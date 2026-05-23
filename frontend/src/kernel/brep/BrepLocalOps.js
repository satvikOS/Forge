/**
 * ArchDisc Kernel — local operations:
 * shell/hollow, thicken sheet, offset, draft.
 *
 * SP-1 S4b (local ops subset) — every op here is spine-aware:
 *   1. Run the engine algorithm (BRepOffsetAPI_MakeThickSolid /
 *      BRepOffsetAPI_MakeOffsetShape / BRepOffsetAPI_DraftAngle —
 *      geometry unchanged).
 *   2. Bind the result shape to a spine `Body` via `bindSpine`.
 *   3. Carry persistent-ID lineage through using the algorithm's
 *      `Modified` / `Generated` / `IsDeleted` history maps. All four
 *      algorithms expose these via the `BRepBuilderAPI_MakeShape` (or
 *      `BRepBuilderAPI_ModifyShape` for `DraftAngle`) base class —
 *      confirmed in `opencascade.full.d.ts` lines 11044-11055
 *      (MakeOffsetShape), 11063-11070 (MakeThickSolid), 10970-10986
 *      (DraftAngle), 11768-11774 (MakeShape base), 11983-11987
 *      (ModifyShape base).
 *   4. Wrap in a `SpineBody`.
 *
 * Input contract — every op accepts SpineBody or legacy BrepShape (the
 * mixed-currency adapter from SP-1 §5). When the input is a SpineBody
 * its persistent ids carry through; when it is a raw BrepShape the
 * result still spines + validates correctly but the lineage map has
 * no input ids to carry — the result entities receive freshly-allocated
 * ids from bindSpine.
 *
 * For shell, the `closingFaces` list is explicitly REMOVED from the
 * input — those faces' ids appear in the `IsDeleted` query and their
 * persistent ids correctly DIE in the result. New inner-wall faces
 * are `Generated` from each remaining face's offset companion; they
 * receive freshly-allocated result ids with `derivedFrom` recording
 * the source face.
 *
 * For offsetShape, every face is `Modified` (offset by the same
 * distance) — the lineage carries every input face's id onto its
 * offset-modified result face.
 *
 * For draft, only the explicitly Added side faces are `Modified` —
 * the neutral plane's faces (top + bottom caps) typically survive
 * with their TShape unchanged.
 *
 * Verified kernel sequences: docs/superpowers/notes/kernel-api-A2.md items 1-4.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { carryLineage } from '../topology/IdLineage.js';
import { recordBodyDerive } from '../history/HistoryLog.js';

/**
 * Shared spine-binding + lineage-carry tail for the local ops. Mirrors the
 * `bindFeatureResult` helper in BrepFeatures.js so all S4 ops follow the
 * same canonical migration shape.
 *
 *   1. Wrap the engine TopoDS_Shape in a heap-managed BrepShape.
 *   2. bindSpine the engine result.
 *   3. If the input body is a SpineBody (`src.body` is present), carry
 *      its persistent ids through via `carryLineage(oc, algo, resultBody,
 *      [{body: src.body}])`. Records the lineage report on meta.lineage.
 *   4. Wrap in a SpineBody.
 *
 * @param {object} oc       the engine module
 * @param {string} opName   op tag used in bodyTag + error prefix
 * @param {object} src      input body — SpineBody or BrepShape; both fine.
 * @param {object} algo     the BRepOffsetAPI_* / BRepBuilderAPI_ModifyShape
 *                          algorithm instance (post-Build, IsDone()=true).
 *                          Must expose Modified(S) / Generated(S) /
 *                          IsDeleted(S) — see the file header for the .d.ts
 *                          references that confirm each algorithm does.
 * @param {object} shape    the engine TopoDS_Shape returned by the algo.
 * @param {object} meta     result meta — op + params, parents.
 * @returns {SpineBody}
 */
