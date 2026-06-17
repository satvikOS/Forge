// PUSH-210 (Slice-164) — Real Surface Fairing math (Class-A surface smoothing).
//
// Class-A surfacing parity with Alias / ICEM / CATIA. Implements the
// industry-standard recipe for triangle-mesh fairing:
//
//   1. Discrete cotangent-Laplace-Beltrami operator (Pinkall & Polthier 1993).
//
//        For each interior vertex i:
//          L_ii = -Σ_{j∈N(i)} (cot α_ij + cot β_ij) / (2 A_i)
//          L_ij =  (cot α_ij + cot β_ij) / (2 A_i)    for j ∈ N(i)
//
//        where α_ij, β_ij are the two angles opposite the edge (i,j) in the
//        two triangles sharing that edge, and A_i is the (mixed) Voronoi area
//        at vertex i (Meyer 2003 §3.3).
//
//   2. Taubin λ|μ alternating smoothing (Taubin 1995).
//
//        Step A (shrink) : x_new = x + λ · L · x          λ > 0
//        Step B (inflate): x_new = x + μ · L · x          μ < 0,  |μ| > λ
//
//      Repeating (A,B) pairs avoids the volume shrinkage of plain Laplacian
//      smoothing. Defaults: λ = 0.6, μ = -0.63 (per Taubin's recommendation
//      pass-band frequency ≈ 0.1).
//
//   3. Bi-Laplace fairing (true Class-A bending-energy minimisation).
//
//        Minimise  E(X) = ½ ‖ L · X ‖²
//
//      whose Euler-Lagrange equation is  L^T L · X = 0  → trivially X
//      collapses to the boundary unless we regularise. We add Tikhonov ε I
//      and require the solution to stay near the original positions:
//
//        ( L^T L + ε I ) · X_new = ε · X_old
//
//      We solve component-wise (x, y, z separately) via conjugate gradient
//      on the SPD operator A = L^T L + ε I. Boundary vertices are fixed —
//      pinned to their original positions by zeroing rows/cols and
//      substituting into the RHS.
//
//   4. Boundary detection. An edge (i,j) is a boundary edge iff it is
//      incident to exactly one triangle. Vertices on any boundary edge are
//      "boundary vertices" and stay fixed.
//
// API:
//   - assembleCotangentLaplacian(positions, indices)
//        Returns sparse-row { rows, cols, vals } CSR-ish representation plus
//        per-vertex Voronoi areas and per-vertex boundary flags.
//   - detectBoundaryVertices(indices, vertexCount) → Uint8Array (1 = boundary).
//   - taubinSmoothStep(positions, lap, lambda, fixedMask)
//        One single shrink-or-inflate step. positions: Float32Array(3n).
//   - runTaubin(positions, lap, fixedMask, { lambda, mu, iterations })
//        Alternates λ then μ for `iterations` PAIRS (so 2·iterations
//        Laplacian sweeps).
//   - runBiLaplace(positions, lap, fixedMask, { epsilon, cgIterations, cgTol })
//        Solves (L^T L + εI) x_new = ε x_old per coordinate via CG.
//   - bendingEnergy(positions, lap)
//        Returns Σ_i A_i · |H_i|² (cotangent-Laplacian estimate, Meyer 2003).
//   - buildBlocks(geometry) — convenience: BufferGeometry → math envelope.
//   - runFairing(geometry, opts)
//        Top-level driver: mode = 'smooth' | 'fair'. Returns:
//          {
//            ok: true,
//            mode, iterations,
//            preEnergy, postEnergy, energyReduction,
//            maxDisplacement, maxBoundaryDisplacement,
//            boundaryCount, vertexCount, triangleCount,
//            positions: Float32Array (3n) new vertex positions,
//            originalPositions: Float32Array (3n),
//            boundaryMask: Uint8Array(n),
//            voronoiArea: Float32Array(n),
//          }
//   - makeTestSphere({ R, divisions, noiseAmp, noiseSeed })
//        Subdivided icosphere with deterministic per-vertex noise so the
//        e2e can reproduce a "noisy sphere" fairing target with bending
//        energy reduction asserts.
//   - makeTestSphereWithHole({ R, divisions, holeFraction, noiseAmp })
//        Sphere mesh with a hole carved at the south pole + boundary
//        vertices marked. Used by the boundary-preservation test.
//
// Hard constraints:
//   - NO new npm packages.
//   - Real Pinkall & Polthier 1993 cotangent Laplacian. Real Taubin λ|μ
//     step. Real conjugate gradient for the bi-Laplace solve. NO MVP, NO
//     fallback, NO stub. Degenerate inputs raise real errors.
//
// All vectors are flat Float32Arrays (3·N) so the math passes through
// THREE.BufferAttribute without copying.

// ─────────────────────────────────────────────────────────────────────
// Constants — shared with the panel + e2e.

export const FORGE_FAIRING_EVENT       = 'forge:surface-fairing-built';
export const FORGE_FAIRING_STORAGE     = 'forge.v4.surfaceFairing';
export const FORGE_FAIRING_GROUP_NAME  = 'forge.surfaceFairing.group';
export const FORGE_FAIRING_USERDATA_TAG = 'surfaceFairing';

export const FAIRING_MODES = Object.freeze(['smooth', 'fair']);
export const FAIRING_DEFAULT_MODE       = 'smooth';
export const FAIRING_DEFAULT_ITERATIONS = 10;
export const FAIRING_MIN_ITERATIONS     = 1;
export const FAIRING_MAX_ITERATIONS     = 200;
// Taubin λ|μ default per Taubin 1995. With these the pass-band lies
// near k_pb = (1/λ + 1/μ) ≈ 0.1 for the discrete Laplacian eigen-spectrum,
// preserving the macroscopic shape while damping high-frequency noise.
export const FAIRING_DEFAULT_LAMBDA = 0.6;
export const FAIRING_DEFAULT_MU     = -0.63;
export const FAIRING_MIN_LAMBDA = 0.01;
export const FAIRING_MAX_LAMBDA = 1.0;
export const FAIRING_MIN_MU     = -1.0;
export const FAIRING_MAX_MU     = -0.02;
// Bi-Laplace Tikhonov regularisation strength. Small ε keeps the
// solution close to the input; large ε turns the solve into a pure
// smoothing step. Per Botsch & Kobbelt 2004, ε ≈ 1e-3 lands a good
// trade-off for typical CAD meshes.
export const FAIRING_DEFAULT_EPSILON = 1e-3;
export const FAIRING_MIN_EPSILON     = 1e-6;
export const FAIRING_MAX_EPSILON     = 1.0;
// Conjugate gradient max iterations + tolerance. CG on an SPD n×n system
// converges in ≤ n steps in exact arithmetic; we cap aggressively because
// the bi-Laplacian is highly structured (band ~ ring²).
export const FAIRING_CG_MAX_ITERATIONS = 200;
export const FAIRING_CG_TOL            = 1e-6;

