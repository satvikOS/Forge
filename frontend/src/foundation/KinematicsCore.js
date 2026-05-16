/**
 * ArchDisc Foundation — general mechanism kinematics.
 *
 * Until now ArchDisc had only point-solution kinematics (a closed-form
 * 4-bar linkage, an IK chain). This module is the general engine:
 *
 *   • Joint types — revolute, prismatic, gear, plus spatial revolute/
 *     prismatic for open chains.
 *   • Mobility — Grübler (planar) and Kutzbach (spatial) DOF.
 *   • PlanarMechanism — a constraint-based solver for ARBITRARY planar
 *     mechanisms, including closed loops (4-bar, slider-crank, six-bar,
 *     geared trains). Each moving link carries a pose (x, y, θ); joints
 *     impose algebraic constraints; drivers prescribe coordinates; the
 *     configuration is found by Newton-Raphson with a finite-difference
 *     Jacobian. Warm-started across time steps for branch consistency.
 *   • SpatialChain — exact forward kinematics for open spatial chains
 *     (robot arms, articulated mechanisms) via 4×4 transform composition.
 *
 * Kernel-free pure math — node-importable for e2e. Validated against the
 * FourBarLinkage closed form and the analytic slider-crank relation.
 */

// ── Mobility (degrees of freedom) ──────────────────────────────────

// Planar constraint count removed by each joint type.
const PLANAR_CONSTRAINTS = { revolute: 2, prismatic: 2, gear: 1, cam: 1 };
// Spatial freedom of each joint type (used by Kutzbach).
const SPATIAL_FREEDOM = { revolute: 1, prismatic: 1, cylindrical: 2, spherical: 3, planar: 3 };

/**
 * Grübler mobility for a planar mechanism.
 * DOF = 3(n−1) − Σ constraints, n = link count including ground.
 */
export function grublerDOF(linkCount, joints) {
  let removed = 0;
  for (const j of joints) removed += PLANAR_CONSTRAINTS[j.type] ?? 2;
  return 3 * (linkCount - 1) - removed;
}

/**
 * Kutzbach mobility for a spatial mechanism.
 * DOF = 6(n−1) − Σ(6 − f), f = joint freedom.
 */
export function kutzbachDOF(linkCount, joints) {
  let removed = 0;
  for (const j of joints) removed += 6 - (SPATIAL_FREEDOM[j.type] ?? 1);
  return 6 * (linkCount - 1) - removed;
}

// ── Dense linear solve (Gaussian elimination, partial pivoting) ────

/** Solve A·x = b for a square dense system. Returns x, or null if singular. */
export function solveLinear(A, b) {
  const n = b.length;
  // Augmented copy.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    // Partial pivot.
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-14) return null;   // singular
    [M[col], M[piv]] = [M[piv], M[col]];
    // Eliminate below.
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  // Back-substitution.
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

// ── Planar mechanism ───────────────────────────────────────────────

/** Map a point in a link's local frame to world coordinates. */
function pointWorld(pose, pLocal) {
  const c = Math.cos(pose.theta), s = Math.sin(pose.theta);
  return [
    pose.x + pLocal[0] * c - pLocal[1] * s,
    pose.y + pLocal[0] * s + pLocal[1] * c,
  ];
}

/**
 * A planar mechanism: links (index 0 = ground, fixed at the origin),
 * joints connecting links, and drivers prescribing joint coordinates.
 *
 * Joint shapes:
 *   revolute  { type, linkA, linkB, pA:[x,y], pB:[x,y] }
 *   prismatic { type, linkA, linkB, pA, pB, axisAngle?, dTheta0?, perpOffset? }
 *   gear      { type, linkA, linkB, ratioA, ratioB, phase? }
 * Driver:
 *   { jointIndex, fn:(t)=>value }   drives the joint's relative coordinate
 *
 * Each link supplies an initial pose {x,y,theta} used to seed the solve.
 */
export class PlanarMechanism {
  constructor({ links, joints, drivers }) {
    this.links = links;            // links[0] is ground
    this.joints = joints;
    this.drivers = drivers ?? [];
    this._q = this._seedFromLinks();
  }

  /** Grübler DOF of this mechanism. */
  dof() {
    return grublerDOF(this.links.length, this.joints);
  }

  _seedFromLinks() {
    const q = [];
    for (let i = 1; i < this.links.length; i++) {
      const p = this.links[i].pose ?? { x: 0, y: 0, theta: 0 };
      q.push(p.x, p.y, p.theta);
    }
    return q;
  }

  _linkPose(idx, q) {
    if (idx === 0) return { x: 0, y: 0, theta: 0 };
    const b = 3 * (idx - 1);
    return { x: q[b], y: q[b + 1], theta: q[b + 2] };
  }

