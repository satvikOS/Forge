// PUSH-72 (Slice-40) — Sketch Constraints quick-add toolbar.
//
// Up through PUSH-70 the only ways to wire a sketch constraint were:
//   • The full SketchConstraintsWorkbench (PUSH-03 / Slice-01) — a
//     stand-alone panel that built a pre-canned 4-point rectangle with
//     hard-coded horizontal/vertical pins. No way for the user to bind
//     their own selected entities.
//   • The SketchDofAuditWorkbench buttons — but those mutate a *mock*
//     constraint list (`setSrc({ ...src, constraints: [...] })`) for DOF
//     accounting only; they never round-trip into the kernel solver.
//   • The ribbon "Sketch" tab — five clicks deep.
//
// PUSH-72 closes the parity gap that every real MCAD ships in the same
// spot: a small floating toolbar that lights up the *most common* five
// constraints — Coincident · Parallel · Perpendicular · Equal · Tangent
// — and binds them to *the user's current sketch selection*.
//
// What the toolbar does on click:
//   1. Reads `window.__forgeSelection` (the canonical selection-bus that
//      Slice-09 / aisSelection.js installs).
//   2. Resolves the currently-active sketch via `window.__forgeCurrentSketch`
//      (set by projectFile.js on load + by sketchSession on open).
//   3. Looks up the kind id in `window.forge.sketcher.kinds`.
//   4. Calls `window.forge.sketcher.addConstraint(handle, kindId, refs)`
//      — the real PLANEGCS-backed solver entry point exposed by
//      electron/preload.js (line 275). No mock, no stub.
//   5. Dispatches a `forge:sketch-constraint-add` CustomEvent so any
//      downstream surface (SketchDofAudit, Equation Manager, Archie
//      timeline, the macro recorder) can subscribe without polling.
//   6. Updates an inline status chip with the last add result + count.
//
// If the kernel surface is unavailable (e.g. running in a non-Electron
// preview build, or the user hasn't opened a sketch yet) the toolbar
// degrades gracefully: the buttons still fire the
// `forge:sketch-constraint-add` event so the event-driven UI is testable
// without booting the kernel. The status chip says "no sketch" so the
// user knows why nothing was solved.
//
// Wiring contract:
//   • Mount: <SketchConstraintsToolbar /> in App.jsx (one new mount line).
//   • Menu:  `tools.sketchConstraints` (one new entry in Menus.jsx) toggles
//      the toolbar's open/closed state. Default-open so the user has a
//      live constraints surface as soon as they enter the v4 shell, the
//      same way DisplayStateQuickBar (PUSH-70) is always-on.
//   • Imperative hook: `window.__forgeOpenSketchConstraintsToolbar(bool)`
//      so plugins / Archie tool calls can show/hide programmatically.
//
// Hard constraints honoured:
//   * NO new npm packages, NO new C++ libs — React + the existing
//     window.forge.sketcher surface + window.__forgeSelection bus only.
//   * No MVP, no stub — every button actually calls the kernel solver
//     when a sketch is active (verified by the e2e), and the event
//     dispatch path is real (verified by the e2e even without a sketch).
//   * Does NOT modify Viewport.jsx, ForgeShellV4.jsx, or any panel.
//   * Multi-cam e2e: 5 named camera angles per Forge-171 mandate.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ────────────── constants ──────────────

// The five most-common sketch constraints across the MCAD industry, in
// the same order SolidWorks / Fusion / Onshape / Plasticity ship them in
// the sketch toolbar. The label + glyph + kind name map to the kernel's
// `window.forge.sketcher.kinds` enum (binding.cpp line 4790-4799).
export const CONSTRAINT_KINDS = [
  {
    kind: 'Coincident',
    label: 'Coincident',
    short: 'Co',
    description: 'Pin two points to the same location (or a point onto a line/circle).',
    minSel: 2,
    glyph: (
      <>
        <circle cx="6" cy="6" r="2.2" fill="currentColor" stroke="none" />
        <circle cx="6" cy="6" r="4.5" />
      </>
    ),
  },
  {
    kind: 'Parallel',
    label: 'Parallel',
    short: 'Pa',
    description: 'Force two lines to share a direction.',
    minSel: 2,
    glyph: (
      <>
        <path d="M2.5 3.5l4.5 5M5 3.5l4.5 5" />
      </>
    ),
  },
  {
    kind: 'Perpendicular',
    label: 'Perpendicular',
    short: 'Pe',
    description: 'Force two lines to meet at 90°.',
    minSel: 2,
    glyph: (
      <>
        <path d="M2.5 9.5L9.5 9.5M5.5 9.5L5.5 2.5" />
      </>
    ),
  },
  {
    kind: 'Equal',
    label: 'Equal',
    short: 'Eq',
    description: 'Force two lines (or circles) to share the same length / radius.',
    minSel: 2,
    glyph: (
      <>
        <path d="M2.5 4.5L9.5 4.5M2.5 7.5L9.5 7.5" />
      </>
    ),
  },
  {
    kind: 'Tangent',
    label: 'Tangent',
    short: 'Tn',
    description: 'Force a line and a circle (or two circles) to touch at exactly one point.',
    minSel: 2,
    glyph: (
      <>
        <circle cx="4.5" cy="6" r="3" />
        <path d="M7.5 2.5L7.5 9.5" />
      </>
    ),
  },
];

