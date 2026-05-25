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

// ── Tier-7a Assembly mate residual helpers ─────────────────────────
//
// The four NEW standard mates added in Tier-7a — Parallel, Perpendicular,
// Tangent, Lock — operate on the kernel-level MateSolver but the residual
// equations are pure math, so we expose them here as kernel-free helpers.
// Node-importable for e2e + algorithmic verification.
//
// Conventions:
//   - All vectors are plain arrays [x, y, z].
//   - All anchors are world-space (the caller transforms local→world).
//   - Each returns a scalar residual (0 = satisfied).
//   - DOF removed is recorded as a sibling export `ASSEMBLY_MATE_DOF`.

/** DOF count removed by each Tier-7a/7b/7c mate (sum of 6-DOF per body model). */
export const ASSEMBLY_MATE_DOF = Object.freeze({
  parallel: 2,         // 2 rotational DOF (two angles to align)
  perpendicular: 1,    // 1 rotational DOF (one angle = 90°)
  tangent: 1,          // 1 translational DOF (point on cylinder surface)
  lock: 6,             // 3 translational + 3 rotational (rigid attach)
  // ── Tier-7b advanced mates ───────────────────────────────────────
  width: 1,            // 1 translational DOF — tab centred between two
                       //   reference faces (equidistant along gap normal)
  path: 2,             // 2 translational DOF — point constrained to a
                       //   1-manifold curve (kills the two perpendicular-
                       //   to-tangent components of position)
  distanceLimit: 0,    // 0 DOF in the active range (slack); 1 at either
                       //   limit (clamp). Reported as worst-case 0 here —
                       //   the constraint contributes a residual only when
                       //   the current distance leaves [min, max].
  // ── Tier-7c mechanical mates ─────────────────────────────────────
  gear: 1,             // 1 rotational DOF — one rotation coupled to the
                       //   other by a fixed ratio (θ_A · ratio − θ_B = phase).
                       //   The two parts remain free to translate; only the
                       //   along-axis rotational coordinate is coupled.
  hinge: 5,            // 5 DOF — concentric (4: 2 translational + 2
                       //   rotational on the axis) plus coincident along
                       //   the axis (1 translational), leaving exactly one
                       //   rotational DOF about the hinge axis. Optional
                       //   angle limits clamp that remaining DOF dynamically
                       //   (reported via `mate.params._clampedDOF`).
});

