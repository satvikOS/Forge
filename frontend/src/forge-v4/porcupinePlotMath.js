// PUSH-211 (Slice-156) — Porcupine curvature plot math.
//
// Discrete differential-geometry operators on a triangle BufferGeometry,
// per Meyer / Desbrun / Schroeder / Barr 2003 "Discrete Differential-
// Geometry Operators for Triangulated 2-Manifolds". For every vertex of
// a triangle mesh we estimate:
//
//   * The voronoi (or mixed) area  A_voronoi (Meyer §3.3).
//   * The Gaussian curvature      K = (2π − Σᵢ αᵢ) / A_voronoi.
//                                 (angle-defect formula, Meyer §4.2.)
//   * The mean-curvature vector    H·n = (1 / (2 A_voronoi)) Σⱼ (cot αⱼ + cot βⱼ) (xᵢ − xⱼ)
//                                 (cotangent Laplacian, Meyer §3.5.)
//     then H = ½ |H·n|, signed so that H > 0 when (H·n)·n > 0 (i.e. the
//     Laplacian agrees with the outward normal — convex side).
//   * The two principal curvatures κ₁,κ₂ from {H, K} via
//        κ₁,κ₂ = H ± √(max(H² − K, 0))
//     and the max-principal κ_max = κ₁ (the one with larger |·|).
//
// The porcupine plot itself is a flat THREE.LineSegments where every
// vertex i emits a quill from P_i to P_i + scale·κ·n_i with an HSV
// diverging colour (red = positive, blue = negative, green = ≈0).
//
// We provide pure-JS helpers exported for unit-test + e2e use, plus a
// `buildPorcupineFromBufferGeometry` driver that takes a THREE
// BufferGeometry and returns:
//
//   {
//     vertexCount, triangleCount,
//     positions:  Float32Array (3·vertexCount, world XYZ),
//     normals:    Float32Array (3·vertexCount, unit normals),
//     gaussian:   Float32Array (vertexCount, K_i, 1/length²),
//     mean:       Float32Array (vertexCount, H_i, 1/length),
//     principalMax: Float32Array (vertexCount, κ_max_i, 1/length),
//     voronoiArea: Float32Array (vertexCount),
//     linePositions:  Float32Array (3·2·vertexCount, line endpoints),
//     lineColors:     Float32Array (3·2·vertexCount, RGB per endpoint),
//     stats:    { kMin, kMax, kAbsMax, count, mode, scale },
//   }
//
// All math is deterministic — no random — and lives at module scope so
// the e2e spec can validate sphere identities:
//
//   For a sphere of radius R:
//     H ≡ 1/R,  K ≡ 1/R²,  κ₁ = κ₂ = 1/R.
//
// Hard constraints honoured:
//   * NO new npm / C++ deps. Plain JS + Float32Array.
//   * Real Meyer 2003 cotangent + angle-defect math. No stubs.

// ─────────────────────────────────────────────────────────────────────
// Constants — shared with the panel + e2e.

export const FORGE_PORCUPINE_EVENT      = 'forge:porcupine-plot-built';
export const FORGE_PORCUPINE_STORAGE    = 'forge.v4.porcupinePlot';
export const FORGE_PORCUPINE_GROUP_NAME = 'forge.porcupinePlot.group';
export const FORGE_PORCUPINE_USERDATA_TAG = 'porcupinePlot';

export const PORCUPINE_MODES = Object.freeze(['gaussian', 'mean', 'principal']);
export const PORCUPINE_DEFAULT_MODE  = 'mean';
export const PORCUPINE_DEFAULT_SCALE = 5.0;
export const PORCUPINE_MIN_SCALE     = 0.05;
export const PORCUPINE_MAX_SCALE     = 200.0;

// ─────────────────────────────────────────────────────────────────────
// Tiny vec3 helpers — no allocations in the inner loops.

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
// extractTriangleIndices — Return a triangle index array (Uint32Array)
// regardless of whether the BufferGeometry is indexed or non-indexed.
// For non-indexed geometry the triangles are implicit: (0,1,2), (3,4,5)…
// All triangles must reference vertex ids in [0, vertexCount).

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
  // Non-indexed: pretend (3i, 3i+1, 3i+2) for every triangle.
  const triCount = (vertexCount / 3) | 0;
  const out = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    out[3 * t + 0] = 3 * t + 0;
    out[3 * t + 1] = 3 * t + 1;
    out[3 * t + 2] = 3 * t + 2;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// extractPositions — Return a flat Float32Array of vertex positions
