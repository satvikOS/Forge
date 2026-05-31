/**
 * ArchDisc Foundation — NURBS surfaces (Phase 2 of Parasolid parity).
 *
 * Tensor-product rational B-spline surface S(u, v):
 *
 *                  Σ_i Σ_j  N_{i,p}(u) · N_{j,q}(v) · w_{i,j} · P_{i,j}
 *   S(u, v)  =  ───────────────────────────────────────────────────────
 *                  Σ_i Σ_j  N_{i,p}(u) · N_{j,q}(v) · w_{i,j}
 *
 * with
 *   - control net  P_{i,j}        (i = 0..n,  j = 0..m)         in R³
 *   - weights       w_{i,j}                                     positive
 *   - degrees       p (in u), q (in v)
 *   - knot vectors  U length n+p+2,  V length m+q+2
 *
 * Surfaces inherit all the NURBS goodness from curves: exact conics in
 * either parametric direction, local control, knot-insertion-preserves-
 * geometry, etc. The classical sphere is degree (2, 2) rational with
 * 9 × 5 control points and matches the analytic sphere to machine
 * precision.
 *
 * Reference: Piegl & Tiller "The NURBS Book" §4.4-4.5.
 *
 * Implementation strategy: re-use NURBSCurve's basisFunctions(),
 * basisFunctionDerivatives(), and knotSpan() by constructing throw-
 * away curves in u and v as needed. This duplicates a tiny bit of
 * algorithm code but keeps each module small.
 */

import { NURBSCurve } from './NURBSCurve.js';

const EPS = 1e-12;

export class NURBSSurface {
  /**
   * @param {object} args
   * @param {number} args.degreeU, args.degreeV   - p, q
   * @param {Array<Array<[x,y,z]>>} args.controlNet
   *   2-D array indexed [i][j] where i is the u-direction, j is v
   * @param {Array<Array<number>>=} args.weights
   *   2-D array of positive weights, default all 1
   * @param {Array<number>} args.knotsU, args.knotsV
   */
  constructor({ degreeU, degreeV, controlNet, weights, knotsU, knotsV }) {
    this.p = degreeU;
    this.q = degreeV;
    this.controlNet = controlNet.map(row => row.map(p => [p[0], p[1], p[2]]));
    this.knotsU = knotsU.slice();
    this.knotsV = knotsV.slice();
    if (weights) {
      this.weights = weights.map(row => row.slice());
    } else {
      this.weights = controlNet.map(row => row.map(() => 1));
    }
    this._validate();

    // Pre-build dummy NURBSCurve instances in U and V to re-use
    // basis-function code without duplicating it.
    const dummyPt = [0, 0, 0];
    const cpU = new Array(this.controlNet.length).fill(0).map(() => dummyPt);
    const cpV = new Array(this.controlNet[0].length).fill(0).map(() => dummyPt);
    this._curveU = new NURBSCurve({ degree: this.p, controlPoints: cpU, knots: this.knotsU });
    this._curveV = new NURBSCurve({ degree: this.q, controlPoints: cpV, knots: this.knotsV });
  }

  _validate() {
    const n = this.controlNet.length - 1;
    const m = this.controlNet[0].length - 1;
    if (this.knotsU.length !== n + this.p + 2)
      throw new Error(`knotsU length ${this.knotsU.length}, expected ${n + this.p + 2}`);
    if (this.knotsV.length !== m + this.q + 2)
      throw new Error(`knotsV length ${this.knotsV.length}, expected ${m + this.q + 2}`);
    for (const row of this.controlNet)
      if (row.length !== m + 1)
        throw new Error('Control net must be rectangular (consistent v size)');
    for (const row of this.weights) {
      for (const w of row) if (w <= 0) throw new Error('All weights must be > 0');
    }
  }

  get uMin() { return this.knotsU[this.p]; }
  get uMax() { return this.knotsU[this.knotsU.length - 1 - this.p]; }
  get vMin() { return this.knotsV[this.q]; }
  get vMax() { return this.knotsV[this.knotsV.length - 1 - this.q]; }

