/**
 * ArchDisc Kernel — NURBS surface operations via OCCT.
 *
 * Verified OCCT sequences: docs/superpowers/notes/occt-api-E.md
 *
 * ARCHITECTURAL CONSTRAINT (Handle vs Transient):
 *   `Geom_BSplineSurface_1(...)` returns a raw `Standard_Transient`.
 *   All OCCT APIs that take surfaces (BRepBuilderAPI_MakeFace_8,
 *   GeomLProp_SLProps_1, BRep_Builder.UpdateFace, etc.) require a
 *   `Handle_Geom_Surface`. `BRep_Tool.Surface_2(face)` is the ONLY
 *   way to get a Handle — but to build a face we need a Handle first.
 *   This chicken-and-egg constraint means we CANNOT bootstrap a
 *   parametric NURBS face from a new surface in this opencascade.js build.
 *
 * WORKAROUND (implemented here):
 *   1. Build the Geom_BSplineSurface transient for its math operations:
 *      - InsertUKnot / InsertVKnot  (h-refinement, verified REACHABLE)
 *      - IncreaseDegree              (p-refinement, verified REACHABLE)
 *      - D0 / D2                     (point + derivative evaluation)
 *   2. Sample the surface on a 20×20 grid using D0, triangulate.
 *   3. Build each triangle as a flat face via BRepBuilderAPI_MakePolygon
 *      + BRepBuilderAPI_MakeFace_15(wire, isPlanar=true).
 *   4. Combine all triangle faces into a TopoDS_Compound via BRep_Builder.
 *   5. Store the live NURBS transient in `BrepShape.meta.nurbsSurf` for
 *      downstream refine/elevate/curvature operations.
 *   6. For curvature: use D2 derivatives directly + classical differential
 *      geometry formulas (bypasses GeomLProp_SLProps Handle requirement).
 *
 * Ops:
 *   buildNurbsPatch(opts)               — build a 4×4 sail-like NURBS patch
 *   refineNurbs(brepShape, opts)        — h-refinement via knot insertion
 *   elevateNurbsDegree(brepShape, opts) — p-refinement via degree elevation
 *   nurbsCurvature(brepShape, u, v)     — sample curvature at (u,v)
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/** Grid resolution for mesh approximation. 10×10 = 200 triangles, fast enough. */
const GRID_N = 10;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a 4×4 clamped-cubic B-spline surface transient.
 * NOT tracked — caller manages lifetime via meta.nurbsSurf.
 *
 * @param {object} oc
 * @param {function} polesFn  (i, j) → { x, y, z }  1-based, i/j in [1..4]
 * @returns {object} Geom_BSplineSurface (Standard_Transient)
 */
function _buildBSplineTransient(oc, polesFn) {
  const poles = track(new oc.TColgp_Array2OfPnt_2(1, 4, 1, 4));
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

  // NOT tracked — explicitly managed by caller.
  return new oc.Geom_BSplineSurface_1(
    poles, uK, vK, uM, vM, 3, 3, false, false,
  );
}

/**
 * Evaluate a point on the NURBS surface at (u, v) using D0.
 * Returns a plain JS object { x, y, z } — not an OCCT object.
 */
function _evalPt(oc, surf, u, v) {
  const p = track(new oc.gp_Pnt_3(0, 0, 0));
  surf.D0(u, v, p);
  const r = { x: p.X(), y: p.Y(), z: p.Z() };
  return r;
}

/**
 * Sample the NURBS surface on a GRID_N × GRID_N grid and build a
 * TopoDS_Compound of planar triangle faces. Verified pattern:
 *   BRep_Builder.MakeCompound / Add — from BrepTransform.js
 *   BRepBuilderAPI_MakeEdge_3 / MakeWire_4 / MakeFace_15 — from BrepBlend.js
 *
 * @param {object} oc
 * @param {object} surf  Geom_BSplineSurface transient
 * @returns {TopoDS_Compound}
 */
function _buildMeshCompound(oc, surf) {
  const N = GRID_N;

  // Pre-evaluate all grid points.
  const pts = [];
  for (let i = 0; i <= N; i++) {
    pts.push([]);
    for (let j = 0; j <= N; j++) {
      pts[i].push(_evalPt(oc, surf, i / N, j / N));
    }
  }

  // Build compound.
  const compound = track(new oc.TopoDS_Compound());
  const builder  = track(new oc.BRep_Builder());
  builder.MakeCompound(compound);

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const a = pts[i][j];
      const b = pts[i + 1][j];
      const c = pts[i + 1][j + 1];
      const d = pts[i][j + 1];
      // Triangle 1: a-b-c
      _addTriFace(oc, builder, compound, a, b, c);
      // Triangle 2: a-c-d
      _addTriFace(oc, builder, compound, a, c, d);
    }
  }

  if (compound.IsNull()) {
    throw new Error('_buildMeshCompound: produced a null compound');
  }
  return compound;
}

