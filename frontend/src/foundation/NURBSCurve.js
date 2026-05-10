/**
 * ArchDisc Foundation — NURBS curves (Phase 1 of Parasolid parity).
 *
 * A NURBS curve C(u) is defined by:
 *   - n+1 control points  P_0, …, P_n     (in R³)
 *   - n+1 weights         w_0, …, w_n     (positive scalars)
 *   - degree              p
 *   - knot vector         U = {u_0, …, u_m}  with m = n + p + 1
 *
 * The curve evaluates as
 *
 *                   Σ N_{i,p}(u) · w_i · P_i
 *      C(u)  =     ─────────────────────────              (eq 4.5 in Piegl/Tiller)
 *                       Σ N_{i,p}(u) · w_i
 *
 * where N_{i,p} are the standard B-spline basis functions (Cox-de
 * Boor recursion).
 *
 * Why NURBS:
 *   - Polynomials of any degree representable, with rational weights
 *     to capture exactly conic sections (circle / ellipse / parabola /
 *     hyperbola) which polynomial Béziers cannot.
 *   - Local control: editing one control point only affects the curve
 *     in a span of (p+1) knot intervals.
 *   - Industry standard: STEP, IGES, ACIS, Parasolid, OpenCascade all
 *     speak NURBS natively.
 *
 * Reference: Piegl & Tiller, "The NURBS Book" (Springer, 2nd ed.).
 */

const EPS = 1e-12;

export class NURBSCurve {
  /**
   * @param {object} args
   * @param {number} args.degree          - polynomial degree p
   * @param {Array<[x,y,z]>} args.controlPoints  - n+1 control points
   * @param {Array<number>=} args.weights        - n+1 positive weights (default all 1 = non-rational)
   * @param {Array<number>} args.knots           - clamped knot vector of length n+p+2
   */
  constructor({ degree, controlPoints, weights, knots }) {
    this.degree = degree;
    this.controlPoints = controlPoints.map(p => [p[0], p[1], p[2]]);
    this.weights = weights ? weights.slice() : controlPoints.map(() => 1);
    this.knots = knots.slice();
    this._validate();
  }

  _validate() {
    const n = this.controlPoints.length - 1;
    const p = this.degree;
    const expectedKnots = n + p + 2;
    if (this.knots.length !== expectedKnots)
      throw new Error(`Bad knot vector: got ${this.knots.length}, expected ${expectedKnots}`);
    if (this.weights.length !== n + 1)
      throw new Error(`Bad weights count: got ${this.weights.length}, expected ${n + 1}`);
    for (const w of this.weights) if (w <= 0) throw new Error('All NURBS weights must be > 0');
    // Knot vector must be non-decreasing
    for (let i = 1; i < this.knots.length; i++)
      if (this.knots[i] < this.knots[i - 1] - EPS)
        throw new Error('Knot vector must be non-decreasing');
  }

  /** First valid parameter (= U[p]). */
  get uMin() { return this.knots[this.degree]; }
  /** Last valid parameter (= U[m-p]). */
  get uMax() { return this.knots[this.knots.length - 1 - this.degree]; }

  /**
   * Find knot span k such that U[k] ≤ u < U[k+1].  (Algorithm A2.1
   * in The NURBS Book.) For u = U[m-p] return m-p-1.
   */
  knotSpan(u) {
    const p = this.degree;
    const m = this.knots.length - 1;
    const n = m - p - 1;
    if (u >= this.knots[n + 1] - EPS) return n;
    if (u <= this.knots[p] + EPS) return p;
    let lo = p, hi = n + 1;
    let mid = (lo + hi) >> 1;
    while (u < this.knots[mid] || u >= this.knots[mid + 1]) {
      if (u < this.knots[mid]) hi = mid;
      else lo = mid;
      mid = (lo + hi) >> 1;
    }
    return mid;
  }

  /**
   * Compute non-zero B-spline basis functions N_{k-p,p}, …, N_{k,p}
   * at parameter u (Algorithm A2.2).
   * Returns array of length p+1.
   */
  basisFunctions(k, u) {
    const p = this.degree;
    const N = new Float64Array(p + 1);
    const left = new Float64Array(p + 1);
    const right = new Float64Array(p + 1);
    N[0] = 1;
    for (let j = 1; j <= p; j++) {
      left[j] = u - this.knots[k + 1 - j];
      right[j] = this.knots[k + j] - u;
      let saved = 0;
      for (let r = 0; r < j; r++) {
        const denom = right[r + 1] + left[j - r];
        const temp = denom > EPS ? N[r] / denom : 0;
        N[r] = saved + right[r + 1] * temp;
        saved = left[j - r] * temp;
      }
      N[j] = saved;
    }
    return N;
  }

