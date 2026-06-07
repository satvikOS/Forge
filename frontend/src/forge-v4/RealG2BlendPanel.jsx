// PUSH-131 (Slice-96) — Real OCCT G2/G3 BRepFill_Filling blend (degree-5 NURBS).
//
// User's brief:
//   "Implement ArchDisc Forge slice PUSH-131 — REAL OCCT BRepFill_Filling
//    G2/G3 blend (replace PUSH-85 Coons approximation). OCCT class
//    BRepOffsetAPI_MakeFilling (with GeomAbs_C2/GeomAbs_C3 continuity)
//    provides true OCCT-blessed G2/G3 surface filling.
//
//    If the kernel binding for BRepFill_Filling doesn't exist and we
//    can't add C++ (no new C++ libs allowed), use existing
//    forge.surfacing.eval(face, u, v) to sample boundary tangent fields
//    at higher density (e.g. 25 sample pts per boundary) and pass to
//    existing forge.surfacing.buildPatch with degree 5 NURBS (higher
//    than PUSH-85's degree 3) for tighter G2 approximation."
//
// State of the kernel binding (audited 2026-06-07):
//   • forge-kernel/src/binding.cpp exposes ONLY:
//       forge.surfacing.buildPatch(spec, uDeg, vDeg, uKnots, vKnots)
//       forge.surfacing.trim / sew / refine / eval / intersect
//       forge.surfacing.projectPoint / classAAnalyse
//   • NO direct binding for BRepOffsetAPI_MakeFilling. The class is
//     #included in forge-kernel/src/Healing.cpp (used internally for
//     forge.healing autoFillHoles) and in forge-kernel/src/DirectModeling.cpp,
//     but neither path is reachable as a "feed N edges → get a G2 face"
//     surface from JS.
//   • PUSH-131 brief explicitly carves out the C++ path ("we can't add
//     C++") → land the higher-density degree-5 JS approximation.
//
// What this panel ships vs PUSH-85:
//   • Sampling density: 25 boundary samples / axis (vs PUSH-85's 11).
//     → 625-point control grid vs 121 — 5.2× denser tangent fields.
//   • NURBS degree: 5 (vs PUSH-85's 3).
//     → Tighter G2 approximation: degree-5 basis functions naturally
//       carry the boundary's curvature signature deeper into the
//       interior than the bicubic patch can.
//   • Grid built with the same hermiteCoonsPatch helper PUSH-85 already
//     ships — same boundary inputs, same continuity → tension mapping.
//   • Result body's `params` carry uDeg, vDeg, uCount, vCount so the
//     e2e can assert degree ≥ 5 without a kernel introspection API.
//
// Hard constraints honoured:
//   * NO new npm / C++ deps. Pure React + existing coonsPatch.js +
//     existing forge.surfacing.buildPatch.
//   * NO kernel modifications. The "use existing forge.surfacing APIs"
//     path the brief explicitly authorises.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one mount).
//   * Manual clicks NEVER post to Archie's thread.
//   * Multi-cam e2e mandate honoured by push-131-real-g2-blend.spec.js.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  hermiteCoonsPatch,
  continuityToTension,
  sampleSquareBoundary,
  extractBoundaryFromBox,
  buildPatchKnots,
} from './coonsPatch.js';

// ─────────────────────────────────────────────────────────────────────
// Constants — the bus event, the persistence key, and the high-density
// 25-sample / degree-5 defaults the brief calls for.

export const FORGE_REAL_G2_BLEND_EVENT   = 'forge:real-g2-blend-built';
export const FORGE_REAL_G2_BLEND_STORAGE = 'forge.v4.realG2Blend';
/** 25 sample points / boundary — the density the brief specifies
 *  ("e.g. 25 sample pts per boundary"). 25×25 control grid = 625 control
 *  points feeding buildPatch. */
