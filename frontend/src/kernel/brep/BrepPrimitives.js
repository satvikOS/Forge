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

/**
 * Make a cylinder solid (axis = +Z, base at origin).
 * @param {number} radius  (mm)
 * @param {number} height  (mm)
 * @returns {Promise<BrepShape>}
 */
export async function makeCylinder(radius, height) {
  if (!(radius > 0 && height > 0)) {
    throw new Error(`makeCylinder: radius and height must be positive (got ${radius}, ${height})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeCylinder_1(radius, height));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('makeCylinder: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'makeCylinder', params: { radius, height } });
  });
}

/**
 * Make a sphere solid centred at the origin.
 * @param {number} radius  (mm)
 * @returns {Promise<BrepShape>}
 */
export async function makeSphere(radius) {
  if (!(radius > 0)) throw new Error(`makeSphere: radius must be positive (got ${radius})`);
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeSphere_1(radius));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('makeSphere: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'makeSphere', params: { radius } });
  });
}

/**
 * Make a (truncated) cone solid (axis = +Z, base at origin).
 * @param {number} radius1  base radius (mm)
 * @param {number} radius2  top radius (mm); 0 for a sharp cone
 * @param {number} height   (mm)
 * @returns {Promise<BrepShape>}
 */
export async function makeCone(radius1, radius2, height) {
  if (!(radius1 >= 0 && radius2 >= 0 && height > 0) || (radius1 === 0 && radius2 === 0)) {
    throw new Error(`makeCone: invalid radii/height (got ${radius1}, ${radius2}, ${height})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeCone_1(radius1, radius2, height));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('makeCone: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'makeCone', params: { radius1, radius2, height } });
  });
}

/**
 * Make a torus solid (axis = +Z, centred at the origin).
 * @param {number} majorRadius  ring radius (mm)
 * @param {number} minorRadius  tube radius (mm)
 * @returns {Promise<BrepShape>}
 */
export async function makeTorus(majorRadius, minorRadius) {
  if (!(majorRadius > 0 && minorRadius > 0 && minorRadius < majorRadius)) {
    throw new Error(`makeTorus: need 0 < minorRadius < majorRadius (got ${majorRadius}, ${minorRadius})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeTorus_1(majorRadius, minorRadius));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('makeTorus: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'makeTorus', params: { majorRadius, minorRadius } });
  });
}
