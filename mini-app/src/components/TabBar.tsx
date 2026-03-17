import React from 'react';

export type TabId = 'now' | 'patterns' | 'history' | 'more';

interface Tab {
  id: TabId;
  icon: string;
  label: string;
}

const TABS: Tab[] = [
  { id: 'now', icon: '📊', label: 'Сейчас' },
  { id: 'patterns', icon: '🔍', label: 'Паттерны' },
  { id: 'history', icon: '📅', label: 'История' },
  { id: 'more', icon: '⚙️', label: 'Ещё' },
];

interface TabBarProps {
  active: TabId;
  onChange: (id: TabId) => void;
}

export const TabBar: React.FC<TabBarProps> = ({ active, onChange }) => {
  return (
    <div className="tab-bar">
      {TABS.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${active === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          <div className="tab-indicator" />
          <span className="tab-icon">{tab.icon}</span>
          <span className="tab-label">{tab.label}</span>
        </div>
      ))}
    </div>
  );
};