function bindLocalOpResult(oc, opName, src, algo, shape, meta, opts = {}) {
  if (shape.IsNull()) throw new Error(`${opName}: kernel produced a null shape`);
  const wrapper = new BrepShape(shape, meta);
  // S5: declared kind is op-supplied (defaults to 'solid' — shell/offset/draft
  // all preserve solidness; thicken explicitly declares 'solid' as its
  // sheet→solid output). Mismatch surfaces as a kindMismatch diagnostic.
  const resultBody = bindSpine(oc, shape, {
    bodyTag: opts.bodyTag || `${opName}-${wrapper.id}`, geomEngineShape: wrapper,
    declaredKind: opts.declaredKind || 'solid',
  });
  if (src.body) {
    const lineage = carryLineage(oc, algo, resultBody, [
      { body: src.body, role: 'arg' },
    ]);
    meta.lineage = {
      survived: lineage.survived, modified: lineage.modified,
      generated: lineage.generated, deleted: lineage.deleted,
      conflicts: lineage.conflicts,
      faceMap: [...lineage.faceMap.entries()].slice(0, 64),
      edgeMap: [...lineage.edgeMap.entries()].slice(0, 64),
    };
  }
  return new SpineBody(resultBody, wrapper, meta);
}

/**
 * Hollow a solid into a thin-walled shell, removing the top (+Z) face.
 *
 * SP-1 S4b — returns a SpineBody. The `BRepOffsetAPI_MakeThickSolid`
 * algorithm exposes `Modified(S)`, `Generated(S)` (inherited from
 * `BRepOffsetAPI_MakeOffsetShape`), and `IsDeleted(S)` (inherited from
 * `BRepBuilderAPI_MakeShape`) — the source body's face / edge / vertex
 * persistent ids carry onto the result. The top (+Z) face explicitly
 * placed in `closingFaces` returns `IsDeleted=true` and its id is
 * correctly DROPPED from the result spine. The new inner-wall faces
 * are `Generated` from each remaining input face and record the
 * source face id in `derivedFrom`.
 *
 * @param {SpineBody|BrepShape} brepShape  the solid to hollow
 * @param {number} thickness               wall thickness (mm)
 * @returns {Promise<SpineBody>}
 */
async function _runShell(brepShape, thickness, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    // verified sequence from kernel-api-A2.md item 1
    const inputShape = brepShape.shape;

    // Step 1: Collect all faces via TopExp_Explorer
    const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
    const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
    const faceExp = track(new oc.TopExp_Explorer_2(inputShape, FACE, ANY));
    const faces = [];
    while (faceExp.More()) {
      faces.push(track(oc.TopoDS.Face_1(faceExp.Current())));
      faceExp.Next();
    }

    // Step 2: Find the top (+Z) face — max bounding-box Z
    let topFace = null;
    let topFaceMaxZ = -Infinity;
    for (const f of faces) {
      const bb = track(new oc.Bnd_Box_1());
      oc.BRepBndLib.Add(f, bb, false);
      const mx = track(bb.CornerMax());
      const mz = mx.Z();
      if (mz > topFaceMaxZ) { topFaceMaxZ = mz; topFace = f; }
    }

    // Step 3: Build TopTools_ListOfShape containing topFace
    const facesToRemove = track(new oc.TopTools_ListOfShape_1());
    facesToRemove.Append_1(topFace);

    // Step 4: MakeThickSolid (undecorated, no-arg constructor)
    const thickSolid = track(new oc.BRepOffsetAPI_MakeThickSolid());

    // Step 5: MakeThickSolidByJoin — exactly 10 args
    //   (shape, closingFaces, offset, tol, mode, intersection, selfInter, joinType, removeIntEdges, progressRange)
    //   offset < 0 = inward (hollowing)
    const pr = track(new oc.Message_ProgressRange_1());
    thickSolid.MakeThickSolidByJoin(inputShape, facesToRemove, -thickness, 0.001, 0, false, false, 0, false, pr);

    // Step 6: Build + check
    const prBuild = track(new oc.Message_ProgressRange_1());
    thickSolid.Build(prBuild);

    if (!thickSolid.IsDone()) throw new Error('shell: MakeThickSolidByJoin did not complete');
    const shape = track(thickSolid.Shape());

    const meta = {
      op: 'shell',
      params: { thickness },
      parents: [brepShape.id],
    };
    return bindLocalOpResult(oc, 'shell', brepShape, thickSolid, shape, meta, { bodyTag });
  });
}

