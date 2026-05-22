/**
 * ArchDisc Foundation — projecting a 3-D curve onto a NURBS surface to obtain
 * a parametric (u,v) curve — a "pcurve".
 *
 * This is the pure-JS port of OCCT's `ShapeConstruct_ProjectCurveOnSurface`
 * (the kernel routine that generates the pcurves a non-planar B-rep face needs
 * on every boundary edge). It performs:
 *
 *   1. POINT INVERSION — for a sampled 3-D point Q, find the surface parameter
 *      (u,v) with S(u,v) closest to Q. A coarse grid search seeds a damped
 *      Newton iteration on the two stationarity equations
 *         f(u,v) = (S − Q) · S_u = 0
 *         g(u,v) = (S − Q) · S_v = 0
 *      solved with the 2×2 Jacobian built from the surface 2nd derivatives
 *      (Piegl & Tiller, "The NURBS Book" §6.1, eqs. 6.3–6.6).
 *
 *   2. PCURVE FITTING — the inverted (u,v) samples are interpolated by a
 *      degree-3 B-spline curve in 2-D parameter space (global cubic
 *      interpolation, Piegl & Tiller §9.2.1 / A9.1). The fitted 2-D curve is
 *      the pcurve: evaluating it and pushing the result through S(u,v)
 *      reproduces the original 3-D boundary curve to the projection tolerance.
 *
 * The result is a `{ knots, degree, controlPoints2d }` 2-D B-spline plus
 * validity diagnostics (closed in parameter space, no degenerate spans, the
 * max push-forward error). The B-rep topology kernel attaches this pcurve to
 * the boundary edge of an arbitrary-surface face (see
 * `kernel/topology/FaceReplace.js`).
 *
 * Kernel-free pure math — node-importable for e2e.
 *
 * Refs:
 *   Piegl & Tiller, "The NURBS Book" (Springer, 2nd ed.) §6.1 (point
 *     inversion / projection — Newton iteration), §9.2.1 / A9.1 (global
 *     curve interpolation).
 *   OCCT `ShapeConstruct_ProjectCurveOnSurface` — the authoritative kernel
 *     routine this module ports (dev.opencascade.org refman).
 *   Ma & Hewitt, "Point inversion and projection for NURBS curve and
 *     surface: control polygon approach", CAGD 20 (2003) 79–99 — robust
 *     initial-guess strategy (the coarse grid seed used here).
 */

const EPS = 1e-12;

// ── tiny vec helpers ────────────────────────────────────────────────────────
const sub3  = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3  = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ────────────────────────────────────────────────────────────────────────────
// 1. Point inversion — closest (u,v) on a NURBS surface to a 3-D point
// ────────────────────────────────────────────────────────────────────────────

/**
 * Invert a 3-D point onto a NURBSSurface: find (u,v) minimising |S(u,v) − Q|.
 *
 * Strategy (Piegl & Tiller §6.1):
 *   - Seed: a coarse `gridU × gridV` sampling of the surface picks the closest
 *     grid node — a robust starting point that avoids the Newton iteration
 *     converging to a far stationary point.
 *   - Refine: damped Newton-Raphson on the two coupled equations
 *        r(u,v) = S(u,v) − Q
 *        f = r · S_u ,  g = r · S_v
 *     with the 2×2 Jacobian
 *        J = | S_u·S_u + r·S_uu      S_u·S_v + r·S_uv |
 *            | S_u·S_v + r·S_uv      S_v·S_v + r·S_vv |
 *     The step is clamped to the parameter domain; convergence tests are the
 *     two standard ones — point coincidence (|r| small) and zero cosine (the
 *     residual is perpendicular to both tangents).
 *
 * @param {import('./NURBSSurface.js').NURBSSurface} surface
 * @param {number[]} Q   the 3-D query point [x,y,z]
 * @param {object} [opts]
 * @param {number} [opts.gridU=12]   coarse seed grid resolution in u
 * @param {number} [opts.gridV=12]   coarse seed grid resolution in v
 * @param {number} [opts.maxIter=24] Newton iteration cap
 * @param {number} [opts.tol=1e-9]   point-coincidence tolerance (model units)
 * @returns {{ u:number, v:number, point:number[], distance:number,
 *             converged:boolean, iterations:number }}
 */