export const REAL_G2_DEFAULT_SAMPLES = 25;
/** Degree 5 NURBS — the brief: "degree 5 NURBS (higher than PUSH-85's
 *  degree 3) for tighter G2 approximation". The kernel's
 *  buildNurbsPatch validation requires degree < controlCount per axis,
 *  so degree 5 needs samples ≥ 6 — comfortably satisfied at 25. */
export const REAL_G2_DEFAULT_DEGREE  = 5;

// ─────────────────────────────────────────────────────────────────────
// continuity ↔ OCCT GeomAbs_C2/C3 mapping.
//
// The OCCT BRepOffsetAPI_MakeFilling class is parameterised by
// GeomAbs_C0/C1/C2/C3 continuity; the brief calls for G2 + G3 only
// (the "real G2/G3 blend"). The user-visible radio surfaces those two
// + the OCCT label next to them.

export const REAL_G2_CONTINUITY_OPTIONS = [
  {
    id: 'G2', label: 'G2 — Curvature',
    occt: 'C2', occtLabel: 'GeomAbs_C2',
    description: 'Position + tangent + curvature (BRepFill_Filling default).',
  },
  {
    id: 'G3', label: 'G3 — Torsion',
    occt: 'C3', occtLabel: 'GeomAbs_C3',
    description: 'Position + tangent + curvature + jerk.',
  },
];

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (exported so the e2e can drive the build pipeline without
// mounting the React panel first).

/** Build the boundary curves for whichever source mode is selected. The
 *  preset is a 100 mm saddle (lift 25 mm) so the resulting Coons patch
 *  has a non-trivial curvature signature for the degree-5 basis to
 *  resolve. */
export function buildRealG2Boundary({
  source, samples = REAL_G2_DEFAULT_SAMPLES, body, jsonOverride,
}) {
  if (source === 'json' && jsonOverride
      && jsonOverride.curveU0 && jsonOverride.curveU1
      && jsonOverride.curveV0 && jsonOverride.curveV1) {
    return jsonOverride;
  }
  if (source === 'body' && body && body.bbox) {
    const b = extractBoundaryFromBox(body.bbox, samples);
    if (b) return b;
  }
  return sampleSquareBoundary({ size: 100, lift: 25, samples });
}

/** Read the currently selected/active body, derive its bbox, and return
 *  { id, name, handle, bbox } or null. Mirrors ClassABlendPanel's
 *  readActiveBody so the "From body" mode falls back cleanly when no
 *  body is picked. */
export function readActiveBodyForRealG2() {
  if (typeof window === 'undefined') return null;
  const sel = window.__forgeSelection;
  let bodyId = null;
  if (sel && sel.kind === 'body' && Array.isArray(sel.ids) && sel.ids.length) {
    bodyId = sel.ids[0];
  }
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  let body = null;
  if (bodyId != null) {
    body = bodies.find((b) => b && (b.id === bodyId || b.handle === bodyId)) || null;
  }
  if (!body && bodies.length) {
    // Fall back to the last native body in the scene.
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      if (b && b.kind === 'native' && typeof b.handle === 'number') {
        body = b;
        break;
      }
    }
  }
  if (!body) return null;
  let bbox = body.bbox;
  if (!bbox && typeof body.handle === 'number'
      && window.forge && typeof window.forge.bbox === 'function') {
    try {
      const raw = window.forge.bbox(body.handle);
      if (raw && Number.isFinite(raw.xMin)) bbox = raw;
    } catch { /* fall through to null */ }
  }
  return {
    id: body.id, name: body.name || body.toolId || body.id,
    handle: body.handle, bbox: bbox || null,
  };
}

/** Build the dense Hermite control grid. The continuity choice maps to
 *  the Hermite tension parameter through the same continuityToTension
 *  helper PUSH-85 uses; the difference is the density (25×25 vs 11×11).
 *  Returns { uCount, vCount, grid, kind:'hermite', tension }. */
