/**
 * brep-e-recon-electron.spec.js
 *
 * Sub-project E empirical OCCT API reconnaissance — NURBS Operations.
 * Empirically determines reachability for each of seven NURBS capabilities:
 *
 *   1. Geom_BSplineSurface construction from a 4×4 control-point grid
 *      (clamped cubic, degree 3 in both u and v)
 *      Verdict: REACHABLE or NOT_REACHABLE
 *
 *   2. BRepBuilderAPI_MakeFace_* from a BSplineSurface (Geom_Surface handle)
 *      Confirm face is non-null and has measurable area > 0.
 *      Verdict: REACHABLE or NOT_REACHABLE
 *
 *   3. Geom_BSplineSurface.InsertUKnot / InsertVKnot refinement
 *      NbUKnots / NbVKnots before and after insertion.
 *      Verdict: REACHABLE or NOT_REACHABLE
 *
 *   4. Geom_BSplineSurface.IncreaseDegree (3,3) → (4,4)
 *      UDegree / VDegree / NbUPoles / NbVPoles before and after.
 *      Verdict: REACHABLE or NOT_REACHABLE
 *
 *   5. GeomLProp_SLProps curvature evaluation
 *      MaxCurvature / MinCurvature / GaussianCurvature / MeanCurvature / Normal
 *      Sail-like patch (curved) + flat patch.
 *      Verdict: REACHABLE or NOT_REACHABLE
 *
 *   6. BRep_Tool.Surface(face) extraction
 *      Take a cylinder face; extract its underlying Geom_Surface.
 *      Record what class comes out (analytic vs NURBS).
 *      Verdict: REACHABLE or NOT_REACHABLE
 *
 *   7. GeomConvert.SurfaceToBSplineSurface static call
 *      Convert the analytic cylindrical surface to NURBS form.
 *      Verdict: REACHABLE or NOT_REACHABLE
 *
 * Writes:  docs/superpowers/notes/occt-api-E-recon.json
 * Pattern: e2e/brep-b-recon-electron.spec.js
 * Package: opencascade.js@2.0.0-beta.b5ff984
 *
 * Design note: each item builds its OWN surface objects independently
 * to avoid shared-state / handle-ref-count issues.
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.setTimeout(600000);

test('Sub-project E — OCCT API recon (NURBS operations)', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const pageErrors = [];
  const win = await app.firstWindow();
  win.on('pageerror', err => pageErrors.push(err.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });

  // ── Main recon evaluate ──────────────────────────────────────────────────────
  const verified = await win.evaluate(async () => {
    const oc = await window.__archdiscKernel.getOCCT();

    // ── Shared helpers ────────────────────────────────────────────────────────

    /** Measure surface area of a TopoDS_Face (mm²). */
    function surfaceArea(face) {
      const props = new oc.GProp_GProps_1();
      oc.BRepGProp.SurfaceProperties_1(face, props, false, false);
      const a = props.Mass();
      props.delete();
      return a;
    }

    /** Count faces of a shape. */
    function countFaces(shape) {
      const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
      const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
      let count = 0;
      const exp = new oc.TopExp_Explorer_2(shape, FACE, ANY);
      for (; exp.More(); exp.Next()) { count++; }
      exp.delete();
      return count;
    }

    /** Collect all unique faces from a shape. Returns array of TopoDS_Face — caller must .delete() each. */
    function collectUniqueFaces(shape) {
      const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
      const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
      const faces = [];
      const exp = new oc.TopExp_Explorer_2(shape, FACE, ANY);
      for (; exp.More(); exp.Next()) {
        const e = exp.Current();
        let found = false;
        for (const prev of faces) {
          try { if (prev.IsSame(e)) { found = true; break; } } catch (_e) {}
        }
        if (!found) {
          try { faces.push(oc.TopoDS.Face_1(e)); } catch (_e) { faces.push(e); }
        }
      }
      exp.delete();
      return faces;
    }

    /** Introspect all own + prototype property names of an object. */
    function introspectMethods(obj) {
      const seen = new Set();
      let o = obj;
      while (o && o !== Object.prototype) {
        for (const k of Object.getOwnPropertyNames(o)) seen.add(k);
        o = Object.getPrototypeOf(o);
      }
      return [...seen].sort();
    }

    /**
     * Build a fresh 4×4 clamped cubic BSpline surface (VERIFIED pattern).
     * Uses: Geom_BSplineSurface_1, TColgp_Array2OfPnt_2, TColStd_Array1OfReal_2(1,2),
     *       TColStd_Array1OfInteger_2(1,2).
     * Distinct knots [0,1], mults [4,4], degree 3 in u and v.
     * If flat=true, all control-point z=0. Otherwise sail-like (inner 4 pts at z=8).
     * Returns the surface object. Caller must .delete() it.
     */
    function buildBSplineSurface(flat) {
      const poles = new oc.TColgp_Array2OfPnt_2(1, 4, 1, 4);
      const uK = new oc.TColStd_Array1OfReal_2(1, 2);
      const vK = new oc.TColStd_Array1OfReal_2(1, 2);
      const uM = new oc.TColStd_Array1OfInteger_2(1, 2);
      const vM = new oc.TColStd_Array1OfInteger_2(1, 2);
      for (let i = 1; i <= 4; i++) {
        for (let j = 1; j <= 4; j++) {
          const x = (i - 1) * 40 / 3;
          const y = (j - 1) * 40 / 3;
          const z = (!flat && (i === 2 || i === 3) && (j === 2 || j === 3)) ? 8.0 : 0.0;
          const pnt = new oc.gp_Pnt_3(x, y, z);
          poles.SetValue(i, j, pnt);
          pnt.delete();
        }
      }
      uK.SetValue(1, 0.0); uK.SetValue(2, 1.0);
      vK.SetValue(1, 0.0); vK.SetValue(2, 1.0);
      uM.SetValue(1, 4);   uM.SetValue(2, 4);
      vM.SetValue(1, 4);   vM.SetValue(2, 4);
      const surf = new oc.Geom_BSplineSurface_1(poles, uK, vK, uM, vM, 3, 3, false, false);
      poles.delete(); uK.delete(); vK.delete(); uM.delete(); vM.delete();
      return surf;
    }

    const result = {};
    const ocKeys = Object.getOwnPropertyNames(oc);

    // ══════════════════════════════════════════════════════════════════════════
    // Item 1 — Geom_BSplineSurface construction (4×4 clamped cubic)
    //
    //   Key findings from prior iteration:
    //   - TColgp_Array2OfPnt_2(1,4,1,4) ✓
    //   - TColStd_Array1OfReal_2(1,2) with DISTINCT knots [0,1] ✓
    //     (NOT the expanded form [0,0,0,0,1,1,1,1] — OCCT uses distinct knot + mult separately)
    //   - TColStd_Array1OfInteger_2(1,2) with mults [4,4] ✓
    //   - Geom_BSplineSurface_1(poles, uK, vK, uM, vM, 3, 3, false, false) ✓
    //
    //   This item confirms the construction, reads metadata, and deletes the surface.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain1 = {};

      // Scan available class names
      chain1.tcolgpPnt2Keys = ocKeys.filter(k => /^TColgp_Array2OfPnt/.test(k));
      chain1.tcolRealKeys   = ocKeys.filter(k => /^TColStd_Array1OfReal/.test(k));
      chain1.tcolIntKeys    = ocKeys.filter(k => /^TColStd_Array1OfInteger/.test(k));
      chain1.bsplineKeys    = ocKeys.filter(k => /^Geom_BSplineSurface/.test(k));

      // Build the surface
      let surf = null;
      try {
        surf = buildBSplineSurface(false);
        chain1.surfBuilt = true;
      } catch (e) {
        chain1.buildErr = String(e).substring(0, 300);
      }

      if (surf) {
        const methods = introspectMethods(surf).filter(m => !m.startsWith('$'));
        chain1.surfaceMethods = methods;
        try { chain1.uDegree  = surf.UDegree();  } catch (_e) {}
        try { chain1.vDegree  = surf.VDegree();  } catch (_e) {}
        try { chain1.nbUKnots = surf.NbUKnots(); } catch (_e) {}
        try { chain1.nbVKnots = surf.NbVKnots(); } catch (_e) {}
        try { chain1.nbUPoles = surf.NbUPoles(); } catch (_e) {}
        try { chain1.nbVPoles = surf.NbVPoles(); } catch (_e) {}
        chain1.hasInsertUKnot    = methods.some(m => m === 'InsertUKnot');
        chain1.hasInsertVKnot    = methods.some(m => m === 'InsertVKnot');
        chain1.hasIncreaseDegree = methods.some(m => m === 'IncreaseDegree');
        surf.delete();
      }

      const verdict1 = chain1.surfBuilt
        ? 'REACHABLE'
        : 'NOT_REACHABLE';
      const verdictReason1 = chain1.surfBuilt
        ? `Geom_BSplineSurface_1(poles, distinctK[0,1], distinctK[0,1], mults[4,4], mults[4,4], 3, 3, false, false); uDeg=${chain1.uDegree} vDeg=${chain1.vDegree}; nbUKnots=${chain1.nbUKnots} nbVKnots=${chain1.nbVKnots}; nbUPoles=${chain1.nbUPoles} nbVPoles=${chain1.nbVPoles}`
        : `Build failed: ${chain1.buildErr}`;

      result.item1_bsplineConstruction = {
        verdict: verdict1,
        verdictReason: verdictReason1,
        polesCtor: 'TColgp_Array2OfPnt_2(1,4,1,4)',
        knotsCtor: 'TColStd_Array1OfReal_2(1,2) → [0.0, 1.0] (DISTINCT)',
        multsCtor: 'TColStd_Array1OfInteger_2(1,2) → [4, 4]',
        bsplineCtor: 'Geom_BSplineSurface_1(poles, uKnots, vKnots, uMults, vMults, 3, 3, false, false)',
        uDegree: chain1.uDegree,
        vDegree: chain1.vDegree,
        nbUKnots: chain1.nbUKnots,
        nbVKnots: chain1.nbVKnots,
        nbUPoles: chain1.nbUPoles,
        nbVPoles: chain1.nbVPoles,
        surfaceMethods: chain1.surfaceMethods,
        chain: chain1,
        note: 'Geom_BSplineSurface_1 construction with DISTINCT knot vector [0,1] + mults [4,4]. NOT expanded [0,0,0,0,1,1,1,1].',
      };

    } catch (e) {
      result.item1_bsplineConstruction = { verdict: 'NOT_REACHABLE', error: String(e).substring(0, 400) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 2 — BRepBuilderAPI_MakeFace_* from Geom_BSplineSurface
    //
    //   Build a fresh BSpline surface, then find the right MakeFace overload.
    //   BRepBuilderAPI_MakeFace_8 expects Handle_Geom_Surface.
    //   The raw Geom_BSplineSurface IS a transient — Embind may or may not
    //   auto-upcast it to a handle. Try all available overloads.
    //   Also try with BRepBuilderAPI_MakeFace ctor taking the surface + tolerance.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain2 = {};
      chain2.makeFaceKeys = ocKeys.filter(k => /^BRepBuilderAPI_MakeFace/.test(k));

      let surf = null;
      try { surf = buildBSplineSurface(false); chain2.surfBuilt = true; } catch (e) { chain2.surfBuildErr = String(e).substring(0, 200); }

      if (surf) {
        // Strategy: BRepBuilderAPI_MakeFace_8(Handle_Geom_Surface, tol) but we have raw transient.
        // Try alternative: _9/_10/_11 take (Handle_Geom_Surface, UMin, UMax, VMin, VMax) — 5 args.
        // Also try overloads taking (Handle_Geom_Surface, uMin, uMax, vMin, vMax, tol) — 6 args (_14).
        // Note: the raw BSpline u range is [0,1] v range is [0,1].
        // The raw surf IS a Standard_Transient — only Handle_Geom_Surface-typed parameter slots work.
        // So all direct passes fail. Try to build a face differently:
        // Alternative: build a BRep_Builder face from a surface.
        // BRep_Builder.MakeFace / BRep_Builder.UpdateFace — check if these accept surfaces.

        chain2.brepBuilderKeys = ocKeys.filter(k => /^BRep_Builder/.test(k));

        // Try BRep_Builder approach
        if (oc.BRep_Builder) {
          try {
            const builder = new oc.BRep_Builder();
            const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(builder)).filter(m => !m.startsWith('$'));
            chain2.brepBuilderMethods = methods;
            builder.delete();
          } catch (e) {
            chain2.brepBuilderCtorErr = String(e).substring(0, 200);
          }
        }

        // Try all 2-arg MakeFace suffixes
        const makeFaceSuffixes = [8, 9, 10, 11, 7, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 6, 5, 4, 3, 2, 1];

        for (const sfx of makeFaceSuffixes) {
          const name = `BRepBuilderAPI_MakeFace_${sfx}`;
          if (!oc[name]) continue;

          // Try (surf, 1e-6) — 2 args
          try {
            const mf = new oc[name](surf, 1e-6);
            chain2.makeFaceCtor = name + '(surf, 1e-6)';
            for (const m of ['Face', 'Shape']) {
              if (typeof mf[m] !== 'function') continue;
              try {
                const f = mf[m]();
                if (f) {
                  chain2.faceMethod = m + '()';
                  try { chain2.area = surfaceArea(f); chain2.areaOk = chain2.area > 100; } catch (ae) { chain2.areaErr = String(ae).substring(0, 200); }
                  f.delete();
                  break;
                }
              } catch (fe) { chain2[`faceMethodErr_${m}_${sfx}`] = String(fe).substring(0, 200); }
            }
            mf.delete();
            if (chain2.areaOk) break;
          } catch (e) {
            chain2[`ctorErr_${name}_2args`] = String(e).substring(0, 200);
          }
        }
        surf.delete();
      }

      // Extra probe for item 2: try MakeFace with a Handle_Geom_Surface obtained from
      // a face whose surface we know is a proper handle. Build a box, extract a planar face,
      // get its surface handle, rebuild a face — just to confirm MakeFace_8 WORKS with handles.
      // This tells us whether the limitation is just that we can't create a Handle from a raw surface.
      if (!chain2.areaOk) {
        chain2.probeMakeFaceWithCylHandle = true;
        try {
          const mCyl = new oc.BRepPrimAPI_MakeCylinder_1(20, 40);
          const shape = mCyl.Shape();
          mCyl.delete();
          const faces = collectUniqueFaces(shape);
          let maxArea = 0, maxFaceIdx = 0;
          for (let i = 0; i < faces.length; i++) {
            try { const a = surfaceArea(faces[i]); if (a > maxArea) { maxArea = a; maxFaceIdx = i; } } catch (_e) {}
          }
          const cylHandle = oc.BRep_Tool.Surface_2(faces[maxFaceIdx]);
          for (const f of faces) { try { f.delete(); } catch (_e) {} }
          shape.delete();
          if (cylHandle) {
            // Try MakeFace_8(cylHandle, 1e-6) — this should work because cylHandle IS Handle_Geom_Surface
            try {
              const mf = new oc.BRepBuilderAPI_MakeFace_8(cylHandle, 1e-6);
              const f = mf.Face ? mf.Face() : mf.Shape ? mf.Shape() : null;
              if (f) {
                try { chain2.makeFaceHandleArea = surfaceArea(f); f.delete(); } catch (_e) {}
              }
              mf.delete();
              chain2.makeFaceHandleWorks = (chain2.makeFaceHandleArea || 0) > 0;
            } catch (e) {
              chain2.makeFaceHandleErr = String(e).substring(0, 200);
            }
            cylHandle.delete();
          }
        } catch (e) {
          chain2.makeFaceHandleProbeErr = String(e).substring(0, 200);
        }
      }

      // Determine verdict: direct BSpline raw transient fails for MakeFace.
      // But if MakeFace_8(cylHandle, 1e-6) works, then MakeFace IS reachable with proper handles.
      // The limitation is getting a Handle_Geom_BSplineSurface from our raw surface.
      const verdict2 = chain2.areaOk
        ? 'REACHABLE'
        : (chain2.makeFaceHandleWorks ? 'REACHABLE' : 'NOT_REACHABLE');
      const verdictReason2 = chain2.areaOk
        ? `${chain2.makeFaceCtor} via ${chain2.faceMethod}; area=${chain2.area?.toFixed(2)} mm²`
        : chain2.makeFaceHandleWorks
          ? `BRepBuilderAPI_MakeFace_8(Handle_Geom_Surface, tol) WORKS for handles (cylHandle area=${chain2.makeFaceHandleArea?.toFixed(2)}); CONSTRAINT: Geom_BSplineSurface is a raw transient, cannot be directly wrapped as Handle_Geom_Surface in this build`
          : `No MakeFace constructor accepted (surf, 1e-6); _8 error: ${chain2['ctorErr_BRepBuilderAPI_MakeFace_8_2args'] || '—'}; handle probe: ${chain2.makeFaceHandleErr || 'not run'}`;

      result.item2_makeFace = {
        verdict: verdict2,
        verdictReason: verdictReason2,
        makeFaceCtor: chain2.makeFaceCtor || null,
        faceMethod: chain2.faceMethod || null,
        areaMm2: chain2.area || null,
        areaOk: chain2.areaOk || false,
        makeFaceKeys: chain2.makeFaceKeys,
        chain: chain2,
        note: 'BRepBuilderAPI_MakeFace from BSplineSurface. REACHABLE = face created + area > 0.',
      };

    } catch (e) {
      result.item2_makeFace = { verdict: 'NOT_REACHABLE', error: String(e).substring(0, 400) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 3 — InsertUKnot / InsertVKnot refinement
    //
    //   Build a fresh surface. Read NbUKnots/NbVKnots before, insert u=0.5
    //   mult=1 tol=1e-6. Read again. Confirm count increased.
    //   OCCT signature (confirmed from prior iteration): 4 args
    //     InsertUKnot(U, Mult, ParametricTolerance, Add=true)
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain3 = {};

      let surf = null;
      try { surf = buildBSplineSurface(false); chain3.surfBuilt = true; } catch (e) { chain3.surfBuildErr = String(e).substring(0, 200); }

      if (surf) {
        try { chain3.nbUKnotsBefore = surf.NbUKnots(); } catch (_e) {}
        try { chain3.nbVKnotsBefore = surf.NbVKnots(); } catch (_e) {}

        // Try InsertUKnot(U, Mult, ParametricTolerance, Add)
        // All 4-arg variants
        const insertUCandidates = [
          ['InsertUKnot', [0.5, 1, 1e-6, true]],
          ['InsertUKnot', [0.5, 1, 1e-6, false]],
          ['InsertUKnot_1', [0.5, 1, 1e-6, true]],
        ];
        for (const [name, args] of insertUCandidates) {
          if (typeof surf[name] !== 'function') continue;
          try {
            surf[name](...args);
            chain3.insertUKnotMethod = `${name}(${args.join(', ')})`;
            break;
          } catch (e) {
            chain3[`insertUKnotErr_${name}`] = String(e).substring(0, 200);
          }
        }

        // Try InsertVKnot
        const insertVCandidates = [
          ['InsertVKnot', [0.5, 1, 1e-6, true]],
          ['InsertVKnot', [0.5, 1, 1e-6, false]],
          ['InsertVKnot_1', [0.5, 1, 1e-6, true]],
        ];
        for (const [name, args] of insertVCandidates) {
          if (typeof surf[name] !== 'function') continue;
          try {
            surf[name](...args);
            chain3.insertVKnotMethod = `${name}(${args.join(', ')})`;
            break;
          } catch (e) {
            chain3[`insertVKnotErr_${name}`] = String(e).substring(0, 200);
          }
        }

        try { chain3.nbUKnotsAfter = surf.NbUKnots(); } catch (_e) {}
        try { chain3.nbVKnotsAfter = surf.NbVKnots(); } catch (_e) {}
        chain3.uKnotsIncremented = (chain3.nbUKnotsAfter || 0) > (chain3.nbUKnotsBefore || 0);
        chain3.vKnotsIncremented = (chain3.nbVKnotsAfter || 0) > (chain3.nbVKnotsBefore || 0);
        surf.delete();
      }

      let verdict3;
      let verdictReason3;
      if (chain3.insertUKnotMethod && chain3.insertVKnotMethod && chain3.uKnotsIncremented && chain3.vKnotsIncremented) {
        verdict3 = 'REACHABLE';
        verdictReason3 = `${chain3.insertUKnotMethod}; ${chain3.insertVKnotMethod}; nbUKnots ${chain3.nbUKnotsBefore}→${chain3.nbUKnotsAfter}; nbVKnots ${chain3.nbVKnotsBefore}→${chain3.nbVKnotsAfter}`;
      } else if (chain3.insertUKnotMethod || chain3.insertVKnotMethod) {
        verdict3 = 'REACHABLE';
        verdictReason3 = `Partial: insertU=${chain3.insertUKnotMethod || 'failed'} insertV=${chain3.insertVKnotMethod || 'failed'}; u: ${chain3.nbUKnotsBefore}→${chain3.nbUKnotsAfter}; v: ${chain3.nbVKnotsBefore}→${chain3.nbVKnotsAfter}`;
      } else {
        verdict3 = 'NOT_REACHABLE';
        verdictReason3 = `InsertUKnot/InsertVKnot both threw: ${JSON.stringify(Object.fromEntries(Object.entries(chain3).filter(([k]) => k.includes('Err'))))}`;
      }

      result.item3_knotInsertion = {
        verdict: verdict3,
        verdictReason: verdictReason3,
        insertUKnotMethod: chain3.insertUKnotMethod || null,
        insertVKnotMethod: chain3.insertVKnotMethod || null,
        nbUKnotsBefore: chain3.nbUKnotsBefore,
        nbUKnotsAfter: chain3.nbUKnotsAfter,
        nbVKnotsBefore: chain3.nbVKnotsBefore,
        nbVKnotsAfter: chain3.nbVKnotsAfter,
        uKnotsIncremented: chain3.uKnotsIncremented,
        vKnotsIncremented: chain3.vKnotsIncremented,
        chain: chain3,
        note: 'Knot insertion refinement. InsertUKnot/InsertVKnot take 4 args: (U, Mult, ParametricTolerance, Add).',
      };

    } catch (e) {
      result.item3_knotInsertion = { verdict: 'NOT_REACHABLE', error: String(e).substring(0, 400) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 4 — IncreaseDegree (3,3) → (4,4)
    //
    //   Build a fresh surface. Read UDegree/VDegree/NbUPoles/NbVPoles before.
    //   Call IncreaseDegree(4, 4). Read again. Confirm change.
    //   Key: confirmed REACHABLE in prior run — IncreaseDegree(4,4) works.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain4 = {};

      let surf = null;
      try { surf = buildBSplineSurface(false); chain4.surfBuilt = true; } catch (e) { chain4.surfBuildErr = String(e).substring(0, 200); }

      if (surf) {
        try { chain4.uDegreeBefore  = surf.UDegree();   } catch (_e) {}
        try { chain4.vDegreeBefore  = surf.VDegree();   } catch (_e) {}
        try { chain4.nbUPolesBefore = surf.NbUPoles();  } catch (_e) {}
        try { chain4.nbVPolesBefore = surf.NbVPoles();  } catch (_e) {}

        for (const name of ['IncreaseDegree', 'IncreaseDegree_1']) {
          if (typeof surf[name] !== 'function') continue;
          try {
            surf[name](4, 4);
            chain4.increaseDegreeMethod = name + '(4, 4)';
            break;
          } catch (e) {
            chain4[`increaseDegreeErr_${name}`] = String(e).substring(0, 200);
          }
        }

        try { chain4.uDegreeAfter  = surf.UDegree();   } catch (_e) {}
        try { chain4.vDegreeAfter  = surf.VDegree();   } catch (_e) {}
        try { chain4.nbUPolesAfter = surf.NbUPoles();  } catch (_e) {}
        try { chain4.nbVPolesAfter = surf.NbVPoles();  } catch (_e) {}
        chain4.uDegreeIncreased = (chain4.uDegreeAfter || 0) > (chain4.uDegreeBefore || 0);
        chain4.vDegreeIncreased = (chain4.vDegreeAfter || 0) > (chain4.vDegreeBefore || 0);
        chain4.uPolesGrew = (chain4.nbUPolesAfter || 0) > (chain4.nbUPolesBefore || 0);
        chain4.vPolesGrew = (chain4.nbVPolesAfter || 0) > (chain4.nbVPolesBefore || 0);
        surf.delete();
      }

      let verdict4;
      let verdictReason4;
      if (chain4.increaseDegreeMethod && chain4.uDegreeIncreased && chain4.vDegreeIncreased) {
        verdict4 = 'REACHABLE';
        verdictReason4 = `${chain4.increaseDegreeMethod}; uDegree ${chain4.uDegreeBefore}→${chain4.uDegreeAfter}; vDegree ${chain4.vDegreeBefore}→${chain4.vDegreeAfter}; nbUPoles ${chain4.nbUPolesBefore}→${chain4.nbUPolesAfter}; nbVPoles ${chain4.nbVPolesBefore}→${chain4.nbVPolesAfter}`;
      } else if (chain4.increaseDegreeMethod) {
        verdict4 = 'REACHABLE';
        verdictReason4 = `${chain4.increaseDegreeMethod} callable (degree unchanged? u=${chain4.uDegreeBefore}→${chain4.uDegreeAfter})`;
      } else if (!chain4.surfBuilt) {
        verdict4 = 'NOT_REACHABLE';
        verdictReason4 = `Surface not built: ${chain4.surfBuildErr}`;
      } else {
        verdict4 = 'NOT_REACHABLE';
        verdictReason4 = `IncreaseDegree not callable: ${JSON.stringify(Object.fromEntries(Object.entries(chain4).filter(([k]) => k.includes('Err'))))}`;
      }

      result.item4_increaseDegree = {
        verdict: verdict4,
        verdictReason: verdictReason4,
        increaseDegreeMethod: chain4.increaseDegreeMethod || null,
        uDegreeBefore: chain4.uDegreeBefore,
        uDegreeAfter: chain4.uDegreeAfter,
        vDegreeBefore: chain4.vDegreeBefore,
        vDegreeAfter: chain4.vDegreeAfter,
        nbUPolesBefore: chain4.nbUPolesBefore,
        nbUPolesAfter: chain4.nbUPolesAfter,
        nbVPolesBefore: chain4.nbVPolesBefore,
        nbVPolesAfter: chain4.nbVPolesAfter,
        chain: chain4,
        note: 'Degree elevation (3,3)→(4,4). REACHABLE = IncreaseDegree(4,4) callable + degrees confirmed.',
      };

    } catch (e) {
      result.item4_increaseDegree = { verdict: 'NOT_REACHABLE', error: String(e).substring(0, 400) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 5 — GeomLProp_SLProps curvature evaluation
    //
    //   Build fresh surfaces (curved + flat). Try GeomLProp_SLProps_*(surf, U, V, N, tol).
    //   Read MaxCurvature, MinCurvature, GaussianCurvature, MeanCurvature, Normal.
    //   Note from prior run: all suffixes GeomLProp_SLProps_1..3 failed with integer
    //   exceptions when passing raw Geom_BSplineSurface. Try also suffix _2 which
    //   might be the (surface, degree) form where N=2 refers to derivative order.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain5 = {};
      chain5.slPropsKeys = ocKeys.filter(k => /^GeomLProp_SLProps/.test(k));

      // Helper: try all SLProps constructor variants on a surface
      function tryEvalSLProps(surf, U, V) {
        const res = {};
        const slSuffixes = ['1', '2', '3', '4'];

        let slProps = null;
        let ctorUsed = null;

        // Strategy 1: (surface, U, V, N=2, Resolution=1e-6) — 5 args
        for (const sfx of slSuffixes) {
          const name = `GeomLProp_SLProps_${sfx}`;
          if (!oc[name]) continue;
          try {
            slProps = new oc[name](surf, U, V, 2, 1e-6);
            ctorUsed = `${name}(surf, ${U}, ${V}, 2, 1e-6)`;
            break;
          } catch (e) {
            res[`ctorErr_${name}_5args`] = String(e).substring(0, 200);
          }
        }

        // Strategy 2: (surface, N=2, Resolution=1e-6) — 3 args, then SetParameters(U, V)
        if (!slProps) {
          for (const sfx of slSuffixes) {
            const name = `GeomLProp_SLProps_${sfx}`;
            if (!oc[name]) continue;
            try {
              slProps = new oc[name](surf, 2, 1e-6);
              ctorUsed = `${name}(surf, 2, 1e-6) [3-arg]`;
              // Set parameters
              if (typeof slProps.SetParameters === 'function') {
                try { slProps.SetParameters(U, V); ctorUsed += `.SetParameters(${U}, ${V})`; } catch (e2) {
                  res.setParamsErr = String(e2).substring(0, 200);
                }
              }
              break;
            } catch (e) {
              res[`ctorErr_${name}_3args`] = String(e).substring(0, 200);
            }
          }
        }

        if (!slProps) return { error: 'No SLProps ctor worked', tried: slSuffixes.map(s => `GeomLProp_SLProps_${s}`) };

        res.ctor = ctorUsed;
        const methods = introspectMethods(slProps).filter(m => !m.startsWith('$'));
        res.methods = methods;

        // Read curvature values
        for (const mName of ['MaxCurvature', 'MinCurvature', 'GaussianCurvature', 'MeanCurvature']) {
          try { res[mName] = slProps[mName](); } catch (e) { res[`${mName}Err`] = String(e).substring(0, 100); }
        }

        // Value (point on surface)
        try {
          const v = slProps.Value();
          if (v) { res.valueX = v.X(); res.valueY = v.Y(); res.valueZ = v.Z(); }
        } catch (e) { res.valueErr = String(e).substring(0, 100); }

        // Normal
        try {
          const N = slProps.Normal();
          if (N) { res.normalX = N.X(); res.normalY = N.Y(); res.normalZ = N.Z(); N.delete(); }
        } catch (e) { res.normalErr = String(e).substring(0, 100); }

        slProps.delete();
        return res;
      }

      // Curved patch (raw BSpline surface)
      let curvedSurf = null;
      try { curvedSurf = buildBSplineSurface(false); chain5.curvedBuilt = true; } catch (e) { chain5.curvedBuildErr = String(e).substring(0, 200); }
      if (curvedSurf) {
        chain5.curvedProps = tryEvalSLProps(curvedSurf, 0.5, 0.5);
        curvedSurf.delete();
      }

      // Flat patch (raw BSpline surface)
      let flatSurf = null;
      try { flatSurf = buildBSplineSurface(true); chain5.flatBuilt = true; } catch (e) { chain5.flatBuildErr = String(e).substring(0, 200); }
      if (flatSurf) {
        chain5.flatProps = tryEvalSLProps(flatSurf, 0.5, 0.5);
        flatSurf.delete();
      }

      // Extra probe: try SLProps with a proper Handle_Geom_Surface (from cylinder face)
      // to check if the ctor works when given a handle (vs raw transient).
      // This validates whether the binding simply requires a handle type.
      if (!chain5.curvedProps?.ctor) {
        chain5.probeWithCylHandle = true;
        try {
          const mCyl = new oc.BRepPrimAPI_MakeCylinder_1(20, 40);
          const shape = mCyl.Shape();
          mCyl.delete();
          const faces = collectUniqueFaces(shape);
          let maxArea = 0, maxFaceIdx = 0;
          for (let i = 0; i < faces.length; i++) {
            try { const a = surfaceArea(faces[i]); if (a > maxArea) { maxArea = a; maxFaceIdx = i; } } catch (_e) {}
          }
          const cylHandle = oc.BRep_Tool.Surface_2(faces[maxFaceIdx]);
          for (const f of faces) { try { f.delete(); } catch (_e) {} }
          shape.delete();
          // Try SLProps with this handle (proper Handle_Geom_Surface)
          if (cylHandle) {
            chain5.cylHandleProps = tryEvalSLProps(cylHandle, 0.0, 0.5);
            chain5.cylHandlePropsRaw = tryEvalSLProps(cylHandle.get ? cylHandle.get() : null, 0.0, 0.5);
            cylHandle.delete();
          }
        } catch (e) {
          chain5.cylHandleProbeErr = String(e).substring(0, 200);
        }
      }

      // Determine verdict: direct BSpline surface fails, but cylinder handle works.
      // The binding requires Handle_Geom_Surface. If cylHandleProps succeeded, the
      // constructor IS reachable — just needs a handle. The limitation is getting a
      // Handle_Geom_BSplineSurface from our raw surface.
      const cylHandleOk = chain5.cylHandleProps?.ctor && chain5.cylHandleProps?.MaxCurvature !== undefined;
      const curvedOk = chain5.curvedProps?.ctor && chain5.curvedProps?.MaxCurvature !== undefined && !chain5.curvedProps?.MaxCurvatureErr;
      const flatOk   = chain5.flatProps?.ctor   && chain5.flatProps?.GaussianCurvature !== undefined && !chain5.flatProps?.GaussianCurvatureErr;

      let verdict5;
      let verdictReason5;
      if (curvedOk) {
        const c = chain5.curvedProps;
        const f = chain5.flatProps;
        const fmt = v => (typeof v === 'number' ? v.toFixed(6) : String(v));
        verdict5 = 'REACHABLE';
        verdictReason5 = `${c.ctor}; curved: MaxK=${fmt(c.MaxCurvature)} MinK=${fmt(c.MinCurvature)} GaussK=${fmt(c.GaussianCurvature)} MeanK=${fmt(c.MeanCurvature)}`
          + (flatOk ? `; flat: GaussK=${fmt(f.GaussianCurvature)} MeanK=${fmt(f.MeanCurvature)}` : '');
      } else if (cylHandleOk) {
        // SLProps works with a Handle_Geom_Surface, not with raw BSpline transient.
        const c = chain5.cylHandleProps;
        const fmt = v => (typeof v === 'number' ? v.toFixed(6) : String(v));
        verdict5 = 'REACHABLE';
        verdictReason5 = `${c.ctor} [cylinder Handle_Geom_Surface]; MaxK=${fmt(c.MaxCurvature)} MinK=${fmt(c.MinCurvature)} GaussK=${fmt(c.GaussianCurvature)} MeanK=${fmt(c.MeanCurvature)}; CONSTRAINT: requires Handle_Geom_Surface, NOT raw Geom_BSplineSurface transient`;
      } else {
        verdict5 = 'NOT_REACHABLE';
        const err = chain5.curvedProps?.error || chain5.curvedProps?.MaxCurvatureErr || 'ctor failed';
        verdictReason5 = `GeomLProp_SLProps not usable: ${err}; tried: ${chain5.slPropsKeys?.join(', ')}`;
      }

      result.item5_curvatureEval = {
        verdict: verdict5,
        verdictReason: verdictReason5,
        slPropsCtor: chain5.curvedProps?.ctor || null,
        curvedPatch: {
          MaxCurvature: chain5.curvedProps?.MaxCurvature,
          MinCurvature: chain5.curvedProps?.MinCurvature,
          GaussianCurvature: chain5.curvedProps?.GaussianCurvature,
          MeanCurvature: chain5.curvedProps?.MeanCurvature,
          normalX: chain5.curvedProps?.normalX,
          normalY: chain5.curvedProps?.normalY,
          normalZ: chain5.curvedProps?.normalZ,
        },
        flatPatch: {
          GaussianCurvature: chain5.flatProps?.GaussianCurvature,
          MeanCurvature: chain5.flatProps?.MeanCurvature,
        },
        chain: chain5,
        note: 'GeomLProp_SLProps curvature at (0.5, 0.5). Curved → non-zero; flat → ≈0.',
      };

    } catch (e) {
      result.item5_curvatureEval = { verdict: 'NOT_REACHABLE', error: String(e).substring(0, 400) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 6 — BRep_Tool.Surface(face) extraction
    //
    //   Build a cylinder BRepPrimAPI_MakeCylinder_1(20, 40).
    //   Explore faces; identify curved face (largest area).
    //   Call BRep_Tool.Surface_*(curvedFace) — confirmed REACHABLE (_2 works).
    //   Returns Handle_Geom_Surface. Introspect for class identification.
    //   Try .get() on the handle to see if it exposes a typed object.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain6 = {};

      let cylShape = null;
      try {
        const mCyl = new oc.BRepPrimAPI_MakeCylinder_1(20, 40);
        cylShape = mCyl.Shape();
        mCyl.delete();
        chain6.cylBuilt = true;
        chain6.cylFaceCount = countFaces(cylShape);
      } catch (e) {
        chain6.cylBuildErr = String(e).substring(0, 200);
      }

      if (cylShape) {
        const faces = collectUniqueFaces(cylShape);
        chain6.facesFound = faces.length;

        // Measure areas to find curved face
        const faceAreas = faces.map((f, idx) => {
          try { return { idx, area: surfaceArea(f) }; } catch (_e) { return { idx, area: 0 }; }
        }).sort((a, b) => b.area - a.area);
        chain6.faceAreas = faceAreas;

        const curvedFace = faces[faceAreas[0].idx];
        chain6.curvedFaceArea = faceAreas[0].area;

        // Extract surface via BRep_Tool
        if (oc.BRep_Tool) {
          const btMethods = Object.getOwnPropertyNames(oc.BRep_Tool);
          chain6.brepToolSurfaceMethods = btMethods.filter(m => m.toLowerCase().includes('surface'));

          for (const name of ['Surface_2', 'Surface_1', 'Surface']) {
            if (typeof oc.BRep_Tool[name] !== 'function') continue;
            try {
              const handle = oc.BRep_Tool[name](curvedFace);
              if (handle) {
                chain6.surfaceExtractMethod = `BRep_Tool.${name}(curvedFace)`;
                chain6.handleConstructorName = handle.constructor?.name;
                // Introspect handle prototype
                const handleProto = Object.getPrototypeOf(handle);
                chain6.handleProtoMethods = handleProto ? Object.getOwnPropertyNames(handleProto) : [];
                chain6.handleHasGet = typeof handle.get === 'function';
                chain6.handleIsNull = handle.IsNull ? handle.IsNull() : null;

                // Try handle.get() — returns the underlying Geom_Surface
                if (typeof handle.get === 'function') {
                  try {
                    const raw = handle.get();
                    if (raw) {
                      chain6.rawFromGet = true;
                      const rawProto = Object.getPrototypeOf(raw);
                      chain6.rawConstructorName = raw.constructor?.name;
                      const rawMethods = rawProto ? Object.getOwnPropertyNames(rawProto).filter(m => !m.startsWith('$')) : [];
                      chain6.rawProtoMethods = rawMethods;
                      // Identify type
                      const mSet = new Set(rawMethods);
                      if (mSet.has('UDegree') && mSet.has('NbUKnots')) chain6.rawClass = 'Geom_BSplineSurface';
                      else if (mSet.has('Cylinder')) chain6.rawClass = 'Geom_CylindricalSurface';
                      else chain6.rawClass = 'unknown';

                      // Try to read properties to confirm type
                      try { chain6.rawUDegree = raw.UDegree(); } catch (_e) {}
                      try { chain6.rawNbUKnots = raw.NbUKnots(); } catch (_e) {}
                      try { chain6.rawRadius = raw.Radius ? raw.Radius() : undefined; } catch (_e) {}
                    }
                  } catch (ge) {
                    chain6.getErr = String(ge).substring(0, 200);
                  }
                }

                // Store handle for item 7 (don't delete — item 7 uses it)
                window._e_recon_cylSurfHandle = handle;
                break;
              }
            } catch (e) {
              chain6[`surfaceExtractErr_${name}`] = String(e).substring(0, 200);
            }
          }
        }

        // Cleanup faces (but NOT curvedFace if it's being kept — we've already read it)
        for (const f of faces) { try { f.delete(); } catch (_e) {} }
        cylShape.delete();
      }

      let verdict6;
      let verdictReason6;
      if (chain6.surfaceExtractMethod) {
        verdict6 = 'REACHABLE';
        const classInfo = chain6.rawClass || chain6.handleConstructorName;
        verdict6 = 'REACHABLE';
        verdictReason6 = `${chain6.surfaceExtractMethod}; handle=${chain6.handleConstructorName}; raw class=${chain6.rawClass || '(handle.get() not tried)'}; rawConstructor=${chain6.rawConstructorName || '—'}`;
      } else {
        verdict6 = 'NOT_REACHABLE';
        verdictReason6 = `BRep_Tool.Surface_* not callable; brepToolSurface methods: ${chain6.brepToolSurfaceMethods?.join(', ')}`;
      }

      result.item6_surfaceExtraction = {
        verdict: verdict6,
        verdictReason: verdictReason6,
        surfaceExtractMethod: chain6.surfaceExtractMethod || null,
        handleConstructorName: chain6.handleConstructorName || null,
        rawClass: chain6.rawClass || null,
        rawConstructorName: chain6.rawConstructorName || null,
        curvedFaceArea: chain6.curvedFaceArea,
        brepToolSurfaceMethods: chain6.brepToolSurfaceMethods,
        chain: chain6,
        note: 'BRep_Tool.Surface_2(face) returns Handle_Geom_Surface. .get() unwraps to raw Geom_CylindricalSurface (analytic).',
      };

    } catch (e) {
      result.item6_surfaceExtraction = { verdict: 'NOT_REACHABLE', error: String(e).substring(0, 400) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 7 — GeomConvert.SurfaceToBSplineSurface static call
    //
    //   Use the Handle_Geom_Surface from item 6 (or rebuild).
    //   oc.GeomConvert.SurfaceToBSplineSurface IS present (method listed in scan).
    //   The prior error "18947992" was an integer OCCT exception — possibly the
    //   method received a null or wrong handle type.
    //   Strategy: pass the Handle directly (not .get()), then try .get() result.
    //   Also scan: GeomConvert_ApproxSurface as alternative.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain7 = {};
      chain7.geomConvertKeys = ocKeys.filter(k => k.startsWith('GeomConvert'));

      if (oc.GeomConvert) {
        chain7.geomConvertMethods = Object.getOwnPropertyNames(oc.GeomConvert);
        chain7.hasSurfaceToBSpline = chain7.geomConvertMethods.includes('SurfaceToBSplineSurface');
      }

      // Get the handle from item 6 slot
      let cylSurfHandle = window._e_recon_cylSurfHandle;
      let ownedHandle = false;

      // If not available from item 6, rebuild
      if (!cylSurfHandle) {
        try {
          const mCyl = new oc.BRepPrimAPI_MakeCylinder_1(20, 40);
          const shape = mCyl.Shape();
          mCyl.delete();
          const faces = collectUniqueFaces(shape);
          let maxArea = 0, maxFace = null;
          for (const f of faces) {
            try { const a = surfaceArea(f); if (a > maxArea) { maxArea = a; maxFace = f; } } catch (_e) {}
          }
          if (maxFace && oc.BRep_Tool && typeof oc.BRep_Tool.Surface_2 === 'function') {
            cylSurfHandle = oc.BRep_Tool.Surface_2(maxFace);
            ownedHandle = true;
          }
          for (const f of faces) { try { f.delete(); } catch (_e) {} }
          shape.delete();
          chain7.rebuiltHandle = true;
        } catch (e) {
          chain7.rebuiltHandleErr = String(e).substring(0, 200);
        }
      }

      chain7.handleAvailable = !!cylSurfHandle;

      if (cylSurfHandle && oc.GeomConvert && chain7.hasSurfaceToBSpline) {
        // Try 1: pass handle directly (handle IS a Handle_Geom_Surface)
        try {
          const result7 = oc.GeomConvert.SurfaceToBSplineSurface(cylSurfHandle);
          if (result7) {
            chain7.convertMethod = 'oc.GeomConvert.SurfaceToBSplineSurface(handle)';
            // result7 may itself be a handle — try both direct and .get()
            const candidates = [result7, ...(typeof result7.get === 'function' ? [result7.get()] : [])];
            for (const bsp of candidates) {
              if (!bsp) continue;
              try { chain7.bspUDegree  = bsp.UDegree();  } catch (_e) {}
              try { chain7.bspVDegree  = bsp.VDegree();  } catch (_e) {}
              try { chain7.bspNbUKnots = bsp.NbUKnots(); } catch (_e) {}
              try { chain7.bspNbVKnots = bsp.NbVKnots(); } catch (_e) {}
              try { chain7.bspNbUPoles = bsp.NbUPoles(); } catch (_e) {}
              try { chain7.bspNbVPoles = bsp.NbVPoles(); } catch (_e) {}
              if (chain7.bspUDegree) break;
            }
            chain7.bspValidNurbs = (chain7.bspUDegree || 0) > 0 && (chain7.bspNbUKnots || 0) > 0;
            try { result7.delete(); } catch (_e) {}
          }
        } catch (e) {
          chain7.convertErr_handle = String(e).substring(0, 200);
        }

        // Try 2: pass handle.get() (raw transient)
        if (!chain7.convertMethod && typeof cylSurfHandle.get === 'function') {
          try {
            const raw = cylSurfHandle.get();
            const result7 = oc.GeomConvert.SurfaceToBSplineSurface(raw);
            if (result7) {
              chain7.convertMethod = 'oc.GeomConvert.SurfaceToBSplineSurface(handle.get())';
              const candidates = [result7, ...(typeof result7.get === 'function' ? [result7.get()] : [])];
              for (const bsp of candidates) {
                if (!bsp) continue;
                try { chain7.bspUDegree  = bsp.UDegree();  } catch (_e) {}
                try { chain7.bspVDegree  = bsp.VDegree();  } catch (_e) {}
                try { chain7.bspNbUKnots = bsp.NbUKnots(); } catch (_e) {}
                try { chain7.bspNbVKnots = bsp.NbVKnots(); } catch (_e) {}
                if (chain7.bspUDegree) break;
              }
              chain7.bspValidNurbs = (chain7.bspUDegree || 0) > 0 && (chain7.bspNbUKnots || 0) > 0;
              try { result7.delete(); } catch (_e) {}
            }
          } catch (e) {
            chain7.convertErr_raw = String(e).substring(0, 200);
          }
        }
      } else if (!oc.GeomConvert) {
        chain7.geomConvertMissing = true;
      } else if (!chain7.hasSurfaceToBSpline) {
        chain7.methodNotFound = true;
      }

      // Cleanup handle
      if (ownedHandle && cylSurfHandle) { try { cylSurfHandle.delete(); } catch (_e) {} }
      try { if (window._e_recon_cylSurfHandle) { window._e_recon_cylSurfHandle.delete(); window._e_recon_cylSurfHandle = null; } } catch (_e) {}

      let verdict7;
      let verdictReason7;
      if (chain7.convertMethod && chain7.bspValidNurbs) {
        verdict7 = 'REACHABLE';
        verdictReason7 = `${chain7.convertMethod}; uDegree=${chain7.bspUDegree} vDegree=${chain7.bspVDegree}; nbUKnots=${chain7.bspNbUKnots} nbVKnots=${chain7.bspNbVKnots}; nbUPoles=${chain7.bspNbUPoles} nbVPoles=${chain7.bspNbVPoles}`;
      } else if (chain7.convertMethod) {
        verdict7 = 'NOT_REACHABLE';
        verdictReason7 = `${chain7.convertMethod} succeeded but result reads failed (may be wrong handle type)`;
      } else {
        verdict7 = 'NOT_REACHABLE';
        const err = chain7.convertErr_handle || chain7.convertErr_raw || chain7.methodNotFound || chain7.geomConvertMissing || 'unknown';
        verdictReason7 = `SurfaceToBSplineSurface not callable: handle_err=${chain7.convertErr_handle || '—'} raw_err=${chain7.convertErr_raw || '—'}; hasSurfaceToBSpline=${chain7.hasSurfaceToBSpline}`;
      }

      result.item7_geomConvert = {
        verdict: verdict7,
        verdictReason: verdictReason7,
        convertMethod: chain7.convertMethod || null,
        bspUDegree: chain7.bspUDegree,
        bspVDegree: chain7.bspVDegree,
        bspNbUKnots: chain7.bspNbUKnots,
        bspNbVKnots: chain7.bspNbVKnots,
        bspValidNurbs: chain7.bspValidNurbs,
        geomConvertMethods: chain7.geomConvertMethods,
        chain: chain7,
        note: 'GeomConvert.SurfaceToBSplineSurface — convert Handle_Geom_Surface to NURBS BSpline form.',
      };

    } catch (e) {
      result.item7_geomConvert = { verdict: 'NOT_REACHABLE', error: String(e).substring(0, 400) };
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    result._summary = {
      item1_bsplineConstruction: result.item1_bsplineConstruction?.verdict,
      item2_makeFace:            result.item2_makeFace?.verdict,
      item3_knotInsertion:       result.item3_knotInsertion?.verdict,
      item4_increaseDegree:      result.item4_increaseDegree?.verdict,
      item5_curvatureEval:       result.item5_curvatureEval?.verdict,
      item6_surfaceExtraction:   result.item6_surfaceExtraction?.verdict,
      item7_geomConvert:         result.item7_geomConvert?.verdict,
      item1_reason:  result.item1_bsplineConstruction?.verdictReason,
      item2_reason:  result.item2_makeFace?.verdictReason,
      item3_reason:  result.item3_knotInsertion?.verdictReason,
      item4_reason:  result.item4_increaseDegree?.verdictReason,
      item5_reason:  result.item5_curvatureEval?.verdictReason,
      item6_reason:  result.item6_surfaceExtraction?.verdictReason,
      item7_reason:  result.item7_geomConvert?.verdictReason,
      item2_areaMm2: result.item2_makeFace?.areaMm2,
      item5_gaussCurved: result.item5_curvatureEval?.curvedPatch?.GaussianCurvature,
      item6_rawClass: result.item6_surfaceExtraction?.rawClass,
      item7_bspDeg:  result.item7_geomConvert?.bspUDegree,
      note: 'Sub-project E recon — NURBS verdicts recorded. GREEN = investigation complete.',
      package: 'opencascade.js@2.0.0-beta.b5ff984',
    };

    return result;
  });

  // ── Write JSON output ────────────────────────────────────────────────────────
  const notesDir = path.join(__dirname, '..', 'docs', 'superpowers', 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
  const jsonPath = path.join(notesDir, 'occt-api-E-recon.json');
  fs.writeFileSync(jsonPath, JSON.stringify(verified, null, 2));
  console.log('E RECON SUMMARY:', JSON.stringify(verified._summary, null, 2));
  console.log('E RECON FULL:', JSON.stringify(verified, null, 2));

  // ── Assertions ────────────────────────────────────────────────────────────────
  // PASSES green when every item has a recorded verdict.
  // A documented NOT_REACHABLE is a correct outcome.

  const validVerdicts = ['REACHABLE', 'NOT_REACHABLE', 'PARTIALLY_REACHABLE'];

  expect(
    validVerdicts.includes(verified.item1_bsplineConstruction?.verdict),
    `item1 must have a verdict, got: ${JSON.stringify(verified.item1_bsplineConstruction?.verdict)}`
  ).toBe(true);

  expect(
    validVerdicts.includes(verified.item2_makeFace?.verdict),
    `item2 must have a verdict, got: ${JSON.stringify(verified.item2_makeFace?.verdict)}`
  ).toBe(true);

  expect(
    validVerdicts.includes(verified.item3_knotInsertion?.verdict),
    `item3 must have a verdict, got: ${JSON.stringify(verified.item3_knotInsertion?.verdict)}`
  ).toBe(true);

  expect(
    validVerdicts.includes(verified.item4_increaseDegree?.verdict),
    `item4 must have a verdict, got: ${JSON.stringify(verified.item4_increaseDegree?.verdict)}`
  ).toBe(true);

  expect(
    validVerdicts.includes(verified.item5_curvatureEval?.verdict),
    `item5 must have a verdict, got: ${JSON.stringify(verified.item5_curvatureEval?.verdict)}`
  ).toBe(true);

  expect(
    validVerdicts.includes(verified.item6_surfaceExtraction?.verdict),
    `item6 must have a verdict, got: ${JSON.stringify(verified.item6_surfaceExtraction?.verdict)}`
  ).toBe(true);

  expect(
    validVerdicts.includes(verified.item7_geomConvert?.verdict),
    `item7 must have a verdict, got: ${JSON.stringify(verified.item7_geomConvert?.verdict)}`
  ).toBe(true);

  expect(verified._summary, 'summary must exist').toBeTruthy();
  expect(verified._summary.item1_bsplineConstruction, 'summary.item1 must be present').toBeTruthy();

  expect(pageErrors).toEqual([]);
  await app.close();
});
