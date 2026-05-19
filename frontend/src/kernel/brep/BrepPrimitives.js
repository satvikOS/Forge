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
    // IsDone() may return false on some opencascade.js builds before
    // Shape() is called (the build happens lazily). Check the shape instead.
    const shape = maker.Shape();
    if (!shape || shape.IsNull()) {
      throw new Error('makeBox: OCCT BRepPrimAPI_MakeBox produced a null shape');
    }
    return new BrepShape(shape, { op: 'makeBox', params: { dx, dy, dz } });
  });
}
