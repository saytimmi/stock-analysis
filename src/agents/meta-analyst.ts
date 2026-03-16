import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../db/client.js';

const client = new Anthropic();

const SYSTEM_PROMPT = `Ты — исследователь рынка. Смотришь на данные без предвзятости предыдущих агентов.

Твои задачи:
- Ищи то, что не искали — новые корреляции, неочевидные паттерны
- Находи кросс-корреляции между акциями если есть данные по нескольким
- Определяй смену рыночного режима — тренд, боковик, высокая волатильность
- Предлагай новые гипотезы для тестирования
- Оценивай общее здоровье системы — работает ли она или деградирует
- Пиши конкретные actionable рекомендации`;

export async function runMetaAnalysis(): Promise<string> {
  // Load all stocks
  const { data: stocks } = await supabase
    .from('stocks')
    .select('id, ticker')
    .eq('active', true);

  // Load all patterns across stocks
  const { data: allPatterns } = await supabase
    .from('patterns')
    .select('*, stocks(ticker)')
    .in('lifecycle_stage', ['validated', 'live', 'monitored', 'degraded']);

  // Load recent agent reports
  const { data: recentReports } = await supabase
    .from('agent_reports')
    .select('*')
    .order('report_date', { ascending: false })
    .limit(10);

  let context = `МЕТА-АНАЛИЗ СИСТЕМЫ\n\n`;
  context += `Активных акций: ${stocks?.length ?? 0}\n`;
  context += `Всего паттернов: ${allPatterns?.length ?? 0}\n\n`;

  if (allPatterns?.length) {
    const byStage: Record<string, number> = {};
    for (const p of allPatterns) {
      byStage[p.lifecycle_stage] = (byStage[p.lifecycle_stage] ?? 0) + 1;
    }
    context += `По стадиям: ${JSON.stringify(byStage)}\n\n`;

    context += `ПАТТЕРНЫ:\n`;
    for (const p of allPatterns) {
      context += `- [${(p as any).stocks?.ticker ?? '?'}] ${p.description} | win: ${(p.win_rate * 100).toFixed(1)}% | EV: ${p.expected_value?.toFixed(2)}% | стадия: ${p.lifecycle_stage}\n`;
    }
    context += '\n';
  }

  if (recentReports?.length) {
    context += `ПОСЛЕДНИЕ ОТЧЁТЫ АУДИТОРА:\n`;
    for (const r of recentReports.slice(0, 3)) {
      const content = r.content as any;
      context += `[${r.report_date}] ${r.agent_type}: ${content?.report?.slice(0, 200) ?? 'н/д'}...\n`;
    }
  }

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Проведи еженедельный мета-анализ. Что упускаем? Какие новые гипотезы стоит проверить? Как улучшить систему?\n\n${context}`,
    }],
  });

  const textBlock = message.content.find(b => b.type === 'text');
  const report = textBlock?.text ?? 'Ошибка мета-анализа';

  await supabase.from('agent_reports').insert({
    agent_type: 'meta_analyst',
    stock_id: null,
    report_date: new Date().toISOString().split('T')[0],
    report_type: 'weekly_meta',
    content: { report },
  });

  return report;
}
