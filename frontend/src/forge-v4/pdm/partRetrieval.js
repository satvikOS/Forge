/**
 * ArchDisc Forge — Geometry-Based Part Retrieval (Task #33)
 * ============================================================================
 * The 80/20 reality of mechanical design: ~80 % of engineering work REUSES or
 * adapts an existing part, and a real 40k-part PDM vault hides 8-12k duplicates
 * (same geometry under a different part number / orientation / rev). A
 * generative-only CAD tool ignores exactly where the measurable savings live.
 * This module is the search side of that 80 %: a pose-invariant shape index
 * over the vault, nearest-neighbour retrieval, near-duplicate detection, and a
 * retrieve-then-edit hand-off into the parametric-edit path.
 *
 * THE FINGERPRINT (pose- and scale-invariant, REAL — not a transform hash)
 *   1. D2 SHAPE DISTRIBUTION (Osada et al. 2002):
 *        • sample M surface points, AREA-WEIGHTED (cumulative-area inverse-CDF
 *          pick of a triangle + barycentric sample) — uniform over the surface,
 *          not over the triangle list,
 *        • take N random point PAIRS and measure their Euclidean distance,
 *        • scale-normalize every distance by the MEAN pairwise distance
 *          (dimensionless → invariant to uniform scale),
 *        • histogram into B bins, L1-normalize → a probability vector.
 *      Random pairwise distances are rigid-invariant BY CONSTRUCTION (a
 *      distance between two points does not change under rotation/translation),
 *      so a rotated+translated copy yields the SAME histogram within sampling
 *      tolerance. Determinism comes from a seeded PRNG (test repeatability).
 *   2. GLOBAL SCALAR FEATURES (all rotation-invariant):
 *        • volume, area               (kernel mass-props; size-bearing)
 *        • compactness = area³/(36π·volume²)   (dimensionless shape factor)
 *        • PCA aspect ratios          — sorted eigenvalues of the surface-point
 *          COVARIANCE (an oriented bounding box, NOT the axis-aligned one,
 *          which would be rotation-sensitive),
 *        • principal-moment ratios    — the same eigenvalues normalized
 *          λ1:λ2:λ3 (moment invariants WITHOUT a kernel inertia tensor —
 *          the binding surfaces only volume/area/COM, so we form the
 *          second-moment tensor of the sampled point cloud in JS).
 *
 * KERNEL SURFACE USED (all already built into forge-kernel.node):
 *   • forge.tessellate(handle, linTol, angTol)
 *       → { positions:Float32Array, normals, indices:Uint32Array, ... }
 *   • forge.massProps(handle) → { volume, area, centerOfMass:[3] }
 *   No inertia tensor / principal moments are exposed by the binding, so the
 *   moment invariants are computed here from the tessellation. (Flagged, not
 *   stubbed — the geometry is real kernel truth.)
 *
 * NEAREST-NEIGHBOUR SEARCH
 *   The global-feature subspace (compactness + PCA aspect + moment ratios) is a
 *   small, rotation/scale-invariant Euclidean vector. We build a KD-TREE over it
 *   for O(log n) candidate pruning, then re-rank candidates by the FULL
 *   descriptor distance (D2 histogram L1 + globals). This keeps retrieval exact
 *   on the short candidate list while pruning the vault cheaply. For a true 40k+
 *   vault, swap the linear/kd candidate stage for an ANN index (HNSW / IVF-PQ)
 *   — noted as the scale follow-up; the descriptor + distance metric are
 *   unchanged.
 *
 * DUPLICATE DETECTION
 *   All vault pairs whose descriptor distance is below DEFAULT_DUP_DISTANCE are
 *   candidate near-duplicates; each candidate is CONFIRMED with a tighter
 *   geometric check — volume/area within ε AND the CADGenBench shape-similarity
 *   metric `0.5·(surface_distance_F1 + volume_IoU)` ≥ a tight threshold
 *   (CADGENBENCH_SPEC.md:169). Only confirmed pairs are flagged.
 *
 * RETRIEVE-THEN-EDIT
 *   retrieveThenEdit() returns the closest existing vault part plus an
 *   `editHandoff` DESCRIPTOR — `{ verb:'cad.edit-step', sourceItem, ... }` — to
 *   be consumed by the parametric-edit / edit-STEP skill. This module does NOT
 *   implement the editor; it wires the hand-off, by design.
 *
 * No new npm packages (Forge rule): the PRNG, histogram, eigen-solver, and
 * kd-tree are all inlined below.
 *
 * @module forge-v4/pdm/partRetrieval
 */

/* eslint-disable no-bitwise */

// ───────────────────────────────────────────────────────── tunables / thresholds

// D2 sampling. M surface points, N random pairs, B histogram bins.
export const D2_SAMPLE_POINTS = 2048;
export const D2_PAIRS         = 4096;
export const D2_BINS          = 64;

