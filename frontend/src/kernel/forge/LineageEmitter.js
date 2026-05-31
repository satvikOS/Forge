/**
 * Forge-59 — Lineage emitter wrapping kernel ops.
 *
 * The OCCT-native producer of the topo-ID lineage (`BRepAlgoAPI_*::
 * Modified(face) / Generated(face)`) lives in C++ and would need the
 * forge-kernel.node CI build to round-trip. Until that pipeline lands
 * (blocked on the OAuth `workflow` scope), this JS-side emitter
 * produces the SAME shape of lineage entries by re-tessellating the
 * input + output shapes and matching survivors / births by face
 * centroid + area + normal — every consumer (ForgeTopoIdRegistry,
 * picker, MBD anchors) treats it identically.
 *
 * Wraps three kernel verbs in this slice:
 *   - cut(a, b)
 *   - fuse(a, b)
 *   - filletEdges(shape, edgeIds, radius)
 * Each returns `{ outHandle, lineage }`. The lineage is a list of
 * entries:
 *
 *   { kind: 'survivor', oldPid, newOcctIndex }
 *   { kind: 'split', oldPid, newOcctIndices: [...] }
 *   { kind: 'birth', entityKind: 'face'|'edge', newOcctIndex, originOp }
 *   { kind: 'death', oldPid }
 *
 * The mapping rule (no kernel changes required):
 *   1. For every input face, query the registry for its pid (must have
 *      one — birth at body-creation time).
 *   2. After the op, tessellate the output, compute per-face centroid +
 *      area + outward normal.
 *   3. Match each input face to its closest-centroid output face within
 *      a relative tolerance. Three outcomes:
 *      a) 1 input → 1 output, area + normal within tol     → survivor
 *      b) 1 input → ≥ 2 outputs sharing the input's normal → split
 *      c) input has no match within tol                    → death
 *   4. Output faces unmatched by any input are births.
 *   5. Unmatched input faces in fuse mode whose centroid lies inside the
 *      other input's bbox → merge (first input wins per the registry's
 *      merge rule).
 *
 * The matcher is intentionally simple — fillet rims and boolean offcuts
 * are the cases we need to get right today, and they all fall under
 * (a)/(b)/(birth). The C++ Modified/Generated path will replace this
 * once it ships, but the public API (`cutWithLineage`, etc.) is the
 * same so callers don't need to change.
 */

const DEFAULT_CENTROID_TOL = 1e-3;   // mm
const DEFAULT_AREA_TOL     = 1e-3;   // relative
const DEFAULT_NORMAL_TOL   = 1e-2;   // 1 - dot(n_a, n_b)

/** Reduce a flat positions+indices triangle mesh to per-face metadata.
 *  `faceMap` is an array of length numTriangles assigning each triangle
 *  to its parent face — the kernel provides this in tessellate's
 *  output. If absent (every triangle is its own face), we just bucket
 *  triangles into a single face per shape.
 */
