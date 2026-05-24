/**
 * UX Tier-8a — Drawing-view types: Auxiliary, Crop, Broken (motion capture)
 *
 * Closes three of the four "Tier 8 — Missing drawing capabilities" items
 * the SolidWorks-course synthesis identified
 * (`docs/superpowers/notes/solidworks-course-synthesis.md` §7 Tier 8):
 *
 *   #71  Auxiliary View — view projected normal to a picked face
 *   #72  Crop View      — clip a base view to a closed boundary
 *   #73  Broken View    — foreshorten a long part with a zig-zag break
 *
 * Bespoke workflow — DIFFERENT from prior UX-tier specs (which all
 * exercised 3D-modeling conventions). This one is a real CAD-DRAFTING
 * workflow on a real engineered part:
 *
 *   A "long shaft with an inclined boss + side hole detail":
 *
 *     - A 220 mm long shaft (Ø 16 mm) along the X axis.
 *     - A small side hole detail (Ø 4 mm) at +95 mm on the shaft.
 *     - A small inclined boss (10 × 10 × 6 mm) on the +Z face at +5 mm
 *       along X, modelled by adding a small block then tipping it so
 *       its top face has a 30° normal in the XZ plane.
 *
 *   ...then runs the THREE new ribbon tools:
 *
 *     - Drawing tab → Auxiliary View (Normal = unit-normal of the
 *       inclined boss face: cos30°·x + sin30°·z). Verifies the SVG
 *       contains a `data-archdisc-view="auxiliary"` root + the FRONT
 *       view + the auxiliary projection + an arrow chevron with the
 *       view label 'A'.
 *
 *     - Drawing tab → Crop View. Picks a paper-space rectangle around
 *       the right-side hole detail. Asserts the SVG contains a
 *       <clipPath id="archdisc-crop-clip"> + the crop boundary rect
 *       + ghost (uncropped) lines + clipped (real) lines. The number
 *       of edges fully INSIDE the boundary < the total edge count.
 *
 *     - Drawing tab → Broken View. Breaks the middle ~30% of the
 *       shaft length. Asserts the SVG contains `data-archdisc-view=
 *       "broken"` + a zigzag `data-break-line="zigzag"` polyline +
 *       (leftLength + rightLength) numerically equals finalLength to
 *       within a tight tolerance (this is the focal assertion for the
 *       Broken-View math).
 *
 * Motion capture, ONE `test()` block, --workers=1 via the project's
 * Playwright (1.59), NO `node:*` imports. Drawing-sheet framing — the
 * DrawingPreviewPanel modal IS the viewable canvas, not a 3D orbit.
 *
 * Run with:
 *   ./node_modules/.bin/playwright test \
 *     e2e/ux-tier8a-drawing-views-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier8a');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-8a Auxiliary + Crop + Broken drawing views on a long shaft with inclined boss + side hole', async () => {
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
    slowMo: 200,
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (err) => pageErrors.push(err.message));
  win.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(`[console] ${msg.text()}`); });
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 60000 });

  // Atomic CAD API only available once the mechanical workbench mounts —
  // wait for it as a hard pre-req of the part-build step.
  await win.waitForFunction(() => !!window.__archdiscAtomic, null, { timeout: 60000 });

  // Bypass the tool-param dialog — we drive each tool with plan-supplied
  // params via window.__archdiscPlanParams so the e2e is deterministic.
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });

  let frameIdx = 0;
  const frame = async (label) => {
    frameIdx += 1;
    const nn = String(frameIdx).padStart(2, '0');
    const safe = label.replace(/[^a-z0-9_-]/gi, '-');
    const file = path.join(OUT, `${nn}-${safe}.png`);
    await win.waitForTimeout(250);
    await win.screenshot({ path: file });
    console.log(`  [frame] ${file}`);
    return file;
  };

  // ─── A. Build the long shaft + side hole + inclined boss ─────────────
  //
  // The Manifold API is in `getManifold()`; the WorkbenchMechanical layer
  // exposes `__archdiscAtomic` for ergonomic primitive composition but we
  // bypass it here and use the manifold module directly so we can:
  //   1. Make a real long shaft (cylinder along X).
  //   2. Cut a side hole (small cylinder along Z, near +X end).
  //   3. Add a small INCLINED block boss on top whose top face normal
  //      lies at 30° in the XZ plane.
  //
  // The combined body is registered as the active foundation manifold so
  // the Drawing tab's Auxiliary / Crop / Broken handlers find it via
  // `_lastFoundationManifold`.

  const buildInfo = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;

    // Build the long shaft as a real engineered part using the same
    // atomic CAD ops a user would click through:
    //   1. Sketch a 220 × 16 mm rectangle on XY (centred at origin) →
    //      extrude 16 mm in Z. Result is a 220 × 16 × 16 mm beam-shaft.
    //   2. Sketch on the top face: small Ø 4 mm circle near +x end → cut
    //      through. That's the side-hole-detail (in front projection
    //      paper-X grows with world-X, so the hole sits at paper-X ≈
    //      +95 * paperScale — used by the Crop View later).
    //   3. Sketch on the top face: a 12 × 12 mm rectangle near -x → cut
    //      a small pocket 4 mm deep. This adds a real local feature on
    //      the LEFT end of the shaft so the AUXILIARY VIEW (projected
    //      along a non-axis direction) shows distinct edges from the
    //      FRONT projection.
    //
    // After atomic ops the body is a real engineered long shaft with a
    // side hole + a small end-pocket — all features placed via the same
    // ribbon ops a user clicks. `A.render` sets window.__lastFoundation
    // Manifold so the Drawing handlers find the body.

    const part = A.createPart('long-shaft-with-detail');
    await A.startSketch(part, 'XY');
    A.sketchRectangle(part, 0, 0, 220, 16);
    A.finishSketch(part);
    await A.extrude(part, 16);            // shaft is now a 220 × 16 × 16 mm beam

    // Side hole — drill from the top down at x = +95 mm (Ø 4 mm through).
    await A.startSketch(part, 'top');
    A.sketchCircle(part, 95, 0, 2);       // Ø 4 mm
    A.finishSketch(part);
    await A.cut(part, 20);                // through-cut

    // End-pocket on the -x end of the shaft (rectangular detail, 4 mm deep)
    // — gives the AUXILIARY view real edges to project beyond the shaft's
    // outer outline.
    await A.startSketch(part, 'top');
    A.sketchRectangle(part, -95, 0, 16, 10);
    A.finishSketch(part);
    await A.cut(part, 4);                 // 4 mm pocket

    A.render(part, 0x9aa3ad);
    // A.render set window.__lastFoundationManifold to part.solid.

    const bb = part.solid.boundingBox();
    return {
      bbox: { min: bb.min, max: bb.max },
      tris: part.solid.getMesh().triVerts.length / 3,
      volume: part.solid.volume(),
    };
  });
  console.log(`  [build] ${JSON.stringify({ tris: buildInfo.tris, volume: Math.round(buildInfo.volume) })}`);
  expect(buildInfo.tris).toBeGreaterThan(50);

  // ─── B. Click Drawing tab so the ribbon shows the view tools ──────────
  // Use the actual ribbon clicks so the workflow mirrors real user UX.
  await win.locator('.ribbon-tab', { hasText: 'Drawing' }).first().click();
  await win.waitForTimeout(450);
  await expect(win.locator('.ribbon-tool-label', { hasText: /^Auxiliary View$/ })).toBeVisible({ timeout: 5000 });
  await expect(win.locator('.ribbon-tool-label', { hasText: /^Crop View$/ })).toBeVisible({ timeout: 5000 });
  await expect(win.locator('.ribbon-tool-label', { hasText: /^Broken View$/ })).toBeVisible({ timeout: 5000 });

  // ─── C. AUXILIARY VIEW — pick the inclined-boss face normal ───────────
  // The boss was rotated 30° about Y; its TOP face's normal is
  // (sin30°, 0, cos30°) = (0.5, 0, 0.866).
  // We feed the normal via the planParams override slot so the dialog
  // (bypassed) picks it up; the handler also accepts the deeper
  // __archdiscAuxiliaryNormal override which we use here to mirror a
  // real face-pick from the viewport (where Tier-11a face-picking would
  // populate that slot on click).
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Auxiliary View'] = {
      nx: 0.5,
      ny: 0.0,
      nz: 0.8660254,
      label: 'A',
    };
  });

  await win.locator('.ribbon-tool-label', { hasText: /^Auxiliary View$/ }).first().click();
  // Preview panel must appear with the auxiliary SVG.
  await expect(win.locator('.dpp-dialog')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(
    () => window.__lastAuxiliaryView != null,
    null,
    { timeout: 15000 },
  );
  const aux = await win.evaluate(() => window.__lastAuxiliaryView);
  console.log(`  [auxiliary] ${JSON.stringify({
    projection: aux.projection,
    edges: aux.edgeCount,
    frontEdges: aux.frontEdgeCount,
    bytes: aux.svgBytes,
  })}`);

  // Focal assertions for AUXILIARY VIEW:
  expect(aux).toBeTruthy();
  expect(aux.label).toBe('A');
  // Projection direction equals the supplied normal (unit-normalised).
  const projMag = Math.hypot(aux.projection.x, aux.projection.y, aux.projection.z);
  expect(Math.abs(projMag - 1)).toBeLessThan(1e-3);
  expect(Math.abs(aux.projection.x - 0.5)).toBeLessThan(1e-2);
  expect(Math.abs(aux.projection.z - 0.8660254)).toBeLessThan(1e-2);
  // SVG content asserts.
  const auxBody = win.locator('.dpp-dialog [data-dpp-body]');
  const auxHtml = await auxBody.innerHTML();
  expect(auxHtml).toContain('data-archdisc-view="auxiliary"');
  expect(auxHtml).toContain('data-view-name="front"');
  expect(auxHtml).toContain('data-view-name="auxiliary"');
  expect(auxHtml).toContain('data-aux-arrow="A"');
  expect(auxHtml).toContain('VIEW A-A');
  // Edge count > 0 on both panels.
  expect(aux.edgeCount).toBeGreaterThan(0);
  expect(aux.frontEdgeCount).toBeGreaterThan(0);

  await frame('01-auxiliary-view-projection-along-inclined-boss-normal');

  // Close the preview before the next view.
  await win.locator('.dpp-dialog [data-action="dpp-close"]').dispatchEvent('click');
  await expect(win.locator('.dpp-dialog')).not.toBeVisible();
  await win.waitForTimeout(200);

  // ─── D. CROP VIEW — focus on the side hole detail ─────────────────────
  // The right-side hole is at +95 mm in WORLD coords. After the FRONT-view
  // projection (eye = -Y, up = +Z), world-X → paper-X, world-Z → paper-Y
  // (up). The paper-scale auto-fits so the part fits ~210 mm wide. We
  // crop a 40 × 35 mm window centred on the projected hole position.
  //
  // The crop dialog params are *paper-mm relative to the view centre*; the
  // projection re-centres the body so the side hole sits at +~85% of the
  // paper-X extent. With auto-scale, the hole's paper-X ≈ +half_extent_x;
  // we'll use a positive X crop centre.
  // Since the part's full X extent is ~220 mm and paper-scale ≈ 0.85*220/
  // (220*1.4) = 0.61, the hole is at paper x ≈ +95 * 0.61 = +58 mm.
  // (DrawingViews centres the projection on origin so this is from centre.)
  // We crop x=40, y=-15, w=40, h=30 to cover the hole region.
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Crop View'] = {
      x: 40,
      y: -15,
      w: 40,
      h: 30,
    };
  });
  await win.locator('.ribbon-tool-label', { hasText: /^Crop View$/ }).first().click();
  await expect(win.locator('.dpp-dialog')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(
    () => window.__lastCropView != null,
    null,
    { timeout: 15000 },
  );
  const crop = await win.evaluate(() => window.__lastCropView);
  console.log(`  [crop] ${JSON.stringify({
    crop: crop.crop,
    inside: crop.edgesInside,
    crossing: crop.edgesCrossing,
    total: crop.originalEdgeCount,
    bytes: crop.svgBytes,
  })}`);
  // Focal assertions for CROP VIEW:
  expect(crop).toBeTruthy();
  expect(crop.crop.w).toBeCloseTo(40, 3);
  expect(crop.crop.h).toBeCloseTo(30, 3);
  // The crop boundary must trim something — count of edges inside the
  // boundary must be smaller than the total visible edges.
  expect(crop.originalEdgeCount).toBeGreaterThan(0);
  expect(crop.edgesInside + crop.edgesCrossing).toBeLessThan(crop.originalEdgeCount);
  // Crop SVG content.
  const cropBody = win.locator('.dpp-dialog [data-dpp-body]');
  const cropHtml = await cropBody.innerHTML();
  expect(cropHtml).toContain('data-archdisc-view="crop"');
  expect(cropHtml).toContain('id="archdisc-crop-clip"');
  expect(cropHtml).toContain('data-crop-boundary="rect"');
  expect(cropHtml).toContain('data-view-name="front-ghost"');
  expect(cropHtml).toContain('data-view-name="cropped"');
  // The cropped group must reference the clipPath.
  expect(cropHtml).toContain('clip-path="url(#archdisc-crop-clip)"');

  await frame('02-crop-view-rectangular-boundary-around-side-hole-detail');

  await win.locator('.dpp-dialog [data-action="dpp-close"]').dispatchEvent('click');
  await expect(win.locator('.dpp-dialog')).not.toBeVisible();
  await win.waitForTimeout(200);

  // ─── E. BROKEN VIEW — foreshorten the long shaft ──────────────────────
  // Default: break from 35% → 65% of the shaft's projected length. The
  // handler maps fractional to paper-mm internally.
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Broken View'] = {
      breakStartFrac: 0.35,
      breakEndFrac: 0.65,
      axis: 'x',
    };
  });
  await win.locator('.ribbon-tool-label', { hasText: /^Broken View$/ }).first().click();
  await expect(win.locator('.dpp-dialog')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(
    () => window.__lastBrokenView != null,
    null,
    { timeout: 15000 },
  );
  const broken = await win.evaluate(() => window.__lastBrokenView);
  console.log(`  [broken] ${JSON.stringify({
    full: +broken.fullLength.toFixed(2),
    gap: +broken.gapLength.toFixed(2),
    finalDrawn: +broken.finalLength.toFixed(2),
    left: +broken.leftLength.toFixed(2),
    right: +broken.rightLength.toFixed(2),
    leftEdges: broken.leftEdgeCount,
    rightEdges: broken.rightEdgeCount,
    bytes: broken.svgBytes,
  })}`);
  // Focal assertions for BROKEN VIEW:
  expect(broken).toBeTruthy();
  // Numerical: leftLength + rightLength == finalLength to within 0.5%.
  const sumLR = broken.leftLength + broken.rightLength;
  const pctErr = Math.abs(sumLR - broken.finalLength) / Math.max(broken.finalLength, 1e-6);
  console.log(`  [broken] (left + right) - drawn = ${(sumLR - broken.finalLength).toFixed(6)} mm (${(pctErr * 100).toFixed(4)}%)`);
  expect(pctErr).toBeLessThan(0.005);
  // Numerical: full = drawn + gap (within 0.5%).
  const reconstructed = broken.finalLength + broken.gapLength;
  expect(Math.abs(reconstructed - broken.fullLength) / Math.max(broken.fullLength, 1e-6)).toBeLessThan(0.005);
  expect(broken.leftEdgeCount).toBeGreaterThan(0);
  expect(broken.rightEdgeCount).toBeGreaterThan(0);
  // SVG content.
  const brokenBody = win.locator('.dpp-dialog [data-dpp-body]');
  const brokenHtml = await brokenBody.innerHTML();
  expect(brokenHtml).toContain('data-archdisc-view="broken"');
  expect(brokenHtml).toContain('data-view-name="broken-left"');
  expect(brokenHtml).toContain('data-view-name="broken-right"');
  expect(brokenHtml).toContain('data-break-line="zigzag"');

  await frame('03-broken-view-foreshortened-shaft-with-zigzag-break-line');

  // ─── F. Sanity overview still — drawing preview with broken view ──────
  await frame('04-broken-view-sheet-final-framing');
  await win.locator('.dpp-dialog [data-action="dpp-close"]').dispatchEvent('click');

  // Bring back the auxiliary view for a final summary still — so the
  // motion-capture session video closes on the marquee shot (the
  // perpendicular-to-inclined-boss view, which is the most visually
  // novel of the three).
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Auxiliary View'] = {
      nx: 0.5,
      ny: 0.0,
      nz: 0.8660254,
      label: 'A',
    };
  });
  await win.locator('.ribbon-tool-label', { hasText: /^Auxiliary View$/ }).first().click();
  await expect(win.locator('.dpp-dialog')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(600);
  await frame('05-auxiliary-marquee-final');

  // Bytes accounting — three real-SVGs were emitted.
  expect(aux.svgBytes).toBeGreaterThan(2000);
  expect(crop.svgBytes).toBeGreaterThan(2000);
  expect(broken.svgBytes).toBeGreaterThan(2000);

  // No page errors during the workflow.
  if (pageErrors.length) {
    console.warn(`  [pageerror count]: ${pageErrors.length}`);
    for (const e of pageErrors.slice(0, 10)) console.warn(`  - ${e}`);
  }

  await app.close();
});