// ─────────────────────────────────────────────────────────────────────
// Tiny scalar helpers — no allocations in the inner loops.

function vsub(ax, ay, az, bx, by, bz) {
  return [ax - bx, ay - by, az - bz];
}
function vlen(x, y, z) {
  return Math.hypot(x, y, z);
}
function vdot(ax, ay, az, bx, by, bz) {
  return ax * bx + ay * by + az * bz;
}
function vcross(ax, ay, az, bx, by, bz) {
  return [
    ay * bz - az * by,
    az * bx - ax * bz,
    ax * by - ay * bx,
  ];
}

// ─────────────────────────────────────────────────────────────────────
// extractTriangleIndices / extractPositions — BufferGeometry-agnostic
// helpers that work on either real three.js geometry or quack-typed
// {attributes.position, index} dicts (e.g. headless tests).

export function extractTriangleIndices(geometry) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) {
    return new Uint32Array(0);
  }
  const positionAttr = geometry.attributes.position;
  const vertexCount = positionAttr.count | 0;
  if (geometry.index && geometry.index.array && geometry.index.count > 0) {
    const src = geometry.index.array;
    const out = new Uint32Array(geometry.index.count);
    for (let i = 0; i < geometry.index.count; i++) out[i] = src[i] | 0;
    return out;
  }
  // Non-indexed: implicit (0,1,2), (3,4,5), …
  const triCount = (vertexCount / 3) | 0;
  const out = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    out[3 * t + 0] = 3 * t + 0;
    out[3 * t + 1] = 3 * t + 1;
    out[3 * t + 2] = 3 * t + 2;
  }
  return out;
}

export function extractPositions(geometry) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) {
    return new Float32Array(0);
  }
  const a = geometry.attributes.position;
  const n = a.count | 0;
  const out = new Float32Array(n * 3);
  // Tolerate both BufferAttribute (.getX/Y/Z) and raw {array}.
  if (typeof a.getX === 'function') {
    for (let i = 0; i < n; i++) {
      out[3 * i + 0] = a.getX(i);
      out[3 * i + 1] = a.getY(i);
      out[3 * i + 2] = a.getZ(i);
    }
  } else if (a.array) {
    for (let i = 0; i < n; i++) {
      out[3 * i + 0] = a.array[3 * i + 0];
      out[3 * i + 1] = a.array[3 * i + 1];
      out[3 * i + 2] = a.array[3 * i + 2];
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// detectBoundaryVertices — An edge (i,j) is a boundary edge iff it is
// incident to exactly one triangle. We hash the unordered (min,max) pair
// → count and then mark vertices touched by any boundary edge.

export function detectBoundaryVertices(indices, vertexCount) {
  const mask = new Uint8Array(vertexCount);
  const triCount = (indices.length / 3) | 0;
  if (triCount === 0) return mask;
  // Edge → triangle count.
  const edgeCount = new Map();
  const key = (a, b) => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    // Pack two 32-bit ints into a string key. 32-bit BigInt would be faster
    // but we sidestep the BigInt cost since vertex counts are small (<1e6).
    return lo + ':' + hi;
  };
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[3 * t + 0] | 0;
    const i1 = indices[3 * t + 1] | 0;
    const i2 = indices[3 * t + 2] | 0;
    if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue;
    const e01 = key(i0, i1);
    const e12 = key(i1, i2);
    const e20 = key(i2, i0);
    edgeCount.set(e01, (edgeCount.get(e01) || 0) + 1);
    edgeCount.set(e12, (edgeCount.get(e12) || 0) + 1);
    edgeCount.set(e20, (edgeCount.get(e20) || 0) + 1);
  }
  // For every boundary edge mark both endpoints.
  for (const [k, count] of edgeCount.entries()) {
    if (count === 1) {
      const colon = k.indexOf(':');
      if (colon < 0) continue;
      const a = parseInt(k.substring(0, colon), 10);
      const b = parseInt(k.substring(colon + 1), 10);
      if (a >= 0 && a < vertexCount) mask[a] = 1;
      if (b >= 0 && b < vertexCount) mask[b] = 1;
    }
  }
  return mask;
}

// ─────────────────────────────────────────────────────────────────────
// assembleCotangentLaplacian — Pinkall & Polthier 1993 discrete operator.
//
// Stored as sparse rows: for each vertex i,
//   rowStart[i] .. rowStart[i+1] - 1   index into (cols, vals).
//
// vals[k]  = (cot α + cot β) / (2 A_i)        off-diagonal weight to cols[k]
// diag[i]  = − Σ_{j∈N(i)} vals[k(i,j)]        so that  L·1 = 0  (constant
//                                              vector is the kernel; the
//                                              cotangent Laplacian inherits
//                                              this property in the smooth
//                                              limit).
//
// Returns:
//   { rowStart: Uint32Array(n+1),
//     cols:     Uint32Array(NNZ),
//     vals:     Float64Array(NNZ),        per-row neighbour weight (positive
//                                          for the off-diagonal entries in the
//                                          standard sign convention where
//                                          (L x)_i = Σ_j w_ij (x_j − x_i)).
//     diag:     Float64Array(n),          diagonal coefficient (negative of
//                                          the row sum so each row sums to 0).
//     voronoiArea: Float32Array(n),       Meyer 2003 mixed Voronoi area.
//     boundaryMask: Uint8Array(n),        1 = vertex sits on a boundary edge.
//     vertexCount, triangleCount,
//     averageEdgeLength,
//   }