  /**
   * Evaluate the surface at (u, v) → [x, y, z].
   */
  eval(u, v) {
    const ku = this._curveU.knotSpan(u);
    const kv = this._curveV.knotSpan(v);
    const Nu = this._curveU.basisFunctions(ku, u);
    const Nv = this._curveV.basisFunctions(kv, v);
    let wx = 0, wy = 0, wz = 0, ww = 0;
    for (let i = 0; i <= this.p; i++) {
      const iIdx = ku - this.p + i;
      for (let j = 0; j <= this.q; j++) {
        const jIdx = kv - this.q + j;
        const w = this.weights[iIdx][jIdx];
        const NN = Nu[i] * Nv[j] * w;
        const P = this.controlNet[iIdx][jIdx];
        wx += NN * P[0];
        wy += NN * P[1];
        wz += NN * P[2];
        ww += NN;
      }
    }
    return [wx / ww, wy / ww, wz / ww];
  }

  /**
   * Compute first partial derivatives + position at (u, v).
   * Returns { S, Su, Sv, normal } — normal = Su × Sv normalised.
   */
  evalDerivatives(u, v) {
    const ku = this._curveU.knotSpan(u);
    const kv = this._curveV.knotSpan(v);
    const Nu = this._curveU.basisFunctionDerivatives(ku, u, 1);
    const Nv = this._curveV.basisFunctionDerivatives(kv, v, 1);
    // A^{0,0}, A^{1,0}, A^{0,1} (numerator vector) + W^{0,0}, W^{1,0}, W^{0,1}
    const A00 = [0, 0, 0], A10 = [0, 0, 0], A01 = [0, 0, 0];
    let W00 = 0, W10 = 0, W01 = 0;
    for (let i = 0; i <= this.p; i++) {
      const iIdx = ku - this.p + i;
      for (let j = 0; j <= this.q; j++) {
        const jIdx = kv - this.q + j;
        const w = this.weights[iIdx][jIdx];
        const P = this.controlNet[iIdx][jIdx];
        const Bu0 = Nu[0][i], Bu1 = Nu[1][i];
        const Bv0 = Nv[0][j], Bv1 = Nv[1][j];
        const W = w;
        // (0,0)
        const f00 = Bu0 * Bv0 * W;
        A00[0] += f00 * P[0]; A00[1] += f00 * P[1]; A00[2] += f00 * P[2];
        W00 += f00;
        // (1,0) — ∂/∂u
        const f10 = Bu1 * Bv0 * W;
        A10[0] += f10 * P[0]; A10[1] += f10 * P[1]; A10[2] += f10 * P[2];
        W10 += f10;
        // (0,1) — ∂/∂v
        const f01 = Bu0 * Bv1 * W;
        A01[0] += f01 * P[0]; A01[1] += f01 * P[1]; A01[2] += f01 * P[2];
        W01 += f01;
      }
    }
    const inv = 1 / W00;
    const S = [A00[0] * inv, A00[1] * inv, A00[2] * inv];
    // Quotient rule:
    //   S^{1,0} = (A^{1,0} − S · W^{1,0}) / W^{0,0}
    const Su = [
      (A10[0] - S[0] * W10) * inv,
      (A10[1] - S[1] * W10) * inv,
      (A10[2] - S[2] * W10) * inv,
    ];
    const Sv = [
      (A01[0] - S[0] * W01) * inv,
      (A01[1] - S[1] * W01) * inv,
      (A01[2] - S[2] * W01) * inv,
    ];
    // Normal = Su × Sv
    const nx = Su[1] * Sv[2] - Su[2] * Sv[1];
    const ny = Su[2] * Sv[0] - Su[0] * Sv[2];
    const nz = Su[0] * Sv[1] - Su[1] * Sv[0];
    const nl = Math.hypot(nx, ny, nz) || 1;
    return { S, Su, Sv, normal: [nx / nl, ny / nl, nz / nl] };
  }

