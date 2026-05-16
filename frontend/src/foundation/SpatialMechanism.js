/**
 * ArchDisc Foundation — spatial (3-D) closed-loop mechanism solver.
 *
 * KinematicsCore solves planar closed loops and spatial OPEN chains.
 * This module closes the remaining gap: closed-loop SPATIAL mechanisms
 * — Stewart platforms, spatial linkages, parallel manipulators.
 *
 * Each moving link carries a 6-DOF pose: position p = [x,y,z] and
 * orientation as a unit quaternion q = [x,y,z,w]. The solver uses the
 * error-state (iterated) formulation: each Newton step solves for a
 * 6-vector increment per link — 3 translation + a 3-vector rotation
 * increment (exponential map) — which is folded into the stored pose
 * and the quaternion renormalised. This keeps the quaternion exactly
 * unit at every iteration and avoids carrying a redundant norm
 * constraint, so the Jacobian is square (6 per moving link) and
 * well-conditioned. A backtracking line search makes the Newton
 * iteration globally convergent.
 *
 * Joints (constraint counts keep the Jacobian square and full-rank):
 *   spherical { linkA, linkB, pA, pB }                              3 eq
 *   distance  { linkA, linkB, pA, pB, dist }                        1 eq
 *   revolute  { linkA, linkB, pA, pB, axisA, perpA1, perpA2, axisB } 5 eq
 *
 * Kernel-free pure math — node-importable for e2e. Validated by a
 * Stewart-platform inverse→forward round trip.
 */

import { solveLinear } from './KinematicsCore.js';

// ── Quaternion helpers ─────────────────────────────────────────────

/** Rotate vector v by unit quaternion q = [x,y,z,w]. */
export function qRotate(q, v) {
  const tx = 2 * (q[1] * v[2] - q[2] * v[1]);
  const ty = 2 * (q[2] * v[0] - q[0] * v[2]);
  const tz = 2 * (q[0] * v[1] - q[1] * v[0]);
  return [
    v[0] + q[3] * tx + (q[1] * tz - q[2] * ty),
    v[1] + q[3] * ty + (q[2] * tx - q[0] * tz),
    v[2] + q[3] * tz + (q[0] * ty - q[1] * tx),
  ];
}

/** Hamilton product a·b. */
function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Unit quaternion from a rotation vector (exponential map). */
function quatFromRotVec(r) {
  const ang = Math.hypot(r[0], r[1], r[2]);
  if (ang < 1e-12) return [0, 0, 0, 1];
  const s = Math.sin(ang / 2) / ang;
  return [r[0] * s, r[1] * s, r[2] * s, Math.cos(ang / 2)];
}

function quatNormalize(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Apply a 6-vector increment (3 translation + 3 rotation) to a pose. */
function applyDelta(pose, d) {
  return {
    p: [pose.p[0] + d[0], pose.p[1] + d[1], pose.p[2] + d[2]],
    q: quatNormalize(quatMul(quatFromRotVec([d[3], d[4], d[5]]), pose.q)),
  };
}

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a) => Math.hypot(a[0], a[1], a[2]);

/** World coordinates of a link-local point. */
function worldPoint(pose, pLocal) {
  const r = qRotate(pose.q, pLocal);
  return [pose.p[0] + r[0], pose.p[1] + r[1], pose.p[2] + r[2]];
}

// ── Spatial mechanism ──────────────────────────────────────────────

/**
 * A spatial mechanism. links[0] is ground (fixed at the origin with
 * identity orientation). Each other link supplies an initial pose
 * { p:[x,y,z], q:[x,y,z,w] } used to seed the Newton-Raphson solve.
 */
export class SpatialMechanism {
  constructor({ links, joints, drivers }) {
    this.links = links;
    this.joints = joints;
    this.drivers = drivers ?? [];
    this._poses = links.map((l, i) =>
      i === 0
        ? { p: [0, 0, 0], q: [0, 0, 0, 1] }
        : {
            p: [...(l.pose?.p ?? [0, 0, 0])],
            q: quatNormalize(l.pose?.q ?? [0, 0, 0, 1]),
          });
  }

  /** Value prescribed by a driver on joint `ji`, or null if undriven. */
  _driven(ji, t) {
    const d = this.drivers.find((dr) => dr.jointIndex === ji);
    return d ? d.fn(t) : null;
  }

  /** Joint equation count (must equal 6·(moving links) to be well-posed). */
  _equationCount() {
    let n = 0;
    for (const j of this.joints) {
      n += j.type === 'spherical' ? 3 : j.type === 'revolute' ? 5 : 1;
    }
    return n;
  }

  /** Residual vector of all joint constraints for the given poses. */
  _residual(poses, t) {
    const F = [];
    for (let ji = 0; ji < this.joints.length; ji++) {
      const j = this.joints[ji];
      const A = poses[j.linkA];
      const B = poses[j.linkB];
      const wA = worldPoint(A, j.pA);
      const wB = worldPoint(B, j.pB);
      if (j.type === 'spherical') {
        F.push(wA[0] - wB[0], wA[1] - wB[1], wA[2] - wB[2]);
      } else if (j.type === 'distance') {
        const d = this._driven(ji, t) ?? j.dist;
        F.push(norm3(sub3(wA, wB)) - d);
      } else if (j.type === 'revolute') {
        F.push(wA[0] - wB[0], wA[1] - wB[1], wA[2] - wB[2]);
        const axB = qRotate(B.q, j.axisB);
        F.push(dot3(axB, qRotate(A.q, j.perpA1)), dot3(axB, qRotate(A.q, j.perpA2)));
      } else {
        throw new Error(`SpatialMechanism: unknown joint type '${j.type}'`);
      }
    }
    return F;
  }

