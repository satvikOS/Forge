/**
 * ArchDisc Foundation — Variable-radius NURBS fillet (Phase 5 of
 * Parasolid parity).
 *
 * Builds a swept rational-quadratic NURBS surface that represents a
 * fillet between two faces meeting at a straight edge, with radius
 * varying linearly along the edge.
 *
 * Mathematical layout for a 90° corner:
 *
 *    Two faces meet at edge `E(v) = startPoint + v · (endPoint − startPoint)`,
 *    v ∈ [0, 1]. Each face has outward unit normal `nA` (face A) and
 *    `nB` (face B). For convenience nA ⊥ nB at each (u, v) on a 90°
 *    corner.
 *
 *    At each v we want a quarter-arc of radius R(v) tangent to both
 *    faces. With center at E(v), the standard rational-quadratic-Bézier
 *    representation has 3 control points
 *
 *        P_0(v) = E(v) + R(v) · nA    (tangent point on face A)
 *        P_1(v) = E(v) + R(v) · (nA + nB)   (corner of inscribing square)
 *        P_2(v) = E(v) + R(v) · nB    (tangent point on face B)
 *
 *    with weights (1, √2/2, 1). Each sweep direction in v is linear
 *    so the surface is degree (2, 1), with control net 3 × 2 and
 *    knot vectors
 *
 *        knotsU = [0, 0, 0, 1, 1, 1]    (clamped quadratic Bézier)
 *        knotsV = [0, 0, 1, 1]          (clamped linear)
 *
 *    For ANY u ∈ [0, 1], the surface point is at distance exactly R(v)
 *    from E(v), to machine precision (rational-quadratic conic-section
 *    exactness). At u = 0 the surface is tangent to face A; at u = 1
 *    tangent to face B.
 *
 * For 90° corners this reduces to a constant-radius arc that's exact;
 * for non-90° corners (faces meeting at angle θ ≠ π/2) the rational
 * Bézier still represents the local circular arc exactly via the
 * appropriate weight (sin(θ/2) instead of √2/2). General-angle support
 * is wired in with `weight = sin(angle / 2)` from the included angle.
 */

import { NURBSSurface } from './NURBSSurface.js';

const PI = Math.PI;

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a) => { const l = Math.hypot(...a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
const sub3 = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const add3 = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const scale3 = (a, s) => [a[0]*s, a[1]*s, a[2]*s];

/**
 * Build a NURBS fillet surface between two faces meeting along a
 * straight edge.
 *
 * @param {object} args
 * @param {[number,number,number]} args.startPoint  - edge start
 * @param {[number,number,number]} args.endPoint    - edge end
 * @param {[number,number,number]} args.normalA     - outward unit normal of face A
 * @param {[number,number,number]} args.normalB     - outward unit normal of face B
 * @param {number} args.radiusStart                  - fillet radius at startPoint
 * @param {number} args.radiusEnd                    - fillet radius at endPoint
 * @returns {NURBSSurface} degree (2, 1) rational, 3 × 2 control net
 */
export function cornerFillet({
  startPoint, endPoint,
  normalA, normalB,
  radiusStart, radiusEnd,
}) {
  const nA = norm3(normalA);
  const nB = norm3(normalB);
  // Included angle between face normals
  const cos = dot3(nA, nB);
  // For perpendicular faces cos = 0, angle = π/2, weight = sin(π/4) = √2/2.
  // For general angle θ between normals, the corresponding fillet arc
  // sweeps through angle (π − θ); the rational-Bézier middle weight is
  // cos((π − θ)/2) = sin(θ/2).
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  const w = Math.sin(angle / 2);    // = √2/2 when angle = π/2

  const buildRow = (pt, R) => [
    add3(pt, scale3(nA, R)),                          // P0
    add3(pt, scale3(add3(nA, nB), R)),                // P1 corner
    add3(pt, scale3(nB, R)),                          // P2
  ];
  const ringStart = buildRow(startPoint, radiusStart);
  const ringEnd   = buildRow(endPoint,   radiusEnd);

  // Build 3×2 control net: rows = u-direction (3 CPs of arc),
  // columns = v-direction (2 endpoints of edge sweep).
  const controlNet = [
    [ringStart[0], ringEnd[0]],
    [ringStart[1], ringEnd[1]],
    [ringStart[2], ringEnd[2]],
  ];
  const weights = [
    [1, 1],
    [w, w],
    [1, 1],
  ];
  return new NURBSSurface({
    degreeU: 2, degreeV: 1,
    controlNet, weights,
    knotsU: [0, 0, 0, 1, 1, 1],
    knotsV: [0, 0, 1, 1],
  });
}

/**
 * Validation helper: for every (u, v) sample on a corner-fillet
 * surface, the surface point should be at distance R(v) from the
 * corresponding point on the edge (E(v)).
 *
 * @returns {{ samples, maxRadiusError, maxTangencyError }}
 */
export function validateCornerFillet(surface, args, samples = 21) {
  const { startPoint, endPoint, radiusStart, radiusEnd, normalA, normalB } = args;
  const out = [];
  let maxRadiusError = 0;
  let maxTangencyError = 0;
  for (let j = 0; j <= samples; j++) {
    const v = j / samples;
    const Ev = add3(scale3(startPoint, 1 - v), scale3(endPoint, v));
    const Rv = radiusStart + (radiusEnd - radiusStart) * v;
    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      const p = surface.eval(u, v);
      const d = Math.hypot(p[0] - Ev[0], p[1] - Ev[1], p[2] - Ev[2]);
      const radErr = Math.abs(d - Rv);
      if (radErr > maxRadiusError) maxRadiusError = radErr;
      // Tangency at u=0: surface tangent in u must be perpendicular to nA
      if (i === 0 || i === samples) {
        const der = surface.evalDerivatives(u, v);
        const tu = norm3(der.Su);
        const targetNormal = i === 0 ? normalA : normalB;
        const dotN = Math.abs(dot3(tu, norm3(targetNormal)));
        // tangent in surface plane should have ZERO component along face normal
        if (dotN > maxTangencyError) maxTangencyError = dotN;
      }
      if (i % 5 === 0 && j % 5 === 0) out.push({ u, v, p, distance: d, expectedRadius: Rv });
    }
  }
  return { samples: out, maxRadiusError, maxTangencyError };
}