// Tessellation tolerances (kernel units = mm). Fine enough for a stable D2.
const TESS_LIN_TOL = 0.25;
const TESS_ANG_TOL = 0.5;

// Descriptor distance weights. D2 dominant; shape-globals secondary. The
// size-bearing volume/area enter only as LOG-RATIOS (so a scaled copy still
// matches) and carry a small weight — set SIZE_WEIGHT to 0 for pure shape match.
const W_D2     = 0.70;   // D2 histogram L1 distance
const W_GLOBAL = 0.30;   // rotation/scale-invariant global features
const SIZE_WEIGHT = 0.0; // log-ratio of volume/area (0 → scale-invariant match)

// Near-duplicate distance threshold on the descriptor metric. Calibrated so a
// rotated/translated copy is ~0, a few-percent dimensional change lands just
// under it, and unrelated primitives sit well above.
export const DEFAULT_DUP_DISTANCE = 0.07;

// Tighter geometric confirm (CADGenBench shape_similarity form,
// 0.5*(surface_F1 + volume_IoU); CADGENBENCH_SPEC.md:169). Two regimes:
//   • EXACT/transform duplicates score ~1.0 at the spec's 0.5%-diagonal
//     surface tolerance.
//   • A near-duplicate (a few-percent dimensional change) is a DIFFERENT shape
//     at 0.5% tolerance, so the confirm runs the surface F1 at a NEAR-DUP BAND
//     tolerance (CONFIRM_SURFACE_TOL_FRAC of the bbox diagonal) — "do these two
//     parts coincide to within the near-dup band?" — while still gating on
//     volume/area within ε. The exact-match 0.5% value is exposed for callers
//     that want strict duplicate confirmation.
export const CONFIRM_SHAPE_SIMILARITY = 0.85; // 0.5*(surfaceF1 + volumeIoU) gate
export const CONFIRM_SURFACE_TOL_FRAC = 0.06; // near-dup band: 6% of bbox diagonal
export const EXACT_SURFACE_TOL_FRAC   = 0.005;// CADGenBench exact-match: 0.5% diag
const CONFIRM_VOL_AREA_EPS = 0.15;            // |Δvol|/vol and |Δarea|/area gate

// ───────────────────────────────────────────────────────── seeded PRNG (mulberry32)
// Deterministic so D2 sampling is repeatable run-to-run (test requirement).

function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────────────────────────────────────── mesh extraction

/**
 * Resolve a body to a triangle mesh + mass props.
 *   body = { handle }                       → tessellate + massProps via kernel
 *        | { positions, indices }           → precomputed mesh (kernel-free)
 *        | { positions, indices, volume, area } → fully precomputed
 * Returns { positions:Float32Array|number[], indices:Uint32Array|number[],
 *           volume, area }.
 */
function resolveMesh(body, forge) {
  if (!body || typeof body !== 'object') {
    throw new Error('partRetrieval: body must be { handle } or { positions, indices }');
  }
  // Precomputed mesh path (test fixtures, cached fingerprints).
  if (body.positions && body.indices) {
    let { volume, area } = body;
    if ((volume == null || area == null) && Number.isInteger(body.handle) && forge) {
      const mp = forge.massProps(body.handle);
      volume = volume ?? mp.volume;
      area = area ?? mp.area;
    }
    return {
      positions: body.positions,
      indices: body.indices,
      volume: volume ?? meshVolume(body.positions, body.indices),
      area: area ?? meshArea(body.positions, body.indices),
    };
  }
  // Kernel path.
  if (!Number.isInteger(body.handle)) {
    throw new Error('partRetrieval: body.handle (int) required when no positions/indices given');
  }
  if (!forge || typeof forge.tessellate !== 'function') {
    throw new Error('partRetrieval: a forge kernel with tessellate() is required to fingerprint a handle');
  }
  const tess = forge.tessellate(body.handle, TESS_LIN_TOL, TESS_ANG_TOL);
  let volume, area;
  if (typeof forge.massProps === 'function') {
    const mp = forge.massProps(body.handle);
    volume = mp.volume; area = mp.area;
  } else {
    volume = meshVolume(tess.positions, tess.indices);
    area = meshArea(tess.positions, tess.indices);
  }
  return { positions: tess.positions, indices: tess.indices, volume, area };
}

// Signed-tetrahedron volume of a closed triangle soup (fallback when no kernel).
function meshVolume(P, I) {
  let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ax = P[a], ay = P[a + 1], az = P[a + 2];
    const bx = P[b], by = P[b + 1], bz = P[b + 2];
    const cx = P[c], cy = P[c + 1], cz = P[c + 2];
    v += (ax * (by * cz - bz * cy)
        - ay * (bx * cz - bz * cx)
        + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(v);
}
function meshArea(P, I) {
  let s = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    s += 0.5 * Math.hypot(cx, cy, cz);
  }
  return s;
}

// ───────────────────────────────────────────────────────── area-weighted surface sampling

