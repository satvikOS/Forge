// PUSH-89 (Slice-57 / Variable-radius fillet panel — UI-side intent + spliced constant fillet).
//
// OCCT's BRepFilletAPI_MakeFillet::Add(Law_Function) supports a true
// variable-radius fillet — pass a parametric radius law `r(u)` along the
// edge and the kernel evolves the rolling-ball radius as `u` traverses
// [0, 1]. The C++ binding `forge.part.variableFilletEdge(handle, edgeId,
// [{u, r}…])` does exist, but the PUSH-89 brief is explicit: this slice
// ships the *UI surface* without touching the C++ kernel, so we
// approximate the operation as a "spliced" fillet — record the user's
// (t, r) intent table, average the radii, and call the existing
// `forge.part.filletEdges(handle, [edgeId], r_avg)` constant-radius op.
// The full (t, r) profile is published on `window.__forgeVariableFilletProfile`
// so a future kernel-binding slice can read the intent table back out
// and re-apply it through the real OCCT API without changing the panel.
//
// Panel surfaces:
//   • Body picker (auto-selects the active native body — same fallback
//     ladder MassProps / DirectEditTranslate use).
//   • Edge picker — wired to `window.__forgeSelection` (kind === 'edge'),
//     with a "Use current edge" button that captures the current pick
//     and a manual numeric edgeId input so you can drive the panel from
//     a headless e2e without simulating a viewport click.
//   • Profile table — rows of `{ t, r }` where `t ∈ [0, 1]` is the
//     parametric position along the edge and `r` is the radius in mm.
//     Defaults: t=0/r=1, t=0.5/r=3, t=1/r=1 (the brief's headline shape:
//     thin at both ends, fat in the middle).
//   • Add / Remove row buttons. Apply enabled only when ≥ 2 valid rows,
//     a body is picked, and an edgeId is set.
//   • A tiny inline SVG radius-curve preview that visualises the profile
//     above the table — makes the "variable" intent visually distinct
//     from a constant fillet.
//
// Apply path:
//   1. Sort the profile rows by t (ascending). Clamp t to [0, 1].
//   2. Compute r_avg = arithmetic mean of all row radii.
//   3. Call `window.forge.part.filletEdges(handle, [edgeId], r_avg)` →
//      receives a fresh handle for the filleted body.
//   4. Replace the source body's entry in `window.__forgeBodies` with
//      the new handle via `window.__forgeSetBodies`. The Variable Fillet
//      lineage entry records `{ feature: 'variableFillet', edgeId,
//      profile: [{t, r}…], appliedRadius: r_avg, intent: 'variable' }`
//      so the feature tree / drawings / Archie can call out the variable
//      intent even though the OCCT shape is a constant fillet for now.
//   5. Publish `window.__forgeVariableFilletProfile = { bodyId, edgeId,
//      profile, appliedRadius, when }` and dispatch the bus event
//      `forge:variable-fillet-applied` for plugins / Archie / e2e.
//
// Channel contract:
//   window.__forgeVariableFilletProfile : {
//     bodyId   : string,        // the source body's stable id
//     handle   : number,        // the NEW filleted body's handle
//     edgeId   : number,        // the user-picked edge id
//     profile  : Array<{t:number, r:number}>,
//     appliedRadius : number,   // the averaged radius actually applied
//     when     : number,        // Date.now() of the apply
//   }
//
// Hard constraints (PUSH-89 brief):
//   • NO new npm / C++ / external deps — pure React + the existing
//     window.__forge* surface + the kernel's constant-radius filletEdges.
//   • NO C++ kernel changes — the average-radius splice is a deliberate
//     stand-in; a future slice can swap the apply path to
//     `forge.part.variableFilletEdge` without changing this panel.
//   • Surgical edits to Menus.jsx (one new tools.variableFillet entry) +
//     App.jsx (one import + one mount).
//   • Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants — bus event name, menu action id, channel global key,
// default profile shape. Kept in sync with the PUSH-71/73/80/82 naming
// pattern so the Activity Log / DiagnosticDump pick the events up.

export const FORGE_VARIABLE_FILLET_EVENT = 'forge:variable-fillet-applied';
export const FORGE_VARIABLE_FILLET_MENU_ID = 'tools.variableFillet';
export const FORGE_VARIABLE_FILLET_GLOBAL = '__forgeVariableFilletProfile';

