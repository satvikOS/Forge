// Forge v3 — bottom timeline strip. Scrubbable parametric history.
//
// Replaces the v1/v2 left-side feature tree. Each step is a card; the
// playhead (the copper bar) sits at the active step. User can click
// any card to jump back to that state — the rebuild engine replays
// only the steps before it.

import React from 'react';

export function TimelineStrip({ steps, activeStepId, onPick }) {
  if (!steps || steps.length === 0) {
    return (
      <footer className="forge-v3-timeline"
              aria-label="Parametric timeline"
              data-testid="forge-v3-timeline">
        <span className="forge-v3-timeline-empty">
          Timeline appears here as you build. No steps yet.
        </span>
      </footer>
    );
  }
  return (
    <footer className="forge-v3-timeline"
            aria-label="Parametric timeline"
            data-testid="forge-v3-timeline">
      {steps.map((s, i) => (
        <React.Fragment key={s.id}>
          {i === steps.findIndex((x) => x.id === activeStepId) && (
            <span className="forge-v3-timeline-head" aria-hidden="true" />
          )}
          <button
            type="button"
            className="forge-v3-timeline-step"
            data-active={String(s.id === activeStepId)}
            onClick={() => onPick(s.id)}
            aria-current={s.id === activeStepId ? 'step' : undefined}
            aria-label={`Step ${i + 1}: ${s.label}`}
          >
            <span className="forge-v3-timeline-step-label">{s.label}</span>
            <span className="forge-v3-timeline-step-meta">{s.meta || ''}</span>
          </button>
        </React.Fragment>
      ))}
    </footer>
  );
}