export function invertPointOnSurface(surface, Q, opts = {}) {
  const gridU = Math.max(2, opts.gridU || 12);
  const gridV = Math.max(2, opts.gridV || 12);
  const maxIter = Math.max(1, opts.maxIter || 24);
  const tol = opts.tol || 1e-9;

  const u0 = surface.uMin, u1 = surface.uMax;
  const v0 = surface.vMin, v1 = surface.vMax;
  const du = u1 - u0, dv = v1 - v0;

  // ── coarse grid seed ──────────────────────────────────────────────────────
  let bestU = u0, bestV = v0, bestD = Infinity;
  for (let j = 0; j <= gridV; j++) {
    const v = v0 + dv * (j / gridV);
    for (let i = 0; i <= gridU; i++) {
      const u = u0 + du * (i / gridU);
      const S = surface.eval(u, v);
      const d = dist3(S, Q);
      if (d < bestD) { bestD = d; bestU = u; bestV = v; }
    }
  }

  // ── damped Newton refinement ──────────────────────────────────────────────
  let u = bestU, v = bestV;
  let converged = false;
  let iterations = 0;
  // characteristic span lengths — used for the zero-cosine convergence test.
  for (let it = 0; it < maxIter; it++) {
    iterations = it + 1;
    const d = surface.evalDerivatives2(u, v);
    const r = sub3(d.S, Q);                       // residual S − Q
    const rLen = Math.hypot(r[0], r[1], r[2]);

    // Convergence test 1 — point coincidence.
    if (rLen < tol) { converged = true; break; }

    const SuLen = Math.hypot(d.Su[0], d.Su[1], d.Su[2]) || EPS;
    const SvLen = Math.hypot(d.Sv[0], d.Sv[1], d.Sv[2]) || EPS;
    const f = dot3(r, d.Su);
    const g = dot3(r, d.Sv);

    // Convergence test 2 — zero cosine (residual ⟂ both tangents).
    const cosU = Math.abs(f) / (rLen * SuLen);
    const cosV = Math.abs(g) / (rLen * SvLen);
    if (cosU < 1e-10 && cosV < 1e-10) { converged = true; break; }

    // 2×2 Jacobian of (f,g) wrt (u,v).
    const a11 = dot3(d.Su, d.Su) + dot3(r, d.Suu);
    const a12 = dot3(d.Su, d.Sv) + dot3(r, d.Suv);
    const a22 = dot3(d.Sv, d.Sv) + dot3(r, d.Svv);
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < EPS) break;               // singular — stop, keep best

    let stepU = -(a22 * f - a12 * g) / det;
    let stepV = -(a11 * g - a12 * f) / det;

    // Clamp the step so we never leave the parameter rectangle in one jump.
    const maxStepU = du, maxStepV = dv;
    if (Math.abs(stepU) > maxStepU) stepU *= maxStepU / Math.abs(stepU);
    if (Math.abs(stepV) > maxStepV) stepV *= maxStepV / Math.abs(stepV);

    let nu = u + stepU;
    let nv = v + stepV;
    // Clamp to the (clamped, non-periodic) domain.
    if (nu < u0) nu = u0; else if (nu > u1) nu = u1;
    if (nv < v0) nv = v0; else if (nv > v1) nv = v1;

    // Convergence test 3 — parameter no longer moving.
    const moved = Math.hypot(
      (nu - u) * SuLen, (nv - v) * SvLen);
    u = nu; v = nv;
    if (moved < tol) { converged = true; break; }
  }

  const point = surface.eval(u, v);
  return {
    u, v, point,
    distance: dist3(point, Q),
    converged,
    iterations,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// degree-3 global interpolation in 2-D parameter space (Piegl & Tiller A9.1)
// ────────────────────────────────────────────────────────────────────────────

/** Cox-de Boor degree-p basis functions (NURBS Book A2.2). */
function basisFunctions(knots, span, t, p) {
  const N = new Float64Array(p + 1);
  const left = new Float64Array(p + 1);
  const right = new Float64Array(p + 1);
  N[0] = 1;
  for (let j = 1; j <= p; j++) {
    left[j] = t - knots[span + 1 - j];
    right[j] = knots[span + j] - t;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const denom = right[r + 1] + left[j - r];
      const tmp = denom > EPS ? N[r] / denom : 0;
      N[r] = saved + right[r + 1] * tmp;
      saved = left[j - r] * tmp;
    }
    N[j] = saved;
  }
  return N;
}

