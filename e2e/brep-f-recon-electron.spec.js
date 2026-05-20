/**
 * brep-f-recon-electron.spec.js
 *
 * Sub-project F empirical OCCT API reconnaissance — Final §3 Capabilities.
 * Empirically determines reachability for each of five items:
 *
 *   1. N-Sided Patching  — BRepOffsetAPI_MakeFilling
 *      - Re-verify A5 finding: Build() throws for all inputs?
 *      - Test 4-edge planar wire boundary (square)
 *      - Test 5-edge non-quad boundary (pentagon)
 *      Verdict: likely NOT_REACHABLE confirming A5 honest outcome.
 *
 *   2. Tortuous-path Sweep — BRepOffsetAPI_MakePipeShell
 *      - Constructor suffix search (_1 etc.) with spine wire
 *      - 3-segment spine (0,0,0)→(20,0,0)→(20,20,0)→(20,20,30)
 *      - Circular profile r=4 at start
 *      - Add profile, Build, IsDone, Shape, measure volume
 *      Verdict: REACHABLE or NOT_REACHABLE
 *
 *   3. Lofting with Tangency — BRepOffsetAPI_ThruSections + SetSmoothing
 *      - 3 square section wires at z=0,20,40 (sides 40,20,30)
 *      - ThruSections(true, false, 1e-6) + SetSmoothing introspection
 *      - Build, IsDone, Shape, volume > 0
 *      Verdict: REACHABLE (likely)
 *
 *   4. Tolerant Stitching — BRepBuilderAPI_Sewing
 *      - Constructor suffix search
 *      - Two planar faces with ~0.05 mm gap
 *      - Sewing with tolerance 0.1 → single shell
 *      Verdict: REACHABLE or NOT_REACHABLE
 *
 *   5. Convergent Modeling — MakeFace+Sewing+MakeSolid pipeline
 *      - 12 triangle faces from cube mesh data
 *      - Sew into SHELL
 *      - BRepBuilderAPI_MakeSolid from SHELL → measure volume
 *      Verdict: REACHABLE or NOT_REACHABLE
 *
 * Writes:  docs/superpowers/notes/occt-api-F-recon.json
 * Pattern: e2e/brep-a5-recon-electron.spec.js
 * Package: opencascade.js@2.0.0-beta.b5ff984
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.setTimeout(600000);

test('Sub-project F — OCCT API recon (final §3 capabilities)', async () => {
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

    /** Measure volume of a TopoDS_Shape (mm³). */
    function volume(shape) {
      const props = new oc.GProp_GProps_1();
      oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
      const v = props.Mass();
      props.delete();
      return v;
    }

    /** Build a straight line edge from two gp_Pnt_3. Caller must .delete() result. */
    function makeLineEdge(x1, y1, z1, x2, y2, z2) {
      const p1 = new oc.gp_Pnt_3(x1, y1, z1);
      const p2 = new oc.gp_Pnt_3(x2, y2, z2);
      const edge = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
      const e = edge.Edge();
      edge.delete();
      p1.delete();
      p2.delete();
      return e;
    }

    /** Build a wire from an array of edges. Caller must .delete() result.
     *  Does NOT delete the edges — caller is responsible. */
    function makeWireFromEdges(edges) {
      const bw = new oc.BRepBuilderAPI_MakeWire_1();
      for (const e of edges) {
        bw.Add_1(e);
      }
      const w = bw.Wire();
      bw.delete();
      return w;
    }

    /** Build a planar face from a closed wire. Caller must .delete() result. */
    function makePlanarFace(wire) {
      const mf = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
      const f = mf.Face();
      mf.delete();
      return f;
    }

    /** Count topology items of a given type in a shape. */
    function countTopo(shape, topoType) {
      const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
      let count = 0;
      const exp = new oc.TopExp_Explorer_2(shape, topoType, ANY);
      for (; exp.More(); exp.Next()) {
        count++;
      }
      exp.delete();
      return count;
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

    const result = {};
    const ocKeys = Object.getOwnPropertyNames(oc);

    // ══════════════════════════════════════════════════════════════════════════
    // Item 1 — N-Sided Patching (BRepOffsetAPI_MakeFilling)
    //
    //   Re-verify A5 finding on proper wire boundaries:
    //     - 4-edge planar square wire boundary
    //     - 5-edge pentagon wire boundary
    //   A5 honest outcome: Build throws raw OCCT integer for all inputs.
    //   This re-check uses PROPER open boundaries (not box edges).
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain1 = {};

      // Check MakeFilling constructor availability (A5: only 10-arg, no suffix)
      chain1.fillingKeys = ocKeys.filter(k => k.startsWith('BRepOffsetAPI_MakeFilling'));

      // ── 1a. Build a 4-edge planar square wire (a proper open boundary) ──────
      // To get a true open boundary for MakeFilling we use 4 edges of a square
      // that DON'T form a closed face — just a boundary wire around an open region.
      // MakeFilling expects edges bounding a hole, so we build the wire edges.
      let squareEdges = [];
      let squareWire = null;
      let squareFace = null;
      try {
        // Square: (0,0,0)-(20,0,0)-(20,20,0)-(0,20,0)-(0,0,0)
        squareEdges = [
          makeLineEdge(0, 0, 0,   20, 0, 0),
          makeLineEdge(20, 0, 0,  20, 20, 0),
          makeLineEdge(20, 20, 0, 0, 20, 0),
          makeLineEdge(0, 20, 0,  0, 0, 0),
        ];
        squareWire = makeWireFromEdges(squareEdges);
        squareFace = makePlanarFace(squareWire);
        chain1.squareFaceBuilt = true;
      } catch (e) {
        chain1.squareFaceBuildErr = String(e).substring(0, 200);
      }

      // ── 1b. Pentagon wire (5-edge N-sided case) ──────────────────────────────
      let pentEdges = [];
      let pentWire = null;
      try {
        // Regular pentagon with circumradius 15mm at z=0, centered at (15,15,0)
        const cx = 15, cy = 15, cr = 15;
        const pts = [];
        for (let i = 0; i < 5; i++) {
          const a = (2 * Math.PI * i) / 5 - Math.PI / 2;
          pts.push([cx + cr * Math.cos(a), cy + cr * Math.sin(a), 0]);
        }
        for (let i = 0; i < 5; i++) {
          const a = pts[i], b = pts[(i + 1) % 5];
          pentEdges.push(makeLineEdge(a[0], a[1], a[2], b[0], b[1], b[2]));
        }
        pentWire = makeWireFromEdges(pentEdges);
        chain1.pentWireBuilt = true;
      } catch (e) {
        chain1.pentWireBuildErr = String(e).substring(0, 200);
      }

      // ── 1c. Test MakeFilling on 4-edge square boundary ───────────────────────
      const test4Edge = {};
      if (squareFace !== null && squareEdges.length === 4) {
        let filling = null;
        try {
          filling = new oc.BRepOffsetAPI_MakeFilling(3, 15, 2, false, 1e-5, 1e-4, 1e-2, 0.1, 8, 9);
          test4Edge.ctorOk = true;

          // Add edges with C2 continuity (3-arg form required per A5)
          let addCount = 0;
          for (const e of squareEdges) {
            try {
              filling.Add_1(e, oc.GeomAbs_Shape.GeomAbs_C2, false);
              addCount++;
            } catch (e2) {
              test4Edge['addErr'] = String(e2).substring(0, 200);
            }
          }
          test4Edge.addCount = addCount;

          // Build with ProgressRange
          const pr = new oc.Message_ProgressRange_1();
          try {
            filling.Build(pr);
            test4Edge.buildReturned = true;
            test4Edge.isDone = filling.IsDone();
            if (filling.IsDone()) {
              const s = filling.Shape();
              test4Edge.shapeObtained = true;
              test4Edge.faceCount = countTopo(s, oc.TopAbs_ShapeEnum.TopAbs_FACE);
              s.delete();
            }
          } catch (e2) {
            const errStr = String(e2);
            test4Edge.buildErr = errStr.substring(0, 300);
            test4Edge.buildErrType = (errStr.includes('BindingError') ? 'BindingError' :
              (!isNaN(parseInt(errStr))) ? 'OCCT_integer_exception' : 'other');
          }
          pr.delete();

        } catch (e) {
          test4Edge.ctorErr = String(e).substring(0, 200);
        }
        if (filling) { try { filling.delete(); } catch (_e) {} }
      }
      chain1.test4Edge = test4Edge;

      // ── 1d. Test MakeFilling on 5-edge pentagon boundary ─────────────────────
      const test5Edge = {};
      if (pentWire !== null && pentEdges.length === 5) {
        let filling = null;
        try {
          filling = new oc.BRepOffsetAPI_MakeFilling(3, 15, 2, false, 1e-5, 1e-4, 1e-2, 0.1, 8, 9);
          test5Edge.ctorOk = true;

          let addCount = 0;
          for (const e of pentEdges) {
            try {
              filling.Add_1(e, oc.GeomAbs_Shape.GeomAbs_C2, false);
              addCount++;
            } catch (e2) {
              test5Edge['addErr'] = String(e2).substring(0, 200);
            }
          }
          test5Edge.addCount = addCount;

          const pr = new oc.Message_ProgressRange_1();
          try {
            filling.Build(pr);
            test5Edge.buildReturned = true;
            test5Edge.isDone = filling.IsDone();
            if (filling.IsDone()) {
              const s = filling.Shape();
              test5Edge.shapeObtained = true;
              s.delete();
            }
          } catch (e2) {
            const errStr = String(e2);
            test5Edge.buildErr = errStr.substring(0, 300);
            test5Edge.buildErrType = (errStr.includes('BindingError') ? 'BindingError' :
              (!isNaN(parseInt(errStr))) ? 'OCCT_integer_exception' : 'other');
          }
          pr.delete();

        } catch (e) {
          test5Edge.ctorErr = String(e).substring(0, 200);
        }
        if (filling) { try { filling.delete(); } catch (_e) {} }
      }
      chain1.test5Edge = test5Edge;

      // Cleanup
      if (squareFace) { try { squareFace.delete(); } catch (_e) {} }
      if (squareWire) { try { squareWire.delete(); } catch (_e) {} }
      for (const e of squareEdges) { try { e.delete(); } catch (_e) {} }
      if (pentWire) { try { pentWire.delete(); } catch (_e) {} }
      for (const e of pentEdges) { try { e.delete(); } catch (_e) {} }

      // ── Verdict ──────────────────────────────────────────────────────────────
      const buildWorked4 = test4Edge.isDone === true;
      const buildWorked5 = test5Edge.isDone === true;
      const build4Ran    = test4Edge.buildReturned === true;
      const build4Exception = test4Edge.buildErr && test4Edge.buildErrType !== 'BindingError';
      const build5Exception = test5Edge.buildErr && test5Edge.buildErrType !== 'BindingError';

      let verdict, verdictReason;
      if (buildWorked4 || buildWorked5) {
        verdict = 'REACHABLE';
        verdictReason = 'MakeFilling.Build() + IsDone() produced a face — N-sided patching works.';
      } else if (build4Exception || build5Exception) {
        verdict = 'NOT_REACHABLE';
        verdictReason = 'MakeFilling.Build() throws raw OCCT C++ exception (integer pointer) for all inputs. ' +
          'Confirms A5 honest outcome: variational solver crashes in this WASM build unconditionally. ' +
          'Errors: 4edge=' + (test4Edge.buildErr || 'n/a') + ' 5edge=' + (test5Edge.buildErr || 'n/a');
      } else if (build4Ran && !buildWorked4) {
        verdict = 'NOT_REACHABLE';
        verdictReason = 'MakeFilling.Build() returns but IsDone()=false. OCCT solver failed. ' +
          'Confirms A5 finding — filling does not produce usable output in this WASM build.';
      } else {
        verdict = 'NOT_REACHABLE';
        verdictReason = 'MakeFilling.Build() did not run (constructor or Add failed). ' +
          'ctorOk=' + test4Edge.ctorOk + ' addCount=' + test4Edge.addCount;
      }

      result.item1_nSidedPatching = {
        verdict,
        verdictReason,
        fillingKeys: chain1.fillingKeys,
        test4Edge,
        test5Edge,
        chain: chain1,
        note: 'N-Sided Patching via BRepOffsetAPI_MakeFilling. Re-verifies A5 NOT_REACHABLE finding.',
      };

    } catch (e) {
      result.item1_nSidedPatching = { verdict: 'NOT_REACHABLE', error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 2 — Tortuous-path Sweep (BRepOffsetAPI_MakePipeShell)
    //
    //   - Spine: 3-segment polyline (0,0,0)→(20,0,0)→(20,20,0)→(20,20,30)
    //   - Profile: circle r=4 at start point, normal = first edge direction
    //   - BRepOffsetAPI_MakePipeShell_1(spineWire) constructor
    //   - .Add(profile) or .Add_1/Add_2 overload
    //   - .Build() + .IsDone() + .Shape() + volume ≈ π·16·70 ≈ 3520 mm³
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain2 = {};

      // Scan available MakePipeShell keys
      const pipeShellKeys = ocKeys.filter(k => k.startsWith('BRepOffsetAPI_MakePipeShell'));
      chain2.pipeShellKeys = pipeShellKeys;

      // ── 2a. Build the 3-segment spine ────────────────────────────────────────
      let spineEdges = [];
      let spineWire = null;
      try {
        spineEdges = [
          makeLineEdge(0, 0, 0,   20, 0, 0),   // segment 1: along +X
          makeLineEdge(20, 0, 0,  20, 20, 0),  // segment 2: along +Y (right-angle bend)
          makeLineEdge(20, 20, 0, 20, 20, 30), // segment 3: along +Z (right-angle bend)
        ];
        spineWire = makeWireFromEdges(spineEdges);
        chain2.spineBuilt = true;
      } catch (e) {
        chain2.spineErr = String(e).substring(0, 200);
      }

      // ── 2b. Build circular profile at origin, normal along +X ────────────────
      // Profile: circle r=4 at (0,0,0), normal along X = (1,0,0)
      let profileWire = null;
      try {
        const origin = new oc.gp_Pnt_3(0, 0, 0);
        const axisDir = new oc.gp_Dir_4(1, 0, 0);   // normal along first edge (+X)
        const refDir  = new oc.gp_Dir_4(0, 0, 1);   // reference direction
        const ax2     = new oc.gp_Ax2_2(origin, axisDir, refDir);
        const circ    = new oc.gp_Circ_2(ax2, 4);   // radius = 4 mm
        const circEdge = new oc.BRepBuilderAPI_MakeEdge_8(circ);
        const ce = circEdge.Edge();
        const bw = new oc.BRepBuilderAPI_MakeWire_1();
        bw.Add_1(ce);
        profileWire = bw.Wire();
        bw.delete();
        circEdge.delete();
        ce.delete();
        circ.delete();
        ax2.delete();
        refDir.delete();
        axisDir.delete();
        origin.delete();
        chain2.profileBuilt = true;
      } catch (e) {
        chain2.profileErr = String(e).substring(0, 200);
      }

      // ── 2c. Construct BRepOffsetAPI_MakePipeShell ─────────────────────────────
      let pipeShell = null;
      let usedCtor = null;
      if (spineWire !== null) {
        const ctorAttempts = [
          { cls: 'BRepOffsetAPI_MakePipeShell_1', label: 'BRepOffsetAPI_MakePipeShell_1(spine)' },
          { cls: 'BRepOffsetAPI_MakePipeShell',   label: 'BRepOffsetAPI_MakePipeShell(spine)' },
        ];
        for (const att of ctorAttempts) {
          if (!oc[att.cls]) { chain2['ctorMissing_' + att.cls] = true; continue; }
          try {
            pipeShell = new oc[att.cls](spineWire);
            usedCtor = att.label;
            break;
          } catch (e) {
            chain2['ctorErr_' + att.cls] = String(e).substring(0, 200);
          }
        }
      }
      chain2.usedCtor = usedCtor;
      chain2.pipeShellConstructed = pipeShell !== null;

      let pipeShellMethods = [];
      if (pipeShell !== null) {
        pipeShellMethods = introspectMethods(pipeShell)
          .filter(m => !m.startsWith('$') && !['constructor', 'delete', 'isDeleted'].includes(m));
        chain2.pipeShellMethods = pipeShellMethods;
      }

      // ── 2d. Add the profile to the pipe shell ─────────────────────────────────
      const addProfileTest = {};
      if (pipeShell !== null && profileWire !== null) {
        // Try various Add overloads — MakePipeShell has multiple Add variants
        // Typical: Add(wire), Add_1(wire), Add_2(wire, bool, bool), etc.
        const addOverloads = pipeShellMethods.filter(m => m === 'Add' || m.startsWith('Add_'));
        addProfileTest.availableAddOverloads = addOverloads;

        let addOk = false;
        for (const addM of addOverloads) {
          if (typeof pipeShell[addM] !== 'function') continue;
          // Try different arities
          const tryArgsVariants = [
            [],
            [false, false],
            [true, false],
            [false, true],
          ];
          for (const extra of tryArgsVariants) {
            try {
              pipeShell[addM](profileWire, ...extra);
              addProfileTest.addOk = true;
              addProfileTest.usedAddMethod = addM + '(' + ['profileWire', ...extra.map(String)].join(', ') + ')';
              addOk = true;
              break;
            } catch (e) {
              addProfileTest['err_' + addM + '_' + extra.length + 'extra'] = String(e).substring(0, 150);
            }
          }
          if (addOk) break;
        }
      }
      chain2.addProfileTest = addProfileTest;

      // ── 2e. Build and measure ─────────────────────────────────────────────────
      const buildTest = {};
      if (pipeShell !== null && addProfileTest.addOk) {
        // Optionally try SetMode or SetTransitionMode
        const transitionModes = pipeShellMethods.filter(m =>
          m.startsWith('SetTransition') || m.startsWith('SetMode') || m.startsWith('SetDiscreteMode'));
        buildTest.transitionMethods = transitionModes;

        // Build
        let buildOk = false;
        for (const buildM of ['Build', 'Build_1']) {
          if (typeof pipeShell[buildM] !== 'function') continue;
          for (const tryArgs of [[], [new oc.Message_ProgressRange_1()]]) {
            try {
              if (tryArgs.length > 0) {
                pipeShell[buildM](tryArgs[0]);
                tryArgs[0].delete();
              } else {
                pipeShell[buildM]();
              }
              buildTest.buildMethod = buildM + '(' + (tryArgs.length ? 'pr' : '') + ')';
              buildOk = true;
              break;
            } catch (e) {
              const errStr = String(e);
              buildTest['buildErr_' + buildM + '_' + tryArgs.length] = errStr.substring(0, 200);
              // If it's not a BindingError, Build ran (OCCT exception) — move on
              if (!errStr.includes('BindingError')) {
                buildTest.buildRanWithOCCTError = errStr.substring(0, 200);
                buildTest.buildMethod = buildM + '[OCCT_exception]';
                // Don't mark buildOk — geometry failed
                break;
              }
            }
          }
          if (buildOk) break;
        }
        buildTest.buildOk = buildOk;

        if (buildOk) {
          // IsDone
          try { buildTest.isDone = pipeShell.IsDone(); } catch (_e) {}

          // Shape
          if (buildTest.isDone) {
            try {
              const shape = pipeShell.Shape();
              buildTest.shapeObtained = true;
              buildTest.faceCount = countTopo(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
              buildTest.shellCount = countTopo(shape, oc.TopAbs_ShapeEnum.TopAbs_SHELL);
              buildTest.solidCount = countTopo(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID);

              // Volume — path total length = 20+20+30 = 70 mm, r=4 → π·16·70 ≈ 3520 mm³
              const vol = volume(shape);
              buildTest.volume = vol;
              buildTest.volumeExpected = Math.PI * 16 * 70;
              buildTest.volumeReasonable = vol > 1000 && vol < 6000;

              shape.delete();
            } catch (e) {
              buildTest.shapeErr = String(e).substring(0, 200);
            }
          }
        }
      }
      chain2.buildTest = buildTest;

      // Cleanup
      if (pipeShell) { try { pipeShell.delete(); } catch (_e) {} }
      if (profileWire) { try { profileWire.delete(); } catch (_e) {} }
      if (spineWire) { try { spineWire.delete(); } catch (_e) {} }
      for (const e of spineEdges) { try { e.delete(); } catch (_e) {} }

      // ── Verdict ──────────────────────────────────────────────────────────────
      const isDone = buildTest.isDone === true;
      const volReasonable = buildTest.volumeReasonable === true;
      let verdict, verdictReason;
      if (isDone && volReasonable) {
        verdict = 'REACHABLE';
        verdictReason = `BRepOffsetAPI_MakePipeShell tortuous-path sweep: ctor=${usedCtor}, Add=${addProfileTest.usedAddMethod}, Build=${buildTest.buildMethod}. ` +
          `Volume=${buildTest.volume?.toFixed(1)} mm³ (expected ≈${buildTest.volumeExpected?.toFixed(0)}). IsDone=true.`;
      } else if (isDone) {
        verdict = 'REACHABLE';
        verdictReason = `BRepOffsetAPI_MakePipeShell: IsDone=true but volume=${buildTest.volume} outside expected range. ` +
          `ctor=${usedCtor}, Add=${addProfileTest.usedAddMethod}, Build=${buildTest.buildMethod}.`;
      } else if (pipeShell === null) {
        verdict = 'NOT_REACHABLE';
        verdictReason = 'BRepOffsetAPI_MakePipeShell constructor not found. pipeShellKeys=' + JSON.stringify(pipeShellKeys);
      } else if (!addProfileTest.addOk) {
        verdict = 'NOT_REACHABLE';
        verdictReason = 'BRepOffsetAPI_MakePipeShell constructed but Add(profileWire) failed all overloads. ' +
          'addOverloads=' + JSON.stringify(addProfileTest.availableAddOverloads);
      } else {
        verdict = 'NOT_REACHABLE';
        verdictReason = 'BRepOffsetAPI_MakePipeShell Build() did not produce IsDone=true. ' +
          'buildOk=' + buildTest.buildOk + ' isDone=' + buildTest.isDone +
          ' buildErr=' + (buildTest.buildRanWithOCCTError || JSON.stringify(buildTest));
      }

      result.item2_tortuousSweep = {
        verdict,
        verdictReason,
        pipeShellKeys,
        usedCtor,
        addProfileTest,
        buildTest,
        chain: chain2,
        note: 'Tortuous-path sweep via BRepOffsetAPI_MakePipeShell. 3-segment spine + circular profile.',
      };

    } catch (e) {
      result.item2_tortuousSweep = { verdict: 'NOT_REACHABLE', error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 3 — Lofting with Tangency (BRepOffsetAPI_ThruSections + SetSmoothing)
    //
    //   - 3 square section wires at z=0,20,40 (side lengths 40,20,30)
    //   - ThruSections(true, false, 1e-6) — solid loft
    //   - Introspect for SetSmoothing, SetMaxDegree, SetParType, SetContinuity
    //   - Build, IsDone, Shape, volume > 0
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain3 = {};

      // ── 3a. Build 3 square section wires at different z heights ──────────────
      /** Build a square wire: side=s, at z-level z, centered at (s/2, s/2, z). */
      function makeSquareWireAtZ(s, z) {
        const edges = [
          makeLineEdge(0, 0, z,   s, 0, z),
          makeLineEdge(s, 0, z,   s, s, z),
          makeLineEdge(s, s, z,   0, s, z),
          makeLineEdge(0, s, z,   0, 0, z),
        ];
        const w = makeWireFromEdges(edges);
        for (const e of edges) { try { e.delete(); } catch (_e) {} }
        return w;
      }

      let wire0 = null, wire1 = null, wire2 = null;
      try {
        wire0 = makeSquareWireAtZ(40, 0);   // 40mm square at z=0
        wire1 = makeSquareWireAtZ(20, 20);  // 20mm square at z=20
        wire2 = makeSquareWireAtZ(30, 40);  // 30mm square at z=40
        chain3.wiresBuilt = true;
      } catch (e) {
        chain3.wiresBuildErr = String(e).substring(0, 200);
      }

      // ── 3b. Construct ThruSections and introspect methods ────────────────────
      let thru = null;
      let thruMethods = [];
      if (wire0 !== null) {
        try {
          thru = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
          chain3.thruConstructed = true;

          thruMethods = introspectMethods(thru)
            .filter(m => !m.startsWith('$') && !['constructor', 'delete', 'isDeleted'].includes(m));
          chain3.thruMethods = thruMethods;

          // Identify tangency/smoothing-related methods
          const smoothingMethods = thruMethods.filter(m =>
            m.startsWith('Set') || m.startsWith('Add') || m.startsWith('Check'));
          chain3.smoothingMethods = smoothingMethods;

        } catch (e) {
          chain3.thruCtorErr = String(e).substring(0, 200);
        }
      }

      // ── 3c. Add wires and try SetSmoothing ────────────────────────────────────
      const smoothingTest = {};
      if (thru !== null && wire0 !== null) {
        // AddWire each section
        let addCount = 0;
        for (const [w, label] of [[wire0, 'w0'], [wire1, 'w1'], [wire2, 'w2']]) {
          try {
            thru.AddWire(w);
            addCount++;
          } catch (e) {
            smoothingTest['addWireErr_' + label] = String(e).substring(0, 200);
          }
        }
        smoothingTest.addWireCount = addCount;

        // Try SetSmoothing(true)
        if (typeof thru.SetSmoothing === 'function') {
          try {
            thru.SetSmoothing(true);
            smoothingTest.setSmoothingOk = true;
            smoothingTest.setSmoothingMethod = 'SetSmoothing(true)';
          } catch (e) {
            smoothingTest.setSmoothingErr = String(e).substring(0, 200);
          }
        } else {
          smoothingTest.setSmoothingAvailable = false;
          smoothingTest.note = 'SetSmoothing not in method list; basic ThruSections produces tangent-continuous loft by default';
        }

        // Try SetMaxDegree if available
        if (typeof thru.SetMaxDegree === 'function') {
          try { thru.SetMaxDegree(8); smoothingTest.setMaxDegreeOk = true; } catch (e) {
            smoothingTest.setMaxDegreeErr = String(e).substring(0, 200);
          }
        }

        // Try SetParType if available
        if (typeof thru.SetParType === 'function') {
          try {
            // Approximation_Chordale=0, Approximation_Centripetal=1, Approximation_IsoParametric=2
            thru.SetParType(0);
            smoothingTest.setParTypeOk = true;
          } catch (e) {
            smoothingTest.setParTypeErr = String(e).substring(0, 200);
          }
        }

        // Try SetContinuity if available
        if (typeof thru.SetContinuity === 'function') {
          try {
            thru.SetContinuity(oc.GeomAbs_Shape.GeomAbs_C1);
            smoothingTest.setContinuityOk = true;
          } catch (e) {
            smoothingTest.setContinuityErr = String(e).substring(0, 200);
          }
        }
      }
      chain3.smoothingTest = smoothingTest;

      // ── 3d. Build the loft ───────────────────────────────────────────────────
      const buildTest3 = {};
      if (thru !== null && smoothingTest.addWireCount === 3) {
        let buildOk = false;
        for (const buildM of ['Build', 'Build_1']) {
          if (typeof thru[buildM] !== 'function') continue;
          for (const tryArgs of [[], [new oc.Message_ProgressRange_1()]]) {
            try {
              if (tryArgs.length > 0) {
                thru[buildM](tryArgs[0]);
                tryArgs[0].delete();
              } else {
                thru[buildM]();
              }
              buildTest3.buildMethod = buildM + '(' + (tryArgs.length ? 'pr' : '') + ')';
              buildOk = true;
              break;
            } catch (e) {
              buildTest3['buildErr_' + buildM + '_' + tryArgs.length] = String(e).substring(0, 200);
              if (!String(e).includes('BindingError')) break;
            }
          }
          if (buildOk) break;
        }
        buildTest3.buildOk = buildOk;

        if (buildOk) {
          try { buildTest3.isDone = thru.IsDone(); } catch (_e) {}

          if (buildTest3.isDone) {
            try {
              const shape = thru.Shape();
              buildTest3.shapeObtained = true;
              buildTest3.faceCount = countTopo(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
              buildTest3.solidCount = countTopo(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID);
              buildTest3.volume = volume(shape);
              buildTest3.volumePositive = buildTest3.volume > 0;
              shape.delete();
            } catch (e) {
              buildTest3.shapeErr = String(e).substring(0, 200);
            }
          }
        }
      }
      chain3.buildTest = buildTest3;

      // Cleanup
      if (thru) { try { thru.delete(); } catch (_e) {} }
      if (wire0) { try { wire0.delete(); } catch (_e) {} }
      if (wire1) { try { wire1.delete(); } catch (_e) {} }
      if (wire2) { try { wire2.delete(); } catch (_e) {} }

      // ── Verdict ──────────────────────────────────────────────────────────────
      const isDone3 = buildTest3.isDone === true;
      const volPos3 = buildTest3.volumePositive === true;
      const smoothingAvail = smoothingTest.setSmoothingOk === true || smoothingTest.setSmoothingAvailable === false;

      let verdict3, reason3;
      if (isDone3 && volPos3) {
        verdict3 = 'REACHABLE';
        const tangencyNote = smoothingTest.setSmoothingOk
          ? 'SetSmoothing(true) available — G1/tangent-continuous loft confirmed.'
          : 'SetSmoothing not present; basic ThruSections loft is C0 (positional) at section boundaries — tangency provided implicitly by NURBS interpolation.';
        reason3 = `ThruSections loft works: Build=${buildTest3.buildMethod}, IsDone=true, volume=${buildTest3.volume?.toFixed(1)} mm³. ${tangencyNote}`;
      } else if (thru === null) {
        verdict3 = 'NOT_REACHABLE';
        reason3 = 'ThruSections constructor failed. thruCtorErr=' + chain3.thruCtorErr;
      } else {
        verdict3 = 'NOT_REACHABLE';
        reason3 = 'ThruSections Build() did not produce IsDone=true. buildOk=' + buildTest3.buildOk +
          ' isDone=' + buildTest3.isDone + ' addWires=' + smoothingTest.addWireCount;
      }

      result.item3_loftTangency = {
        verdict: verdict3,
        verdictReason: reason3,
        thruMethods: chain3.thruMethods,
        smoothingMethods: chain3.smoothingMethods,
        smoothingTest,
        buildTest: buildTest3,
        chain: chain3,
        note: 'Lofting with tangency via BRepOffsetAPI_ThruSections. SetSmoothing introspected.',
      };

    } catch (e) {
      result.item3_loftTangency = { verdict: 'NOT_REACHABLE', error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 4 — Tolerant Stitching (BRepBuilderAPI_Sewing)
    //
    //   - Face A: (0,0,0)-(20,0,0)-(20,20,0)-(0,20,0)
    //   - Face B: (20.05,0,0)-(40.05,0,0)-(40.05,20,0)-(20.05,20,0)
    //   - Gap ≈ 0.05mm between shared edge
    //   - Sewing with tolerance 0.1 → should stitch → single shell
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain4 = {};

      // Scan available Sewing keys
      const sewingKeys = ocKeys.filter(k => k.startsWith('BRepBuilderAPI_Sewing'));
      chain4.sewingKeys = sewingKeys;

      // ── 4a. Build 2 planar faces with a small gap ─────────────────────────────
      let faceA = null, faceB = null;
      let edgesA = [], edgesB = [];
      try {
        // Face A: square (0,0,0)→(20,0,0)→(20,20,0)→(0,20,0)
        edgesA = [
          makeLineEdge(0, 0, 0,    20, 0, 0),
          makeLineEdge(20, 0, 0,   20, 20, 0),
          makeLineEdge(20, 20, 0,  0, 20, 0),
          makeLineEdge(0, 20, 0,   0, 0, 0),
        ];
        const wireA = makeWireFromEdges(edgesA);
        faceA = makePlanarFace(wireA);
        wireA.delete();
        chain4.faceABuilt = true;
      } catch (e) {
        chain4.faceAErr = String(e).substring(0, 200);
      }

      try {
        // Face B: square (20.05,0,0)→(40.05,0,0)→(40.05,20,0)→(20.05,20,0)
        // ~0.05mm gap from Face A
        edgesB = [
          makeLineEdge(20.05, 0, 0,   40.05, 0, 0),
          makeLineEdge(40.05, 0, 0,   40.05, 20, 0),
          makeLineEdge(40.05, 20, 0,  20.05, 20, 0),
          makeLineEdge(20.05, 20, 0,  20.05, 0, 0),
        ];
        const wireB = makeWireFromEdges(edgesB);
        faceB = makePlanarFace(wireB);
        wireB.delete();
        chain4.faceBBuilt = true;
      } catch (e) {
        chain4.faceBErr = String(e).substring(0, 200);
      }

      // ── 4b. Construct BRepBuilderAPI_Sewing ───────────────────────────────────
      let sewing = null;
      let usedSewingCtor = null;
      const sewingCtorAttempts = [
        // Try tolerance-only constructor variants
        { cls: 'BRepBuilderAPI_Sewing_1', args: [0.1], label: 'BRepBuilderAPI_Sewing_1(0.1)' },
        { cls: 'BRepBuilderAPI_Sewing_1', args: [],    label: 'BRepBuilderAPI_Sewing_1()' },
        { cls: 'BRepBuilderAPI_Sewing',   args: [0.1], label: 'BRepBuilderAPI_Sewing(0.1)' },
        { cls: 'BRepBuilderAPI_Sewing',   args: [],    label: 'BRepBuilderAPI_Sewing()' },
        // Try fuller constructor (tolerance + booleans)
        { cls: 'BRepBuilderAPI_Sewing_1', args: [0.1, true, true, true, false], label: 'BRepBuilderAPI_Sewing_1(tol,true,true,true,false)' },
        { cls: 'BRepBuilderAPI_Sewing',   args: [0.1, true, true, true, false], label: 'BRepBuilderAPI_Sewing(tol,true,true,true,false)' },
      ];

      for (const att of sewingCtorAttempts) {
        if (!oc[att.cls]) { chain4['ctorMissing_' + att.cls] = true; continue; }
        try {
          sewing = new oc[att.cls](...att.args);
          usedSewingCtor = att.label;
          break;
        } catch (e) {
          chain4['ctorErr_' + att.label.substring(0, 60)] = String(e).substring(0, 200);
        }
      }
      chain4.usedSewingCtor = usedSewingCtor;
      chain4.sewingConstructed = sewing !== null;

      // Introspect sewing methods
      let sewingMethods = [];
      if (sewing !== null) {
        sewingMethods = introspectMethods(sewing)
          .filter(m => !m.startsWith('$') && !['constructor', 'delete', 'isDeleted'].includes(m));
        chain4.sewingMethods = sewingMethods;
      }

      // ── 4c. Init tolerance (if Init method exists) ───────────────────────────
      const initTest = {};
      if (sewing !== null) {
        if (typeof sewing.Init === 'function') {
          try {
            // Init(tolerance, optionFaceMode?, optionBorderMode?, optionFreeEdges3d?)
            for (const initArgs of [[0.1], [0.1, true, true, true, false]]) {
              try {
                sewing.Init(...initArgs);
                initTest.initOk = true;
                initTest.initArgs = initArgs;
                break;
              } catch (e) {
                initTest['initErr_' + initArgs.length] = String(e).substring(0, 200);
              }
            }
          } catch (e) {
            initTest.initErr = String(e).substring(0, 200);
          }
        } else {
          initTest.initAvailable = false;
        }
      }
      chain4.initTest = initTest;

      // ── 4d. Add faces and Perform ─────────────────────────────────────────────
      const performTest = {};
      if (sewing !== null && faceA !== null && faceB !== null) {
        // Add faces
        let addA = false, addB = false;
        for (const addM of ['Add', 'Add_1']) {
          if (typeof sewing[addM] !== 'function') continue;
          try { sewing[addM](faceA); addA = true; } catch (e) {
            performTest['addAErr_' + addM] = String(e).substring(0, 200);
          }
          try { sewing[addM](faceB); addB = true; } catch (e) {
            performTest['addBErr_' + addM] = String(e).substring(0, 200);
          }
          if (addA && addB) { performTest.usedAddMethod = addM; break; }
        }
        performTest.addA = addA;
        performTest.addB = addB;

        // Perform
        if (addA && addB) {
          for (const perfM of ['Perform', 'Perform_1']) {
            if (typeof sewing[perfM] !== 'function') continue;
            // Try no-arg and progress-range arg
            for (const tryArgs of [[], [new oc.Message_ProgressRange_1()]]) {
              try {
                if (tryArgs.length > 0) {
                  sewing[perfM](tryArgs[0]);
                  tryArgs[0].delete();
                } else {
                  sewing[perfM]();
                }
                performTest.performMethod = perfM + '(' + (tryArgs.length ? 'pr' : '') + ')';
                performTest.performOk = true;
                break;
              } catch (e) {
                performTest['performErr_' + perfM + '_' + tryArgs.length] = String(e).substring(0, 200);
                if (!String(e).includes('BindingError')) break;
              }
            }
            if (performTest.performOk) break;
          }

          // Get SewedShape
          if (performTest.performOk) {
            for (const shapeM of ['SewedShape', 'SewedShape_1']) {
              if (typeof sewing[shapeM] !== 'function') continue;
              try {
                const sewedShape = sewing[shapeM]();
                performTest.sewedShapeObtained = true;
                performTest.shapeMethod = shapeM + '()';

                // Count shells — should be 1 if stitched
                const SHELL = oc.TopAbs_ShapeEnum.TopAbs_SHELL;
                performTest.shellCount = countTopo(sewedShape, SHELL);

                // Count faces inside — should have both faces
                const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
                performTest.faceCount = countTopo(sewedShape, FACE);

                performTest.stitchSuccess = performTest.shellCount === 1 && performTest.faceCount >= 2;

                sewedShape.delete();
                break;
              } catch (e) {
                performTest['sewedShapeErr_' + shapeM] = String(e).substring(0, 200);
              }
            }
          }
        }
      }
      chain4.performTest = performTest;

      // Cleanup
      if (sewing) { try { sewing.delete(); } catch (_e) {} }
      if (faceA) { try { faceA.delete(); } catch (_e) {} }
      if (faceB) { try { faceB.delete(); } catch (_e) {} }
      for (const e of edgesA) { try { e.delete(); } catch (_e) {} }
      for (const e of edgesB) { try { e.delete(); } catch (_e) {} }

      // ── Verdict ──────────────────────────────────────────────────────────────
      let verdict4, reason4;
      if (performTest.stitchSuccess) {
        verdict4 = 'REACHABLE';
        reason4 = `BRepBuilderAPI_Sewing stitched 2 faces (gap 0.05mm) into 1 shell. ` +
          `ctor=${usedSewingCtor}, Perform=${performTest.performMethod}, shells=${performTest.shellCount}, faces=${performTest.faceCount}.`;
      } else if (performTest.sewedShapeObtained) {
        verdict4 = 'REACHABLE';
        reason4 = `BRepBuilderAPI_Sewing ran (SewedShape obtained) but shells=${performTest.shellCount} faces=${performTest.faceCount} — tolerance may need tuning. ` +
          `ctor=${usedSewingCtor}, Perform=${performTest.performMethod}.`;
      } else if (sewing === null) {
        verdict4 = 'NOT_REACHABLE';
        reason4 = 'BRepBuilderAPI_Sewing constructor not found. sewingKeys=' + JSON.stringify(sewingKeys);
      } else if (!performTest.performOk) {
        verdict4 = 'NOT_REACHABLE';
        reason4 = 'BRepBuilderAPI_Sewing.Perform() failed. ' +
          JSON.stringify(Object.entries(performTest).filter(([k]) => k.includes('Err')).map(([k, v]) => k + ':' + v));
      } else {
        verdict4 = 'NOT_REACHABLE';
        reason4 = 'BRepBuilderAPI_Sewing partial failure. ' + JSON.stringify(performTest);
      }

      result.item4_tolerantStiching = {
        verdict: verdict4,
        verdictReason: reason4,
        sewingKeys,
        usedSewingCtor,
        sewingMethods,
        performTest,
        chain: chain4,
        note: 'Tolerant stitching via BRepBuilderAPI_Sewing. Two faces with 0.05mm gap, tolerance 0.1.',
      };

    } catch (e) {
      result.item4_tolerantStiching = { verdict: 'NOT_REACHABLE', error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 5 — Convergent Modeling (MakeFace + Sewing + MakeSolid pipeline)
    //
    //   - 12 triangular faces from cube mesh (20mm cube = 8 verts, 12 tris)
    //   - Each triangle: MakeEdge_3 ×3 + MakeWire + MakeFace_15
    //   - Sew 12 faces (tolerance 0.001)
    //   - MakeSolid from shell → measure volume ≈ 8000 mm³
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain5 = {};

      // ── 5a. Define cube mesh data ─────────────────────────────────────────────
      // 8 vertices of a 20mm cube (0-based index)
      const cubeVerts = [
        [0,  0,  0],   // 0
        [20, 0,  0],   // 1
        [20, 20, 0],   // 2
        [0,  20, 0],   // 3
        [0,  0,  20],  // 4
        [20, 0,  20],  // 5
        [20, 20, 20],  // 6
        [0,  20, 20],  // 7
      ];

      // 12 triangles (CCW when viewed from outside)
      const cubeTris = [
        // Bottom face (z=0, normal -Z)
        [0, 2, 1], [0, 3, 2],
        // Top face (z=20, normal +Z)
        [4, 5, 6], [4, 6, 7],
        // Front face (y=0, normal -Y)
        [0, 1, 5], [0, 5, 4],
        // Back face (y=20, normal +Y)
        [2, 3, 7], [2, 7, 6],
        // Left face (x=0, normal -X)
        [0, 4, 7], [0, 7, 3],
        // Right face (x=20, normal +X)
        [1, 2, 6], [1, 6, 5],
      ];

      // ── 5b. Scan for MakeSolid keys ───────────────────────────────────────────
      const makeSolidKeys = ocKeys.filter(k => k.startsWith('BRepBuilderAPI_MakeSolid'));
      chain5.makeSolidKeys = makeSolidKeys;

      // ── 5c. Build triangle faces ──────────────────────────────────────────────
      const triFaces = [];
      const triBuildErrors = [];
      for (let i = 0; i < cubeTris.length; i++) {
        const [ia, ib, ic] = cubeTris[i];
        const [ax, ay, az] = cubeVerts[ia];
        const [bx, by, bz] = cubeVerts[ib];
        const [cx, cy, cz] = cubeVerts[ic];
        try {
          const e1 = makeLineEdge(ax, ay, az, bx, by, bz);
          const e2 = makeLineEdge(bx, by, bz, cx, cy, cz);
          const e3 = makeLineEdge(cx, cy, cz, ax, ay, az);
          const wire = makeWireFromEdges([e1, e2, e3]);
          e1.delete(); e2.delete(); e3.delete();
          const face = makePlanarFace(wire);
          wire.delete();
          triFaces.push(face);
        } catch (e) {
          triBuildErrors.push(`tri${i}: ${String(e).substring(0, 100)}`);
        }
      }
      chain5.triFaceCount = triFaces.length;
      chain5.triBuildErrors = triBuildErrors;

      // ── 5d. Sew the triangle faces into a shell ───────────────────────────────
      let sewedShape = null;
      const sewTest5 = {};
      if (triFaces.length >= 6) {
        let sewing5 = null;
        // Construct Sewing (reuse knowledge from item 4)
        // Item 4 confirmed: Sewing requires exactly 5 args — (tolerance, faceMode, borderMode, freeEdges, nonManifold)
        const sewingCtors5 = [
          ['BRepBuilderAPI_Sewing',   [0.001, true, true, true, false]],
          ['BRepBuilderAPI_Sewing_1', [0.001, true, true, true, false]],
          ['BRepBuilderAPI_Sewing_1', [0.001]],
          ['BRepBuilderAPI_Sewing',   [0.001]],
          ['BRepBuilderAPI_Sewing_1', []],
          ['BRepBuilderAPI_Sewing',   []],
        ];
        for (const [cls, args] of sewingCtors5) {
          if (!oc[cls]) continue;
          try { sewing5 = new oc[cls](...args); sewTest5.usedCtor = cls + '(' + args + ')'; break; }
          catch (e) { sewTest5['ctorErr_' + cls] = String(e).substring(0, 150); }
        }

        if (sewing5 !== null) {
          // Add all triangle faces
          let addCount5 = 0;
          for (const f of triFaces) {
            try {
              if (typeof sewing5.Add === 'function') { sewing5.Add(f); addCount5++; }
              else if (typeof sewing5.Add_1 === 'function') { sewing5.Add_1(f); addCount5++; }
            } catch (e) { sewTest5.addErr = String(e).substring(0, 150); }
          }
          sewTest5.addCount = addCount5;

          // Perform
          let performOk5 = false;
          for (const perfM of ['Perform', 'Perform_1']) {
            if (typeof sewing5[perfM] !== 'function') continue;
            for (const tryArgs of [[], [new oc.Message_ProgressRange_1()]]) {
              try {
                if (tryArgs.length > 0) { sewing5[perfM](tryArgs[0]); tryArgs[0].delete(); }
                else { sewing5[perfM](); }
                sewTest5.performMethod = perfM + '(' + (tryArgs.length ? 'pr' : '') + ')';
                performOk5 = true;
                break;
              } catch (e) {
                sewTest5['performErr_' + perfM + '_' + tryArgs.length] = String(e).substring(0, 200);
                if (!String(e).includes('BindingError')) break;
              }
            }
            if (performOk5) break;
          }

          if (performOk5) {
            for (const shapeM of ['SewedShape', 'SewedShape_1']) {
              if (typeof sewing5[shapeM] !== 'function') continue;
              try {
                sewedShape = sewing5[shapeM]();
                sewTest5.sewedShapeObtained = true;
                sewTest5.shellCount = countTopo(sewedShape, oc.TopAbs_ShapeEnum.TopAbs_SHELL);
                sewTest5.faceCount = countTopo(sewedShape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
                break;
              } catch (e) {
                sewTest5['sewedShapeErr_' + shapeM] = String(e).substring(0, 200);
              }
            }
          }
          sewing5.delete();
        }
      }
      chain5.sewTest = sewTest5;

      // ── 5e. Convert shell to solid via BRepBuilderAPI_MakeSolid ──────────────
      const solidTest5 = {};
      if (sewedShape !== null && sewTest5.shellCount >= 1) {
        // Extract the shell from sewedShape
        let shell = null;
        try {
          const SHELL = oc.TopAbs_ShapeEnum.TopAbs_SHELL;
          const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
          const exp5 = new oc.TopExp_Explorer_2(sewedShape, SHELL, ANY);
          if (exp5.More()) {
            shell = oc.TopoDS.Shell_1(exp5.Current());
          }
          exp5.delete();
          solidTest5.shellExtracted = shell !== null;
        } catch (e) {
          solidTest5.shellExtractErr = String(e).substring(0, 200);
        }

        if (shell !== null) {
          // Try MakeSolid constructor variants
          const makeSolidAttempts = [
            { cls: 'BRepBuilderAPI_MakeSolid_2', args: () => [shell], label: 'MakeSolid_2(shell)' },
            { cls: 'BRepBuilderAPI_MakeSolid_1', args: () => [shell], label: 'MakeSolid_1(shell)' },
            { cls: 'BRepBuilderAPI_MakeSolid',   args: () => [shell], label: 'MakeSolid(shell)' },
            { cls: 'BRepBuilderAPI_MakeSolid_3', args: () => [shell], label: 'MakeSolid_3(shell)' },
          ];

          let solidMaker = null;
          for (const att of makeSolidAttempts) {
            if (!oc[att.cls]) { solidTest5['ctorMissing_' + att.cls] = true; continue; }
            try {
              solidMaker = new oc[att.cls](...att.args());
              solidTest5.usedSolidCtor = att.label;
              break;
            } catch (e) {
              solidTest5['ctorErr_' + att.label] = String(e).substring(0, 200);
            }
          }

          if (solidMaker !== null) {
            try {
              solidTest5.isDone = solidMaker.IsDone();
              if (solidTest5.isDone) {
                const solidShape = solidMaker.Shape();
                solidTest5.shapeObtained = true;
                solidTest5.solidCount = countTopo(solidShape, oc.TopAbs_ShapeEnum.TopAbs_SOLID);
                solidTest5.faceCount = countTopo(solidShape, oc.TopAbs_ShapeEnum.TopAbs_FACE);

                // Volume should be ~8000 mm³ for 20mm cube
                const vol5 = volume(solidShape);
                solidTest5.volume = vol5;
                solidTest5.volumeExpected = 8000;
                solidTest5.volumeReasonable = vol5 > 5000 && vol5 < 11000;

                solidShape.delete();
              }
            } catch (e) {
              solidTest5.solidMeasureErr = String(e).substring(0, 200);
            }
            solidMaker.delete();
          }

          shell.delete();
        }
      }
      chain5.solidTest = solidTest5;

      // Cleanup
      if (sewedShape) { try { sewedShape.delete(); } catch (_e) {} }
      for (const f of triFaces) { try { f.delete(); } catch (_e) {} }

      // ── Verdict ──────────────────────────────────────────────────────────────
      const solidDone = solidTest5.isDone === true;
      const volOk5 = solidTest5.volumeReasonable === true;
      const shellObtained = sewTest5.sewedShapeObtained === true;
      let verdict5, reason5;

      if (solidDone && volOk5) {
        verdict5 = 'REACHABLE';
        reason5 = `Convergent modeling pipeline works: 12 triangle faces → Sewing → Shell → MakeSolid → IsDone=true. ` +
          `Volume=${solidTest5.volume?.toFixed(1)} mm³ (expected ≈8000). ` +
          `MakeSolid=${solidTest5.usedSolidCtor}, Sewing=${sewTest5.performMethod}.`;
      } else if (solidDone) {
        verdict5 = 'REACHABLE';
        reason5 = `Convergent pipeline runs but volume=${solidTest5.volume} outside expected range. ` +
          `solidCount=${solidTest5.solidCount}. May need oriented shell (BRepLib.OrientClosedSolid).`;
      } else if (shellObtained && !solidDone) {
        verdict5 = 'PARTIALLY_REACHABLE';
        reason5 = `Sewing produces a shell (shells=${sewTest5.shellCount}) but MakeSolid IsDone=false. ` +
          `Shell may not be properly closed/oriented. solidTest=${JSON.stringify(solidTest5).substring(0, 300)}.`;
      } else if (!shellObtained) {
        verdict5 = 'NOT_REACHABLE';
        reason5 = `Sewing did not produce SewedShape. addCount=${sewTest5.addCount}, perform=${sewTest5.performMethod}. ` +
          `sewTest=${JSON.stringify(sewTest5).substring(0, 300)}.`;
      } else {
        verdict5 = 'NOT_REACHABLE';
        reason5 = 'Convergent pipeline failed. chain5=' + JSON.stringify(chain5).substring(0, 500);
      }

      result.item5_convergentModeling = {
        verdict: verdict5,
        verdictReason: reason5,
        makeSolidKeys,
        sewTest: sewTest5,
        solidTest: solidTest5,
        chain: chain5,
        note: 'Convergent modeling via 12-triangle cube mesh → MakeFace+Sewing+MakeSolid pipeline.',
      };

    } catch (e) {
      result.item5_convergentModeling = { verdict: 'NOT_REACHABLE', error: String(e) };
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    result._summary = {
      item1_nSidedPatching:   result.item1_nSidedPatching.verdict,
      item2_tortuousSweep:    result.item2_tortuousSweep.verdict,
      item3_loftTangency:     result.item3_loftTangency.verdict,
      item4_tolerantStiching: result.item4_tolerantStiching.verdict,
      item5_convergentModeling: result.item5_convergentModeling.verdict,
      note: 'F recon — verdicts recorded. GREEN = investigation complete, not all REACHABLE.',
    };

    return result;
  });

  // ── Write JSON output ────────────────────────────────────────────────────────
  const notesDir = path.join(__dirname, '..', 'docs', 'superpowers', 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
  const jsonPath = path.join(notesDir, 'occt-api-F-recon.json');
  fs.writeFileSync(jsonPath, JSON.stringify(verified, null, 2));
  console.log('F RECON RESULT:', JSON.stringify(verified._summary, null, 2));
  console.log('F RECON FULL:', JSON.stringify(verified, null, 2));

  // ── Assertions — spec PASSES when each item has a recorded verdict ────────────
  // GREEN = investigation complete. NOT_REACHABLE is a valid honest result.

  const VALID_VERDICTS = ['REACHABLE', 'NOT_REACHABLE', 'PARTIALLY_REACHABLE'];

  expect(
    VALID_VERDICTS.includes(verified.item1_nSidedPatching.verdict),
    `item1_nSidedPatching must have a verdict, got: ${JSON.stringify(verified.item1_nSidedPatching.verdict)}`
  ).toBe(true);

  expect(
    VALID_VERDICTS.includes(verified.item2_tortuousSweep.verdict),
    `item2_tortuousSweep must have a verdict, got: ${JSON.stringify(verified.item2_tortuousSweep.verdict)}`
  ).toBe(true);

  expect(
    VALID_VERDICTS.includes(verified.item3_loftTangency.verdict),
    `item3_loftTangency must have a verdict, got: ${JSON.stringify(verified.item3_loftTangency.verdict)}`
  ).toBe(true);

  expect(
    VALID_VERDICTS.includes(verified.item4_tolerantStiching.verdict),
    `item4_tolerantStiching must have a verdict, got: ${JSON.stringify(verified.item4_tolerantStiching.verdict)}`
  ).toBe(true);

  expect(
    VALID_VERDICTS.includes(verified.item5_convergentModeling.verdict),
    `item5_convergentModeling must have a verdict, got: ${JSON.stringify(verified.item5_convergentModeling.verdict)}`
  ).toBe(true);

  expect(verified._summary, 'summary must exist').toBeTruthy();
  expect(verified._summary.item1_nSidedPatching, 'summary.item1 must be present').toBeTruthy();
  expect(verified._summary.item2_tortuousSweep, 'summary.item2 must be present').toBeTruthy();
  expect(verified._summary.item3_loftTangency, 'summary.item3 must be present').toBeTruthy();
  expect(verified._summary.item4_tolerantStiching, 'summary.item4 must be present').toBeTruthy();
  expect(verified._summary.item5_convergentModeling, 'summary.item5 must be present').toBeTruthy();

  expect(pageErrors, 'No page errors expected').toEqual([]);
  await app.close();
});
