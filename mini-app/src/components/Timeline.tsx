import React from 'react';
import type { TimelineStep } from '../api';

interface TimelineProps {
  steps: TimelineStep[];
}

const COLOR_MAP: Record<string, string> = {
  red: 'var(--red)',
  green: 'var(--green)',
  blue: 'var(--accent)',
  orange: 'var(--orange)',
};

export const Timeline: React.FC<TimelineProps> = ({ steps }) => {
  return (
    <div className="timeline">
      {steps.map((step, i) => (
        <div key={i} className="timeline-step">
          <div className={`timeline-dot ${step.color}`} />
          <div className="timeline-time" style={{ color: COLOR_MAP[step.color] }}>
            {step.time}
          </div>
          <div
            className="timeline-desc"
            dangerouslySetInnerHTML={{ __html: step.description }}
          />
          {step.detail && (
            <div className="timeline-detail">
              {step.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
