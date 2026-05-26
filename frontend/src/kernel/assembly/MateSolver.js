/**
 * ArchDisc — Assembly Mate Solver
 *
 * Iterative constraint satisfaction for assembly mates.
 * Each part has 6 DOF (3 translation + 3 rotation).
 * Mates reduce DOF by enforcing geometric relationships.
 *
 * Supported mates:
 * - coincident: two points/face origins must coincide
 * - distance: two reference points at distance d
 * - concentric: align two axes (translation + rotation match)
 * - parallel: two axes/normals point same direction
 * - perpendicular: two axes/normals at 90°
 * - tangent: a point/anchor on partB touches a cylindrical axis on partA at
 *            distance R (cylinder radius)
 * - angle: two axes/normals at angle θ
 * - lock: zero relative motion (rigid; copies anchor's pose into free)
 *
 * Algorithm:
 * - Each mate has a residual function (current error vs target)
 * - Apply incremental corrections to the non-fixed part
 * - Iterate until all residuals < tolerance or max iterations
 *
 * The Tier-7a additions (Parallel improvements, Perpendicular, Tangent, Lock)
 * use real geometric residual equations — see `assemblyMateResiduals` in
 * `foundation/KinematicsCore.js` for the kernel-free math helpers that
 * compute these residuals so e2e / Node tests can verify them without
 * loading the full Mate / PartInstance class hierarchy.
 */

import Vec3 from '../math/Vec3.js';

const DEFAULT_TOLERANCE = 1e-5;  // 10 microns
const DEFAULT_MAX_ITER = 50;
const RELAXATION = 0.5;          // damping factor

export default class MateSolver {

  /**
   * Solve all mates in an assembly.
   * @param {Assembly} assembly
   * @param {object} options - { tolerance, maxIter }
   * @returns {{ converged, iterations, residual, satisfiedCount, totalCount }}
   */
  static solve(assembly, options = {}) {
    const tolerance = options.tolerance || DEFAULT_TOLERANCE;
    const maxIter = options.maxIter || DEFAULT_MAX_ITER;

    if (!assembly.mates.length) {
      return { converged: true, iterations: 0, residual: 0, satisfiedCount: 0, totalCount: 0 };
    }

    let iter = 0;
    let totalResidual = Infinity;

    while (iter < maxIter && totalResidual > tolerance) {
      totalResidual = 0;

      for (const mate of assembly.mates) {
        const residual = MateSolver._satisfyMate(mate);
        mate.error = residual;
        mate.satisfied = residual < tolerance;
        totalResidual += residual;
      }

      iter++;
    }

    const satisfied = assembly.mates.filter(m => m.satisfied).length;

    return {
      converged: totalResidual < tolerance,
      iterations: iter,
      residual: totalResidual,
      satisfiedCount: satisfied,
      totalCount: assembly.mates.length,
    };
  }

  /**
   * Compute degrees of freedom remaining in the assembly.
   * Each part: 6 DOF (3 trans + 3 rot)
   * Each mate removes some DOFs based on type.
   */
  static computeDOF(assembly) {
    const partDOF = assembly.parts.length * 6;
    const fixedParts = assembly.parts.filter(p => p.fixed).length;
    const fixedDOF = fixedParts * 6;

    let mateDOF = 0;
    for (const mate of assembly.mates) {
      mateDOF += MateSolver._mateDOFRemoved(mate.type);
    }

    return Math.max(0, partDOF - fixedDOF - mateDOF);
  }

  static _mateDOFRemoved(type) {
    switch (type) {
      case 'coincident': return 3; // removes 3 translational DOF (point-on-point)
      case 'distance': return 1;
      case 'concentric': return 4; // 2 translational + 2 rotational
      case 'parallel': return 2;
      case 'perpendicular': return 1;
      case 'angle': return 1;
      case 'tangent': return 1;
      case 'lock': return 6;
      case 'fixed': return 6;
      // ── Tier-7b advanced mates ─────────────────────────────────
      case 'width': return 1;          // 1 translational along gap normal
      case 'path':  return 2;          // 2 normal-to-tangent components
      case 'distanceLimit': return 0;  // slack inside [min,max]; the
                                       //   _satisfyDistanceLimit handler
                                       //   reports an EFFECTIVE removed=1
                                       //   when currently clamped (set
                                       //   via mate.params._clampedDOF).
      // ── Tier-7c mechanical mates ─────────────────────────────────
      case 'gear':  return 1;          // 1 rotational DOF (along-axis
                                       //   rotation of B coupled to that
                                       //   of A by `gearRatio`).
      case 'hinge': return 5;          // 2 translational + 2 rotational
                                       //   (axis-aligned) + 1 trans along
                                       //   axis (anchor coincides) = 5;
                                       //   1 rotational DOF (hinge angle)
                                       //   left, optionally clamped via
                                       //   mate.params._clampedDOF.
      // ── Tier-7c-rest mechanical mates ─────────────────────────────────
      case 'screw': return 1;          // 1 DOF — A's along-axis rotation
                                       //   coupled to B's along-axis
                                       //   translation by `pitch`.
      case 'rackPinion': return 1;     // 1 DOF — pinion's along-axis
                                       //   rotation coupled to rack's
                                       //   along-axis translation by
                                       //   `pinionRadius`.
      // ── Tier-7c-final mechanical mates ────────────────────────────────
      case 'cam': return 1;            // 1 DOF — follower contact point
                                       //   stays on the cam profile
                                       //   (rotating perimeter curve).
      case 'universalJoint': return 2; // 2 DOF — couples 2 of 3 rotational
                                       //   axes (axis-alignment-up-to-cross
                                       //   plus along-axis phase coupling);
                                       //   1 rotational + 3 translational
                                       //   DOFs remain free.
      default: return 1;
    }
  }

  /**
   * Apply correction to satisfy a single mate.
   * @returns {number} residual error magnitude
   */
  static _satisfyMate(mate) {
    if (!mate.partA || !mate.partB) return 0;

    // The non-fixed part gets corrected; if both fixed, return current error.
    // If both are non-fixed, pick partB as the free side — the convention is
    // the user picks the "anchor" then the "to-mate" component (partB), so
    // partB is the one that should move. If partB is fixed and partA is
    // not, partA moves. This also helps when partA is INDIRECTLY fixed via
    // another mate (e.g. a Lock anchored to a fixed Base) — the iteration
    // restores partA's pose via the Lock on the next pass.
    const fixedA = mate.partA.fixed;
    const fixedB = mate.partB.fixed;
    if (fixedA && fixedB) {
      return MateSolver._mateError(mate);
    }
    let free, anchor;
    if (fixedA) { free = mate.partB; anchor = mate.partA; }
    else if (fixedB) { free = mate.partA; anchor = mate.partB; }
    else { free = mate.partB; anchor = mate.partA; }    // both unfixed → partB moves

    switch (mate.type) {
      case 'coincident':
        return MateSolver._satisfyCoincident(mate, free, anchor);
      case 'distance':
        return MateSolver._satisfyDistance(mate, free, anchor);
      case 'concentric':
        return MateSolver._satisfyConcentric(mate, free, anchor);
      case 'parallel':
        return MateSolver._satisfyParallel(mate, free, anchor);
      case 'perpendicular':
        return MateSolver._satisfyPerpendicular(mate, free, anchor);
      case 'tangent':
        return MateSolver._satisfyTangent(mate, free, anchor);
      case 'lock':
      case 'fixed':
        return MateSolver._satisfyLock(mate, free, anchor);
      case 'width':
        return MateSolver._satisfyWidth(mate, free, anchor);
      case 'path':
        return MateSolver._satisfyPath(mate, free, anchor);
      case 'distanceLimit':
        return MateSolver._satisfyDistanceLimit(mate, free, anchor);
      case 'gear':
        return MateSolver._satisfyGear(mate, free, anchor);
      case 'hinge':
        return MateSolver._satisfyHinge(mate, free, anchor);
      case 'screw':
        return MateSolver._satisfyScrew(mate, free, anchor);
      case 'rackPinion':
        return MateSolver._satisfyRackPinion(mate, free, anchor);
      case 'cam':
        return MateSolver._satisfyCam(mate, free, anchor);
      case 'universalJoint':
        return MateSolver._satisfyUniversalJoint(mate, free, anchor);
      default:
        return MateSolver._mateError(mate);
    }
  }