  /**
   * Evaluate the curve at parameter u → [x, y, z].
   */
  eval(u) {
    const p = this.degree;
    const k = this.knotSpan(u);
    const N = this.basisFunctions(k, u);
    let wx = 0, wy = 0, wz = 0, ww = 0;
    for (let i = 0; i <= p; i++) {
      const idx = k - p + i;
      const w = this.weights[idx];
      const Nw = N[i] * w;
      wx += Nw * this.controlPoints[idx][0];
      wy += Nw * this.controlPoints[idx][1];
      wz += Nw * this.controlPoints[idx][2];
      ww += Nw;
    }
    return [wx / ww, wy / ww, wz / ww];
  }

  /**
   * Compute basis-function derivatives up to order `d` (Algorithm A2.3).
   * Returns 2-D array [order][i] where i ranges over the (p+1) non-zero
   * basis functions.
   */
  basisFunctionDerivatives(k, u, d) {
    const p = this.degree;
    const ndu = Array.from({ length: p + 1 }, () => new Float64Array(p + 1));
    const a = Array.from({ length: 2 }, () => new Float64Array(p + 1));
    const ders = Array.from({ length: d + 1 }, () => new Float64Array(p + 1));
    const left = new Float64Array(p + 1);
    const right = new Float64Array(p + 1);
    ndu[0][0] = 1;
    for (let j = 1; j <= p; j++) {
      left[j] = u - this.knots[k + 1 - j];
      right[j] = this.knots[k + j] - u;
      let saved = 0;
      for (let r = 0; r < j; r++) {
        ndu[j][r] = right[r + 1] + left[j - r];
        const temp = ndu[j][r] > EPS ? ndu[r][j - 1] / ndu[j][r] : 0;
        ndu[r][j] = saved + right[r + 1] * temp;
        saved = left[j - r] * temp;
      }
      ndu[j][j] = saved;
    }
    for (let j = 0; j <= p; j++) ders[0][j] = ndu[j][p];
    for (let r = 0; r <= p; r++) {
      let s1 = 0, s2 = 1;
      a[0][0] = 1;
      for (let kk = 1; kk <= d; kk++) {
        let dval = 0;
        const rk = r - kk;
        const pk = p - kk;
        if (r >= kk) {
          a[s2][0] = a[s1][0] / (ndu[pk + 1][rk] || EPS);
          dval = a[s2][0] * ndu[rk][pk];
        }
        const j1 = rk >= -1 ? 1 : -rk;
        const j2 = (r - 1) <= pk ? kk - 1 : p - r;
        for (let j = j1; j <= j2; j++) {
          a[s2][j] = (a[s1][j] - a[s1][j - 1]) / (ndu[pk + 1][rk + j] || EPS);
          dval += a[s2][j] * ndu[rk + j][pk];
        }
        if (r <= pk) {
          a[s2][kk] = -a[s1][kk - 1] / (ndu[pk + 1][r] || EPS);
          dval += a[s2][kk] * ndu[r][pk];
        }
        ders[kk][r] = dval;
        const tmp = s1; s1 = s2; s2 = tmp;
      }
    }
    let f = p;
    for (let kk = 1; kk <= d; kk++) {
      for (let j = 0; j <= p; j++) ders[kk][j] *= f;
      f *= (p - kk);
    }
    return ders;
  }