// Default profile — t=0/r=1, t=0.5/r=3, t=1/r=1 (thin → fat → thin).
// Matches the brief's worked example.
export const DEFAULT_PROFILE = Object.freeze([
  Object.freeze({ t: 0,    r: 1 }),
  Object.freeze({ t: 0.5,  r: 3 }),
  Object.freeze({ t: 1,    r: 1 }),
]);

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — exported so e2e / Archie tool calls / plugins can
// drive the same logic without mounting the React panel first.

/** Snapshot every native (kernel-backed) body in the scene. Same filter
 *  the MassProps / EntityProps / DirectEditTranslate panels use. */
export function readNativeBodies() {
  if (typeof window === 'undefined') return [];
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return all.filter(
    (b) => b && b.kind === 'native' && typeof b.handle === 'number',
  );
}

/** Resolve the active native body for the panel's initial pick. Mirrors
 *  the MassPropsPanel.activeBody / DirectEditTranslatePanel ladder:
 *  selection.bodyHandle → selection.ids[0] → last native body. */
export function activeNativeBody() {
  const native = readNativeBodies();
  if (native.length === 0) return null;
  if (typeof window === 'undefined') return native[native.length - 1];
  const sel = window.__forgeSelection || null;
  if (sel && typeof sel.bodyHandle === 'number') {
    const m = native.find((b) => b.handle === sel.bodyHandle);
    if (m) return m;
  }
  if (sel && Array.isArray(sel.ids) && typeof sel.ids[0] === 'number') {
    const m = native.find((b) => b.handle === sel.ids[0]);
    if (m) return m;
  }
  return native[native.length - 1];
}

/** Pull the currently-selected edgeId off `window.__forgeSelection`.
 *  Returns `null` if the selection is not an edge or has no edgeId. */
export function activeEdgeId() {
  if (typeof window === 'undefined') return null;
  const sel = window.__forgeSelection;
  if (!sel || typeof sel !== 'object') return null;
  if (sel.kind !== 'edge') return null;
  if (typeof sel.edgeId !== 'number') return null;
  return sel.edgeId;
}

/** Sort the profile by t ascending and clamp every t into [0, 1]. */
export function sortProfile(profile) {
  if (!Array.isArray(profile)) return [];
  const cleaned = [];
  for (const row of profile) {
    if (!row || typeof row !== 'object') continue;
    const t = Number(row.t);
    const r = Number(row.r);
    if (!Number.isFinite(t) || !Number.isFinite(r)) continue;
    if (r <= 0) continue;
    cleaned.push({ t: Math.min(1, Math.max(0, t)), r });
  }
  cleaned.sort((a, b) => a.t - b.t);
  return cleaned;
}

/** Arithmetic mean of every row's radius. Empty profile → 0. */
export function averageRadius(profile) {
  if (!Array.isArray(profile) || profile.length === 0) return 0;
  let sum = 0; let n = 0;
  for (const row of profile) {
    const r = Number(row?.r);
    if (Number.isFinite(r) && r > 0) { sum += r; n += 1; }
  }
  return n > 0 ? sum / n : 0;
}

/** Sample the (t, r) profile at `t ∈ [0, 1]` using piecewise-linear
 *  interpolation between the sorted control points. Used by the
 *  preview curve renderer + future kernel-binding consumers. */
export function sampleProfile(profile, t) {
  const sorted = sortProfile(profile);
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0].r;
  const clamped = Math.min(1, Math.max(0, Number(t) || 0));
  if (clamped <= sorted[0].t) return sorted[0].r;
  const last = sorted[sorted.length - 1];
  if (clamped >= last.t) return last.r;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i]; const b = sorted[i + 1];
    if (clamped >= a.t && clamped <= b.t) {
      const span = b.t - a.t;
      if (span <= 0) return a.r;
      const f = (clamped - a.t) / span;
      return a.r + (b.r - a.r) * f;
    }
  }
  return last.r;
}

/** Apply the spliced variable fillet. Returns
 *  `{ ok, newHandle, appliedRadius, profile }` on success, or
 *  `{ ok: false, error }` on failure. */