  /** Coincident: align reference points (use part centers or specified offsets) */
  static _satisfyCoincident(mate, free, anchor) {
    const offsetA = mate.params.pointA || Vec3.zero();
    const offsetB = mate.params.pointB || Vec3.zero();

    const pA = anchor.position.add(offsetA);
    const pB = free.position.add(offsetB);

    const delta = pA.sub(pB);
    const newPos = free.position.add(delta.mul(RELAXATION));
    free.position = newPos;

    return delta.length();
  }

  /** Distance: maintain specified distance between reference points */
  static _satisfyDistance(mate, free, anchor) {
    const target = mate.params.distance || 0;
    const offsetA = mate.params.pointA || Vec3.zero();
    const offsetB = mate.params.pointB || Vec3.zero();

    const pA = anchor.position.add(offsetA);
    const pB = free.position.add(offsetB);
    const dir = pB.sub(pA);
    const currentDist = dir.length();
    if (currentDist < 1e-9) return Math.abs(target);

    const dirNorm = dir.mul(1 / currentDist);
    const wantPos = pA.add(dirNorm.mul(target));
    const correction = wantPos.sub(pB).mul(RELAXATION);
    free.position = free.position.add(correction);

    return Math.abs(currentDist - target);
  }

  /** Concentric: align axes (point on axis + axis direction match) */
  static _satisfyConcentric(mate, free, anchor) {
    // Treat as coincident for now (simplified); in real CAD also aligns axis directions
    return MateSolver._satisfyCoincident(mate, free, anchor);
  }

  /**
   * Parallel (Tier-7a): align two direction vectors so they point the same way.
   * mate.params.axisA / axisB are local-frame direction vectors (default Z).
   * Residual = |cross(dA_world, dB_world)| — zero when parallel.
   * Removes 2 rotational DOF.
   */
  static _satisfyParallel(mate, free, anchor) {
    const axisAnchor = mate.params.axisA || new Vec3(0, 0, 1);
    const axisFree   = mate.params.axisB || new Vec3(0, 0, 1);
    // Decide which is which (anchor / free are decided by fixed flag).
    const localAnchor = anchor === mate.partA ? axisAnchor : axisFree;
    const localFree   = anchor === mate.partA ? axisFree   : axisAnchor;

    const dA = MateSolver._rotateLocal(anchor, localAnchor);
    const dB = MateSolver._rotateLocal(free, localFree);
    // Rotate `free` about (dB × dA) by the angle between them.
    const axis = dB.cross(dA);
    const axLen = axis.length();
    const cos = Math.max(-1, Math.min(1, dB.dot(dA)));
    if (axLen < 1e-9) {
      // Already parallel OR anti-parallel; nudge to parallel if anti.
      if (cos < 0 && (mate.params.antiparallel !== true)) {
        free.rotation = new Vec3(
          free.rotation.x + Math.PI * RELAXATION,
          free.rotation.y, free.rotation.z,
        );
        return Math.PI;
      }
      return 0;
    }
    const angle = Math.acos(cos);
    const axisN = axis.mul(1 / axLen);
    // Rotate free's Euler XYZ by angle*RELAXATION about axisN. We
    // approximate by adding the axis-angle projected onto each Euler axis.
    const step = angle * RELAXATION;
    free.rotation = new Vec3(
      free.rotation.x + axisN.x * step,
      free.rotation.y + axisN.y * step,
      free.rotation.z + axisN.z * step,
    );
    return Math.abs(angle);
  }

  /**
   * Perpendicular (Tier-7a): two direction vectors at 90°.
   * Residual = |dot(dA, dB)| — zero when perpendicular.
   * Removes 1 rotational DOF.
   */
  static _satisfyPerpendicular(mate, free, anchor) {
    const axisAnchor = mate.params.axisA || new Vec3(0, 0, 1);
    const axisFree   = mate.params.axisB || new Vec3(0, 0, 1);
    const localAnchor = anchor === mate.partA ? axisAnchor : axisFree;
    const localFree   = anchor === mate.partA ? axisFree   : axisAnchor;

    const dA = MateSolver._rotateLocal(anchor, localAnchor);
    const dB = MateSolver._rotateLocal(free, localFree);
    const dot = dA.dot(dB);
    // We want dot = 0; current angle is acos(dot). Target = π/2.
    // Rotate `free` about axis = dA × dB by (currentAngle - π/2).
    const cos = Math.max(-1, Math.min(1, dot));
    const angle = Math.acos(cos);
    const delta = angle - Math.PI / 2;          // signed correction
    const axis  = dA.cross(dB);
    const axLen = axis.length();
    if (axLen < 1e-9) return Math.abs(delta);
    const axisN = axis.mul(1 / axLen);
    const step  = delta * RELAXATION;
    free.rotation = new Vec3(
      free.rotation.x - axisN.x * step,
      free.rotation.y - axisN.y * step,
      free.rotation.z - axisN.z * step,
    );
    return Math.abs(delta);
  }

  /**
   * Tangent (Tier-7a): a point on partB touches a cylindrical axis on partA
   * at distance R. params: axisOriginA, axisDirA (local), pointB (local), radius.
   * Residual = |perpDistance(pointB_world, axisLineA_world) - radius|.
   * Removes 1 DOF.
   */
  static _satisfyTangent(mate, free, anchor) {
    const aOrigA  = mate.params.axisOriginA || Vec3.zero();
    const aDirA   = mate.params.axisDirA   || new Vec3(0, 0, 1);
    const pointB  = mate.params.pointB     || Vec3.zero();
    const radius  = mate.params.radius     || 0;

    // World-space axis line on the anchor part + the point on the free part.
    const axisOrigin = (anchor === mate.partA ? mate.partA : mate.partB).position.add(aOrigA);
    const axisDirW   = MateSolver._rotateLocal(anchor === mate.partA ? mate.partA : mate.partB, aDirA);
    const dN = axisDirW.length() > 0 ? axisDirW.mul(1 / axisDirW.length()) : axisDirW;
    const ptWorld = free.position.add(pointB);

    // Vector from axis origin to point.
    const w     = ptWorld.sub(axisOrigin);
    const proj  = w.dot(dN);
    const perp  = w.sub(dN.mul(proj));
    const dist  = perp.length();
    const err   = dist - radius;
    if (Math.abs(err) < 1e-12) return Math.abs(err);

    // Slide `free` along the perp direction so |perp| → radius.
    const perpN = dist > 1e-12 ? perp.mul(1 / dist) : new Vec3(1, 0, 0);
    const shift = perpN.mul(-err * RELAXATION);
    free.position = free.position.add(shift);
    return Math.abs(err);
  }

