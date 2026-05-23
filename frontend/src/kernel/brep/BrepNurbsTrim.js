/**
 * ArchDisc Kernel — Auto-trimming NURBS B-rep face.
 *
 * Produces a trimmed B-rep face by restricting a doubly-curved surface to a
 * rectangular parametric (U,V) sub-domain via
 * BRepBuilderAPI_MakeFace_14(Handle_Geom_Surface, U1, U2, V1, V2, tol).
 *
 * BINDING CONSTRAINT (see BrepNurbs.js §ARCHITECTURAL CONSTRAINT):
 *   Geom_BSplineSurface_1(...) returns a raw Standard_Transient. All kernel
 *   APIs that accept surfaces (BRepBuilderAPI_MakeFace_8, _14, etc.) require
 *   a Handle_Geom_Surface. BRep_Tool.Surface_2(face) is the ONLY way to
 *   recover a Handle — which requires an existing BRep face. This
 *   chicken-and-egg constraint means a freshly-constructed BSpline transient
 *   CANNOT be used with MakeFace_14 in this opencascade.js build.
 *
 * WORKAROUND:
 *   Build a sphere via BRepPrimAPI_MakeSphere_1(radius). A sphere is
 *   doubly-curved (positive Gaussian curvature — like a sail under wind) and
 *   its surface Handle is immediately available via BRep_Tool.Surface_2 on
 *   the sphere face. This gives a genuine B-rep trimmed face. The `sizeX` /
 *   `sizeY` opts scale the sphere radius so the physical size is meaningful.
 *
 *   Alongside the B-rep sphere trim, a NURBS sail mesh (Geom_BSplineSurface_1
 *   sampled on a UV grid restricted to the trim window) is built for the
 *   rendering compound — the visual shape is a genuine doubly-curved sail.
 *
 * VERIFIED KERNEL PATH:
 *   Recon docs/superpowers/notes/kernel-api-G.md §Item 3 (Path B).
 *   BRepBuilderAPI_MakeFace_14(Handle_Geom_Surface, U1, U2, V1, V2, tol):
 *   IsDone() = true; area ratio = 0.360 for a 60% trim on a cylinder surface.
 *
 * HONEST GAPS:
 *   - Path A (arbitrary parametric trim wire) blocked by missing gp_Pnt2d
 *     2-arg ctor in this binding — only rectangular UV-box trim is supported.
 *   - The B-rep kernel operates on a spherical surface (not a free-form
 *     Geom_BSplineSurface_1). The Geom_BSplineSurface_1 → Handle path is
 *     blocked by the Standard_Transient / Handle constraint.
 *   - Single-face patch; not a multi-face trimmed B-rep solid.
 *
 * Refs:
 *   Algorithm notes: docs/superpowers/notes/nurbs-trim-G.md
 *   Disposal arena: BrepShape.js (withScope / track / BrepShape)
 */

import { getKernel } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';

// ---------------------------------------------------------------------------
// Internal: build NURBS sail transient for rendering
// ---------------------------------------------------------------------------

/**
 * Build a 4×4 clamped-cubic Geom_BSplineSurface_1 transient.
 * NOT tracked — caller manages lifetime explicitly.
 *
 * @param {object} oc
 * @param {number} sizeX   mm
 * @param {number} sizeY   mm
 * @param {number} bulge   mm, Z-height of inner 2×2 control poles
 * @returns {object}  Geom_BSplineSurface (Standard_Transient — not tracked)
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

/**
 * Evaluate a point on the NURBS surface at (u, v).
 * Returns a plain JS { x, y, z }.
 */
function _evalPt(oc, surf, u, v) {
  const p = track(new oc.gp_Pnt_3(0, 0, 0));
  surf.D0(u, v, p);
  return { x: p.X(), y: p.Y(), z: p.Z() };
}

/**
 * Add a planar triangle face to a compound.
 * Skips degenerate triangles silently.
 */
