/**
 * ArchDisc Kernel — NURBS surface operations via OCCT.
 *
 * Verified OCCT sequences: docs/superpowers/notes/occt-api-E.md
 *
 * Key architectural constraint (Handle vs Transient):
 *   `Geom_BSplineSurface_1(...)` returns a raw `Standard_Transient`.
 *   All downstream OCCT APIs need a `Handle_Geom_Surface`.
 *   The ONLY way to obtain a Handle is: build the transient surface →
 *   place it into a BRep shell via `BRep_Builder` → call
 *   `BRep_Tool.Surface_2(face)` to recover the typed Handle.
 *   Every op routes through this BRep round-trip.
 *
 * Ops:
 *   buildNurbsPatch(opts)         — build a 4×4 sail-like NURBS patch
 *   refineNurbs(brepShape, opts)  — h-refinement via knot insertion
 *   elevateNurbsDegree(brepShape, opts) — p-refinement via degree elevation
 *   nurbsCurvature(brepShape, u, v)    — sample curvature at (u,v)
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a 4×4 clamped-cubic B-spline surface transient from a control-point
 * function. Returns a raw `Standard_Transient` (not a Handle).
 *
 * @param {object} oc     OCCT module
 * @param {function} polesFn  (i, j) → { x, y, z }  1-based indices, i/j in [1..4]
 * @returns {object}  Geom_BSplineSurface (Standard_Transient)
 */
function _buildBSplineTransient(oc, polesFn) {
  const poles = track(new oc.TColgp_Array2OfPnt_2(1, 4, 1, 4));
  // Distinct knot vectors (NOT expanded):  [0.0, 1.0] with mults [4, 4]
  const uK = track(new oc.TColStd_Array1OfReal_2(1, 2));
  const vK = track(new oc.TColStd_Array1OfReal_2(1, 2));
  const uM = track(new oc.TColStd_Array1OfInteger_2(1, 2));
  const vM = track(new oc.TColStd_Array1OfInteger_2(1, 2));

  for (let i = 1; i <= 4; i++) {
    for (let j = 1; j <= 4; j++) {
      const { x, y, z } = polesFn(i, j);
      const pnt = track(new oc.gp_Pnt_3(x, y, z));
      poles.SetValue(i, j, pnt);
    }
  }

  uK.SetValue(1, 0.0); uK.SetValue(2, 1.0);
  vK.SetValue(1, 0.0); vK.SetValue(2, 1.0);
  uM.SetValue(1, 4);   uM.SetValue(2, 4);
  vM.SetValue(1, 4);   vM.SetValue(2, 4);

  const surf = track(new oc.Geom_BSplineSurface_1(
    poles, uK, vK, uM, vM,
    3, 3,          // UDegree, VDegree
    false, false,  // UPeriodic, VPeriodic
  ));
  return surf;
}

/**
 * Embed a B-spline transient into a BRep face via BRep_Builder, then
 * extract the Handle_Geom_Surface via BRep_Tool.Surface_2.
 * Returns { face (TopoDS_Face), handle (Handle_Geom_Surface) }.
 * Both are tracked for scope cleanup.
 *
 * Strategy: use BRep_Builder to create a free face directly from the
 * transient surface by making a face with a planar wire boundary that
 * lets OCCT store it, then read the surface back via BRep_Tool.
 *
 * In this opencascade.js build, BRepBuilderAPI_MakeFace_8 needs a
 * Handle_Geom_Surface. We bootstrap by using MakeFace_9 (parametric
 * bounds + handle) which also requires a handle. The workaround used
 * here:
 *   1. Build a BRep_Builder shell around the raw transient via
 *      BRep_Builder.MakeFace(face, surface, tolerance).
 *   2. This stores the surface inside the face without needing a Handle.
 *   3. Retrieve Handle via BRep_Tool.Surface_2.
 *
 * @param {object} oc
 * @param {object} surfTransient  Geom_BSplineSurface (Standard_Transient)
 * @param {number} [tol=1e-6]
 * @returns {{ face: TopoDS_Face, handle: Handle_Geom_Surface }}
 */
function _embedSurfaceInFace(oc, surfTransient, tol = 1e-6) {
  const face = track(new oc.TopoDS_Face_1());
  const bb = track(new oc.BRep_Builder());
  bb.MakeFace_1(face, surfTransient, tol);
  const handle = track(oc.BRep_Tool.Surface_2(face));
  if (handle.IsNull()) {
    throw new Error('_embedSurfaceInFace: BRep_Tool.Surface_2 returned null handle');
  }
  return { face, handle };
}

/**
 * Build a full parametric face from a Handle_Geom_Surface via
 * BRepBuilderAPI_MakeFace_8 (handle + tolerance).
 * Returns the TopoDS_Face.
 *
 * @param {object} oc
 * @param {object} handle  Handle_Geom_Surface
 * @param {number} [tol=1e-6]
 * @returns {TopoDS_Face}
 */