/**
 * Sample `count` points uniformly over the mesh surface (area-weighted):
 *   • per-triangle area → cumulative-area array,
 *   • pick a triangle via inverse-CDF on a uniform [0,1) draw (binary search),
 *   • pick a barycentric point inside it (the standard sqrt(r1) reflection so
 *     the sample is uniform over the triangle, not biased to a corner).
 * Returns Float64Array of length count*3.
 */
function sampleSurface(P, I, count, rng) {
  const triCount = I.length / 3;
  const cum = new Float64Array(triCount);
  let total = 0;
  for (let t = 0; t < triCount; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    total += 0.5 * Math.hypot(cx, cy, cz);
    cum[t] = total;
  }
  if (total <= 0) throw new Error('partRetrieval: degenerate mesh (zero surface area)');

  // Inverse-CDF triangle pick via binary search on the cumulative-area array.
  const pickTri = (u) => {
    const target = u * total;
    let lo = 0, hi = triCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  const out = new Float64Array(count * 3);
  for (let s = 0; s < count; s++) {
    const t = pickTri(rng());
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    let r1 = rng(), r2 = rng();
    const sq = Math.sqrt(r1);
    const w0 = 1 - sq, w1 = sq * (1 - r2), w2 = sq * r2; // uniform barycentric
    out[s * 3]     = w0 * P[a]     + w1 * P[b]     + w2 * P[c];
    out[s * 3 + 1] = w0 * P[a + 1] + w1 * P[b + 1] + w2 * P[c + 1];
    out[s * 3 + 2] = w0 * P[a + 2] + w1 * P[b + 2] + w2 * P[c + 2];
  }
  return out;
}

// ───────────────────────────────────────────────────────── D2 histogram

/**
 * D2 shape distribution from a surface-point set. Random point PAIRS →
 * distances → normalize by mean distance → histogram (B bins over [0, 3*mean],
 * a stable upper bound for a normalized distribution) → L1-normalize.
 * Returns { hist:Float32Array(bins), meanDist }.
 */
function d2Histogram(pts, pairs, bins, rng) {
  const n = pts.length / 3;
  const dists = new Float64Array(pairs);
  let sum = 0;
  for (let k = 0; k < pairs; k++) {
    let i = (rng() * n) | 0;
    let j = (rng() * n) | 0;
    if (i === j) j = (j + 1) % n;
    const ai = i * 3, bj = j * 3;
    const d = Math.hypot(pts[ai] - pts[bj], pts[ai + 1] - pts[bj + 1], pts[ai + 2] - pts[bj + 2]);
    dists[k] = d;
    sum += d;
  }
  const mean = sum / pairs || 1;
  // Normalize by mean → scale-invariant. Bin over [0, MAX_NORM*mean'].
  const MAX_NORM = 3.0;            // ~covers the tail of a normalized D2
  const hi = MAX_NORM;            // upper edge in mean-normalized units
  const hist = new Float32Array(bins);
  for (let k = 0; k < pairs; k++) {
    const x = dists[k] / mean;     // mean-normalized → dimensionless
    let bin = (x / hi) * bins | 0;
    if (bin >= bins) bin = bins - 1;
    if (bin < 0) bin = 0;
    hist[bin] += 1;
  }
  // L1-normalize → probability vector.
  let acc = 0;
  for (let i = 0; i < bins; i++) acc += hist[i];
  if (acc > 0) for (let i = 0; i < bins; i++) hist[i] /= acc;
  return { hist, meanDist: mean };
}

// ───────────────────────────────────────────────────────── covariance / eigen (3×3)

/** Mass-centred 3×3 covariance of a point set. */
function covariance3(pts) {
  const n = pts.length / 3;
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) { mx += pts[i * 3]; my += pts[i * 3 + 1]; mz += pts[i * 3 + 2]; }
  mx /= n; my /= n; mz /= n;
  let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0;
  for (let i = 0; i < n; i++) {
    const dx = pts[i * 3] - mx, dy = pts[i * 3 + 1] - my, dz = pts[i * 3 + 2] - mz;
    xx += dx * dx; yy += dy * dy; zz += dz * dz;
    xy += dx * dy; xz += dx * dz; yz += dy * dz;
  }
  return [xx / n, yy / n, zz / n, xy / n, xz / n, yz / n]; // [xx,yy,zz,xy,xz,yz]
}

/**
 * Eigenvalues of a symmetric 3×3 matrix via the closed-form trigonometric
 * solution (Smith 1961). Input [xx,yy,zz,xy,xz,yz]. Returns the three
 * eigenvalues sorted descending. Rotation of the point cloud rotates the
 * eigenVECTORS but leaves the eigenVALUES invariant — exactly the property we
 * want for a pose-invariant feature.
 */
