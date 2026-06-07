// PUSH-130 (Slice-95) — REAL variable-radius fillet panel.
//
// PUSH-89 (Slice-57) shipped the *UI surface* for a (t, r) variable
// fillet but spliced the apply path through `forge.part.filletEdges`
// with the arithmetic-mean radius — every row in the table averaged
// into a single constant-radius rolling-ball fillet. The header on the
// VariableFilletPanel called this out as a deliberate stand-in awaiting
// a future kernel-binding slice.
//
// PUSH-130 is that follow-up slice. The C++ kernel binding
// `forge.part.variableFilletEdge(handle, edgeId, [{u, r}…])` has
// existed since Features.cpp:472; it wraps OCCT's
// `BRepFilletAPI_MakeFillet::Add(TColgp_Array1OfPnt2d, edge)` with the
// (u, r) law-function overload — i.e. the real variable-radius fillet
// that varies the rolling ball as `u` traverses the edge's parameter
// range. preload.js:1355 has been exposing it on the renderer all
// along (`window.forge.part.variableFilletEdge`). No C++ kernel rebuild
// needed; this slice is pure JS + preload wiring + UI.
//
// Panel surfaces (identical UX to PUSH-89 so the muscle-memory carries
// over — the change is in the apply path, not the form):
//   • Body picker (auto-selects the active native body — same fallback
//     ladder MassProps / DirectEditTranslate / PUSH-89 use).
//   • Edge picker — wired to `window.__forgeSelection` (kind === 'edge')
//     with a "Use current edge" button + manual numeric edgeId input.
//   • (t, r) profile table — rows of `{ t, r }` where `t ∈ [0, 1]` is the
//     parametric position along the edge and `r` is the radius in mm.
//     Defaults match the brief's worked example: t=0/r=1, t=0.5/r=5,
//     t=1/r=1 (thin → fat → thin, peak in the middle).
//   • Add / Remove row buttons. Apply enabled only when ≥ 2 valid rows,
//     a body is picked, and an edgeId is set.
//   • The same inline SVG radius-curve preview as PUSH-89 so the user
//     can see the law before it hits the kernel.
//
// Apply path (the difference from PUSH-89):
//   1. Sort the profile rows by t (ascending). Clamp t to [0, 1].
//   2. Build the anchor array `[{u: t, r}, …]` straight from the sorted
//      profile — no averaging, no splice. Pass it to
//      `window.forge.part.variableFilletEdge(handle, edgeId, anchors)`.
//   3. Receive a fresh kernel handle for the variably-filleted body.
//   4. Replace the source body's entry in `window.__forgeBodies` with
//      the new handle via `window.__forgeSetBodies`. The Real Variable
//      Fillet lineage entry stamps `toolId: 'solid.realVariableFillet'`
//      with `{ feature, edgeId, profile, anchorCount, intent: 'realVariable' }`
//      params so the feature tree / drawings / Archie / PUSH-89's tools
//      can tell the two apart.
//   5. Publish `window.__forgeRealVariableFilletProfile = { bodyId,
//      handle, edgeId, profile, when }` and dispatch the bus event
//      `forge:real-var-fillet-built` for plugins / Archie / e2e.
//
// Channel contract:
//   window.__forgeRealVariableFilletProfile : {
//     bodyId  : string,        // the source body's stable id
//     handle  : number,        // the NEW filleted body's handle
//     edgeId  : number,        // the user-picked edge id
//     profile : Array<{t:number, r:number}>,  // sorted anchor list
//     when    : number,        // Date.now() of the apply
//   }
//
// Hard constraints (PUSH-130 brief):
//   • NO new npm / C++ / external deps — pure React + the existing
//     preload-exposed kernel surface.
//   • NO C++ kernel changes — the binding already exists.
//   • Surgical edits to Menus.jsx (one new tools.realVarFillet entry) +
//     App.jsx (one import + one mount).
//   • Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants — bus event name, menu action id, channel global key,
// default profile shape. Kept in sync with PUSH-89's naming so the
// Activity Log / DiagnosticDump pick the events up unchanged.

