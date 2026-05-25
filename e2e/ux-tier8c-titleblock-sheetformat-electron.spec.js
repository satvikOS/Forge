/**
 * UX Tier-8c — Drawing Title Block + Sheet Format (motion capture)
 *
 * Closes the remaining two "Tier 8 — Missing drawing capabilities" items
 * the SolidWorks-course synthesis identified
 * (`docs/superpowers/notes/solidworks-course-synthesis.md` §7 Tier 8):
 *
 *   #89  Title Block  — real ASME / ISO 3-row grid stamped in the corner
 *   #~~  Sheet Format — change A0..A4 / ANSI A..E size + orientation
 *
 * Bespoke workflow — DIFFERENT from Tier 8a's long-shaft drafting demo
 * and DIFFERENT from Tier 8b's multi-body conveyor-roller assembly.
 * Tier 8c exercises the SHEET-LEVEL pipeline on a real automotive part:
 *
 *   A CONNECTING ROD (engine-block staple):
 *     - I-beam web 8 × 60 × 6 mm (length runs along +Y)
 *     - Big-end hub  20 × 24 × 6 mm at +y end with Ø10 bore
 *     - Small-end hub 12 × 16 × 6 mm at -y end with Ø5 pin bore
 *
 * Workflow (real ribbon clicks, single drawing-sheet framing, NO
 * 7-angle 3D orbit — this is a 2D drawing op):
 *
 *   1. Build the connecting rod via the atomic Part API + render so it
 *      becomes `window.__lastFoundationManifold`.
 *   2. Click the Drawing tab → assert both NEW ribbon tools are visible
 *      (Title Block + Sheet Format).
 *   3. Run SHEET FORMAT first — switch the active sheet to A3 landscape
 *      (420 × 297 mm). Assert the SVG carries the new sheet dimensions
 *      + the FRONT view + a mini corner block.
 *   4. Run TITLE BLOCK with REAL engineering fields
 *      (partNumber 'CR-2104-A', description 'CONNECTING ROD',
 *      drawnBy 'A.Eng', date '2026-05-25', material 'AISI 4140',
 *      scale '1:2', sheetN 1, sheetTotal 1). Assert the SVG contains a
 *      `data-archdisc-title-block="1"` group with EVERY cell tagged
 *      (`data-tb-cell="drawn"`, etc.) + the part number / description
 *      strings + the bottom-right anchor coords.
 *
 * Focal assertions:
 *   - Sheet Format: new sheet dimensions (420 × 297 mm A3 landscape)
 *     appear in the SVG width/height + viewBox + data attrs.
 *   - Title Block: 8 properties cells + title row + approval row all
 *     present; partNumber + description text appear; the block lives in
 *     the bottom-right corner (TB_X + TB_W ≈ sheetW - 5,
 *     TB_Y + TB_H ≈ sheetH - 5).
 *
 * Motion capture, ONE `test()` block, --workers=1 via the project's
 * Playwright (1.59), NO `node:*` imports. Drawing-sheet framing — the
 * DrawingPreviewPanel modal IS the viewable canvas. 3-4 stills max.
 *
 * Run with:
 *   ./node_modules/.bin/playwright test \
 *     e2e/ux-tier8c-titleblock-sheetformat-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier8c');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-8c Sheet Format + Title Block on a real automotive connecting rod', async () => {
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

  // Bypass tool-param dialog — drive each tool with planParams instead.
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

  // ─── A. Build the connecting rod via atomic CAD ────────────────────────
  //
  // I-beam web + two hub blocks fused + two bores. We build it via the
  // atomic Part API so the result lands on `__lastFoundationManifold`
  // automatically when `A.render` is called.
  const buildInfo = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const part = A.createPart('connecting-rod');

    // Build the connecting-rod SILHOUETTE in the XY plane (top-down view).
    // The Title Block / Sheet Format ops project TOP-DOWN, so this XY
    // silhouette is exactly what will appear on the drawing sheet.
    //
    //   long axis X : -120 .. +120 mm (rod spans 240 mm tip-to-tip)
    //   width    Y : the I-beam profile (thin web + wide hub circles)
    //   thickness Z: 6 mm (extruded, collapsed in the TOP view)

    // Big-end hub — Ø50 disc centred at (+105, 0).
    await A.startSketch(part, 'XY');
    A.sketchCircle(part, 105, 0, 25);
    A.finishSketch(part);
    await A.extrude(part, 6);

    // Small-end hub — Ø36 disc centred at (-105, 0). Fused into the body.
    await A.startSketch(part, 'XY');
    A.sketchCircle(part, -105, 0, 18);
    A.finishSketch(part);
    await A.extrude(part, 6);

    // I-beam web — narrow rectangle bridging the two hubs (X from -100
    // to +100, Y thin ±7).
    await A.startSketch(part, 'XY');
    A.sketchRectangle(part, 0, 0, 200, 14);
    A.finishSketch(part);
    await A.extrude(part, 6);

    // Big-end bore — Ø22 through-hole at (+105, 0).
    await A.startSketch(part, 'XY');
    A.sketchCircle(part, 105, 0, 11);
    A.finishSketch(part);
    await A.cut(part, 12);

    // Small-end pin bore — Ø12 through-hole at (-105, 0).
    await A.startSketch(part, 'XY');
    A.sketchCircle(part, -105, 0, 6);
    A.finishSketch(part);
    await A.cut(part, 12);

    A.render(part, 0xc5a86a);

    const bb = part.solid.boundingBox();
    return {
      bbox: { min: bb.min, max: bb.max },
      tris: part.solid.getMesh().triVerts.length / 3,
      volume: part.solid.volume(),
      featureCount: part.features.length,
    };
  });
  console.log(`  [build] ${JSON.stringify({
    tris: buildInfo.tris,
    volume: Math.round(buildInfo.volume),
    features: buildInfo.featureCount,
    bbox: buildInfo.bbox,
  })}`);
  expect(buildInfo.tris).toBeGreaterThan(50);
  expect(buildInfo.featureCount).toBeGreaterThan(8);

  // ─── B. Click Drawing tab and assert the new ribbon tools exist ────────
  await win.locator('.ribbon-tab', { hasText: 'Drawing' }).first().click();
  await win.waitForTimeout(800);
  // Surface what the ribbon actually rendered for diagnosis if Title Block
  // is missing.
  const ribbonLabels = await win.locator('.ribbon-tool-label').allInnerTexts();
  console.log(`  [ribbon-labels] ${JSON.stringify(ribbonLabels)}`);
  await expect(win.locator('.ribbon-tool-label', { hasText: /^Title Block$/ }).first()).toBeVisible({ timeout: 10000 });
  await expect(win.locator('.ribbon-tool-label', { hasText: /^Sheet Format$/ }).first()).toBeVisible({ timeout: 10000 });

  await frame('01-connecting-rod-built-drawing-tab-with-tier8c-tools');

  // ─── C. SHEET FORMAT — switch to A3 landscape (420 × 297 mm) ──────────
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Sheet Format'] = {
      size: 'A3',
      orientation: 'landscape',
      partName: 'CR-2104-A',
    };
  });
  await win.locator('.ribbon-tool-label', { hasText: /^Sheet Format$/ }).first().click();
  await expect(win.locator('.dpp-dialog')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => window.__lastSheetFormat != null, null, { timeout: 15000 });
  const sf = await win.evaluate(() => window.__lastSheetFormat);
  console.log(`  [sheet-format] ${JSON.stringify({
    sheet: sf.sheet,
    edges: sf.edgeCount,
    bytes: sf.svgBytes,
    area_mm2: sf.sheetArea_mm2,
  })}`);

  // Focal assertions for SHEET FORMAT:
  expect(sf).toBeTruthy();
  expect(sf.sheet.size).toBe('A3');
  expect(sf.sheet.orientation).toBe('landscape');
  // A3 landscape = 420 × 297 mm. The Sheet Format swaps natural-portrait
  // dimensions to fit landscape (h>w → w>h).
  expect(sf.sheet.w).toBe(420);
  expect(sf.sheet.h).toBe(297);
  expect(sf.sheetArea_mm2).toBe(420 * 297);
  expect(sf.edgeCount).toBeGreaterThan(8);

  // SVG content checks.
  const sfBody = win.locator('.dpp-dialog [data-dpp-body]');
  const sfHtml = await sfBody.innerHTML();
  expect(sfHtml).toContain('data-archdisc-view="sheet-format"');
  expect(sfHtml).toContain('data-sheet-size="A3"');
  expect(sfHtml).toContain('data-sheet-orientation="landscape"');
  expect(sfHtml).toContain('data-sheet-w="420"');
  expect(sfHtml).toContain('data-sheet-h="297"');
  expect(sfHtml).toContain('viewBox="0 0 420 297"');
  expect(sfHtml).toContain('SHEET A3 (LANDSCAPE)');
  expect(sfHtml).toContain('data-view-name="front"');
  // Mini corner block exists.
  expect(sfHtml).toContain('data-archdisc-title-block="mini"');

  await frame('02-sheet-format-a3-landscape-connecting-rod-front-view');
  await win.locator('.dpp-dialog [data-action="dpp-close"]').dispatchEvent('click');
  await expect(win.locator('.dpp-dialog')).not.toBeVisible();
  await win.waitForTimeout(200);

  // Clear the SVG slot so the preview panel re-shows on the next op.
  await win.evaluate(() => { window.__lastDrawingSVG = null; });

  // ─── D. TITLE BLOCK — stamp real engineering fields on A3 landscape ────
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Title Block'] = {
      partNumber: 'CR-2104-A',
      description: 'CONNECTING ROD',
      drawnBy: 'A.Eng',
      date: '2026-05-25',
      material: 'AISI 4140',
      scale: '1:2',
      sheetN: 1,
      sheetTotal: 1,
      approval: 'PENDING',
      size: 'A3',
      orientation: 'landscape',
    };
  });
  await win.locator('.ribbon-tool-label', { hasText: /^Title Block$/ }).first().click();
  await expect(win.locator('.dpp-dialog')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => window.__lastTitleBlock != null, null, { timeout: 15000 });
  const tb = await win.evaluate(() => window.__lastTitleBlock);
  console.log(`  [title-block] ${JSON.stringify({
    sheet: tb.sheet,
    fields: tb.fields,
    tbBBox: tb.titleBlockBBox,
    edges: tb.edgeCount,
    bytes: tb.svgBytes,
  })}`);

  // Focal assertions for TITLE BLOCK:
  expect(tb).toBeTruthy();
  expect(tb.sheet.size).toBe('A3');
  expect(tb.sheet.orientation).toBe('landscape');
  expect(tb.sheet.w).toBe(420);
  expect(tb.sheet.h).toBe(297);
  // Field values came through.
  expect(tb.fields.partNumber).toBe('CR-2104-A');
  expect(tb.fields.description).toBe('CONNECTING ROD');
  expect(tb.fields.drawnBy).toBe('A.Eng');
  expect(tb.fields.date).toBe('2026-05-25');
  expect(tb.fields.material).toBe('AISI 4140');
  expect(tb.fields.scale).toBe('1:2');
  expect(tb.fields.sheetN).toBe(1);
  expect(tb.fields.sheetTotal).toBe(1);
  // Block is anchored bottom-right with 5mm inset (TB_X + TB_W = sheetW - 5,
  // TB_Y + TB_H = sheetH - 5).
  expect(tb.titleBlockBBox.x + tb.titleBlockBBox.w).toBeCloseTo(tb.sheet.w - 5, 3);
  expect(tb.titleBlockBBox.y + tb.titleBlockBBox.h).toBeCloseTo(tb.sheet.h - 5, 3);
  expect(tb.titleBlockBBox.w).toBe(120);
  expect(tb.titleBlockBBox.h).toBe(60);
  // FRONT view rendered.
  expect(tb.edgeCount).toBeGreaterThan(8);

  // SVG content checks — every cell must be present.
  const tbBody = win.locator('.dpp-dialog [data-dpp-body]');
  const tbHtml = await tbBody.innerHTML();
  expect(tbHtml).toContain('data-archdisc-view="title-block"');
  expect(tbHtml).toContain('data-archdisc-title-block="1"');
  expect(tbHtml).toContain('data-tb-part-number="CR-2104-A"');
  expect(tbHtml).toContain('viewBox="0 0 420 297"');
  // 8 properties cells + approval cell = 9 distinct data-tb-cell ids.
  for (const cell of ['drawn', 'date', 'material', 'scale', 'sheet', 'standard', 'units', 'tol', 'approval']) {
    expect(tbHtml).toContain(`data-tb-cell="${cell}"`);
  }
  // Visible labels (uppercase in the SVG).
  expect(tbHtml).toContain('DRAWN');
  expect(tbHtml).toContain('DATE');
  expect(tbHtml).toContain('MATERIAL');
  expect(tbHtml).toContain('SCALE');
  expect(tbHtml).toContain('APPROVED');
  // The actual field values must appear in the SVG text too.
  expect(tbHtml).toContain('CR-2104-A');
  expect(tbHtml).toContain('CONNECTING ROD');
  expect(tbHtml).toContain('A.Eng');
  expect(tbHtml).toContain('2026-05-25');
  expect(tbHtml).toContain('AISI 4140');
  expect(tbHtml).toContain('1:2');
  expect(tbHtml).toContain('1 / 1');
  // FRONT view present.
  expect(tbHtml).toContain('data-view-name="front"');

  await frame('03-title-block-stamped-with-real-engineering-fields');

  // ─── E. Final still — keep the title-block sheet visible for the marquee
  await win.waitForTimeout(500);
  await frame('04-final-engineering-drawing-with-title-block-corner');

  // Sanity: real SVG bytes were emitted.
  expect(sf.svgBytes).toBeGreaterThan(800);
  expect(tb.svgBytes).toBeGreaterThan(1500);

  if (pageErrors.length) {
    console.warn(`  [pageerror count]: ${pageErrors.length}`);
    for (const e of pageErrors.slice(0, 10)) console.warn(`  - ${e}`);
  }

  await app.close();
});
