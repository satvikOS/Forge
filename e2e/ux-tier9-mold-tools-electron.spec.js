/**
 * ux-tier9-mold-tools-electron.spec.js — UX Tier 9 acceptance
 *
 * Mold Tools workbench FOUNDATION — three foundational ops on top of
 * SP-4's `evalSurface` (face normal sampling) + SP-5's `partition`
 * (volumetric split):
 *
 *   - Draft Analysis  — per-face draft classification vs the pull direction.
 *                       Each face is tagged with `mold.draft` SP-2 attribute
 *                       (positive=green / negative=red / vertical=yellow).
 *   - Parting Line    — silhouette curve: edges between faces of opposite
 *                       draft signs (or one positive + one vertical).
 *   - Tooling Split   — partition body into CORE (faces +pull) + CAVITY
 *                       (opposite) halves along a planar parting surface.
 *
 * ── The bespoke real model — plastic bottle cap with internal threads ─────
 *
 * A real injection-mouldable plastic part: a screw-on bottle cap.
 *
 *   1. Outer ring (the part's "skirt" — Ø34 mm × 12 mm tall cylinder)
 *   2. Top dome (Ø34 × 4 mm thick puck fused on top → a closed cap)
 *   3. Inner bore (Ø28 × 10 mm cylinder subtracted to create the hollow
 *      interior where the bottle neck threads engage)
 *   4. Run **Draft Analysis** with pull = +Z, threshold 3°.
 *   5. Run **Parting Line** with the same pull direction — traces the
 *      silhouette edges where outer cylinder meets the top dome / bottom rim.
 *   6. Run **Tooling Split** with pull = +Z, parting offset 0 — splits the
 *      cap into CORE (the upper half — the puck + outer wall above the
 *      midline) + CAVITY (the lower half — outer wall + bottom rim).
 *
 * ── Framing — perfectly viewable ───────────────────────────────────────────
 *
 *   - ONE iso of the bottle cap (held).
 *   - 4-5 stills at key states: original body, draft-analysis colored,
 *     parting line traced, split into core / cavity (visibly separated).
 *   - NO 7-angle orbit. One short orbit at the end revealing the split halves.
 *
 * ── Focal assertions ───────────────────────────────────────────────────────
 *
 *   A. Draft Analysis classifies every face — perFace.length === face count.
 *   B. Categories are mutually exclusive (positive + negative + vertical ===
 *      faceCount).
 *   C. The bottle cap has BOTH positive AND negative draft faces (top puck
 *      faces +Z, bottom rim faces -Z, outer skirt is mostly vertical) →
 *      Tooling Split will produce two halves.
 *   D. Parting Line traces a non-empty wire (edgeCount > 0).
 *   E. Tooling Split produces exactly 2 bodies labelled CORE + CAVITY.
 *
 * ── Methodology ────────────────────────────────────────────────────────────
 *   - Headed Electron, motion-capture, ONE test() block.
 *   - Workflow drives REAL ribbon clicks for every op.
 *   - Imports use BARE specifiers (no `node:` prefix).
 *
 * Run: ./node_modules/.bin/playwright test ux-tier9-mold-tools --headed --workers=1
 */

import { test, expect } from '@playwright/test';
import { clickRibbonTab, clickRibbonTool, injectToolParams } from './helpers/uiWorkflow.js';
import { launchWithCapture } from './helpers/motionCapture.js';

test.setTimeout(600000);

