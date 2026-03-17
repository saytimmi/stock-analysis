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
import { initTelegram, getInitialTicker, showBackButton, hideBackButton, hapticFeedback } from './telegram';

export default function App() {
  const [tab, setTab] = useState<TabId>('now');
  const [ticker, setTicker] = useState(() => getInitialTicker('ALAB'));
  const [selectedPattern, setSelectedPattern] = useState<PatternCatalogItem | null>(null);
  const [marketOpen, setMarketOpen] = useState(false);

  useEffect(() => {
    initTelegram();

    // Compute market open status in ET
    function checkMarket() {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short',
      }).formatToParts(new Date());
      const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
      const mins = parseInt(p.hour) * 60 + parseInt(p.minute);
      setMarketOpen(!['Sat','Sun'].includes(p.weekday) && mins >= 9*60+30 && mins < 16*60);
    }
    checkMarket();
    const timer = setInterval(checkMarket, 60_000);
    return () => clearInterval(timer);
  }, []);

  // Telegram back button when pattern detail is open
  useEffect(() => {
    if (!selectedPattern) return;
    const close = () => { hapticFeedback('light'); setSelectedPattern(null); };
    showBackButton(close);
    return () => hideBackButton(close);
  }, [selectedPattern]);

  function handleTabChange(id: TabId) {
    hapticFeedback('light');
    setTab(id);
    setSelectedPattern(null);
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div className="header">
        <div className="header-content">
          <div className="header-ticker" onClick={() => handleTabChange('more')}>
            <span className="header-ticker-name">{ticker}</span>
            <span className="header-ticker-arrow">▼</span>
          </div>
          <div className="market-status">
            <div className={`market-dot ${marketOpen ? '' : 'closed'}`} />
            <span>{marketOpen ? 'Торги идут' : 'Рынок закрыт'}</span>
          </div>
        </div>
      </div>

      {tab === 'now' && <NowPage ticker={ticker} onPatternClick={setSelectedPattern} />}
      {tab === 'patterns' && <PatternsPage ticker={ticker} onPatternClick={setSelectedPattern} />}
      {tab === 'history' && <HistoryPage ticker={ticker} />}
      {tab === 'more' && <MorePage ticker={ticker} onTickerChange={(t) => { setTicker(t); setTab('now'); }} />}

      <TabBar active={tab} onChange={handleTabChange} />

      <PatternDetail item={selectedPattern} onClose={() => setSelectedPattern(null)} />
    </div>
  );
}