/**
 * Build a single planar triangle face and add it to a compound.
 * Skips degenerate triangles silently.
 */
function _addTriFace(oc, builder, compound, a, b, c) {
  // Degenerate check: area of triangle must be non-zero.
  const ax = b.x - a.x; const ay = b.y - a.y; const az = b.z - a.z;
  const bx = c.x - a.x; const by = c.y - a.y; const bz = c.z - a.z;
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  if (cx * cx + cy * cy + cz * cz < 1e-12) return; // degenerate

  try {
    const pa = track(new oc.gp_Pnt_3(a.x, a.y, a.z));
    const pb = track(new oc.gp_Pnt_3(b.x, b.y, b.z));
    const pc = track(new oc.gp_Pnt_3(c.x, c.y, c.z));

    const ea = track(track(new oc.BRepBuilderAPI_MakeEdge_3(pa, pb)).Edge());
    const eb = track(track(new oc.BRepBuilderAPI_MakeEdge_3(pb, pc)).Edge());
    const ec = track(track(new oc.BRepBuilderAPI_MakeEdge_3(pc, pa)).Edge());

    const wm = track(new oc.BRepBuilderAPI_MakeWire_1());
    wm.Add_1(ea); wm.Add_1(eb); wm.Add_1(ec);
    if (!wm.IsDone()) return;
    const wire = track(wm.Wire());

    const fm = track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
    if (!fm.IsDone()) return;
    const face = track(fm.Face());
    if (!face.IsNull()) {
      builder.Add(compound, face);
    }
  } catch {
    // Skip problematic triangles — OCCT sometimes rejects near-degenerate ones.
  }
}

/**
 * Compute curvature at (u, v) from the raw NURBS surface using D2.
 * Uses classical differential geometry (first + second fundamental forms).
 * Bypasses GeomLProp_SLProps (which requires a Handle_Geom_Surface).
 */
function _computeCurvatureFromD2(oc, surf, u, v) {
  const P   = track(new oc.gp_Pnt_3(0, 0, 0));
  const D1u  = track(new oc.gp_Vec_4(0, 0, 0));
  const D1v  = track(new oc.gp_Vec_4(0, 0, 0));
  const D2u  = track(new oc.gp_Vec_4(0, 0, 0));
  const D2v  = track(new oc.gp_Vec_4(0, 0, 0));
  const D2uv = track(new oc.gp_Vec_4(0, 0, 0));

  surf.D2(u, v, P, D1u, D1v, D2u, D2v, D2uv);

  const e1u = [D1u.X(), D1u.Y(), D1u.Z()];
  const e1v = [D1v.X(), D1v.Y(), D1v.Z()];
  const e2u  = [D2u.X(), D2u.Y(), D2u.Z()];
  const e2v  = [D2v.X(), D2v.Y(), D2v.Z()];
  const e2uv = [D2uv.X(), D2uv.Y(), D2uv.Z()];
  const pos  = [P.X(), P.Y(), P.Z()];

  const dot   = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const norm  = (a) => Math.sqrt(dot(a, a));
  const unit  = (a) => { const n = norm(a); return n > 1e-12 ? [a[0]/n, a[1]/n, a[2]/n] : [0,0,1]; };

  const E = dot(e1u, e1u);
  const F = dot(e1u, e1v);
  const G = dot(e1v, e1v);
  const EGF2 = E * G - F * F;

  const normal = unit(cross(e1u, e1v));

  if (Math.abs(EGF2) < 1e-20) {
    return { gaussian: 0, mean: 0, kMin: 0, kMax: 0, normal, position: pos };
  }

  const L  = dot(e2u,  normal);
  const M  = dot(e2uv, normal);
  const Nc = dot(e2v,  normal);

  const gaussian = (L * Nc - M * M) / EGF2;
  const mean     = (L * G - 2 * M * F + Nc * E) / (2 * EGF2);
  const disc     = Math.sqrt(Math.max(0, mean * mean - gaussian));
  const kMin     = mean - disc;
  const kMax     = mean + disc;

  return { gaussian, mean, kMin, kMax, normal, position: pos };
}

/**
 * Attach a dispose extension that also cleans up the NURBS transient.
 * Mutates the BrepShape instance in-place.
 */
