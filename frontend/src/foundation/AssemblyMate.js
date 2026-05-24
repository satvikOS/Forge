/**
 * ArchDisc Foundation — 6-DOF assembly mate solver.
 *
 * Each Part has a transform (translation + rotation). Mates impose
 * constraints between two parts (or a part and the world). The solver
 * finds part transforms that satisfy all mates simultaneously, using
 * Levenberg-Marquardt over the Part transforms.
 *
 * Mate types (anchor specified relative to each part's local frame):
 *
 *   coincident(partA, anchorA, partB, anchorB)
 *     Two anchor points coincide in world space.
 *
 *   distance(partA, anchorA, partB, anchorB, d)
 *     Anchors at distance d (3D Euclidean).
 *
 *   concentric(partA, axisA, partB, axisB)
 *     Two axes (point + direction) become collinear.
 *
 *   parallel(partA, dirA, partB, dirB)
 *     Two direction vectors point the same way.
 *
 *   perpendicular(partA, dirA, partB, dirB)              [Tier-7a]
 *     Two direction vectors at 90° (dot product = 0).
 *
 *   tangent(partA, axisA, partB, anchorB, radius)        [Tier-7a]
 *     A point/anchor on partB lies at distance `radius` from the cylindrical
 *     axis on partA. Works for cylinder/sphere/cone-equivalent surfaces by
 *     supplying the axis line + radius from the analytic geometry.
 *
 *   angle(partA, dirA, partB, dirB, theta_rad)
 *     Two direction vectors at angle θ.
 *
 *   lock(partA, partB)
 *     All 6 DOF locked between A and B (rigid).
 *
 * Anchor types:
 *   { type: 'point', xyz: [x,y,z] }                 // local point
 *   { type: 'axis', origin: [x,y,z], dir: [x,y,z] } // local axis
 *   { type: 'dir', dir: [x,y,z] }                   // local direction only
 *
 * One part per assembly may be marked `fixed = true`. If none is fixed,
 * the first part is treated as ground.
 */

const D2R = Math.PI / 180;

function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function vLen(a) { return Math.hypot(a[0], a[1], a[2]); }
function vNorm(a) { const l = vLen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

/**
 * Build a 3x3 rotation matrix from Euler XYZ in degrees.
 */
function rotMatrixXYZ(rxDeg, ryDeg, rzDeg) {
  const rx = rxDeg * D2R, ry = ryDeg * D2R, rz = rzDeg * D2R;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    [cy * cz, -cy * sz, sy],
    [sx * sy * cz + cx * sz, -sx * sy * sz + cx * cz, -sx * cy],
    [-cx * sy * cz + sx * sz, cx * sy * sz + sx * cz, cx * cy],
  ];
}

function matVec(M, v) {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
  ];
}

/**
 * Apply a part's transform to a local point/dir.
 */
function transformPoint(part, p) {
  const R = rotMatrixXYZ(...part.transform.rotation);
  return vAdd(matVec(R, p), part.transform.translation);
}
function transformDir(part, d) {
  const R = rotMatrixXYZ(...part.transform.rotation);
  return matVec(R, d);
}

export class Assembly {
  constructor(name) {
    this.name = name || 'assembly';
    this.parts = [];
    this.mates = [];
  }

  addPart(part) {
    this.parts.push(part);
    return this;
  }

  fix(part) {
    part._fixed = true;
    return this;
  }

  // --- Mate factories ---
  coincident(partA, anchorA, partB, anchorB) {
    this.mates.push({ kind: 'coincident', partA, anchorA, partB, anchorB });
    return this;
  }
  distance(partA, anchorA, partB, anchorB, d) {
    this.mates.push({ kind: 'distance', partA, anchorA, partB, anchorB, d });
    return this;
  }
  concentric(partA, axisA, partB, axisB) {
    this.mates.push({ kind: 'concentric', partA, axisA, partB, axisB });
    return this;
  }
  parallel(partA, dirA, partB, dirB) {
    this.mates.push({ kind: 'parallel', partA, dirA, partB, dirB });
    return this;
  }
  perpendicular(partA, dirA, partB, dirB) {
    this.mates.push({ kind: 'perpendicular', partA, dirA, partB, dirB });
    return this;
  }
  tangent(partA, axisA, partB, anchorB, radius) {
    this.mates.push({ kind: 'tangent', partA, axisA, partB, anchorB, radius });
    return this;
  }
  angle(partA, dirA, partB, dirB, thetaRad) {
    this.mates.push({ kind: 'angle', partA, dirA, partB, dirB, theta: thetaRad });
    return this;
  }
  lock(partA, partB) {
    this.mates.push({ kind: 'lock', partA, partB });
    return this;
  }