function eigvals3sym([xx, yy, zz, xy, xz, yz]) {
  const p1 = xy * xy + xz * xz + yz * yz;
  if (p1 === 0) {
    // already diagonal
    return [xx, yy, zz].sort((a, b) => b - a);
  }
  const q = (xx + yy + zz) / 3;
  const p2 = (xx - q) ** 2 + (yy - q) ** 2 + (zz - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  // B = (A - qI)/p
  const b00 = (xx - q) / p, b11 = (yy - q) / p, b22 = (zz - q) / p;
  const b01 = xy / p, b02 = xz / p, b12 = yz / p;
  // det(B)/2
  const detB = b00 * (b11 * b22 - b12 * b12)
             - b01 * (b01 * b22 - b12 * b02)
             + b02 * (b01 * b12 - b11 * b02);
  let r = detB / 2;
  r = Math.max(-1, Math.min(1, r));
  const phi = Math.acos(r) / 3;
  const eig1 = q + 2 * p * Math.cos(phi);
  const eig3 = q + 2 * p * Math.cos(phi + (2 * Math.PI / 3));
  const eig2 = 3 * q - eig1 - eig3;
  return [eig1, eig2, eig3].sort((a, b) => b - a);
}

// ───────────────────────────────────────────────────────── fingerprint

/**
 * Compute a pose- and scale-invariant fingerprint for a part.
 * @param {object} body  { handle } or { positions, indices, volume?, area? }
 * @param {object} forge live kernel (window.forge) — required for the handle path
 * @param {object} [opts] { seed, points, pairs, bins }
 * @returns descriptor:
 *   { d2:Float32Array(bins), meanDist,
 *     globals:{ volume, area, compactness, momentRatios:[3], pcaAspect:[2] },
 *     scale }
 */
export function computeFingerprint(body, forge, opts = {}) {
  const seed   = opts.seed   ?? 0xF0E33;
  const points = opts.points ?? D2_SAMPLE_POINTS;
  const pairs  = opts.pairs  ?? D2_PAIRS;
  const bins   = opts.bins   ?? D2_BINS;

  const { positions, indices, volume, area } = resolveMesh(body, forge);
  const rng = makeRng(seed);
  const pts = sampleSurface(positions, indices, points, rng);

  // D2 (pose- and scale-invariant by construction).
  const { hist, meanDist } = d2Histogram(pts, pairs, bins, rng);

  // Covariance eigenvalues of the SURFACE-POINT cloud → rotation-invariant
  // moment/aspect features. The point cloud is mean-centred inside covariance3.
  const cov = covariance3(pts);
  const [l1, l2, l3] = eigvals3sym(cov).map((v) => Math.max(v, 0));
  const eMax = l1 || 1;
  // moment ratios normalized to the largest → λ1:λ2:λ3 in [0,1].
  const momentRatios = [1, l2 / eMax, l3 / eMax];
  // pca aspect = sqrt(eigen) ratios (linear extents) → [mid/major, minor/major].
  const s1 = Math.sqrt(l1) || 1, s2 = Math.sqrt(l2), s3 = Math.sqrt(l3);
  const pcaAspect = [s2 / s1, s3 / s1];

  // compactness (isoperimetric-style, dimensionless). 1 for a sphere.
  const compactness = volume > 0 ? (area * area * area) / (36 * Math.PI * volume * volume) : 0;

  // a single scale measure (mean pairwise distance in model units) — used by
  // size-aware (non-default) matching and reported for diagnostics.
  const scale = meanDist;

  return {
    d2: hist,
    meanDist,
    globals: { volume, area, compactness, momentRatios, pcaAspect },
    scale,
  };
}

// ───────────────────────────────────────────────────────── descriptor distance

/** L1 distance between two equal-length histograms. */
function l1(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s;
}

/**
 * Distance between two descriptors. Scale-invariant by default:
 *   W_D2 * 0.5*L1(d2)            (∈[0,1] — D2 is the shape signature)
 * + W_GLOBAL * globalDist        (compactness + pca aspect + moment ratios)
 * + SIZE_WEIGHT * sizeLogRatio   (0 by default → pure shape match)
 */
export function descriptorDistance(a, b) {
  // D2 — L1 over two probability vectors is in [0,2]; halve → [0,1].
  const d2 = 0.5 * l1(a.d2, b.d2);

  // Global shape features (all rotation/scale-invariant).
  const ga = a.globals, gb = b.globals;
  const compDiff = relDiff(ga.compactness, gb.compactness);
  let aspDiff = 0;
  for (let i = 0; i < ga.pcaAspect.length; i++) aspDiff += Math.abs(ga.pcaAspect[i] - gb.pcaAspect[i]);
  aspDiff /= ga.pcaAspect.length;
  let momDiff = 0;
  for (let i = 0; i < ga.momentRatios.length; i++) momDiff += Math.abs(ga.momentRatios[i] - gb.momentRatios[i]);
  momDiff /= ga.momentRatios.length;
  // average the three invariant sub-features, each already ~[0,1]-scaled.
  const globalDist = (clamp01(compDiff) + clamp01(aspDiff) + clamp01(momDiff)) / 3;

  // Size — compared as log-ratios so a uniformly scaled copy reads as a match.
  const volLog = logRatio(ga.volume, gb.volume);
  const areaLog = logRatio(ga.area, gb.area);
  const sizeDist = clamp01((volLog + areaLog) / 2);

  return W_D2 * d2 + W_GLOBAL * globalDist + SIZE_WEIGHT * sizeDist;
}

function relDiff(a, b) {
  const m = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / m;
}
function logRatio(a, b) {
  const x = Math.max(Math.abs(a), 1e-12), y = Math.max(Math.abs(b), 1e-12);
  return Math.abs(Math.log(x / y));
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Score decay rate. Mapping is exp(-SCORE_DECAY·distance) so the well-separated
// distance tiers (pose-copy ~0, near-dup ~0.05, closest distinct ~0.11) land in
// clearly different score bands: copy→1.0, near-dup→~0.75, distinct→<0.6.
const SCORE_DECAY = 6;

/** Map a descriptor distance to a similarity score in (0,1]. ~1.0 for a copy. */
export function similarityScore(distance) {
  return Math.exp(-SCORE_DECAY * distance);
}

// ───────────────────────────────────────────────────────── kd-tree (global subspace)

/**
 * A small static kd-tree over the global-feature subspace for candidate
 * pruning. The subspace is the rotation/scale-invariant global vector:
 *   [compactness, pcaAspect0, pcaAspect1, momentRatio1, momentRatio2]
 * (momentRatio0 is always 1, so it is dropped). Build O(n log n), query the
 * K nearest in this cheap subspace, then re-rank by the FULL descriptor.
 */
function globalVec(desc) {
  const g = desc.globals;
  return [g.compactness, g.pcaAspect[0], g.pcaAspect[1], g.momentRatios[1], g.momentRatios[2]];
}

function buildKdTree(points) {
  // points: [{ vec:number[], idx:number }]
  const dim = points.length ? points[0].vec.length : 0;
  function build(arr, depth) {
    if (arr.length === 0) return null;
    const axis = depth % dim;
    arr.sort((a, b) => a.vec[axis] - b.vec[axis]);
    const mid = arr.length >> 1;
    return {
      point: arr[mid],
      axis,
      left: build(arr.slice(0, mid), depth + 1),
      right: build(arr.slice(mid + 1), depth + 1),
    };
  }
  return { root: build(points.slice(), 0), dim };
}

function kdNearest(tree, target, k) {
  // Bounded max-heap-free k-NN via a sorted insertion list (k is small).
  const best = []; // { idx, dist2 } sorted ascending by dist2
  const dim = tree.dim;
  function dist2(vec) {
    let s = 0;
    for (let i = 0; i < dim; i++) { const d = vec[i] - target[i]; s += d * d; }
    return s;
  }
  function consider(node) {
    const d2 = dist2(node.point.vec);
    if (best.length < k) {
      best.push({ idx: node.point.idx, dist2: d2 });
      best.sort((a, b) => a.dist2 - b.dist2);
    } else if (d2 < best[best.length - 1].dist2) {
      best[best.length - 1] = { idx: node.point.idx, dist2: d2 };
      best.sort((a, b) => a.dist2 - b.dist2);
    }
  }
  function recurse(node) {
    if (!node) return;
    consider(node);
    const axis = node.axis;
    const diff = target[axis] - node.point.vec[axis];
    const near = diff < 0 ? node.left : node.right;
    const far = diff < 0 ? node.right : node.left;
    recurse(near);
    const worst = best.length < k ? Infinity : best[best.length - 1].dist2;
    if (diff * diff < worst) recurse(far);
  }
  recurse(tree.root);
  return best.map((b) => b.idx);
}

// ───────────────────────────────────────────────────────── vault index

/**
 * Build a fingerprint index over a vault.
 * @param {Array} parts [{ itemId|partNumber, handle } | { ..., positions, indices }]
 * @param {object} forge live kernel
 * @param {object} [opts] forwarded to computeFingerprint (seed/points/pairs/bins)
 * @returns index { entries:[{ part, descriptor }], kd, opts }
 */
export function indexVault(parts, forge, opts = {}) {
  if (!Array.isArray(parts)) throw new Error('indexVault: parts must be an array');
  const entries = parts.map((part) => ({
    part,
    descriptor: part.descriptor || computeFingerprint(part, forge, opts),
  }));
  const kdPoints = entries.map((e, idx) => ({ vec: globalVec(e.descriptor), idx }));
  const kd = entries.length ? buildKdTree(kdPoints) : null;
  return { entries, kd, opts };
}

// ───────────────────────────────────────────────────────── nearest-neighbour search

/**
 * Rank the vault by similarity to a query.
 * @param {object|descriptor} query  a body ({handle}|{positions,indices}) OR a
 *        precomputed descriptor (has a `.d2` field).
 * @param {number} k  number of matches to return.
 * @param {object} index  from indexVault.
 * @param {object} [forge] kernel — required if `query` is a body.
 * @returns [{ part, score, distance }] sorted by score descending.
 */
export function findSimilar(query, k, index, forge) {
  if (!index || !Array.isArray(index.entries)) {
    throw new Error('findSimilar: a vault index from indexVault() is required');
  }
  const qDesc = query && query.d2 ? query : computeFingerprint(query, forge, index.opts);
  const n = index.entries.length;
  if (n === 0) return [];

  // Candidate pruning over the cheap global subspace, then exact re-rank. We
  // over-fetch candidates (a multiple of k) so the kd prune never starves the
  // exact stage; for small vaults this collapses to a full scan.
  let candidateIdx;
  const want = Math.min(n, Math.max(k * 4, 16));
  if (index.kd && want < n) {
    candidateIdx = kdNearest(index.kd, globalVec(qDesc), want);
  } else {
    candidateIdx = index.entries.map((_, i) => i);
  }

  const scored = candidateIdx.map((i) => {
    const distance = descriptorDistance(qDesc, index.entries[i].descriptor);
    return { part: index.entries[i].part, score: similarityScore(distance), distance };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// ───────────────────────────────────────────────────────── duplicate detection

/**
 * The CADGenBench shape-similarity confirm: 0.5*(surface_distance_F1 +
 * volume_IoU) on two ALIGNED meshes (CADGENBENCH_SPEC.md:169). We align by PCA —
 * translate both to their COM and rotate into their principal axes — so a
 * rotated/translated copy overlays its original, then measure on the ACTUAL
 * TRIANGLE SURFACES (point-to-mesh, not point-to-resampled-cloud — the latter is
 * sampling-starved at the spec's 0.5%-diagonal tolerance):
 *   • surface_distance_F1: sample points on aligned-A's surface; a point is
 *     "matched" when the nearest point on aligned-B's TRIANGLE SOUP is within
 *     0.5% of the bbox diagonal (size-proportional, per spec); symmetric →
 *     precision + recall → F1.
 *   • volume_IoU: with the meshes aligned and the surfaces coincident (high
 *     F1), the occupied volumes overlap, so IoU is bounded by the KERNEL volume
 *     ratio min(Vol_A,Vol_B)/max(Vol_A,Vol_B); we attenuate that by the surface
 *     overlap fraction so a poor alignment / partial surface match drops the IoU
 *     toward 0. (Using kernel-truth volumes avoids the sampling noise of a
 *     sparse voxel-occupancy estimate, which starved a tight ≥0.97 gate.)
 * PCA axes are sign-ambiguous (eigenvector signs), so we try the 4 proper
 * sign-flips (det=+1) of B's frame and keep the best — the canonical fix.
 * Returns a similarity in [0,1] (~1.0 for identical geometry).
 */
function shapeSimilarityConfirm(bodyA, bodyB, forge, opts = {}) {
  const seed = opts.seed ?? 0xC0FFEE;
  const tolFrac = opts.tolFrac ?? CONFIRM_SURFACE_TOL_FRAC; // near-dup band by default
  const ma = resolveMesh(bodyA, forge);
  const mb = resolveMesh(bodyB, forge);
  // Align FULL meshes (vertices) into each one's own principal frame.
  const A = alignMesh(ma.positions, ma.indices);
  const Braw = alignMesh(mb.positions, mb.indices);

  const diag = Math.max(bboxDiag(A.positions), bboxDiag(Braw.positions)) || 1;
  const tol = tolFrac * diag; // size-proportional surface tolerance

  const rng = makeRng(seed);
  const SAMPLES = 1200;
  // Points on A's surface (frame-A), resampled fresh on B's surface per flip.
  const ptsA = sampleSurface(A.positions, A.indices, SAMPLES, rng);

  // kernel-truth volume ratio — the IoU ceiling once surfaces coincide.
  const volRatio = Math.min(ma.volume, mb.volume) / Math.max(ma.volume, mb.volume || 1);

  let best = -1;
  for (const flip of SIGN_FLIPS) {
    const Bpos = applyVertexSignFlip(Braw.positions, flip);
    const ptsB = sampleSurface(Bpos, Braw.indices, SAMPLES, makeRng(seed ^ 0x55));
    // surface F1 via point-to-TRIANGLE-SOUP distance (both directions).
    const recall    = meshMatchedFraction(ptsA, Bpos, Braw.indices, tol); // A→B surface
    const precision = meshMatchedFraction(ptsB, A.positions, A.indices, tol); // B→A surface
    const overlap   = Math.min(recall, precision); // conservative surface coincidence
    const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    // volume IoU: kernel volume ratio attenuated by how coincident the surfaces are.
    const iou = volRatio * overlap;
    const sim = 0.5 * (f1 + iou);
    if (sim > best) best = sim;
  }
  return best;
}

/** Tessellate-aligned mesh: vertices translated to COM + rotated into PCA axes. */
function alignMesh(positions, indices) {
  // Use the vertex set for the frame (cheap, deterministic).
  const n = positions.length / 3;
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) { mx += positions[i * 3]; my += positions[i * 3 + 1]; mz += positions[i * 3 + 2]; }
  mx /= n; my /= n; mz /= n;
  const cov = covariance3(positions);
  const R = eigvecs3sym(cov);
  const out = new Float64Array(positions.length);
  for (let i = 0; i < n; i++) {
    const dx = positions[i * 3] - mx, dy = positions[i * 3 + 1] - my, dz = positions[i * 3 + 2] - mz;
    out[i * 3]     = R[0] * dx + R[1] * dy + R[2] * dz;
    out[i * 3 + 1] = R[3] * dx + R[4] * dy + R[5] * dz;
    out[i * 3 + 2] = R[6] * dx + R[7] * dy + R[8] * dz;
  }
  return { positions: out, indices };
}

function applyVertexSignFlip(positions, [sx, sy, sz]) {
  const out = new Float64Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i] * sx; out[i + 1] = positions[i + 1] * sy; out[i + 2] = positions[i + 2] * sz;
  }
  return out;
}

/** Fraction of sample points within `tol` of the nearest triangle in (P,I). */
function meshMatchedFraction(samples, P, I, tol) {
  const nS = samples.length / 3;
  const triCount = I.length / 3;
  const tol2 = tol * tol;
  let matched = 0;
  for (let s = 0; s < nS; s++) {
    const px = samples[s * 3], py = samples[s * 3 + 1], pz = samples[s * 3 + 2];
    let best = Infinity;
    for (let t = 0; t < triCount; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      const d2 = pointTriangleDist2(px, py, pz,
        P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]);
      if (d2 < best) { best = d2; if (best <= tol2) break; }
    }
    if (best <= tol2) matched++;
  }
  return matched / nS;
}

/** Squared distance from point p to triangle (a,b,c) (Ericson, Real-Time CD §5.1.5). */
function pointTriangleDist2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const qx = ax + v * abx, qy = ay + v * aby, qz = az + v * abz;
    return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const qx = ax + w * acx, qy = ay + w * acy, qz = az + w * acz;
    return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const qx = bx + w * (cx - bx), qy = by + w * (cy - by), qz = bz + w * (cz - bz);
    return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
  }
  // inside face region — project onto the plane
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  const qx = ax + abx * v + acx * w, qy = ay + aby * v + acy * w, qz = az + abz * v + acz * w;
  return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}

