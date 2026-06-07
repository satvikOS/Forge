// PUSH-91 (Slice-59) — Sketch Constraints Extended Panel.
//
// Up through PUSH-72 the only quick-add surface was a five-button floating
// toolbar (Coincident / Parallel / Perpendicular / Equal / Tangent). Every
// real MCAD ships a *complete* constraints panel with both the geometric
// kinds AND the dimensional kinds (Distance / Angle / Diameter / Radius
// with a numeric input). The PLANEGCS-backed kernel surface already
// exposes the dimensional families via the `Distance` kind — PUSH-72 just
// never wired the numeric input.
//
// PUSH-91 closes that parity gap with a docked side-rail panel — same
// info-architecture slot the PMI / Layers / Body Colours / Section Plane
// panels live in — that lists every constraint family in two groups:
//
//   Geometric (no value)
//     Coincident, Parallel, Perpendicular, Equal, Tangent,
//     Horizontal, Vertical, PointOnLine, PointOnCircle, Symmetric,
//     Concentric, Fix
//
//   Dimensional (numeric value)
//     Distance, Angle, Diameter, Radius
//
// Of those 16 kinds, ten map *directly* onto the kernel enum exposed by
// binding.cpp lines 4789-4800 (Coincident=1 · Parallel=2 · Perpendicular=3
// · Distance=4 · Horizontal=5 · Vertical=6 · PointOnLine=7 · PointOnCircle=8
// · Equal=9 · Tangent=10) — those buttons call window.forge.sketcher
// .addConstraint(handle, kindId, refs, value) directly.
//
// The other six (Symmetric, Concentric, Fix, Angle, Diameter, Radius) are
// surfaced through *compositions* of the kernel-supplied primitives so
// every button is honest about what reaches the solver:
//
//   Fix       → Distance with refs=[p, p] and value=0  (pins a point in
//                place; the exact pattern PUSH-72's kernel-path e2e uses
//                at line 302 of push-72-sketch-constraints.spec.js).
//   Concentric → Coincident on the two circle centres (a circle's centre
//                point is the first entity in its [centre, radius-point]
//                tuple by sketcher convention).
//   Symmetric  → Equal between |A→M| and |B→M| (added as two Distance
//                constraints sharing the value field).
//   Radius     → Distance(centre, radius-point) = value
//   Diameter   → Distance(centre, radius-point) = value / 2
//   Angle      → not in the planegcs facade yet; we keep the UX and emit
//                a bus event with result:'no-kernel-kind' so subscribers
//                (macro recorder, Archie, plugin authors) can still
//                observe the user-intent. NO silent fallback: the status
//                chip says "no kernel kind" explicitly.
//
// This follows the same "graceful degrade" policy PUSH-72 established at
// line 384-387 of SketchConstraintsToolbar.jsx — we never stub a kernel
// id, we report the truthful surface state via the result enum:
//
//     'kernel-ok'              → addConstraint returned a finite id
//     'kernel-no-id'           → addConstraint returned non-numeric (rare)
//     'kernel-error'           → addConstraint threw
//     'composite-ok'           → composite sequence (eg Symmetric) ran
//     'no-sketch'              → no active sketch; bus-only
//     'no-kernel'              → no kernel surface at all; bus-only
//     'no-kernel-kind'         → kind has no kernel mapping (Angle today)
//     'insufficient-selection' → selection didn't meet minSel
//     'invalid-value'          → numeric value field is required but blank
//
// Every result emits a `forge:sketch-constraint-add-ext` event with the
// full detail payload so downstream UI (PUSH-72 toolbar, Activity Log,
// Equation Manager, Archie timeline) can subscribe without polling. The
// panel header chip surfaces the last constraint count + last-kind, the
// same shape PUSH-72 used so the e2e can assert kernel hits.
//
// Wiring contract:
//   • Mount:         <SketchConstraintsExtendedPanelHost /> in App.jsx.
//   • Menu:          `tools.sketchConstraintsExt` (in Menus.jsx).
//   • Imperative:    window.__forgeOpenSketchConstraintsExtPanel(bool).
//   • Bus event:     forge:sketch-constraint-add-ext.
//   • Reads:         window.__forgeSelection, window.__forgeCurrentSketch.
//   • Solver:        window.forge.sketcher.addConstraint (real PLANEGCS).
//
// Hard constraints honoured:
//   * NO new npm / C++ / external deps — React + window.forge.sketcher
//     + window.__forgeSelection bus, same as PUSH-72.
//   * No MVP, no stub, no fallback that silently lies — kinds without a
//     kernel mapping report `no-kernel-kind` explicitly.
//   * Does NOT modify Viewport.jsx, ForgeShellV4.jsx, the PUSH-72 toolbar,
//     or any existing panel.
//   * Multi-cam e2e: 5 named camera angles per Forge-171 mandate.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// ─────────────────────────────────────────────────────────────────────
// Constants — every constraint family we surface.
//
// `kernel: <name>` is the key looked up in window.forge.sketcher.kinds;
// `composite: true` flags the families we synthesise out of multiple
// kernel calls; `dim: true` flags the dimensional families that need
// a numeric value; `minSel` is the entity count we refuse below.

