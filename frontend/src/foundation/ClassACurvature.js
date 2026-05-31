/**
 * ArchDisc Foundation — class-A discrete curvature analysis on triangle meshes.
 *
 * The class-A surfacing workflow (Alias, ICEM Surf, CATIA ICEM) inspects a
 * surface with two visual instruments:
 *   • a Gaussian-curvature heatmap — exposes local imperfections, dents and
 *     abrupt curvature changes a tangent-continuous (G1) join would hide;
 *   • zebra stripes — see ZebraStripes.js.
 *
 * This module is the heatmap half. It computes a TRUE discrete Gaussian
 * curvature field on an arbitrary triangle mesh via the angle-deficit
 * (Gauss-Bonnet) scheme — the standard discrete-differential-geometry
 * operator — and maps the field to the production red/white/blue colour
 * convention.
 *
 *   Discrete Gaussian curvature at a vertex v (angle-deficit / angular defect):
 *
 *       K_v = ( 2π − Σ θ_i ) / A_v
 *
 *   where θ_i are the interior angles, at v, of the triangles incident to v,
 *   and A_v is the vertex's mixed Voronoi area. The numerator 2π − Σ θ_i is
 *   the angular defect: how far the fan of incident triangles falls short of
 *   tiling a full turn. A_v normalises the defect to an area density, so K_v
 *   carries the dimensions (1/length²) of smooth Gaussian curvature and
 *   converges to it under refinement (quadratically — Gauss-Bonnet scheme).
 *
 *   The mixed area (Meyer, Desbrun, Schröder, Barr — "Discrete Differential-
 *   Geometry Operators for Triangulated 2-Manifolds") uses the genuine
 *   Voronoi-cell area for non-obtuse triangles and a barycentric fallback for
 *   obtuse ones, so A_v stays positive and well-behaved on bad triangulations.
 *
 * A discrete MEAN-curvature magnitude is also produced — |H| from the
 * Laplace-Beltrami (cotangent) operator, the companion DDG operator — to feed
 * the meanRange the class-A panel reports.
 *
 * Honest scope: this is a per-vertex DISCRETE estimator on a tessellation. It
 * is the analysis instrument a class-A modeller reads; it is not the exact
 * analytic curvature of an underlying NURBS surface. For the analytic NURBS
 * path see SurfaceCurvature.js (first/second fundamental forms). The two are
 * complementary — discrete here for arbitrary triangle soup, analytic there
 * for evaluable NURBS patches.
 *
 * Kernel-free pure JS — node-importable for e2e.
 */

const TWO_PI = Math.PI * 2;

// ── small vector helpers ─────────────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);

/**
 * Normalise a mesh argument to `{ vertices:[[x,y,z]...], triangles:[[a,b,c]...] }`.
 * Accepts either that object form, or the flat typed-array form
 * `{ positions:Float32Array, indices:Uint32Array }` the kernel tessellator
 * emits. Returns the object form.
 */