  /** Residual vector of all joint + driver constraints at time t. */
  _residual(q, t) {
    const F = [];
    for (const j of this.joints) {
      const A = this._linkPose(j.linkA, q);
      const B = this._linkPose(j.linkB, q);
      if (j.type === 'revolute') {
        const wA = pointWorld(A, j.pA);
        const wB = pointWorld(B, j.pB);
        F.push(wA[0] - wB[0], wA[1] - wB[1]);
      } else if (j.type === 'prismatic') {
        F.push(B.theta - A.theta - (j.dTheta0 ?? 0));
        const wA = pointWorld(A, j.pA);
        const wB = pointWorld(B, j.pB);
        const ax = A.theta + (j.axisAngle ?? 0);
        const perp = [-Math.sin(ax), Math.cos(ax)];
        F.push((wB[0] - wA[0]) * perp[0] + (wB[1] - wA[1]) * perp[1] - (j.perpOffset ?? 0));
      } else if (j.type === 'gear') {
        F.push(j.ratioA * A.theta + j.ratioB * B.theta - (j.phase ?? 0));
      } else {
        throw new Error(`PlanarMechanism: unknown joint type '${j.type}'`);
      }
    }
    for (const d of this.drivers) {
      const j = this.joints[d.jointIndex];
      const A = this._linkPose(j.linkA, q);
      const B = this._linkPose(j.linkB, q);
      if (j.type === 'revolute' || j.type === 'gear') {
        F.push((B.theta - A.theta) - d.fn(t));
      } else if (j.type === 'prismatic') {
        const wA = pointWorld(A, j.pA);
        const wB = pointWorld(B, j.pB);
        const ax = A.theta + (j.axisAngle ?? 0);
        const axis = [Math.cos(ax), Math.sin(ax)];
        F.push((wB[0] - wA[0]) * axis[0] + (wB[1] - wA[1]) * axis[1] - d.fn(t));
      }
    }
    return F;
  }

  /**
   * Solve the mechanism configuration at time t (Newton-Raphson).
   * @param {number} t
   * @param {object=} opts  { guess?, tol?, maxIter? }
   * @returns {{ links, joints, residualNorm, converged, iterations }}
   */
  solveAt(t, opts = {}) {
    const tol = opts.tol ?? 1e-9;
    const maxIter = opts.maxIter ?? 60;
    let q = (opts.guess ?? this._q).slice();
    const D = q.length;

    let F = this._residual(q, t);
    if (F.length !== D) {
      throw new Error(
        `PlanarMechanism: ${F.length} constraints for ${D} unknowns — ` +
        `mechanism is not well-posed (DOF ${this.dof()}, drivers ${this.drivers.length})`);
    }
    let iterations = 0;
    let norm = Math.hypot(...F);
    while (norm > tol && iterations < maxIter) {
      // Finite-difference Jacobian J[i][k] = ∂F_i/∂q_k.
      const eps = 1e-7;
      const J = Array.from({ length: D }, () => new Array(D).fill(0));
      for (let k = 0; k < D; k++) {
        const qk = q.slice();
        qk[k] += eps;
        const Fk = this._residual(qk, t);
        for (let i = 0; i < D; i++) J[i][k] = (Fk[i] - F[i]) / eps;
      }
      const negF = F.map((v) => -v);
      const dq = solveLinear(J, negF);
      if (!dq) break;                     // singular Jacobian
      for (let k = 0; k < D; k++) q[k] += dq[k];
      F = this._residual(q, t);
      norm = Math.hypot(...F);
      iterations++;
    }
    const converged = norm <= Math.max(tol, 1e-6);
    if (converged) this._q = q;           // warm-start the next step

    const links = [{ x: 0, y: 0, theta: 0 }];
    for (let i = 1; i < this.links.length; i++) links.push(this._linkPose(i, q));
    const joints = this.joints.map((j) => {
      const A = this._linkPose(j.linkA, q);
      return { type: j.type, world: j.pA ? pointWorld(A, j.pA) : null };
    });
    return { links, joints, residualNorm: norm, converged, iterations };
  }
}

// ── Spatial open-chain forward kinematics ──────────────────────────

/** 4×4 identity (row-major, length-16 array). */
function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Row-major 4×4 multiply. */
function mat4Mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++)
        o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
}

/** Translation matrix. */
function mat4Translate(x, y, z) {
  const m = mat4Identity();
  m[3] = x; m[7] = y; m[11] = z;
  return m;
}

/** Rotation by `angle` (rad) about a unit-ish axis (Rodrigues). */
function mat4RotAxis(axis, angle) {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const x = axis[0] / len, y = axis[1] / len, z = axis[2] / len;
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    t * x * x + c,     t * x * y - s * z, t * x * z + s * y, 0,
    t * x * y + s * z, t * y * y + c,     t * y * z - s * x, 0,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,     0,
    0, 0, 0, 1,
  ];
}

/** Apply a row-major 4×4 to a point. */
export function mat4Apply(m, p) {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

/**
 * Open spatial kinematic chain. Joints are listed root-to-tip; each
 * joint frame is positioned at `origin` in its parent link's frame and
 * moves about `axis` (revolute → rotation, prismatic → translation).
 *
 * Joint: { type:'revolute'|'prismatic', axis:[x,y,z], origin:[x,y,z] }
 */
export class SpatialChain {
  constructor({ joints, base } = { joints: [] }) {
    this.joints = joints;
    this.base = base ?? mat4Identity();
  }

  /** Kutzbach DOF (a serial chain: one DOF per joint). */
  dof() {
    return kutzbachDOF(this.joints.length + 1, this.joints);
  }

  /**
   * Forward kinematics. `values` gives each joint's coordinate
   * (angle for revolute, distance for prismatic).
   * @returns {{ linkTransforms: number[][], tip: number[] }}
   */
  fkAt(values, tipLocal = [0, 0, 0]) {
    let frame = this.base.slice();
    const linkTransforms = [frame];
    for (let i = 0; i < this.joints.length; i++) {
      const j = this.joints[i];
      frame = mat4Mul(frame, mat4Translate(j.origin[0], j.origin[1], j.origin[2]));
      const motion = j.type === 'revolute'
        ? mat4RotAxis(j.axis, values[i] ?? 0)
        : mat4Translate(
            j.axis[0] * (values[i] ?? 0),
            j.axis[1] * (values[i] ?? 0),
            j.axis[2] * (values[i] ?? 0));
      frame = mat4Mul(frame, motion);
      linkTransforms.push(frame);
    }
    return { linkTransforms, tip: mat4Apply(frame, tipLocal) };
  }
}
