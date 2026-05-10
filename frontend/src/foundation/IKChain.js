/**
 * ArchDisc Foundation — Inverse Kinematics on revolute chains.
 *
 * Damped least-squares (DLS) IK solver for serial revolute-joint chains
 * in 3D. Robust at singularities (where the Jacobian loses rank — e.g.
 * a fully extended arm) because of the Levenberg-Marquardt-style
 * damping in the pseudo-inverse:
 *
 *     Δθ = J^T (J J^T + λ² I)^-1 (x_target − x_end)
 *
 * As λ → 0 this becomes the Moore-Penrose pseudo-inverse (least-norm
 * solution to J Δθ = e). As λ grows, Δθ shrinks toward J^T e — a small
 * step in the gradient-descent direction. Near singularities we
 * automatically blend toward J^T e and avoid the divergence the bare
 * pseudo-inverse would suffer.
 *
 * Chain definition:
 *   - Base frame at world origin (configurable).
 *   - Each joint is { axis: 'x'|'y'|'z' or [vx,vy,vz], offset: [dx,dy,dz] }
 *     where `axis` is the joint axis in the joint's local frame and
 *     `offset` is the link vector (from previous joint origin to this
 *     joint origin) in the previous joint's local frame.
 *   - Tip is at the end of the last link's offset, optionally with a
 *     fixed end-effector offset.
 *
 * Forward kinematics: chain transforms applied as homogeneous matrices.
 * Joint i has a rotation by θ_i around its local axis, then translation
 * by its offset.
 */

const D2R = Math.PI / 180;

function mat4Identity() {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}
function mat4Mul(a, b) {
  const out = new Float64Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j];
      out[i * 4 + j] = s;
    }
  return out;
}
function mat4Translate(t) {
  const m = mat4Identity();
  m[3] = t[0]; m[7] = t[1]; m[11] = t[2];
  return m;
}
function mat4RotateAxis(axis, angle) {
  // Rodrigues — rotate around unit axis by angle (radians)
  const ax = axis[0], ay = axis[1], az = axis[2];
  const len = Math.hypot(ax, ay, az) || 1;
  const ux = ax / len, uy = ay / len, uz = az / len;
  const c = Math.cos(angle), s = Math.sin(angle), omc = 1 - c;
  const m = mat4Identity();
  m[0]  = c + ux * ux * omc;
  m[1]  = ux * uy * omc - uz * s;
  m[2]  = ux * uz * omc + uy * s;
  m[4]  = uy * ux * omc + uz * s;
  m[5]  = c + uy * uy * omc;
  m[6]  = uy * uz * omc - ux * s;
  m[8]  = uz * ux * omc - uy * s;
  m[9]  = uz * uy * omc + ux * s;
  m[10] = c + uz * uz * omc;
  return m;
}
function mat4MulPoint(m, p) {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2]  * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6]  * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}
function mat4MulVec(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2]  * v[2],
    m[4] * v[0] + m[5] * v[1] + m[6]  * v[2],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
  ];
}

function axisToVec(a) {
  if (Array.isArray(a)) return a;
  if (a === 'x') return [1, 0, 0];
  if (a === 'y') return [0, 1, 0];
  if (a === 'z') return [0, 0, 1];
  throw new Error(`Bad axis: ${a}`);
}

/**
 * IKChain: serial revolute chain.
 */
export class IKChain {
  /**
   * @param {Array<{axis, offset, lower?, upper?}>} joints
   *   axis: 'x'|'y'|'z' or [vx,vy,vz] in the JOINT's local frame
   *   offset: [dx,dy,dz] link vector (from previous joint origin)
   *   lower, upper: optional joint limits (radians)
   * @param {Array<number>} initialAngles - default 0 each
   * @param {number[]} options.endEffectorOffset - tip offset from last
   *   joint frame (default [0,0,0])
   */
  constructor(joints, initialAngles = null, options = {}) {
    this.joints = joints;
    this.angles = initialAngles ?? new Array(joints.length).fill(0);
    this.endEffectorOffset = options.endEffectorOffset ?? [0, 0, 0];
  }

  /**
   * Compute world-frame transforms for each joint origin and the tip.
   * @returns {{ jointFrames: Float64Array[], jointOrigins: number[][], tipPos: number[] }}
   */
  forwardKinematics(angles = this.angles) {
    let M = mat4Identity();
    const jointFrames = [];
    const jointOrigins = [];
    for (let i = 0; i < this.joints.length; i++) {
      const j = this.joints[i];
      // Joint origin (before its rotation)
      const tMat = mat4Translate(j.offset);
      M = mat4Mul(M, tMat);
      jointOrigins.push(mat4MulPoint(M, [0, 0, 0]));
      // Apply rotation about local axis
      const ax = axisToVec(j.axis);
      const rMat = mat4RotateAxis(ax, angles[i]);
      M = mat4Mul(M, rMat);
      jointFrames.push(new Float64Array(M));   // copy
    }
    const tipPos = mat4MulPoint(M, this.endEffectorOffset);
    return { jointFrames, jointOrigins, tipPos };
  }

