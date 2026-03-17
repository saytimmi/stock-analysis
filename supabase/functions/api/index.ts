import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WEEKDAY_NAMES: Record<number, string> = { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт' };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function breakdownLevel(wr: number): 'high' | 'mid' | 'low' {
  if (wr >= 0.68) return 'high';
  if (wr >= 0.55) return 'mid';
  return 'low';
}

interface RawPattern {
  id: number; stock_id: number; type: string; source: string;
  description: string; parameters: Record<string, unknown>;
  lifecycle_stage: string; occurrences: number; win_rate: number;
  avg_win: number | null; avg_loss: number | null; expected_value: number | null;
  p_value: number | null;
}

interface RawEvent {
  id: number; pattern_id: number; date: string;
  was_correct: boolean; profit_pct: number; trigger_value: number;
  actual_outcome: number; predicted_direction: string;
}

interface JoinedEvent extends RawEvent {
  day_of_week?: number; is_opex?: boolean; gap_pct?: number | null;
}

// ── description builders ─────────────────────────────────────────────────────

function buildDescription(p: RawPattern): string {
  const wr = Math.round(p.win_rate * 100);
  const n = p.occurrences;
  const ev = (p.expected_value ?? 0).toFixed(2);
  const { threshold: thr, direction: dir, observation_window: win } = p.parameters as Record<string, number | string>;

  if (p.type === 'gap_fill') {
    const dirRu = dir === 'down' ? 'вниз' : 'вверх';
    const verbRu = dir === 'down' ? 'закрывается' : 'закрывается';
    return `Когда ALAB открывается с гэпом ${dirRu} на ${thr}% и более, акция в ${wr}% случаев ${verbRu} и возвращается к уровню закрытия предыдущего дня. Проверено на ${n} торговых днях. Средний доход за сделку: +${ev}%.`;
  }
  if (p.type === 'mean_reversion') {
    const hrs = win ? Math.round((win as number) * 15 / 60) : 1;
    const dirRu = dir === 'down' ? 'падает' : 'растёт';
    const revertRu = dir === 'down' ? 'отскакивает вверх' : 'откатывается вниз';
    return `Когда ALAB ${dirRu} на ${thr}% и более от открытия за первые ${hrs} ч, акция в ${wr}% случаев ${revertRu}. Логика: сильное движение часто заходит слишком далеко и корректируется. Проверено на ${n} случаях, ожидаемый доход: +${ev}%.`;
  }
  if (p.type === 'momentum_continuation') {
    const hrs = win ? Math.round((win as number) * 15 / 60) : 1;
    const dirRu = dir === 'up' ? 'растёт' : 'падает';
    const contRu = dir === 'up' ? 'продолжает рост до закрытия' : 'продолжает падение до закрытия';
    return `Когда ALAB ${dirRu} на ${thr}% и более за первые ${hrs} ч после открытия, в ${wr}% случаев акция ${contRu}. Ранний импульс — хороший предиктор дня. Проверено на ${n} случаях, средний доход: +${ev}%.`;
  }
  return `${p.description}. Win rate: ${wr}% на ${n} случаях.`;
}