export const FORGE_REAL_VAR_FILLET_EVENT = 'forge:real-var-fillet-built';
export const FORGE_REAL_VAR_FILLET_MENU_ID = 'tools.realVarFillet';
export const FORGE_REAL_VAR_FILLET_GLOBAL = '__forgeRealVariableFilletProfile';

// Default profile — t=0/r=1, t=0.5/r=5, t=1/r=1 (thin → fat → thin).
// Matches the PUSH-130 brief's worked example — the peak radius is now
// 5 mm (vs PUSH-89's 3 mm) so the real OCCT result is visually distinct
// from the spliced one.
export const DEFAULT_PROFILE = Object.freeze([
  Object.freeze({ t: 0,    r: 1 }),
  Object.freeze({ t: 0.5,  r: 5 }),
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
 *  the MassPropsPanel.activeBody / DirectEditTranslatePanel / PUSH-89
 *  ladder: selection.bodyHandle → selection.ids[0] → last native body. */
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

/** Sample the (t, r) profile at `t ∈ [0, 1]` using piecewise-linear
 *  interpolation between the sorted control points. Used by the
 *  preview curve renderer. */
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

/** Run the REAL variable fillet against the kernel binding. Returns
 *  `{ ok, newHandle, profile, anchors }` on success, or
 *  `{ ok: false, error }` on failure. */
export function applyRealVariableFillet(body, edgeId, profile) {
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
  const fn = window.forge?.part?.variableFilletEdge;
  if (typeof fn !== 'function') {
    return { ok: false, error: 'forge.part.variableFilletEdge unavailable' };
  }
  // Anchors map directly: t → u (parametric position 0..1), r → r (mm).
  // The kernel binding expects {u, r} keys.
  const anchors = sorted.map((p) => ({ u: p.t, r: p.r }));
  let newHandle;
  try {
    newHandle = fn(body.handle, edgeId, anchors);
  } catch (err) {
    return { ok: false,
             error: `kernel variableFilletEdge threw: ${err?.message || err}` };
  }
  if (typeof newHandle !== 'number' || newHandle <= 0) {
    return { ok: false,
             error: `kernel variableFilletEdge returned bad handle ${newHandle}` };
  }
  // Replace the source body in the scene — same lineage convention as
  // PUSH-89's variableFillet path; the only difference is the toolId.
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  const next = bodies.map((b) => (b && b.id === body.id)
    ? {
        ...b,
        handle: newHandle,
        toolId: 'solid.realVariableFillet',
        params: {
          ...(b.params || {}),
          edgeId,
          profile: sorted.map((p) => ({ t: p.t, r: p.r })),
          anchorCount: sorted.length,
          intent: 'realVariable',
        },
      }
    : b);
  if (typeof window.__forgeSetBodies === 'function') {
    window.__forgeSetBodies(next);
  }
  try { window.__forgeBodies = next; } catch {}
  // Publish channel + bus event.
  const payload = {
    bodyId: body.id,
    handle: newHandle,
    edgeId,
    profile: sorted.map((p) => ({ t: p.t, r: p.r })),
    when: Date.now(),
  };
  try { window[FORGE_REAL_VAR_FILLET_GLOBAL] = payload; } catch {}
  try {
    window.dispatchEvent(new CustomEvent(FORGE_REAL_VAR_FILLET_EVENT, {
      detail: payload,
    }));
  } catch { /* CustomEvent is universal in Electron */ }
  try {
    window.dispatchEvent(new CustomEvent('forge:bodies-changed', {
      detail: { bodies: next },
    }));
  } catch {}
  return { ok: true, newHandle, profile: payload.profile, anchors };
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail matching PUSH-89's panel so the two read as
// a matched pair on the right shelf when both are open at once.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 440,
  zIndex: 1333,
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
// 80-sample line. Updates live as the user edits the table.

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
      const y = (H - PAD) - (r / rMax) * (H - PAD * 2);
      out.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return out.join(' ');
  }, [sorted, rMax]);

  return (
    <svg width={W} height={H}
         data-testid="forge-realvarfillet-curve"
         data-r-max={rMax.toFixed(3)}
         style={{
           display: 'block',
           background: 'var(--forge-canvas-1, #0e1218)',
           border: '1px solid var(--forge-rail-edge, #2a2d34)',
           borderRadius: 3,
         }}>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD}
            stroke="var(--forge-rail-edge, #2a2d34)" strokeWidth="1" />
      <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2}
            stroke="var(--forge-rail-edge, #2a2d34)" strokeWidth="0.5"
            strokeDasharray="2 3" />
      <polyline points={pts} fill="none"
                stroke="var(--forge-accent, #4f87ff)" strokeWidth="1.5" />
      {sorted.map((p, i) => {
        const x = PAD + p.t * (W - PAD * 2);
        const y = (H - PAD) - (p.r / rMax) * (H - PAD * 2);
        return (
          <circle key={i} cx={x} cy={y} r="3"
                  fill="var(--forge-accent, #4f87ff)"
                  stroke="var(--forge-ink, #dadde2)" strokeWidth="0.5"
                  data-testid={`forge-realvarfillet-control-${i}`} />
        );
      })}
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

