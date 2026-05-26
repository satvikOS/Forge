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

  // ── Tier-7b advanced mates ───────────────────────────────────────
  /**
   * Width mate — centre a TAB anchor on partB equidistantly between two
   * reference anchors (`refA1`, `refA2`) on partA. Removes 1 translational
   * DOF along the gap normal (the line through refA1↔refA2). Anchors are
   * `{ type: 'point', xyz: [x,y,z] }` in their respective local frames.
   */
  width(partA, refA1, refA2, partB, tabB) {
    this.mates.push({ kind: 'width', partA, refA1, refA2, partB, tabB });
    return this;
  }

  /**
   * Path mate — constrain a point on partB to lie on a polyline-sampled
   * path expressed in partA's local frame. `pathLocalA` is an array of
   * `[x,y,z]` samples; a closed curve repeats the first sample at end.
   * Removes 2 translational DOF (the two normal components to the
   * tangent); the remaining 1 along-path DOF is free.
   */
  path(partA, pathLocalA, partB, anchorB) {
    this.mates.push({ kind: 'path', partA, pathLocalA, partB, anchorB });
    return this;
  }

  /**
   * Distance-Limit mate — the distance between two anchors must stay in
   * `[minDist, maxDist]`. Slack within the range (0 DOF removed); clamps
   * at either boundary (1 DOF removed at the clamped limit).
   */
  distanceLimit(partA, anchorA, partB, anchorB, minDist, maxDist) {
    this.mates.push({ kind: 'distanceLimit', partA, anchorA, partB, anchorB, minDist, maxDist });
    return this;
  }

  // ── Tier-7c mechanical mates ─────────────────────────────────────
  /**
   * Gear mate — couples the rotational coordinate of partA about `axisA`
   * to the rotational coordinate of partB about `axisB` by a fixed ratio
   * `gearRatio = ωB / ωA` (equivalently `θA · gearRatio − θB ≡ phase`).
   * Removes 1 rotational DOF. The two parts remain free to translate;
   * only the along-axis rotational coordinate is coupled.
   *
   * NOTE: the foundation LM solver expresses the gear residual as a
   * scalar coupling of the parts' Euler rotation projections onto the
   * axes (a first-order approximation valid when both axes are world-
   * aligned; the kernel `_satisfyGear` handles arbitrary axes
   * iteratively). For arbitrary-axis gears, prefer the kernel solver.
   */
  gear(partA, axisA, partB, axisB, gearRatio, phase = 0) {
    this.mates.push({ kind: 'gear', partA, axisA, partB, axisB, gearRatio, phase });
    return this;
  }

  /**
   * Hinge mate — single rotational DOF along the shared axis. Equivalent
   * to concentric (2 trans + 2 rot DOF removed) + coincident-along-axis
   * (1 trans DOF removed) = 5 DOF removed. The remaining 1 rotational
   * DOF is the hinge angle about the shared axis. Optional `[angleMin,
   * angleMax]` clamp that remaining DOF.
   *
   *   axisA, axisB : `{ origin:[x,y,z], dir:[x,y,z] }` in each local frame.
   *                  The pivots (axis origins) coincide; the axes align.
   *   angleMin, angleMax : optional limits in radians (omit for free spin).
   */
  hinge(partA, axisA, partB, axisB, angleMin = -Infinity, angleMax = +Infinity) {
    this.mates.push({ kind: 'hinge', partA, axisA, partB, axisB, angleMin, angleMax });
    return this;
  }

  /**
   * Screw mate (Tier-7c-rest) — couples a rotation of partA about its axis
   * to a translation of partB along the same axis by `pitch` (m per
   * revolution; positive = right-hand thread, negative = left-hand):
   *   `theta_A · pitch / (2π) − t_B  →  0`
   * Removes 1 DOF. Real leadscrew / CNC linear-stage kinematics.
   *
   *   axisA : `{ origin:[x,y,z], dir:[x,y,z] }` (partA's rotation axis)
   *   axisB : `{ origin:[x,y,z], dir:[x,y,z] }` (partB's translation axis;
   *           must be parallel to axisA in world space — coincident screw
   *           thread + carriage)
   *   pitch : metres per revolution (signed for handedness)
   *
   * The LM-solver residual reads off θ_A via Euler-projection on the world
   * axis direction (exact for axis-aligned shafts; the kernel iterative
   * solver handles arbitrary axes via the same projection — first-order
   * approximation, see Tier-7c notes for the quaternion follow-on).
   */
  screw(partA, axisA, partB, axisB, pitch) {
    this.mates.push({ kind: 'screw', partA, axisA, partB, axisB, pitch });
    return this;
  }

  /**
   * Rack-and-Pinion mate (Tier-7c-rest) — couples a rotation of pinion
   * (partA) about its axis to a translation of rack (partB) along the
   * tangent line by `pinionRadius` (m; positive = standard, negative =
   * rack-on-opposite-side reverse):
   *   `theta_A · pinionRadius − t_B  →  0`
   * Removes 1 DOF. Real rolling-without-slipping rack-and-pinion kinematics.
   *
   *   axisA        : `{ origin:[x,y,z], dir:[x,y,z] }` (pinion rotation axis)
   *   axisB        : `{ origin:[x,y,z], dir:[x,y,z] }` (rack tangent translation axis;
   *                  must be perpendicular to axisA in world space)
   *   pinionRadius : m (signed)
   */
  rackPinion(partA, axisA, partB, axisB, pinionRadius) {
    this.mates.push({ kind: 'rackPinion', partA, axisA, partB, axisB, pinionRadius });
    return this;
  }

  // ── Tier-7c-final mechanical mates ─────────────────────────────────
  /**
   * Cam mate (Tier-7c-final) — point-on-cam-surface contact. The follower's
   * contact point (`followerPt`, partB-local) rides on the cam profile
   * (`camProfileLocalA`, partA-local — an array of `[x,y,z]` samples forming
   * a closed polyline of the perimeter curve in the cam's rotating frame).
   * As the cam rotates, every sample on the profile spins with it; the
   * follower's contact point translates radially to stay tangent.
   *
   * Residual = perpendicular distance from world-space follower point to its
   * nearest segment of the cam-profile polyline (the polyline samples are
   * transformed by partA's current pose, so the profile spins with the cam).
   * Removes 1 DOF.
   *
   *   axisA           : `{ origin:[x,y,z], dir:[x,y,z] }` (cam rotation axis on partA)
   *   camProfileLocalA: `Array<[x,y,z]>` (cam profile samples in partA-local)
   *   followerAxisB   : `{ origin:[x,y,z], dir:[x,y,z] }` (follower translation axis on partB)
   *   followerPtB     : `[x,y,z]` (contact point on the follower, partB-local)
   */
  cam(partA, axisA, camProfileLocalA, partB, followerAxisB, followerPtB) {
    this.mates.push({
      kind: 'cam', partA, axisA, camProfileLocalA,
      partB, followerAxisB, followerPtB,
    });
    return this;
  }

  /**
   * Universal-Joint mate (Tier-7c-final) — velocity coupling between two
   * non-collinear shafts through a cross-pin at angle `crossAngle`
   * (rad; the misalignment angle between input and output shafts —
   * 0 for in-line, π/2 = 90° for the Cardan singularity). For a static
   * residual:  `cos(crossAngle) · θ_A − θ_B  →  0`.
   *
   * Real Cardan-joint kinematics: rotational velocity is transferred with a
   * `cos(crossAngle)` average modulation (instantaneous is `1/cos` modulated
   * but the average and the static phase relationship is the linear cos
   * coupling). Two shafts in line (crossAngle = 0) ≡ 1:1 rigid coupling;
   * two at 90° ≡ geometric singularity (cos = 0, decouples).
   *
   * Removes 2 DOF — couples 2 of 3 rotational axes (the alignment-up-to-
   * crossAngle direction relation between the two shaft axes plus the
   * along-axis spin coupling). 1 rotational DOF (the cos-modulated spin
   * transmission) remains free, plus the 3 translational DOF unless the
   * caller adds a concentric / hinge to anchor the pivots.
   *
   *   axisA      : `{ origin:[x,y,z], dir:[x,y,z] }` (input-shaft axis on partA)
   *   axisB      : `{ origin:[x,y,z], dir:[x,y,z] }` (output-shaft axis on partB)
   *   crossAngle : rad (default π/2). Misalignment between the two shafts.
   */
  universalJoint(partA, axisA, partB, axisB, crossAngle = Math.PI / 2) {
    this.mates.push({ kind: 'universalJoint', partA, axisA, partB, axisB, crossAngle });
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
        case 'width': {
          // Tier-7b: tab anchor on partB centred between refA1/refA2 on
          // partA. Scalar residual = d1 − d2 (signed, so the Jacobian
          // has gradient in both directions).
          const r1 = transformPoint(m.partA, m.refA1.xyz);
          const r2 = transformPoint(m.partA, m.refA2.xyz);
          const tb = transformPoint(m.partB, m.tabB.xyz);
          const d1 = vLen(vSub(tb, r1));
          const d2 = vLen(vSub(tb, r2));
          r.push(d1 - d2);
          break;
        }
        case 'path': {
          // Tier-7b: anchor on partB lies on path (sampled polyline) in
          // partA's local frame. Three scalar residuals = anchor world −
          // nearest-point-on-path world (vector difference; norm = 0 when
          // on path). 2 of the 3 are independent because the third is
          // along the tangent; LM solver handles redundancy via damping.
          const aB = transformPoint(m.partB, m.anchorB.xyz);
          // Transform each path sample by partA, find nearest segment.
          let bestD = Infinity, bestPt = null;
          for (let k = 0; k < m.pathLocalA.length - 1; k++) {
            const p0 = transformPoint(m.partA, m.pathLocalA[k]);
            const p1 = transformPoint(m.partA, m.pathLocalA[k + 1]);
            const ab = vSub(p1, p0);
            const abLen2 = vDot(ab, ab);
            if (abLen2 < 1e-18) continue;
            const t = Math.max(0, Math.min(1, vDot(vSub(aB, p0), ab) / abLen2));
            const closest = [p0[0] + ab[0] * t, p0[1] + ab[1] * t, p0[2] + ab[2] * t];
            const d = vLen(vSub(aB, closest));
            if (d < bestD) { bestD = d; bestPt = closest; }
          }
          if (bestPt) {
            r.push(aB[0] - bestPt[0], aB[1] - bestPt[1], aB[2] - bestPt[2]);
          } else {
            r.push(0, 0, 0);
          }
          break;
        }
        case 'distanceLimit': {
          // Tier-7b: distance in [min, max]. Outside → signed clamp delta;
          // inside → 0. The LM solver sees a one-sided residual.
          const a = transformPoint(m.partA, m.anchorA.xyz);
          const b = transformPoint(m.partB, m.anchorB.xyz);
          const d = vLen(vSub(a, b));
          if (d < m.minDist)      r.push(d - m.minDist);
          else if (d > m.maxDist) r.push(d - m.maxDist);
          else                    r.push(0);
          break;
        }
        case 'gear': {
          // Tier-7c: gear coupling thetaA*ratio − thetaB ≡ phase (mod 2π).
          // The "rotational coordinate about the axis" is approximated by
          // the projection of the part's Euler rotation vector onto the
          // (world-space) axis direction. For axis-aligned gears (Z-axis
          // gears, world-aligned shafts) this is exact; for arbitrary axes
          // the kernel iterative solver handles the geometry — for LM here
          // it's a useful scalar residual that drops the rotational rank
          // by 1 in the Jacobian.
          const dA = vNorm(transformDir(m.partA, m.axisA.dir));
          const dB = vNorm(transformDir(m.partB, m.axisB.dir));
          const rotA = m.partA.transform.rotation.map(v => v * D2R);
          const rotB = m.partB.transform.rotation.map(v => v * D2R);
          const thetaA = vDot(rotA, dA);
          const thetaB = vDot(rotB, dB);
          // Wrap (thetaA*ratio − thetaB − phase) into (−π, π].
          let d = thetaA * m.gearRatio - thetaB - (m.phase ?? 0);
          const TAU = Math.PI * 2;
          d = ((d % TAU) + TAU) % TAU;
          if (d > Math.PI) d -= TAU;
          r.push(d);
          break;
        }
        case 'hinge': {
          // Tier-7c: equivalent to concentric (4 DOF) + coincident-on-axis
          // (1 trans DOF) = 5 DOF removed. We emit the residuals already
          // used by concentric (3 parallel + 3 collinear) so the LM solver
          // gets a well-posed Jacobian. The remaining 1 rotational DOF
          // about the axis is the hinge angle.
          //
          // Optional angle limits add a one-sided clamp residual.
          const oA = transformPoint(m.partA, m.axisA.origin);
          const dA = vNorm(transformDir(m.partA, m.axisA.dir));
          const oB = transformPoint(m.partB, m.axisB.origin);
          const dB = vNorm(transformDir(m.partB, m.axisB.dir));
          // Parallel axes (3 residuals; |cross| = 0 when parallel).
          const cross = vCross(dA, dB);
          r.push(cross[0], cross[1], cross[2]);
          // Anchor coincidence — the two pivots must coincide.
          r.push(oA[0] - oB[0], oA[1] - oB[1], oA[2] - oB[2]);
          // Optional angle clamp. The hinge angle is the rotation of B
          // about dA relative to A. We approximate it via the diff of the
          // axis-projected Euler rotation vectors (same approximation as
          // gear). Outside [min, max] → one-sided residual; inside → 0.
          if (Number.isFinite(m.angleMin) || Number.isFinite(m.angleMax)) {
            const rotA = m.partA.transform.rotation.map(v => v * D2R);
            const rotB = m.partB.transform.rotation.map(v => v * D2R);
            const ang = vDot(rotB, dA) - vDot(rotA, dA);
            if (Number.isFinite(m.angleMin) && ang < m.angleMin) {
              r.push(ang - m.angleMin);
            } else if (Number.isFinite(m.angleMax) && ang > m.angleMax) {
              r.push(ang - m.angleMax);
            } else {
              r.push(0);
            }
          }
          break;
        }
        case 'screw': {
          // Tier-7c-rest: θ_A · pitch / (2π) − t_B = 0.
          // θ_A: projection of partA's Euler rotation (rad, after D2R) onto
          //      world-space partA axis direction.
          // t_B: projection of partB position relative to axis origin (on A,
          //      in world space) onto partB's world-space axis direction.
          const dA = vNorm(transformDir(m.partA, m.axisA.dir));
          const dB = vNorm(transformDir(m.partB, m.axisB.dir));
          const oA = transformPoint(m.partA, m.axisA.origin);
          const rotA = m.partA.transform.rotation.map(v => v * D2R);
          const thetaA = vDot(rotA, dA);
          const rel = vSub(m.partB.transform.translation, oA);
          const tB = vDot(rel, dB);
          const target = thetaA * (m.pitch ?? 0) / (Math.PI * 2);
          r.push(target - tB);
          break;
        }
        case 'rackPinion': {
          // Tier-7c-rest: θ_A · pinionRadius − t_B = 0.
          // Same projection trick as `screw` but coupling is linear in θ
          // rather than divided by 2π. The pinion (A) rotates, the rack (B)
          // translates along its world-space tangent axis.
          const dA = vNorm(transformDir(m.partA, m.axisA.dir));
          const dB = vNorm(transformDir(m.partB, m.axisB.dir));
          const oA = transformPoint(m.partA, m.axisA.origin);
          const rotA = m.partA.transform.rotation.map(v => v * D2R);
          const thetaA = vDot(rotA, dA);
          const rel = vSub(m.partB.transform.translation, oA);
          const tB = vDot(rel, dB);
          const target = thetaA * (m.pinionRadius ?? 0);
          r.push(target - tB);
          break;
        }
        case 'cam': {
          // Tier-7c-final: point-on-cam-surface contact. Transform each cam
          // profile sample by partA's pose so the polyline spins with the
          // cam; transform the follower's contact point by partB; emit the
          // signed (follower − nearest-sample-on-profile) 3-vector. The LM
          // solver sees a 3-component residual that drives the follower
          // radially to stay on the profile.
          const followerWorld = transformPoint(m.partB, m.followerPtB);
          let bestD = Infinity, bestPt = null;
          for (let k = 0; k < m.camProfileLocalA.length - 1; k++) {
            const p0 = transformPoint(m.partA, m.camProfileLocalA[k]);
            const p1 = transformPoint(m.partA, m.camProfileLocalA[k + 1]);
            const ab = vSub(p1, p0);
            const abLen2 = vDot(ab, ab);
            if (abLen2 < 1e-18) continue;
            const t = Math.max(0, Math.min(1, vDot(vSub(followerWorld, p0), ab) / abLen2));
            const closest = [p0[0] + ab[0] * t, p0[1] + ab[1] * t, p0[2] + ab[2] * t];
            const d = vLen(vSub(followerWorld, closest));
            if (d < bestD) { bestD = d; bestPt = closest; }
          }
          if (bestPt) {
            r.push(followerWorld[0] - bestPt[0], followerWorld[1] - bestPt[1], followerWorld[2] - bestPt[2]);
          } else {
            r.push(0, 0, 0);
          }
          break;
        }
        case 'universalJoint': {
          // Tier-7c-final: cos(crossAngle)·θA − θB → 0 plus axis-alignment-
          // up-to-crossAngle constraint. We emit 2 scalar residuals:
          //   (1) the linearised velocity-coupling phase residual on the
          //       parts' Euler rotations projected onto their world axes
          //       (same projection trick as gear/screw).
          //   (2) the angle-between-axes deviation from `crossAngle`
          //       (so the two shafts maintain their misalignment angle —
          //       removes the second DOF). The LM solver damps these so the
          //       coupling stabilises without over-constraining.
          const dA = vNorm(transformDir(m.partA, m.axisA.dir));
          const dB = vNorm(transformDir(m.partB, m.axisB.dir));
          const rotA = m.partA.transform.rotation.map(v => v * D2R);
          const rotB = m.partB.transform.rotation.map(v => v * D2R);
          const thetaA = vDot(rotA, dA);
          const thetaB = vDot(rotB, dB);
          const c = Math.cos(m.crossAngle ?? Math.PI / 2);
          let dPhase = c * thetaA - thetaB;
          const TAU = Math.PI * 2;
          dPhase = ((dPhase % TAU) + TAU) % TAU;
          if (dPhase > Math.PI) dPhase -= TAU;
          r.push(dPhase);
          // Axis-misalignment angle relative to target.
          const cosCurrent = Math.max(-1, Math.min(1, vDot(dA, dB)));
          const angleCurrent = Math.acos(cosCurrent);
          r.push(angleCurrent - (m.crossAngle ?? Math.PI / 2));
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
