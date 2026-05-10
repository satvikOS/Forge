/**
 * ArchDisc Foundation — 2D Sketch with Newton-Raphson constraint solver.
 *
 * A sketch is a set of points (free or fixed) plus constraints between
 * them. Entities (line, arc, circle) are derived from points so we only
 * need to solve for point coordinates.
 *
 * The solver:
 *   - Each constraint contributes one or more residual equations
 *     f_i(x) = 0 where x is the free DOF vector.
 *   - We solve f(x) = 0 with damped Newton-Raphson:
 *       x_{k+1} = x_k - α (J^T J + λI)^{-1} J^T f(x_k)
 *     using finite-difference Jacobian and Levenberg-Marquardt damping
 *     for robustness against rank-deficient J.
 *   - Converges when ‖f‖_2 < tol or max iterations reached.
 *   - Reports rank deficiency (over-constrained) when residuals plateau
 *     above tolerance.
 *
 * Entities:
 *   - SketchPoint(x, y, fixed?)
 *   - SketchLine(p1, p2)
 *   - SketchCircle(center, radius)   — radius is solved as scalar DOF
 *   - SketchArc(center, p1, p2)      — arc from p1 to p2 around center
 *
 * Constraints:
 *   - coincident(a, b)               point-point
 *   - distance(a, b, d)              point-point at d
 *   - horizontal(line)
 *   - vertical(line)
 *   - parallel(l1, l2)
 *   - perpendicular(l1, l2)
 *   - equalLength(l1, l2)
 *   - tangent(line, circle)          line tangent to circle
 *   - radius(circle, r)
 *   - angle(l1, l2, theta_rad)
 *   - fix(point)                     mark point as fixed
 */

let _idCounter = 0;
const nextId = (kind) => `${kind}_${++_idCounter}`;

export class SketchPoint {
  constructor(x, y, fixed = false) {
    this.id = nextId('p');
    this.type = 'point';
    this.x = x;
    this.y = y;
    this.fixed = fixed;
  }
  clone() { return new SketchPoint(this.x, this.y, this.fixed); }
  toArray() { return [this.x, this.y]; }
}

export class SketchLine {
  constructor(p1, p2) {
    this.id = nextId('l');
    this.type = 'line';
    this.p1 = p1;
    this.p2 = p2;
  }
  dx() { return this.p2.x - this.p1.x; }
  dy() { return this.p2.y - this.p1.y; }
  length() { return Math.hypot(this.dx(), this.dy()); }
  angle() { return Math.atan2(this.dy(), this.dx()); }
}

export class SketchCircle {
  constructor(center, radius) {
    this.id = nextId('c');
    this.type = 'circle';
    this.center = center;
    this.radius = radius;
    this._radiusFixed = false;
  }
}

export class SketchArc {
  constructor(center, startPoint, endPoint, ccw = true) {
    this.id = nextId('a');
    this.type = 'arc';
    this.center = center;
    this.start = startPoint;
    this.end = endPoint;
    this.ccw = ccw;
  }
  startAngle() { return Math.atan2(this.start.y - this.center.y, this.start.x - this.center.x); }
  endAngle() { return Math.atan2(this.end.y - this.center.y, this.end.x - this.center.x); }
  radius() { return Math.hypot(this.start.x - this.center.x, this.start.y - this.center.y); }
}

const C = {
  coincident: 'coincident',
  distance: 'distance',
  horizontal: 'horizontal',
  vertical: 'vertical',
  parallel: 'parallel',
  perpendicular: 'perpendicular',
  equalLength: 'equalLength',
  tangent: 'tangent',
  radius: 'radius',
  angle: 'angle',
};

export class Sketch2D {
  constructor() {
    this.points = [];
    this.entities = [];      // lines, circles, arcs
    this.constraints = [];
  }

  addPoint(x, y, fixed = false) {
    const p = new SketchPoint(x, y, fixed);
    this.points.push(p);
    return p;
  }
  addLine(p1, p2) {
    if (!this.points.includes(p1)) this.points.push(p1);
    if (!this.points.includes(p2)) this.points.push(p2);
    const l = new SketchLine(p1, p2);
    this.entities.push(l);
    return l;
  }
  addCircle(center, radius) {
    if (!this.points.includes(center)) this.points.push(center);
    const c = new SketchCircle(center, radius);
    this.entities.push(c);
    return c;
  }
  addArc(center, p1, p2, ccw = true) {
    [center, p1, p2].forEach(p => { if (!this.points.includes(p)) this.points.push(p); });
    const a = new SketchArc(center, p1, p2, ccw);
    this.entities.push(a);
    return a;
  }

