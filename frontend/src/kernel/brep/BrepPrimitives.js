/**
 * ArchDisc Kernel — B-rep primitive solids.
 * A0 scope: box only. A1 adds cylinder/sphere/cone/torus.
 *
 * SP-1 S2 — `makeBox` is the canonical FIRST op migration to the topology
 * spine: it now constructs a `SpineBody` (Body→Lump→Shell→Face→Loop→Coedge→
 * Edge→Vertex bound from the engine TopoDS_Shape) instead of a raw BrepShape.
 * Because `SpineBody` is duck-compatible with `BrepShape` (.shape/.id/.meta
 * + dispose + _triangulation), the downstream scene path is unchanged — the
 * spine is genuinely built end-to-end (facade → scene → window.__lastSpine →
 * e2e) without behaviour regression. The other primitives stay BrepShape
 * until S3, exercising the mixed-currency adapter contract.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';

/**
 * Make an axis-aligned box solid with one corner at the origin.
 *
 * @param {number} dx  size along X (mm)
 * @param {number} dy  size along Y (mm)
 * @param {number} dz  size along Z (mm)
 * @returns {Promise<SpineBody>}  the box wrapped in a SpineBody — the SP-1
 *   currency. SpineBody is duck-compatible with BrepShape (it exposes .shape /
 *   .id / .meta / .dispose / ._triangulation), so every downstream consumer
 *   (`brepToMesh`, `measure`, `addBrepShapeToScene`, `selectedBrepShapes`,
 *   `withScope` survivor detection) treats it identically to a BrepShape.
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
      throw new Error('makeBox: kernel BRepPrimAPI_MakeBox produced a null shape');
    }
    const meta = { op: 'makeBox', params: { dx, dy, dz } };
    const wrapper = new BrepShape(shape, meta);
    // Bind the spine — populates Body→Lump→Shell→Face→Loop→Coedge→Edge→Vertex
    // from the engine shape, attaches `geomRef` back-pointers, allocates a
    // per-body persistent-ID namespace (a unit box spine: 8 V, 12 E, 24 CE,
    // 6 F, 6 L, 1 S, 1 lump), runs validateSpine, attaches the report on
    // body.diagnostics.validation. bindSpine only READS the shape — never
    // mutates it — so the geometry path cannot regress (SP-1 §5.2).
    const body = bindSpine(oc, shape, {
      bodyTag: `makeBox-${wrapper.id}`, geomEngineShape: wrapper,
    });
    return new SpineBody(body, wrapper, meta);
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
    if (shape.IsNull()) throw new Error('makeCylinder: kernel produced a null shape');
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
    if (shape.IsNull()) throw new Error('makeSphere: kernel produced a null shape');
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
    if (shape.IsNull()) throw new Error('makeCone: kernel produced a null shape');
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
    if (shape.IsNull()) throw new Error('makeTorus: kernel produced a null shape');
    return new BrepShape(shape, { op: 'makeTorus', params: { majorRadius, minorRadius } });
  });
}
