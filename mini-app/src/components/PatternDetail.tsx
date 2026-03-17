import React, { useEffect, useRef } from 'react';
import type { PatternCatalogItem } from '../api';
import { TradeLevel } from './TradeLevel';
import { Timeline } from './Timeline';
import { BreakdownBars } from './BreakdownBars';
import { hapticFeedback } from '../telegram';

interface PatternDetailProps {
  item: PatternCatalogItem | null;
  onClose: () => void;
}

export const PatternDetail: React.FC<PatternDetailProps> = ({ item, onClose }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (item) {
      hapticFeedback('light');
      scrollRef.current?.scrollTo(0, 0);
    }
  }, [item]);

  return (
    <div
      className="detail-overlay"
      style={{
        transform: item ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {item && (
        <>
          {/* Header */}
          <div className="detail-header">
            <button className="detail-back" onClick={onClose}>‹</button>
            <div className="detail-title">{item.pattern_name}</div>
            <span className={`pattern-badge ${item.source}`} style={{ flexShrink: 0 }}>
              {item.source === 'system' ? 'Система' : 'Мой'}
            </span>
          </div>

          {/* Scrollable body */}
          <div className="detail-scroll" ref={scrollRef}>

            {/* Hero */}
            <div className="detail-hero">
              <div className="detail-hero-name">{item.pattern_name}</div>
              <div className="detail-hero-type">
                <span>{item.ticker}</span>
                <span style={{ color: 'var(--text-hint)' }}>·</span>
                <span>{item.timeframe}</span>
                <span style={{ color: 'var(--text-hint)' }}>·</span>
                <span>{item.source === 'system' ? 'Алгоритм' : 'Пользователь'}</span>
              </div>
            </div>

            {/* Big stats */}
            <div className="detail-big-stats">
              <div className="detail-big-stat">
                <div className="detail-big-stat-value green">{Math.round(item.win_rate * 100)}%</div>
                <div className="detail-big-stat-label">Выигрыш</div>
              </div>
              <div className="detail-big-stat">
                <div className={`detail-big-stat-value ${item.avg_return >= 0 ? 'green' : ''}`}>
                  {item.avg_return >= 0 ? '+' : ''}{item.avg_return.toFixed(1)}%
                </div>
                <div className="detail-big-stat-label">Ср. доход</div>
              </div>
              <div className="detail-big-stat">
                <div className="detail-big-stat-value blue">{item.avg_rr.toFixed(1)}</div>
                <div className="detail-big-stat-label">R:R</div>
              </div>
              <div className="detail-big-stat">
                <div className="detail-big-stat-value">{item.sample_size}</div>
                <div className="detail-big-stat-label">Случаев</div>
              </div>
            </div>

            {/* Description */}
            <div
              style={{
                fontSize: 15,
                lineHeight: 1.6,
                color: 'var(--text-secondary)',
                padding: '8px 0 16px',
              }}
            >
              {item.description_ru}
            </div>

            {/* Grade / confidence */}
            {(item.grade || item.confidence_pct) && (
              <div className="confidence-meter">
                <div className="confidence-label">Уверенность системы</div>
                <div className="confidence-bar-outer">
                  <div
                    className="confidence-bar-inner"
                    style={{ width: `${item.confidence_pct ?? 0}%` }}
                  />
                </div>
                <div className="confidence-labels">
                  <span>Низкая</span>
                  <span>Средняя</span>
                  <span>Высокая</span>
                </div>
                {item.confidence_pct && (
                  <>
                    <div className="confidence-score">{item.confidence_pct}%</div>
                    <div className="confidence-score-label">{item.grade ?? 'Средняя уверенность'}</div>
                  </>
                )}
              </div>
            )}

            {/* Trade levels */}
            {item.trade_levels && (
              <TradeLevel levels={item.trade_levels} />
            )}

            {/* Conditions */}
            {item.conditions && item.conditions.length > 0 && (
              <>
                <div className="detail-section-title">📋 Условия входа</div>
                <div className="conditions-list">
                  {item.conditions.map((c, i) => (
                    <div key={i} className="condition-item">
                      <div
                        className="condition-icon"
                        style={{ background: c.bg }}
                      >
                        {c.icon}
                      </div>
                      <div
                        className="condition-text"
                        dangerouslySetInnerHTML={{ __html: c.text }}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Timeline */}
            {item.timeline_steps && item.timeline_steps.length > 0 && (
              <>
                <div className="detail-section-title">⏱ Как работает паттерн</div>
                <Timeline steps={item.timeline_steps} />
              </>
            )}

            {/* Breakdowns */}
            {item.breakdown_by_earnings_phase && item.breakdown_by_earnings_phase.length > 0 && (
              <BreakdownBars
                title="📅 По фазе отчётности"
                rows={item.breakdown_by_earnings_phase}
              />
            )}

            {item.breakdown_by_quarter && item.breakdown_by_quarter.length > 0 && (
              <BreakdownBars
                title="📆 По кварталу"
                rows={item.breakdown_by_quarter}
              />
            )}

            {item.breakdown_by_weekday && item.breakdown_by_weekday.length > 0 && (
              <BreakdownBars
                title="📅 По дню недели"
                rows={item.breakdown_by_weekday}
              />
            )}

            {/* Fail reasons */}
            {item.fail_reasons && item.fail_reasons.length > 0 && (
              <>
                <div className="detail-section-title">⚠️ Когда не работает</div>
                <div className="fail-analysis">
                  <div className="fail-header">
                    Причины провала
                  </div>
                  {item.fail_reasons.map((fr, i) => (
                    <div key={i} className="fail-reason">
                      <div className="fail-reason-pct">{fr.pct}</div>
                      <div
                        className="fail-reason-text"
                        dangerouslySetInnerHTML={{ __html: fr.text }}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Example days */}
            {item.example_days && item.example_days.length > 0 && (
              <>
                <div className="detail-section-title">📆 Примеры</div>
                {item.example_days.map((ex, i) => (
                  <div key={i} className="example-day">
                    <div className="example-day-header">
                      <div className="example-day-date">{ex.date}</div>
                      <div className={`example-day-result ${ex.resultClass}`}>
                        {ex.result}
                        {ex.resultClass === 'win' ? ' ✓' : ' ✗'}
                      </div>
                    </div>
                    <div className="example-day-ohlc">{ex.ohlc}</div>
                    {ex.tags.length > 0 && (
                      <div className="example-day-tags">
                        {ex.tags.map((tag, ti) => (
                          <span
                            key={ti}
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
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Extra stats */}
            {item.stats_extra && Object.keys(item.stats_extra).length > 0 && (
              <>
                <div className="detail-section-title">📊 Доп. статистика</div>
                <div className="stats-grid">
                  {Object.entries(item.stats_extra).map(([k, v]) => (
                    <div key={k} className="stat-box">
                      <div className="stat-box-label">{k}</div>
                      <div className="stat-box-value">{String(v)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Disclaimer */}
            <div
              style={{
                marginTop: 20,
                padding: 12,
                background: 'rgba(255,145,0,0.06)',
                border: '1px solid rgba(255,145,0,0.15)',
                borderRadius: 12,
                fontSize: 12,
                color: 'var(--text-hint)',
                lineHeight: 1.5,
              }}
            >
              ⚠️ Торговля сопряжена с рисками. Паттерны основаны на исторических данных и не гарантируют будущих результатов.
              Используйте стоп-лоссы и управляйте размером позиции.
            </div>
          </div>
        </>
      )}
    </div>
  );
};
