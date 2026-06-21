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

// Bottom-right corner. z-index on the viewport-HUD layer so it sits above
// the scene but below modal dialogs. Sits clear of the StatusBar (which is
// position:fixed bottom:0). Refined onto the --fds-* design tokens:
// hairline-framed translucent panel, tabular-numeric readouts, one
// restrained accent on the active state, grey-tinted signal dots only.
const barStyle = {
  position: 'fixed',
  right: 'var(--fds-space-4, 12px)',
  bottom: 'calc(var(--forge-statusbar-h, 26px) + var(--fds-space-4, 12px))',
  zIndex: 'var(--fds-z-viewport-hud, 5)',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--fds-space-3, 8px)',
  height: 'var(--fds-control-h-lg, 32px)',
  padding: '0 var(--fds-space-3, 8px)',
  background: 'color-mix(in srgb, var(--fds-surface-panel) 78%, transparent)',
  WebkitBackdropFilter: 'blur(10px) saturate(1.1)',
  backdropFilter: 'blur(10px) saturate(1.1)',
  border: '1px solid var(--fds-border)',
  borderRadius: 'var(--fds-radius-md, 4px)',
  color: 'var(--fds-text-secondary)',
  fontFamily: 'var(--fds-font-ui)',
  fontSize: 'var(--fds-fs-micro, 11px)',
  lineHeight: 'var(--fds-lh-micro, 14px)',
  userSelect: 'none',
  pointerEvents: 'auto',
  boxShadow: 'var(--fds-elev-1)',
  whiteSpace: 'nowrap',
};

const stateChipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--fds-space-2, 4px)',
  height: 'var(--fds-control-h-xs, 22px)',
  padding: '0 var(--fds-space-3, 8px)',
  background: 'var(--fds-state-selected)',
  border: '1px solid var(--fds-state-selected-bd)',
  borderRadius: 'var(--fds-radius-sm, 3px)',
  fontSize: 'var(--fds-fs-micro, 11px)',
  fontWeight: 'var(--fds-fw-medium, 500)',
  letterSpacing: 'var(--fds-tracking-caps, 0.08em)',
  color: 'var(--fds-text-primary)',
  textTransform: 'uppercase',
};

const buttonStyle = (active) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'var(--fds-control-h-sm, 24px)',
  height: 'var(--fds-control-h-sm, 24px)',
  padding: 0,
  background: active ? 'var(--fds-state-selected)' : 'transparent',
  border: '1px solid ' + (active ? 'var(--fds-state-selected-bd)' : 'transparent'),
  color: active ? 'var(--fds-text-primary)' : 'var(--fds-text-tertiary)',
  cursor: 'pointer',
  borderRadius: 'var(--fds-radius-sm, 3px)',
  outline: 'none',
  transition: 'background var(--fds-motion-fast), color var(--fds-motion-fast), border-color var(--fds-motion-fast)',
});

const buttonGroupStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--fds-space-1, 2px)',
  paddingLeft: 'var(--fds-space-3, 8px)',
  borderLeft: '1px solid var(--fds-border)',
};

const sepStyle = {
  display: 'inline-block',
  width: 1,
  height: 'var(--fds-icon-sm, 14px)',
  background: 'var(--fds-border)',
};

const axisChipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--fds-space-2, 4px)',
  height: 'var(--fds-control-h-xs, 22px)',
  padding: '0 var(--fds-space-3, 8px)',
  background: 'transparent',
  border: '1px solid var(--fds-border)',
  borderRadius: 'var(--fds-radius-sm, 3px)',
  color: 'var(--fds-text-secondary)',
  fontSize: 'var(--fds-fs-micro, 11px)',
  fontWeight: 'var(--fds-fw-regular, 400)',
};

// FPS readout — monochrome value with a grey-tinted signal DOT (never a
// garish coloured fill). Dot: ok > 50 · warn 30-50 · error < 30 · idle pre-warmup.
const fpsStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--fds-space-2, 4px)',
  height: 'var(--fds-control-h-xs, 22px)',
  padding: '0 var(--fds-space-3, 8px)',
  background: 'transparent',
  border: '1px solid var(--fds-border)',
  borderRadius: 'var(--fds-radius-sm, 3px)',
  color: 'var(--fds-text-primary)',
  fontFamily: 'var(--fds-font-num)',
  fontVariantNumeric: 'tabular-nums lining-nums',
  fontSize: 'var(--fds-fs-micro, 11px)',
  fontWeight: 'var(--fds-fw-medium, 500)',
};

const fpsDotStyle = (fps) => ({
  width: 7,
  height: 7,
  borderRadius: 'var(--fds-radius-pill, 999px)',
  flexShrink: 0,
  background: fps <= 0 ? 'var(--fds-text-disabled)'
            : fps < 30 ? 'var(--fds-signal-error)'
            : fps < 50 ? 'var(--fds-signal-warn)'
            : 'var(--fds-signal-ok)',
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
          warming up rather than a spurious 0. The grey-tinted signal dot
          (ok / warn / error / idle) carries the health cue; the number
          itself stays monochrome per the design system. */}
      <span style={fpsStyle}
            data-testid="forge-display-quickbar-fps"
            data-fps={String(fps)}
            title="Live frame rate (1-second window)">
        <span style={fpsDotStyle(fps)} aria-hidden="true" />
        <span style={{ color: 'var(--fds-text-tertiary)' }}>FPS</span>
        <span>{fps > 0 ? fps : '--'}</span>
      </span>
    </div>,
    document.body,
  );
}

export default DisplayStateQuickBar;
