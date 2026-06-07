// PUSH-107 (Slice-76) — Surface Offset panel.
//
// Class-A workflow needs offset surfaces: pick a source surface (or face)
// and emit a new surface body that's translated by N mm along the local
// normal at every UV sample. The standard OCCT primitive for this is
// BRepOffsetAPI_MakeOffsetShape; the JS-level realisation we ship here
// uses the kernel surfaces our preload bridge already exposes:
//
//   • window.forge.surfacing.eval(face, u, v) → { point, du, dv, normal,
//     gaussian, mean }. Available on ANY OCCT face, not only NURBS
//     patches — works on the surface representation pulled from the
//     TopoDS_Face. (binding.cpp: SurfEval → forge::surfacing::evalSurface,
//     Nurbs.cpp:324.)
//   • window.forge.surfacing.buildPatch(spec, uDeg, vDeg, uKnots, vKnots)
//     → faceHandle. The kernel build commits an open-uniform bicubic
//     NURBS face we can hand to the scene as a native surface body.
//
// The headless pipeline:
//   1. Determine the source surface — either an existing surface body
//      already in the scene (picked via the body selector) or, when
//      nothing is picked, a default 100 mm domed saddle built on the
//      fly via the same sampleSquareBoundary + hermiteCoonsPatch combo
//      Class-A Blend uses. The auto-seeded source guarantees the panel
//      is always reachable without user prep.
//   2. Sample the source face on an 11×11 UV grid via surfacing.eval.
//      For every sample, displace the point along its (already unit-
//      normalised) normal vector by the user-chosen offset distance
//      (mm). Negative offsets flip the displacement direction.
//   3. Re-commit the displaced grid as a brand-new NURBS face via
//      surfacing.buildPatch (degree 3, open-uniform knots) and attach
//      the resulting handle as a native surface body via
//      window.__forgeAppendBody. Two distinct face handles → two
//      genuine OCCT entities, not a mesh duplicate.
//
// Hard constraints honoured:
//   * NO new npm / C++ / external deps. Pure React + the existing
//     preload surfacing.eval + buildPatch + the hermiteCoonsPatch +
//     buildPatchKnots helpers from coonsPatch.js.
//   * NO kernel modifications. The offset is built JS-side from
//     evalSurface samples — no new binding required.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one mount).
//   * Manual clicks do NOT post to Archie's thread.
//   * Multi-cam e2e mandate honoured by push-107-surface-offset.spec.js.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  hermiteCoonsPatch,
  sampleSquareBoundary,
  buildPatchKnots,
} from './coonsPatch.js';

// ─────────────────────────────────────────────────────────────────────
// Constants — the bus event the e2e listens for, the storage key the
// panel persists the last offset distance under, and the default
// sampling density.

export const FORGE_SURFACE_OFFSET_EVENT   = 'forge:surface-offset-built';
export const FORGE_SURFACE_OFFSET_STORAGE = 'forge.v4.surfaceOffset';
/** 11×11 UV grid matches the Class-A Blend density — enough to capture
 *  curvature, sparse enough to stay under buildPatch's open-uniform
 *  knot-vector bound. */
export const SURFACE_OFFSET_DEFAULT_SAMPLES = 11;
/** Default offset distance (mm) — non-zero so an immediate Apply produces
 *  a visibly translated surface. */
export const SURFACE_OFFSET_DEFAULT_DISTANCE = 5;
/** Slider bounds (mm) — the brief: "Offset distance slider (-10 to +10 mm)". */
export const SURFACE_OFFSET_MIN = -10;
export const SURFACE_OFFSET_MAX = +10;
/** Tag used for the auto-seeded preset source body so the panel can find
 *  it after a re-open. */