function _attachNurbsDispose(brepShape) {
  const origDispose = brepShape.dispose.bind(brepShape);
  brepShape.dispose = function () {
    try {
      if (this.meta && this.meta.nurbsSurf && typeof this.meta.nurbsSurf.isDeleted === 'function') {
        if (!this.meta.nurbsSurf.isDeleted()) this.meta.nurbsSurf.delete();
      } else if (this.meta && this.meta.nurbsSurf) {
        try { this.meta.nurbsSurf.delete(); } catch { /* already gone */ }
      }
    } catch { /* already gone */ }
    if (this.meta) this.meta.nurbsSurf = null;
    origDispose();
  };
}

// ---------------------------------------------------------------------------
// 1. buildNurbsPatch
// ---------------------------------------------------------------------------

/**
 * Build a 4×4 clamped-cubic sail-like NURBS patch.
 *
 * Default control grid: 40×40 mm footprint, inner 2×2 poles lifted z=crown.
 * The surface is sampled on a 20×20 grid → triangulated compound for BRep use.
 * The NURBS surface transient is stored in `brepShape.meta.nurbsSurf` for
 * downstream refine/elevate/curvature operations.
 *
 * @param {object} [opts]
 * @param {number} [opts.size=40]    Base dimension (mm).
 * @param {number} [opts.crown=8]    Z-lift of inner 2×2 poles (mm).
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
    const surf = _buildBSplineTransient(oc, (i, j) => {
      const x = (i - 1) * size / 3;
      const y = (j - 1) * size / 3;
      const inner = (i === 2 || i === 3) && (j === 2 || j === 3);
      return { x, y, z: inner ? crown : 0.0 };
    });

    const compound = _buildMeshCompound(oc, surf);

    const brepShape = new BrepShape(compound, {
      op: 'buildNurbsPatch',
      params: { size, crown },
      description: `4×4 clamped-cubic NURBS sail patch (${size}×${size} mm, crown=${crown} mm); ${GRID_N}×${GRID_N} triangulated mesh`,
      nurbsSurf: surf,
    });
    _attachNurbsDispose(brepShape);
    return brepShape;
  });
}

// ---------------------------------------------------------------------------
// 2. refineNurbs
// ---------------------------------------------------------------------------

/**
 * Refine a NURBS patch by inserting knots at u=0.25, 0.5, 0.75 and
 * v=0.25, 0.5, 0.75 (h-refinement). Preserves the surface shape exactly.
 *
 * @param {BrepShape} brepShape   Must have been created by buildNurbsPatch.
 * @returns {Promise<BrepShape>}
 */
export async function refineNurbs(brepShape, opts = {}) {
  if (!brepShape || !brepShape.shape) {
    throw new Error('refineNurbs: first argument must be a BrepShape with a live shape');
  }
  const srcSurf = brepShape.meta && brepShape.meta.nurbsSurf;
  if (!srcSurf) {
    throw new Error('refineNurbs: input does not contain a NURBS surface');
  }

  const oc = await getOCCT();
  return withScope(() => {
    // Clone the surface by copying its poles and knots.
    const surf = _cloneSurface(oc, srcSurf);

    // Insert knots at 0.25, 0.5, 0.75 in both u and v.
    const knotPositions = [0.25, 0.5, 0.75];
    for (const k of knotPositions) {
      surf.InsertUKnot(k, 1, 1e-6, true);
      surf.InsertVKnot(k, 1, 1e-6, true);
    }

    const compound = _buildMeshCompound(oc, surf);

    const resultShape = new BrepShape(compound, {
      op: 'refineNurbs',
      params: { knotsU: knotPositions, knotsV: knotPositions },
      parents: [brepShape.id],
      description: 'NURBS h-refinement — knots inserted at 0.25, 0.5, 0.75 in u and v',
      nurbsSurf: surf,
    });
    _attachNurbsDispose(resultShape);
    return resultShape;
  });
}

// ---------------------------------------------------------------------------
// 3. elevateNurbsDegree
// ---------------------------------------------------------------------------

/**
 * Elevate the degree of a NURBS patch in u and/or v (p-refinement).
 * Does NOT change the surface shape.
 *
 * @param {BrepShape} brepShape   Must have been created by buildNurbsPatch.
 * @param {object}    [opts]
 * @param {number}    [opts.uDegree]   Target u-degree (default: current + 1).
 * @param {number}    [opts.vDegree]   Target v-degree (default: current + 1).
 * @returns {Promise<BrepShape>}
 */
