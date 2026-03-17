import React, { useEffect, useState } from 'react';
import { api } from '../api';
import type { HistoryDay } from '../api';
import { hapticFeedback } from '../telegram';

interface HistoryPageProps {
  ticker: string;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];

function getMonthDays(year: number, month: number): { date: string; weekday: number }[] {
  const days: { date: string; weekday: number }[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    const wd = d.getDay(); // 0=Sun
    if (wd >= 1 && wd <= 5) {
      days.push({
        date: d.toISOString().slice(0, 10),
        weekday: wd - 1, // 0=Mon..4=Fri
      });
    }
    d.setDate(d.getDate() + 1);
  }
  return days;
}

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export const HistoryPage: React.FC<HistoryPageProps> = ({ ticker }) => {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [history, setHistory] = useState<HistoryDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [_selectedDay, setSelectedDay] = useState<HistoryDay | null>(null);

  useEffect(() => {
    setLoading(true);
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    api.getHistory(ticker, from, to)
      .then((data) => { setHistory(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker, year, month]);

  function prevMonth() {
    hapticFeedback('light');
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    hapticFeedback('light');
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  const historyMap: Record<string, HistoryDay> = {};
  history.forEach((d) => { historyMap[d.date] = d; });

  const calDays = getMonthDays(year, month);
  const today = now.toISOString().slice(0, 10);

  // Fill grid: start at correct weekday offset
  const firstWd = calDays[0]?.weekday ?? 0;
  const gridItems: ({ date: string; weekday: number } | null)[] = [
    ...Array(firstWd).fill(null),
    ...calDays,
  ];

  return (
    <div className="content">
      <div className="content-inner fade-in">
        {/* Calendar header */}
        <div className="calendar-header">
          <div className="calendar-month">{MONTH_NAMES[month]} {year}</div>
          <div className="calendar-nav">
            <button className="calendar-nav-btn" onClick={prevMonth}>‹</button>
            <button className="calendar-nav-btn" onClick={nextMonth}>›</button>
          </div>
        </div>

        {/* Weekday headers */}
        <div className="calendar-grid">
          {WEEKDAYS.map((d) => (
            <div key={d} className="calendar-day-header">{d}</div>
          ))}

          {/* Day cells */}
          {gridItems.map((item, i) => {
            if (!item) {
              return <div key={`empty-${i}`} />;
            }
            const hd = historyMap[item.date];
            const isToday = item.date === today;
            let cls = 'neutral';
            if (hd) cls = hd.correct ? 'win' : 'loss';

            return (
              <div
                key={item.date}
                className={`calendar-day ${cls} ${isToday ? 'today' : ''}`}
                onClick={() => {
                  hapticFeedback('light');
                  if (hd) setSelectedDay(hd);
                }}
              >
                <div className="calendar-day-num">{parseInt(item.date.slice(8))}</div>
                {hd && <div className="calendar-day-dot" />}
              </div>
            );
          })}
        </div>

        {/* Stats summary */}
        {history.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {[
              { label: 'Торговых дней', value: history.length },
              { label: 'Точных', value: `${history.filter(d => d.correct).length}/${history.length}` },
              {
                label: 'Точность',
                value: `${Math.round(history.filter(d => d.correct).length / history.length * 100)}%`,
                green: true,
              },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  flex: 1,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: 12,
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 18,
                    fontWeight: 700,
                    color: s.green ? 'var(--green)' : 'var(--text)',
                  }}
                >
                  {s.value}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* History detail cards */}
        {loading ? (
          <div>
            {[1, 2, 3].map((i) => (
              <div key={i} className="history-card">
                <div className="skeleton" style={{ height: 20, width: '50%', marginBottom: 10 }} />
                <div className="skeleton" style={{ height: 16, width: '80%' }} />
              </div>
            ))}
          </div>
        ) : (
          history.slice().reverse().map((hd) => (
            <div key={hd.date} className="history-card">
              <div className="history-card-header">
                <div className="history-date">{hd.day_label || hd.date}</div>
                <div className={`history-result ${hd.result_pct >= 0 ? 'up' : 'down'}`}>
                  {hd.result_pct >= 0 ? '+' : ''}{hd.result_pct.toFixed(2)}%
                </div>
              </div>
              <div className="history-ohlc">
                <span>O {hd.ohlc.o.toFixed(2)}</span>
                <span>H {hd.ohlc.h.toFixed(2)}</span>
                <span>L {hd.ohlc.l.toFixed(2)}</span>
                <span>C {hd.ohlc.c.toFixed(2)}</span>
              </div>
              <div className="history-pattern">
                <span className="history-pattern-name">{hd.pattern_name}</span>
                <span className="history-prediction" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {hd.prediction}
                  {hd.correct
                    ? <span style={{ color: 'var(--green)' }}>✓</span>
                    : <span style={{ color: 'var(--red)' }}>✗</span>}
                </span>
              </div>
            </div>
          ))
        )}

        {!loading && history.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-hint)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
            <div>Нет данных за этот месяц</div>
          </div>
        )}
      </div>
    </div>
  );
};