export function assembleCotangentLaplacian(positions, indices) {
  const vertexCount = (positions.length / 3) | 0;
  const triCount = (indices.length / 3) | 0;
  if (vertexCount === 0 || triCount === 0) {
    return {
      rowStart:     new Uint32Array(1),
      cols:         new Uint32Array(0),
      vals:         new Float64Array(0),
      diag:         new Float64Array(0),
      voronoiArea:  new Float32Array(0),
      boundaryMask: new Uint8Array(0),
      vertexCount, triangleCount: triCount,
      averageEdgeLength: 0,
    };
  }
  // First pass: accumulate edge weights into a dictionary keyed on
  // unordered (min, max). Each edge (i,j) accumulates (cot α + cot β)/2
  // by summing one cotangent contribution per adjacent triangle.
  //
  // We also accumulate per-vertex mixed Voronoi area following Meyer 2003 §3.3
  // (used to normalise the Laplacian row by 2 A_i).
  const edgeWeight = new Map(); // key → Σ (cot of opposite-vertex angle)
  const areaMix = new Float64Array(vertexCount);
  const incident = new Map();   // vertex → Set of neighbours

  const key = (a, b) => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    return lo + ':' + hi;
  };

  let edgeLengthSum = 0;
  let edgeLengthCount = 0;

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[3 * t + 0] | 0;
    const i1 = indices[3 * t + 1] | 0;
    const i2 = indices[3 * t + 2] | 0;
    if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue;
    if (i0 === i1 || i1 === i2 || i2 === i0) continue;

    const x0 = positions[3 * i0], y0 = positions[3 * i0 + 1], z0 = positions[3 * i0 + 2];
    const x1 = positions[3 * i1], y1 = positions[3 * i1 + 1], z1 = positions[3 * i1 + 2];
    const x2 = positions[3 * i2], y2 = positions[3 * i2 + 1], z2 = positions[3 * i2 + 2];

    const e01 = vsub(x1, y1, z1, x0, y0, z0);
    const e02 = vsub(x2, y2, z2, x0, y0, z0);
    const e12 = vsub(x2, y2, z2, x1, y1, z1);
    const l01 = vlen(e01[0], e01[1], e01[2]);
    const l02 = vlen(e02[0], e02[1], e02[2]);
    const l12 = vlen(e12[0], e12[1], e12[2]);
    if (l01 < 1e-20 || l02 < 1e-20 || l12 < 1e-20) continue;

    edgeLengthSum += l01 + l02 + l12;
    edgeLengthCount += 3;

    const sq01 = l01 * l01;
    const sq02 = l02 * l02;
    const sq12 = l12 * l12;

    // Interior angles at vertex 0, 1, 2.
    let cos0 = vdot(e01[0], e01[1], e01[2], e02[0], e02[1], e02[2]) / (l01 * l02);
    let cos1 = vdot(-e01[0], -e01[1], -e01[2], e12[0], e12[1], e12[2]) / (l01 * l12);
    let cos2 = vdot(-e02[0], -e02[1], -e02[2], -e12[0], -e12[1], -e12[2]) / (l02 * l12);
    if (cos0 > 1) cos0 = 1; if (cos0 < -1) cos0 = -1;
    if (cos1 > 1) cos1 = 1; if (cos1 < -1) cos1 = -1;
    if (cos2 > 1) cos2 = 1; if (cos2 < -1) cos2 = -1;
    const a0 = Math.acos(cos0);
    const a1 = Math.acos(cos1);
    const a2 = Math.acos(cos2);

    const c   = vcross(e01[0], e01[1], e01[2], e02[0], e02[1], e02[2]);
    const triArea = 0.5 * vlen(c[0], c[1], c[2]);
    if (!Number.isFinite(triArea) || triArea < 1e-30) continue;

    const sin0 = Math.sin(a0); const cot0 = sin0 > 1e-30 ? cos0 / sin0 : 0;
    const sin1 = Math.sin(a1); const cot1 = sin1 > 1e-30 ? cos1 / sin1 : 0;
    const sin2 = Math.sin(a2); const cot2 = sin2 > 1e-30 ? cos2 / sin2 : 0;

    // Each edge receives the cotangent of the OPPOSITE vertex's angle.
    // edge (i0, i1) is opposite vertex 2 → cot2.
    // edge (i1, i2) is opposite vertex 0 → cot0.
    // edge (i2, i0) is opposite vertex 1 → cot1.
    const e01k = key(i0, i1);
    const e12k = key(i1, i2);
    const e20k = key(i2, i0);
    edgeWeight.set(e01k, (edgeWeight.get(e01k) || 0) + cot2);
    edgeWeight.set(e12k, (edgeWeight.get(e12k) || 0) + cot0);
    edgeWeight.set(e20k, (edgeWeight.get(e20k) || 0) + cot1);

    if (!incident.has(i0)) incident.set(i0, new Set());
    if (!incident.has(i1)) incident.set(i1, new Set());
    if (!incident.has(i2)) incident.set(i2, new Set());
    incident.get(i0).add(i1); incident.get(i0).add(i2);
    incident.get(i1).add(i0); incident.get(i1).add(i2);
    incident.get(i2).add(i0); incident.get(i2).add(i1);

    // Mixed Voronoi area (Meyer 2003 §3.3 + Fig 4).
    const obtuse0 = a0 > Math.PI / 2;
    const obtuse1 = a1 > Math.PI / 2;
    const obtuse2 = a2 > Math.PI / 2;
    const obtuseTriangle = obtuse0 || obtuse1 || obtuse2;
    if (!obtuseTriangle) {
      areaMix[i0] += 0.125 * (cot2 * sq01 + cot1 * sq02);
      areaMix[i1] += 0.125 * (cot2 * sq01 + cot0 * sq12);
      areaMix[i2] += 0.125 * (cot1 * sq02 + cot0 * sq12);
    } else {
      areaMix[i0] += obtuse0 ? (triArea / 2) : (triArea / 4);
      areaMix[i1] += obtuse1 ? (triArea / 2) : (triArea / 4);
      areaMix[i2] += obtuse2 ? (triArea / 2) : (triArea / 4);
    }
  }

  // Build the CSR.
  const rowStart = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < vertexCount; i++) {
    const s = incident.get(i);
    rowStart[i + 1] = rowStart[i] + (s ? s.size : 0);
  }
  const NNZ = rowStart[vertexCount];
  const cols = new Uint32Array(NNZ);
  const vals = new Float64Array(NNZ);
  const diag = new Float64Array(vertexCount);

  for (let i = 0; i < vertexCount; i++) {
    const s = incident.get(i);
    if (!s) continue;
    const A = areaMix[i];
    // If A_i is ill-defined (orphan vertex / degenerate one-ring), zero the
    // row so the operator is well-conditioned (vertex becomes a fixed point).
    const invDenom = (A > 1e-30) ? (1 / (2 * A)) : 0;
    let off = rowStart[i];
    let rowSum = 0;
    // Sort neighbours so the CSR is deterministic — helps test stability.
    const neighbours = Array.from(s).sort((a, b) => a - b);
    for (const j of neighbours) {
      const w = (edgeWeight.get(key(i, j)) || 0) * invDenom;
      cols[off] = j;
      vals[off] = w;
      rowSum += w;
      off += 1;
    }
    // Diagonal makes the row sum to zero: L · 1 = 0 in the smooth limit.
    diag[i] = -rowSum;
  }

  const voronoiArea = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) voronoiArea[i] = areaMix[i];

  const boundaryMask = detectBoundaryVertices(indices, vertexCount);
  const averageEdgeLength = edgeLengthCount > 0
    ? edgeLengthSum / edgeLengthCount : 0;

  return {
    rowStart, cols, vals, diag,
    voronoiArea, boundaryMask,
    vertexCount, triangleCount: triCount,
    averageEdgeLength,
  };
}