// (size 3·vertexCount) from a BufferGeometry. Returns a fresh copy so
// the caller can mutate / dispose without disturbing the source.

export function extractPositions(geometry) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) {
    return new Float32Array(0);
  }
  const a = geometry.attributes.position;
  const n = a.count | 0;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[3 * i + 0] = a.getX(i);
    out[3 * i + 1] = a.getY(i);
    out[3 * i + 2] = a.getZ(i);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// computeVertexNormals — Area-weighted face-normal sum, then normalise
// per vertex. Equivalent to three.js BufferGeometry.computeVertexNormals
// but doesn't require importing three (so the helper is unit-testable).

export function computeVertexNormals(positions, indices) {
  const vertexCount = (positions.length / 3) | 0;
  const normals = new Float32Array(vertexCount * 3);
  if (vertexCount === 0 || indices.length === 0) return normals;
  const triCount = (indices.length / 3) | 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[3 * t + 0] | 0;
    const i1 = indices[3 * t + 1] | 0;
    const i2 = indices[3 * t + 2] | 0;
    if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue;
    const x0 = positions[3 * i0 + 0], y0 = positions[3 * i0 + 1], z0 = positions[3 * i0 + 2];
    const x1 = positions[3 * i1 + 0], y1 = positions[3 * i1 + 1], z1 = positions[3 * i1 + 2];
    const x2 = positions[3 * i2 + 0], y2 = positions[3 * i2 + 1], z2 = positions[3 * i2 + 2];
    // n_face = (v1 − v0) × (v2 − v0). Length encodes 2× face area, so the
    // accumulated normal is area-weighted automatically.
    const e1 = vsub(x1, y1, z1, x0, y0, z0);
    const e2 = vsub(x2, y2, z2, x0, y0, z0);
    const c  = vcross(e1[0], e1[1], e1[2], e2[0], e2[1], e2[2]);
    normals[3 * i0 + 0] += c[0]; normals[3 * i0 + 1] += c[1]; normals[3 * i0 + 2] += c[2];
    normals[3 * i1 + 0] += c[0]; normals[3 * i1 + 1] += c[1]; normals[3 * i1 + 2] += c[2];
    normals[3 * i2 + 0] += c[0]; normals[3 * i2 + 1] += c[1]; normals[3 * i2 + 2] += c[2];
  }
  for (let i = 0; i < vertexCount; i++) {
    const nx = normals[3 * i + 0], ny = normals[3 * i + 1], nz = normals[3 * i + 2];
    const m  = Math.hypot(nx, ny, nz);
    if (m > 1e-30) {
      normals[3 * i + 0] = nx / m;
      normals[3 * i + 1] = ny / m;
      normals[3 * i + 2] = nz / m;
    } else {
      normals[3 * i + 0] = 0;
      normals[3 * i + 1] = 0;
      normals[3 * i + 2] = 1;
    }
  }
  return normals;
}

// ─────────────────────────────────────────────────────────────────────
// computeDiscreteCurvature — Meyer 2003 §3.3 (mixed Voronoi area) +
// §3.5 (cotangent mean-curvature vector) + §4.2 (angle-defect Gaussian
// curvature).
//
// For every triangle (i, j, k) — using the convention that angle αᵢ is
// at vertex i, opposite edge (j↔k) — we accumulate per-vertex:
//
//   angleSum[i] += αᵢ                                       (Gaussian)
//   areaMix[i]  += { Voronoi area at i if all 3 angles acute,
//                    else 1/2 triangle area  if αᵢ obtuse,
//                    else 1/4 triangle area  if another angle obtuse }
//                                                            (Meyer Fig 4)
//   Δ[i] += (cot αⱼ + cot αₖ) · (xⱼ − xᵢ)                    (mean·n vector)
//   Δ[j] += (cot αᵢ + cot αₖ) · (xᵢ − xⱼ)                    via symmetry
//   Δ[k] += (cot αⱼ + cot αᵢ) · (xⱼ − xₖ)... etc.
//
// After the full sweep:
//
//   K_i = (2π − angleSum[i]) / A_voronoi[i]
//   H_i·nᵢ = Δ[i] / (2·A_voronoi[i])
//   H_i = 0.5 · |Δ[i]| / (2·A_voronoi[i])  signed by sign(Δ[i] · n_i)
//
// Returns { gaussian:Float32Array, mean:Float32Array, voronoiArea:Float32Array,
//           angleDefect:Float32Array (for diagnostics) }.