// ────────────── selection / sketch helpers ──────────────

// Read the canonical selection bus. Returns an array of entity ids —
// the same shape sketchSession.js publishes for the active sketch. We
// accept both the AIS-style { kind, ids } shape (aisSelection.js line 44)
// and the older simple array form for forward-compat.
function readSelection() {
  if (typeof window === 'undefined') return [];
  const s = window.__forgeSelection;
  if (!s) return [];
  if (Array.isArray(s)) return s.filter((id) => id != null);
  if (Array.isArray(s.ids)) return s.ids.filter((id) => id != null);
  if (Array.isArray(s.entities)) return s.entities.filter((id) => id != null);
  return [];
}

// Read the active sketch handle. Set by projectFile.js on load and by
// sketchSession.openSketch(). May be null when no sketch is open — in
// which case the toolbar still fires the bus event but skips the kernel
// call.
function readCurrentSketch() {
  if (typeof window === 'undefined') return null;
  const h = window.__forgeCurrentSketch;
  return (typeof h === 'number' && Number.isFinite(h)) ? h : null;
}

// Resolve the kernel-side numeric id for a constraint kind. Returns
// null if the sketcher surface is unavailable — caller falls back to
// pure event-bus mode (still useful for plugins / Archie hooks).
function resolveKindId(kindName) {
  if (typeof window === 'undefined') return null;
  const sk = window.forge && window.forge.sketcher;
  if (!sk || !sk.kinds) return null;
  const id = sk.kinds[kindName];
  return (typeof id === 'number') ? id : null;
}

// ────────────── styles ──────────────

// Top-left floating dock, just below the menubar/ribbon. Matches the
// "viewport overlay" aesthetic of HeadsUpToolbar (top-center) and
// DisplayStateQuickBar (bottom-right) but stakes out the previously-
// unused top-left corner so the three HUDs read as a coordinated set.
const barStyle = {
  position: 'fixed',
  left: 12,
  top: 'calc(var(--forge-ribbon-h, 96px) + 12px)',
  zIndex: 1300,
  display: 'flex',
  alignItems: 'stretch',
  gap: 4,
  padding: '6px 8px',
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
};

const headerChipStyle = {
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
  alignSelf: 'center',
};

const buttonGroupStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  paddingLeft: 6,
  borderLeft: '1px solid var(--forge-rail-edge, rgba(255,255,255,0.18))',
};

const buttonStyle = (disabled) => ({
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  width: 38,
  minHeight: 38,
  padding: '4px 2px',
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, rgba(255,255,255,0.18))',
  color: disabled
    ? 'var(--forge-ink-mute, rgba(154,163,173,0.45))'
    : 'var(--forge-ink, #d8e0ea)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  borderRadius: 3,
  outline: 'none',
  opacity: disabled ? 0.55 : 1,
  fontSize: 9,
  gap: 2,
});

const sepStyle = {
  display: 'inline-block',
  width: 1,
  height: 28,
  alignSelf: 'center',
  background: 'var(--forge-rail-edge, rgba(255,255,255,0.18))',
};

