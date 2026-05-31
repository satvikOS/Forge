/**
 * ArchDisc Topology Spine — Pcurve
 *
 * SP-1 Stage S0. The 2-D parametric trace of an edge in a face's surface
 * (u,v) space — carried by a `Coedge`. ACIS PCURVE.
 *
 * Two flavours:
 *   - A B-spline pcurve — the degree-3 2-D B-spline produced by
 *     `foundation/PCurveProjection.js`, used by analytic NURBS faces
 *     (G2 blend, N-sided patch, face-replace). This is the existing
 *     `AnalyticNurbsFace.Pcurve`, re-exported here so the spine has a single
 *     `kernel/topology/Pcurve.js` import surface (the SP-1 module layout).
 *   - A linear pcurve — a straight (u0,v0)→(u1,v1) segment in parameter space.
 *     Sufficient for the common engine-bound case where the spine just needs
 *     parameter-space endpoints, not a full projected curve.
 *
 * S0 is additive: no op constructs a Pcurve through this module yet — it is
 * the scaffold S6 (analytic-face unification) and the geometry adapters use.
 */

import { Pcurve as BSplinePcurve } from './AnalyticNurbsFace.js';

// Re-export the existing B-spline pcurve under the spine's module surface.
export { BSplinePcurve };

/**
 * A linear pcurve — a straight segment in surface (u,v) space.
 * Cheap, exact for the trace of an edge across a planar or ruled face.
 */
export class LinearPcurve {
  /**
   * @param {[number,number]} uv0  start (u,v).
   * @param {[number,number]} uv1  end (u,v).
   */
  constructor(uv0, uv1) {
    this.type = 'pcurve';
    this.kind = 'linear';
    this.uv0 = [uv0[0], uv0[1]];
    this.uv1 = [uv1[0], uv1[1]];
  }

  /** Evaluate the pcurve at parameter t∈[0,1] → [u,v]. */
  evaluate(t) {
    const s = Math.min(1, Math.max(0, t));
    return [
      this.uv0[0] + (this.uv1[0] - this.uv0[0]) * s,
      this.uv0[1] + (this.uv1[1] - this.uv0[1]) * s,
    ];
  }

  /** Parameter-space length of the segment. */
  paramLength() {
    const du = this.uv1[0] - this.uv0[0];
    const dv = this.uv1[1] - this.uv0[1];
    return Math.sqrt(du * du + dv * dv);
  }
}

/**
 * Build the natural Pcurve for a coedge if one can be derived cheaply.
 * In S0 this returns null (no behaviour change); S6 fills it in for analytic
 * faces. Present so the call site exists for later stages.
 * @returns {null}
 */
export function derivePcurve(/* coedge, face */) {
  return null;
}