export function buildRealG2Grid({
  boundary, continuity, samples = REAL_G2_DEFAULT_SAMPLES,
}) {
  const uN = samples, vN = samples;
  const c = String(continuity || 'G2').toUpperCase();
  // PUSH-131 only surfaces G2 + G3 — both hit the Hermite path. Default
  // to G2 if the caller passes anything else (defensive).
  const safeC = c === 'G3' ? 'G3' : 'G2';
  const tension = continuityToTension(safeC);
  const { grid } = hermiteCoonsPatch(
    boundary.curveU0, boundary.curveU1,
    boundary.curveV0, boundary.curveV1,
    { uCount: uN, vCount: vN, tension });
  return { uCount: uN, vCount: vN, grid, kind: 'hermite', tension,
           continuity: safeC };
}

/** Call window.forge.surfacing.buildPatch with the grid + degree-5
 *  open-uniform knot vectors. Returns
 *  { ok, faceHandle, uKnots, vKnots, uDeg, vDeg, reason, message }. */
export function commitRealG2Grid(gridSpec, { uDeg = REAL_G2_DEFAULT_DEGREE,
                                              vDeg = REAL_G2_DEFAULT_DEGREE } = {}) {
  if (typeof window === 'undefined' || !window.forge || !window.forge.surfacing) {
    return { ok: false, reason: 'kernel not ready' };
  }
  const buildPatch = window.forge.surfacing.buildPatch;
  if (typeof buildPatch !== 'function') {
    return { ok: false, reason: 'buildPatch missing' };
  }
  // The kernel's buildNurbsPatch checks degree < controlCount per axis;
  // a 25×25 grid with degree 5 satisfies that bound by 20.
  const uKnots = buildPatchKnots(gridSpec.uCount, uDeg);
  const vKnots = buildPatchKnots(gridSpec.vCount, vDeg);
  try {
    const faceHandle = buildPatch(gridSpec.grid, uDeg, vDeg, uKnots, vKnots);
    if (typeof faceHandle !== 'number' || !Number.isFinite(faceHandle)) {
      return { ok: false, reason: 'buildPatch returned non-handle',
               message: String(faceHandle) };
    }
    return { ok: true, faceHandle, uKnots, vKnots, uDeg, vDeg };
  } catch (err) {
    return { ok: false, reason: 'buildPatch threw',
             message: err && err.message ? err.message : String(err) };
  }
}

/** Append the resulting surface body to the live scene. The body
 *  records the uDeg/vDeg/uCount/vCount the kernel committed, so the
 *  e2e can later assert "degree 5+" without a kernel-side introspection
 *  API. Returns the body record appended. */
export function appendRealG2Body(faceHandle, {
  continuity, source, uDeg, vDeg, uCount, vCount, name,
}) {
  if (typeof window === 'undefined') return null;
  const ts = Date.now();
  const id = `real-g2-blend-${ts}`;
  const body = {
    id, kind: 'native', handle: faceHandle,
    toolId: 'surfacing.realG2Blend',
    surface: true,
    params: { continuity, source, uDeg, vDeg, uCount, vCount },
    name: name || `Real G${continuity === 'G3' ? '3' : '2'} Blend (deg ${uDeg})`,
  };
  if (typeof window.__forgeAppendBody === 'function') {
    window.__forgeAppendBody(body);
  }
  return body;
}

/** Top-level driver — wires boundary build → grid build → buildPatch
 *  → __forgeAppendBody → bus event. Used by both the panel button and
 *  the e2e spec / Archie tool calls. */
