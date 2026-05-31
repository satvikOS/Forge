// Forge-73 — Sketch state badge.
//
// Floats bottom-center of the viewport ONLY while a sketch is being
// edited. Three states: UNDER-DEFINED (amber), FULLY DEFINED (green),
// OVER-DEFINED (red). Replicates the SolidWorks indicator.

import React from 'react';

const STATE_COLOR = {
  'under':  'var(--forge-warn)',
  'full':   'var(--forge-ok)',
  'over':   'var(--forge-err)',
};
const STATE_LABEL = {
  'under':  'UNDER-DEFINED',
  'full':   'FULLY DEFINED',
  'over':   'OVER-DEFINED',
};

export function SketchStateBadge({ visible, state = 'under',
                                   nConstraints = 0, nDof = 0 }) {
  if (!visible) return null;
  return (
    <div className="forge-sketch-badge"
         data-state={state}
         data-testid="forge-sketch-badge"
         style={{
           position: 'absolute',
           bottom: 12,
           left: '50%',
           transform: 'translateX(-50%)',
           display: 'inline-flex',
           alignItems: 'center',
           gap: 8,
           background: 'rgba(0,0,0,0.55)',
           backdropFilter: 'blur(4px)',
           border: `1px solid ${STATE_COLOR[state]}`,
           borderLeft: `3px solid ${STATE_COLOR[state]}`,
           color: 'var(--forge-ink)',
           padding: '4px 12px',
           borderRadius: 'var(--forge-radius)',
           fontSize: 11,
           fontFamily: 'var(--forge-mono)',
           letterSpacing: '0.06em',
           zIndex: 6,
         }}>
      <span style={{ color: STATE_COLOR[state], fontWeight: 600 }}>{STATE_LABEL[state]}</span>
      <span style={{ color: 'var(--forge-ink-mute)' }}>
        c={nConstraints} · dof={nDof}
      </span>
    </div>
  );
}