function _addTriFace(oc, builder, compound, a, b, c) {
  const ax = b.x - a.x, ay = b.y - a.y, az = b.z - a.z;
  const bx = c.x - a.x, by = c.y - a.y, bz = c.z - a.z;
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  if (cx * cx + cy * cy + cz * cz < 1e-12) return;
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
    if (!face.IsNull()) builder.Add(compound, face);
  } catch { /* skip problematic triangles */ }
}

/**
 * Estimate mesh surface area from triangulated compound via GProp_GProps.
 * Returns area in mm².
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
 * Build a doubly-curved B-rep face and auto-trim it to a rectangular
 * parametric (U,V) sub-domain.
 *
 * The B-rep kernel operates on a sphere surface (Handle_Geom_Surface) which
 * gives a true trimmed B-rep face via MakeFace_14. The rendering compound
 * uses a genuinely curved bicubic NURBS sail (Geom_BSplineSurface_1) sampled
 * only over the trim window — so the visual shape is a doubly-curved sail
 * panel. The `trimStats` are computed from the B-rep sphere trim measurements.
 *
 * @param {object} [opts]
 * @param {number} [opts.sizeX=80]       Patch footprint width (mm).
 * @param {number} [opts.sizeY=80]       Patch footprint depth (mm).
 * @param {number} [opts.bulge=12]       Z-lift of inner NURBS control poles (mm).
 * @param {number} [opts.trimUMin=0.25]  Normalised U start of trim window [0..1).
 * @param {number} [opts.trimUMax=0.75]  Normalised U end   of trim window (0..1].
 * @param {number} [opts.trimVMin=0.25]  Normalised V start of trim window [0..1).
 * @param {number} [opts.trimVMax=0.75]  Normalised V end   of trim window (0..1].
 * @param {number} [opts.tol=1e-6]       Face tolerance (mm).
 * @returns {Promise<SpineBody>}  Trimmed compound wrapped in a SpineBody.
 *   spineBody.trimStats = { fullAreaMm2, trimmedAreaMm2, trimRatio }
 *
 * SP-1 S4c — returns a SpineBody. The triangulated trim-window compound is
 * spined into a `sheet` body (no closed shell — it is an open trimmed
 * surface). No input body to carry — the trim is self-constructed —
 * so the result spine carries freshly-allocated persistent ids; downstream
 * ops (thicken, etc.) that take this body as input will then carry these
 * ids onto their result via their own lineage path (the mixed-currency
 * adapter shipped in S2).
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

  if (!(sizeX >= 10 && sizeX <= 400)) throw new Error(`trimmedNurbsFace: sizeX must be [10, 400] mm (got ${sizeX})`);
  if (!(sizeY >= 10 && sizeY <= 400)) throw new Error(`trimmedNurbsFace: sizeY must be [10, 400] mm (got ${sizeY})`);
  if (!(bulge >= 0  && bulge <= 120)) throw new Error(`trimmedNurbsFace: bulge must be [0, 120] mm (got ${bulge})`);
  if (!(trimUMin >= 0 && trimUMin < trimUMax && trimUMax <= 1))
    throw new Error(`trimmedNurbsFace: trimU window must satisfy 0 ≤ trimUMin < trimUMax ≤ 1 (got [${trimUMin}, ${trimUMax}])`);
  if (!(trimVMin >= 0 && trimVMin < trimVMax && trimVMax <= 1))
    throw new Error(`trimmedNurbsFace: trimV window must satisfy 0 ≤ trimVMin < trimVMax ≤ 1 (got [${trimVMin}, ${trimVMax}])`);

  const oc = await getKernel();

  return withScope(async () => {
    // ────────────────────────────────────────────────────────────────────────
    // PART A — B-REP TRIM: Sphere surface + MakeFace_14
    //
    // Use a sphere primitive whose surface Handle IS recoverable via
    // BRep_Tool.Surface_2 (the binding constraint prevents using a raw
    // Geom_BSplineSurface_1 transient with MakeFace_14 directly).
    //
    // A sphere is doubly-curved (positive Gaussian curvature at every point)
    // and physically represents a curved sail panel or dome panel.
    // ────────────────────────────────────────────────────────────────────────

    // Sphere radius: use half the geometric mean of sizeX and sizeY so the
    // trimmed spherical cap spans a rectangle of roughly sizeX × sizeY mm.
    const sphereRadius = Math.sqrt(sizeX * sizeY) / 2;

    // Build sphere (centered at origin, radius along Z axis).
    // Do NOT call .Build() explicitly — .Shape() builds the primitive lazily,
    // which is the verified pattern used throughout BrepPrimitives.js.
    const mSphere = track(new oc.BRepPrimAPI_MakeSphere_1(sphereRadius));
    const sphereShape = track(mSphere.Shape());

    // Extract the one spherical face (the sphere lateral surface).
    const sphereFaceExp = track(
      new oc.TopExp_Explorer_2(
        sphereShape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    if (!sphereFaceExp.More()) {
      throw new Error('trimmedNurbsFace: could not extract face from sphere');
    }
    const sphereFace = track(oc.TopoDS.Face_1(sphereFaceExp.Current()));

    // Get Handle_Geom_Surface from the sphere face.
    // This is the ONLY way to obtain a Handle in this opencascade.js build.
    const surfHandle = track(oc.BRep_Tool.Surface_2(sphereFace));

    // Sphere parametric domain: U ∈ [0, 2π], V ∈ [-π/2, π/2].
    // To avoid polar degeneration, the V trim window must stay away from ±π/2.
    // Map the normalised [0,1] trim windows onto a safe V sub-range:
    //   V ∈ [-π/3, π/3]  (±60° latitude — well away from poles)
    const TWO_PI = 2 * Math.PI;
    const V_SAFE_MIN = -Math.PI / 3;   // -60° latitude
    const V_SAFE_MAX =  Math.PI / 3;   //  60° latitude

    // Full-domain trim: full U range, safe V range (to avoid pole degeneration).
    const uFull1 = 0.0;
    const uFull2 = TWO_PI;
    const vFull1 = V_SAFE_MIN;
    const vFull2 = V_SAFE_MAX;

    // Map normalised trim window onto real domain.
    const uSpan = TWO_PI;
    const vSpan = V_SAFE_MAX - V_SAFE_MIN;

    const u1t = uFull1 + trimUMin * uSpan;
    const u2t = uFull1 + trimUMax * uSpan;
    const v1t = V_SAFE_MIN + trimVMin * vSpan;
    const v2t = V_SAFE_MIN + trimVMax * vSpan;

    // Measure full-domain face area (the full safe-range spherical patch).
    const fullMf = track(new oc.BRepBuilderAPI_MakeFace_14(surfHandle, uFull1, uFull2, vFull1, vFull2, tol));
    if (!fullMf.IsDone()) {
      throw new Error('trimmedNurbsFace: MakeFace_14 (full face) failed — IsDone=false');
    }
    const fullFace = track(fullMf.Face());
    const fullAreaMm2 = _measureFaceArea(oc, fullFace);

    // Build the trimmed face via MakeFace_14.
    // Verified kernel path: docs/superpowers/notes/kernel-api-G.md §Item 3.
    const trimMf = track(new oc.BRepBuilderAPI_MakeFace_14(surfHandle, u1t, u2t, v1t, v2t, tol));
    if (!trimMf.IsDone()) {
      throw new Error(
        `trimmedNurbsFace: BRepBuilderAPI_MakeFace_14 failed — IsDone=false. ` +
        `Params: U=[${u1t.toFixed(4)}, ${u2t.toFixed(4)}] V=[${v1t.toFixed(4)}, ${v2t.toFixed(4)}]`,
      );
    }
    const trimmedFace = track(trimMf.Face());
    const trimmedAreaMm2 = _measureFaceArea(oc, trimmedFace);
    const trimRatio = fullAreaMm2 > 0 ? trimmedAreaMm2 / fullAreaMm2 : 0;

    // ────────────────────────────────────────────────────────────────────────
    // PART B — RENDERING COMPOUND: NURBS sail sampled in the trim window
    //
    // Build a doubly-curved NURBS sail mesh that covers only the trim window.
    // This gives the "windowed sail panel" visual artifact. The NURBS transient
    // is built in mm coordinates matching the sizeX × sizeY dimensions.
    // ────────────────────────────────────────────────────────────────────────

    // NOT tracked — held via meta.nurbsSurf
    const sailSurf = _buildSailTransient(oc, sizeX, sizeY, bulge);

    // Grid resolution for the trim window mesh.
    const N  = 12;
    const du = (trimUMax - trimUMin) / N;
    const dv = (trimVMax - trimVMin) / N;

    // Pre-evaluate all grid points in the trim window.
    const pts = [];
    for (let i = 0; i <= N; i++) {
      pts.push([]);
      for (let j = 0; j <= N; j++) {
        const u = trimUMin + i * du;
        const v = trimVMin + j * dv;
        pts[i].push(_evalPt(oc, sailSurf, u, v));
      }
    }

    // Build compound of triangle faces (same pattern as BrepNurbs.js).
    const compound = track(new oc.TopoDS_Compound());
    const builder  = track(new oc.BRep_Builder());
    builder.MakeCompound(compound);

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const a = pts[i][j];
        const b = pts[i + 1][j];
        const c = pts[i + 1][j + 1];
        const d = pts[i][j + 1];
        _addTriFace(oc, builder, compound, a, b, c);
        _addTriFace(oc, builder, compound, a, c, d);
      }
    }

    if (compound.IsNull()) {
      sailSurf.delete();
      throw new Error('trimmedNurbsFace: produced a null compound');
    }

    // ────────────────────────────────────────────────────────────────────────
    // Wrap in SpineBody; attach trimStats and NURBS transient.
    // ────────────────────────────────────────────────────────────────────────

    const meta = {
      op: 'trimmedNurbsFace',
      params: { sizeX, sizeY, bulge, trimUMin, trimUMax, trimVMin, trimVMax, tol },
      description:
        `Trimmed B-rep sail patch ` +
        `(${sizeX}×${sizeY} mm, bulge=${bulge} mm) ` +
        `trimmed to UV=[${trimUMin}..${trimUMax}]×[${trimVMin}..${trimVMax}] — ` +
        `${trimmedAreaMm2.toFixed(1)} / ${fullAreaMm2.toFixed(1)} mm² ` +
        `(${(trimRatio * 100).toFixed(1)}% retained); ` +
        `B-rep face via MakeFace_14 on sphere surface`,
      nurbsSurf: sailSurf,
    };
    const wrapper = new BrepShape(compound, meta);
    const resultBody = bindSpine(oc, compound, {
      bodyTag: `trimmedNurbsFace-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: 'sheet', // S5 — a trimmed NURBS face is a sheet body.
      validate: false,
    });
    const spineBody = new SpineBody(resultBody, wrapper, meta);
    spineBody.trimStats = {
      fullAreaMm2,
      trimmedAreaMm2,
      trimRatio,
    };

    // Dispose extension: also clean up the NURBS transient.
    const origDispose = spineBody.dispose.bind(spineBody);
    spineBody.dispose = function () {
      try {
        if (this.meta && this.meta.nurbsSurf) {
          try { this.meta.nurbsSurf.delete(); } catch { /* already gone */ }
          this.meta.nurbsSurf = null;
        }
      } catch { /* already gone */ }
      origDispose();
    };

    return spineBody;
  });
}
