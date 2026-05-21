/**
 * ArchDisc Kernel — geometry healing & simplification.
 *
 * `simplify` runs a two-stage cleanup pass on a solid:
 *   Stage 1 — small-feature removal: `ShapeFix_FixSmallFace` detects and
 *     removes tiny faces — sliver "strip" faces and degenerate "spot" faces
 *     (e.g. micro-fillet bands, sliver faces left by tolerant booleans) whose
 *     size is below the `minFeatureSize` precision threshold. This is the
 *     §3.5 "removing tiny features, sliver faces, small edges automatically"
 *     intent: dropping a tiny face also collapses its small bounding edges.
 *   Stage 2 — same-domain merge: `ShapeUpgrade_UnifySameDomain` merges
 *     adjacent faces lying on the same underlying surface and drops the
 *     now-redundant seam / small edges.
 *
 * Empirically verified in this `opencascade.js@2.0.0-beta.b5ff984` build
 * (e2e recon — see brep-simplify-electron.spec.js):
 *   - `ShapeUpgrade_RemoveInternalWires` is constructible but its `MinArea()`
 *     reference-getter cannot be set from JS (always reads 0), so it removes
 *     nothing — NOT used.
 *   - `ShapeFix_FixSmallFace` IS fully bound and effective: `Init(shape)` +
 *     `SetPrecision(p)` + `Perform()` + `FixShape()` returns the cleaned
 *     shape. `Perform()` returns void; the result is read from `FixShape()`.
 *     Precision-gated: a tiny-fillet box (26 faces) reduces to 6 faces once
 *     the precision exceeds the fillet-face size.
 *   - `ShapeUpgrade_UnifySameDomain_2(shape,true,true,false)` + `Build()` +
 *     `Shape()` merges same-domain faces — kernel-api-A4.md item 2.
 *
 * OCCT refman: `ShapeFix_FixSmallFace` — "fixing faces with small size";
 * `ShapeUpgrade_UnifySameDomain` — "unifies faces / edges of the same
 * geometric domain".
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/** Count members of a shape of a given TopAbs enum. Caller is inside withScope. */
function countSubShapes(oc, shape, enumVal) {
  if (!shape || shape.IsNull()) return 0;
  const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
  const exp = track(new oc.TopExp_Explorer_2(shape, enumVal, ANY));
  let n = 0;
  for (; exp.More(); exp.Next()) n++;
  return n;
}

/**
 * Simplify a solid: remove tiny / sliver faces below a size threshold, then
 * unify same-domain faces and drop redundant edges.
 *
 * The returned BrepShape carries `meta.stats` with:
 *   - `removedFeatures`   total tiny features removed (small faces + the
 *                         small edges that vanished with them)
 *   - `removedFaces`      tiny / sliver faces removed
 *   - `removedEdges`      small edges removed (with the faces and by the merge)
 *   - `facesBefore` / `facesAfter` / `edgesBefore` / `edgesAfter`
 *   - `facesMerged` / `edgesMerged`  reductions attributable to Stage 2
 *
 * @param {BrepShape} brepShape
 * @param {{minFeatureSize?:number, tolerance?:number}} [opts]
 *        minFeatureSize  size (mm) below which a face is "tiny" and removed
 *                        (drives `ShapeFix_FixSmallFace` precision).
 *                        Default 1.0 mm.
 *        tolerance       linear tolerance (mm) for the same-domain merge.
 * @returns {Promise<BrepShape>}
 */
export async function simplify(brepShape, opts = {}) {
  if (!brepShape || !brepShape.shape) throw new Error('simplify: needs a BrepShape');
  const oc = await getOCCT();
  const minFeatureSize = opts.minFeatureSize > 0 ? opts.minFeatureSize : 1.0;
  const tolerance = opts.tolerance > 0 ? opts.tolerance : 0;
  return withScope(() => {
    const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
    const EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;

    const facesBefore = countSubShapes(oc, brepShape.shape, FACE);
    const edgesBefore = countSubShapes(oc, brepShape.shape, EDGE);

    // ── Stage 1: small-feature removal — ShapeFix_FixSmallFace ──
    // Init(shape) + SetPrecision(minFeatureSize) + Perform() ; the cleaned
    // shape is read from FixShape() (Perform returns void). Guarded — if the
    // class misbehaves on a given input, Stage 2 still simplifies.
    let stage1Shape = brepShape.shape;
    let facesAfterStage1 = facesBefore;
    let edgesAfterStage1 = edgesBefore;
    try {
      const smallFaceFix = track(new oc.ShapeFix_FixSmallFace());
      smallFaceFix.Init(brepShape.shape);
      if (typeof smallFaceFix.SetPrecision === 'function') {
        smallFaceFix.SetPrecision(minFeatureSize);
      }
      // SetMaxTolerance bounds how far a small face's vertices may be merged.
      if (typeof smallFaceFix.SetMaxTolerance === 'function') {
        try { smallFaceFix.SetMaxTolerance(Math.max(minFeatureSize, 1)); } catch { /* opt */ }
      }
      smallFaceFix.Perform();
      const fixed = smallFaceFix.FixShape();
      if (fixed && !fixed.IsNull()) {
        stage1Shape = track(fixed);
        facesAfterStage1 = countSubShapes(oc, stage1Shape, FACE);
        edgesAfterStage1 = countSubShapes(oc, stage1Shape, EDGE);
      }
    } catch {
      // ShapeFix_FixSmallFace failed on this input — Stage 2 alone still
      // simplifies (no tiny-feature removal this run).
      stage1Shape = brepShape.shape;
      facesAfterStage1 = facesBefore;
      edgesAfterStage1 = edgesBefore;
    }

    // ── Stage 2: same-domain merge — ShapeUpgrade_UnifySameDomain ──
    const unifier = track(new oc.ShapeUpgrade_UnifySameDomain_2(
      stage1Shape, true, true, false));
    if (tolerance > 0 && typeof unifier.SetLinearTolerance === 'function') {
      try { unifier.SetLinearTolerance(tolerance); } catch { /* not bound */ }
    }
    unifier.Build();
    const shape = unifier.Shape();
    if (!shape || shape.IsNull()) throw new Error('simplify: kernel produced a null shape');

    const facesAfter = countSubShapes(oc, shape, FACE);
    const edgesAfter = countSubShapes(oc, shape, EDGE);

    // Stage-1 removed tiny faces; Stage-2 merged same-domain faces.
    const removedFaces = Math.max(0, facesBefore - facesAfterStage1);
    const removedEdges = Math.max(0, edgesBefore - edgesAfter);
    const facesMerged = Math.max(0, facesAfterStage1 - facesAfter);
    const edgesMerged = Math.max(0, edgesAfterStage1 - edgesAfter);

    const result = new BrepShape(shape, { op: 'simplify', parents: [brepShape.id] });
    result.meta.params = { minFeatureSize, tolerance };
    result.meta.stats = {
      // "features removed" = tiny faces dropped + the small edges that went
      // with them; this is the headline §3.5 metric the handler reports.
      removedFeatures: removedFaces + Math.max(0, edgesBefore - edgesAfterStage1),
      removedFaces,
      removedEdges,
      facesBefore,
      facesAfter,
      edgesBefore,
      edgesAfter,
      facesMerged,
      edgesMerged,
    };
    return result;
  });
}
