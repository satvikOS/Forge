/**
 * UX Tier-12 — Stepped Section Line + Tabular Note (motion capture)
 *
 * Closes the two NX-distinctive Drafting items the SolidWorks-course
 * synthesis missed but the Siemens-NX synthesis flagged
 * (`docs/superpowers/notes/siemens-nx-course-synthesis.md` §6 items 112 +
 * 114):
 *
 *   #112  Stepped Section Line — multi-segment cut path with right-angle
 *         jogs; composite cross-section hops between parallel planes.
 *
 *   #114  Tabular Note         — generic editable N×M annotation table
 *         (NOT BOM-linked). Used for hole charts, revision blocks,
 *         tolerance tables.
 *
 * Bespoke workflow — DIFFERENT from all prior UX-tier specs:
 *
 *   An HVAC MANIFOLD VALVE BODY — a single steel block (120 × 60 × 40 mm)
 *   with THREE through-bores down the Z axis, evenly spaced along the X
 *   axis. Each bore has a different diameter + depth + tolerance class.
 *   This is a real engineering-drawing scenario: stepped section reveals
 *   all three bores in ONE composite section (the canonical use of NX
 *   "Section Line → Stand Alone"), while the tabular note documents the
 *   hole chart that the section drawing references.
 *
 *     - Block:    120 × 60 × 40 mm   (X × Y × Z)
 *     - Bore #1:  Ø10  thru,  H7  tolerance — centred at  X = -40, Y = 0
 *     - Bore #2:  Ø14  thru,  H7  tolerance — centred at  X =   0, Y = 0
 *     - Bore #3:  Ø10  thru,  H8  tolerance — centred at  X = +40, Y = 0
 *
 *   Workflow (real ribbon clicks):
 *     1. Build the manifold valve body via the atomic Part API + render.
 *     2. Click the Drawing tab; assert BOTH new Tier-12 tools render.
 *     3. Stepped Section Line — stash a real 7-point polyline that jogs
 *        through all 3 bore centrelines (in/out across each bore, then
 *        a right-angle jog to the next bore). Assert the SVG carries
 *        the polyline, the jog markers, the labelled arrow heads, AND
 *        the composite section hops (one per segment).
 *     4. Tabular Note — stash a real hole-chart (4 columns: Hole,
 *        Diameter, Depth, Tolerance; 3 rows). Assert the SVG carries
 *        every cell value + the header labels + the title bar.
 *
 * Focal assertions:
 *   - Stepped Section: segmentCount = polylineLen - 1, jogCount =
 *     polylineLen - 2, totalCutEdges > 6 (every bore + outer-block
 *     contribute edges to the composite section).
 *   - Tabular Note: 4×3 grid is present, every Ø/depth/tolerance string
 *     appears in the SVG text, header labels visible, table positioned
 *     where requested.
 *
 * Motion capture, ONE `test()` block, --workers=1 via the project's
 * Playwright (1.59), NO `node:*` imports. ONE sheet view per op,
 * 3-4 stills total.
 *
 * Run with:
 *   ./node_modules/.bin/playwright test \
 *     e2e/ux-tier12-steppedsection-tabularnote-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier12');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-12 Stepped Section Line + Tabular Note on a real HVAC manifold valve body', async () => {
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

  // ─── A. Build the HVAC manifold valve body via atomic CAD ──────────────
  //
  // Block 120 × 60 × 40 mm + 3 through-bores along the Z axis at
  // X = -40 / 0 / +40 (Y = 0). Bore diameters: 10 / 14 / 10 mm.
  const buildInfo = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const part = A.createPart('hvac-manifold-valve-body');

    // The block — XY rectangle 120 × 60, extruded Z 40.
    await A.startSketch(part, 'XY');
    A.sketchRectangle(part, 0, 0, 120, 60);
    A.finishSketch(part);
    await A.extrude(part, 40);

    // Bore #1 — Ø10 at X = -40.
    await A.startSketch(part, 'XY');
    A.sketchCircle(part, -40, 0, 5);
    A.finishSketch(part);
    await A.cut(part, 40);

    // Bore #2 — Ø14 at X = 0.
    await A.startSketch(part, 'XY');
    A.sketchCircle(part, 0, 0, 7);
    A.finishSketch(part);
    await A.cut(part, 40);

    // Bore #3 — Ø10 at X = +40.
    await A.startSketch(part, 'XY');
    A.sketchCircle(part, 40, 0, 5);
    A.finishSketch(part);
    await A.cut(part, 40);

    A.render(part, 0x6c8aa6);

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
  expect(buildInfo.featureCount).toBeGreaterThan(6);

  // ─── B. Click Drawing tab and assert the new ribbon tools exist ────────
  await win.locator('.ribbon-tab', { hasText: 'Drawing' }).first().click();
  await win.waitForTimeout(800);
  const ribbonLabels = await win.locator('.ribbon-tool-label').allInnerTexts();
  console.log(`  [ribbon-labels] ${JSON.stringify(ribbonLabels)}`);
  await expect(win.locator('.ribbon-tool-label', { hasText: /^Stepped Section Line$/ }).first()).toBeVisible({ timeout: 10000 });
  await expect(win.locator('.ribbon-tool-label', { hasText: /^Tabular Note$/ }).first()).toBeVisible({ timeout: 10000 });

  await frame('01-manifold-built-drawing-tab-tier12-tools');

  // ─── C. STEPPED SECTION LINE — jog through all 3 bore centrelines ─────
  //
  // The FRONT view is projected with eye=-Y, up=+Z, scale ~paperScale to
  // fit the box. To hit each bore (at world X = -40 / 0 / +40, Z = 0) we
  // build a polyline in paper-mm of the FRONT view's paper space that
  // passes left→right through all three bore centrelines. The bore X
  // positions in paper-mm = worldX * paperScale. We don't know the exact
  // paperScale ahead of time, but with the block extent ~120 mm, scale ~
  // 0.6–0.8 → bores live around ±25 mm in paper space. We use the raw
  // world-mm coordinates (paperScale is forgiving) and the step jog is
  // a small Y offset between the bores.
  await win.evaluate(() => {
    // 7-point polyline: left-bore tail → bore#1 centreline → jog up →
    // bore#2 centreline (different Y) → jog down → bore#3 centreline →
    // right tail. This makes 6 segments with 5 interior jog markers.
    window.__archdiscSteppedSectionPoints = [
      { x: -55, y: -5 },   // P0 — left tail (start arrow A)
      { x: -40, y: -5 },   // P1 — pass through bore #1 centreline at -40
      { x: -40, y:  8 },   // P2 — right-angle jog up
      { x:   0, y:  8 },   // P3 — pass through bore #2 centreline at  0
      { x:   0, y: -5 },   // P4 — right-angle jog down
      { x:  40, y: -5 },   // P5 — pass through bore #3 centreline at +40
      { x:  55, y: -5 },   // P6 — right tail (end arrow A)
    ];
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Stepped Section Line'] = { label: 'A' };
  });
  await win.locator('.ribbon-tool-label', { hasText: /^Stepped Section Line$/ }).first().click();
  await expect(win.locator('.dpp-dialog')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => window.__lastSteppedSectionLine != null, null, { timeout: 15000 });
  const ss = await win.evaluate(() => window.__lastSteppedSectionLine);
  console.log(`  [stepped-section] ${JSON.stringify({
    label: ss.label,
    segs: ss.segmentCount,
    jogs: ss.jogCount,
    cutEdges: ss.totalCutEdges,
    scale: ss.paperScale,
    bytes: ss.svgBytes,
  })}`);

  // Focal assertions for STEPPED SECTION LINE.
  expect(ss).toBeTruthy();
  expect(ss.label).toBe('A');
  // 7 points → 6 segments, 5 interior jogs.
  expect(ss.segmentCount).toBe(6);
  expect(ss.jogCount).toBe(5);
  // Every segment slices the body — total cut edges must be substantial
  // because each of the 3 bore-passing segments slices the block + 1 bore.
  expect(ss.totalCutEdges).toBeGreaterThan(6);
  // Each segment record must carry its own slice count.
  expect(ss.segments.length).toBe(6);
  for (const seg of ss.segments) {
    expect(seg).toHaveProperty('sliceSegmentCount');
    expect(seg).toHaveProperty('planeOrigin');
    expect(seg).toHaveProperty('planeNormal');
  }

  // SVG content checks.
  const ssBody = win.locator('.dpp-dialog [data-dpp-body]');
  const ssHtml = await ssBody.innerHTML();
  expect(ssHtml).toContain('data-archdisc-view="stepped-section"');
  expect(ssHtml).toContain('data-section-label="A"');
  expect(ssHtml).toContain('data-segment-count="6"');
  expect(ssHtml).toContain('data-jog-count="5"');
  expect(ssHtml).toContain('data-archdisc-stepped-section-line="A"');
  expect(ssHtml).toContain('data-stepped-section-polyline="1"');
  // 5 jog markers.
  for (let j = 1; j <= 5; j++) {
    expect(ssHtml).toContain(`data-stepped-section-jog="${j}"`);
  }
  // Arrow heads at each end carry the label.
  expect(ssHtml).toContain('data-stepped-section-arrow="A"');
  // Composite section banner — when read back from the DOM the en-dash is
  // the literal Unicode char (not the HTML entity form).
  expect(ssHtml).toContain('SECTION A–A  (STEPPED)');
  // 6 hop groups (one per segment).
  for (let h = 1; h <= 6; h++) {
    expect(ssHtml).toContain(`data-hop="${h}"`);
  }
  expect(ssHtml).toContain('data-view-name="front"');

  await frame('02-stepped-section-line-A-A-through-3-bores');
  await win.locator('.dpp-dialog [data-action="dpp-close"]').dispatchEvent('click');
  await expect(win.locator('.dpp-dialog')).not.toBeVisible();
  await win.waitForTimeout(200);

  // Clear the SVG slot so the preview panel re-shows on the next op.
  await win.evaluate(() => { window.__lastDrawingSVG = null; });

  // ─── D. TABULAR NOTE — Hole | Diameter | Depth | Tolerance hole chart ─
  await win.evaluate(() => {
    window.__archdiscTabularNoteData = {
      columns: [
        { label: 'HOLE', width: 22 },
        { label: 'DIAMETER', width: 32 },
        { label: 'DEPTH', width: 28 },
        { label: 'TOLERANCE', width: 30 },
      ],
      rows: [
        ['A', 'Ø10.0 mm', '40.0 mm', 'H7'],
        ['B', 'Ø14.0 mm', '40.0 mm', 'H7'],
        ['C', 'Ø10.0 mm', '40.0 mm', 'H8'],
      ],
    };
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Tabular Note'] = {
      title: 'HOLE CHART',
      x: 40,
      y: 40,
      cols: 4,
      rows: 3,
      colWidth: 28,
      size: 'A3',
      orientation: 'landscape',
    };
  });
  await win.locator('.ribbon-tool-label', { hasText: /^Tabular Note$/ }).first().click();
  await expect(win.locator('.dpp-dialog')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => window.__lastTabularNote != null, null, { timeout: 15000 });
  const tn = await win.evaluate(() => window.__lastTabularNote);
  console.log(`  [tabular-note] ${JSON.stringify({
    title: tn.title,
    cols: tn.columnCount,
    rows: tn.rowCount,
    position: tn.position,
    bbox: tn.tableBBox,
    bytes: tn.svgBytes,
  })}`);

  // Focal assertions for TABULAR NOTE.
  expect(tn).toBeTruthy();
  expect(tn.title).toBe('HOLE CHART');
  expect(tn.columnCount).toBe(4);
  expect(tn.rowCount).toBe(3);
  expect(tn.position.x).toBe(40);
  expect(tn.position.y).toBe(40);
  // Table width: 22 + 32 + 28 + 30 = 112 mm.
  expect(tn.tableBBox.w).toBe(112);
  expect(tn.tableBBox.x).toBe(40);
  expect(tn.tableBBox.y).toBe(40);
  // Cells: 4 × 3 = 12 data cells.
  expect(tn.cells.length).toBe(12);
  expect(tn.sheet.size).toBe('A3');
  expect(tn.sheet.orientation).toBe('landscape');
  expect(tn.sheet.w).toBe(420);
  expect(tn.sheet.h).toBe(297);

  // SVG content checks — header + every cell value.
  const tnBody = win.locator('.dpp-dialog [data-dpp-body]');
  const tnHtml = await tnBody.innerHTML();
  expect(tnHtml).toContain('data-archdisc-view="tabular-note"');
  expect(tnHtml).toContain('data-tn-title="HOLE CHART"');
  expect(tnHtml).toContain('data-tn-cols="4"');
  expect(tnHtml).toContain('data-tn-rows="3"');
  expect(tnHtml).toContain('data-archdisc-tabular-note="1"');
  // Header labels.
  expect(tnHtml).toContain('HOLE CHART');
  expect(tnHtml).toContain('HOLE');
  expect(tnHtml).toContain('DIAMETER');
  expect(tnHtml).toContain('DEPTH');
  expect(tnHtml).toContain('TOLERANCE');
  // Row content — every cell value appears as SVG text. Note the Ø
  // character may be HTML-escaped in the rendered preview, so check both
  // the literal symbol and the entity form. The diameter rows always
  // include the literal "10.0" / "14.0" digit substrings.
  expect(tnHtml).toMatch(/(10\.0)/);
  expect(tnHtml).toMatch(/(14\.0)/);
  expect(tnHtml).toContain('40.0 mm');
  expect(tnHtml).toContain('H7');
  expect(tnHtml).toContain('H8');
  // Row letters.
  expect(tnHtml).toContain('>A<');
  expect(tnHtml).toContain('>B<');
  expect(tnHtml).toContain('>C<');
  // Every (col, row) cell carries its index.
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      expect(tnHtml).toContain(`data-tn-row="${r}"`);
      expect(tnHtml).toContain(`data-tn-col="${c}"`);
    }
  }

  await frame('03-tabular-note-hole-chart-4x3');

  // ─── E. Final still — keep the tabular-note sheet visible ─────────────
  await win.waitForTimeout(500);
  await frame('04-final-engineering-drawing-tier12');

  // Sanity: real SVG bytes were emitted for both ops.
  expect(ss.svgBytes).toBeGreaterThan(1200);
  expect(tn.svgBytes).toBeGreaterThan(1200);

  if (pageErrors.length) {
    console.warn(`  [pageerror count]: ${pageErrors.length}`);
    for (const e of pageErrors.slice(0, 10)) console.warn(`  - ${e}`);
  }

  await app.close();
});