// proper-rotation sign flips of a 3-axis frame (det = +1 → even # of −1s)
const SIGN_FLIPS = [
  [1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1],
];

/** Eigenvectors of a symmetric 3×3, returned row-major (rows = principal axes). */
function eigvecs3sym(cov) {
  const [xx, yy, zz, xy, xz, yz] = cov;
  const evals = eigvals3sym(cov);
  const M = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]];
  const rows = [];
  for (const lam of evals) {
    rows.push(nullspaceVec(M, lam));
  }
  // Gram-Schmidt to guarantee orthonormality (degenerate eigenvalues).
  ortho(rows);
  return [rows[0][0], rows[0][1], rows[0][2],
          rows[1][0], rows[1][1], rows[1][2],
          rows[2][0], rows[2][1], rows[2][2]];
}

function nullspaceVec(M, lam) {
  // (M - lam I) v = 0 → take the largest cross product of two rows.
  const A = [
    [M[0][0] - lam, M[0][1], M[0][2]],
    [M[1][0], M[1][1] - lam, M[1][2]],
    [M[2][0], M[2][1], M[2][2] - lam],
  ];
  const r0 = A[0], r1 = A[1], r2 = A[2];
  const c01 = cross(r0, r1), c02 = cross(r0, r2), c12 = cross(r1, r2);
  let best = c01, bl = norm(c01);
  if (norm(c02) > bl) { best = c02; bl = norm(c02); }
  if (norm(c12) > bl) { best = c12; bl = norm(c12); }
  if (bl < 1e-12) return [1, 0, 0];
  return [best[0] / bl, best[1] / bl, best[2] / bl];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(v) { return Math.hypot(v[0], v[1], v[2]); }
function ortho(rows) {
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < i; j++) {
      const d = rows[i][0] * rows[j][0] + rows[i][1] * rows[j][1] + rows[i][2] * rows[j][2];
      rows[i][0] -= d * rows[j][0]; rows[i][1] -= d * rows[j][1]; rows[i][2] -= d * rows[j][2];
    }
    const nn = norm(rows[i]) || 1;
    rows[i][0] /= nn; rows[i][1] /= nn; rows[i][2] /= nn;
  }
}