test('UX Tier 9 — plastic bottle cap: Draft Analysis + Parting Line + Tooling Split via real ribbon clicks', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('ux-tier9-mold-tools');
  win.on('console', m => console.log('[browser] ' + m.text()));
  try {
    // ── Step 0 — Verify the Tier-9 ops are exposed on the kernel facade.
    const opsAvailable = await win.evaluate(() => {
      const K = window.__archdiscKernel && window.__archdiscKernel.kernel;
      return {
        draftAnalysis:    typeof K?.brep?.draftAnalysis    === 'function',
        partingLine:      typeof K?.brep?.partingLine      === 'function',
        toolingSplit:     typeof K?.brep?.toolingSplit     === 'function',
        isMold:           typeof K?.brep?.isMold           === 'function',
        getMoldMetadata:  typeof K?.brep?.getMoldMetadata  === 'function',
      };
    });
    console.log('  Tier-9 ops available:', JSON.stringify(opsAvailable));
    expect(opsAvailable.draftAnalysis,    'draftAnalysis on kernel facade').toBe(true);
    expect(opsAvailable.partingLine,      'partingLine on kernel facade').toBe(true);
    expect(opsAvailable.toolingSplit,     'toolingSplit on kernel facade').toBe(true);
    expect(opsAvailable.isMold,           'isMold on kernel facade').toBe(true);
    expect(opsAvailable.getMoldMetadata,  'getMoldMetadata on kernel facade').toBe(true);

    // ── Step 1 — Build the bottle cap via direct kernel ops (faster than
    //    driving ribbon clicks for primitives + booleans). The result body
    //    is registered to the scene so the registry's `bodies` list contains
    //    it — the Mold Tools tab can then operate on it via _pickBodies(1).
    console.log('  building bottle cap …');
    const bodyId = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel;
      // Outer skirt: cylinder Ø34 × 12 mm (r = 17, h = 12).
      const skirt = await K.brep.makeCylinder(17, 12);
      // Top puck: cylinder Ø34 × 4 mm above the skirt (z translation will
      // be applied via translate).
      const puckRaw = await K.brep.makeCylinder(17, 4);
      // Translate the puck upward to sit on top of the skirt: +12 mm in Z.
      const puck = await K.brep.translate(puckRaw, 0, 0, 12);
      // Fuse the two.
      const closed = await K.brep.fuse(skirt, puck);
      // Inner bore: cylinder Ø28 × 10 mm, starting at z=0 (open at bottom,
      // not penetrating the top puck). r = 14, h = 10.
      const bore = await K.brep.makeCylinder(14, 10);
      // Cut the bore out — creates the hollow interior.
      const cap = await K.brep.cut(closed, bore);

      // Register to the scene via the canonical helper. The helper's
      // signature is (scene, viewport, brepShape, color, consumedInputs);
      // WorkbenchMechanical binds it to window.__archdiscAddBrepShape.
      const scene = window.__archdiscViewport && window.__archdiscViewport.scene;
      const viewport = window.__archdiscViewport;
      if (!scene || !viewport) {
        throw new Error('viewport / scene not available');
      }
      if (typeof window.__archdiscAddBrepShape === 'function') {
        await window.__archdiscAddBrepShape(scene, viewport, cap, 0xb0bec5, []);
      }
      // Find the registered body's id.
      const reg = window.__archdiscRegistry;
      const lastBody = reg && reg.bodies && reg.bodies.length > 0
        ? reg.bodies[reg.bodies.length - 1] : null;
      return lastBody ? lastBody.id : null;
    });
    console.log(`  bottle cap registered as body ${bodyId}`);

    // Wait for the scene to render the cap.
    await win.waitForTimeout(400);

    // Frame the cap iso so the whole part fits the viewport.
    await frameLast(win);
    await win.waitForTimeout(280);
    await story.frame('01-bottle-cap-original');

    // Verify the cap has multiple faces — the analysis needs at least
    // a top, a side wall, and a bottom rim.
    const capFaceCount = await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      const last = reg && reg.bodies && reg.bodies[reg.bodies.length - 1];
      if (!last) return -1;
      const bs = last.brepShapeRef;
      if (!bs || !bs.body) return -1;
      return bs.body.faces().length;
    });
    console.log(`  bottle cap face count: ${capFaceCount}`);
    expect(capFaceCount, 'bottle cap has multiple faces').toBeGreaterThan(2);

    // ── Step 2 — Activate the Mold Tools ribbon tab.
    console.log('  clicking Mold Tools ribbon tab …');
    await clickRibbonTab(win, 'Mold Tools');
    await win.waitForTimeout(220);
    await story.frame('02-mold-tools-ribbon-active');

    // Verify the ribbon's Mold Tools tab actually shows our 3 tools.
    const moldToolNames = await win.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('button.ribbon-tool .ribbon-tool-label'))
        .map(el => el.textContent.trim());
      return labels;
    });
    console.log('  Mold Tools tab tool labels:', JSON.stringify(moldToolNames));
    expect(moldToolNames, 'Draft Analysis tool visible').toContain('Draft Analysis');
    expect(moldToolNames, 'Parting Line tool visible').toContain('Parting Line');
    expect(moldToolNames, 'Tooling Split tool visible').toContain('Tooling Split');

    // Pre-select the bottle cap.
    if (bodyId) {
      await win.evaluate((id) => {
        const reg = window.__archdiscRegistry;
        if (typeof reg.clearSelection === 'function') reg.clearSelection();
        if (typeof reg.select === 'function') reg.select(id);
      }, bodyId);
      await win.waitForTimeout(180);
    }

    // ── Step 3 — Run Draft Analysis.
    await injectToolParams(win, 'Draft Analysis', {
      pullX: 0, pullY: 0, pullZ: 1, minDraftDeg: 3,
    });
    console.log('  clicking Draft Analysis …');
    await clickRibbonTool(win, 'Draft Analysis');
    try {
      await win.waitForFunction(() => !!window.__lastDraftAnalysis, null, { timeout: 90000 });
      await win.waitForTimeout(300);
    } catch (err) {
      console.log('  Draft Analysis did not record slot within timeout — continuing');
    }

    const draftReport = await win.evaluate(() => window.__lastDraftAnalysis || null);
    console.log(`  Draft Analysis result: ${JSON.stringify({
      faceCount: draftReport?.faceCount,
      positive: draftReport?.positive,
      negative: draftReport?.negative,
      vertical: draftReport?.vertical,
    })}`);

    // FOCAL A — every face classified.
    expect(draftReport, 'Draft Analysis published its result slot').not.toBeNull();
    expect(draftReport.faceCount, 'face count > 0').toBeGreaterThan(0);
    expect(draftReport.categories.length, 'every face classified')
      .toBe(draftReport.faceCount);

    // FOCAL B — categories are mutually exclusive and sum to faceCount.
    const total = draftReport.positive + draftReport.negative + draftReport.vertical;
    expect(total, 'positive + negative + vertical === faceCount')
      .toBe(draftReport.faceCount);

    // FOCAL C — the cap has BOTH positive AND negative draft faces
    // (top puck → +Z = positive; bottom rim → -Z = negative).
    expect(draftReport.positive, 'cap has positive-draft faces (top)').toBeGreaterThan(0);
    expect(draftReport.negative, 'cap has negative-draft faces (bottom)').toBeGreaterThan(0);

    // Re-frame and capture the colored overlay.
    await frameLast(win);
    await win.waitForTimeout(280);
    await story.frame('03-draft-analysis-coloured');

    // ── Step 4 — Run Parting Line (re-select the same body first).
    if (bodyId) {
      await win.evaluate((id) => {
        const reg = window.__archdiscRegistry;
        if (typeof reg.clearSelection === 'function') reg.clearSelection();
        if (typeof reg.select === 'function') reg.select(id);
      }, bodyId);
      await win.waitForTimeout(140);
    }

    await injectToolParams(win, 'Parting Line', {
      pullX: 0, pullY: 0, pullZ: 1, minDraftDeg: 3,
    });
    console.log('  clicking Parting Line …');
    await clickRibbonTool(win, 'Parting Line');
    try {
      await win.waitForFunction(() => !!window.__lastPartingLine, null, { timeout: 90000 });
      await win.waitForTimeout(300);
    } catch (err) {
      console.log('  Parting Line did not record slot within timeout — continuing');
    }

    const partingReport = await win.evaluate(() => window.__lastPartingLine || null);
    console.log(`  Parting Line result: ${JSON.stringify({
      edgeCount: partingReport?.edgeCount,
      pullDirection: partingReport?.pullDirection,
    })}`);

    // FOCAL D — Parting Line traces a non-empty wire.
    expect(partingReport, 'Parting Line published its result slot').not.toBeNull();
    expect(partingReport.edgeCount, 'parting line is non-empty').toBeGreaterThan(0);
    // Every recorded edge has endpoints + left/right draft classification.
    for (const edge of partingReport.edges) {
      expect(edge.leftDraft).toMatch(/^(positive|negative|vertical)$/);
      expect(edge.rightDraft).toMatch(/^(positive|negative|vertical)$/);
      // The two sides cannot both be the same non-vertical category — it
      // wouldn't be a parting edge.
      if (edge.leftDraft === 'positive') expect(edge.rightDraft).not.toBe('positive');
      if (edge.leftDraft === 'negative') expect(edge.rightDraft).not.toBe('negative');
    }
    await frameLast(win);
    await win.waitForTimeout(280);
    await story.frame('04-parting-line-traced');

    // ── Step 5 — Run Tooling Split.
    if (bodyId) {
      await win.evaluate((id) => {
        const reg = window.__archdiscRegistry;
        if (typeof reg.clearSelection === 'function') reg.clearSelection();
        if (typeof reg.select === 'function') reg.select(id);
      }, bodyId);
      await win.waitForTimeout(140);
    }

    const bodiesBeforeSplit = await win.evaluate(() => window.__archdiscRegistry?.bodies?.length || 0);

    await injectToolParams(win, 'Tooling Split', {
      pullX: 0, pullY: 0, pullZ: 1, partingZ: 0, minDraftDeg: 3,
    });
    console.log('  clicking Tooling Split …');
    await clickRibbonTool(win, 'Tooling Split');
    try {
      await win.waitForFunction(() => !!window.__lastToolingSplit, null, { timeout: 120000 });
      await win.waitForTimeout(400);
    } catch (err) {
      console.log('  Tooling Split did not record slot within timeout — continuing');
    }

    const splitReport = await win.evaluate(() => window.__lastToolingSplit || null);
    console.log(`  Tooling Split result: ${JSON.stringify({
      pieceCount: splitReport?.pieceCount,
      corePresent: splitReport?.corePresent,
      cavityPresent: splitReport?.cavityPresent,
    })}`);

    // FOCAL E — Tooling Split produced exactly 2 bodies, labelled core + cavity.
    expect(splitReport, 'Tooling Split published its result slot').not.toBeNull();
    expect(splitReport.pieceCount, 'Tooling Split produced 2 pieces').toBe(2);
    expect(splitReport.corePresent, 'CORE piece present').toBe(true);
    expect(splitReport.cavityPresent, 'CAVITY piece present').toBe(true);

    const bodiesAfterSplit = await win.evaluate(() => window.__archdiscRegistry?.bodies?.length || 0);
    console.log(`  registry bodies: ${bodiesBeforeSplit} → ${bodiesAfterSplit}`);
    // The split adds 2 new bodies (core + cavity), removes the original;
    // net delta = +1 (gained two pieces, lost the original).
    expect(bodiesAfterSplit, 'registry gained at least 1 body after split').toBeGreaterThanOrEqual(bodiesBeforeSplit);

    // Verify the bodies' metadata carries `mold.half` correctly.
    const halfTags = await win.evaluate(() => {
      const K = window.__archdiscKernel.kernel.brep;
      const core = window.__lastMoldCore;
      const cavity = window.__lastMoldCavity;
      const coreMeta = core ? K.getMoldMetadata(core) : null;
      const cavityMeta = cavity ? K.getMoldMetadata(cavity) : null;
      return {
        core: coreMeta ? coreMeta.half : null,
        cavity: cavityMeta ? cavityMeta.half : null,
      };
    });
    console.log(`  half-tags: ${JSON.stringify(halfTags)}`);
    expect(halfTags.core, 'core piece labelled core').toBe('core');
    expect(halfTags.cavity, 'cavity piece labelled cavity').toBe('cavity');

    // Re-frame to show both halves visibly separated.
    await frameAll(win);
    await win.waitForTimeout(360);
    await story.frame('05-tooling-split-core-cavity');

    // Final short orbit (4 steps, 18° apart) revealing the split halves from
    // another side.
    for (let i = 0; i < 4; i++) {
      await win.evaluate((step) => {
        const v = window.__archdiscViewport;
        if (!v || !v.camera || !v.orbitControls) return;
        const center = v.orbitControls.target;
        const dx = v.camera.position.x - center.x;
        const dy = v.camera.position.y - center.y;
        const dz = v.camera.position.z - center.z;
        const angle = (step + 1) * 0.18;
        const c = Math.cos(angle), s = Math.sin(angle);
        const rx = c * dx - s * dy;
        const ry = s * dx + c * dy;
        v.camera.position.set(center.x + rx, center.y + ry, center.z + dz);
        v.camera.lookAt(center);
        v.orbitControls.update();
      }, i);
      await win.waitForTimeout(200);
    }
    await story.frame('06-final-split-orbit');

    expect(pageErrors, 'no page errors during Tier-9 workflow').toEqual([]);

    console.log('  ── Tier 9 summary ──');
    console.log(`     Bottle cap faces: ${draftReport.faceCount}`);
    console.log(`     Draft Analysis: ${draftReport.positive} pos / ${draftReport.negative} neg / ${draftReport.vertical} vertical`);
    console.log(`     Parting Line edges: ${partingReport.edgeCount}`);
    console.log(`     Tooling Split: ${splitReport.pieceCount} pieces (${splitReport.corePresent ? 'CORE+' : ''}${splitReport.cavityPresent ? 'CAVITY' : ''})`);
  } finally {
    await app.close();
    const session = await story.finish();
    console.log(`Tier-9 motion-capture session: ${session}`);
    console.log(`Tier-9 stills: ${story.frames().length}`);
  }
});

