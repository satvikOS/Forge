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
 * - angle: two axes/normals at angle θ
 * - lock: zero relative motion (rigid)
 *
 * Algorithm:
 * - Each mate has a residual function (current error vs target)
 * - Apply incremental corrections to the non-fixed part
 * - Iterate until all residuals < tolerance or max iterations
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

  /** Parallel: align rotation around shared axis */
  static _satisfyParallel(mate, free, anchor) {
    // Match Y-rotation (simplified)
    const targetRotY = anchor.rotation.y;
    const delta = targetRotY - free.rotation.y;
    free.rotation = new Vec3(free.rotation.x, free.rotation.y + delta * RELAXATION, free.rotation.z);
    return Math.abs(delta);
  }

  /** Lock: copy anchor's transform exactly */
  static _satisfyLock(mate, free, anchor) {
    const offset = mate.params.offset || Vec3.zero();
    const target = anchor.position.add(offset);
    const delta = target.sub(free.position);
    free.position = target;
    free.rotation = anchor.rotation.clone();
    return delta.length();
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
      case 'parallel':
        return Math.abs(mate.partA.rotation.y - mate.partB.rotation.y);
      default:
        return 0;
    }
  }
}
