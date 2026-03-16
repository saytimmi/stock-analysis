import Anthropic from '@anthropic-ai/sdk';
import { AnalogResult } from '../scoring/similarity.js';
import { CompositeResult } from '../scoring/composite.js';

const client = new Anthropic();

const SYSTEM_PROMPT = `Ты — опытный интрадей трейдер. Ты торгуешь вероятностями, не гарантиями. Ты анализируешь акции на основе статистических паттернов и исторических аналогов.

Твои правила:
- Всегда говори прямо и конкретно, без воды
- Указывай конкретные уровни входа, стопа и цели
- Объясняй логику через исторические аналоги — "в 7 из 10 похожих дней акция откатывала"
- Никогда не говори "не знаю" — всегда есть ближайший аналог
- Оценивай риск/доходность каждой ситуации
- Предупреждай о рисках — если ситуация неоднозначная, скажи об этом
- Пиши кратко, по делу, как в трейдинг-чате
- Используй проценты и конкретные цифры, не общие слова
- Если рынок закрыт или данных мало — анализируй на основе того что есть`;

export async function traderAnalysis(
  ticker: string,
  stockName: string,
  analogResult: AnalogResult,
  composite: CompositeResult,
  patterns: any[],
): Promise<string> {
  // Build context for Claude
  let context = `Акция: ${ticker} (${stockName})\n\n`;

  // Current situation
  context += `ТЕКУЩАЯ СИТУАЦИЯ:\n`;
  context += `- От открытия: ${analogResult.current_pct >= 0 ? '+' : ''}${analogResult.current_pct.toFixed(2)}%\n`;
  context += `- Прошло свечей: ${analogResult.candles_so_far} (${analogResult.candles_so_far * 15} мин от открытия)\n\n`;

  // Composite score
  context += `КОМПОЗИТНЫЙ СКОР: ${composite.score.toFixed(0)} (${composite.confidence})\n`;
  context += `- Ожидаемая доходность: ${composite.expected_value.toFixed(2)}%\n`;
  context += `- Риск/доходность: ${composite.risk_reward.toFixed(1)}\n`;
  context += `- Рекомендуемый стоп: ${composite.suggested_stop_loss.toFixed(2)}%\n\n`;

  // Signals
  if (composite.signals.length > 0) {
    context += `СИГНАЛЫ:\n`;
    for (const s of composite.signals) {
      context += `- ${s.source}: ${s.direction} (сила: ${(s.strength * 100).toFixed(0)}%, точность: ${((s.accuracy ?? 0.5) * 100).toFixed(0)}%)\n`;
    }
    context += '\n';
  }

  // Historical analogs
  if (analogResult.analogs.length > 0) {
    context += `ПОХОЖИЕ ИСТОРИЧЕСКИЕ ДНИ (топ ${Math.min(analogResult.analogs.length, 10)}):\n`;
    for (const a of analogResult.analogs.slice(0, 10)) {
      context += `- ${a.date}: сходство ${(a.similarity * 100).toFixed(0)}%, закрытие ${a.day_change_pct >= 0 ? '+' : ''}${a.day_change_pct.toFixed(2)}%, макс рост после ${a.max_gain_after.toFixed(2)}%, макс падение после ${a.max_loss_after.toFixed(2)}%\n`;
    }
    context += `\nКонсенсус: ${analogResult.consensus.bullish_count} вверх / ${analogResult.consensus.bearish_count} вниз\n`;
    context += `Среднее оставшееся движение: ${analogResult.consensus.avg_remaining_move.toFixed(2)}%\n`;
    context += `Медианное: ${analogResult.consensus.median_remaining_move.toFixed(2)}%\n\n`;
  } else {
    context += `Рынок закрыт или свечей ещё нет. Анализируй на основе паттернов.\n\n`;
  }

  // Active patterns
  if (patterns.length > 0) {
    context += `АКТИВНЫЕ ПАТТЕРНЫ ПО АКЦИИ:\n`;
    for (const p of patterns) {
      context += `- ${p.description} (win: ${(p.win_rate * 100).toFixed(1)}%, EV: ${p.expected_value?.toFixed(2)}%, событий: ${p.occurrences})\n`;
    }
  }

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Проанализируй текущую ситуацию и дай конкретную торговую рекомендацию.\n\n${context}`,
    }],
  });

  const textBlock = message.content.find(b => b.type === 'text');
  return textBlock?.text ?? 'Ошибка генерации анализа';
}
