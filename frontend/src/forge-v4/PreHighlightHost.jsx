// Task #21 (Enterprise CAD UI/UX) — sub-entity PRE-HIGHLIGHT readout +
// QuickPick disambiguation host (NX / CATIA "preselect").
//
// This is the React surface for preHighlightStore.js. It is a self-
// mounting portal host (the CommandPaletteHost / SelectionHighlightHost
// pattern): on mount it installs the imperative window API
// `window.__forgePreHighlight` and `window.__forgeOpenQuickPick`; on
// unmount it deletes them. It NEVER calls a React setter from inside the
// window API — the API mutates preHighlightStore + dispatches the
// `forge:prehighlight` bus, and THIS component subscribes via
// addEventListener and reads the store (no-setState contract).
//
// MONOCHROME ONLY: the pre-highlight readout chip + the QuickPick stack
// use --forge-* / grey tokens (outline + tone, never chromatic). The
// actual 3-D geometry recolor is driven by SelectionHighlight reading
// the same store; this host renders the textual/QuickPick affordance so
// the preselect is observable + testable even headless.

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  setHover, setCandidates, clearHover, getHover, getCandidates,
  hoverLabel, PREHIGHLIGHT_EVENT,
} from './preHighlightStore.js';

const KIND_GLYPH = { body: '◧', face: '▢', edge: '╱', vertex: '◇' };

const readoutStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px) + var(--forge-toolbar-h, 48px) + 12px)',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 1330,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 10px',
  background: 'var(--forge-canvas-2, #0a0b0e)',
  border: '1px solid var(--forge-accent-rim, rgba(255,255,255,0.28))',
  borderRadius: 'var(--forge-radius, 4px)',
  color: 'var(--forge-ink, #ebecef)',
  fontFamily: 'var(--forge-mono, ui-monospace, Menlo, monospace)',
  fontSize: 11,
  letterSpacing: '0.03em',
  userSelect: 'none',
  pointerEvents: 'none',
  boxShadow: '0 6px 16px rgba(0,0,0,0.45)',
  whiteSpace: 'nowrap',
};

const quickPickStyle = {
  position: 'fixed',
  zIndex: 1335,
  minWidth: 150,
  background: 'var(--forge-canvas-3, #14161b)',
  border: '1px solid var(--forge-rail-edge, rgba(255,255,255,0.12))',
  borderRadius: 'var(--forge-radius, 4px)',
  boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
  padding: 4,
  fontFamily: 'var(--forge-mono, ui-monospace, Menlo, monospace)',
  fontSize: 11,
  color: 'var(--forge-ink, #ebecef)',
};

const quickPickItemStyle = (active) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '4px 8px',
  background: active ? 'var(--forge-accent-mute, rgba(255,255,255,0.08))' : 'transparent',
  border: '1px solid ' + (active
    ? 'var(--forge-accent-rim, rgba(255,255,255,0.28))'
    : 'transparent'),
  borderRadius: 3,
  color: active ? 'var(--forge-ink, #ebecef)' : 'var(--forge-ink-2, #b0b4bd)',
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit',
});

export function PreHighlightHost() {
  const [hover, setHoverState] = useState(() => getHover());
  const [cands, setCandsState] = useState(() => getCandidates());
  const [pickPos, setPickPos] = useState(null);   // {x,y} for QuickPick
  const [pickIdx, setPickIdx] = useState(0);

  // Subscribe to the store bus — read-only mirror, never the source.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onChange = (e) => {
      setHoverState(e?.detail?.hover ?? null);
      setCandsState(Array.isArray(e?.detail?.candidates) ? e.detail.candidates : []);
    };
    window.addEventListener(PREHIGHLIGHT_EVENT, onChange);
    return () => window.removeEventListener(PREHIGHLIGHT_EVENT, onChange);
  }, []);

  // Install the imperative window API (mutates the store, never setState).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgePreHighlight = (desc) => setHover(desc);
    window.__forgePreHighlightCandidates = (list) => setCandidates(list);
    window.__forgeClearPreHighlight = () => clearHover();
    window.__forgeOpenQuickPick = (list, pos) => {
      setCandidates(list);
      // pos is read by THIS host (a UI concern), so a local setState here
      // is fine — it is NOT inside the store-mutating window API path.
      setPickPos(pos && Number.isFinite(pos.x) ? { x: pos.x, y: pos.y } : null);
      setPickIdx(0);
    };
    return () => {
      try { delete window.__forgePreHighlight; } catch { /* ignore */ }
      try { delete window.__forgePreHighlightCandidates; } catch { /* ignore */ }
      try { delete window.__forgeClearPreHighlight; } catch { /* ignore */ }
      try { delete window.__forgeOpenQuickPick; } catch { /* ignore */ }
    };
  }, []);

  const commit = useCallback((idx) => {
    const c = cands[idx];
    setPickPos(null);
    if (!c || typeof window === 'undefined') return;
    // Commit a QuickPick choice as a real selection on the canonical bus.
    try {
      const sel = { kind: c.kind, ids: c.handle != null ? [c.handle] : [],
        bodyHandle: c.handle ?? undefined };
      window.__forgeSelection = sel;
      window.dispatchEvent(new CustomEvent('forge:selection-changed', { detail: sel }));
    } catch { /* ignore */ }
  }, [cands]);

  if (typeof document === 'undefined') return null;

  const showQuickPick = pickPos && cands.length >= 2;
  const label = hover ? hoverLabel(hover) : '';

  return createPortal(
    <>
      {hover ? (
        <div style={readoutStyle}
             data-testid="forge-prehighlight-overlay"
             data-kind={hover.kind}
             data-subidx={hover.subIdx == null ? '' : String(hover.subIdx)}
             role="status"
             aria-live="polite">
          <span aria-hidden="true" style={{ opacity: 0.7 }}>
            {KIND_GLYPH[hover.kind] || '·'}
          </span>
          <span>{label}</span>
        </div>
      ) : null}

      {showQuickPick ? (
        <div style={{ ...quickPickStyle, left: pickPos.x, top: pickPos.y }}
             data-testid="forge-quickpick"
             role="menu"
             aria-label="Disambiguate entity under cursor">
          {cands.map((c, i) => (
            <button key={`${c.kind}-${c.handle}-${c.subIdx}-${i}`}
                    type="button"
                    role="menuitem"
                    style={quickPickItemStyle(i === pickIdx)}
                    data-testid={`forge-quickpick-item-${i}`}
                    data-kind={c.kind}
                    onMouseEnter={() => { setPickIdx(i); setHover(c); }}
                    onClick={() => commit(i)}>
              <span aria-hidden="true" style={{ opacity: 0.7 }}>
                {KIND_GLYPH[c.kind] || '·'}
              </span>
              <span>{hoverLabel(c)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>,
    document.body,
  );
}

export default PreHighlightHost;
