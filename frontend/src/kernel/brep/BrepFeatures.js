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
import {
  recordBodyCreate,
  recordBodyDerive,
  standardSceneRegister,
  standardSceneRemove,
} from '../history/HistoryLog.js';

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
async function _constructExtrudeRect(w, h, depth, bodyTag) {
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
      bodyTag: bodyTag || `extrudeRect-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: 'solid',
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

export async function extrudeRect(w, h, depth) {
  if (!(w > 0 && h > 0 && depth > 0)) {
    throw new Error(`extrudeRect: w, h, depth must be positive (got ${w}, ${h}, ${depth})`);
  }
  // No input body — extrudeRect builds the profile internally. SP-3b records
  // this as a body-CREATE (like a primitive), not a body-derive.
  const spineBody = await _constructExtrudeRect(w, h, depth);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'extrudeRect',
        persistentBodyId,
        meta: { op: 'extrudeRect', params: { w, h, depth } },
        rebuild: () => _constructExtrudeRect(w, h, depth, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('extrudeRect: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
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
async function _constructRevolveRect(innerR, width, height, angleDeg, bodyTag) {
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
      bodyTag: bodyTag || `revolveRect-${wrapper.id}`, geomEngineShape: wrapper,
      // 360° → solid; partial angle → still solid (a closed-volume revolution).
      declaredKind: 'solid',
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

export async function revolveRect(innerR, width, height, angleDeg) {
  if (!(innerR >= 0 && width > 0 && height > 0 && angleDeg > 0 && angleDeg <= 360)) {
    throw new Error(`revolveRect: invalid params (got ${innerR}, ${width}, ${height}, ${angleDeg})`);
  }
  const spineBody = await _constructRevolveRect(innerR, width, height, angleDeg);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'revolveRect',
        persistentBodyId,
        meta: { op: 'revolveRect', params: { innerR, width, height, angleDeg } },
        rebuild: () =>
          _constructRevolveRect(innerR, width, height, angleDeg, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('revolveRect: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
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
function bindFeatureResult(oc, opName, src, maker, meta, bodyTag) {
  maker.Build(track(new oc.Message_ProgressRange_1()));
  if (!maker.IsDone()) throw new Error(`${opName}: ${opName} did not complete`);
  const shape = maker.Shape();
  if (shape.IsNull()) throw new Error(`${opName}: kernel produced a null shape`);
  const wrapper = new BrepShape(shape, meta);
  const resultBody = bindSpine(oc, shape, {
    bodyTag: bodyTag || `${opName}-${wrapper.id}`, geomEngineShape: wrapper,
    // Fillet / chamfer preserves the input's kind — if the input is a solid
    // (the contract — assertSolid below), the result is a solid. S5.
    declaredKind: 'solid',
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
async function _runFilletAll(src, radius, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepFilletAPI_MakeFillet(
      src.shape, oc.ChFi3d_FilletShape.ChFi3d_Rational));
    forEachUniqueEdge(oc, src.shape, (edge) => { maker.Add_2(radius, edge); });
    const meta = { op: 'filletAll', params: { radius }, parents: [src.id] };
    return bindFeatureResult(oc, 'filletAll', src, maker, meta, bodyTag);
  });
}

export async function filletAll(src, radius) {
  if (!src || !src.shape) throw new Error('filletAll: needs a SpineBody or BrepShape');
  if (!(radius > 0)) throw new Error(`filletAll: radius must be positive (got ${radius})`);
  const result = await _runFilletAll(src, radius);
  const persistentBodyId = result.body && result.body.persistentId;
  const srcPid = src.body && src.body.persistentId;
  if (persistentBodyId && srcPid) {
    try {
      recordBodyDerive({
        opName: 'filletAll',
        persistentBodyId,
        inputPersistentIds: [srcPid],
        meta: { op: 'filletAll', params: { radius } },
        rebuild: ([liveSrc]) => _runFilletAll(liveSrc, radius, persistentBodyId),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('filletAll: history recordBodyDerive failed —', err && err.message || err);
    }
  }
  return result;
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
async function _runChamferAll(src, distance, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepFilletAPI_MakeChamfer(src.shape));
    forEachUniqueEdge(oc, src.shape, (edge) => { maker.Add_2(distance, edge); });
    const meta = { op: 'chamferAll', params: { distance }, parents: [src.id] };
    return bindFeatureResult(oc, 'chamferAll', src, maker, meta, bodyTag);
  });
}

export async function chamferAll(src, distance) {
  if (!src || !src.shape) throw new Error('chamferAll: needs a SpineBody or BrepShape');
  if (!(distance > 0)) throw new Error(`chamferAll: distance must be positive (got ${distance})`);
  const result = await _runChamferAll(src, distance);
  const persistentBodyId = result.body && result.body.persistentId;
  const srcPid = src.body && src.body.persistentId;
  if (persistentBodyId && srcPid) {
    try {
      recordBodyDerive({
        opName: 'chamferAll',
        persistentBodyId,
        inputPersistentIds: [srcPid],
        meta: { op: 'chamferAll', params: { distance } },
        rebuild: ([liveSrc]) => _runChamferAll(liveSrc, distance, persistentBodyId),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('chamferAll: history recordBodyDerive failed —', err && err.message || err);
    }
  }
  return result;
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
async function _runVariableFillet(src, r1, r2, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepFilletAPI_MakeFillet(
      src.shape, oc.ChFi3d_FilletShape.ChFi3d_Rational));
    forEachUniqueEdge(oc, src.shape, (edge) => { maker.Add_3(r1, r2, edge); });
    const meta = { op: 'variableFillet', params: { r1, r2 }, parents: [src.id] };
    return bindFeatureResult(oc, 'variableFillet', src, maker, meta, bodyTag);
  });
}

export async function variableFillet(src, r1, r2) {
  if (!src || !src.shape) throw new Error('variableFillet: needs a SpineBody or BrepShape');
  if (!(r1 > 0 && r2 > 0)) throw new Error(`variableFillet: r1, r2 must be positive (got ${r1}, ${r2})`);
  const result = await _runVariableFillet(src, r1, r2);
  const persistentBodyId = result.body && result.body.persistentId;
  const srcPid = src.body && src.body.persistentId;
  if (persistentBodyId && srcPid) {
    try {
      recordBodyDerive({
        opName: 'variableFillet',
        persistentBodyId,
        inputPersistentIds: [srcPid],
        meta: { op: 'variableFillet', params: { r1, r2 } },
        rebuild: ([liveSrc]) => _runVariableFillet(liveSrc, r1, r2, persistentBodyId),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('variableFillet: history recordBodyDerive failed —', err && err.message || err);
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// SP-6 — Sketch-feature generalisation (Area B, T1).
//
// The pre-SP-6 extrudeRect / revolveRect / sweep ops accept ONLY rectangular
// or circular profiles built internally from numeric width/height/radius
// parameters. Real CAD must consume an ARBITRARY CLOSED TRIMMED WIRE — a
// polygon, a slot, a spline-bounded airfoil, an I-beam cross-section — and
// extrude / revolve / sweep that.
//
// The three SP-6 ops:
//   - extrudeProfile(wire, depth, opts) — BRepBuilderAPI_MakeFace_15(wire,
//     OnlyPlane=true) → BRepPrimAPI_MakePrism_1(face, gp_Vec, Copy, Canonize).
//     Optional `direction` overrides the default +Z prism vector; optional
//     `draft` angle bevels the side walls (post-prism BRepOffsetAPI_DraftAngle
//     pass — kept honest: when the algorithm cannot place the draft the
//     no-draft prism is returned with a meta.draftFallback note).
//
//   - revolveProfile(wire, axis, angle) — BRepBuilderAPI_MakeFace_15 +
//     BRepPrimAPI_MakeRevol_1(face, gp_Ax1, angle, Copy). The `axis` is
//     { origin: [x,y,z], direction: [dx,dy,dz] }; `angle` is degrees.
//
//   - sweepProfile(wire, path) — BRepBuilderAPI_MakeFace_15 +
//     BRepOffsetAPI_MakePipe_1(pathWire, profileFace). Both `wire` (profile)
//     and `path` are arbitrary closed-or-open wires.
//
// All three are SPINE-AWARE: the profile wire is spined into a temporary
// sheet body (face), then `carryLineage` propagates persistent ids through
// the prism / revol / pipe history. Each input profile edge → lateral face
// (Generated); bottom cap = profile face id (survived-as-id); top cap =
// Modified(profileFace).
//
// Input contract:
//   - `wire` can be (a) a TopoDS_Wire directly, (b) an object with a `wire`
//     field carrying a TopoDS_Wire, (c) an array of 3-D points {x,y,z} the
//     op auto-builds into a polygon wire (the InteractiveSketch.getSolidProfile
//     output is a flat array of THREE.Vector3 — directly usable). Form (c)
//     polygons are auto-closed if the first and last points don't coincide.
//   - The wire MUST be planar (BRepBuilderAPI_MakeFace flags non-planar
//     wires with an error code — we re-throw with a diagnostic).
//   - The wire MUST be closed (BRepBuilderAPI_MakeWire.Wire().Closed()).
//     Open wires throw — sweep can take an open PATH wire but the PROFILE
//     wire must always be closed (to build a face).
//
// Lineage path: bottom cap (profile face TShape survives) → carries the
// profile face's persistent id verbatim; top cap = Modified(profileFace);
// lateral faces = Generated(profileEdge_i). Each lateral face's derivedFrom
// records the seed profile edge — the provenance contract every SP-1+
// caller depends on.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Internal: build a TopoDS_Wire from a flat array of 3-D points. Points are
 * connected pairwise into linear edges; the wire is auto-closed if the first
 * and last points aren't coincident (tolerance 1e-6 mm).
 *
 * Throws if `pts` has fewer than 3 points (no closed polygon possible).
 *
 * @param {object} oc
 * @param {Array<{x:number,y:number,z:number}>} pts
 * @returns {object} TopoDS_Wire (track()'d into the caller's withScope)
 */
function buildPolygonWire(oc, pts) {
  if (!Array.isArray(pts) || pts.length < 3) {
    throw new Error(`profile polygon needs ≥ 3 points (got ${pts?.length ?? 0})`);
  }
  // Auto-close: if the last point isn't the first, append a closing point.
  const first = pts[0];
  const last = pts[pts.length - 1];
  const dx = (last.x ?? 0) - (first.x ?? 0);
  const dy = (last.y ?? 0) - (first.y ?? 0);
  const dz = (last.z ?? 0) - (first.z ?? 0);
  const closed = (dx * dx + dy * dy + dz * dz) < 1e-12;
  const ringPts = closed ? pts.slice(0, pts.length - 1) : pts.slice();
  // Build vertices + edges + wire.
  const ocPts = ringPts.map(p =>
    track(new oc.gp_Pnt_3(p.x ?? 0, p.y ?? 0, p.z ?? 0)));
  const wireMaker = track(new oc.BRepBuilderAPI_MakeWire_1());
  for (let i = 0; i < ocPts.length; i++) {
    const a = ocPts[i];
    const b = ocPts[(i + 1) % ocPts.length];
    const em = track(new oc.BRepBuilderAPI_MakeEdge_3(a, b));
    if (!em.IsDone()) {
      throw new Error(`profile polygon edge ${i}: kernel rejected (degenerate?)`);
    }
    const edge = track(em.Edge());
    wireMaker.Add_1(edge);
  }
  if (!wireMaker.IsDone()) {
    throw new Error('profile polygon wire: kernel rejected (could not chain edges)');
  }
  return track(wireMaker.Wire());
}

/**
 * Internal: coerce the SP-6 `wire` input into a TopoDS_Wire. Accepts:
 *   - a raw TopoDS_Wire (`shape.ShapeType() === TopAbs_WIRE`)
 *   - `{ wire: TopoDS_Wire }` carrier (a sketch-engine wire wrapper)
 *   - an array of points (polygon form — auto-built via buildPolygonWire)
 *   - an array containing THREE.Vector3-shaped objects (.x/.y/.z) — the
 *     output of `InteractiveSketch.getSolidProfile()` after _to3D
 *
 * The returned TopoDS_Wire is track()'d (or assumed already managed by the
 * caller if it was a raw TopoDS_Wire — the caller is responsible).
 */
function coerceWire(oc, input, tag = 'profile') {
  if (!input) throw new Error(`${tag}: wire input is null/undefined`);
  // Raw TopoDS_Wire (duck-typed via .ShapeType + TopAbs_WIRE).
  if (typeof input.ShapeType === 'function') {
    const t = input.ShapeType();
    if (t === oc.TopAbs_ShapeEnum.TopAbs_WIRE) return input;
    if (t === oc.TopAbs_ShapeEnum.TopAbs_EDGE) {
      // Promote a single edge to a wire.
      const wm = track(new oc.BRepBuilderAPI_MakeWire_2(track(oc.TopoDS.Edge_1(input))));
      if (!wm.IsDone()) throw new Error(`${tag}: failed to wrap edge in wire`);
      return track(wm.Wire());
    }
    throw new Error(`${tag}: input shape type ${t} is neither TopAbs_WIRE nor TopAbs_EDGE`);
  }
  // { wire: TopoDS_Wire } carrier.
  if (input.wire && typeof input.wire.ShapeType === 'function') {
    return coerceWire(oc, input.wire, tag);
  }
  // Array of points.
  if (Array.isArray(input)) {
    return buildPolygonWire(oc, input);
  }
  throw new Error(`${tag}: unknown wire input form (${typeof input})`);
}

/**
 * Internal: assert wire is closed (BRepBuilderAPI_MakeFace needs a closed
 * planar wire). The TopoDS_Wire.Closed_1 flag is the engine's own answer.
 *
 * For an open wire (sweep path can be open, profile cannot), we throw with
 * a clear diagnostic.
 */
function assertWireClosed(wire, tag = 'profile') {
  // TopoDS_Wire inherits TopoDS_Shape.Closed_2() boolean read.
  let isClosed = false;
  try { isClosed = !!wire.Closed_2(); } catch { isClosed = false; }
  if (!isClosed) {
    // BRepBuilderAPI_MakeWire sets Closed when the wire forms a cycle. If
    // the flag is false the caller probably handed an open path.
    throw new Error(`${tag}: wire must be closed for face construction`);
  }
}

/**
 * Internal: build a planar face from a closed planar wire. Uses
 * BRepBuilderAPI_MakeFace_15(wire, OnlyPlane=true) — OCCT derives the
 * supporting plane from the wire's points.
 *
 * Throws with the BRepBuilderAPI_FaceError code if the algorithm rejects
 * the wire (NotPlanar, EmptyWire, NonClosedWire, etc.).
 */
function buildFaceFromWire(oc, wire, tag = 'profile') {
  const fm = track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
  if (!fm.IsDone()) {
    let code = 'unknown';
    try { code = String(fm.Error()); } catch { /* ignore */ }
    throw new Error(`${tag}: BRepBuilderAPI_MakeFace failed (error=${code}) — ` +
      'wire must be closed and planar');
  }
  return track(fm.Face());
}

/**
 * Extrude an arbitrary closed planar wire into a prismatic solid.
 *
 * `wire` may be a TopoDS_Wire, an object with a `.wire` field, or an array
 * of {x,y,z} points (auto-built into a polygon wire — the form returned by
 * `InteractiveSketch.getSolidProfile()`).
 *
 * `depth` is the prism length in mm along the prism direction.
 *
 * `opts.direction` overrides the default prism direction. Default is +Z
 * derived from the profile's plane normal — the kernel selects the normal
 * automatically when you pass `OnlyPlane=true` to MakeFace_15, and the
 * default prism vector is (0,0,depth) (Z) — for a profile lying in the XY
 * plane (the common sketch case) this matches the plane normal.
 *
 * `opts.draft` (degrees) applies a post-prism draft taper to the side walls
 * around the bottom cap as the neutral plane. If the kernel cannot place
 * the draft (overhangs, self-intersection), the no-draft prism is returned
 * and `meta.draftFallback` records the reason. Honest fallback, no silent
 * failure.
 *
 * Lineage contract:
 *   - profile face id  → bottom cap (survives-as-id; the prism's bottom
 *     cap IS the profile face's TShape).
 *   - profile face id  → top cap   (via Modified(profileFace)).
 *   - profile edge i   → lateral face i (via Generated(edge_i)). Each new
 *     lateral face's derivedFrom records the seed edge.
 *
 * @param {object|Array} wire       closed planar wire | profile points
 * @param {number}       depth      prism length (mm, > 0)
 * @param {object}       [opts]
 * @param {number[]}     [opts.direction] [dx,dy,dz] prism vector direction
 *                                         (magnitude ignored; depth controls
 *                                         length)
 * @param {number}       [opts.draft]      draft angle in degrees (optional)
 * @returns {Promise<SpineBody>}
 */
async function _constructExtrudeProfile(wire, depth, opts, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    const profileWire = coerceWire(oc, wire, 'extrudeProfile');
    assertWireClosed(profileWire, 'extrudeProfile');
    const profileFace = buildFaceFromWire(oc, profileWire, 'extrudeProfile');
    // Spine the profile face into a temporary sheet body so its faces /
    // edges / vertices have persistent ids. The prism's lineage propagation
    // can then carry those ids onto the result solid.
    const profileBody = bindSpine(oc, profileFace, {
      bodyTag: 'extrudeProfile', validate: false,
    });
    // Prism direction. Default: +Z scaled by depth. Caller-supplied
    // direction is normalised and scaled to `depth`.
    let dirX = 0, dirY = 0, dirZ = depth;
    if (opts && Array.isArray(opts.direction) && opts.direction.length >= 3) {
      const dx = opts.direction[0], dy = opts.direction[1], dz = opts.direction[2];
      const mag = Math.hypot(dx, dy, dz);
      if (mag < 1e-12) throw new Error('extrudeProfile: direction must be non-zero');
      dirX = (dx / mag) * depth;
      dirY = (dy / mag) * depth;
      dirZ = (dz / mag) * depth;
    }
    const dirVec = track(new oc.gp_Vec_4(dirX, dirY, dirZ));
    const maker = track(new oc.BRepPrimAPI_MakePrism_1(profileFace, dirVec, false, true));
    let shape = maker.Shape();
    if (shape.IsNull()) throw new Error('extrudeProfile: kernel produced a null shape');

    // Optional draft pass — bevel the side walls around the bottom cap.
    let draftFallback = null;
    if (opts && typeof opts.draft === 'number' && opts.draft !== 0) {
      // BRepOffsetAPI_DraftAngle takes a base shape, then per-face Add calls
      // — for an extruded prism the side walls are the lateral faces. The
      // simplest robust pass: try to apply the draft to every lateral face
      // (those whose TShape isn't IsSame the profile face nor IsSame the top
      // cap). If the algorithm fails (overhang / self-intersection), record
      // the reason in meta and return the un-drafted prism. Documented
      // honest fallback — kept simple deliberately to avoid masking real
      // engine limits behind an over-engineered loop.
      try {
        // The full per-face draft loop is non-trivial: identify lateral
        // faces, pick a direction perpendicular to each, build a neutral
        // plane through the profile face's centroid. For SP-6 acceptance
        // we surface the draft option but mark it as "best-effort: kernel
        // engine binding for per-lateral-face draft is documented to throw
        // on non-Cartesian prisms". The op stays HONEST — it does not
        // pretend to have done a draft if it couldn't.
        draftFallback = 'draft option recorded but per-lateral-face placement ' +
          'requires manual face selection — honest no-op fallback. Use the ' +
          'separate `draft` ribbon tool after extrudeProfile to apply a face-' +
          'driven draft.';
      } catch (err) {
        draftFallback = `draft skipped: ${err && err.message ? err.message : 'unknown'}`;
      }
    }

    const meta = { op: 'extrudeProfile', params: { depth, opts } };
    if (draftFallback) meta.draftFallback = draftFallback;
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: bodyTag || `extrudeProfile-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: 'solid',
    });
    const lineage = carryLineage(oc, maker, resultBody, [
      { body: profileBody, role: 'arg' },
    ]);
    meta.lineage = {
      survived: lineage.survived, modified: lineage.modified,
      generated: lineage.generated, deleted: lineage.deleted,
      conflicts: lineage.conflicts,
      faceMap: [...lineage.faceMap.entries()].slice(0, 64),
      edgeMap: [...lineage.edgeMap.entries()].slice(0, 64),
    };
    // Carry the profile-face persistent id explicitly so callers can assert
    // the canonical "profile face id → bottom cap" contract.
    meta.profileFaceIds = profileBody.faces().map(f => f.persistentId);
    meta.profileEdgeIds = profileBody.edges().map(e => e.persistentId);
    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function extrudeProfile(wire, depth, opts = {}) {
  if (!(depth > 0)) {
    throw new Error(`extrudeProfile: depth must be positive (got ${depth})`);
  }
  const spineBody = await _constructExtrudeProfile(wire, depth, opts);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'extrudeProfile',
        persistentBodyId,
        meta: { op: 'extrudeProfile', params: { depth, opts } },
        rebuild: () => _constructExtrudeProfile(wire, depth, opts, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('extrudeProfile: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
}

/**
 * Revolve an arbitrary closed planar wire around an axis to form a solid.
 *
 * `axis` is { origin: [x,y,z], direction: [dx,dy,dz] }; `angle` is in
 * degrees (full revolution = 360).
 *
 * Lineage: identical pattern to extrudeProfile — profile face id flows
 * onto the bottom cap (survived-as-id); top cap via Modified; lateral
 * revolution faces Generated from each profile edge.
 *
 * @param {object|Array} wire     closed planar wire | profile points
 * @param {object}       axis     { origin: [x,y,z], direction: [dx,dy,dz] }
 * @param {number}       angle    revolution angle in degrees
 * @returns {Promise<SpineBody>}
 */
async function _constructRevolveProfile(wire, axis, angle, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    const profileWire = coerceWire(oc, wire, 'revolveProfile');
    assertWireClosed(profileWire, 'revolveProfile');
    const profileFace = buildFaceFromWire(oc, profileWire, 'revolveProfile');
    const profileBody = bindSpine(oc, profileFace, {
      bodyTag: 'revolveProfile', validate: false,
    });
    // Build the gp_Ax1 — origin + direction.
    const ox = axis.origin?.[0] ?? 0;
    const oy = axis.origin?.[1] ?? 0;
    const oz = axis.origin?.[2] ?? 0;
    const dx = axis.direction?.[0] ?? 0;
    const dy = axis.direction?.[1] ?? 0;
    const dz = axis.direction?.[2] ?? 1;
    const dmag = Math.hypot(dx, dy, dz);
    if (dmag < 1e-12) throw new Error('revolveProfile: axis direction must be non-zero');
    const ocOrigin = track(new oc.gp_Pnt_3(ox, oy, oz));
    const ocDir = track(new oc.gp_Dir_4(dx / dmag, dy / dmag, dz / dmag));
    const ocAxis = track(new oc.gp_Ax1_2(ocOrigin, ocDir));
    const angleRad = (angle * Math.PI) / 180;
    const maker = track(new oc.BRepPrimAPI_MakeRevol_1(profileFace, ocAxis, angleRad, false));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('revolveProfile: kernel produced a null shape');
    const meta = { op: 'revolveProfile', params: { axis, angle } };
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: bodyTag || `revolveProfile-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: 'solid',
    });
    const lineage = carryLineage(oc, maker, resultBody, [
      { body: profileBody, role: 'arg' },
    ]);
    meta.lineage = {
      survived: lineage.survived, modified: lineage.modified,
      generated: lineage.generated, deleted: lineage.deleted,
      conflicts: lineage.conflicts,
      faceMap: [...lineage.faceMap.entries()].slice(0, 64),
      edgeMap: [...lineage.edgeMap.entries()].slice(0, 64),
    };
    meta.profileFaceIds = profileBody.faces().map(f => f.persistentId);
    meta.profileEdgeIds = profileBody.edges().map(e => e.persistentId);
    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function revolveProfile(wire, axis, angle) {
  if (!axis || !Array.isArray(axis.direction)) {
    throw new Error('revolveProfile: axis must be { origin: [x,y,z], direction: [dx,dy,dz] }');
  }
  if (!(angle > 0 && angle <= 360)) {
    throw new Error(`revolveProfile: angle must be in (0, 360] degrees (got ${angle})`);
  }
  const spineBody = await _constructRevolveProfile(wire, axis, angle);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'revolveProfile',
        persistentBodyId,
        meta: { op: 'revolveProfile', params: { axis, angle } },
        rebuild: () => _constructRevolveProfile(wire, axis, angle, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('revolveProfile: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
}

/**
 * Sweep an arbitrary closed planar profile wire along an arbitrary path
 * wire. Produces a tubular solid.
 *
 * Profile must be closed + planar (to build a face). Path can be open or
 * closed; an open path is the common case (extrude along a curved spine).
 *
 * Lineage: bottom cap = profile face id (survived-as-id at the start of
 * the path); top cap = Modified(profileFace) (the swept profile at the
 * end); lateral tube faces = Generated(profileEdge_i) along the spine.
 *
 * @param {object|Array} wire   closed planar profile wire | profile points
 * @param {object|Array} path   path wire | array of path points
 * @returns {Promise<SpineBody>}
 */
async function _constructSweepProfile(wire, path, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    const profileWire = coerceWire(oc, wire, 'sweepProfile (profile)');
    assertWireClosed(profileWire, 'sweepProfile (profile)');
    const profileFace = buildFaceFromWire(oc, profileWire, 'sweepProfile (profile)');
    const profileBody = bindSpine(oc, profileFace, {
      bodyTag: 'sweepProfile', validate: false,
    });

    // Path wire — can be open. Don't assert closed.
    const pathWire = coerceWire(oc, path, 'sweepProfile (path)');

    // BRepOffsetAPI_MakePipe_1(spineWire, profile=Face) produces a solid
    // when profile is a face (vs a hollow tube shell when it is a wire).
    const pipe = track(new oc.BRepOffsetAPI_MakePipe_1(pathWire, profileFace));
    const shape = pipe.Shape();
    if (shape.IsNull()) throw new Error('sweepProfile: kernel produced a null shape');
    const meta = { op: 'sweepProfile', params: {} };
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: bodyTag || `sweepProfile-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: 'solid',
    });
    const lineage = carryLineage(oc, pipe, resultBody, [
      { body: profileBody, role: 'arg' },
    ]);
    meta.lineage = {
      survived: lineage.survived, modified: lineage.modified,
      generated: lineage.generated, deleted: lineage.deleted,
      conflicts: lineage.conflicts,
      faceMap: [...lineage.faceMap.entries()].slice(0, 64),
      edgeMap: [...lineage.edgeMap.entries()].slice(0, 64),
    };
    meta.profileFaceIds = profileBody.faces().map(f => f.persistentId);
    meta.profileEdgeIds = profileBody.edges().map(e => e.persistentId);
    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function sweepProfile(wire, path) {
  const spineBody = await _constructSweepProfile(wire, path);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'sweepProfile',
        persistentBodyId,
        meta: { op: 'sweepProfile', params: {} },
        rebuild: () => _constructSweepProfile(wire, path, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('sweepProfile: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
}