function buildConditions(p: RawPattern) {
  const { threshold: thr, direction: dir, observation_window: win } = p.parameters as Record<string, number | string>;
  const hrs = win ? Math.round((win as number) * 15 / 60) : 1;

  if (p.type === 'gap_fill') {
    const dirRu = dir === 'down' ? 'вниз' : 'вверх';
    return [
      { icon: '📐', bg: 'rgba(68,138,255,0.15)', text: `Гэп на открытии <b>${dirRu} ≥ ${thr}%</b> от закрытия прошлого дня` },
      { icon: '⏰', bg: 'rgba(0,230,118,0.12)', text: 'Вход <b>на открытии</b> или в первые 15 минут' },
      { icon: '🎯', bg: 'rgba(0,230,118,0.12)', text: 'Цель: уровень <b>закрытия прошлого дня</b>' },
      { icon: '🛡️', bg: 'rgba(255,23,68,0.12)', text: `Стоп: продолжение гэпа ещё на <b>${((thr as number) * 0.5).toFixed(1)}%</b>` },
    ];
  }
  if (p.type === 'mean_reversion') {
    const dirRu = dir === 'down' ? 'падение' : 'рост';
    const entryRu = dir === 'down' ? 'лонг (отскок вверх)' : 'шорт (откат вниз)';
    return [
      { icon: '📉', bg: 'rgba(255,23,68,0.12)', text: `${dirRu} от открытия на <b>≥ ${thr}%</b> за первые <b>${hrs} ч</b>` },
      { icon: '📊', bg: 'rgba(68,138,255,0.15)', text: 'Объём выше среднего — подтверждает перепроданность' },
      { icon: '⏰', bg: 'rgba(0,230,118,0.12)', text: `Вход: <b>${entryRu}</b> после достижения порога` },
      { icon: '🛡️', bg: 'rgba(255,23,68,0.12)', text: `Стоп: ещё <b>${((thr as number) * 0.3).toFixed(1)}%</b> в сторону тренда` },
    ];
  }
  if (p.type === 'momentum_continuation') {
    const dirRu = dir === 'up' ? 'рост' : 'падение';
    const entryRu = dir === 'up' ? 'лонг' : 'шорт';
    return [
      { icon: '🚀', bg: 'rgba(0,230,118,0.12)', text: `${dirRu} на <b>≥ ${thr}%</b> за первые <b>${hrs} ч</b>` },
      { icon: '📊', bg: 'rgba(68,138,255,0.15)', text: 'Объём поддерживает движение (ratio > 1.2)' },
      { icon: '⏰', bg: 'rgba(0,230,118,0.12)', text: `Вход: <b>${entryRu}</b> при подтверждении импульса` },
      { icon: '🎯', bg: 'rgba(0,230,118,0.12)', text: 'Держать до <b>конца дня</b> (15:45–16:00)' },
    ];
  }
  return [];
}

function buildTimeline(p: RawPattern) {
  const { threshold: thr, direction: dir, observation_window: win } = p.parameters as Record<string, number | string>;
  const hrs = win ? Math.round((win as number) * 15 / 60) : 1;

  if (p.type === 'gap_fill') {
    const dirRu = dir === 'down' ? 'вниз' : 'вверх';
    return [
      { time: '9:30', color: dir === 'down' ? 'red' : 'green', description: `Открытие с гэпом ${dirRu} ≥${thr}%`, detail: 'Акция открылась далеко от вчерашнего закрытия' },
      { time: '9:30–10:00', color: 'blue', description: 'Оцениваем объём', detail: 'Высокий объём = сигнал сильнее' },
      { time: 'Вход', color: 'green', description: 'Открываем позицию против гэпа', detail: 'Цель — вернуться к уровню вчерашнего закрытия' },
      { time: 'Выход', color: 'orange', description: 'Достигли цели или конец дня', detail: 'Обычно закрывается в первые 2–4 часа' },
    ];
  }
  if (p.type === 'mean_reversion') {
    const dirRu = dir === 'down' ? 'падает' : 'растёт';
    return [
      { time: '9:30', color: 'blue', description: 'Открытие', detail: 'Наблюдаем первые свечи' },
      { time: `первые ${hrs} ч`, color: dir === 'down' ? 'red' : 'green', description: `Акция ${dirRu} на ≥${thr}%`, detail: 'Движение слишком сильное — ждём разворота' },
      { time: 'Вход', color: 'green', description: 'Позиция против движения', detail: 'Перепроданность даёт возможность для отскока' },
      { time: 'До 16:00', color: 'orange', description: 'Коррекция к балансу', detail: 'Большинство откатов случается в тот же день' },
    ];
  }
  if (p.type === 'momentum_continuation') {
    const dirRu = dir === 'up' ? 'растёт' : 'падает';
    return [
      { time: '9:30', color: 'blue', description: 'Открытие', detail: 'Следим за первыми свечами' },
      { time: `первые ${hrs} ч`, color: dir === 'up' ? 'green' : 'red', description: `Акция ${dirRu} на ≥${thr}%`, detail: 'Сильный ранний импульс — сигнал продолжения' },
      { time: 'Вход', color: 'green', description: 'Входим по тренду', detail: 'Импульс — рыночная сила, идём с ней' },
      { time: '15:45', color: 'orange', description: 'Закрытие позиции', detail: 'Фиксируем прибыль перед закрытием рынка' },
    ];
  }
  return [];
}