  // --- Constraints ---
  coincident(a, b) { this.constraints.push({ kind: C.coincident, a, b }); return this; }
  distance(a, b, d) { this.constraints.push({ kind: C.distance, a, b, d }); return this; }
  horizontal(line) { this.constraints.push({ kind: C.horizontal, line }); return this; }
  vertical(line) { this.constraints.push({ kind: C.vertical, line }); return this; }
  parallel(l1, l2) { this.constraints.push({ kind: C.parallel, l1, l2 }); return this; }
  perpendicular(l1, l2) { this.constraints.push({ kind: C.perpendicular, l1, l2 }); return this; }
  equalLength(l1, l2) { this.constraints.push({ kind: C.equalLength, l1, l2 }); return this; }
  tangent(line, circle) { this.constraints.push({ kind: C.tangent, line, circle }); return this; }
  radius(circle, r) { this.constraints.push({ kind: C.radius, circle, r }); return this; }
  angle(l1, l2, theta) { this.constraints.push({ kind: C.angle, l1, l2, theta }); return this; }
  fix(point) { point.fixed = true; return this; }

  /**
   * Build the DOF vector — array of [pointId, 'x' | 'y' | 'r'] entries
   * for every free coordinate. Fixed points contribute no DOFs.
   */
  _buildDOFs() {
    const dofs = [];
    for (const p of this.points) {
      if (!p.fixed) {
        dofs.push({ id: p.id, kind: 'x', target: p });
        dofs.push({ id: p.id, kind: 'y', target: p });
      }
    }
    for (const e of this.entities) {
      if (e.type === 'circle' && !e._radiusFixed) {
        dofs.push({ id: e.id, kind: 'r', target: e });
      }
    }
    return dofs;
  }

  _readDOFs(dofs) {
    return dofs.map(d => d.kind === 'r' ? d.target.radius : d.target[d.kind]);
  }

  _writeDOFs(dofs, x) {
    for (let i = 0; i < dofs.length; i++) {
      if (dofs[i].kind === 'r') dofs[i].target.radius = x[i];
      else dofs[i].target[dofs[i].kind] = x[i];
    }
  }

