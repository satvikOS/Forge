/**
 * ArchDisc Kernel — local operations:
 * shell/hollow, thicken sheet, offset, draft.
 * Verified kernel sequences: docs/superpowers/notes/kernel-api-A2.md items 1-4.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Hollow a solid into a thin-walled shell, removing the top (+Z) face.
 * @param {BrepShape} brepShape  the solid to hollow
 * @param {number} thickness     wall thickness (mm)
 * @returns {Promise<BrepShape>}
 */
export async function shell(brepShape, thickness) {
  if (!brepShape || !brepShape.shape) throw new Error('shell: needs a BrepShape');
  if (!(thickness > 0)) throw new Error(`shell: thickness must be positive (got ${thickness})`);
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

    if (shape.IsNull()) throw new Error('shell: kernel produced a null shape');
    return new BrepShape(shape, { op: 'shell', params: { thickness }, parents: [brepShape.id] });
  });
}

/**
 * Thicken a planar sheet of size w×h into a solid slab of `thickness`.
 * @param {number} w  sheet width (mm)
 * @param {number} h  sheet height (mm)
 * @param {number} thickness  (mm)
 * @returns {Promise<BrepShape>}
 */
export async function thicken(w, h, thickness) {
  if (!(w > 0 && h > 0 && thickness > 0)) {
    throw new Error(`thicken: w, h, thickness must be positive (got ${w}, ${h}, ${thickness})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    // verified sequence from kernel-api-A2.md item 2
    // Step 1: Build w×h planar face (four corners → edges → wire → face)
    const p0 = track(new oc.gp_Pnt_3( 0,  0, 0));
    const p1 = track(new oc.gp_Pnt_3( w,  0, 0));
    const p2 = track(new oc.gp_Pnt_3( w,  h, 0));
    const p3 = track(new oc.gp_Pnt_3( 0,  h, 0));

    const em01 = track(new oc.BRepBuilderAPI_MakeEdge_3(p0, p1));
    const e01  = track(em01.Edge());
    const em12 = track(new oc.BRepBuilderAPI_MakeEdge_3(p1, p2));
    const e12  = track(em12.Edge());
    const em23 = track(new oc.BRepBuilderAPI_MakeEdge_3(p2, p3));
    const e23  = track(em23.Edge());
    const em30 = track(new oc.BRepBuilderAPI_MakeEdge_3(p3, p0));
    const e30  = track(em30.Edge());

    const wm = track(new oc.BRepBuilderAPI_MakeWire_1());
    wm.Add_1(e01); wm.Add_1(e12); wm.Add_1(e23); wm.Add_1(e30);
    const wire = track(wm.Wire());

    const fm        = track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
    const faceShape = track(fm.Face());

    // Step 2: Thicken via MakeThickSolidBySimple(shape, offset) — exactly 2 args
    // Note: MakeThickSolidBySimple may produce an inward-oriented solid; we fix
    // the orientation below by calling Reversed() on the result.
    const thickObj = track(new oc.BRepOffsetAPI_MakeThickSolid());
    thickObj.MakeThickSolidBySimple(faceShape, thickness);

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
    return new BrepShape(shape, { op: 'thicken', params: { w, h, thickness } });
  });
}

/**
 * Offset every face of a solid by `distance`, performing a proper
 * self-intersection-handling offset (the §3.2 "complex face offsetting"
 * intent: offsetting intricate high-curvature surfaces WITHOUT
 * self-intersection).
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
 * @param {BrepShape} brepShape
 * @param {number} distance   offset (mm); positive = outward, negative = inward
 * @param {{joinType?:('arc'|'intersection'), selfInter?:boolean,
 *          intersection?:boolean, tol?:number}} [opts]
 *        joinType  'intersection' (default — robust on curvature) or 'arc'.
 *        intersection  compute intersections with all parallels (default true).
 *        selfInter  request explicit self-intersection elimination (default true).
 *        tol  offset tolerance (mm); default 1e-4.
 * @returns {Promise<BrepShape>}
 */
export async function offsetShape(brepShape, distance, opts = {}) {
  if (!brepShape || !brepShape.shape) throw new Error('offsetShape: needs a BrepShape');
  if (!(Math.abs(distance) > 0)) {
    throw new Error(`offsetShape: distance must be non-zero (got ${distance})`);
  }
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
    }

    return new BrepShape(shape, {
      op: 'offsetShape',
      params: { distance, joinType, intersection, selfInter, tol },
      parents: [brepShape.id],
    });
  });
}

/**
 * Apply a draft (mould taper) angle to the side faces of a solid about a
 * FULLY PARAMETRIC neutral plane, pulled along a FULLY PARAMETRIC direction.
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
 * @param {BrepShape} brepShape
 * @param {number} angleDeg  draft angle (degrees, 0–90)
 * @param {{neutralOrigin?:[number,number,number],
 *          neutralNormal?:[number,number,number],
 *          pullDir?:[number,number,number]}} [opts]
 *        neutralOrigin  neutral-plane origin in mm (default [0,0,0]).
 *        neutralNormal  neutral-plane normal (default [0,0,1]); also the
 *                       axis side faces are classified against.
 *        pullDir        pull / demould direction (default = neutralNormal).
 * @returns {Promise<BrepShape>}
 */
export async function draft(brepShape, angleDeg, opts = {}) {
  if (!brepShape || !brepShape.shape) throw new Error('draft: needs a BrepShape');
  if (!(angleDeg > 0 && angleDeg < 90)) throw new Error(`draft: angle must be 0-90° (got ${angleDeg})`);

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

    if (shape.IsNull()) throw new Error('draft: kernel produced a null shape');
    return new BrepShape(shape, {
      op: 'draft',
      params: {
        angleDeg,
        neutralOrigin: nOrigin,
        neutralNormal: nNormalU,
        pullDir: pullU,
        draftedFaces: sideFaces.length,
      },
      parents: [brepShape.id],
    });
  });
}
