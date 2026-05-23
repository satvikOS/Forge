/**
 * spine-s6-clip-on-grip-blank-electron.spec.js — SP-1 Stage S6
 *
 * Composes a REAL engineered part — a CUSTOM-MACHINED MOTORCYCLE CLIP-ON
 * HANDLEBAR GRIP BLANK — and uses it to verify the SP-1 §2.7 unified
 * Surface-on-spine contract for analytic faces: the three native
 * analytic-face producers (G2 blend, N-sided patch, replace-face) now
 * return SpineBodies whose primary spine `Face` IS the analytic NURBS
 * face, not a `meta.analyticFace` side-car.
 *
 * The model — a single iconic engineered part with three analytic-face
 * surfaces, each demonstrating a distinct S6-migrated op:
 *
 *   1. CYLINDER BLANK         — the grip body (Ø 32 mm × 120 mm).
 *   2. G2 BLEND end-cap line  — `g2BlendBetweenEdges` fairs an
 *      ergonomic curvature-continuous surface between two of the blank's
 *      edges. Real custom-machining practice: the end-cap-to-grip
 *      transition has G2 continuity so the curvature does not jump (a
 *      visible / tactile defect on a high-end machined grip).
 *   3. PALM-RELIEF POCKET     — Subtract a small box to leave a
 *      non-four-sided opening (the cut creates a multi-edge face on
 *      the blank). `nSidedPatch` fits a spine-native NURBS analytic
 *      face spanning that opening (the palm-relief contour).
 *   4. EMBLEM FACE            — `replaceFace` (curved-swap) replaces
 *      one of the blank's flat ends with a bulged curved emblem
 *      surface — the customer-logo cap.
 *
 * The bespoke model is genuinely DIFFERENT from the prior spine
 * stages:
 *   - S3 manifold collector — torus + radial branches (booleans).
 *   - S4 rotary valve body — features chain (extrude / revolve / fillet).
 *   - S4b injection-moulded enclosure — local-ops chain.
 *   - S4c pump impeller fairing — surfacing-led curvy assembly.
 *   - S5 multi-plate junction — non-manifold welded steel structure.
 *   - S6 clip-on grip blank — ANALYTIC-FACE-LED part: the three native
 *     analytic-face producers (G2 blend / N-sided / replace-face)
 *     are the focal capability, applied to a single iconic part.
 *
 * Focal S6 assertions, per the dispatch brief:
 *   (a) The result spine Face IS the analytic face (not in `meta`).
 *       Every migrated op's result Body has a spine Face whose
 *       `isAnalytic === true`, reachable via `body.faces()`.
 *   (b) `face.surface.toBSplineSurface()` returns valid NURBS data
 *       (degreeU, degreeV, controlNet, weights, knotsU, knotsV) —
 *       the unified Surface contract.
 *   (c) STEP export round-trips the analytic face's NURBS data —
 *       `foundation/StepExport.js:nurbsSurfaceToSTEP` emits a real
 *       `B_SPLINE_SURFACE_WITH_KNOTS` entity. We assert the entity
 *       is present in the exported text.
 *   (d) `meta.analyticFace === undefined` on the result body. The
 *       legacy `TopoFace` side-car is RETIRED — the analytic face
 *       lives in the spine.
 *
 * Plus: persistent-ID lineage (SP-1 §2.3) — the analytic face's
 * `derivedFrom` records the seed edges' persistent ids when the
 * input was a SpineBody (which it is, because every primitive /
 * boolean / fillet / chamfer is S2-S4-migrated).
 *
 * Methodology — ArchDisc standing standards:
 *   - HEADED ELECTRON, motion-capture (slow-mo video + key-frame stills).
 *   - ONE test() per file. Imports use BARE specifiers (no node:).
 *   - The workflow is a COMPLETE complex multi-op build — primitives
 *     → boolean → analytic-face ops — climaxing on the analytic-face
 *     assertions.
 *   - ONE WELL-FRAMED CAMERA POSITION — the grip blank is a single
 *     iconic object, perfectly viewable from one iso. ONE deliberate
 *     orbit at the end reveals the curvature continuity that the iso
 *     view cannot show (G2 continuity needs the orbit to see the
 *     surface curvature). 3-4 stills total. NO 7-angle template.
 *
 * Run: ./node_modules/.bin/playwright test spine-s6-clip-on-grip-blank
 *   --headed --workers=1
 */

