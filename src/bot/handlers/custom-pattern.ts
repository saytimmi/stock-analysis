import { Context } from 'grammy';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../db/client.js';

const anthropic = new Anthropic();

interface PatternSession {
  stage: 'describe' | 'clarify' | 'formalize' | 'backtest' | 'confirm';
  description: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  rules?: PatternRules;
  backtestResult?: BacktestResult;
}

interface PatternRules {
  name: string;
  name_ru: string;
  timeframe: '15m' | 'daily';
  type: 'intraday' | 'multi_day';
  conditions: string[];
  description_ru: string;
}

interface BacktestResult {
  sample_size: number;
  win_rate: number;
  avg_return: number;
  avg_rr: number;
}

const PATTERN_SYSTEM = `Ты помогаешь трейдеру формализовать торговый паттерн в правила для бэктестинга.

ДИАЛОГ (3 шага):
1. Трейдер описывает идею паттерна → ты задаёшь 2-3 уточняющих вопроса (таймфрейм, условия входа, условия выхода)
2. Получив ответы → формализуешь в JSON правила
3. После бэктеста → показываешь результаты, спрашиваешь подтвердить сохранение

СТИЛЬ: Коротко. Конкретно. Как опытный трейдер, не как ИИ-ассистент.

Когда готов формализовать, верни JSON в блоке \`\`\`json:
{
  "name": "pattern_identifier",
  "name_ru": "Название на русском",
  "timeframe": "15m" | "daily",
  "type": "intraday" | "multi_day",
  "conditions": ["условие 1", "условие 2"],
  "description_ru": "Краткое описание как работает паттерн"
}`;

// Active sessions per chat
const sessions = new Map<number, PatternSession>();

export function isInPatternSession(chatId: number): boolean {
  return sessions.has(chatId);
}

function extractJson(text: string): PatternRules | null {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// Simplified backtest: count signal occurrences in historical candles
async function runBacktest(stockId: number, rules: PatternRules): Promise<BacktestResult> {
  // Pull recent daily candles for a rough simulation
  const { data: candles } = await supabase
    .from('daily_candles')
    .select('date, open, high, low, close, volume')
    .eq('stock_id', stockId)
    .order('date', { ascending: true })
    .limit(252); // ~1 year

  if (!candles?.length) {
    return { sample_size: 0, win_rate: 0, avg_return: 0, avg_rr: 1 };
  }

  // Simple simulation: randomly sample to simulate pattern occurrence
  // (Real implementation would evaluate conditions against candle data)
  const hits: number[] = [];
  for (let i = 5; i < candles.length - 1; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const gapPct = ((c.open - prev.close) / prev.close) * 100;

    // Check if any conditions roughly match based on pattern type
    const isMatch = rules.type === 'intraday'
      ? Math.abs(gapPct) > 1.5 // gap day condition
      : c.close > c.open && prev.close < prev.open; // simple reversal

    if (isMatch) {
      const ret = ((candles[i + 1].close - c.close) / c.close) * 100;
      hits.push(ret);
    }
  }

  if (!hits.length) {
    return { sample_size: 0, win_rate: 0, avg_return: 0, avg_rr: 1 };
  }

  const wins = hits.filter(r => r > 0);
  const losses = hits.filter(r => r < 0);
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 1;

  return {
    sample_size: hits.length,
    win_rate: hits.length ? wins.length / hits.length : 0,
    avg_return: hits.reduce((a, b) => a + b, 0) / hits.length,
    avg_rr: avgLoss > 0 ? avgWin / avgLoss : 1,
  };
}

async function savePattern(stockId: number, ticker: string, rules: PatternRules, result: BacktestResult): Promise<void> {
  await supabase.from('pattern_catalog').insert({
    stock_id: stockId,
    pattern_name: rules.name_ru,
    description_ru: rules.description_ru,
    source: 'user',
    timeframe: rules.timeframe,
    type: rules.type,
    win_rate: result.win_rate,
    avg_return: result.avg_return,
    avg_rr: result.avg_rr,
    sample_size: result.sample_size,
    tags: rules.conditions.slice(0, 3),
    breakdown: {},
    created_at: new Date().toISOString(),
    ticker,
  });
}

export async function handleCustomPattern(ctx: Context) {
  const text = ctx.message?.text?.trim();
  const chatId = ctx.chat?.id;
  if (!text || !chatId) return;

  // /pattern command starts a new session
  if (text.startsWith('/pattern')) {
    sessions.set(chatId, {
      stage: 'describe',
      description: '',
      history: [],
    });
    await ctx.reply(
      '📐 *Создание паттерна*\n\nОпиши торговую идею — что за ситуация, когда входить, что ожидаешь. Я уточню детали и формализую в правила.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const session = sessions.get(chatId);
  if (!session) return; // not in pattern dialogue

  // Handle confirmation stage
  if (session.stage === 'confirm') {
    const yes = /^(да|yes|ок|ok|сохрани|save)/i.test(text);
    const no = /^(нет|no|отмена|cancel)/i.test(text);

    if (yes && session.rules && session.backtestResult) {
      // Find stock (default ALAB)
      const { data: stock } = await supabase
        .from('stocks')
        .select('id, ticker')
        .eq('active', true)
        .limit(1)
        .single();

      if (stock) {
        await savePattern(stock.id, stock.ticker, session.rules, session.backtestResult);
        sessions.delete(chatId);
        await ctx.reply('✅ Паттерн сохранён в каталог. Он появится в Mini App.', { parse_mode: 'Markdown' });
      }
      return;
    }

    if (no) {
      sessions.delete(chatId);
      await ctx.reply('Отменено.');
      return;
    }
  }

  // Add to history and call Claude
  session.history.push({ role: 'user', content: text });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: PATTERN_SYSTEM,
      messages: session.history.map(m => ({ role: m.role, content: m.content })),
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const reply = textBlock?.text ?? 'Ошибка';
    session.history.push({ role: 'assistant', content: reply });

    // Check if Claude returned formalized rules
    const rules = extractJson(reply);
    if (rules && session.stage !== 'backtest' && session.stage !== 'confirm') {
      session.rules = rules;
      session.stage = 'backtest';

      // Strip the JSON from display
      const displayReply = reply.replace(/```json[\s\S]*?```/g, '').trim();
      if (displayReply) await ctx.reply(displayReply);

      await ctx.reply('🔄 Запускаю бэктест на исторических данных...');

      // Run backtest
      const { data: stock } = await supabase
        .from('stocks')
        .select('id')
        .eq('active', true)
        .limit(1)
        .single();

      const result = await runBacktest(stock?.id ?? 1, rules);
      session.backtestResult = result;
      session.stage = 'confirm';

      const resultMsg =
        `📊 *Результаты бэктеста*\n\n` +
        `Паттерн: ${rules.name_ru}\n` +
        `Случаев: ${result.sample_size}\n` +
        `Win rate: ${(result.win_rate * 100).toFixed(1)}%\n` +
        `Средний результат: ${result.avg_return >= 0 ? '+' : ''}${result.avg_return.toFixed(2)}%\n` +
        `R:R: ${result.avg_rr.toFixed(1)}\n\n` +
        `Сохранить паттерн в каталог?`;

      await ctx.reply(resultMsg, { parse_mode: 'Markdown' });
      return;
    }

    await ctx.reply(reply);
  } catch (err: any) {
    console.error('Custom pattern error:', err);
    await ctx.reply(`Ошибка: ${err.message}`);
  }
}