export async function shell(brepShape, thickness) {
  if (!brepShape || !brepShape.shape) throw new Error('shell: needs a SpineBody or BrepShape');
  if (!(thickness > 0)) throw new Error(`shell: thickness must be positive (got ${thickness})`);
  // S5 body-kind gate — shell requires a closed-volume body. Spine-aware:
  // when the input has a body, enforce solid-only first-class.
  if (brepShape.body && typeof brepShape.body.assertSolid === 'function') {
    brepShape.body.assertSolid('shell');
  }
  const result = await _runShell(brepShape, thickness);
  const persistentBodyId = result.body && result.body.persistentId;
  const srcPid = brepShape.body && brepShape.body.persistentId;
  if (persistentBodyId && srcPid) {
    try {
      recordBodyDerive({
        opName: 'shell',
        persistentBodyId,
        inputPersistentIds: [srcPid],
        meta: { op: 'shell', params: { thickness } },
        rebuild: ([liveSrc]) => _runShell(liveSrc, thickness, persistentBodyId),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('shell: history recordBodyDerive failed —', err && err.message || err);
    }
  }
  return result;
}

/**
 * Thicken a real open-surface body (an open shell or sheet) into a valid
 * watertight solid of the given wall `thickness`.
 *
 * SP-1 S4b — returns a SpineBody. `BRepOffsetAPI_MakeThickSolid` exposes
 * `Modified` / `Generated` / `IsDeleted` (see header note); when the input
 * is a SpineBody (a sheet body — e.g. a swept face), its face / edge /
 * vertex persistent ids carry onto the resulting solid via lineage.
 *
 * §3.2 "thickening sheets" intent: converting a complex open surface into a
 * valid watertight solid. `BRepOffsetAPI_MakeThickSolid.MakeThickSolidBySimple`
 * (OCCT refman) takes `(theS: TopoDS_Shape, theOffsetValue: Real)` and accepts
 * "Non-closed shell or face" — i.e. ANY open-surface shape. The op therefore
 * thickens the SELECTED body's actual surface geometry, not an internally
 * fabricated rectangle (parity-audit P8).
 *
 * Robust input handling: a user surface body may arrive as a single FACE, an
 * open SHELL, or a COMPOUND of faces (e.g. a tessellated NURBS sail patch).
 * `MakeThickSolidBySimple` thickens a connected face/shell — a compound of
 * disjoint faces is first sewn into a connected shell via
 * `BRepBuilderAPI_Sewing` so the whole surface thickens as one solid.
 *
 * @param {SpineBody|BrepShape} brepShape  the open-surface body to thicken
 * @param {number} thickness               wall thickness (mm)
 * @returns {Promise<SpineBody>}
 */
async function _runThicken(brepShape, thickness, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    const inputShape = brepShape.shape;

    // ── Step 1: Classify the input topology ─────────────────────────────────
    const TYPE = oc.TopAbs_ShapeEnum;
    const shapeType = inputShape.ShapeType();
    const isSolid = (shapeType === TYPE.TopAbs_SOLID || shapeType === TYPE.TopAbs_COMPSOLID);
    if (isSolid) {
      throw new Error('thicken: input is already a closed solid — Thicken converts an OPEN surface (sheet/shell) into a solid');
    }

    // Count the faces in the input.
    const ANY = TYPE.TopAbs_SHAPE;
    const faceExp = track(new oc.TopExp_Explorer_2(inputShape, TYPE.TopAbs_FACE, ANY));
    let faceCount = 0;
    while (faceExp.More()) { faceCount += 1; faceExp.Next(); }
    if (faceCount === 0) {
      throw new Error('thicken: the selected body contains no faces to thicken');
    }

    // ── Step 2: Resolve a connected face/shell to feed MakeThickSolidBySimple ─
    //   - single FACE / open SHELL  → use directly (the real open-surface path)
    //   - COMPOUND of faces         → sew into a connected shell first, so the
    //     whole tessellated surface thickens as one solid
    let surfaceShape;
    if (shapeType === TYPE.TopAbs_FACE || shapeType === TYPE.TopAbs_SHELL) {
      surfaceShape = inputShape;
    } else {
      // Sew every face into a single shell. BRepBuilderAPI_Sewing requires
      // EXACTLY 5 constructor args in this binding (see BrepFinal.stitchFaces).
      const sewing = track(new oc.BRepBuilderAPI_Sewing(
        1e-3,  // tolerance — bridges sub-mm seams between adjacent faces
        true,  // optionFaceMode
        true,  // optionBorderMode
        true,  // optionFreeEdges
        false, // optionNonManifold
      ));
      const addExp = track(new oc.TopExp_Explorer_2(inputShape, TYPE.TopAbs_FACE, ANY));
      while (addExp.More()) {
        sewing.Add(track(oc.TopoDS.Face_1(addExp.Current())));
        addExp.Next();
      }
      const prSew = track(new oc.Message_ProgressRange_1());
      sewing.Perform(prSew);
      const sewed = track(sewing.SewedShape());
      if (sewed.IsNull()) {
        throw new Error('thicken: sewing the surface body into a shell produced a null shape');
      }
      // The sewed result is typically a SHELL; if sewing returned a compound
      // wrapping one shell, unwrap it so MakeThickSolidBySimple gets a shell.
      if (sewed.ShapeType() === TYPE.TopAbs_COMPOUND) {
        const shExp = track(new oc.TopExp_Explorer_2(sewed, TYPE.TopAbs_SHELL, ANY));
        surfaceShape = shExp.More()
          ? track(oc.TopoDS.Shell_1(shExp.Current()))
          : sewed;
      } else {
        surfaceShape = sewed;
      }
    }

    // ── Step 3: Thicken — MakeThickSolidBySimple(shape, offset), exactly 2 args ─
    const thickObj = track(new oc.BRepOffsetAPI_MakeThickSolid());
    thickObj.MakeThickSolidBySimple(surfaceShape, thickness);

    const prBuild = track(new oc.Message_ProgressRange_1());
    thickObj.Build(prBuild);

    if (!thickObj.IsDone()) throw new Error('thicken: MakeThickSolidBySimple did not complete');
    const rawShape = track(thickObj.Shape());
    if (rawShape.IsNull()) throw new Error('thicken: kernel produced a null shape');

    // MakeThickSolidBySimple may produce an inward-oriented solid whose
    // VolumeProperties returns a negative value. Reversing the orientation
    // corrects the face normals so downstream consumers (measure, boolean, …)
    // receive a properly-outward-oriented solid.
    const shape = track(rawShape.Reversed());
    const meta = {
      op: 'thicken',
      params: { thickness, inputFaceCount: faceCount },
      parents: [brepShape.id],
    };
    return bindLocalOpResult(oc, 'thicken', brepShape, thickObj, shape, meta, { bodyTag });
  });
}

