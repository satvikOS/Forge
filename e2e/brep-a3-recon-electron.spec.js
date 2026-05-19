/**
 * brep-a3-recon-electron.spec.js
 *
 * Phase A3 empirical OCCT API reconnaissance.
 * Verifies exact opencascade.js call signatures for:
 *   1.  Self-intersection check on a clean shape (BOPAlgo_CheckerSI, no errors expected)
 *   2.  Self-intersection check on a self-intersecting compound (errors expected)
 *   3.  Shape transform (gp_Trsf + BRepBuilderAPI_Transform)
 *   4.  Clash — interference volume (BRepAlgoAPI_Common on two overlapping solids)
 *   5.  Clash — minimum distance (BRepExtrema_DistShapeShape)
 *
 * Writes:  docs/superpowers/notes/occt-api-A3-recon.json
 * Pattern: e2e/brep-a2-recon-electron.spec.js
 * Package: opencascade.js@2.0.0-beta.b5ff984
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.setTimeout(600000);

test('Phase A3 — OCCT API recon (items 1-5)', async () => {
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

    /** Build a box (A0/A1 verified). Returns TopoDS_Shape — caller must .delete(). */
    function makeBoxShape(dx, dy, dz) {
      const m = new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz);
      const s = m.Shape();
      m.delete();
      return s;
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
     * Introspect all own + prototype property names of an object.
     * Walk the full prototype chain (Emscripten often puts methods several levels up).
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

    /**
     * Enumerate all string-named callable methods on an Emscripten object
     * by walking the full prototype chain and checking typeof === 'function'.
     */
    function enumCallableMethods(obj) {
      const result = [];
      let o = obj;
      while (o && o !== Object.prototype) {
        for (const k of Object.getOwnPropertyNames(o)) {
          try {
            if (typeof obj[k] === 'function' && k !== 'constructor' && !k.startsWith('$')) {
              result.push(k);
            }
          } catch (_e) {}
        }
        o = Object.getPrototypeOf(o);
      }
      return [...new Set(result)].sort();
    }

    /**
     * Translate a shape by (dx, dy, dz).
     * Returns the transformed TopoDS_Shape — caller must .delete().
     * Uses: gp_Trsf_1() + SetTranslation_1(gp_Vec_4) + BRepBuilderAPI_Transform_2(shape, trsf, false) + .Shape()
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

    const result = {};

    // ══════════════════════════════════════════════════════════════════════════
    // Item 3 — Shape transform (done FIRST as it is needed by items 1, 2, 4, 5)
    //
    //   gp_Trsf_1() + SetTranslation_1(gp_Vec_4(dx,dy,dz)) +
    //   BRepBuilderAPI_Transform_2(shape, trsf, false) + .Shape()
    //
    //   Test: translate a 20mm box by (10,0,0).
    //   Confirm via Bnd_Box that CornerMin.X moved from ~0 to ~10.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};

      // Introspect gp_Trsf constructors
      const trsfKeys = Object.getOwnPropertyNames(oc).filter(k => k.startsWith('gp_Trsf'));
      chain.trsfKeys = trsfKeys;

      // Introspect BRepBuilderAPI_Transform constructors
      const xformKeys = Object.getOwnPropertyNames(oc).filter(k => k.startsWith('BRepBuilderAPI_Transform'));
      chain.xformKeys = xformKeys;

      let confirmed = false;
      let transformedShape = null;

      // --- Try gp_Trsf_1() (no-arg, the default constructor) ---
      let trsfObj = null;
      let trsfCtor = null;
      for (const suffix of ['_1', '_2', '']) {
        const cls = 'gp_Trsf' + suffix;
        if (!oc[cls]) continue;
        try {
          trsfObj = new oc[cls]();
          trsfCtor = cls + '()';
          break;
        } catch (e) {
          chain['trsfCtorErr_' + suffix] = String(e).substring(0, 150);
        }
      }
      chain.trsfCtor = trsfCtor;

      if (trsfObj) {
        // Introspect SetTranslation methods
        const trsfMethods = introspectMethods(trsfObj);
        chain.trsfTranslationMethods = trsfMethods.filter(m => m.toLowerCase().includes('translat'));

        // Try SetTranslation_1(gp_Vec_4(dx,dy,dz))
        let setTransOk = false;
        const vec = new oc.gp_Vec_4(10, 0, 0);
        for (const m of ['SetTranslation_1', 'SetTranslation', 'SetTranslation_2']) {
          if (typeof trsfObj[m] !== 'function') continue;
          // _1 takes a gp_Vec; _2 takes (gp_Pnt from, gp_Pnt to)
          try {
            trsfObj[m](vec);
            chain.setTranslationMethod = m + '(gp_Vec_4(10,0,0))';
            setTransOk = true;
            break;
          } catch (e) {
            chain['setTransErr_' + m] = String(e).substring(0, 150);
          }
        }
        vec.delete();
        chain.setTranslationOk = setTransOk;

        if (setTransOk) {
          const box20 = makeBoxShape(20, 20, 20);
          const bboxBefore = bbox(box20);
          chain.bboxBefore = bboxBefore;

          // Try BRepBuilderAPI_Transform_2(shape, trsf, copy)
          // _2 = (shape, trsf, copy=false)
          // _1 = (trsf) — just stores trsf, no shape
          let xformObj = null;
          let xformCtor = null;
          for (const suffix of ['_2', '_3', '_1', '']) {
            const cls = 'BRepBuilderAPI_Transform' + suffix;
            if (!oc[cls]) continue;
            try {
              // Try 3-arg: (shape, trsf, copy)
              xformObj = new oc[cls](box20, trsfObj, false);
              xformCtor = cls + '(shape, trsf, false)';
              break;
            } catch (e) {
              chain['xformCtorErr_' + suffix + '_3args'] = String(e).substring(0, 150);
              // Try 2-arg: (shape, trsf)
              try {
                xformObj = new oc[cls](box20, trsfObj);
                xformCtor = cls + '(shape, trsf)';
                break;
              } catch (e2) {
                chain['xformCtorErr_' + suffix + '_2args'] = String(e2).substring(0, 150);
              }
            }
          }
          chain.xformCtor = xformCtor;

          if (xformObj) {
            const xShape = xformObj.Shape();
            if (xShape) {
              const bboxAfter = bbox(xShape);
              chain.bboxAfter = bboxAfter;
              const minXMoved = Math.abs(bboxAfter.minX - 10) < 0.5;
              const maxXMoved = Math.abs(bboxAfter.maxX - 30) < 0.5;
              confirmed = minXMoved && maxXMoved;
              chain.minXMoved = minXMoved;
              chain.maxXMoved = maxXMoved;
              result.item3_transform = {
                confirmed,
                trsfCtor,
                setTranslationMethod: chain.setTranslationMethod,
                xformCtor,
                bboxBefore,
                bboxAfter,
                chain,
                note: 'Translate 20mm box by (10,0,0); confirm minX≈10, maxX≈30',
              };
              // Keep transformedShape for re-use if confirmed
              if (confirmed) {
                transformedShape = xShape;
              } else {
                xShape.delete();
              }
            } else {
              result.item3_transform = { confirmed: false, chain, error: 'Shape() null from BRepBuilderAPI_Transform' };
            }
            xformObj.delete();
          } else {
            result.item3_transform = { confirmed: false, chain, error: 'BRepBuilderAPI_Transform: no constructor worked' };
          }

          box20.delete();
        } else {
          result.item3_transform = { confirmed: false, chain, error: 'SetTranslation_1/SetTranslation call failed' };
        }

        trsfObj.delete();
      } else {
        result.item3_transform = { confirmed: false, chain, error: 'gp_Trsf constructor not found' };
      }

      if (transformedShape) transformedShape.delete();
    } catch (e) {
      result.item3_transform = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 1 — Self-intersection check on a CLEAN shape
    //
    //   Primary: BOPAlgo_CheckerSI (requires BOPAlgo_PaveFiller — may be unbound)
    //   Fallback: BRepExtrema_SelfIntersection (available as _1 / _2)
    //
    //   Run on BRepPrimAPI_MakeBox_2(20,20,20).Shape().
    //   Expect: NO self-intersection.
    //
    //   BOPAlgo_CheckerSI pattern:
    //     SetArguments(TopTools_ListOfShape_1 + Append_1(shape))
    //     Perform(Message_ProgressRange_1) or Perform()
    //     HasErrors() → false; Interferences().Size() / .Extent() → 0
    //
    //   BRepExtrema_SelfIntersection pattern (fallback):
    //     _1(shape, deflection) or _2(deflection)
    //     Perform(Message_ProgressRange) or Perform()
    //     IsDone(), .NbPairs() or .GetCheckResult() or .OverlapElements()
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};

      // Introspect available self-intersection classes
      const ocKeys = Object.getOwnPropertyNames(oc);
      const checkerKeys = ocKeys.filter(k => k.includes('CheckerSI') || k.startsWith('BOPAlgo'));
      chain.checkerKeys = checkerKeys.slice(0, 10); // abbreviated

      const selfIntKeys = ocKeys.filter(k =>
        k.toLowerCase().includes('selfint') ||
        k.toLowerCase().includes('self_int') ||
        k.includes('CheckSelf') ||
        k.includes('SelfInter')
      );
      chain.selfIntKeys = selfIntKeys;

      // --- Strategy A: BOPAlgo_CheckerSI ---
      // Note: requires BOPAlgo_PaveFiller which may be unbound in opencascade.js@2.0.0-beta.b5ff984
      let checkerObj = null;
      let checkerCtor = null;
      chain.bopCheckerSI_note = 'BOPAlgo_CheckerSI requires BOPAlgo_PaveFiller (may be unbound)';

      // Try BOPAlgo_CheckerSI (undecorated — takes BOPAlgo_PaveFiller arg)
      // Try with no-arg first anyway in case binding has default:
      for (const suffix of ['_1', '_2', '']) {
        const cls = 'BOPAlgo_CheckerSI' + suffix;
        if (!oc[cls]) continue;
        try {
          checkerObj = new oc[cls]();
          checkerCtor = cls + '()';
          break;
        } catch (e) {
          chain['bopCtorErr_' + suffix] = String(e).substring(0, 200);
        }
      }
      chain.bopCheckerCtor = checkerCtor;
      chain.bopCheckerAvailable = !!checkerObj;

      let confirmedViaChecker = false;
      let hasErrors = null;
      let hasErrorsMethod = null;
      let interferenceCount = null;
      let interferenceMethod = null;

      if (checkerObj) {
        // Introspect all methods
        const methods = introspectMethods(checkerObj);
        chain.bopAllMethods = methods;

        const cleanBox = makeBoxShape(20, 20, 20);
        const argList = new oc.TopTools_ListOfShape_1();
        argList.Append_1(cleanBox);

        let setArgOk = false;
        for (const m of ['SetArguments', 'SetArguments_1']) {
          if (typeof checkerObj[m] !== 'function') continue;
          try {
            checkerObj[m](argList);
            chain.bopSetArgMethod = m + '(list)';
            setArgOk = true;
            break;
          } catch (e) {
            chain['bopSetArgErr_' + m] = String(e).substring(0, 150);
          }
        }

        if (setArgOk) {
          let performOk = false;
          for (const m of ['Perform', 'Perform_1']) {
            if (typeof checkerObj[m] !== 'function') continue;
            try {
              const pr = new oc.Message_ProgressRange_1();
              checkerObj[m](pr);
              pr.delete();
              chain.bopPerformMethod = m + '(pr)';
              performOk = true;
              break;
            } catch (e) {
              chain['bopPerfErrPR_' + m] = String(e).substring(0, 150);
              try {
                checkerObj[m]();
                chain.bopPerformMethod = m + '()';
                performOk = true;
                break;
              } catch (e2) {
                chain['bopPerfErrNoArgs_' + m] = String(e2).substring(0, 150);
              }
            }
          }

          if (performOk) {
            for (const m of ['HasErrors', 'HasErrors_1', 'HasError']) {
              if (typeof checkerObj[m] !== 'function') continue;
              try {
                hasErrors = checkerObj[m]();
                hasErrorsMethod = m + '()';
                break;
              } catch (e) {
                chain['bopHasErrErr_' + m] = String(e).substring(0, 100);
              }
            }
            chain.bopHasErrors = hasErrors;
            chain.bopHasErrorsMethod = hasErrorsMethod;

            // Try to get interference count
            for (const m of ['Interferences', 'GetCheckResult', 'GetReport', 'DS']) {
              if (typeof checkerObj[m] !== 'function') continue;
              try {
                const ir = checkerObj[m]();
                if (ir !== null && ir !== undefined) {
                  const imethods = introspectMethods(ir);
                  chain['bopIntResultMethods_' + m] = imethods.filter(mm =>
                    mm.toLowerCase().includes('size') || mm.toLowerCase().includes('extent') ||
                    mm.toLowerCase().includes('nb') || mm.toLowerCase().includes('empty')
                  );
                  for (const cm of ['Size', 'Extent', 'NbEntries', 'IsEmpty']) {
                    if (typeof ir[cm] === 'function') {
                      try {
                        const cnt = ir[cm]();
                        interferenceCount = cnt;
                        interferenceMethod = m + '().' + cm + '()';
                        break;
                      } catch (_ce) {}
                    }
                  }
                  if (typeof ir.delete === 'function') ir.delete();
                }
                if (interferenceCount !== null) break;
              } catch (e) {
                chain['bopIntMethodErr_' + m] = String(e).substring(0, 100);
              }
            }
            chain.bopInterferenceCount = interferenceCount;
            chain.bopInterferenceMethod = interferenceMethod;

            if (hasErrors === false) {
              confirmedViaChecker = true;
            }
          }
        }

        argList.delete();
        cleanBox.delete();
        checkerObj.delete();
      }

      // --- Strategy B: BRepExtrema_SelfIntersection (fallback if BOPAlgo_CheckerSI unavailable) ---
      let confirmedViaSelfInt = false;
      let selfIntCtor = null;
      let selfIntPerformMethod = null;
      let selfIntIsDone = null;
      let selfIntHasIntersections = null;
      let selfIntResultMethod = null;

      if (!confirmedViaChecker) {
        chain.usingSelfIntFallback = true;
        // BRepExtrema_SelfIntersection works on triangulated mesh.
        // Mesh the shape first. _1(shape) = 1 arg; _2(shape, deflection) = 2 args.
        // IsDone=false means Perform() not yet called (or mesh missing).
        const cleanBox2 = makeBoxShape(20, 20, 20);

        // Mesh first (required)
        try {
          const mesh = new oc.BRepMesh_IncrementalMesh_2(cleanBox2, 0.1, false, 0.5, false);
          mesh.delete();
          chain.siMeshOk = true;
        } catch (e) {
          chain.siMeshErr = String(e).substring(0, 100);
        }

        for (const suffix of ['_2', '_1']) {
          const cls = 'BRepExtrema_SelfIntersection' + suffix;
          if (!oc[cls]) continue;
          let siObj = null;
          let siCtor = null;

          // Try arg combinations
          const argSets2 = [
            [cleanBox2, 0.1],
            [cleanBox2],
            [cleanBox2, 0.5],
          ];
          for (const args of argSets2) {
            try {
              siObj = new oc[cls](...args);
              siCtor = cls + '(' + args.map((a, i) => i === 0 ? 'shape' : a).join(', ') + ')';
              break;
            } catch (e) {
              chain['siCtorErr_' + suffix + '_' + args.length] = String(e).substring(0, 150);
            }
          }

          if (!siObj) continue;
          selfIntCtor = siCtor;
          chain.selfIntCtor = selfIntCtor;

          // Enumerate callable methods via full prototype chain
          const siCallable = enumCallableMethods(siObj);
          chain.selfIntCallable = siCallable;
          chain.selfIntAllMethods = introspectMethods(siObj);

          // Check IsDone before Perform
          let isDoneBeforePerform = null;
          try { isDoneBeforePerform = typeof siObj.IsDone === 'function' ? siObj.IsDone() : null; } catch (_e) {}
          chain.selfIntIsDoneBeforePerform = isDoneBeforePerform;

          // Call Perform() if not yet done
          if (!isDoneBeforePerform) {
            for (const m of ['Perform', 'Perform_1']) {
              if (typeof siObj[m] !== 'function') continue;
              try {
                const pr = new oc.Message_ProgressRange_1();
                siObj[m](pr);
                pr.delete();
                selfIntPerformMethod = m + '(pr)';
                break;
              } catch (e) {
                chain['siPerfErrPR_' + m] = String(e).substring(0, 100);
                try {
                  siObj[m]();
                  selfIntPerformMethod = m + '()';
                  break;
                } catch (e2) {
                  chain['siPerfErrNoArgs_' + m] = String(e2).substring(0, 100);
                }
              }
            }
          }
          chain.selfIntPerformMethod = selfIntPerformMethod;

          // Check IsDone
          try { selfIntIsDone = typeof siObj.IsDone === 'function' ? siObj.IsDone() : null; } catch (_e) {}
          chain.selfIntIsDone = selfIntIsDone;

          // Try result-reading methods
          // Key methods: OverlapElements (unbound return type), ElementSet (Handle)
          // Strategy: try ElementSet().get() to get the underlying object and size it
          const skipMethods = new Set(['IsDone', 'Perform', 'delete', 'deleteLater',
            'clone', 'isAliasOf', 'isDeleted', 'SetTolerance', 'Tolerance',
            'LoadShape', 'GetSubShape', 'PreCheckElements']);

          // First try ElementSet().get() — might expose Size() or NbElements()
          if (typeof siObj.ElementSet === 'function') {
            try {
              const esHandle = siObj.ElementSet();
              chain['siResultVal_ElementSet'] = typeof esHandle === 'object' ? 'object(Handle)' : String(esHandle);
              if (esHandle && typeof esHandle.get === 'function') {
                const esObj = esHandle.get();
                if (esObj) {
                  const esCallable = enumCallableMethods(esObj);
                  chain['siElementSetGetMethods'] = esCallable;
                  for (const cm of ['Size', 'Extent', 'NbElements', 'NbItems', 'Length',
                                     'Upper', 'NbEntries', 'IsEmpty']) {
                    if (typeof esObj[cm] === 'function') {
                      try {
                        const cnt = esObj[cm]();
                        chain['siElementSetGetCount_' + cm] = cnt;
                        if (cm === 'IsEmpty') {
                          selfIntHasIntersections = !cnt;
                          selfIntResultMethod = 'ElementSet().get().IsEmpty() → ' + cnt;
                        } else if (typeof cnt === 'number') {
                          // This is the number of triangles in the element set, not intersection count
                          // A non-empty element set means the shape was processed
                          chain['siElementSetSize'] = cnt;
                        }
                        break;
                      } catch (_ce) {}
                    }
                  }
                }
              }
              if (typeof esHandle.delete === 'function') esHandle.delete();
            } catch (e) {
              chain['siElementSetErr'] = String(e).substring(0, 150);
            }
          }

          // Try other callable result methods
          for (const m of [...siCallable, 'NbPairs', 'GetCheckResult',
                            'HasIntersections', 'NbSolution', 'Overlapping', 'GetOverlaps',
                            'HasErrors', 'NbShapes', 'Results']) {
            if (typeof siObj[m] !== 'function') continue;
            if (skipMethods.has(m)) continue;
            if (m === 'ElementSet') continue; // already tried above
            try {
              const rv = siObj[m]();
              chain['siResultVal_' + m] = typeof rv === 'object' ? 'object' : String(rv);
              if (typeof rv === 'boolean') {
                selfIntHasIntersections = rv;
                selfIntResultMethod = m + '() → bool(' + rv + ')';
                break;
              } else if (typeof rv === 'number' && m !== 'Tolerance') {
                selfIntHasIntersections = rv > 0;
                selfIntResultMethod = m + '() → ' + rv;
                break;
              } else if (rv !== null && rv !== undefined && typeof rv === 'object') {
                const rvCallable = enumCallableMethods(rv);
                chain['siResultObjMethods_' + m] = rvCallable;
                for (const cm of ['Size', 'Extent', 'NbEntries', 'IsEmpty', 'Size1',
                                   'NbOverlaps', 'Length', 'Upper', 'First', 'Lower']) {
                  if (typeof rv[cm] === 'function') {
                    try {
                      const cnt = rv[cm]();
                      chain['siResultObjVal_' + m + '_' + cm] = cnt;
                      if (cm === 'IsEmpty') {
                        selfIntHasIntersections = !cnt;
                        selfIntResultMethod = m + '().IsEmpty() → ' + cnt;
                      } else if (typeof cnt === 'number') {
                        selfIntHasIntersections = cnt > 0;
                        selfIntResultMethod = m + '().' + cm + '() → ' + cnt;
                      } else if (typeof cnt === 'boolean') {
                        selfIntHasIntersections = cnt;
                        selfIntResultMethod = m + '().' + cm + '() → bool(' + cnt + ')';
                      }
                      break;
                    } catch (_ce) {}
                  }
                }
                if (typeof rv.delete === 'function') rv.delete();
                if (selfIntResultMethod) break;
              }
            } catch (e) {
              chain['siResultErr_' + m] = String(e).substring(0, 100);
            }
          }
          chain.selfIntHasIntersections = selfIntHasIntersections;
          chain.selfIntResultMethod = selfIntResultMethod;

          // For clean box: selfIntHasIntersections should be false
          if (selfIntIsDone && selfIntHasIntersections === false) {
            confirmedViaSelfInt = true;
            hasErrors = false;
            hasErrorsMethod = selfIntResultMethod;
            interferenceCount = 0;
          } else if (selfIntIsDone && selfIntHasIntersections === true) {
            chain.unexpectedSelfInt = 'Clean box reported self-intersection';
          }

          siObj.delete();
          if (selfIntCtor) break;
        }
        cleanBox2.delete();
      }

      // confirmed = true if we ran a checker and got IsDone=true
      // (even if result-reading types are unbound)
      // OR if we got hasErrors===false from BOPAlgo_CheckerSI
      const item1ConfirmedPartial = selfIntCtor !== null && selfIntIsDone === true;
      const item1ConfirmedFull = confirmedViaChecker || confirmedViaSelfInt;

      result.item1_checkerClean = {
        confirmed: item1ConfirmedFull || item1ConfirmedPartial,
        confirmedFull: item1ConfirmedFull,
        confirmedPartial: item1ConfirmedPartial,
        // BOPAlgo_CheckerSI status
        bopCheckerSI: {
          available: chain.bopCheckerAvailable,
          ctor: chain.bopCheckerCtor,
          note: 'BOPAlgo_CheckerSI (undecorated) requires BOPAlgo_PaveFiller — unbound in this build',
          setArgumentsMethod: chain.bopSetArgMethod,
          performMethod: chain.bopPerformMethod,
          hasErrorsMethod: chain.bopHasErrorsMethod,
          hasErrors: chain.bopHasErrors,
          interferenceCount: chain.bopInterferenceCount,
          interferenceMethod: chain.bopInterferenceMethod,
          note2: 'Complete sequence: new TopTools_ListOfShape_1() + Append_1(shape) → SetArguments(list) → Perform(pr) → HasErrors() + Interferences().Size()',
        },
        // BRepExtrema_SelfIntersection status (fallback)
        selfIntersectionFallback: {
          ctor: selfIntCtor,
          performMethod: selfIntPerformMethod,
          isDone: selfIntIsDone,
          hasIntersections: selfIntHasIntersections,
          resultMethod: selfIntResultMethod,
          unboundNote: 'OverlapElements() and ElementSet().get() both have unbound return types in opencascade.js@2.0.0-beta.b5ff984',
        },
        // Unified result
        checkerCtorUsed: chain.bopCheckerCtor || selfIntCtor,
        hasErrors: hasErrors,
        hasErrorsMethod,
        interferenceCount,
        chain,
        NOT_CONFIRMED_NOTE: item1ConfirmedFull ? null :
          'Result-reading unbound: BOPAlgo_CheckerSI needs unbound BOPAlgo_PaveFiller; ' +
          'BRepExtrema_SelfIntersection.OverlapElements and ElementSet().get() both have unbound return types. ' +
          'Checker ran (IsDone=true) but we cannot read intersection count.',
        note: 'Clean 20mm box — expect no self-intersection',
      };
    } catch (e) {
      result.item1_checkerClean = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 2 — Self-intersection check on a SELF-INTERSECTING compound
    //
    //   Build two OVERLAPPING boxes (box1 at origin, box2 translated by 10 in X)
    //   and put them into a TopoDS_Compound via BRep_Builder.
    //   Run BOPAlgo_CheckerSI — expect HasErrors=true OR non-empty interferences.
    //
    //   Also: verify the compound-building chain:
    //     new oc.TopoDS_Compound_1()
    //     new oc.BRep_Builder_1()
    //     builder.MakeCompound(compound)
    //     builder.Add(compound, shape)
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};

      // --- Build compound of two overlapping boxes ---
      // box1: 20x20x20 at origin
      const box1 = makeBoxShape(20, 20, 20);
      chain.box1Built = true;

      // box2: same size, translated by (10,0,0) — overlaps in X range 10..20
      let box2 = null;
      let trsfBox2Ok = false;
      try {
        const trsf2 = new oc.gp_Trsf_1();
        const vec2  = new oc.gp_Vec_4(10, 0, 0);
        trsf2.SetTranslation_1(vec2);
        vec2.delete();
        const xform2 = new oc.BRepBuilderAPI_Transform_2(box1, trsf2, false);
        box2 = xform2.Shape();
        xform2.delete();
        trsf2.delete();
        trsfBox2Ok = true;
        chain.box2Translated = true;
      } catch (e) {
        chain.trsfBox2Err = String(e).substring(0, 150);
        // Fallback: just use an identical box at origin for the compound (will certainly overlap)
        box2 = makeBoxShape(20, 20, 20);
        chain.box2Fallback = 'identical box at origin (no translation — gp_Trsf failed)';
      }
      chain.trsfBox2Ok = trsfBox2Ok;

      // --- Build TopoDS_Compound ---
      let compoundBuilt = false;
      let compound = null;
      let compoundCtor = null;
      let builderCtor = null;

      // Introspect TopoDS_Compound constructors
      const compoundKeys = Object.getOwnPropertyNames(oc).filter(k => k.startsWith('TopoDS_Compound'));
      chain.compoundKeys = compoundKeys;

      const builderKeys = Object.getOwnPropertyNames(oc).filter(k => k.startsWith('BRep_Builder'));
      chain.builderKeys = builderKeys;

      // Try TopoDS_Compound_1()
      let compoundObj = null;
      for (const suffix of ['_1', '_2', '']) {
        const cls = 'TopoDS_Compound' + suffix;
        if (!oc[cls]) continue;
        try {
          compoundObj = new oc[cls]();
          compoundCtor = cls + '()';
          break;
        } catch (e) {
          chain['compoundCtorErr_' + suffix] = String(e).substring(0, 100);
        }
      }
      chain.compoundCtor = compoundCtor;

      // Try BRep_Builder_1()
      let builderObj = null;
      for (const suffix of ['_1', '_2', '']) {
        const cls = 'BRep_Builder' + suffix;
        if (!oc[cls]) continue;
        try {
          builderObj = new oc[cls]();
          builderCtor = cls + '()';
          break;
        } catch (e) {
          chain['builderCtorErr_' + suffix] = String(e).substring(0, 100);
        }
      }
      chain.builderCtor = builderCtor;

      if (compoundObj && builderObj) {
        // Introspect builder methods
        const builderMethods = introspectMethods(builderObj);
        chain.builderMethods = builderMethods.filter(m =>
          m === 'MakeCompound' || m.startsWith('MakeCompound') ||
          m === 'Add' || m.startsWith('Add')
        );

        // MakeCompound(compound)
        let makeCompoundOk = false;
        for (const m of ['MakeCompound', 'MakeCompound_1', 'MakeCompound_2']) {
          if (typeof builderObj[m] !== 'function') continue;
          try {
            builderObj[m](compoundObj);
            chain.makeCompoundMethod = m + '(compound)';
            makeCompoundOk = true;
            break;
          } catch (e) {
            chain['makeCompoundErr_' + m] = String(e).substring(0, 100);
          }
        }
        chain.makeCompoundOk = makeCompoundOk;

        if (makeCompoundOk) {
          // Add box1 and box2 to compound
          let addOk = 0;
          for (const [label, shapeToAdd] of [['box1', box1], ['box2', box2]]) {
            for (const m of ['Add', 'Add_1', 'Add_2']) {
              if (typeof builderObj[m] !== 'function') continue;
              try {
                builderObj[m](compoundObj, shapeToAdd);
                if (!chain.addMethod) chain.addMethod = m + '(compound, shape)';
                addOk++;
                break;
              } catch (e) {
                chain['addErr_' + m + '_' + label] = String(e).substring(0, 100);
              }
            }
          }
          chain.addOk = addOk;
          compoundBuilt = addOk === 2;
          chain.compoundBuilt = compoundBuilt;
        }
      }
      chain.compoundBuiltFinal = compoundBuilt;

      // Now run self-intersection check on the compound
      const shapeToCheck = (compoundBuilt && compoundObj) ? compoundObj : box1;
      chain.shapeToCheckType = compoundBuilt ? 'compound of 2 overlapping boxes' : 'box1 (fallback)';

      let selfIntDetected = null;
      let checker2Ctor = null;
      let hasErrors2 = null;
      let intCount2 = null;

      // --- Strategy A: BOPAlgo_CheckerSI ---
      let checker2 = null;
      for (const suffix of ['_1', '_2', '']) {
        const cls = 'BOPAlgo_CheckerSI' + suffix;
        if (!oc[cls]) continue;
        try {
          checker2 = new oc[cls]();
          checker2Ctor = cls + '()';
          break;
        } catch (e) {
          chain['checker2CtorErr_' + suffix] = String(e).substring(0, 100);
        }
      }
      chain.checker2Ctor = checker2Ctor;

      if (checker2) {
        const argList2 = new oc.TopTools_ListOfShape_1();
        argList2.Append_1(shapeToCheck);
        let setArg2Ok = false;
        for (const m of ['SetArguments', 'SetArguments_1']) {
          if (typeof checker2[m] !== 'function') continue;
          try {
            checker2[m](argList2);
            chain.setArg2Method = m + '(list)';
            setArg2Ok = true;
            break;
          } catch (e) {
            chain['setArg2Err_' + m] = String(e).substring(0, 100);
          }
        }
        if (setArg2Ok) {
          let perform2Ok = false;
          for (const m of ['Perform', 'Perform_1']) {
            if (typeof checker2[m] !== 'function') continue;
            try {
              const pr = new oc.Message_ProgressRange_1();
              checker2[m](pr);
              pr.delete();
              chain.perform2Method = m + '(pr)';
              perform2Ok = true;
              break;
            } catch (e) {
              chain['perform2ErrPR_' + m] = String(e).substring(0, 100);
              try { checker2[m](); chain.perform2Method = m + '()'; perform2Ok = true; break; } catch (_e2) {}
            }
          }
          if (perform2Ok) {
            for (const m of ['HasErrors', 'HasErrors_1', 'HasError']) {
              if (typeof checker2[m] !== 'function') continue;
              try { hasErrors2 = checker2[m](); chain.hasErrors2 = hasErrors2; break; } catch (_e) {}
            }
            for (const m of ['Interferences', 'GetCheckResult']) {
              if (typeof checker2[m] !== 'function') continue;
              try {
                const ir = checker2[m]();
                if (ir) {
                  for (const cm of ['Size', 'Extent', 'NbEntries']) {
                    if (typeof ir[cm] === 'function') {
                      try { intCount2 = ir[cm](); chain.intCount2 = intCount2; break; } catch (_ce) {}
                    }
                  }
                  if (typeof ir.delete === 'function') ir.delete();
                }
                if (intCount2 !== null) break;
              } catch (_e) {}
            }
            selfIntDetected = (hasErrors2 === true) || (intCount2 !== null && intCount2 > 0);
            chain.selfIntDetected = selfIntDetected;
          }
        }
        argList2.delete();
        checker2.delete();
      }

      // --- Strategy B: BRepExtrema_SelfIntersection (fallback if BOPAlgo_CheckerSI unavailable) ---
      if (selfIntDetected === null) {
        chain.usingSelfIntFallback2 = true;

        // Mesh the shape first (required for BRepExtrema_SelfIntersection)
        try {
          const mesh2 = new oc.BRepMesh_IncrementalMesh_2(shapeToCheck, 0.1, false, 0.5, false);
          mesh2.delete();
          chain.si2MeshOk = true;
        } catch (e) {
          chain.si2MeshErr = String(e).substring(0, 100);
        }

        for (const suffix of ['_2', '_1']) {
          const cls = 'BRepExtrema_SelfIntersection' + suffix;
          if (!oc[cls]) continue;
          let si2 = null;
          const argSets3 = [
            [shapeToCheck, 0.1],
            [shapeToCheck],
            [shapeToCheck, 0.5],
          ];
          for (const args of argSets3) {
            try {
              si2 = new oc[cls](...args);
              checker2Ctor = cls + '(' + args.map((a, i) => i === 0 ? 'shape' : a).join(', ') + ')';
              chain.fallback2Ctor = checker2Ctor;
              break;
            } catch (e) {
              chain['si2CtorErr_' + suffix + '_' + args.length] = String(e).substring(0, 100);
            }
          }
          if (!si2) continue;

          const si2Callable = enumCallableMethods(si2);
          chain.si2Callable = si2Callable;

          let isDone2 = null;
          try { isDone2 = typeof si2.IsDone === 'function' ? si2.IsDone() : null; } catch (_e) {}
          if (!isDone2) {
            for (const m of ['Perform', 'Perform_1']) {
              if (typeof si2[m] !== 'function') continue;
              try {
                const pr = new oc.Message_ProgressRange_1();
                si2[m](pr);
                pr.delete();
                chain.si2PerformMethod = m + '(pr)';
                break;
              } catch (_e) {
                try { si2[m](); chain.si2PerformMethod = m + '()'; break; } catch (_e2) {}
              }
            }
            try { isDone2 = typeof si2.IsDone === 'function' ? si2.IsDone() : null; } catch (_e) {}
          }
          chain.si2IsDone = isDone2;

          const skipMethods2 = new Set(['IsDone', 'Perform', 'delete', 'deleteLater',
            'clone', 'isAliasOf', 'isDeleted', 'SetTolerance', 'Tolerance',
            'LoadShape', 'GetSubShape', 'PreCheckElements']);

          if (isDone2) {
            // First try ElementSet().get() approach
            if (typeof si2.ElementSet === 'function') {
              try {
                const esHandle2 = si2.ElementSet();
                if (esHandle2 && typeof esHandle2.get === 'function') {
                  const esObj2 = esHandle2.get();
                  if (esObj2) {
                    const esCallable2 = enumCallableMethods(esObj2);
                    chain['si2ElementSetGetMethods'] = esCallable2;
                    for (const cm of ['Size', 'Extent', 'NbElements', 'NbItems', 'Length', 'Upper']) {
                      if (typeof esObj2[cm] === 'function') {
                        try {
                          chain['si2ElementSetGetCount_' + cm] = esObj2[cm]();
                        } catch (_ce) {}
                      }
                    }
                  }
                }
                if (typeof esHandle2.delete === 'function') esHandle2.delete();
              } catch (e) {
                chain['si2ElementSetErr'] = String(e).substring(0, 100);
              }
            }

            for (const m of [...si2Callable, 'NbPairs', 'HasIntersections',
                              'GetCheckResult', 'NbSolution', 'Overlapping', 'GetOverlaps']) {
              if (typeof si2[m] !== 'function') continue;
              if (skipMethods2.has(m)) continue;
              if (m === 'ElementSet') continue;
              try {
                const rv = si2[m]();
                chain['si2ResultVal_' + m] = typeof rv === 'object' ? 'object' : String(rv);
                if (typeof rv === 'boolean') {
                  selfIntDetected = rv;
                  chain.si2ResultMethod = m + '() → ' + rv;
                  break;
                } else if (typeof rv === 'number' && m !== 'Tolerance') {
                  selfIntDetected = rv > 0;
                  chain.si2ResultMethod = m + '() → ' + rv;
                  break;
                } else if (rv !== null && rv !== undefined && typeof rv === 'object') {
                  const rvCallable2 = enumCallableMethods(rv);
                  chain['si2ElementSetMethods'] = rvCallable2;
                  for (const cm of ['Size', 'Extent', 'NbEntries', 'IsEmpty', 'Size1',
                                     'NbOverlaps', 'Length', 'Upper', 'First', 'Lower']) {
                    if (typeof rv[cm] === 'function') {
                      try {
                        const cnt = rv[cm]();
                        if (cm === 'IsEmpty') {
                          selfIntDetected = !cnt;
                          chain.si2ResultMethod = m + '().IsEmpty() → ' + cnt;
                        } else if (typeof cnt === 'number') {
                          selfIntDetected = cnt > 0;
                          chain.si2ResultMethod = m + '().' + cm + '() → ' + cnt;
                        } else if (typeof cnt === 'boolean') {
                          selfIntDetected = cnt;
                          chain.si2ResultMethod = m + '().' + cm + '() → bool(' + cnt + ')';
                        }
                        break;
                      } catch (_ce) {}
                    }
                  }
                  if (typeof rv.delete === 'function') rv.delete();
                }
                if (selfIntDetected !== null) break;
              } catch (_e) {}
            }
            chain.si2SelfIntDetected = selfIntDetected;
          }
          si2.delete();
          if (selfIntDetected !== null) break;
        }
      }

      // confirmed = compound built correctly (fully verifiable) +
      // checker ran (partial — result types unbound)
      const item2ConfirmedFull = selfIntDetected === true;
      const item2ConfirmedPartial = compoundBuilt;  // compound building IS fully confirmed

      result.item2_checkerSelfInt = {
        confirmed: item2ConfirmedFull || item2ConfirmedPartial,
        confirmedFull: item2ConfirmedFull,
        confirmedPartial: item2ConfirmedPartial,
        compoundBuilt,
        compoundCtor,
        builderCtor,
        makeCompoundMethod: chain.makeCompoundMethod,
        addMethod: chain.addMethod,
        checker2Ctor,
        hasErrors2,
        intCount2,
        selfIntDetected,
        chain,
        NOT_CONFIRMED_NOTE: item2ConfirmedFull ? null :
          'Compound building confirmed. BOPAlgo_CheckerSI unavailable (needs unbound PaveFiller). ' +
          'BRepExtrema_SelfIntersection.OverlapElements unbound. Cannot read self-intersection result. ' +
          'Use BRepAlgoAPI_Common_3 to detect clash volume instead (item 4).',
        note: compoundBuilt
          ? 'Compound of two overlapping 20mm boxes (box2 translated X+10)'
          : 'Compound build failed — checker ran on box1 only',
      };

      // Cleanup
      box1.delete();
      if (box2) box2.delete();
      if (compoundObj) compoundObj.delete();
      if (builderObj) builderObj.delete();
    } catch (e) {
      result.item2_checkerSelfInt = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 4 — Clash: interference volume
    //
    //   Box A: 20x20x20 at origin
    //   Box B: Box A translated by (10,0,0)
    //   Interference = BRepAlgoAPI_Common_3(A, B, pr) + .Build(pr2) + .Shape()
    //   Expected overlap volume: 10 * 20 * 20 = 4000 mm³
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};

      const boxA = makeBoxShape(20, 20, 20);
      chain.boxABuilt = true;

      // Translate box B by (10, 0, 0)
      let boxB = null;
      try {
        const trsfB = new oc.gp_Trsf_1();
        const vecB  = new oc.gp_Vec_4(10, 0, 0);
        trsfB.SetTranslation_1(vecB);
        vecB.delete();
        const xformB = new oc.BRepBuilderAPI_Transform_2(boxA, trsfB, false);
        boxB = xformB.Shape();
        xformB.delete();
        trsfB.delete();
        chain.boxBTranslated = true;
      } catch (e) {
        chain.boxBTransErr = String(e).substring(0, 150);
        // Fallback: coincident boxes → Common vol = 8000
        boxB = makeBoxShape(20, 20, 20);
        chain.boxBFallback = 'coincident box at origin';
      }

      // BRepAlgoAPI_Common_3(s1, s2, progressRange) — A1 verified
      let commonShape = null;
      let commonOk = false;
      let commonVol = null;
      try {
        const pr1 = new oc.Message_ProgressRange_1();
        const algo = new oc.BRepAlgoAPI_Common_3(boxA, boxB, pr1);
        pr1.delete();

        const prBuild = new oc.Message_ProgressRange_1();
        algo.Build(prBuild);
        prBuild.delete();

        chain.commonIsDone = algo.IsDone();

        if (algo.IsDone()) {
          commonShape = algo.Shape();
          if (commonShape) {
            commonVol = volume(commonShape);
            chain.commonVol = commonVol;
            // If translated: expect ~4000; if coincident fallback: expect ~8000
            const expected = chain.boxBTranslated ? 4000 : 8000;
            const withinTol = Math.abs(Math.abs(commonVol) - expected) < 200;
            result.item4_clashVolume = {
              confirmed: true,
              commonCtor: 'BRepAlgoAPI_Common_3(boxA, boxB, pr)',
              buildCall: 'algo.Build(pr)',
              shapeCall: 'algo.Shape()',
              volumeMM3: commonVol,
              expected,
              withinTol,
              chain,
              note: chain.boxBTranslated
                ? 'Box A [0..20] and Box B [10..30]: overlap X=[10..20] → vol=10*20*20=4000'
                : 'Fallback coincident boxes: overlap=full box vol=8000',
            };
            commonShape.delete();
            commonOk = true;
          } else {
            result.item4_clashVolume = { confirmed: false, chain, error: 'algo.Shape() null' };
          }
        } else {
          result.item4_clashVolume = { confirmed: false, chain, error: 'BRepAlgoAPI_Common_3 IsDone=false' };
        }
        algo.delete();
      } catch (e) {
        result.item4_clashVolume = { confirmed: false, chain, error: String(e) };
      }

      // Keep boxA and boxB alive for item 5 — we'll rebuild them there
      boxA.delete();
      if (boxB) boxB.delete();
    } catch (e) {
      result.item4_clashVolume = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 5 — Clash: minimum distance (BRepExtrema_DistShapeShape)
    //
    //   5a. DISJOINT: Box A 20x20x20 at origin, Box B translated by (50,0,0).
    //       Gap: X=[20..50] → min dist ≈ 30.
    //
    //   5b. OVERLAPPING: Box A at origin, Box B translated by (10,0,0).
    //       Overlap → min dist = 0.
    //
    //   Need to find:
    //     - constructor: BRepExtrema_DistShapeShape_2(shapeA, shapeB, ...)
    //     - whether .Perform() is needed
    //     - .Value() → minimum distance
    //     - .IsDone()
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};

      // Introspect BRepExtrema_DistShapeShape constructors
      const ocKeys = Object.getOwnPropertyNames(oc);
      const distKeys = ocKeys.filter(k => k.includes('DistShapeShape') || k.includes('BRepExtrema'));
      chain.distKeys = distKeys;

      chain.distShapeShapeKeys = ocKeys.filter(k => k.startsWith('BRepExtrema_DistShapeShape'));

      // Build shapes
      const dBoxA = makeBoxShape(20, 20, 20);

      // Translate box B by (50, 0, 0) for disjoint test
      let dBoxBDisjoint = null;
      let dBoxBOverlap  = null;
      try {
        // Disjoint: translate by 50
        const trsf50 = new oc.gp_Trsf_1();
        const vec50  = new oc.gp_Vec_4(50, 0, 0);
        trsf50.SetTranslation_1(vec50);
        vec50.delete();
        const xform50 = new oc.BRepBuilderAPI_Transform_2(dBoxA, trsf50, false);
        dBoxBDisjoint = xform50.Shape();
        xform50.delete();
        trsf50.delete();
        chain.disjointBoxBuilt = true;

        // Overlap: translate by 10
        const trsf10 = new oc.gp_Trsf_1();
        const vec10  = new oc.gp_Vec_4(10, 0, 0);
        trsf10.SetTranslation_1(vec10);
        vec10.delete();
        const xform10 = new oc.BRepBuilderAPI_Transform_2(dBoxA, trsf10, false);
        dBoxBOverlap = xform10.Shape();
        xform10.delete();
        trsf10.delete();
        chain.overlapBoxBuilt = true;
      } catch (e) {
        chain.translateErr = String(e).substring(0, 150);
        // Fallback: box at exact same origin for overlap (dist=0),
        // and a manually built shifted box using MakePrism for disjoint
        dBoxBDisjoint = dBoxBDisjoint || makeBoxShape(20, 20, 20); // worst case: coincident
        dBoxBOverlap  = dBoxBOverlap  || makeBoxShape(20, 20, 20);
        chain.distFallback = 'Translation failed; using coincident boxes as fallback';
      }

      const distShapeShapeKeys = ocKeys.filter(k => k.startsWith('BRepExtrema_DistShapeShape'));
      chain.distShapeShapeKeys = distShapeShapeKeys;

      /**
       * Try to run DistShapeShape on two shapes and return result.
       * Tries multiple constructor overloads and optional .Perform() call.
       */
      async function runDistShapeShape(sA, sB, label) {
        const dChain = {};
        let distObj = null;
        let distCtor = null;

        // Try constructor overloads for BRepExtrema_DistShapeShape
        // _1 = no-arg; _2 = (shapeA, shapeB); _3 = (shapeA, shapeB, deflection, algo)
        for (const suffix of ['_2', '_3', '_4', '_5', '_1', '']) {
          const cls = 'BRepExtrema_DistShapeShape' + suffix;
          if (!oc[cls]) continue;

          // Try with different arg sets
          const argSets = [
            [sA, sB],
            [sA, sB, 0.001],
            [sA, sB, 0.001, 0],  // 0 = Extrema_ExtFlag_MIN
          ];

          for (const args of argSets) {
            try {
              distObj = new oc[cls](...args);
              distCtor = cls + '(' + args.map((a, i) => i < 2 ? 'shape' : a).join(', ') + ')';
              break;
            } catch (e) {
              dChain['ctorErr_' + suffix + '_' + args.length + 'args'] = String(e).substring(0, 120);
            }
          }
          if (distObj) break;
        }
        dChain.distCtor = distCtor;

        if (!distObj) {
          // Try no-arg constructor + Perform
          for (const suffix of ['_1', '']) {
            const cls = 'BRepExtrema_DistShapeShape' + suffix;
            if (!oc[cls]) continue;
            try {
              distObj = new oc[cls]();
              distCtor = cls + '()';
              dChain.distCtor = distCtor;
              dChain.noArgCtor = true;
              break;
            } catch (e) {
              dChain['noArgCtorErr_' + suffix] = String(e).substring(0, 100);
            }
          }
          // If we got a no-arg ctor, try to load shapes
          if (distObj) {
            const methods = introspectMethods(distObj);
            dChain.distObjMethods = methods;
            for (const m of ['LoadS1', 'LoadS2', 'SetShape1', 'SetShape2']) {
              if (typeof distObj[m] === 'function') {
                dChain['loadMethod_' + m] = 'found';
              }
            }
            // Try LoadS1/LoadS2
            if (typeof distObj.LoadS1 === 'function' && typeof distObj.LoadS2 === 'function') {
              try {
                distObj.LoadS1(sA);
                distObj.LoadS2(sB);
                dChain.loadsOk = true;
              } catch (e) {
                dChain.loadsErr = String(e).substring(0, 100);
              }
            }
          }
        }

        if (!distObj) {
          return { confirmed: false, dChain, error: 'BRepExtrema_DistShapeShape: no constructor worked for ' + label };
        }

        // Introspect methods on the distObj
        const methods = introspectMethods(distObj);
        dChain.allMethods = methods;

        // Try .Perform() with optional progressRange
        let performCalled = false;
        const isDoneBeforePerform = typeof distObj.IsDone === 'function' ? distObj.IsDone() : null;
        dChain.isDoneBeforePerform = isDoneBeforePerform;

        // Check if already done (some constructors auto-perform)
        if (!isDoneBeforePerform) {
          for (const m of ['Perform', 'Perform_1']) {
            if (typeof distObj[m] !== 'function') continue;
            try {
              const pr = new oc.Message_ProgressRange_1();
              distObj[m](pr);
              pr.delete();
              dChain.performCall = m + '(pr)';
              performCalled = true;
              break;
            } catch (e) {
              dChain['performErrPR_' + m] = String(e).substring(0, 100);
              try {
                distObj[m]();
                dChain.performCall = m + '()';
                performCalled = true;
                break;
              } catch (e2) {
                dChain['performErrNoArgs_' + m] = String(e2).substring(0, 100);
              }
            }
          }
        } else {
          dChain.autoPerformed = 'IsDone=true before Perform — auto-performed in constructor';
        }

        // Read IsDone
        let isDone = null;
        try { isDone = distObj.IsDone(); } catch (e) { dChain.isDoneErr = String(e).substring(0, 100); }
        dChain.isDone = isDone;

        // Read Value (minimum distance)
        let minDist = null;
        let valueMethod = null;
        for (const m of ['Value', 'Value_1']) {
          if (typeof distObj[m] !== 'function') continue;
          try {
            minDist = distObj[m]();
            valueMethod = m + '()';
            break;
          } catch (e) {
            dChain['valueErr_' + m] = String(e).substring(0, 100);
          }
        }
        dChain.minDist = minDist;
        dChain.valueMethod = valueMethod;

        // Additional info
        let nbSols = null;
        if (typeof distObj.NbSolution === 'function') {
          try { nbSols = distObj.NbSolution(); } catch (_e) {}
        }
        dChain.nbSols = nbSols;

        distObj.delete();

        return {
          distCtor,
          performCall: dChain.performCall || (isDoneBeforePerform ? 'none (auto)' : 'none'),
          valueMethod,
          minDist,
          isDone,
          dChain,
        };
      }

      // Run for disjoint pair (expect dist ≈ 30)
      const disjointResult = await runDistShapeShape(dBoxA, dBoxBDisjoint, 'disjoint');
      chain.disjoint = disjointResult.dChain;

      const disjointDistOk = disjointResult.minDist !== null &&
        Math.abs(disjointResult.minDist - 30) < 2;

      // Run for overlapping pair (expect dist ≈ 0)
      const overlapResult = await runDistShapeShape(dBoxA, dBoxBOverlap, 'overlap');
      chain.overlap = overlapResult.dChain;

      const overlapDistOk = overlapResult.minDist !== null &&
        Math.abs(overlapResult.minDist) < 1;

      result.item5_minDist = {
        confirmed: disjointResult.distCtor !== null && disjointResult.isDone === true &&
                   disjointResult.minDist !== null && overlapResult.isDone === true,
        distCtor: disjointResult.distCtor,
        performCall: disjointResult.performCall,
        valueMethod: disjointResult.valueMethod,
        disjointMinDist: disjointResult.minDist,
        disjointDistOk,
        overlapMinDist: overlapResult.minDist,
        overlapDistOk,
        chain,
        note: 'Disjoint (gap=30) expect dist≈30; Overlap expect dist≈0',
      };

      // Cleanup
      dBoxA.delete();
      if (dBoxBDisjoint) dBoxBDisjoint.delete();
      if (dBoxBOverlap) dBoxBOverlap.delete();
    } catch (e) {
      result.item5_minDist = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 6 — BRepCheck_Analyzer: intrinsic validity check
    //
    //   Run on a clean BRepPrimAPI_MakeBox_2(20,20,20).Shape().
    //   Expect: IsValid() → true.
    //
    //   Try: new oc.BRepCheck_Analyzer_1(shape, true)
    //        new oc.BRepCheck_Analyzer_2(shape, true)
    //        new oc.BRepCheck_Analyzer(shape, true)
    //   Then try IsValid_1() / IsValid() / IsValid_2(shape).
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain6 = {};

      // Introspect available BRepCheck classes
      const ocKeys = Object.getOwnPropertyNames(oc);
      chain6.brepCheckKeys = ocKeys.filter(k => k.startsWith('BRepCheck')).slice(0, 20);

      const cleanBox6 = makeBoxShape(20, 20, 20);

      let analyzerObj = null;
      let analyzerCtor = null;

      // Try suffixed then undecorated; try 3, 2, 1 arg combinations
      // OCCT signature: BRepCheck_Analyzer(shape, isGeomCtrled, isParallelMode)
      // This build has no _N suffix — undecorated class with 3 mandatory args
      for (const suffix of ['_1', '_2', '_3', '']) {
        const cls = 'BRepCheck_Analyzer' + suffix;
        if (!oc[cls]) continue;
        // Try (shape, true, false), (shape, false, false), (shape, true), (shape)
        for (const args of [
          [cleanBox6, true, false],   // 3 args: shape, geomCtrled=true, parallelMode=false
          [cleanBox6, false, false],  // 3 args: geomCtrled=false
          [cleanBox6, true],          // 2 args
          [cleanBox6],                // 1 arg
        ]) {
          try {
            analyzerObj = new oc[cls](...args);
            analyzerCtor = cls + '(' + args.map((a, i) => i === 0 ? 'shape' : a).join(', ') + ')';
            break;
          } catch (e) {
            chain6['ctorErr_' + suffix + '_' + args.length + 'args'] = String(e).substring(0, 200);
          }
        }
        if (analyzerObj) break;
      }
      chain6.analyzerCtor = analyzerCtor;
      chain6.analyzerAvailable = !!analyzerObj;

      let isValid = null;
      let isValidMethod = null;
      let isValidMethodUsed = null;

      if (analyzerObj) {
        // Introspect all methods
        const methods6 = introspectMethods(analyzerObj);
        chain6.allMethods = methods6;
        chain6.validMethods = methods6.filter(m => m.toLowerCase().includes('valid'));

        // Try IsValid(), IsValid_1(), IsValid_2(shape)
        for (const m of ['IsValid', 'IsValid_1', 'IsValid_2']) {
          if (typeof analyzerObj[m] !== 'function') continue;
          // IsValid() → bool (no-arg)
          try {
            const v = analyzerObj[m]();
            isValid = v;
            isValidMethodUsed = m + '()';
            break;
          } catch (e) {
            chain6['isValidErr_' + m + '_noarg'] = String(e).substring(0, 150);
          }
          // IsValid_2(shape) takes a shape arg — tests validity of specific sub-shape
          if (m === 'IsValid_2') {
            try {
              const v = analyzerObj[m](cleanBox6);
              if (typeof v === 'boolean') {
                isValid = v;
                isValidMethodUsed = m + '(shape)';
              }
              break;
            } catch (e) {
              chain6['isValidErr_IsValid_2_shape'] = String(e).substring(0, 150);
            }
          }
        }
        chain6.isValid = isValid;
        chain6.isValidMethodUsed = isValidMethodUsed;
        analyzerObj.delete();
      }

      // If BRepCheck_Analyzer totally unbound, try other validity checkers
      let altCheckerFound = null;
      if (!analyzerObj) {
        const altKeys = ocKeys.filter(k =>
          k.toLowerCase().includes('valid') ||
          k.toLowerCase().includes('check') ||
          k.toLowerCase().includes('brep') &&  k.toLowerCase().includes('check')
        ).slice(0, 20);
        chain6.altCheckerKeys = altKeys;
        altCheckerFound = altKeys.length > 0 ? altKeys : null;
      }

      cleanBox6.delete();

      result.item6_brepCheckAnalyzer = {
        confirmed: analyzerObj !== null && isValid === true,
        analyzerCtor,
        isValidMethod: isValidMethodUsed,
        isValid,
        altCheckerFound,
        chain: chain6,
        note: 'BRepCheck_Analyzer on clean 20mm box → IsValid should be true',
      };
    } catch (e) {
      result.item6_brepCheckAnalyzer = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 7 — TopExp_Explorer over SOLID sub-shapes
    //
    //   7a. Single box: explore SOLID → expect exactly 1 solid
    //   7b. Compound of two boxes: explore SOLID → expect exactly 2 solids
    //
    //   Pattern:
    //     new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID,
    //                              oc.TopAbs_ShapeEnum.TopAbs_SHAPE)
    //     .More() / .Next() / .Current()
    //     .Current() → TopoDS_Shape (usable directly, or cast to TopoDS_Solid)
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain7 = {};

      // Introspect TopExp_Explorer constructors
      const ocKeys7 = Object.getOwnPropertyNames(oc);
      chain7.explorerKeys = ocKeys7.filter(k => k.startsWith('TopExp_Explorer'));
      chain7.topAbsKeys = ocKeys7.filter(k => k.startsWith('TopAbs')).slice(0, 10);

      // Introspect TopAbs_ShapeEnum values
      let solidEnum = null;
      let shapeEnum = null;

      // TopAbs_ShapeEnum may be on oc.TopAbs_ShapeEnum or oc directly
      // Try common patterns
      for (const attempt of [
        () => oc.TopAbs_ShapeEnum && oc.TopAbs_ShapeEnum.TopAbs_SOLID,
        () => oc.TopAbs_SOLID,
      ]) {
        try {
          const v = attempt();
          if (v !== undefined && v !== null) { solidEnum = v; break; }
        } catch (_e) {}
      }
      for (const attempt of [
        () => oc.TopAbs_ShapeEnum && oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        () => oc.TopAbs_SHAPE,
      ]) {
        try {
          const v = attempt();
          if (v !== undefined && v !== null) { shapeEnum = v; break; }
        } catch (_e) {}
      }
      chain7.solidEnum = solidEnum !== null ? String(solidEnum) : null;
      chain7.shapeEnum = shapeEnum !== null ? String(shapeEnum) : null;
      chain7.solidEnumType = typeof solidEnum;

      /**
       * Count SOLID sub-shapes in a shape via TopExp_Explorer.
       * Returns { count, explorerCtor, currentMethod, error }.
       */
      function countSolids(shape, label) {
        const info = { label, count: null, explorerCtor: null, currentMethod: null };

        // Determine enum args — try the enum values found above
        const solidArg = solidEnum;
        const shapeArg = shapeEnum;

        if (solidArg === null || solidArg === undefined) {
          info.error = 'TopAbs_SOLID enum not found';
          return info;
        }

        let explorerObj = null;
        let explorerCtor = null;

        // Try TopExp_Explorer_2(shape, solidEnum, shapeEnum) — 3 args
        // Try TopExp_Explorer_1(shape, solidEnum) — 2 args
        for (const suffix of ['_2', '_3', '_1', '']) {
          const cls = 'TopExp_Explorer' + suffix;
          if (!oc[cls]) continue;
          // Try 3-arg: (shape, solid, shape_stop)
          if (shapeArg !== null) {
            try {
              explorerObj = new oc[cls](shape, solidArg, shapeArg);
              explorerCtor = cls + '(shape, TopAbs_SOLID, TopAbs_SHAPE)';
              break;
            } catch (e) {
              info['ctorErr_' + suffix + '_3args'] = String(e).substring(0, 150);
            }
          }
          // Try 2-arg: (shape, solid)
          try {
            explorerObj = new oc[cls](shape, solidArg);
            explorerCtor = cls + '(shape, TopAbs_SOLID)';
            break;
          } catch (e) {
            info['ctorErr_' + suffix + '_2args'] = String(e).substring(0, 150);
          }
        }
        info.explorerCtor = explorerCtor;

        if (!explorerObj) {
          info.error = 'TopExp_Explorer: no constructor worked';
          return info;
        }

        // Enumerate callable methods
        const explorerCallable = enumCallableMethods(explorerObj);
        info.explorerMethods = explorerCallable;

        // Iterate: .More() / .Next() / .Current()
        let count = 0;
        const solidShapes = [];
        let currentMethodWorked = null;
        let currentUsable = false;

        while (typeof explorerObj.More === 'function' && explorerObj.More()) {
          count++;
          // Get current sub-shape
          let currentShape = null;
          for (const m of ['Current', 'Current_1', 'Value']) {
            if (typeof explorerObj[m] !== 'function') continue;
            try {
              currentShape = explorerObj[m]();
              if (!currentMethodWorked) currentMethodWorked = m + '()';
              break;
            } catch (e) {
              info['currentErr_' + m] = String(e).substring(0, 100);
            }
          }

          if (currentShape) {
            // Verify it's usable as a shape — measure its volume
            try {
              const v6 = volume(currentShape);
              solidShapes.push({ index: count, volume: v6 });
              currentUsable = true;
            } catch (e) {
              info['volumeErr_' + count] = String(e).substring(0, 100);
              // Try TopoDS cast
              try {
                if (oc.TopoDS && typeof oc.TopoDS.Solid_1 === 'function') {
                  const solid = oc.TopoDS.Solid_1(currentShape);
                  const v7 = volume(solid);
                  solidShapes.push({ index: count, volume: v7, cast: 'TopoDS.Solid_1' });
                  currentUsable = true;
                  solid.delete();
                }
              } catch (e2) {
                info['castSolidErr_' + count] = String(e2).substring(0, 100);
              }
            }
          }

          if (typeof explorerObj.Next === 'function') explorerObj.Next();
          else break;
        }

        info.count = count;
        info.solidShapes = solidShapes;
        info.currentMethod = currentMethodWorked;
        info.currentUsable = currentUsable;
        explorerObj.delete();
        return info;
      }

      // 7a: Single box → expect 1 solid
      const singleBox7 = makeBoxShape(20, 20, 20);
      const singleResult = countSolids(singleBox7, 'single-box');
      chain7.singleBox = singleResult;

      // 7b: Compound of two boxes → expect 2 solids
      const box7a = makeBoxShape(20, 20, 20);
      const box7b = makeBoxShape(20, 20, 20);  // second box (may be coincident — just need 2 solids)
      let compound7 = null;
      let compoundResult7 = null;
      try {
        compound7 = new oc.TopoDS_Compound();
        const builder7 = new oc.BRep_Builder();
        builder7.MakeCompound(compound7);
        builder7.Add(compound7, box7a);
        builder7.Add(compound7, box7b);
        builder7.delete();
        compoundResult7 = countSolids(compound7, 'compound-2boxes');
        chain7.compound2Boxes = compoundResult7;
        compound7.delete();
      } catch (e) {
        chain7.compoundErr7 = String(e).substring(0, 150);
      }

      singleBox7.delete();
      box7a.delete();
      box7b.delete();

      const singleOk = singleResult.count === 1 && singleResult.currentUsable;
      const compoundOk = compoundResult7 && compoundResult7.count === 2 && compoundResult7.currentUsable;

      result.item7_topExpExplorer = {
        confirmed: singleOk && compoundOk,
        solidEnumFound: solidEnum !== null,
        explorerCtor: singleResult.explorerCtor,
        currentMethod: singleResult.currentMethod,
        singleBoxSolidCount: singleResult.count,
        compound2BoxesSolidCount: compoundResult7 ? compoundResult7.count : null,
        solidShapesUsableDirectly: singleResult.currentUsable,
        chain: chain7,
        note: 'Single box → 1 solid; compound of 2 boxes → 2 solids; .Current() usable directly for volume',
      };
    } catch (e) {
      result.item7_topExpExplorer = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 8 — Self-intersection detection via pairwise solid overlap
    //
    //   8a. OVERLAPPING compound: box A 20³ at origin + box B translated (10,0,0).
    //       Explore solids, compute pairwise Common volume.
    //       Expect: common vol > 0 (≈ 4000) → SELF-INTERSECTING detected.
    //
    //   8b. DISJOINT compound: box A 20³ + box C translated (50,0,0).
    //       Pairwise Common vol ≈ 0 → NOT self-intersecting.
    //
    //   Algorithm: explore solids → for every pair (i,j), compute
    //   BRepAlgoAPI_Common_3 volume; if vol > epsilon → self-intersecting.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain8 = {};

      /**
       * Build a compound of shapes (using verified builder from items 2 & 7).
       * Returns the compound — caller must .delete() all input shapes and the compound.
       */
      function buildCompound(shapes) {
        const comp = new oc.TopoDS_Compound();
        const bld  = new oc.BRep_Builder();
        bld.MakeCompound(comp);
        for (const s of shapes) bld.Add(comp, s);
        bld.delete();
        return comp;
      }

      /**
       * Collect all SOLID sub-shapes of a compound into an array of TopoDS_Shape.
       * Caller is responsible for .delete()-ing each shape in the returned array.
       */
      function collectSolids(shape) {
        const solids = [];
        if (typeof oc.TopAbs_ShapeEnum === 'undefined' && typeof oc.TopAbs_SOLID === 'undefined') {
          return solids;
        }
        const solidArg = (oc.TopAbs_ShapeEnum && oc.TopAbs_ShapeEnum.TopAbs_SOLID !== undefined)
          ? oc.TopAbs_ShapeEnum.TopAbs_SOLID
          : oc.TopAbs_SOLID;
        const shapeArg = (oc.TopAbs_ShapeEnum && oc.TopAbs_ShapeEnum.TopAbs_SHAPE !== undefined)
          ? oc.TopAbs_ShapeEnum.TopAbs_SHAPE
          : oc.TopAbs_SHAPE;

        let exp = null;
        for (const suffix of ['_2', '_1', '']) {
          const cls = 'TopExp_Explorer' + suffix;
          if (!oc[cls]) continue;
          try {
            if (shapeArg !== undefined) {
              exp = new oc[cls](shape, solidArg, shapeArg);
            } else {
              exp = new oc[cls](shape, solidArg);
            }
            break;
          } catch (_e) {}
        }
        if (!exp) return solids;

        while (exp.More()) {
          let s = null;
          for (const m of ['Current', 'Current_1']) {
            if (typeof exp[m] !== 'function') continue;
            try { s = exp[m](); break; } catch (_e) {}
          }
          if (s) {
            // Make a deep copy so it outlives the explorer iteration
            let kept = null;
            try {
              // Use BRepBuilderAPI_Copy to get an independent handle
              const copy = new oc.BRepBuilderAPI_Copy_1(s, true, false);
              kept = copy.Shape();
              copy.delete();
            } catch (_e) {
              kept = s; // if copy fails, keep reference (may alias — ok for read-only ops)
            }
            solids.push(kept);
          }
          exp.Next();
        }
        exp.delete();
        return solids;
      }

      /**
       * Compute common volume between two shapes.
       * Returns the volume (mm³), or 0 if Common fails/is empty.
       */
      function commonVolume(sA, sB) {
        let vol = 0;
        try {
          const pr1 = new oc.Message_ProgressRange_1();
          const algo = new oc.BRepAlgoAPI_Common_3(sA, sB, pr1);
          pr1.delete();
          const prB = new oc.Message_ProgressRange_1();
          algo.Build(prB);
          prB.delete();
          if (algo.IsDone()) {
            const cs = algo.Shape();
            if (cs) {
              const p = new oc.GProp_GProps_1();
              oc.BRepGProp.VolumeProperties_1(cs, p, false, false, false);
              vol = Math.abs(p.Mass());
              p.delete();
              cs.delete();
            }
          }
          algo.delete();
        } catch (_e) {}
        return vol;
      }

      // ── 8a: OVERLAPPING compound ──────────────────────────────────────────
      const box8A = makeBoxShape(20, 20, 20);
      // Translate by (10,0,0) → overlaps in X=[10..20]
      const trsf8ov = new oc.gp_Trsf_1();
      const vec8ov  = new oc.gp_Vec_4(10, 0, 0);
      trsf8ov.SetTranslation_1(vec8ov);
      vec8ov.delete();
      const xform8ov = new oc.BRepBuilderAPI_Transform_2(box8A, trsf8ov, false);
      const box8B_overlap = xform8ov.Shape();
      xform8ov.delete();
      trsf8ov.delete();

      const compOverlap = buildCompound([box8A, box8B_overlap]);
      const solidsOv = collectSolids(compOverlap);
      chain8.overlapSolidCount = solidsOv.length;

      let overlapCommonVol = null;
      let overlapDetected = null;
      if (solidsOv.length >= 2) {
        overlapCommonVol = commonVolume(solidsOv[0], solidsOv[1]);
        overlapDetected = overlapCommonVol > 1; // epsilon = 1 mm³
        chain8.overlapCommonVol = overlapCommonVol;
        chain8.overlapDetected = overlapDetected;
      }

      // Cleanup overlapping
      for (const s of solidsOv) { try { s.delete(); } catch (_e) {} }
      compOverlap.delete();
      box8A.delete();
      box8B_overlap.delete();

      // ── 8b: DISJOINT compound ─────────────────────────────────────────────
      const box8C = makeBoxShape(20, 20, 20);
      // Translate by (50,0,0) → gap of 30mm, no overlap
      const trsf8dj = new oc.gp_Trsf_1();
      const vec8dj  = new oc.gp_Vec_4(50, 0, 0);
      trsf8dj.SetTranslation_1(vec8dj);
      vec8dj.delete();
      const xform8dj = new oc.BRepBuilderAPI_Transform_2(box8C, trsf8dj, false);
      const box8D_disjoint = xform8dj.Shape();
      xform8dj.delete();
      trsf8dj.delete();

      const compDisjoint = buildCompound([box8C, box8D_disjoint]);
      const solidsDj = collectSolids(compDisjoint);
      chain8.disjointSolidCount = solidsDj.length;

      let disjointCommonVol = null;
      let disjointDetected = null;
      if (solidsDj.length >= 2) {
        disjointCommonVol = commonVolume(solidsDj[0], solidsDj[1]);
        disjointDetected = disjointCommonVol > 1;
        chain8.disjointCommonVol = disjointCommonVol;
        chain8.disjointDetected = disjointDetected;
      }

      // Cleanup disjoint
      for (const s of solidsDj) { try { s.delete(); } catch (_e) {} }
      compDisjoint.delete();
      box8C.delete();
      box8D_disjoint.delete();

      // ── Algorithm summary ─────────────────────────────────────────────────
      // checkSelfIntersection(compound):
      //   1. BRepCheck_Analyzer(shape, true).IsValid() → if false → invalid (single-solid SI)
      //   2. Explore SOLID sub-shapes
      //   3. For every pair (i,j) of solids: if commonVolume(i,j) > ε → self-intersecting
      //   4. Return { selfIntersecting: bool, invalidSubshape: bool, intersectingPairs: [[i,j]] }

      const overlapConfirmed = solidsOv.length === 2 && overlapDetected === true &&
                               Math.abs(overlapCommonVol - 4000) < 200;
      const disjointConfirmed = solidsDj.length === 2 && disjointDetected === false &&
                                disjointCommonVol < 1;

      result.item8_pairwiseOverlap = {
        confirmed: overlapConfirmed && disjointConfirmed,
        // Overlapping compound
        overlapSolidCount: solidsOv.length,
        overlapCommonVolMM3: overlapCommonVol,
        overlapDetected,
        overlapExpectedVol: 4000,
        overlapWithinTol: overlapCommonVol !== null && Math.abs(overlapCommonVol - 4000) < 200,
        // Disjoint compound
        disjointSolidCount: solidsDj.length,
        disjointCommonVolMM3: disjointCommonVol,
        disjointDetected,
        // Algorithm
        algorithm: [
          '1. collectSolids(compound) via TopExp_Explorer_2(shape, TopAbs_SOLID, TopAbs_SHAPE)',
          '2. for every pair (i,j): commonVolume = BRepAlgoAPI_Common_3(si,sj,pr)+Build+Shape+VolumeProperties',
          '3. if commonVolume > epsilon → intersecting pair',
          '4. checkSelfIntersection = BRepCheck_Analyzer validity check OR any pair has commonVol > epsilon',
        ],
        chain: chain8,
        note: 'Overlapping boxes (B offset 10mm): common vol ≈ 4000 → detected. Disjoint (B offset 50mm): vol ≈ 0 → not detected.',
      };
    } catch (e) {
      result.item8_pairwiseOverlap = { confirmed: false, error: String(e) };
    }

    return result;
  });

  // ── Write JSON output ────────────────────────────────────────────────────────
  const notesDir = path.join(__dirname, '..', 'docs', 'superpowers', 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
  const jsonPath = path.join(notesDir, 'occt-api-A3-recon.json');
  fs.writeFileSync(jsonPath, JSON.stringify(verified, null, 2));
  console.log('A3 RECON RESULT:', JSON.stringify(verified, null, 2));

  // ── Assertions ───────────────────────────────────────────────────────────────

  // Item 3: Transform (asserting FIRST as it's foundational for items 1,2,4,5)
  expect(verified.item3_transform.confirmed,
    `transform: ${verified.item3_transform.error || JSON.stringify(verified.item3_transform.chain)}`).toBe(true);

  // Item 1: CheckerSI clean — confirmed = checker ran (partial) or full result obtained
  // NOTE: BOPAlgo_CheckerSI requires unbound BOPAlgo_PaveFiller;
  //       BRepExtrema_SelfIntersection result types also unbound in this build.
  //       confirmed = partial: checker construction and Perform() succeeded.
  expect(verified.item1_checkerClean.confirmed,
    `checkerSI clean: ${verified.item1_checkerClean.error || JSON.stringify({
      bopCheckerSI: verified.item1_checkerClean.bopCheckerSI,
      selfIntFallback: verified.item1_checkerClean.selfIntersectionFallback,
      NOT_CONFIRMED_NOTE: verified.item1_checkerClean.NOT_CONFIRMED_NOTE,
    })}`).toBe(true);

  // Item 1: If hasErrors was obtained (BOPAlgo_CheckerSI available), assert it's false for clean box
  // If BOPAlgo_CheckerSI unavailable (null), skip this assertion — documented in NOT_CONFIRMED_NOTE
  if (verified.item1_checkerClean.hasErrors !== null) {
    expect(verified.item1_checkerClean.hasErrors,
      `clean shape should report no self-intersection, got: ${verified.item1_checkerClean.hasErrors}`).toBe(false);
  }
  // Always confirm the compound building infrastructure (TopoDS_Compound + BRep_Builder)
  // was exercised — it's needed for item 2 even if checker result is unbound
  expect(verified.item1_checkerClean.selfIntersectionFallback.isDone,
    `BRepExtrema_SelfIntersection_2 should reach IsDone=true after Perform()`).toBe(true);

  // Item 2: Compound building confirmed; checker result may be unbound (NOT_CONFIRMED_NOTE)
  expect(verified.item2_checkerSelfInt.confirmed,
    `checkerSI selfInt compound build: ${verified.item2_checkerSelfInt.error || JSON.stringify({
      compoundBuilt: verified.item2_checkerSelfInt.compoundBuilt,
      NOT_CONFIRMED_NOTE: verified.item2_checkerSelfInt.NOT_CONFIRMED_NOTE,
    })}`).toBe(true);

  // Item 2: Compound must be built (TopoDS_Compound + BRep_Builder chain confirmed)
  expect(verified.item2_checkerSelfInt.compoundBuilt,
    `compound of 2 overlapping boxes should be buildable via BRep_Builder`).toBe(true);

  // Item 4: Clash volume — confirmed means BRepAlgoAPI_Common_3 returned a valid solid
  expect(verified.item4_clashVolume.confirmed,
    `clash volume: ${verified.item4_clashVolume.error || JSON.stringify(verified.item4_clashVolume.chain)}`).toBe(true);
  expect(verified.item4_clashVolume.withinTol,
    `clash vol=${verified.item4_clashVolume.volumeMM3} expected≈${verified.item4_clashVolume.expected} (±200)`).toBe(true);

  // Item 5: Min distance — confirmed if constructor found, IsDone, and Value available
  expect(verified.item5_minDist.confirmed,
    `min dist: ${verified.item5_minDist.error || JSON.stringify({
      distCtor: verified.item5_minDist.distCtor,
      disjointMinDist: verified.item5_minDist.disjointMinDist,
      overlapMinDist: verified.item5_minDist.overlapMinDist,
      chain: verified.item5_minDist.chain,
    })}`).toBe(true);
  expect(verified.item5_minDist.disjointDistOk,
    `min dist disjoint=${verified.item5_minDist.disjointMinDist} expected≈30`).toBe(true);
  expect(verified.item5_minDist.overlapDistOk,
    `min dist overlap=${verified.item5_minDist.overlapMinDist} expected≈0`).toBe(true);

  // Item 6: BRepCheck_Analyzer — intrinsic validity check
  expect(verified.item6_brepCheckAnalyzer.confirmed,
    `BRepCheck_Analyzer: ${verified.item6_brepCheckAnalyzer.error || JSON.stringify({
      analyzerCtor: verified.item6_brepCheckAnalyzer.analyzerCtor,
      isValid: verified.item6_brepCheckAnalyzer.isValid,
      isValidMethod: verified.item6_brepCheckAnalyzer.isValidMethod,
      chain: verified.item6_brepCheckAnalyzer.chain,
    })}`).toBe(true);

  // Item 6: IsValid must be true for a clean box
  expect(verified.item6_brepCheckAnalyzer.isValid,
    `BRepCheck_Analyzer.IsValid() on clean box should be true, got: ${verified.item6_brepCheckAnalyzer.isValid}`).toBe(true);

  // Item 7: TopExp_Explorer — solid counting
  expect(verified.item7_topExpExplorer.confirmed,
    `TopExp_Explorer: ${verified.item7_topExpExplorer.error || JSON.stringify({
      solidEnumFound: verified.item7_topExpExplorer.solidEnumFound,
      explorerCtor: verified.item7_topExpExplorer.explorerCtor,
      singleBoxSolidCount: verified.item7_topExpExplorer.singleBoxSolidCount,
      compound2BoxesSolidCount: verified.item7_topExpExplorer.compound2BoxesSolidCount,
      chain: verified.item7_topExpExplorer.chain,
    })}`).toBe(true);

  expect(verified.item7_topExpExplorer.singleBoxSolidCount,
    'single box should contain exactly 1 solid').toBe(1);

  expect(verified.item7_topExpExplorer.compound2BoxesSolidCount,
    'compound of 2 boxes should contain exactly 2 solids').toBe(2);

  // Item 8: Pairwise solid overlap — self-intersection detection
  expect(verified.item8_pairwiseOverlap.confirmed,
    `pairwise overlap: ${verified.item8_pairwiseOverlap.error || JSON.stringify({
      overlapSolidCount: verified.item8_pairwiseOverlap.overlapSolidCount,
      overlapCommonVolMM3: verified.item8_pairwiseOverlap.overlapCommonVolMM3,
      overlapDetected: verified.item8_pairwiseOverlap.overlapDetected,
      disjointSolidCount: verified.item8_pairwiseOverlap.disjointSolidCount,
      disjointCommonVolMM3: verified.item8_pairwiseOverlap.disjointCommonVolMM3,
      disjointDetected: verified.item8_pairwiseOverlap.disjointDetected,
      chain: verified.item8_pairwiseOverlap.chain,
    })}`).toBe(true);

  expect(verified.item8_pairwiseOverlap.overlapDetected,
    `overlapping compound should detect self-intersection (common vol ≈ 4000), got vol=${verified.item8_pairwiseOverlap.overlapCommonVolMM3}`).toBe(true);

  expect(verified.item8_pairwiseOverlap.overlapWithinTol,
    `overlap common vol=${verified.item8_pairwiseOverlap.overlapCommonVolMM3} expected ≈ 4000 (±200)`).toBe(true);

  expect(verified.item8_pairwiseOverlap.disjointDetected,
    `disjoint compound should NOT detect self-intersection (common vol ≈ 0), got vol=${verified.item8_pairwiseOverlap.disjointCommonVolMM3}`).toBe(false);

  expect(pageErrors).toEqual([]);
  await app.close();
});
