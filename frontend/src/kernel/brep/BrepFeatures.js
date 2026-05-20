/**
 * ArchDisc Kernel — feature operations (OCCT): extrude, revolve, fillet,
 * chamfer. A1 extrude/revolve operate on an internally-built rectangular
 * profile; sketch-driven profiles are a later sub-project.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Build a planar rectangular face in the XY plane (z=0), corner at origin.
 * Returns the OCCT TopoDS_Face. All transient objects are track()ed in the
 * caller's scope.
 * @param {object} oc
 * @param {number} w  width  (mm, +X)
 * @param {number} h  height (mm, +Y)
 */
function buildRectFaceXY(oc, w, h) {
  const p0 = track(new oc.gp_Pnt_3(0, 0, 0));
  const p1 = track(new oc.gp_Pnt_3(w, 0, 0));
  const p2 = track(new oc.gp_Pnt_3(w, h, 0));
  const p3 = track(new oc.gp_Pnt_3(0, h, 0));
  const e0 = track(new oc.BRepBuilderAPI_MakeEdge_3(p0, p1)).Edge();
  const e1 = track(new oc.BRepBuilderAPI_MakeEdge_3(p1, p2)).Edge();
  const e2 = track(new oc.BRepBuilderAPI_MakeEdge_3(p2, p3)).Edge();
  const e3 = track(new oc.BRepBuilderAPI_MakeEdge_3(p3, p0)).Edge();
  const wireMaker = track(new oc.BRepBuilderAPI_MakeWire_1());
  wireMaker.Add_1(e0); wireMaker.Add_1(e1); wireMaker.Add_1(e2); wireMaker.Add_1(e3);
  const wire = wireMaker.Wire();
  const faceMaker = track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
  return faceMaker.Face();
}

/**
 * Extrude a rectangular profile into a box-like prism.
 * @param {number} w      profile width  (mm)
 * @param {number} h      profile height (mm)
 * @param {number} depth  extrusion distance along +Z (mm)
 * @returns {Promise<BrepShape>}
 */
