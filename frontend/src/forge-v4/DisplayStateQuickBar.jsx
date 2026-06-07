// PUSH-70 (Slice-38) — Display State QuickBar (always-on HUD overlay).
//
// Up through PUSH-67 the only place to change the viewport's display
// state (shaded / wireframe / transparent) was the View menu — three
// clicks away (open View → pick Shaded/Wireframe), with no
// always-visible readout of what state you're currently in. The
// HeadsUpToolbar (Forge-71) does expose Shaded / Wireframe / Section
// buttons but it lives top-center and groups twelve unrelated tools
// together; it's a *tool palette*, not a display-state monitor.
//
// PUSH-70 lights up the bottom-right HUD that every other MCAD
// (Inventor, SolidWorks, Plasticity, Fusion, FreeCAD) ships in the same
// spot — a small, always-on QuickBar showing:
//
//   • The current display state, with a live highlighted chip.
//   • Three quick-toggle buttons: Shaded · Wireframe · Transparent.
//   • An axis indicator that reflects the active view orientation
//     (iso / front / top / right / back / bottom / left).
//   • A live FPS counter driven by a requestAnimationFrame loop — same
//     1-second window pattern that the legacy PerfStatsHUD uses, but
//     scoped to the QuickBar so it survives even when PerfStats is hidden.
//
// Wiring contract (per the PUSH-70 brief):
//
//   • On boot the QuickBar publishes `window.__forgeDisplayState =
//     'shaded'` so any later surface that needs the canonical "what
//     display state is the viewport in?" can read it synchronously.
//   • Whenever the user clicks a button OR an external surface (View
//     menu, HeadsUpToolbar, Cmd+D) dispatches a
//     `forge:menu-action` with id ∈ {view.shaded, view.wireframe,
//     view.transparent}, the QuickBar updates its tracked state and
//     re-publishes `__forgeDisplayState` + `forge:display-state-changed`.
//     This makes the QuickBar the single subscriber-publisher
//     for display state — other panels never have to MutationObserver
//     ForgeShellV4 internals.
//   • Clicking a QuickBar button dispatches `forge:menu-action` with the
//     matching view.X id — so the canonical ForgeShellV4 displayState
//     state also updates for the two wired ids (shaded / wireframe).
//     `view.transparent` is not currently wired in the shell; we still
//     fire the menu event (so plugins and Archie can hook it) AND we
//     still flip the QuickBar's local state + global signal so other
//     surfaces see the user's intent.
//   • viewName for the axis indicator is sniffed off the same
//     `forge:menu-action` bus (view.iso / view.front / …) — no
//     ForgeShellV4 touch needed.
//
// Hard constraints honoured:
//   * NO new npm packages, NO new C++ libs — React + the existing
//     forge:menu-action bus only.
//   * No MVP, no stub — every interaction has a live readout and
//     the FPS counter is a real rAF loop (no fake number).
//   * Always-visible, inline (NOT a Host pattern) — the component
//     renders its own portal directly into <body> on mount and lives
//     for the whole session.
//   * Does NOT modify Menus.jsx, Viewport.jsx, or any other panel.
//     ForgeShellV4 is also untouched — the QuickBar piggybacks on the
//     bus that already exists.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ────────────── constants ──────────────

const DISPLAY_STATES = ['shaded', 'wireframe', 'transparent'];

const DISPLAY_LABEL = {
  shaded:      'Shaded',
  wireframe:   'Wireframe',
  transparent: 'Transparent',
};

// 12×12 glyphs for the three display states. Match the icon vocabulary
// used by the HeadsUpToolbar so the QuickBar reads as part of the same
// design system.
const DISPLAY_GLYPH = {
  shaded: (
    <>
      <circle cx="6" cy="6" r="4" />
      <path d="M6 2a4 4 0 0 0 0 8" fill="currentColor" stroke="none" />
    </>
  ),
  wireframe: (
    <>
      <circle cx="6" cy="6" r="4" />
      <path d="M2 6h8M6 2v8" />
    </>
  ),
  transparent: (
    <>
      <circle cx="6" cy="6" r="4" strokeDasharray="2 1.5" />
      <path d="M2 6h8" strokeDasharray="2 1.5" />
    </>
  ),
};

