import React, { useEffect, useState } from 'react';
import { api } from '../api';
import type { PriceData, SignalData, PatternCatalogItem } from '../api';
import { hapticFeedback } from '../telegram';

interface NowPageProps {
  ticker: string;
  onPatternClick: (item: PatternCatalogItem) => void;
}

function Sparkline({ path, color }: { path?: string; color: string }) {
  if (!path) {
    // Generate a simple placeholder sparkline
    return (
      <svg viewBox="0 0 100 30" className="sparkline-svg">
        <polyline
          points="0,20 20,18 40,22 60,12 80,16 100,10"
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 30" className="sparkline-svg">
      <polyline
        points={path}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function matchClass(pct: number): string {
  if (pct >= 70) return 'high';
  if (pct >= 50) return 'medium';
  return 'low';
}

export const NowPage: React.FC<NowPageProps> = ({ ticker, onPatternClick }) => {
  const [price, setPrice] = useState<PriceData | null>(null);
  const [signals, setSignals] = useState<SignalData[]>([]);
  const [catalog, setCatalog] = useState<PatternCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      api.getPrice(ticker),
      api.getSignals(ticker),
      api.getCatalog(ticker),
    ]).then(([priceRes, signalsRes, catalogRes]) => {
      if (priceRes.status === 'fulfilled') setPrice(priceRes.value);
      if (signalsRes.status === 'fulfilled') setSignals(signalsRes.value);
      if (catalogRes.status === 'fulfilled') setCatalog(catalogRes.value);
      setLoading(false);
    });
  }, [ticker]);

  const marketOpen = price?.market_status === 'open';

  return (
    <div className="content">
      <div className="content-inner fade-in">
        {/* Price block */}
        {loading ? (
          <div className="price-block">
            <div className="skeleton" style={{ height: 42, width: 180, margin: '0 auto 8px' }} />
            <div className="skeleton" style={{ height: 20, width: 120, margin: '0 auto' }} />
          </div>
        ) : price ? (
          <div className="price-block">
            <div className="price-main">${price.price.toFixed(2)}</div>
            <div className={`price-change ${price.change >= 0 ? 'up' : 'down'}`}>
              {price.change >= 0 ? '+' : ''}{price.change.toFixed(2)} ({price.change_pct >= 0 ? '+' : ''}{price.change_pct.toFixed(2)}%)
            </div>
            <div className="price-ohlc">
              <span><span className="label">O</span> {price.open.toFixed(2)}</span>
              <span><span className="label">H</span> {price.high.toFixed(2)}</span>
              <span><span className="label">L</span> {price.low.toFixed(2)}</span>
              <span><span className="label">Gap</span> {price.gap_pct >= 0 ? '+' : ''}{price.gap_pct.toFixed(1)}%</span>
            </div>
          </div>
        ) : (
          <div className="price-block">
            <div className="price-main" style={{ color: 'var(--text-hint)' }}>—</div>
          </div>
        )}

        {/* Market context */}
        <div className="market-context">
          {['SPY', 'QQQ', 'SOXX', 'VIX'].map((sym) => (
            <div key={sym} className="market-ctx-item">
              <div className="market-ctx-ticker">{sym}</div>
              <div className="market-ctx-value" style={{ color: 'var(--text-hint)' }}>—</div>
            </div>
          ))}
        </div>

        {/* Earnings context */}
        <div className="earnings-context">
          <span className="earnings-badge">📅 До отчёта: —</span>
          <span style={{ color: 'var(--text-hint)', fontSize: 12 }}>
            {marketOpen ? 'Торговая сессия' : 'Вне сессии'}
          </span>
        </div>

        {/* Live signals */}
        {signals.length > 0 && (
          <>
            <div className="section-header">
              <div className="section-title">
                Активные сигналы
                <span className="section-count">{signals.length}</span>
              </div>
            </div>

            {signals.map((signal) => {
              return (
                <div key={signal.id} className="live-analysis">
                  <div className="live-analysis-header">
                    <div className="live-pulse" />
                    <div className="live-analysis-title">{signal.pattern_name}</div>
                    <div className="live-analysis-time">
                      {new Date(signal.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className="live-analysis-body">
                    <p dangerouslySetInnerHTML={{ __html: signal.narrative_ru }} />
                  </div>

                  {/* Phase progress */}
                  {signal.phases.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                      {signal.phases.map((p, i) => (
                        <div
                          key={i}
                          style={{
                            padding: '3px 10px',
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 500,
                            background: p.active
                              ? 'var(--blue-dim)'
                              : p.done
                              ? 'rgba(0,230,118,0.08)'
                              : 'rgba(255,255,255,0.03)',
                            color: p.active
                              ? 'var(--accent)'
                              : p.done
                              ? 'var(--green)'
                              : 'var(--text-hint)',
                          }}
                        >
                          {p.done && !p.active ? '✓ ' : ''}{p.name}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Tags */}
                  <div className="live-analysis-tags">
                    {signal.tags.map((t, i) => (
                      <span key={i} className={`live-tag ${t.type}`}>{t.label}</span>
                    ))}
                  </div>

                  <div
                    className="live-analysis-action"
                    onClick={() => {
                      hapticFeedback('light');
                      const item = catalog.find((c) => c.id === signal.pattern_id);
                      if (item) onPatternClick(item);
                    }}
                  >
                    Открыть паттерн →
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Pattern cards (from catalog) */}
        {catalog.length > 0 && (
          <>
            <div className="section-header">
              <div className="section-title">
                Паттерны ALAB
                <span className="section-count">{catalog.length}</span>
              </div>
            </div>

            {catalog.slice(0, 3).map((item) => {
              const itemMc = matchClass(item.win_rate * 100);
              return (
                <div
                  key={item.id}
                  className="pattern-card"
                  onClick={() => {
                    hapticFeedback('light');
                    onPatternClick(item);
                  }}
                >
                  <div className="pattern-card-header">
                    <div className="pattern-name">{item.pattern_name}</div>
                    <div className={`pattern-match ${itemMc}`}>{Math.round(item.win_rate * 100)}%</div>
                  </div>

                  <div className="match-bar">
                    <div
                      className={`match-bar-fill ${itemMc}`}
                      style={{ width: `${item.win_rate * 100}%` }}
                    />
                  </div>

                  <div className="pattern-stats">
                    <div className="pattern-stat">
                      <span className="pattern-stat-label">Выигрыш</span>
                      <span className={`pattern-stat-value ${item.avg_return >= 0 ? 'up' : 'down'}`}>
                        {item.avg_return >= 0 ? '+' : ''}{item.avg_return.toFixed(1)}%
                      </span>
                    </div>
                    <div className="pattern-stat">
                      <span className="pattern-stat-label">R:R</span>
                      <span className="pattern-stat-value">{item.avg_rr.toFixed(1)}</span>
                    </div>
                    <div className="pattern-stat">
                      <span className="pattern-stat-label">Случаев</span>
                      <span className="pattern-stat-value">{item.sample_size}</span>
                    </div>
                  </div>

                  <div className="sparkline-container">
                    <Sparkline color={item.avg_return >= 0 ? 'var(--green)' : 'var(--red)'} />
                  </div>

                  <div className="pattern-meta">
                    <span className={`pattern-badge ${item.source}`}>
                      {item.source === 'system' ? 'Система' : 'Мой паттерн'}
                    </span>
                    {item.tags.slice(0, 2).map((tag, i) => (
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
              );
            })}
          </>
        )}

        {/* Empty state */}
        {!loading && signals.length === 0 && catalog.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-hint)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <div>Нет данных для {ticker}</div>
            <div style={{ fontSize: 13, marginTop: 8 }}>Запустите backfill для загрузки данных</div>
          </div>
        )}
      </div>
    </div>
  );
};