  /**
   * Numerical Jacobian: ∂(tip)/∂θ_i for each joint i.
   * 3×N matrix.
   */
  jacobian(angles = this.angles, eps = 1e-5) {
    const J = [
      new Float64Array(angles.length),
      new Float64Array(angles.length),
      new Float64Array(angles.length),
    ];
    const tip0 = this.forwardKinematics(angles).tipPos;
    const a = angles.slice();
    for (let i = 0; i < angles.length; i++) {
      a[i] += eps;
      const tipP = this.forwardKinematics(a).tipPos;
      a[i] -= 2 * eps;
      const tipM = this.forwardKinematics(a).tipPos;
      a[i] += eps;
      for (let r = 0; r < 3; r++) J[r][i] = (tipP[r] - tipM[r]) / (2 * eps);
    }
    return { J, tip0 };
  }

  /**
   * Solve IK to bring the tip to `target` (a 3-vec).
   * Damped least-squares iterations.
   *
   * @param {number[]} target
   * @param {object} options
   * @param {number} options.maxIter - default 200
   * @param {number} options.tol - convergence (mm) — default 1e-3
   * @param {number} options.lambda - DLS damping — default 0.05
   * @param {number} options.stepSize - max step per iter — default 0.5
   *   (radians). Limits aggressive moves.
   * @returns {{ converged, iterations, finalDistance, angles, history }}
   */
  solveIK(target, options = {}) {
    const maxIter = options.maxIter ?? 200;
    const tol = options.tol ?? 1e-3;
    const lambda = options.lambda ?? 0.05;
    const stepSize = options.stepSize ?? 0.5;
    const angles = this.angles.slice();
    const history = [];

    for (let iter = 0; iter < maxIter; iter++) {
      const { J, tip0 } = this.jacobian(angles);
      const e = [target[0] - tip0[0], target[1] - tip0[1], target[2] - tip0[2]];
      const dist = Math.hypot(...e);
      history.push({ iter, dist, angles: angles.slice() });
      if (dist < tol) {
        return { converged: true, iterations: iter, finalDistance: dist, angles, history };
      }

      // Compute Δθ = J^T (J J^T + λ² I)^-1 e
      // J is 3×n, J J^T is 3×3.
      const n = angles.length;
      const JJt = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          let s = 0;
          for (let k = 0; k < n; k++) s += J[i][k] * J[j][k];
          JJt[i][j] = s + (i === j ? lambda * lambda : 0);
        }
      // Solve JJt y = e (3x3)
      const y = solve3x3(JJt, e);
      if (!y) {
        return { converged: false, iterations: iter, finalDistance: dist, angles, history, status: 'singular-3x3' };
      }
      // Δθ = J^T y
      const dTheta = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 3; j++) dTheta[i] += J[j][i] * y[j];
      }
      // Limit step magnitude
      let mag = 0;
      for (const dt of dTheta) mag = Math.max(mag, Math.abs(dt));
      if (mag > stepSize) {
        const scale = stepSize / mag;
        for (let i = 0; i < n; i++) dTheta[i] *= scale;
      }
      // Apply + clamp to joint limits
      for (let i = 0; i < n; i++) {
        angles[i] += dTheta[i];
        const lo = this.joints[i].lower;
        const up = this.joints[i].upper;
        if (lo !== undefined && angles[i] < lo) angles[i] = lo;
        if (up !== undefined && angles[i] > up) angles[i] = up;
      }
    }
    const tipFinal = this.forwardKinematics(angles).tipPos;
    const finalDist = Math.hypot(target[0] - tipFinal[0], target[1] - tipFinal[1], target[2] - tipFinal[2]);
    return { converged: false, iterations: maxIter, finalDistance: finalDist, angles, history, status: 'max-iter' };
  }
}

function solve3x3(M, b) {
  const det =
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  if (Math.abs(det) < 1e-12) return null;
  const x = [
    (b[0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
      - M[0][1] * (b[1] * M[2][2] - M[1][2] * b[2])
      + M[0][2] * (b[1] * M[2][1] - M[1][1] * b[2])) / det,
    (M[0][0] * (b[1] * M[2][2] - M[1][2] * b[2])
      - b[0] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
      + M[0][2] * (M[1][0] * b[2] - b[1] * M[2][0])) / det,
    (M[0][0] * (M[1][1] * b[2] - b[1] * M[2][1])
      - M[0][1] * (M[1][0] * b[2] - b[1] * M[2][0])
      + b[0] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])) / det,
  ];
  return x;
}
