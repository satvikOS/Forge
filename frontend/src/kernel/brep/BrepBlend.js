/**
 * ArchDisc Kernel — hard blending (OCCT). G2 (curvature-continuous) blending
 * via BRepOffsetAPI_MakeFilling; cliff-edge blends; corner mitering.
 * Verified OCCT sequences: docs/superpowers/notes/occt-api-A5.md.
 * The Phase A5 recon confirmed all three capabilities reachable with the
 * prebuilt opencascade.js.
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Walk every unique edge of `shape` and call `addEdge(edge)` once per edge.
 * TopExp_Explorer double-counts shared edges; we dedup with IsSame() — the
 * same pattern used in BrepFeatures.forEachUniqueEdge.
 * @param {object} oc
 * @param {object} shape  TopoDS_Shape
 * @param {function} addEdge  callback(TopoDS_Edge)
 */
function forEachUniqueEdge(oc, shape, addEdge) {
  const ex = track(new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  ));
  const seen = [];
  for (; ex.More(); ex.Next()) {
    const cur = track(ex.Current());
    if (seen.some((s) => s.IsSame(cur))) continue;
    seen.push(cur);
    addEdge(track(oc.TopoDS.Edge_1(cur)));
  }
}

/**
 * Compute the smallest axis-aligned bounding-box dimension of `shape` (mm).
 * @param {object} oc
 * @param {object} shape  TopoDS_Shape
 * @returns {number}
 */
function bboxMinDim(oc, shape) {
  const bbox = track(new oc.Bnd_Box_1());
  oc.BRepBndLib.Add(shape, bbox, false);
  const mn = track(bbox.CornerMin());
  const mx = track(bbox.CornerMax());
  const dx = mx.X() - mn.X();
  const dy = mx.Y() - mn.Y();
  const dz = mx.Z() - mn.Z();
  return Math.min(dx, dy, dz);
}

// ---------------------------------------------------------------------------
// 1.  G2 (curvature-continuous) blending via BRepOffsetAPI_MakeFilling
// ---------------------------------------------------------------------------

/**
 * Demonstrative G2 fill: constructs a planar 4-edge square wire at z=10 mm
 * (side length `holeBoxSize` mm, centred at the origin), then fills it with
 * `BRepOffsetAPI_MakeFilling` at C2 (curvature-continuous) continuity.
 *
 * The "planar wire + MakeFilling with C2" path is used in preference to the
 * cut-hole path because it cleanly isolates the MakeFilling API without
 * needing hole-boundary exploration, and the recon notes confirm that
 * MakeFilling requires an OPEN boundary (not edges from a closed solid face).
 * The resulting shape is a single OCCT face that fills the wire with a
 * curvature-continuous surface — its area equals holeBoxSize² mm² (flat case).
 *
 * @param {number} [holeBoxSize=6]  side length of the square fill region (mm).
 *   Must be > 0 and < 18.
 * @returns {Promise<BrepShape>}  the G2 fill face
 */
export async function blendG2(holeBoxSize = 6) {
  if (!(holeBoxSize > 0 && holeBoxSize < 18)) {
    throw new Error(
      `blendG2: holeBoxSize must be > 0 and < 18 mm (got ${holeBoxSize})`
    );
  }
  const oc = await getOCCT();
  return withScope(() => {
    // Build a planar 4-edge square wire in the XY plane at z=10 mm.
    // The square runs from (-half, -half) to (+half, +half) centred at origin.
    const half = holeBoxSize / 2;
    const z = 10;

    const p0 = track(new oc.gp_Pnt_3(-half, -half, z));
    const p1 = track(new oc.gp_Pnt_3( half, -half, z));
    const p2 = track(new oc.gp_Pnt_3( half,  half, z));
    const p3 = track(new oc.gp_Pnt_3(-half,  half, z));

    const e0 = track(new oc.BRepBuilderAPI_MakeEdge_3(p0, p1)).Edge();
    const e1 = track(new oc.BRepBuilderAPI_MakeEdge_3(p1, p2)).Edge();
    const e2 = track(new oc.BRepBuilderAPI_MakeEdge_3(p2, p3)).Edge();
    const e3 = track(new oc.BRepBuilderAPI_MakeEdge_3(p3, p0)).Edge();

    // BRepOffsetAPI_MakeFilling — verified 10-arg constructor
    // (no _N suffix variants exist in this OCCT build).
    const filling = track(new oc.BRepOffsetAPI_MakeFilling(
      3,       // Degree
      15,      // NbPtsOnCur
      2,       // NbIter
      false,   // Anisotropie
      1e-5,    // Tol2d
      1e-4,    // Tol3d
      1e-2,    // TolAng
      0.1,     // TolCurv
      8,       // MaxDeg
      9,       // MaxSegments
    ));

    // Add all four boundary edges with C2 (curvature-continuous) constraint.
    // Add_1(edge, order, isPCurve) — 3 args required (2-arg throws BindingError).
    filling.Add_1(e0, oc.GeomAbs_Shape.GeomAbs_C2, false);
    filling.Add_1(e1, oc.GeomAbs_Shape.GeomAbs_C2, false);
    filling.Add_1(e2, oc.GeomAbs_Shape.GeomAbs_C2, false);
    filling.Add_1(e3, oc.GeomAbs_Shape.GeomAbs_C2, false);

    // Build — requires exactly 1 arg (a Message_ProgressRange).
    const pr = track(new oc.Message_ProgressRange_1());
    filling.Build(pr);

    if (!filling.IsDone()) {
      throw new Error(
        'blendG2: BRepOffsetAPI_MakeFilling did not complete — ' +
        'boundary edges may not form a valid open region'
      );
    }

    const shape = filling.Shape();
    if (shape.IsNull()) throw new Error('blendG2: OCCT produced a null shape');

    return new BrepShape(shape, {
      op: 'blendG2',
      params: { holeBoxSize },
      description: 'G2 (C2 curvature-continuous) fill surface over a planar square wire',
    });
  });
}