export function applyVariableFillet(body, edgeId, profile) {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (!body || typeof body.handle !== 'number' || typeof body.id !== 'string') {
    return { ok: false, error: 'body missing handle/id' };
  }
  if (typeof edgeId !== 'number' || !Number.isFinite(edgeId) || edgeId < 0) {
    return { ok: false, error: 'edgeId must be a non-negative integer' };
  }
  const sorted = sortProfile(profile);
  if (sorted.length < 2) {
    return { ok: false, error: 'profile needs at least 2 valid (t, r) rows' };
  }
  const radius = averageRadius(sorted);
  if (!Number.isFinite(radius) || radius <= 0) {
    return { ok: false, error: 'computed average radius is non-positive' };
  }
  const fn = window.forge?.part?.filletEdges;
  if (typeof fn !== 'function') {
    return { ok: false, error: 'forge.part.filletEdges unavailable' };
  }
  let newHandle;
  try {
    newHandle = fn(body.handle, [edgeId], radius);
  } catch (err) {
    return { ok: false, error: `kernel filletEdges threw: ${err?.message || err}` };
  }
  if (typeof newHandle !== 'number' || newHandle <= 0) {
    return { ok: false, error: `kernel filletEdges returned bad handle ${newHandle}` };
  }
  // Replace the source body in the scene. Same lineage convention as
  // ForgeShellV4's REPLACE_LAST path for solid.fillet — keep id + name,
  // swap the handle, and record the variable-fillet intent on the body.
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  const next = bodies.map((b) => (b && b.id === body.id)
    ? {
        ...b,
        handle: newHandle,
        toolId: 'solid.variableFillet',
        params: {
          ...(b.params || {}),
          edgeId,
          profile: sorted.map((p) => ({ t: p.t, r: p.r })),
          appliedRadius: radius,
          intent: 'variable',
        },
      }
    : b);
  if (typeof window.__forgeSetBodies === 'function') {
    window.__forgeSetBodies(next);
  }
  // Keep the live mirror consistent for subscribers that poll the global.
  try { window.__forgeBodies = next; } catch {}
  // Publish the profile channel + the bus event. The channel global
  // lives on the window so the future kernel-binding slice can read the
  // intent table without re-deriving it.
  const payload = {
    bodyId: body.id,
    handle: newHandle,
    edgeId,
    profile: sorted.map((p) => ({ t: p.t, r: p.r })),
    appliedRadius: radius,
    when: Date.now(),
  };
  try { window[FORGE_VARIABLE_FILLET_GLOBAL] = payload; } catch {}
  try {
    window.dispatchEvent(new CustomEvent(FORGE_VARIABLE_FILLET_EVENT, {
      detail: payload,
    }));
  } catch { /* CustomEvent is universal in Electron */ }
  try {
    window.dispatchEvent(new CustomEvent('forge:bodies-changed', {
      detail: { bodies: next },
    }));
  } catch {}
  return { ok: true, newHandle, appliedRadius: radius, profile: payload.profile };
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail matching BatchRenamePanel / MassPropsPanel.
// 440 px wide so the (t, r) table + preview curve + body picker all fit
// without horizontal scroll.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 440,
  zIndex: 1332,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'hidden',
};
const HEADER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  margin: '8px 0 4px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const ROW = {
  display: 'flex', alignItems: 'center', gap: 6,
};
const LABEL = {
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  minWidth: 60,
};
const TEXT_INPUT = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px',
  borderRadius: 3,
  fontSize: 12,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  flex: 1,
  minWidth: 0,
};
const NUM_INPUT = {
  ...TEXT_INPUT,
  flex: 'none',
  width: 70,
  textAlign: 'right',
};
const SELECT_INPUT = {
  ...TEXT_INPUT,
  appearance: 'none',
};
const ACTION_BTN = (variant = 'default') => ({
  background: variant === 'primary'
    ? 'var(--forge-accent, #4f87ff)'
    : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: variant === 'primary' ? '#fff' : 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  padding: '5px 12px',
  borderRadius: 3,
  fontSize: 11,
  fontWeight: variant === 'primary' ? 600 : 400,
});
const TABLE_HEAD = {
  display: 'grid',
  gridTemplateColumns: '32px 1fr 1fr 28px',
  alignItems: 'center',
  gap: 6,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: '4px 0',
};
const TABLE_ROW = {
  display: 'grid',
  gridTemplateColumns: '32px 1fr 1fr 28px',
  alignItems: 'center',
  gap: 6,
  padding: '4px 0',
};
const REMOVE_BTN = (enabled) => ({
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: enabled ? 'var(--forge-ink, #dadde2)' : 'var(--forge-ink-mute, #9aa1ab)',
  cursor: enabled ? 'pointer' : 'not-allowed',
  padding: '2px 5px',
  borderRadius: 3,
  fontSize: 11,
  opacity: enabled ? 1 : 0.45,
});