// 7-axis-indicator glyphs. We reuse the same Y-up RH convention the
// kernel writes (Z is "up" in world space, but the camera-relative
// names are iso / front / top / right / back / bottom / left). The icon
// shows where the camera is looking *from* for that orientation.
const VIEW_GLYPH = {
  iso: (
    <>
      <path d="M2 4l4 -2 4 2v4l-4 2 -4 -2z" />
      <path d="M2 4l4 2 4 -2M6 6v4" />
    </>
  ),
  front: (
    <>
      <rect x="2.5" y="2.5" width="7" height="7" />
      <text x="6" y="7.6" textAnchor="middle" fontSize="4.5"
            fontFamily="var(--forge-mono)" fill="currentColor" stroke="none">F</text>
    </>
  ),
  top: (
    <>
      <rect x="2.5" y="2.5" width="7" height="7" />
      <text x="6" y="7.6" textAnchor="middle" fontSize="4.5"
            fontFamily="var(--forge-mono)" fill="currentColor" stroke="none">T</text>
    </>
  ),
  right: (
    <>
      <rect x="2.5" y="2.5" width="7" height="7" />
      <text x="6" y="7.6" textAnchor="middle" fontSize="4.5"
            fontFamily="var(--forge-mono)" fill="currentColor" stroke="none">R</text>
    </>
  ),
  back: (
    <>
      <rect x="2.5" y="2.5" width="7" height="7" />
      <text x="6" y="7.6" textAnchor="middle" fontSize="4.5"
            fontFamily="var(--forge-mono)" fill="currentColor" stroke="none">B</text>
    </>
  ),
  bottom: (
    <>
      <rect x="2.5" y="2.5" width="7" height="7" />
      <text x="6" y="7.6" textAnchor="middle" fontSize="4.5"
            fontFamily="var(--forge-mono)" fill="currentColor" stroke="none">D</text>
    </>
  ),
  left: (
    <>
      <rect x="2.5" y="2.5" width="7" height="7" />
      <text x="6" y="7.6" textAnchor="middle" fontSize="4.5"
            fontFamily="var(--forge-mono)" fill="currentColor" stroke="none">L</text>
    </>
  ),
};

const VIEW_LABEL = {
  iso: 'Iso', front: 'Front', top: 'Top', right: 'Right',
  back: 'Back', bottom: 'Bottom', left: 'Left',
};

// ────────────── global signal ──────────────

// Publish to BOTH the synchronous global (`__forgeDisplayState`) and the
// async bus (`forge:display-state-changed`) so consumers can pick the
// flavour that matches their wiring. Idempotent: setting the same state
// twice still fires (so a button click is observable even when the
// state hasn't changed — e.g. clicking "shaded" while already shaded
// still confirms the action).
function publishDisplay(state, source) {
  if (typeof window === 'undefined') return;
  window.__forgeDisplayState = state;
  try {
    window.dispatchEvent(new CustomEvent('forge:display-state-changed', {
      detail: { state, source: source || 'quickbar' },
    }));
  } catch { /* dispatchEvent ctor can throw in old shells; ignore */ }
}

// ────────────── FPS counter ──────────────

// requestAnimationFrame-driven 1-second-window FPS counter. We sample
// the last second of frames and report the integer fps, identical to
// the algorithm PerfStatsHUD uses but isolated so the QuickBar shows
// a number even when PerfStats is hidden.
function useFps() {
  const [fps, setFps] = useState(0);
  const stateRef = useRef({ frames: 0, last: 0, rafId: 0, mounted: true });
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const s = stateRef.current;
    s.mounted = true;
    s.frames = 0;
    s.last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const tick = () => {
      if (!s.mounted) return;
      s.frames += 1;
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const dt = now - s.last;
      if (dt >= 1000) {
        // Round to nearest integer — small enough display, no need for decimals.
        const v = Math.round((s.frames * 1000) / dt);
        setFps(v);
        s.frames = 0;
        s.last = now;
      }
      s.rafId = requestAnimationFrame(tick);
    };
    s.rafId = requestAnimationFrame(tick);
    return () => {
      s.mounted = false;
      try { cancelAnimationFrame(s.rafId); } catch { /* ignore */ }
    };
  }, []);
  return fps;
}