  /**
   * Compute residuals for the current transform state.
   */
  _residuals() {
    const r = [];
    for (const m of this.mates) {
      switch (m.kind) {
        case 'coincident': {
          const a = transformPoint(m.partA, m.anchorA.xyz);
          const b = transformPoint(m.partB, m.anchorB.xyz);
          r.push(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          break;
        }
        case 'distance': {
          const a = transformPoint(m.partA, m.anchorA.xyz);
          const b = transformPoint(m.partB, m.anchorB.xyz);
          r.push(vLen(vSub(a, b)) - m.d);
          break;
        }
        case 'concentric': {
          // axes coincide: their direction must be parallel AND the line
          // through originA along dirA must contain originB.
          const oA = transformPoint(m.partA, m.axisA.origin);
          const dA = vNorm(transformDir(m.partA, m.axisA.dir));
          const oB = transformPoint(m.partB, m.axisB.origin);
          const dB = vNorm(transformDir(m.partB, m.axisB.dir));
          const cross = vCross(dA, dB);
          r.push(cross[0], cross[1], cross[2]);   // parallel direction
          // perpendicular distance from oB to line(oA, dA)
          const w = vSub(oB, oA);
          const proj = vDot(w, dA);
          const perp = vSub(w, [dA[0] * proj, dA[1] * proj, dA[2] * proj]);
          r.push(perp[0], perp[1], perp[2]);     // collinear origins
          break;
        }
        case 'parallel': {
          const dA = vNorm(transformDir(m.partA, m.dirA.dir));
          const dB = vNorm(transformDir(m.partB, m.dirB.dir));
          const c = vCross(dA, dB);
          r.push(c[0], c[1], c[2]);
          break;
        }
        case 'perpendicular': {
          // Tier-7a: dot product of unit direction vectors = 0
          // (single scalar residual — removes 1 rotational DOF).
          const dA = vNorm(transformDir(m.partA, m.dirA.dir));
          const dB = vNorm(transformDir(m.partB, m.dirB.dir));
          r.push(vDot(dA, dB));
          break;
        }
        case 'tangent': {
          // Tier-7a: distance from anchorB to axisA = radius.
          // For a cylinder of radius R centred on axisA, this constrains
          // the anchor point on partB to touch the surface tangentially
          // (single scalar residual — removes 1 DOF).
          const oA = transformPoint(m.partA, m.axisA.origin);
          const dA = vNorm(transformDir(m.partA, m.axisA.dir));
          const pB = transformPoint(m.partB, m.anchorB.xyz);
          // Perpendicular distance from pB to line(oA, dA).
          const w = vSub(pB, oA);
          const proj = vDot(w, dA);
          const perp = vSub(w, [dA[0] * proj, dA[1] * proj, dA[2] * proj]);
          r.push(vLen(perp) - m.radius);
          break;
        }
        case 'angle': {
          const dA = vNorm(transformDir(m.partA, m.dirA.dir));
          const dB = vNorm(transformDir(m.partB, m.dirB.dir));
          const cos = Math.max(-1, Math.min(1, vDot(dA, dB)));
          r.push(Math.acos(cos) - m.theta);
          break;
        }
        case 'lock': {
          // 3 translation + 3 rotation residuals (treat partA as ground)
          const tA = m.partA.transform.translation;
          const rA = m.partA.transform.rotation;
          const tB = m.partB.transform.translation;
          const rB = m.partB.transform.rotation;
          for (let i = 0; i < 3; i++) r.push(tA[i] - tB[i]);
          for (let i = 0; i < 3; i++) r.push(rA[i] - rB[i]);
          break;
        }
        default:
          throw new Error(`Unknown mate kind: ${m.kind}`);
      }
    }
    return r;
  }

  _buildDOFs() {
    const dofs = [];
    for (const p of this.parts) {
      if (p._fixed) continue;
      for (const k of ['translation', 'rotation']) {
        for (let i = 0; i < 3; i++) {
          dofs.push({ part: p, kind: k, index: i });
        }
      }
    }
    return dofs;
  }
  _readDOFs(dofs) {
    return dofs.map(d => d.part.transform[d.kind][d.index]);
  }
  _writeDOFs(dofs, x) {
    for (let i = 0; i < dofs.length; i++) dofs[i].part.transform[dofs[i].kind][dofs[i].index] = x[i];
  }

  _jacobian(dofs, eps = 1e-5) {
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
      this._writeDOFs(dofs, x0);
      for (let i = 0; i < m; i++) J[i][j] = (rp[i] - r0[i]) / eps;
    }
    return { J, r0 };
  }

