import { useEffect, useState } from 'react';
import './styles/theme.css';
import { TabBar } from './components/TabBar';
import type { TabId } from './components/TabBar';
import { NowPage } from './pages/NowPage';
import { PatternsPage } from './pages/PatternsPage';
import { HistoryPage } from './pages/HistoryPage';
import { MorePage } from './pages/MorePage';
import { PatternDetail } from './components/PatternDetail';
import type { PatternCatalogItem } from './api';
import { initTelegram } from './telegram';

export default function App() {
  const [tab, setTab] = useState<TabId>('now');
  const [ticker, setTicker] = useState('ALAB');
  const [selectedPattern, setSelectedPattern] = useState<PatternCatalogItem | null>(null);

  useEffect(() => {
    initTelegram();
  }, []);

  function handleTabChange(id: TabId) {
    setTab(id);
    setSelectedPattern(null);
  }

  const marketOpen = true; // TODO: compute from price data

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {/* Header */}
      <div className="header">
        <div className="header-content">
          <div className="header-ticker" onClick={() => handleTabChange('more')}>
            <span className="header-ticker-name">{ticker}</span>
            <span className="header-ticker-arrow">▼</span>
          </div>
          <div className="market-status">
            <div className={`market-dot ${marketOpen ? '' : 'closed'}`} />
            <span>{marketOpen ? 'Regular session' : 'Market closed'}</span>
          </div>
        </div>
      </div>

      {/* Page content */}
      {tab === 'now' && (
        <NowPage
          ticker={ticker}
          onPatternClick={(item) => setSelectedPattern(item)}
        />
      )}
      {tab === 'patterns' && (
        <PatternsPage
          ticker={ticker}
          onPatternClick={(item) => setSelectedPattern(item)}
        />
      )}
      {tab === 'history' && (
        <HistoryPage ticker={ticker} />
      )}
      {tab === 'more' && (
        <MorePage
          ticker={ticker}
          onTickerChange={(t) => { setTicker(t); setTab('now'); }}
        />
      )}

      {/* Tab bar */}
      <TabBar active={tab} onChange={handleTabChange} />

      {/* Pattern detail overlay */}
      <PatternDetail
        item={selectedPattern}
        onClose={() => setSelectedPattern(null)}
      />
    </div>
  );
}