export function RealVariableFilletPanel({ open, onClose }) {
  const [bodies, setBodies] = useState(() => readNativeBodies());
  const [bodyId, setBodyId] = useState(() => activeNativeBody()?.id || '');
  const [edgeId, setEdgeId] = useState(() => activeEdgeId() ?? 0);
  const [profile, setProfile] = useState(() => DEFAULT_PROFILE.map((p) => ({ ...p })));
  const [toast, setToast] = useState(null);
  const [error, setError] = useState('');

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
    const onBodies = () => setBodies(readNativeBodies());
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
      const last = prev[prev.length - 1] || { t: 1, r: 1 };
      const prevLast = prev[prev.length - 2] || { t: 0, r: 1 };
      const nextT = Math.min(1, Math.max(0, (last.t + prevLast.t) / 2));
      return [...prev, { t: nextT, r: last.r }];
    });
  }, []);

  const removeRow = useCallback((i) => {
    setProfile((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, j) => j !== i);
    });
  }, []);

  const captureEdgeFromSelection = useCallback(() => {
    const e = activeEdgeId();
    if (e !== null) setEdgeId(e);
  }, []);

  const sorted = useMemo(() => sortProfile(profile), [profile]);
  const rPeak = useMemo(() => {
    let m = 0;
    for (const p of sorted) if (p.r > m) m = p.r;
    return m;
  }, [sorted]);

  const canApply = !!body
    && Number.isFinite(edgeId) && edgeId >= 0
    && sorted.length >= 2
    && rPeak > 0;

  const apply = useCallback(() => {
    setError('');
    setToast(null);
    const res = applyRealVariableFillet(body, Number(edgeId), profile);
    if (!res.ok) {
      setError(res.error || 'apply failed');
      return;
    }
    setToast({
      handle: res.newHandle,
      anchors: res.profile.length,
      peak: rPeak,
      when: Date.now(),
    });
    setBodies(readNativeBodies());
  }, [body, edgeId, profile, rPeak]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Real variable-radius fillet"
         data-testid="forge-realvarfillet-panel"
         data-body-id={body?.id || ''}
         data-edge-id={Number.isFinite(edgeId) ? String(edgeId) : ''}
         data-row-count={sorted.length}
         data-peak-radius={rPeak.toFixed(4)}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="sketch.fillet" size={14} />
        <strong style={{ fontSize: 13 }}>Real Variable Fillet</strong>
        <span style={{
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          padding: '1px 6px',
          borderRadius: 'var(--forge-radius-pill, 10px)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}
              data-testid="forge-realvarfillet-peak-chip">
          r_peak = {rPeak.toFixed(2)} mm
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close real variable fillet panel"
                data-testid="forge-realvarfillet-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={SECTION_TITLE}>Target</div>
      <div style={SECTION_BOX}>
        <div style={ROW}>
          <span style={LABEL}>Body</span>
          {bodies.length === 0 ? (
            <span data-testid="forge-realvarfillet-empty"
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
                    data-testid="forge-realvarfillet-body-select"
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
                 data-testid="forge-realvarfillet-edge-input"
                 style={NUM_INPUT} />
          <button type="button"
                  onClick={captureEdgeFromSelection}
                  title="Capture the currently-selected edge id from window.__forgeSelection"
                  data-testid="forge-realvarfillet-capture-edge"
                  style={ACTION_BTN('default')}>
            Use current edge
          </button>
        </div>
      </div>

      <div style={SECTION_TITLE}>Radius law r(u)</div>
      <RadiusCurvePreview profile={sorted} />

      <div style={SECTION_TITLE}>
        Anchors ({sorted.length} {sorted.length === 1 ? 'point' : 'points'})
      </div>
      <div style={SECTION_BOX}>
        <div style={TABLE_HEAD}>
          <span>#</span>
          <span>u (0–1)</span>
          <span>r (mm)</span>
          <span />
        </div>
        {profile.map((row, i) => (
          <div key={i}
               style={TABLE_ROW}
               data-testid="forge-realvarfillet-row"
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
                   data-testid={`forge-realvarfillet-t-${i}`}
                   style={NUM_INPUT} />
            <input type="number" step="0.1" min="0"
                   value={row.r}
                   onChange={(e) => setRow(i, 'r', e.target.value)}
                   data-testid={`forge-realvarfillet-r-${i}`}
                   style={NUM_INPUT} />
            <button type="button"
                    onClick={() => removeRow(i)}
                    disabled={profile.length <= 2}
                    title={profile.length <= 2
                      ? 'Profile needs at least 2 rows'
                      : 'Remove this row'}
                    data-testid={`forge-realvarfillet-remove-${i}`}
                    style={REMOVE_BTN(profile.length > 2)}>
              −
            </button>
          </div>
        ))}
        <div style={{ ...ROW, marginTop: 4 }}>
          <button type="button"
                  onClick={addRow}
                  title="Append a new (u, r) anchor mid-way between the last two"
                  data-testid="forge-realvarfillet-add-row"
                  style={ACTION_BTN('default')}>
            + Add row
          </button>
        </div>
      </div>

      {error && (
        <div data-testid="forge-realvarfillet-error"
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
          <span data-testid="forge-realvarfillet-toast"
                style={{
                  fontSize: 11,
                  color: 'var(--forge-accent, #4f87ff)',
                }}>
            Built · handle {toast.handle} · r_peak = {toast.peak.toFixed(2)} mm
            · {toast.anchors} anchors
          </span>
        ) : (
          <span style={{
            fontSize: 10,
            color: 'var(--forge-ink-mute, #9aa1ab)',
          }}>
            Apply runs forge.part.variableFilletEdge(handle, edge, anchors)
            — real OCCT law-function fillet.
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={apply}
                disabled={!canApply}
                title={canApply
                  ? `Apply real variable fillet (r_peak = ${rPeak.toFixed(2)} mm)`
                  : 'Pick a body + edge + at least 2 valid rows'}
                data-testid="forge-realvarfillet-apply"
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
// Host — listens for `tools.realVarFillet` menu action, exposes the
// imperative open/close hooks, and mirrors the headless helpers on the
// window debug surface.

export function RealVariableFilletPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenRealVarFilletPanel  = () => setOpen(true);
    window.__forgeCloseRealVarFilletPanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === FORGE_REAL_VAR_FILLET_MENU_ID) setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    window.__forgeRealVarFilletHelper = Object.freeze({
      readNativeBodies,
      activeNativeBody,
      activeEdgeId,
      sortProfile,
      sampleProfile,
      applyRealVariableFillet,
      EVENT_NAME: FORGE_REAL_VAR_FILLET_EVENT,
      GLOBAL_KEY: FORGE_REAL_VAR_FILLET_GLOBAL,
      DEFAULT_PROFILE,
    });
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenRealVarFilletPanel; } catch {}
      try { delete window.__forgeCloseRealVarFilletPanel; } catch {}
    };
  }, []);
  return <RealVariableFilletPanel open={open} onClose={() => setOpen(false)} />;
}

export default RealVariableFilletPanel;