function normalizeMesh(mesh) {
  if (!mesh) throw new Error('ClassACurvature: mesh is required');
  if (Array.isArray(mesh.vertices) && Array.isArray(mesh.triangles)) {
    return { vertices: mesh.vertices, triangles: mesh.triangles };
  }
  if (mesh.positions && mesh.indices) {
    const vertices = [];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      vertices.push([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
    }
    const triangles = [];
    for (let i = 0; i < mesh.indices.length; i += 3) {
      triangles.push([mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]);
    }
    return { vertices, triangles };
  }
  throw new Error('ClassACurvature: mesh needs {vertices,triangles} or {positions,indices}');
}

/**
 * The three interior angles of a triangle, plus a degeneracy flag.
 * Angles are returned in the corner order [angleAtA, angleAtB, angleAtC].
 */
function triangleAngles(A, B, C) {
  const ab = sub(B, A), ac = sub(C, A);
  const ba = sub(A, B), bc = sub(C, B);
  const ca = sub(A, C), cb = sub(B, C);
  const lAB = norm(ab), lAC = norm(ac), lBC = norm(bc);
  // Degenerate triangle: a zero-length edge → angles are undefined; skip it.
  if (lAB < 1e-12 || lAC < 1e-12 || lBC < 1e-12) {
    return { angles: [0, 0, 0], degenerate: true };
  }
  const ang = (u, v, lu, lv) => {
    let c = dot(u, v) / (lu * lv);
    if (c > 1) c = 1; else if (c < -1) c = -1;
    return Math.acos(c);
  };
  const aA = ang(ab, ac, lAB, lAC);
  const aB = ang(ba, bc, lAB, lBC);
  const aC = ang(ca, cb, lAC, lBC);
  return { angles: [aA, aB, aC], degenerate: false };
}

/**
 * cot of the angle at corner P given the two edge vectors leaving P.
 * cot θ = (u·v) / |u×v| — numerically stable; large for near-degenerate
 * (sliver) corners, which the area-mixing step keeps in check.
 */
function cotAngle(u, v) {
  const c = cross(u, v);
  const s = norm(c);
  if (s < 1e-14) return 0;
  return dot(u, v) / s;
}

/**
 * Discrete Gaussian (and mean) curvature field of a triangle mesh.
 *
 * Per vertex:
 *   • angular defect  2π − Σ θ_i  accumulated over incident triangles;
 *     for a BOUNDARY vertex the reference is π (a half turn) not 2π, so
 *     a flat boundary correctly reports zero curvature.
 *   • mixed Voronoi area  A_v  (Meyer et al.): genuine Voronoi area for a
 *     non-obtuse triangle, barycentric (½ or ¼ of the triangle area) for an
 *     obtuse one.
 *   • Gaussian curvature  K_v = defect / A_v.
 *   • a Laplace-Beltrami (cotangent) mean-curvature vector whose half-length
 *     gives |H_v|, the discrete mean-curvature magnitude.
 *
 * Degenerate triangles (zero-length edge / zero area) are skipped so they
 * never poison a vertex's accumulators.
 *
 * @param {object} mesh  {vertices,triangles} or {positions,indices}
 * @returns {{
 *   gaussian: Float64Array,   // per-vertex Gaussian curvature (1/mm²)
 *   mean:     Float64Array,   // per-vertex |mean curvature| (1/mm)
 *   area:     Float64Array,   // per-vertex mixed Voronoi area (mm²)
 *   defect:   Float64Array,   // per-vertex angular defect (rad)
 *   boundary: Uint8Array,     // 1 if the vertex lies on a mesh boundary
 *   vertexCount: number,
 *   triangleCount: number,
 *   degenerateTriangles: number
 * }}
 */
export function gaussianCurvatureField(mesh) {
  const { vertices, triangles } = normalizeMesh(mesh);
  const nV = vertices.length;

  const defect = new Float64Array(nV);    // starts at the reference turn, below
  const area = new Float64Array(nV);      // mixed Voronoi area accumulator
  const hVec = new Float64Array(nV * 3);  // cotangent Laplacian vector accumulator
  const valence = new Uint32Array(nV);

  // ── Edge → incident-triangle count, to flag boundary vertices ──────────────
  // A boundary EDGE borders exactly one triangle; a boundary VERTEX touches a
  // boundary edge. Boundary vertices use a π reference defect (Gauss-Bonnet
  // for a surface with boundary) instead of 2π.
  const edgeFaceCount = new Map();
  const ekey = (i, j) => (i < j ? i * nV + j : j * nV + i);
  for (const tri of triangles) {
    const [a, b, c] = tri;
    if (a === b || b === c || a === c) continue; // topologically degenerate
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = ekey(u, v);
      edgeFaceCount.set(k, (edgeFaceCount.get(k) || 0) + 1);
    }
  }
  const boundary = new Uint8Array(nV);
  for (const [k, count] of edgeFaceCount) {
    if (count === 1) {
      const i = Math.floor(k / nV), j = k % nV;
      boundary[i] = 1;
      boundary[j] = 1;
    }
  }

  let degenerateTriangles = 0;

  // ── Single triangle walk: angles, mixed area, cotangent Laplacian ──────────
  for (const tri of triangles) {
    const [ia, ib, ic] = tri;
    if (ia === ib || ib === ic || ia === ic) { degenerateTriangles++; continue; }
    const A = vertices[ia], B = vertices[ib], C = vertices[ic];
    const { angles, degenerate } = triangleAngles(A, B, C);
    if (degenerate) { degenerateTriangles++; continue; }
    const [aA, aB, aC] = angles;

    // Accumulate interior angles for the angular defect.
    defect[ia] += aA; defect[ib] += aB; defect[ic] += aC;
    valence[ia]++; valence[ib]++; valence[ic]++;

    // Triangle area (½|edge×edge|).
    const ab = sub(B, A), ac = sub(C, A);
    const triArea = 0.5 * norm(cross(ab, ac));
    if (triArea < 1e-18) { degenerateTriangles++; continue; }

    // Squared edge lengths and corner cotangents — used by BOTH the mixed-area
    // Voronoi computation and the cotangent-Laplacian below, so they are
    // computed unconditionally (not inside the non-obtuse branch).
    const lAB2 = dot(ab, ab);          // |B−A|²
    const lCA2 = dot(ac, ac);          // |C−A|²
    const lBC2 = (() => { const bc = sub(C, B); return dot(bc, bc); })(); // |C−B|²
    const cotA = 1 / Math.tan(aA);
    const cotB = 1 / Math.tan(aB);
    const cotC = 1 / Math.tan(aC);

    // ── Mixed Voronoi area (Meyer, Desbrun, Schröder, Barr 2003) ─────────────
    // Obtuse triangle → barycentric split (½ triArea at the obtuse corner,
    // ¼ at each of the other two). Non-obtuse → genuine Voronoi area, where
    // the corner P's share is (1/8) Σ_{edges at P} |edge|² · cot(opposite).
    const halfPi = Math.PI / 2;
    const obtuse = aA > halfPi || aB > halfPi || aC > halfPi;
    if (obtuse) {
      const big = aA > halfPi ? 0 : (aB > halfPi ? 1 : 2);
      area[ia] += big === 0 ? triArea / 2 : triArea / 4;
      area[ib] += big === 1 ? triArea / 2 : triArea / 4;
      area[ic] += big === 2 ? triArea / 2 : triArea / 4;
    } else {
      // Voronoi share of each corner (edges meeting at the corner, weighted by
      // the cotangent of the angle opposite each edge).
      area[ia] += (lAB2 * cotC + lCA2 * cotB) / 8;
      area[ib] += (lAB2 * cotC + lBC2 * cotA) / 8;
      area[ic] += (lBC2 * cotA + lCA2 * cotB) / 8;
    }

    // ── Cotangent Laplacian contribution (mean-curvature normal) ─────────────
    // For each edge (i,j) the cotangent weight is cot(angle opposite i-j).
    // Edge AB is opposite corner C; edge BC opposite A; edge CA opposite B.
    const accumulate = (i, j, cot) => {
      // (1/2) cot(opp) (x_i − x_j) added to vertex i's Laplacian vector,
      // and the negated displacement to vertex j's.
      const d = sub(vertices[i], vertices[j]);
      hVec[i * 3]     += 0.5 * cot * d[0];
      hVec[i * 3 + 1] += 0.5 * cot * d[1];
      hVec[i * 3 + 2] += 0.5 * cot * d[2];
      hVec[j * 3]     -= 0.5 * cot * d[0];
      hVec[j * 3 + 1] -= 0.5 * cot * d[1];
      hVec[j * 3 + 2] -= 0.5 * cot * d[2];
    };
    accumulate(ia, ib, cotC); // edge AB ↔ opposite corner C
    accumulate(ib, ic, cotA); // edge BC ↔ opposite corner A
    accumulate(ic, ia, cotB); // edge CA ↔ opposite corner B
  }

  // ── Finalise per-vertex K and |H| ──────────────────────────────────────────
  const gaussian = new Float64Array(nV);
  const mean = new Float64Array(nV);
  for (let v = 0; v < nV; v++) {
    // Reference turn: a full 2π in the interior, π on a boundary.
    const reference = boundary[v] ? Math.PI : TWO_PI;
    const angDefect = reference - defect[v];
    defect[v] = angDefect; // overwrite the accumulator with the actual defect
    const A = area[v];
    if (valence[v] === 0 || A < 1e-15) {
      gaussian[v] = 0;
      mean[v] = 0;
      continue;
    }
    // Discrete Gaussian curvature — the angle-deficit operator.
    gaussian[v] = angDefect / A;
    // Discrete mean curvature: |H| = (1/2) |Laplacian| / A_v.
    const hx = hVec[v * 3], hy = hVec[v * 3 + 1], hz = hVec[v * 3 + 2];
    mean[v] = 0.5 * Math.hypot(hx, hy, hz) / A;
  }

  return {
    gaussian,
    mean,
    area,
    defect,
    boundary,
    vertexCount: nV,
    triangleCount: triangles.length,
    degenerateTriangles,
  };
}

