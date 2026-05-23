/**
 * ArchDisc Kernel — B-rep primitive solids.
 *
 * SP-1 S2 — `makeBox` was the canonical FIRST op migration to the topology
 * spine: it constructs a `SpineBody` (Body→Lump→Shell→Face→Loop→Coedge→Edge→
 * Vertex bound from the engine TopoDS_Shape) instead of a raw BrepShape.
 *
 * SP-1 S3 — every remaining primitive (`makeCylinder/makeSphere/makeCone/
 * makeTorus`) is now migrated to the same pattern. Each produces a fully-bound
 * spine body — the cylinder (3 faces / 3 edges / 2 vertices: side + 2 caps),
 * sphere (1 face / 1 seam edge / 2 degenerate poles → 2 vertices, χ=2 via
 * degenerate-edge exclusion), cone (3 or 2 faces / 2-3 edges), torus (1 face /
 * 2 seam edges / 1 vertex, χ=0 — a real genus-1 body, the most exotic
 * topological case shipping in S3).
 *
 * Because `SpineBody` is duck-compatible with `BrepShape` (.shape/.id/.meta +
 * dispose + _triangulation), every downstream consumer (`brepToMesh`,
 * `measure`, `addBrepShapeToScene`, `selectedBrepShapes`, `withScope` survivor
 * detection) treats a SpineBody-returning primitive identically to a legacy
 * BrepShape-returning one — proven end-to-end by the S2 makeBox e2e and now
 * exercised by S3's primitive coverage.
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
      // S5 — every primitive DECLARES its result kind first-class.
      declaredKind: 'solid',
    });
    return new SpineBody(body, wrapper, meta);
  });
}

/**
 * Make a cylinder solid (axis = +Z, base at origin).
 *
 * Spine topology — 3 faces (side, top cap, bottom cap), 3 edges (top circle,
 * bottom circle, vertical seam — the side face wraps around so it has a seam
 * edge), 2 vertices (one on the seam on top, one on the seam on bottom).
 *   V − E_real + F − R = 2 − 3 + 3 − 0 = 2 = 2(1 − 0) → genus 0. ✓
 *
 * @param {number} radius  (mm)
 * @param {number} height  (mm)
 * @returns {Promise<SpineBody>}
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
    const meta = { op: 'makeCylinder', params: { radius, height } };
    const wrapper = new BrepShape(shape, meta);
    const body = bindSpine(oc, shape, {
      bodyTag: `makeCylinder-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: 'solid',
    });
    return new SpineBody(body, wrapper, meta);
  });
}

/**
 * Make a sphere solid centred at the origin.
 *
 * Spine topology — 1 face (the whole sphere), 1 seam edge (where the
 * parametric u wraps), 2 degenerate pole edges (the north + south
 * singularities), 2 vertices (the two poles). Per Body.eulerCharacteristic,
 * degenerate edges are excluded from E (they are zero-length parametric
 * artefacts), so V − E_real + F = 2 − 1 + 1 = 2 → genus 0. ✓
 *
 * @param {number} radius  (mm)
 * @returns {Promise<SpineBody>}
 */
export async function makeSphere(radius) {
  if (!(radius > 0)) throw new Error(`makeSphere: radius must be positive (got ${radius})`);
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeSphere_1(radius));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('makeSphere: kernel produced a null shape');
    const meta = { op: 'makeSphere', params: { radius } };
    const wrapper = new BrepShape(shape, meta);
    const body = bindSpine(oc, shape, {
      bodyTag: `makeSphere-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: 'solid',
    });
    return new SpineBody(body, wrapper, meta);
  });
}

/**
 * Make a (truncated) cone solid (axis = +Z, base at origin).
 *
 * Spine topology — truncated cone: 3 faces (side + 2 caps), 3 edges
 * (top/bottom circles + seam), 2 vertices (seam endpoints). Sharp cone
 * (radius2 = 0): 2 faces (side + base), 2 edges (base circle + degenerate
 * apex), 2 vertices.
 *
 * @param {number} radius1  base radius (mm)
 * @param {number} radius2  top radius (mm); 0 for a sharp cone
 * @param {number} height   (mm)
 * @returns {Promise<SpineBody>}
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
    const meta = { op: 'makeCone', params: { radius1, radius2, height } };
    const wrapper = new BrepShape(shape, meta);
    const body = bindSpine(oc, shape, {
      bodyTag: `makeCone-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: 'solid',
    });
    return new SpineBody(body, wrapper, meta);
  });
}

/**
 * Make a torus solid (axis = +Z, centred at the origin).
 *
 * Spine topology — the most exotic primitive: 1 face, 2 seam edges (a u-seam
 * around the major circle, a v-seam around the minor tube), 1 vertex where
 * the seams meet. NO degenerate edges (a torus is non-singular).
 *   χ = V − E + F − R = 1 − 2 + 1 − 0 = 0 = 2(1 − 1) → genus 1. ✓
 * This is the canonical genus-1 body in the spine — the toroidal handle is
 * the topological signature.
 *
 * @param {number} majorRadius  ring radius (mm)
 * @param {number} minorRadius  tube radius (mm)
 * @returns {Promise<SpineBody>}
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
    const meta = { op: 'makeTorus', params: { majorRadius, minorRadius } };
    const wrapper = new BrepShape(shape, meta);
    const body = bindSpine(oc, shape, {
      bodyTag: `makeTorus-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: 'solid',
    });
    return new SpineBody(body, wrapper, meta);
  });
}
