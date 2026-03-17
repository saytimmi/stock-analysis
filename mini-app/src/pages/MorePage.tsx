import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { hapticFeedback } from '../telegram';

interface MorePageProps {
  ticker: string;
  onTickerChange: (t: string) => void;
}

export const MorePage: React.FC<MorePageProps> = ({ ticker, onTickerChange }) => {
  const [stocks, setStocks] = useState<{ ticker: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getStocks()
      .then((data) => { setStocks(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="content">
      <div className="content-inner fade-in">

        {/* Ticker selector */}
        <div className="settings-group">
          <div className="settings-group-title">Активный тикер</div>
          {loading ? (
            <div className="skeleton" style={{ height: 52, borderRadius: 12 }} />
          ) : (
            stocks.map((s, i) => (
              <div
                key={s.ticker}
                className="settings-item"
                style={
                  stocks.length === 1
                    ? { borderRadius: 12 }
                    : i === 0
                    ? { borderRadius: '12px 12px 0 0' }
                    : i === stocks.length - 1
                    ? { borderRadius: '0 0 12px 12px' }
                    : {}
                }
                onClick={() => {
                  hapticFeedback('medium');
                  onTickerChange(s.ticker);
                }}
              >
                <div className="settings-item-left">
                  <div className="settings-icon blue" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700 }}>
                    {s.ticker.slice(0, 2)}
                  </div>
                  <div>
                    <div className="settings-item-label">{s.ticker}</div>
                    {s.name && (
                      <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 2 }}>{s.name}</div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {s.ticker === ticker && (
                    <span style={{ color: 'var(--green)', fontSize: 16 }}>✓</span>
                  )}
                  <span className="settings-item-arrow">›</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* System info */}
        <div className="settings-group">
          <div className="settings-group-title">Система</div>

          <div className="settings-item" style={{ borderRadius: '12px 12px 0 0' }}>
            <div className="settings-item-left">
              <div className="settings-icon green">📊</div>
              <div className="settings-item-label">Статус данных</div>
            </div>
            <div className="settings-item-value">
              <span style={{ color: 'var(--green)' }}>●</span> Актуально
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-left">
              <div className="settings-icon blue">🔍</div>
              <div className="settings-item-label">Активных паттернов</div>
            </div>
            <div className="settings-item-value">—</div>
          </div>

          <div className="settings-item" style={{ borderRadius: '0 0 12px 12px' }}>
            <div className="settings-item-left">
              <div className="settings-icon orange">🤖</div>
              <div className="settings-item-label">Агенты</div>
            </div>
            <div className="settings-item-value">Trader, Auditor</div>
          </div>
        </div>

        {/* Actions */}
        <div className="settings-group">
          <div className="settings-group-title">Действия</div>

          <div className="settings-item" style={{ borderRadius: '12px 12px 0 0' }}>
            <div className="settings-item-left">
              <div className="settings-icon orange">💡</div>
              <div className="settings-item-label">Создать паттерн</div>
            </div>
            <span className="settings-item-arrow">›</span>
          </div>

          <div className="settings-item">
            <div className="settings-item-left">
              <div className="settings-icon blue">📋</div>
              <div className="settings-item-label">Отчёт агентов</div>
            </div>
            <span className="settings-item-arrow">›</span>
          </div>

          <div className="settings-item" style={{ borderRadius: '0 0 12px 12px' }}>
            <div className="settings-item-left">
              <div className="settings-icon green">🔔</div>
              <div className="settings-item-label">Уведомления</div>
            </div>
            <div className="settings-item-value">
              Включены <span className="settings-item-arrow">›</span>
            </div>
          </div>
        </div>

        {/* Version */}
        <div style={{ textAlign: 'center', color: 'var(--text-hint)', fontSize: 12, padding: '20px 0 8px' }}>
          Stock Pattern Analyzer v0.1.0
        </div>
      </div>
    </div>
  );
};
