/**
 * brep-b-recon-electron.spec.js
 *
 * Sub-project B empirical kernel API reconnaissance — Advanced Booleans.
 * Empirically determines reachability for each of four §3.4 capabilities:
 *
 *   1. Non-manifold / multi-arg booleans
 *      - BRepAlgoAPI_BuilderAlgo, BOPAlgo_Builder, BOPAlgo_BOP, BOPAlgo_MakerVolume
 *      - Multi-input feeding via AddArgument / SetArguments / TopTools_ListOfShape
 *      - Two adjacent boxes (share face exactly) → single fused solid vol ≈ 16000?
 *      - Two overlapping boxes (overlap half) → vol ≈ 12000?
 *      Verdict: REACHABLE or NOT_REACHABLE
 *
 *   2. Coplanar/coincident-face booleans (fuzzy tolerance)
 *      - BRepAlgoAPI_Fuse SetFuzzy* / SetTolerance* method introspection
 *      - Near-coincident boxes (gap 0.001 mm) standard vs fuzzy fuse
 *      Verdict: REACHABLE or NOT_REACHABLE
 *
 *   3. Lattice batching (single-pass multi-arg fuse of ≥8 shapes)
 *      - Feed 8 non-overlapping boxes to the advanced builder
 *      - Volume should be 8 × 90 = 720 mm³
 *      - Record timing via performance.now()
 *      Verdict: REACHABLE or NOT_REACHABLE
 *
 *   4. Local face replacement via BRepTools_ReShape / ShapeBuild_ReShape
 *      - Constructor, Replace(old, new), Apply(rootShape)
 *      - Swap face #1 of a 20mm box with an identity copy → still 6 faces?
 *      Verdict: REACHABLE or NOT_REACHABLE
 *
 * Writes:  docs/superpowers/notes/kernel-api-B-recon.json
 * Pattern: e2e/brep-a5-recon-electron.spec.js
 * Package: opencascade.js@2.0.0-beta.b5ff984
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.setTimeout(600000);

test('Sub-project B — kernel API recon (advanced booleans)', async () => {
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

    /** Build a translated box. Returns TopoDS_Shape — caller must .delete(). */
    function makeTranslatedBox(dx, dy, dz, tx, ty, tz) {
      const m = new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz);
      const s0 = m.Shape();
      m.delete();
      if (tx === 0 && ty === 0 && tz === 0) return s0;
      const trsf = new oc.gp_Trsf_1();
      trsf.SetTranslation_1(new oc.gp_Vec_4(tx, ty, tz));
      const builder = new oc.BRepBuilderAPI_Transform_2(s0, trsf, true);
      const s1 = builder.Shape();
      builder.delete();
      trsf.delete();
      s0.delete();
      return s1;
    }

    /** Count faces of a shape. */
    function countFaces(shape) {
      const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
      const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
      let count = 0;
      const exp = new oc.TopExp_Explorer_2(shape, FACE, ANY);
      for (; exp.More(); exp.Next()) {
        count++;
      }
      exp.delete();
      return count;
    }

    /** Collect all unique faces from a shape. Returns array — caller must .delete() each. */
    function collectUniqueFaces(shape) {
      const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
      const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
      const faces = [];
      const exp = new oc.TopExp_Explorer_2(shape, FACE, ANY);
      for (; exp.More(); exp.Next()) {
        const f = exp.Current();
        let found = false;
        for (const prev of faces) {
          try { if (prev.IsSame(f)) { found = true; break; } } catch (_e) {}
        }
        if (!found) {
          try { faces.push(oc.TopoDS.Face_1(f)); } catch (_e) { faces.push(f); }
        }
      }
      exp.delete();
      return faces;
    }

    /** Standard fuse (A-series verified). */
    function standardFuse(a, b) {
      const pr  = new oc.Message_ProgressRange_1();
      const pr2 = new oc.Message_ProgressRange_1();
      const fuse = new oc.BRepAlgoAPI_Fuse_3(a, b, pr);
      fuse.Build(pr2);
      pr.delete(); pr2.delete();
      const s = fuse.Shape();
      fuse.delete();
      return s;
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

    /** Safely try to build a TopTools_ListOfShape and append shapes. */
    function tryBuildList(shapes) {
      // Try several list constructors
      let list = null;
      for (const ctorName of ['TopTools_ListOfShape_1', 'TopTools_ListOfShape']) {
        if (!oc[ctorName]) continue;
        try { list = new oc[ctorName](); break; } catch (_e) {}
      }
      if (!list) return { list: null, error: 'No TopTools_ListOfShape constructor found' };

      const methods = introspectMethods(list);
      const appendMethods = methods.filter(m => m.startsWith('Append') || m.startsWith('Prepend') || m === 'push');
      let appendOk = false;
      let usedMethod = null;
      for (const s of shapes) {
        let added = false;
        for (const am of appendMethods) {
          try {
            list[am](s);
            usedMethod = am;
            added = true;
            break;
          } catch (_e) {}
        }
        if (!added) {
          try { list.delete(); } catch (_e) {}
          return { list: null, error: `Cannot append shape to list; tried: ${appendMethods.join(',')}` };
        }
      }
      return { list, appendMethod: usedMethod, appendMethods };
    }

    const result = {};
    const ocKeys = Object.getOwnPropertyNames(oc);

    // ══════════════════════════════════════════════════════════════════════════
    // Capability 1 — Non-manifold / multi-arg booleans
    //
    //   Investigate: BRepAlgoAPI_BuilderAlgo, BOPAlgo_Builder, BOPAlgo_BOP,
    //                BOPAlgo_MakerVolume
    //   Feed multiple inputs, build, check volume.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain1 = {};

      // ── 1a. Scan available advanced-boolean classes ────────────────────────
      const advBoolCandidates = [
        'BRepAlgoAPI_BuilderAlgo',
        'BRepAlgoAPI_BuilderAlgo_1', 'BRepAlgoAPI_BuilderAlgo_2',
        'BOPAlgo_Builder', 'BOPAlgo_Builder_1', 'BOPAlgo_Builder_2',
        'BOPAlgo_BOP', 'BOPAlgo_BOP_1',
        'BOPAlgo_MakerVolume', 'BOPAlgo_MakerVolume_1', 'BOPAlgo_MakerVolume_2',
        'BRepAlgoAPI_Common_3', 'BRepAlgoAPI_Section_3',
      ];
      chain1.availableClasses = {};
      for (const cls of advBoolCandidates) {
        chain1.availableClasses[cls] = !!oc[cls];
      }

      // ── 1b. Introspect BRepAlgoAPI_BuilderAlgo ───────────────────────────
      let builderAlgoInfo = {};
      let builderAlgoObj = null;
      let builderAlgoCtor = null;
      for (const ctorName of ['BRepAlgoAPI_BuilderAlgo', 'BRepAlgoAPI_BuilderAlgo_1']) {
        if (!oc[ctorName]) { builderAlgoInfo['missing_' + ctorName] = true; continue; }
        try {
          builderAlgoObj = new oc[ctorName]();
          builderAlgoCtor = ctorName + '()';
          break;
        } catch (e) {
          builderAlgoInfo['ctorErr_' + ctorName] = String(e).substring(0, 200);
        }
      }
      if (builderAlgoObj) {
        builderAlgoInfo.ctor = builderAlgoCtor;
        const methods = introspectMethods(builderAlgoObj).filter(m => !m.startsWith('$'));
        builderAlgoInfo.methods = methods;
        // Look for key methods
        builderAlgoInfo.hasSetArguments = methods.some(m => m.toLowerCase().includes('setargument'));
        builderAlgoInfo.hasAddArgument  = methods.some(m => m.toLowerCase().includes('addargument'));
        builderAlgoInfo.hasPerform      = methods.some(m => m.toLowerCase() === 'perform');
        builderAlgoInfo.hasBuild        = methods.some(m => m.toLowerCase() === 'build');
        builderAlgoInfo.hasIsDone       = methods.some(m => m.toLowerCase() === 'isdone');
        builderAlgoInfo.hasHasErrors    = methods.some(m => m.toLowerCase() === 'haserrors');
        builderAlgoInfo.hasShape        = methods.some(m => m.toLowerCase() === 'shape');
        builderAlgoInfo.setArgsMethods  = methods.filter(m => m.toLowerCase().includes('argument'));
        try { builderAlgoObj.delete(); } catch (_e) {}
        builderAlgoObj = null;
      }
      chain1.builderAlgoInfo = builderAlgoInfo;

      // ── 1c. Introspect BOPAlgo_Builder ───────────────────────────────────
      let bopBuilderInfo = {};
      for (const ctorName of ['BOPAlgo_Builder', 'BOPAlgo_Builder_1']) {
        if (!oc[ctorName]) { bopBuilderInfo['missing_' + ctorName] = true; continue; }
        try {
          const obj = new oc[ctorName]();
          bopBuilderInfo.ctor = ctorName + '()';
          const methods = introspectMethods(obj).filter(m => !m.startsWith('$'));
          bopBuilderInfo.methods = methods;
          try { obj.delete(); } catch (_e) {}
          break;
        } catch (e) {
          bopBuilderInfo['ctorErr_' + ctorName] = String(e).substring(0, 200);
        }
      }
      chain1.bopBuilderInfo = bopBuilderInfo;

      // ── 1d. Introspect BOPAlgo_MakerVolume ──────────────────────────────
      let makerVolumeInfo = {};
      for (const ctorName of ['BOPAlgo_MakerVolume', 'BOPAlgo_MakerVolume_1']) {
        if (!oc[ctorName]) { makerVolumeInfo['missing_' + ctorName] = true; continue; }
        try {
          const obj = new oc[ctorName]();
          makerVolumeInfo.ctor = ctorName + '()';
          const methods = introspectMethods(obj).filter(m => !m.startsWith('$'));
          makerVolumeInfo.methods = methods;
          try { obj.delete(); } catch (_e) {}
          break;
        } catch (e) {
          makerVolumeInfo['ctorErr_' + ctorName] = String(e).substring(0, 200);
        }
      }
      chain1.makerVolumeInfo = makerVolumeInfo;

      // ── 1e. TopTools_ListOfShape introspection ───────────────────────────
      let listInfo = {};
      for (const ctorName of ['TopTools_ListOfShape', 'TopTools_ListOfShape_1']) {
        if (!oc[ctorName]) { listInfo['missing_' + ctorName] = true; continue; }
        try {
          const list = new oc[ctorName]();
          listInfo.ctor = ctorName + '()';
          const methods = introspectMethods(list).filter(m => !m.startsWith('$'));
          listInfo.methods = methods;
          try { list.delete(); } catch (_e) {}
          break;
        } catch (e) {
          listInfo['ctorErr_' + ctorName] = String(e).substring(0, 200);
        }
      }
      chain1.listInfo = listInfo;

      // ── 1f. Test: two adjacent boxes (shared face) via BRepAlgoAPI_BuilderAlgo ──
      // Box A: 20mm cube at origin
      // Box B: 20mm cube translated (20,0,0) — they share the 20×20 face at x=20
      // Expected combined volume: 2 × 8000 = 16000 mm³
      const adjacentTest = {};
      let box1 = null, box2 = null;
      try {
        box1 = makeTranslatedBox(20, 20, 20, 0, 0, 0);
        box2 = makeTranslatedBox(20, 20, 20, 20, 0, 0);
        adjacentTest.boxesBuilt = true;
        adjacentTest.box1VolExpected = 8000;
        adjacentTest.box2VolExpected = 8000;

        // First try: BRepAlgoAPI_BuilderAlgo with SetArguments (TopTools_ListOfShape)
        let tested = false;

        // Try SetArguments approach
        for (const ctorName of ['BRepAlgoAPI_BuilderAlgo', 'BRepAlgoAPI_BuilderAlgo_1']) {
          if (!oc[ctorName]) continue;
          try {
            const builder = new oc[ctorName]();
            const methods = introspectMethods(builder).filter(m => !m.startsWith('$'));

            // Look for SetArguments method
            const setArgMethods = methods.filter(m => m.toLowerCase().includes('argument'));
            adjacentTest.setArgMethods = setArgMethods;

            let feedOk = false;

            // Try SetArguments with a TopTools_ListOfShape
            const setArgVariants = ['SetArguments', 'SetArguments_1'];
            for (const sam of setArgVariants) {
              if (typeof builder[sam] !== 'function') continue;
              // Build list
              const listResult = tryBuildList([box1, box2]);
              adjacentTest.listBuildResult = {
                listOk: !!listResult.list,
                appendMethod: listResult.appendMethod,
                error: listResult.error,
              };
              if (!listResult.list) continue;
              try {
                builder[sam](listResult.list);
                adjacentTest.setArgMethod = sam;
                feedOk = true;
                listResult.list.delete();
                break;
              } catch (e) {
                adjacentTest['setArgErr_' + sam] = String(e).substring(0, 200);
                try { listResult.list.delete(); } catch (_e) {}
              }
            }

            // If SetArguments failed, try AddArgument
            if (!feedOk) {
              for (const aam of ['AddArgument', 'AddArgument_1']) {
                if (typeof builder[aam] !== 'function') continue;
                try {
                  builder[aam](box1);
                  builder[aam](box2);
                  adjacentTest.addArgMethod = aam;
                  feedOk = true;
                  break;
                } catch (e) {
                  adjacentTest['addArgErr_' + aam] = String(e).substring(0, 200);
                }
              }
            }

            adjacentTest.feedOk = feedOk;

            if (feedOk) {
              // Try Perform first (kernel low-level), then Build
              let ran = false;
              for (const runM of ['Perform', 'Build', 'Build_1']) {
                if (typeof builder[runM] !== 'function') continue;
                // Try no-arg
                try {
                  builder[runM]();
                  adjacentTest.runMethod = runM + '()';
                  ran = true;
                  break;
                } catch (e) {
                  adjacentTest['runErr_' + runM + '_noarg'] = String(e).substring(0, 200);
                  // Try with progress range
                  try {
                    const pr = new oc.Message_ProgressRange_1();
                    builder[runM](pr);
                    pr.delete();
                    adjacentTest.runMethod = runM + '(pr)';
                    ran = true;
                    break;
                  } catch (e2) {
                    adjacentTest['runErr_' + runM + '_pr'] = String(e2).substring(0, 200);
                  }
                }
              }
              adjacentTest.ran = ran;

              if (ran) {
                // IsDone
                try { adjacentTest.isDone = builder.IsDone(); } catch (_e) {}
                // HasErrors
                try { adjacentTest.hasErrors = builder.HasErrors(); } catch (_e) {}
                // HasWarnings
                try { adjacentTest.hasWarnings = builder.HasWarnings(); } catch (_e) {}

                // Shape
                for (const shapeM of ['Shape', 'Shape_1']) {
                  if (typeof builder[shapeM] !== 'function') continue;
                  try {
                    const s = builder[shapeM]();
                    adjacentTest.shapeMethod = shapeM + '()';
                    if (s) {
                      const vol = volume(s);
                      adjacentTest.volumeAdjacent = vol;
                      adjacentTest.volumeAdjacentExpected = 16000;
                      adjacentTest.volumeOk = Math.abs(vol - 16000) < 100;
                      adjacentTest.faceCount = countFaces(s);
                      s.delete();
                    }
                    break;
                  } catch (e) {
                    adjacentTest['shapeErr_' + shapeM] = String(e).substring(0, 200);
                  }
                }
              }
            }

            builder.delete();
            tested = true;
            break;
          } catch (e) {
            adjacentTest['builderCtorErr_' + ctorName] = String(e).substring(0, 200);
          }
        }

        // If BRepAlgoAPI_BuilderAlgo failed, try standard fuse as verification that
        // the geometry itself works
        if (!tested || !adjacentTest.ran) {
          adjacentTest.fallbackToStandardFuse = true;
          try {
            const fused = standardFuse(box1, box2);
            const vol = volume(fused);
            adjacentTest.standardFuseVolume = vol;
            adjacentTest.standardFuseVolumeOk = Math.abs(vol - 16000) < 100;
            fused.delete();
          } catch (e) {
            adjacentTest.standardFuseErr = String(e).substring(0, 200);
          }
        }

      } catch (e) {
        adjacentTest.outerErr = String(e).substring(0, 300);
      } finally {
        if (box1) { try { box1.delete(); } catch (_e) {} box1 = null; }
        if (box2) { try { box2.delete(); } catch (_e) {} box2 = null; }
      }
      chain1.adjacentTest = adjacentTest;

      // ── 1g. Overlapping box test (translate 10,0,0 → overlap half) ────────
      // Box A: 20mm at origin (x: 0→20)
      // Box B: 20mm at (10,0,0) (x: 10→30)
      // Overlap: 10×20×20 = 4000 mm³
      // Expected fused volume: 8000 + 8000 - 4000 = 12000 mm³
      const overlapTest = {};
      let obox1 = null, obox2 = null;
      try {
        obox1 = makeTranslatedBox(20, 20, 20, 0, 0, 0);
        obox2 = makeTranslatedBox(20, 20, 20, 10, 0, 0);
        overlapTest.boxesBuilt = true;

        // Use BRepAlgoAPI_BuilderAlgo if it worked above
        const ctorToTry = builderAlgoInfo.ctor ? builderAlgoInfo.ctor.replace('()', '') : null;
        let ranOverlap = false;

        if (ctorToTry && oc[ctorToTry]) {
          try {
            const builder = new oc[ctorToTry]();
            // Feed via whichever method worked above
            const feedMethod = adjacentTest.setArgMethod || null;
            const addMethod  = adjacentTest.addArgMethod || null;

            let feedOk = false;
            if (feedMethod && typeof builder[feedMethod] === 'function') {
              const lr = tryBuildList([obox1, obox2]);
              if (lr.list) {
                try { builder[feedMethod](lr.list); feedOk = true; lr.list.delete(); } catch (_e) { try { lr.list.delete(); } catch (__e) {} }
              }
            }
            if (!feedOk && addMethod && typeof builder[addMethod] === 'function') {
              try { builder[addMethod](obox1); builder[addMethod](obox2); feedOk = true; } catch (_e) {}
            }

            overlapTest.feedOk = feedOk;

            if (feedOk) {
              // Run
              const runM = (adjacentTest.runMethod || '').replace('(pr)', '').replace('()', '');
              let ran = false;
              if (runM && typeof builder[runM] === 'function') {
                try {
                  const pr = new oc.Message_ProgressRange_1();
                  builder[runM](pr);
                  pr.delete();
                  ran = true;
                  overlapTest.runMethod = runM + '(pr)';
                } catch (_e) {
                  try { builder[runM](); ran = true; overlapTest.runMethod = runM + '()'; } catch (_e2) {}
                }
              }
              overlapTest.ran = ran;
              ranOverlap = ran;

              if (ran) {
                try { overlapTest.isDone = builder.IsDone(); } catch (_e) {}
                const shapeM = (adjacentTest.shapeMethod || 'Shape()').replace('()', '');
                if (typeof builder[shapeM] === 'function') {
                  try {
                    const s = builder[shapeM]();
                    if (s) {
                      const vol = volume(s);
                      overlapTest.volume = vol;
                      overlapTest.volumeExpected = 12000;
                      overlapTest.volumeOk = Math.abs(vol - 12000) < 200;
                      s.delete();
                    }
                  } catch (e) { overlapTest.shapeErr = String(e).substring(0, 200); }
                }
              }
            }
            builder.delete();
          } catch (e) {
            overlapTest.builderErr = String(e).substring(0, 200);
          }
        }

        // Fallback: standard fuse
        if (!ranOverlap) {
          overlapTest.fallbackToStandardFuse = true;
          try {
            const fused = standardFuse(obox1, obox2);
            const vol = volume(fused);
            overlapTest.standardFuseVolume = vol;
            overlapTest.standardFuseVolumeOk = Math.abs(vol - 12000) < 200;
            fused.delete();
          } catch (e) {
            overlapTest.standardFuseErr = String(e).substring(0, 200);
          }
        }
      } catch (e) {
        overlapTest.outerErr = String(e).substring(0, 300);
      } finally {
        if (obox1) { try { obox1.delete(); } catch (_e) {} }
        if (obox2) { try { obox2.delete(); } catch (_e) {} }
      }
      chain1.overlapTest = overlapTest;

      // ── Verdict ─────────────────────────────────────────────────────────────
      const builderAlgoReachable = builderAlgoInfo.ctor !== undefined;
      const multiArgFeedWorks    = !!(adjacentTest.feedOk);
      const buildRan             = !!(adjacentTest.ran);
      const volumeConfirmed      = !!(adjacentTest.volumeOk || adjacentTest.standardFuseVolumeOk);

      let verdict1;
      let verdictReason1;
      if (builderAlgoReachable && multiArgFeedWorks && buildRan && adjacentTest.volumeOk) {
        verdict1 = 'REACHABLE';
        verdictReason1 = `BRepAlgoAPI_BuilderAlgo constructible; ${adjacentTest.setArgMethod || adjacentTest.addArgMethod} feeds shapes; ${adjacentTest.runMethod} executes; vol≈${adjacentTest.volumeAdjacent}`;
      } else if (builderAlgoReachable && !multiArgFeedWorks) {
        verdict1 = 'NOT_REACHABLE';
        verdictReason1 = 'BRepAlgoAPI_BuilderAlgo constructible but cannot feed multiple shapes (SetArguments/AddArgument failed)';
      } else if (!builderAlgoReachable) {
        verdict1 = 'NOT_REACHABLE';
        verdictReason1 = 'BRepAlgoAPI_BuilderAlgo not constructible in this build; BOPAlgo_Builder/MakerVolume also unavailable';
        // But verify geometry works via standard fuse
        if (adjacentTest.standardFuseVolumeOk) {
          verdictReason1 += '; standard BRepAlgoAPI_Fuse confirmed vol≈16000 for adjacent geometry';
        }
      } else {
        verdict1 = 'NOT_REACHABLE';
        verdictReason1 = `Builder constructible but Build/Perform failed or shape extraction failed`;
      }

      result.cap1_multiArgBoolean = {
        verdict: verdict1,
        verdictReason: verdictReason1,
        builderAlgoReachable,
        multiArgFeedWorks,
        buildRan,
        volumeConfirmedAdjacent: adjacentTest.volumeOk,
        volumeConfirmedOverlap: overlapTest.volumeOk,
        adjacentExpected: 16000,
        adjacentActual: adjacentTest.volumeAdjacent,
        overlapExpected: 12000,
        overlapActual: overlapTest.volume || overlapTest.standardFuseVolume,
        builderAlgoInfo,
        bopBuilderInfo,
        makerVolumeInfo,
        listInfo,
        chain: chain1,
        note: 'Multi-arg boolean engine. REACHABLE = BRepAlgoAPI_BuilderAlgo constructible + multi-shape feed + Build + vol≈16000.',
      };

    } catch (e) {
      result.cap1_multiArgBoolean = { verdict: 'NOT_REACHABLE', error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Capability 2 — Coplanar/coincident-face booleans (fuzzy tolerance)
    //
    //   Investigate fuzzy tolerance on BRepAlgoAPI_Fuse prototype.
    //   Test near-coincident boxes (gap 0.001 mm) with and without fuzzy.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain2 = {};

      // ── 2a. Introspect BRepAlgoAPI_Fuse prototype for fuzzy methods ───────
      let fuseObj = null;
      for (const ctorName of ['BRepAlgoAPI_Fuse', 'BRepAlgoAPI_Fuse_1']) {
        if (!oc[ctorName]) { chain2['missing_' + ctorName] = true; continue; }
        try {
          fuseObj = new oc[ctorName]();
          chain2.fuseCtor = ctorName + '()';
          break;
        } catch (e) {
          chain2['ctorErr_' + ctorName] = String(e).substring(0, 200);
        }
      }

      let fusePrototypeMethods = [];
      if (fuseObj) {
        fusePrototypeMethods = introspectMethods(fuseObj).filter(m => !m.startsWith('$'));
        chain2.fuseMethods = fusePrototypeMethods;
        const fuzzyMethods = fusePrototypeMethods.filter(m =>
          m.toLowerCase().includes('fuzzy') ||
          m.toLowerCase().includes('tolerance') ||
          m.toLowerCase().includes('tol')
        );
        chain2.fuzzyMethods = fuzzyMethods;
        try { fuseObj.delete(); } catch (_e) {}
        fuseObj = null;
      }

      // Also check on BRepAlgoAPI_Algo (parent class)
      for (const ctorName of ['BRepAlgoAPI_Algo', 'BRepAlgoAPI_Algo_1']) {
        if (!oc[ctorName]) { chain2['missing_' + ctorName] = true; continue; }
        try {
          const obj = new oc[ctorName]();
          const methods = introspectMethods(obj).filter(m => !m.startsWith('$'));
          chain2.algoParentMethods = methods;
          chain2.algoFuzzyMethods = methods.filter(m =>
            m.toLowerCase().includes('fuzzy') || m.toLowerCase().includes('tol')
          );
          try { obj.delete(); } catch (_e) {}
          break;
        } catch (e) { chain2['algoCtorErr'] = String(e).substring(0, 200); }
      }

      // ── 2b. Test: two boxes with 0.001 mm gap, WITHOUT fuzzy ─────────────
      // Box A: 20mm at origin
      // Box B: 20mm at (20.001, 0, 0) — gap = 0.001 mm between abutting faces
      const noFuzzyTest = {};
      let nb1 = null, nb2 = null;
      try {
        nb1 = makeTranslatedBox(20, 20, 20, 0, 0, 0);
        nb2 = makeTranslatedBox(20, 20, 20, 20.001, 0, 0);
        noFuzzyTest.boxesBuilt = true;
        // Standard fuse: does it produce a single solid or two disconnected solids?
        try {
          const pr  = new oc.Message_ProgressRange_1();
          const pr2 = new oc.Message_ProgressRange_1();
          const fuse = new oc.BRepAlgoAPI_Fuse_3(nb1, nb2, pr);
          fuse.Build(pr2);
          pr.delete(); pr2.delete();
          noFuzzyTest.buildCalled = true;
          noFuzzyTest.isDone = fuse.IsDone();
          try { noFuzzyTest.hasErrors = fuse.HasErrors(); } catch (_e) {}
          if (noFuzzyTest.isDone) {
            const s = fuse.Shape();
            if (s) {
              noFuzzyTest.volume = volume(s);
              // Two disconnected solids would appear as a compound: volume ~ 16000 but not truly fused
              noFuzzyTest.faceCount = countFaces(s);
              // If face count > 12 that might mean two disconnected shells
              noFuzzyTest.seemsCompound = noFuzzyTest.faceCount >= 12;
              s.delete();
            }
          }
          fuse.delete();
        } catch (e) {
          noFuzzyTest.fuseErr = String(e).substring(0, 300);
        }
      } catch (e) {
        noFuzzyTest.outerErr = String(e).substring(0, 300);
      } finally {
        if (nb1) { try { nb1.delete(); } catch (_e) {} }
        if (nb2) { try { nb2.delete(); } catch (_e) {} }
      }
      chain2.noFuzzyTest = noFuzzyTest;

      // ── 2c. Test: WITH fuzzy tolerance (0.01 mm) ─────────────────────────
      const fuzzyTest = {};
      let fb1 = null, fb2 = null;
      try {
        fb1 = makeTranslatedBox(20, 20, 20, 0, 0, 0);
        fb2 = makeTranslatedBox(20, 20, 20, 20.001, 0, 0);
        fuzzyTest.boxesBuilt = true;

        const pr  = new oc.Message_ProgressRange_1();
        const pr2 = new oc.Message_ProgressRange_1();
        const fuse = new oc.BRepAlgoAPI_Fuse_3(fb1, fb2, pr);
        pr.delete();

        // Try to call fuzzy methods found in introspection
        const allFuzzyMethods = [...(chain2.fuzzyMethods || []), ...(chain2.algoFuzzyMethods || [])];
        chain2.triedFuzzyMethods = allFuzzyMethods;

        let fuzzySetOk = false;
        let usedFuzzyMethod = null;
        let usedFuzzyTolerance = null;

        // Common fuzzy method names in the kernel (try variants)
        const fuzzyMethodCandidates = [
          'SetFuzzyValue', 'SetFuzzyValue_1',
          'SetTolerance', 'SetTolerance_1',
          'FuzzyValue', 'SetFuzzy',
          ...allFuzzyMethods.filter(m => !['delete','isDeleted','clone','deleteLater','isAliasOf'].includes(m)),
        ];

        for (const fm of [...new Set(fuzzyMethodCandidates)]) {
          if (typeof fuse[fm] !== 'function') continue;
          for (const tolVal of [0.01, 1e-3, 0.1]) {
            try {
              fuse[fm](tolVal);
              fuzzySetOk = true;
              usedFuzzyMethod = fm;
              usedFuzzyTolerance = tolVal;
              break;
            } catch (e) {
              fuzzyTest['fuzzySetErr_' + fm + '_' + tolVal] = String(e).substring(0, 150);
            }
          }
          if (fuzzySetOk) break;
        }

        fuzzyTest.fuzzySetOk = fuzzySetOk;
        fuzzyTest.usedFuzzyMethod = usedFuzzyMethod;
        fuzzyTest.usedFuzzyTolerance = usedFuzzyTolerance;

        // Build (with or without fuzzy — we build regardless to see the effect)
        try {
          fuse.Build(pr2);
          pr2.delete();
          fuzzyTest.buildCalled = true;
          fuzzyTest.isDone = fuse.IsDone();
          try { fuzzyTest.hasErrors = fuse.HasErrors(); } catch (_e) {}

          if (fuzzyTest.isDone) {
            const s = fuse.Shape();
            if (s) {
              fuzzyTest.volume = volume(s);
              fuzzyTest.faceCount = countFaces(s);
              // A properly fused result should have fewer faces than two disconnected solids
              fuzzyTest.seemsFused = fuzzyTest.faceCount <= 12;
              s.delete();
            }
          }
        } catch (e) {
          try { pr2.delete(); } catch (_e) {}
          fuzzyTest.buildErr = String(e).substring(0, 300);
        }

        fuse.delete();
      } catch (e) {
        try { if (fb1) fb1.delete(); } catch (_e) {}
        try { if (fb2) fb2.delete(); } catch (_e) {}
        fuzzyTest.outerErr = String(e).substring(0, 300);
      } finally {
        if (fb1) { try { fb1.delete(); } catch (_e) {} }
        if (fb2) { try { fb2.delete(); } catch (_e) {} }
      }
      chain2.fuzzyTest = fuzzyTest;

      // ── Verdict ─────────────────────────────────────────────────────────────
      const fuzzyMethodFound = chain2.fuzzyMethods && chain2.fuzzyMethods.length > 0;
      const fuzzySetWorked   = !!(fuzzyTest.fuzzySetOk);
      const fuzzyBuildOk     = !!(fuzzyTest.isDone);

      let verdict2;
      let verdictReason2;
      if (fuzzySetWorked && fuzzyBuildOk) {
        verdict2 = 'REACHABLE';
        verdictReason2 = `${fuzzyTest.usedFuzzyMethod}(${fuzzyTest.usedFuzzyTolerance}) callable; Build succeeded; vol≈${fuzzyTest.volume}`;
      } else if (fuzzyMethodFound && !fuzzySetWorked) {
        verdict2 = 'NOT_REACHABLE';
        verdictReason2 = `Fuzzy methods found (${chain2.fuzzyMethods.join(',')}) but none accepted a tolerance value`;
      } else if (!fuzzyMethodFound) {
        verdict2 = 'NOT_REACHABLE';
        verdictReason2 = 'No SetFuzzy*/SetTolerance* methods found on BRepAlgoAPI_Fuse prototype';
        if (noFuzzyTest.isDone) {
          verdictReason2 += `; standard fuse of near-coincident boxes: vol≈${noFuzzyTest.volume}, faceCount=${noFuzzyTest.faceCount}`;
        }
      } else {
        verdict2 = 'NOT_REACHABLE';
        verdictReason2 = `Fuzzy method found but Build failed after setting tolerance`;
      }

      result.cap2_fuzzyBoolean = {
        verdict: verdict2,
        verdictReason: verdictReason2,
        fuzzyMethodFound,
        foundFuzzyMethods: chain2.fuzzyMethods || [],
        fuzzySetWorked,
        usedFuzzyMethod: fuzzyTest.usedFuzzyMethod || null,
        usedFuzzyTolerance: fuzzyTest.usedFuzzyTolerance || null,
        fuzzyBuildOk,
        fuzzyVolume: fuzzyTest.volume || null,
        noFuzzyVolume: noFuzzyTest.volume || null,
        chain: chain2,
        note: 'Fuzzy boolean. REACHABLE = SetFuzzy* method callable + Build succeeds near-coincident geometry.',
      };

    } catch (e) {
      result.cap2_fuzzyBoolean = { verdict: 'NOT_REACHABLE', error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Capability 3 — Lattice batching (single-pass multi-arg fuse of 8 shapes)
    //
    //   8 small boxes 10×3×3, placed in 2×2×2 non-overlapping grid.
    //   Expected total volume = 8 × 90 = 720 mm³.
    //   Feed all 8 to the advanced builder (or fallback to sequential standard fuse).
    //   Record timing via performance.now().
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain3 = {};

      // ── 3a. Build 8 non-overlapping boxes in a 2×2×2 grid ─────────────────
      // Cells at offsets (x,y,z) with 5mm spacing so they never overlap
      // Box dims: 10×3×3 → volume = 90 mm³ each
      const cellOffsets = [
        [0, 0, 0], [0, 0, 5], [0, 5, 0], [0, 5, 5],
        [10, 0, 0], [10, 0, 5], [10, 5, 0], [10, 5, 5],
      ];
      const boxes8 = [];
      for (const [tx, ty, tz] of cellOffsets) {
        boxes8.push(makeTranslatedBox(10, 3, 3, tx, ty, tz));
      }
      chain3.boxesBuilt = boxes8.length;
      chain3.expectedVolume = 8 * 90; // 720

      const t0 = performance.now();

      // Try multi-arg builder (from Capability 1 findings)
      let multiArgResult = null;
      const builderCtor = result.cap1_multiArgBoolean &&
        result.cap1_multiArgBoolean.builderAlgoInfo &&
        result.cap1_multiArgBoolean.builderAlgoInfo.ctor;

      if (builderCtor) {
        const ctorName = builderCtor.replace('()', '');
        if (oc[ctorName]) {
          try {
            const builder = new oc[ctorName]();
            // Feed all 8 boxes
            const feedMethod = result.cap1_multiArgBoolean.chain &&
              result.cap1_multiArgBoolean.chain.adjacentTest &&
              (result.cap1_multiArgBoolean.chain.adjacentTest.setArgMethod ||
               result.cap1_multiArgBoolean.chain.adjacentTest.addArgMethod);

            let feedOk = false;

            // Try SetArguments with full list
            if (result.cap1_multiArgBoolean.chain.adjacentTest.setArgMethod) {
              const sam = result.cap1_multiArgBoolean.chain.adjacentTest.setArgMethod;
              const lr = tryBuildList(boxes8);
              chain3.listBuild = { ok: !!lr.list, error: lr.error };
              if (lr.list) {
                try { builder[sam](lr.list); feedOk = true; lr.list.delete(); }
                catch (e) { chain3.setArgErr = String(e).substring(0, 200); try { lr.list.delete(); } catch (_e) {} }
              }
            }

            // Try AddArgument for each
            if (!feedOk && result.cap1_multiArgBoolean.chain.adjacentTest.addArgMethod) {
              const aam = result.cap1_multiArgBoolean.chain.adjacentTest.addArgMethod;
              try {
                for (const b of boxes8) builder[aam](b);
                feedOk = true;
                chain3.feedMethod = aam + ' × 8';
              } catch (e) { chain3.addArgErr = String(e).substring(0, 200); }
            }

            chain3.feedOk = feedOk;

            if (feedOk) {
              // Run
              const runSig = result.cap1_multiArgBoolean.chain.adjacentTest.runMethod || '';
              const runM   = runSig.replace('(pr)', '').replace('()', '');
              let ran = false;
              if (runM && typeof builder[runM] === 'function') {
                try {
                  const pr = new oc.Message_ProgressRange_1();
                  builder[runM](pr);
                  pr.delete();
                  ran = true;
                  chain3.runMethod = runM + '(pr)';
                } catch (_e) {
                  try { builder[runM](); ran = true; chain3.runMethod = runM + '()'; } catch (_e2) {}
                }
              }
              chain3.ran = ran;

              if (ran) {
                try { chain3.isDone = builder.IsDone(); } catch (_e) {}
                const shapeM = (result.cap1_multiArgBoolean.chain.adjacentTest.shapeMethod || 'Shape()').replace('()', '');
                if (typeof builder[shapeM] === 'function') {
                  try {
                    const s = builder[shapeM]();
                    if (s) {
                      chain3.volume = volume(s);
                      chain3.volumeExpected = 720;
                      chain3.volumeOk = Math.abs(chain3.volume - 720) < 10;
                      chain3.faceCount = countFaces(s);
                      s.delete();
                      multiArgResult = { volume: chain3.volume, ok: chain3.volumeOk };
                    }
                  } catch (e) { chain3.shapeErr = String(e).substring(0, 200); }
                }
              }
            }
            builder.delete();
          } catch (e) {
            chain3.builderErr = String(e).substring(0, 200);
          }
        }
      }

      // Fallback: sequential standard fuse
      if (!multiArgResult) {
        chain3.fallbackToSequentialFuse = true;
        try {
          let accumulated = boxes8[0]; // do NOT delete — boxes8 still holds ref
          let accShape = null;
          // Make a copy of box[0] to start accumulation
          {
            const trsf = new oc.gp_Trsf_1();
            const builder = new oc.BRepBuilderAPI_Transform_2(boxes8[0], trsf, true);
            accShape = builder.Shape();
            builder.delete();
            trsf.delete();
          }
          for (let i = 1; i < boxes8.length; i++) {
            const prev = accShape;
            accShape = standardFuse(prev, boxes8[i]);
            prev.delete();
          }
          chain3.volume = volume(accShape);
          chain3.volumeExpected = 720;
          chain3.volumeOk = Math.abs(chain3.volume - 720) < 10;
          chain3.faceCount = countFaces(accShape);
          accShape.delete();
          multiArgResult = { volume: chain3.volume, ok: chain3.volumeOk, sequential: true };
        } catch (e) {
          chain3.seqFuseErr = String(e).substring(0, 300);
        }
      }

      const t1 = performance.now();
      chain3.timingMs = t1 - t0;

      // Cleanup boxes
      for (const b of boxes8) { try { b.delete(); } catch (_e) {} }

      // ── Verdict ─────────────────────────────────────────────────────────────
      const multiArgNative = !!(chain3.feedOk && chain3.ran && chain3.volumeOk);
      const volumeOk = !!(chain3.volumeOk);

      let verdict3;
      let verdictReason3;
      if (multiArgNative) {
        verdict3 = 'REACHABLE';
        verdictReason3 = `Single-pass multi-arg builder: 8 shapes → vol≈${chain3.volume} (expected 720) in ${chain3.timingMs.toFixed(0)}ms`;
      } else if (volumeOk && chain3.fallbackToSequentialFuse) {
        verdict3 = 'NOT_REACHABLE';
        verdictReason3 = `Multi-arg builder not available; sequential standard fuse of 8 boxes works: vol≈${chain3.volume} (expected 720) in ${chain3.timingMs.toFixed(0)}ms. Lattice batching (single-pass) is NOT natively available.`;
      } else {
        verdict3 = 'NOT_REACHABLE';
        verdictReason3 = `Neither multi-arg builder nor sequential fuse produced vol≈720`;
      }

      result.cap3_latticeBatch = {
        verdict: verdict3,
        verdictReason: verdictReason3,
        nativeSinglePassAvailable: multiArgNative,
        volumeOk,
        volumeActual: chain3.volume || null,
        volumeExpected: 720,
        timingMs: chain3.timingMs || null,
        chain: chain3,
        note: 'Lattice batching. REACHABLE (native) = multi-arg builder feeds 8 shapes in one pass. NOT_REACHABLE if fallback to sequential fuse.',
      };

    } catch (e) {
      result.cap3_latticeBatch = { verdict: 'NOT_REACHABLE', error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Capability 4 — Local face replacement
    //
    //   Investigate BRepTools_ReShape and ShapeBuild_ReShape.
    //   Determine: constructor, .Replace(old, new), .Apply(root, ...).
    //   Test: grab face #1 of a 20mm box, replace with identity-copy → still 6 faces?
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain4 = {};

      // ── 4a. Scan available reshape classes ─────────────────────────────────
      const reshapeCandidates = [
        'BRepTools_ReShape', 'BRepTools_ReShape_1',
        'ShapeBuild_ReShape', 'ShapeBuild_ReShape_1',
        'BRep_Builder', 'BRepBuilderAPI_Copy',
      ];
      chain4.availableClasses = {};
      for (const cls of reshapeCandidates) {
        chain4.availableClasses[cls] = !!oc[cls];
      }

      // ── 4b. Introspect BRepTools_ReShape ─────────────────────────────────
      let reshapeInfo = {};
      let reshapeObj = null;
      let reshapeCtor = null;
      for (const ctorName of ['BRepTools_ReShape', 'BRepTools_ReShape_1']) {
        if (!oc[ctorName]) { reshapeInfo['missing_' + ctorName] = true; continue; }
        try {
          reshapeObj = new oc[ctorName]();
          reshapeCtor = ctorName + '()';
          break;
        } catch (e) {
          reshapeInfo['ctorErr_' + ctorName] = String(e).substring(0, 200);
        }
      }

      if (reshapeObj) {
        reshapeInfo.ctor = reshapeCtor;
        const methods = introspectMethods(reshapeObj).filter(m => !m.startsWith('$'));
        reshapeInfo.methods = methods;
        reshapeInfo.hasReplace = methods.some(m => m.toLowerCase().includes('replace'));
        reshapeInfo.hasApply   = methods.some(m => m.toLowerCase().includes('apply'));
        reshapeInfo.replaceMethods = methods.filter(m => m.toLowerCase().includes('replace'));
        reshapeInfo.applyMethods   = methods.filter(m => m.toLowerCase().includes('apply'));
        try { reshapeObj.delete(); } catch (_e) {}
        reshapeObj = null;
      }
      chain4.brepToolsReshapeInfo = reshapeInfo;

      // ── 4c. Introspect ShapeBuild_ReShape ─────────────────────────────────
      let shapeBuildInfo = {};
      for (const ctorName of ['ShapeBuild_ReShape', 'ShapeBuild_ReShape_1']) {
        if (!oc[ctorName]) { shapeBuildInfo['missing_' + ctorName] = true; continue; }
        try {
          const obj = new oc[ctorName]();
          shapeBuildInfo.ctor = ctorName + '()';
          const methods = introspectMethods(obj).filter(m => !m.startsWith('$'));
          shapeBuildInfo.methods = methods;
          shapeBuildInfo.hasReplace = methods.some(m => m.toLowerCase().includes('replace'));
          shapeBuildInfo.hasApply   = methods.some(m => m.toLowerCase().includes('apply'));
          shapeBuildInfo.replaceMethods = methods.filter(m => m.toLowerCase().includes('replace'));
          shapeBuildInfo.applyMethods   = methods.filter(m => m.toLowerCase().includes('apply'));
          try { obj.delete(); } catch (_e) {}
          break;
        } catch (e) {
          shapeBuildInfo['ctorErr_' + ctorName] = String(e).substring(0, 200);
        }
      }
      chain4.shapeBuildReshapeInfo = shapeBuildInfo;

      // ── 4d. Test: identity-copy face replacement ──────────────────────────
      const replaceTest = {};
      let testBox = null;
      let reshapeWorker = null;
      let faces = [];

      try {
        testBox = makeTranslatedBox(20, 20, 20, 0, 0, 0);
        replaceTest.boxBuilt = true;
        replaceTest.originalFaceCount = countFaces(testBox);

        // Collect faces
        faces = collectUniqueFaces(testBox);
        replaceTest.faceCount = faces.length;

        if (faces.length === 0) throw new Error('No faces found on box');

        // Make an identity copy of face[0]
        const origFace = faces[0];
        let copyFace = null;
        try {
          // Identity transform copy
          const trsf = new oc.gp_Trsf_1();
          const copyBuilder = new oc.BRepBuilderAPI_Transform_2(origFace, trsf, true);
          copyFace = copyBuilder.Shape();
          copyBuilder.delete();
          trsf.delete();
          replaceTest.copiedFace = true;
        } catch (e) {
          replaceTest.copyFaceErr = String(e).substring(0, 200);
        }

        // Determine which reshape class is available
        const reshapeCtorName = reshapeInfo.ctor
          ? reshapeInfo.ctor.replace('()', '')
          : (shapeBuildInfo.ctor ? shapeBuildInfo.ctor.replace('()', '') : null);

        const reshapeData = reshapeInfo.ctor ? reshapeInfo : shapeBuildInfo;

        if (!reshapeCtorName) {
          replaceTest.noReshapeClass = true;
          replaceTest.note = 'Neither BRepTools_ReShape nor ShapeBuild_ReShape available';
        } else if (copyFace) {
          reshapeWorker = new oc[reshapeCtorName]();
          replaceTest.reshapeCtor = reshapeCtorName + '()';

          // Try Replace(oldFace, newFace)
          let replaceOk = false;
          for (const rm of (reshapeData.replaceMethods || ['Replace', 'Replace_1', 'Replace_2'])) {
            if (typeof reshapeWorker[rm] !== 'function') continue;
            // Try 2-arg (old, new)
            try {
              reshapeWorker[rm](origFace, copyFace);
              replaceTest.replaceMethod = rm + '(face, copiedFace)';
              replaceOk = true;
              break;
            } catch (e) {
              replaceTest['replaceErr_' + rm + '_2arg'] = String(e).substring(0, 200);
            }
          }
          replaceTest.replaceOk = replaceOk;

          if (replaceOk) {
            // Try Apply(rootShape)
            let applyOk = false;
            let rewrittenShape = null;
            for (const am of (reshapeData.applyMethods || ['Apply', 'Apply_1', 'Apply_2'])) {
              if (typeof reshapeWorker[am] !== 'function') continue;
              // Try 1-arg
              try {
                rewrittenShape = reshapeWorker[am](testBox);
                replaceTest.applyMethod = am + '(testBox)';
                applyOk = true;
                break;
              } catch (e) {
                replaceTest['applyErr_' + am + '_1arg'] = String(e).substring(0, 200);
                // Try 2-arg: (shape, TopAbs_SHAPE or something)
                try {
                  const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
                  rewrittenShape = reshapeWorker[am](testBox, ANY);
                  replaceTest.applyMethod = am + '(testBox, TopAbs_SHAPE)';
                  applyOk = true;
                  break;
                } catch (e2) {
                  replaceTest['applyErr_' + am + '_2arg'] = String(e2).substring(0, 200);
                }
              }
            }
            replaceTest.applyOk = applyOk;

            if (applyOk && rewrittenShape) {
              try {
                replaceTest.rewrittenFaceCount = countFaces(rewrittenShape);
                replaceTest.rewrittenVolumeOk = Math.abs(volume(rewrittenShape) - 8000) < 100;
                rewrittenShape.delete();
                rewrittenShape = null;
              } catch (e) {
                replaceTest.measureErr = String(e).substring(0, 200);
                if (rewrittenShape) { try { rewrittenShape.delete(); } catch (_e) {} }
              }
            }
          }

          if (reshapeWorker) { try { reshapeWorker.delete(); } catch (_e) {} reshapeWorker = null; }
          if (copyFace) { try { copyFace.delete(); } catch (_e) {} copyFace = null; }
        }
      } catch (e) {
        replaceTest.outerErr = String(e).substring(0, 300);
      } finally {
        for (const f of faces) { try { f.delete(); } catch (_e) {} }
        if (testBox) { try { testBox.delete(); } catch (_e) {} }
        if (reshapeWorker) { try { reshapeWorker.delete(); } catch (_e) {} }
      }
      chain4.replaceTest = replaceTest;

      // ── Verdict ─────────────────────────────────────────────────────────────
      const reshapeAvailable   = !!(reshapeInfo.ctor || shapeBuildInfo.ctor);
      const replaceMethodFound  = reshapeAvailable && (reshapeInfo.hasReplace || shapeBuildInfo.hasReplace);
      const applyMethodFound    = reshapeAvailable && (reshapeInfo.hasApply   || shapeBuildInfo.hasApply);
      const replaceWorked       = !!(replaceTest.replaceOk);
      const applyWorked         = !!(replaceTest.applyOk);
      const rewrittenCorrect    = !!(replaceTest.rewrittenFaceCount === 6 && replaceTest.rewrittenVolumeOk);

      let verdict4;
      let verdictReason4;
      if (reshapeAvailable && replaceWorked && applyWorked && rewrittenCorrect) {
        verdict4 = 'REACHABLE';
        verdictReason4 = `${replaceTest.reshapeCtor} + ${replaceTest.replaceMethod} + ${replaceTest.applyMethod} → ${replaceTest.rewrittenFaceCount} faces, vol≈8000 ✓`;
      } else if (reshapeAvailable && replaceWorked && !applyWorked) {
        verdict4 = 'NOT_REACHABLE';
        verdictReason4 = `${replaceTest.reshapeCtor} constructible, Replace OK, but Apply failed`;
      } else if (reshapeAvailable && !replaceWorked) {
        verdict4 = 'NOT_REACHABLE';
        verdictReason4 = `${reshapeInfo.ctor || shapeBuildInfo.ctor} constructible but Replace(old,new) failed; methods: ${JSON.stringify((reshapeInfo.replaceMethods || shapeBuildInfo.replaceMethods || []))}`;
      } else {
        verdict4 = 'NOT_REACHABLE';
        verdictReason4 = 'Neither BRepTools_ReShape nor ShapeBuild_ReShape constructible in this build';
      }

      result.cap4_faceReplacement = {
        verdict: verdict4,
        verdictReason: verdictReason4,
        reshapeAvailable,
        replaceMethodFound,
        applyMethodFound,
        replaceWorked,
        applyWorked,
        rewrittenFaceCount: replaceTest.rewrittenFaceCount || null,
        reshapeClass: replaceTest.reshapeCtor || null,
        replaceMethod: replaceTest.replaceMethod || null,
        applyMethod: replaceTest.applyMethod || null,
        brepToolsReshapeInfo: reshapeInfo,
        shapeBuildReshapeInfo: shapeBuildInfo,
        chain: chain4,
        note: 'Face replacement. REACHABLE = ReShape ctor + Replace(old,new) + Apply(root) → valid 6-face solid.',
      };

    } catch (e) {
      result.cap4_faceReplacement = { verdict: 'NOT_REACHABLE', error: String(e) };
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    result._summary = {
      cap1_multiArgBoolean:  result.cap1_multiArgBoolean.verdict,
      cap2_fuzzyBoolean:     result.cap2_fuzzyBoolean.verdict,
      cap3_latticeBatch:     result.cap3_latticeBatch.verdict,
      cap4_faceReplacement:  result.cap4_faceReplacement.verdict,
      cap1_adjacentVolume:   result.cap1_multiArgBoolean.adjacentActual,
      cap1_overlapVolume:    result.cap1_multiArgBoolean.overlapActual,
      cap2_fuzzyMethod:      result.cap2_fuzzyBoolean.usedFuzzyMethod,
      cap3_timingMs:         result.cap3_latticeBatch.timingMs,
      cap4_reshapeClass:     result.cap4_faceReplacement.reshapeClass,
      note: 'Sub-project B recon — verdicts recorded. GREEN means investigation complete, not all REACHABLE.',
      package: 'opencascade.js@2.0.0-beta.b5ff984',
    };

    return result;
  });

  // ── Write JSON output ────────────────────────────────────────────────────────
  const notesDir = path.join(__dirname, '..', 'docs', 'superpowers', 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
  const jsonPath = path.join(notesDir, 'kernel-api-B-recon.json');
  fs.writeFileSync(jsonPath, JSON.stringify(verified, null, 2));
  console.log('B RECON RESULT:', JSON.stringify(verified._summary, null, 2));
  console.log('B RECON FULL:', JSON.stringify(verified, null, 2));

  // ── Assertions ────────────────────────────────────────────────────────────────
  // Spec PASSES green meaning "investigation complete, each capability has a verdict".
  // A documented NOT_REACHABLE is a correct outcome.

  const validVerdicts = ['REACHABLE', 'NOT_REACHABLE', 'PARTIALLY_REACHABLE'];

  expect(
    validVerdicts.includes(verified.cap1_multiArgBoolean.verdict),
    `cap1_multiArgBoolean must have a recorded verdict, got: ${JSON.stringify(verified.cap1_multiArgBoolean.verdict)}`
  ).toBe(true);

  expect(
    validVerdicts.includes(verified.cap2_fuzzyBoolean.verdict),
    `cap2_fuzzyBoolean must have a recorded verdict, got: ${JSON.stringify(verified.cap2_fuzzyBoolean.verdict)}`
  ).toBe(true);

  expect(
    validVerdicts.includes(verified.cap3_latticeBatch.verdict),
    `cap3_latticeBatch must have a recorded verdict, got: ${JSON.stringify(verified.cap3_latticeBatch.verdict)}`
  ).toBe(true);

  expect(
    validVerdicts.includes(verified.cap4_faceReplacement.verdict),
    `cap4_faceReplacement must have a recorded verdict, got: ${JSON.stringify(verified.cap4_faceReplacement.verdict)}`
  ).toBe(true);

  // Summary must exist and have all 4 cap fields
  expect(verified._summary, 'summary must exist').toBeTruthy();
  expect(verified._summary.cap1_multiArgBoolean, 'summary.cap1 must be present').toBeTruthy();
  expect(verified._summary.cap2_fuzzyBoolean,    'summary.cap2 must be present').toBeTruthy();
  expect(verified._summary.cap3_latticeBatch,    'summary.cap3 must be present').toBeTruthy();
  expect(verified._summary.cap4_faceReplacement, 'summary.cap4 must be present').toBeTruthy();

  expect(pageErrors).toEqual([]);
  await app.close();
});