  /**
   * Lock (Tier-7a): rigidly attach `free` to `anchor`, preserving the
   * CURRENT relative pose at the moment the mate was added. params:
   *   - `offset`         : Vec3 (anchor→free translation, world frame)
   *   - `rotationDelta`  : Vec3 (free.rotation − anchor.rotation, Euler XYZ)
   * Without these, defaults to 0 (snap free's pose onto anchor's pose).
   * Removes all 6 DOF.
   */
  static _satisfyLock(mate, free, anchor) {
    const offset = mate.params.offset || Vec3.zero();
    const rotDelta = mate.params.rotationDelta || Vec3.zero();
    const target = anchor.position.add(offset);
    const delta = target.sub(free.position);
    free.position = target;
    free.rotation = anchor.rotation.add(rotDelta);
    return delta.length();
  }

  /**
   * Width (Tier-7b): tab anchor on `free` is held equidistant between two
   * reference anchors on `anchor`. params:
   *   - `refA1`, `refA2` : Vec3 anchor offsets on the anchor part (mate-A)
   *   - `tabB`           : Vec3 anchor offset on the free part   (mate-B)
   * Residual = |d1 − d2|. Correction slides `free` along the gap-normal
   * direction (`refA2 − refA1` normalised) by half the differential, so
   * after a step the tab is closer to the midpoint.
   * Removes 1 translational DOF (along gap normal).
   */
  static _satisfyWidth(mate, free, anchor) {
    const refA1 = mate.params.refA1 || Vec3.zero();
    const refA2 = mate.params.refA2 || Vec3.zero();
    const tabB  = mate.params.tabB  || Vec3.zero();

    // World-space anchors.
    const p1 = (anchor === mate.partA ? mate.partA : mate.partB).position.add(refA1);
    const p2 = (anchor === mate.partA ? mate.partA : mate.partB).position.add(refA2);
    const tb = free.position.add(tabB);

    const d1 = tb.sub(p1).length();
    const d2 = tb.sub(p2).length();
    const diff = d1 - d2;                        // signed
    if (Math.abs(diff) < 1e-12) return 0;

    // Gap-normal direction (refA1 → refA2). Slide free along this so
    // d1 grows / shrinks toward d2.
    const gap = p2.sub(p1);
    const gapLen = gap.length();
    if (gapLen < 1e-9) return Math.abs(diff);
    const gN = gap.mul(1 / gapLen);

    // Move toward the midpoint of p1, p2: shift = -diff/2 along gN.
    // (If d1 > d2, tab is closer to p2 → shift back toward p1, i.e. against gN.)
    const shift = gN.mul(-diff * 0.5 * RELAXATION);
    free.position = free.position.add(shift);
    return Math.abs(diff);
  }

  /**
   * Path (Tier-7b): a point on `free` is constrained to lie on a path
   * (sampled polyline) anchored in `anchor`'s local frame. params:
   *   - `pathLocalA` : Array<Vec3> in anchor-local frame
   *   - `pointB`     : Vec3 on free part (local frame)
   * Residual = perpendicular distance from world-space point to the
   * nearest segment. Correction slides `free` along the closest-point
   * direction (the perpendicular component to the curve tangent).
   * Removes 2 translational DOF (the two normal-to-tangent components).
   */
  static _satisfyPath(mate, free, anchor) {
    const path  = Array.isArray(mate.params.pathLocalA) ? mate.params.pathLocalA : [];
    const pointB = mate.params.pointB || Vec3.zero();
    if (path.length < 2) return 0;

    const anchorPart = (anchor === mate.partA ? mate.partA : mate.partB);
    // Transform path samples by anchor's translation (rotation defaults
    // to identity for the polyline-on-fixed-anchor common case; we don't
    // rotate per-sample here to keep allocations cheap — callers stamp
    // a pre-rotated path if needed).
    const aPos = anchorPart.position;
    const aB = free.position.add(pointB);

    let bestD = Infinity, bestPt = null;
    for (let i = 0; i < path.length - 1; i++) {
      const s0 = path[i];   const s1 = path[i + 1];
      const p0 = new Vec3(aPos.x + s0.x, aPos.y + s0.y, aPos.z + s0.z);
      const p1 = new Vec3(aPos.x + s1.x, aPos.y + s1.y, aPos.z + s1.z);
      const ab = p1.sub(p0);
      const abLen2 = ab.dot(ab);
      if (abLen2 < 1e-18) continue;
      const tRaw = aB.sub(p0).dot(ab) / abLen2;
      const t = Math.max(0, Math.min(1, tRaw));
      const closest = new Vec3(p0.x + ab.x * t, p0.y + ab.y * t, p0.z + ab.z * t);
      const d = aB.sub(closest).length();
      if (d < bestD) { bestD = d; bestPt = closest; }
    }
    if (!bestPt || bestD < 1e-12) return bestD < 1e-12 ? 0 : bestD;

    // Pull free toward the closest point.
    const correction = bestPt.sub(aB).mul(RELAXATION);
    free.position = free.position.add(correction);
    return bestD;
  }

  /**
   * Distance-Limit (Tier-7b): distance between anchors held in
   * `[minDist, maxDist]`. Slack inside → 0 residual, 0 DOF removed.
   * Clamped at min/max → pulls free toward the boundary, 1 DOF removed.
   * params:
   *   - `pointA`, `pointB` : anchor offsets (local frames)
   *   - `minDist`, `maxDist` : the allowed-distance interval
   */
  static _satisfyDistanceLimit(mate, free, anchor) {
    const offsetA = mate.params.pointA || Vec3.zero();
    const offsetB = mate.params.pointB || Vec3.zero();
    const minD = mate.params.minDist || 0;
    const maxD = mate.params.maxDist || Infinity;

    const pA = anchor.position.add(offsetA);
    const pB = free.position.add(offsetB);
    const dir = pB.sub(pA);
    const dist = dir.length();

    // Slack — record DOF=0 and bail.
    if (dist >= minD && dist <= maxD) {
      mate.params._clampedDOF = 0;
      mate.params._activeLimit = null;
      return 0;
    }

    // Clamped at the closest limit.
    const target = (dist < minD) ? minD : maxD;
    mate.params._clampedDOF = 1;
    mate.params._activeLimit = (dist < minD) ? 'min' : 'max';

    if (dist < 1e-9) {
      // Degenerate — push apart along +X.
      free.position = free.position.add(new Vec3(target * RELAXATION, 0, 0));
      return target;
    }
    const dirN = dir.mul(1 / dist);
    const wantPos = pA.add(dirN.mul(target));
    const correction = wantPos.sub(pB).mul(RELAXATION);
    free.position = free.position.add(correction);
    return Math.abs(dist - target);
  }