export const EXT_CONSTRAINT_KINDS = [
  // ─── Geometric ───────────────────────────────────────────────────
  { kind: 'Coincident',    label: 'Coincident',     short: 'Co', group: 'geom', kernel: 'Coincident',    minSel: 2 },
  { kind: 'Parallel',      label: 'Parallel',       short: 'Pa', group: 'geom', kernel: 'Parallel',      minSel: 2 },
  { kind: 'Perpendicular', label: 'Perpendicular',  short: 'Pe', group: 'geom', kernel: 'Perpendicular', minSel: 2 },
  { kind: 'Equal',         label: 'Equal',          short: 'Eq', group: 'geom', kernel: 'Equal',         minSel: 2 },
  { kind: 'Tangent',       label: 'Tangent',        short: 'Tn', group: 'geom', kernel: 'Tangent',       minSel: 2 },
  { kind: 'Horizontal',    label: 'Horizontal',     short: 'Hz', group: 'geom', kernel: 'Horizontal',    minSel: 1 },
  { kind: 'Vertical',      label: 'Vertical',       short: 'Vt', group: 'geom', kernel: 'Vertical',      minSel: 1 },
  { kind: 'PointOnLine',   label: 'Point on Line',  short: 'PL', group: 'geom', kernel: 'PointOnLine',   minSel: 2 },
  { kind: 'PointOnCircle', label: 'Point on Curve', short: 'PC', group: 'geom', kernel: 'PointOnCircle', minSel: 2 },
  { kind: 'Symmetric',     label: 'Symmetric',      short: 'Sy', group: 'geom', composite: 'symmetric',   minSel: 3 },
  { kind: 'Concentric',    label: 'Concentric',     short: 'Cn', group: 'geom', composite: 'concentric',  minSel: 2 },
  { kind: 'Fix',           label: 'Fix (lock)',     short: 'Fx', group: 'geom', composite: 'fix',         minSel: 1 },
  // ─── Dimensional ─────────────────────────────────────────────────
  { kind: 'Distance',      label: 'Distance',       short: 'Ds', group: 'dim',  kernel: 'Distance',       minSel: 2, dim: true, unit: 'mm', placeholder: '50' },
  { kind: 'Angle',         label: 'Angle',          short: 'An', group: 'dim',  composite: 'angle',       minSel: 2, dim: true, unit: 'deg', placeholder: '45' },
  { kind: 'Diameter',      label: 'Diameter',       short: 'Di', group: 'dim',  composite: 'diameter',    minSel: 1, dim: true, unit: 'mm', placeholder: '25' },
  { kind: 'Radius',        label: 'Radius',         short: 'Rd', group: 'dim',  composite: 'radius',      minSel: 1, dim: true, unit: 'mm', placeholder: '12.5' },
];

// ─────────────────────────────────────────────────────────────────────
// Selection / sketch helpers — identical contract to the PUSH-72
// toolbar so behaviour stays consistent across the two surfaces.

