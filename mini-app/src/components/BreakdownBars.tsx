import React from 'react';
import type { BreakdownRow } from '../api';

interface BreakdownBarsProps {
  title: string;
  rows: BreakdownRow[];
}

export const BreakdownBars: React.FC<BreakdownBarsProps> = ({ title, rows }) => {
  return (
    <div>
      <div className="detail-section-title">{title}</div>
      <div className="phase-breakdown">
        {rows.map((row, i) => (
          <div key={i} className="phase-row">
            <div className="phase-name">{row.name}</div>
            <div className="phase-bar-bg">
              <div
                className={`phase-bar-fill ${row.level}`}
                style={{ width: `${row.pct}%` }}
              />
            </div>
            <div className={`phase-pct ${row.level}`}>{row.pct}%</div>
            <div className="phase-count">{row.count}x</div>
          </div>
        ))}
      </div>
    </div>
  );
};
