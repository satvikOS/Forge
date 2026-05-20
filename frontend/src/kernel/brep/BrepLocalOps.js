/**
 * ArchDisc Kernel — local operations (OCCT BRepOffsetAPI):
 * shell/hollow, thicken sheet, offset, draft.
 * Verified OCCT sequences: docs/superpowers/notes/occt-api-A2.md items 1-4.
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
    // verified sequence from occt-api-A2.md item 1
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

    if (shape.IsNull()) throw new Error('shell: OCCT produced a null shape');
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
    // verified sequence from occt-api-A2.md item 2
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

    if (rawShape.IsNull()) throw new Error('thicken: OCCT produced a null shape');

    // MakeThickSolidBySimple may produce an inward-oriented solid whose
    // VolumeProperties returns a negative value. Reversing the orientation
    // corrects the face normals so downstream consumers (measure, boolean, …)
    // receive a properly-outward-oriented solid.
    const shape = track(rawShape.Reversed());
    return new BrepShape(shape, { op: 'thicken', params: { w, h, thickness } });
  });
}

/**
 * Offset every face of a solid outward by `distance`.
 * @param {BrepShape} brepShape
 * @param {number} distance  outward offset (mm)
 * @returns {Promise<BrepShape>}
 */
export async function offsetShape(brepShape, distance) {
  if (!brepShape || !brepShape.shape) throw new Error('offsetShape: needs a BrepShape');
  if (!(distance > 0)) throw new Error(`offsetShape: distance must be positive (got ${distance})`);
  const oc = await getOCCT();
  return withScope(() => {
    // verified sequence from occt-api-A2.md item 3
    // BRepOffsetAPI_MakeOffsetShape (undecorated, no-arg constructor)
    const algo = track(new oc.BRepOffsetAPI_MakeOffsetShape());

    // PerformBySimple(shape, offset) — exactly 2 args; positive = outward expansion
    algo.PerformBySimple(brepShape.shape, distance);

    const prBuild = track(new oc.Message_ProgressRange_1());
    algo.Build(prBuild);

    if (!algo.IsDone()) throw new Error('offsetShape: PerformBySimple did not complete');
    const shape = track(algo.Shape());

    if (shape.IsNull()) throw new Error('offsetShape: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'offsetShape', params: { distance }, parents: [brepShape.id] });
  });
}

/**
 * Apply a draft angle to the side faces of a solid.
 * @param {BrepShape} brepShape
 * @param {number} angleDeg  draft angle (degrees)
 * @returns {Promise<BrepShape>}
 */
export async function draft(brepShape, angleDeg) {
  if (!brepShape || !brepShape.shape) throw new Error('draft: needs a BrepShape');
  if (!(angleDeg > 0 && angleDeg < 90)) throw new Error(`draft: angle must be 0-90° (got ${angleDeg})`);
  const oc = await getOCCT();
  return withScope(() => {
    // verified sequence from occt-api-A2.md item 4
    const inputShape = brepShape.shape;
    const angleRad   = angleDeg * Math.PI / 180;

    // Step 1: Pull direction +Z
    const pullDir = track(new oc.gp_Dir_4(0, 0, 1));

    // Step 2: Neutral plane = z=0 plane via gp_Ax3_3(origin, normalDir, xDir) → gp_Pln_2(ax3)
    const origin    = track(new oc.gp_Pnt_3(0, 0, 0));
    const normalZ   = track(new oc.gp_Dir_4(0, 0, 1));
    const xDir      = track(new oc.gp_Dir_4(1, 0, 0));
    const ax3       = track(new oc.gp_Ax3_3(origin, normalZ, xDir));
    const neutralPlane = track(new oc.gp_Pln_2(ax3));

    // Step 3: Collect all faces via TopExp_Explorer
    const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
    const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
    const faceExp = track(new oc.TopExp_Explorer_2(inputShape, FACE, ANY));
    const faces = [];
    while (faceExp.More()) {
      faces.push(track(oc.TopoDS.Face_1(faceExp.Current())));
      faceExp.Next();
    }

    // Step 4: Filter to side faces — faces that span from near z=0 to near the top
    // Determine overall height of the solid first
    const solidBB = track(new oc.Bnd_Box_1());
    oc.BRepBndLib.Add(inputShape, solidBB, false);
    const solidMin = track(solidBB.CornerMin());
    const solidMax = track(solidBB.CornerMax());
    const minZ = solidMin.Z();
    const maxZ = solidMax.Z();
    const height = maxZ - minZ;
    const tol = height * 0.05; // 5% tolerance for face classification

    const sideFaces = [];
    for (const f of faces) {
      const bb = track(new oc.Bnd_Box_1());
      oc.BRepBndLib.Add(f, bb, false);
      const fMin = track(bb.CornerMin());
      const fMax = track(bb.CornerMax());
      const fMinZ = fMin.Z();
      const fMaxZ = fMax.Z();
      // A side face spans most of the height (within tol of both bottom and top)
      if (fMinZ < minZ + tol && fMaxZ > maxZ - tol) {
        sideFaces.push(f);
      }
    }

    if (sideFaces.length === 0) {
      throw new Error('draft: no side faces found spanning the full height; input shape may not be prismatic');
    }

    // Step 5: DraftAngle constructor — _2(shape), NOT undecorated (no accessible ctor)
    const draftObj = track(new oc.BRepOffsetAPI_DraftAngle_2(inputShape));

    // Step 6: Add each side face
    // .Add (undecorated, NOT .Add_1 or .Add_2) — exactly 5 args:
    //   (face: TopoDS_Face, direction: gp_Dir, angle: Real, neutralPlane: gp_Pln, flag: bool)
    for (const sideFace of sideFaces) {
      draftObj.Add(sideFace, pullDir, angleRad, neutralPlane, true);
    }

    // Step 7: Build
    const prBuild = track(new oc.Message_ProgressRange_1());
    draftObj.Build(prBuild);

    if (!draftObj.IsDone()) throw new Error('draft: BRepOffsetAPI_DraftAngle did not complete');
    const shape = track(draftObj.Shape());

    if (shape.IsNull()) throw new Error('draft: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'draft', params: { angleDeg }, parents: [brepShape.id] });
  });
}
