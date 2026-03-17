import React, { useEffect, useState } from 'react';
import { api } from '../api';
import type { PatternCatalogItem } from '../api';
import { hapticFeedback } from '../telegram';

interface PatternsPageProps {
  ticker: string;
  onPatternClick: (item: PatternCatalogItem) => void;
}

const FILTERS = ['Все', 'Система', 'Мои', 'Высокий WR', 'Активные'];
const SORT_OPTIONS = ['Выигрыш', 'R:R', 'Случаи'];

function Sparkline({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 100 30" width="100%" height="100%">
      <polyline
        points="0,22 15,18 30,24 45,14 60,18 75,10 90,14 100,8"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
    </svg>
  );
}

export const PatternsPage: React.FC<PatternsPageProps> = ({ ticker, onPatternClick }) => {
  const [catalog, setCatalog] = useState<PatternCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('Все');
  const [sortBy, setSortBy] = useState('Выигрыш');
  const [sortIdx, setSortIdx] = useState(0);

  useEffect(() => {
    setLoading(true);
    api.getCatalog(ticker).then((data) => {
      setCatalog(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [ticker]);

  function cycleSort() {
    const next = (sortIdx + 1) % SORT_OPTIONS.length;
    setSortIdx(next);
    setSortBy(SORT_OPTIONS[next]);
    hapticFeedback('light');
  }

  const filtered = catalog.filter((item) => {
    if (activeFilter === 'Система') return item.source === 'system';
    if (activeFilter === 'Мои') return item.source === 'user';
    if (activeFilter === 'Высокий WR') return item.win_rate >= 0.65;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'R:R') return b.avg_rr - a.avg_rr;
    if (sortBy === 'Случаи') return b.sample_size - a.sample_size;
    return b.win_rate - a.win_rate;
  });

  return (
    <div className="content">
      <div className="content-inner fade-in">
        {/* Filters */}
        <div style={{ paddingTop: 8, paddingBottom: 4 }}>
          <div className="chip-scroll">
            {FILTERS.map((f) => (
              <button
                key={f}
                className={`chip ${activeFilter === f ? 'active' : ''}`}
                onClick={() => {
                  hapticFeedback('light');
                  setActiveFilter(f);
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Sort bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
          <span style={{ fontSize: 13, color: 'var(--text-hint)' }}>
            {sorted.length} паттернов
          </span>
          <span
            style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
            onClick={cycleSort}
          >
            Сортировка: <span style={{ color: 'var(--text)', fontWeight: 600 }}>{sortBy}</span> ↕
          </span>
        </div>

        {/* Loading */}
        {loading && (
          <div>
            {[1, 2, 3].map((i) => (
              <div key={i} className="lib-card" style={{ minHeight: 160 }}>
                <div className="skeleton" style={{ height: 20, width: '60%', marginBottom: 12 }} />
                <div className="skeleton" style={{ height: 50, marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 16, width: '80%' }} />
              </div>
            ))}
          </div>
        )}

        {/* Pattern library cards */}
        {!loading && sorted.map((item, idx) => (
          <div
            key={item.id}
            className="lib-card"
            onClick={() => {
              hapticFeedback('light');
              onPatternClick(item);
            }}
          >
            <div className="lib-card-top">
              <div>
                <div className="lib-card-name">
                  <span style={{ color: 'var(--text-hint)', fontFamily: 'var(--font-mono)', fontSize: 12, marginRight: 6 }}>
                    #{idx + 1}
                  </span>
                  {item.pattern_name}
                </div>
                <div className="lib-card-timeframe">{item.timeframe} · {item.ticker}</div>
              </div>
              <div className="lib-card-winrate">{Math.round(item.win_rate * 100)}%</div>
            </div>

            {/* Sparkline */}
            <div className="lib-card-sparkline">
              <Sparkline color={item.avg_return >= 0 ? 'var(--green)' : 'var(--red)'} />
            </div>

            {/* Description */}
            <div className="lib-card-explain">
              {item.description_ru}
            </div>

            {/* Mini stats */}
            <div className="lib-card-stats-row">
              <div className="lib-mini-stat">
                <span className="lib-mini-label">Ср. доход</span>
                <span className={`lib-mini-value ${item.avg_return >= 0 ? 'green' : ''}`}>
                  {item.avg_return >= 0 ? '+' : ''}{item.avg_return.toFixed(1)}%
                </span>
              </div>
              <div className="lib-mini-stat">
                <span className="lib-mini-label">R:R</span>
                <span className="lib-mini-value blue">{item.avg_rr.toFixed(1)}</span>
              </div>
              <div className="lib-mini-stat">
                <span className="lib-mini-label">Случаев</span>
                <span className="lib-mini-value">{item.sample_size}</span>
              </div>
              <div className="lib-mini-stat">
                <span className="lib-mini-label">Тайм</span>
                <span className="lib-mini-value">{item.timeframe}</span>
              </div>
            </div>

            {/* Footer badges */}
            <div className="lib-card-footer">
              <span className={`pattern-badge ${item.source}`}>
                {item.source === 'system' ? 'Система' : 'Мой паттерн'}
              </span>
              {item.tags.slice(0, 3).map((tag, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: 11,
                    padding: '2px 7px',
                    borderRadius: 6,
                    background: 'rgba(255,255,255,0.04)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ))}

        {/* Empty state */}
        {!loading && sorted.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-hint)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
            <div>Паттернов не найдено</div>
            <div style={{ fontSize: 13, marginTop: 8 }}>Попробуйте другой фильтр</div>
          </div>
        )}

        {/* Create pattern CTA */}
        <div
          className="create-pattern-cta"
          onClick={() => hapticFeedback('medium')}
        >
          + Создать свой паттерн
        </div>
      </div>
    </div>
  );
};
