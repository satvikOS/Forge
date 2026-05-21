/**
 * ArchDisc Kernel — NURBS Surface-Surface Intersection (SSI).
 *
 * Uses GeomAPI_IntSS_1 (no-arg ctor + Perform) — verified REACHABLE in
 * docs/superpowers/notes/kernel-api-G.md (Task 1 recon, item 1).
 *
 * Algorithm:
 *   1. Extract the first face of each BrepShape via TopExp_Explorer + TopAbs_FACE.
 *   2. Get the Handle_Geom_Surface via BRep_Tool.Surface_2(face).
 *   3. Construct GeomAPI_IntSS_1(), call Perform(surfA, surfB, tol).
 *   4. For each intersection curve (1..NbLines()), sample `samples` uniform
 *      points along the curve parameter domain.
 *   5. Handle the Geom_Line infinite-parameter gotcha: clamp ±2e100 domain
 *      to a finite window around the line midpoint before sampling.
 *   6. Return { curves: [{points: Float32Array, length}], stats }.
 *
 * Honest scope:
 *   - Extracts the FIRST face from each BrepShape. For multi-face B-rep solids
 *     (box, cylinder, etc.) the first face is geometry-dependent. A full B-rep
 *     SSI would loop over every face pair; this shim intersects face[0] × face[0]
 *     which is sufficient for the recon-verified primitives and the ribbon e2e.
 *   - Geom_Line results (plane × cylinder degenerate case) are clamped to
 *     ±sampleRange mm of the line's u=0 point.
 *
 * Refs:
 *   Recon: docs/superpowers/notes/kernel-api-G.md §1
 *   Disposal: BrepShape.js withScope / track pattern
 */

import { getKernel } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/** Default half-range for clamping Geom_Line infinite parameters (mm). */
const INFINITE_LINE_HALF_RANGE = 60;

/**
 * Collect all unique faces from a TopoDS_Shape via TopExp_Explorer.
 * Returns an array of TopoDS_Face objects. Caller must delete them.
 *
 * @param {object} oc
 * @param {object} shape  TopoDS_Shape
 * @returns {object[]}  TopoDS_Face array (tracked — freed by withScope)
 */
