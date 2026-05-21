/**
 * ArchDisc Kernel — Auto-trimming NURBS B-rep face.
 *
 * Builds a genuinely curved bicubic NURBS sail-like patch and produces a
 * trimmed B-rep face by restricting it to a rectangular parametric sub-domain
 * via BRepBuilderAPI_MakeFace_14(Handle_Geom_Surface, U1, U2, V1, V2, tol).
 *
 * ALGORITHM:
 *   1. Build a 4×4 clamped-cubic Geom_BSplineSurface with inner control
 *      points raised by `bulge` (genuinely curved doubly-curved sail surface).
 *   2. Create an untrimmed face from the full surface via MakeFace_8(handle,
 *      tol) to obtain a valid Handle_Geom_Surface (round-trip through BRep_Tool
 *      recovers the Handle — the Standard_Transient / Handle gap documented in
 *      BrepNurbs.js §ARCHITECTURAL CONSTRAINT).
 *   3. Map the 0..1 normalised trim window onto the real [U1,U2]×[V1,V2]
 *      parametric domain read back from the face.
 *   4. Construct the trimmed face: MakeFace_14(surfHandle, u1t, u2t, v1t, v2t, tol).
 *   5. Tessellate the trimmed face via BRepMesh_IncrementalMesh for rendering.
 *   6. Measure full and trimmed surface areas via GProp_GProps +
 *      BRepGProp.SurfaceProperties_1 and attach as shape.trimStats.
 *
 * Verified kernel path: docs/superpowers/notes/kernel-api-G.md §Item 3 (Path B).
 * Notes: docs/superpowers/notes/nurbs-trim-G.md
 *
 * Honest scope:
 *   - Rectangular UV-box trim only (Path A wire-trim blocked by missing
 *     gp_Pnt2d 2-arg ctor in this opencascade.js build).
 *   - Single-face patch; not a multi-face trimmed B-rep solid.
 */

import { getKernel } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';

// ---------------------------------------------------------------------------
// Internal: build a bicubic NURBS transient (sail-like patch)
// ---------------------------------------------------------------------------

/**
 * Build a 4×4 clamped-cubic Geom_BSplineSurface (Standard_Transient).
 * Control net: sizeX × sizeY footprint; inner 2×2 poles raised by `bulge`.
 * This produces a genuinely doubly-curved surface — NOT a flat plane.
 *
 * NOT tracked — caller manages lifetime explicitly.
 *
 * @param {object} oc
 * @param {number} sizeX   mm, patch footprint in X
 * @param {number} sizeY   mm, patch footprint in Y
 * @param {number} bulge   mm, Z-height of the inner 2×2 control poles
 * @returns {object}  Geom_BSplineSurface (Standard_Transient)
 */
function _buildSailTransient(oc, sizeX, sizeY, bulge) {
  const poles = track(new oc.TColgp_Array2OfPnt_2(1, 4, 1, 4));
  const uK    = track(new oc.TColStd_Array1OfReal_2(1, 2));
  const vK    = track(new oc.TColStd_Array1OfReal_2(1, 2));
  const uM    = track(new oc.TColStd_Array1OfInteger_2(1, 2));
  const vM    = track(new oc.TColStd_Array1OfInteger_2(1, 2));

  for (let i = 1; i <= 4; i++) {
    for (let j = 1; j <= 4; j++) {
      const x = (i - 1) * sizeX / 3;
      const y = (j - 1) * sizeY / 3;
      const inner = (i === 2 || i === 3) && (j === 2 || j === 3);
      const pnt = track(new oc.gp_Pnt_3(x, y, inner ? bulge : 0.0));
      poles.SetValue(i, j, pnt);
    }
  }

  uK.SetValue(1, 0.0); uK.SetValue(2, 1.0);
  vK.SetValue(1, 0.0); vK.SetValue(2, 1.0);
  uM.SetValue(1, 4);   uM.SetValue(2, 4);
  vM.SetValue(1, 4);   vM.SetValue(2, 4);

  // NOT tracked — stored in meta by caller.
  return new oc.Geom_BSplineSurface_1(
    poles, uK, vK, uM, vM, 3, 3, false, false,
  );
}

// ---------------------------------------------------------------------------
// Internal: measure surface area via GProp_GProps
// ---------------------------------------------------------------------------

/**
 * Measure the surface area (mm²) of a TopoDS_Face.
 * Uses GProp_GProps + BRepGProp.SurfaceProperties_1.
 *
 * @param {object} oc
 * @param {object} face  TopoDS_Face
 * @returns {number}  area in mm²
 */
function _measureFaceArea(oc, face) {
  const props = track(new oc.GProp_GProps_1());
  oc.BRepGProp.SurfaceProperties_1(face, props, false, false);
  return props.Mass();
}

