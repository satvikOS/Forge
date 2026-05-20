/**
 * ArchDisc Kernel — advanced boolean operations (OCCT multi-arg + fuzzy).
 *
 * Verified API: docs/superpowers/notes/occt-api-B.md (2026-05-19).
 * All constructor variants and call sequences are empirically confirmed.
 */

import { getOCCT } from './kernelLoader.js';
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

/**
 * Robustly fuse two solids whose touching faces are coincident within a
 * tolerance. Uses BRepAlgoAPI_Fuse_3 + SetFuzzyValue (before Build).
 *
 * Verified sequence: docs/superpowers/notes/occt-api-B.md Capability 2.
 * BRepAlgoAPI_Fuse_3(shapeA, shapeB, pr1) constructs + does internal init,
 * then SetFuzzyValue(tol) before Build(pr2) bridges near-coincident gaps.
 * Evidence: gap=0.001mm, fuzzy=0.01 → faceCount 12→10, vol≈16000.27 ✓
 *
 * @param {BrepShape} a
 * @param {BrepShape} b
 * @param {number} [tolerance]  fuzzy tolerance (mm), default 0.01
 * @returns {Promise<BrepShape>}
 */
export async function fuseCoincident(a, b, tolerance = 0.01) {
  if (!a || !a.shape || !b || !b.shape) {
    throw new Error('fuseCoincident: both operands must be BrepShapes with live shapes');
  }
  if (!(tolerance > 0)) throw new Error(`fuseCoincident: tolerance must be positive (got ${tolerance})`);
  const oc = await getOCCT();
  return withScope(() => {
    // VERIFIED sequence — occt-api-B.md Capability 2, exact call order:
    // 1. BRepAlgoAPI_Fuse_3(shapeA, shapeB, pr1) — 3-arg ctor (shape + pr)
    // 2. SetFuzzyValue(tolerance) — BEFORE Build
    // 3. Build(pr2)
    // 4. IsDone() + HasErrors() + Shape()
    const pr1 = track(new oc.Message_ProgressRange_1());
    const fuse = track(new oc.BRepAlgoAPI_Fuse_3(a.shape, b.shape, pr1));

    // Set fuzzy tolerance BEFORE Build — bridges the near-coincident gap
    fuse.SetFuzzyValue(tolerance);

    fuse.Build(track(new oc.Message_ProgressRange_1()));
    if (!fuse.IsDone()) throw new Error('fuseCoincident: BRepAlgoAPI_Fuse did not complete');
    const shape = fuse.Shape();
    if (shape.IsNull()) throw new Error('fuseCoincident: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'fuseCoincident', params: { tolerance }, parents: [a.id, b.id] });
  });
}

/**
 * Fuse N lattice members into one solid via a single BOPAlgo_Builder pass.
 * Mechanically delegates to fuseAll; the dedicated name surfaces the
 * lattice-intersection capability and validates ≥4 members.
 *
 * Verified: occt-api-B.md Capability 3 — 8-shape single-pass fuse,
 * vol=720 mm³ exactly in 42ms (non-overlapping 2×2×2 grid of 10×3×3 boxes).
 *
 * @param {BrepShape[]} members
 * @returns {Promise<BrepShape>}
 */
export async function fuseLattice(members) {
  if (!Array.isArray(members) || members.length < 4) {
    throw new Error('fuseLattice: needs at least 4 lattice member BrepShapes');
  }
  return fuseAll(members);
}