  /**
   * Evaluate position + first `d` derivatives at u.
   *
   * Returns array of length d+1 of 3D vectors. Index 0 is the point;
   * index 1 is C'(u); index 2 is C''(u); etc.
   *
   * For rational curves we apply the quotient rule to
   *   C(u) = A(u) / w(u)
   * where A(u) = Σ N_i(u)·w_i·P_i and w(u) = Σ N_i(u)·w_i.
   */
  evalDerivatives(u, d) {
    const p = this.degree;
    const k = this.knotSpan(u);
    const ders = this.basisFunctionDerivatives(k, u, d);
    // A^k and w^k
    const A = Array.from({ length: d + 1 }, () => [0, 0, 0]);
    const W = new Float64Array(d + 1);
    for (let kk = 0; kk <= d; kk++) {
      for (let i = 0; i <= p; i++) {
        const idx = k - p + i;
        const Nw = ders[kk][i] * this.weights[idx];
        A[kk][0] += Nw * this.controlPoints[idx][0];
        A[kk][1] += Nw * this.controlPoints[idx][1];
        A[kk][2] += Nw * this.controlPoints[idx][2];
        W[kk]    += Nw;
      }
    }
    // Curve derivatives via quotient rule (Algorithm A4.4):
    //   C^k = (A^k − Σ_{i=1..k} C(k,i) · W^i · C^{k-i}) / W^0
    const C = Array.from({ length: d + 1 }, () => [0, 0, 0]);
    for (let kk = 0; kk <= d; kk++) {
      const v = [A[kk][0], A[kk][1], A[kk][2]];
      for (let i = 1; i <= kk; i++) {
        const bin = binomial(kk, i);
        v[0] -= bin * W[i] * C[kk - i][0];
        v[1] -= bin * W[i] * C[kk - i][1];
        v[2] -= bin * W[i] * C[kk - i][2];
      }
      const inv = 1 / W[0];
      C[kk] = [v[0] * inv, v[1] * inv, v[2] * inv];
    }
    return C;
  }

  /**
   * Adaptive tessellation: recursively bisect the curve where the
   * chord deviation from the curve's midpoint exceeds `chordTol`.
   * Returns ordered Array<[x,y,z]>.
   */
  tessellate(chordTol = 0.01) {
    const out = [];
    const u0 = this.uMin, u1 = this.uMax;
    const p0 = this.eval(u0);
    const p1 = this.eval(u1);
    out.push(p0);
    this._tessRec(u0, u1, p0, p1, chordTol, out, 0, 16);
    out.push(p1);
    return out;
  }

  _tessRec(u0, u1, p0, p1, tol, out, depth, maxDepth) {
    if (depth >= maxDepth) return;
    const um = 0.5 * (u0 + u1);
    const pm = this.eval(um);
    // Distance from pm to chord(p0, p1)
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const len = Math.hypot(ax, ay, az) || 1;
    const tx = ax / len, ty = ay / len, tz = az / len;
    const dx = pm[0] - p0[0], dy = pm[1] - p0[1], dz = pm[2] - p0[2];
    const proj = dx * tx + dy * ty + dz * tz;
    const px = p0[0] + proj * tx, py = p0[1] + proj * ty, pz = p0[2] + proj * tz;
    const err = Math.hypot(pm[0] - px, pm[1] - py, pm[2] - pz);
    if (err <= tol) return;
    this._tessRec(u0, um, p0, pm, tol, out, depth + 1, maxDepth);
    out.push(pm);
    this._tessRec(um, u1, pm, p1, tol, out, depth + 1, maxDepth);
  }

  /**
   * Knot insertion: insert knot `u` r times. The curve is unchanged
   * but the control polygon gets refined. (Algorithm A5.1.)
   * Returns a NEW NURBSCurve.
   */
  insertKnot(u, r = 1) {
    const p = this.degree;
    const k = this.knotSpan(u);
    // Existing multiplicity of u
    let s = 0;
    for (let i = k; i >= 0 && Math.abs(this.knots[i] - u) < EPS; i--) s++;
    if (s + r > p) throw new Error('Insertion would exceed multiplicity p');
    // Convert to homogeneous control points
    const Pw = this.controlPoints.map((P, i) => {
      const w = this.weights[i];
      return [P[0] * w, P[1] * w, P[2] * w, w];
    });
    const newKnots = this.knots.slice();
    const newPw = Array.from({ length: Pw.length + r }, () => [0, 0, 0, 0]);
    // Save unaltered control points
    for (let i = 0; i <= k - p; i++) newPw[i] = Pw[i].slice();
    for (let i = k - s; i < Pw.length; i++) newPw[i + r] = Pw[i].slice();
    // Update knots
    const newKnotVec = new Array(newKnots.length + r);
    for (let i = 0; i <= k; i++) newKnotVec[i] = newKnots[i];
    for (let i = 1; i <= r; i++) newKnotVec[k + i] = u;
    for (let i = k + 1; i < newKnots.length; i++) newKnotVec[i + r] = newKnots[i];
    // Compute new control points
    let R = Array.from({ length: p - s + 1 }, (_, i) => Pw[k - p + i].slice());
    for (let j = 1; j <= r; j++) {
      const L = k - p + j;
      for (let i = 0; i <= p - j - s; i++) {
        const alpha = (u - newKnots[L + i]) / (newKnots[i + k + 1] - newKnots[L + i]);
        for (let d = 0; d < 4; d++) {
          R[i][d] = alpha * R[i + 1][d] + (1 - alpha) * R[i][d];
        }
      }
      newPw[L] = R[0].slice();
      newPw[k + r - j - s] = R[p - j - s].slice();
    }
    for (let i = k - p + r; i < k - s; i++) newPw[i] = R[i - (k - p + r)].slice();
    // Convert back to Cartesian
    const newCps = newPw.map(pw => [pw[0] / pw[3], pw[1] / pw[3], pw[2] / pw[3]]);
    const newWs = newPw.map(pw => pw[3]);
    return new NURBSCurve({ degree: p, controlPoints: newCps, weights: newWs, knots: newKnotVec });
  }

