/**
 * ArchDisc Kernel — advanced boolean operations (OCCT multi-arg + fuzzy).
 *
 * Verified API: docs/superpowers/notes/occt-api-B.md (2026-05-19).
 * All constructor variants and call sequences are empirically confirmed.
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Multi-argument boolean union via OCCT BRepAlgoAPI_BuilderAlgo — single-pass
 * across N input shapes. Faster than sequential pairwise fuse and tolerates
 * shared faces / edges (non-manifold-friendly).
 * @param {BrepShape[]} brepShapes
 * @returns {Promise<BrepShape>}
 */
export async function fuseAll(brepShapes) {
  if (!Array.isArray(brepShapes) || brepShapes.length < 2) {
    throw new Error('fuseAll: needs an array of at least two BrepShapes');
  }
  for (const s of brepShapes) {
    if (!s || !s.shape) throw new Error('fuseAll: every entry must be a BrepShape with a live shape');
  }
  const oc = await getOCCT();
  return withScope(() => {
    // VERIFIED sequence — BRepAlgoAPI_BuilderAlgo_1 multi-arg boolean
    // (occt-api-B.md Capability 1). Build() requires exactly 1 arg
    // (Message_ProgressRange); 0-arg throws BindingError.
    const list = track(new oc.TopTools_ListOfShape_1());
    for (const s of brepShapes) list.Append_1(s.shape);

    const builder = track(new oc.BRepAlgoAPI_BuilderAlgo_1());
    builder.SetArguments(list);

    builder.Build(track(new oc.Message_ProgressRange_1()));
    if (!builder.IsDone()) throw new Error('fuseAll: BRepAlgoAPI_BuilderAlgo did not complete');
    const shape = builder.Shape();
    if (shape.IsNull()) throw new Error('fuseAll: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'fuseAll', parents: brepShapes.map(s => s.id) });
  });
}

/**
 * Non-manifold-tolerant fuse of two shapes that may share a face/edge.
 * Delegates to fuseAll (the multi-arg builder handles non-manifold inputs).
 * @param {BrepShape} a
 * @param {BrepShape} b
 * @returns {Promise<BrepShape>}
 */
export async function fuseNonManifold(a, b) {
  if (!a || !a.shape || !b || !b.shape) {
    throw new Error('fuseNonManifold: both operands must be BrepShapes with live shapes');
  }
  return fuseAll([a, b]);
}