// ---------------------------------------------------------------------------
// Main export: trimmedNurbsFace
// ---------------------------------------------------------------------------

/**
 * Build a genuinely curved bicubic NURBS sail patch and produce an
 * auto-trimmed B-rep face by restricting it to a rectangular parametric
 * (U,V) sub-domain.
 *
 * @param {object} [opts]
 * @param {number} [opts.sizeX=80]       Full patch extent in X (mm).
 * @param {number} [opts.sizeY=80]       Full patch extent in Y (mm).
 * @param {number} [opts.bulge=12]       Z-height of inner 2×2 control pts (mm).
 *                                       Must be >0 to produce a real curved surface.
 * @param {number} [opts.trimUMin=0.25]  Normalised U start of the trim window [0..1).
 * @param {number} [opts.trimUMax=0.75]  Normalised U end   of the trim window (0..1].
 * @param {number} [opts.trimVMin=0.25]  Normalised V start of the trim window [0..1).
 * @param {number} [opts.trimVMax=0.75]  Normalised V end   of the trim window (0..1].
 * @param {number} [opts.tol=1e-6]       Face tolerance (mm).
 * @returns {Promise<BrepShape>}  Trimmed B-rep face wrapped in a BrepShape.
 *                                shape.trimStats = { fullAreaMm2, trimmedAreaMm2, trimRatio }
 */