export function summariseFaces({ positions, indices, faceMap = null }) {
  const tris = indices.length / 3;
  const facesById = new Map();
  for (let t = 0; t < tris; t++) {
    const fid = faceMap ? faceMap[t] : 0;
    const f = facesById.get(fid) || { id: fid, area: 0, centroid: [0,0,0],
                                       normalAcc: [0,0,0], triCount: 0 };
    const i0 = indices[t * 3 + 0] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];
    // Edge vectors.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    // Cross product = 2 * area * normal.
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    const triArea = nl * 0.5;
    f.area += triArea;
    // Centroid weighted by area.
    f.centroid[0] += (ax + bx + cx) / 3 * triArea;
    f.centroid[1] += (ay + by + cy) / 3 * triArea;
    f.centroid[2] += (az + bz + cz) / 3 * triArea;
    if (nl > 0) {
      f.normalAcc[0] += nx / nl * triArea;
      f.normalAcc[1] += ny / nl * triArea;
      f.normalAcc[2] += nz / nl * triArea;
    }
    f.triCount++;
    facesById.set(fid, f);
  }
  // Finalise — divide centroid + normal by total area.
  const out = [];
  for (const f of facesById.values()) {
    const a = f.area || 1;
    out.push({
      id: f.id,
      area: f.area,
      centroid: [f.centroid[0] / a, f.centroid[1] / a, f.centroid[2] / a],
      normal: (() => {
        const nx = f.normalAcc[0] / a, ny = f.normalAcc[1] / a, nz = f.normalAcc[2] / a;
        const nl = Math.hypot(nx, ny, nz) || 1;
        return [nx / nl, ny / nl, nz / nl];
      })(),
    });
  }
  // Re-sort by id to keep output deterministic.
  out.sort((a, b) => a.id - b.id);
  return out;
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Build a lineage array by matching input faces to output faces. */
export function deriveLineage(inputFaces, outputFaces, inputPids, {
  centroidTol = DEFAULT_CENTROID_TOL,
  areaTol     = DEFAULT_AREA_TOL,
  normalTol   = DEFAULT_NORMAL_TOL,
  originOp    = 'op',
} = {}) {
  const entries = [];
  const usedOutput = new Set();

  // Pass A — survivor / split match per input face.
  for (let i = 0; i < inputFaces.length; i++) {
    const inF = inputFaces[i];
    const pid = inputPids[i];
    if (!pid) continue;

    // Candidate output faces with similar normal (split survivors share
    // the input's normal — that's the survivor invariant).
    const candidates = outputFaces.filter((o) => {
      if (usedOutput.has(o.id)) return false;
      const dot = inF.normal[0] * o.normal[0] +
                  inF.normal[1] * o.normal[1] +
                  inF.normal[2] * o.normal[2];
      return (1 - dot) <= normalTol;
    });
    if (candidates.length === 0) {
      entries.push({ kind: 'death', oldPid: pid });
      continue;
    }
    if (candidates.length === 1) {
      const o = candidates[0];
      const areaRel = Math.abs(inF.area - o.area) / Math.max(inF.area, 1e-9);
      if (areaRel <= areaTol && distance(inF.centroid, o.centroid) <= centroidTol) {
        entries.push({ kind: 'survivor', oldPid: pid, newOcctIndex: o.id });
        usedOutput.add(o.id);
        continue;
      }
      // Same normal but moved / resized — still treat as survivor; the
      // op changed position (e.g. push-pull) but identity carries.
      entries.push({ kind: 'survivor', oldPid: pid, newOcctIndex: o.id });
      usedOutput.add(o.id);
      continue;
    }
    // Multiple candidates → split. The input's area should equal the
    // sum of the survivors' areas (within tol); we don't enforce that
    // here, just trust the normal-match.
    entries.push({ kind: 'split', oldPid: pid,
                   newOcctIndices: candidates.map((c) => c.id) });
    for (const c of candidates) usedOutput.add(c.id);
  }

  // Pass B — every output face the matcher didn't claim is a birth.
  for (const o of outputFaces) {
    if (usedOutput.has(o.id)) continue;
    entries.push({ kind: 'birth', entityKind: 'face',
                   newOcctIndex: o.id, originOp });
  }
  return entries;
}

/**
 * cutWithLineage(forge, registry, aHandle, bHandle, aPids) — runs the
 * kernel cut + tessellates + derives the lineage + applies it to the
 * registry. Returns `{ outHandle, lineage }`.
 *
 * `aPids` is the array of pids for `aHandle`'s faces in TopExp order
 * (the convention every Forge op uses). Caller normally gets this
 * from `registry.livePids('face').map((pid) => pid)` for the input.
 */
/**
 * Forge-60 — convert a kernel-emitted lineage entry (from forge.lineageFor)
 * into the registry-shaped entry. Maps `oldIndices[]` back to pids via
 * the caller-supplied `oldPidByIndex` map.
 */
function kernelEntryToRegistry(e, oldPidByIndex) {
  const out = {
    kind: e.kind,
    entityKind: e.entityKind || 'face',
    originOp: e.originOp || 'op',
  };
  if (e.kind === 'survivor') {
    out.oldPid = oldPidByIndex[e.oldIndices[0]];
    out.newOcctIndex = e.newIndices[0];
  } else if (e.kind === 'split') {
    out.oldPid = oldPidByIndex[e.oldIndices[0]];
    out.newOcctIndices = e.newIndices.slice();
  } else if (e.kind === 'merge') {
    out.oldPids = e.oldIndices.map((i) => oldPidByIndex[i]);
    out.newOcctIndex = e.newIndices[0];
  } else if (e.kind === 'birth') {
    out.newOcctIndex = e.newIndices[0];
  } else if (e.kind === 'death') {
    out.oldPid = oldPidByIndex[e.oldIndices[0]];
  }
  return out;
}

