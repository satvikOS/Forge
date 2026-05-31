// Forge v3 — viewport surface. Hosts the three.js scene (Forge-26's
// existing ForgeViewport renderer plugs in here in Forge-49). For the
// scaffold slice we show an empty-state with a single Cmd+K hint so
// the IP signature reads cleanly without any rendered geometry.

import React from 'react';

export function ViewportSurface({ selection, onSelect }) {
  return (
    <main className="forge-v3-viewport"
          role="region"
          aria-label="Forge viewport"
          data-testid="forge-v3-viewport">
      <div className="forge-v3-viewport-empty" data-testid="forge-v3-viewport-empty">
        <span className="forge-v3-viewport-empty-mark" aria-hidden="true">⎈</span>
        <div style={{ fontSize: 14, color: 'var(--forge-v3-ink)' }}>
          Forge — a blank canvas.
        </div>
        <div className="forge-v3-viewport-empty-hint">
          Press <kbd>⌘K</kbd> and tell Archie what you want.
        </div>
      </div>
    </main>
  );
}