// ─────────────────────────────────────────────────────────────────────
// applyLaplacian — Compute (L x)_i = Σ_{j∈N(i)} w_ij (x_j − x_i) per
// component, writing into `out` (zeroed first). Operates on 3D positions
// stored as Float32Array (3n).
//
// (L x)_i = Σ w_ij x_j + diag_i · x_i
//         = Σ w_ij (x_j − x_i)   (because diag_i = −Σ w_ij)
//
// So the simpler form is the second one; equivalent but kept symmetric
// with the assembled `diag` array for clarity.

export function applyLaplacian(positions, lap, out) {
  const { rowStart, cols, vals, diag } = lap;
  const n = (positions.length / 3) | 0;
  if (!out || out.length !== positions.length) {
    out = new Float32Array(positions.length);
  } else {
    out.fill(0);
  }
  for (let i = 0; i < n; i++) {
    const start = rowStart[i];
    const end   = rowStart[i + 1];
    let sx = diag[i] * positions[3 * i + 0];
    let sy = diag[i] * positions[3 * i + 1];
    let sz = diag[i] * positions[3 * i + 2];
    for (let k = start; k < end; k++) {
      const j = cols[k];
      const w = vals[k];
      sx += w * positions[3 * j + 0];
      sy += w * positions[3 * j + 1];
      sz += w * positions[3 * j + 2];
    }
    out[3 * i + 0] = sx;
    out[3 * i + 1] = sy;
    out[3 * i + 2] = sz;
  }
  return out;
}

// applyLaplacianScalar — Same op but for a single scalar coordinate
// (Float64Array, length n). Used by the CG solver per-component.

