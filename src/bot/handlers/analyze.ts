import { Context, InlineKeyboard } from 'grammy';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../db/client.js';
import { analyzeCurrentSession } from '../../scoring/realtime.js';
import { getActivePatternSignals, computeComposite } from '../../scoring/composite.js';

const MINI_APP_URL = process.env.MINI_APP_URL || '';

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `Ты трейдер. Пишешь как в трейдинг-чате — коротко, конкретно, с цифрами. Без вступлений, без "давайте разберёмся", без списков что ты "можешь сделать".

СТИЛЬ:
- Пишешь как человек в чате, не как ИИ-ассистент
- Никогда не пиши "я могу", "давайте", "позвольте" — просто делай
- Не используй маркдаун жирный текст (звёздочки)
- Не делай списки с буллетами — пиши текстом
- Не предлагай пользователю куда-то зайти (TradingView, Finviz и т.д.) — у тебя есть свои данные
- Никогда не говори что у тебя нет данных — у тебя 498 дней истории, 8 проверенных паттернов
- Если рынок закрыт — анализируй последний торговый день и паттерны
- Цифры, проценты, конкретика. "В 69% случаев гэп вниз закрывался внутри дня" — вот так

ДАННЫЕ:
Ты работаешь с системой которая проанализировала 498 торговых дней ALAB. Нашла 8 статистически подтверждённых паттернов (прошли walk-forward backtesting, p-value < 0.05). У тебя есть исторические аналоги — дни когда акция вела себя похоже.

Когда спрашивают про акцию — давай конкретный анализ: какие паттерны работают, с какой вероятностью, что было в похожих днях, куда вероятнее пойдёт.`;

// Load all available data for context
async function buildContext(ticker?: string): Promise<string> {
  let context = '';

  // List tracked stocks
  const { data: stocks } = await supabase
    .from('stocks')
    .select('id, ticker, name')
    .eq('active', true);

  context += `ОТСЛЕЖИВАЕМЫЕ АКЦИИ: ${stocks?.map(s => `${s.ticker} (${s.name})`).join(', ') ?? 'нет'}\n\n`;

  if (ticker && stocks) {
    const stock = stocks.find(s => s.ticker === ticker.toUpperCase());
    if (stock) {
      // Load patterns
      const { data: patterns } = await supabase
        .from('patterns')
        .select('description, win_rate, expected_value, occurrences, lifecycle_stage, type')
        .eq('stock_id', stock.id)
        .in('lifecycle_stage', ['validated', 'live', 'monitored'])
        .order('win_rate', { ascending: false });

      if (patterns?.length) {
        context += `ПАТТЕРНЫ ${ticker.toUpperCase()} (${patterns.length} шт):\n`;
        for (const p of patterns) {
          context += `• ${p.description}\n  Win rate: ${(p.win_rate * 100).toFixed(1)}% | EV: ${p.expected_value?.toFixed(2)}% | Событий: ${p.occurrences} | Стадия: ${p.lifecycle_stage}\n`;
        }
        context += '\n';
      }

      // Try to get current session
      try {
        const analogResult = await analyzeCurrentSession(stock.id, ticker.toUpperCase());

        context += `ТЕКУЩАЯ СЕССИЯ ${ticker.toUpperCase()}:\n`;
        context += `• От открытия: ${analogResult.current_pct >= 0 ? '+' : ''}${analogResult.current_pct.toFixed(2)}%\n`;
        context += `• Свечей: ${analogResult.candles_so_far} (${analogResult.candles_so_far * 15} мин)\n\n`;

        if (analogResult.analogs.length > 0) {
          context += `ПОХОЖИЕ ИСТОРИЧЕСКИЕ ДНИ:\n`;
          for (const a of analogResult.analogs.slice(0, 7)) {
            context += `• ${a.date} (сходство ${(a.similarity * 100).toFixed(0)}%) → закрылся ${a.day_change_pct >= 0 ? '+' : ''}${a.day_change_pct.toFixed(2)}%`;
            context += ` | макс вверх: +${a.max_gain_after.toFixed(2)}% | макс вниз: ${a.max_loss_after.toFixed(2)}%\n`;
          }
          context += `\nКонсенсус: ${analogResult.consensus.bullish_count} вверх / ${analogResult.consensus.bearish_count} вниз\n`;
          context += `Среднее оставшееся движение: ${analogResult.consensus.avg_remaining_move >= 0 ? '+' : ''}${analogResult.consensus.avg_remaining_move.toFixed(2)}%\n\n`;
        }

        // Composite score
        const currentCandles = analogResult.candles_so_far > 0
          ? Array.from({ length: analogResult.candles_so_far }, () => ({
              pct_from_open: analogResult.current_pct, volume: 0,
            }))
          : [];

        const patternSignals = await getActivePatternSignals(stock.id, currentCandles);
        const allSignals = [...patternSignals];

        if (analogResult.analogs.length > 0) {
          const { consensus } = analogResult;
          const total = consensus.bullish_count + consensus.bearish_count;
          allSignals.push({
            source: 'analog_consensus',
            direction: consensus.avg_remaining_move > 0 ? 'up' : 'down',
            strength: Math.min(Math.abs(consensus.avg_remaining_move) / 3, 1),
            weight: 0.30,
            accuracy: total > 0 ? consensus.bullish_count / total : 0.5,
          });
        }

        const composite = computeComposite(allSignals);
        context += `КОМПОЗИТНЫЙ СКОР: ${composite.score.toFixed(0)} (${composite.confidence === 'high' ? 'высокая уверенность' : composite.confidence === 'medium' ? 'средняя' : 'низкая'})\n`;
        context += `EV: ${composite.expected_value.toFixed(2)}% | Стоп-лосс: ${composite.suggested_stop_loss.toFixed(2)}%\n`;
        const dataSource = (analogResult as any).data_source;
        if (dataSource) {
          context += `Источник данных: ${dataSource}\n`;
        }
      } catch (err: any) {
        context += `Ошибка загрузки сессии: ${err.message}\n`;
      }
    }
  }

  return context;
}

