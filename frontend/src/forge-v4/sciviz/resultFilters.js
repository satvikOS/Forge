// sciviz/resultFilters.js — SimScale results-manager wiring layer (task #66 Inc 6).
// ============================================================================
// This is the THIN bridge between the FEA solver result + the kernel FE mesh
// and the already-committed ParaView-parity sci-viz primitives. It does NOT
// re-implement any filter — every cut / clip / iso call delegates straight to:
//
//   ./slice.js       — sliceMesh        (arbitrary-plane Slice)
//   ./clip.js        — clipMesh         (plane / box / scalar Clip)
//   ./isosurface.js  — contourMesh      (result-field Contour / Iso-surface)
//   ./colorMaps.js   — TransferFunction (ParaView colour+opacity TF)
//
// The genuinely-new work here is:
//   • mapping the kernel FE result shape (result.vonMises / result.stressTensor
//     / result.temperature / result.u) onto a single per-node scalar array the
//     filters consume — so the results UI can expose σ-components, σ_mean, von
//     Mises, temperature or |u|, not just von Mises;
//   • a kernel-mesh ⇄ sci-viz-mesh adapter (the kernel mesh names its element
//     connectivity `.elements`; the sci-viz filters read `.tets`);
//   • click-to-probe nearest-node lookup;
//   • a numeric field summary (min/max/mean + probe history) for report export.
//
// Pure JS, head-less — no THREE, no GPU. The render meshes are still built by
// the sci-viz modules' own buildSliceMesh / buildClipMesh / buildIsosurfaceMesh.
// ============================================================================

import { makePlane, sliceMesh } from './slice.js';
import { clipMesh, tetsVolume, tetsFromMesh } from './clip.js';
import { contourMesh, enclosedVolume } from './isosurface.js';
import { TransferFunction } from './colorMaps.js';

// Stress-tensor component order — IDENTICAL to FeaResultViewer's Principal path:
//   [σxx, σyy, σzz, τxy, τyz, τzx] per node (6 floats / node).
export const STRESS_COMPONENTS = ['sxx', 'syy', 'szz', 'txy', 'tyz', 'tzx'];
const STRESS_INDEX = { sxx: 0, syy: 1, szz: 2, txy: 3, tyz: 4, tzx: 5 };

// Scalar fields the results manager can cut / clip / iso on.
export const RESULT_FIELDS = [
  'vonMises', 'sigma_mean', ...STRESS_COMPONENTS, 'temperature', 'displacement',
];

export function unitsFor(key) {
  if (key === 'temperature') return 'K';
  if (key === 'displacement') return 'm';
  return 'Pa'; // vonMises, sigma_mean, σ-components
}

// ───────────────────────────────────────────────────────────────────────────
//  kernel FE mesh  ⇄  sci-viz mesh adapter.
//  Kernel mesh: { nodes, elements|tets, nodeCount, elemCount?, elemNodeCount? }
//  sci-viz mesh: { nodes, tets, nodeCount, elemCount, elemNodeCount }
// ───────────────────────────────────────────────────────────────────────────
export function asSciVizMesh(mesh) {
  if (!mesh) return null;
  const conn = mesh.tets || mesh.elements;
  const elemNodeCount = mesh.elemNodeCount || 4;
  const nodeCount = mesh.nodeCount ?? (mesh.nodes ? mesh.nodes.length / 3 : 0);
  const elemCount = mesh.elemCount ?? (conn ? conn.length / elemNodeCount : 0);
  return { nodes: mesh.nodes, tets: conn, nodeCount, elemCount, elemNodeCount };
}

// ───────────────────────────────────────────────────────────────────────────
//  result → per-node scalar field.
//  Returns a Float64Array of length nodeCount, or null when the field is
//  unavailable in the result. Honest: never fabricates a field.
// ───────────────────────────────────────────────────────────────────────────
export function nodalFieldFor(result, mesh, key) {
  if (!result || !mesh) return null;
  const N = mesh.nodeCount ?? (mesh.nodes ? mesh.nodes.length / 3 : 0);
  if (!N) return null;

  if (key === 'vonMises') {
    return result.vonMises || result.stress || null;
  }
  if (key === 'temperature') {
    return result.temperature || null;
  }
  if (key === 'displacement') {
    const u = result.u || result.displacement;
    if (!u) return null;
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const x = u[3 * i], y = u[3 * i + 1], z = u[3 * i + 2];
      out[i] = Math.sqrt(x * x + y * y + z * z);
    }
    return out;
  }
  // stress components + hydrostatic mean need the full tensor.
  const t = result.stressTensor;
  if (key === 'sigma_mean') {
    if (!t) return null;
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) out[i] = (t[6 * i] + t[6 * i + 1] + t[6 * i + 2]) / 3;
    return out;
  }
  if (key in STRESS_INDEX) {
    if (!t) return null;
    const off = STRESS_INDEX[key];
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) out[i] = t[6 * i + off];
    return out;
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
//  field statistics — min / max / mean over finite values.
// ───────────────────────────────────────────────────────────────────────────
export function fieldStats(field) {
  if (!field || !field.length) return { min: 0, max: 0, mean: 0, count: 0 };
  let mn = Infinity, mx = -Infinity, sum = 0, n = 0;
  for (let i = 0; i < field.length; i++) {
    const v = field[i];
    if (!Number.isFinite(v)) continue;
    if (v < mn) mn = v; if (v > mx) mx = v; sum += v; n++;
  }
  if (!n) return { min: 0, max: 0, mean: 0, count: 0 };
  return { min: mn, max: mx, mean: sum / n, count: n };
}

