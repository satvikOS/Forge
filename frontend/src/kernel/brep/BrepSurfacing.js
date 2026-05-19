/**
 * ArchDisc Kernel — surfacing operations (OCCT): sweep along a path,
 * loft through sections. A2 builds profiles/sections internally.
 * Verified OCCT sequences: docs/superpowers/notes/occt-api-A2.md items 5-6.
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Sweep a circular profile (radius `r`) along a straight path of `length`
 * along +Z, producing a solid rod.
 * @param {number} r       profile radius (mm)
 * @param {number} length  path length along +Z (mm)
 * @returns {Promise<BrepShape>}
 */
export async function sweep(r, length) {
  if (!(r > 0 && length > 0)) throw new Error(`sweep: r and length must be positive (got ${r}, ${length})`);
  const oc = await getOCCT();
  return withScope(() => {
    // verified sequence from occt-api-A2.md item 5

    // Step 1: Build circular profile FACE (disk)
    // gp_Ax2_2(origin, N, Vx) — 3 args: (gp_Pnt, gp_Dir, gp_Dir)
    const circOrigin = track(new oc.gp_Pnt_3(0, 0, 0));
    const circNormal = track(new oc.gp_Dir_4(0, 0, 1));  // Z = sweep direction
    const circXDir   = track(new oc.gp_Dir_4(1, 0, 0));
    const ax2        = track(new oc.gp_Ax2_2(circOrigin, circNormal, circXDir));

    // gp_Circ_2(gp_Ax2, radius)
    const circ = track(new oc.gp_Circ_2(ax2, r));

    // Full circle edge — BRepBuilderAPI_MakeEdge_8(gp_Circ)
    const circEdgeMaker = track(new oc.BRepBuilderAPI_MakeEdge_8(circ));
    const circEdge      = track(circEdgeMaker.Edge());

    // Profile wire
    const profileWM   = track(new oc.BRepBuilderAPI_MakeWire_1());
    profileWM.Add_1(circEdge);
    const profileWire = track(profileWM.Wire());

    // Profile FACE — BRepBuilderAPI_MakeFace_15(wire, isPlanar)
    // IMPORTANT: profile must be a FACE for a solid pipe result.
    // Passing a wire gives a hollow tube shell (wrong volume).
    const profileFM   = track(new oc.BRepBuilderAPI_MakeFace_15(profileWire, true));
    const profileFace = track(profileFM.Face());

    // Step 2: Build path wire (straight line from z=0 to z=length)
    const pathP0   = track(new oc.gp_Pnt_3(0, 0, 0));
    const pathP1   = track(new oc.gp_Pnt_3(0, 0, length));
    const pathEM   = track(new oc.BRepBuilderAPI_MakeEdge_3(pathP0, pathP1));
    const pathEdge = track(pathEM.Edge());
    const pathWM   = track(new oc.BRepBuilderAPI_MakeWire_1());
    pathWM.Add_1(pathEdge);
    const pathWire = track(pathWM.Wire());

    // Step 3: MakePipe_1(spineWire, profileFace)
    const pipe  = track(new oc.BRepOffsetAPI_MakePipe_1(pathWire, profileFace));
    const shape = pipe.Shape();

    if (shape.IsNull()) throw new Error('sweep: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'sweep', params: { r, length } });
  });
}

/**
 * Loft a solid through two square section wires: side `bottomSize` at z=0
 * and side `topSize` at z=`height`.
 * @param {number} bottomSize  bottom square side (mm)
 * @param {number} topSize     top square side (mm)
 * @param {number} height      (mm)
 * @returns {Promise<BrepShape>}
 */
export async function loft(bottomSize, topSize, height) {
  if (!(bottomSize > 0 && topSize > 0 && height > 0)) {
    throw new Error(`loft: all params must be positive (got ${bottomSize}, ${topSize}, ${height})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    // verified sequence from occt-api-A2.md item 6

    // Step 1: Build section wires (A1 verified chain: gp_Pnt_3 → MakeEdge_3 → MakeWire_1 + Add_1)
    // Helper: build a closed square wire of given side at height z
    function makeSquareWire(side, z) {
      const p0 = track(new oc.gp_Pnt_3(0,    0,    z));
      const p1 = track(new oc.gp_Pnt_3(side, 0,    z));
      const p2 = track(new oc.gp_Pnt_3(side, side, z));
      const p3 = track(new oc.gp_Pnt_3(0,    side, z));
      const em01 = track(new oc.BRepBuilderAPI_MakeEdge_3(p0, p1)); const e01 = track(em01.Edge());
      const em12 = track(new oc.BRepBuilderAPI_MakeEdge_3(p1, p2)); const e12 = track(em12.Edge());
      const em23 = track(new oc.BRepBuilderAPI_MakeEdge_3(p2, p3)); const e23 = track(em23.Edge());
      const em30 = track(new oc.BRepBuilderAPI_MakeEdge_3(p3, p0)); const e30 = track(em30.Edge());
      const wm = track(new oc.BRepBuilderAPI_MakeWire_1());
      wm.Add_1(e01); wm.Add_1(e12); wm.Add_1(e23); wm.Add_1(e30);
      return track(wm.Wire());
    }

    const wire0 = makeSquareWire(bottomSize, 0);
    const wire1 = makeSquareWire(topSize, height);

    // Step 2: ThruSections (undecorated, NOT _1/_2)
    // Constructor: (isSolid: bool, isRuled: bool, pres3d: Real)
    // isSolid = true → closed solid; isRuled = false → smooth loft
    const loftOp = track(new oc.BRepOffsetAPI_ThruSections(true, false, 1.0e-6));

    // Step 3: AddWire (undecorated) — add each section wire
    loftOp.AddWire(wire0);
    loftOp.AddWire(wire1);

    // Step 4: Build
    const prBuild = track(new oc.Message_ProgressRange_1());
    loftOp.Build(prBuild);

    const shape = loftOp.Shape();

    if (shape.IsNull()) throw new Error('loft: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'loft', params: { bottomSize, topSize, height } });
  });
}