function applyLaplacianScalar(x, lap, out) {
  const { rowStart, cols, vals, diag } = lap;
  const n = x.length | 0;
  if (!out || out.length !== n) out = new Float64Array(n);
  else out.fill(0);
  for (let i = 0; i < n; i++) {
    const start = rowStart[i];
    const end   = rowStart[i + 1];
    let s = diag[i] * x[i];
    for (let k = start; k < end; k++) {
      const j = cols[k];
      s += vals[k] * x[j];
    }
    out[i] = s;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// taubinSmoothStep — One single Laplacian smoothing step:
//
//   x_new = x + α · (L x)
//
// `α` is positive for the shrink step (λ) and negative for the inflate
// step (μ). Fixed vertices stay put.

export function taubinSmoothStep(positions, lap, alpha, fixedMask) {
  const n = (positions.length / 3) | 0;
  const lap_x = applyLaplacian(positions, lap, null);
  const out = new Float32Array(positions.length);
  for (let i = 0; i < n; i++) {
    if (fixedMask && fixedMask[i]) {
      out[3 * i + 0] = positions[3 * i + 0];
      out[3 * i + 1] = positions[3 * i + 1];
      out[3 * i + 2] = positions[3 * i + 2];
    } else {
      out[3 * i + 0] = positions[3 * i + 0] + alpha * lap_x[3 * i + 0];
      out[3 * i + 1] = positions[3 * i + 1] + alpha * lap_x[3 * i + 1];
      out[3 * i + 2] = positions[3 * i + 2] + alpha * lap_x[3 * i + 2];
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// runTaubin — Iterate `iterations` PAIRS of (λ, μ) Taubin steps:
//   x ← x + λ · L x
//   x ← x + μ · L x
// (so 2·iterations Laplacian sweeps total). Returns the new positions.

export function runTaubin(positions, lap, fixedMask, opts = {}) {
  const lambda = Number.isFinite(opts.lambda) ? opts.lambda : FAIRING_DEFAULT_LAMBDA;
  const mu     = Number.isFinite(opts.mu)     ? opts.mu     : FAIRING_DEFAULT_MU;
  const iterations = Math.max(1, Math.min(FAIRING_MAX_ITERATIONS,
    (opts.iterations | 0) || FAIRING_DEFAULT_ITERATIONS));
  let x = new Float32Array(positions);
  for (let it = 0; it < iterations; it++) {
    x = taubinSmoothStep(x, lap, lambda, fixedMask);
    x = taubinSmoothStep(x, lap, mu,     fixedMask);
  }
  return x;
}

// ─────────────────────────────────────────────────────────────────────
// Conjugate gradient solver for an SPD linear operator.
//
//   Solve  A · x = b  where applyA(v, out) writes A·v into out.
//
// Standard Hestenes-Stiefel CG; returns { x, iterations, residual }.

export function conjugateGradient(applyA, b, opts = {}) {
  const tol = Number.isFinite(opts.tol) ? opts.tol : FAIRING_CG_TOL;
  const maxIter = Math.max(1, (opts.maxIterations | 0) || FAIRING_CG_MAX_ITERATIONS);
  const n = b.length | 0;
  const x = opts.x0 ? new Float64Array(opts.x0) : new Float64Array(n);
  const r = new Float64Array(n);
  const p = new Float64Array(n);
  const Ap = new Float64Array(n);

  // r = b − A x   ; p = r
  applyA(x, Ap);
  for (let i = 0; i < n; i++) {
    r[i] = b[i] - Ap[i];
    p[i] = r[i];
  }
  let rsold = 0;
  for (let i = 0; i < n; i++) rsold += r[i] * r[i];
  let bnorm = 0;
  for (let i = 0; i < n; i++) bnorm += b[i] * b[i];
  const bnormSqrt = Math.sqrt(bnorm);
  const tolAbs = tol * (bnormSqrt > 1e-30 ? bnormSqrt : 1) * Math.sqrt(n);
  const tolAbsSq = tolAbs * tolAbs;
  let iter = 0;
  if (rsold < tolAbsSq) {
    return { x, iterations: 0, residual: Math.sqrt(rsold) };
  }
  for (iter = 1; iter <= maxIter; iter++) {
    applyA(p, Ap);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    if (!(pAp > 0)) break; // not SPD, bail
    const alpha = rsold / pAp;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
    }
    let rsnew = 0;
    for (let i = 0; i < n; i++) rsnew += r[i] * r[i];
    if (rsnew < tolAbsSq) {
      rsold = rsnew;
      break;
    }
    const beta = rsnew / rsold;
    for (let i = 0; i < n; i++) {
      p[i] = r[i] + beta * p[i];
    }
    rsold = rsnew;
  }
  return { x, iterations: iter, residual: Math.sqrt(rsold) };
}

// ─────────────────────────────────────────────────────────────────────
// runBiLaplace — Solve  (L^T L + ε I) X_new = ε X_old  per coordinate,
// with boundary vertices pinned.
//
// Boundary handling. For each fixed vertex i we want X_new[i] = X_old[i].
// We enforce this by:
//   1. Zeroing all rows / columns of (L^T L) at index i,
//   2. Setting the diagonal at i to 1,
//   3. Setting the RHS at i to X_old[i].
//
// Practically we just rebuild the apply-A and RHS lambdas to honour the
// boundary inside the inner loop. The actual operator L^T L would densify
// because each L^T L row spans the 2-ring; we avoid materialising it and
// instead apply (L^T L) v = L^T (L v) by composing two Laplacian sweeps
// (works because L is symmetric in the weights L_ij = L_ji, both equal
// to (cot α + cot β) / (2 A_i)…
//
// Wait — that's actually only true if A_i = A_j. In general the cotangent
// Laplacian as defined here is NOT symmetric (the factor 1/(2 A_i) differs
// per row). For the bending-energy minimisation we use the SYMMETRIC
// surrogate L_sym defined by w_ij directly (no per-vertex area normalisation),
// then solve (L_sym^T L_sym + ε I) — which is SPD by construction. The
// physical "mass-weighted" form would use the M^{-1} L formulation
// (Botsch & Kobbelt 2004), but for our visual smoothing target the
// unweighted bi-Laplace is the canonical Class-A surfacing operator.
//
// We therefore build a SECOND "symmetric" Laplacian variant on the fly:
//   diag_sym[i]    = − Σ_j w_ij  (raw cotangent sum, no /2A)
//   row_sym[i][k]  =   w_ij      (raw)
// `lap` already has these — vals = w_ij / (2 A_i). We can derive the raw
// weights by multiplying back by (2 A_i). However that's fragile; instead
// we re-traverse the geometry. For now we accept a slight asymmetry —
// CG still converges robustly because the operator is positive definite
// near the boundary-pinned origin, even when not perfectly symmetric in
// arithmetic. For TRUE symmetry callers should pass `lapSym` (built below).

export function assembleSymmetricCotangentLaplacian(positions, indices) {
  // Same machinery as assembleCotangentLaplacian but WITHOUT the
  // 1/(2 A_i) normalisation, so L is symmetric (L_ij = L_ji = w_edge).
  const vertexCount = (positions.length / 3) | 0;
  const triCount = (indices.length / 3) | 0;
  const edgeWeight = new Map();
  const incident = new Map();
  const key = (a, b) => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    return lo + ':' + hi;
  };
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[3 * t + 0] | 0;
    const i1 = indices[3 * t + 1] | 0;
    const i2 = indices[3 * t + 2] | 0;
    if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue;
    if (i0 === i1 || i1 === i2 || i2 === i0) continue;
    const x0 = positions[3 * i0], y0 = positions[3 * i0 + 1], z0 = positions[3 * i0 + 2];
    const x1 = positions[3 * i1], y1 = positions[3 * i1 + 1], z1 = positions[3 * i1 + 2];
    const x2 = positions[3 * i2], y2 = positions[3 * i2 + 1], z2 = positions[3 * i2 + 2];
    const e01 = vsub(x1, y1, z1, x0, y0, z0);
    const e02 = vsub(x2, y2, z2, x0, y0, z0);
    const e12 = vsub(x2, y2, z2, x1, y1, z1);
    const l01 = vlen(e01[0], e01[1], e01[2]);
    const l02 = vlen(e02[0], e02[1], e02[2]);
    const l12 = vlen(e12[0], e12[1], e12[2]);
    if (l01 < 1e-20 || l02 < 1e-20 || l12 < 1e-20) continue;
    let cos0 = vdot(e01[0], e01[1], e01[2], e02[0], e02[1], e02[2]) / (l01 * l02);
    let cos1 = vdot(-e01[0], -e01[1], -e01[2], e12[0], e12[1], e12[2]) / (l01 * l12);
    let cos2 = vdot(-e02[0], -e02[1], -e02[2], -e12[0], -e12[1], -e12[2]) / (l02 * l12);
    if (cos0 > 1) cos0 = 1; if (cos0 < -1) cos0 = -1;
    if (cos1 > 1) cos1 = 1; if (cos1 < -1) cos1 = -1;
    if (cos2 > 1) cos2 = 1; if (cos2 < -1) cos2 = -1;
    const a0 = Math.acos(cos0);
    const a1 = Math.acos(cos1);
    const a2 = Math.acos(cos2);
    const sin0 = Math.sin(a0); const cot0 = sin0 > 1e-30 ? cos0 / sin0 : 0;
    const sin1 = Math.sin(a1); const cot1 = sin1 > 1e-30 ? cos1 / sin1 : 0;
    const sin2 = Math.sin(a2); const cot2 = sin2 > 1e-30 ? cos2 / sin2 : 0;
    const e01k = key(i0, i1);
    const e12k = key(i1, i2);
    const e20k = key(i2, i0);
    edgeWeight.set(e01k, (edgeWeight.get(e01k) || 0) + cot2);
    edgeWeight.set(e12k, (edgeWeight.get(e12k) || 0) + cot0);
    edgeWeight.set(e20k, (edgeWeight.get(e20k) || 0) + cot1);
    if (!incident.has(i0)) incident.set(i0, new Set());
    if (!incident.has(i1)) incident.set(i1, new Set());
    if (!incident.has(i2)) incident.set(i2, new Set());
    incident.get(i0).add(i1); incident.get(i0).add(i2);
    incident.get(i1).add(i0); incident.get(i1).add(i2);
    incident.get(i2).add(i0); incident.get(i2).add(i1);
  }
  // Build CSR. Note: we store HALF of the cotangent sum (the (cot α + cot β)
  // sum maps to TWO triangles per shared edge → factor of (1/2) standard
  // discrete Laplacian convention).
  const rowStart = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < vertexCount; i++) {
    const s = incident.get(i);
    rowStart[i + 1] = rowStart[i] + (s ? s.size : 0);
  }
  const NNZ = rowStart[vertexCount];
  const cols = new Uint32Array(NNZ);
  const vals = new Float64Array(NNZ);
  const diag = new Float64Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const s = incident.get(i);
    if (!s) continue;
    let off = rowStart[i];
    let rowSum = 0;
    const neighbours = Array.from(s).sort((a, b) => a - b);
    for (const j of neighbours) {
      const w = 0.5 * (edgeWeight.get(key(i, j)) || 0);
      cols[off] = j;
      vals[off] = w;
      rowSum += w;
      off += 1;
    }
    diag[i] = -rowSum;
  }
  return {
    rowStart, cols, vals, diag,
    vertexCount, triangleCount: triCount,
  };
}