export async function elevateNurbsDegree(brepShape, opts = {}) {
  if (!brepShape || !brepShape.shape) {
    throw new Error('elevateNurbsDegree: first argument must be a BrepShape with a live shape');
  }
  const srcSurf = brepShape.meta && brepShape.meta.nurbsSurf;
  if (!srcSurf) {
    throw new Error('elevateNurbsDegree: input does not contain a NURBS surface');
  }

  const currentU = srcSurf.UDegree();
  const currentV = srcSurf.VDegree();
  const targetU = (opts.uDegree !== undefined) ? Number(opts.uDegree) : (currentU + 1);
  const targetV = (opts.vDegree !== undefined) ? Number(opts.vDegree) : (currentV + 1);

  if (targetU < currentU) {
    throw new Error(`elevateNurbsDegree: uDegree ${targetU} < current ${currentU}`);
  }
  if (targetV < currentV) {
    throw new Error(`elevateNurbsDegree: vDegree ${targetV} < current ${currentV}`);
  }

  const oc = await getOCCT();
  return withScope(() => {
    const surf = _cloneSurface(oc, srcSurf);
    surf.IncreaseDegree(targetU, targetV);

    const compound = _buildMeshCompound(oc, surf);

    const resultShape = new BrepShape(compound, {
      op: 'elevateNurbsDegree',
      params: { uDegree: targetU, vDegree: targetV },
      parents: [brepShape.id],
      description: `NURBS degree elevation: u=${currentU}→${targetU}, v=${currentV}→${targetV}`,
      nurbsSurf: surf,
    });
    _attachNurbsDispose(resultShape);
    return resultShape;
  });
}

// ---------------------------------------------------------------------------
// 4. nurbsCurvature
// ---------------------------------------------------------------------------

/**
 * Sample principal, Gaussian, and mean curvatures at a (u, v) parameter
 * on a NURBS surface using D2 derivatives + differential geometry.
 *
 * @param {BrepShape} brepShape   Must have been created by buildNurbsPatch.
 * @param {number}    u           Parameter in [0, 1].
 * @param {number}    v           Parameter in [0, 1].
 * @returns {Promise<{gaussian, mean, kMin, kMax, normal, position}>}
 */
export async function nurbsCurvature(brepShape, u = 0.5, v = 0.5) {
  if (!brepShape || !brepShape.shape) {
    throw new Error('nurbsCurvature: first argument must be a BrepShape with a live shape');
  }
  const surf = brepShape.meta && brepShape.meta.nurbsSurf;
  if (!surf) {
    throw new Error('nurbsCurvature: input does not contain a NURBS surface');
  }

  const oc = await getOCCT();
  return withScope(() => {
    // Plain object return — withScope frees all tracked objects but keeps
    // the plain JS object (not a BrepShape).
    return _computeCurvatureFromD2(oc, surf, u, v);
  });
}

// ---------------------------------------------------------------------------
// Internal: clone surface from meta
// ---------------------------------------------------------------------------

/**
 * Clone a Geom_BSplineSurface by copying its poles, knots, multiplicities.
 * Returns a new surface transient (NOT tracked — caller stores in meta).
 *
 * @param {object} oc
 * @param {object} srcSurf  existing Geom_BSplineSurface
 * @returns {object} new Geom_BSplineSurface (not tracked)
 */
function _cloneSurface(oc, srcSurf) {
  const nbU  = srcSurf.NbUPoles();
  const nbV  = srcSurf.NbVPoles();
  const nbUK = srcSurf.NbUKnots();
  const nbVK = srcSurf.NbVKnots();
  const degU = srcSurf.UDegree();
  const degV = srcSurf.VDegree();

  const poles = track(new oc.TColgp_Array2OfPnt_2(1, nbU, 1, nbV));
  for (let i = 1; i <= nbU; i++) {
    for (let j = 1; j <= nbV; j++) {
      const pole = track(srcSurf.Pole(i, j));
      poles.SetValue(i, j, pole);
    }
  }
  const uK = track(new oc.TColStd_Array1OfReal_2(1, nbUK));
  const vK = track(new oc.TColStd_Array1OfReal_2(1, nbVK));
  const uM = track(new oc.TColStd_Array1OfInteger_2(1, nbUK));
  const vM = track(new oc.TColStd_Array1OfInteger_2(1, nbVK));
  for (let k = 1; k <= nbUK; k++) {
    uK.SetValue(k, srcSurf.UKnot(k));
    uM.SetValue(k, srcSurf.UMultiplicity(k));
  }
  for (let k = 1; k <= nbVK; k++) {
    vK.SetValue(k, srcSurf.VKnot(k));
    vM.SetValue(k, srcSurf.VMultiplicity(k));
  }

  // NOT tracked — stored in meta by caller.
  return new oc.Geom_BSplineSurface_1(
    poles, uK, vK, uM, vM, degU, degV, false, false,
  );
}