export const SURFACE_OFFSET_SEED_TAG = 'surfacing.offsetSeedSaddle';

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (exported so the e2e can drive the build pipeline without
// mounting the React panel first).

/** Identify the surface bodies currently in the live scene. Returns an
 *  array of body records (kind === 'native', surface === true, has a
 *  finite numeric handle). The order matches __forgeBodies. */
export function listSurfaceBodies() {
  if (typeof window === 'undefined') return [];
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return bodies.filter((b) =>
    b && b.kind === 'native' && b.surface === true
      && Number.isFinite(b.handle));
}

/** Read the currently-selected body and return the matching record from
 *  __forgeBodies, or null when nothing is picked. Mirrors the helper in
 *  ClassABlendPanel so the two surfaces share a contract. */
export function readSelectedSurfaceBody() {
  if (typeof window === 'undefined') return null;
  const sel = window.__forgeSelection;
  let bodyId = null;
  if (sel && sel.kind === 'body' && Array.isArray(sel.ids) && sel.ids.length) {
    bodyId = sel.ids[0];
  }
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  if (bodyId != null) {
    const hit = bodies.find((b) => b && (b.id === bodyId || b.handle === bodyId));
    if (hit && hit.kind === 'native' && hit.surface === true
        && Number.isFinite(hit.handle)) {
      return hit;
    }
  }
  return null;
}

/** Build the auto-seeded source surface — a 100 mm domed saddle patch.
 *  Returns { ok, faceHandle, reason, message }. The seed lives in the
 *  scene as a native surface body so the e2e can prove the source ↔
 *  offset relationship later. */
export function buildSourceSeedSurface({ samples = SURFACE_OFFSET_DEFAULT_SAMPLES } = {}) {
  if (typeof window === 'undefined' || !window.forge || !window.forge.surfacing) {
    return { ok: false, reason: 'kernel not ready' };
  }
  const buildPatch = window.forge.surfacing.buildPatch;
  if (typeof buildPatch !== 'function') {
    return { ok: false, reason: 'buildPatch missing' };
  }
  // 100 mm saddle with a 25 mm lift — mirrors the Class-A preset so the
  // surface has interesting curvature for the offset displacement to
  // resolve.
  const boundary = sampleSquareBoundary({ size: 100, lift: 25, samples });
  const { grid } = hermiteCoonsPatch(
    boundary.curveU0, boundary.curveU1,
    boundary.curveV0, boundary.curveV1,
    { uCount: samples, vCount: samples, tension: 0.66 });
  const uKnots = buildPatchKnots(samples, 3);
  const vKnots = buildPatchKnots(samples, 3);
  try {
    const faceHandle = buildPatch(grid, 3, 3, uKnots, vKnots);
    if (typeof faceHandle !== 'number' || !Number.isFinite(faceHandle)) {
      return { ok: false, reason: 'buildPatch returned non-handle',
               message: String(faceHandle) };
    }
    return { ok: true, faceHandle, uKnots, vKnots, samples };
  } catch (err) {
    return { ok: false, reason: 'buildPatch threw',
             message: err && err.message ? err.message : String(err) };
  }
}

/** Append the seed surface to the live scene so the picker can reference
 *  it on subsequent panel opens. Returns the body record appended. */
export function appendSeedBody(faceHandle) {
  if (typeof window === 'undefined') return null;
  const ts = Date.now();
  const id = `surface-offset-seed-${ts}`;
  const body = {
    id, kind: 'native', handle: faceHandle,
    toolId: SURFACE_OFFSET_SEED_TAG,
    surface: true,
    params: { kind: 'saddle', size: 100, lift: 25 },
    name: 'Offset Source (saddle)',
  };
  if (typeof window.__forgeAppendBody === 'function') {
    window.__forgeAppendBody(body);
  }
  return body;
}

/** Sample the source face on an N×N UV grid and build the displaced
 *  control grid. Returns { ok, uCount, vCount, xyz, grid, reason,
 *  message }. xyz is a flat Float64Array suitable for the buildPatch
 *  pass-through payload. */
export function sampleOffsetGrid(faceHandle, offsetMm, samples = SURFACE_OFFSET_DEFAULT_SAMPLES) {
  if (typeof window === 'undefined' || !window.forge || !window.forge.surfacing) {
    return { ok: false, reason: 'kernel not ready' };
  }
  const evalFn = window.forge.surfacing.eval;
  if (typeof evalFn !== 'function') {
    return { ok: false, reason: 'surfacing.eval missing' };
  }
  if (!Number.isFinite(faceHandle) || faceHandle <= 0) {
    return { ok: false, reason: 'invalid source face handle' };
  }
  const n = Math.max(2, samples | 0);
  const xyz = new Float64Array(n * n * 3);
  const grid = [];
  let w = 0;
  try {
    for (let j = 0; j < n; j++) {
      const v = j / (n - 1);
      const row = [];
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const r = evalFn(faceHandle, u, v);
        // r.normal is the unit surface normal at (u, v); r.point is the
        // surface position. Displace point along normal by the offset.
        const nx = r.normal[0], ny = r.normal[1], nz = r.normal[2];
        const px = r.point[0]  + nx * offsetMm;
        const py = r.point[1]  + ny * offsetMm;
        const pz = r.point[2]  + nz * offsetMm;
        row.push([px, py, pz]);
        xyz[w++] = px; xyz[w++] = py; xyz[w++] = pz;
      }
      grid.push(row);
    }
    return { ok: true, uCount: n, vCount: n, xyz, grid };
  } catch (err) {
    return { ok: false, reason: 'surfacing.eval threw',
             message: err && err.message ? err.message : String(err) };
  }
}