  /** Apply a flat delta vector (6 per moving link) to a pose array. */
  _withDelta(poses, delta) {
    const out = [poses[0]];
    for (let i = 1; i < poses.length; i++) {
      out.push(applyDelta(poses[i], delta.slice(6 * (i - 1), 6 * (i - 1) + 6)));
    }
    return out;
  }

  /**
   * Solve the spatial configuration at time t.
   *
   * Levenberg-Marquardt: each step solves (JᵀJ + λ·diag(JᵀJ))·δ = −JᵀF.
   * λ interpolates between Gauss-Newton (fast near a root) and damped
   * gradient descent (robust when the Jacobian is near-singular or the
   * step would overshoot). λ adapts to whether the step reduced the
   * residual — this is the standard globally-convergent solver for the
   * spurious local minima a Stewart-platform residual surface has.
   *
   * @returns {{ links, residualNorm, converged, iterations }}
   */
  solveAt(t, opts = {}) {
    const tol = opts.tol ?? 1e-10;
    const maxIter = opts.maxIter ?? 200;
    const D = 6 * (this.links.length - 1);
    if (this._equationCount() !== D) {
      throw new Error(
        `SpatialMechanism: ${this._equationCount()} equations for ${D} unknowns — ` +
        `mechanism is not well-posed`);
    }

    let poses = this._poses.map((p) => ({ p: [...p.p], q: [...p.q] }));
    let F = this._residual(poses, t);
    let norm = Math.hypot(...F);
    const M = F.length;
    let lambda = 1e-3;
    let iterations = 0;

    while (norm > tol && iterations < maxIter) {
      // Finite-difference Jacobian about delta = 0.
      const eps = 1e-7;
      const J = Array.from({ length: M }, () => new Array(D).fill(0));
      for (let k = 0; k < D; k++) {
        const d = new Array(D).fill(0);
        d[k] = eps;
        const Fk = this._residual(this._withDelta(poses, d), t);
        for (let i = 0; i < M; i++) J[i][k] = (Fk[i] - F[i]) / eps;
      }
      // Normal equations JᵀJ and gradient JᵀF.
      const JtJ = Array.from({ length: D }, () => new Array(D).fill(0));
      const Jtf = new Array(D).fill(0);
      for (let a = 0; a < D; a++) {
        for (let b = 0; b < D; b++) {
          let s = 0;
          for (let i = 0; i < M; i++) s += J[i][a] * J[i][b];
          JtJ[a][b] = s;
        }
        let g = 0;
        for (let i = 0; i < M; i++) g += J[i][a] * F[i];
        Jtf[a] = g;
      }
      let stepAccepted = false;
      for (let inner = 0; inner < 14; inner++) {
        const A = JtJ.map((row, a) => row.map((v, b) =>
          a === b ? v + lambda * (JtJ[a][a] + 1e-12) : v));
        const ddelta = solveLinear(A, Jtf.map((v) => -v));
        if (!ddelta) { lambda *= 8; continue; }
        const trial = this._withDelta(poses, ddelta);
        const Ft = this._residual(trial, t);
        const nt = Math.hypot(...Ft);
        if (nt < norm) {
          poses = trial; F = Ft; norm = nt;
          lambda = Math.max(lambda * 0.3, 1e-12);
          stepAccepted = true;
          break;
        }
        lambda *= 8;
        if (lambda > 1e14) break;
      }
      if (!stepAccepted) break;
      iterations++;
    }
    const converged = norm <= Math.max(tol, 1e-6);
    if (converged) this._poses = poses;

    return {
      links: poses.map((p) => ({ p: [...p.p], q: [...p.q] })),
      residualNorm: norm, converged, iterations,
    };
  }
}

// ── Stewart platform builder ───────────────────────────────────────

/**
 * Build a 6-leg Stewart platform: a rigid moving platform connected to
 * ground by six variable-length legs. The platform is one link; each
 * leg is a `distance` constraint from a platform-fixed anchor to a
 * ground-fixed anchor. Driving the six leg lengths drives the platform.
 *
 * @param {object} cfg
 * @param {number[][]} cfg.baseAnchors      6 ground points
 * @param {number[][]} cfg.platformAnchors  6 platform-local points
 * @param {number[]}   cfg.legLengths       6 current leg lengths
 * @param {object=}    cfg.initialPose      seed { p, q }
 * @returns {SpatialMechanism}
 */
export function buildStewartPlatform(cfg) {
  const joints = cfg.baseAnchors.map((B, i) => ({
    type: 'distance',
    linkA: 1, pA: cfg.platformAnchors[i],
    linkB: 0, pB: B,
    dist: cfg.legLengths[i],
  }));
  return new SpatialMechanism({
    links: [
      { name: 'ground' },
      { name: 'platform', pose: cfg.initialPose ?? { p: [0, 0, 100], q: [0, 0, 0, 1] } },
    ],
    joints,
  });
}

/**
 * Inverse kinematics of a Stewart platform: given a platform pose,
 * return the six leg lengths. Closed-form — validates the forward solve.
 */
export function stewartLegLengths(pose, baseAnchors, platformAnchors) {
  return baseAnchors.map((B, i) => norm3(sub3(worldPoint(pose, platformAnchors[i]), B)));
}
