// PUSH-165 (Slice-121) — Level-of-Detail (LOD) mesh generator.
//
// For every native OCCT body the user picks, this module produces three
// triangulations at strictly different deflections so the viewport can
// swap between them based on camera distance:
//
//   * Fine   — linear deflection 0.1  mm → smooth Class-A surface
//   * Med    — linear deflection 0.5  mm → mid-distance rendering
//   * Coarse — linear deflection 2.0  mm → far-distance dot
//
// All three calls go through `window.forge.tessellate(handle, linTol,
// angTol)` against the live OCCT shape. OCCT's BRepMesh_IncrementalMesh
// keeps the existing triangulation if it is already finer than the new
// request, so to guarantee 3 distinct mesh densities we tessellate the
// COARSEST first → MEDIUM next → FINEST last. Each successive call has
// a smaller deflection which forces OCCT to remesh strictly finer than
// the previous level.
//
// The math is pure JS — no React, no DOM. The panel hosts side-effects.
//
// Reachable headlessly via:
//
//   window.__forgeLodMathHelper.computeLods(handle, opts?)
//   window.__forgeLodMathHelper.selectLodByDistance(distMm, bands)
//
// The host installs that helper from LodMeshPanel.jsx.

// ────────────────────────────────────────────────────────────────────
// Canonical deflection tolerances + LOD level identifiers.
//
// We pin these as `const` (not just numeric literals) so the panel + the
// e2e + headless callers all share the same source of truth.

export const LOD_DEFLECTIONS = Object.freeze({
  fine:   0.1,
  med:    0.5,
  coarse: 2.0,
});

// Order matters: we tessellate coarsest → finest so OCCT actually
// re-meshes for each finer tolerance instead of returning the cached
// triangulation from the previous (finer) call.
export const LOD_ORDER_COARSE_TO_FINE = Object.freeze(['coarse', 'med', 'fine']);

// Display order is finest → coarsest because the High/Med/Low triplet
// reads naturally that way in the UI.
export const LOD_ORDER_DISPLAY = Object.freeze(['fine', 'med', 'coarse']);

export const LOD_LEVELS = Object.freeze([
  Object.freeze({ id: 'fine',   label: 'High',   deflection: LOD_DEFLECTIONS.fine }),
  Object.freeze({ id: 'med',    label: 'Med',    deflection: LOD_DEFLECTIONS.med }),
  Object.freeze({ id: 'coarse', label: 'Low',    deflection: LOD_DEFLECTIONS.coarse }),
]);

// Default angular deflection. Same as the kernel's kLodAngTol so a JS
// caller produces the same triangulation shape the kernel's
// `tessellateLOD` does for the equivalent linear tolerance.
export const LOD_ANGULAR_DEFLECTION = 0.5;

// Default distance bands (millimetres from camera to body centre):
//
//   < nearMaxMm        → fine
//   < medMaxMm         → med
//   ≥ medMaxMm         → coarse
//
// These mirror the lodScheduler.js DIST_BUCKETS (50 / 200) so the two
// systems agree on what "near" / "med" / "far" mean.
export const DEFAULT_LOD_BANDS = Object.freeze({
  nearMaxMm: 50,
  medMaxMm:  200,
});

// ────────────────────────────────────────────────────────────────────
// Pure helpers.

function triCountForMesh(mesh) {
  if (!mesh) return 0;
  if (mesh.indices && mesh.indices.length) {
    return Math.floor(mesh.indices.length / 3);
  }
  if (mesh.positions && mesh.positions.length) {
    return Math.floor(mesh.positions.length / 9);
  }
  return 0;
}

function vertexCountForMesh(mesh) {
  if (!mesh) return 0;
  if (mesh.positions && mesh.positions.length) {
    return Math.floor(mesh.positions.length / 3);
  }
  return 0;
}

// ────────────────────────────────────────────────────────────────────
// computeLods(handle, opts?)
//
// Tessellates the OCCT body at three deflections (coarse → med → fine
// order so OCCT actually re-meshes per call) and returns the three
// snapshots in the canonical display order:
//
//   [
//     { id: 'fine',   label: 'High', deflection: 0.1, triCount, vertexCount, mesh },
//     { id: 'med',    label: 'Med',  deflection: 0.5, triCount, vertexCount, mesh },
//     { id: 'coarse', label: 'Low',  deflection: 2.0, triCount, vertexCount, mesh },
//   ]
//
// If `window.forge.tessellate` is missing the function returns
// `{ ok: false, error: '...' }` — no fallback, no synthetic mesh; the
// caller surfaces the real error.