  /**
   * Position + all partials up to 2nd order at (u, v).
   * Returns { S, Su, Sv, Suu, Suv, Svv, normal } — the inputs for
   * fundamental forms, Gaussian / mean curvature, and G2 continuity.
   */
  evalDerivatives2(u, v) {
    const ku = this._curveU.knotSpan(u);
    const kv = this._curveV.knotSpan(v);
    const Nu = this._curveU.basisFunctionDerivatives(ku, u, 2);
    const Nv = this._curveV.basisFunctionDerivatives(kv, v, 2);
    const A = { '00': [0, 0, 0], '10': [0, 0, 0], '01': [0, 0, 0], '20': [0, 0, 0], '11': [0, 0, 0], '02': [0, 0, 0] };
    const W = { '00': 0, '10': 0, '01': 0, '20': 0, '11': 0, '02': 0 };
    for (let i = 0; i <= this.p; i++) {
      const iIdx = ku - this.p + i;
      for (let j = 0; j <= this.q; j++) {
        const jIdx = kv - this.q + j;
        const w = this.weights[iIdx][jIdx];
        const P = this.controlNet[iIdx][jIdx];
        for (const [k, l] of [[0, 0], [1, 0], [0, 1], [2, 0], [1, 1], [0, 2]]) {
          const f = Nu[k][i] * Nv[l][j] * w;
          const key = `${k}${l}`;
          A[key][0] += f * P[0]; A[key][1] += f * P[1]; A[key][2] += f * P[2];
          W[key] += f;
        }
      }
    }
    const w0 = W['00'];
    const sub = (x, y) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
    const scl = (x, s) => [x[0] * s, x[1] * s, x[2] * s];
    const div = (x) => [x[0] / w0, x[1] / w0, x[2] / w0];
    const S = div(A['00']);
    const Su = div(sub(A['10'], scl(S, W['10'])));
    const Sv = div(sub(A['01'], scl(S, W['01'])));
    const Suu = div(sub(sub(A['20'], scl(Su, 2 * W['10'])), scl(S, W['20'])));
    const Svv = div(sub(sub(A['02'], scl(Sv, 2 * W['01'])), scl(S, W['02'])));
    const Suv = div(sub(sub(sub(A['11'], scl(Sv, W['10'])), scl(Su, W['01'])), scl(S, W['11'])));
    const nx = Su[1] * Sv[2] - Su[2] * Sv[1];
    const ny = Su[2] * Sv[0] - Su[0] * Sv[2];
    const nz = Su[0] * Sv[1] - Su[1] * Sv[0];
    const nl = Math.hypot(nx, ny, nz) || 1;
    return { S, Su, Sv, Suu, Suv, Svv, normal: [nx / nl, ny / nl, nz / nl] };
  }

  /**
   * Tessellate to a triangle mesh on a uniform grid in (u, v).
   * Returns { vertProperties, triVerts, numProp } compatible with the
   * rest of foundation (manifold-3d Mesh shape).
   *
   * @param {number} stepsU, stepsV - grid resolution
   */
  tessellate({ stepsU = 32, stepsV = 32 } = {}) {
    const verts = [];
    const tris = [];
    const u0 = this.uMin, u1 = this.uMax;
    const v0 = this.vMin, v1 = this.vMax;
    for (let j = 0; j <= stepsV; j++) {
      const vt = j / stepsV;
      const v = v0 + (v1 - v0) * vt;
      for (let i = 0; i <= stepsU; i++) {
        const ut = i / stepsU;
        const u = u0 + (u1 - u0) * ut;
        const p = this.eval(u, v);
        verts.push(p[0], p[1], p[2]);
      }
    }
    const stride = stepsU + 1;
    for (let j = 0; j < stepsV; j++) {
      for (let i = 0; i < stepsU; i++) {
        const a = j * stride + i;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        // CCW for outward normal in u-major convention
        tris.push(a, b, d, a, d, c);
      }
    }
    return {
      numProp: 3,
      vertProperties: new Float32Array(verts),
      triVerts: new Uint32Array(tris),
    };
  }

  /**
   * Convenience: a flat plane through `origin` spanned by uDir × vDir
   * (degree 1 × 1, four corner control points).
   */
  static plane(origin, uDir, vDir, uLen = 1, vLen = 1) {
    const pt = (s, t) => [
      origin[0] + uDir[0] * s * uLen + vDir[0] * t * vLen,
      origin[1] + uDir[1] * s * uLen + vDir[1] * t * vLen,
      origin[2] + uDir[2] * s * uLen + vDir[2] * t * vLen,
    ];
    return new NURBSSurface({
      degreeU: 1, degreeV: 1,
      controlNet: [[pt(0, 0), pt(0, 1)], [pt(1, 0), pt(1, 1)]],
      knotsU: [0, 0, 1, 1], knotsV: [0, 0, 1, 1],
    });
  }