/** Knot span index for parameter t (NURBS Book A2.1). */
function knotSpan(knots, nCP, t, p) {
  if (t >= knots[nCP] - EPS) return nCP - 1;
  if (t <= knots[p] + EPS) return p;
  let lo = p, hi = nCP;
  let mid = (lo + hi) >> 1;
  while (t < knots[mid] || t >= knots[mid + 1]) {
    if (t < knots[mid]) hi = mid; else lo = mid;
    mid = (lo + hi) >> 1;
  }
  return mid;
}

/** Chord-length parameters t_0..t_m ∈ [0,1] for a polyline of 2-D points. */
function chordLengthParams2d(Q) {
  const m = Q.length - 1;
  const chord = new Array(m + 1).fill(0);
  let total = 0;
  for (let k = 1; k <= m; k++) {
    chord[k] = Math.hypot(Q[k][0] - Q[k - 1][0], Q[k][1] - Q[k - 1][1]);
    total += chord[k];
  }
  const t = new Array(m + 1);
  t[0] = 0; t[m] = 1;
  if (total < EPS) {
    for (let k = 1; k < m; k++) t[k] = k / m;
  } else {
    let acc = 0;
    for (let k = 1; k < m; k++) { acc += chord[k]; t[k] = acc / total; }
  }
  return t;
}

/** Degree-3 clamped knot vector by averaging (NURBS Book §9.2.1, eq. 9.8). */
function cubicKnotVector(tk) {
  const m = tk.length - 1;
  const p = 3;
  const nCP = m + 1;
  const nKnots = nCP + p + 1;
  const knots = new Array(nKnots).fill(0);
  for (let i = 0; i <= p; i++) { knots[i] = 0; knots[nKnots - 1 - i] = 1; }
  for (let j = 1; j <= m - p; j++) {
    let s = 0;
    for (let i = j; i <= j + p - 1; i++) s += tk[i];
    knots[j + p] = s / p;
  }
  return knots;
}

/**
 * Solve A·x = d (A n×n scalar, d n×2 — both 2-D coords solved together).
 * Gaussian elimination with partial pivoting. Returns null if singular.
 */
function solveLinear2d(A, d) {
  const n = A.length;
  const M = A.map((row) => row.slice());
  const R = d.map((p) => [p[0], p[1]]);
  for (let col = 0; col < n; col++) {
    let piv = col, best = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > best) { best = v; piv = r; }
    }
    if (best < 1e-14) return null;
    if (piv !== col) {
      const tm = M[piv]; M[piv] = M[col]; M[col] = tm;
      const tr = R[piv]; R[piv] = R[col]; R[col] = tr;
    }
    const diag = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / diag;
      if (factor === 0) continue;
      for (let c = col; c < n; c++) M[r][c] -= factor * M[col][c];
      R[r][0] -= factor * R[col][0];
      R[r][1] -= factor * R[col][1];
    }
  }
  const x = new Array(n);
  for (let row = n - 1; row >= 0; row--) {
    const acc = [R[row][0], R[row][1]];
    for (let c = row + 1; c < n; c++) {
      acc[0] -= M[row][c] * x[c][0];
      acc[1] -= M[row][c] * x[c][1];
    }
    const inv = 1 / M[row][row];
    x[row] = [acc[0] * inv, acc[1] * inv];
  }
  return x;
}

/**
 * Fit a degree-3 B-spline curve through 2-D points Q[0..m] EXACTLY (global
 * interpolation, Piegl & Tiller A9.1). Returns { degree, knots, controlPoints }.
 */
