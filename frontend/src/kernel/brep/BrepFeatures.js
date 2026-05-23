/**
 * ArchDisc Kernel — feature operations: extrude, revolve, fillet,
 * chamfer.
 *
 * SP-1 S4 (features subset) — every op here is spine-aware:
 *   1. Run the engine algorithm (BRepPrimAPI_MakePrism / MakeRevol /
 *      BRepFilletAPI_MakeFillet / MakeChamfer — geometry unchanged).
 *   2. Bind the result shape to a spine `Body` via `bindSpine`.
 *   3. Carry persistent-ID lineage through using the algorithm's
 *      `Modified` / `Generated` / `IsDeleted` history maps
 *      (`BRepBuilderAPI_MakeShape` base contract — confirmed for prism /
 *      revol via the base class, native on `BRepFilletAPI_LocalOperation`).
 *   4. Wrap in a `SpineBody`.
 *
 * Input contract — every op accepts SpineBody or legacy BrepShape (the
 * mixed-currency adapter from SP-1 §5). When the input is a SpineBody
 * its persistent ids carry through; when it is a raw BrepShape the
 * result still spines + validates correctly but the lineage map has
 * no input ids to carry — the result entities receive freshly-allocated
 * ids from bindSpine.
 *
 * For extrude / revolve there is no "input body" in the boolean sense —
 * the profile is a transient face built internally. We spine that
 * profile face into a temporary sheet body so its faces / edges /
 * vertices have persistent ids; then the prism / revol's lineage
 * propagation can carry those ids onto the result solid (bottom +
 * top cap, lateral faces generated from each profile edge).
 *
 * Verified kernel sequences: docs/superpowers/notes/kernel-api-A1.md.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { carryLineage } from '../topology/IdLineage.js';

/**
 * Build a planar rectangular face in the XY plane (z=0), corner at origin.
 * Returns the kernel TopoDS_Face. All transient objects are track()ed in the
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
 *
 * SP-1 S4 — returns a SpineBody. The profile face is spined as a
 * temporary sheet body so the prism's `Modified` / `Generated` history
 * can propagate its face / edge / vertex persistent ids onto the
 * resulting solid (the prism's bottom cap is the profile face; the
 * top cap is its Modified; the lateral faces are Generated from each
 * profile edge — the canonical extrude lineage contract).
 *
 * @param {number} w      profile width  (mm)
 * @param {number} h      profile height (mm)
 * @param {number} depth  extrusion distance along +Z (mm)
 * @returns {Promise<SpineBody>}
 */
