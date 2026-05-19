/**
 * ArchDisc Kernel — B-rep primitive solids (OCCT-backed).
 * A0 scope: box only. A1 adds cylinder/sphere/cone/torus.
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Make an axis-aligned box solid with one corner at the origin.
 * @param {number} dx  size along X (mm)
 * @param {number} dy  size along Y (mm)
 * @param {number} dz  size along Z (mm)
 * @returns {Promise<BrepShape>}
 */
export async function makeBox(dx, dy, dz) {
  if (!(dx > 0 && dy > 0 && dz > 0)) {
    throw new Error(`makeBox: dimensions must be positive (got ${dx}, ${dy}, ${dz})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz));
    if (!maker.IsDone()) throw new Error('makeBox: OCCT BRepPrimAPI_MakeBox failed');
    const shape = maker.Shape(); // survives — owned by the returned BrepShape
    return new BrepShape(shape, { op: 'makeBox', params: { dx, dy, dz } });
  });
}