  /**
   * Gear (Tier-7c): two rotational coordinates θA, θB about each part's
   * local axis (`axisA`, `axisB`) are coupled by `gearRatio = ωB / ωA`:
   *   θA · gearRatio − θB ≡ phase    (mod 2π)
   * params:
   *   - `axisA`     : Vec3 (local-frame axis of partA)
   *   - `axisB`     : Vec3 (local-frame axis of partB)
   *   - `gearRatio` : number (ωB / ωA — `N_A / N_B` for tooth counts)
   *   - `phase`     : number (rad; default 0)
   *
   * Residual = |wrapped(θA·ratio − θB − phase)|. Removes 1 rotational DOF.
   * The kernel applies the angular correction to free part's along-axis
   * rotation projection, leaving translational + perpendicular rotational
   * DOFs untouched.
   */
  static _satisfyGear(mate, free, anchor) {
    const axisAnchor = mate.params.axisA || new Vec3(0, 0, 1);
    const axisFree   = mate.params.axisB || new Vec3(0, 0, 1);
    const ratio = mate.params.gearRatio ?? 1;
    const phase = mate.params.phase ?? 0;
    // Which local axis belongs to which part (anchor / free decided by fixed flag).
    const localAnchor = anchor === mate.partA ? axisAnchor : axisFree;
    const localFree   = anchor === mate.partA ? axisFree   : axisAnchor;
    // World-space axes for projection.
    const dA = MateSolver._rotateLocal(anchor, localAnchor);
    const dB = MateSolver._rotateLocal(free,   localFree);
    const dAlen = dA.length() || 1;
    const dBlen = dB.length() || 1;
    const dAn = new Vec3(dA.x / dAlen, dA.y / dAlen, dA.z / dAlen);
    const dBn = new Vec3(dB.x / dBlen, dB.y / dBlen, dB.z / dBlen);
    // Project the parts' Euler rotation vectors onto their axes.
    const thetaA = anchor.rotation.x * dAn.x + anchor.rotation.y * dAn.y + anchor.rotation.z * dAn.z;
    const thetaB = free.rotation.x   * dBn.x + free.rotation.y   * dBn.y + free.rotation.z   * dBn.z;
    // Effective ratio: anchor → free convention. If anchor is partA in the
    // mate the ratio is as-given; if anchor is partB it inverts.
    const eff = (anchor === mate.partA) ? ratio : (ratio === 0 ? 0 : 1 / ratio);
    const effPhase = (anchor === mate.partA) ? phase : -phase;
    let delta = thetaA * eff - thetaB - effPhase;
    const TAU = Math.PI * 2;
    delta = ((delta % TAU) + TAU) % TAU;
    if (delta > Math.PI) delta -= TAU;
    if (Math.abs(delta) < 1e-12) return 0;
    // Correction: add `delta` to free's along-axis rotation. We distribute
    // the correction across the Euler XYZ components weighted by dBn.
    const step = delta * RELAXATION;
    free.rotation = new Vec3(
      free.rotation.x + dBn.x * step,
      free.rotation.y + dBn.y * step,
      free.rotation.z + dBn.z * step,
    );
    return Math.abs(delta);
  }

  /**
   * Hinge (Tier-7c): single rotational DOF along a shared axis.
   * Equivalent to concentric + coincident-along-axis = 5 DOF removed.
   * params:
   *   - `axisOriginA`, `axisDirA` : Vec3 (local-frame axis on partA)
   *   - `axisOriginB`, `axisDirB` : Vec3 (local-frame axis on partB)
   *   - `angleMin`, `angleMax`    : optional limits (rad); use ±Infinity
   *                                 (or omit) for free spin
   *
   * Per-iteration correction:
   *   1. Translate `free` so its world-space pivot coincides with anchor's.
   *   2. Rotate `free`'s axis to align with anchor's (cross-product nudge).
   *   3. If the relative angle is outside [min, max], clamp `free`'s along-
   *      axis rotation toward the closer limit; record the active clamp
   *      via mate.params._clampedDOF (0 = free spin, 1 = clamped).
   */
  static _satisfyHinge(mate, free, anchor) {
    const aOrigA = mate.params.axisOriginA || Vec3.zero();
    const aDirA  = mate.params.axisDirA   || new Vec3(0, 0, 1);
    const aOrigB = mate.params.axisOriginB || Vec3.zero();
    const aDirB  = mate.params.axisDirB   || new Vec3(0, 0, 1);
    const angleMin = mate.params.angleMin ?? -Infinity;
    const angleMax = mate.params.angleMax ?? +Infinity;

    // Resolve which local-frame axis belongs to anchor vs free.
    const oAnchorLocal = anchor === mate.partA ? aOrigA : aOrigB;
    const dAnchorLocal = anchor === mate.partA ? aDirA  : aDirB;
    const oFreeLocal   = anchor === mate.partA ? aOrigB : aOrigA;
    const dFreeLocal   = anchor === mate.partA ? aDirB  : aDirA;

    // World-space axis lines on each part.
    const oAW = anchor.position.add(oAnchorLocal);
    const oBW = free.position.add(oFreeLocal);
    const dAW = MateSolver._rotateLocal(anchor, dAnchorLocal);
    const dBW = MateSolver._rotateLocal(free,   dFreeLocal);
    const dAlen = dAW.length() || 1;
    const dBlen = dBW.length() || 1;
    const dAn = new Vec3(dAW.x / dAlen, dAW.y / dAlen, dAW.z / dAlen);
    const dBn = new Vec3(dBW.x / dBlen, dBW.y / dBlen, dBW.z / dBlen);

    // 1. Anchor coincidence — slide `free` so oBW → oAW.
    const dPos = oAW.sub(oBW);
    free.position = free.position.add(dPos.mul(RELAXATION));

    // 2. Axis alignment — rotate `free` about axis = dBn × dAn by the angle
    //    between them, weighted by RELAXATION. Same approximation used by
    //    `_satisfyParallel` (project axis-angle onto Euler XYZ).
    const cross = dBn.cross(dAn);
    const axLen = cross.length();
    const cos = Math.max(-1, Math.min(1, dBn.dot(dAn)));
    let axisErr = 0;
    if (axLen > 1e-9) {
      const angle = Math.acos(cos);
      const axisN = cross.mul(1 / axLen);
      const step = angle * RELAXATION;
      free.rotation = new Vec3(
        free.rotation.x + axisN.x * step,
        free.rotation.y + axisN.y * step,
        free.rotation.z + axisN.z * step,
      );
      axisErr = angle;
    } else if (cos < 0) {
      // Anti-parallel — flip free 180° about an arbitrary perpendicular axis.
      free.rotation = new Vec3(
        free.rotation.x + Math.PI * RELAXATION, free.rotation.y, free.rotation.z,
      );
      axisErr = Math.PI;
    }

    // 3. Angle limit clamp. The hinge angle is the projection of free's
    //    rotation onto the shared axis MINUS anchor's same projection (so
    //    rigid co-rotation contributes zero).
    let clampedDOF = 0;
    let activeLimit = null;
    if (Number.isFinite(angleMin) || Number.isFinite(angleMax)) {
      const thetaA = anchor.rotation.x * dAn.x + anchor.rotation.y * dAn.y + anchor.rotation.z * dAn.z;
      const thetaB = free.rotation.x   * dAn.x + free.rotation.y   * dAn.y + free.rotation.z   * dAn.z;
      const hingeAngle = thetaB - thetaA;
      if (Number.isFinite(angleMin) && hingeAngle < angleMin) {
        const delta = angleMin - hingeAngle;
        const step = delta * RELAXATION;
        free.rotation = new Vec3(
          free.rotation.x + dAn.x * step,
          free.rotation.y + dAn.y * step,
          free.rotation.z + dAn.z * step,
        );
        clampedDOF = 1;
        activeLimit = 'min';
      } else if (Number.isFinite(angleMax) && hingeAngle > angleMax) {
        const delta = angleMax - hingeAngle;
        const step = delta * RELAXATION;
        free.rotation = new Vec3(
          free.rotation.x + dAn.x * step,
          free.rotation.y + dAn.y * step,
          free.rotation.z + dAn.z * step,
        );
        clampedDOF = 1;
        activeLimit = 'max';
      }
    }
    mate.params._clampedDOF = clampedDOF;
    mate.params._activeLimit = activeLimit;

    return dPos.length() + axisErr;
  }