export async function extrudeRect(w, h, depth) {
  if (!(w > 0 && h > 0 && depth > 0)) {
    throw new Error(`extrudeRect: w, h, depth must be positive (got ${w}, ${h}, ${depth})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const face = buildRectFaceXY(oc, w, h);
    const dir = track(new oc.gp_Vec_4(0, 0, depth));
    const maker = track(new oc.BRepPrimAPI_MakePrism_1(face, dir, false, true));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('extrudeRect: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'extrudeRect', params: { w, h, depth } });
  });
}

/**
 * Revolve a rectangular profile around the Z axis to make a ring/disc solid.
 * The profile sits in the XZ plane, offset from the axis by `innerR`.
 * @param {number} innerR  distance from Z axis to the profile's near edge (mm)
 * @param {number} width   profile radial width (mm, +X)
 * @param {number} height  profile height (mm, +Z)
 * @param {number} angleDeg revolution angle in degrees (e.g. 360 for a full ring)
 * @returns {Promise<BrepShape>}
 */
export async function revolveRect(innerR, width, height, angleDeg) {
  if (!(innerR >= 0 && width > 0 && height > 0 && angleDeg > 0 && angleDeg <= 360)) {
    throw new Error(`revolveRect: invalid params (got ${innerR}, ${width}, ${height}, ${angleDeg})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    // Rectangular profile in the XZ plane.
    const p0 = track(new oc.gp_Pnt_3(innerR, 0, 0));
    const p1 = track(new oc.gp_Pnt_3(innerR + width, 0, 0));
    const p2 = track(new oc.gp_Pnt_3(innerR + width, 0, height));
    const p3 = track(new oc.gp_Pnt_3(innerR, 0, height));
    const e0 = track(new oc.BRepBuilderAPI_MakeEdge_3(p0, p1)).Edge();
    const e1 = track(new oc.BRepBuilderAPI_MakeEdge_3(p1, p2)).Edge();
    const e2 = track(new oc.BRepBuilderAPI_MakeEdge_3(p2, p3)).Edge();
    const e3 = track(new oc.BRepBuilderAPI_MakeEdge_3(p3, p0)).Edge();
    const wireMaker = track(new oc.BRepBuilderAPI_MakeWire_1());
    wireMaker.Add_1(e0); wireMaker.Add_1(e1); wireMaker.Add_1(e2); wireMaker.Add_1(e3);
    const face = track(new oc.BRepBuilderAPI_MakeFace_15(wireMaker.Wire(), true)).Face();
    // Z axis.
    const origin = track(new oc.gp_Pnt_3(0, 0, 0));
    const zdir = track(new oc.gp_Dir_4(0, 0, 1));
    const axis = track(new oc.gp_Ax1_2(origin, zdir));
    const angleRad = angleDeg * Math.PI / 180;
    const maker = track(new oc.BRepPrimAPI_MakeRevol_1(face, axis, angleRad, false));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('revolveRect: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'revolveRect', params: { innerR, width, height, angleDeg } });
  });
}

/**
 * Walk every unique edge of a shape and invoke `addEdge(edge)` once per edge.
 * TopExp_Explorer double-counts shared edges, so dedup with IsSame() — the
 * same approach as BrepMeasure.countSubShapes.
 */
function forEachUniqueEdge(oc, shape, addEdge) {
  const ex = track(new oc.TopExp_Explorer_2(
    shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
  const seen = [];
  for (; ex.More(); ex.Next()) {
    const cur = track(ex.Current());
    if (seen.some((s) => s.IsSame(cur))) continue;
    seen.push(cur);
    addEdge(track(oc.TopoDS.Edge_1(cur)));
  }
}

/**
 * Exact constant-radius fillet applied to ALL edges of a solid.
 * @param {BrepShape} brepShape
 * @param {number} radius  fillet radius (mm)
 * @returns {Promise<BrepShape>}
 */
export async function filletAll(brepShape, radius) {
  if (!brepShape || !brepShape.shape) throw new Error('filletAll: needs a BrepShape');
  if (!(radius > 0)) throw new Error(`filletAll: radius must be positive (got ${radius})`);
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepFilletAPI_MakeFillet(
      brepShape.shape, oc.ChFi3d_FilletShape.ChFi3d_Rational));
    forEachUniqueEdge(oc, brepShape.shape, (edge) => { maker.Add_2(radius, edge); });
    maker.Build(track(new oc.Message_ProgressRange_1()));
    if (!maker.IsDone()) throw new Error('filletAll: OCCT fillet did not complete');
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('filletAll: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'filletAll', params: { radius }, parents: [brepShape.id] });
  });
}

/**
 * Exact chamfer applied to ALL edges of a solid.
 * @param {BrepShape} brepShape
 * @param {number} distance  chamfer setback (mm)
 * @returns {Promise<BrepShape>}
 */
export async function chamferAll(brepShape, distance) {
  if (!brepShape || !brepShape.shape) throw new Error('chamferAll: needs a BrepShape');
  if (!(distance > 0)) throw new Error(`chamferAll: distance must be positive (got ${distance})`);
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepFilletAPI_MakeChamfer(brepShape.shape));
    forEachUniqueEdge(oc, brepShape.shape, (edge) => { maker.Add_2(distance, edge); });
    maker.Build(track(new oc.Message_ProgressRange_1()));
    if (!maker.IsDone()) throw new Error('chamferAll: OCCT chamfer did not complete');
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('chamferAll: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'chamferAll', params: { distance }, parents: [brepShape.id] });
  });
}

/**
 * Variable-radius fillet on ALL edges of a solid: the radius ramps
 * linearly from `r1` at one end of each edge to `r2` at the other.
 * @param {BrepShape} brepShape
 * @param {number} r1  start radius (mm)
 * @param {number} r2  end radius (mm)
 * @returns {Promise<BrepShape>}
 */
export async function variableFillet(brepShape, r1, r2) {
  if (!brepShape || !brepShape.shape) throw new Error('variableFillet: needs a BrepShape');
  if (!(r1 > 0 && r2 > 0)) throw new Error(`variableFillet: r1, r2 must be positive (got ${r1}, ${r2})`);
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepFilletAPI_MakeFillet(
      brepShape.shape, oc.ChFi3d_FilletShape.ChFi3d_Rational));
    forEachUniqueEdge(oc, brepShape.shape, (edge) => { maker.Add_3(r1, r2, edge); });
    maker.Build(track(new oc.Message_ProgressRange_1()));
    if (!maker.IsDone()) throw new Error('variableFillet: OCCT fillet did not complete');
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('variableFillet: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'variableFillet', params: { r1, r2 }, parents: [brepShape.id] });
  });
}
