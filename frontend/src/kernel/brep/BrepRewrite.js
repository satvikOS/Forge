/**
 * ArchDisc Kernel — topology rewriting.
 * Verified kernel sequence: docs/superpowers/notes/kernel-api-B.md Capability 4.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Replace one face of a shape with a topologically-equivalent copy of itself
 * via BRepTools_ReShape — demonstrates local face replacement. The result is
 * a valid solid with the original face count and volume.
 *
 * Verified sequence (kernel-api-B.md Capability 4):
 *  1. Walk faces with TopExp_Explorer_2 (TopAbs_FACE, TopAbs_SHAPE) to the
 *     faceIndex-th face (1-based). Deduplicate via IsSame to avoid counting
 *     the same face twice.
 *  2. Clone via BRepBuilderAPI_Transform_2(face, identity_trsf, true).Shape()
 *  3. BRepTools_ReShape() + Replace(oldFace, newFace)
 *  4. Apply(rootShape, TopAbs_ShapeEnum.TopAbs_SHAPE) — 2-arg form required;
 *     1-arg throws BindingError.
 * Evidence: 6-face box, replace face #1 → 6 faces, vol≈8000 mm³ ✓
 *
 * @param {BrepShape} brepShape
 * @param {number} faceIndex  1-based index into TopExp_Explorer face order
 * @returns {Promise<BrepShape>}
 */
export async function replaceFace(brepShape, faceIndex = 1) {
  if (!brepShape || !brepShape.shape) throw new Error('replaceFace: needs a BrepShape');
  if (!(Number.isInteger(faceIndex) && faceIndex >= 1)) {
    throw new Error(`replaceFace: faceIndex must be a positive integer (got ${faceIndex})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const FACE  = oc.TopAbs_ShapeEnum.TopAbs_FACE;
    const ANY   = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;

    // Walk faces — deduplicate with IsSame (mirrors recon spec exactly).
    const faces = [];
    const exp = track(new oc.TopExp_Explorer_2(brepShape.shape, FACE, ANY));
    for (; exp.More(); exp.Next()) {
      const f = exp.Current();
      let dup = false;
      for (const prev of faces) {
        try { if (prev.IsSame(f)) { dup = true; break; } } catch (_e) { /* ignore */ }
      }
      if (!dup) {
        try { faces.push(track(oc.TopoDS.Face_1(f))); } catch (_e) { faces.push(track(f)); }
      }
    }

    if (faceIndex > faces.length) {
      throw new Error(`replaceFace: faceIndex=${faceIndex} but shape has only ${faces.length} faces`);
    }

    // Target face is 1-based
    const oldFace = faces[faceIndex - 1];

    // Identity-copy of the target face via BRepBuilderAPI_Transform_2
    // (verified: BRepBuilderAPI_Transform_2(shape, trsf, copy=true))
    const trsf = track(new oc.gp_Trsf_1()); // identity transform
    const copyBuilder = track(new oc.BRepBuilderAPI_Transform_2(oldFace, trsf, true));
    const newFace = copyBuilder.Shape();

    // Register replacement and apply to root shape
    const reshape = track(new oc.BRepTools_ReShape());
    reshape.Replace(oldFace, newFace);

    // MUST pass TopAbs_SHAPE as second arg — 1-arg Apply throws BindingError
    const shape = reshape.Apply(brepShape.shape, ANY);

    if (shape.IsNull()) throw new Error('replaceFace: kernel produced a null shape');
    return new BrepShape(shape, { op: 'replaceFace', params: { faceIndex }, parents: [brepShape.id] });
  });
}