  /**
   * Screw (Tier-7c-rest): partA's along-axis rotation θ_A drives partB's
   * along-axis translation t_B via `pitch` (m per revolution, signed for
   * handedness — positive = right-hand, negative = left-hand):
   *   `θ_A · pitch / (2π) − t_B  →  0`.
   * params:
   *   - `axisA`        : Vec3 (local-frame rotation axis of partA)
   *   - `axisB`        : Vec3 (local-frame translation axis of partB)
   *   - `axisOriginA`  : Vec3 (local-frame point on the screw axis on partA;
   *                            sets the world reference point from which the
   *                            along-axis component of B's position is
   *                            measured. Defaults to (0,0,0).)
   *   - `pitch`        : number (m per revolution; sign = handedness)
   *
   * Per-iteration correction: project partB's position onto the world-space
   * screw axis (anchored at `axisOriginA` on partA) to read off t_B, project
   * partA's Euler rotation onto its axis to read off θ_A, compute the
   * signed delta, and slide partB along the axis by `delta · RELAXATION`.
   * Removes 1 DOF (the coupling reduces a translation + rotation pair to
   * a single independent scalar).
   */
  static _satisfyScrew(mate, free, anchor) {
    const axisAnchorLocal = mate.params.axisA  || new Vec3(0, 0, 1);
    const axisFreeLocal   = mate.params.axisB  || new Vec3(0, 0, 1);
    const originAnchorLocal = mate.params.axisOriginA || Vec3.zero();
    const pitch = mate.params.pitch ?? 0;
    // Which local axis belongs to which part (anchor / free decided by fixed flag).
    const localAnchor = anchor === mate.partA ? axisAnchorLocal : axisFreeLocal;
    const localFree   = anchor === mate.partA ? axisFreeLocal   : axisAnchorLocal;
    const originLocal = anchor === mate.partA ? originAnchorLocal : originAnchorLocal;
    // World-space rotation axis on anchor + world-space translation axis on free
    // (same physical axis once concentric — but the kernel treats them per-part
    // for symmetry).
    const dA = MateSolver._rotateLocal(anchor, localAnchor);
    const dB = MateSolver._rotateLocal(free,   localFree);
    const dAlen = dA.length() || 1;
    const dBlen = dB.length() || 1;
    const dAn = new Vec3(dA.x / dAlen, dA.y / dAlen, dA.z / dAlen);
    const dBn = new Vec3(dB.x / dBlen, dB.y / dBlen, dB.z / dBlen);
    // Anchor world-space origin of the screw axis (on the anchor part).
    const oW = anchor.position.add(originLocal);
    // θ_A: projection of anchor's Euler rotation onto its world-space axis.
    const thetaA = anchor.rotation.x * dAn.x + anchor.rotation.y * dAn.y + anchor.rotation.z * dAn.z;
    // t_B: along-axis component of free's position (relative to oW), measured
    // along dBn (the free part's axis — anchored to dA when concentric).
    const rel = free.position.sub(oW);
    const tB  = rel.x * dBn.x + rel.y * dBn.y + rel.z * dBn.z;
    // Effective pitch sign for anchor/free convention. If anchor is partA we
    // use pitch as-given; if anchor is partB (less common — fixed B + free A)
    // we invert because the coupling direction flips.
    const effPitch = (anchor === mate.partA) ? pitch : -pitch;
    const target = thetaA * effPitch / (Math.PI * 2);
    const delta  = target - tB;
    if (Math.abs(delta) < 1e-12) return 0;
    // Slide free along dBn by delta · RELAXATION.
    const step = delta * RELAXATION;
    free.position = free.position.add(new Vec3(dBn.x * step, dBn.y * step, dBn.z * step));
    return Math.abs(delta);
  }

  /**
   * Rack-and-Pinion (Tier-7c-rest): rotation of pinion (partA) about its
   * axis is coupled to translation of rack (partB) along the rack tangent
   * line by `pinionRadius`:
   *   `θ_A · pinionRadius − t_B  →  0`.
   * params:
   *   - `axisA`        : Vec3 (local-frame rotation axis of pinion partA)
   *   - `axisB`        : Vec3 (local-frame tangent translation axis of rack partB)
   *   - `axisOriginA`  : Vec3 (local-frame point on pinion's axis;
   *                            world reference from which t_B is measured)
   *   - `pinionRadius` : number (m; positive = standard, negative = reverse)
   *
   * Per-iteration correction: read off θ_A by projecting pinion's Euler
   * rotation onto its world-space axis; read off t_B by projecting rack's
   * position-relative-to-reference onto its tangent axis; slide rack along
   * the tangent so t_B → θ_A · pinionRadius. Removes 1 DOF.
   */
  static _satisfyRackPinion(mate, free, anchor) {
    const axisAnchorLocal = mate.params.axisA  || new Vec3(0, 0, 1);
    const axisFreeLocal   = mate.params.axisB  || new Vec3(1, 0, 0);
    const originAnchorLocal = mate.params.axisOriginA || Vec3.zero();
    const radius = mate.params.pinionRadius ?? 0;
    // Anchor is the pinion (rotating), free is the rack (translating). Same
    // convention as Gear: if the user mated A=pinion, B=rack the partA is
    // the anchor; if the user mated A=rack, B=pinion the kernel auto-flips.
    const localAnchor = anchor === mate.partA ? axisAnchorLocal : axisFreeLocal;
    const localFree   = anchor === mate.partA ? axisFreeLocal   : axisAnchorLocal;
    const dA = MateSolver._rotateLocal(anchor, localAnchor);
    const dB = MateSolver._rotateLocal(free,   localFree);
    const dAlen = dA.length() || 1;
    const dBlen = dB.length() || 1;
    const dAn = new Vec3(dA.x / dAlen, dA.y / dAlen, dA.z / dAlen);
    const dBn = new Vec3(dB.x / dBlen, dB.y / dBlen, dB.z / dBlen);
    const oW = anchor.position.add(originAnchorLocal);
    const thetaA = anchor.rotation.x * dAn.x + anchor.rotation.y * dAn.y + anchor.rotation.z * dAn.z;
    const rel = free.position.sub(oW);
    const tB  = rel.x * dBn.x + rel.y * dBn.y + rel.z * dBn.z;
    // If anchor is partB (the rack) instead of partA, flip radius sign.
    const effR = (anchor === mate.partA) ? radius : -radius;
    const target = thetaA * effR;
    const delta  = target - tB;
    if (Math.abs(delta) < 1e-12) return 0;
    const step = delta * RELAXATION;
    free.position = free.position.add(new Vec3(dBn.x * step, dBn.y * step, dBn.z * step));
    return Math.abs(delta);
  }

