/**
 * ArchDisc Geometry Kernel — arbitrary face replacement in the native B-rep
 * topology kernel (parity-audit P4).
 *
 * ── The §3.4 intent ─────────────────────────────────────────────────────────
 * "Local face replacement": swap a face's underlying surface for an ARBITRARY
 * new one and rebuild the surrounding topology. The hard part is the new
 * surface is geometrically DIFFERENT from the old one, so the boundary edges
 * need fresh PCURVES — the 2-D parametric trace of each boundary edge in the
 * new surface's (u,v) space. OCCT does this with
 * `ShapeConstruct_ProjectCurveOnSurface`; this module is the native ArchDisc
 * equivalent built on `foundation/PCurveProjection.js`.
 *
 * ── What this module does ───────────────────────────────────────────────────
 * `replaceFaceSurface(face, newNurbs)`:
 *   1. Keeps the face's boundary loops (the 3-D edges are unchanged — the
 *      boundary geometry of the face does not move).
 *   2. Projects each boundary edge's 3-D curve onto `newNurbs` via Newton
 *      point-inversion + 2-D B-spline fitting (`projectCurveOnSurface`),
 *      producing a fresh pcurve per edge.
 *   3. Re-seats the `TopoFace` onto `newNurbs` (`reseatFaceOnSurface`), with
 *      the new pcurves attached to the boundary edges.
 *   4. VALIDATES the rebuilt face — the pcurve loop must be closed in (u,v)
 *      space and no pcurve may be degenerate; the push-forward error (how far
 *      the rebuilt face's boundary, evaluated through the new surface, lands
 *      from the original 3-D edges) is reported. If the swap genuinely cannot
 *      produce a valid face the op reports a clear error — it does NOT ship an
 *      invalid face.
 *   5. The owning shell/solid keeps the same face object (re-seated in place),
 *      so the surrounding topology — edges, vertices, adjacent faces — is
 *      rebuilt around the swapped surface without re-stitching.
 *
 * The result is an ArchDisc-native analytic face (a `TopoFace` on an exact
 * `NURBSSurface` with real pcurves) — NOT an OCCT `TopoDS_Face`.
 *
 * Refs:
 *   foundation/PCurveProjection.js — Newton point-inversion + pcurve fit.
 *   ISO 10303-42 — `curve_bounded_surface` / `pcurve`.
 *   OCCT `ShapeConstruct_ProjectCurveOnSurface` — the kernel routine ported.
 */

import { reseatFaceOnSurface } from './AnalyticNurbsFace.js';
import { validatePCurveLoop } from '../../foundation/PCurveProjection.js';

/**
 * Replace the underlying surface of a `TopoFace` with an arbitrary new
 * `NURBSSurface`, rebuilding the boundary pcurves and validating the result.
 *
 * @param {import('./TopoFace.js').default} face   the face to re-surface
 * @param {import('../../foundation/NURBSSurface.js').NURBSSurface} newNurbs
 * @param {object} [opts]
 * @param {number} [opts.edgeSamples=24]   polyline samples per boundary edge
 * @param {number} [opts.tolerance=1.0]    max acceptable push-forward error
 *   (model units) — how far the rebuilt boundary may sit from the original.
 * @returns {{
 *   ok: boolean,
 *   face: import('./TopoFace.js').default,
 *   pcurveCount: number,
 *   maxProjectionError: number,
 *   maxPushForwardError: number,
 *   loopClosed: boolean,
 *   loopGaps: number[],
 *   allConverged: boolean,
 *   reason: string
 * }}
 */
export function replaceFaceSurface(face, newNurbs, opts = {}) {
  if (!face || !face.outerLoop) {
    throw new Error('replaceFaceSurface: face has no boundary loop');
  }
  if (!newNurbs || typeof newNurbs.eval !== 'function') {
    throw new Error('replaceFaceSurface: newNurbs must be a NURBSSurface');
  }
  const tolerance = opts.tolerance != null ? opts.tolerance : 1.0;

  // ── 1. project the boundary edges, re-seat the face on the new surface ────
  const reseat = reseatFaceOnSurface(face, newNurbs, {
    edgeSamples: opts.edgeSamples || 24,
    gridU: opts.gridU,
    gridV: opts.gridV,
  });

  // ── 2. validate the rebuilt face ─────────────────────────────────────────
  // Collect the per-edge pcurves in OUTER-LOOP traversal order so the loop
  // closure check sees them as the boundary wire walks them.
  const outerPcurves = [];
  for (const he of face.outerLoop.halfEdges) {
    const pcMap = he.edge.userData.pcurves;
    const pc = pcMap && pcMap.get(face);
    if (pc) outerPcurves.push(pc);
  }
  const loopCheck = validatePCurveLoop(outerPcurves, 1e-3 *
    Math.hypot(newNurbs.uMax - newNurbs.uMin, newNurbs.vMax - newNurbs.vMin));

  let ok = true;
  let reason = 'face re-seated on the new surface; pcurves valid';

  if (reseat.degenerate) {
    ok = false;
    reason = 'the boundary projects to a degenerate region of the new ' +
      'surface (the new surface is too small / mis-placed for this boundary)';
  } else if (!reseat.allConverged) {
    ok = false;
    reason = 'point-inversion did not converge for every boundary sample — ' +
      'the boundary does not project cleanly onto the new surface';
  } else if (!loopCheck.valid) {
    ok = false;
    reason = `the rebuilt pcurve boundary is invalid: ${loopCheck.reason}`;
  } else if (reseat.maxPushForwardError > tolerance) {
    ok = false;
    reason = `the new surface is too far from the boundary — rebuilt boundary ` +
      `lands ${reseat.maxPushForwardError.toFixed(3)} mm off the original ` +
      `(tolerance ${tolerance} mm); pick a surface that spans the face boundary`;
  }

  return {
    ok,
    face: reseat.face,
    pcurveCount: reseat.pcurves.length,
    maxProjectionError: reseat.maxProjectionError,
    maxPushForwardError: reseat.maxPushForwardError,
    loopClosed: loopCheck.closed,
    loopGaps: loopCheck.gaps,
    allConverged: reseat.allConverged,
    reason,
  };
}