// ────────────── styles ──────────────

// Bottom-right corner. z-index just above the viewport's overlays so it
// always wins, but below modal dialogs (z-index 2000+). Sits clear of
// the StatusBar (which uses position:fixed bottom:0 height:24px).
const barStyle = {
  position: 'fixed',
  right: 12,
  bottom: 'calc(var(--forge-statusbar-h, 24px) + 12px)',
  zIndex: 1350,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  background: 'var(--forge-canvas-2, rgba(20, 24, 28, 0.92))',
  border: '1px solid var(--forge-rail-edge, rgba(255,255,255,0.12))',
  borderRadius: 6,
  color: 'var(--forge-ink, #d8e0ea)',
  fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 10,
  letterSpacing: '0.04em',
  userSelect: 'none',
  pointerEvents: 'auto',
  boxShadow: '0 8px 18px rgba(0,0,0,0.45)',
  whiteSpace: 'nowrap',
};

const stateChipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 6px',
  background: 'var(--forge-accent-mute, rgba(70, 130, 200, 0.20))',
  border: '1px solid var(--forge-rail-edge, rgba(255,255,255,0.12))',
  borderRadius: 3,
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--forge-ink, #d8e0ea)',
  textTransform: 'uppercase',
};

const buttonStyle = (active) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 22,
  padding: 0,
  background: active
    ? 'var(--forge-accent, rgba(70, 130, 200, 0.45))'
    : 'transparent',
  border: '1px solid ' + (active
    ? 'var(--forge-accent, rgba(70, 130, 200, 0.80))'
    : 'var(--forge-rail-edge, rgba(255,255,255,0.18))'),
  color: active ? '#ffffff' : 'var(--forge-ink-mute, #9aa3ad)',
  cursor: 'pointer',
  borderRadius: 3,
  outline: 'none',
});

const buttonGroupStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  paddingLeft: 6,
  borderLeft: '1px solid var(--forge-rail-edge, rgba(255,255,255,0.18))',
};

const sepStyle = {
  display: 'inline-block',
  width: 1,
  height: 14,
  background: 'var(--forge-rail-edge, rgba(255,255,255,0.18))',
};

const axisChipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '2px 6px',
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, rgba(255,255,255,0.18))',
  borderRadius: 3,
  color: 'var(--forge-ink-mute, #9aa3ad)',
  fontSize: 10,
  fontWeight: 500,
};

const fpsStyle = (fps) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '2px 6px',
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, rgba(255,255,255,0.18))',
  borderRadius: 3,
  // Color-code: green for >50, amber for 30-50, red for <30, neutral pre-warmup.
  color: fps <= 0 ? 'var(--forge-ink-mute, #9aa3ad)'
       : fps < 30 ? '#e07a7a'
       : fps < 50 ? '#e0c87a'
       : '#7ae09c',
  fontSize: 10,
  fontWeight: 600,
});

// ────────────── component ──────────────