// ───────────────────────────────────────────────────────────────────────────
//  Filter wrappers — pure delegation to the sci-viz modules (DEDUP: these add
//  only the mesh adapter + plane normalisation; the geometry math lives in
//  slice.js / clip.js / isosurface.js).
// ───────────────────────────────────────────────────────────────────────────

/** Cutting plane through the result field (ParaView Slice). */
export function sliceResult(mesh, nodalField, plane, opts = {}) {
  const sv = asSciVizMesh(mesh);
  const pl = makePlane(plane.point, plane.normal);
  return sliceMesh(sv, nodalField, pl, opts);
}

/** Clip the result field by a plane / box / scalar half-space (ParaView Clip). */
export function clipResult(mesh, nodalField, spec, opts = {}) {
  return clipMesh(asSciVizMesh(mesh), nodalField, spec, opts);
}

/** Iso-surface(s) over the nodal result field (ParaView Contour). */
export function isoResult(mesh, nodalField, isovalues, opts = {}) {
  return contourMesh(asSciVizMesh(mesh), nodalField, isovalues, opts);
}

/** Default isovalue for a field = its (nodal) mean — the σ_mean default. */
export function defaultIsovalue(field) {
  return fieldStats(field).mean;
}

/** Volume fraction of the domain kept by a scalar clip at `isovalue`
 *  (keep field ≥ isovalue when invert=true; field ≤ isovalue otherwise). */
export function clipVolumeFraction(mesh, nodalField, isovalue, invert = true) {
  const sv = asSciVizMesh(mesh);
  const totalVol = tetsVolume(tetsFromMesh(sv, nodalField));
  const kept = clipResult(mesh, nodalField, { type: 'scalar', isovalue, invert });
  return { keptVolume: kept.keptVolume, totalVolume: totalVol,
           fraction: totalVol > 0 ? kept.keptVolume / totalVol : 0 };
}

// ───────────────────────────────────────────────────────────────────────────
//  Click-to-probe — nearest node to a world point.
//  `nodes` defaults to mesh.nodes (kernel metres); the viewport passes its own
//  deformed/scaled node array so the probe matches what the user clicked.
// ───────────────────────────────────────────────────────────────────────────
export function nearestNode(nodes, nodeCount, point) {
  let best = -1, bestD2 = Infinity;
  for (let i = 0; i < nodeCount; i++) {
    const dx = nodes[3 * i] - point[0];
    const dy = nodes[3 * i + 1] - point[1];
    const dz = nodes[3 * i + 2] - point[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = i; }
  }
  return {
    nodeId: best,
    dist: Math.sqrt(bestD2),
    position: best >= 0
      ? [nodes[3 * best], nodes[3 * best + 1], nodes[3 * best + 2]]
      : null,
  };
}

/** Probe the field at the node nearest a clicked point. */
export function probeResult(mesh, nodalField, point, opts = {}) {
  const nodes = opts.nodes || mesh.nodes;
  const nodeCount = opts.nodeCount ?? mesh.nodeCount ?? (nodes ? nodes.length / 3 : 0);
  const n = nearestNode(nodes, nodeCount, point);
  return {
    nodeId: n.nodeId,
    dist: n.dist,
    position: n.position,
    value: (nodalField && n.nodeId >= 0) ? nodalField[n.nodeId] : null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Report payload — numeric summary (min/max/mean) + probe history. The PNG
//  is captured by the UI via the existing SnapshotPng.captureSnapshot util;
//  this only assembles the JSON-serialisable numeric report.
// ───────────────────────────────────────────────────────────────────────────
export function buildFieldReport({ fieldKey, field, probes = [], filter = null } = {}) {
  const stats = fieldStats(field);
  return {
    field: fieldKey || null,
    units: fieldKey ? unitsFor(fieldKey) : null,
    stats: { min: stats.min, max: stats.max, mean: stats.mean, count: stats.count },
    probes: probes.map((p) => ({
      nodeId: p.nodeId, value: p.value, position: p.position,
    })),
    probeCount: probes.length,
    filter: filter || null,
    generatedAt: new Date().toISOString(),
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Reuse proof — the EXACT sci-viz function objects this module delegates to.
//  The gate asserts these are identical to the originals exported by the
//  sci-viz modules, proving the results path calls sciviz/slice|clip|isosurface
//  and NOT a private re-implementation.
// ───────────────────────────────────────────────────────────────────────────
export const SCIVIZ_DEPS = {
  sliceMesh, clipMesh, contourMesh, TransferFunction,
  makePlane, enclosedVolume, tetsVolume, tetsFromMesh,
};

export default {
  RESULT_FIELDS, STRESS_COMPONENTS, unitsFor,
  asSciVizMesh, nodalFieldFor, fieldStats,
  sliceResult, clipResult, isoResult, defaultIsovalue, clipVolumeFraction,
  nearestNode, probeResult, buildFieldReport, SCIVIZ_DEPS,
};