export function computeDiscreteCurvature(positions, indices, normals) {
  const vertexCount = (positions.length / 3) | 0;
  const triCount = (indices.length / 3) | 0;
  const TWO_PI = 2 * Math.PI;
  const angleSum  = new Float32Array(vertexCount);
  const areaMix   = new Float32Array(vertexCount);
  // Laplacian accumulator — three components per vertex.
  const lapX = new Float32Array(vertexCount);
  const lapY = new Float32Array(vertexCount);
  const lapZ = new Float32Array(vertexCount);
  // Boundary vertices have an open angle sum, so we mark which vertices
  // see at least one obtuse-angled triangle (used only for diagnostics).
  // 1 if vertex i borders any triangle with an obtuse angle at i.

  // Initial-state for sphere with no triangles → empty 0 arrays.
  if (vertexCount === 0 || triCount === 0) {
    return {
      gaussian:    new Float32Array(0),
      mean:        new Float32Array(0),
      voronoiArea: new Float32Array(0),
      angleDefect: new Float32Array(0),
    };
  }

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[3 * t + 0] | 0;
    const i1 = indices[3 * t + 1] | 0;
    const i2 = indices[3 * t + 2] | 0;
    if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue;
    const x0 = positions[3 * i0 + 0], y0 = positions[3 * i0 + 1], z0 = positions[3 * i0 + 2];
    const x1 = positions[3 * i1 + 0], y1 = positions[3 * i1 + 1], z1 = positions[3 * i1 + 2];
    const x2 = positions[3 * i2 + 0], y2 = positions[3 * i2 + 1], z2 = positions[3 * i2 + 2];

    // Edge vectors. Naming: e_jk = x_k − x_j.
    const e01 = vsub(x1, y1, z1, x0, y0, z0);
    const e02 = vsub(x2, y2, z2, x0, y0, z0);
    const e12 = vsub(x2, y2, z2, x1, y1, z1);
    const l01 = vlen(e01[0], e01[1], e01[2]);
    const l02 = vlen(e02[0], e02[1], e02[2]);
    const l12 = vlen(e12[0], e12[1], e12[2]);
    if (l01 < 1e-20 || l02 < 1e-20 || l12 < 1e-20) continue;

    // Squared edge lengths — used for the Voronoi area weights.
    const sq01 = l01 * l01;
    const sq02 = l02 * l02;
    const sq12 = l12 * l12;

    // Interior angles at vertex 0, 1, 2 using vectors emanating from
    // each vertex (so the cosine reads the actual interior angle).
    // α_0 sits between e01 and e02.
    let cos0 = vdot(e01[0], e01[1], e01[2], e02[0], e02[1], e02[2]) / (l01 * l02);
    // α_1 sits between (-e01) and e12.
    let cos1 = vdot(-e01[0], -e01[1], -e01[2], e12[0], e12[1], e12[2]) / (l01 * l12);
    // α_2 sits between (-e02) and (-e12).
    let cos2 = vdot(-e02[0], -e02[1], -e02[2], -e12[0], -e12[1], -e12[2]) / (l02 * l12);
    if (cos0 > 1) cos0 = 1; if (cos0 < -1) cos0 = -1;
    if (cos1 > 1) cos1 = 1; if (cos1 < -1) cos1 = -1;
    if (cos2 > 1) cos2 = 1; if (cos2 < -1) cos2 = -1;
    const a0 = Math.acos(cos0);
    const a1 = Math.acos(cos1);
    const a2 = Math.acos(cos2);

    // Triangle area via cross product on e01, e02.
    const c   = vcross(e01[0], e01[1], e01[2], e02[0], e02[1], e02[2]);
    const triArea = 0.5 * vlen(c[0], c[1], c[2]);

    // cot α = cos α / sin α. Guard against tiny sin (degenerate / flat
    // angles → cotangent → ∞).
    const sin0 = Math.sin(a0); const cot0 = sin0 > 1e-30 ? cos0 / sin0 : 0;
    const sin1 = Math.sin(a1); const cot1 = sin1 > 1e-30 ? cos1 / sin1 : 0;
    const sin2 = Math.sin(a2); const cot2 = sin2 > 1e-30 ? cos2 / sin2 : 0;

    // Angle-defect contribution per vertex.
    angleSum[i0] += a0;
    angleSum[i1] += a1;
    angleSum[i2] += a2;

    // ── Voronoi / mixed area (Meyer Fig 4) ─────────────────────────
    // Pure Voronoi formula:
    //   A_voronoi(i in triangle) = 1/8 (cot α_j · ‖x_i - x_k‖² + cot α_k · ‖x_i - x_j‖²)
    //   where i, j, k name the three vertices and α_j, α_k are the
    //   angles opposite x_i (i.e. at the OTHER two vertices).
    //
    // For obtuse triangles we substitute a fixed fallback:
    //   - if the angle at i is obtuse, A(i) = T/2
    //   - otherwise (some other angle is obtuse), A(i) = T/4.
    const obtuse0 = a0 > Math.PI / 2;
    const obtuse1 = a1 > Math.PI / 2;
    const obtuse2 = a2 > Math.PI / 2;
    const obtuseTriangle = obtuse0 || obtuse1 || obtuse2;
    if (!obtuseTriangle) {
      // All acute — apply the standard Voronoi weight.
      // Vertex 0 sees edges (0-1) and (0-2) with squared lengths sq01, sq02.
      // The "opposite" angles at 1 (a1) and 2 (a2) gate the weights.
      areaMix[i0] += 0.125 * (cot2 * sq01 + cot1 * sq02);
      areaMix[i1] += 0.125 * (cot2 * sq01 + cot0 * sq12);
      areaMix[i2] += 0.125 * (cot1 * sq02 + cot0 * sq12);
    } else {
      // Obtuse triangle.
      areaMix[i0] += obtuse0 ? (triArea / 2) : (triArea / 4);
      areaMix[i1] += obtuse1 ? (triArea / 2) : (triArea / 4);
      areaMix[i2] += obtuse2 ? (triArea / 2) : (triArea / 4);
    }

    // ── Cotangent Laplacian (mean-curvature vector) ───────────────
    // Meyer 2003 §3.5:
    //   2 A_i H_i n_i = (1/2) Σ_{j ∈ N(i)} (cot α_ij + cot β_ij) (x_j − x_i)
    //
    // where α_ij and β_ij are the two angles opposite the edge (i, j)
    // in the two triangles adjacent to that edge. We accumulate
    // contributions on a per-triangle basis: each triangle contributes
    // its cotangent at the vertex opposite the edge to BOTH endpoints
    // of the edge.
    //
    // Per triangle (i0,i1,i2):
    //   edge (i0, i1) is opposite α_2 → cot2 contributes (x1 − x0)
    //     to lap[i0] and (x0 − x1) to lap[i1].
    //   edge (i1, i2) is opposite α_0 → cot0 contributes (x2 − x1)
    //     to lap[i1] and (x1 − x2) to lap[i2].
    //   edge (i2, i0) is opposite α_1 → cot1 contributes (x0 − x2)
    //     to lap[i2] and (x2 − x0) to lap[i0].
    //
    // The 1/2 factor is fused into the final divide by 2·A; the cotangent
    // sum across two adjacent triangles is what reconstructs (cot α + cot β).
    lapX[i0] += cot2 * e01[0];
    lapY[i0] += cot2 * e01[1];
    lapZ[i0] += cot2 * e01[2];
    lapX[i1] += cot2 * (-e01[0]);
    lapY[i1] += cot2 * (-e01[1]);
    lapZ[i1] += cot2 * (-e01[2]);

    lapX[i1] += cot0 * e12[0];
    lapY[i1] += cot0 * e12[1];
    lapZ[i1] += cot0 * e12[2];
    lapX[i2] += cot0 * (-e12[0]);
    lapY[i2] += cot0 * (-e12[1]);
    lapZ[i2] += cot0 * (-e12[2]);

    lapX[i2] += cot1 * (-e02[0]); // (x0 − x2) = −e02
    lapY[i2] += cot1 * (-e02[1]);
    lapZ[i2] += cot1 * (-e02[2]);
    lapX[i0] += cot1 * e02[0];    // (x2 − x0) = e02
    lapY[i0] += cot1 * e02[1];
    lapZ[i0] += cot1 * e02[2];
  }

  // Derive curvature scalars.
  const gaussian    = new Float32Array(vertexCount);
  const mean        = new Float32Array(vertexCount);
  const voronoiArea = new Float32Array(vertexCount);
  const angleDefect = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const A = areaMix[i];
    voronoiArea[i] = A;
    const defect = TWO_PI - angleSum[i];
    angleDefect[i] = defect;
    if (A > 1e-30) {
      gaussian[i] = defect / A;
      // Mean-curvature vector magnitude / 2A then halved (Meyer eq §3.5).
      // The accumulated lap is Σ (cotα+cotβ)(x_j − x_i) across one ring.
      const lx = lapX[i] / (2 * A);
      const ly = lapY[i] / (2 * A);
      const lz = lapZ[i] / (2 * A);
      const lmag = Math.hypot(lx, ly, lz);
      const H = 0.5 * lmag;
      // Sign: positive if Laplacian agrees with outward normal (convex
      // side). The accumulated Laplacian points TOWARDS the surface
      // centre for a convex bump (because (x_j − x_i) summed around a
      // bump points inward) — so for an outward-pointing normal we
      // negate to recover H > 0 on the convex side, matching the
      // sphere identity H = 1/R below.
      let sign = +1;
      if (normals && normals.length === 3 * vertexCount) {
        const nx = normals[3 * i + 0];
        const ny = normals[3 * i + 1];
        const nz = normals[3 * i + 2];
        const lDotN = lx * nx + ly * ny + lz * nz;
        // Outward-pointing convex bump → Laplacian dots NEGATIVE with n.
        sign = (lDotN < 0) ? +1 : -1;
      }
      mean[i] = sign * H;
    } else {
      gaussian[i] = 0;
      mean[i]     = 0;
    }
  }

  return { gaussian, mean, voronoiArea, angleDefect };
}