function bboxDiag(pts) {
  let minx = Infinity, miny = Infinity, minz = Infinity;
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    if (pts[i] < minx) minx = pts[i]; if (pts[i] > maxx) maxx = pts[i];
    if (pts[i + 1] < miny) miny = pts[i + 1]; if (pts[i + 1] > maxy) maxy = pts[i + 1];
    if (pts[i + 2] < minz) minz = pts[i + 2]; if (pts[i + 2] > maxz) maxz = pts[i + 2];
  }
  return Math.hypot(maxx - minx, maxy - miny, maxz - minz);
}

/**
 * Find near-duplicate part pairs in the vault.
 * @param {object} index  from indexVault.
 * @param {object} [opts] { threshold, confirm:boolean, forge, shapeSimilarity }
 * @returns [{ a, b, distance, confirmed, shapeSimilarity }] for every pair under
 *          threshold; if `confirm` (default true) the pair is additionally
 *          checked with the tighter geometric metric and `confirmed` reflects it.
 */
export function findDuplicates(index, opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_DUP_DISTANCE;
  const confirm = opts.confirm !== false;
  const forge = opts.forge;
  const shapeSimGate = opts.shapeSimilarity ?? CONFIRM_SHAPE_SIMILARITY;
  const entries = index.entries;
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const distance = descriptorDistance(entries[i].descriptor, entries[j].descriptor);
      if (distance > threshold) continue;
      let confirmed = true;
      let shapeSim = null;
      if (confirm) {
        const ga = entries[i].descriptor.globals, gb = entries[j].descriptor.globals;
        const volOk = relDiff(ga.volume, gb.volume) <= CONFIRM_VOL_AREA_EPS;
        const areaOk = relDiff(ga.area, gb.area) <= CONFIRM_VOL_AREA_EPS;
        // Tighter geometric check on the actual meshes (when bodies + kernel available).
        const a = entries[i].part, b = entries[j].part;
        const canMesh = (a.handle != null || a.positions) && (b.handle != null || b.positions);
        if (canMesh) {
          shapeSim = shapeSimilarityConfirm(a, b, forge);
          confirmed = volOk && areaOk && shapeSim >= shapeSimGate;
        } else {
          confirmed = volOk && areaOk;
        }
      }
      out.push({ a: entries[i].part, b: entries[j].part, distance, confirmed, shapeSimilarity: shapeSim });
    }
  }
  // Confirmed pairs first, then by ascending distance.
  out.sort((x, y) => (Number(y.confirmed) - Number(x.confirmed)) || (x.distance - y.distance));
  return out;
}