  /**
   * Compute the residual vector for the current state.
   */
  _residuals() {
    const r = [];
    for (const c of this.constraints) {
      switch (c.kind) {
        case C.coincident:
          r.push(c.a.x - c.b.x);
          r.push(c.a.y - c.b.y);
          break;
        case C.distance: {
          const dx = c.a.x - c.b.x, dy = c.a.y - c.b.y;
          r.push(Math.hypot(dx, dy) - c.d);
          break;
        }
        case C.horizontal:
          r.push(c.line.p1.y - c.line.p2.y);
          break;
        case C.vertical:
          r.push(c.line.p1.x - c.line.p2.x);
          break;
        case C.parallel:
          // cross product of direction vectors must be 0
          r.push(c.l1.dx() * c.l2.dy() - c.l1.dy() * c.l2.dx());
          break;
        case C.perpendicular:
          // dot product of direction vectors must be 0
          r.push(c.l1.dx() * c.l2.dx() + c.l1.dy() * c.l2.dy());
          break;
        case C.equalLength:
          r.push(c.l1.length() - c.l2.length());
          break;
        case C.tangent: {
          // distance from circle center to line == radius
          const { line, circle } = c;
          const x0 = circle.center.x, y0 = circle.center.y;
          const x1 = line.p1.x, y1 = line.p1.y;
          const x2 = line.p2.x, y2 = line.p2.y;
          const num = Math.abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1);
          const den = Math.max(Math.hypot(x2 - x1, y2 - y1), 1e-12);
          r.push(num / den - circle.radius);
          break;
        }
        case C.radius:
          r.push(c.circle.radius - c.r);
          break;
        case C.angle: {
          // angle between two lines
          const a1 = c.l1.angle(), a2 = c.l2.angle();
          let d = (a2 - a1) - c.theta;
          // wrap to [-π, π]
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          r.push(d);
          break;
        }
        default:
          throw new Error(`Unknown constraint kind: ${c.kind}`);
      }
    }
    return r;
  }

  /**
   * Compute Jacobian via finite differences.
   * Cost: O(n_dofs × n_residuals). Cheap for typical sketches (<200 DOFs).
   */
  _jacobian(dofs, eps = 1e-7) {
    const r0 = this._residuals();
    const m = r0.length;
    const n = dofs.length;
    const J = Array.from({ length: m }, () => new Float64Array(n));
    const x0 = this._readDOFs(dofs);
    for (let j = 0; j < n; j++) {
      const x = x0.slice();
      x[j] += eps;
      this._writeDOFs(dofs, x);
      const rp = this._residuals();
      this._writeDOFs(dofs, x0); // restore
      for (let i = 0; i < m; i++) J[i][j] = (rp[i] - r0[i]) / eps;
    }
    return { J, r0 };
  }

  /**
   * Solve the constraint system. Levenberg-Marquardt: damped
   * Gauss-Newton with adaptive λ. Returns convergence diagnostics.
   *
   * @param {object} opts
   * @param {number} opts.tol        residual norm convergence (default 1e-9)
   * @param {number} opts.maxIter    max outer iterations (default 60)
   * @param {number} opts.lambda0    initial damping (default 1e-3)
   * @returns {{ converged, iterations, residualNorm, dofCount, residualCount, status }}
   */
  solve(opts = {}) {
    const tol = opts.tol ?? 1e-9;
    const maxIter = opts.maxIter ?? 60;
    let lambda = opts.lambda0 ?? 1e-3;

    const dofs = this._buildDOFs();
    if (dofs.length === 0 || this.constraints.length === 0) {
      const r = this._residuals();
      return {
        converged: norm(r) < tol,
        iterations: 0,
        residualNorm: norm(r),
        dofCount: dofs.length,
        residualCount: r.length,
        status: 'no-dofs-or-constraints',
      };
    }

    let prevNorm = Infinity;
    for (let iter = 0; iter < maxIter; iter++) {
      const { J, r0 } = this._jacobian(dofs);
      const rNorm = norm(r0);
      if (rNorm < tol) {
        return {
          converged: true,
          iterations: iter,
          residualNorm: rNorm,
          dofCount: dofs.length,
          residualCount: r0.length,
          status: 'converged',
        };
      }

      // Build normal equations: (J^T J + λI) Δx = J^T r0
      const n = dofs.length, m = r0.length;
      const A = matMulTransposed(J, n, m);     // J^T J
      const g = matVecTransposed(J, r0, n, m); // J^T r0
      for (let i = 0; i < n; i++) A[i][i] += lambda * (A[i][i] + 1);

      const dx = solveLinear(A, g, n);
      if (!dx) {
        return {
          converged: false, iterations: iter, residualNorm: rNorm,
          dofCount: n, residualCount: m, status: 'singular-jacobian',
        };
      }

      // Trial step
      const x0 = this._readDOFs(dofs);
      const xTrial = x0.map((v, i) => v - dx[i]);
      this._writeDOFs(dofs, xTrial);
      const rTrial = this._residuals();
      const tNorm = norm(rTrial);

      if (tNorm < rNorm) {
        // accept; reduce damping
        lambda = Math.max(lambda * 0.5, 1e-12);
        if (Math.abs(prevNorm - tNorm) < tol * 0.1 && tNorm > tol) {
          // plateau — likely over-constrained
          return {
            converged: false, iterations: iter, residualNorm: tNorm,
            dofCount: n, residualCount: m, status: 'over-constrained',
          };
        }
        prevNorm = tNorm;
      } else {
        // reject; restore + increase damping
        this._writeDOFs(dofs, x0);
        lambda = Math.min(lambda * 5, 1e6);
      }
    }

    const finalR = this._residuals();
    return {
      converged: norm(finalR) < tol,
      iterations: maxIter,
      residualNorm: norm(finalR),
      dofCount: dofs.length,
      residualCount: finalR.length,
      status: norm(finalR) < tol ? 'converged' : 'max-iterations',
    };
  }
}

// --- Linear algebra helpers (small dense, n ≤ ~500) ---

function norm(v) {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

// J^T J  (n × n) where J is m × n
function matMulTransposed(J, n, m) {
  const A = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += J[k][i] * J[k][j];
      A[i][j] = s;
    }
  }
  return A;
}

// J^T r  (n vector)
function matVecTransposed(J, r, n, m) {
  const g = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < m; k++) s += J[k][i] * r[k];
    g[i] = s;
  }
  return g;
}

// Gaussian elimination with partial pivoting. Returns null on singular A.
function solveLinear(A, b, n) {
  // Copy
  const M = A.map(row => Array.from(row));
  const v = Array.from(b);
  for (let k = 0; k < n; k++) {
    // pivot
    let pivot = k;
    let pmax = Math.abs(M[k][k]);
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(M[i][k]) > pmax) { pmax = Math.abs(M[i][k]); pivot = i; }
    }
    if (pmax < 1e-14) return null;
    if (pivot !== k) {
      [M[k], M[pivot]] = [M[pivot], M[k]];
      [v[k], v[pivot]] = [v[pivot], v[k]];
    }
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      for (let j = k; j < n; j++) M[i][j] -= f * M[k][j];
      v[i] -= f * v[k];
    }
  }
  // back-substitute
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = v[i];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}