/**
 * Robust symmetric range of a curvature field for colour mapping.
 *
 * A few sliver triangles can spike one vertex's curvature by orders of
 * magnitude; mapping the colour ramp to the raw min/max would wash the
 * whole part to a flat mid-tone. So the range is taken from a high
 * PERCENTILE of |value| (default 98th), then made symmetric (±r) so that
 * zero curvature always lands at the neutral colour. The true raw extrema
 * are returned separately for honest reporting.
 *
 * @param {Float64Array|number[]} field
 * @param {number} [percentile=0.98]
 * @returns {{ rawMin, rawMax, robust, percentile }}
 */
export function curvatureRange(field, percentile = 0.98) {
  let rawMin = Infinity, rawMax = -Infinity;
  const mags = [];
  for (let i = 0; i < field.length; i++) {
    const v = field[i];
    if (!Number.isFinite(v)) continue;
    if (v < rawMin) rawMin = v;
    if (v > rawMax) rawMax = v;
    mags.push(Math.abs(v));
  }
  if (mags.length === 0) {
    return { rawMin: 0, rawMax: 0, robust: 0, percentile };
  }
  mags.sort((a, b) => a - b);
  const idx = Math.min(mags.length - 1,
    Math.max(0, Math.floor(percentile * (mags.length - 1))));
  const robust = mags[idx] || mags[mags.length - 1] || 0;
  return { rawMin, rawMax, robust, percentile };
}