// ─────────────────────────────────────────────────────────────────────
// principalFromMeanGaussian — Given H and K per vertex, return the two
// principal curvatures (κ₁, κ₂) and the max-principal κ_max (the one
// with larger absolute value). κ₁,κ₂ = H ± √(max(H² − K, 0)).

export function principalFromMeanGaussian(meanH, gaussianK) {
  const n = meanH.length | 0;
  const k1 = new Float32Array(n);
  const k2 = new Float32Array(n);
  const kMax = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const H = meanH[i];
    const K = gaussianK[i];
    const disc = Math.max(H * H - K, 0);
    const root = Math.sqrt(disc);
    k1[i] = H + root;
    k2[i] = H - root;
    kMax[i] = Math.abs(k1[i]) >= Math.abs(k2[i]) ? k1[i] : k2[i];
  }
  return { k1, k2, kMax };
}

// ─────────────────────────────────────────────────────────────────────
// divergingColor — Map a signed scalar in [-1, 1] (clamped) to a
// diverging RGB ramp:
//
//   t = -1 → blue   (0, 0, 1)
//   t =  0 → green  (0, 1, 0.4) — slightly bluish-green for legibility
//   t = +1 → red    (1, 0.15, 0.15)
//
// Returns [r, g, b] in [0, 1].

