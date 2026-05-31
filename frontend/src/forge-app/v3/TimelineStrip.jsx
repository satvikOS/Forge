// Forge v3 — bottom timeline strip. Scrubbable parametric history.
//
// Replaces the v1/v2 left-side feature tree. Each step is a card; the
// playhead (the copper bar) sits at the active step. Click a card to
// highlight; double-click (or Shift+click) to rollback the parametric
// model to that state.

import React from 'react';

export function TimelineStrip({ steps, activeStepId, onPick, onRollback }) {
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
            onClick={(e) => {
              if (e.shiftKey && onRollback) onRollback(s.id);
              else onPick(s.id);
            }}
            onDoubleClick={() => onRollback && onRollback(s.id)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && e.shiftKey && onRollback) {
                e.preventDefault();
                onRollback(s.id);
              } else if (e.key === 'Backspace' && onRollback) {
                e.preventDefault();
                onRollback(s.id);
              }
            }}
            aria-current={s.id === activeStepId ? 'step' : undefined}
            aria-label={`Step ${i + 1}: ${s.label}. Shift-click or double-click to rollback.`}
            title={`${s.label}\n${s.meta || ''}\n⇧+click or dbl-click to rollback`}
          >
            <span className="forge-v3-timeline-step-label">{s.label}</span>
            <span className="forge-v3-timeline-step-meta">{s.meta || ''}</span>
          </button>
        </React.Fragment>
      ))}
    </footer>
  );
}