  /**
   * Convenience: a unit-radius circle centred at origin in the XY
   * plane, expressed as a degree-2 rational NURBS.
   *
   * Standard 9-control-point form (Piegl/Tiller §1.4.5):
   *   knots    = [0,0,0, 1/4,1/4, 1/2,1/2, 3/4,3/4, 1,1,1]
   *   weights  = [1, √2/2, 1, √2/2, 1, √2/2, 1, √2/2, 1]
   * Each evaluation gives an EXACT point on the unit circle.
   */
  static unitCircle() {
    const s = Math.SQRT2 / 2;
    return new NURBSCurve({
      degree: 2,
      controlPoints: [
        [1, 0, 0], [1, 1, 0], [0, 1, 0], [-1, 1, 0], [-1, 0, 0],
        [-1, -1, 0], [0, -1, 0], [1, -1, 0], [1, 0, 0],
      ],
      weights: [1, s, 1, s, 1, s, 1, s, 1],
      knots: [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1],
    });
  }

  /**
   * Convenience: a quarter circle of radius R from (R,0) to (0,R)
   * in the XY plane, expressed as a degree-2 rational Bézier
   * (3 control points).
   *
   *   P_0 = (R, 0),  P_1 = (R, R),  P_2 = (0, R)
   *   w   = (1, √2/2, 1)
   *   knots = [0, 0, 0, 1, 1, 1]
   *
   * Every evaluated point lies EXACTLY on the circle x² + y² = R².
   */
  static quarterCircle(R = 1) {
    const s = Math.SQRT2 / 2;
    return new NURBSCurve({
      degree: 2,
      controlPoints: [[R, 0, 0], [R, R, 0], [0, R, 0]],
      weights: [1, s, 1],
      knots: [0, 0, 0, 1, 1, 1],
    });
  }

  /**
   * Convenience: a circular helix of radius R, axial pitch h, n turns.
   * Built by chaining quarter-circle segments and adding linear z-rise
   * via each segment's middle control point. NOT exactly a helix in
   * the analytic-rational sense (true helices are transcendental, NOT
   * algebraic — Parasolid uses a special analytic curve type) but
   * approximates it within rational-NURBS precision.
   */
  static helix(R, h, turns) {
    // Construct piecewise — 4 quarter-arcs per turn, lifted by h/4.
    const segs = Math.ceil(4 * turns);
    const cps = [], ws = [], knotsRaw = [];
    const s = Math.SQRT2 / 2;
    for (let i = 0; i <= segs; i++) {
      const angle = i * Math.PI / 2;
      const z = (h / 4) * i;
      cps.push([R * Math.cos(angle), R * Math.sin(angle), z]);
      ws.push(1);
      if (i < segs) {
        const aMid = angle + Math.PI / 4;
        const r = R * Math.SQRT2;
        cps.push([r * Math.cos(aMid), r * Math.sin(aMid), z + h / 8]);
        ws.push(s);
      }
    }
    // Build clamped knot vector with DOUBLE interior knots so each
    // 3-CP quarter-arc segment is its own rational quadratic Bézier
    // (C⁰ continuity at boundaries → on-circle property holds exactly).
    //
    //   [ 0,0,0,  s, s,  2s, 2s,  …, (segs-1)s, (segs-1)s,  1,1,1 ]
    //
    // where s = 1/segs.
    const p = 2;
    const knots = [0, 0, 0];
    for (let k = 1; k < segs; k++) {
      const v = k / segs;
      knots.push(v, v);
    }
    knots.push(1, 1, 1);
    return new NURBSCurve({ degree: p, controlPoints: cps, weights: ws, knots });
  }
}

function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let c = 1;
  for (let i = 0; i < k; i++) c = c * (n - i) / (i + 1);
  return c;
}
