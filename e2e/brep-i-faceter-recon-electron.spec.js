/**
 * brep-i-faceter-recon-electron.spec.js
 *
 * SP-7 (Area I — Faceting & tessellation) empirical kernel API reconnaissance.
 *
 * Confirms exactly what faceter / hidden-line API the bundled
 * opencascade.js@2.0.0-beta exposes, so the SP-7 facade is built on verified
 * call signatures rather than guesses. Probes:
 *
 *   1.  BRepMesh_IncrementalMesh — both constructor forms:
 *        (a) the explicit-args form (shape, linDefl, isRelative, angDefl, parallel)
 *        (b) the IMeshTools_Parameters form (shape, params [, progressRange])
 *   2.  IMeshTools_Parameters — which struct fields are writable
 *        (Deflection, Angle, DeflectionInterior, AngleInterior, MinSize,
 *         Relative, InParallel, AllowQualityDecrease, ControlSurfaceDeflection)
 *   3.  Chordal-deflection EFFECT — coarse vs fine deflection on a sphere must
 *        give monotonically more triangles (proves the linear-tol knob works).
 *   4.  Angular-deflection EFFECT — coarse vs fine angular tol on a cylinder
 *        side must change the triangle count (proves the angular knob works).
 *   5.  HLRBRep_Algo + HLRBRep_HLRToShape — hidden-line / silhouette extraction:
 *        is the class bound, can a projector be set, can VCompound /
 *        OutLineVCompound be read? (If unbound → SP-7 falls back to pure-JS
 *        silhouette extraction; the gap is recorded honestly.)
 *
 * Writes:  docs/superpowers/notes/kernel-api-I-recon.json
 * Pattern: e2e/brep-a3-recon-electron.spec.js
 * Package: opencascade.js@2.0.0-beta.b5ff984
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.setTimeout(600000);

test('SP-7 — faceter / hidden-line kernel API recon (items 1-5)', async () => {
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

  const verified = await win.evaluate(async () => {
    const oc = await window.__archdiscKernel.getOCCT();
    const result = {};

    // ── Shared helpers ────────────────────────────────────────────────────────
    function makeBox(dx, dy, dz) {
      const m = new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz);
      const s = m.Shape(); m.delete(); return s;
    }
    function makeSphere(r) {
      const m = new oc.BRepPrimAPI_MakeSphere_1(r);
      const s = m.Shape(); m.delete(); return s;
    }
    function makeCylinder(r, h) {
      const m = new oc.BRepPrimAPI_MakeCylinder_1(r, h);
      const s = m.Shape(); m.delete(); return s;
    }
    function introspect(obj) {
      const seen = new Set();
      let o = obj;
      while (o && o !== Object.prototype) {
        for (const k of Object.getOwnPropertyNames(o)) seen.add(k);
        o = Object.getPrototypeOf(o);
      }
      return [...seen].sort();
    }
    /** Mesh a shape and count its total triangles across all faces. */
    function triCount(shape) {
      let total = 0;
      const exp = new oc.TopExp_Explorer_2(
        shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      const loc = new oc.TopLoc_Location_1();
      for (; exp.More(); exp.Next()) {
        const face = oc.TopoDS.Face_1(exp.Current());
        const h = oc.BRep_Tool.Triangulation(face, loc, 0);
        if (h && !h.IsNull()) total += h.get().NbTriangles();
        if (h && typeof h.delete === 'function') h.delete();
        face.delete();
      }
      loc.delete(); exp.delete();
      return total;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 1 — BRepMesh_IncrementalMesh constructor forms
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};
      const meshKeys = Object.getOwnPropertyNames(oc).filter(k => k.startsWith('BRepMesh_IncrementalMesh'));
      chain.incrementalMeshKeys = meshKeys;

      // Form (a): explicit args (shape, linDefl, isRelative, angDefl, parallel)
      let formA = false, formACtor = null;
      const boxA = makeBox(20, 20, 20);
      for (const suffix of ['_2', '_3', '_1', '']) {
        const cls = 'BRepMesh_IncrementalMesh' + suffix;
        if (!oc[cls]) continue;
        try {
          const m = new oc[cls](boxA, 0.1, false, 0.5, false);
          m.delete();
          formA = true;
          formACtor = cls + '(shape, 0.1, false, 0.5, false)';
          break;
        } catch (e) {
          chain['formAErr_' + suffix] = String(e).substring(0, 140);
        }
      }
      chain.formA = formA;
      chain.formACtor = formACtor;
      // Confirm the mesh actually triangulated the box.
      chain.formATriCount = formA ? triCount(boxA) : 0;
      boxA.delete();

      // Form (b): IMeshTools_Parameters object
      let paramsCtor = null, paramsObj = null;
      for (const suffix of ['_1', '_2', '']) {
        const cls = 'IMeshTools_Parameters' + suffix;
        if (!oc[cls]) continue;
        try {
          paramsObj = new oc[cls]();
          paramsCtor = cls + '()';
          break;
        } catch (e) {
          chain['paramsCtorErr_' + suffix] = String(e).substring(0, 140);
        }
      }
      chain.imeshParamsCtor = paramsCtor;
      chain.imeshParamsAvailable = !!paramsObj;

      let formB = false, formBCtor = null, formBTriCount = 0;
      if (paramsObj) {
        chain.imeshParamsFields = introspect(paramsObj).filter(
          k => !['constructor', 'delete', 'deleteLater', 'isDeleted',
                 'clone', 'isAliasOf', '$$'].includes(k));
        // Set sane fields, then mesh a box with the params form.
        try { paramsObj.Deflection = 0.1; chain.setDeflectionOk = true; }
        catch (e) { chain.setDeflectionErr = String(e).substring(0, 120); }
        try { paramsObj.Angle = 0.3; chain.setAngleOk = true; }
        catch (e) { chain.setAngleErr = String(e).substring(0, 120); }

        const boxB = makeBox(20, 20, 20);
        for (const suffix of ['_2', '_3', '_1', '']) {
          const cls = 'BRepMesh_IncrementalMesh' + suffix;
          if (!oc[cls]) continue;
          // Try (shape, params) and (shape, params, progressRange).
          try {
            const m = new oc[cls](boxB, paramsObj);
            m.delete();
            formB = true; formBCtor = cls + '(shape, IMeshTools_Parameters)';
            break;
          } catch (e) {
            chain['formBErr2_' + suffix] = String(e).substring(0, 140);
            try {
              const pr = new oc.Message_ProgressRange_1();
              const m = new oc[cls](boxB, paramsObj, pr);
              m.delete(); pr.delete();
              formB = true; formBCtor = cls + '(shape, IMeshTools_Parameters, progressRange)';
              break;
            } catch (e2) {
              chain['formBErr3_' + suffix] = String(e2).substring(0, 140);
            }
          }
        }
        formBTriCount = formB ? triCount(boxB) : 0;
        boxB.delete();
        paramsObj.delete();
      }
      chain.formB = formB;
      chain.formBCtor = formBCtor;
      chain.formBTriCount = formBTriCount;

      result.item1_incrementalMesh = {
        confirmed: formA && chain.formATriCount > 0,
        explicitArgsForm: { available: formA, ctor: formACtor, triCount: chain.formATriCount },
        parametersForm:   { available: formB, ctor: formBCtor, triCount: formBTriCount },
        chain,
        note: 'Explicit-args form is the primary path; IMeshTools_Parameters form ' +
              'is preferred when bound (exposes interior tol independently).',
      };
    } catch (e) {
      result.item1_incrementalMesh = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 2 — IMeshTools_Parameters writable fields
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};
      let obj = null;
      for (const suffix of ['_1', '_2', '']) {
        const cls = 'IMeshTools_Parameters' + suffix;
        if (!oc[cls]) continue;
        try { obj = new oc[cls](); chain.ctor = cls + '()'; break; } catch (_e) {}
      }
      if (obj) {
        const fields = [
          ['Deflection', 0.05], ['Angle', 0.2], ['DeflectionInterior', 0.05],
          ['AngleInterior', 0.2], ['MinSize', 0.001], ['Relative', false],
          ['InParallel', true], ['AllowQualityDecrease', true],
          ['ControlSurfaceDeflection', true],
        ];
        const writable = {};
        for (const [name, val] of fields) {
          try {
            obj[name] = val;
            // Read it back to confirm the binding round-trips.
            const got = obj[name];
            writable[name] = { set: true, readBack: got, matches: got === val };
          } catch (e) {
            writable[name] = { set: false, error: String(e).substring(0, 100) };
          }
        }
        chain.writable = writable;
        obj.delete();
      } else {
        chain.note = 'IMeshTools_Parameters not constructible';
      }
      const writableCount = chain.writable
        ? Object.values(chain.writable).filter(w => w.set).length : 0;
      result.item2_meshParams = {
        confirmed: writableCount >= 4,
        writableFieldCount: writableCount,
        chain,
        note: 'Confirms which IMeshTools_Parameters fields the Embind binding ' +
              'exposes as settable struct members.',
      };
    } catch (e) {
      result.item2_meshParams = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 3 — chordal-deflection EFFECT (sphere: coarse < fine triangle count)
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};
      // r=25 mm sphere — a curved surface where linear tol bites hard.
      const counts = {};
      for (const [label, defl] of [['coarse', 2.0], ['medium', 0.5], ['fine', 0.05]]) {
        const sph = makeSphere(25);
        new oc.BRepMesh_IncrementalMesh_2(sph, defl, false, 1.0, false).delete();
        counts[label] = triCount(sph);
        sph.delete();
      }
      chain.triCounts = counts;
      // Finer deflection ⇒ strictly more triangles.
      const monotonic = counts.coarse < counts.medium && counts.medium < counts.fine;
      result.item3_chordalEffect = {
        confirmed: monotonic && counts.fine > counts.coarse * 4,
        triCounts: counts,
        monotonic,
        ratio: counts.coarse > 0 ? (counts.fine / counts.coarse) : 0,
        chain,
        note: 'Sphere r=25: linear deflection 2.0→0.5→0.05 must give strictly ' +
              'increasing triangle counts (≥4× coarse→fine).',
      };
    } catch (e) {
      result.item3_chordalEffect = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 4 — angular-deflection EFFECT (cylinder side: angular tol changes count)
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};
      // Cylinder r=20 h=40. Hold linear tol generous & constant; vary angular.
      const counts = {};
      for (const [label, ang] of [['coarseAng', 1.2], ['fineAng', 0.15]]) {
        const cyl = makeCylinder(20, 40);
        new oc.BRepMesh_IncrementalMesh_2(cyl, 5.0, false, ang, false).delete();
        counts[label] = triCount(cyl);
        cyl.delete();
      }
      chain.triCounts = counts;
      // Tighter angular tol ⇒ more facets around the cylinder side.
      const angularBites = counts.fineAng > counts.coarseAng;
      result.item4_angularEffect = {
        confirmed: angularBites,
        triCounts: counts,
        angularBites,
        ratio: counts.coarseAng > 0 ? (counts.fineAng / counts.coarseAng) : 0,
        chain,
        note: 'Cylinder r=20: with linear tol fixed at 5.0 mm, angular ' +
              'deflection 1.2→0.15 rad must increase the side facet count.',
      };
    } catch (e) {
      result.item4_angularEffect = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 5 — HLRBRep_Algo + HLRBRep_HLRToShape (hidden-line / silhouette)
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};
      const ocKeys = Object.getOwnPropertyNames(oc);
      chain.hlrKeys = ocKeys.filter(k => k.startsWith('HLRBRep') || k.startsWith('HLRAlgo'));
      chain.projectorKeys = ocKeys.filter(k => k.startsWith('HLRAlgo_Projector') || k.startsWith('Prs3d'));

      // Try to construct HLRBRep_Algo.
      let algoObj = null, algoCtor = null;
      for (const suffix of ['_1', '']) {
        const cls = 'HLRBRep_Algo' + suffix;
        if (!oc[cls]) continue;
        try { algoObj = new oc[cls](); algoCtor = cls + '()'; break; }
        catch (e) { chain['algoCtorErr_' + suffix] = String(e).substring(0, 140); }
      }
      chain.algoCtor = algoCtor;
      chain.algoAvailable = !!algoObj;
      if (algoObj) {
        chain.algoMethods = introspect(algoObj).filter(
          k => typeof algoObj[k] === 'function' && k !== 'constructor');
      }

      // Try HLRAlgo_Projector — needs a gp_Ax2 or gp_Trsf.
      let projObj = null, projCtor = null;
      const projKeys = ocKeys.filter(k => k.startsWith('HLRAlgo_Projector'));
      chain.hlrAlgoProjectorKeys = projKeys;
      for (const cls of projKeys) {
        try {
          // (gp_Ax2) — orthographic projection along the Ax2's Z.
          const origin = new oc.gp_Pnt_3(0, 0, 0);
          const dir = new oc.gp_Dir_4(0, 0, 1);
          const ax2 = new oc.gp_Ax2_3(origin, dir);
          projObj = new oc[cls](ax2);
          projCtor = cls + '(gp_Ax2)';
          origin.delete(); dir.delete(); ax2.delete();
          break;
        } catch (e) {
          chain['projCtorErr_' + cls] = String(e).substring(0, 120);
        }
      }
      chain.projectorCtor = projCtor;
      chain.projectorAvailable = !!projObj;

      // Try HLRBRep_HLRToShape.
      const toShapeKeys = ocKeys.filter(k => k.startsWith('HLRBRep_HLRToShape'));
      chain.hlrToShapeKeys = toShapeKeys;

      // Attempt the full pipeline on a box if all pieces bind.
      let pipelineRan = false, vCompoundOk = false, outlineOk = false;
      if (algoObj && projObj) {
        try {
          const box = makeBox(20, 20, 20);
          // Projector MUST be set before Add in HLRBRep_Algo. Set it first.
          for (const m of ['Projector', 'Projector_1', 'Projector_2']) {
            if (typeof algoObj[m] !== 'function') continue;
            try { algoObj[m](projObj); chain.projectorSet = m; break; }
            catch (e) { chain['projectorSetErr_' + m] = String(e).substring(0, 120); }
          }
          // Add — the binding reports Add_1 wants 3 args, Add_2 wants 2.
          // HLRBRep_Algo::Add(shape, nbIso) is the documented 2-arg form;
          // the 3-arg form adds an Aspect/projector. Probe arg combinations.
          let added = false;
          const addAttempts = [
            ['Add_2', [box, 0]], ['Add_2', [box, 1]], ['Add_2', [box]],
            ['Add_1', [box, projObj, 0]], ['Add_1', [box, 0, 0]],
            ['Add', [box, 0]], ['Add', [box]],
          ];
          for (const [m, args] of addAttempts) {
            if (typeof algoObj[m] !== 'function') continue;
            try {
              algoObj[m](...args);
              added = true;
              chain.addMethod = m + '(' + args.map((a, i) => i === 0 ? 'shape' : a).join(',') + ')';
              break;
            } catch (e) {
              chain['addErr_' + m + '_' + args.length] = String(e).substring(0, 110);
            }
          }
          chain.added = added;
          if (added) {
            // Update() + Hide()
            try { algoObj.Update(); chain.updateOk = true; }
            catch (e) { chain.updateErr = String(e).substring(0, 120); }
            try { algoObj.Hide(); chain.hideOk = true; }
            catch (e) {
              chain.hideErr = String(e).substring(0, 120);
              // Hide_1/_2/_3 variants
              for (const hm of ['Hide_1', 'Hide_2', 'Hide_3']) {
                if (typeof algoObj[hm] !== 'function') continue;
                try { algoObj[hm](); chain.hideOk = hm; break; }
                catch (e2) { chain['hideErr_' + hm] = String(e2).substring(0, 100); }
              }
            }

            // HLRBRep_HLRToShape wants a Handle_HLRBRep_Algo, not the raw
            // object. Probe ways to obtain the handle.
            chain.handleAlgoKeys = ocKeys.filter(k => k.startsWith('Handle_HLRBRep_Algo'));
            const handleCandidates = [];
            // (a) algoObj.This() — opencascade.js exposes This() on Standard_Transient.
            try {
              if (typeof algoObj.This === 'function') {
                handleCandidates.push(['This()', algoObj.This()]);
              }
            } catch (e) { chain.thisErr = String(e).substring(0, 100); }
            // (b) explicit Handle_HLRBRep_Algo_N constructors.
            for (const hcls of chain.handleAlgoKeys) {
              try { handleCandidates.push([hcls + '(algo)', new oc[hcls](algoObj)]); }
              catch (e) { chain['handleCtorErr_' + hcls] = String(e).substring(0, 100); }
            }
            // HLRBRep_HLRToShape(algoHandle)
            for (const cls of toShapeKeys) {
              let made = false;
              for (const [hlabel, handle] of handleCandidates) {
                if (!handle) continue;
                try {
                  const toShape = new oc[cls](handle);
                  chain.toShapeCtor = cls + '(' + hlabel + ')';
                  chain.toShapeMethods = introspect(toShape).filter(
                    k => typeof toShape[k] === 'function' && k !== 'constructor');
                  pipelineRan = true;
                  for (const m of ['VCompound', 'VCompound_1', 'VCompound_2']) {
                    if (typeof toShape[m] !== 'function') continue;
                    try { const cc = toShape[m](); vCompoundOk = !!cc; if (cc && cc.delete) cc.delete(); break; }
                    catch (e) { chain['vCompoundErr_' + m] = String(e).substring(0, 100); }
                  }
                  for (const m of ['OutLineVCompound', 'OutLineVCompound_1']) {
                    if (typeof toShape[m] !== 'function') continue;
                    try { const cc = toShape[m](); outlineOk = !!cc; if (cc && cc.delete) cc.delete(); break; }
                    catch (e) { chain['outlineErr_' + m] = String(e).substring(0, 100); }
                  }
                  toShape.delete();
                  made = true;
                  break;
                } catch (e) {
                  chain['toShapeHandleErr_' + hlabel] = String(e).substring(0, 110);
                }
              }
              if (made) break;
            }
            // Legacy raw-object attempt (kept for the record).
            for (const cls of (pipelineRan ? [] : toShapeKeys)) {
              try {
                const toShape = new oc[cls](algoObj);
                pipelineRan = true;
                chain.toShapeCtor = cls + '(algo-raw)';
                chain.toShapeMethods = introspect(toShape).filter(
                  k => typeof toShape[k] === 'function' && k !== 'constructor');
                // VCompound = visible sharp edges; OutLineVCompound = silhouette.
                for (const m of ['VCompound', 'VCompound_1', 'VCompound_2']) {
                  if (typeof toShape[m] !== 'function') continue;
                  try { const c = toShape[m](); vCompoundOk = !!c; if (c && c.delete) c.delete(); break; }
                  catch (e) { chain['vCompoundErr_' + m] = String(e).substring(0, 100); }
                }
                for (const m of ['OutLineVCompound', 'OutLineVCompound_1']) {
                  if (typeof toShape[m] !== 'function') continue;
                  try { const c = toShape[m](); outlineOk = !!c; if (c && c.delete) c.delete(); break; }
                  catch (e) { chain['outlineErr_' + m] = String(e).substring(0, 100); }
                }
                toShape.delete();
                break;
              } catch (e) {
                chain['toShapeCtorErr_' + cls] = String(e).substring(0, 120);
              }
            }
          }
          box.delete();
        } catch (e) {
          chain.pipelineErr = String(e).substring(0, 150);
        }
      }
      if (algoObj) algoObj.delete();
      if (projObj) projObj.delete();

      // "confirmed" here means we have a DEFINITIVE answer (bound or not),
      // not that HLR necessarily works — SP-7 has a pure-JS fallback.
      result.item5_hiddenLine = {
        confirmed: true,
        hlrAlgoAvailable: chain.algoAvailable,
        projectorAvailable: chain.projectorAvailable,
        pipelineRan,
        vCompoundReadable: vCompoundOk,
        outlineReadable: outlineOk,
        hlrFullyBound: pipelineRan && vCompoundOk,
        chain,
        VERDICT: (pipelineRan && vCompoundOk)
          ? 'HLRBRep pipeline bound — facade can use OCCT hidden-line directly.'
          : 'HLRBRep pipeline NOT fully bound in opencascade.js@2.0.0-beta — ' +
            'SP-7 uses a pure-JS silhouette extractor (mesh edges whose two ' +
            'adjacent faces straddle the view direction). Documented gap.',
      };
    } catch (e) {
      result.item5_hiddenLine = { confirmed: false, error: String(e) };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Item 6 — edge discretisation (HLR result edges → polylines)
    //   BRepAdaptor_Curve + GCPnts_UniformDeflection — needed to turn the
    //   HLR-extracted edge compounds into drawable polylines.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const chain = {};
      const ocKeys = Object.getOwnPropertyNames(oc);
      chain.adaptorKeys = ocKeys.filter(k => k.startsWith('BRepAdaptor_Curve'));
      chain.gcpntsKeys = ocKeys.filter(k => k.startsWith('GCPnts_UniformDeflection'));

      // Get one edge off a box.
      const box = makeBox(20, 20, 20);
      const edgeExp = new oc.TopExp_Explorer_2(
        box, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      let edge = null;
      if (edgeExp.More()) edge = oc.TopoDS.Edge_1(edgeExp.Current());
      edgeExp.delete();

      let discretised = false, nbPts = 0, adaptorCtor = null, gcpntsCtor = null;
      if (edge) {
        // BRepAdaptor_Curve_2(edge)
        let adaptor = null;
        for (const suffix of ['_2', '_1', '']) {
          const cls = 'BRepAdaptor_Curve' + suffix;
          if (!oc[cls]) continue;
          try { adaptor = new oc[cls](edge); adaptorCtor = cls + '(edge)'; break; }
          catch (e) { chain['adaptorErr_' + suffix] = String(e).substring(0, 110); }
        }
        if (adaptor) {
          const f = adaptor.FirstParameter();
          const l = adaptor.LastParameter();
          // GCPnts_UniformDeflection overloads differ in arity — probe many.
          const gcAttempts = [
            ['_2', [adaptor, 0.05, false]],
            ['_2', [adaptor, 0.05]],
            ['_3', [adaptor, 0.05, f, l, false]],
            ['_3', [adaptor, 0.05, f, l]],
            ['_4', [adaptor, 0.05, false]],
            ['_5', [adaptor, 0.05, f, l, false]],
            ['_2', [adaptor, 0.05, false, true]],
          ];
          for (const [suffix, args] of gcAttempts) {
            const cls = 'GCPnts_UniformDeflection' + suffix;
            if (!oc[cls]) continue;
            try {
              const g = new oc[cls](...args);
              if (g.IsDone()) { discretised = true; nbPts = g.NbPoints(); }
              gcpntsCtor = cls + '(' + args.length + ' args)';
              g.delete();
              if (discretised) break;
            } catch (e) {
              chain['gcpntsErr_' + suffix + '_' + args.length] = String(e).substring(0, 110);
            }
          }
          // Also try GCPnts_QuasiUniformDeflection / TangentialDeflection /
          // GCPnts_QuasiUniformAbscissa as alternatives.
          if (!discretised) {
            chain.altDiscretiseKeys = ocKeys.filter(k =>
              k.startsWith('GCPnts_QuasiUniform') || k.startsWith('GCPnts_TangentialDeflection') ||
              k.startsWith('GCPnts_UniformAbscissa'));
            for (const cls of (chain.altDiscretiseKeys || [])) {
              for (const args of [[adaptor, 0.05, false], [adaptor, 0.05], [adaptor, 20]]) {
                try {
                  const g = new oc[cls](...args);
                  if (typeof g.IsDone !== 'function' || g.IsDone()) {
                    discretised = true;
                    nbPts = typeof g.NbPoints === 'function' ? g.NbPoints() : 0;
                    gcpntsCtor = cls + '(' + args.length + ' args)';
                  }
                  g.delete();
                  if (discretised) break;
                } catch (e) {
                  chain['altErr_' + cls + '_' + args.length] = String(e).substring(0, 90);
                }
              }
              if (discretised) break;
            }
          }
          adaptor.delete();
        }
        edge.delete();
      }
      box.delete();
      chain.adaptorCtor = adaptorCtor;
      chain.gcpntsCtor = gcpntsCtor;
      chain.nbPts = nbPts;

      result.item6_edgeDiscretise = {
        confirmed: discretised && nbPts >= 2,
        adaptorCtor,
        gcpntsCtor,
        nbPoints: nbPts,
        chain,
        note: 'BRepAdaptor_Curve + GCPnts_UniformDeflection turn HLR result ' +
              'edges into polylines for drawing / overlay.',
      };
    } catch (e) {
      result.item6_edgeDiscretise = { confirmed: false, error: String(e) };
    }

    return result;
  });

  // ── Persist the recon JSON ──────────────────────────────────────────────────
  const notesDir = path.join(__dirname, '..', 'docs', 'superpowers', 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(
    path.join(notesDir, 'kernel-api-I-recon.json'),
    JSON.stringify(verified, null, 2),
  );

  // ── Assertions ──────────────────────────────────────────────────────────────
  console.log('Item 1 — IncrementalMesh:', JSON.stringify(verified.item1_incrementalMesh, null, 1));
  console.log('Item 2 — MeshParams:', JSON.stringify(verified.item2_meshParams, null, 1));
  console.log('Item 3 — Chordal effect:', JSON.stringify(verified.item3_chordalEffect.triCounts));
  console.log('Item 4 — Angular effect:', JSON.stringify(verified.item4_angularEffect.triCounts));
  console.log('Item 5 — Hidden-line VERDICT:', verified.item5_hiddenLine.VERDICT);

  expect(verified.item1_incrementalMesh.confirmed,
    `BRepMesh_IncrementalMesh: ${verified.item1_incrementalMesh.error || JSON.stringify(verified.item1_incrementalMesh.chain)}`).toBe(true);

  expect(verified.item2_meshParams.confirmed,
    `IMeshTools_Parameters writable fields: ${verified.item2_meshParams.error || JSON.stringify(verified.item2_meshParams.chain)}`).toBe(true);

  expect(verified.item3_chordalEffect.confirmed,
    `chordal deflection effect: ${verified.item3_chordalEffect.error || JSON.stringify(verified.item3_chordalEffect.triCounts)}`).toBe(true);

  expect(verified.item4_angularEffect.confirmed,
    `angular deflection effect: ${verified.item4_angularEffect.error || JSON.stringify(verified.item4_angularEffect.triCounts)}`).toBe(true);

  // Item 5 always "confirmed" (definitive answer); just require no crash.
  expect(verified.item5_hiddenLine.confirmed,
    `hidden-line recon: ${verified.item5_hiddenLine.error || ''}`).toBe(true);

  console.log('Item 6 — Edge discretise:', JSON.stringify({
    adaptorCtor: verified.item6_edgeDiscretise.adaptorCtor,
    gcpntsCtor: verified.item6_edgeDiscretise.gcpntsCtor,
    nbPoints: verified.item6_edgeDiscretise.nbPoints,
  }));
  expect(verified.item6_edgeDiscretise.confirmed,
    `edge discretisation: ${verified.item6_edgeDiscretise.error || JSON.stringify(verified.item6_edgeDiscretise.chain)}`).toBe(true);

  expect(pageErrors).toEqual([]);
  await app.close();
});