/**
 * Map a curvature field to per-vertex RGB colours — the production class-A
 * convention:
 *
 *   • RED   — positive curvature (convex / elliptic / dome regions);
 *   • WHITE — curvature ≈ zero (flat or developable regions);
 *   • BLUE  — negative curvature (saddle / hyperbolic regions).
 *
 * The ramp is a diverging white-centred map: each vertex's signed curvature
 * is divided by the robust symmetric range `r` and clamped to [−1,1]; the
 * positive half fades white→red, the negative half white→blue. A diverging
 * map (rather than a rainbow) keeps the zero-curvature reference visually
 * unambiguous — the way Alias / ICEM Surf present a Gaussian heatmap.
 *
 * @param {Float64Array|number[]} field  per-vertex curvature
 * @param {object} [opts]
 * @param {number} [opts.range]       symmetric ± range; default = robust range
 * @param {number} [opts.percentile]  percentile for the auto range (0.98)
 * @param {number} [opts.gamma]       contrast exponent on the ramp (default 0.7
 *                                    — <1 lifts low-curvature detail)
 * @returns {{ colors: Float32Array, range: number, gamma: number }}
 */
export function curvatureColors(field, opts = {}) {
  const gamma = opts.gamma ?? 0.7;
  let range = opts.range;
  if (!(Number.isFinite(range) && range > 0)) {
    range = curvatureRange(field, opts.percentile ?? 0.98).robust;
  }
  // Guard a perfectly flat field (range 0) so we still emit valid white.
  const denom = range > 1e-20 ? range : 1;

  const n = field.length;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let t = field[i] / denom;            // signed, ~[-1,1] after clamp
    if (!Number.isFinite(t)) t = 0;
    if (t > 1) t = 1; else if (t < -1) t = -1;
    const mag = Math.pow(Math.abs(t), gamma); // contrast-shaped magnitude
    let r, g, b;
    if (t >= 0) {
      // white (1,1,1) → red (1,0,0): drop green & blue with magnitude.
      r = 1;
      g = 1 - mag;
      b = 1 - mag;
    } else {
      // white (1,1,1) → blue (0.10,0.32,1): drop red & green with magnitude.
      r = 1 - mag;
      g = 1 - 0.68 * mag;
      b = 1;
    }
    colors[i * 3]     = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  return { colors, range, gamma };
}

/**
 * One-call class-A curvature analysis of a triangle mesh.
 *
 * Computes the discrete Gaussian-curvature field, derives the per-vertex
 * heatmap colours, and reports the curvature ranges the class-A panel shows.
 *
 * @param {object} mesh  {vertices,triangles} or {positions,indices}
 * @param {object} [opts]  forwarded to curvatureColors (range/percentile/gamma)
 * @returns {{
 *   colors: Float32Array,        // per-vertex RGB heatmap
 *   gaussianRange: [min,max],    // raw Gaussian-curvature extrema (1/mm²)
 *   meanRange: [min,max],        // raw |mean curvature| extrema (1/mm)
 *   samples: number,             // vertices analysed
 *   triangleCount: number,
 *   degenerateTriangles: number,
 *   robustRange: number,         // the symmetric ± range the ramp used
 *   field: { gaussian, mean, area, defect, boundary }
 * }}
 */
export function analyzeClassACurvature(mesh, opts = {}) {
  const field = gaussianCurvatureField(mesh);
  const { colors, range } = curvatureColors(field.gaussian, opts);

  // Raw extrema — honest, un-clamped, for the panel's numeric readout.
  let gMin = Infinity, gMax = -Infinity, mMin = Infinity, mMax = -Infinity;
  for (let i = 0; i < field.gaussian.length; i++) {
    const g = field.gaussian[i];
    if (Number.isFinite(g)) { if (g < gMin) gMin = g; if (g > gMax) gMax = g; }
    const m = field.mean[i];
    if (Number.isFinite(m)) { if (m < mMin) mMin = m; if (m > mMax) mMax = m; }
  }
  if (!Number.isFinite(gMin)) { gMin = 0; gMax = 0; }
  if (!Number.isFinite(mMin)) { mMin = 0; mMax = 0; }

  return {
    colors,
    gaussianRange: [gMin, gMax],
    meanRange: [mMin, mMax],
    samples: field.vertexCount,
    triangleCount: field.triangleCount,
    degenerateTriangles: field.degenerateTriangles,
    robustRange: range,
    field: {
      gaussian: field.gaussian,
      mean: field.mean,
      area: field.area,
      defect: field.defect,
      boundary: field.boundary,
    },
  };
}
