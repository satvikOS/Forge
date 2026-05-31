/**
 * ArchDisc Foundation — numerical validation harness.
 *
 * Agreement with a single benchmark says a method is plausible; it does
 * not prove the method is sound. This harness raises the bar with the
 * three checks a numerical analyst actually demands:
 *
 *   1. CONVERGENCE — refine the discretisation and confirm the error
 *      shrinks at the method's THEORETICAL order of accuracy (observed
 *      order from successive errors). A method that converges at its
 *      predicted rate is genuinely sound, not coincidentally close.
 *   2. CROSS-METHOD — two independent methods must agree.
 *   3. CONSERVATION — an invariant (here a geometric one) is preserved.
 *
 * The harness ships with reference methods whose convergence orders are
 * known exactly (trapezoid → 2, Simpson → 4, linear finite elements →
 * 2 in L2) so the harness itself is validated against theory.
 *
 * Honest scope: this raises rigour from "matches a benchmark" to
 * "converges at the theoretical rate + cross-validates + conserves".
 * It is not lab-measured experimental truth.
 *
 * Kernel-free pure math — node-importable for e2e.
 */

// ── Convergence analysis ───────────────────────────────────────────

/**
 * Observed order of accuracy from two errors at refinement ratio `ratio`
 * (default 2, i.e. the step was halved). p = ln(eCoarse/eFine)/ln(ratio).
 */
export function observedOrder(eCoarse, eFine, ratio = 2) {
  return Math.log(eCoarse / eFine) / Math.log(ratio);
}

/**
 * Run a refinement study. `run(level)` returns the error at that level;
 * levels should be successive halvings of the step.
 *
 * @returns {{ errors, orders, meanOrder, monotone }}
 */
export function convergenceStudy(run, levels, ratio = 2) {
  const errors = levels.map((lv) => run(lv));
  const orders = [];
  for (let i = 0; i + 1 < errors.length; i++) {
    orders.push(observedOrder(errors[i], errors[i + 1], ratio));
  }
  let monotone = true;
  for (let i = 0; i + 1 < errors.length; i++) {
    if (errors[i + 1] > errors[i] * 1.0001) monotone = false;
  }
  const meanOrder = orders.reduce((a, b) => a + b, 0) / (orders.length || 1);
  return { errors, orders, meanOrder, monotone };
}

/** Richardson extrapolation of two estimates at refinement ratio `ratio`. */
export function richardsonExtrapolate(coarse, fine, order, ratio = 2) {
  const f = Math.pow(ratio, order);
  return (f * fine - coarse) / (f - 1);
}

// ── Quadrature (reference methods of known order) ──────────────────

/** Composite trapezoidal rule — order 2. */
export function trapezoidIntegral(f, a, b, n) {
  const h = (b - a) / n;
  let s = 0.5 * (f(a) + f(b));
  for (let i = 1; i < n; i++) s += f(a + i * h);
  return s * h;
}

/** Composite Simpson's rule — order 4. n must be even. */
export function simpsonIntegral(f, a, b, n) {
  if (n % 2) n++;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return s * h / 3;
}

// 5-point Gauss-Legendre on [-1,1].
const GL5_X = [0, -0.5384693101056831, 0.5384693101056831, -0.9061798459386640, 0.9061798459386640];
const GL5_W = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891];

/** 5-point Gauss-Legendre integral of f over [a,b]. */
export function gaussIntegral(f, a, b) {
  const c = 0.5 * (b - a), m = 0.5 * (a + b);
  let s = 0;
  for (let i = 0; i < 5; i++) s += GL5_W[i] * f(m + c * GL5_X[i]);
  return s * c;
}

// ── 1-D linear finite-element Poisson solver ───────────────────────

/**
 * Solve −u'' = f on [0,1] with u(0)=u(1)=0 using linear finite
 * elements over `n` equal elements. Returns the nodal solution and the
 * L2 error against a known exact solution.
 *
 * Linear FE is L2-convergent at order 2; in 1-D the nodal values are
 * additionally exact — both facts are checked in the e2e.
 *
 * @returns {{ h, nodes, u, l2Error, maxNodalError }}
 */
export function poisson1DLinearFE(n, f, exactU) {
  const h = 1 / n;
  const nodes = Array.from({ length: n + 1 }, (_, i) => i * h);
  // Interior unknowns 1..n-1. Tridiagonal stiffness, consistent load.
  const m = n - 1;
  const A = Array.from({ length: m }, () => new Array(m).fill(0));
  const b = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    A[i][i] = 2 / h;
    if (i > 0) A[i][i - 1] = -1 / h;
    if (i < m - 1) A[i][i + 1] = -1 / h;
    // Consistent load: ∫ f·φ over the two elements adjacent to node i+1.
    const xi = nodes[i + 1];
    const left = gaussIntegral((x) => f(x) * (x - nodes[i]) / h, nodes[i], xi);
    const right = gaussIntegral((x) => f(x) * (nodes[i + 2] - x) / h, xi, nodes[i + 2]);
    b[i] = left + right;
  }
  // Thomas algorithm for the tridiagonal system.
  const cp = new Array(m).fill(0), dp = new Array(m).fill(0);
  cp[0] = A[0][1] / A[0][0];
  dp[0] = b[0] / A[0][0];
  for (let i = 1; i < m; i++) {
    const denom = A[i][i] - A[i][i - 1] * cp[i - 1];
    cp[i] = (i < m - 1 ? A[i][i + 1] : 0) / denom;
    dp[i] = (b[i] - A[i][i - 1] * dp[i - 1]) / denom;
  }
  const interior = new Array(m).fill(0);
  interior[m - 1] = dp[m - 1];
  for (let i = m - 2; i >= 0; i--) interior[i] = dp[i] - cp[i] * interior[i + 1];
  const u = [0, ...interior, 0];

  // Errors.
  let maxNodalError = 0;
  for (let i = 0; i <= n; i++) {
    maxNodalError = Math.max(maxNodalError, Math.abs(u[i] - exactU(nodes[i])));
  }
  let l2sq = 0;
  for (let e = 0; e < n; e++) {
    const x0 = nodes[e], x1 = nodes[e + 1];
    l2sq += gaussIntegral((x) => {
      const uFE = u[e] + (u[e + 1] - u[e]) * (x - x0) / h;   // linear on the element
      const d = uFE - exactU(x);
      return d * d;
    }, x0, x1);
  }
  return { h, nodes, u, l2Error: Math.sqrt(l2sq), maxNodalError };
}

// ── Conservation: rigid-transform invariance ───────────────────────

/** Signed area of a 2-D polygon (shoelace formula). */
export function polygonArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Rotate + translate a polygon — a rigid transform preserves area. */
export function rigidTransform(points, angle, tx, ty) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return points.map((p) => [p[0] * c - p[1] * s + tx, p[0] * s + p[1] * c + ty]);
}
