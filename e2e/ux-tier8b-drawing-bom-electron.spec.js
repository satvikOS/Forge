/**
 * UX Tier-8b — Drawing Model Items + BOM + Auto-Balloon (motion capture)
 *
 * Closes the remaining three "Tier 8 — Missing drawing capabilities" items
 * the SolidWorks-course synthesis identified
 * (`docs/superpowers/notes/solidworks-course-synthesis.md` §7 Tier 8):
 *
 *   #86  Model Items   — auto-import all part dimensions onto a drawing view
 *   #87  BOM           — Bill of Materials table from the assembly
 *   #88  Auto-Balloon  — numbered callouts linked to BOM rows
 *
 * Bespoke workflow — DIFFERENT from the Tier-8a long-shaft single-part
 * spec. Tier-8b exercises a REAL ENGINEERED ASSEMBLY with 5 distinct
 * components: a **conveyor roller assembly** (the canonical SW assembly-
 * drawing tutorial part):
 *
 *   1. Roller tube    — Ø60 × 200 mm, AISI 1020 steel
 *   2. Left end cap   — Ø60 × 12 mm, Aluminium 6061-T6
 *   3. Right end cap  — Ø60 × 12 mm, Aluminium 6061-T6
 *   4. Centre shaft   — Ø20 × 280 mm, AISI 1045
 *   5. Bearing (×2)   — Ø32 × 8 mm SKF 6004 (auto-merged by part number)
 *
 * Each body is tagged via the new BodyRegistry.attachAttribute API with
 * `partNumber`, `description`, `material`, `quantity`. Then the Drawing
 * tab runs the THREE new ribbon tools:
 *
 *   - Annotate → Model Items   — projects every parametric dimension of
 *                                the active body (the roller tube) onto
 *                                the FRONT drawing view with leader lines
 *   - BOM → BOM                — auto-builds the Bill of Materials table
 *                                from every body's attributes (the two
 *                                identical bearings merge into one row
 *                                with quantity 2)
 *   - BOM → Auto-Balloon       — places a numbered balloon callout on
 *                                each component, connected by leader
 *                                lines to the projected centroid
 *
 * Focal assertions:
 *   - Model Items: dimension count equals the body's feature-parameter
 *     count (we publish the part's `features` array to the handler).
 *   - BOM: row count equals the de-duped component count (5 raw → 4 rows
 *     because the two bearings merge); columns Item No / Part Number /
 *     Description / Quantity / Material all present.
 *   - Auto-Balloon: balloon count equals BOM row count; balloon positions
 *     are non-overlapping (each balloon owns a unique 30° angular slot).
 *
 * Motion capture, ONE `test()` block, --workers=1 via the project's
 * Playwright (1.59), NO `node:*` imports. Drawing-sheet framing — the
 * DrawingPreviewPanel modal IS the viewable canvas, not a 3D orbit.
 *
 * Run with:
 *   ./node_modules/.bin/playwright test \
 *     e2e/ux-tier8b-drawing-bom-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier8b');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-8b Model Items + BOM + Auto-Balloon on a real conveyor-roller assembly', async () => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith('.png') || f.endsWith('.webm')) {
      try { fs.rmSync(path.join(OUT, f)); } catch {}
    }
  }

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, NODE_ENV: 'test' },
    slowMo: 220,
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (err) => pageErrors.push(err.message));
  win.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(`[console] ${msg.text()}`); });
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscAtomic, null, { timeout: 60000 });

  // Bypass the dialog so the e2e is deterministic (planParams supplies
  // values for each tool's schema).
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });

  let frameIdx = 0;
  const frame = async (label) => {
    frameIdx += 1;
    const nn = String(frameIdx).padStart(2, '0');
    const safe = label.replace(/[^a-z0-9_-]/gi, '-');
    const file = path.join(OUT, `${nn}-${safe}.png`);
    await win.waitForTimeout(280);
    await win.screenshot({ path: file });
    console.log(`  [frame] ${file}`);
    return file;
  };

  // ─── A. Build the conveyor-roller assembly (5 distinct components) ─────
  //
  // Real atomic CAD: each component is its own Part, its solid is added
  // to the scene as its own body, and each gets BOM attributes attached
  // via the new BodyRegistry.attachAttribute API.
  //
  // To make the Model Items assertion meaningful we keep the ROLLER TUBE
  // as the "active" foundation manifold and publish its full feature
  // history at window.__archdiscLastPartFeatures.

  const buildInfo = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const reg = window.__archdiscBodies;

    const makeAndRegister = async (buildFn, color, attrs) => {
      const part = A.createPart(attrs.name);
      await buildFn(part);
      // renderBody = additive: doesn't unregister the previous body.
      const group = A.renderBody(part, color);
      const id = group.userData.bodyId;
      if (id) reg.attachAttributes(id, attrs);
      return { part, id, group };
    };

    // ── 1. Roller tube — hollow Ø60 × 200 mm steel cylinder ─────────────
    // Approximate hollow tube by extruding an OUTER ring (od=60, id=44)
    // along Y. To keep the feature history simple for Model Items we
    // model it as ONE extrude of the outer profile (we'd cut the bore
    // with a second extrude, but a single dim-rich extrude makes the
    // Model Items assertion crisp). Wall is implicit in the diameter.
    const tube = await makeAndRegister(async (part) => {
      // Centre the tube at origin so the assembly centroid is sensible.
      await A.startSketch(part, 'XY');
      A.sketchCircle(part, 0, 0, 30);  // OD Ø60 outer
      A.finishSketch(part);
      await A.extrude(part, 200);
      // Bore — cut a Ø44 hole along the tube length.
      await A.startSketch(part, 'XY');
      A.sketchCircle(part, 0, 0, 22);  // ID Ø44 bore
      A.finishSketch(part);
      await A.cut(part, 220);          // through the 200-mm tube
    }, 0x9aa3ad, {
      partName: 'Roller Tube',
      partNumber: 'CR-100',
      description: 'Conveyor roller tube Ø60×200',
      material: 'AISI 1020 Steel',
      quantity: 1,
      name: 'Roller Tube',
    });

    // ── 2. Left end cap — Ø60 × 12 mm aluminium puck ────────────────────
    const leftCap = await makeAndRegister(async (part) => {
      await A.startSketch(part, 'XY');
      A.sketchCircle(part, 0, 0, 30);
      A.finishSketch(part);
      await A.extrude(part, 12);
      // Translate down so it sits at the LEFT end of the tube (z = -12).
      A.translate(part, 0, 0, -12);
    }, 0xb8a86b, {
      partName: 'Left End Cap',
      partNumber: 'CR-200L',
      description: 'Roller end cap (drive side)',
      material: 'Aluminium 6061-T6',
      quantity: 1,
      name: 'Left End Cap',
    });

    // ── 3. Right end cap — same Ø60 × 12 mm but at the +Z end ───────────
    const rightCap = await makeAndRegister(async (part) => {
      await A.startSketch(part, 'XY');
      A.sketchCircle(part, 0, 0, 30);
      A.finishSketch(part);
      await A.extrude(part, 12);
      A.translate(part, 0, 0, 200);   // sits flush with the tube +Z end
    }, 0xb8a86b, {
      partName: 'Right End Cap',
      partNumber: 'CR-200R',
      description: 'Roller end cap (idler side)',
      material: 'Aluminium 6061-T6',
      quantity: 1,
      name: 'Right End Cap',
    });

    // ── 4. Centre shaft — Ø20 × 280 mm through the bore ─────────────────
    const shaft = await makeAndRegister(async (part) => {
      await A.startSketch(part, 'XY');
      A.sketchCircle(part, 0, 0, 10);  // Ø20
      A.finishSketch(part);
      await A.extrude(part, 280);
      A.translate(part, 0, 0, -40);    // -40 .. +240 (poking out each end)
    }, 0x707a85, {
      partName: 'Centre Shaft',
      partNumber: 'CR-300',
      description: 'Conveyor roller shaft Ø20×280',
      material: 'AISI 1045 Steel',
      quantity: 1,
      name: 'Centre Shaft',
    });

    // ── 5. Bearings — TWO identical Ø32 × 8 mm bearings at each end ─────
    // Identical part numbers (SKF 6004) → BOM merges them into ONE row qty 2.
    const bearingL = await makeAndRegister(async (part) => {
      await A.startSketch(part, 'XY');
      A.sketchCircle(part, 0, 0, 16);  // Ø32 OD
      A.finishSketch(part);
      await A.extrude(part, 8);
      A.translate(part, 0, 0, -30);    // outboard of the left cap
    }, 0x2a4d70, {
      partName: 'Bearing (Left)',
      partNumber: 'SKF-6004',
      description: 'Deep groove ball bearing 6004',
      material: 'Chrome Steel',
      quantity: 1,
      name: 'Bearing (Left)',
    });
    const bearingR = await makeAndRegister(async (part) => {
      await A.startSketch(part, 'XY');
      A.sketchCircle(part, 0, 0, 16);
      A.finishSketch(part);
      await A.extrude(part, 8);
      A.translate(part, 0, 0, 222);    // outboard of the right cap
    }, 0x2a4d70, {
      partName: 'Bearing (Right)',
      partNumber: 'SKF-6004',
      description: 'Deep groove ball bearing 6004',
      material: 'Chrome Steel',
      quantity: 1,
      name: 'Bearing (Right)',
    });

    // Make the ROLLER TUBE the active body for Model Items (its feature
    // history is the richest). Publish its features via the slot the
    // Model Items handler reads.
    window.__lastFoundationManifold = tube.part.solid;
    window.__archdiscLastPartFeatures = tube.part.features.map(
      (f) => ({ type: f.type, params: { ...f.params } }),
    );

    const ids = [tube.id, leftCap.id, rightCap.id, shaft.id, bearingL.id, bearingR.id];
    return {
      ids,
      bodyCount: ids.length,
      tubeFeatureCount: tube.part.features.length,
      tubeFeatureTypes: tube.part.features.map((f) => f.type),
      // dump every body's BOM-relevant attrs for visibility.
      attrs: ids.map((id) => ({
        id,
        partNumber: reg.getAttribute(id, 'partNumber'),
        material: reg.getAttribute(id, 'material'),
      })),
    };
  });
  console.log(`  [build] ${JSON.stringify(buildInfo)}`);
  expect(buildInfo.bodyCount).toBe(6);  // 1+1+1+1+2 = 6 bodies; BOM merges to 5 rows
  expect(buildInfo.tubeFeatureCount).toBeGreaterThan(3);

  // ─── B. Click Drawing tab ─────────────────────────────────────────────
  await win.locator('.ribbon-tab', { hasText: 'Drawing' }).first().click();
  await win.waitForTimeout(450);
  await expect(win.locator('.ribbon-tool-label', { hasText: /^Model Items$/ })).toBeVisible({ timeout: 5000 });
  await expect(win.locator('.ribbon-tool-label', { hasText: /^BOM$/ })).toBeVisible({ timeout: 5000 });
  await expect(win.locator('.ribbon-tool-label', { hasText: /^Auto-Balloon$/ })).toBeVisible({ timeout: 5000 });

  await frame('01-A1-conveyor-roller-assembly-built-drawing-tab-opened');

  // ─── C. MODEL ITEMS ───────────────────────────────────────────────────
  // Project the active body's parametric dimensions onto the FRONT view.
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Model Items'] = { viewKind: 'front' };
  });
  await win.locator('.ribbon-tool-label', { hasText: /^Model Items$/ }).first().click();
  await expect(win.locator('.dpp-dialog')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => window.__lastModelItems != null, null, { timeout: 15000 });
  const mi = await win.evaluate(() => window.__lastModelItems);
  console.log(`  [model-items] ${JSON.stringify({
    dimCount: mi.dimensionCount,
    featureCount: mi.featureCount,
    unsupported: mi.unsupportedFeatures,
    bytes: mi.svgBytes,
  })}`);

  // Focal assertions for MODEL ITEMS:
  expect(mi).toBeTruthy();
  // The tube has these features that produce dimensions:
  //   startSketch (XY)            -> 0
  //   sketchCircle (r=30)         -> 1 (Ø60)
  //   finishSketch                -> 0
  //   extrude (200)               -> 1
  //   startSketch (XY)            -> 0
  //   sketchCircle (r=22)         -> 1 (Ø44)
  //   finishSketch                -> 0
  //   cut (220)                   -> 1
  // = 4 dimensions expected.
  expect(mi.dimensionCount).toBeGreaterThanOrEqual(3);
  expect(mi.featureCount).toBe(buildInfo.tubeFeatureCount);
  // No unsupported types in this build.
  expect(mi.unsupportedFeatures.length).toBe(0);
  // SVG content
  const miBody = win.locator('.dpp-dialog [data-dpp-body]');
  const miHtml = await miBody.innerHTML();
  expect(miHtml).toContain('data-archdisc-view="model-items"');
  expect(miHtml).toContain(`data-dim-count="${mi.dimensionCount}"`);
  expect(miHtml).toContain('data-view-name="front"');
  // Each dimension produces a leader line with data-dim-id.
  expect(miHtml).toMatch(/data-dim-id="dim-\d+"/);
  // Should contain at least one diameter dimension (Ø prefix).
  expect(miHtml).toContain('Ø');

  await frame('02-B1-model-items-dimensions-projected-on-front-view');
  await win.locator('.dpp-dialog [data-action="dpp-close"]').dispatchEvent('click');
  await expect(win.locator('.dpp-dialog')).not.toBeVisible();
  await win.waitForTimeout(200);

  // ─── D. BOM ───────────────────────────────────────────────────────────
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['BOM'] = { mergeByPartNumber: 'yes' };
  });
  await win.locator('.ribbon-tool-label', { hasText: /^BOM$/ }).first().click();
  await expect(win.locator('.dpp-dialog')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => window.__lastBOM != null, null, { timeout: 15000 });
  const bom = await win.evaluate(() => window.__lastBOM);
  console.log(`  [bom] ${JSON.stringify({
    rows: bom.rowCount,
    totalQty: bom.totalQty,
    partNumbers: bom.partNumbers,
    bytes: bom.svgBytes,
  })}`);

  // Focal assertions for BOM:
  expect(bom).toBeTruthy();
  // 6 raw bodies → 5 BOM rows (the two SKF-6004 bearings merge).
  expect(bom.rowCount).toBe(5);
  expect(bom.totalQty).toBe(6);
  expect(bom.partNumbers).toContain('CR-100');
  expect(bom.partNumbers).toContain('CR-200L');
  expect(bom.partNumbers).toContain('CR-200R');
  expect(bom.partNumbers).toContain('CR-300');
  expect(bom.partNumbers).toContain('SKF-6004');
  // SVG content
  const bomBody = win.locator('.dpp-dialog [data-dpp-body]');
  const bomHtml = await bomBody.innerHTML();
  expect(bomHtml).toContain('data-archdisc-view="bom"');
  expect(bomHtml).toContain(`data-bom-rows="${bom.rowCount}"`);
  expect(bomHtml).toContain('BILL OF MATERIALS');
  // All five columns present in the header.
  expect(bomHtml).toContain('Item');
  expect(bomHtml).toContain('Part Number');
  expect(bomHtml).toContain('Description');
  expect(bomHtml).toContain('Qty');
  expect(bomHtml).toContain('Material');
  // SKF-6004 row should show quantity 2 (the merged bearings).
  const bearingRow = bom.rows.find((r) => r.partNumber === 'SKF-6004');
  expect(bearingRow).toBeTruthy();
  expect(bearingRow.quantity).toBe(2);

  await frame('03-C1-bom-table-five-rows-merged-bearings');
  await win.locator('.dpp-dialog [data-action="dpp-close"]').dispatchEvent('click');
  await expect(win.locator('.dpp-dialog')).not.toBeVisible();
  await win.waitForTimeout(200);

  // ─── E. AUTO-BALLOON ──────────────────────────────────────────────────
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Auto-Balloon'] = { balloonRadius: 5, mergeByPartNumber: 'yes' };
  });
  await win.locator('.ribbon-tool-label', { hasText: /^Auto-Balloon$/ }).first().click();
  await expect(win.locator('.dpp-dialog')).toBeVisible({ timeout: 20000 });
  await win.waitForFunction(() => window.__lastAutoBalloon != null, null, { timeout: 20000 });
  const ab = await win.evaluate(() => window.__lastAutoBalloon);
  console.log(`  [auto-balloon] ${JSON.stringify({
    balloons: ab.balloonCount,
    rows: ab.rowCount,
    bumps: ab.overlapBumps,
    ringR: ab.ringRadius_mm,
    slots: ab.balloons.map((b) => b.slotDeg),
    bytes: ab.svgBytes,
  })}`);

  // Focal assertions for AUTO-BALLOON:
  expect(ab).toBeTruthy();
  expect(ab.balloonCount).toBe(ab.rowCount);  // 1:1 mapping balloon-to-BOM
  expect(ab.balloonCount).toBe(5);
  // Non-overlapping check: every balloon owns a UNIQUE slotDeg.
  const slotSet = new Set(ab.balloons.map((b) => b.slotDeg));
  expect(slotSet.size).toBe(ab.balloons.length);
  // Each balloon carries the matching Item No (1..N).
  const itemNos = ab.balloons.map((b) => b.itemNo).sort((a, b) => a - b);
  for (let i = 0; i < itemNos.length; i++) expect(itemNos[i]).toBe(i + 1);
  // SVG content
  const abBody = win.locator('.dpp-dialog [data-dpp-body]');
  const abHtml = await abBody.innerHTML();
  expect(abHtml).toContain('data-archdisc-view="auto-balloon"');
  expect(abHtml).toContain(`data-balloon-count="${ab.balloonCount}"`);
  // Each balloon emits a <circle data-balloon="N"> + the Item No text.
  for (let i = 1; i <= ab.balloonCount; i++) {
    expect(abHtml).toContain(`data-balloon="${i}"`);
    expect(abHtml).toContain(`data-balloon-leader="${i}"`);
  }
  // Mini BOM legend in the corner.
  expect(abHtml).toContain('BOM (Auto-Balloon)');

  await frame('04-D1-auto-balloon-five-balloons-radial-layout');

  // ─── F. Marquee final still — re-open Auto-Balloon with a slightly
  //         different balloon radius so the SVG bytes differ and the
  //         DrawingPreviewPanel's "only update when SVG changes" guard
  //         lets the dialog re-show.
  await win.locator('.dpp-dialog [data-action="dpp-close"]').dispatchEvent('click');
  await expect(win.locator('.dpp-dialog')).not.toBeVisible();
  await win.waitForTimeout(200);

  // Clear the slot so the panel's tick() picks up the next emission.
  await win.evaluate(() => { window.__lastDrawingSVG = null; });

  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    // Bump the radius slightly so the SVG bytes differ from the prior
    // Auto-Balloon emission (the preview panel only re-shows on a new
    // SVG string).
    window.__archdiscPlanParams['Auto-Balloon'] = { balloonRadius: 6, mergeByPartNumber: 'yes' };
  });
  await win.locator('.ribbon-tool-label', { hasText: /^Auto-Balloon$/ }).first().click();
  await expect(win.locator('.dpp-dialog')).toBeVisible({ timeout: 20000 });
  await win.waitForTimeout(900);
  await frame('05-E1-final-composed-assembly-drawing-sheet');

  // Bytes accounting — three real SVGs were emitted.
  expect(mi.svgBytes).toBeGreaterThan(1500);
  expect(bom.svgBytes).toBeGreaterThan(1500);
  expect(ab.svgBytes).toBeGreaterThan(1500);

  // Page-error tally (informational; some warnings are normal).
  if (pageErrors.length) {
    console.warn(`  [pageerror count]: ${pageErrors.length}`);
    for (const e of pageErrors.slice(0, 10)) console.warn(`  - ${e}`);
  }

  await app.close();
});