export async function thicken(brepShape, thickness) {
  if (!brepShape || !brepShape.shape) throw new Error('thicken: needs a SpineBody or BrepShape (the open-surface body to thicken)');
  if (!(thickness > 0)) throw new Error(`thicken: thickness must be positive (got ${thickness})`);
  // S5 body-kind gate — when the input carries a spine body, enforce the
  // sheet-only precondition first-class. The engine-shape-type check below
  // still runs (it covers raw BrepShape inputs without a spine body), but the
  // spine-aware gate fires earlier with a clearer diagnostic.
  if (brepShape.body && typeof brepShape.body.assertSheet === 'function') {
    brepShape.body.assertSheet('thicken');
  }
  const result = await _runThicken(brepShape, thickness);
  const persistentBodyId = result.body && result.body.persistentId;
  const srcPid = brepShape.body && brepShape.body.persistentId;
  if (persistentBodyId && srcPid) {
    try {
      recordBodyDerive({
        opName: 'thicken',
        persistentBodyId,
        inputPersistentIds: [srcPid],
        meta: { op: 'thicken', params: { thickness } },
        rebuild: ([liveSrc]) => _runThicken(liveSrc, thickness, persistentBodyId),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('thicken: history recordBodyDerive failed —', err && err.message || err);
    }
  }
  return result;
}

/**
 * Offset every face of a solid by `distance`, performing a proper
 * self-intersection-handling offset (the §3.2 "complex face offsetting"
 * intent: offsetting intricate high-curvature surfaces WITHOUT
 * self-intersection).
 *
 * SP-1 S4b — returns a SpineBody. `BRepOffsetAPI_MakeOffsetShape` exposes
 * `Modified`, `Generated`, `IsDeleted` natively (lines 11050-11052 in the
 * .d.ts). Every input face is Modified by the offset, so the input body's
 * face / edge / vertex persistent ids carry onto their offset-modified
 * result counterparts.
 *
 * Implementation: `BRepOffsetAPI_MakeOffsetShape.PerformByJoin` — the
 * full-featured 9-arg offset. Per the OCCT refman
 * (BRepOffsetAPI_MakeOffsetShape):
 *   PerformByJoin(S, Offset, Tol, Mode=BRepOffset_Skin, Intersection=false,
 *                 SelfInter=false, Join=GeomAbs_Arc, RemoveIntEdges=false,
 *                 theRange)
 * - `Intersection=true`  → the algorithm limits the parallels by computing
 *   intersections with ALL generated parallels (not just the two adjacent
 *   ones), which is what repairs an offset that would otherwise overlap
 *   itself on a high-curvature surface.
 * - `Join`:  GeomAbs_Arc (rolling-ball pipes/spheres in the gaps) or
 *   GeomAbs_Intersection (enlarged + intersected parallels). The
 *   intersection join is the robust choice for tight curvature.
 *
 * The naive `PerformBySimple` (used previously) computes NO intersections
 * and self-intersects / degenerates on curved input — see parity audit P2.
 *
 * @param {SpineBody|BrepShape} brepShape
 * @param {number} distance   offset (mm); positive = outward, negative = inward
 * @param {{joinType?:('arc'|'intersection'), selfInter?:boolean,
 *          intersection?:boolean, tol?:number}} [opts]
 *        joinType  'intersection' (default — robust on curvature) or 'arc'.
 *        intersection  compute intersections with all parallels (default true).
 *        selfInter  request explicit self-intersection elimination (default true).
 *        tol  offset tolerance (mm); default 1e-4.
 * @returns {Promise<SpineBody>}
 */
async function _runOffsetShape(brepShape, distance, opts, bodyTag) {
  const oc = await getOCCT();
  const joinType = opts.joinType === 'arc' ? 'arc' : 'intersection';
  const intersection = opts.intersection !== false; // default true
  const selfInter = opts.selfInter !== false;       // default true
  const tol = opts.tol > 0 ? opts.tol : 1e-4;
  return withScope(() => {
    // BRepOffsetAPI_MakeOffsetShape (undecorated, no-arg constructor)
    const algo = track(new oc.BRepOffsetAPI_MakeOffsetShape());

    // BRepOffset_Mode — only BRepOffset_Skin is implemented; enum value 0.
    const mode = (oc.BRepOffset_Mode && oc.BRepOffset_Mode.BRepOffset_Skin != null)
      ? oc.BRepOffset_Mode.BRepOffset_Skin : 0;
    // GeomAbs_JoinType — Arc=0, Tangent=1, Intersection=2 (OCCT enum order).
    let join;
    if (oc.GeomAbs_JoinType && oc.GeomAbs_JoinType.GeomAbs_Intersection != null) {
      join = joinType === 'arc'
        ? oc.GeomAbs_JoinType.GeomAbs_Arc
        : oc.GeomAbs_JoinType.GeomAbs_Intersection;
    } else {
      join = joinType === 'arc' ? 0 : 2;
    }

    // PerformByJoin — exactly 9 args (verified arg list, kernel-api-A2.md item 3):
    //   (S, Offset, Tol, Mode, Intersection, SelfInter, Join, RemoveIntEdges, pr)
    const prJoin = track(new oc.Message_ProgressRange_1());
    let joinFailed = false;
    try {
      algo.PerformByJoin(
        brepShape.shape, distance, tol,
        mode, intersection, selfInter, join, false, prJoin,
      );
    } catch (e) {
      // Some PerformByJoin failure modes surface as a thrown C++ exception
      // rather than IsDone()=false. Treat that as "join unavailable" and
      // fall back to the simple offset below so the op still produces a body.
      joinFailed = true;
    }

    // Track the live algorithm whose Modified/Generated/IsDeleted answer
    // the lineage query — falls through to the simple fallback below if
    // PerformByJoin produced no usable shape.
    let liveAlgo = algo;
    let shape = null;
    if (!joinFailed) {
      const prBuild = track(new oc.Message_ProgressRange_1());
      algo.Build(prBuild);
      if (algo.IsDone()) {
        const s = track(algo.Shape());
        if (!s.IsNull()) shape = s;
      }
    }

    // Fallback: PerformByJoin can fail on pathological input. Rather than
    // throwing, retry with the simple algorithm so a result is still
    // produced (the join path is the primary, repaired offset).
    if (!shape) {
      const algo2 = track(new oc.BRepOffsetAPI_MakeOffsetShape());
      algo2.PerformBySimple(brepShape.shape, distance);
      const prBuild2 = track(new oc.Message_ProgressRange_1());
      algo2.Build(prBuild2);
      if (!algo2.IsDone()) {
        throw new Error('offsetShape: PerformByJoin and PerformBySimple both failed');
      }
      const s2 = track(algo2.Shape());
      if (s2.IsNull()) throw new Error('offsetShape: kernel produced a null shape');
      shape = s2;
      liveAlgo = algo2;
    }

    const meta = {
      op: 'offsetShape',
      params: { distance, joinType, intersection, selfInter, tol },
      parents: [brepShape.id],
    };
    return bindLocalOpResult(oc, 'offsetShape', brepShape, liveAlgo, shape, meta, { bodyTag });
  });
}

export async function offsetShape(brepShape, distance, opts = {}) {
  if (!brepShape || !brepShape.shape) throw new Error('offsetShape: needs a SpineBody or BrepShape');
  if (!(Math.abs(distance) > 0)) {
    throw new Error(`offsetShape: distance must be non-zero (got ${distance})`);
  }
  const result = await _runOffsetShape(brepShape, distance, opts);
  const persistentBodyId = result.body && result.body.persistentId;
  const srcPid = brepShape.body && brepShape.body.persistentId;
  if (persistentBodyId && srcPid) {
    try {
      recordBodyDerive({
        opName: 'offsetShape',
        persistentBodyId,
        inputPersistentIds: [srcPid],
        meta: { op: 'offsetShape', params: { distance, ...opts } },
        rebuild: ([liveSrc]) =>
          _runOffsetShape(liveSrc, distance, opts, persistentBodyId),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('offsetShape: history recordBodyDerive failed —', err && err.message || err);
    }
  }
  return result;
}

/**
 * Apply a draft (mould taper) angle to the side faces of a solid about a
 * FULLY PARAMETRIC neutral plane, pulled along a FULLY PARAMETRIC direction.
 *
 * SP-1 S4b — returns a SpineBody. `BRepOffsetAPI_DraftAngle` exposes
 * `Modified`, `Generated`, `IsDeleted`, and the per-shape lookup
 * `ModifiedShape` (lines 10982-10985 in the .d.ts; inherits IsDeleted
 * from `BRepBuilderAPI_MakeShape`). Side faces explicitly Added are
 * Modified — the lineage carries the source face id onto the drafted
 * result face. Top + bottom (neutral-plane) faces survive with their
 * TShape — their ids carry verbatim.
 *
 * §3.2 "drafting faces" intent: taper angles applied about an arbitrary
 * parting plane, not just a fixed z=0 / +Z setup. `BRepOffsetAPI_DraftAngle`
 * (OCCT refman): `Add(F, Direction, Angle, NeutralPlane, Flag)` —
 *   - `Direction` (gp_Dir) is the pull direction: it indicates the side of
 *     `NeutralPlane` from which matter is removed (positive angle).
 *   - `NeutralPlane` (gp_Pln) is the reference plane; the side face is
 *     inclined through `Angle` about the line of intersection of the plane
 *     with the face. `gp_Pln` accepts ANY origin + normal — so an arbitrary
 *     planar parting plane is fully supported by this binding.
 *
 * The neutral-plane origin/normal and the pull direction are now caller
 * parameters. The op also auto-classifies side faces relative to the GIVEN
 * neutral plane + pull axis (not a hardcoded +Z bbox span), so a draft about
 * an X- or Y- or skew-oriented parting plane works.
 *
 * HONEST RESIDUAL: a NON-planar neutral *surface* (a curved parting surface
 * for taper on spline faces) needs `BRepOffset_Draft`-level logic that is not
 * exposed in this `opencascade.js` binding — see parity-audit P3. The
 * planar-neutral-plane case is what is fully parametric here.
 *
 * @param {SpineBody|BrepShape} brepShape
 * @param {number} angleDeg  draft angle (degrees, 0–90)
 * @param {{neutralOrigin?:[number,number,number],
 *          neutralNormal?:[number,number,number],
 *          pullDir?:[number,number,number]}} [opts]
 *        neutralOrigin  neutral-plane origin in mm (default [0,0,0]).
 *        neutralNormal  neutral-plane normal (default [0,0,1]); also the
 *                       axis side faces are classified against.
 *        pullDir        pull / demould direction (default = neutralNormal).
 * @returns {Promise<SpineBody>}
 */
async function _runDraft(brepShape, angleDeg, opts, bodyTag) {
  // ── Resolve parametric neutral plane + pull direction ──────────────────────
  const _vec3 = (v, fallback) => {
    if (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) return v;
    return fallback;
  };
  const nOrigin = _vec3(opts.neutralOrigin, [0, 0, 0]);
  let nNormal   = _vec3(opts.neutralNormal, [0, 0, 1]);
  let nNlen = Math.hypot(nNormal[0], nNormal[1], nNormal[2]);
  if (!(nNlen > 1e-9)) { nNormal = [0, 0, 1]; nNlen = 1; }
  const nNormalU = [nNormal[0] / nNlen, nNormal[1] / nNlen, nNormal[2] / nNlen];
  // Pull direction defaults to the neutral-plane normal.
  let pull = _vec3(opts.pullDir, nNormalU);
  let pLen = Math.hypot(pull[0], pull[1], pull[2]);
  if (!(pLen > 1e-9)) { pull = nNormalU.slice(); pLen = 1; }
  const pullU = [pull[0] / pLen, pull[1] / pLen, pull[2] / pLen];

  const oc = await getOCCT();
  return withScope(() => {
    const inputShape = brepShape.shape;
    const angleRad   = angleDeg * Math.PI / 180;

    // Step 1: Pull direction — parametric gp_Dir.
    const pullDir = track(new oc.gp_Dir_4(pullU[0], pullU[1], pullU[2]));

    // Step 2: Neutral plane — parametric gp_Pln from (origin, normal).
    //   gp_Pln_3(gp_Pnt, gp_Dir) builds a plane through `origin` with the
    //   given normal — any origin + normal accepted.
    const origin       = track(new oc.gp_Pnt_3(nOrigin[0], nOrigin[1], nOrigin[2]));
    const planeNormal  = track(new oc.gp_Dir_4(nNormalU[0], nNormalU[1], nNormalU[2]));
    const neutralPlane = track(new oc.gp_Pln_3(origin, planeNormal));

    // Step 3: Collect all faces via TopExp_Explorer.
    const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
    const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
    const faceExp = track(new oc.TopExp_Explorer_2(inputShape, FACE, ANY));
    const faces = [];
    while (faceExp.More()) {
      faces.push(track(oc.TopoDS.Face_1(faceExp.Current())));
      faceExp.Next();
    }

    // Step 4: Classify side faces along the PARAMETRIC pull axis.
    //   Project the solid bbox corners onto the pull axis to get the extent
    //   along that axis; a side face is one whose own projected extent spans
    //   most of that range (i.e. it is roughly parallel to the pull axis).
    const solidBB = track(new oc.Bnd_Box_1());
    oc.BRepBndLib.Add(inputShape, solidBB, false);
    const sMin = track(solidBB.CornerMin());
    const sMax = track(solidBB.CornerMax());
    // Eight corners of the bbox.
    const corners = [
      [sMin.X(), sMin.Y(), sMin.Z()], [sMax.X(), sMin.Y(), sMin.Z()],
      [sMin.X(), sMax.Y(), sMin.Z()], [sMax.X(), sMax.Y(), sMin.Z()],
      [sMin.X(), sMin.Y(), sMax.Z()], [sMax.X(), sMin.Y(), sMax.Z()],
      [sMin.X(), sMax.Y(), sMax.Z()], [sMax.X(), sMax.Y(), sMax.Z()],
    ];
    const projAxis = (p) => p[0] * pullU[0] + p[1] * pullU[1] + p[2] * pullU[2];
    let axisMin = Infinity; let axisMax = -Infinity;
    for (const c of corners) {
      const t = projAxis(c);
      if (t < axisMin) axisMin = t;
      if (t > axisMax) axisMax = t;
    }
    const axisSpan = axisMax - axisMin;
    const tol = (axisSpan > 1e-9 ? axisSpan : 1) * 0.05; // 5% classification band

    const sideFaces = [];
    for (const f of faces) {
      const bb = track(new oc.Bnd_Box_1());
      oc.BRepBndLib.Add(f, bb, false);
      const fMin = track(bb.CornerMin());
      const fMax = track(bb.CornerMax());
      const fc = [
        [fMin.X(), fMin.Y(), fMin.Z()], [fMax.X(), fMin.Y(), fMin.Z()],
        [fMin.X(), fMax.Y(), fMin.Z()], [fMax.X(), fMax.Y(), fMin.Z()],
        [fMin.X(), fMin.Y(), fMax.Z()], [fMax.X(), fMin.Y(), fMax.Z()],
        [fMin.X(), fMax.Y(), fMax.Z()], [fMax.X(), fMax.Y(), fMax.Z()],
      ];
      let fAxisMin = Infinity; let fAxisMax = -Infinity;
      for (const c of fc) {
        const t = projAxis(c);
        if (t < fAxisMin) fAxisMin = t;
        if (t > fAxisMax) fAxisMax = t;
      }
      // A side face spans most of the pull-axis extent (within tol of both ends).
      if (fAxisMin < axisMin + tol && fAxisMax > axisMax - tol) {
        sideFaces.push(f);
      }
    }

    if (sideFaces.length === 0) {
      throw new Error('draft: no side faces found spanning the pull axis; input may not be prismatic relative to the chosen pull direction');
    }

    // Step 5: DraftAngle constructor — _2(shape).
    const draftObj = track(new oc.BRepOffsetAPI_DraftAngle_2(inputShape));

    // Step 6: Add each side face with the parametric direction + neutral plane.
    //   .Add — 5 args: (face, direction: gp_Dir, angle: Real, neutralPlane: gp_Pln, flag).
    for (const sideFace of sideFaces) {
      draftObj.Add(sideFace, pullDir, angleRad, neutralPlane, true);
    }

    // Step 7: Build.
    const prBuild = track(new oc.Message_ProgressRange_1());
    draftObj.Build(prBuild);

    if (!draftObj.IsDone()) throw new Error('draft: BRepOffsetAPI_DraftAngle did not complete');
    const shape = track(draftObj.Shape());

    const meta = {
      op: 'draft',
      params: {
        angleDeg,
        neutralOrigin: nOrigin,
        neutralNormal: nNormalU,
        pullDir: pullU,
        draftedFaces: sideFaces.length,
      },
      parents: [brepShape.id],
    };
    return bindLocalOpResult(oc, 'draft', brepShape, draftObj, shape, meta, { bodyTag });
  });
}

export async function draft(brepShape, angleDeg, opts = {}) {
  if (!brepShape || !brepShape.shape) throw new Error('draft: needs a SpineBody or BrepShape');
  if (!(angleDeg > 0 && angleDeg < 90)) throw new Error(`draft: angle must be 0-90° (got ${angleDeg})`);
  const result = await _runDraft(brepShape, angleDeg, opts);
  const persistentBodyId = result.body && result.body.persistentId;
  const srcPid = brepShape.body && brepShape.body.persistentId;
  if (persistentBodyId && srcPid) {
    try {
      recordBodyDerive({
        opName: 'draft',
        persistentBodyId,
        inputPersistentIds: [srcPid],
        meta: { op: 'draft', params: { angleDeg, ...opts } },
        rebuild: ([liveSrc]) => _runDraft(liveSrc, angleDeg, opts, persistentBodyId),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('draft: history recordBodyDerive failed —', err && err.message || err);
    }
  }
  return result;
}
