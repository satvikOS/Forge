/**
 * brep-a4-recon-electron.spec.js
 *
 * Phase A4 empirical kernel API reconnaissance — Geometry Simplification.
 * Empirically determines the COMPLETE working call sequence for:
 *
 *   1. Build a fused two-box bar with an internal seam:
 *      - Box A: MakeBox_2(20,20,20) at origin
 *      - Box B: MakeBox_2(20,20,20) translated by (20,0,0) — abuts A face-to-face
 *      - Fuse A+B via BRepAlgoAPI_Fuse_3 + .Build() + .Shape()
 *      - Measure fused bar: faces, unique edges (dedup via IsSame), volume
 *      - Expected: 40×20×20 bar, volume ≈ 16000; faces/edges may reflect seam
 *
 *   2. ShapeUpgrade_UnifySameDomain — simplify the fused bar (remove seam):
 *      - Introspect constructor overloads (_1, _2, undecorated)
 *      - Call .Build()
 *      - Read result via .Shape() or alternative
 *      - Verify: volume preserved (≈ 16000 ± 0.1%); face/edge count ≤ fused bar
 *
 *   3. (Optional) ShapeFix_Shape — brief check if constructible + Perform + Shape work
 *
 * Writes:  docs/superpowers/notes/kernel-api-A4-recon.json
 * Pattern: e2e/brep-a3-recon-electron.spec.js
 * Package: opencascade.js@2.0.0-beta.b5ff984
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.setTimeout(600000);

test('Phase A4 — kernel API recon (geometry simplification)', async () => {
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

    /** Build a box (A0/A1 verified). Returns TopoDS_Shape — caller must .delete(). */
    function makeBoxShape(dx, dy, dz) {
      const m = new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz);
      const s = m.Shape();
      m.delete();
      return s;
    }

    /**
     * Translate a shape by (dx, dy, dz).
     * Returns the transformed TopoDS_Shape — caller must .delete().
     * Verified in A3: gp_Trsf_1() + SetTranslation_1(gp_Vec_4) + BRepBuilderAPI_Transform_2.
     */
    function translateShape(shape, dx, dy, dz) {
      const trsf = new oc.gp_Trsf_1();
      const vec  = new oc.gp_Vec_4(dx, dy, dz);
      trsf.SetTranslation_1(vec);
      vec.delete();
      const xform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, false);
      const result = xform.Shape();
      xform.delete();
      trsf.delete();
      return result;
    }

    /**
     * Count faces of a shape using TopExp_Explorer_2.
     * Returns number of faces.
     */
    function countFaces(shape) {
      const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
      const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
      let count = 0;
      const exp = new oc.TopExp_Explorer_2(shape, FACE, ANY);
      for (; exp.More(); exp.Next()) {
        const f = oc.TopoDS.Face_1(exp.Current());
        count++;
        f.delete();
      }
      exp.delete();
      return count;
    }

    /**
     * Count UNIQUE edges of a shape using TopExp_Explorer_2 + IsSame dedup.
     * Returns number of unique edges.
     */
    function countUniqueEdges(shape) {
      const EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;
      const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
      const edges = [];
      const exp = new oc.TopExp_Explorer_2(shape, EDGE, ANY);
      for (; exp.More(); exp.Next()) {
        const e = exp.Current();
        // Dedup: check if any existing edge IsSame
        let found = false;
        for (const prev of edges) {
          try {
            if (prev.IsSame(e)) { found = true; break; }
          } catch (_err) {}
        }
        if (!found) {
          // Store a reference — but Current() returns an internal reference
          // We need to cast it to get an independent edge shape
          try {
            const edgeCopy = oc.TopoDS.Edge_1(e);
            edges.push(edgeCopy);
          } catch (_err) {
            edges.push(e);
          }
        }
      }
      exp.delete();
      // Cleanup stored edge copies
      for (const e of edges) {
        try { e.delete(); } catch (_err) {}
      }
      return edges.length;
    }

    /**
     * Introspect all own + prototype property names of an object.
     */
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
    // Item 1 — Build the fused two-box bar with an internal seam
    //
    //   Box A: MakeBox_2(20,20,20) at origin
    //   Box B: MakeBox_2(20,20,20) translated by (20,0,0) — abuts A face-to-face
    //   Fuse: BRepAlgoAPI_Fuse_3(a, b, pr) + .Build(pr2) + .Shape()
    //
    //   Measure: fusedFaceCount, fusedEdgeCount, fusedVolume
    //   Expected: volume ≈ 16000; faces > 6 if seam retained, possibly = 6 if fuse cleans up
    // ══════════════════════════════════════════════════════════════════════════
    let fusedShape = null;  // kept alive for item 2

    try {
      const chain1 = {};

      // Introspect BRepAlgoAPI_Fuse constructors
      const fuseKeys = ocKeys.filter(k => k.startsWith('BRepAlgoAPI_Fuse'));
      chain1.fuseKeys = fuseKeys;

      // Build box A at origin
      const boxA = makeBoxShape(20, 20, 20);
      chain1.boxABuilt = true;

      // Build box B at (20,0,0) — abuts A face-to-face
      const boxBraw = makeBoxShape(20, 20, 20);
      const boxB = translateShape(boxBraw, 20, 0, 0);
      boxBraw.delete();
      chain1.boxBBuilt = true;

      // Verify box B bbox: min.X should be ≈ 20
      {
        const bb = new oc.Bnd_Box_1();
        oc.BRepBndLib.Add(boxB, bb, false);
        const mn = bb.CornerMin();
        chain1.boxBMinX = mn.X();
        mn.delete(); bb.delete();
      }

      // Fuse A + B using BRepAlgoAPI_Fuse_3(a, b, pr) (verified in A2/A3 pattern)
      let fuseObj = null;
      let fuseCtor = null;
      let fuseError = null;

      // Try _3 first (verified overload from notes), then alternatives
      for (const attempt of [
        { suffix: '_3', args: () => {
            const pr = new oc.Message_ProgressRange_1();
            const f = new oc.BRepAlgoAPI_Fuse_3(boxA, boxB, pr);
            pr.delete();
            return f;
          }, label: 'BRepAlgoAPI_Fuse_3(a,b,pr)' },
        { suffix: '_2', args: () => {
            const f = new oc.BRepAlgoAPI_Fuse_2(boxA, boxB);
            return f;
          }, label: 'BRepAlgoAPI_Fuse_2(a,b)' },
        { suffix: '_1', args: () => {
            const f = new oc.BRepAlgoAPI_Fuse_1();
            return f;
          }, label: 'BRepAlgoAPI_Fuse_1()' },
        { suffix: '', args: () => {
            const pr = new oc.Message_ProgressRange_1();
            const f = new oc.BRepAlgoAPI_Fuse(boxA, boxB, pr);
            pr.delete();
            return f;
          }, label: 'BRepAlgoAPI_Fuse(a,b,pr)' },
      ]) {
        if (!oc['BRepAlgoAPI_Fuse' + attempt.suffix] && attempt.suffix !== '') continue;
        try {
          fuseObj = attempt.args();
          fuseCtor = attempt.label;
          break;
        } catch (e) {
          chain1['fuseCtorErr_' + attempt.suffix] = String(e).substring(0, 150);
        }
      }

      chain1.fuseCtor = fuseCtor;

      if (fuseObj) {
        // Call .Build(pr)
        let buildOk = false;
        for (const buildM of ['Build', 'Build_1']) {
          if (typeof fuseObj[buildM] !== 'function') continue;
          try {
            const prBuild = new oc.Message_ProgressRange_1();
            fuseObj[buildM](prBuild);
            prBuild.delete();
            chain1.buildMethod = buildM + '(pr)';
            buildOk = true;
            break;
          } catch (e) {
            chain1['buildErr_' + buildM + '_pr'] = String(e).substring(0, 120);
            try {
              fuseObj[buildM]();
              chain1.buildMethod = buildM + '()';
              buildOk = true;
              break;
            } catch (e2) {
              chain1['buildErr_' + buildM + '_noarg'] = String(e2).substring(0, 120);
            }
          }
        }
        chain1.buildOk = buildOk;

        // Check IsDone
        let isDone = false;
        try { isDone = fuseObj.IsDone(); } catch (_e) {}
        chain1.isDone = isDone;

        // Read fused shape
        if (buildOk || isDone) {
          let shapeReadOk = false;
          for (const shapeM of ['Shape', 'Shape_1']) {
            if (typeof fuseObj[shapeM] !== 'function') continue;
            try {
              fusedShape = fuseObj[shapeM]();
              chain1.shapeMethod = shapeM + '()';
              shapeReadOk = true;
              break;
            } catch (e) {
              chain1['shapeErr_' + shapeM] = String(e).substring(0, 120);
            }
          }
          chain1.shapeReadOk = shapeReadOk;
        }

        fuseObj.delete();
      } else {
        chain1.fuseError = 'No Fuse constructor succeeded';
      }

      // Measure fused shape
      if (fusedShape) {
        // Volume
        try {
          const vol = volume(fusedShape);
          chain1.fusedVolume = vol;
        } catch (e) {
          chain1.volumeErr = String(e).substring(0, 120);
        }

        // Face count
        try {
          const fc = countFaces(fusedShape);
          chain1.fusedFaceCount = fc;
        } catch (e) {
          chain1.faceCountErr = String(e).substring(0, 120);
        }

        // Unique edge count
        try {
          const ec = countUniqueEdges(fusedShape);
          chain1.fusedEdgeCount = ec;
        } catch (e) {
          chain1.edgeCountErr = String(e).substring(0, 120);
        }

        // Note about seam retention
        if (chain1.fusedFaceCount !== undefined && chain1.fusedEdgeCount !== undefined) {
          if (chain1.fusedFaceCount > 6) {
            chain1.seamNote = 'Seam RETAINED: faces > 6 (internal seam face present)';
          } else if (chain1.fusedFaceCount === 6) {
            chain1.seamNote = 'Seam REMOVED by fuse: exactly 6 faces (clean box result) — simplification has less to do';
          } else {
            chain1.seamNote = 'Unexpected face count: ' + chain1.fusedFaceCount;
          }
        }
      }

      boxA.delete();
      boxB.delete();

      const vol = chain1.fusedVolume;
      const volOk = vol !== undefined && Math.abs(vol - 16000) < 16; // 0.1%
      const faceOk = chain1.fusedFaceCount !== undefined;
      const edgeOk = chain1.fusedEdgeCount !== undefined;

      result.item1_fusedBar = {
        confirmed: fusedShape !== null && volOk && faceOk && edgeOk,
        fuseCtor: chain1.fuseCtor,
        buildMethod: chain1.buildMethod,
        shapeMethod: chain1.shapeMethod,
        fusedVolume: chain1.fusedVolume,
        fusedFaceCount: chain1.fusedFaceCount,
        fusedEdgeCount: chain1.fusedEdgeCount,
        volumeWithinTol: volOk,
        seamNote: chain1.seamNote,
        chain: chain1,
        note: 'Box A(20³) fused with Box B(20³) at (20,0,0). Expected vol≈16000. Faces may retain internal seam.',
      };
    } catch (e) {
      result.item1_fusedBar = { confirmed: false, error: String(e), fusedShape: null };
      // Don't keep fusedShape if we errored
      try { if (fusedShape) fusedShape.delete(); } catch (_e) {}
      fusedShape = null;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 2 — ShapeUpgrade_UnifySameDomain — the simplification op
    //
    //   Constructor candidates: _2(shape, unifyEdges, unifyFaces, concatBSplines)
    //                            _1(shape)  or  undecorated
    //   Then call .Build()
    //   Then read result via .Shape()
    //
    //   Run on fusedShape from item 1.
    //   Confirm: volume preserved (≈ 16000 ± 0.1%); face/edge ≤ fused bar counts.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain2 = {};

      // Introspect available ShapeUpgrade_UnifySameDomain keys
      const unifySameDomainKeys = ocKeys.filter(k => k.startsWith('ShapeUpgrade_UnifySameDomain'));
      chain2.unifySameDomainKeys = unifySameDomainKeys;

      // Also scan for related simplification classes
      const shapeUpgradeKeys = ocKeys.filter(k => k.startsWith('ShapeUpgrade')).slice(0, 30);
      chain2.shapeUpgradeKeys = shapeUpgradeKeys;

      if (!fusedShape) {
        result.item2_unifySameDomain = {
          confirmed: false,
          error: 'fusedShape from item 1 is null — cannot run item 2',
          NOT_CONFIRMED_NOTE: 'Item 1 must succeed to provide the fused bar for simplification',
        };
      } else {
        let unifyObj = null;
        let unifyCtor = null;
        let unifyCtorFound = false;

        // Try constructor overloads in priority order:
        // _2(shape, unifyEdges, unifyFaces, concatBSplines) — most specific
        // _1(shape) — simpler
        // undecorated(shape) — bare name
        // Also try some alternative names if all fail
        const ctorAttempts = [
          {
            cls: 'ShapeUpgrade_UnifySameDomain_2',
            makeArgs: () => [fusedShape, true, true, false],
            label: 'ShapeUpgrade_UnifySameDomain_2(shape, true, true, false)',
          },
          {
            cls: 'ShapeUpgrade_UnifySameDomain_1',
            makeArgs: () => [fusedShape],
            label: 'ShapeUpgrade_UnifySameDomain_1(shape)',
          },
          {
            cls: 'ShapeUpgrade_UnifySameDomain',
            makeArgs: () => [fusedShape, true, true, false],
            label: 'ShapeUpgrade_UnifySameDomain(shape, true, true, false)',
          },
          {
            cls: 'ShapeUpgrade_UnifySameDomain',
            makeArgs: () => [fusedShape],
            label: 'ShapeUpgrade_UnifySameDomain(shape)',
          },
          {
            cls: 'ShapeUpgrade_UnifySameDomain_3',
            makeArgs: () => [fusedShape, true, true, false],
            label: 'ShapeUpgrade_UnifySameDomain_3(shape, true, true, false)',
          },
          {
            cls: 'ShapeUpgrade_UnifySameDomain_3',
            makeArgs: () => [fusedShape],
            label: 'ShapeUpgrade_UnifySameDomain_3(shape)',
          },
        ];

        for (const attempt of ctorAttempts) {
          if (!oc[attempt.cls]) {
            chain2['ctorMissing_' + attempt.cls] = true;
            continue;
          }
          try {
            unifyObj = new oc[attempt.cls](...attempt.makeArgs());
            unifyCtor = attempt.label;
            unifyCtorFound = true;
            break;
          } catch (e) {
            chain2['ctorErr_' + attempt.label.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 50)] =
              String(e).substring(0, 150);
          }
        }

        chain2.unifyCtor = unifyCtor;
        chain2.unifyCtorFound = unifyCtorFound;

        // If no constructor found, try to introspect what IS available
        if (!unifyObj) {
          // Try to construct a no-arg version and Initialize() it
          for (const cls of ['ShapeUpgrade_UnifySameDomain_1', 'ShapeUpgrade_UnifySameDomain', 'ShapeUpgrade_UnifySameDomain_2']) {
            if (!oc[cls]) continue;
            try {
              unifyObj = new oc[cls]();
              unifyCtor = cls + '()';
              unifyCtorFound = true;
              chain2.noArgCtor = cls + '()';
              break;
            } catch (e) {
              chain2['noArgCtorErr_' + cls] = String(e).substring(0, 150);
            }
          }

          // If we got a no-arg, try Initialize(shape, ...)
          if (unifyObj) {
            const methods = introspectMethods(unifyObj);
            chain2.unifyMethods = methods.filter(m =>
              !m.startsWith('$') && !['constructor', 'delete', 'isDeleted'].includes(m)
            ).slice(0, 40);
            const initMethods = methods.filter(m => m.toLowerCase().includes('init') || m.toLowerCase().includes('shape'));
            chain2.initMethods = initMethods;

            for (const initM of ['Initialize', 'Initialize_1', 'Init', 'SetShape', 'SetInput']) {
              if (typeof unifyObj[initM] !== 'function') continue;
              try {
                unifyObj[initM](fusedShape, true, true, false);
                chain2.initMethod = initM + '(shape, true, true, false)';
                break;
              } catch (e) {
                try {
                  unifyObj[initM](fusedShape);
                  chain2.initMethod = initM + '(shape)';
                  break;
                } catch (e2) {
                  chain2['initErr_' + initM] = String(e2).substring(0, 120);
                }
              }
            }
          }
        }

        let simplifiedShape = null;
        let buildOk = false;
        let shapeReadOk = false;
        let simplifiedVolume = null;
        let simplifiedFaceCount = null;
        let simplifiedEdgeCount = null;

        if (unifyObj) {
          // Introspect all methods
          const methods = introspectMethods(unifyObj);
          chain2.unifyMethods = chain2.unifyMethods || methods.filter(m =>
            !m.startsWith('$') && !['constructor', 'delete', 'isDeleted'].includes(m)
          ).slice(0, 40);

          // Call .Build()
          for (const buildM of ['Build', 'Build_1', 'Perform', 'Perform_1']) {
            if (typeof unifyObj[buildM] !== 'function') continue;
            try {
              unifyObj[buildM]();
              chain2.buildMethod = buildM + '()';
              buildOk = true;
              break;
            } catch (e) {
              chain2['buildErr_' + buildM + '_noarg'] = String(e).substring(0, 120);
              // Try with progress range
              try {
                const pr = new oc.Message_ProgressRange_1();
                unifyObj[buildM](pr);
                pr.delete();
                chain2.buildMethod = buildM + '(pr)';
                buildOk = true;
                break;
              } catch (e2) {
                chain2['buildErr_' + buildM + '_pr'] = String(e2).substring(0, 120);
              }
            }
          }
          chain2.buildOk = buildOk;

          // Read result shape
          if (buildOk) {
            for (const shapeM of ['Shape', 'Shape_1', 'GetResult', 'Result', 'OutShape']) {
              if (typeof unifyObj[shapeM] !== 'function') continue;
              try {
                simplifiedShape = unifyObj[shapeM]();
                chain2.shapeMethod = shapeM + '()';
                shapeReadOk = true;
                break;
              } catch (e) {
                chain2['shapeErr_' + shapeM] = String(e).substring(0, 120);
              }
            }
          }
          chain2.shapeReadOk = shapeReadOk;

          // Measure simplified shape
          if (simplifiedShape) {
            try {
              simplifiedVolume = volume(simplifiedShape);
              chain2.simplifiedVolume = simplifiedVolume;
            } catch (e) {
              chain2.simplifiedVolumeErr = String(e).substring(0, 120);
            }

            try {
              simplifiedFaceCount = countFaces(simplifiedShape);
              chain2.simplifiedFaceCount = simplifiedFaceCount;
            } catch (e) {
              chain2.simplifiedFaceCountErr = String(e).substring(0, 120);
            }

            try {
              simplifiedEdgeCount = countUniqueEdges(simplifiedShape);
              chain2.simplifiedEdgeCount = simplifiedEdgeCount;
            } catch (e) {
              chain2.simplifiedEdgeCountErr = String(e).substring(0, 120);
            }

            simplifiedShape.delete();
          }

          unifyObj.delete();
        }

        // Assess results
        const fusedFaceCount = result.item1_fusedBar.fusedFaceCount;
        const fusedEdgeCount = result.item1_fusedBar.fusedEdgeCount;
        const fusedVolume = result.item1_fusedBar.fusedVolume;

        const volOk2 = simplifiedVolume !== null &&
                       Math.abs(simplifiedVolume - 16000) < 16; // 0.1%
        const faceReduced = simplifiedFaceCount !== null && fusedFaceCount !== null &&
                            simplifiedFaceCount <= fusedFaceCount;
        const edgeReduced = simplifiedEdgeCount !== null && fusedEdgeCount !== null &&
                            simplifiedEdgeCount <= fusedEdgeCount;
        const cleanResult = simplifiedFaceCount === 6 && simplifiedEdgeCount === 12;

        // Before vs after summary
        const beforeAfter = {
          before: {
            faces: fusedFaceCount,
            edges: fusedEdgeCount,
            volume: fusedVolume,
          },
          after: {
            faces: simplifiedFaceCount,
            edges: simplifiedEdgeCount,
            volume: simplifiedVolume,
          },
        };

        result.item2_unifySameDomain = {
          confirmed: unifyCtorFound && buildOk && shapeReadOk && volOk2,
          unifyCtor,
          buildMethod: chain2.buildMethod,
          shapeMethod: chain2.shapeMethod,
          simplifiedVolume,
          simplifiedFaceCount,
          simplifiedEdgeCount,
          volumePreserved: volOk2,
          facesReduced: faceReduced,
          edgesReduced: edgeReduced,
          cleanBoxResult: cleanResult,
          beforeAfter,
          NOT_CONFIRMED_NOTE: (!unifyCtorFound)
            ? 'ShapeUpgrade_UnifySameDomain constructor not found or failed — see chain for details'
            : (!buildOk)
            ? 'Build() not callable on ShapeUpgrade_UnifySameDomain instance'
            : (!shapeReadOk)
            ? 'Shape() not callable on ShapeUpgrade_UnifySameDomain after Build()'
            : (!volOk2)
            ? 'Volume not preserved after simplification'
            : null,
          chain: chain2,
          note: 'ShapeUpgrade_UnifySameDomain simplifies fused bar. Volume must be preserved; faces/edges should be reduced.',
        };
      }
    } catch (e) {
      result.item2_unifySameDomain = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 3 — (Optional) ShapeFix_Shape — brief check
    //
    //   Try new oc.ShapeFix_Shape_2(shape) or _1(shape) — Perform + Shape
    //   Just record what's reachable — don't spend long here.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain3 = {};

      const shapefixKeys = ocKeys.filter(k => k.startsWith('ShapeFix_Shape'));
      chain3.shapefixKeys = shapefixKeys;

      if (shapefixKeys.length === 0) {
        result.item3_shapefixShape = {
          confirmed: false,
          status: 'SKIPPED — ShapeFix_Shape not found in oc namespace',
          chain: chain3,
          note: 'ShapeFix_Shape keys not present in opencascade.js@2.0.0-beta.b5ff984',
        };
      } else if (!fusedShape) {
        result.item3_shapefixShape = {
          confirmed: false,
          status: 'SKIPPED — no fusedShape available',
          chain: chain3,
        };
      } else {
        // Make a fresh test box to avoid interfering with fusedShape
        const testBox = makeBoxShape(10, 10, 10);

        let sfObj = null;
        let sfCtor = null;

        // Try constructor variants
        for (const attempt of [
          { cls: 'ShapeFix_Shape_2', makeArgs: () => [testBox], label: 'ShapeFix_Shape_2(shape)' },
          { cls: 'ShapeFix_Shape_1', makeArgs: () => [testBox], label: 'ShapeFix_Shape_1(shape)' },
          { cls: 'ShapeFix_Shape',   makeArgs: () => [testBox], label: 'ShapeFix_Shape(shape)' },
          { cls: 'ShapeFix_Shape_1', makeArgs: () => [],        label: 'ShapeFix_Shape_1()' },
          { cls: 'ShapeFix_Shape',   makeArgs: () => [],        label: 'ShapeFix_Shape()' },
        ]) {
          if (!oc[attempt.cls]) {
            chain3['ctorMissing_' + attempt.cls] = true;
            continue;
          }
          try {
            sfObj = new oc[attempt.cls](...attempt.makeArgs());
            sfCtor = attempt.label;
            break;
          } catch (e) {
            chain3['ctorErr_' + attempt.label.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 40)] =
              String(e).substring(0, 150);
          }
        }

        chain3.sfCtor = sfCtor;

        let performOk = false;
        let shapeOk = false;
        let sfShape = null;

        if (sfObj) {
          const methods = introspectMethods(sfObj);
          chain3.sfMethods = methods.filter(m =>
            !m.startsWith('$') && !['constructor', 'delete', 'isDeleted'].includes(m)
          ).slice(0, 30);

          // Try Perform — ShapeFix_Shape.Perform may need a progress range
          for (const performM of ['Perform', 'Perform_1']) {
            if (typeof sfObj[performM] !== 'function') continue;
            // Try with progress range first (the error showed it wants 1 arg)
            try {
              const pr = new oc.Message_ProgressRange_1();
              sfObj[performM](pr);
              pr.delete();
              chain3.performMethod = performM + '(pr)';
              performOk = true;
              break;
            } catch (e) {
              chain3['performErr_' + performM + '_pr'] = String(e).substring(0, 120);
            }
            // Also try no-arg
            try {
              sfObj[performM]();
              chain3.performMethod = performM + '()';
              performOk = true;
              break;
            } catch (e) {
              chain3['performErr_' + performM + '_noarg'] = String(e).substring(0, 120);
            }
          }

          // Try Shape
          if (performOk) {
            for (const shapeM of ['Shape', 'Shape_1']) {
              if (typeof sfObj[shapeM] !== 'function') continue;
              try {
                sfShape = sfObj[shapeM]();
                chain3.shapeMethod = shapeM + '()';
                shapeOk = true;
                break;
              } catch (e) {
                chain3['shapeErr_' + shapeM] = String(e).substring(0, 120);
              }
            }
          }

          if (sfShape) {
            try {
              const vol = volume(sfShape);
              chain3.sfVolume = vol;
            } catch (_e) {}
            sfShape.delete();
          }

          sfObj.delete();
        }

        testBox.delete();

        result.item3_shapefixShape = {
          confirmed: sfCtor !== null && performOk && shapeOk,
          sfCtor,
          performMethod: chain3.performMethod,
          shapeMethod: chain3.shapeMethod,
          performOk,
          shapeOk,
          chain: chain3,
          note: 'Optional check — ShapeFix_Shape constructible + Perform + Shape',
        };
      }
    } catch (e) {
      result.item3_shapefixShape = { confirmed: false, error: String(e) };
    }

    // ── Cleanup fused shape (used across items 1 & 2) ──────────────────────────
    if (fusedShape) {
      try { fusedShape.delete(); } catch (_e) {}
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    result._summary = {
      item1_fusedBar: result.item1_fusedBar.confirmed ? 'CONFIRMED' : 'NOT CONFIRMED',
      item2_unifySameDomain: result.item2_unifySameDomain.confirmed ? 'CONFIRMED' : 'NOT CONFIRMED',
      item3_shapefixShape: result.item3_shapefixShape.confirmed ? 'CONFIRMED' : 'NOT CONFIRMED',
      beforeAfter: result.item2_unifySameDomain.beforeAfter || null,
    };

    return result;
  });

  // ── Write JSON output ────────────────────────────────────────────────────────
  const notesDir = path.join(__dirname, '..', 'docs', 'superpowers', 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
  const jsonPath = path.join(notesDir, 'kernel-api-A4-recon.json');
  fs.writeFileSync(jsonPath, JSON.stringify(verified, null, 2));
  console.log('A4 RECON RESULT:', JSON.stringify(verified, null, 2));

  // ── Assertions ────────────────────────────────────────────────────────────────

  // Item 1: Fused bar must be built, volume confirmed, face/edge counts recorded
  expect(verified.item1_fusedBar.confirmed,
    `item1 fused bar: ${verified.item1_fusedBar.error || JSON.stringify({
      fuseCtor: verified.item1_fusedBar.fuseCtor,
      buildMethod: verified.item1_fusedBar.buildMethod,
      shapeMethod: verified.item1_fusedBar.shapeMethod,
      fusedVolume: verified.item1_fusedBar.fusedVolume,
      fusedFaceCount: verified.item1_fusedBar.fusedFaceCount,
      fusedEdgeCount: verified.item1_fusedBar.fusedEdgeCount,
      chain: verified.item1_fusedBar.chain,
    })}`).toBe(true);

  // Volume must be within 0.1% of 16000
  expect(verified.item1_fusedBar.volumeWithinTol,
    `fused bar volume=${verified.item1_fusedBar.fusedVolume} expected≈16000 (±16)`).toBe(true);

  // Item 2: ShapeUpgrade_UnifySameDomain — confirmed means: ctor + build + shape read + vol preserved
  expect(verified.item2_unifySameDomain.confirmed,
    `item2 ShapeUpgrade_UnifySameDomain: ${verified.item2_unifySameDomain.error || JSON.stringify({
      unifyCtor: verified.item2_unifySameDomain.unifyCtor,
      buildMethod: verified.item2_unifySameDomain.buildMethod,
      shapeMethod: verified.item2_unifySameDomain.shapeMethod,
      simplifiedVolume: verified.item2_unifySameDomain.simplifiedVolume,
      simplifiedFaceCount: verified.item2_unifySameDomain.simplifiedFaceCount,
      simplifiedEdgeCount: verified.item2_unifySameDomain.simplifiedEdgeCount,
      NOT_CONFIRMED_NOTE: verified.item2_unifySameDomain.NOT_CONFIRMED_NOTE,
      chain: verified.item2_unifySameDomain.chain,
    })}`).toBe(true);

  // Volume must be preserved (within 0.1%)
  expect(verified.item2_unifySameDomain.volumePreserved,
    `simplified volume=${verified.item2_unifySameDomain.simplifiedVolume} must be≈16000 (±16)`).toBe(true);

  // Faces and edges must not increase
  expect(verified.item2_unifySameDomain.facesReduced,
    `simplifiedFaces=${verified.item2_unifySameDomain.simplifiedFaceCount} must be ≤ fusedFaces=${verified.item1_fusedBar.fusedFaceCount}`).toBe(true);

  expect(verified.item2_unifySameDomain.edgesReduced,
    `simplifiedEdges=${verified.item2_unifySameDomain.simplifiedEdgeCount} must be ≤ fusedEdges=${verified.item1_fusedBar.fusedEdgeCount}`).toBe(true);

  // Item 3: optional — just check it ran (no hard fail)
  // (it may be 'SKIPPED' which is fine — not a blocker)
  expect(verified.item3_shapefixShape,
    'item3 must have a result object (even if skipped)').toBeTruthy();

  expect(pageErrors).toEqual([]);
  await app.close();
});