// ---------------------------------------------------------------------------
// 2.  Cliff-edge blending (large-radius fillet)
// ---------------------------------------------------------------------------

/**
 * Large-radius fillet applied to ALL unique edges of a solid. The radius must
 * be in the "cliff" range: at least 20% of the shape's smallest bounding-box
 * dimension. Small radii (normal fillets) are rejected — use `filletAll`
 * (BrepFeatures.js) for those.
 *
 * The recon proved radii up to 97.5% of the adjacent face dimension succeed
 * (`IsDone()=true`, positive volume) — standard `BRepFilletAPI_MakeFillet`
 * handles large radii robustly without any additional OCCT infrastructure.
 *
 * @param {BrepShape} brepShape  input solid
 * @param {number}    radius     fillet radius (mm); must be ≥ 20% of bbox min dim
 * @returns {Promise<BrepShape>}
 */
export async function cliffEdgeBlend(brepShape, radius) {
  if (!brepShape || !brepShape.shape) {
    throw new Error('cliffEdgeBlend: first argument must be a BrepShape with a live shape');
  }
  if (!(radius > 0)) {
    throw new Error(`cliffEdgeBlend: radius must be positive (got ${radius})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    // Reject small radii — this op is specifically for cliff/large-radius blends.
    const minDim = bboxMinDim(oc, brepShape.shape);
    const cliffThreshold = 0.20 * minDim;
    if (radius < cliffThreshold) {
      throw new Error(
        `cliffEdgeBlend: radius ${radius} mm is below the cliff threshold ` +
        `(${cliffThreshold.toFixed(3)} mm = 20% of bbox min dim ${minDim.toFixed(3)} mm). ` +
        `Use filletAll() for small fillets.`
      );
    }

    const maker = track(new oc.BRepFilletAPI_MakeFillet(
      brepShape.shape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational,
    ));
    forEachUniqueEdge(oc, brepShape.shape, (edge) => { maker.Add_2(radius, edge); });

    const pr = track(new oc.Message_ProgressRange_1());
    maker.Build(pr);

    if (!maker.IsDone()) {
      throw new Error(
        `cliffEdgeBlend: OCCT fillet did not complete for radius=${radius} mm. ` +
        'The radius may exceed the available face geometry (> ~97.5% of face dim).'
      );
    }

    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('cliffEdgeBlend: OCCT produced a null shape');

    return new BrepShape(shape, {
      op: 'cliffEdgeBlend',
      params: { radius },
      parents: [brepShape.id],
    });
  });
}

// ---------------------------------------------------------------------------
// 3.  Corner mitering (fillet all edges → automatic corner resolution)
// ---------------------------------------------------------------------------

/**
 * Fillet every unique edge of the input solid at `radius`, producing a result
 * where every corner vertex is automatically mitred by OCCT (spherical corner
 * patches are inserted wherever three or more filleted edges meet).
 *
 * This is the §3.1-named "corner mitering" capability: no manual corner
 * specification is required — OCCT resolves all corners in a single Build()
 * call. For a 20mm box at r=3mm, the result has 26 faces (6 flat + 12
 * cylindrical edge faces + 8 spherical corner patches) — empirically verified
 * in the A5 recon.
 *
 * Mechanically this overlaps with BrepFeatures.filletAll by design: both use
 * BRepFilletAPI_MakeFillet over all edges. `mitreCorner` is the distinct
 * ribbon-named op that exposes the corner-mitering capability; it carries no
 * cliff-radius constraint.
 *
 * @param {BrepShape} brepShape  input solid
 * @param {number}    radius     fillet radius (mm); must be > 0
 * @returns {Promise<BrepShape>}
 */
export async function mitreCorner(brepShape, radius) {
  if (!brepShape || !brepShape.shape) {
    throw new Error('mitreCorner: first argument must be a BrepShape with a live shape');
  }
  if (!(radius > 0)) {
    throw new Error(`mitreCorner: radius must be positive (got ${radius})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepFilletAPI_MakeFillet(
      brepShape.shape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational,
    ));
    forEachUniqueEdge(oc, brepShape.shape, (edge) => { maker.Add_2(radius, edge); });

    const pr = track(new oc.Message_ProgressRange_1());
    maker.Build(pr);

    if (!maker.IsDone()) {
      throw new Error(
        `mitreCorner: OCCT fillet did not complete for radius=${radius} mm`
      );
    }

    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('mitreCorner: OCCT produced a null shape');

    return new BrepShape(shape, {
      op: 'mitreCorner',
      params: { radius },
      parents: [brepShape.id],
    });
  });
}