export function DisplayStateQuickBar() {
  const [displayState, setDisplayState] = useState(() => {
    if (typeof window !== 'undefined'
        && typeof window.__forgeDisplayState === 'string'
        && DISPLAY_STATES.includes(window.__forgeDisplayState)) {
      return window.__forgeDisplayState;
    }
    return 'shaded';
  });
  const [viewName, setViewName] = useState('iso');
  const fps = useFps();

  // Publish the initial state once on mount so any surface that probes
  // `window.__forgeDisplayState` on boot sees a sane value. Idempotent
  // if the user dispatches view.shaded later — same state, same publish.
  useEffect(() => {
    publishDisplay(displayState, 'quickbar-mount');
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to the menu-action bus. We catch:
  //   • view.{shaded,wireframe,transparent} → update display state +
  //     re-publish global signal.
  //   • view.{iso,front,top,right,back,bottom,left} → update viewName
  //     so the axis indicator follows external view changes.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (typeof id !== 'string' || !id.startsWith('view.')) return;
      const sub = id.slice('view.'.length);
      if (DISPLAY_STATES.includes(sub)) {
        setDisplayState((prev) => {
          if (prev === sub) {
            publishDisplay(sub, e?.detail?.source || 'bus');
            return prev;
          }
          publishDisplay(sub, e?.detail?.source || 'bus');
          return sub;
        });
        return;
      }
      if (Object.prototype.hasOwnProperty.call(VIEW_GLYPH, sub)) {
        setViewName(sub);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => window.removeEventListener('forge:menu-action', onMenu);
  }, []);

  // Dispatch the same forge:menu-action event the View menu fires. This
  // round-trips through the bus, hits ForgeShellV4's handler (for the
  // wired ids shaded / wireframe), and bubbles back into our onMenu
  // listener above so the QuickBar's local state stays in sync.
  const dispatch = useCallback((nextState) => {
    if (!DISPLAY_STATES.includes(nextState)) return;
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent('forge:menu-action', {
        detail: { id: `view.${nextState}`, source: 'quickbar' },
      }));
    } catch { /* ignore */ }
    // Defensive: also update local state + global signal immediately so
    // we don't depend on the round-trip ordering. The onMenu listener
    // will see the same dispatch and no-op (same value).
    setDisplayState((prev) => {
      publishDisplay(nextState, 'quickbar-click');
      return nextState;
    });
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div style={barStyle}
         data-testid="forge-display-quickbar"
         data-display-state={displayState}
         data-view-name={viewName}
         role="toolbar"
         aria-label="Display state quickbar">

      {/* Current state chip — primary readout. */}
      <span style={stateChipStyle}
            data-testid="forge-display-quickbar-state"
            aria-live="polite">
        {DISPLAY_LABEL[displayState] || displayState}
      </span>

      {/* Toggle buttons. */}
      <span style={buttonGroupStyle}
            data-testid="forge-display-quickbar-buttons">
        {DISPLAY_STATES.map((s) => {
          const active = s === displayState;
          return (
            <button key={s}
                    type="button"
                    style={buttonStyle(active)}
                    data-testid={`forge-display-quickbar-${s}`}
                    data-active={String(active)}
                    aria-label={`Set display state to ${DISPLAY_LABEL[s]}`}
                    aria-pressed={String(active)}
                    title={`${DISPLAY_LABEL[s]} (forge:menu-action view.${s})`}
                    onClick={() => dispatch(s)}>
              <svg width="12" height="12" viewBox="0 0 12 12"
                   fill="none"
                   stroke="currentColor"
                   strokeWidth="1.2"
                   strokeLinecap="round"
                   strokeLinejoin="round"
                   aria-hidden="true">
                {DISPLAY_GLYPH[s]}
              </svg>
            </button>
          );
        })}
      </span>

      <span style={sepStyle} aria-hidden="true" />

      {/* Axis indicator. */}
      <span style={axisChipStyle}
            data-testid="forge-display-quickbar-axis"
            data-view={viewName}
            title={`Active view: ${VIEW_LABEL[viewName] || viewName}`}>
        <svg width="12" height="12" viewBox="0 0 12 12"
             fill="none"
             stroke="currentColor"
             strokeWidth="1.1"
             strokeLinecap="round"
             strokeLinejoin="round"
             aria-hidden="true">
          {VIEW_GLYPH[viewName] || VIEW_GLYPH.iso}
        </svg>
        <span style={{ fontSize: 10 }}>{VIEW_LABEL[viewName] || viewName}</span>
      </span>

      {/* FPS counter — populated by the rAF loop. Shows "--" until the
          first 1-second window completes so the user sees the counter
          warming up rather than a spurious 0. */}
      <span style={fpsStyle(fps)}
            data-testid="forge-display-quickbar-fps"
            data-fps={String(fps)}
            title="Live frame rate (1-second window)">
        <span style={{ opacity: 0.7 }}>FPS</span>
        <span>{fps > 0 ? fps : '--'}</span>
      </span>
    </div>,
    document.body,
  );
}

export default DisplayStateQuickBar;