/** Commit a displaced control grid as a new NURBS face via
 *  window.forge.surfacing.buildPatch. Returns
 *  { ok, faceHandle, reason, message }. */
export function commitOffsetGrid(gridSpec, { uDeg = 3, vDeg = 3 } = {}) {
  if (typeof window === 'undefined' || !window.forge || !window.forge.surfacing) {
    return { ok: false, reason: 'kernel not ready' };
  }
  const buildPatch = window.forge.surfacing.buildPatch;
  if (typeof buildPatch !== 'function') {
    return { ok: false, reason: 'buildPatch missing' };
  }
  const uKnots = buildPatchKnots(gridSpec.uCount, uDeg);
  const vKnots = buildPatchKnots(gridSpec.vCount, vDeg);
  try {
    // Pass the flat-payload form so our uCount/vCount convention lines
    // up with the kernel's knot-vector sizing check.
    const spec = {
      uCount: gridSpec.uCount, vCount: gridSpec.vCount,
      xyz: gridSpec.xyz,
    };
    const faceHandle = buildPatch(spec, uDeg, vDeg, uKnots, vKnots);
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

/** Append an offset surface body to the live scene. Returns the body
 *  record appended. */
export function appendOffsetBody(faceHandle, {
  sourceBodyId, sourceHandle, offsetMm, samples, name,
}) {
  if (typeof window === 'undefined') return null;
  const ts = Date.now();
  const id = `surface-offset-${ts}`;
  const body = {
    id, kind: 'native', handle: faceHandle,
    toolId: 'surfacing.offsetSurface',
    surface: true,
    params: {
      sourceBodyId, sourceHandle, offsetMm, samples,
    },
    name: name || `Offset Surface ${offsetMm >= 0 ? '+' : ''}${offsetMm.toFixed(1)} mm`,
  };
  if (typeof window.__forgeAppendBody === 'function') {
    window.__forgeAppendBody(body);
  }
  return body;
}

/** Top-level driver — pick source → sample displaced grid → buildPatch
 *  → __forgeAppendBody → bus event. Used by both the panel button and
 *  the e2e spec / Archie tool calls. */
export function runSurfaceOffsetPipeline({
  sourceBodyId = null,
  sourceHandle = null,
  offsetMm = SURFACE_OFFSET_DEFAULT_DISTANCE,
  samples = SURFACE_OFFSET_DEFAULT_SAMPLES,
  autoSeed = true,
} = {}) {
  let resolvedHandle = sourceHandle;
  let resolvedId = sourceBodyId;
  let seedBody = null;

  // Resolve source by id if no explicit handle.
  if (!Number.isFinite(resolvedHandle) && resolvedId != null) {
    const bodies = listSurfaceBodies();
    const hit = bodies.find((b) => b.id === resolvedId);
    if (hit) resolvedHandle = hit.handle;
  }

  // No explicit source — try a surface body in the scene. If none
  // exists and autoSeed is on, build the saddle preset on the fly so
  // the panel always has something to offset.
  if (!Number.isFinite(resolvedHandle)) {
    const surfaces = listSurfaceBodies();
    if (surfaces.length > 0) {
      // Pick the most recent surface body (LIFO order matches the picker
      // default).
      const pick = surfaces[surfaces.length - 1];
      resolvedHandle = pick.handle;
      resolvedId     = pick.id;
    } else if (autoSeed) {
      const seed = buildSourceSeedSurface({ samples });
      if (!seed.ok) {
        return { ok: false, reason: seed.reason, message: seed.message };
      }
      resolvedHandle = seed.faceHandle;
      seedBody = appendSeedBody(seed.faceHandle);
      resolvedId = seedBody ? seedBody.id : null;
    } else {
      return { ok: false, reason: 'no source surface available' };
    }
  }

  // Sample and displace.
  const sampled = sampleOffsetGrid(resolvedHandle, offsetMm, samples);
  if (!sampled.ok) {
    return { ok: false, reason: sampled.reason, message: sampled.message,
             sourceHandle: resolvedHandle, sourceBodyId: resolvedId };
  }

  const committed = commitOffsetGrid({
    uCount: sampled.uCount, vCount: sampled.vCount, xyz: sampled.xyz,
  });
  if (!committed.ok) {
    return { ok: false, reason: committed.reason, message: committed.message,
             sourceHandle: resolvedHandle, sourceBodyId: resolvedId,
             gridSpec: sampled };
  }

  const newBody = appendOffsetBody(committed.faceHandle, {
    sourceBodyId: resolvedId, sourceHandle: resolvedHandle,
    offsetMm, samples,
  });

  // Broadcast so the e2e / Archie tool call / activity log can subscribe.
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FORGE_SURFACE_OFFSET_EVENT, {
        detail: {
          faceHandle: committed.faceHandle,
          bodyId: newBody?.id,
          sourceBodyId: resolvedId,
          sourceHandle: resolvedHandle,
          seedBodyId: seedBody?.id || null,
          offsetMm, samples,
          ts: Date.now(),
        },
      }));
    }
  } catch { /* fail soft — CustomEvent is universal in Electron */ }

  return {
    ok: true, faceHandle: committed.faceHandle, body: newBody,
    sourceHandle: resolvedHandle, sourceBodyId: resolvedId,
    seedBody, gridSpec: sampled,
    uKnots: committed.uKnots, vKnots: committed.vKnots,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Side-effect helper API install — same pattern as ClassABlendPanel.
// The moment this module is imported (which App.jsx does once the bundle
// loads), the helper API mirror is available on window. This is the
// contract surface plugins / e2e / Archie tool calls rely on.

if (typeof window !== 'undefined') {
  try {
    window.__forgeSurfaceOffsetHelper = Object.freeze({
      listSurfaceBodies,
      readSelectedSurfaceBody,
      buildSourceSeedSurface,
      appendSeedBody,
      sampleOffsetGrid,
      commitOffsetGrid,
      appendOffsetBody,
      runSurfaceOffsetPipeline,
      EVENT_NAME:     FORGE_SURFACE_OFFSET_EVENT,
      STORAGE_KEY:    FORGE_SURFACE_OFFSET_STORAGE,
      DEFAULT_SAMPLES: SURFACE_OFFSET_DEFAULT_SAMPLES,
      DEFAULT_DISTANCE: SURFACE_OFFSET_DEFAULT_DISTANCE,
      MIN_DISTANCE:    SURFACE_OFFSET_MIN,
      MAX_DISTANCE:    SURFACE_OFFSET_MAX,
      SEED_TAG:        SURFACE_OFFSET_SEED_TAG,
    });
    // Bus subscriber for tools.surfaceOffset that doesn't depend on the
    // React Host being mounted — surfaces a window.__forgeSurfaceOffsetLastMenuTs
    // the e2e can poll on even if the React host hasn't booted yet.
    window.addEventListener('forge:menu-action', (e) => {
      if (e?.detail?.id === 'tools.surfaceOffset') {
        window.__forgeSurfaceOffsetLastMenuTs = Date.now();
      }
    });
  } catch { /* fail soft — defensive in SSR / non-window envs */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same right-docked rail as PUSH-85 / PUSH-102 panels.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 460,
  zIndex: 1334,
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
const SOURCE_ROW = {
  display: 'flex', alignItems: 'center', gap: 6,
};
const SELECT_STYLE = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  flex: 1, minWidth: 0,
};
const SMALL_BTN = {
  background: 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  cursor: 'pointer', padding: '3px 8px', borderRadius: 3, fontSize: 11,
};
const SLIDER_ROW = {
  display: 'grid', gridTemplateColumns: '1fr 70px', gap: 8, alignItems: 'center',
};
const SLIDER_STYLE = { width: '100%' };
const NUM_INPUT_STYLE = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '3px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  textAlign: 'right', width: '100%', boxSizing: 'border-box',
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
const STATUS_PILL = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  padding: '1px 6px',
  borderRadius: 'var(--forge-radius-pill, 10px)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function SurfaceOffsetPanel({ open, onClose }) {
  const [sourceId, setSourceId] = useState(null);
  const [offsetMm, setOffsetMm] = useState(() => {
    if (typeof localStorage === 'undefined') return SURFACE_OFFSET_DEFAULT_DISTANCE;
    try {
      const raw = localStorage.getItem(FORGE_SURFACE_OFFSET_STORAGE);
      if (!raw) return SURFACE_OFFSET_DEFAULT_DISTANCE;
      const blob = JSON.parse(raw);
      const v = Number(blob.offsetMm);
      if (Number.isFinite(v) && v >= SURFACE_OFFSET_MIN && v <= SURFACE_OFFSET_MAX) {
        return v;
      }
      return SURFACE_OFFSET_DEFAULT_DISTANCE;
    } catch { return SURFACE_OFFSET_DEFAULT_DISTANCE; }
  });
  const [surfaces, setSurfaces] = useState(() => listSurfaceBodies());
  const [log, setLog] = useState([]);
  const lastFaceRef = useRef(null);

  // Persist offset distance to localStorage so a panel re-open boots the
  // same slider position the user just exercised.
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(FORGE_SURFACE_OFFSET_STORAGE,
        JSON.stringify({ offsetMm }));
    } catch { /* quota / private mode — fail soft */ }
  }, [offsetMm]);

  // Refresh the surface list when the panel opens + on bodies-changed
  // events. The Bodies bus is the same one BodyColorsPanel listens to.
  useEffect(() => {
    if (!open) return undefined;
    const refresh = () => {
      const list = listSurfaceBodies();
      setSurfaces(list);
      // Auto-pick the most-recent surface (or the selected body, if it's
      // a surface) the first time the panel sees a non-empty list.
      const picked = readSelectedSurfaceBody();
      if (picked) setSourceId(picked.id);
      else if (list.length > 0) setSourceId((prev) => prev ?? list[list.length - 1].id);
    };
    refresh();
    setLog([]);
    window.addEventListener('forge:selection-changed', refresh);
    window.addEventListener('forge:bodies-changed', refresh);
    return () => {
      window.removeEventListener('forge:selection-changed', refresh);
      window.removeEventListener('forge:bodies-changed', refresh);
    };
  }, [open]);

  // The picker source row only renders the chosen source — handle and id
  // come from looking it up in the surfaces list on demand.
  const sourceBody = useMemo(() => {
    if (sourceId == null) return null;
    return surfaces.find((b) => b.id === sourceId) || null;
  }, [sourceId, surfaces]);

  const onSetSource = useCallback((e) => {
    const v = e.target.value || null;
    setSourceId(v === '' ? null : v);
  }, []);

  const onChangeOffset = useCallback((e) => {
    let v = Number(e.target.value);
    if (!Number.isFinite(v)) v = SURFACE_OFFSET_DEFAULT_DISTANCE;
    if (v < SURFACE_OFFSET_MIN) v = SURFACE_OFFSET_MIN;
    if (v > SURFACE_OFFSET_MAX) v = SURFACE_OFFSET_MAX;
    setOffsetMm(v);
  }, []);

  // Seed a default source surface on demand — the panel can hand-roll
  // the saddle when nothing's in the scene.
  const onSeedSource = useCallback(() => {
    const seed = buildSourceSeedSurface();
    if (!seed.ok) {
      setLog((l) => [...l.slice(-12), {
        ok: false, ts: Date.now(),
        message: `Seed failed: ${seed.reason}${seed.message ? ' · ' + seed.message : ''}`,
      }]);
      return;
    }
    const body = appendSeedBody(seed.faceHandle);
    setSurfaces(listSurfaceBodies());
    if (body) setSourceId(body.id);
    setLog((l) => [...l.slice(-12), {
      ok: true, ts: Date.now(),
      message: `Seeded saddle source → face ${seed.faceHandle}`,
    }]);
  }, []);

  // Apply — the headline button. Drives the same pipeline the e2e + the
  // Archie tool-call paths land on. autoSeed is on so the panel works
  // even when nothing's in the scene yet.
  const onApply = useCallback(() => {
    const r = runSurfaceOffsetPipeline({
      sourceBodyId: sourceBody ? sourceBody.id : null,
      sourceHandle: sourceBody ? sourceBody.handle : null,
      offsetMm,
      samples: SURFACE_OFFSET_DEFAULT_SAMPLES,
      autoSeed: true,
    });
    if (r.ok) {
      lastFaceRef.current = r.faceHandle;
      setSurfaces(listSurfaceBodies());
      if (r.seedBody) setSourceId(r.seedBody.id);
    }
    setLog((l) => [
      ...l.slice(-12),
      {
        ok: r.ok, ts: Date.now(),
        message: r.ok
          ? `Offset ${offsetMm.toFixed(2)} mm → face ${r.faceHandle} (source ${r.sourceHandle})`
          : `Apply failed: ${r.reason || 'error'}${r.message ? ' · ' + r.message : ''}`,
      },
    ]);
  }, [sourceBody, offsetMm]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const sliderPct = ((offsetMm - SURFACE_OFFSET_MIN)
                  / (SURFACE_OFFSET_MAX - SURFACE_OFFSET_MIN)) * 100;

  return createPortal(
    <div role="dialog"
         aria-label="Surface offset"
         data-testid="forge-surface-offset-panel"
         data-offset={String(offsetMm)}
         data-source-id={sourceId == null ? '' : String(sourceId)}
         data-source-handle={sourceBody && Number.isFinite(sourceBody.handle)
                              ? String(sourceBody.handle) : ''}
         data-source-count={String(surfaces.length)}
         data-last-face={lastFaceRef.current == null ? '' : String(lastFaceRef.current)}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="sketch.spline" size={14} />
        <strong style={{ fontSize: 13 }}>Surface Offset</strong>
        <span style={STATUS_PILL}>Normal displace</span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Surface Offset panel"
                data-testid="forge-surface-offset-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
        Pick a surface body and offset it along the surface normal at
        every UV sample. Builds a brand-new OCCT NURBS face through
        surfacing.eval + surfacing.buildPatch. Equivalent to one side of
        BRepOffsetAPI_MakeOffsetShape.
      </div>

      <div style={SECTION_TITLE}>Source surface</div>
      <div style={SECTION_BOX}>
        <div style={SOURCE_ROW}>
          <select value={sourceId == null ? '' : sourceId}
                  onChange={onSetSource}
                  data-testid="forge-surface-offset-source-select"
                  aria-label="Source surface body"
                  style={SELECT_STYLE}>
            <option value="">
              {surfaces.length === 0
                ? '— no surface bodies — Apply will auto-seed saddle —'
                : '— pick a surface body —'}
            </option>
            {surfaces.map((b) => (
              <option key={b.id} value={b.id}>
                {`${b.name || b.toolId || b.id}  ·  handle ${b.handle}`}
              </option>
            ))}
          </select>
          <button type="button"
                  onClick={onSeedSource}
                  data-testid="forge-surface-offset-seed"
                  title="Build a 100 mm saddle source surface"
                  style={SMALL_BTN}>+ Seed saddle</button>
        </div>
        <div data-testid="forge-surface-offset-source-status"
             style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {sourceBody
            ? `face handle ${sourceBody.handle} · ${sourceBody.name || sourceBody.toolId}`
            : surfaces.length === 0
              ? 'scene has no surface bodies — Apply will seed one'
              : `${surfaces.length} surface bodies in scene`}
        </div>
      </div>

      <div style={SECTION_TITLE}>Offset distance (mm)</div>
      <div style={SECTION_BOX}>
        <div style={SLIDER_ROW}>
          <input type="range"
                 min={SURFACE_OFFSET_MIN}
                 max={SURFACE_OFFSET_MAX}
                 step="0.1"
                 value={offsetMm}
                 onChange={onChangeOffset}
                 data-testid="forge-surface-offset-slider"
                 aria-label="Offset distance"
                 style={SLIDER_STYLE} />
          <input type="number"
                 min={SURFACE_OFFSET_MIN}
                 max={SURFACE_OFFSET_MAX}
                 step="0.1"
                 value={offsetMm}
                 onChange={onChangeOffset}
                 data-testid="forge-surface-offset-number"
                 aria-label="Offset distance (mm)"
                 style={NUM_INPUT_STYLE} />
        </div>
        <div style={{ fontSize: 10,
                      color: 'var(--forge-ink-mute, #9aa1ab)',
                      display: 'flex', justifyContent: 'space-between' }}>
          <span>{`${SURFACE_OFFSET_MIN.toFixed(0)} mm`}</span>
          <span data-testid="forge-surface-offset-pct">
            {`slider ${sliderPct.toFixed(1)}% · ${offsetMm.toFixed(2)} mm`}
          </span>
          <span>{`${SURFACE_OFFSET_MAX.toFixed(0)} mm`}</span>
        </div>
      </div>

      <div style={SECTION_TITLE}>Apply</div>
      <div style={SECTION_BOX}>
        <button type="button"
                onClick={onApply}
                data-testid="forge-surface-offset-apply"
                style={ACTION_BTN('primary')}>
          Apply — Build offset surface
        </button>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {`${SURFACE_OFFSET_DEFAULT_SAMPLES}×${SURFACE_OFFSET_DEFAULT_SAMPLES} UV samples · degree 3 · open-uniform knots`}
        </span>
      </div>

      <div style={SECTION_TITLE}>Log</div>
      <div data-testid="forge-surface-offset-log"
           data-log-count={log.length}
           style={LOG_BOX}>
        {log.length === 0 ? (
          <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>
            no offsets yet
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
// Host — listens for the `tools.surfaceOffset` menu action, exposes the
// imperative open/close hooks for plugins / e2e / Archie tool calls.

export function SurfaceOffsetPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSurfaceOffset  = () => setOpen(true);
    window.__forgeCloseSurfaceOffset = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.surfaceOffset') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenSurfaceOffset; } catch {}
      try { delete window.__forgeCloseSurfaceOffset; } catch {}
    };
  }, []);
  // Only mount the panel subtree when open. Makes the useState
  // initializer (which reads localStorage) run fresh on each open,
  // honouring any test-fixture clears that happen after app boot.
  if (!open) return null;
  return <SurfaceOffsetPanel open={open} onClose={() => setOpen(false)} />;
}

export default SurfaceOffsetPanel;