  /**
   * Convenience: a cylinder of radius R, height H, centred on z-axis.
   * Built by lifting the 9-CP unit-circle representation along v.
   * Every (u, v) evaluation gives an EXACT point on the cylinder
   * (x² + y² = R²,  z = H · v).
   */
  static cylinder(R = 1, H = 1) {
    const s = Math.SQRT2 / 2;
    const circleCps = [
      [R, 0, 0], [R, R, 0], [0, R, 0], [-R, R, 0], [-R, 0, 0],
      [-R, -R, 0], [0, -R, 0], [R, -R, 0], [R, 0, 0],
    ];
    const circleW = [1, s, 1, s, 1, s, 1, s, 1];
    const circleKnots = [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1];
    // Build a 9 × 2 control net: bottom ring at z=0, top ring at z=H.
    // Each ring uses the circle CPs (cylinder is linear in v).
    const controlNet = circleCps.map(p => [
      [p[0], p[1], 0],
      [p[0], p[1], H],
    ]);
    const weights = circleW.map(w => [w, w]);
    return new NURBSSurface({
      degreeU: 2, degreeV: 1,
      controlNet, weights,
      knotsU: circleKnots,
      knotsV: [0, 0, 1, 1],
    });
  }

  /**
   * Convenience: a sphere of radius R, exact rational NURBS surface.
   * Uses a 9 × 5 control net: 9 longitudinal CPs (4 quarter-arcs in
   * u) and 5 latitudinal CPs (2 quarter-arcs in v from south pole to
   * north pole). Form per Piegl/Tiller §4.4.4.
   *
   * Every evaluated point satisfies  x² + y² + z² = R²  to machine
   * precision.
   */
  static sphere(R = 1) {
    const s = Math.SQRT2 / 2;
    // Latitudinal half-circle in (x, z), x = cos(latitude), z = sin(latitude)
    // The half-circle goes from south pole (x=0, z=-R) to equator (x=R, z=0)
    // to north pole (x=0, z=R). Three quarter arcs would give 5 CPs but
    // we need 5 CPs for a half-circle (south, SE-corner, equator, NE-
    // corner, north). Using 2 rational quadratic Bézier patches:
    //   south: [0, 0, -R],  weight 1
    //   south-east corner: [R, 0, -R],  weight √2/2
    //   equator: [R, 0, 0],  weight 1
    //   north-east corner: [R, 0, R],  weight √2/2
    //   north: [0, 0, R],  weight 1
    const latCps = [
      [0, 0, -R],     // south pole
      [R, 0, -R],     // SE corner
      [R, 0, 0],      // equator
      [R, 0, R],      // NE corner
      [0, 0, R],      // north pole
    ];
    const latW = [1, s, 1, s, 1];
    const latKnots = [0, 0, 0, 0.5, 0.5, 1, 1, 1];

    // Longitudinal: 9 CPs around equator at z=0.
    // For each latitude i, the longitudinal control row sits at the
    // ring of radius latCps[i].x and height latCps[i].z.
    // The full sphere control net is 5 × 9 (lat × lon).
    //
    // Per Piegl/Tiller, the sphere surface uses the SAME knots in u as
    // the unit circle representation:
    //   knotsU = [0,0,0, 1/4,1/4, 1/2,1/2, 3/4,3/4, 1,1,1]
    //
    // For ring at latitude i with radius r_i = latCps[i].x:
    //   the 9 ring CPs are r_i × the unit circle CPs (with the
    //   middle (corner) CPs at radius r_i × √2 / 1 = r_i for the
    //   weight-s case; but actually for a circle of radius r the
    //   middle CP is at (r, r) with weight s = √2/2 ... same as unit
    //   circle scaled by r.
    const circleCpsXY = [
      [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
      [-1, -1], [0, -1], [1, -1], [1, 0],
    ];
    const circleW = [1, s, 1, s, 1, s, 1, s, 1];

    const controlNet = [];
    const weights = [];
    for (let i = 0; i < 9; i++) {
      const cpRow = [];
      const wRow = [];
      for (let j = 0; j < 5; j++) {
        const r = latCps[j][0];
        const z = latCps[j][2];
        cpRow.push([r * circleCpsXY[i][0], r * circleCpsXY[i][1], z]);
        // Weight is product of u and v weights (Piegl/Tiller §4.4.4)
        wRow.push(circleW[i] * latW[j]);
      }
      controlNet.push(cpRow);
      weights.push(wRow);
    }
    return new NURBSSurface({
      degreeU: 2, degreeV: 2,
      controlNet, weights,
      knotsU: [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1],
      knotsV: latKnots,
    });
  }
}
