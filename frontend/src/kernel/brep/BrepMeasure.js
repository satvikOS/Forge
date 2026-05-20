/**
 * ArchDisc Kernel — geometry measurement for B-rep shapes. Drives the
 * numeric assertions in e2e specs. All values in mm / mm² / mm³.
 */

import { getOCCT } from './kernelLoader.js';
import { withScope, track } from './BrepShape.js';

/** Solid volume (mm³). */
export async function volume(brepShape) {
  const oc = await getOCCT();
  return withScope(() => {
    const props = track(new oc.GProp_GProps_1());
    oc.BRepGProp.VolumeProperties_1(brepShape.shape, props, false, false, false);
    return props.Mass();
  });
}

/** Total surface area (mm²). */
export async function area(brepShape) {
  const oc = await getOCCT();
  return withScope(() => {
    const props = track(new oc.GProp_GProps_1());
    oc.BRepGProp.SurfaceProperties_1(brepShape.shape, props, false, false);
    return props.Mass();
  });
}

/**
 * Count UNIQUE sub-shapes of a given TopAbs kind. A raw TopExp_Explorer
 * DOUBLE-COUNTS shared sub-shapes: a box edge is visited once per adjacent
 * face, so TopAbs_EDGE yields 24 hits for 12 real edges (empirically
 * verified — see docs/superpowers/notes/occt-api-A0.md, Item 3). We
 * deduplicate with TopoDS_Shape.IsSame(). (A1+ may switch to
 * TopExp.MapShapes for O(n) counting on large shapes; IsSame dedup is
 * sufficient at A0 scope — box only.)
 */
async function countSubShapes(brepShape, kind) {
  const oc = await getOCCT();
  return withScope(() => {
    const ex = track(new oc.TopExp_Explorer_2(
      brepShape.shape, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
    const unique = [];
    for (; ex.More(); ex.Next()) {
      const cur = track(ex.Current());
      if (!unique.some((s) => s.IsSame(cur))) unique.push(cur);
    }
    return unique.length;
  });
}

/** Number of faces. */
export async function faceCount(brepShape) {
  const oc = await getOCCT();
  return countSubShapes(brepShape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
}

/** Number of edges. */
export async function edgeCount(brepShape) {
  const oc = await getOCCT();
  return countSubShapes(brepShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
}

/** Axis-aligned bounding box: {min:[x,y,z], max:[x,y,z]} in mm. */
export async function boundingBox(brepShape) {
  const oc = await getOCCT();
  return withScope(() => {
    const bbox = track(new oc.Bnd_Box_1());
    oc.BRepBndLib.Add(brepShape.shape, bbox, false);
    const min = track(bbox.CornerMin());
    const max = track(bbox.CornerMax());
    return {
      min: [min.X(), min.Y(), min.Z()],
      max: [max.X(), max.Y(), max.Z()],
    };
  });
}