function _makeFaceFromHandle(oc, handle, tol = 1e-6) {
  const mf = track(new oc.BRepBuilderAPI_MakeFace_8(handle, tol));
  if (!mf.IsDone()) {
    throw new Error('_makeFaceFromHandle: BRepBuilderAPI_MakeFace_8 did not complete');
  }
  const face = track(mf.Face());
  if (face.IsNull()) {
    throw new Error('_makeFaceFromHandle: produced a null face');
  }
  return face;
}

/**
 * Extract the first NURBS face from a BrepShape.
 * Iterates via TopExp_Explorer over FACE; calls BRep_Tool.Surface_2 and
 * checks if the underlying surface is a Geom_BSplineSurface by checking
 * the constructor name. Throws a descriptive error if none found.
 *
 * @param {object} oc
 * @param {BrepShape} brepShape
 * @returns {{ face: TopoDS_Face, handle: Handle_Geom_Surface, surf: Geom_BSplineSurface }}
 */
function _extractNurbsFace(oc, brepShape) {
  const exp = track(new oc.TopExp_Explorer_2(
    brepShape.shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  ));
  while (exp.More()) {
    const face = track(oc.TopoDS.Face_1(exp.Current()));
    const handle = track(oc.BRep_Tool.Surface_2(face));
    if (!handle.IsNull()) {
      const raw = handle.get();
      if (raw && raw.constructor && raw.constructor.name === 'Geom_BSplineSurface') {
        return { face, handle, surf: raw };
      }
    }
    exp.Next();
  }
  throw new Error('refineNurbs: input does not contain a NURBS surface');
}

// ---------------------------------------------------------------------------
// 1. buildNurbsPatch
// ---------------------------------------------------------------------------

/**
 * Build a 4×4 clamped-cubic sail-like NURBS patch.
 *
 * Default control grid: 40×40 mm footprint, inner 2×2 poles lifted z=crown.
 * The resulting surface is a smooth, sail-like parametric patch — useful as
 * a fairing panel in aerospace, automotive, and naval surface design.
 *
 * @param {object} [opts]
 * @param {number} [opts.size=40]    Base dimension (mm). Grid spans size×size.
 * @param {number} [opts.crown=8]    Z-lift of inner 2×2 poles (mm). 0 = flat.
 * @returns {Promise<BrepShape>}
 */
export async function buildNurbsPatch(opts = {}) {
  const size   = opts.size   ?? 40;
  const crown  = opts.crown  ?? 8;

  if (!(size >= 10 && size <= 200)) {
    throw new Error(`buildNurbsPatch: size must be in [10, 200] mm (got ${size})`);
  }
  if (!(crown >= 0 && crown <= 50)) {
    throw new Error(`buildNurbsPatch: crown must be in [0, 50] mm (got ${crown})`);
  }

  const oc = await getOCCT();
  return withScope(() => {
    // Build 4×4 sail-like control grid.
    // Grid corners at (0,0), (size,0), (0,size), (size,size).
    // Inner 2×2 poles (i=2,3 and j=2,3) lifted by crown mm.
    const surf = _buildBSplineTransient(oc, (i, j) => {
      const x = (i - 1) * size / 3;
      const y = (j - 1) * size / 3;
      const inner = (i === 2 || i === 3) && (j === 2 || j === 3);
      const z = inner ? crown : 0.0;
      return { x, y, z };
    });

    // Embed into a BRep face → recover Handle → build full MakeFace.
    const { handle } = _embedSurfaceInFace(oc, surf);
    const face = _makeFaceFromHandle(oc, handle);

    return new BrepShape(face, {
      op: 'buildNurbsPatch',
      params: { size, crown },
      description: `4×4 clamped-cubic NURBS sail patch (${size}×${size} mm, crown=${crown} mm)`,
    });
  });
}

// ---------------------------------------------------------------------------
// 2. refineNurbs
// ---------------------------------------------------------------------------

/**
 * Refine a NURBS patch by inserting knots at u=0.25, 0.5, 0.75 and
 * v=0.25, 0.5, 0.75 (h-refinement). Preserves the surface shape exactly.
 *
 * @param {BrepShape} brepShape   Must contain at least one NURBS face.
 * @param {object}    [opts]       Reserved for future custom knot positions.
 * @returns {Promise<BrepShape>}
 */
export async function refineNurbs(brepShape, opts = {}) {
  if (!brepShape || !brepShape.shape) {
    throw new Error('refineNurbs: first argument must be a BrepShape with a live shape');
  }

  const oc = await getOCCT();
  return withScope(() => {
    // Extract the underlying Geom_BSplineSurface via BRep_Tool.
    const { surf } = _extractNurbsFace(oc, brepShape);

    // Insert knots at 0.25, 0.5, 0.75 in both u and v.
    // Signature (verified by recon): InsertUKnot(U, Mult, ParametricTol, Add)
    const knotPositions = [0.25, 0.5, 0.75];
    for (const k of knotPositions) {
      surf.InsertUKnot(k, 1, 1e-6, true);
      surf.InsertVKnot(k, 1, 1e-6, true);
    }

    // Rebuild the face from the refined surface.
    // The surf is now modified in-place; we need to re-embed and rebuild.
    const { handle: h2 } = _embedSurfaceInFace(oc, surf);
    const face2 = _makeFaceFromHandle(oc, h2);

    return new BrepShape(face2, {
      op: 'refineNurbs',
      params: { knotsU: knotPositions, knotsV: knotPositions },
      parents: [brepShape.id],
      description: 'NURBS h-refinement — knots inserted at 0.25, 0.5, 0.75 in u and v',
    });
  });
}