// ─────────────────────────────────────────────────────────────────────
// SVG radius-curve preview. Plots the sampled radius vs t on an
// 80-sample line. Makes the "variable" intent visually distinct from a
// constant-radius fillet — the user sees the curve update live as they
// edit the table.

function RadiusCurvePreview({ profile }) {
  const W = 400;
  const H = 80;
  const PAD = 8;
  const samples = 81;
  const sorted = useMemo(() => sortProfile(profile), [profile]);
  const rMax = useMemo(() => {
    if (sorted.length === 0) return 1;
    let m = 0;
    for (const p of sorted) if (p.r > m) m = p.r;
    return m > 0 ? m : 1;
  }, [sorted]);

  const pts = useMemo(() => {
    if (sorted.length === 0) return '';
    const out = [];
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      const r = sampleProfile(sorted, t);
      const x = PAD + t * (W - PAD * 2);
      // Invert Y — r grows upward visually.
      const y = (H - PAD) - (r / rMax) * (H - PAD * 2);
      out.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return out.join(' ');
  }, [sorted, rMax]);

  return (
    <svg width={W} height={H}
         data-testid="forge-varfillet-curve"
         data-r-max={rMax.toFixed(3)}
         style={{
           display: 'block',
           background: 'var(--forge-canvas-1, #0e1218)',
           border: '1px solid var(--forge-rail-edge, #2a2d34)',
           borderRadius: 3,
         }}>
      {/* Axis baseline at the bottom. */}
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD}
            stroke="var(--forge-rail-edge, #2a2d34)" strokeWidth="1" />
      {/* Gridline at mid-height. */}
      <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2}
            stroke="var(--forge-rail-edge, #2a2d34)" strokeWidth="0.5"
            strokeDasharray="2 3" />
      {/* The sampled radius curve. */}
      <polyline points={pts} fill="none"
                stroke="var(--forge-accent, #4f87ff)" strokeWidth="1.5" />
      {/* Control-point dots. */}
      {sorted.map((p, i) => {
        const x = PAD + p.t * (W - PAD * 2);
        const y = (H - PAD) - (p.r / rMax) * (H - PAD * 2);
        return (
          <circle key={i} cx={x} cy={y} r="3"
                  fill="var(--forge-accent, #4f87ff)"
                  stroke="var(--forge-ink, #dadde2)" strokeWidth="0.5"
                  data-testid={`forge-varfillet-control-${i}`} />
        );
      })}
      {/* r_max label top-right. */}
      <text x={W - PAD} y={PAD + 8} textAnchor="end"
            style={{ font: '9px var(--forge-mono, ui-monospace, monospace)',
                     fill: 'var(--forge-ink-mute, #9aa1ab)' }}>
        r_max = {rMax.toFixed(2)} mm
      </text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function VariableFilletPanel({ open, onClose }) {
  const [bodies, setBodies] = useState(() => readNativeBodies());
  const [bodyId, setBodyId] = useState(() => activeNativeBody()?.id || '');
  const [edgeId, setEdgeId] = useState(() => activeEdgeId() ?? 0);
  const [profile, setProfile] = useState(() => DEFAULT_PROFILE.map((p) => ({ ...p })));
  const [toast, setToast] = useState(null);
  const [error, setError] = useState('');

  // Refresh bodies on open + listen for live scene churn / selection
  // changes while open.
  useEffect(() => {
    if (!open) return undefined;
    setBodies(readNativeBodies());
    const live = activeNativeBody();
    if (live) setBodyId(live.id);
    const liveEdge = activeEdgeId();
    if (liveEdge !== null) setEdgeId(liveEdge);
    setProfile(DEFAULT_PROFILE.map((p) => ({ ...p })));
    setToast(null);
    setError('');
    const onBodies = () => {
      setBodies(readNativeBodies());
    };
    const onSel = () => {
      const e = activeEdgeId();
      if (e !== null) setEdgeId(e);
    };
    window.addEventListener('forge:bodies-changed', onBodies);
    window.addEventListener('forge:selection-changed', onSel);
    return () => {
      window.removeEventListener('forge:bodies-changed', onBodies);
      window.removeEventListener('forge:selection-changed', onSel);
    };
  }, [open]);

  const body = useMemo(
    () => bodies.find((b) => b.id === bodyId) || null,
    [bodies, bodyId],
  );

  const setRow = useCallback((i, key, value) => {
    setProfile((prev) => prev.map((row, j) => (i === j
      ? { ...row, [key]: Number(value) }
      : row)));
  }, []);

  const addRow = useCallback(() => {
    setProfile((prev) => {
      // Default new row to t = midpoint between last two, r = last r.
      const last = prev[prev.length - 1] || { t: 1, r: 1 };
      const prevLast = prev[prev.length - 2] || { t: 0, r: 1 };
      const nextT = Math.min(1, Math.max(0, (last.t + prevLast.t) / 2));
      return [...prev, { t: nextT, r: last.r }];
    });
  }, []);

  const removeRow = useCallback((i) => {
    setProfile((prev) => {
      if (prev.length <= 2) return prev; // keep at least 2 rows
      return prev.filter((_, j) => j !== i);
    });
  }, []);

  const captureEdgeFromSelection = useCallback(() => {
    const e = activeEdgeId();
    if (e !== null) setEdgeId(e);
  }, []);

  const sorted = useMemo(() => sortProfile(profile), [profile]);
  const rAvg = useMemo(() => averageRadius(sorted), [sorted]);

  const canApply = !!body
    && Number.isFinite(edgeId) && edgeId >= 0
    && sorted.length >= 2
    && rAvg > 0;

  const apply = useCallback(() => {
    setError('');
    setToast(null);
    const res = applyVariableFillet(body, Number(edgeId), profile);
    if (!res.ok) {
      setError(res.error || 'apply failed');
      return;
    }
    setToast({
      handle: res.newHandle,
      radius: res.appliedRadius,
      rows: res.profile.length,
      when: Date.now(),
    });
    setBodies(readNativeBodies());
  }, [body, edgeId, profile]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Variable-radius fillet"
         data-testid="forge-varfillet-panel"
         data-body-id={body?.id || ''}
         data-edge-id={Number.isFinite(edgeId) ? String(edgeId) : ''}
         data-row-count={sorted.length}
         data-avg-radius={rAvg.toFixed(4)}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="sketch.fillet" size={14} />
        <strong style={{ fontSize: 13 }}>Variable Fillet</strong>
        <span style={{
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          padding: '1px 6px',
          borderRadius: 'var(--forge-radius-pill, 10px)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}
              data-testid="forge-varfillet-radius-chip">
          r̄ = {rAvg.toFixed(2)} mm
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close variable fillet panel"
                data-testid="forge-varfillet-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={SECTION_TITLE}>Target</div>
      <div style={SECTION_BOX}>
        <div style={ROW}>
          <span style={LABEL}>Body</span>
          {bodies.length === 0 ? (
            <span data-testid="forge-varfillet-empty"
                  style={{
                    flex: 1,
                    fontStyle: 'italic',
                    color: 'var(--forge-ink-mute, #9aa1ab)',
                    fontSize: 11,
                  }}>
              No native bodies in the scene. Seed one first.
            </span>
          ) : (
            <select value={bodyId}
                    onChange={(e) => setBodyId(e.target.value)}
                    data-testid="forge-varfillet-body-select"
                    style={SELECT_INPUT}>
              {bodies.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || b.toolId || `handle ${b.handle}`}
                </option>
              ))}
            </select>
          )}
        </div>
        <div style={ROW}>
          <span style={LABEL}>Edge id</span>
          <input type="number" min="0" step="1"
                 value={Number.isFinite(edgeId) ? edgeId : 0}
                 onChange={(e) => {
                   const v = Number(e.target.value);
                   if (Number.isFinite(v)) setEdgeId(Math.max(0, Math.floor(v)));
                 }}
                 data-testid="forge-varfillet-edge-input"
                 style={NUM_INPUT} />
          <button type="button"
                  onClick={captureEdgeFromSelection}
                  title="Capture the currently-selected edge id from window.__forgeSelection"
                  data-testid="forge-varfillet-capture-edge"
                  style={ACTION_BTN('default')}>
            Use current edge
          </button>
        </div>
      </div>

      <div style={SECTION_TITLE}>Radius curve</div>
      <RadiusCurvePreview profile={sorted} />

      <div style={SECTION_TITLE}>
        Profile ({sorted.length} {sorted.length === 1 ? 'point' : 'points'})
      </div>
      <div style={SECTION_BOX}>
        <div style={TABLE_HEAD}>
          <span>#</span>
          <span>t (0–1)</span>
          <span>r (mm)</span>
          <span />
        </div>
        {profile.map((row, i) => (
          <div key={i}
               style={TABLE_ROW}
               data-testid="forge-varfillet-row"
               data-row-index={i}
               data-row-t={String(row.t)}
               data-row-r={String(row.r)}>
            <span style={{
              fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
              fontSize: 10,
              color: 'var(--forge-ink-mute, #9aa1ab)',
              textAlign: 'right',
            }}>{i + 1}</span>
            <input type="number" step="0.05" min="0" max="1"
                   value={row.t}
                   onChange={(e) => setRow(i, 't', e.target.value)}
                   data-testid={`forge-varfillet-t-${i}`}
                   style={NUM_INPUT} />
            <input type="number" step="0.1" min="0"
                   value={row.r}
                   onChange={(e) => setRow(i, 'r', e.target.value)}
                   data-testid={`forge-varfillet-r-${i}`}
                   style={NUM_INPUT} />
            <button type="button"
                    onClick={() => removeRow(i)}
                    disabled={profile.length <= 2}
                    title={profile.length <= 2
                      ? 'Profile needs at least 2 rows'
                      : 'Remove this row'}
                    data-testid={`forge-varfillet-remove-${i}`}
                    style={REMOVE_BTN(profile.length > 2)}>
              −
            </button>
          </div>
        ))}
        <div style={{ ...ROW, marginTop: 4 }}>
          <button type="button"
                  onClick={addRow}
                  title="Append a new (t, r) row mid-way between the last two"
                  data-testid="forge-varfillet-add-row"
                  style={ACTION_BTN('default')}>
            + Add row
          </button>
        </div>
      </div>

      {error && (
        <div data-testid="forge-varfillet-error"
             style={{
               background: 'rgba(255, 100, 100, 0.12)',
               border: '1px solid #b04040',
               borderRadius: 3,
               padding: '6px 8px',
               color: '#f8c4c4',
               fontSize: 11,
             }}>
          {error}
        </div>
      )}

      <footer style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 0 0',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        {toast ? (
          <span data-testid="forge-varfillet-toast"
                style={{
                  fontSize: 11,
                  color: 'var(--forge-accent, #4f87ff)',
                }}>
            Applied · handle {toast.handle} · r̄ = {toast.radius.toFixed(2)} mm
            · {toast.rows} pts
          </span>
        ) : (
          <span style={{
            fontSize: 10,
            color: 'var(--forge-ink-mute, #9aa1ab)',
          }}>
            Apply runs filletEdges(handle, [edge], r̄). Profile mirrored on
            window.{FORGE_VARIABLE_FILLET_GLOBAL.replace('__forge', '__forge')}.
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={apply}
                disabled={!canApply}
                title={canApply
                  ? `Apply variable fillet (r̄ = ${rAvg.toFixed(2)} mm)`
                  : 'Pick a body + edge + at least 2 valid rows'}
                data-testid="forge-varfillet-apply"
                style={{
                  ...ACTION_BTN('primary'),
                  opacity: canApply ? 1 : 0.5,
                  cursor: canApply ? 'pointer' : 'not-allowed',
                }}>
          Apply
        </button>
      </footer>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for `tools.variableFillet` menu action, exposes the
// imperative open/close hooks, and mirrors the headless helpers on the
// window debug surface.

export function VariableFilletPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenVariableFilletPanel  = () => setOpen(true);
    window.__forgeCloseVariableFilletPanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === FORGE_VARIABLE_FILLET_MENU_ID) setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    window.__forgeVariableFilletHelper = Object.freeze({
      readNativeBodies,
      activeNativeBody,
      activeEdgeId,
      sortProfile,
      averageRadius,
      sampleProfile,
      applyVariableFillet,
      EVENT_NAME: FORGE_VARIABLE_FILLET_EVENT,
      GLOBAL_KEY: FORGE_VARIABLE_FILLET_GLOBAL,
      DEFAULT_PROFILE,
    });
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenVariableFilletPanel; } catch {}
      try { delete window.__forgeCloseVariableFilletPanel; } catch {}
    };
  }, []);
  return <VariableFilletPanel open={open} onClose={() => setOpen(false)} />;
}

export default VariableFilletPanel;