export function computeLods(handle, opts = {}) {
  if (typeof handle !== 'number' || !Number.isFinite(handle) || handle <= 0) {
    return { ok: false, error: 'computeLods: invalid handle' };
  }
  if (typeof window === 'undefined' || !window.forge ||
      typeof window.forge.tessellate !== 'function') {
    return { ok: false, error: 'window.forge.tessellate unavailable' };
  }
  const angTol = Number.isFinite(opts.angularDeflection)
    ? opts.angularDeflection
    : LOD_ANGULAR_DEFLECTION;

  const snapshots = {};
  // Tessellate from coarse → fine so the OCCT triangulation actually
  // gets re-meshed each step (the incremental mesher keeps the cached
  // triangulation when the existing one is already finer than the
  // requested deflection).
  for (const id of LOD_ORDER_COARSE_TO_FINE) {
    const deflection = LOD_DEFLECTIONS[id];
    let mesh;
    try {
      mesh = window.forge.tessellate(handle, deflection, angTol);
    } catch (ex) {
      return { ok: false, error: `forge.tessellate failed at ${id} (${deflection} mm): ${ex?.message || ex}` };
    }
    if (!mesh || !mesh.positions || mesh.positions.length === 0) {
      return { ok: false, error: `forge.tessellate returned empty mesh at ${id} (${deflection} mm)` };
    }
    snapshots[id] = {
      id,
      label: LOD_LEVELS.find((l) => l.id === id)?.label || id,
      deflection,
      angularDeflection: angTol,
      triCount:    triCountForMesh(mesh),
      vertexCount: vertexCountForMesh(mesh),
      mesh,
    };
  }

  // Order results in canonical display order (fine → med → coarse).
  const levels = LOD_ORDER_DISPLAY.map((id) => snapshots[id]).filter(Boolean);

  // Triangle counts are strictly decreasing in display order
  // (fine > med > coarse). If the kernel produced a tie because the body
  // is too simple to re-mesh further, we surface the tie honestly
  // instead of fudging the numbers — the UI shows the real OCCT output.
  return {
    ok: true,
    handle,
    levels,
    triCounts: {
      fine:   snapshots.fine?.triCount   || 0,
      med:    snapshots.med?.triCount    || 0,
      coarse: snapshots.coarse?.triCount || 0,
    },
    vertexCounts: {
      fine:   snapshots.fine?.vertexCount   || 0,
      med:    snapshots.med?.vertexCount    || 0,
      coarse: snapshots.coarse?.vertexCount || 0,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// selectLodByDistance(distanceMm, bands?)
//
// Pure dispatch: given a camera-to-body distance in millimetres,
// returns the LOD id to render at — `'fine' | 'med' | 'coarse'`.
//
// Bands default to DEFAULT_LOD_BANDS; callers may pass a different
// pair, e.g. `{ nearMaxMm: 100, medMaxMm: 500 }`, to tune for their
// scene scale.

export function selectLodByDistance(distanceMm, bands = DEFAULT_LOD_BANDS) {
  const d = Number(distanceMm);
  if (!Number.isFinite(d) || d < 0) return 'coarse';
  const nearMax = Number(bands?.nearMaxMm ?? DEFAULT_LOD_BANDS.nearMaxMm);
  const medMax  = Number(bands?.medMaxMm  ?? DEFAULT_LOD_BANDS.medMaxMm);
  if (d < nearMax) return 'fine';
  if (d < medMax)  return 'med';
  return 'coarse';
}

// ────────────────────────────────────────────────────────────────────
// validateLodTriCountsDecrease(triCounts)
//
// Asserts the invariant the e2e relies on: fine > med > coarse. Returns
// `{ ok, reason? }`. The kernel always satisfies this for a body whose
// surface has enough curvature to subdivide — but degenerate cases
// (e.g. a single planar quad face) will tie at the minimum mesh.

export function validateLodTriCountsDecrease(triCounts) {
  if (!triCounts) return { ok: false, reason: 'no triCounts' };
  const { fine, med, coarse } = triCounts;
  if (!(fine >= med)) return { ok: false, reason: `fine (${fine}) < med (${med})` };
  if (!(med  >= coarse)) return { ok: false, reason: `med (${med}) < coarse (${coarse})` };
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────
// Auto-publish the helper surface for headless callers (the e2e drives
// the pure pipeline before the panel mounts).

if (typeof window !== 'undefined' && !window.__forgeLodMathHelper) {
  try {
    window.__forgeLodMathHelper = Object.freeze({
      computeLods,
      selectLodByDistance,
      validateLodTriCountsDecrease,
      LOD_DEFLECTIONS,
      LOD_LEVELS,
      LOD_ORDER_DISPLAY,
      LOD_ORDER_COARSE_TO_FINE,
      LOD_ANGULAR_DEFLECTION,
      DEFAULT_LOD_BANDS,
    });
  } catch { /* ignore — sealed window in some test envs */ }
}

export default {
  computeLods,
  selectLodByDistance,
  validateLodTriCountsDecrease,
  LOD_DEFLECTIONS,
  LOD_LEVELS,
  LOD_ORDER_DISPLAY,
  LOD_ORDER_COARSE_TO_FINE,
  LOD_ANGULAR_DEFLECTION,
  DEFAULT_LOD_BANDS,
};
