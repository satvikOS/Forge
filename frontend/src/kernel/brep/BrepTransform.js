/**
 * ArchDisc Kernel — shape transforms & combination.
 * Verified OCCT sequences: docs/superpowers/notes/occt-api-A3.md.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Translate a shape by (dx, dy, dz) mm.
 * Verified OCCT sequence: occt-api-A3.md Item 3 —
 *   gp_Trsf_1() + SetTranslation_1(gp_Vec_4) + BRepBuilderAPI_Transform_2(shape, trsf, true)
 * @param {BrepShape} brepShape
 * @param {number} dx
 * @param {number} dy
 * @param {number} dz
 * @returns {Promise<BrepShape>}
 */
export async function translate(brepShape, dx, dy, dz) {
  if (!brepShape || !brepShape.shape) throw new Error('translate: needs a BrepShape');
  const oc = await getOCCT();
  return withScope(() => {
    // Verified sequence from occt-api-A3.md Item 3:
    // gp_Trsf_1() no-arg constructor; SetTranslation_1(gp_Vec) takes a gp_Vec
    // gp_Vec_4 = 3-double constructor (verified in A3 recon)
    // BRepBuilderAPI_Transform_2(shape, trsf, copy=true) — copy=true gives
    // a geometry-independent result so disposing the input cannot corrupt it.
    const trsf = track(new oc.gp_Trsf_1());
    const vec = track(new oc.gp_Vec_4(dx, dy, dz));
    trsf.SetTranslation_1(vec);
    const tf = track(new oc.BRepBuilderAPI_Transform_2(brepShape.shape, trsf, true));
    const shape = tf.Shape();
    if (!shape || shape.IsNull()) throw new Error('translate: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'translate', params: { dx, dy, dz }, parents: [brepShape.id] });
  });
}

/**
 * Combine multiple shapes into a single compound shape.
 * Verified OCCT sequence: occt-api-A3.md Items 2/8 —
 *   TopoDS_Compound() (undecorated) + BRep_Builder() (undecorated) +
 *   MakeCompound(compound) + Add(compound, shape) for each shape.
 * @param {BrepShape[]} brepShapes
 * @returns {Promise<BrepShape>}
 */
export async function makeCompound(brepShapes) {
  if (!Array.isArray(brepShapes) || brepShapes.length === 0) {
    throw new Error('makeCompound: needs a non-empty array of BrepShapes');
  }
  for (const s of brepShapes) {
    if (!s || !s.shape) throw new Error('makeCompound: every entry must be a BrepShape with a live shape');
  }
  const oc = await getOCCT();
  return withScope(() => {
    // Verified sequence from occt-api-A3.md Items 2 & 8:
    // TopoDS_Compound (undecorated, no _N suffix) + BRep_Builder (undecorated)
    // MakeCompound initializes the compound; Add appends each shape
    const compound = track(new oc.TopoDS_Compound());
    const builder = track(new oc.BRep_Builder());
    builder.MakeCompound(compound);
    for (const s of brepShapes) {
      builder.Add(compound, s.shape);
    }
    // compound IS the TopoDS_Shape result
    const shape = compound;
    if (!shape || shape.IsNull()) throw new Error('makeCompound: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'makeCompound', parents: brepShapes.map(s => s.id) });
  });
}
