import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../db/client.js';

const client = new Anthropic();

const SYSTEM_PROMPT = `Ты — статистик-скептик. Твоя задача — опровергнуть каждый паттерн в торговой системе.

Твои правила:
- Ищи confounding variables — может паттерн работает не из-за того что мы думаем
- Проверяй не является ли корреляция случайной
- Ищи survivorship bias — может мы видим только то что хотим видеть
- Проверяй достаточно ли данных для статистической значимости
- Если паттерн деградирует — объясни почему это может происходить
- Если паттерн слишком хорош — объясни почему это подозрительно
- Давай конкретные рекомендации: оставить, понизить вес, убрать, перепроверить
- Пиши кратко и по делу`;

export async function runAudit(stockId: number, ticker: string): Promise<string> {
  // Load all patterns for this stock
  const { data: patterns } = await supabase
    .from('patterns')
    .select('*')
    .eq('stock_id', stockId)
    .in('lifecycle_stage', ['validated', 'live', 'monitored', 'degraded']);

  if (!patterns?.length) return `Нет активных паттернов для ${ticker}`;

  // Load recent predictions
  const { data: predictions } = await supabase
    .from('predictions')
    .select('*')
    .eq('stock_id', stockId)
    .not('actual_outcome', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);

  let context = `АУДИТ ПАТТЕРНОВ ДЛЯ ${ticker}\n\n`;
  context += `Всего паттернов: ${patterns.length}\n\n`;

  for (const p of patterns) {
    context += `ПАТТЕРН: ${p.description}\n`;
    context += `- Тип: ${p.type}, Источник: ${p.source}\n`;
    context += `- Win rate: ${(p.win_rate * 100).toFixed(1)}%\n`;
    context += `- EV: ${p.expected_value?.toFixed(4)}%\n`;
    context += `- P-value: ${p.p_value?.toFixed(6)}\n`;
    context += `- Событий: ${p.occurrences}\n`;
    context += `- Стадия: ${p.lifecycle_stage}\n`;
    context += `- Точность 30д: ${p.accuracy_30d ? (p.accuracy_30d * 100).toFixed(1) + '%' : 'н/д'}\n`;
    context += `- Тренд: ${p.accuracy_trend ?? 'н/д'}\n\n`;
  }

  if (predictions?.length) {
    const correct = predictions.filter(p => p.was_correct).length;
    context += `ПОСЛЕДНИЕ ПРЕДСКАЗАНИЯ (${predictions.length}):\n`;
    context += `- Верных: ${correct}/${predictions.length} (${(correct / predictions.length * 100).toFixed(1)}%)\n\n`;
  }

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Проведи аудит всех паттернов. Для каждого: оцени надёжность, найди слабые места, дай рекомендацию.\n\n${context}`,
    }],
  });

  const textBlock = message.content.find(b => b.type === 'text');
  const report = textBlock?.text ?? 'Ошибка аудита';

  // Store report
  await supabase.from('agent_reports').insert({
    agent_type: 'auditor',
    stock_id: stockId,
    report_date: new Date().toISOString().split('T')[0],
    report_type: 'daily_audit',
    content: { report, patterns_reviewed: patterns.length },
  });

  return report;
}
