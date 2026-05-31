/**
 * Forge Healing — geometric repair (sew, fill, simplify, validity check).
 *
 * Wraps the native `forge.heal.*` namespace. Each operation produces a new
 * `ForgeBody` plus an opt-in diagnostic report. The original is never
 * mutated — callers should `.dispose()` the input when the new body
 * takes its place in the project.
 */

import { getForge, ForgeBody } from './index.js';

function requireHeal() {
  const f = getForge();
  if (!f.heal) {
    throw new Error('[forge.heal] not present on bridge — rebuild forge-kernel >= Forge-23');
  }
  return f.heal;
}

export class ForgeHealing {
  /**
   * Stitch open shells into closed solids using `BRepBuilderAPI_Sewing`.
   * Returns `{ body, report: { closedBefore, closedAfter, facesBefore/After, openEdgesBefore/After } }`.
   */
  static sewShape(body, tolerance = 1e-3) {
    const r = requireHeal().sewShape(body.handle, tolerance);
    return {
      body: new ForgeBody(r.handle, { source: 'heal.sew', tolerance }),
      report: r.report,
    };
  }

  /**
   * Fold adjacent C0-continuous faces into single faces using
   * `ShapeUpgrade_UnifySameDomain`. Returns `{ body, facesBefore/After, edgesBefore/After }`.
   */
  static simplifyShape(body, options = {}) {
    const r = requireHeal().simplifyShape(body.handle, options);
    return {
      body: new ForgeBody(r.handle, { source: 'heal.simplify' }),
      facesBefore: r.facesBefore,
      facesAfter:  r.facesAfter,
      edgesBefore: r.edgesBefore,
      edgesAfter:  r.edgesAfter,
    };
  }

  /**
   * Detect open-edge boundaries, fit `BRepOffsetAPI_MakeFilling` caps,
   * sew + return the closed solid.
   */
  static autoFillMissingFaces(body, tolerance = 1e-3) {
    const r = requireHeal().autoFillMissingFaces(body.handle, tolerance);
    return {
      body: new ForgeBody(r.handle, { source: 'heal.autoFill' }),
      report: r.report,
    };
  }

  /** ShapeFix_Shape cleanup pass; reports which fixers fired. */
  static autoRepairSelfIntersection(body, tolerance = 1e-3) {
    const r = requireHeal().autoRepairSelfIntersection(body.handle, tolerance);
    return {
      body: new ForgeBody(r.handle, { source: 'heal.autoRepair' }),
      report: r.report,
    };
  }

  /** Re-orient every face's normal to point outward. */
  static harmonizeNormals(body) {
    const h = requireHeal().harmonizeNormals(body.handle);
    return new ForgeBody(h, { source: 'heal.harmonizeNormals' });
  }

  /** Full validity report — closedness, manifoldness, self-intersect, bad sub-shapes. */
  static checkValidity(body) {
    return requireHeal().checkValidity(body.handle);
  }
}