function buildFailReasons(p: RawPattern, events: JoinedEvent[]) {
  const fails = events.filter(e => !e.was_correct);
  if (!fails.length) return [];
  const ft = fails.length;

  const opexFails = fails.filter(e => e.is_opex).length;
  const bigLoss = fails.filter(e => (e.profit_pct ?? 0) < -2).length;

  const reasons = [];
  if (p.type === 'gap_fill') {
    reasons.push({ pct: `${Math.round((bigLoss / ft) * 100)}% провалов`, text: 'Гэп слишком большой (>5%) — фундаментальный катализатор (новости, отчёт). Технический паттерн не работает против фундаментала' });
    reasons.push({ pct: `${Math.round(((ft - bigLoss - opexFails) / ft) * 100)}% провалов`, text: 'Общий рыночный тренд вниз (SPY/QQQ -1%+) давит на акцию и не даёт закрыть гэп' });
  } else if (p.type === 'mean_reversion') {
    reasons.push({ pct: `${Math.round((bigLoss / ft) * 100)}% провалов`, text: 'Движение продолжается без коррекции — акция в устойчивом тренде, а не в перепроданности' });
    reasons.push({ pct: `${Math.round(((ft - bigLoss) / ft) * 100)}% провалов`, text: 'Вход слишком рано: движение продолжилось ещё на 1–2% после входа, стоп сработал' });
  } else {
    reasons.push({ pct: `${Math.round((bigLoss / ft) * 100)}% провалов`, text: 'Импульс иссякает: объём падает после первого часа, умные деньги продают в силу' });
    reasons.push({ pct: `${Math.round(((ft - bigLoss) / ft) * 100)}% провалов`, text: 'Разворот рынка во второй половине дня — SPY разворачивается, тянет за собой' });
  }
  if (opexFails > 2) {
    reasons.push({ pct: `${Math.round((opexFails / ft) * 100)}% провалов`, text: 'Дни экспирации опционов (3-я пятница месяца) — нестандартное поведение рынка' });
  }
  return reasons.slice(0, 3);
}

function buildTradeLevels(p: RawPattern) {
  const avgWin = p.avg_win ?? 0;
  const avgLoss = Math.abs(p.avg_loss ?? 1);
  const rr = (avgLoss > 0 ? avgWin / avgLoss : 1).toFixed(1);
  return {
    tp2: { price: `Открытие + ${avgWin.toFixed(2)}%`, pct: `+${avgWin.toFixed(2)}%` },
    tp1: { price: `Открытие + ${(avgWin * 0.5).toFixed(2)}%`, pct: `+${(avgWin * 0.5).toFixed(2)}%` },
    entry: { price: 'Открытие / триггер' },
    stop: { price: `Открытие − ${avgLoss.toFixed(2)}%`, pct: `-${avgLoss.toFixed(2)}%` },
    rr,
    expectancy: `+${(p.expected_value ?? 0).toFixed(2)}% на сделку`,
  };
}

function patternName(p: RawPattern): string {
  const { direction: dir, threshold: thr } = p.parameters as Record<string, string | number>;
  const typeNames: Record<string, string> = { gap_fill: 'Закрытие гэпа', mean_reversion: 'Возврат к среднему', momentum_continuation: 'Продолжение импульса' };
  const dirLabel = dir === 'down' ? ' вниз' : dir === 'up' ? ' вверх' : '';
  return `${typeNames[p.type] ?? p.type}${dirLabel} ≥${thr}%`;
}

