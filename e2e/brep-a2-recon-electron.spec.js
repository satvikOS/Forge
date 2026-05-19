/**
 * brep-a2-recon-electron.spec.js
 *
 * Phase A2 empirical OCCT API reconnaissance.
 * Verifies exact opencascade.js call signatures for:
 *   1.  Shell / hollow  (BRepOffsetAPI_MakeThickSolid)
 *   2.  Thicken sheet   (BRepOffsetAPI_MakeThickSolid or MakeOffsetShape on open shell)
 *   3.  Offset shape    (BRepOffsetAPI_MakeOffsetShape)
 *   4.  Draft angle     (BRepOffsetAPI_DraftAngle)
 *   5.  Sweep along path (BRepOffsetAPI_MakePipe)
 *   6.  Loft through sections (BRepOffsetAPI_ThruSections)
 *   7.  Variable-radius fillet (BRepFilletAPI_MakeFillet variable Add overload)
 *
 * Writes:  docs/superpowers/notes/occt-api-A2-recon.json
 * Pattern: e2e/brep-a1-recon-electron.spec.js
 * Package: opencascade.js@2.0.0-beta.b5ff984
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.setTimeout(600000);

test('Phase A2 — OCCT API recon (items 1-7)', async () => {
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

    /** Measure volume of a TopoDS_Shape. */
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

    /** Build a box (A0/A1 verified). */
    function makeBoxShape(dx, dy, dz) {
      const m = new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz);
      const s = m.Shape();
      m.delete();
      return s;
    }

    /**
     * Collect unique faces from a shape.
     * Returns array of TopoDS_Face (caller must .delete()).
     */
    function collectFaces(shape) {
      const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
      const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
      const exp  = new oc.TopExp_Explorer_2(shape, FACE, ANY);
      const faces = [];
      while (exp.More()) {
        const fShape = exp.Current();
        const face   = oc.TopoDS.Face_1(fShape);
        let isDup = false;
        for (const seen of faces) {
          if (seen.IsSame(face)) { isDup = true; break; }
        }
        if (!isDup) faces.push(face);
        else face.delete();
        exp.Next();
      }
      exp.delete();
      return faces;
    }

    /**
     * Collect unique edges from a shape.
     * Returns array of TopoDS_Edge (caller must .delete()).
     */
    function collectEdges(shape) {
      const EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;
      const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
      const exp  = new oc.TopExp_Explorer_2(shape, EDGE, ANY);
      const edges = [];
      while (exp.More()) {
        const eShape = exp.Current();
        const edge   = oc.TopoDS.Edge_1(eShape);
        let isDup = false;
        for (const seen of edges) {
          if (seen.IsSame(edge)) { isDup = true; break; }
        }
        if (!isDup) edges.push(edge);
        else edge.delete();
        exp.Next();
      }
      exp.delete();
      return edges;
    }

    /**
     * Get bounding box of a shape.
     * Returns {minX, minY, minZ, maxX, maxY, maxZ}.
     */
    function bbox(shape) {
      const bb = new oc.Bnd_Box_1();
      oc.BRepBndLib.Add(shape, bb, false);
      const mn = bb.CornerMin();
      const mx = bb.CornerMax();
      const r = {
        minX: mn.X(), minY: mn.Y(), minZ: mn.Z(),
        maxX: mx.X(), maxY: mx.Y(), maxZ: mx.Z(),
      };
      mn.delete(); mx.delete(); bb.delete();
      return r;
    }

    /**
     * Explicitly build an algo with Message_ProgressRange, return {didBuild, buildError, done}.
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

    /**
     * Try calling algo.Build() with no args if the PR version fails.
     */
    function flexBuild(algo) {
      let didBuild = false;
      let buildError = null;
      try {
        const pr = new oc.Message_ProgressRange_1();
        algo.Build(pr);
        pr.delete();
        didBuild = true;
        buildError = null;
      } catch (e) {
        buildError = String(e);
        try {
          algo.Build();
          didBuild = true;
          buildError = null;
        } catch (e2) {
          buildError = String(e2);
        }
      }
      let done = false;
      try { done = algo.IsDone(); } catch (_e) {}
      return { didBuild, buildError, done };
    }

    /**
     * Introspect all own + prototype property names of an object.
     */
    function introspectMethods(obj) {
      const own   = Object.getOwnPropertyNames(obj);
      const proto = obj && Object.getOwnPropertyNames(Object.getPrototypeOf(obj));
      return [...new Set([...own, ...(proto || [])])].sort();
    }

    const result = {};

    // ══════════════════════════════════════════════════════════════════════════
    // Item 1 — Shell / hollow (BRepOffsetAPI_MakeThickSolid)
    //   Hollow a 20mm box to wall thickness 2, removing top (+Z) face.
    //   Expected volume: 20³ - (16³) = 8000 - 4096 = 3904 (inner cavity 16³)
    //   Actually inner dims = 20-2*2 = 16, so inner vol = 16³ = 4096, shell vol = 8000-4096 = 3904
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};
      const boxShape = makeBoxShape(20, 20, 20);

      // Collect faces, find top face (max Z centroid)
      const faces = collectFaces(boxShape);
      chain.faceCount = faces.length;

      // Find the top face by bounding box max Z
      let topFace = null;
      let topFaceMaxZ = -Infinity;
      for (const face of faces) {
        const fb = bbox(face);
        const faceMaxZ = fb.maxZ;
        if (faceMaxZ > topFaceMaxZ) {
          topFaceMaxZ = faceMaxZ;
          topFace = face;
        }
      }
      chain.topFaceMaxZ = topFaceMaxZ;

      // Build TopTools_ListOfShape containing the top face to remove
      // Try various TopTools_ListOfShape constructors
      let facesToRemove = null;
      let listCtorName = null;
      for (const suffix of ['_1', '_2', '', '_3']) {
        const cls = 'TopTools_ListOfShape' + suffix;
        if (!oc[cls]) continue;
        try {
          facesToRemove = new oc[cls]();
          listCtorName = cls + '()';
          break;
        } catch (_e) {}
      }
      chain.listCtor = listCtorName;

      // Append the top face to the list
      let appendMethod = null;
      if (facesToRemove) {
        const methods = introspectMethods(facesToRemove);
        chain.listMethods = methods.filter(m => m.startsWith('Append') || m.startsWith('append') || m === 'Add' || m === 'Push');
        for (const m of ['Append_1', 'Append', 'Append_2', 'Add', 'Push', 'push_back']) {
          if (typeof facesToRemove[m] === 'function') {
            try {
              facesToRemove[m](topFace);
              appendMethod = m;
              break;
            } catch (_e) {}
          }
        }
      }
      chain.appendMethod = appendMethod;

      // Now try BRepOffsetAPI_MakeThickSolid
      let thickSolid = null;
      let thickCtorName = null;
      let thickMethod = null;

      // Introspect what's available on oc
      const ocKeys = Object.getOwnPropertyNames(oc);
      chain.thickSolidKeys = ocKeys.filter(k => k.toLowerCase().includes('thick') || k.toLowerCase().includes('offset'));

      // Try MakeThickSolid via MakeThickSolidByJoin method on the object
      // First try constructors
      for (const suffix of ['_1', '_2', '', '_3']) {
        const cls = 'BRepOffsetAPI_MakeThickSolid' + suffix;
        if (!oc[cls]) continue;
        try {
          thickSolid = new oc[cls]();
          thickCtorName = cls + '()';
          break;
        } catch (_e) {}
      }

      if (thickSolid && facesToRemove && appendMethod) {
        // Try MakeThickSolidByJoin
        const methods = introspectMethods(thickSolid);
        chain.thickMethods = methods.filter(m => m.toLowerCase().includes('make') || m.toLowerCase().includes('join') || m.toLowerCase().includes('build') || m.toLowerCase().includes('shape'));

        for (const m of ['MakeThickSolidByJoin', 'MakeThickSolidBySimple']) {
          if (typeof thickSolid[m] === 'function') {
            try {
              const tol = 0.001;
              // MakeThickSolidByJoin(S, closingFaces, offset, tol, mode, intersection, selfInter, joinType, removeIntEdges)
              // offset < 0 = inward
              thickSolid[m](boxShape, facesToRemove, -2, tol);
              thickMethod = m + '(shape, facesToRemove, -2, tol)';
              break;
            } catch (e) {
              chain['joinErr_' + m] = String(e);
              // Try with more args
              try {
                const pr = new oc.Message_ProgressRange_1();
                thickSolid[m](boxShape, facesToRemove, -2, 0.001, 0, false, false, 0, false, pr);
                pr.delete();
                thickMethod = m + '(shape, faces, -2, 0.001, 0, false, false, 0, false, pr)';
                break;
              } catch (e2) {
                chain['joinErr10_' + m] = String(e2);
                // Try without progress range
                try {
                  thickSolid[m](boxShape, facesToRemove, -2, 0.001, 0, false, false, 0, false);
                  thickMethod = m + '(shape, faces, -2, 0.001, 0, false, false, 0, false)';
                  break;
                } catch (e3) {
                  chain['joinErr9_' + m] = String(e3);
                }
              }
            }
          }
        }

        chain.thickMethod = thickMethod;

        if (thickMethod) {
          const { didBuild, buildError, done } = flexBuild(thickSolid);
          chain.didBuild = didBuild;
          chain.buildError = buildError;
          chain.done = done;

          if (done || didBuild) {
            const shape = safeShape(thickSolid);
            if (shape) {
              const vol = volume(shape);
              result.item1_shell = {
                confirmed: true,
                chain,
                volumeMM3: vol,
                volumeInRange: vol > 0 && vol < 8000,
              };
              shape.delete();
            } else {
              result.item1_shell = { confirmed: false, chain, error: 'Shape() null after build' };
            }
          } else {
            result.item1_shell = { confirmed: false, chain, error: 'Build failed or IsDone=false' };
          }
        } else {
          result.item1_shell = { confirmed: false, chain, error: 'No MakeThickSolid method found' };
        }
      } else if (!facesToRemove) {
        result.item1_shell = { confirmed: false, chain, error: 'Could not construct TopTools_ListOfShape' };
      } else if (!thickSolid) {
        result.item1_shell = { confirmed: false, chain, error: 'BRepOffsetAPI_MakeThickSolid not found' };
      } else {
        result.item1_shell = { confirmed: false, chain, error: 'appendMethod not found' };
      }

      // Cleanup
      for (const f of faces) f.delete();
      if (facesToRemove) facesToRemove.delete();
      if (thickSolid) thickSolid.delete();
      boxShape.delete();
    } catch (e) {
      result.item1_shell = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 2 — Thicken sheet (planar face → solid via MakeOffsetShape PerformByJoin)
    //   Build a 60×40 planar face, thicken by 3mm → vol ≈ 7200
    //   From run 1: PerformByJoin needs exactly 9 args.
    //   Signature: PerformByJoin(S, offset, tol, mode, intersection, selfInter, joinType, removeIntEdges, progressRange)
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};
      const w = 60, d = 40, t = 3;

      // Build planar face (A1 verified chain)
      const p0 = new oc.gp_Pnt_3(0, 0, 0);
      const p1 = new oc.gp_Pnt_3(w, 0, 0);
      const p2 = new oc.gp_Pnt_3(w, d, 0);
      const p3 = new oc.gp_Pnt_3(0, d, 0);

      const em01 = new oc.BRepBuilderAPI_MakeEdge_3(p0, p1); const e01 = em01.Edge(); em01.delete();
      const em12 = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2); const e12 = em12.Edge(); em12.delete();
      const em23 = new oc.BRepBuilderAPI_MakeEdge_3(p2, p3); const e23 = em23.Edge(); em23.delete();
      const em30 = new oc.BRepBuilderAPI_MakeEdge_3(p3, p0); const e30 = em30.Edge(); em30.delete();

      const wm = new oc.BRepBuilderAPI_MakeWire_1();
      wm.Add_1(e01); wm.Add_1(e12); wm.Add_1(e23); wm.Add_1(e30);
      const wire = wm.Wire(); wm.delete();

      const fm = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
      const faceShape = fm.Face(); fm.delete();
      chain.faceBuilt = true;

      // Strategy for "thicken a face into a solid":
      // 1. BRepOffsetAPI_MakeThickSolid.MakeThickSolidBySimple(face, offset) — 2 args (the solid thickener)
      // 2. BRepOffsetAPI_MakeOffsetShape.PerformByJoin(S,off,tol,mode,inters,selfInters,joinType,removeIntEdges,pr) — 9 args
      //    (this offsets a shell; gives volume 0 on a single face as it creates the offset face not a solid)
      let thickened = false;
      chain.offsetShapeMethods = ['PerformByJoin (9 args)', 'PerformBySimple (2 args)', 'MakeThickSolidBySimple (2 args)'];

      // First try: MakeThickSolidBySimple(face, offset) — designed for thickening open shells
      try {
        const thickObj2 = new oc.BRepOffsetAPI_MakeThickSolid();
        thickObj2.MakeThickSolidBySimple(faceShape, t);
        const { didBuild, buildError, done } = flexBuild(thickObj2);
        chain.ctor = 'BRepOffsetAPI_MakeThickSolid()';
        chain.thickSimpleMethod = 'MakeThickSolidBySimple(face, 3)';
        chain.didBuild = didBuild;
        chain.buildError = buildError;
        chain.done = done;
        const shape = safeShape(thickObj2);
        if (shape) {
          const vol = volume(shape);
          result.item2_thickenSheet = {
            confirmed: true,
            method: 'BRepOffsetAPI_MakeThickSolid.MakeThickSolidBySimple',
            chain,
            volumeMM3: vol,
            expected: 7200,
            // vol may be negative due to face normal orientation; use |vol|
            withinTol: Math.abs(Math.abs(vol) - 7200) < 100,
          };
          shape.delete();
          thickened = true;
        } else {
          chain.thickSimpleShapeNull = true;
        }
        thickObj2.delete();
      } catch (e) {
        chain['thickSimpleErr'] = String(e).substring(0, 200);
      }

      // Second try: BRepOffsetAPI_MakeOffsetShape.PerformByJoin with 9 args
      // NOTE: on a single planar face this gives a shell (volume=0); for solid thickening use MakeThickSolidBySimple
      if (!thickened) {
        const offsetAlgo = new oc.BRepOffsetAPI_MakeOffsetShape();
        chain.ctor2 = 'BRepOffsetAPI_MakeOffsetShape()';
        try {
          const pr9 = new oc.Message_ProgressRange_1();
          offsetAlgo.PerformByJoin(faceShape, t, 0.001, 0, false, false, 0, false, pr9);
          pr9.delete();
          chain.performMethod = 'PerformByJoin(face, 3, 0.001, 0, false, false, 0, false, pr)';
          thickened = true;
        } catch (e) {
          chain['joinErr9'] = String(e).substring(0, 200);
        }
        if (thickened) {
          const { didBuild, buildError, done } = flexBuild(offsetAlgo);
          chain.didBuild2 = didBuild;
          chain.done2 = done;
          const shape = safeShape(offsetAlgo);
          if (shape) {
            const vol = volume(shape);
            result.item2_thickenSheet = {
              confirmed: Math.abs(vol - 7200) < 100,
              method: 'BRepOffsetAPI_MakeOffsetShape.PerformByJoin',
              chain,
              volumeMM3: vol,
              expected: 7200,
              withinTol: Math.abs(vol - 7200) < 100,
              note: 'PerformByJoin on single face gives shell (vol≈0); use MakeThickSolidBySimple for true thickening',
            };
            shape.delete();
          } else {
            result.item2_thickenSheet = { confirmed: false, chain, error: 'Shape() null after PerformByJoin' };
          }
        } else {
          result.item2_thickenSheet = { confirmed: false, chain, error: 'All PerformBy* / MakeThickSolid approaches failed' };
        }
        offsetAlgo.delete();
      }

      // Cleanup
      for (const e of [e01, e12, e23, e30]) e.delete();
      wire.delete(); faceShape.delete();
      p0.delete(); p1.delete(); p2.delete(); p3.delete();
    } catch (e) {
      result.item2_thickenSheet = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 3 — Offset shape (BRepOffsetAPI_MakeOffsetShape)
    //   Offset all faces of a 20mm box outward by 2mm → vol > 8000
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};
      const boxShape = makeBoxShape(20, 20, 20);

      // Introspect available offset classes
      const ocKeys = Object.getOwnPropertyNames(oc);
      chain.offsetClasses = ocKeys.filter(k => k.toLowerCase().includes('offsetshape'));

      let confirmed = false;

      for (const suffix of ['_1', '_2', '', '_3']) {
        const cls = 'BRepOffsetAPI_MakeOffsetShape' + suffix;
        if (!oc[cls]) continue;
        try {
          const algo = new oc[cls]();
          chain.ctor = cls + '()';

          // Introspect methods
          const methods = introspectMethods(algo);
          chain.methods = methods.filter(m =>
            m.startsWith('Perform') || m.startsWith('Build') || m === 'Shape' || m.startsWith('IsDone')
          );

          // Try PerformByJoin
          let performed = false;
          for (const pm of ['PerformByJoin', 'PerformBySimple', 'Perform']) {
            if (typeof algo[pm] === 'function') {
              const argSets = [
                [boxShape, 2, 0.001, 0, false, false, 0, false],
                [boxShape, 2, 0.001, 0, false, false, 0],
                [boxShape, 2, 0.001, 0, false, false],
                [boxShape, 2, 0.001, 0],
                [boxShape, 2, 0.001],
                [boxShape, 2],
              ];
              for (const args of argSets) {
                try {
                  algo[pm](...args);
                  chain.performMethod = pm + '(' + args.map(a => typeof a === 'object' ? 'shape' : a).join(', ') + ')';
                  performed = true;
                  break;
                } catch (e) {
                  chain['perfErr_' + pm + '_' + args.length] = String(e).substring(0, 200);
                }
              }
              if (performed) break;
            }
          }

          if (performed) {
            const { didBuild, buildError, done } = flexBuild(algo);
            chain.didBuild = didBuild;
            chain.buildError = buildError;
            chain.done = done;

            const shape = safeShape(algo);
            if (shape) {
              const vol = volume(shape);
              result.item3_offsetShape = {
                confirmed: true,
                chain,
                volumeMM3: vol,
                volumeAbove8000: vol > 8000,
              };
              shape.delete();
              confirmed = true;
            } else {
              result.item3_offsetShape = { confirmed: false, chain, error: 'Shape() null' };
            }
          } else {
            result.item3_offsetShape = { confirmed: false, chain, error: 'No Perform* method worked' };
          }

          algo.delete();
          if (confirmed) break;
        } catch (e) {
          chain['ctorErr_' + suffix] = String(e);
        }
      }

      if (!confirmed && !result.item3_offsetShape) {
        result.item3_offsetShape = { confirmed: false, chain, error: 'BRepOffsetAPI_MakeOffsetShape: all suffixes failed' };
      }

      boxShape.delete();
    } catch (e) {
      result.item3_offsetShape = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 4 — Draft angle (BRepOffsetAPI_DraftAngle)
    //   5° draft on 4 side faces of a 20mm box, neutral plane = bottom (z=0),
    //   pull direction +Z.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};
      const boxShape = makeBoxShape(20, 20, 20);

      // Introspect available draft classes
      const ocKeys = Object.getOwnPropertyNames(oc);
      chain.draftClasses = ocKeys.filter(k => k.toLowerCase().includes('draft'));

      // Collect faces
      const faces = collectFaces(boxShape);
      chain.faceCount = faces.length;

      // Classify faces: top (maxZ), bottom (minZ), and 4 sides
      const boxBbox = bbox(boxShape);
      chain.boxBbox = boxBbox;
      const topZ    = boxBbox.maxZ;
      const bottomZ = boxBbox.minZ;

      const sideFaces = [];
      let bottomFace  = null;
      for (const f of faces) {
        const fb = bbox(f);
        const fMinZ = fb.minZ;
        const fMaxZ = fb.maxZ;
        // Bottom: entirely at z=0 (minZ ≈ 0 and maxZ ≈ 0)
        if (Math.abs(fMaxZ - bottomZ) < 0.1 && Math.abs(fMinZ - bottomZ) < 0.1) {
          bottomFace = f;
        }
        // Top: entirely at z=20
        else if (Math.abs(fMinZ - topZ) < 0.1 && Math.abs(fMaxZ - topZ) < 0.1) {
          // skip top face
        }
        // Side faces: span from z=0 to z=20
        else if (fMinZ < 0.5 && fMaxZ > topZ - 0.5) {
          sideFaces.push(f);
        }
      }
      chain.sideFaceCount = sideFaces.length;
      chain.bottomFaceFound = !!bottomFace;

      // Build pull direction +Z: gp_Dir_4(0, 0, 1)
      const pullDir = new oc.gp_Dir_4(0, 0, 1);

      // Build neutral plane = z=0 plane
      // gp_Pln from gp_Ax3: need to find working constructor
      // gp_Pln_3 = (point, direction) - the normal form
      // gp_Pln constructors: _1 no-arg, _2 gp_Ax3, _3 (gp_Pnt, gp_Dir)
      let neutralPlane = null;
      let plnCtor = null;
      const origin = new oc.gp_Pnt_3(0, 0, 0);
      const normalDir = new oc.gp_Dir_4(0, 0, 1);

      // Introspect available gp_Pln* constructors
      const ocKeysDraft = Object.getOwnPropertyNames(oc);
      const plnKeys = ocKeysDraft.filter(k => k.startsWith('gp_Pln'));
      chain.plnKeys = plnKeys;

      for (const cls of plnKeys.filter(k => k !== 'gp_Pln')) {
        try {
          // Try (gp_Pnt, gp_Dir) — point + normal
          neutralPlane = new oc[cls](origin, normalDir);
          plnCtor = cls + '(origin, normalDir)';
          break;
        } catch (_e) {
          // Try via gp_Ax3
          const ax3Keys = ocKeysDraft.filter(k => k.startsWith('gp_Ax3'));
          for (const ax3cls of ax3Keys.filter(k => k !== 'gp_Ax3')) {
            try {
              const xDir2 = new oc.gp_Dir_4(1, 0, 0);
              const ax3 = new oc[ax3cls](origin, normalDir, xDir2);
              try {
                neutralPlane = new oc[cls](ax3);
                plnCtor = cls + '(' + ax3cls + '(origin, Z, X))';
              } catch (_e2) {}
              ax3.delete(); xDir2.delete();
              if (neutralPlane) break;
            } catch (_e3) {}
          }
          if (neutralPlane) break;
        }
      }
      chain.plnCtor = plnCtor;

      // Try BRepOffsetAPI_DraftAngle
      let draftConfirmed = false;
      for (const suffix of ['_1', '', '_2', '_3']) {
        const cls = 'BRepOffsetAPI_DraftAngle' + suffix;
        if (!oc[cls]) continue;
        try {
          const draftObj = new oc[cls](boxShape);
          chain.draftCtor = cls + '(boxShape)';

          const methods = introspectMethods(draftObj);
          chain.draftMethods = methods.filter(m =>
            m === 'Add' || m.startsWith('Add') || m === 'Build' || m === 'Shape' || m.startsWith('IsDone')
          );

          if (neutralPlane && sideFaces.length > 0) {
            const angleRad = 5 * Math.PI / 180;
            let addSucceeded = 0;

            // Introspect Add methods
            const draftAllMethods = introspectMethods(draftObj);
            chain.draftAllAddMethods = draftAllMethods.filter(m => m.startsWith('Add') || m === 'Build' || m === 'Shape' || m === 'IsDone');

            for (const sideFace of sideFaces) {
              // From run 1: Add needs 5 args. Try: Add(face, dir, angle, plane, bool)
              // OCCT signature: Add(F: TopoDS_Face, D: gp_Dir, Angle: Real, NeutralPlane: gp_Pln, Flag: bool=true)
              for (const addM of ['Add', 'Add_1', 'Add_2']) {
                if (typeof draftObj[addM] !== 'function') continue;
                // Try 5 args first
                let succeeded = false;
                try {
                  draftObj[addM](sideFace, pullDir, angleRad, neutralPlane, true);
                  if (!chain.addCall) chain.addCall = addM + '(sideFace, pullDir, angleRad, neutralPlane, true)';
                  addSucceeded++;
                  succeeded = true;
                } catch (e) {
                  chain['addErr5_' + addM] = String(e).substring(0, 150);
                }
                if (!succeeded) {
                  try {
                    draftObj[addM](sideFace, pullDir, angleRad, neutralPlane);
                    if (!chain.addCall) chain.addCall = addM + '(sideFace, pullDir, angleRad, neutralPlane)';
                    addSucceeded++;
                    succeeded = true;
                  } catch (e) {
                    chain['addErr4_' + addM] = String(e).substring(0, 150);
                  }
                }
                if (succeeded) break;
              }
            }
            chain.addSucceeded = addSucceeded;

            if (addSucceeded > 0) {
              const { didBuild, buildError, done } = flexBuild(draftObj);
              chain.didBuild = didBuild;
              chain.buildError = buildError;
              chain.done = done;

              const shape = safeShape(draftObj);
              if (shape) {
                const vol = volume(shape);
                result.item4_draftAngle = {
                  confirmed: true,
                  chain,
                  volumeMM3: vol,
                  volumePositive: vol > 0,
                  volumeNot8000: Math.abs(vol - 8000) > 1,
                };
                shape.delete();
                draftConfirmed = true;
              } else {
                result.item4_draftAngle = { confirmed: false, chain, error: 'Shape() null after draft build' };
              }
            } else {
              result.item4_draftAngle = { confirmed: false, chain, error: 'No Add* method succeeded for any side face' };
            }
          } else {
            result.item4_draftAngle = {
              confirmed: false, chain,
              error: !neutralPlane ? 'gp_Pln construction failed' : 'No side faces found',
            };
          }

          draftObj.delete();
          if (draftConfirmed) break;
        } catch (e) {
          chain['draftCtorErr_' + suffix] = String(e).substring(0, 150);
        }
      }

      if (!draftConfirmed && !result.item4_draftAngle) {
        result.item4_draftAngle = { confirmed: false, chain, error: 'BRepOffsetAPI_DraftAngle not found' };
      }

      // Cleanup
      for (const f of faces) f.delete();
      if (neutralPlane) neutralPlane.delete();
      pullDir.delete(); origin.delete(); normalDir.delete();
      boxShape.delete();
    } catch (e) {
      result.item4_draftAngle = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 5 — Sweep along path (BRepOffsetAPI_MakePipe)
    //   Circular profile r=8, path length 60 along +Z
    //   Expected vol ≈ π·64·60 ≈ 12064
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};

      // Build circular profile wire at z=0, center=(0,0,0), radius=8, in XY plane
      // gp_Ax2 for the circle: origin + normal(Z) + x-axis direction
      // Introspect all gp_Ax2* constructors first
      const ocKeys2 = Object.getOwnPropertyNames(oc);
      const ax2Keys = ocKeys2.filter(k => k.startsWith('gp_Ax2'));
      chain.ax2Keys = ax2Keys;

      let circAx2 = null;
      let ax2Ctor = null;
      // Profile circle: at (0,0,0), in XY plane, axis = Z. Circle normal = Z = sweep direction.
      // Offset profile origin slightly off path start to avoid coincident geometry issues.
      const circOrigin = new oc.gp_Pnt_3(0, 0, 0);
      const circNormal = new oc.gp_Dir_4(0, 0, 1); // Z = sweep direction = circle normal
      const circXDir   = new oc.gp_Dir_4(1, 0, 0);

      // Try each available gp_Ax2* constructor variant
      for (const cls of ax2Keys) {
        if (cls === 'gp_Ax2') continue; // abstract
        try {
          // Try (pnt, normal, xDir) — 3 args
          circAx2 = new oc[cls](circOrigin, circNormal, circXDir);
          ax2Ctor = cls + '(origin, normalDir, xDir)';
          break;
        } catch (_e) {
          try {
            // Try (pnt, normal) — 2 args
            circAx2 = new oc[cls](circOrigin, circNormal);
            ax2Ctor = cls + '(origin, normalDir)';
            break;
          } catch (_e2) {}
        }
      }
      chain.ax2Ctor = ax2Ctor;

      // gp_Circ: find constructor that takes (gp_Ax2, radius)
      const circKeys = ocKeys2.filter(k => k.startsWith('gp_Circ_') || k === 'gp_Circ');
      chain.circKeys = circKeys.filter(k => k.startsWith('gp_Circ'));
      let circObj = null;
      let circCtor = null;
      if (circAx2) {
        for (const cls of circKeys.filter(k => k !== 'gp_Circ')) {
          try {
            circObj = new oc[cls](circAx2, 8);
            circCtor = cls + '(ax2, 8)';
            break;
          } catch (_e) {}
        }
      }
      chain.circCtor = circCtor;

      // Make edge from circle — introspect all MakeEdge_* that take a single circle arg
      let circEdge = null;
      let circEdgeCtor = null;
      if (circObj) {
        const makeEdgeKeys = ocKeys2.filter(k => k.startsWith('BRepBuilderAPI_MakeEdge_'));
        chain.makeEdgeKeys = makeEdgeKeys;

        for (const cls of makeEdgeKeys) {
          try {
            const em = new oc[cls](circObj);
            const e = em.Edge();
            if (e) {
              circEdge = e;
              circEdgeCtor = cls + '(gp_Circ)';
              em.delete();
              break;
            }
            em.delete();
          } catch (_e) {}
        }
      }
      chain.circEdgeCtor = circEdgeCtor;

      // Build profile wire from circle edge
      let profileWire = null;
      if (circEdge) {
        const wm = new oc.BRepBuilderAPI_MakeWire_1();
        wm.Add_1(circEdge);
        profileWire = wm.Wire();
        wm.delete();
        chain.profileWireBuilt = true;
      }

      // Build profile FACE (disk) from circle wire — needed for solid sweep
      // BRepBuilderAPI_MakeFace_15(wire, isPlanar) — A1 verified
      let profileFace = null;
      if (profileWire) {
        try {
          const pfm = new oc.BRepBuilderAPI_MakeFace_15(profileWire, true);
          profileFace = pfm.Face();
          pfm.delete();
          chain.profileFaceBuilt = true;
        } catch (e) {
          chain.profileFaceErr = String(e).substring(0, 200);
        }
      }

      // Build path wire: straight line from (0,0,0) to (0,0,60)
      const pathP0 = new oc.gp_Pnt_3(0, 0, 0);
      const pathP1 = new oc.gp_Pnt_3(0, 0, 60);
      const pathEM = new oc.BRepBuilderAPI_MakeEdge_3(pathP0, pathP1);
      const pathEdge = pathEM.Edge(); pathEM.delete();
      const pathWM = new oc.BRepBuilderAPI_MakeWire_1();
      pathWM.Add_1(pathEdge);
      const pathWire = pathWM.Wire(); pathWM.delete();
      chain.pathWireBuilt = true;

      // BRepOffsetAPI_MakePipe
      // NOTE: MakePipe(spine, profile) — profile must be a FACE (disk) for a solid result.
      //       A WIRE profile creates a hollow tube shell.
      //       Expected vol for face (disk r=8) swept 60mm: π·64·60 ≈ 12064
      let pipeConfirmed = false;
      for (const suffix of ['_1', '_2', '', '_3']) {
        const cls = 'BRepOffsetAPI_MakePipe' + suffix;
        if (!oc[cls]) continue;

        // Try profile as FACE first (gives solid), then WIRE (gives hollow tube)
        const profilesToTry = [];
        if (profileFace) profilesToTry.push({ shape: profileFace, type: 'face' });
        if (profileWire) profilesToTry.push({ shape: profileWire, type: 'wire' });
        if (profilesToTry.length === 0) continue;

        for (const { shape: prof, type: profType } of profilesToTry) {
          try {
            let pipeObj = null;
            let pipeCtor = null;
            try {
              pipeObj = new oc[cls](pathWire, prof);
              pipeCtor = cls + '(pathWire, profile' + profType + ')';
            } catch (e) {
              chain['pipeCtorErr_' + suffix + '_' + profType] = String(e).substring(0, 150);
              try {
                const transMode = oc.BRepBuilderAPI_TransitionMode
                  ? oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_Transformed || 0
                  : 0;
                pipeObj = new oc[cls](pathWire, prof, transMode, false);
                pipeCtor = cls + '(pathWire, profile' + profType + ', transMode, false)';
              } catch (e2) {
                chain['pipeCtorErr2_' + suffix + '_' + profType] = String(e2).substring(0, 150);
              }
            }

            if (pipeObj) {
              chain.pipeCtor = pipeCtor;
              chain.profileType = profType;
              const shape = safeShape(pipeObj);
              if (shape) {
                const vol = volume(shape);
                const expectedVol = Math.PI * 64 * 60; // π·r²·h for solid
                const absVol = Math.abs(vol);
                result.item5_sweep = {
                  confirmed: true,
                  chain,
                  volumeMM3: vol,
                  expected: expectedVol,
                  withinTol: Math.abs(absVol - expectedVol) < 200,
                };
                shape.delete();
                pipeConfirmed = true;
              } else {
                result.item5_sweep = { confirmed: false, chain, error: 'Shape() null from MakePipe with ' + profType };
              }
              pipeObj.delete();
              if (pipeConfirmed) break;
            }
          } catch (e) {
            chain['pipeOuterErr_' + suffix + '_' + profType] = String(e).substring(0, 150);
          }
        }
        if (pipeConfirmed) break;
      }

      if (!pipeConfirmed && !result.item5_sweep) {
        result.item5_sweep = {
          confirmed: false, chain,
          error: (profileWire || profileFace) ? 'BRepOffsetAPI_MakePipe all constructors failed' : 'Profile construction failed',
        };
      }

      // Cleanup
      if (circAx2) circAx2.delete();
      if (circObj) circObj.delete();
      if (circEdge) circEdge.delete();
      if (profileFace) profileFace.delete();
      if (profileWire) profileWire.delete();
      circOrigin.delete(); circNormal.delete(); circXDir.delete();
      pathEdge.delete(); pathWire.delete(); pathP0.delete(); pathP1.delete();
    } catch (e) {
      result.item5_sweep = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 6 — Loft through sections (BRepOffsetAPI_ThruSections)
    //   Two 20×20 square wires: one at z=0, one at z=30
    //   Expected vol ≈ 20·20·30 = 12000
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};

      /**
       * Build a closed square wire of given side length at given z.
       */
      function makeSquareWire(side, z) {
        const p0 = new oc.gp_Pnt_3(0,    0,    z);
        const p1 = new oc.gp_Pnt_3(side, 0,    z);
        const p2 = new oc.gp_Pnt_3(side, side, z);
        const p3 = new oc.gp_Pnt_3(0,    side, z);

        const em01 = new oc.BRepBuilderAPI_MakeEdge_3(p0, p1); const e01 = em01.Edge(); em01.delete();
        const em12 = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2); const e12 = em12.Edge(); em12.delete();
        const em23 = new oc.BRepBuilderAPI_MakeEdge_3(p2, p3); const e23 = em23.Edge(); em23.delete();
        const em30 = new oc.BRepBuilderAPI_MakeEdge_3(p3, p0); const e30 = em30.Edge(); em30.delete();

        const wm = new oc.BRepBuilderAPI_MakeWire_1();
        wm.Add_1(e01); wm.Add_1(e12); wm.Add_1(e23); wm.Add_1(e30);
        const w = wm.Wire(); wm.delete();

        // Cleanup edges and points
        e01.delete(); e12.delete(); e23.delete(); e30.delete();
        p0.delete(); p1.delete(); p2.delete(); p3.delete();
        return w;
      }

      const wire0 = makeSquareWire(20, 0);
      const wire1 = makeSquareWire(20, 30);
      chain.wiresBuilt = true;

      // BRepOffsetAPI_ThruSections
      let loftConfirmed = false;
      for (const suffix of ['_1', '_2', '', '_3']) {
        const cls = 'BRepOffsetAPI_ThruSections' + suffix;
        if (!oc[cls]) continue;
        try {
          // Constructor: ThruSections(isSolid, isRuled, pres3d)
          let loftObj = null;
          let loftCtor = null;
          for (const args of [
            [true, false, 1.0e-6],
            [true, false],
            [true],
            [],
          ]) {
            try {
              loftObj = new oc[cls](...args);
              loftCtor = cls + '(' + args.join(', ') + ')';
              break;
            } catch (e) {
              chain['loftCtorErr_' + suffix + '_' + args.length] = String(e).substring(0, 100);
            }
          }

          if (!loftObj) continue;
          chain.loftCtor = loftCtor;

          // Introspect AddWire method
          const methods = introspectMethods(loftObj);
          chain.loftMethods = methods.filter(m =>
            m.startsWith('Add') || m === 'Build' || m === 'Shape' || m.startsWith('IsDone')
          );

          // AddWire
          let addWireMethod = null;
          for (const m of ['AddWire', 'AddWire_1', 'AddWire_2']) {
            if (typeof loftObj[m] === 'function') {
              try {
                loftObj[m](wire0);
                loftObj[m](wire1);
                addWireMethod = m;
                break;
              } catch (e) {
                chain['addWireErr_' + m] = String(e).substring(0, 100);
              }
            }
          }
          chain.addWireMethod = addWireMethod;

          if (addWireMethod) {
            const { didBuild, buildError, done } = flexBuild(loftObj);
            chain.didBuild = didBuild;
            chain.buildError = buildError;
            chain.done = done;

            const shape = safeShape(loftObj);
            if (shape) {
              const vol = volume(shape);
              result.item6_loft = {
                confirmed: true,
                chain,
                volumeMM3: vol,
                expected: 12000,
                withinTol: Math.abs(vol - 12000) < 100,
              };
              shape.delete();
              loftConfirmed = true;
            } else {
              result.item6_loft = { confirmed: false, chain, error: 'Shape() null after ThruSections build' };
            }
          } else {
            result.item6_loft = { confirmed: false, chain, error: 'AddWire* method not found/failed' };
          }

          loftObj.delete();
          if (loftConfirmed) break;
        } catch (e) {
          chain['loftOuterErr_' + suffix] = String(e).substring(0, 100);
        }
      }

      if (!loftConfirmed && !result.item6_loft) {
        result.item6_loft = { confirmed: false, chain, error: 'BRepOffsetAPI_ThruSections all suffixes failed' };
      }

      wire0.delete(); wire1.delete();
    } catch (e) {
      result.item6_loft = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 7 — Variable-radius fillet (BRepFilletAPI_MakeFillet variable Add)
    //   Fillet ONE edge of a 20mm box, varying 1mm → 4mm.
    //   Expected vol < 8000.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};
      const boxShape = makeBoxShape(20, 20, 20);

      // Constructor: BRepFilletAPI_MakeFillet (undecorated) — A1 verified
      const filletShapeEnum = oc.ChFi3d_FilletShape
        ? oc.ChFi3d_FilletShape.ChFi3d_Rational
        : 0;
      const filletObj = new oc.BRepFilletAPI_MakeFillet(boxShape, filletShapeEnum);
      chain.ctor = 'BRepFilletAPI_MakeFillet(shape, ChFi3d_FilletShape.ChFi3d_Rational)';

      // Introspect all Add* methods
      const methods = introspectMethods(filletObj);
      chain.allAddMethods = methods.filter(m => m.startsWith('Add'));

      // Get one edge
      const edges = collectEdges(boxShape);
      chain.edgeCount = edges.length;
      const oneEdge = edges[0];

      // Try variable-radius Add overloads: (r1, r2, edge)
      // A1 verified: .Add_2(r, edge) = constant radius (Standard_Real, TopoDS_Edge)
      // Variable = (r1, r2, edge) → different suffix
      let varAddMethod = null;
      let varAddArgs   = null;

      for (const m of methods.filter(m => m.startsWith('Add_') || m === 'Add')) {
        if (m === 'Add_2') continue; // skip known constant-radius overload
        if (typeof filletObj[m] !== 'function') continue;
        try {
          filletObj[m](1.0, 4.0, oneEdge);
          varAddMethod = m;
          varAddArgs   = '(1.0, 4.0, oneEdge)';
          break;
        } catch (e) {
          chain['varAddErr_' + m] = String(e).substring(0, 150);
        }
      }

      chain.varAddMethod = varAddMethod;
      chain.varAddArgs   = varAddArgs;

      // If variable Add not found, fall back to constant as a diagnostic
      if (!varAddMethod) {
        // Also try the bare 'Add' name
        if (typeof filletObj['Add'] === 'function') {
          try {
            filletObj['Add'](1.0, 4.0, oneEdge);
            varAddMethod = 'Add';
            varAddArgs   = '(1.0, 4.0, oneEdge)';
            chain.varAddMethod = varAddMethod;
          } catch (e) {
            chain['varAddErr_bare'] = String(e).substring(0, 150);
            // try 2-arg to confirm method exists at all
            try {
              filletObj['Add'](1.0, oneEdge);
              chain.fallback2ArgAdd = 'Add(1.0, edge) worked on undecorated Add';
            } catch (e2) {
              chain['fallback2ArgAddErr'] = String(e2).substring(0, 100);
            }
          }
        }
      }

      // Build
      const { didBuild, buildError, done } = boolBuild(filletObj);
      chain.didBuild = didBuild;
      chain.buildError = buildError;
      chain.done = done;

      if (done) {
        const shape = safeShape(filletObj);
        if (shape) {
          const vol = volume(shape);
          result.item7_varFillet = {
            confirmed: !!varAddMethod,
            varAddMethod,
            varAddArgs,
            chain,
            volumeMM3: vol,
            volumeBelow8000: vol < 8000,
            note: varAddMethod
              ? 'Variable-radius Add confirmed'
              : 'NOT CONFIRMED — no (r1,r2,edge) overload found; volume measured using constant fallback if any',
          };
          shape.delete();
        } else {
          result.item7_varFillet = { confirmed: false, chain, error: 'Shape() null' };
        }
      } else {
        // IsDone=false may mean no edges were added; if varAdd was not found, confirm as NOT CONFIRMED
        result.item7_varFillet = {
          confirmed: false,
          varAddMethod,
          chain,
          error: buildError || 'IsDone=false',
          note: varAddMethod ? 'Add succeeded but Build failed' : 'No variable Add overload found',
        };
      }

      // Cleanup
      for (const e of edges) e.delete();
      filletObj.delete();
      boxShape.delete();
    } catch (e) {
      result.item7_varFillet = { confirmed: false, error: String(e) };
    }

    return result;
  });

  // ── Write JSON output ────────────────────────────────────────────────────────
  const notesDir = path.join(__dirname, '..', 'docs', 'superpowers', 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
  const jsonPath = path.join(notesDir, 'occt-api-A2-recon.json');
  fs.writeFileSync(jsonPath, JSON.stringify(verified, null, 2));
  console.log('A2 RECON RESULT:', JSON.stringify(verified, null, 2));

  // ── Assertions ───────────────────────────────────────────────────────────────

  // Item 1: Shell
  expect(verified.item1_shell.confirmed,
    `shell: ${verified.item1_shell.error || JSON.stringify(verified.item1_shell)}`).toBe(true);
  expect(verified.item1_shell.volumeInRange,
    `shell vol=${verified.item1_shell.volumeMM3} must be in (0, 8000)`).toBe(true);

  // Item 2: Thicken sheet
  expect(verified.item2_thickenSheet.confirmed,
    `thicken sheet: ${verified.item2_thickenSheet.error || JSON.stringify(verified.item2_thickenSheet)}`).toBe(true);
  expect(verified.item2_thickenSheet.withinTol,
    `thicken vol=${verified.item2_thickenSheet.volumeMM3} expected~7200`).toBe(true);

  // Item 3: Offset shape
  expect(verified.item3_offsetShape.confirmed,
    `offset shape: ${verified.item3_offsetShape.error || JSON.stringify(verified.item3_offsetShape)}`).toBe(true);
  expect(verified.item3_offsetShape.volumeAbove8000,
    `offset shape vol=${verified.item3_offsetShape.volumeMM3} must be > 8000`).toBe(true);

  // Item 4: Draft angle
  expect(verified.item4_draftAngle.confirmed,
    `draft angle: ${verified.item4_draftAngle.error || JSON.stringify(verified.item4_draftAngle)}`).toBe(true);
  expect(verified.item4_draftAngle.volumePositive,
    `draft angle vol=${verified.item4_draftAngle.volumeMM3} must be > 0`).toBe(true);
  expect(verified.item4_draftAngle.volumeNot8000,
    `draft angle vol=${verified.item4_draftAngle.volumeMM3} must differ from 8000`).toBe(true);

  // Item 5: Sweep
  expect(verified.item5_sweep.confirmed,
    `sweep: ${verified.item5_sweep.error || JSON.stringify(verified.item5_sweep)}`).toBe(true);
  expect(verified.item5_sweep.withinTol,
    `sweep vol=${verified.item5_sweep.volumeMM3} expected~${Math.PI * 64 * 60}`).toBe(true);

  // Item 6: Loft
  expect(verified.item6_loft.confirmed,
    `loft: ${verified.item6_loft.error || JSON.stringify(verified.item6_loft)}`).toBe(true);
  expect(verified.item6_loft.withinTol,
    `loft vol=${verified.item6_loft.volumeMM3} expected~12000`).toBe(true);

  // Item 7: Variable fillet — confirmed only if varAddMethod was found
  expect(verified.item7_varFillet.confirmed,
    `var fillet: ${verified.item7_varFillet.error || JSON.stringify(verified.item7_varFillet)}`).toBe(true);
  expect(verified.item7_varFillet.volumeBelow8000,
    `var fillet vol=${verified.item7_varFillet.volumeMM3} must be < 8000`).toBe(true);

  expect(pageErrors).toEqual([]);
  await app.close();
});
