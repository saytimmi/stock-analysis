import React from 'react';
import type { TradeLevels } from '../api';

interface TradeLevelProps {
  levels: TradeLevels;
}

export const TradeLevel: React.FC<TradeLevelProps> = ({ levels }) => {
  return (
    <div className="trade-levels">
      <div className="trade-levels-header">
        📈 Торговые уровни
      </div>
      <div className="trade-levels-visual">
        <div className="trade-level-bar">
          {/* TP2 */}
          <div className="trade-level">
            <span className="trade-level-tag tp">TP2</span>
            <div className="trade-level-line tp2" />
            <span className="trade-level-price green">{levels.tp2.price}</span>
            <span className="trade-level-pct">{levels.tp2.pct}</span>
          </div>

          {/* TP1 */}
          <div className="trade-level">
            <span className="trade-level-tag tp">TP1</span>
            <div className="trade-level-line tp1" />
            <span className="trade-level-price green">{levels.tp1.price}</span>
            <span className="trade-level-pct">{levels.tp1.pct}</span>
          </div>

          {/* Entry */}
          <div className="trade-level">
            <span className="trade-level-tag entry">ВХОД</span>
            <div className="trade-level-line entry" />
            <span className="trade-level-price blue">{levels.entry.price}</span>
            <span className="trade-level-pct" />
          </div>

          {/* Stop */}
          <div className="trade-level">
            <span className="trade-level-tag stop">СТОП</span>
            <div className="trade-level-line stop" />
            <span className="trade-level-price red">{levels.stop.price}</span>
            <span className="trade-level-pct">{levels.stop.pct}</span>
          </div>
        </div>

        {/* R:R row */}
        <div className="trade-rr">
          <div className="trade-rr-item">
            <div className="trade-rr-value green">{levels.tp1.pct}</div>
            <div className="trade-rr-label">Потенциал</div>
          </div>
          <div className="trade-rr-item">
            <div className="trade-rr-value blue">{levels.rr}</div>
            <div className="trade-rr-label">R:R</div>
          </div>
          <div className="trade-rr-item">
            <div className="trade-rr-value red">{levels.stop.pct}</div>
            <div className="trade-rr-label">Риск</div>
          </div>
        </div>

        {/* Timing */}
        {levels.timing && levels.timing.length > 0 && (
          <div className="trade-timing">
            {levels.timing.map((row, i) => (
              <div key={i} className="trade-timing-row">
                <span className="trade-timing-label">{row.label}</span>
                <span
                  className="trade-timing-value"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Expectancy */}
        {levels.expectancy && (
          <div
            style={{
              marginTop: 10,
              padding: '10px 12px',
              background: 'rgba(0,230,118,0.06)',
              borderRadius: 10,
              fontSize: 13,
              color: 'var(--text-secondary)',
            }}
          >
            Математическое ожидание:{' '}
            <span style={{ color: 'var(--green)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              {levels.expectancy}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
