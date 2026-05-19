/**
 * brep-a1-recon-electron.spec.js
 *
 * Phase A1 empirical OCCT API reconnaissance.
 * Verifies exact opencascade.js call signatures for:
 *   1.  Cylinder
 *   2.  Sphere
 *   3.  Cone
 *   4.  Torus
 *   5.  Boolean fuse
 *   6.  Boolean cut
 *   7.  Boolean common
 *   8.  Rectangle face → extrude (full chain)
 *   9.  Revolve
 *   10. Fillet
 *   11. Chamfer
 *   12. STEP export
 *   13. STEP import
 *
 * Writes:  docs/superpowers/notes/occt-api-A1-recon.json
 * Pattern: e2e/brep-occt-load-electron.spec.js + docs/superpowers/notes/occt-api-A0.md
 * Package: opencascade.js@2.0.0-beta.b5ff984
 *
 * Verified overloads (from diagnostic runs):
 *   gp_Pnt_3(x, y, z)             — 3-double constructor
 *   gp_Vec_4(x, y, z)             — 3-double constructor
 *   gp_Dir_4(x, y, z)             — 3-double constructor
 *   gp_Ax1_2(pnt, dir)            — (gp_Pnt, gp_Dir) constructor
 *   BRepBuilderAPI_MakeEdge_3     — (gp_Pnt, gp_Pnt) overload
 *   BRepBuilderAPI_MakeWire_1()   — no-arg; .Add_1(edge) to add edges
 *   BRepBuilderAPI_MakeFace_15(wire, bool) — wire+planar overload
 *   BRepPrimAPI_MakeCylinder_1(r, h)
 *   BRepPrimAPI_MakeSphere_1(r)
 *   BRepPrimAPI_MakeCone_1(r1, r2, h)
 *   BRepPrimAPI_MakeTorus_1(R, r)
 *   BRepAlgoAPI_Fuse/Cut/Common_3(s1, s2, progressRange) + explicit Build(pr)
 *   BRepFilletAPI_MakeFillet (undecorated; requires 2 args: shape + ChFi3d_FilletShape enum)
 *     + .Add_2(radius, edge) + .Build(progressRange)
 *   BRepFilletAPI_MakeChamfer (undecorated; requires 1 arg: shape)
 *     + .Add_2(distance, edge) + .Build(progressRange)
 *   STEPControl_Writer_1() + Transfer(shape, mt, true, pr) + Write('filename')
 *   STEPControl_Reader_1() + ReadFile('filename') + TransferRoots(pr) + OneShape()
 *   oc.FS.readFile('filename', {encoding:'utf8'}) — relative path in Emscripten FS
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.setTimeout(600000);

test('Phase A1 — OCCT API recon (items 1-13)', async () => {
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

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Measure volume of a TopoDS_Shape (A0 verified call). */
    function volume(shape) {
      const props = new oc.GProp_GProps_1();
      oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
      const v = props.Mass();
      props.delete();
      return v;
    }

    /** Call a shape-maker .Shape(), return shape or null. */
    function safeShape(maker) {
      try {
        const s = maker.Shape();
        if (s && !s.IsNull()) return s;
      } catch (_e) {}
      return null;
    }

    /** Build a 10mm axis-aligned box (A0 verified). */
    function makeBox(dx, dy, dz) {
      return new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz);
    }

    /**
     * Explicitly build a boolean algo then check IsDone.
     * Returns {didBuild, buildError, done}.
     */
    function boolBuild(algo) {
      let didBuild = false;
      let buildError = null;
      try {
        const pr = new oc.Message_ProgressRange_1();
        algo.Build(pr);
        pr.delete();
        didBuild = true;
      } catch (e) {
        buildError = String(e);
      }
      let done = false;
      try { done = algo.IsDone(); } catch (_e) {}
      return { didBuild, buildError, done };
    }

    const result = {};

    // ══════════════════════════════════════════════════════════════════════════
    // Item 1 — Cylinder  (r=5, h=12;  expected volume ≈ 942.5)
    // Verified: BRepPrimAPI_MakeCylinder_1(r, h)
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const r = 5, h = 12;
      const m = new oc.BRepPrimAPI_MakeCylinder_1(r, h);
      const shape = safeShape(m);
      if (shape) {
        const vol = volume(shape);
        result.item1_cylinder = {
          confirmed: true,
          overload: 'BRepPrimAPI_MakeCylinder_1(r, h)',
          volumeMM3: vol,
          expected: 942.5,
          withinTol: Math.abs(vol - 942.5) < 2,
        };
        shape.delete();
      } else {
        result.item1_cylinder = { confirmed: false, error: 'Shape() null' };
      }
      m.delete();
    } catch (e) {
      result.item1_cylinder = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 2 — Sphere  (r=6;  expected volume ≈ 904.8)
    // Verified: BRepPrimAPI_MakeSphere_1(r)
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const r = 6;
      const m = new oc.BRepPrimAPI_MakeSphere_1(r);
      const shape = safeShape(m);
      if (shape) {
        const vol = volume(shape);
        result.item2_sphere = {
          confirmed: true,
          overload: 'BRepPrimAPI_MakeSphere_1(r)',
          volumeMM3: vol,
          expected: 904.8,
          withinTol: Math.abs(vol - 904.8) < 2,
        };
        shape.delete();
      } else {
        result.item2_sphere = { confirmed: false, error: 'Shape() null' };
      }
      m.delete();
    } catch (e) {
      result.item2_sphere = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 3 — Cone  (r1=6, r2=2, h=12;  expected volume ≈ 653.5)
    // Verified: BRepPrimAPI_MakeCone_1(r1, r2, h)
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const r1 = 6, r2 = 2, h = 12;
      const m = new oc.BRepPrimAPI_MakeCone_1(r1, r2, h);
      const shape = safeShape(m);
      if (shape) {
        const vol = volume(shape);
        result.item3_cone = {
          confirmed: true,
          overload: 'BRepPrimAPI_MakeCone_1(r1, r2, h)',
          volumeMM3: vol,
          expected: 653.5,
          withinTol: Math.abs(vol - 653.5) < 2,
        };
        shape.delete();
      } else {
        result.item3_cone = { confirmed: false, error: 'Shape() null' };
      }
      m.delete();
    } catch (e) {
      result.item3_cone = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 4 — Torus  (R=10, r=3;  expected volume ≈ 1776.5)
    // Verified: BRepPrimAPI_MakeTorus_1(R, r)
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const R = 10, r = 3;
      const m = new oc.BRepPrimAPI_MakeTorus_1(R, r);
      const shape = safeShape(m);
      if (shape) {
        const vol = volume(shape);
        result.item4_torus = {
          confirmed: true,
          overload: 'BRepPrimAPI_MakeTorus_1(R, r)',
          volumeMM3: vol,
          expected: 1776.5,
          withinTol: Math.abs(vol - 1776.5) < 5,
        };
        shape.delete();
      } else {
        result.item4_torus = { confirmed: false, error: 'Shape() null' };
      }
      m.delete();
    } catch (e) {
      result.item4_torus = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 5 — Boolean fuse (two coincident 10mm boxes; volume ≈ 1000)
    // Verified: BRepAlgoAPI_Fuse_3(s1, s2, progressRange)
    //           + explicit .Build(pr) + .IsDone() + .Shape()
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const b1 = makeBox(10, 10, 10);
      const b2 = makeBox(10, 10, 10);
      const s1 = b1.Shape();
      const s2 = b2.Shape();
      const prCons = new oc.Message_ProgressRange_1();
      const algo = new oc.BRepAlgoAPI_Fuse_3(s1, s2, prCons);
      prCons.delete();
      const { didBuild, buildError, done } = boolBuild(algo);
      if (done) {
        const shape = algo.Shape();
        if (shape && !shape.IsNull()) {
          const vol = volume(shape);
          result.item5_fuse = {
            confirmed: true,
            overload: 'BRepAlgoAPI_Fuse_3(s1, s2, progressRange)',
            explicitBuildNeeded: didBuild,
            buildError,
            volumeMM3: vol,
            expected: 1000,
            withinTol: Math.abs(vol - 1000) < 5,
          };
          shape.delete();
        } else {
          result.item5_fuse = { confirmed: false, error: 'Shape() null' };
        }
      } else {
        result.item5_fuse = { confirmed: false, buildError, error: 'IsDone=false' };
      }
      algo.delete();
      s1.delete(); s2.delete();
      b1.delete(); b2.delete();
    } catch (e) {
      result.item5_fuse = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 6 — Boolean cut (two coincident 10mm boxes; volume ≈ 0)
    // Verified: BRepAlgoAPI_Cut_3(s1, s2, progressRange)
    //           + explicit .Build(pr) + .IsDone() + .Shape()
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const b1 = makeBox(10, 10, 10);
      const b2 = makeBox(10, 10, 10);
      const s1 = b1.Shape();
      const s2 = b2.Shape();
      const prCons = new oc.Message_ProgressRange_1();
      const algo = new oc.BRepAlgoAPI_Cut_3(s1, s2, prCons);
      prCons.delete();
      const { didBuild, buildError, done } = boolBuild(algo);
      if (done) {
        const shape = algo.Shape();
        let vol = 0;
        if (shape) {
          try {
            if (!shape.IsNull()) vol = volume(shape);
          } catch (_e) {}
          shape.delete();
        }
        result.item6_cut = {
          confirmed: true,
          overload: 'BRepAlgoAPI_Cut_3(s1, s2, progressRange)',
          explicitBuildNeeded: didBuild,
          buildError,
          volumeMM3: vol,
          note: 'two coincident boxes cut → near-0 volume expected',
        };
      } else {
        result.item6_cut = { confirmed: false, buildError, error: 'IsDone=false' };
      }
      algo.delete();
      s1.delete(); s2.delete();
      b1.delete(); b2.delete();
    } catch (e) {
      result.item6_cut = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 7 — Boolean common (two coincident 10mm boxes; volume ≈ 1000)
    // Verified: BRepAlgoAPI_Common_3(s1, s2, progressRange)
    //           + explicit .Build(pr) + .IsDone() + .Shape()
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const b1 = makeBox(10, 10, 10);
      const b2 = makeBox(10, 10, 10);
      const s1 = b1.Shape();
      const s2 = b2.Shape();
      const prCons = new oc.Message_ProgressRange_1();
      const algo = new oc.BRepAlgoAPI_Common_3(s1, s2, prCons);
      prCons.delete();
      const { didBuild, buildError, done } = boolBuild(algo);
      if (done) {
        const shape = algo.Shape();
        if (shape && !shape.IsNull()) {
          const vol = volume(shape);
          result.item7_common = {
            confirmed: true,
            overload: 'BRepAlgoAPI_Common_3(s1, s2, progressRange)',
            explicitBuildNeeded: didBuild,
            buildError,
            volumeMM3: vol,
            expected: 1000,
            withinTol: Math.abs(vol - 1000) < 5,
          };
          shape.delete();
        } else {
          result.item7_common = { confirmed: false, error: 'Shape() null' };
        }
      } else {
        result.item7_common = { confirmed: false, buildError, error: 'IsDone=false' };
      }
      algo.delete();
      s1.delete(); s2.delete();
      b1.delete(); b2.delete();
    } catch (e) {
      result.item7_common = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 8 — Rectangle face → extrude (12×8 rect, 5mm height; vol ≈ 480)
    // Verified full chain:
    //   gp_Pnt_3(x,y,z)
    //   BRepBuilderAPI_MakeEdge_3(p, p) + .Edge()
    //   BRepBuilderAPI_MakeWire_1() + .Add_1(edge) + .Wire()
    //   BRepBuilderAPI_MakeFace_15(wire, planarBool) + .Face()
    //   gp_Vec_4(x,y,z)
    //   BRepPrimAPI_MakePrism_1(face, vec, copy, canonize) + .Shape()
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const w = 12, d = 8, extH = 5;
      const chain = {};

      // Points — verified: gp_Pnt_3(x, y, z)
      const p0 = new oc.gp_Pnt_3(0, 0, 0);
      const p1 = new oc.gp_Pnt_3(w, 0, 0);
      const p2 = new oc.gp_Pnt_3(w, d, 0);
      const p3 = new oc.gp_Pnt_3(0, d, 0);
      chain.pntOverload = 'gp_Pnt_3(x, y, z)';

      // Edges — verified: BRepBuilderAPI_MakeEdge_3(gp_Pnt, gp_Pnt)
      const pPairs = [[p0,p1],[p1,p2],[p2,p3],[p3,p0]];
      const edges = [];
      for (const [a, b] of pPairs) {
        const em = new oc.BRepBuilderAPI_MakeEdge_3(a, b);
        edges.push(em.Edge());
        em.delete();
      }
      chain.edgeOverload = 'BRepBuilderAPI_MakeEdge_3(gp_Pnt, gp_Pnt)';

      // Wire — verified: BRepBuilderAPI_MakeWire_1() + .Add_1(edge)
      const wm = new oc.BRepBuilderAPI_MakeWire_1();
      for (const e of edges) wm.Add_1(e);
      const wire = wm.Wire();
      wm.delete();
      chain.wireOverload = 'BRepBuilderAPI_MakeWire_1() + .Add_1(edge)';

      // Face — verified: BRepBuilderAPI_MakeFace_15(wire, isPlanar)
      const fm = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
      const face = fm.Face();
      fm.delete();
      chain.faceOverload = 'BRepBuilderAPI_MakeFace_15(wire, true)';

      // Vec — verified: gp_Vec_4(x, y, z)
      const extVec = new oc.gp_Vec_4(0, 0, extH);
      chain.vecOverload = 'gp_Vec_4(x, y, z)';

      // Prism — try _1 first (copy=false, canonize=true)
      let prismShape = null;
      let prismOverload = null;
      for (const suffix of ['_1', '_2', '_3']) {
        const cls = 'BRepPrimAPI_MakePrism' + suffix;
        if (!oc[cls]) continue;
        try {
          const pm = new oc[cls](face, extVec, false, true);
          const s = safeShape(pm);
          if (s) {
            prismOverload = cls + '(face, vec, false, true)';
            prismShape = s;
            pm.delete();
            break;
          }
          pm.delete();
        } catch (_e) {
          try {
            const pm = new oc[cls](face, extVec);
            const s = safeShape(pm);
            if (s) {
              prismOverload = cls + '(face, vec)';
              prismShape = s;
              pm.delete();
              break;
            }
            pm.delete();
          } catch (_e2) {}
        }
      }
      chain.prismOverload = prismOverload;

      if (prismShape) {
        const vol = volume(prismShape);
        result.item8_extrude = {
          confirmed: true,
          chain,
          volumeMM3: vol,
          expected: 480,
          withinTol: Math.abs(vol - 480) < 2,
        };
        prismShape.delete();
      } else {
        result.item8_extrude = { confirmed: false, chain, error: 'BRepPrimAPI_MakePrism: all overloads failed' };
      }

      // Cleanup
      for (const e of edges) e.delete();
      wire.delete();
      face.delete();
      extVec.delete();
      p0.delete(); p1.delete(); p2.delete(); p3.delete();
    } catch (e) {
      result.item8_extrude = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 9 — Revolve (innerR=4, width=3, height=10, 360°; vol ≈ 1036.7)
    // Profile in XZ plane (y=0): rect from (4,0,0) to (7,0,10), revolved around Z axis.
    // Verified:
    //   gp_Pnt_3, BRepBuilderAPI_MakeEdge_3, BRepBuilderAPI_MakeWire_1+Add_1,
    //   BRepBuilderAPI_MakeFace_15(wire, true)
    //   gp_Dir_4(0, 0, 1), gp_Ax1_2(pnt, dir)
    //   BRepPrimAPI_MakeRevol_N(face, ax1, angle, copy)
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const innerR = 4, w = 3, h = 10;
      const chain = {};

      // Profile: rectangle in XZ plane offset from Z axis
      const rp0 = new oc.gp_Pnt_3(innerR, 0, 0);
      const rp1 = new oc.gp_Pnt_3(innerR + w, 0, 0);
      const rp2 = new oc.gp_Pnt_3(innerR + w, 0, h);
      const rp3 = new oc.gp_Pnt_3(innerR, 0, h);
      chain.pntOverload = 'gp_Pnt_3(x, y, z)';

      // Edges
      const rPPairs = [[rp0,rp1],[rp1,rp2],[rp2,rp3],[rp3,rp0]];
      const revolveEdges = [];
      for (const [a, b] of rPPairs) {
        const em = new oc.BRepBuilderAPI_MakeEdge_3(a, b);
        revolveEdges.push(em.Edge());
        em.delete();
      }
      chain.edgeOverload = 'BRepBuilderAPI_MakeEdge_3(gp_Pnt, gp_Pnt)';

      // Wire
      const rwm = new oc.BRepBuilderAPI_MakeWire_1();
      for (const e of revolveEdges) rwm.Add_1(e);
      const rWire = rwm.Wire();
      rwm.delete();
      chain.wireOverload = 'BRepBuilderAPI_MakeWire_1() + .Add_1(edge)';

      // Face
      const rfm = new oc.BRepBuilderAPI_MakeFace_15(rWire, true);
      const rFace = rfm.Face();
      rfm.delete();
      chain.faceOverload = 'BRepBuilderAPI_MakeFace_15(wire, true)';

      // Z axis — verified: gp_Dir_4(0, 0, 1), gp_Ax1_2(originPnt, dir)
      const axisDir = new oc.gp_Dir_4(0, 0, 1);
      const originPt = new oc.gp_Pnt_3(0, 0, 0);
      const rotAxis = new oc.gp_Ax1_2(originPt, axisDir);
      chain.dirOverload = 'gp_Dir_4(x, y, z)';
      chain.ax1Overload = 'gp_Ax1_2(gp_Pnt, gp_Dir)';

      // Revolve — try suffixes
      let revolveShape = null;
      let revolveOverload = null;
      const angle = 2 * Math.PI;
      for (const suffix of ['_1', '_2', '_3', '_4']) {
        const cls = 'BRepPrimAPI_MakeRevol' + suffix;
        if (!oc[cls]) continue;
        try {
          const rm = new oc[cls](rFace, rotAxis, angle, false);
          const s = safeShape(rm);
          if (s) {
            revolveOverload = cls + '(face, ax1, angle, false)';
            revolveShape = s;
            rm.delete();
            break;
          }
          rm.delete();
        } catch (_e) {
          try {
            const rm = new oc[cls](rFace, rotAxis, angle);
            const s = safeShape(rm);
            if (s) {
              revolveOverload = cls + '(face, ax1, angle)';
              revolveShape = s;
              rm.delete();
              break;
            }
            rm.delete();
          } catch (_e2) {
            try {
              const rm = new oc[cls](rFace, rotAxis);
              const s = safeShape(rm);
              if (s) {
                revolveOverload = cls + '(face, ax1)';
                revolveShape = s;
                rm.delete();
                break;
              }
              rm.delete();
            } catch (_e3) {}
          }
        }
      }
      chain.revolveOverload = revolveOverload;

      if (revolveShape) {
        const vol = volume(revolveShape);
        result.item9_revolve = {
          confirmed: true,
          chain,
          volumeMM3: vol,
          expected: 1036.7,
          withinTol: Math.abs(vol - 1036.7) < 5,
        };
        revolveShape.delete();
      } else {
        result.item9_revolve = { confirmed: false, chain, error: 'BRepPrimAPI_MakeRevol: all failed' };
      }

      // Cleanup
      for (const e of revolveEdges) e.delete();
      rWire.delete();
      rFace.delete();
      axisDir.delete();
      originPt.delete();
      rotAxis.delete();
      rp0.delete(); rp1.delete(); rp2.delete(); rp3.delete();
    } catch (e) {
      result.item9_revolve = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 10 — Fillet (all 12 edges of 10mm box, r=1; 900 < vol < 1000)
    // Verified:
    //   BRepFilletAPI_MakeFillet_1(shape, ChFi3d_Rational)
    //   .Add_2(radius, edge)
    //   .Build(progressRange) + .IsDone() + .Shape()
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const boxM = makeBox(10, 10, 10);
      const boxShape = boxM.Shape();
      const chain = {};

      // Constructor: BRepFilletAPI_MakeFillet (undecorated, not _1) takes (shape, ChFi3d_FilletShape)
      const filletShapeEnum = oc.ChFi3d_FilletShape
        ? oc.ChFi3d_FilletShape.ChFi3d_Rational
        : 0;
      const filletObj = new oc.BRepFilletAPI_MakeFillet(boxShape, filletShapeEnum);
      chain.ctor = 'BRepFilletAPI_MakeFillet(shape, ChFi3d_FilletShape.ChFi3d_Rational)';

      // Collect 12 unique edges
      const EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;
      const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
      const edgeExp = new oc.TopExp_Explorer_2(boxShape, EDGE, ANY);
      const seenEdges = [];
      while (edgeExp.More()) {
        const eShape = edgeExp.Current();
        const edge = oc.TopoDS.Edge_1(eShape);
        let isDup = false;
        for (const seen of seenEdges) {
          if (seen.IsSame(edge)) { isDup = true; break; }
        }
        if (!isDup) seenEdges.push(edge);
        else edge.delete();
        edgeExp.Next();
      }
      edgeExp.delete();
      chain.edgeCount = seenEdges.length;

      // Add all edges with r=1 — verified: .Add_2(radius, edge)
      for (const edge of seenEdges) {
        filletObj.Add_2(1.0, edge);
      }
      chain.addOverload = '.Add_2(radius, edge)';

      // Cleanup edge handles
      for (const e of seenEdges) e.delete();

      // Build
      const { didBuild, buildError, done } = boolBuild(filletObj);
      chain.explicitBuildNeeded = didBuild;
      chain.buildError = buildError;

      if (done) {
        const filletShape = filletObj.Shape();
        if (filletShape && !filletShape.IsNull()) {
          const vol = volume(filletShape);
          result.item10_fillet = {
            confirmed: true,
            chain,
            volumeMM3: vol,
            volumeInRange: vol > 900 && vol < 1000,
          };
          filletShape.delete();
        } else {
          result.item10_fillet = { confirmed: false, chain, error: 'Shape() null' };
        }
      } else {
        result.item10_fillet = { confirmed: false, chain, error: 'IsDone=false' };
      }

      filletObj.delete();
      boxShape.delete();
      boxM.delete();
    } catch (e) {
      result.item10_fillet = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 11 — Chamfer (all edges of 10mm box, d=1; vol < 1000)
    // Verified:
    //   BRepFilletAPI_MakeChamfer_1(shape)
    //   .Add_2(distance, edge)
    //   .Build(progressRange) + .IsDone() + .Shape()
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const boxM = makeBox(10, 10, 10);
      const boxShape = boxM.Shape();
      const chain = {};

      // Constructor: BRepFilletAPI_MakeChamfer (undecorated, not _1) takes (shape)
      const chamferObj = new oc.BRepFilletAPI_MakeChamfer(boxShape);
      chain.ctor = 'BRepFilletAPI_MakeChamfer(shape)';

      // Collect 12 unique edges
      const EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;
      const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
      const edgeExp = new oc.TopExp_Explorer_2(boxShape, EDGE, ANY);
      const seenEdges = [];
      while (edgeExp.More()) {
        const eShape = edgeExp.Current();
        const edge = oc.TopoDS.Edge_1(eShape);
        let isDup = false;
        for (const seen of seenEdges) {
          if (seen.IsSame(edge)) { isDup = true; break; }
        }
        if (!isDup) seenEdges.push(edge);
        else edge.delete();
        edgeExp.Next();
      }
      edgeExp.delete();
      chain.edgeCount = seenEdges.length;

      // Add all edges — verified: .Add_2(distance, edge)
      for (const edge of seenEdges) {
        chamferObj.Add_2(1.0, edge);
      }
      chain.addOverload = '.Add_2(distance, edge)';
      for (const e of seenEdges) e.delete();

      // Build
      const { didBuild, buildError, done } = boolBuild(chamferObj);
      chain.explicitBuildNeeded = didBuild;
      chain.buildError = buildError;

      if (done) {
        const chamferShape = chamferObj.Shape();
        if (chamferShape && !chamferShape.IsNull()) {
          const vol = volume(chamferShape);
          result.item11_chamfer = {
            confirmed: true,
            chain,
            volumeMM3: vol,
            volumeBelow1000: vol < 1000,
          };
          chamferShape.delete();
        } else {
          result.item11_chamfer = { confirmed: false, chain, error: 'Shape() null' };
        }
      } else {
        result.item11_chamfer = { confirmed: false, chain, error: 'IsDone=false' };
      }

      chamferObj.delete();
      boxShape.delete();
      boxM.delete();
    } catch (e) {
      result.item11_chamfer = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 12 — STEP export (10mm box → STEP text; must contain ISO-10303-21)
    // Verified:
    //   STEPControl_Writer_1()
    //   .Transfer(shape, STEPControl_StepModelType.STEPControl_AsIs, true, progressRange) → 1
    //   .Write('filename')  — filename is relative path in Emscripten FS (no leading slash)
    //   oc.FS.readFile('filename', {encoding:'utf8'})
    // ══════════════════════════════════════════════════════════════════════════
    let stepText = null;
    const stepFilename = 'a1_recon_box.step';
    try {
      const boxM = makeBox(10, 10, 10);
      const boxShape = boxM.Shape();
      const chain = {};

      const writer = new oc.STEPControl_Writer_1();
      chain.writerCtor = 'STEPControl_Writer_1()';

      // modelType: STEPControl_AsIs = 0
      const modelType = oc.STEPControl_StepModelType.STEPControl_AsIs;
      const mtVal = (typeof modelType === 'object' && modelType !== null && 'value' in modelType)
        ? modelType.value : modelType;
      chain.modelType = 'STEPControl_StepModelType.STEPControl_AsIs';
      chain.modelTypeValue = mtVal;

      // Transfer — REQUIRES 4 args: (shape, modelType, bool, ProgressRange)
      const prTransfer = new oc.Message_ProgressRange_1();
      const transferRet = writer.Transfer(boxShape, modelType, true, prTransfer);
      prTransfer.delete();
      const retVal = (typeof transferRet === 'object' && transferRet !== null && 'value' in transferRet)
        ? transferRet.value : transferRet;
      chain.transferOverload = 'Transfer(shape, modelType, true, progressRange) → 4 args required';
      chain.transferRet = retVal; // 1 = IFSelect_RetDone

      // Write — relative filename works in Emscripten FS
      const writeRet = writer.Write(stepFilename);
      const writeRetVal = (typeof writeRet === 'object' && writeRet !== null && 'value' in writeRet)
        ? writeRet.value : writeRet;
      chain.writeOverload = `Write('${stepFilename}') — relative path`;
      chain.writeRet = writeRetVal; // 1 = success

      // Read back via oc.FS.readFile with {encoding:'utf8'}
      const text = oc.FS.readFile(stepFilename, { encoding: 'utf8' });
      stepText = text;
      chain.fsReadPath = `oc.FS.readFile('${stepFilename}', {encoding:'utf8'})`;
      chain.textLength = text.length;

      const isStep = typeof text === 'string' && text.includes('ISO-10303-21');
      result.item12_step_export = {
        confirmed: isStep,
        chain,
        containsISO: isStep,
        stepTextLength: text.length,
      };

      writer.delete();
      boxShape.delete();
      boxM.delete();
    } catch (e) {
      result.item12_step_export = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 13 — STEP import (round-trip the box; volume ≈ 1000)
    // Verified:
    //   oc.FS.writeFile('filename', text)
    //   STEPControl_Reader_1()
    //   .ReadFile('filename') → IFSelect_RetDone (1)
    //   .TransferRoots(progressRange)
    //   .OneShape() → TopoDS_Shape
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const importFilename = 'a1_recon_import.step';
      const chain = {};

      if (!stepText || !stepText.includes('ISO-10303-21')) {
        result.item13_step_import = {
          confirmed: false,
          error: 'no valid STEP text from item 12',
        };
      } else {
        // Write STEP text to Emscripten FS
        oc.FS.writeFile(importFilename, stepText);
        chain.writeFileCall = `oc.FS.writeFile('${importFilename}', stepText)`;

        // Reader
        const reader = new oc.STEPControl_Reader_1();
        chain.readerCtor = 'STEPControl_Reader_1()';

        // ReadFile
        const readRet = reader.ReadFile(importFilename);
        const readRetVal = (typeof readRet === 'object' && readRet !== null && 'value' in readRet)
          ? readRet.value : readRet;
        chain.readFileRet = readRetVal; // 1 = IFSelect_RetDone

        // TransferRoots — try with ProgressRange, fallback to no-arg
        let trRet = null;
        try {
          const prTr = new oc.Message_ProgressRange_1();
          trRet = reader.TransferRoots(prTr);
          prTr.delete();
          chain.transferRootsCall = 'TransferRoots(progressRange)';
        } catch (_e) {
          trRet = reader.TransferRoots();
          chain.transferRootsCall = 'TransferRoots()';
        }
        const trVal = (typeof trRet === 'object' && trRet !== null && 'value' in trRet)
          ? trRet.value : trRet;
        chain.transferRootsRet = trVal;

        // OneShape
        const importedShape = reader.OneShape();
        if (importedShape && !importedShape.IsNull()) {
          const vol = volume(importedShape);
          result.item13_step_import = {
            confirmed: true,
            chain,
            volumeMM3: vol,
            expected: 1000,
            withinTol: Math.abs(vol - 1000) < 5,
          };
          importedShape.delete();
        } else {
          result.item13_step_import = {
            confirmed: false,
            chain,
            error: 'OneShape() returned null or IsNull',
          };
        }
        reader.delete();
      }
    } catch (e) {
      result.item13_step_import = { confirmed: false, error: String(e) };
    }

    return result;
  });

  // ── Write JSON output ────────────────────────────────────────────────────────
  const notesDir = path.join(__dirname, '..', 'docs', 'superpowers', 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
  const jsonPath = path.join(notesDir, 'occt-api-A1-recon.json');
  fs.writeFileSync(jsonPath, JSON.stringify(verified, null, 2));
  console.log('A1 RECON RESULT:', JSON.stringify(verified, null, 2));

  // ── Assertions ───────────────────────────────────────────────────────────────

  expect(verified.item1_cylinder.confirmed, `cylinder: ${verified.item1_cylinder.error}`).toBe(true);
  expect(verified.item1_cylinder.withinTol, `cylinder vol=${verified.item1_cylinder.volumeMM3} expected~942.5`).toBe(true);

  expect(verified.item2_sphere.confirmed, `sphere: ${verified.item2_sphere.error}`).toBe(true);
  expect(verified.item2_sphere.withinTol, `sphere vol=${verified.item2_sphere.volumeMM3} expected~904.8`).toBe(true);

  expect(verified.item3_cone.confirmed, `cone: ${verified.item3_cone.error}`).toBe(true);
  expect(verified.item3_cone.withinTol, `cone vol=${verified.item3_cone.volumeMM3} expected~653.5`).toBe(true);

  expect(verified.item4_torus.confirmed, `torus: ${verified.item4_torus.error}`).toBe(true);
  expect(verified.item4_torus.withinTol, `torus vol=${verified.item4_torus.volumeMM3} expected~1776.5`).toBe(true);

  expect(verified.item5_fuse.confirmed, `fuse: ${verified.item5_fuse.error}`).toBe(true);
  expect(verified.item5_fuse.withinTol, `fuse vol=${verified.item5_fuse.volumeMM3} expected~1000`).toBe(true);

  expect(verified.item6_cut.confirmed, `cut: ${verified.item6_cut.error}`).toBe(true);

  expect(verified.item7_common.confirmed, `common: ${verified.item7_common.error}`).toBe(true);
  expect(verified.item7_common.withinTol, `common vol=${verified.item7_common.volumeMM3} expected~1000`).toBe(true);

  expect(verified.item8_extrude.confirmed, `extrude: ${verified.item8_extrude.error}`).toBe(true);
  expect(verified.item8_extrude.withinTol, `extrude vol=${verified.item8_extrude.volumeMM3} expected~480`).toBe(true);

  expect(verified.item9_revolve.confirmed, `revolve: ${verified.item9_revolve.error}`).toBe(true);
  expect(verified.item9_revolve.withinTol, `revolve vol=${verified.item9_revolve.volumeMM3} expected~1036.7`).toBe(true);

  expect(verified.item10_fillet.confirmed, `fillet: ${verified.item10_fillet.error}`).toBe(true);
  expect(verified.item10_fillet.volumeInRange, `fillet vol=${verified.item10_fillet.volumeMM3} not in (900,1000)`).toBe(true);

  expect(verified.item11_chamfer.confirmed, `chamfer: ${verified.item11_chamfer.error}`).toBe(true);
  expect(verified.item11_chamfer.volumeBelow1000, `chamfer vol=${verified.item11_chamfer.volumeMM3} not < 1000`).toBe(true);

  expect(verified.item12_step_export.confirmed, `step export: ${verified.item12_step_export.error}`).toBe(true);
  expect(verified.item12_step_export.containsISO, 'STEP text missing ISO-10303-21').toBe(true);

  expect(verified.item13_step_import.confirmed, `step import: ${verified.item13_step_import.error}`).toBe(true);
  expect(verified.item13_step_import.withinTol, `step import vol=${verified.item13_step_import.volumeMM3} expected~1000`).toBe(true);

  expect(pageErrors).toEqual([]);
  await app.close();
});
