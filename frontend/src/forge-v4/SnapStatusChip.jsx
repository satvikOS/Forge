// Forge-117 — status-bar chip for the snap engine.
//
// Renders a compact pill into the existing `.forge-statusbar` element
// via a portal, so we don't need to modify StatusBar.jsx or
// ForgeShellV4.jsx. Behavior:
//   - Click → modes picker dropdown.
//   - Right-click → grid size numeric input.
//   - Re-renders whenever window.__forgeSnap changes (rev counter).
//
// Self-mounts on import:
//   import './SnapStatusChip.jsx';
// or render explicitly anywhere — the inner component is exported too.

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  SNAP_MODES,
  getSnapState,
  setSnapState,
  toggleSnapMode,
} from './snapEngine.js';

const MODE_LABEL = {
  vertex:        'Vertex',
  edgeMid:       'Mid',
  faceCenter:    'Face',
  grid:          'Grid',
  origin:        'Origin',
  perpendicular: 'Perp',
  tangent:       'Tan',
};

const MODE_GLYPH = {
  vertex:        <rect x="2" y="2" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.2" />,
  edgeMid:       <polygon points="1,2 9,2 5,9" fill="none" stroke="currentColor" strokeWidth="1.2" />,
  faceCenter:    <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />,
  grid:          (<g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                    <line x1="1" y1="5" x2="9" y2="5" />
                    <line x1="5" y1="1" x2="5" y2="9" />
                  </g>),
  origin:        <circle cx="5" cy="5" r="2.5" fill="currentColor" />,
  perpendicular: (<g stroke="currentColor" strokeWidth="1.2" fill="none">
                    <polyline points="1,1 1,9 9,9" />
                    <rect x="1" y="7" width="2" height="2" />
                  </g>),
  tangent:       (<g stroke="currentColor" strokeWidth="1.2" fill="none">
                    <circle cx="5" cy="7" r="2" />
                    <line x1="0" y1="3" x2="10" y2="3" />
                  </g>),
};

function ModeIcon({ mode, active }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10"
         style={{
           display: 'block',
           color: active ? 'var(--forge-accent)' : 'var(--forge-ink-mute)',
           opacity: active ? 1 : 0.55,
         }}>
      {MODE_GLYPH[mode]}
    </svg>
  );
}

function useSnapRev() {
  const [rev, setRev] = useState(() => {
    const s = getSnapState();
    return s ? s.rev | 0 : 0;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      const s = getSnapState();
      setRev(s ? s.rev | 0 : 0);
    };
    window.addEventListener('forge-snap-change', refresh);
    return () => window.removeEventListener('forge-snap-change', refresh);
  }, []);
  return rev;
}