function fitCubic2d(Q) {
  const m = Q.length - 1;
  const p = 3;
  const nCP = m + 1;
  const tk = chordLengthParams2d(Q);

  if (m < 3) {
    // Too few points for a cubic — emit a degree-1 polyline B-spline.
    const deg = Math.max(1, m);
    const knots = [];
    for (let i = 0; i <= deg; i++) knots.push(0);
    for (let i = 1; i < nCP - deg; i++) knots.push(i / (nCP - deg));
    for (let i = 0; i <= deg; i++) knots.push(1);
    return { degree: deg, knots, controlPoints: Q.map((q) => [q[0], q[1]]), params: tk };
  }

  const knots = cubicKnotVector(tk);
  const A = Array.from({ length: nCP }, () => new Array(nCP).fill(0));
  const rhs = new Array(nCP);
  for (let k = 0; k <= m; k++) {
    const t = tk[k];
    const span = knotSpan(knots, nCP, t, p);
    const N = basisFunctions(knots, span, t, p);
    for (let r = 0; r <= p; r++) {
      const cpIdx = span - p + r;
      if (cpIdx >= 0 && cpIdx < nCP) A[k][cpIdx] += N[r];
    }
    rhs[k] = [Q[k][0], Q[k][1]];
  }
  let P = solveLinear2d(A, rhs);
  if (!P) P = Q.map((q) => [q[0], q[1]]);  // singular — fall back to data
  return { degree: p, knots, controlPoints: P, params: tk };
}

/** Evaluate a 2-D B-spline {degree,knots,controlPoints} at parameter t. */
export function evalPCurve(pcurve, t) {
  const p = pcurve.degree;
  const cp = pcurve.controlPoints;
  const knots = pcurve.knots;
  const nCP = cp.length;
  const span = knotSpan(knots, nCP, t, p);
  const N = basisFunctions(knots, span, t, p);
  let u = 0, v = 0;
  for (let r = 0; r <= p; r++) {
    const idx = span - p + r;
    if (idx < 0 || idx >= nCP) continue;
    u += N[r] * cp[idx][0];
    v += N[r] * cp[idx][1];
  }
  return [u, v];
}

// ────────────────────────────────────────────────────────────────────────────
// 2. projectCurveOnSurface — the public pcurve generator
// ────────────────────────────────────────────────────────────────────────────

/**
 * Project a 3-D boundary curve onto a NURBS surface and return its 2-D pcurve.
 *
 * The 3-D curve is supplied as an ordered polyline of points (the caller
 * tessellates whatever curve representation it has — a B-rep edge, a NURBS
 * curve, an arc — to a polyline). Each polyline point is inverted onto the
 * surface (`invertPointOnSurface`); the (u,v) samples are then fitted by a
 * degree-3 2-D B-spline.
 *
 * @param {import('./NURBSSurface.js').NURBSSurface} surface
 * @param {number[][]} curvePoints  ordered 3-D points along the boundary curve
 * @param {object} [opts]
 * @param {number} [opts.gridU], [opts.gridV] coarse seed grid (point inversion)
 * @param {number} [opts.tol]      point-inversion tolerance
 * @returns {{
 *   pcurve: { degree:number, knots:number[], controlPoints:number[][] },
 *   uvSamples: number[][],
 *   maxProjectionError: number,
 *   maxPushForwardError: number,
 *   allConverged: boolean,
 *   degenerate: boolean
 * }}
 *   `maxProjectionError`  — max |S(u,v) − Q| over the inverted samples (how
 *                           far the 3-D curve lies off the surface).
 *   `maxPushForwardError` — max |S(pcurve(t)) − Q| — how faithfully the FITTED
 *                           pcurve, pushed back through S, reproduces the
 *                           original 3-D curve. The honest fidelity number.
 *   `degenerate`          — true if the (u,v) samples collapse to a point /
 *                           span no parametric extent (caller rejects).
 */
export function projectCurveOnSurface(surface, curvePoints, opts = {}) {
  if (!Array.isArray(curvePoints) || curvePoints.length < 2) {
    throw new Error('projectCurveOnSurface: need at least 2 curve points');
  }
  const uvSamples = [];
  let maxProjectionError = 0;
  let allConverged = true;
  for (const Q of curvePoints) {
    const inv = invertPointOnSurface(surface, Q, opts);
    uvSamples.push([inv.u, inv.v]);
    if (inv.distance > maxProjectionError) maxProjectionError = inv.distance;
    if (!inv.converged) allConverged = false;
  }

  // Degeneracy test — the inverted samples must span a real parametric extent.
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const [u, v] of uvSamples) {
    if (u < umin) umin = u; if (u > umax) umax = u;
    if (v < vmin) vmin = v; if (v > vmax) vmax = v;
  }
  const uExtent = umax - umin;
  const vExtent = vmax - vmin;
  const domainDiag = Math.hypot(
    surface.uMax - surface.uMin, surface.vMax - surface.vMin) || 1;
  const degenerate = Math.hypot(uExtent, vExtent) < 1e-6 * domainDiag;

  // Fit the degree-3 2-D pcurve through the (u,v) samples.
  const pcurve = fitCubic2d(uvSamples);

  // Push-forward fidelity — evaluate the fitted pcurve, map through S, compare.
  let maxPushForwardError = 0;
  const checkN = Math.max(2, curvePoints.length);
  for (let i = 0; i < checkN; i++) {
    const t = i / (checkN - 1);
    const [u, v] = evalPCurve(pcurve, t);
    const S = surface.eval(
      Math.min(surface.uMax, Math.max(surface.uMin, u)),
      Math.min(surface.vMax, Math.max(surface.vMin, v)));
    // Compare to the nearest original sample by parameter fraction.
    const srcIdx = Math.round(t * (curvePoints.length - 1));
    const e = dist3(S, curvePoints[srcIdx]);
    if (e > maxPushForwardError) maxPushForwardError = e;
  }

  return {
    pcurve,
    uvSamples,
    maxProjectionError,
    maxPushForwardError,
    allConverged,
    degenerate,
  };
}

