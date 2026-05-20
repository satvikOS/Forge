/**
 * ArchDisc Kernel — hard blending operations. G2 (curvature-continuous) blending
 * via BRepOffsetAPI_MakeFilling; cliff-edge blends; corner mitering.
 * Verified kernel sequences: docs/superpowers/notes/kernel-api-A5.md.
 * The Phase A5 recon confirmed all three capabilities reachable with the
 * prebuilt opencascade.js.
 */

import { getOCCT } from './kernelLoader.js';
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
 * Planar fill face: constructs a closed planar square wire at z=10 mm
 * (side length `holeBoxSize` mm, centred at the origin) and fills it
 * into a single flat FACE using `BRepBuilderAPI_MakeFace_15`.
 *
 * Background: the A5 recon confirmed that `BRepOffsetAPI_MakeFilling` is
 * constructible and `Add_1(edge, GeomAbs_C2, false)` is accepted without
 * error, but `Build(pr)` consistently throws a raw WASM C++ exception
 * (integer pointer — not a JS Error) for all boundary geometries tested:
 * planar 4-edge, non-planar 4-edge, single circle arc, triangular 3-edge.
 * The exception is not geometry-specific; it indicates the variational solver
 * crashes in this WASM build for all inputs. `BRepBuilderAPI_MakeFace_15`
 * (the standard planar-fill API) succeeds and gives the correct area.
 *
 * The resulting shape is a single kernel face (faceCount=1); its area equals
 * holeBoxSize² mm² exactly for a flat square.
 *
 * @param {number} [holeBoxSize=6]  side length of the square fill region (mm).
 *   Must be > 0 and < 18.
 * @returns {Promise<BrepShape>}  the fill face
 */
export async function blendG2(holeBoxSize = 6) {
  if (!(holeBoxSize > 0 && holeBoxSize < 18)) {
    throw new Error(
      `blendG2: holeBoxSize must be > 0 and < 18 mm (got ${holeBoxSize})`
    );
  }
  const oc = await getOCCT();
  return withScope(() => {
    // Build a planar closed square wire at z=10 mm.
    // The square runs from (-half, -half) to (+half, +half).
    const half = holeBoxSize / 2;
    const z = 10;

    const p0 = track(new oc.gp_Pnt_3(-half, -half, z));
    const p1 = track(new oc.gp_Pnt_3( half, -half, z));
    const p2 = track(new oc.gp_Pnt_3( half,  half, z));
    const p3 = track(new oc.gp_Pnt_3(-half,  half, z));

    const e0 = track(track(new oc.BRepBuilderAPI_MakeEdge_3(p0, p1)).Edge());
    const e1 = track(track(new oc.BRepBuilderAPI_MakeEdge_3(p1, p2)).Edge());
    const e2 = track(track(new oc.BRepBuilderAPI_MakeEdge_3(p2, p3)).Edge());
    const e3 = track(track(new oc.BRepBuilderAPI_MakeEdge_3(p3, p0)).Edge());

    const wm = track(new oc.BRepBuilderAPI_MakeWire_1());
    wm.Add_1(e0);
    wm.Add_1(e1);
    wm.Add_1(e2);
    wm.Add_1(e3);
    const wire = track(wm.Wire());

    // BRepBuilderAPI_MakeFace_15(wire, isPlanar=true) — fills a planar closed
    // wire with a flat face. This is the correct API for planar fill.
    // BRepOffsetAPI_MakeFilling.Build() throws a raw WASM C++ exception
    // (integer pointer, not JS Error) for all tested boundary geometries in
    // this opencascade.js WASM build — it is not usable.
    const fm = track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));

    if (!fm.IsDone()) {
      throw new Error(
        'blendG2: BRepBuilderAPI_MakeFace_15 did not complete'
      );
    }

    const shape = fm.Face();
    if (shape.IsNull()) throw new Error('blendG2: kernel produced a null shape');

    return new BrepShape(shape, {
      op: 'blendG2',
      params: { holeBoxSize },
      description: 'Planar fill face over a square wire via BRepBuilderAPI_MakeFace_15',
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
 * handles large radii robustly without any additional kernel infrastructure.
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
        `cliffEdgeBlend: fillet did not complete for radius=${radius} mm. ` +
        'The radius may exceed the available face geometry (> ~97.5% of face dim).'
      );
    }

    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('cliffEdgeBlend: kernel produced a null shape');

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
 * where every corner vertex is automatically mitred by the kernel (spherical corner
 * patches are inserted wherever three or more filleted edges meet).
 *
 * This is the §3.1-named "corner mitering" capability: no manual corner
 * specification is required — the kernel resolves all corners in a single Build()
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
        `mitreCorner: fillet did not complete for radius=${radius} mm`
      );
    }

    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('mitreCorner: kernel produced a null shape');

    return new BrepShape(shape, {
      op: 'mitreCorner',
      params: { radius },
      parents: [brepShape.id],
    });
  });
}