export function SnapStatusChip() {
  useSnapRev();
  const state = getSnapState();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const chipRef = useRef(null);

  if (!state) return null;
  const enabledModes = SNAP_MODES.filter((m) => state.modes.has(m));

  const onClick = (e) => {
    e.preventDefault();
    setGridOpen(false);
    setPickerOpen((v) => !v);
  };
  const onContextMenu = (e) => {
    e.preventDefault();
    setPickerOpen(false);
    setGridOpen((v) => !v);
  };

  const toggleEnabled = (e) => {
    e.stopPropagation();
    setSnapState({ enabled: !state.enabled });
  };

  return (
    <span ref={chipRef}
          className="forge-snap-chip"
          data-testid="forge-snap-chip"
          data-enabled={state.enabled ? 'true' : 'false'}
          onClick={onClick}
          onContextMenu={onContextMenu}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            border: '1px solid var(--forge-rail-edge)',
            borderRadius: 'var(--forge-radius-pill)',
            background: state.enabled
              ? 'var(--forge-accent-mute)'
              : 'transparent',
            color: state.enabled ? 'var(--forge-ink)' : 'var(--forge-ink-mute)',
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'var(--forge-mono)',
            letterSpacing: '0.04em',
            position: 'relative',
            userSelect: 'none',
          }}>
      <button
        type="button"
        aria-label="Toggle snap engine"
        data-testid="forge-snap-toggle"
        onClick={toggleEnabled}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          color: 'inherit',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          fontFamily: 'inherit',
          fontSize: 10,
        }}>
        SNAP
      </button>
      <span style={{ display: 'inline-flex', gap: 2 }}>
        {enabledModes.length === 0 ? (
          <span style={{ color: 'var(--forge-ink-mute)' }}>off</span>
        ) : enabledModes.map((m) => (
          <ModeIcon key={m} mode={m} active />
        ))}
      </span>
      <span style={{ color: 'var(--forge-ink-mute)', fontSize: 9 }}>
        g={state.gridSize}
      </span>

      {pickerOpen && (
        <div data-testid="forge-snap-picker"
             onClick={(e) => e.stopPropagation()}
             onContextMenu={(e) => e.stopPropagation()}
             style={{
               position: 'absolute',
               bottom: 'calc(100% + 6px)',
               left: 0,
               background: 'var(--forge-canvas-3)',
               border: '1px solid var(--forge-rail-edge)',
               borderRadius: 'var(--forge-radius)',
               padding: 6,
               minWidth: 160,
               boxShadow: '0 12px 28px rgba(0,0,0,0.55)',
               zIndex: 1400,
               display: 'flex',
               flexDirection: 'column',
               gap: 2,
             }}>
          {SNAP_MODES.map((m) => {
            const active = state.modes.has(m);
            return (
              <button key={m}
                      type="button"
                      data-testid={`forge-snap-mode-${m}`}
                      data-active={active ? 'true' : 'false'}
                      onClick={() => toggleSnapMode(m)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '4px 6px',
                        background: active ? 'var(--forge-accent-mute)' : 'transparent',
                        border: '1px solid transparent',
                        borderRadius: 3,
                        color: active ? 'var(--forge-ink)' : 'var(--forge-ink-2)',
                        fontSize: 11,
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: 'var(--forge-font)',
                      }}>
                <ModeIcon mode={m} active={active} />
                <span style={{ flex: 1 }}>{MODE_LABEL[m]}</span>
                <span style={{ fontSize: 9, color: 'var(--forge-ink-mute)' }}>{active ? 'on' : 'off'}</span>
              </button>
            );
          })}
        </div>
      )}

      {gridOpen && (
        <div data-testid="forge-snap-grid-input"
             onClick={(e) => e.stopPropagation()}
             onContextMenu={(e) => e.stopPropagation()}
             style={{
               position: 'absolute',
               bottom: 'calc(100% + 6px)',
               left: 0,
               background: 'var(--forge-canvas-3)',
               border: '1px solid var(--forge-rail-edge)',
               borderRadius: 'var(--forge-radius)',
               padding: 8,
               boxShadow: '0 12px 28px rgba(0,0,0,0.55)',
               zIndex: 1400,
               display: 'flex',
               alignItems: 'center',
               gap: 6,
             }}>
          <label style={{ fontSize: 10, color: 'var(--forge-ink-mute)' }}>Grid (mm)</label>
          <input type="number"
                 min="0.1"
                 step="0.1"
                 defaultValue={state.gridSize}
                 data-testid="forge-snap-grid-size"
                 autoFocus
                 onBlur={() => setGridOpen(false)}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter') {
                     const v = parseFloat(e.target.value);
                     if (Number.isFinite(v) && v > 0) setSnapState({ gridSize: v });
                     setGridOpen(false);
                   } else if (e.key === 'Escape') {
                     setGridOpen(false);
                   }
                 }}
                 onChange={(e) => {
                   const v = parseFloat(e.target.value);
                   if (Number.isFinite(v) && v > 0) setSnapState({ gridSize: v });
                 }}
                 style={{
                   width: 70,
                   background: 'var(--forge-canvas)',
                   border: '1px solid var(--forge-rail-edge)',
                   borderRadius: 3,
                   color: 'var(--forge-ink)',
                   font: 'inherit',
                   fontSize: 12,
                   padding: '3px 6px',
                 }} />
        </div>
      )}
    </span>
  );
}

// ── Self-mount via portal ─────────────────────────────────────────────
// We watch for the status bar to appear (it's mounted lazily after the
// shell hydrates) and inject a span there. Idempotent.

let _mounted = false;
let _root = null;

function ensureMount() {
  if (typeof document === 'undefined') return;
  const statusbar = document.querySelector('[data-testid="forge-statusbar"]')
                 || document.querySelector('.forge-statusbar');
  if (!statusbar) return;
  let host = statusbar.querySelector('[data-forge-snap-host="true"]');
  if (!host) {
    host = document.createElement('span');
    host.setAttribute('data-forge-snap-host', 'true');
    host.style.marginLeft = '8px';
    host.style.display = 'inline-flex';
    host.style.alignItems = 'center';
    statusbar.appendChild(host);
  }
  if (!_root) _root = createRoot(host);
  _root.render(<SnapStatusChip />);
  _mounted = true;
}

export function mountSnapStatusChip() {
  if (typeof window === 'undefined') return;
  ensureMount();
  if (_mounted) return;
  // Retry until the status bar exists (shell hydrates async).
  const observer = new MutationObserver(() => {
    ensureMount();
    if (_mounted) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Auto-mount on import (idempotent, harmless if no DOM).
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountSnapStatusChip, { once: true });
  } else {
    // Defer so the shell can hydrate first.
    setTimeout(mountSnapStatusChip, 0);
  }
}

export default SnapStatusChip;