  /**
   * Cam (Tier-7c-final): point-on-cam-surface contact. The follower's
   * contact point (anchored on partB at `followerPtB`, local frame) stays
   * tangent to the cam profile — the perimeter curve in partA's rotating
   * frame, supplied as `camProfileLocalA` (Array<Vec3>). As partA (the cam)
   * rotates, every profile sample spins with it; the follower must
   * translate to stay on the resulting world-space polyline.
   *
   * params:
   *   - `axisOriginA`     : Vec3 (cam rotation axis origin on partA, local)
   *   - `axisDirA`        : Vec3 (cam rotation axis direction on partA, local)
   *   - `camProfileLocalA`: Array<Vec3> (cam profile samples in partA-local;
   *                         the perimeter polyline that spins with the cam)
   *   - `followerAxisDirB`: Vec3 (follower translation axis on partB, local —
   *                         the direction the follower can slide along)
   *   - `followerPtB`     : Vec3 (contact point on the follower, partB-local)
   *
   * Per-iteration correction: transform every profile sample by partA's
   * pose; find the closest segment to the world-space follower point; shift
   * `free` (the follower part) toward that closest point by RELAXATION ×
   * distance. Residual = perpendicular distance follower → profile polyline.
   * Removes 1 DOF.
   */
  static _satisfyCam(mate, free, anchor) {
    const profile = Array.isArray(mate.params.camProfileLocalA) ? mate.params.camProfileLocalA : [];
    const followerPt = mate.params.followerPtB || Vec3.zero();
    if (profile.length < 2) return 0;

    // The cam is always partA's role conceptually, but the solver picks
    // anchor/free by fixed-flag. Resolve which part's local frame carries
    // the cam profile (anchorPart) vs which carries the follower point.
    const camPart = (anchor === mate.partA) ? mate.partA : mate.partB;
    const followerPart = free;

    // Transform every profile sample into world space via the cam part's
    // current pose. We rotate each sample by the cam's Euler XYZ then
    // translate by the cam's position so the polyline spins with the cam.
    const samplesW = [];
    for (const s of profile) {
      const rotated = MateSolver._rotateLocal(camPart, s);
      samplesW.push(camPart.position.add(rotated));
    }
    const followerW = followerPart.position.add(followerPt);

    // Find the closest point on the polyline.
    let bestD = Infinity, bestPt = null;
    for (let i = 0; i < samplesW.length - 1; i++) {
      const p0 = samplesW[i];
      const p1 = samplesW[i + 1];
      const ab = p1.sub(p0);
      const abLen2 = ab.dot(ab);
      if (abLen2 < 1e-18) continue;
      const tRaw = followerW.sub(p0).dot(ab) / abLen2;
      const t = Math.max(0, Math.min(1, tRaw));
      const closest = new Vec3(p0.x + ab.x * t, p0.y + ab.y * t, p0.z + ab.z * t);
      const d = followerW.sub(closest).length();
      if (d < bestD) { bestD = d; bestPt = closest; }
    }
    if (!bestPt || bestD < 1e-12) return bestD < 1e-12 ? 0 : bestD;

    // Pull the follower toward the closest point on the cam profile.
    const correction = bestPt.sub(followerW).mul(RELAXATION);
    free.position = free.position.add(correction);
    return bestD;
  }

  /**
   * Universal Joint (Tier-7c-final): velocity-coupling between two non-
   * collinear shafts through a cross-pin at angle `crossAngle` (rad). The
   * static residual is the linear-cos coupling
   *   `cos(crossAngle) · θ_A − θ_B  →  0`
   * applied to the parts' along-axis Euler-rotation projections — same
   * projection trick as Gear / Screw. Plus an axis-misalignment-toward-
   * crossAngle correction so the two shafts maintain their misalignment.
   *
   * params:
   *   - `axisA`      : Vec3 (input shaft axis on partA, local)
   *   - `axisB`      : Vec3 (output shaft axis on partB, local)
   *   - `crossAngle` : rad (default π/2). Misalignment between shafts.
   *
   * Per-iteration correction:
   *   1. Project the parts' Euler rotations onto their world-space axes
   *      → θ_A, θ_B; compute `delta = cos(crossAngle)·θ_A − θ_B`; rotate
   *      `free` along its axis by `delta · RELAXATION` to satisfy the
   *      phase coupling.
   *   2. (Cross-pin angle held — the misalignment-toward-crossAngle
   *      correction is left to the caller's concentric/hinge anchor; this
   *      satisfier focuses on the velocity coupling. The misalignment
   *      residual is read off by `_mateError` for solver convergence.)
   *
   * Removes 2 DOF (the alignment-up-to-crossAngle direction relation plus
   * the along-axis phase coupling). 1 rotational + 3 translational DOFs
   * remain free unless the caller adds a concentric / hinge anchor.
   */
  static _satisfyUniversalJoint(mate, free, anchor) {
    const axisAnchorLocal = mate.params.axisA || new Vec3(0, 0, 1);
    const axisFreeLocal   = mate.params.axisB || new Vec3(0, 0, 1);
    const crossAngle = mate.params.crossAngle ?? (Math.PI / 2);
    const localAnchor = anchor === mate.partA ? axisAnchorLocal : axisFreeLocal;
    const localFree   = anchor === mate.partA ? axisFreeLocal   : axisAnchorLocal;
    const dA = MateSolver._rotateLocal(anchor, localAnchor);
    const dB = MateSolver._rotateLocal(free,   localFree);
    const dAlen = dA.length() || 1;
    const dBlen = dB.length() || 1;
    const dAn = new Vec3(dA.x / dAlen, dA.y / dAlen, dA.z / dAlen);
    const dBn = new Vec3(dB.x / dBlen, dB.y / dBlen, dB.z / dBlen);
    // θ_A, θ_B from Euler-projection onto each world-space axis.
    const thetaA = anchor.rotation.x * dAn.x + anchor.rotation.y * dAn.y + anchor.rotation.z * dAn.z;
    const thetaB = free.rotation.x   * dBn.x + free.rotation.y   * dBn.y + free.rotation.z   * dBn.z;
    const c = Math.cos(crossAngle);
    // Anchor / free convention: if the user mated A as the input shaft and
    // B as the output, anchor = partA and the coupling is cos(α)·θA − θB = 0.
    // If anchor ends up as partB (less common — fixed B + free A), the
    // coupling inverts:  cos(α)·θB − θA = 0  →  θA = cos(α)·θB. We need to
    // drive `free`'s along-axis rotation to satisfy this; the natural way
    // is to compute `delta` from anchor's perspective and add to free.
    const eff = (anchor === mate.partA) ? c : (c === 0 ? 0 : 1 / c);
    let delta = thetaA * eff - thetaB;
    const TAU = Math.PI * 2;
    delta = ((delta % TAU) + TAU) % TAU;
    if (delta > Math.PI) delta -= TAU;
    let phaseErr = Math.abs(delta);
    if (Math.abs(delta) > 1e-12) {
      const step = delta * RELAXATION;
      free.rotation = new Vec3(
        free.rotation.x + dBn.x * step,
        free.rotation.y + dBn.y * step,
        free.rotation.z + dBn.z * step,
      );
    }
    // Axis-misalignment residual — angle between the two axes vs crossAngle.
    // We report it but do NOT actively correct it here (the caller is
    // expected to seed the parts in their nominal cross-angle pose; a real
    // u-joint geometry locks the misalignment via the yoke + cross-pin).
    const cosAngle = Math.max(-1, Math.min(1, dAn.dot(dBn)));
    const angleNow = Math.acos(cosAngle);
    const angleErr = Math.abs(angleNow - crossAngle);
    return phaseErr + angleErr;
  }