// runBiLaplace — Solve (L^T L + ε I) X_new = ε X_old  per coordinate.
//
// Boundary vertices are pinned: we reformulate the problem on the FREE
// vertices only by substituting X_new[fixed] = X_old[fixed] into the
// equations. Practically we run CG on the symmetric operator
//   A_free = (L^T L + ε I) restricted to free indices,
// after pre-computing RHS = ε X_old − (L^T L) X_old |_fixed (since L^T L
// times the pinned-portion contributes to the free residual).

export function runBiLaplace(positions, lapSym, fixedMask, opts = {}) {
  const n = (positions.length / 3) | 0;
  const epsilon = Number.isFinite(opts.epsilon) ? opts.epsilon : FAIRING_DEFAULT_EPSILON;
  const cgTol = Number.isFinite(opts.cgTol) ? opts.cgTol : FAIRING_CG_TOL;
  const cgIter = Math.max(1, (opts.cgIterations | 0) || FAIRING_CG_MAX_ITERATIONS);
  const iterations = Math.max(1, Math.min(FAIRING_MAX_ITERATIONS,
    (opts.iterations | 0) || FAIRING_DEFAULT_ITERATIONS));

  // Per coordinate: solve (L^T L + εI) x_new = εx_old + (boundary contrib).
  // We iterate so very small ε still nudges the solution toward smoothness.

  // Operator: applyA(v, out) writes (L^T L + ε I) v into out, with the
  // boundary constraint baked in by zeroing out the boundary rows/cols.
  const work = new Float64Array(n);
  const applyAFree = (v, out) => {
    // 1. masked input: v_free entries are v[i], v_fixed entries are 0.
    //    We pass that through L (symmetric Laplacian) twice.
    for (let i = 0; i < n; i++) {
      if (fixedMask && fixedMask[i]) work[i] = 0;
      else work[i] = v[i];
    }
    const Lv = applyLaplacianScalar(work, lapSym, null);
    // L^T = L (symmetric variant), so L^T (L work) = L (L work).
    const LtLv = applyLaplacianScalar(Lv, lapSym, null);
    // out_free = (L^T L) v_free + ε v_free
    // out_fixed = v_fixed (identity rows on boundary)
    for (let i = 0; i < n; i++) {
      if (fixedMask && fixedMask[i]) {
        out[i] = v[i];
      } else {
        out[i] = LtLv[i] + epsilon * v[i];
      }
    }
  };

  // Precompute the boundary contribution to RHS (b_boundary = L^T L X_old |_fixed
  // applied to a vector that is X_old on fixed and 0 on free, then
  // SUBTRACT the result from the free rows).
  const xCoord = new Float64Array(n);
  const yCoord = new Float64Array(n);
  const zCoord = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xCoord[i] = positions[3 * i + 0];
    yCoord[i] = positions[3 * i + 1];
    zCoord[i] = positions[3 * i + 2];
  }

  function solveOne(coord, iters) {
    let x = new Float64Array(coord);
    // x already satisfies x_fixed = coord_fixed.
    // Run `iters` outer iterations of (L^T L + ε I) x ← εcoord_old (with
    // boundary substitution baked in). For ε > 0 a single CG solve gives
    // the answer; but to remain consistent with the brief that mentions
    // an iteration count, we do `iters` outer passes (each pass updates
    // `coord_old` to the previous solution — this approximates gradient
    // descent on the bending energy with line-search ε).
    let coordOld = new Float64Array(coord);
    for (let it = 0; it < iters; it++) {
      // RHS = ε · coordOld for free vertices, coordOld for fixed.
      const b = new Float64Array(n);
      // 1. Compute boundary contribution: tmp = (L^T L) (coordOld restricted to fixed)
      //    Then subtract from free rows.
      const fixedX = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        if (fixedMask && fixedMask[i]) fixedX[i] = coordOld[i];
      }
      const LfixedX = applyLaplacianScalar(fixedX, lapSym, null);
      const LtLfixedX = applyLaplacianScalar(LfixedX, lapSym, null);
      for (let i = 0; i < n; i++) {
        if (fixedMask && fixedMask[i]) {
          b[i] = coordOld[i];                 // identity row → unchanged
        } else {
          b[i] = epsilon * coordOld[i] - LtLfixedX[i];
        }
      }
      // Warm-start with current x.
      const sol = conjugateGradient(applyAFree, b, {
        x0: x, tol: cgTol, maxIterations: cgIter,
      });
      x = sol.x;
      // Enforce boundary exactly (CG might drift one ULP).
      for (let i = 0; i < n; i++) {
        if (fixedMask && fixedMask[i]) x[i] = coordOld[i];
      }
      coordOld = new Float64Array(x);
    }
    return x;
  }

  const xs = solveOne(xCoord, iterations);
  const ys = solveOne(yCoord, iterations);
  const zs = solveOne(zCoord, iterations);

  const out = new Float32Array(positions.length);
  for (let i = 0; i < n; i++) {
    out[3 * i + 0] = xs[i];
    out[3 * i + 1] = ys[i];
    out[3 * i + 2] = zs[i];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// bendingEnergy — Σ_i A_i · |L x|_i² (cotangent estimate of the mean-
// curvature-squared integral, which is the bending energy minimised by
// the bi-Laplace equation in the smooth limit, Botsch 2004).
//
// `lap` is the area-normalised Laplacian (`assembleCotangentLaplacian`).
// |L x|_i is then the discrete mean-curvature vector. Multiplying by
// A_i and summing gives the integrated κ²-area we surface.

export function bendingEnergy(positions, lap) {
  const n = (positions.length / 3) | 0;
  if (n === 0) return 0;
  const Lx = applyLaplacian(positions, lap, null);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const A = lap.voronoiArea[i] || 0;
    const lx = Lx[3 * i + 0];
    const ly = Lx[3 * i + 1];
    const lz = Lx[3 * i + 2];
    const mag2 = lx * lx + ly * ly + lz * lz;
    energy += A * mag2;
  }
  return energy;
}

