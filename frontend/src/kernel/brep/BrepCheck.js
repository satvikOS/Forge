/**
 * ArchDisc Kernel — evaluation & checking (analytical, no new geometry):
 * self-intersection detection and clash / interference detection.
 * Verified OCCT sequences: docs/superpowers/notes/occt-api-A3.md.
 *
 * Note: OCCT's BOPAlgo_CheckerSI is unbound in this opencascade.js build.
 * checkSelfIntersection uses BRepCheck_Analyzer validity + pairwise
 * solid-overlap, the verified reachable approach.
 */

import { getOCCT } from './occtKernel.js';
import { withScope, track } from './BrepShape.js';

/** Volume of an OCCT shape (mm³). Helper — caller is inside a withScope. */
function shapeVolume(oc, shape) {
  const props = track(new oc.GProp_GProps_1());
  oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
  return props.Mass();
}

/**
 * Collect all SOLID sub-shapes from a shape via TopExp_Explorer_2.
 * Returns an array of TopoDS_Shape copies (track()ed) — will be freed
 * when the surrounding withScope exits.
 * Must be called from inside a withScope.
 */
function collectSolids(oc, shape) {
  const solidEnum = oc.TopAbs_ShapeEnum.TopAbs_SOLID;
  const shapeEnum = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
  const exp = track(new oc.TopExp_Explorer_2(shape, solidEnum, shapeEnum));
  const solids = [];
  while (exp.More()) {
    const s = exp.Current();
    // Copy to get an independent handle that survives explorer moves
    try {
      const copy = track(new oc.BRepBuilderAPI_Copy_1(s, true, false));
      solids.push(copy.Shape());
    } catch (_e) {
      // fallback: alias (safe for read-only ops like volume measurement)
      solids.push(s);
    }
    exp.Next();
  }
  return solids;
}

/**
 * Compute Boolean Common volume between two shapes (mm³).
 * Must be called from inside a withScope.
 */
function commonVolume(oc, sA, sB) {
  let vol = 0;
  const pr1 = track(new oc.Message_ProgressRange_1());
  const algo = track(new oc.BRepAlgoAPI_Common_3(sA, sB, pr1));
  const prB = track(new oc.Message_ProgressRange_1());
  algo.Build(prB);
  if (algo.IsDone()) {
    const cs = algo.Shape();
    if (cs && !cs.IsNull()) {
      vol = Math.abs(shapeVolume(oc, cs));
    }
  }
  return vol;
}

/**
 * Detect self-intersection in a shape: reports the shape as self-intersecting
 * if it fails an intrinsic validity check OR contains two solids that overlap.
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @returns {Promise<{selfIntersects: boolean, count: number, valid: boolean}>}
 */
export async function checkSelfIntersection(brepShape) {
  if (!brepShape || !brepShape.shape) throw new Error('checkSelfIntersection: needs a BrepShape');
  const oc = await getOCCT();
  return withScope(() => {
    // Step 1: intrinsic validity via BRepCheck_Analyzer(shape, isGeomCtrled, isParallelMode)
    // Per occt-api-A3.md Item 6: 3-arg constructor (no _N suffix), IsValid_2() = whole shape
    const analyzer = track(new oc.BRepCheck_Analyzer(brepShape.shape, true, false));
    const valid = analyzer.IsValid_2();

    // Step 2: collect all SOLID sub-shapes via TopExp_Explorer_2
    // Per occt-api-A3.md Item 7: _2(shape, solidEnum, shapeEnum), Current() usable directly
    const solids = collectSolids(oc, brepShape.shape);

    // Step 3: for every pair (i < j), compute Boolean Common volume
    // Per occt-api-A3.md Item 8: BRepAlgoAPI_Common_3 + pairwise volume > epsilon → overlap
    let count = 0;
    const epsilon = 1e-6;
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        const vol = commonVolume(oc, solids[i], solids[j]);
        if (vol > epsilon) {
          count++;
        }
      }
    }

    // Step 4: selfIntersects = !valid || intersectingPairCount > 0
    const selfIntersects = !valid || count > 0;

    return { selfIntersects, count, valid };
  });
}

/**
 * Detect a clash between two solids. Reports whether they interfere, the
 * overlap (interference) volume in mm³, and the minimum clearance distance
 * in mm (0 when they touch or overlap).
 * @param {import('./BrepShape.js').BrepShape} a
 * @param {import('./BrepShape.js').BrepShape} b
 * @returns {Promise<{clash: boolean, interferenceVolume: number, minDistance: number}>}
 */
export async function checkClash(a, b) {
  if (!a || !a.shape || !b || !b.shape) {
    throw new Error('checkClash: both operands must be BrepShapes with live shapes');
  }
  const oc = await getOCCT();
  return withScope(() => {
    // interferenceVolume via BRepAlgoAPI_Common_3
    // Per occt-api-A3.md Item 4: _3(shapeA, shapeB, pr) + Build(pr2) + Shape() + VolumeProperties
    let interferenceVolume = 0;
    const pr1 = track(new oc.Message_ProgressRange_1());
    const algo = track(new oc.BRepAlgoAPI_Common_3(a.shape, b.shape, pr1));
    const prBuild = track(new oc.Message_ProgressRange_1());
    algo.Build(prBuild);
    if (algo.IsDone()) {
      const commonShape = algo.Shape();
      if (commonShape && !commonShape.IsNull()) {
        interferenceVolume = Math.abs(shapeVolume(oc, commonShape));
      }
    }

    // minDistance via BRepExtrema_DistShapeShape_1
    // Per occt-api-A3.md Item 5: no-arg _1() + LoadS1/LoadS2 + Perform(pr) + Value()
    let minDistance = 0;
    const distAlgo = track(new oc.BRepExtrema_DistShapeShape_1());
    distAlgo.LoadS1(a.shape);
    distAlgo.LoadS2(b.shape);
    const prDist = track(new oc.Message_ProgressRange_1());
    distAlgo.Perform(prDist);
    if (distAlgo.IsDone()) {
      minDistance = distAlgo.Value();
    }

    const clash = interferenceVolume > 1e-6;
    return { clash, interferenceVolume, minDistance };
  });
}