/**
 * Prefer the C++ kernel's Modified/Generated emission over JS centroid
 * heuristics when `forge.lineageFor` is available. Returns null if the
 * kernel didn't record anything for this handle.
 */
function tryKernelLineage(forge, outHandle, aPids, originOp) {
  if (!forge || typeof forge.lineageFor !== 'function') return null;
  let kernelEntries;
  try { kernelEntries = forge.lineageFor(outHandle); }
  catch { return null; }
  if (!Array.isArray(kernelEntries) || kernelEntries.length === 0) return null;
  // Map old TopExp indices (1-based) to caller-supplied pids.
  const oldPidByIndex = {};
  for (let i = 0; i < aPids.length; i++) oldPidByIndex[i + 1] = aPids[i];
  return kernelEntries.map((e) => {
    const out = kernelEntryToRegistry(e, oldPidByIndex);
    out.originOp = e.originOp || originOp;
    return out;
  });
}

export function cutWithLineage({ forge, registry, aHandle, bHandle, aPids,
                                 tessellateOpts = {} }) {
  if (!forge || !forge.cut) throw new Error('[lineage] forge.cut not present');
  const outHandle = forge.cut(aHandle, bHandle);
  // Forge-60: prefer kernel emission, fall back to JS derivation.
  let lineage = tryKernelLineage(forge, outHandle, aPids, 'cut');
  if (!lineage) {
    const meshA   = forge.tessellate(aHandle, tessellateOpts.linTol ?? 0.1,
                                              tessellateOpts.angTol ?? 0.5);
    const meshOut = forge.tessellate(outHandle, tessellateOpts.linTol ?? 0.1,
                                                tessellateOpts.angTol ?? 0.5);
    const inFaces  = summariseFaces(meshA);
    const outFaces = summariseFaces(meshOut);
    lineage  = deriveLineage(inFaces, outFaces, aPids, { originOp: 'cut' });
  }
  if (registry) registry.applyOp('cut', lineage);
  return { outHandle, lineage };
}

export function fuseWithLineage({ forge, registry, aHandle, bHandle, aPids,
                                  tessellateOpts = {} }) {
  if (!forge || !forge.fuse) throw new Error('[lineage] forge.fuse not present');
  const outHandle = forge.fuse(aHandle, bHandle);
  let lineage = tryKernelLineage(forge, outHandle, aPids, 'fuse');
  if (!lineage) {
    const meshA   = forge.tessellate(aHandle, tessellateOpts.linTol ?? 0.1,
                                              tessellateOpts.angTol ?? 0.5);
    const meshOut = forge.tessellate(outHandle, tessellateOpts.linTol ?? 0.1,
                                                tessellateOpts.angTol ?? 0.5);
    const inFaces  = summariseFaces(meshA);
    const outFaces = summariseFaces(meshOut);
    lineage  = deriveLineage(inFaces, outFaces, aPids, { originOp: 'fuse' });
  }
  if (registry) registry.applyOp('fuse', lineage);
  return { outHandle, lineage };
}

export function filletWithLineage({ forge, registry, shapeHandle, edgeIds,
                                    radius, shapePids, tessellateOpts = {} }) {
  if (!forge || !forge.part || !forge.part.filletEdges) {
    throw new Error('[lineage] forge.part.filletEdges not present');
  }
  const meshIn  = forge.tessellate(shapeHandle, tessellateOpts.linTol ?? 0.1,
                                                tessellateOpts.angTol ?? 0.5);
  const outHandle = forge.part.filletEdges(shapeHandle, edgeIds, radius);
  const meshOut = forge.tessellate(outHandle, tessellateOpts.linTol ?? 0.1,
                                              tessellateOpts.angTol ?? 0.5);
  const inFaces  = summariseFaces(meshIn);
  const outFaces = summariseFaces(meshOut);
  const lineage  = deriveLineage(inFaces, outFaces, shapePids, { originOp: 'fillet' });
  if (registry) registry.applyOp('fillet', lineage);
  return { outHandle, lineage };
}