  /**
   * Solve mates. Returns convergence diagnostics.
   */
  solve(opts = {}) {
    const tol = opts.tol ?? 1e-7;
    const maxIter = opts.maxIter ?? 80;
    let lambda = opts.lambda0 ?? 1e-2;

    if (this.mates.length === 0) {
      return { converged: true, iterations: 0, residualNorm: 0, status: 'no-mates' };
    }
    if (!this.parts.some(p => p._fixed)) {
      this.parts[0]._fixed = true;  // ground first part
    }

    const dofs = this._buildDOFs();
    if (dofs.length === 0) {
      const r = this._residuals();
      return {
        converged: norm(r) < tol, iterations: 0, residualNorm: norm(r),
        status: 'all-parts-fixed',
      };
    }

    let prevNorm = Infinity;
    for (let iter = 0; iter < maxIter; iter++) {
      const { J, r0 } = this._jacobian(dofs);
      const rNorm = norm(r0);
      if (rNorm < tol) {
        return { converged: true, iterations: iter, residualNorm: rNorm, status: 'converged' };
      }
      const n = dofs.length, m = r0.length;
      const A = mulJtJ(J, n, m);
      const g = mulJtr(J, r0, n, m);
      for (let i = 0; i < n; i++) A[i][i] += lambda * (A[i][i] + 1);
      const dx = solveLinear(A, g, n);
      if (!dx) return { converged: false, iterations: iter, residualNorm: rNorm, status: 'singular-jacobian' };

      const x0 = this._readDOFs(dofs);
      const xT = x0.map((v, i) => v - dx[i]);
      this._writeDOFs(dofs, xT);
      const rT = this._residuals();
      const tNorm = norm(rT);

      if (tNorm < rNorm) {
        lambda = Math.max(lambda * 0.5, 1e-12);
        if (Math.abs(prevNorm - tNorm) < tol * 0.01 && tNorm > tol) {
          return {
            converged: false, iterations: iter, residualNorm: tNorm,
            status: 'over-constrained',
          };
        }
        prevNorm = tNorm;
      } else {
        this._writeDOFs(dofs, x0);
        lambda = Math.min(lambda * 5, 1e6);
      }
    }
    const final = this._residuals();
    return {
      converged: norm(final) < tol, iterations: maxIter, residualNorm: norm(final),
      status: norm(final) < tol ? 'converged' : 'max-iterations',
    };
  }
}

function norm(v) { let s = 0; for (const x of v) s += x * x; return Math.sqrt(s); }
function mulJtJ(J, n, m) {
  const A = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let s = 0; for (let k = 0; k < m; k++) s += J[k][i] * J[k][j]; A[i][j] = s;
  }
  return A;
}
function mulJtr(J, r, n, m) {
  const g = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < m; k++) s += J[k][i] * r[k]; g[i] = s; }
  return g;
}
function solveLinear(A, b, n) {
  const M = A.map(row => Array.from(row));
  const v = Array.from(b);
  for (let k = 0; k < n; k++) {
    let pivot = k, pmax = Math.abs(M[k][k]);
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > pmax) { pmax = Math.abs(M[i][k]); pivot = i; }
    if (pmax < 1e-14) return null;
    if (pivot !== k) { [M[k], M[pivot]] = [M[pivot], M[k]]; [v[k], v[pivot]] = [v[pivot], v[k]]; }
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      for (let j = k; j < n; j++) M[i][j] -= f * M[k][j];
      v[i] -= f * v[k];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = v[i]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}