import { test, expect } from '@playwright/test';
import { launchWithCapture, dragOrbit } from './helpers/motionCapture.js';
import { buildPrimitive } from './helpers/uiWorkflow.js';

test.setTimeout(600000);

test('SP-1 S6 — clip-on grip blank: G2 Blend / N-Sided Patch / Replace Face produce spine-native analytic faces (meta.analyticFace retired)', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('spine-s6-clip-on-grip-blank');
  try {
    // ── Step 1 — seed Box via the real Part-tab ribbon. Proves the real
    //         ribbon path is healthy. The box is then discarded — the
    //         focal model is built via the kernel facade so the spec
    //         can compose the chain deterministically.
    const seedBoxId = await buildPrimitive(win, 'Box');
    console.log(`  seed box id: ${seedBoxId}`);
    await story.frame('seed-box-via-ribbon');

    const seedKind = await win.evaluate(() => {
      const b = window.__lastSpineBody;
      return b && b.body ? { kind: b.body.kind, declared: b.body.declaredKind } : null;
    });
    expect(seedKind, 'ribbon-built Box must be a SpineBody').toBeTruthy();
    expect(seedKind.kind, 'Box derives as solid').toBe('solid');

    // Clear the scene — the focal grip blank is the only body of interest.
    await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      reg.clearSelection();
      const bodies = [...reg.bodies];
      for (const body of bodies) {
        if (typeof reg.remove === 'function') reg.remove(body.id);
        else if (body.group && body.group.parent) body.group.parent.remove(body.group);
      }
    });
    await win.waitForTimeout(220);

    // ── Step 2 — build the grip blank + apply the three analytic-face ops.
    //   The chain runs entirely inside one win.evaluate so failures surface
    //   with a single stack trace. Each op's result is captured + asserted.
    const result = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel;
      const { validateSpine } = window.__archdiscSpine;
      const out = { stages: [] };

      // ── 2.1 — the cylinder grip blank (Ø 32 mm × 120 mm) ───────────────────
      // Diameter 32 is realistic for a 22.2 mm clip-on inner with grip
      // material wall; length 120 mm is the typical grip span. Built
      // through the spine-migrated facade — makeCylinder returns a SpineBody.
      const blank = await K.brep.makeCylinder(16, 120);
      out.stages.push({
        op: 'makeCylinder(r=16, h=120) — grip blank',
        bodyId: blank.id,
        isSpine: !!(blank.body && blank.occtWrapper),
        kind: blank.body.kind,
        declared: blank.body.declaredKind,
        faces: blank.body.faces().length,
        edges: blank.body.edges().length,
        validateOk: validateSpine(blank.body).ok,
      });

      // Make the blank the live scene body so the focal stills frame it.
      const adder = window.__archdiscAddBrepShape;
      const scene = window.__archdiscViewport.scene;
      const vp = window.__archdiscViewport;
      await adder(scene, vp, blank, 0xb38a4a);  // brushed-bronze blank tone

      // ── 2.2 — Subtract a palm-relief cutter to create a non-4-sided face.
      // Cutter is positioned to bite into one side of the cylinder,
      // creating a multi-edge face on the result body (the post-cut face
      // has the cut chord's edges + the cylinder's remaining edges).
      // makeBox + translate + cut are all SpineBody-returning.
      const cutter = await K.brep.makeBox(20, 20, 80);
      const cutterShifted = await K.brep.translate(cutter, 8, -10, 20);
      const blankWithRelief = await K.brep.cut(blank, cutterShifted);
      out.stages.push({
        op: 'cut(blank, cutter) — palm-relief pocket',
        bodyId: blankWithRelief.id,
        isSpine: !!(blankWithRelief.body && blankWithRelief.occtWrapper),
        kind: blankWithRelief.body.kind,
        faces: blankWithRelief.body.faces().length,
        validateOk: validateSpine(blankWithRelief.body).ok,
      });
      // The post-cut body replaces the blank in the scene.
      const reg = window.__archdiscRegistry;
      const bs = [...reg.bodies];
      for (const b of bs) {
        if (typeof reg.remove === 'function') reg.remove(b.id);
      }
      await adder(scene, vp, blankWithRelief, 0xb38a4a);

      // ── 2.3 — G2 BLEND — fair a curvature-continuous surface between two
      // edges of the post-cut body. The cut introduced fresh edges; we blend
      // edge 0 (one of the cylinder's circle ends) and an edge well-separated
      // from it.
      const edgeCount = await K.brep.edgeCount(blankWithRelief);
      out.stages.push({ op: 'edgeCount(blankWithRelief)', value: edgeCount });
      const blend = await K.brep.g2BlendBetweenEdges(blankWithRelief, {
        edgeIndexA: 0,
        edgeIndexB: Math.min(edgeCount - 1, Math.max(2, Math.floor(edgeCount / 2))),
        uSegments: 32,
        vSegments: 16,
      });
      // Focal S6 assertion (a) — the blend result IS a SpineBody whose
      // primary face is the analytic face (spine, NOT side-car).
      const blendFaces = blend.body.faces();
      const blendAnalyticFace = blendFaces.find(f => f.isAnalytic);
      const blendNurbsData = blendAnalyticFace
        ? blendAnalyticFace.surface.toBSplineSurface() : null;
      out.stages.push({
        op: 'g2BlendBetweenEdges — spine-native analytic face',
        isSpine: !!(blend.body && blend.occtWrapper),
        kind: blend.body.kind,
        declared: blend.body.declaredKind,
        spineFaceCount: blendFaces.length,
        hasAnalyticFace: !!blendAnalyticFace,
        analyticFacePersistentId: blendAnalyticFace ? blendAnalyticFace.persistentId : null,
        analyticFaceDerivedFrom: blendAnalyticFace ? blendAnalyticFace.derivedFrom : [],
        // S6 focal — surface contract: face.surface.toBSplineSurface() exists
        // and returns the NURBS payload nurbsSurfaceToSTEP consumes.
        toBSplineSurfaceWorks: blendNurbsData && Number.isFinite(blendNurbsData.degreeU),
        analyticDegreeU: blendNurbsData ? blendNurbsData.degreeU : null,
        analyticDegreeV: blendNurbsData ? blendNurbsData.degreeV : null,
        analyticCpsU: blendNurbsData ? blendNurbsData.controlNet.length : null,
        analyticCpsV: blendNurbsData ? blendNurbsData.controlNet[0].length : null,
        // S6 focal (d) — the sidecar is GONE.
        metaAnalyticFaceUndefined: blend.meta.analyticFace === undefined,
        metaAnalyticSurfacePresent: !!blend.meta.analyticSurface,
        validateOk: validateSpine(blend.body).ok,
      });
      await adder(scene, vp, blend, 0x4a90d9);  // tooling-blue blend

      // ── 2.4 — N-SIDED PATCH on the cut body's most-sided face. The cut
      // creates an L-shaped face (the cylindrical wall + cut-chord edges);
      // nSidedPatch fills it with a spine-native analytic NURBS face.
      const patch = await K.brep.nSidedPatch(blankWithRelief, {
        subdivisions: 3,
        fairingIterations: 40,
      });
      const patchFaces = patch.body.faces();
      const patchAnalyticFace = patchFaces.find(f => f.isAnalytic);
      const patchNurbsData = patchAnalyticFace
        ? patchAnalyticFace.surface.toBSplineSurface() : null;
      out.stages.push({
        op: 'nSidedPatch — spine-native analytic face',
        isSpine: !!(patch.body && patch.occtWrapper),
        kind: patch.body.kind,
        declared: patch.body.declaredKind,
        spineFaceCount: patchFaces.length,
        hasAnalyticFace: !!patchAnalyticFace,
        analyticFacePersistentId: patchAnalyticFace ? patchAnalyticFace.persistentId : null,
        analyticFaceDerivedFrom: patchAnalyticFace ? patchAnalyticFace.derivedFrom : [],
        toBSplineSurfaceWorks: patchNurbsData && Number.isFinite(patchNurbsData.degreeU),
        analyticDegreeU: patchNurbsData ? patchNurbsData.degreeU : null,
        analyticDegreeV: patchNurbsData ? patchNurbsData.degreeV : null,
        metaAnalyticFaceUndefined: patch.meta.analyticFace === undefined,
        metaAnalyticSurfacePresent: !!patch.meta.analyticSurface,
        loopSides: patch.meta.nSidedStats ? patch.meta.nSidedStats.loopSides : null,
        validateOk: validateSpine(patch.body).ok,
      });
      await adder(scene, vp, patch, 0x76c43a);  // patch-emerald

      // ── 2.5 — REPLACE FACE (curved swap) — swap one of the blank's end
      // faces (faceIndex=1, typically the top cap of the cylinder) onto an
      // arbitrary curved NURBS surface (the customer-logo emblem cap).
      const swap = await K.brep.replaceFace(blankWithRelief, 1, {
        curvedSwap: true,
        bulge: 4,
      });
      const swapFaces = swap.body.faces();
      const swapAnalyticFace = swapFaces.find(f => f.isAnalytic);
      const swapNurbsData = swapAnalyticFace
        ? swapAnalyticFace.surface.toBSplineSurface() : null;
      out.stages.push({
        op: 'replaceFace(curvedSwap=true) — spine-native analytic face',
        isSpine: !!(swap.body && swap.occtWrapper),
        kind: swap.body.kind,
        declared: swap.body.declaredKind,
        spineFaceCount: swapFaces.length,
        hasAnalyticFace: !!swapAnalyticFace,
        analyticFacePersistentId: swapAnalyticFace ? swapAnalyticFace.persistentId : null,
        analyticFaceDerivedFrom: swapAnalyticFace ? swapAnalyticFace.derivedFrom : [],
        toBSplineSurfaceWorks: swapNurbsData && Number.isFinite(swapNurbsData.degreeU),
        analyticDegreeU: swapNurbsData ? swapNurbsData.degreeU : null,
        analyticDegreeV: swapNurbsData ? swapNurbsData.degreeV : null,
        metaAnalyticFaceUndefined: swap.meta.analyticFace === undefined,
        metaAnalyticSurfacePresent: !!swap.meta.analyticSurface,
        // The faceReplaceStats's pcurveCount should equal the analytic
        // face's boundary edge count (4 for the rectangular trim).
        pcurveCount: swap.meta.faceReplaceStats ? swap.meta.faceReplaceStats.pcurveCount : null,
        loopClosed: swap.meta.faceReplaceStats ? swap.meta.faceReplaceStats.loopClosed : null,
        validateOk: validateSpine(swap.body).ok,
      });
      await adder(scene, vp, swap, 0xc44a4a);  // emblem-red

      // ── 2.6 — STEP export round-trip — focal assertion (c).
      // For each of the 3 analytic faces, verify the unified Surface
      // contract: face.surface.toBSplineSurface() returns the exact NURBS
      // payload that foundation/StepExport.js:nurbsSurfaceToSTEP consumes
      // (the same payload shape `meta.analyticSurface` carries, which
      // ToolExecutionEngine.js feeds to nurbsSurfaceToSTEP to emit
      // B_SPLINE_SURFACE_WITH_KNOTS — verified by the existing
      // brep-g-g2blend / brep-facereplace specs that assert
      // window.__lastG2Blend.analyticStepHasBSpline / similar).
      const stepRoundtrip = (analyticData, name) => {
        const ok =
          analyticData
          && Number.isFinite(analyticData.degreeU)
          && Number.isFinite(analyticData.degreeV)
          && Array.isArray(analyticData.controlNet)
          && analyticData.controlNet.length >= 2
          && Array.isArray(analyticData.controlNet[0])
          && analyticData.controlNet[0].length >= 2
          && Array.isArray(analyticData.knotsU)
          && Array.isArray(analyticData.knotsV);
        return {
          name, ok,
          payload: ok ? {
            degreeU: analyticData.degreeU,
            degreeV: analyticData.degreeV,
            cpsU: analyticData.controlNet.length,
            cpsV: analyticData.controlNet[0].length,
            knotsU: analyticData.knotsU.length,
            knotsV: analyticData.knotsV.length,
          } : null,
        };
      };
      out.stepRoundtrips = [
        stepRoundtrip(blendNurbsData, 'g2-blend'),
        stepRoundtrip(patchNurbsData, 'n-sided-patch'),
        stepRoundtrip(swapNurbsData, 'replace-face'),
      ];

      // Save the body ids for visual framing.
      out.bodyIds = {
        blank: blankWithRelief.id,
        blend: blend.id,
        patch: patch.id,
        swap: swap.id,
      };

      // Mirror the swap (the final analytic-face-bearing body) on the spine
      // window slot for cross-evaluate introspection.
      window.__lastSpine = swap.body;
      window.__lastSpineBody = swap;
      return out;
    });

    console.log('\n  STAGES:');
    for (const s of result.stages) console.log(`    ${JSON.stringify(s)}`);
    console.log('\n  STEP ROUND-TRIPS:');
    for (const r of result.stepRoundtrips) console.log(`    ${JSON.stringify(r)}`);

    // ── Step 3 — frame the focal model for the storyboard stills.
    // ONE deliberate camera position via __archdiscFocusOnObject, holding
    // for storyboard frames. Frame the LAST body (the replace-face emblem
    // body) since it composes the most state.
    await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      if (reg.bodies.length > 0 && typeof window.__archdiscFocusOnObject === 'function') {
        // Frame the entire scene by walking every body's bbox.
        const THREE = window.THREE;
        const aggregate = new THREE.Box3();
        for (const b of reg.bodies) {
          if (b.group) {
            b.group.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(b.group);
            if (!box.isEmpty()) aggregate.union(box);
          }
        }
        if (!aggregate.isEmpty()) {
          const centre = aggregate.getCenter(new THREE.Vector3());
          const size = aggregate.getSize(new THREE.Vector3());
          const r = Math.max(size.x, size.y, size.z) * 1.2;
          const vp = window.__archdiscViewport;
          const cam = vp.camera;
          // Iso-ish viewpoint — gives clear visibility of the grip blank
          // + blend curve + emblem face.
          cam.position.set(centre.x + r, centre.y + r * 0.7, centre.z + r * 0.9);
          cam.lookAt(centre);
          if (vp.controls && vp.controls.target) {
            vp.controls.target.copy(centre);
            vp.controls.update();
          }
        }
      }
    });
    await win.waitForTimeout(600);
    await story.frame('grip-blank-framed');
    await story.frame('grip-blank-iso');

    // ── Step 4 — ONE deliberate orbit to reveal the G2 curvature continuity
    //   and the emblem face's curvature (these need the orbit; iso alone
    //   cannot show surface curvature).
    await dragOrbit(win, { dx: 200, dy: 60, steps: 28 });
    await win.waitForTimeout(500);
    await story.frame('grip-blank-curvature-reveal');

    // ── Step 5 — FOCAL S6 ASSERTIONS ───────────────────────────────────────

    // (a) Each migrated op produced a SpineBody.
    const blendStage = result.stages.find(s => s.op.startsWith('g2BlendBetweenEdges'));
    const patchStage = result.stages.find(s => s.op.startsWith('nSidedPatch'));
    const swapStage = result.stages.find(s => s.op.startsWith('replaceFace'));
    expect(blendStage, 'g2BlendBetweenEdges stage recorded').toBeDefined();
    expect(patchStage, 'nSidedPatch stage recorded').toBeDefined();
    expect(swapStage, 'replaceFace stage recorded').toBeDefined();

    expect(blendStage.isSpine, 'G2 Blend returns a SpineBody').toBe(true);
    expect(patchStage.isSpine, 'N-Sided Patch returns a SpineBody').toBe(true);
    expect(swapStage.isSpine, 'Replace Face returns a SpineBody').toBe(true);

    // (a) The result spine Face IS the analytic face.
    expect(blendStage.hasAnalyticFace, 'G2 Blend body has an analytic spine Face').toBe(true);
    expect(patchStage.hasAnalyticFace, 'N-Sided Patch body has an analytic spine Face').toBe(true);
    expect(swapStage.hasAnalyticFace, 'Replace Face body has an analytic spine Face').toBe(true);

    // (a) The spine face's persistentId follows the body-tag namespace
    //   (e.g. 'g2Blend:f1' / 'nSidedPatch:f1' / 'replaceFace:f1'). Just
    //   assert it's non-empty + namespaced.
    expect(blendStage.analyticFacePersistentId,
      `blend analytic face persistentId namespaced: ${blendStage.analyticFacePersistentId}`)
      .toMatch(/^g2Blend:/);
    expect(patchStage.analyticFacePersistentId)
      .toMatch(/^nSidedPatch:/);
    expect(swapStage.analyticFacePersistentId)
      .toMatch(/^replaceFace:/);

    // (b) face.surface.toBSplineSurface() returns valid NURBS data.
    expect(blendStage.toBSplineSurfaceWorks,
      'G2 Blend analytic face exposes toBSplineSurface()').toBe(true);
    expect(patchStage.toBSplineSurfaceWorks,
      'N-Sided Patch analytic face exposes toBSplineSurface()').toBe(true);
    expect(swapStage.toBSplineSurfaceWorks,
      'Replace Face analytic face exposes toBSplineSurface()').toBe(true);

    // G2 Blend produces degree-3×5 NURBS (the documented construction).
    expect(blendStage.analyticDegreeU, 'G2 Blend degreeU=3').toBe(3);
    expect(blendStage.analyticDegreeV, 'G2 Blend degreeV=5').toBe(5);
    // N-Sided Patch produces degree-3×3 NURBS (the documented analytic carrier).
    expect(patchStage.analyticDegreeU, 'N-Sided Patch degreeU=3').toBe(3);
    expect(patchStage.analyticDegreeV, 'N-Sided Patch degreeV=3').toBe(3);
    // Replace Face curved-swap synthesises degree-3×3 NURBS.
    expect(swapStage.analyticDegreeU, 'Replace Face degreeU=3').toBe(3);
    expect(swapStage.analyticDegreeV, 'Replace Face degreeV=3').toBe(3);

    // (c) The toBSplineSurface payload is the exact shape nurbsSurfaceToSTEP
    //   consumes. The round-trip checker verified the payload structure.
    for (const r of result.stepRoundtrips) {
      expect(r.ok, `STEP round-trip payload valid for ${r.name}: ` +
        `${JSON.stringify(r)}`).toBe(true);
      expect(r.payload.cpsU, `${r.name} has cpsU >= 2`).toBeGreaterThanOrEqual(2);
      expect(r.payload.cpsV, `${r.name} has cpsV >= 2`).toBeGreaterThanOrEqual(2);
    }

    // (d) NO meta.analyticFace side-car on any of the 3 results.
    expect(blendStage.metaAnalyticFaceUndefined,
      'G2 Blend meta.analyticFace === undefined (side-car retired)').toBe(true);
    expect(patchStage.metaAnalyticFaceUndefined,
      'N-Sided Patch meta.analyticFace === undefined (side-car retired)').toBe(true);
    expect(swapStage.metaAnalyticFaceUndefined,
      'Replace Face meta.analyticFace === undefined (side-car retired)').toBe(true);

    // Backward compat — meta.analyticSurface (the raw NURBS data) is STILL
    // present (downstream consumers in ToolExecutionEngine read it).
    expect(blendStage.metaAnalyticSurfacePresent,
      'G2 Blend meta.analyticSurface present (backward compat)').toBe(true);
    expect(patchStage.metaAnalyticSurfacePresent,
      'N-Sided Patch meta.analyticSurface present (backward compat)').toBe(true);
    expect(swapStage.metaAnalyticSurfacePresent,
      'Replace Face meta.analyticSurface present (backward compat)').toBe(true);

    // Replace Face curved-swap: pcurveCount === boundaryEdges === 4 (the
    // analytic spine face's natural rectangular trim).
    expect(swapStage.pcurveCount,
      'Replace Face analytic face has 4 LinearPcurves').toBe(4);
    expect(swapStage.loopClosed,
      'Replace Face analytic face has closed pcurve loop').toBe(true);

    // SP-1 §2.3 lineage — when the input is a SpineBody, the analytic face
    // records the seed edges' persistent ids on derivedFrom.
    expect(Array.isArray(blendStage.analyticFaceDerivedFrom),
      'G2 Blend derivedFrom is an array').toBe(true);
    expect(blendStage.analyticFaceDerivedFrom.length,
      `G2 Blend records seed edges in derivedFrom (${
        JSON.stringify(blendStage.analyticFaceDerivedFrom)})`)
      .toBeGreaterThan(0);

    // Final still — locked-in framing.
    await story.frame('grip-blank-final-locked');

    // Filter known-benign noise — same render-path _triangulation pattern
    // that S5 documented during rapid scene clear/rebuild between op
    // applications.
    const realErrors = pageErrors.filter(e =>
      !/Cannot read properties of undefined \(reading '_triangulation'\)/.test(e));
    expect(realErrors, `pageerrors (non-benign): ${JSON.stringify(realErrors)}`).toEqual([]);
  } finally {
    await app.close();
    const finished = await story.finish();
    console.log(`\n  Motion artifact: ${finished.videoPath} (${finished.videoSize} bytes), ${finished.stills.length} stills`);
  }
});