function _collectFaces(oc, shape) {
  const faces = [];
  const exp = track(new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
  while (exp.More()) {
    const face = track(oc.TopoDS.Face_1(exp.Current()));
    faces.push(face);
    exp.Next();
  }
  exp.delete();
  return faces;
}

/**
 * Determine if a parameter domain is effectively infinite.
 * Geom_Line uses ±2e100 as its infinite parametric convention.
 */
function _isInfiniteDomain(p) {
  return Math.abs(p) > 1e90;
}

/**
 * Sample a Handle_Geom_Curve at `nSamples` uniform parameter values.
 * Handles the Geom_Line infinite-parameter gotcha by clamping.
 *
 * @param {object} oc
 * @param {object} curveHandle  Handle_Geom_Curve
 * @param {number} nSamples     Number of sample points (≥ 2)
 * @returns {{ points: Float32Array, length: number }}
 */
function _sampleCurve(oc, curveHandle, nSamples) {
  const curve = curveHandle.get();

  let t0 = curve.FirstParameter();
  let t1 = curve.LastParameter();

  // Geom_Line has infinite parameter domain: clamp to a sensible finite window.
  if (_isInfiniteDomain(t0) || _isInfiniteDomain(t1)) {
    // Evaluate the line at u=0 as the reference midpoint, then clamp.
    const refPnt = track(new oc.gp_Pnt_3(0, 0, 0));
    curve.D0(0.0, refPnt);
    // Clamp around u=0 (the line midpoint exposed by the kernel).
    t0 = -INFINITE_LINE_HALF_RANGE;
    t1 =  INFINITE_LINE_HALF_RANGE;
  }

  const count = Math.max(2, nSamples);
  const step  = (t1 - t0) / (count - 1);

  const pts    = new Float32Array(count * 3);
  let totalLen = 0;
  let prevX = 0, prevY = 0, prevZ = 0;

  const p = track(new oc.gp_Pnt_3(0, 0, 0));

  for (let k = 0; k < count; k++) {
    const t = t0 + k * step;
    curve.D0(t, p);
    const x = p.X(), y = p.Y(), z = p.Z();
    pts[k * 3]     = x;
    pts[k * 3 + 1] = y;
    pts[k * 3 + 2] = z;

    if (k > 0) {
      const dx = x - prevX, dy = y - prevY, dz = z - prevZ;
      totalLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    prevX = x; prevY = y; prevZ = z;
  }

  return { points: pts, length: totalLen };
}

/**
 * Intersect the surface of the first face of brepShapeA with the surface of
 * the first face of brepShapeB. Returns sampled intersection curves.
 *
 * @param {BrepShape} brepShapeA
 * @param {BrepShape} brepShapeB
 * @param {object}    [opts]
 * @param {number}    [opts.samples=32]      Points per curve.
 * @param {number}    [opts.tolerance=1e-6]  SSI geometric tolerance (mm).
 * @returns {Promise<{
 *   curves: Array<{ points: Float32Array, length: number }>,
 *   stats: { nbLines: number, totalPoints: number, totalLength: number }
 * }>}
 */
export async function intersectSurfaces(brepShapeA, brepShapeB, opts = {}) {
  if (!brepShapeA || !brepShapeA.shape) {
    throw new Error('intersectSurfaces: first argument must be a BrepShape with a live shape');
  }
  if (!brepShapeB || !brepShapeB.shape) {
    throw new Error('intersectSurfaces: second argument must be a BrepShape with a live shape');
  }

  const samples   = Math.min(256, Math.max(8, Math.round(opts.samples   ?? 32)));
  const tolerance = Math.min(1e-2, Math.max(1e-9, opts.tolerance ?? 1e-6));

  const oc = await getKernel();

  return withScope(async () => {
    // ── 1. Extract first face from each shape ────────────────────────────────
    const facesA = _collectFaces(oc, brepShapeA.shape);
    const facesB = _collectFaces(oc, brepShapeB.shape);

    if (facesA.length === 0) {
      throw new Error('intersectSurfaces: brepShapeA has no faces');
    }
    if (facesB.length === 0) {
      throw new Error('intersectSurfaces: brepShapeB has no faces');
    }

    // ── 2. Get Handle_Geom_Surface via BRep_Tool.Surface_2 ───────────────────
    const surfA = track(oc.BRep_Tool.Surface_2(facesA[0]));
    const surfB = track(oc.BRep_Tool.Surface_2(facesB[0]));

    // ── 3. Run GeomAPI_IntSS ─────────────────────────────────────────────────
    const intersector = track(new oc.GeomAPI_IntSS_1());
    intersector.Perform(surfA, surfB, tolerance);

    if (!intersector.IsDone()) {
      throw new Error(
        'intersectSurfaces: GeomAPI_IntSS failed (IsDone=false). ' +
        'The two surface types may not support analytic intersection.',
      );
    }

    const nbLines = intersector.NbLines();

    // ── 4. Sample each intersection curve ────────────────────────────────────
    const curves = [];
    let totalPoints = 0;
    let totalLength = 0;

    for (let i = 1; i <= nbLines; i++) {
      const curveHandle = track(intersector.Line(i));
      const { points, length } = _sampleCurve(oc, curveHandle, samples);
      curves.push({ points, length });
      totalPoints += points.length / 3;
      totalLength += length;
    }

    // withScope returns a plain JS object (not a BrepShape), so it is not
    // subject to the BrepShape survival filter. The typed arrays inside
    // `curves` are plain JS Float32Array — they survive scope exit normally.
    return {
      curves,
      stats: { nbLines, totalPoints, totalLength },
    };
  });
}