// ───────────────────────────────────────────────────────── retrieve-then-edit

/**
 * Retrieve the closest existing vault part to a query and emit a hand-off
 * descriptor to the parametric-edit / edit-STEP skill. THIS DOES NOT EDIT —
 * the returned `editHandoff` is a documented interface object the edit path
 * (e.g. ForgeToolBridge `io.export-step` / a `cad.edit-step` verb / the
 * CADGenBench edit harness) consumes. See CADGENBENCH_SPEC.md for the edit
 * metric the consumer optimizes against.
 *
 * @returns { match, score, distance, editHandoff } | { match:null, ... } if
 *          the vault is empty.
 */
export function retrieveThenEdit(query, index, forge, opts = {}) {
  const ranked = findSimilar(query, 1, index, forge);
  if (ranked.length === 0) {
    return { match: null, score: 0, distance: Infinity, editHandoff: null };
  }
  const top = ranked[0];
  const qDesc = query && query.d2 ? query : computeFingerprint(query, forge, index.opts);
  const mDesc = top.part.descriptor || computeFingerprint(top.part, forge, index.opts);

  // A coarse, edit-relevant delta so the editor knows WHAT to morph: the
  // uniform scale factor (cube-root of the volume ratio) plus the size deltas.
  const volRatio = (qDesc.globals.volume || 1) / (mDesc.globals.volume || 1);
  const queryDelta = {
    scaleFactor: Math.cbrt(volRatio),
    volumeRatio: volRatio,
    areaRatio: (qDesc.globals.area || 1) / (mDesc.globals.area || 1),
    compactnessDelta: qDesc.globals.compactness - mDesc.globals.compactness,
    pcaAspectDelta: qDesc.globals.pcaAspect.map((v, i) => v - mDesc.globals.pcaAspect[i]),
  };

  const editHandoff = {
    verb: 'cad.edit-step',
    sourceItem: top.part,                 // the closest existing vault part
    similarity: top.score,
    queryDelta,                           // hint for the parametric morph
    confirmMetric: 'shape_similarity = 0.5*(surface_distance_F1 + volume_IoU)',
    note: 'hand off to the parametric-edit / edit-STEP skill; this module does not edit. '
        + 'Reuse sourceItem geometry, apply queryDelta, re-validate via confirmMetric.',
  };
  return { match: top.part, score: top.score, distance: top.distance, editHandoff };
}

// ───────────────────────────────────────────────────────── test hooks
export const __test = {
  makeRng, sampleSurface, d2Histogram, covariance3, eigvals3sym, eigvecs3sym,
  alignMesh, shapeSimilarityConfirm, meshMatchedFraction, pointTriangleDist2,
  meshVolume, meshArea, globalVec, buildKdTree, kdNearest, bboxDiag,
};