// ---------------------------------------------------------------------------
// 3. elevateNurbsDegree
// ---------------------------------------------------------------------------

/**
 * Elevate the degree of a NURBS patch in u and/or v (p-refinement).
 * Does NOT change the surface shape.
 *
 * @param {BrepShape} brepShape   Must contain at least one NURBS face.
 * @param {object}    [opts]
 * @param {number}    [opts.uDegree]   Target u-degree (default: current + 1).
 * @param {number}    [opts.vDegree]   Target v-degree (default: current + 1).
 * @returns {Promise<BrepShape>}
 */
export async function elevateNurbsDegree(brepShape, opts = {}) {
  if (!brepShape || !brepShape.shape) {
    throw new Error('elevateNurbsDegree: first argument must be a BrepShape with a live shape');
  }

  const oc = await getOCCT();
  return withScope(() => {
    const { surf } = _extractNurbsFace(oc, brepShape);

    const currentU = surf.UDegree();
    const currentV = surf.VDegree();

    const targetU = (opts.uDegree !== undefined) ? opts.uDegree : (currentU + 1);
    const targetV = (opts.vDegree !== undefined) ? opts.vDegree : (currentV + 1);

    if (targetU < currentU) {
      throw new Error(
        `elevateNurbsDegree: uDegree ${targetU} < current ${currentU} ` +
        '(OCCT IncreaseDegree cannot lower degree)',
      );
    }
    if (targetV < currentV) {
      throw new Error(
        `elevateNurbsDegree: vDegree ${targetV} < current ${currentV} ` +
        '(OCCT IncreaseDegree cannot lower degree)',
      );
    }

    // IncreaseDegree(UDegree, VDegree) — modifies in-place.
    surf.IncreaseDegree(targetU, targetV);

    // Rebuild the face from the elevated surface.
    const { handle: h2 } = _embedSurfaceInFace(oc, surf);
    const face2 = _makeFaceFromHandle(oc, h2);

    return new BrepShape(face2, {
      op: 'elevateNurbsDegree',
      params: { uDegree: targetU, vDegree: targetV },
      parents: [brepShape.id],
      description: `NURBS degree elevation: u=${currentU}→${targetU}, v=${currentV}→${targetV}`,
    });
  });
}

// ---------------------------------------------------------------------------
// 4. nurbsCurvature
// ---------------------------------------------------------------------------

/**
 * Sample principal, Gaussian, and mean curvatures at a (u, v) parameter
 * on a NURBS surface face.
 *
 * @param {BrepShape} brepShape   Must contain at least one NURBS face.
 * @param {number}    u           Parameter in [0, 1].
 * @param {number}    v           Parameter in [0, 1].
 * @returns {Promise<{
 *   gaussian: number,
 *   mean: number,
 *   kMin: number,
 *   kMax: number,
 *   normal: [number, number, number],
 *   position: [number, number, number],
 * }>}
 */
export async function nurbsCurvature(brepShape, u = 0.5, v = 0.5) {
  if (!brepShape || !brepShape.shape) {
    throw new Error('nurbsCurvature: first argument must be a BrepShape with a live shape');
  }

  const oc = await getOCCT();
  return withScope(() => {
    // Extract Handle_Geom_Surface via BRep_Tool.Surface_2.
    const { handle } = _extractNurbsFace(oc, brepShape);

    // GeomLProp_SLProps_1(Handle_Geom_Surface, U, V, Order=2, Resolution)
    const props = track(new oc.GeomLProp_SLProps_1(handle, u, v, 2, 1e-6));

    let gaussian = 0;
    let mean     = 0;
    let kMin     = 0;
    let kMax     = 0;
    let nx = 0, ny = 0, nz = 1;
    let px = 0, py = 0, pz = 0;

    if (props.IsCurvatureDefined()) {
      kMin     = props.MinCurvature();
      kMax     = props.MaxCurvature();
      gaussian = props.GaussianCurvature();
      mean     = props.MeanCurvature();
    }

    if (props.IsNormalDefined()) {
      const n = track(props.Normal());
      nx = n.X(); ny = n.Y(); nz = n.Z();
    }

    const pt = track(props.Value());
    px = pt.X(); py = pt.Y(); pz = pt.Z();

    // withScope returns a plain object — not a BrepShape — so all tracked
    // objects are freed at scope exit. That's correct for a pure analysis op.
    return {
      gaussian,
      mean,
      kMin,
      kMax,
      normal:   [nx, ny, nz],
      position: [px, py, pz],
    };
  });
}
