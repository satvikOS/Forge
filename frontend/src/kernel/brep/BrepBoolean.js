/**
 * ArchDisc Kernel — exact boolean operations (OCCT BRepAlgoAPI).
 * Operate on TopoDS_Shape solids; produce exact B-rep results.
 *
 * Verified API (docs/superpowers/notes/occt-api-A1.md items 5-7):
 * the BRepAlgoAPI_*_3 constructor takes (shape1, shape2, progressRange),
 * and an explicit .Build(progressRange) call is required.
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/** Shared boolean runner. `Ctor` is an OCCT BRepAlgoAPI_*_3 class. */
async function runBoolean(opName, Ctor, a, b) {
  if (!a || !a.shape || !b || !b.shape) {
    throw new Error(`${opName}: both operands must be BrepShapes with live shapes`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new Ctor(
      a.shape, b.shape, track(new oc.Message_ProgressRange_1())));
    maker.Build(track(new oc.Message_ProgressRange_1()));
    if (!maker.IsDone()) throw new Error(`${opName}: OCCT boolean did not complete`);
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error(`${opName}: OCCT produced a null shape`);
    return new BrepShape(shape, { op: opName, parents: [a.id, b.id] });
  });
}

/** Union of two solids (a ∪ b). */
export async function fuse(a, b) {
  const oc = await getOCCT();
  return runBoolean('fuse', oc.BRepAlgoAPI_Fuse_3, a, b);
}

/** Subtraction (a − b). */
export async function cut(a, b) {
  const oc = await getOCCT();
  return runBoolean('cut', oc.BRepAlgoAPI_Cut_3, a, b);
}

/** Intersection (a ∩ b). */
export async function common(a, b) {
  const oc = await getOCCT();
  return runBoolean('common', oc.BRepAlgoAPI_Common_3, a, b);
}