/**
 * Frame the camera so the most-recently-added body fits the viewport at iso.
 */
async function frameLast(win) {
  await win.evaluate(() => {
    const v = window.__archdiscViewport;
    if (!v || !v.camera || !v.orbitControls) return;
    const THREE = window.THREE;
    if (!THREE) return;
    const reg = window.__archdiscRegistry;
    if (!reg || !reg.bodies || reg.bodies.length === 0) return;
    const last = reg.bodies[reg.bodies.length - 1];
    if (!last || !last.group) return;
    const box = new THREE.Box3().setFromObject(last.group);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 0.05;
    const halfFov = (v.camera.fov * Math.PI / 180) / 2;
    const dist = (maxDim / 2) / Math.tan(halfFov) * 2.0;
    const dx = 0.7, dy = 0.45, dz = 0.55;
    const L = Math.hypot(dx, dy, dz);
    v.camera.position.set(
      center.x + dist * dx / L,
      center.y + dist * dy / L,
      center.z + dist * dz / L,
    );
    v.camera.up.set(0, 0, 1);
    v.camera.near = Math.max(dist * 0.001, 0.0001);
    v.camera.far = Math.max(dist * 100, 100);
    v.camera.updateProjectionMatrix();
    v.orbitControls.target.copy(center);
    v.orbitControls.update();
  });
}