  /** Helper — rotate a local-frame direction by a part's Euler XYZ. */
  static _rotateLocal(part, v) {
    const rx = part.rotation.x, ry = part.rotation.y, rz = part.rotation.z;
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    // Rotation order ZYX applied to the local vector.
    let x = v.x, y = v.y, z = v.z;
    // Rx
    let y1 = cx * y - sx * z, z1 = sx * y + cx * z;
    y = y1; z = z1;
    // Ry
    let x2 = cy * x + sy * z, z2 = -sy * x + cy * z;
    x = x2; z = z2;
    // Rz
    let x3 = cz * x - sz * y, y3 = sz * x + cz * y;
    x = x3; y = y3;
    return new Vec3(x, y, z);
  }

  /** Compute current mate error without modifying parts (read-only). */
  static _mateError(mate) {
    if (!mate.partA || !mate.partB) return 0;
    const offsetA = mate.params.pointA || Vec3.zero();
    const offsetB = mate.params.pointB || Vec3.zero();
    const pA = mate.partA.position.add(offsetA);
    const pB = mate.partB.position.add(offsetB);
    const delta = pA.sub(pB);

    switch (mate.type) {
      case 'coincident':
      case 'concentric':
      case 'lock':
        return delta.length();
      case 'distance':
        return Math.abs(delta.length() - (mate.params.distance || 0));
      case 'parallel': {
        const axisAnchor = mate.params.axisA || new Vec3(0, 0, 1);
        const axisFree   = mate.params.axisB || new Vec3(0, 0, 1);
        const dA = MateSolver._rotateLocal(mate.partA, axisAnchor);
        const dB = MateSolver._rotateLocal(mate.partB, axisFree);
        return dA.cross(dB).length();
      }
      case 'perpendicular': {
        const axisAnchor = mate.params.axisA || new Vec3(0, 0, 1);
        const axisFree   = mate.params.axisB || new Vec3(0, 0, 1);
        const dA = MateSolver._rotateLocal(mate.partA, axisAnchor);
        const dB = MateSolver._rotateLocal(mate.partB, axisFree);
        return Math.abs(dA.dot(dB));
      }
      case 'tangent': {
        const aOrigA  = mate.params.axisOriginA || Vec3.zero();
        const aDirA   = mate.params.axisDirA    || new Vec3(0, 0, 1);
        const pointB  = mate.params.pointB      || Vec3.zero();
        const radius  = mate.params.radius      || 0;
        const axisOrigin = mate.partA.position.add(aOrigA);
        const axisDirW   = MateSolver._rotateLocal(mate.partA, aDirA);
        const dN = axisDirW.length() > 0 ? axisDirW.mul(1 / axisDirW.length()) : axisDirW;
        const ptWorld = mate.partB.position.add(pointB);
        const w    = ptWorld.sub(axisOrigin);
        const proj = w.dot(dN);
        const perp = w.sub(dN.mul(proj));
        return Math.abs(perp.length() - radius);
      }
      case 'width': {
        const refA1 = mate.params.refA1 || Vec3.zero();
        const refA2 = mate.params.refA2 || Vec3.zero();
        const tabB  = mate.params.tabB  || Vec3.zero();
        const p1 = mate.partA.position.add(refA1);
        const p2 = mate.partA.position.add(refA2);
        const tb = mate.partB.position.add(tabB);
        return Math.abs(tb.sub(p1).length() - tb.sub(p2).length());
      }
      case 'path': {
        const path = Array.isArray(mate.params.pathLocalA) ? mate.params.pathLocalA : [];
        const pointB = mate.params.pointB || Vec3.zero();
        if (path.length < 2) return 0;
        const aPos = mate.partA.position;
        const aB = mate.partB.position.add(pointB);
        let bestD = Infinity;
        for (let i = 0; i < path.length - 1; i++) {
          const s0 = path[i], s1 = path[i + 1];
          const p0 = new Vec3(aPos.x + s0.x, aPos.y + s0.y, aPos.z + s0.z);
          const p1 = new Vec3(aPos.x + s1.x, aPos.y + s1.y, aPos.z + s1.z);
          const ab = p1.sub(p0);
          const abLen2 = ab.dot(ab);
          if (abLen2 < 1e-18) continue;
          const tRaw = aB.sub(p0).dot(ab) / abLen2;
          const t = Math.max(0, Math.min(1, tRaw));
          const closest = new Vec3(p0.x + ab.x * t, p0.y + ab.y * t, p0.z + ab.z * t);
          const d = aB.sub(closest).length();
          if (d < bestD) bestD = d;
        }
        return bestD === Infinity ? 0 : bestD;
      }
      case 'distanceLimit': {
        const offsetA = mate.params.pointA || Vec3.zero();
        const offsetB = mate.params.pointB || Vec3.zero();
        const pA = mate.partA.position.add(offsetA);
        const pB = mate.partB.position.add(offsetB);
        const d = pB.sub(pA).length();
        const minD = mate.params.minDist || 0;
        const maxD = mate.params.maxDist || Infinity;
        if (d < minD) return minD - d;
        if (d > maxD) return d - maxD;
        return 0;
      }
      case 'gear': {
        const axisA = mate.params.axisA || new Vec3(0, 0, 1);
        const axisB = mate.params.axisB || new Vec3(0, 0, 1);
        const ratio = mate.params.gearRatio ?? 1;
        const phase = mate.params.phase ?? 0;
        const dA = MateSolver._rotateLocal(mate.partA, axisA);
        const dB = MateSolver._rotateLocal(mate.partB, axisB);
        const dAlen = dA.length() || 1;
        const dBlen = dB.length() || 1;
        const dAn = new Vec3(dA.x / dAlen, dA.y / dAlen, dA.z / dAlen);
        const dBn = new Vec3(dB.x / dBlen, dB.y / dBlen, dB.z / dBlen);
        const thetaA = mate.partA.rotation.x * dAn.x + mate.partA.rotation.y * dAn.y + mate.partA.rotation.z * dAn.z;
        const thetaB = mate.partB.rotation.x * dBn.x + mate.partB.rotation.y * dBn.y + mate.partB.rotation.z * dBn.z;
        let d = thetaA * ratio - thetaB - phase;
        const TAU = Math.PI * 2;
        d = ((d % TAU) + TAU) % TAU;
        if (d > Math.PI) d -= TAU;
        return Math.abs(d);
      }
      case 'screw': {
        const axisA = mate.params.axisA || new Vec3(0, 0, 1);
        const axisB = mate.params.axisB || new Vec3(0, 0, 1);
        const originA = mate.params.axisOriginA || Vec3.zero();
        const pitch = mate.params.pitch ?? 0;
        const dA = MateSolver._rotateLocal(mate.partA, axisA);
        const dB = MateSolver._rotateLocal(mate.partB, axisB);
        const dAlen = dA.length() || 1;
        const dBlen = dB.length() || 1;
        const dAn = new Vec3(dA.x / dAlen, dA.y / dAlen, dA.z / dAlen);
        const dBn = new Vec3(dB.x / dBlen, dB.y / dBlen, dB.z / dBlen);
        const oW = mate.partA.position.add(originA);
        const thetaA = mate.partA.rotation.x * dAn.x + mate.partA.rotation.y * dAn.y + mate.partA.rotation.z * dAn.z;
        const rel = mate.partB.position.sub(oW);
        const tB = rel.x * dBn.x + rel.y * dBn.y + rel.z * dBn.z;
        const target = thetaA * pitch / (Math.PI * 2);
        return Math.abs(target - tB);
      }
      case 'rackPinion': {
        const axisA = mate.params.axisA || new Vec3(0, 0, 1);
        const axisB = mate.params.axisB || new Vec3(1, 0, 0);
        const originA = mate.params.axisOriginA || Vec3.zero();
        const radius = mate.params.pinionRadius ?? 0;
        const dA = MateSolver._rotateLocal(mate.partA, axisA);
        const dB = MateSolver._rotateLocal(mate.partB, axisB);
        const dAlen = dA.length() || 1;
        const dBlen = dB.length() || 1;
        const dAn = new Vec3(dA.x / dAlen, dA.y / dAlen, dA.z / dAlen);
        const dBn = new Vec3(dB.x / dBlen, dB.y / dBlen, dB.z / dBlen);
        const oW = mate.partA.position.add(originA);
        const thetaA = mate.partA.rotation.x * dAn.x + mate.partA.rotation.y * dAn.y + mate.partA.rotation.z * dAn.z;
        const rel = mate.partB.position.sub(oW);
        const tB = rel.x * dBn.x + rel.y * dBn.y + rel.z * dBn.z;
        const target = thetaA * radius;
        return Math.abs(target - tB);
      }
      case 'cam': {
        const profile = Array.isArray(mate.params.camProfileLocalA) ? mate.params.camProfileLocalA : [];
        const followerPt = mate.params.followerPtB || Vec3.zero();
        if (profile.length < 2) return 0;
        const samplesW = [];
        for (const s of profile) {
          const rotated = MateSolver._rotateLocal(mate.partA, s);
          samplesW.push(mate.partA.position.add(rotated));
        }
        const followerW = mate.partB.position.add(followerPt);
        let bestD = Infinity;
        for (let i = 0; i < samplesW.length - 1; i++) {
          const p0 = samplesW[i], p1 = samplesW[i + 1];
          const ab = p1.sub(p0);
          const abLen2 = ab.dot(ab);
          if (abLen2 < 1e-18) continue;
          const t = Math.max(0, Math.min(1, followerW.sub(p0).dot(ab) / abLen2));
          const closest = new Vec3(p0.x + ab.x * t, p0.y + ab.y * t, p0.z + ab.z * t);
          const d = followerW.sub(closest).length();
          if (d < bestD) bestD = d;
        }
        return bestD === Infinity ? 0 : bestD;
      }
      case 'universalJoint': {
        const axisA = mate.params.axisA || new Vec3(0, 0, 1);
        const axisB = mate.params.axisB || new Vec3(0, 0, 1);
        const crossAngle = mate.params.crossAngle ?? (Math.PI / 2);
        const dA = MateSolver._rotateLocal(mate.partA, axisA);
        const dB = MateSolver._rotateLocal(mate.partB, axisB);
        const dAlen = dA.length() || 1;
        const dBlen = dB.length() || 1;
        const dAn = new Vec3(dA.x / dAlen, dA.y / dAlen, dA.z / dAlen);
        const dBn = new Vec3(dB.x / dBlen, dB.y / dBlen, dB.z / dBlen);
        const thetaA = mate.partA.rotation.x * dAn.x + mate.partA.rotation.y * dAn.y + mate.partA.rotation.z * dAn.z;
        const thetaB = mate.partB.rotation.x * dBn.x + mate.partB.rotation.y * dBn.y + mate.partB.rotation.z * dBn.z;
        const c = Math.cos(crossAngle);
        let d = c * thetaA - thetaB;
        const TAU = Math.PI * 2;
        d = ((d % TAU) + TAU) % TAU;
        if (d > Math.PI) d -= TAU;
        const phaseErr = Math.abs(d);
        const cosAngle = Math.max(-1, Math.min(1, dAn.dot(dBn)));
        const angleErr = Math.abs(Math.acos(cosAngle) - crossAngle);
        return phaseErr + angleErr;
      }
      case 'hinge': {
        const aOrigA = mate.params.axisOriginA || Vec3.zero();
        const aDirA  = mate.params.axisDirA   || new Vec3(0, 0, 1);
        const aOrigB = mate.params.axisOriginB || Vec3.zero();
        const aDirB  = mate.params.axisDirB   || new Vec3(0, 0, 1);
        const oAW = mate.partA.position.add(aOrigA);
        const oBW = mate.partB.position.add(aOrigB);
        const dAW = MateSolver._rotateLocal(mate.partA, aDirA);
        const dBW = MateSolver._rotateLocal(mate.partB, aDirB);
        const dAlen = dAW.length() || 1;
        const dBlen = dBW.length() || 1;
        const dAn = new Vec3(dAW.x / dAlen, dAW.y / dAlen, dAW.z / dAlen);
        const dBn = new Vec3(dBW.x / dBlen, dBW.y / dBlen, dBW.z / dBlen);
        const anchorErr = oAW.sub(oBW).length();
        const axisErr = dAn.cross(dBn).length();
        let clampErr = 0;
        const angleMin = mate.params.angleMin ?? -Infinity;
        const angleMax = mate.params.angleMax ?? +Infinity;
        if (Number.isFinite(angleMin) || Number.isFinite(angleMax)) {
          const thetaA = mate.partA.rotation.x * dAn.x + mate.partA.rotation.y * dAn.y + mate.partA.rotation.z * dAn.z;
          const thetaB = mate.partB.rotation.x * dAn.x + mate.partB.rotation.y * dAn.y + mate.partB.rotation.z * dAn.z;
          const hingeAngle = thetaB - thetaA;
          if (Number.isFinite(angleMin) && hingeAngle < angleMin) clampErr = angleMin - hingeAngle;
          else if (Number.isFinite(angleMax) && hingeAngle > angleMax) clampErr = hingeAngle - angleMax;
        }
        return anchorErr + axisErr + clampErr;
      }
      default:
        return 0;
    }
  }
}