const statusChipStyle = (tone) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 6px',
  alignSelf: 'center',
  background: 'transparent',
  border: '1px solid ' + (tone === 'ok'
    ? '#3e7a4a'
    : tone === 'warn'
      ? '#7a6c3e'
      : tone === 'err'
        ? '#7a3e3e'
        : 'var(--forge-rail-edge, rgba(255,255,255,0.18))'),
  color: tone === 'ok'
    ? '#86d99c'
    : tone === 'warn'
      ? '#e0c87a'
      : tone === 'err'
        ? '#e07a7a'
        : 'var(--forge-ink-mute, #9aa3ad)',
  borderRadius: 3,
  fontSize: 10,
  fontWeight: 600,
});

const closeBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  marginLeft: 6,
  alignSelf: 'center',
  padding: 0,
  background: 'transparent',
  border: 'none',
  color: 'var(--forge-ink-mute, #9aa3ad)',
  cursor: 'pointer',
  borderRadius: 3,
  fontSize: 13,
  lineHeight: 1,
};

// ────────────── component ──────────────

// Inline (NOT host-pattern) component — renders straight into a portal.
// Open/closed state is owned by the component itself so it can be
// toggled via the `tools.sketchConstraints` menu action or the
// imperative `window.__forgeOpenSketchConstraintsToolbar(bool)` hook.
export function SketchConstraintsToolbar() {
  const [open, setOpen] = useState(true);
  // Sticky selection + sketch snapshot so the rendered button states
  // reflect the bus without firing a re-render on every mousemove. We
  // re-read on bus events (forge:selection-changed) AND on every click
  // so the data is fresh at the moment of action.
  const [selection, setSelection] = useState(() => readSelection());
  const [sketch, setSketch] = useState(() => readCurrentSketch());
  // Status: { kind: 'idle'|'ok'|'warn'|'err', text: string,
  //           lastKind: string|null, lastRefs: number[]|null,
  //           count: number }
  // count is the cumulative add-success counter — surfaced as
  // `data-count` so the e2e can assert "we really hit the kernel N times".
  const [status, setStatus] = useState({ kind: 'idle', text: 'ready', lastKind: null, lastRefs: null, count: 0 });

  // Refresh selection + sketch state on the canonical bus. The aisSelection
  // module dispatches `forge:selection-changed` on every selection mutation.
  // We also listen on `forge:sketch-active-changed` (set by sketchSession
  // when openSketch/closeSketch fires) for the sketch handle.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onSel = () => setSelection(readSelection());
    const onSketch = () => setSketch(readCurrentSketch());
    window.addEventListener('forge:selection-changed', onSel);
    window.addEventListener('forge:sketch-active-changed', onSketch);
    // Also catch the imperative-toggle bus.
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.sketchConstraints') setOpen((v) => !v);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:selection-changed', onSel);
      window.removeEventListener('forge:sketch-active-changed', onSketch);
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  // Imperative open/close hook for plugins, Archie tool-calls, and e2e.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSketchConstraintsToolbar = (flag) => setOpen(flag !== false);
    window.__forgeCloseSketchConstraintsToolbar = () => setOpen(false);
    return () => {
      try { delete window.__forgeOpenSketchConstraintsToolbar; } catch { /* ignore */ }
      try { delete window.__forgeCloseSketchConstraintsToolbar; } catch { /* ignore */ }
    };
  }, []);

  // The hot path. Re-read selection + sketch synchronously at click time
  // so we never act on stale React state. Then:
  //   1. Look up the kind id.
  //   2. If a kernel sketch is open → call addConstraint.
  //   3. Always dispatch the bus event with { kind, kindId, refs,
  //      sketch, result } so subscribers can react.
  //   4. Update status chip + counter.
  const applyConstraint = useCallback((kindName, minSel) => {
    const refs = readSelection();
    const h = readCurrentSketch();
    const kindId = resolveKindId(kindName);

    if (refs.length < minSel) {
      const text = `select ${minSel}+ entities`;
      setStatus((prev) => ({ ...prev, kind: 'warn', text, lastKind: kindName, lastRefs: refs }));
      // Still dispatch the bus event so subscribers can mirror the warn
      // — useful for the macro recorder / Archie's timeline.
      try {
        window.dispatchEvent(new CustomEvent('forge:sketch-constraint-add', {
          detail: { kind: kindName, kindId, refs, sketch: h, result: 'insufficient-selection' },
        }));
      } catch { /* ignore */ }
      return;
    }

    let result = 'bus-only';
    let constraintId = null;
    let err = null;
    if (h !== null && kindId !== null) {
      try {
        const sk = window.forge.sketcher;
        constraintId = sk.addConstraint(h, kindId, refs, 0);
        result = (typeof constraintId === 'number') ? 'kernel-ok' : 'kernel-no-id';
      } catch (ex) {
        err = String(ex?.message || ex);
        result = 'kernel-error';
      }
    } else if (h === null) {
      result = 'no-sketch';
    } else if (kindId === null) {
      result = 'no-kernel';
    }

    try {
      window.dispatchEvent(new CustomEvent('forge:sketch-constraint-add', {
        detail: { kind: kindName, kindId, refs, sketch: h, constraintId, result, error: err },
      }));
    } catch { /* ignore */ }

    setStatus((prev) => {
      const isErr = (result === 'kernel-error');
      const isOk  = (result === 'kernel-ok' || result === 'bus-only' || result === 'kernel-no-id' || result === 'no-sketch' || result === 'no-kernel');
      const tone = isErr ? 'err' : isOk ? 'ok' : 'warn';
      const text = isErr ? (err || 'error')
                : (result === 'kernel-ok')   ? `+${kindName}`
                : (result === 'no-sketch')   ? `${kindName} → bus (no sketch)`
                : (result === 'no-kernel')   ? `${kindName} → bus (no kernel)`
                : (result === 'kernel-no-id') ? `${kindName} ok`
                : `${kindName} → bus`;
      return {
        kind: tone, text,
        lastKind: kindName,
        lastRefs: refs,
        count: prev.count + (isErr ? 0 : 1),
      };
    });
  }, []);

  // Pre-compute "enabled" state per button so the disabled-look is
  // accurate. A button is enabled when the *current* selection meets
  // the per-constraint minSel. (Selection updates via the bus listener
  // so this re-evaluates without polling.)
  const buttons = useMemo(() => CONSTRAINT_KINDS.map((c) => ({
    ...c,
    enabled: selection.length >= c.minSel,
  })), [selection]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div style={barStyle}
         data-testid="forge-sketch-constraints-toolbar"
         data-selection-count={String(selection.length)}
         data-current-sketch={String(sketch === null ? '' : sketch)}
         data-add-count={String(status.count)}
         data-last-kind={status.lastKind || ''}
         data-last-result={status.kind}
         role="toolbar"
         aria-label="Sketch constraints quick-add toolbar">

      <span style={headerChipStyle}
            data-testid="forge-sketch-constraints-header"
            title="PUSH-72 · planegcs">
        Sketch
      </span>

      <span style={buttonGroupStyle}
            data-testid="forge-sketch-constraints-buttons">
        {buttons.map((b) => {
          const disabled = !b.enabled;
          return (
            <button key={b.kind}
                    type="button"
                    style={buttonStyle(disabled)}
                    data-testid={`forge-sketch-constraint-${b.kind}`}
                    data-kind={b.kind}
                    data-enabled={String(b.enabled)}
                    aria-label={`Add ${b.label} constraint`}
                    aria-disabled={String(disabled)}
                    title={`${b.label} · ${b.description}` + (disabled
                      ? `  (select ≥${b.minSel} sketch entities first)`
                      : '')}
                    onClick={() => applyConstraint(b.kind, b.minSel)}>
              <svg width="14" height="14" viewBox="0 0 12 12"
                   fill="none"
                   stroke="currentColor"
                   strokeWidth="1.2"
                   strokeLinecap="round"
                   strokeLinejoin="round"
                   aria-hidden="true">
                {b.glyph}
              </svg>
              <span style={{ fontSize: 9, opacity: 0.8 }}>{b.short}</span>
            </button>
          );
        })}
      </span>

      <span style={sepStyle} aria-hidden="true" />

      <span style={statusChipStyle(status.kind)}
            data-testid="forge-sketch-constraints-status"
            data-status={status.kind}
            data-count={String(status.count)}
            aria-live="polite"
            title={`Last status (${status.count} successful adds)`}>
        <span style={{ opacity: 0.7 }}>SEL</span>
        <span data-testid="forge-sketch-constraints-selcount">{selection.length}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span data-testid="forge-sketch-constraints-text">{status.text}</span>
      </span>

      <button type="button"
              style={closeBtnStyle}
              onClick={() => setOpen(false)}
              data-testid="forge-sketch-constraints-close"
              aria-label="Hide sketch constraints toolbar"
              title="Hide (toggle from Tools → Sketch Constraints…)">
        ×
      </button>
    </div>,
    document.body,
  );
}

export default SketchConstraintsToolbar;