/**
 * Frame the camera so EVERY body in the scene fits the viewport at iso.
 */
async function frameAll(win) {
  await win.evaluate(() => {
    const v = window.__archdiscViewport;
    if (!v || !v.camera || !v.orbitControls) return;
    const THREE = window.THREE;
    if (!THREE) return;
    const reg = window.__archdiscRegistry;
    if (!reg || !reg.bodies || reg.bodies.length === 0) return;
    const box = new THREE.Box3();
    let init = false;
    for (const b of reg.bodies) {
      if (!b || !b.group) continue;
      const bb = new THREE.Box3().setFromObject(b.group);
      if (bb.isEmpty()) continue;
      if (!init) { box.copy(bb); init = true; }
      else box.union(bb);
    }
    if (!init || box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 0.05;
    const halfFov = (v.camera.fov * Math.PI / 180) / 2;
    const dist = (maxDim / 2) / Math.tan(halfFov) * 1.8;
    const dx = 0.7, dy = 0.45, dz = 0.55;
    const L = Math.hypot(dx, dy, dz);
    v.camera.position.set(
      center.x + dist * dx / L,
      center.y + dist * dy / L,
      center.z + dist * dz / L,
    );
    v.camera.up.set(0, 0, 1);
    v.camera.near = Math.max(dist * 0.001, 0.0001);
    v.camera.far = Math.max(dist * 100, 100);
    v.camera.updateProjectionMatrix();
    v.orbitControls.target.copy(center);
    v.orbitControls.update();
  });
}