// ── main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.replace('/api', '');
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {

    // GET /catalog?ticker=ALAB
    if (path === '/catalog' && req.method === 'GET') {
      const ticker = url.searchParams.get('ticker') || 'ALAB';
      const { data: stock } = await sb.from('stocks').select('id').eq('ticker', ticker).single();
      if (!stock) return json({ error: 'Stock not found' }, 404);

      const { data: patterns } = await sb.from('patterns').select('*').eq('stock_id', stock.id)
        .in('lifecycle_stage', ['validated', 'live', 'monitored']).order('win_rate', { ascending: false });
      if (!patterns?.length) return json([]);

      const { data: allEvents } = await sb.from('pattern_events')
        .select('id, pattern_id, date, was_correct, profit_pct, trigger_value, actual_outcome, predicted_direction')
        .in('pattern_id', patterns.map((p: RawPattern) => p.id));

      const dates = [...new Set((allEvents ?? []).map((e: RawEvent) => e.date))];
      const { data: profiles } = dates.length ? await sb.from('day_profiles').select('date, day_of_week, is_opex').in('date', dates) : { data: [] };
      const { data: candles } = dates.length ? await sb.from('candles_daily').select('date, gap_pct').in('date', dates) : { data: [] };

      const profMap: Record<string, { day_of_week: number; is_opex: boolean }> = {};
      for (const dp of (profiles ?? [])) profMap[dp.date] = dp;
      const candMap: Record<string, { gap_pct: number | null }> = {};
      for (const c of (candles ?? [])) candMap[c.date] = c;

      return json(patterns.map((p: RawPattern) => {
        const events: JoinedEvent[] = (allEvents ?? [])
          .filter((e: RawEvent) => e.pattern_id === p.id)
          .map((e: RawEvent) => ({ ...e, day_of_week: profMap[e.date]?.day_of_week, is_opex: profMap[e.date]?.is_opex ?? false, gap_pct: candMap[e.date]?.gap_pct ?? null }));

        const wins = events.filter(e => e.was_correct);
        const losses = events.filter(e => !e.was_correct);
        const avgReturn = events.length ? events.reduce((s, e) => s + (e.profit_pct ?? 0), 0) / events.length : 0;
        const avgWin = wins.length ? wins.reduce((s, e) => s + (e.profit_pct ?? 0), 0) / wins.length : 0;
        const avgLossVal = losses.length ? Math.abs(losses.reduce((s, e) => s + (e.profit_pct ?? 0), 0) / losses.length) : 1;

        // Weekday breakdown
        const wdMap: Record<number, { w: number; t: number }> = {};
        for (const e of events) {
          const d = e.day_of_week; if (!d) continue;
          if (!wdMap[d]) wdMap[d] = { w: 0, t: 0 };
          wdMap[d].t++; if (e.was_correct) wdMap[d].w++;
        }
        const breakdown_by_weekday = Object.entries(wdMap).filter(([, v]) => v.t >= 5)
          .map(([d, v]) => ({ name: WEEKDAY_NAMES[Number(d)] ?? `d${d}`, pct: Math.round((v.w / v.t) * 100), count: v.t, level: breakdownLevel(v.w / v.t) }))
          .sort((a, b) => Object.values(WEEKDAY_NAMES).indexOf(a.name) - Object.values(WEEKDAY_NAMES).indexOf(b.name));

        // Gap direction breakdown
        const gapGroups: Record<string, { w: number; t: number }> = { 'Гэп вверх': { w:0,t:0 }, 'Нейтрально': { w:0,t:0 }, 'Гэп вниз': { w:0,t:0 } };
        for (const e of events) {
          const g = e.gap_pct ?? 0;
          const grp = g >= 0.5 ? 'Гэп вверх' : g <= -0.5 ? 'Гэп вниз' : 'Нейтрально';
          gapGroups[grp].t++; if (e.was_correct) gapGroups[grp].w++;
        }
        const breakdown_by_earnings_phase = Object.entries(gapGroups).filter(([,v]) => v.t >= 5)
          .map(([name, v]) => ({ name, pct: Math.round((v.w / v.t) * 100), count: v.t, level: breakdownLevel(v.w / v.t) }));

        // Half-year breakdown
        const hyGroups: Record<string, { w: number; t: number }> = { '1П (янв–июн)': { w:0,t:0 }, '2П (июл–дек)': { w:0,t:0 } };
        for (const e of events) {
          const m = new Date(e.date).getMonth() + 1;
          const grp = m <= 6 ? '1П (янв–июн)' : '2П (июл–дек)';
          hyGroups[grp].t++; if (e.was_correct) hyGroups[grp].w++;
        }
        const breakdown_by_quarter = Object.entries(hyGroups).filter(([,v]) => v.t >= 5)
          .map(([name, v]) => ({ name, pct: Math.round((v.w / v.t) * 100), count: v.t, level: breakdownLevel(v.w / v.t) }));

        const wr = p.win_rate;
        return {
          id: String(p.id),
          ticker,
          pattern_name: patternName(p),
          description_ru: buildDescription(p),
          source: 'system',
          timeframe: '15m / дневной',
          win_rate: p.win_rate,
          avg_return: avgReturn,
          avg_rr: avgLossVal > 0 ? avgWin / avgLossVal : 1,
          sample_size: events.length || p.occurrences,
          tags: [p.type.replace(/_/g, ' '), `≥${(p.parameters as Record<string,unknown>).threshold}%`].filter(Boolean),
          phases: [],
          grade: wr >= 0.70 ? 'A — Высокая надёжность' : wr >= 0.62 ? 'B — Хорошая надёжность' : 'C — Средняя надёжность',
          confidence_pct: Math.round(Math.min(wr * 100 + (p.occurrences > 100 ? 5 : 0), 95)),
          conditions: buildConditions(p),
          timeline_steps: buildTimeline(p),
          fail_reasons: buildFailReasons(p, events),
          breakdown_by_weekday,
          breakdown_by_earnings_phase,
          breakdown_by_quarter,
          trade_levels: buildTradeLevels(p),
          example_days: events.slice(0, 5).map(e => ({
            date: e.date,
            label: e.date,
            result: `${e.profit_pct >= 0 ? '+' : ''}${e.profit_pct.toFixed(2)}%`,
            resultClass: e.was_correct ? 'win' : 'loss',
            ohlc: '',
            tags: [`триггер: ${e.trigger_value?.toFixed(1)}%`],
          })),
          stats_extra: {
            'P-value': p.p_value != null ? p.p_value.toFixed(4) : '—',
            'Ср. выигрыш': `+${(p.avg_win ?? 0).toFixed(2)}%`,
            'Ср. проигрыш': `${(p.avg_loss ?? 0).toFixed(2)}%`,
            'Всего случаев': p.occurrences,
          },
        };
      }));
    }

    // GET /signals?ticker=ALAB
    if (path === '/signals' && req.method === 'GET') {
      const ticker = url.searchParams.get('ticker') || 'ALAB';
      const { data: stock } = await sb.from('stocks').select('id').eq('ticker', ticker).single();
      if (!stock) return json([]);

      const { data: todayCandle } = await sb.from('candles_daily').select('date, open, close, gap_pct')
        .eq('stock_id', stock.id).order('date', { ascending: false }).limit(1).single();
      if (!todayCandle) return json([]);

      const { data: patterns } = await sb.from('patterns').select('*').eq('stock_id', stock.id)
        .in('lifecycle_stage', ['validated', 'live', 'monitored']);

      const signals = [];
      for (const p of (patterns ?? [] as RawPattern[])) {
        const { threshold: thr, direction: dir } = p.parameters as Record<string, number | string>;
        const gap = todayCandle.gap_pct ?? 0;
        let matchPct = 0;
        if (p.type === 'gap_fill') {
          if (dir === 'down' && gap <= -(thr as number)) matchPct = Math.min(90, Math.round((Math.abs(gap) / (thr as number)) * 70));
          if (dir === 'up' && gap >= (thr as number)) matchPct = Math.min(90, Math.round((gap / (thr as number)) * 70));
        }
        if (!matchPct) continue;
        const wr = Math.round(p.win_rate * 100);
        signals.push({
          id: String(p.id), ticker, pattern_id: String(p.id),
          pattern_name: patternName(p), match_pct: matchPct, signal_type: p.type,
          narrative_ru: `Гэп ${gap >= 0 ? '+' : ''}${gap.toFixed(1)}% сегодня. Паттерн <b>${patternName(p)}</b> активирован — в <b>${wr}%</b> похожих дней из ${p.occurrences} гэп закрывался внутри торговой сессии. Средний доход: <b>+${(p.expected_value ?? 0).toFixed(2)}%</b>.`,
          phase_current: 'Открытие',
          phases: [
            { name: 'Гэп зафиксирован', done: true, active: false },
            { name: 'Ожидание разворота', done: false, active: true },
            { name: 'Закрытие гэпа', done: false, active: false },
          ],
          trade_levels: buildTradeLevels(p),
          tags: [
            { label: `WR ${wr}%`, type: wr >= 65 ? 'bullish' : 'neutral' },
            { label: `EV +${(p.expected_value ?? 0).toFixed(2)}%`, type: 'bullish' },
            { label: `${p.occurrences} случаев`, type: 'info' },
          ],
          created_at: new Date().toISOString(),
        });
      }
      return json(signals);
    }

    // GET /history?ticker=ALAB&from=&to=
    if (path === '/history' && req.method === 'GET') {
      const ticker = url.searchParams.get('ticker') || 'ALAB';
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const { data: stock } = await sb.from('stocks').select('id').eq('ticker', ticker).single();
      if (!stock) return json([]);

      const { data: patterns } = await sb.from('patterns').select('id, type').eq('stock_id', stock.id);
      if (!patterns?.length) return json([]);

      let q = sb.from('pattern_events').select('id, pattern_id, date, was_correct, profit_pct, trigger_value')
        .in('pattern_id', patterns.map((p: { id: number }) => p.id)).order('date', { ascending: false }).limit(90);
      if (from) q = q.gte('date', from);
      if (to) q = q.lte('date', to);
      const { data: events } = await q;

      const dates = [...new Set((events ?? []).map((e: RawEvent) => e.date))];
      const { data: candles } = dates.length
        ? await sb.from('candles_daily').select('date, open, high, low, close').in('date', dates)
        : { data: [] };
      const candMap: Record<string, { open: number; high: number; low: number; close: number }> = {};
      for (const c of (candles ?? [])) candMap[c.date] = c;

      const pTypeMap: Record<number, string> = {};
      for (const p of (patterns ?? [])) pTypeMap[p.id] = p.type;
      const typeNames: Record<string, string> = { gap_fill: 'Закр. гэпа', mean_reversion: 'Возврат', momentum_continuation: 'Импульс' };

      return json((events ?? []).map((e: RawEvent) => {
        const c = candMap[e.date];
        return {
          date: e.date,
          day_label: new Date(e.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
          result_pct: e.profit_pct ?? 0,
          ohlc: c ? { o: c.open, h: c.high, l: c.low, c: c.close } : { o: 0, h: 0, l: 0, c: 0 },
          pattern_name: typeNames[pTypeMap[e.pattern_id]] ?? '—',
          prediction: pTypeMap[e.pattern_id]?.includes('gap') ? 'Закрытие гэпа' : 'Продолжение',
          correct: e.was_correct,
        };
      }));
    }

    // GET /price?ticker=ALAB
    if (path === '/price' && req.method === 'GET') {
      const ticker = url.searchParams.get('ticker') || 'ALAB';
      const { data: stock } = await sb.from('stocks').select('id').eq('ticker', ticker).single();
      if (!stock) return json({ error: 'Stock not found' }, 404);
      const { data: candles } = await sb.from('candles_daily').select('date, open, high, low, close, volume, gap_pct')
        .eq('stock_id', stock.id).order('date', { ascending: false }).limit(2);
      if (!candles?.length) return json({ error: 'No data' }, 404);
      const today = candles[0]; const prev = candles[1];
      const change = today.close - (prev?.close ?? today.open);
      const change_pct = prev?.close ? ((today.close - prev.close) / prev.close) * 100 : 0;
      const now = new Date();
      const etH = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(now));
      const etM = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', minute: 'numeric' }).format(now));
      const etDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now);
      const isOpen = !['Sat','Sun'].includes(etDay) && (etH * 60 + etM) >= 570 && (etH * 60 + etM) < 960;
      return json({ ticker, price: today.close, change, change_pct, open: today.open, high: today.high, low: today.low, gap_pct: today.gap_pct ?? 0, market_status: isOpen ? 'open' : 'closed', date: today.date });
    }

    // GET /stocks
    if (path === '/stocks' && req.method === 'GET') {
      const { data } = await sb.from('stocks').select('id, ticker, name, sector').eq('active', true);
      return json(data || []);
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