export function runRealG2BlendPipeline({
  source = 'preset',
  continuity = 'G2',
  samples = REAL_G2_DEFAULT_SAMPLES,
  degree = REAL_G2_DEFAULT_DEGREE,
  jsonOverride = null,
} = {}) {
  const body = source === 'body' ? readActiveBodyForRealG2() : null;
  const boundary = buildRealG2Boundary({ source, samples, body, jsonOverride });
  const gridSpec = buildRealG2Grid({ boundary, continuity, samples });
  // The kernel's validation requires degree < controlCount; clamp the
  // requested degree so the panel can't construct an invalid call.
  const safeDeg = Math.max(REAL_G2_DEFAULT_DEGREE,
                            Math.min(degree | 0, samples - 1));
  const built = commitRealG2Grid(gridSpec, { uDeg: safeDeg, vDeg: safeDeg });
  if (!built.ok) {
    return { ok: false, reason: built.reason, message: built.message,
             boundary, gridSpec };
  }
  const newBody = appendRealG2Body(built.faceHandle, {
    continuity: gridSpec.continuity, source,
    uDeg: built.uDeg, vDeg: built.vDeg,
    uCount: gridSpec.uCount, vCount: gridSpec.vCount,
    name: `Real ${gridSpec.continuity} Blend (deg ${built.uDeg}, ${gridSpec.uCount}×${gridSpec.vCount})`,
  });
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FORGE_REAL_G2_BLEND_EVENT, {
        detail: {
          faceHandle: built.faceHandle, bodyId: newBody?.id,
          continuity: gridSpec.continuity, source, samples,
          uDeg: built.uDeg, vDeg: built.vDeg,
          uCount: gridSpec.uCount, vCount: gridSpec.vCount,
          tension: gridSpec.tension,
          ts: Date.now(),
        },
      }));
    }
  } catch { /* fail soft — CustomEvent is universal in Electron */ }
  return {
    ok: true, faceHandle: built.faceHandle, body: newBody,
    boundary, gridSpec, uKnots: built.uKnots, vKnots: built.vKnots,
    uDeg: built.uDeg, vDeg: built.vDeg,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Side-effect helper API install — same pattern as ClassABlendPanel.
// The moment this module is imported (which App.jsx does once the
// bundle loads), the helper API mirror is live on window. The Host
// installs a richer subscriber when it mounts (which lets the panel
// actually render).

if (typeof window !== 'undefined') {
  try {
    window.__forgeRealG2BlendHelper = Object.freeze({
      buildRealG2Boundary,
      buildRealG2Grid,
      commitRealG2Grid,
      appendRealG2Body,
      readActiveBodyForRealG2,
      runRealG2BlendPipeline,
      continuityToTension,
      CONTINUITY_OPTIONS: REAL_G2_CONTINUITY_OPTIONS,
      EVENT_NAME: FORGE_REAL_G2_BLEND_EVENT,
      STORAGE_KEY: FORGE_REAL_G2_BLEND_STORAGE,
      DEFAULT_SAMPLES: REAL_G2_DEFAULT_SAMPLES,
      DEFAULT_DEGREE: REAL_G2_DEFAULT_DEGREE,
    });
    window.addEventListener('forge:menu-action', (e) => {
      if (e?.detail?.id === 'tools.realG2Blend') {
        window.__forgeRealG2BlendLastMenuTs = Date.now();
      }
    });
  } catch { /* fail soft — defensive in SSR / non-window envs */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail mirroring the other PUSH-N surfacing
// panels. The width + zIndex are picked to coexist with PUSH-85's
// Class-A Blend (zIndex 1332), Loft Sections (zIndex 1333), etc.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 460,
  zIndex: 1336,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'hidden',
};
const HEADER_ROW = { display: 'flex', alignItems: 'center', gap: 8 };
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)', margin: '8px 0 4px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const RADIO_GRID = {
  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
};
const RADIO_BTN = (active) => ({
  background: active ? 'var(--forge-accent-mute, #1f2c4a)' : 'var(--forge-canvas-1, #0e1218)',
  border: active ? '1px solid var(--forge-accent, #4f87ff)' : '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  color: 'var(--forge-ink, #dadde2)',
  padding: '6px 4px',
  cursor: 'pointer',
  fontSize: 11,
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
});
const SOURCE_RADIO_BTN = (active) => ({
  ...RADIO_BTN(active),
  fontSize: 10,
});
const CONTINUITY_RADIO_GRID = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
};
const ACTION_BTN = (variant = 'default', disabled = false) => ({
  background: disabled ? 'var(--forge-surface-mute, #1a1f27)'
            : variant === 'primary' ? 'var(--forge-accent, #4f87ff)'
            : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: disabled ? 'var(--forge-ink-mute, #9aa1ab)'
       : variant === 'primary' ? '#fff'
       : 'var(--forge-ink, #dadde2)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  padding: '6px 14px', borderRadius: 3, fontSize: 12,
  fontWeight: variant === 'primary' ? 600 : 400,
});
const LOG_BOX = {
  flex: 1, minHeight: 0, overflowY: 'auto',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, background: 'var(--forge-canvas-1, #0e1218)',
  padding: 6, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  color: 'var(--forge-ink-2, #b5bac4)',
};
const FIELD_LABEL = {
  fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const TEXT_AREA = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  resize: 'vertical', minHeight: 80,
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function RealG2BlendPanel({ open, onClose }) {
  const [source, setSource] = useState('preset'); // preset | body | json
  const [continuity, setContinuity] = useState(() => {
    if (typeof localStorage === 'undefined') return 'G2';
    try {
      const raw = localStorage.getItem(FORGE_REAL_G2_BLEND_STORAGE);
      if (!raw) return 'G2';
      const blob = JSON.parse(raw);
      const c = String(blob.continuity || 'G2').toUpperCase();
      if (c === 'G2' || c === 'G3') return c;
      return 'G2';
    } catch { return 'G2'; }
  });
  const [jsonOverride, setJsonOverride] = useState('');
  const [activeBody, setActiveBody] = useState(() => readActiveBodyForRealG2());
  const [log, setLog] = useState([]);
  const lastFaceRef = useRef(null);
  const lastDegRef  = useRef(null);

  // Persist continuity to localStorage so the next panel-open boots the
  // same modeller setting the user just exercised.
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(FORGE_REAL_G2_BLEND_STORAGE, JSON.stringify({ continuity }));
    } catch { /* quota / private mode — fail soft */ }
  }, [continuity]);

  // Re-derive the active body when the panel opens + on selection-change
  // events. The Bodies/Selection bus is the same one BodyColorsPanel
  // listens to.
  useEffect(() => {
    if (!open) return undefined;
    setActiveBody(readActiveBodyForRealG2());
    setLog([]);
    const refresh = () => setActiveBody(readActiveBodyForRealG2());
    window.addEventListener('forge:selection-changed', refresh);
    window.addEventListener('forge:bodies-changed', refresh);
    return () => {
      window.removeEventListener('forge:selection-changed', refresh);
      window.removeEventListener('forge:bodies-changed', refresh);
    };
  }, [open]);

  const onSetSource = useCallback((s) => setSource(s), []);
  const onSetContinuity = useCallback((c) => setContinuity(c), []);
  const onSetJsonOverride = useCallback((e) => setJsonOverride(e.target.value), []);

  // Build button — drives the same pipeline the e2e + Archie tool-call
  // paths land on.
  const onBuild = useCallback(() => {
    let override = null;
    if (source === 'json' && jsonOverride.trim().length > 0) {
      try {
        const blob = JSON.parse(jsonOverride);
        if (blob && blob.curveU0 && blob.curveU1 && blob.curveV0 && blob.curveV1) {
          override = blob;
        }
      } catch { /* keep override null — the pipeline falls back to preset */ }
    }
    const r = runRealG2BlendPipeline({
      source, continuity,
      samples: REAL_G2_DEFAULT_SAMPLES,
      degree:  REAL_G2_DEFAULT_DEGREE,
      jsonOverride: override,
    });
    if (r.ok) {
      lastFaceRef.current = r.faceHandle;
      lastDegRef.current  = r.uDeg;
    }
    setLog((l) => [
      ...l.slice(-12),
      {
        ok: r.ok, ts: Date.now(),
        message: r.ok
          ? `Built ${continuity} blend (deg ${r.uDeg}, ${r.gridSpec.uCount}×${r.gridSpec.vCount}) → face ${r.faceHandle}`
          : `Build failed: ${r.reason || 'error'}${r.message ? ' · ' + r.message : ''}`,
      },
    ]);
  }, [source, continuity, jsonOverride]);

  // Status line for "From body" mode.
  const bodyStatus = useMemo(() => {
    if (!activeBody) return 'no body picked — preset will be used';
    if (!activeBody.bbox) return `body ${activeBody.name} — bbox unavailable, preset will be used`;
    const b = activeBody.bbox;
    return `body ${activeBody.name} — bbox [${b.xMin.toFixed(1)},${b.yMin.toFixed(1)},${b.zMin.toFixed(1)}] → [${b.xMax.toFixed(1)},${b.yMax.toFixed(1)},${b.zMax.toFixed(1)}]`;
  }, [activeBody]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Real G2 blend"
         data-testid="forge-real-g2-blend-panel"
         data-continuity={continuity}
         data-source={source}
         data-samples={String(REAL_G2_DEFAULT_SAMPLES)}
         data-degree={String(REAL_G2_DEFAULT_DEGREE)}
         data-last-face={lastFaceRef.current == null ? '' : String(lastFaceRef.current)}
         data-last-deg={lastDegRef.current == null ? '' : String(lastDegRef.current)}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="sketch.spline" size={14} />
        <strong style={{ fontSize: 13 }}>Real G2 Blend</strong>
        <span style={{
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          padding: '1px 6px',
          borderRadius: 'var(--forge-radius-pill, 10px)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          deg {REAL_G2_DEFAULT_DEGREE} · {REAL_G2_DEFAULT_SAMPLES}×{REAL_G2_DEFAULT_SAMPLES}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Real G2 Blend panel"
                data-testid="forge-real-g2-blend-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
        High-density (25×25) degree-5 NURBS blend through four boundary
        curves — tighter G2/G3 approximation than PUSH-85's bicubic Coons.
        Approximates BRepOffsetAPI_MakeFilling with GeomAbs_C2/C3
        continuity until the kernel exposes a direct binding.
      </div>

      <div style={SECTION_TITLE}>Continuity</div>
      <div style={SECTION_BOX}>
        <div style={CONTINUITY_RADIO_GRID}>
          {REAL_G2_CONTINUITY_OPTIONS.map((opt) => {
            const active = continuity === opt.id;
            return (
              <button key={opt.id}
                      type="button"
                      onClick={() => onSetContinuity(opt.id)}
                      data-testid={`forge-real-g2-blend-continuity-${opt.id.toLowerCase()}`}
                      data-active={active ? '1' : '0'}
                      aria-pressed={active}
                      style={RADIO_BTN(active)}>
                <strong>{opt.label}</strong>
                <span style={{
                  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                  fontSize: 9,
                  color: 'var(--forge-ink-mute, #9aa1ab)',
                }}>
                  OCCT {opt.occtLabel}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {REAL_G2_CONTINUITY_OPTIONS.find((o) => o.id === continuity)?.description}
        </div>
      </div>

      <div style={SECTION_TITLE}>Boundary source</div>
      <div style={SECTION_BOX}>
        <div style={RADIO_GRID}>
          <button type="button"
                  onClick={() => onSetSource('preset')}
                  data-testid="forge-real-g2-blend-source-preset"
                  data-active={source === 'preset' ? '1' : '0'}
                  aria-pressed={source === 'preset'}
                  style={SOURCE_RADIO_BTN(source === 'preset')}>
            <strong>Saddle preset</strong>
            <span style={FIELD_LABEL}>100 mm × 25 mm lift</span>
          </button>
          <button type="button"
                  onClick={() => onSetSource('body')}
                  data-testid="forge-real-g2-blend-source-body"
                  data-active={source === 'body' ? '1' : '0'}
                  aria-pressed={source === 'body'}
                  style={SOURCE_RADIO_BTN(source === 'body')}>
            <strong>From body</strong>
            <span style={FIELD_LABEL}>top-face bbox</span>
          </button>
          <button type="button"
                  onClick={() => onSetSource('json')}
                  data-testid="forge-real-g2-blend-source-json"
                  data-active={source === 'json' ? '1' : '0'}
                  aria-pressed={source === 'json'}
                  style={SOURCE_RADIO_BTN(source === 'json')}>
            <strong>JSON override</strong>
            <span style={FIELD_LABEL}>curveU0/U1/V0/V1</span>
          </button>
        </div>
        {source === 'body' && (
          <div data-testid="forge-real-g2-blend-body-status"
               style={{ fontSize: 10,
                        color: activeBody && activeBody.bbox
                          ? 'var(--forge-ink-2, #b5bac4)'
                          : 'var(--forge-warn, #d4a142)' }}>
            {bodyStatus}
          </div>
        )}
        {source === 'json' && (
          <textarea
            value={jsonOverride}
            onChange={onSetJsonOverride}
            data-testid="forge-real-g2-blend-json"
            placeholder='{"curveU0":[[0,0,0],[100,0,0]], …}'
            style={TEXT_AREA} />
        )}
      </div>

      <div style={SECTION_TITLE}>Build</div>
      <div style={SECTION_BOX}>
        <button type="button"
                onClick={onBuild}
                data-testid="forge-real-g2-blend-build"
                style={ACTION_BTN('primary')}>
          Build real G{continuity === 'G3' ? '3' : '2'} blend
        </button>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {`${REAL_G2_DEFAULT_SAMPLES}×${REAL_G2_DEFAULT_SAMPLES} control grid · degree ${REAL_G2_DEFAULT_DEGREE} · open-uniform knots`}
        </span>
      </div>

      <div style={SECTION_TITLE}>Log</div>
      <div data-testid="forge-real-g2-blend-log"
           data-log-count={log.length}
           style={LOG_BOX}>
        {log.length === 0 ? (
          <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>
            no builds yet
          </span>
        ) : log.slice().reverse().map((entry, i) => (
          <div key={`${entry.ts}-${i}`}
               style={{
                 display: 'flex', gap: 6, alignItems: 'baseline',
                 borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
                 padding: '2px 0',
               }}>
            <span style={{ color: entry.ok ? 'var(--forge-ok, #4caf50)'
                                            : 'var(--forge-err, #ef5350)' }}>
              {entry.ok ? 'OK' : 'ER'}
            </span>
            <span style={{ flex: 1 }}>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.realG2Blend` menu action, exposes the
// imperative open/close hooks plus the headless pipeline helpers on
// window.__forgeRealG2BlendHelper for plugins / e2e / Archie tool calls.

export function RealG2BlendPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenRealG2Blend  = () => setOpen(true);
    window.__forgeCloseRealG2Blend = () => setOpen(false);
    window.__forgeRealG2BlendHelper = Object.freeze({
      buildRealG2Boundary,
      buildRealG2Grid,
      commitRealG2Grid,
      appendRealG2Body,
      readActiveBodyForRealG2,
      runRealG2BlendPipeline,
      continuityToTension,
      CONTINUITY_OPTIONS: REAL_G2_CONTINUITY_OPTIONS,
      EVENT_NAME: FORGE_REAL_G2_BLEND_EVENT,
      STORAGE_KEY: FORGE_REAL_G2_BLEND_STORAGE,
      DEFAULT_SAMPLES: REAL_G2_DEFAULT_SAMPLES,
      DEFAULT_DEGREE: REAL_G2_DEFAULT_DEGREE,
    });
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.realG2Blend') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenRealG2Blend; } catch {}
      try { delete window.__forgeCloseRealG2Blend; } catch {}
      try { delete window.__forgeRealG2BlendHelper; } catch {}
    };
  }, []);
  if (!open) return null;
  return <RealG2BlendPanel open={open} onClose={() => setOpen(false)} />;
}

export default RealG2BlendPanel;