export function divergingColor(t) {
  let v = t;
  if (!Number.isFinite(v)) v = 0;
  if (v < -1) v = -1; if (v > 1) v = 1;
  // Piecewise lerp through (blue, green, red) anchors. The mid-anchor
  // green sits at t = 0; we pick a slightly desaturated green to keep
  // the porcupine quills visible against a dark background.
  if (v <= 0) {
    const w = v + 1; // [0, 1] from blue→green
    return [
      0.0   * (1 - w) + 0.0  * w,
      0.0   * (1 - w) + 1.0  * w,
      1.0   * (1 - w) + 0.4  * w,
    ];
  }
  const w = v; // [0, 1] from green→red
  return [
    0.0  * (1 - w) + 1.0   * w,
    1.0  * (1 - w) + 0.15  * w,
    0.4  * (1 - w) + 0.15  * w,
  ];
}

// ─────────────────────────────────────────────────────────────────────
// pickCurvatureSeries — Given the per-mode arrays, return the requested
// series + the human label + the units.

export function pickCurvatureSeries(mode, curvature) {
  const m = String(mode || PORCUPINE_DEFAULT_MODE).toLowerCase();
  if (m === 'gaussian') {
    return { values: curvature.gaussian, label: 'Gaussian κ', units: '1/L²', mode: 'gaussian' };
  }
  if (m === 'principal') {
    return { values: curvature.principalMax, label: 'Max-principal κ', units: '1/L', mode: 'principal' };
  }
  return { values: curvature.mean, label: 'Mean κ', units: '1/L', mode: 'mean' };
}