// ─────────────────────────────────────────────────────────────────────
// maxDisplacement — Largest per-vertex displacement between two
// Float32Array(3n) position arrays. Returns { maxAll, maxFree, maxFixed }.

export function maxDisplacement(originalPositions, newPositions, fixedMask) {
  const n = (originalPositions.length / 3) | 0;
  let maxAll = 0, maxFree = 0, maxFixed = 0;
  for (let i = 0; i < n; i++) {
    const dx = newPositions[3 * i + 0] - originalPositions[3 * i + 0];
    const dy = newPositions[3 * i + 1] - originalPositions[3 * i + 1];
    const dz = newPositions[3 * i + 2] - originalPositions[3 * i + 2];
    const d = Math.hypot(dx, dy, dz);
    if (d > maxAll) maxAll = d;
    if (fixedMask && fixedMask[i]) {
      if (d > maxFixed) maxFixed = d;
    } else {
      if (d > maxFree) maxFree = d;
    }
  }
  return { maxAll, maxFree, maxFixed };
}

// ─────────────────────────────────────────────────────────────────────
// validateInputs — Real degenerate-input check: no vertices, no triangles,
// not enough interior vertices for a meaningful fairing pass.

export function validateInputs(positions, indices) {
  const n = (positions.length / 3) | 0;
  const t = (indices.length / 3) | 0;
  if (n === 0) return { ok: false, reason: 'no vertices' };
  if (t === 0) return { ok: false, reason: 'no triangles' };
  if (n < 3)  return { ok: false, reason: `too few vertices (${n})` };
  if (t < 1)  return { ok: false, reason: `too few triangles (${t})` };
  // Check at least one interior vertex exists for fairing to act on.
  const boundary = detectBoundaryVertices(indices, n);
  let interior = 0;
  for (let i = 0; i < n; i++) if (!boundary[i]) interior += 1;
  if (interior === 0) {
    return { ok: false, reason: 'no interior vertices (all on boundary)' };
  }
  return { ok: true, reason: null, interiorCount: interior, boundaryCount: n - interior };
}

// ─────────────────────────────────────────────────────────────────────
// runFairing — Top-level driver. Mode 'smooth' runs the Taubin loop;
// mode 'fair' runs the bi-Laplace solve. Boundary vertices (or any
// extra user-pinned vertices) stay fixed.

export function runFairing(geometry, opts = {}) {
  const mode = (opts.mode || FAIRING_DEFAULT_MODE).toLowerCase();
  if (!FAIRING_MODES.includes(mode)) {
    return { ok: false, reason: `unknown mode '${mode}'` };
  }
  const positionsOrig = extractPositions(geometry);
  const indices = extractTriangleIndices(geometry);
  const valid = validateInputs(positionsOrig, indices);
  if (!valid.ok) return { ok: false, reason: valid.reason };
  const n = (positionsOrig.length / 3) | 0;
  const triCount = (indices.length / 3) | 0;

  // Build the operators.
  const lap = assembleCotangentLaplacian(positionsOrig, indices);
  // Fixed mask = boundary vertices ∪ user-marked pins.
  const fixedMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) fixedMask[i] = lap.boundaryMask[i];
  if (opts.fixedExtra && opts.fixedExtra.length === n) {
    for (let i = 0; i < n; i++) {
      if (opts.fixedExtra[i]) fixedMask[i] = 1;
    }
  }

  const preEnergy = bendingEnergy(positionsOrig, lap);

  let positionsNew;
  let iterations;
  const params = {};
  if (mode === 'smooth') {
    iterations = Math.max(1, Math.min(FAIRING_MAX_ITERATIONS,
      (opts.iterations | 0) || FAIRING_DEFAULT_ITERATIONS));
    const lambda = Number.isFinite(opts.lambda) ? opts.lambda : FAIRING_DEFAULT_LAMBDA;
    const mu     = Number.isFinite(opts.mu)     ? opts.mu     : FAIRING_DEFAULT_MU;
    params.lambda = lambda;
    params.mu = mu;
    positionsNew = runTaubin(positionsOrig, lap, fixedMask,
      { lambda, mu, iterations });
  } else {
    iterations = Math.max(1, Math.min(FAIRING_MAX_ITERATIONS,
      (opts.iterations | 0) || FAIRING_DEFAULT_ITERATIONS));
    const epsilon = Number.isFinite(opts.epsilon) ? opts.epsilon : FAIRING_DEFAULT_EPSILON;
    const cgIterations = Math.max(1,
      (opts.cgIterations | 0) || FAIRING_CG_MAX_ITERATIONS);
    const cgTol = Number.isFinite(opts.cgTol) ? opts.cgTol : FAIRING_CG_TOL;
    params.epsilon = epsilon;
    params.cgIterations = cgIterations;
    params.cgTol = cgTol;
    // Build the SYMMETRIC variant for the bi-Laplace solve.
    const lapSym = assembleSymmetricCotangentLaplacian(positionsOrig, indices);
    positionsNew = runBiLaplace(positionsOrig, lapSym, fixedMask,
      { iterations, epsilon, cgIterations, cgTol });
  }

  const postEnergy = bendingEnergy(positionsNew, lap);
  const energyReduction = preEnergy > 0
    ? (preEnergy - postEnergy) / preEnergy : 0;

  const disp = maxDisplacement(positionsOrig, positionsNew, fixedMask);

  let boundaryCount = 0;
  for (let i = 0; i < n; i++) if (fixedMask[i]) boundaryCount += 1;

  return {
    ok: true,
    mode,
    iterations,
    params,
    preEnergy,
    postEnergy,
    energyReduction,
    energyReductionPct: energyReduction * 100,
    maxDisplacement: disp.maxAll,
    maxFreeDisplacement: disp.maxFree,
    maxBoundaryDisplacement: disp.maxFixed,
    boundaryPreservationPct: disp.maxAll > 0
      ? 100 * (1 - disp.maxFixed / Math.max(disp.maxAll, 1e-30))
      : 100,
    boundaryCount,
    interiorCount: n - boundaryCount,
    vertexCount: n,
    triangleCount: triCount,
    positions: positionsNew,
    originalPositions: positionsOrig,
    boundaryMask: fixedMask,
    voronoiArea: lap.voronoiArea,
    averageEdgeLength: lap.averageEdgeLength,
  };
}

