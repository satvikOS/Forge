/**
 * ArchDisc Kernel — geometry healing & simplification (OCCT).
 * `simplify` merges adjacent faces lying on the same underlying surface
 * and removes the now-redundant seam/small edges. Volume is preserved;
 * face and edge counts typically drop.
 * Verified OCCT sequence: docs/superpowers/notes/occt-api-A4.md item 2.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Simplify a solid: unify coplanar faces and drop redundant edges
 * (OCCT ShapeUpgrade_UnifySameDomain). Volume is preserved.
 * @param {BrepShape} brepShape
 * @returns {Promise<BrepShape>}
 */
export async function simplify(brepShape) {
  if (!brepShape || !brepShape.shape) throw new Error('simplify: needs a BrepShape');
  const oc = await getOCCT();
  return withScope(() => {
    const unifier = track(new oc.ShapeUpgrade_UnifySameDomain_2(
      brepShape.shape, true, true, false));
    unifier.Build();
    const shape = unifier.Shape();
    if (shape.IsNull()) throw new Error('simplify: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'simplify', parents: [brepShape.id] });
  });
}