// ─────────────────────────────────────────────────────────────────────
// buildPorcupineLineSegments — Build the flat THREE.LineSegments vertex
// + colour buffers given per-vertex (P, n, κ) and a UI scale.
//
// Each vertex i emits ONE line segment from P_i to P_i + scale·κ·n_i
// (i.e. 2 buffer-vertices per source-vertex). The colour at both
// endpoints is the diverging-ramp colour for κ_i / kAbsMax (so the
// whole quill renders one solid colour).
//
// Returns:
//   { linePositions: Float32Array(6·N),
//     lineColors:    Float32Array(6·N),
//     stats:         { kMin, kMax, kAbsMax, count, scale, mode } }

export function buildPorcupineLineSegments({
  positions, normals, curvatureValues, scale,
}) {
  const vertexCount = (positions.length / 3) | 0;
  const linePositions = new Float32Array(vertexCount * 6);
  const lineColors    = new Float32Array(vertexCount * 6);
  if (vertexCount === 0) {
    return {
      linePositions, lineColors,
      stats: { kMin: 0, kMax: 0, kAbsMax: 0, count: 0, scale: scale || 0 },
    };
  }
  let kMin = +Infinity, kMax = -Infinity, kAbsMax = 0;
  for (let i = 0; i < vertexCount; i++) {
    const v = curvatureValues[i];
    if (Number.isFinite(v)) {
      if (v < kMin) kMin = v;
      if (v > kMax) kMax = v;
      const a = Math.abs(v);
      if (a > kAbsMax) kAbsMax = a;
    }
  }
  if (!Number.isFinite(kMin)) kMin = 0;
  if (!Number.isFinite(kMax)) kMax = 0;
  if (kAbsMax < 1e-30) kAbsMax = 1e-30;
  for (let i = 0; i < vertexCount; i++) {
    const px = positions[3 * i + 0];
    const py = positions[3 * i + 1];
    const pz = positions[3 * i + 2];
    const nx = normals[3 * i + 0];
    const ny = normals[3 * i + 1];
    const nz = normals[3 * i + 2];
    const k  = Number.isFinite(curvatureValues[i]) ? curvatureValues[i] : 0;
    const len = scale * k;
    const qx = px + len * nx;
    const qy = py + len * ny;
    const qz = pz + len * nz;
    linePositions[6 * i + 0] = px;
    linePositions[6 * i + 1] = py;
    linePositions[6 * i + 2] = pz;
    linePositions[6 * i + 3] = qx;
    linePositions[6 * i + 4] = qy;
    linePositions[6 * i + 5] = qz;
    // Colour: signed-normalised t in [-1, 1].
    const t = k / kAbsMax;
    const c = divergingColor(t);
    lineColors[6 * i + 0] = c[0];
    lineColors[6 * i + 1] = c[1];
    lineColors[6 * i + 2] = c[2];
    lineColors[6 * i + 3] = c[0];
    lineColors[6 * i + 4] = c[1];
    lineColors[6 * i + 5] = c[2];
  }
  return {
    linePositions,
    lineColors,
    stats: { kMin, kMax, kAbsMax, count: vertexCount, scale },
  };
}

// ─────────────────────────────────────────────────────────────────────
// summariseCurvature — Reduce a curvature array to {min, max, avg,
// absAvg, absMax} stats used by the panel readouts.

export function summariseCurvature(values) {
  const n = values.length | 0;
  if (n === 0) {
    return { count: 0, min: 0, max: 0, avg: 0, absAvg: 0, absMax: 0 };
  }
  let mn = +Infinity, mx = -Infinity;
  let sum = 0, absSum = 0, absMx = 0, finiteCount = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    finiteCount += 1;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    sum += v;
    const a = Math.abs(v);
    absSum += a;
    if (a > absMx) absMx = a;
  }
  if (finiteCount === 0) {
    return { count: 0, min: 0, max: 0, avg: 0, absAvg: 0, absMax: 0 };
  }
  return {
    count:  finiteCount,
    min:    mn,
    max:    mx,
    avg:    sum / finiteCount,
    absAvg: absSum / finiteCount,
    absMax: absMx,
  };
}