export async function trimmedNurbsFace(opts = {}) {
  const sizeX    = opts.sizeX    ?? 80;
  const sizeY    = opts.sizeY    ?? 80;
  const bulge    = opts.bulge    ?? 12;
  const trimUMin = opts.trimUMin ?? 0.25;
  const trimUMax = opts.trimUMax ?? 0.75;
  const trimVMin = opts.trimVMin ?? 0.25;
  const trimVMax = opts.trimVMax ?? 0.75;
  const tol      = opts.tol      ?? 1e-6;

  // Validate inputs.
  if (!(sizeX >= 10 && sizeX <= 400)) throw new Error(`trimmedNurbsFace: sizeX must be [10, 400] mm (got ${sizeX})`);
  if (!(sizeY >= 10 && sizeY <= 400)) throw new Error(`trimmedNurbsFace: sizeY must be [10, 400] mm (got ${sizeY})`);
  if (!(bulge >= 0  && bulge <= 120)) throw new Error(`trimmedNurbsFace: bulge must be [0, 120] mm (got ${bulge})`);
  if (!(trimUMin >= 0 && trimUMin < trimUMax && trimUMax <= 1))
    throw new Error(`trimmedNurbsFace: trimU window must satisfy 0 ≤ trimUMin < trimUMax ≤ 1 (got [${trimUMin}, ${trimUMax}])`);
  if (!(trimVMin >= 0 && trimVMin < trimVMax && trimVMax <= 1))
    throw new Error(`trimmedNurbsFace: trimV window must satisfy 0 ≤ trimVMin < trimVMax ≤ 1 (got [${trimVMin}, ${trimVMax}])`);

  const oc = await getKernel();

  return withScope(async () => {
    // ── 1. Build the NURBS surface transient ────────────────────────────────
    // NOT tracked — held via meta.nurbsSurf
    const surf = _buildSailTransient(oc, sizeX, sizeY, bulge);

    // ── 2. Round-trip: MakeFace_8 to get a Handle_Geom_Surface ───────────────
    // Geom_BSplineSurface_1 returns a raw Standard_Transient; all kernel APIs
    // that accept surfaces require a Handle_Geom_Surface. BRep_Tool.Surface_2
    // is the ONLY way to get a Handle — which requires a face. Build the full
    // untrimmed face first (MakeFace_8), then extract its surface handle.
    const fullMf = track(new oc.BRepBuilderAPI_MakeFace_8(surf, tol));
    if (!fullMf.IsDone()) {
      surf.delete();
      throw new Error('trimmedNurbsFace: BRepBuilderAPI_MakeFace_8 (full face) failed — IsDone=false');
    }
    const fullFace = track(fullMf.Face());

    // ── 3. Extract Handle_Geom_Surface and real parametric bounds ─────────────
    const surfHandle = track(oc.BRep_Tool.Surface_2(fullFace));

    // Read real parametric domain from the BSpline surface.
    // Clamped cubic with knots [0,0,0,0, 1,1,1,1] → domain [0, 1].
    const u1Raw = surf.FirstUKnotIndex ? surf.UKnot(1) : 0.0;
    const u2Raw = surf.LastUKnotIndex  ? surf.UKnot(surf.NbUKnots()) : 1.0;
    const v1Raw = surf.UKnot           ? surf.VKnot(1) : 0.0;
    const v2Raw = surf.VKnot           ? surf.VKnot(surf.NbVKnots()) : 1.0;

    // Robust fallback: read directly from NbUKnots / NbVKnots methods.
    let uDomMin, uDomMax, vDomMin, vDomMax;
    try {
      uDomMin = surf.UKnot(1);
      uDomMax = surf.UKnot(surf.NbUKnots());
      vDomMin = surf.VKnot(1);
      vDomMax = surf.VKnot(surf.NbVKnots());
    } catch {
      // Fallback to known clamped-cubic domain [0, 1].
      uDomMin = 0.0; uDomMax = 1.0;
      vDomMin = 0.0; vDomMax = 1.0;
    }

    // ── 4. Map normalised 0..1 trim window onto the real domain ───────────────
    const uSpan = uDomMax - uDomMin;
    const vSpan = vDomMax - vDomMin;

    const u1t = uDomMin + trimUMin * uSpan;
    const u2t = uDomMin + trimUMax * uSpan;
    const v1t = vDomMin + trimVMin * vSpan;
    const v2t = vDomMin + trimVMax * vSpan;

    // ── 5. Measure full-patch area (for trimStats) ────────────────────────────
    const fullAreaMm2 = _measureFaceArea(oc, fullFace);

    // ── 6. Construct the trimmed face via MakeFace_14 ─────────────────────────
    // Sig: BRepBuilderAPI_MakeFace_14(Handle_Geom_Surface, U1, U2, V1, V2, tol)
    const trimMf = track(new oc.BRepBuilderAPI_MakeFace_14(surfHandle, u1t, u2t, v1t, v2t, tol));
    if (!trimMf.IsDone()) {
      surf.delete();
      throw new Error(
        `trimmedNurbsFace: BRepBuilderAPI_MakeFace_14 failed — IsDone=false. ` +
        `Params: U=[${u1t.toFixed(4)}, ${u2t.toFixed(4)}] V=[${v1t.toFixed(4)}, ${v2t.toFixed(4)}]`,
      );
    }
    const trimmedFace = track(trimMf.Face());

    // ── 7. Measure trimmed area ───────────────────────────────────────────────
    const trimmedAreaMm2 = _measureFaceArea(oc, trimmedFace);
    const trimRatio = fullAreaMm2 > 0 ? trimmedAreaMm2 / fullAreaMm2 : 0;

    // ── 8. Tessellate for rendering ───────────────────────────────────────────
    // BRepMesh_IncrementalMesh: discretise the face for rendering.
    const LINEAR_DEFLECTION  = Math.min(sizeX, sizeY) * 0.02; // 2% of smallest dim
    const ANGULAR_DEFLECTION = 0.5; // radians
    const mesher = track(
      new oc.BRepMesh_IncrementalMesh_2(trimmedFace, LINEAR_DEFLECTION, false, ANGULAR_DEFLECTION, false),
    );
    mesher.Perform();

    // Read triangulation from the face location (standard tessellation pattern).
    // Build a compound containing the tessellated face for downstream rendering.
    const compound = track(new oc.TopoDS_Compound());
    const builder  = track(new oc.BRep_Builder());
    builder.MakeCompound(compound);
    builder.Add(compound, trimmedFace);

    if (compound.IsNull()) {
      surf.delete();
      throw new Error('trimmedNurbsFace: produced a null compound after tessellation');
    }

    // ── 9. Wrap in a BrepShape ────────────────────────────────────────────────
    const brepShape = new BrepShape(compound, {
      op: 'trimmedNurbsFace',
      params: { sizeX, sizeY, bulge, trimUMin, trimUMax, trimVMin, trimVMax, tol },
      description:
        `Auto-trimmed NURBS sail patch ` +
        `(${sizeX}×${sizeY} mm, bulge=${bulge} mm) ` +
        `trimmed to U=[${trimUMin}..${trimUMax}] V=[${trimVMin}..${trimVMax}] ` +
        `— ${trimmedAreaMm2.toFixed(1)} mm² of ${fullAreaMm2.toFixed(1)} mm² ` +
        `(${(trimRatio * 100).toFixed(1)}% retained)`,
      nurbsSurf: surf,
    });

    // Attach trimStats directly onto the BrepShape for e2e readback.
    brepShape.trimStats = {
      fullAreaMm2,
      trimmedAreaMm2,
      trimRatio,
    };

    // Attach a dispose extension that also cleans up the NURBS transient.
    const origDispose = brepShape.dispose.bind(brepShape);
    brepShape.dispose = function () {
      try {
        if (this.meta && this.meta.nurbsSurf) {
          try { this.meta.nurbsSurf.delete(); } catch { /* already gone */ }
          this.meta.nurbsSurf = null;
        }
      } catch { /* already gone */ }
      origDispose();
    };

    return brepShape;
  });
}