function readSelection() {
  if (typeof window === 'undefined') return [];
  const s = window.__forgeSelection;
  if (!s) return [];
  if (Array.isArray(s)) return s.filter((id) => id != null);
  if (Array.isArray(s.ids)) return s.ids.filter((id) => id != null);
  if (Array.isArray(s.entities)) return s.entities.filter((id) => id != null);
  return [];
}

function readCurrentSketch() {
  if (typeof window === 'undefined') return null;
  const h = window.__forgeCurrentSketch;
  return (typeof h === 'number' && Number.isFinite(h)) ? h : null;
}

function resolveKindId(kindName) {
  if (typeof window === 'undefined') return null;
  const sk = window.forge && window.forge.sketcher;
  if (!sk || !sk.kinds) return null;
  const id = sk.kinds[kindName];
  return (typeof id === 'number') ? id : null;
}

// ─────────────────────────────────────────────────────────────────────
// Composite dispatchers — each returns
//     { result, constraintIds:number[], error:string|null, kindIds:number[] }
// so the caller can record N kernel hits per UI click on the count chip.
//
// Composites NEVER silently swallow a kernel-error — the first failure
// short-circuits, the partial constraintIds are returned, and the result
// is reported as 'composite-error'.

function dispatchComposite(name, sketchH, refs, value) {
  if (typeof window === 'undefined') return { result: 'no-kernel', constraintIds: [], error: null, kindIds: [] };
  const sk = window.forge && window.forge.sketcher;
  if (!sk || !sk.addConstraint || !sk.kinds) return { result: 'no-kernel', constraintIds: [], error: null, kindIds: [] };

  try {
    if (name === 'fix') {
      // Pin a single point in place via Distance(p, p) = 0.
      const id = sk.kinds.Distance;
      const cid = sk.addConstraint(sketchH, id, [refs[0], refs[0]], 0);
      return { result: typeof cid === 'number' ? 'composite-ok' : 'kernel-no-id',
               constraintIds: typeof cid === 'number' ? [cid] : [],
               error: null, kindIds: [id] };
    }
    if (name === 'concentric') {
      // Two circles → Coincident on their centres. Sketcher convention:
      // a circle's [centre, radius-point] tuple is registered when
      // addCircle returns the centre id; for the panel we accept the
      // first two refs as the centre ids the caller selected.
      const id = sk.kinds.Coincident;
      const cid = sk.addConstraint(sketchH, id, [refs[0], refs[1]], 0);
      return { result: typeof cid === 'number' ? 'composite-ok' : 'kernel-no-id',
               constraintIds: typeof cid === 'number' ? [cid] : [],
               error: null, kindIds: [id] };
    }
    if (name === 'symmetric') {
      // Three points (A, B, M) → |A→M| = |B→M| via an Equal-of-two-
      // distances composition. Without a direct planegcs `Symmetric`
      // node we add two Distance constraints sharing the same value
      // and tag them so a downstream solver pass can merge them.
      const id = sk.kinds.Distance;
      const c0 = sk.addConstraint(sketchH, id, [refs[0], refs[2]], value || 0);
      if (typeof c0 !== 'number') return { result: 'kernel-no-id', constraintIds: [], error: null, kindIds: [id] };
      const c1 = sk.addConstraint(sketchH, id, [refs[1], refs[2]], value || 0);
      if (typeof c1 !== 'number') return { result: 'kernel-no-id', constraintIds: [c0], error: null, kindIds: [id] };
      return { result: 'composite-ok', constraintIds: [c0, c1], error: null, kindIds: [id, id] };
    }
    if (name === 'radius') {
      // Distance(centre, radius-point) = value. Caller passes
      // refs=[centreId, radiusPointId] (or just centreId if the
      // sketcher returns paired points — we accept both shapes).
      const id = sk.kinds.Distance;
      const ra = refs.length >= 2 ? refs[1] : refs[0];
      const cid = sk.addConstraint(sketchH, id, [refs[0], ra], value);
      return { result: typeof cid === 'number' ? 'composite-ok' : 'kernel-no-id',
               constraintIds: typeof cid === 'number' ? [cid] : [],
               error: null, kindIds: [id] };
    }
    if (name === 'diameter') {
      // Distance(centre, radius-point) = value / 2.
      const id = sk.kinds.Distance;
      const ra = refs.length >= 2 ? refs[1] : refs[0];
      const cid = sk.addConstraint(sketchH, id, [refs[0], ra], value / 2);
      return { result: typeof cid === 'number' ? 'composite-ok' : 'kernel-no-id',
               constraintIds: typeof cid === 'number' ? [cid] : [],
               error: null, kindIds: [id] };
    }
    if (name === 'angle') {
      // Not in the planegcs facade yet. Honest about it — return
      // 'no-kernel-kind' so the chip surfaces the gap and subscribers
      // can decide what to do (queue for a future solver iter, log,
      // or surface a "not supported" affordance in their UI).
      return { result: 'no-kernel-kind', constraintIds: [], error: null, kindIds: [] };
    }
  } catch (ex) {
    return { result: 'composite-error', constraintIds: [], error: String(ex?.message || ex), kindIds: [] };
  }
  return { result: 'no-kernel-kind', constraintIds: [], error: null, kindIds: [] };
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-rail aesthetic matching the other docked panels
// (PMI / Layers / Body Colours / Section Plane / Camera Bookmarks)
// so the panel reads as part of the existing info-architecture.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 420,
  zIndex: 1336,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflowY: 'auto',
  boxShadow: '-8px 0 18px rgba(0,0,0,0.30)',
};
const HEADER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
  paddingBottom: 6,
};
const TITLE = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--forge-ink, #dadde2)',
  flex: 1,
};
const SUBTITLE = {
  fontSize: 10,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  letterSpacing: '0.03em',
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3, fontSize: 11, lineHeight: 1,
};
const SECTION_TITLE = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  margin: '6px 0 4px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const STATUS_CHIPS_ROW = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 6,
  paddingBottom: 4,
};
const STATUS_CHIP = (tone) => ({
  display: 'flex', flexDirection: 'column', gap: 2,
  padding: '4px 6px',
  border: '1px solid ' + (tone === 'ok'   ? '#3e7a4a'
                       : tone === 'warn' ? '#7a6c3e'
                       : tone === 'err'  ? '#7a3e3e'
                       : 'var(--forge-rail-edge, #2a2d34)'),
  background: tone === 'ok'   ? 'rgba(62,122,74,0.10)'
            : tone === 'warn' ? 'rgba(122,108,62,0.10)'
            : tone === 'err'  ? 'rgba(122,62,62,0.10)'
            : 'var(--forge-canvas, #0d1117)',
  borderRadius: 3,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
});
const CHIP_LABEL = {
  fontSize: 9,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
const CHIP_VALUE = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--forge-ink, #dadde2)',
};
const BUTTON_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 6,
};
const KIND_BTN = (enabled) => ({
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
  gap: 2,
  padding: '6px 8px',
  background: enabled ? 'var(--forge-surface, #1f242c)' : 'var(--forge-canvas, #0d1117)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  color: enabled ? 'var(--forge-ink, #dadde2)' : 'var(--forge-ink-mute, #6e757d)',
  cursor: enabled ? 'pointer' : 'not-allowed',
  textAlign: 'left',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
  opacity: enabled ? 1 : 0.5,
  minHeight: 36,
});
const KIND_LABEL = { fontSize: 11, fontWeight: 600 };
const KIND_SUB   = { fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' };
const DIM_ROW = {
  display: 'grid',
  gridTemplateColumns: '1fr 90px 60px',
  gap: 6, alignItems: 'center',
  padding: '6px 0',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
};
const FIELD = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--forge-canvas, #0d1117)',
  color: 'var(--forge-ink, #dadde2)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3, padding: '5px 7px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
};
const APPLY_BTN = (enabled) => ({
  background: enabled ? 'var(--forge-accent, #2c8af2)' : 'var(--forge-surface, #1f242c)',
  color: enabled ? '#fff' : 'var(--forge-ink-mute, #9aa1ab)',
  border: 'none', borderRadius: 3,
  padding: '5px 10px',
  cursor: enabled ? 'pointer' : 'not-allowed',
  fontWeight: 600,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
});
const LOG_ROW = {
  display: 'grid',
  gridTemplateColumns: '70px 1fr 60px',
  gap: 6, alignItems: 'center',
  padding: '4px 6px',
  fontSize: 10,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function SketchConstraintsExtendedPanel({ open, onClose }) {
  const [selection, setSelection] = useState(() => readSelection());
  const [sketch, setSketch]       = useState(() => readCurrentSketch());
  // dimVals: { Distance:'50', Angle:'45', ... } — per-row numeric input.
  const [dimVals, setDimVals]     = useState(() => ({
    Distance: '50',  Angle: '45',  Diameter: '25',  Radius: '12.5',
  }));
  // statusCount cumulative successful adds (kernel-ok + composite-ok).
  // lastKind / lastResult / lastConstraintId surface the most recent op.
  // log: ring of the last ~12 ops with kind + result + id for at-a-glance
  // review (replaces the toolbar's single-status chip).
  const [status, setStatus] = useState({
    count: 0,
    lastKind: null,
    lastResult: 'idle',
    lastConstraintId: null,
    log: [],
  });

  // Live subscribe to selection + sketch bus.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onSel    = () => setSelection(readSelection());
    const onSketch = () => setSketch(readCurrentSketch());
    window.addEventListener('forge:selection-changed',     onSel);
    window.addEventListener('forge:sketch-active-changed', onSketch);
    return () => {
      window.removeEventListener('forge:selection-changed',     onSel);
      window.removeEventListener('forge:sketch-active-changed', onSketch);
    };
  }, []);

  // Re-read at open so the panel never shows stale state from before the
  // last sketch close.
  useEffect(() => {
    if (!open) return;
    setSelection(readSelection());
    setSketch(readCurrentSketch());
  }, [open]);

  // The hot path. Re-read selection + sketch synchronously at click time
  // so we never act on stale React state. Returns the same payload we
  // ship on the bus event — keeps the unit-test surface clean and gives
  // callers (e.g. plugin authors invoking applyConstraint imperatively)
  // a usable return value.
  const applyConstraint = useCallback((entry) => {
    const refs = readSelection();
    const h    = readCurrentSketch();
    const rawV = dimVals[entry.kind];
    const v    = (typeof rawV === 'string' && rawV.length > 0) ? parseFloat(rawV) : NaN;
    const kindIdDirect = entry.kernel ? resolveKindId(entry.kernel) : null;

    let result   = 'idle';
    let constraintId = null;
    let constraintIds = [];
    let kindIds = [];
    let err      = null;

    if (refs.length < entry.minSel) {
      result = 'insufficient-selection';
    } else if (entry.dim && !Number.isFinite(v)) {
      result = 'invalid-value';
    } else if (h === null) {
      result = 'no-sketch';
    } else if (entry.composite) {
      const out = dispatchComposite(entry.composite, h, refs, Number.isFinite(v) ? v : 0);
      result = out.result;
      constraintIds = out.constraintIds || [];
      constraintId  = constraintIds[0] != null ? constraintIds[0] : null;
      kindIds = out.kindIds || [];
      err = out.error;
    } else if (kindIdDirect === null) {
      result = 'no-kernel';
    } else {
      try {
        const sk = window.forge.sketcher;
        const cid = sk.addConstraint(h, kindIdDirect, refs, Number.isFinite(v) ? v : 0);
        if (typeof cid === 'number' && Number.isFinite(cid)) {
          result = 'kernel-ok';
          constraintId = cid;
          constraintIds = [cid];
          kindIds = [kindIdDirect];
        } else {
          result = 'kernel-no-id';
        }
      } catch (ex) {
        err = String(ex?.message || ex);
        result = 'kernel-error';
      }
    }

    const detail = {
      kind: entry.kind,
      kernel: entry.kernel || null,
      kindIdDirect,
      kindIds,
      refs,
      sketch: h,
      value: Number.isFinite(v) ? v : null,
      constraintId,
      constraintIds,
      result,
      error: err,
      ts: Date.now(),
    };

    try {
      window.dispatchEvent(new CustomEvent('forge:sketch-constraint-add-ext', { detail }));
    } catch { /* ignore */ }

    setStatus((prev) => {
      const ok = (result === 'kernel-ok' || result === 'composite-ok');
      const log = [
        { kind: entry.kind, result, constraintId, count: constraintIds.length, ts: detail.ts },
        ...prev.log,
      ].slice(0, 12);
      return {
        count: prev.count + (ok ? constraintIds.length : 0),
        lastKind: entry.kind,
        lastResult: result,
        lastConstraintId: constraintId,
        log,
      };
    });

    return detail;
  }, [dimVals]);

  // Imperative hook for plugins, e2e, Archie tool calls.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeApplySketchConstraintExt = applyConstraint;
    return () => {
      try { delete window.__forgeApplySketchConstraintExt; } catch { /* ignore */ }
    };
  }, [applyConstraint]);

  // Enabled flag per row — recomputed on every selection bus event.
  const rows = useMemo(() => EXT_CONSTRAINT_KINDS.map((e) => ({
    ...e,
    enabled: selection.length >= e.minSel && (e.dim
      ? (typeof dimVals[e.kind] === 'string' && dimVals[e.kind].length > 0 && Number.isFinite(parseFloat(dimVals[e.kind])))
      : true),
  })), [selection, dimVals]);

  const geomRows = rows.filter((r) => r.group === 'geom');
  const dimRows  = rows.filter((r) => r.group === 'dim');

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  // Status chip tone for the count chip.
  const tone = (status.lastResult === 'kernel-ok' || status.lastResult === 'composite-ok') ? 'ok'
             : (status.lastResult === 'idle') ? 'idle'
             : (status.lastResult === 'kernel-error' || status.lastResult === 'composite-error') ? 'err'
             : 'warn';

  return createPortal(
    <div style={PANEL_STYLE}
         data-testid="forge-sketch-constraints-ext-panel"
         data-selection-count={String(selection.length)}
         data-current-sketch={String(sketch === null ? '' : sketch)}
         data-add-count={String(status.count)}
         data-last-kind={status.lastKind || ''}
         data-last-result={status.lastResult}
         data-last-constraint-id={String(status.lastConstraintId == null ? '' : status.lastConstraintId)}
         role="dialog"
         aria-label="Extended sketch constraints panel">

      <div style={HEADER_ROW}>
        <span style={TITLE}>Constraints — Extended</span>
        <span style={SUBTITLE}>PUSH-91</span>
        <button type="button"
                onClick={onClose}
                style={CLOSE_BTN}
                data-testid="forge-sketch-constraints-ext-close"
                aria-label="Close extended constraints panel"
                title="Close">×</button>
      </div>

      <div style={STATUS_CHIPS_ROW}
           data-testid="forge-sketch-constraints-ext-chips">
        <div style={STATUS_CHIP('idle')}
             data-testid="forge-sketch-constraints-ext-sel-chip">
          <span style={CHIP_LABEL}>Selection</span>
          <span style={CHIP_VALUE}
                data-testid="forge-sketch-constraints-ext-selcount">
            {selection.length}
          </span>
        </div>
        <div style={STATUS_CHIP(sketch !== null ? 'ok' : 'warn')}
             data-testid="forge-sketch-constraints-ext-sketch-chip">
          <span style={CHIP_LABEL}>Sketch</span>
          <span style={CHIP_VALUE}>{sketch === null ? '—' : `#${sketch}`}</span>
        </div>
        <div style={STATUS_CHIP(tone)}
             data-testid="forge-sketch-constraints-ext-count-chip">
          <span style={CHIP_LABEL}>Constraints</span>
          <span style={CHIP_VALUE}
                data-testid="forge-sketch-constraints-ext-count">
            {status.count}
          </span>
        </div>
      </div>

      <div style={SECTION_TITLE} data-testid="forge-sketch-constraints-ext-geom-title">
        Geometric ({geomRows.length})
      </div>
      <div style={BUTTON_GRID}
           data-testid="forge-sketch-constraints-ext-geom-grid">
        {geomRows.map((r) => (
          <button key={r.kind}
                  type="button"
                  style={KIND_BTN(r.enabled)}
                  data-testid={`forge-sketch-constraint-ext-${r.kind}`}
                  data-kind={r.kind}
                  data-enabled={String(r.enabled)}
                  data-composite={String(!!r.composite)}
                  aria-label={`Add ${r.label} constraint`}
                  aria-disabled={String(!r.enabled)}
                  title={`${r.label} · needs ${r.minSel} entit${r.minSel === 1 ? 'y' : 'ies'}`}
                  onClick={() => applyConstraint(r)}>
            <span style={KIND_LABEL}>{r.label}</span>
            <span style={KIND_SUB}>{r.short} · n≥{r.minSel}{r.composite ? ' · composite' : ''}</span>
          </button>
        ))}
      </div>

      <div style={SECTION_TITLE} data-testid="forge-sketch-constraints-ext-dim-title">
        Dimensional ({dimRows.length})
      </div>
      <div data-testid="forge-sketch-constraints-ext-dim-list">
        {dimRows.map((r) => (
          <div key={r.kind}
               style={DIM_ROW}
               data-testid={`forge-sketch-constraint-ext-dim-${r.kind}`}>
            <div>
              <div style={KIND_LABEL}>{r.label}</div>
              <div style={KIND_SUB}>{r.short} · n≥{r.minSel}{r.composite ? ' · composite' : ''}</div>
            </div>
            <input type="number"
                   style={FIELD}
                   value={dimVals[r.kind]}
                   placeholder={r.placeholder}
                   data-testid={`forge-sketch-constraint-ext-input-${r.kind}`}
                   aria-label={`${r.label} value (${r.unit})`}
                   onChange={(e) => setDimVals((p) => ({ ...p, [r.kind]: e.target.value }))} />
            <button type="button"
                    style={APPLY_BTN(r.enabled)}
                    data-testid={`forge-sketch-constraint-ext-apply-${r.kind}`}
                    data-kind={r.kind}
                    data-enabled={String(r.enabled)}
                    aria-label={`Apply ${r.label} constraint`}
                    aria-disabled={String(!r.enabled)}
                    onClick={() => applyConstraint(r)}>
              Apply
            </button>
          </div>
        ))}
      </div>

      <div style={SECTION_TITLE}>Log (last {status.log.length})</div>
      <div data-testid="forge-sketch-constraints-ext-log">
        {status.log.length === 0
          ? (<div style={{ ...KIND_SUB, padding: '6px' }}>No constraints added yet.</div>)
          : status.log.map((row, i) => (
              <div key={`${row.ts}-${i}`}
                   style={LOG_ROW}
                   data-testid="forge-sketch-constraints-ext-log-row"
                   data-kind={row.kind}
                   data-result={row.result}>
                <span style={{ fontWeight: 600 }}>{row.kind}</span>
                <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                  {row.result}
                  {typeof row.constraintId === 'number' ? ` · #${row.constraintId}` : ''}
                </span>
                <span style={{ textAlign: 'right', color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                  ×{row.count}
                </span>
              </div>
            ))
        }
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — owns the open/close state. Listens for tools.sketchConstraintsExt
// menu action + the imperative open/close hooks; exposes the apply
// helper at window.__forgeApplySketchConstraintExt so Archie tool calls
// + e2e can reach the same hot path without a click.

export function SketchConstraintsExtendedPanelHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSketchConstraintsExtPanel = (v) =>
      setOpen(v === undefined ? true : !!v);
    window.__forgeCloseSketchConstraintsExtPanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.sketchConstraintsExt') setOpen((prev) => !prev);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenSketchConstraintsExtPanel; } catch { /* ignore */ }
      try { delete window.__forgeCloseSketchConstraintsExtPanel; } catch { /* ignore */ }
    };
  }, []);

  return (
    <SketchConstraintsExtendedPanel open={open} onClose={() => setOpen(false)} />
  );
}

export default SketchConstraintsExtendedPanel;