// ─────────────────────────────────────────────────────────────────────
// buildPorcupineFromBufferGeometry — Top-level driver. Takes a THREE
// BufferGeometry (or anything quack-typed to one — has
// .attributes.position with .count + .getX/Y/Z), a curvature mode
// ('gaussian'|'mean'|'principal') and a scale. Returns a complete result
// payload including the line buffers ready to feed THREE.LineSegments.

export function buildPorcupineFromBufferGeometry(geometry, opts = {}) {
  const mode = (opts.mode || PORCUPINE_DEFAULT_MODE).toLowerCase();
  const scale = Number.isFinite(opts.scale) ? opts.scale : PORCUPINE_DEFAULT_SCALE;
  const positions = extractPositions(geometry);
  const indices   = extractTriangleIndices(geometry);
  const vertexCount = (positions.length / 3) | 0;
  const triangleCount = (indices.length / 3) | 0;
  const normals = computeVertexNormals(positions, indices);
  const { gaussian, mean, voronoiArea, angleDefect } =
    computeDiscreteCurvature(positions, indices, normals);
  const { k1, k2, kMax: principalMax } =
    principalFromMeanGaussian(mean, gaussian);
  const curvature = {
    gaussian, mean, principalMax, k1, k2, voronoiArea, angleDefect,
  };
  const series = pickCurvatureSeries(mode, curvature);
  const lines  = buildPorcupineLineSegments({
    positions, normals, curvatureValues: series.values, scale,
  });
  return {
    vertexCount, triangleCount,
    positions, normals,
    gaussian, mean, principalMax, k1, k2,
    voronoiArea, angleDefect,
    linePositions: lines.linePositions,
    lineColors:    lines.lineColors,
    stats: {
      ...lines.stats,
      mode: series.mode,
      seriesLabel: series.label,
      seriesUnits: series.units,
      meanSummary:        summariseCurvature(mean),
      gaussianSummary:    summariseCurvature(gaussian),
      principalSummary:   summariseCurvature(principalMax),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Sphere identity checker — for the e2e + unit tests.
//
// On a triangulated sphere of radius R, theoretical values are:
//   H ≡ 1/R   (mean curvature)
//   K ≡ 1/R²  (Gaussian curvature)
//   κ₁ = κ₂ = 1/R (principal — both)
//
// `checkSphereIdentity(values, expected)` returns:
//   { medianRel, meanRel, maxRel, count }
//
// where each `rel` is |v_i − expected| / |expected| over interior
// vertices (we drop the lowest- and highest-area vertices since they're
// the pole singularities of a UV sphere parametrisation).

export function checkSphereIdentity(values, expected, voronoiArea) {
  const n = values.length | 0;
  if (n === 0 || !Number.isFinite(expected) || expected === 0) {
    return { medianRel: NaN, meanRel: NaN, maxRel: NaN, count: 0 };
  }
  // Trim poles by area threshold — keep only vertices whose voronoiArea
  // is in the central 90 % of the area distribution.
  let kept = [];
  if (voronoiArea && voronoiArea.length === n) {
    const areas = Array.from(voronoiArea).slice().sort((a, b) => a - b);
    const aLo = areas[Math.floor(0.05 * n)] || 0;
    const aHi = areas[Math.min(n - 1, Math.floor(0.95 * n))] || Infinity;
    for (let i = 0; i < n; i++) {
      const a = voronoiArea[i];
      if (a >= aLo && a <= aHi && Number.isFinite(values[i])) {
        kept.push(Math.abs(values[i] - expected) / Math.abs(expected));
      }
    }
  } else {
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(values[i])) {
        kept.push(Math.abs(values[i] - expected) / Math.abs(expected));
      }
    }
  }
  if (kept.length === 0) {
    return { medianRel: NaN, meanRel: NaN, maxRel: NaN, count: 0 };
  }
  kept.sort((a, b) => a - b);
  const median = kept[kept.length >> 1];
  let mx = 0, s = 0;
  for (const v of kept) {
    if (v > mx) mx = v;
    s += v;
  }
  return {
    medianRel: median,
    meanRel:   s / kept.length,
    maxRel:    mx,
    count:     kept.length,
  };
}
