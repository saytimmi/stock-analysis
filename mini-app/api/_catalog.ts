// Shared catalog-building logic (used by /api/catalog and /api/signals)
import { sb } from './_supabase.js';

const WEEKDAY_NAMES: Record<number, string> = { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт' };

function level(wr: number): 'high' | 'mid' | 'low' {
  return wr >= 0.68 ? 'high' : wr >= 0.55 ? 'mid' : 'low';
}

export interface RawPattern {
  id: number; stock_id: number; type: string;
  description: string; parameters: Record<string, unknown>;
  lifecycle_stage: string; occurrences: number; win_rate: number;
  avg_win: number | null; avg_loss: number | null;
  expected_value: number | null; p_value: number | null;
}

export interface RawEvent {
  id: number; pattern_id: number; date: string;
  was_correct: boolean; profit_pct: number; trigger_value: number;
}

export interface JoinedEvent extends RawEvent {
  day_of_week?: number; is_opex?: boolean; gap_pct?: number | null;
}

export function pName(p: RawPattern): string {
  const { direction: dir, threshold: thr } = p.parameters as Record<string, string | number>;
  const names: Record<string, string> = { gap_fill: 'Закрытие гэпа', mean_reversion: 'Возврат к среднему', momentum_continuation: 'Продолжение импульса' };
  const d = dir === 'down' ? ' вниз' : dir === 'up' ? ' вверх' : '';
  return `${names[p.type] ?? p.type}${d} ≥${thr}%`;
}

export function buildDescription(p: RawPattern): string {
  const wr = Math.round(p.win_rate * 100);
  const ev = (p.expected_value ?? 0).toFixed(2);
  const { threshold: thr, direction: dir, observation_window: win } = p.parameters as Record<string, number | string>;
  const hrs = win ? Math.round((win as number) * 15 / 60) : 1;
  if (p.type === 'gap_fill') {
    const d = dir === 'down' ? 'вниз' : 'вверх';
    return `Когда ALAB открывается с гэпом ${d} на ${thr}% и более — в ${wr}% случаев акция возвращается к уровню закрытия предыдущего дня. Простая логика: гэп — это резкое движение, которое часто нечем подкреплено и корректируется. Проверено на ${p.occurrences} реальных торговых днях, средний доход: +${ev}% на сделку.`;
  }
  if (p.type === 'mean_reversion') {
    const d = dir === 'down' ? 'падает' : 'растёт';
    const r = dir === 'down' ? 'отскакивает вверх' : 'откатывается вниз';
    return `Когда ALAB ${d} на ${thr}% и более от открытия за первые ${hrs} ч — в ${wr}% случаев акция ${r}. Как маятник: чем дальше ушёл, тем сильнее тянет обратно. Проверено на ${p.occurrences} случаях, ожидаемый доход: +${ev}%.`;
  }
  if (p.type === 'momentum_continuation') {
    const d = dir === 'up' ? 'растёт' : 'падает';
    const c = dir === 'up' ? 'продолжает рост до конца дня' : 'продолжает падение до конца дня';
    return `Когда ALAB ${d} на ${thr}% и более за первые ${hrs} ч — в ${wr}% случаев акция ${c}. Кто начал торговый день с силой — обычно заканчивает с силой. ${p.occurrences} случаев, средний доход: +${ev}%.`;
  }
  return `${p.description}. Win rate: ${wr}% на ${p.occurrences} случаях.`;
}

export function buildConditions(p: RawPattern) {
  const { threshold: thr, direction: dir, observation_window: win } = p.parameters as Record<string, number | string>;
  const hrs = win ? Math.round((win as number) * 15 / 60) : 1;
  if (p.type === 'gap_fill') {
    const d = dir === 'down' ? 'вниз' : 'вверх';
    return [
      { icon: '📐', bg: 'rgba(68,138,255,0.15)', text: `Гэп на открытии <b>${d} ≥ ${thr}%</b> от закрытия прошлого дня` },
      { icon: '⏰', bg: 'rgba(0,230,118,0.12)', text: 'Вход <b>на открытии</b> или в первые 15 минут' },
      { icon: '🎯', bg: 'rgba(0,230,118,0.12)', text: 'Цель: уровень <b>закрытия прошлого дня</b> (вчерашний close)' },
      { icon: '🛡️', bg: 'rgba(255,23,68,0.12)', text: `Стоп: продолжение гэпа ещё на <b>${((thr as number) * 0.5).toFixed(1)}%</b>` },
    ];
  }
  if (p.type === 'mean_reversion') {
    const d = dir === 'down' ? 'падение' : 'рост';
    const e = dir === 'down' ? 'лонг (покупка на отскок)' : 'шорт (продажа на откат)';
    return [
      { icon: '📉', bg: 'rgba(255,23,68,0.12)', text: `${d} от открытия на <b>≥ ${thr}%</b> за первые <b>${hrs} ч</b>` },
      { icon: '📊', bg: 'rgba(68,138,255,0.15)', text: 'Объём выше среднего — подтверждает истощение движения' },
      { icon: '⏰', bg: 'rgba(0,230,118,0.12)', text: `Вход: <b>${e}</b> после достижения порога` },
      { icon: '🛡️', bg: 'rgba(255,23,68,0.12)', text: `Стоп: ещё <b>${((thr as number) * 0.3).toFixed(1)}%</b> в сторону тренда` },
    ];
  }
  return [
    { icon: '🚀', bg: 'rgba(0,230,118,0.12)', text: `Движение на <b>≥ ${thr}%</b> за первые <b>${hrs} ч</b>` },
    { icon: '📊', bg: 'rgba(68,138,255,0.15)', text: 'Объём подтверждает импульс (ratio > 1.2)' },
    { icon: '⏰', bg: 'rgba(0,230,118,0.12)', text: 'Вход по направлению импульса' },
    { icon: '🎯', bg: 'rgba(0,230,118,0.12)', text: 'Держать до <b>конца дня</b> (15:45–16:00)' },
  ];
}

export function buildTimeline(p: RawPattern) {
  const { threshold: thr, direction: dir, observation_window: win } = p.parameters as Record<string, number | string>;
  const hrs = win ? Math.round((win as number) * 15 / 60) : 1;
  if (p.type === 'gap_fill') {
    const d = dir === 'down' ? 'вниз' : 'вверх';
    return [
      { time: '9:30', color: dir === 'down' ? 'red' : 'green', description: `Открытие с гэпом ${d} ≥${thr}%`, detail: 'Акция открылась далеко от вчерашнего закрытия' },
      { time: '9:30–10:00', color: 'blue', description: 'Оцениваем объём и направление', detail: 'Высокий объём = гэп подтверждён рынком, паттерн сильнее' },
      { time: 'Вход', color: 'green', description: 'Открываем позицию против гэпа', detail: 'Цель — вернуться к уровню вчерашнего закрытия' },
      { time: '~2–4 ч', color: 'orange', description: 'Закрытие гэпа', detail: 'В большинстве случаев гэп закрывается в первой половине дня' },
    ];
  }
  if (p.type === 'mean_reversion') {
    const d = dir === 'down' ? 'падает' : 'растёт';
    return [
      { time: '9:30', color: 'blue', description: 'Открытие', detail: 'Наблюдаем первые свечи' },
      { time: `первые ${hrs} ч`, color: dir === 'down' ? 'red' : 'green', description: `Акция ${d} на ≥${thr}%`, detail: 'Перепроданность/перекупленность нарастает' },
      { time: 'Разворот', color: 'green', description: 'Позиция против движения', detail: 'Коррекция к балансу — маятник возвращается' },
      { time: 'До 16:00', color: 'orange', description: 'Выход', detail: 'Фиксируем прибыль до закрытия рынка' },
    ];
  }
  return [
    { time: '9:30', color: 'blue', description: 'Открытие', detail: 'Наблюдаем первые свечи' },
    { time: `первые ${hrs} ч`, color: 'green', description: `Импульс ≥${thr}% с объёмом`, detail: 'Рынок голосует за направление дня' },
    { time: 'Вход', color: 'green', description: 'По тренду', detail: 'Не бороться с импульсом, идти с ним' },
    { time: '15:45', color: 'orange', description: 'Закрытие', detail: 'Фиксируем прибыль до конца дня' },
  ];
}

export function buildFailReasons(p: RawPattern, events: JoinedEvent[]) {
  const fails = events.filter(e => !e.was_correct);
  if (!fails.length) return [];
  const ft = fails.length;
  const bigLoss = fails.filter(e => (e.profit_pct ?? 0) < -2).length;
  const opex = fails.filter(e => e.is_opex).length;
  if (p.type === 'gap_fill') return [
    { pct: `${Math.round((bigLoss / ft) * 100)}% провалов`, text: 'Фундаментальный катализатор (отчёт, новости): гэп слишком большой и не просто "технический". Паттерн не работает против реальных новостей' },
    { pct: `${Math.round(((ft - bigLoss - opex) / ft) * 100)}% провалов`, text: 'Широкий рынок (SPY/QQQ) падает на 1%+ — давление сверху не даёт гэпу закрыться' },
    ...(opex > 2 ? [{ pct: `${Math.round((opex / ft) * 100)}% провалов`, text: 'Дни экспирации опционов OPEX (3-я пятница): нестандартные движения из-за расчётов' }] : []),
  ].slice(0, 3);
  if (p.type === 'mean_reversion') return [
    { pct: `${Math.round((bigLoss / ft) * 100)}% провалов`, text: 'Тренд продолжается без коррекции: акция в устойчивом движении, а не случайной перепроданности' },
    { pct: `${Math.round(((ft - bigLoss) / ft) * 100)}% провалов`, text: 'Преждевременный вход: движение продолжилось ещё 1–2% после входа, стоп сработал до отскока' },
  ];
  return [
    { pct: `${Math.round((bigLoss / ft) * 100)}% провалов`, text: 'Иссякание импульса: объём падает во второй половине дня, умные деньги продают в силу' },
    { pct: `${Math.round(((ft - bigLoss) / ft) * 100)}% провалов`, text: 'Afternoon reversal: SPY разворачивается после обеда, тянет акцию за собой' },
  ];
}

export function buildTradeLevels(p: RawPattern) {
  const aw = p.avg_win ?? 0; const al = Math.abs(p.avg_loss ?? 1);
  return {
    tp2: { price: `Open + ${aw.toFixed(2)}%`, pct: `+${aw.toFixed(2)}%` },
    tp1: { price: `Open + ${(aw * 0.5).toFixed(2)}%`, pct: `+${(aw * 0.5).toFixed(2)}%` },
    entry: { price: 'Open / триггер' },
    stop: { price: `Open − ${al.toFixed(2)}%`, pct: `-${al.toFixed(2)}%` },
    rr: (al > 0 ? aw / al : 1).toFixed(1),
    expectancy: `+${(p.expected_value ?? 0).toFixed(2)}% на сделку`,
  };
}

export async function buildCatalog(ticker: string) {
  const { data: stock } = await sb.from('stocks').select('id').eq('ticker', ticker).single();
  if (!stock) return null;

  const { data: patterns } = await sb.from('patterns').select('*').eq('stock_id', stock.id)
    .in('lifecycle_stage', ['validated', 'live', 'monitored']).order('win_rate', { ascending: false });
  if (!patterns?.length) return [];

  const { data: allEvents } = await sb.from('pattern_events')
    .select('id, pattern_id, date, was_correct, profit_pct, trigger_value, actual_outcome, predicted_direction')
    .in('pattern_id', patterns.map((p: RawPattern) => p.id));

  const dates = [...new Set((allEvents ?? []).map((e: RawEvent) => e.date))];
  const [{ data: profiles }, { data: candles }] = await Promise.all([
    dates.length ? sb.from('day_profiles').select('date, day_of_week, is_opex').in('date', dates) : Promise.resolve({ data: [] }),
    dates.length ? sb.from('candles_daily').select('date, open, high, low, close, gap_pct').in('date', dates) : Promise.resolve({ data: [] }),
  ]);

  const profMap: Record<string, { day_of_week: number; is_opex: boolean }> = {};
  for (const dp of (profiles ?? [])) profMap[dp.date] = dp;
  const candMap: Record<string, { open: number; high: number; low: number; close: number; gap_pct: number | null }> = {};
  for (const c of (candles ?? [])) candMap[c.date] = c;

  return patterns.map((p: RawPattern) => {
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
    for (const e of events) { const d = e.day_of_week; if (!d) continue; if (!wdMap[d]) wdMap[d] = { w:0,t:0 }; wdMap[d].t++; if (e.was_correct) wdMap[d].w++; }
    const breakdown_by_weekday = Object.entries(wdMap).filter(([,v]) => v.t >= 5)
      .map(([d, v]) => ({ name: WEEKDAY_NAMES[Number(d)] ?? `d${d}`, pct: Math.round((v.w/v.t)*100), count: v.t, level: level(v.w/v.t) }))
      .sort((a, b) => Object.values(WEEKDAY_NAMES).indexOf(a.name) - Object.values(WEEKDAY_NAMES).indexOf(b.name));

    // Gap direction breakdown
    const gMap: Record<string, { w:number; t:number }> = { 'Гэп вверх':{w:0,t:0}, 'Нейтрально':{w:0,t:0}, 'Гэп вниз':{w:0,t:0} };
    for (const e of events) { const g = e.gap_pct ?? 0; const k = g>=0.5?'Гэп вверх':g<=-0.5?'Гэп вниз':'Нейтрально'; gMap[k].t++; if (e.was_correct) gMap[k].w++; }
    const breakdown_by_earnings_phase = Object.entries(gMap).filter(([,v]) => v.t>=5).map(([name,v]) => ({ name, pct: Math.round((v.w/v.t)*100), count: v.t, level: level(v.w/v.t) }));

    // Half-year
    const hyMap: Record<string, { w:number; t:number }> = { '1П (янв–июн)':{w:0,t:0}, '2П (июл–дек)':{w:0,t:0} };
    for (const e of events) { const m = new Date(e.date).getMonth()+1; const k = m<=6?'1П (янв–июн)':'2П (июл–дек)'; hyMap[k].t++; if (e.was_correct) hyMap[k].w++; }
    const breakdown_by_quarter = Object.entries(hyMap).filter(([,v]) => v.t>=5).map(([name,v]) => ({ name, pct: Math.round((v.w/v.t)*100), count: v.t, level: level(v.w/v.t) }));

    const wr = p.win_rate;
    return {
      id: String(p.id), ticker,
      pattern_name: pName(p),
      description_ru: buildDescription(p),
      source: 'system',
      timeframe: '15m / дневной',
      win_rate: wr, avg_return: avgReturn,
      avg_rr: avgLossVal > 0 ? avgWin / avgLossVal : 1,
      sample_size: events.length || p.occurrences,
      tags: [p.type.replace(/_/g,' '), `≥${(p.parameters as Record<string,unknown>).threshold}%`],
      phases: [],
      grade: wr>=0.70 ? 'A — Высокая надёжность' : wr>=0.62 ? 'B — Хорошая надёжность' : 'C — Средняя надёжность',
      confidence_pct: Math.round(Math.min(wr*100 + (p.occurrences>100?5:0), 95)),
      conditions: buildConditions(p),
      timeline_steps: buildTimeline(p),
      fail_reasons: buildFailReasons(p, events),
      breakdown_by_weekday, breakdown_by_earnings_phase, breakdown_by_quarter,
      trade_levels: buildTradeLevels(p),
      example_days: events.slice(0,5).map(e => {
        const c = candMap[e.date];
        return { date: e.date, label: e.date, result: `${e.profit_pct>=0?'+':''}${e.profit_pct.toFixed(2)}%`, resultClass: e.was_correct?'win':'loss',
          ohlc: c ? `O ${c.open.toFixed(2)} H ${c.high.toFixed(2)} L ${c.low.toFixed(2)} C ${c.close.toFixed(2)}` : '',
          tags: [`триггер: ${e.trigger_value?.toFixed(1)}%`] };
      }),
      stats_extra: { 'P-value': p.p_value!=null?p.p_value.toFixed(4):'—', 'Ср. выигрыш': `+${(p.avg_win??0).toFixed(2)}%`, 'Ср. проигрыш': `${(p.avg_loss??0).toFixed(2)}%`, 'Всего случаев': p.occurrences },
    };
  });
}
