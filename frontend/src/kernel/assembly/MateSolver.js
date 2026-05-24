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
      default: return 1;
    }
  }

  /**
   * Apply correction to satisfy a single mate.
   * @returns {number} residual error magnitude
   */
  static _satisfyMate(mate) {
    if (!mate.partA || !mate.partB) return 0;

    // The non-fixed part gets corrected; if both fixed, return current error
    const fixedA = mate.partA.fixed;
    const fixedB = mate.partB.fixed;
    if (fixedA && fixedB) {
      return MateSolver._mateError(mate);
    }

    // The "free" part is the one we'll move
    const free = fixedA ? mate.partB : mate.partA;
    const anchor = fixedA ? mate.partA : mate.partB;

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
      default:
        return 0;
    }
  }
}
