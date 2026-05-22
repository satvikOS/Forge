/**
 * brep-i-faceter-electron.spec.js
 *
 * SP-7 (Area I — Faceting & tessellation) — in-motion gate test for the
 * faceter option surface. Drives the ENTIRE workflow through real ribbon
 * clicks + real viewport picks; records slow-mo video + key-frame stills.
 *
 * ── Workflow (complex real-world model, faceter as the climactic step) ──────
 *   1. Build a Cylinder (curved body — tessellation quality is visibly
 *      meaningful on the round side wall).
 *   2. Fillet its edges (rounds the rims — more curvature for the faceter).
 *   3. Build a Sphere and Combine it onto the filleted cylinder — a compound
 *      curved part: a capsule-like body whose facets are obvious from any angle.
 *   4. CLIMAX A — Faceter Controls at the RENDER profile, COARSE chordal tol
 *      (a big chord gap → a chunky, low-poly mesh).
 *   5. CLIMAX B — Faceter Controls AGAIN on the same body at the ANALYSIS
 *      profile, FINE chordal tol (a tight gap → a dense, smooth mesh).
 *      The triangle count must jump dramatically — proving the chordal +
 *      angular knobs and the render-vs-analysis profile are real.
 *   6. CLIMAX C — Hidden Line / Silhouette on the body: OCCT HLR edge set +
 *      pure-JS mesh silhouette, drawn as a viewport overlay.
 *
 * Multi-angle drag-orbit capture after each re-faceting so the facet-density
 * change is visible from many viewpoints + zooms.
 *
 * Reference: e2e/brep-g-catmullclark-electron.spec.js
 * Artifacts: test-results/motion/brep-i-faceter/  (00-session.webm + NN-*.png)
 *
 * ONE test() per file. Run with --workers=1 via ./node_modules/.bin/playwright.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  clickRibbonTab, clickRibbonTool, buildPrimitive, injectToolParams, selectBodies,
} from './helpers/uiWorkflow.js';
import {
  launchWithCapture, clickBody, addToSelection, dragOrbit,
} from './helpers/motionCapture.js';
import { captureAllAngles } from './helpers/orbitCapture.js';

test.setTimeout(600000);

test('Faceter Controls: ribbon-driven re-faceting of a curved compound part visibly changes facet density', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('brep-i-faceter');
  try {
    // ── Step 1: Build a Cylinder (curved body) ───────────────────────────────
    const cylId = await buildPrimitive(win, 'Cylinder', { radius: 22, height: 50 });
    console.log(`  Cylinder id: ${cylId}`);
    await story.frame('input-cylinder');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-cylinder-3d');

    // ── Step 2: Fillet the cylinder rims (more curvature for the faceter) ────
    await clickBody(win, cylId);
    const idBeforeFillet = await win.evaluate(
      () => (window.__lastBrepShape && window.__lastBrepShape.id) || null);
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await injectToolParams(win, 'Fillet', { radius: 5 });
    await story.frame('before-fillet');
    await clickRibbonTool(win, 'Fillet');
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeFillet, { timeout: 60000 });
    const filletedId = await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      return reg && reg.bodies.length
        ? reg.bodies[reg.bodies.length - 1].id
        : window.__lastBrepShape.id;
    });
    console.log(`  Filleted cylinder id: ${filletedId}`);
    await win.waitForTimeout(300);
    await story.frame('after-fillet');

    // ── Step 3: Build a Sphere and Combine it onto the filleted cylinder ─────
    const sphId = await buildPrimitive(win, 'Sphere', { radius: 26 });
    console.log(`  Sphere id: ${sphId}`);
    await win.waitForTimeout(200);

    // Select the filleted cylinder + the sphere, then Combine (union).
    await clickBody(win, filletedId);
    await addToSelection(win, sphId);
    const idBeforeCombine = await win.evaluate(
      () => (window.__lastBrepShape && window.__lastBrepShape.id) || null);
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('before-combine');
    await clickRibbonTool(win, 'Combine');
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeCombine, { timeout: 60000 });
    const combinedId = await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      return reg && reg.bodies.length
        ? reg.bodies[reg.bodies.length - 1].id
        : window.__lastBrepShape.id;
    });
    console.log(`  Combined (capsule) body id: ${combinedId}`);
    await win.waitForTimeout(300);
    await dragOrbit(win, { dx: 220, dy: 70 });
    await story.frame('after-combine');

    // ── Step 4: CLIMAX A — Faceter Controls, RENDER profile, COARSE tol ──────
    await clickBody(win, combinedId);
    await win.evaluate(() => { window.__lastFaceterMesh = null; });
    await injectToolParams(win, 'Faceter Controls', {
      profile: 'render',
      chordalMm: 4.0,    // big chord gap → chunky low-poly mesh
      angularDeg: 45,
      minSizeMm: 0,
    });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('before-faceter-coarse');
    await clickRibbonTool(win, 'Faceter Controls');
    await win.waitForFunction(() => !!window.__lastFaceterMesh, null, { timeout: 120000 });
    await win.waitForTimeout(400);
    await story.frame('after-faceter-coarse');

    const coarse = await win.evaluate(() => window.__lastFaceterMesh);
    console.log(`  COARSE facet: ${coarse.triangleCount} triangles, ` +
      `${coarse.vertexCount} verts, profile=${coarse.params.profile}, ` +
      `chordal=${coarse.params.chordalMm}, faces=${coarse.faceCount}, ` +
      `degenerate=${coarse.degenerateFaces}`);
    expect(coarse, 'coarse faceting must produce a mesh').toBeTruthy();
    expect(coarse.triangleCount, 'coarse mesh must have triangles').toBeGreaterThan(0);

    // Multi-angle capture of the COARSE (chunky) mesh.
    const capCoarse = await captureAllAngles(win, 'faceter-coarse', { story, drags: 5 });
    console.log(`  Coarse render: ${capCoarse.total} drag-orbits, ${capCoarse.blanks.length} blanks`);
    expect(capCoarse.blanks).toEqual([]);

    // ── Step 5: CLIMAX B — Faceter Controls AGAIN, ANALYSIS profile, FINE ────
    // Re-select the SAME body (re-faceting is in-place — same id).
    await clickBody(win, combinedId);
    await win.evaluate(() => { window.__lastFaceterMesh = null; });
    await injectToolParams(win, 'Faceter Controls', {
      profile: 'analysis',
      chordalMm: 0.08,   // tight chord gap → dense smooth mesh
      angularDeg: 6,
      minSizeMm: 0,
    });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('before-faceter-fine');
    await clickRibbonTool(win, 'Faceter Controls');
    await win.waitForFunction(() => !!window.__lastFaceterMesh, null, { timeout: 120000 });
    await win.waitForTimeout(400);
    await story.frame('after-faceter-fine');

    const fine = await win.evaluate(() => window.__lastFaceterMesh);
    console.log(`  FINE facet: ${fine.triangleCount} triangles, ` +
      `${fine.vertexCount} verts, profile=${fine.params.profile}, ` +
      `chordal=${fine.params.chordalMm}, faces=${fine.faceCount}, ` +
      `usedParametersForm=${fine.params.usedParametersForm}`);

    // ── Core assertion: the faceter knobs are REAL ───────────────────────────
    // Fine analysis-profile tol must give dramatically more triangles than the
    // coarse render-profile tol on the SAME body. This proves chordal +
    // angular deflection and the render/analysis profile actually drive the
    // tessellation — a genuine faceter option surface, not a fixed deflection.
    expect(fine.triangleCount, 'fine mesh must have triangles').toBeGreaterThan(0);
    expect(fine.triangleCount,
      `fine (${fine.triangleCount}) must FAR exceed coarse (${coarse.triangleCount}) — ` +
      `≥8× is the floor for a real chordal+angular tol`)
      .toBeGreaterThan(coarse.triangleCount * 8);
    expect(fine.params.profile).toBe('analysis');
    expect(coarse.params.profile).toBe('render');
    // The analysis profile resolves a much finer chordal tol than render.
    expect(fine.params.chordalMm,
      'analysis chordal tol must be finer than coarse render tol')
      .toBeLessThan(coarse.params.chordalMm);
    // Re-faceting was in place — same body id both times.
    expect(fine.bodyId, 're-faceting must operate on the same body').toBe(coarse.bodyId);

    // Multi-angle capture of the FINE (smooth) mesh — facet density visibly up.
    const capFine = await captureAllAngles(win, 'faceter-fine', { story, drags: 7 });
    console.log(`  Fine render: ${capFine.total} drag-orbits, ${capFine.blanks.length} blanks`);
    expect(capFine.blanks).toEqual([]);

    // ── Step 6: CLIMAX C — Hidden Line / Silhouette ──────────────────────────
    await clickBody(win, combinedId);
    await win.evaluate(() => { window.__lastHiddenLine = null; });
    await injectToolParams(win, 'Hidden Line / Silhouette', {
      viewX: 0.5, viewY: -0.62, viewZ: 0.6, showHidden: 'yes',
    });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('before-hiddenline');
    await clickRibbonTool(win, 'Hidden Line / Silhouette');
    await win.waitForFunction(() => !!window.__lastHiddenLine, null, { timeout: 120000 });
    await win.waitForTimeout(500);
    await story.frame('after-hiddenline');

    const hlr = await win.evaluate(() => window.__lastHiddenLine);
    console.log(`  HLR: method=${hlr.method}, visibleSharp=${hlr.visibleSharpCount}, ` +
      `visibleOutline=${hlr.visibleOutlineCount}, hiddenSharp=${hlr.hiddenSharpCount}, ` +
      `hiddenOutline=${hlr.hiddenOutlineCount}, edgeCount=${hlr.edgeCount}, ` +
      `meshSilhouetteSegments=${hlr.meshSilhouetteSegments}`);

    // The hidden-line projection of a curved compound part must yield edges:
    // the rounded body's silhouette outline alone is non-empty, and the
    // pure-JS mesh silhouette must find front/back-straddling edges.
    expect(hlr, 'hidden-line extraction must produce a result').toBeTruthy();
    expect(hlr.edgeCount,
      `OCCT HLR must extract edges (got ${hlr.edgeCount})`).toBeGreaterThan(0);
    expect(hlr.meshSilhouetteSegments,
      `pure-JS mesh silhouette must find straddling edges (got ${hlr.meshSilhouetteSegments})`)
      .toBeGreaterThan(0);

    const capHlr = await captureAllAngles(win, 'faceter-hiddenline', { story, drags: 5 });
    console.log(`  HLR render: ${capHlr.total} drag-orbits, ${capHlr.blanks.length} blanks`);
    expect(capHlr.blanks).toEqual([]);

    // ── No page errors across the whole workflow ─────────────────────────────
    expect(pageErrors).toEqual([]);

    // ── Storyboard stills must exist and be real screenshots ─────────────────
    const stills = story.frames();
    const coarseStill = stills.find(f => /-after-faceter-coarse\.png$/.test(f));
    const fineStill = stills.find(f => /-after-faceter-fine\.png$/.test(f));
    const hlrStill = stills.find(f => /-after-hiddenline\.png$/.test(f));
    expect(coarseStill, 'an after-faceter-coarse still must exist').toBeTruthy();
    expect(fineStill, 'an after-faceter-fine still must exist').toBeTruthy();
    expect(hlrStill, 'an after-hiddenline still must exist').toBeTruthy();
    for (const [label, f] of [['coarse', coarseStill], ['fine', fineStill], ['hlr', hlrStill]]) {
      expect(fs.statSync(f).size,
        `${label} still must be a real screenshot (>10 KB)`).toBeGreaterThan(10 * 1024);
    }
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