/**
 * Validate a closed boundary made of several pcurves: the pcurves, walked in
 * order, must form a closed loop in (u,v) space (each pcurve's end ≈ the next
 * pcurve's start, and the last closes onto the first) and no pcurve may be a
 * degenerate point.
 *
 * @param {Array<{degree:number,knots:number[],controlPoints:number[][]}>} pcurves
 * @param {number} [tol=1e-4] join tolerance in parameter space
 * @returns {{ valid:boolean, closed:boolean, gaps:number[], reason:string }}
 */
export function validatePCurveLoop(pcurves, tol = 1e-4) {
  if (!Array.isArray(pcurves) || pcurves.length === 0) {
    return { valid: false, closed: false, gaps: [], reason: 'no pcurves' };
  }
  const ends = pcurves.map((pc) => ({
    start: evalPCurve(pc, 0),
    end: evalPCurve(pc, 1),
  }));
  const gaps = [];
  let closed = true;
  for (let i = 0; i < ends.length; i++) {
    const next = ends[(i + 1) % ends.length];
    const gap = Math.hypot(
      ends[i].end[0] - next.start[0],
      ends[i].end[1] - next.start[1]);
    gaps.push(gap);
    if (gap > tol) closed = false;
  }
  // No degenerate pcurve — each must span real parametric length.
  for (const pc of pcurves) {
    const a = evalPCurve(pc, 0);
    const b = evalPCurve(pc, 1);
    const m = evalPCurve(pc, 0.5);
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]) +
                 Math.hypot(m[0] - a[0], m[1] - a[1]);
    if (span < 1e-9) {
      return {
        valid: false, closed, gaps,
        reason: 'a pcurve is degenerate (collapses to a point in u,v)',
      };
    }
  }
  return {
    valid: closed,
    closed,
    gaps,
    reason: closed ? 'closed pcurve loop' : 'pcurve loop is not closed in (u,v)',
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * SELF-TEST (commented — run by uncommenting under `node`):
 *
 *   import { NURBSSurface } from './NURBSSurface.js';
 *   import { projectCurveOnSurface, invertPointOnSurface } from './PCurveProjection.js';
 *
 *   // A cylinder; project a 3-D helix-ish polyline that lies ON it.
 *   const cyl = NURBSSurface.cylinder(10, 40);
 *   const pts = [];
 *   for (let i = 0; i <= 20; i++) {
 *     const u = cyl.uMin + (cyl.uMax - cyl.uMin) * (i / 20);
 *     const v = cyl.vMin + (cyl.vMax - cyl.vMin) * (i / 20);
 *     pts.push(cyl.eval(u, v));               // a point genuinely on the cyl
 *   }
 *   const res = projectCurveOnSurface(cyl, pts, { gridU: 16, gridV: 8 });
 *   console.assert(res.maxProjectionError  < 1e-6, 'proj err', res.maxProjectionError);
 *   console.assert(res.maxPushForwardError < 1e-3, 'pushfwd err', res.maxPushForwardError);
 *   console.assert(!res.degenerate, 'must not be degenerate');
 *   console.log('PCurveProjection self-test OK', res.maxProjectionError, res.maxPushForwardError);
 * ───────────────────────────────────────────────────────────────────────────── */
