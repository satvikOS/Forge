// Forge-65 — status bar (24 px). Units · snap · ortho · fps · selection
// summary · save status. Pure-mono text on the canvas, no chrome.

import React from 'react';

export function StatusBar({ units = 'mm', snap = true, ortho = false,
                            fps = 60, selection, savedAt = null,
                            workbench = 'mech' }) {
  return (
    <div className="forge-statusbar"
         role="status"
         aria-label="Application status"
         data-testid="forge-statusbar">
      <span>Units · <strong>{units}</strong></span>
      <span>Snap · <strong>{snap ? 'on' : 'off'}</strong></span>
      <span>Ortho · <strong>{ortho ? 'on' : 'off'}</strong></span>
      <span>WB · <strong>{workbench}</strong></span>
      <span className="forge-statusbar-spacer" />
      <span>FPS · <strong>{fps}</strong></span>
      {selection && selection.kind !== 'none' ? (
        <span>Sel · <strong>{selection.kind}({selection.ids?.length ?? 0})</strong></span>
      ) : (
        <span>Sel · <strong>none</strong></span>
      )}
      <span>{savedAt ? `saved ${new Date(savedAt).toLocaleTimeString()}` : 'unsaved'}</span>
    </div>
  );
}