// Conversation history per chat
const chatHistory = new Map<number, Array<{ role: 'user' | 'assistant'; content: string }>>();

export async function handleAnalyze(ctx: Context) {
  const text = ctx.message?.text?.trim();
  const chatId = ctx.chat?.id;
  if (!text || !chatId) return;

  // Detect if there's a ticker mentioned
  const potentialTickers = text.toUpperCase().match(/\b[A-Z]{2,5}\b/g) ?? [];

  // Check which ones are actual tracked stocks
  const { data: stocks } = await supabase
    .from('stocks')
    .select('ticker')
    .eq('active', true);

  const trackedTickers = new Set(stocks?.map(s => s.ticker) ?? []);
  const mentionedTicker = potentialTickers.find(t => trackedTickers.has(t));

  // Always load ALAB data as default if no specific ticker mentioned
  const tickerToAnalyze = mentionedTicker ?? (trackedTickers.has('ALAB') ? 'ALAB' : undefined);

  // Build context with data
  const dataContext = await buildContext(tickerToAnalyze);

  // Get/init conversation history
  if (!chatHistory.has(chatId)) {
    chatHistory.set(chatId, []);
  }
  const history = chatHistory.get(chatId)!;

  // Add user message
  history.push({ role: 'user', content: text });

  // Keep last 10 messages for context
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: SYSTEM_PROMPT + '\n\n--- АКТУАЛЬНЫЕ ДАННЫЕ ---\n' + dataContext,
      messages: history.map(m => ({ role: m.role, content: m.content })),
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const reply = textBlock?.text ?? 'Ошибка генерации ответа';

    // Save assistant response to history
    history.push({ role: 'assistant', content: reply });

    // Build inline keyboard with Mini App button
    const kb = MINI_APP_URL
      ? new InlineKeyboard().webApp(
          '📊 Открыть в приложении',
          tickerToAnalyze ? `${MINI_APP_URL}?ticker=${tickerToAnalyze}` : MINI_APP_URL,
        )
      : undefined;

    // Send, handling Telegram's 4096-char message limit
    if (reply.length > 4000) {
      const chunks = reply.match(/.{1,4000}/gs) ?? [reply];
      for (let i = 0; i < chunks.length; i++) {
        // Attach button only to the last chunk
        const opts = i === chunks.length - 1 && kb ? { reply_markup: kb } : {};
        await ctx.reply(chunks[i], opts);
      }
    } else {
      await ctx.reply(reply, kb ? { reply_markup: kb } : {});
    }

  } catch (err: any) {
    console.error('Claude error:', err);
    await ctx.reply(`Ошибка: ${err.message}`);
  }
}