export async function extrudeRect(w, h, depth) {
  if (!(w > 0 && h > 0 && depth > 0)) {
    throw new Error(`extrudeRect: w, h, depth must be positive (got ${w}, ${h}, ${depth})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const face = buildRectFaceXY(oc, w, h);
    // Spine the profile face into a temporary sheet body so its faces /
    // edges / vertices have persistent ids. This is the input body for
    // the prism's lineage propagation.
    const profileBody = bindSpine(oc, face, {
      bodyTag: 'extrudeProfile', validate: false,
    });
    const dir = track(new oc.gp_Vec_4(0, 0, depth));
    const maker = track(new oc.BRepPrimAPI_MakePrism_1(face, dir, false, true));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('extrudeRect: kernel produced a null shape');
    const meta = { op: 'extrudeRect', params: { w, h, depth } };
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: `extrudeRect-${wrapper.id}`, geomEngineShape: wrapper,
    });
    // Carry persistent ids from the profile sheet body through the prism.
    // The base `BRepBuilderAPI_MakeShape` exposes `Modified(S)` /
    // `Generated(S)` / `IsDeleted(S)` — `BRepPrimAPI_MakePrism` inherits all
    // three. The profile face's id propagates onto the bottom cap (S
    // survives as-is); its Modified yields the top cap; the lateral
    // faces created from each profile edge come via Generated.
    const lineage = carryLineage(oc, maker, resultBody, [
      { body: profileBody, role: 'arg' },
    ]);
    meta.lineage = {
      survived: lineage.survived, modified: lineage.modified,
      generated: lineage.generated, deleted: lineage.deleted,
      conflicts: lineage.conflicts,
      faceMap: [...lineage.faceMap.entries()].slice(0, 64),
    };
    return new SpineBody(resultBody, wrapper, meta);
  });
}

/**
 * Revolve a rectangular profile around the Z axis to make a ring/disc solid.
 * The profile sits in the XZ plane, offset from the axis by `innerR`.
 *
 * SP-1 S4 — returns a SpineBody. Lineage propagation pattern is identical
 * to `extrudeRect`'s — the profile face is spined, and the revol's
 * `Modified` / `Generated` carry its persistent ids onto the cap +
 * lateral / revolution faces of the resulting solid.
 *
 * @param {number} innerR  distance from Z axis to the profile's near edge (mm)
 * @param {number} width   profile radial width (mm, +X)
 * @param {number} height  profile height (mm, +Z)
 * @param {number} angleDeg revolution angle in degrees (e.g. 360 for a full ring)
 * @returns {Promise<SpineBody>}
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
    // Spine the profile face for lineage.
    const profileBody = bindSpine(oc, face, {
      bodyTag: 'revolveProfile', validate: false,
    });
    // Z axis.
    const origin = track(new oc.gp_Pnt_3(0, 0, 0));
    const zdir = track(new oc.gp_Dir_4(0, 0, 1));
    const axis = track(new oc.gp_Ax1_2(origin, zdir));
    const angleRad = angleDeg * Math.PI / 180;
    const maker = track(new oc.BRepPrimAPI_MakeRevol_1(face, axis, angleRad, false));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('revolveRect: kernel produced a null shape');
    const meta = { op: 'revolveRect', params: { innerR, width, height, angleDeg } };
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: `revolveRect-${wrapper.id}`, geomEngineShape: wrapper,
    });
    const lineage = carryLineage(oc, maker, resultBody, [
      { body: profileBody, role: 'arg' },
    ]);
    meta.lineage = {
      survived: lineage.survived, modified: lineage.modified,
      generated: lineage.generated, deleted: lineage.deleted,
      conflicts: lineage.conflicts,
      faceMap: [...lineage.faceMap.entries()].slice(0, 64),
    };
    return new SpineBody(resultBody, wrapper, meta);
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
 * Shared fillet/chamfer runner — SP-1 S4 spine-aware path.
 *   1. Run the engine `BRepFilletAPI_*` builder (Build + IsDone).
 *   2. Bind the result shape into a spine Body.
 *   3. Carry the input body's persistent ids onto the result via
 *      `carryLineage` consuming the algo's `Modified(F)` / `Generated(E or V)` /
 *      `IsDeleted(F)` — the `BRepFilletAPI_LocalOperation` history contract.
 *      Faces of the source body that survived the fillet keep their ids;
 *      faces that were Modified (e.g. trimmed near the new fillet face)
 *      record the source id in `derivedFrom`; new rolling-ball fillet
 *      surfaces are Generated from their seed edges, so the seed edge's
 *      id lands in `derivedFrom` of the new face.
 *   4. Wrap in a SpineBody.
 *
 * @param {string} opName       'filletAll' | 'chamferAll' | 'variableFillet' |
 *                              'cliffEdgeBlend' | 'mitreCorner'
 * @param {object} src          input SpineBody | BrepShape — `.shape` + optional `.body`.
 * @param {object} maker        the BRepFilletAPI_* algo, edges already added.
 * @param {object} meta         result meta — op + params, parents.
 * @returns {SpineBody}
 */
function bindFeatureResult(oc, opName, src, maker, meta) {
  maker.Build(track(new oc.Message_ProgressRange_1()));
  if (!maker.IsDone()) throw new Error(`${opName}: ${opName} did not complete`);
  const shape = maker.Shape();
  if (shape.IsNull()) throw new Error(`${opName}: kernel produced a null shape`);
  const wrapper = new BrepShape(shape, meta);
  const resultBody = bindSpine(oc, shape, {
    bodyTag: `${opName}-${wrapper.id}`, geomEngineShape: wrapper,
  });
  if (src.body) {
    const lineage = carryLineage(oc, maker, resultBody, [
      { body: src.body, role: 'arg' },
    ]);
    meta.lineage = {
      survived: lineage.survived, modified: lineage.modified,
      generated: lineage.generated, deleted: lineage.deleted,
      conflicts: lineage.conflicts,
      faceMap: [...lineage.faceMap.entries()].slice(0, 64),
    };
  }
  return new SpineBody(resultBody, wrapper, meta);
}

/**
 * Exact constant-radius fillet applied to ALL edges of a solid.
 *
 * SP-1 S4 — returns a SpineBody. The `BRepFilletAPI_MakeFillet` algorithm
 * exposes `Modified(F)`, `Generated(EorV)`, `IsDeleted(F)` (verified in
 * the opencascade.js TypeScript definitions); the source body's face /
 * edge / vertex persistent ids carry onto the result, and new rolling-
 * ball fillet faces record their seed edge in `derivedFrom`.
 *
 * @param {SpineBody|BrepShape} src
 * @param {number} radius  fillet radius (mm)
 * @returns {Promise<SpineBody>}
 */
export async function filletAll(src, radius) {
  if (!src || !src.shape) throw new Error('filletAll: needs a SpineBody or BrepShape');
  if (!(radius > 0)) throw new Error(`filletAll: radius must be positive (got ${radius})`);
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepFilletAPI_MakeFillet(
      src.shape, oc.ChFi3d_FilletShape.ChFi3d_Rational));
    forEachUniqueEdge(oc, src.shape, (edge) => { maker.Add_2(radius, edge); });
    const meta = { op: 'filletAll', params: { radius }, parents: [src.id] };
    return bindFeatureResult(oc, 'filletAll', src, maker, meta);
  });
}

/**
 * Exact chamfer applied to ALL edges of a solid.
 *
 * SP-1 S4 — returns a SpineBody. `BRepFilletAPI_MakeChamfer` inherits the
 * same `Modified` / `Generated` / `IsDeleted` history surface from
 * `BRepFilletAPI_LocalOperation`; lineage carry is identical to filletAll.
 *
 * @param {SpineBody|BrepShape} src
 * @param {number} distance  chamfer setback (mm)
 * @returns {Promise<SpineBody>}
 */
export async function chamferAll(src, distance) {
  if (!src || !src.shape) throw new Error('chamferAll: needs a SpineBody or BrepShape');
  if (!(distance > 0)) throw new Error(`chamferAll: distance must be positive (got ${distance})`);
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepFilletAPI_MakeChamfer(src.shape));
    forEachUniqueEdge(oc, src.shape, (edge) => { maker.Add_2(distance, edge); });
    const meta = { op: 'chamferAll', params: { distance }, parents: [src.id] };
    return bindFeatureResult(oc, 'chamferAll', src, maker, meta);
  });
}

/**
 * Variable-radius fillet on ALL edges of a solid: the radius ramps
 * linearly from `r1` at one end of each edge to `r2` at the other.
 *
 * SP-1 S4 — returns a SpineBody. Lineage carry identical to filletAll.
 *
 * @param {SpineBody|BrepShape} src
 * @param {number} r1  start radius (mm)
 * @param {number} r2  end radius (mm)
 * @returns {Promise<SpineBody>}
 */
export async function variableFillet(src, r1, r2) {
  if (!src || !src.shape) throw new Error('variableFillet: needs a SpineBody or BrepShape');
  if (!(r1 > 0 && r2 > 0)) throw new Error(`variableFillet: r1, r2 must be positive (got ${r1}, ${r2})`);
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepFilletAPI_MakeFillet(
      src.shape, oc.ChFi3d_FilletShape.ChFi3d_Rational));
    forEachUniqueEdge(oc, src.shape, (edge) => { maker.Add_3(r1, r2, edge); });
    const meta = { op: 'variableFillet', params: { r1, r2 }, parents: [src.id] };
    return bindFeatureResult(oc, 'variableFillet', src, maker, meta);
  });
}