function _len(v) { return Math.hypot(v[0], v[1], v[2]); }
function _dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function _sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function _cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function _normalize(v) {
  const l = _len(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Parallel mate residual — two world-space direction vectors are parallel
 * iff |dA × dB| == 0. Returns the magnitude of the cross product (scalar).
 * Range [0, 1] for unit vectors; 0 = satisfied.
 */
export function parallelResidual(dAWorld, dBWorld) {
  const a = _normalize(dAWorld);
  const b = _normalize(dBWorld);
  return _len(_cross(a, b));
}

/**
 * Perpendicular mate residual — two unit direction vectors are perpendicular
 * iff dA · dB == 0. Returns |dot product| (scalar). Range [0, 1].
 */
export function perpendicularResidual(dAWorld, dBWorld) {
  const a = _normalize(dAWorld);
  const b = _normalize(dBWorld);
  return Math.abs(_dot(a, b));
}

/**
 * Tangent mate residual — point pBWorld lies tangent to cylinder
 * (axisOriginWorld + t*axisDirWorld, radius). Returns
 * |perpendicular-distance(pB → axis) − radius| (scalar).
 *
 * Generalises naturally to spheres (pass axisOriginWorld = sphere centre +
 * any axisDirWorld; the perpendicular distance == |pB − origin| when the
 * "axis" is contained in the perpendicular plane).
 */
export function tangentResidual(pBWorld, axisOriginWorld, axisDirWorld, radius) {
  const dN = _normalize(axisDirWorld);
  const w = _sub(pBWorld, axisOriginWorld);
  const proj = _dot(w, dN);
  const perp = [
    w[0] - dN[0] * proj,
    w[1] - dN[1] * proj,
    w[2] - dN[2] * proj,
  ];
  return Math.abs(_len(perp) - radius);
}

/**
 * Lock mate residual — partA and partB share the same world-space pose.
 * Inputs are { translation:[x,y,z], rotation:[rx,ry,rz] }. Returns the
 * 6-vector L2 norm (translation magnitude + rotation magnitude).
 *
 * For a rigid attach, mateResidual = 0 iff both parts have identical
 * translation AND identical rotation. The 6 scalar residuals are the
 * three translation differences plus the three rotation differences.
 */
export function lockResidual(poseA, poseB) {
  const tA = poseA.translation, tB = poseB.translation;
  const rA = poseA.rotation,    rB = poseB.rotation;
  const dt = [tA[0] - tB[0], tA[1] - tB[1], tA[2] - tB[2]];
  const dr = [rA[0] - rB[0], rA[1] - rB[1], rA[2] - rB[2]];
  return Math.hypot(
    dt[0], dt[1], dt[2],
    dr[0], dr[1], dr[2],
  );
}

/**
 * Width mate residual (Tier-7b) — a TAB anchor on partB is equidistant
 * between two reference anchors `pRefA1Pt` and `pRefA2Pt` on partA (world
 * space). Centred ⇔ `dist(tab, refA1) == dist(tab, refA2)`. Returns the
 * absolute distance differential (scalar; 0 = centred). Removes 1
 * translational DOF along the gap normal.
 */
export function widthResidual(pTabWorld, pRefA1World, pRefA2World) {
  const d1 = _len(_sub(pTabWorld, pRefA1World));
  const d2 = _len(_sub(pTabWorld, pRefA2World));
  return Math.abs(d1 - d2);
}

/**
 * Path mate residual (Tier-7b) — point `pBWorld` on partB lies on a path
 * curve sampled densely as a world-space polyline `pathPoints`. Returns
 * the perpendicular distance from the point to its nearest segment of the
 * polyline. Generalises to spline / circle / polyline because the caller
 * supplies the sampled points. Removes 2 translational DOF (the two
 * components of position perpendicular to the local tangent).
 *
 * pathPoints: Array of [x,y,z]. Closed loops repeat the first point at
 * the end. At least 2 distinct points required.
 */
export function pathResidual(pBWorld, pathPoints) {
  if (!Array.isArray(pathPoints) || pathPoints.length < 2) return _len(pBWorld);
  let best = Infinity;
  for (let i = 0; i < pathPoints.length - 1; i++) {
    const a = pathPoints[i], b = pathPoints[i + 1];
    const ab = _sub(b, a);
    const abLen2 = _dot(ab, ab);
    if (abLen2 < 1e-18) continue;
    const t = Math.max(0, Math.min(1, _dot(_sub(pBWorld, a), ab) / abLen2));
    const closest = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const d = _len(_sub(pBWorld, closest));
    if (d < best) best = d;
  }
  return best === Infinity ? 0 : best;
}

/**
 * Path mate — also returns the nearest-point + along-curve tangent so the
 * solver can both pull the point onto the curve AND know which direction
 * is the kept (free-slide) DOF. Used by MateSolver._satisfyPath.
 */
export function pathNearest(pBWorld, pathPoints) {
  if (!Array.isArray(pathPoints) || pathPoints.length < 2) {
    return { point: pBWorld.slice(), tangent: [1, 0, 0], distance: 0 };
  }
  let bestD = Infinity, bestPt = null, bestTan = [1, 0, 0];
  for (let i = 0; i < pathPoints.length - 1; i++) {
    const a = pathPoints[i], b = pathPoints[i + 1];
    const ab = _sub(b, a);
    const abLen2 = _dot(ab, ab);
    if (abLen2 < 1e-18) continue;
    const t = Math.max(0, Math.min(1, _dot(_sub(pBWorld, a), ab) / abLen2));
    const closest = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const d = _len(_sub(pBWorld, closest));
    if (d < bestD) {
      bestD = d;
      bestPt = closest;
      bestTan = _normalize(ab);
    }
  }
  return { point: bestPt ?? pBWorld.slice(), tangent: bestTan, distance: bestD };
}

/**
 * Distance-Limit mate residual (Tier-7b) — the distance between two
 * anchors is held within `[minDist, maxDist]`. Returns 0 inside the
 * range (slack); returns the signed clamp delta outside the range (free
 * = move closer if too far; further if too close). Removes 0 DOF in the
 * slack region; removes 1 DOF when clamped to either limit.
 *
 *   d < minDist  →  (d − minDist)   < 0  (need to grow)
 *   d > maxDist  →  (d − maxDist)   > 0  (need to shrink)
 *   else         →  0                    (slack)
 */
export function distanceLimitResidual(pAWorld, pBWorld, minDist, maxDist) {
  const d = _len(_sub(pBWorld, pAWorld));
  if (d < minDist) return Math.abs(d - minDist);
  if (d > maxDist) return Math.abs(d - maxDist);
  return 0;
}

/**
 * Distance-Limit — signed delta + clamp target for use by the solver.
 * Returns { clamped, target, delta }. `clamped === false` means in-range
 * (no correction); when clamped, `target` is the boundary distance
 * (min or max) the solver pulls toward.
 */
export function distanceLimitClamp(pAWorld, pBWorld, minDist, maxDist) {
  const d = _len(_sub(pBWorld, pAWorld));
  if (d < minDist) return { clamped: true, target: minDist, delta: d - minDist, current: d };
  if (d > maxDist) return { clamped: true, target: maxDist, delta: d - maxDist, current: d };
  return { clamped: false, target: d, delta: 0, current: d };
}

/**
 * Gear mate residual (Tier-7c) — two rotational coordinates θA, θB about
 * their own axes are coupled by a fixed ratio so that
 *   `θA · gearRatio − θB ≡ phase    (mod 2π)`.
 * The residual is the signed phase deviation, wrapped into (−π, π]; 0 = in
 * sync. `gearRatio = ωB / ωA` (e.g. a 2:1 reduction has gearRatio = 0.5;
 * to express the SW convention "N_A : N_B" pass gearRatio = N_A / N_B —
 * the larger gear turns slower). Removes 1 rotational DOF (the along-axis
 * angle of B is no longer independent of the along-axis angle of A).
 *
 * The caller is responsible for resolving θA, θB from the parts' current
 * orientations + their respective axes (e.g. project the parts' Euler
 * vectors onto the axis directions). The kernel `_satisfyGear` does this.
 */
export function gearResidual(thetaA, thetaB, gearRatio, phase = 0) {
  let d = thetaA * gearRatio - thetaB - phase;
  const TAU = Math.PI * 2;
  // Wrap into (−π, π].
  d = ((d % TAU) + TAU) % TAU;
  if (d > Math.PI) d -= TAU;
  return Math.abs(d);
}

/**
 * Gear mate — signed phase delta + correction the kernel solver applies
 * to part B's along-axis rotation. Returns `{ delta, correction }` where
 *   delta      = signed wrapped (thetaA · ratio − thetaB − phase)
 *   correction = the signed angle to ADD to thetaB (so newThetaB = thetaB +
 *                correction satisfies the coupling at this iteration).
 */
export function gearCorrection(thetaA, thetaB, gearRatio, phase = 0) {
  let d = thetaA * gearRatio - thetaB - phase;
  const TAU = Math.PI * 2;
  d = ((d % TAU) + TAU) % TAU;
  if (d > Math.PI) d -= TAU;
  return { delta: d, correction: d };
}

/**
 * Hinge mate residual (Tier-7c) — a hinge between partA and partB
 * geometrically equals a Concentric (2 trans + 2 rot DOF removed) +
 * Coincident-along-axis (1 trans DOF removed) = 5 DOF removed; the
 * remaining 1 rotational DOF is the hinge angle about the shared axis.
 * Optional `[angleMin, angleMax]` clamp the hinge angle.
 *
 * Inputs (world-space, the caller resolves local → world):
 *   pAnchorAWorld, pAnchorBWorld : anchor points on each part (the pivot)
 *   axisAWorld, axisBWorld       : hinge axis direction on each part
 *   hingeAngle                   : current relative rotation about the axis (rad)
 *   angleMin, angleMax           : optional limits (rad); omit for free spin
 *
 * Returns a scalar = positional anchor mismatch + axis non-alignment + (if
 * the angle is outside [min, max]) the clamp deviation. Zero ⇔ satisfied.
 */
export function hingeResidual(
  pAnchorAWorld, pAnchorBWorld, axisAWorld, axisBWorld,
  hingeAngle = 0, angleMin = -Infinity, angleMax = +Infinity,
) {
  // 1. Anchor mismatch — the two pivots must coincide in world space.
  const dPos = _sub(pAnchorAWorld, pAnchorBWorld);
  const eAnchor = _len(dPos);
  // 2. Axis non-alignment — |dA × dB| ∈ [0, 1] for unit vectors.
  const dA = _normalize(axisAWorld);
  const dB = _normalize(axisBWorld);
  const eAxis = _len(_cross(dA, dB));
  // 3. Angle limit deviation (if outside the interval).
  let eClamp = 0;
  if (Number.isFinite(angleMin) && hingeAngle < angleMin) eClamp = angleMin - hingeAngle;
  else if (Number.isFinite(angleMax) && hingeAngle > angleMax) eClamp = hingeAngle - angleMax;
  return eAnchor + eAxis + eClamp;
}

/**
 * Hinge — split residual + clamp signal for the kernel solver. Returns
 *   { anchorErr, axisErr, clamp:{active, limit, target, delta} }
 * so the kernel `_satisfyHinge` can apply the right correction per
 * component (translate to anchor / rotate to axis / clamp to angle).
 */
export function hingeBreakdown(
  pAnchorAWorld, pAnchorBWorld, axisAWorld, axisBWorld,
  hingeAngle = 0, angleMin = -Infinity, angleMax = +Infinity,
) {
  const dPos = _sub(pAnchorAWorld, pAnchorBWorld);
  const anchorErr = _len(dPos);
  const dA = _normalize(axisAWorld);
  const dB = _normalize(axisBWorld);
  const axisErr = _len(_cross(dA, dB));
  let clamp = { active: false, limit: null, target: hingeAngle, delta: 0 };
  if (Number.isFinite(angleMin) && hingeAngle < angleMin) {
    clamp = { active: true, limit: 'min', target: angleMin, delta: angleMin - hingeAngle };
  } else if (Number.isFinite(angleMax) && hingeAngle > angleMax) {
    clamp = { active: true, limit: 'max', target: angleMax, delta: hingeAngle - angleMax };
  }
  return { anchorErr, axisErr, clamp };
}

/**
 * Bundle: compute residuals for every Tier-7a / Tier-7b / Tier-7c mate
 * kind in one call. Used by AssemblyMate/MateSolver consistency checks +
 * e2e.
 *
 * Each input is `{ kind: ..., ... }` with the mate-kind-specific
 * world-space inputs already resolved.
 */
export function assemblyMateResiduals(mates) {
  return mates.map((m) => {
    switch (m.kind) {
      case 'parallel':      return { kind: m.kind, r: parallelResidual(m.dAWorld, m.dBWorld) };
      case 'perpendicular': return { kind: m.kind, r: perpendicularResidual(m.dAWorld, m.dBWorld) };
      case 'tangent':       return { kind: m.kind, r: tangentResidual(m.pBWorld, m.axisOriginWorld, m.axisDirWorld, m.radius) };
      case 'lock':          return { kind: m.kind, r: lockResidual(m.poseA, m.poseB) };
      case 'width':         return { kind: m.kind, r: widthResidual(m.pTabWorld, m.pRefA1World, m.pRefA2World) };
      case 'path':          return { kind: m.kind, r: pathResidual(m.pBWorld, m.pathPoints) };
      case 'distanceLimit': return { kind: m.kind, r: distanceLimitResidual(m.pAWorld, m.pBWorld, m.minDist, m.maxDist) };
      case 'gear':          return { kind: m.kind, r: gearResidual(m.thetaA, m.thetaB, m.gearRatio, m.phase ?? 0) };
      case 'hinge':         return { kind: m.kind, r: hingeResidual(m.pAnchorAWorld, m.pAnchorBWorld, m.axisAWorld, m.axisBWorld, m.hingeAngle ?? 0, m.angleMin ?? -Infinity, m.angleMax ?? Infinity) };
      default:              throw new Error(`assemblyMateResiduals: unknown kind '${m.kind}'`);
    }
  });
}

/** Sum of DOFs removed by a list of Tier-7a mate kinds. */
export function totalAssemblyMateDOF(mateKinds) {
  let sum = 0;
  for (const k of mateKinds) sum += ASSEMBLY_MATE_DOF[k] ?? 0;
  return sum;
}

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