// ─────────────────────────────────────────────────────────────────────
// makeTestSphere — Subdivided icosphere with optional per-vertex
// deterministic noise. Used by the e2e to seed a "noisy sphere" with a
// reproducible bending energy.

// Deterministic 31-bit LCG (Park-Miller) — no Math.random() so the test
// asserts hold against a fixed seed.
function lcgFactory(seed) {
  let s = (seed | 0) || 1;
  return () => {
    // Park-Miller LCG, period 2^31 − 2.
    s = (s * 48271) % 2147483647;
    return (s & 0x7fffffff) / 2147483647;
  };
}

export function makeTestSphere({
  R = 25, divisions = 3, noiseAmp = 0, noiseSeed = 12345,
} = {}) {
  // Icosahedron base verts.
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1,  t,  0], [ 1,  t,  0], [-1, -t,  0], [ 1, -t,  0],
    [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
    [ t,  0, -1], [ t,  0,  1], [-t,  0, -1], [-t,  0,  1],
  ];
  verts = verts.map((v) => {
    const L = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return [v[0] / L, v[1] / L, v[2] / L];
  });
  let faces = [
    [ 0, 11,  5], [ 0,  5,  1], [ 0,  1,  7], [ 0,  7, 10], [ 0, 10, 11],
    [ 1,  5,  9], [ 5, 11,  4], [11, 10,  2], [10,  7,  6], [ 7,  1,  8],
    [ 3,  9,  4], [ 3,  4,  2], [ 3,  2,  6], [ 3,  6,  8], [ 3,  8,  9],
    [ 4,  9,  5], [ 2,  4, 11], [ 6,  2, 10], [ 8,  6,  7], [ 9,  8,  1],
  ];
  const midpointCache = new Map();
  const getMidpoint = (a, b) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (midpointCache.has(key)) return midpointCache.get(key);
    const va = verts[a], vb = verts[b];
    const m = [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2];
    const L = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
    const norm = [m[0] / L, m[1] / L, m[2] / L];
    const idx = verts.length;
    verts.push(norm);
    midpointCache.set(key, idx);
    return idx;
  };
  for (let d = 0; d < divisions; d++) {
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = getMidpoint(a, b);
      const bc = getMidpoint(b, c);
      const ca = getMidpoint(c, a);
      next.push([a, ab, ca]);
      next.push([b, bc, ab]);
      next.push([c, ca, bc]);
      next.push([ab, bc, ca]);
    }
    faces = next;
  }
  const rand = lcgFactory(noiseSeed);
  const positions = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    const ux = verts[i][0];
    const uy = verts[i][1];
    const uz = verts[i][2];
    let noiseScale = 0;
    if (noiseAmp > 0) {
      // Noise applied along the radial direction so the input mesh is
      // still recognisably spherical but riddled with high-frequency
      // bumps. 2× the LCG draw gives a triangular-distribution-like
      // ripple ∈ [-noiseAmp, +noiseAmp].
      const a = rand();
      const b = rand();
      const c = rand();
      noiseScale = noiseAmp * (2 * (a + b + c) / 3 - 1);
    }
    const Rfact = R + noiseScale;
    positions[3 * i + 0] = ux * Rfact;
    positions[3 * i + 1] = uy * Rfact;
    positions[3 * i + 2] = uz * Rfact;
  }
  const indices = new Uint32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    indices[3 * i + 0] = faces[i][0];
    indices[3 * i + 1] = faces[i][1];
    indices[3 * i + 2] = faces[i][2];
  }
  return { positions, indices };
}

// makeTestSphereWithHole — drop every triangle whose centroid has y <
// −holeFraction·R; the new free boundary becomes the hole edge so the e2e
// can prove boundary preservation.

export function makeTestSphereWithHole({
  R = 25, divisions = 3, holeFraction = 0.5, noiseAmp = 0, noiseSeed = 12345,
} = {}) {
  const sphere = makeTestSphere({ R, divisions, noiseAmp, noiseSeed });
  const positions = sphere.positions;
  const triCount = sphere.indices.length / 3;
  const kept = [];
  const yCut = -holeFraction * R;
  for (let t = 0; t < triCount; t++) {
    const i0 = sphere.indices[3 * t + 0];
    const i1 = sphere.indices[3 * t + 1];
    const i2 = sphere.indices[3 * t + 2];
    const yC = (positions[3 * i0 + 1] + positions[3 * i1 + 1]
              + positions[3 * i2 + 1]) / 3;
    if (yC > yCut) {
      kept.push(i0, i1, i2);
    }
  }
  const indices = new Uint32Array(kept);
  return { positions, indices };
}

// ─────────────────────────────────────────────────────────────────────
// makeBufferGeometryLike — Pack a {positions, indices} pair into a
// duck-typed BufferGeometry stub usable by the math helpers (saves the
// e2e from importing three).

export function makeBufferGeometryLike(positions, indices) {
  const n = (positions.length / 3) | 0;
  return {
    attributes: {
      position: {
        count: n,
        getX: (i) => positions[3 * i + 0],
        getY: (i) => positions[3 * i + 1],
        getZ: (i) => positions[3 * i + 2],
        array: positions,
      },
    },
    index: indices && indices.length > 0
      ? { array: indices, count: indices.length }
      : null,
  };
}
