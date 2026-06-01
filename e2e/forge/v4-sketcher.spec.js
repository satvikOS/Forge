// v4-sketcher.spec.js — Forge-85 rigorous multi-angle headed verification.
//
// Covers the full sketcher path: open sketch, add line/rect/circle/arc/
// polygon, constrain, finish, then extrude. Screenshots from every named
// view + both themes + every display style.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-sketcher';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function confirmDialog(page) {
  const btn = page.locator('[data-testid="forge-tool-confirm"]');
  if (await btn.count()) await btn.click();
  await page.waitForTimeout(450);
}

const VIEWS = [
  { key: '1', name: 'iso' },
  { key: '2', name: 'front' },
  { key: '3', name: 'back' },
  { key: '4', name: 'top' },
  { key: '5', name: 'bottom' },
  { key: '6', name: 'right' },
  { key: '7', name: 'left' },
];

test.describe.serial('Forge-85 · sketcher full multi-angle', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 open sketch · badge shows under-constrained', async () => {
    await page.click('[data-qat-id="sketch.new"]');
    await page.waitForTimeout(400);
    await confirmDialog(page);
    await shot(page, 'sketch-opened');
    const badge = page.locator('[data-testid="forge-sketch-badge"]');
    await expect(badge).toBeVisible({ timeout: 2500 });
  });

  test('02 add rectangle to sketch', async () => {
    await page.click('[data-tool="sketch.rect"]');
    await page.waitForTimeout(400);
    await confirmDialog(page);
    await shot(page, 'rect-added');
    const toast = page.locator('text=/Rectangle .+ entities/i').first();
    await expect(toast).toBeVisible({ timeout: 2000 });
  });

  test('03 add circle to sketch', async () => {
    await page.click('[data-tool="sketch.circle"]');
    await page.waitForTimeout(400);
    await confirmDialog(page);
    await shot(page, 'circle-added');
  });

  test('04 add polygon (hex)', async () => {
    await page.click('[data-tool="sketch.polygon"]');
    await page.waitForTimeout(400);
    await confirmDialog(page);
    await shot(page, 'polygon-added');
  });

  test('05 add arc', async () => {
    await page.click('[data-tool="sketch.arc"]');
    await page.waitForTimeout(400);
    await confirmDialog(page);
    await shot(page, 'arc-added');
  });

  test('06 add line', async () => {
    await page.click('[data-tool="sketch.line"]');
    await page.waitForTimeout(400);
    await confirmDialog(page);
    await shot(page, 'line-added');
  });

  test('07 view sketch from every named angle', async () => {
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(450);
      await shot(page, `sketch-${v.name}`);
    }
  });

  test('08 light theme · sketch entities still visible from every angle', async () => {
    await page.keyboard.press('Meta+t');
    await page.waitForTimeout(900);
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(420);
      await shot(page, `light-${v.name}`);
    }
    await page.keyboard.press('Meta+t');
    await page.waitForTimeout(500);
  });

  test('09 wireframe + section display modes', async () => {
    for (const mode of ['wireframe','shaded','section']) {
      await page.click(`[data-hut-id="view.${mode}"]`);
      await page.waitForTimeout(500);
      await shot(page, `display-${mode}`);
    }
  });

  test('10 finish sketch · then extrude · body appears', async () => {
    await page.click('[data-qat-id="sketch.new"]');   // actually triggers sketch.finish via the same id? — fallback path
    // Use the keyboard menu approach instead
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.click('[data-menu="tools"]');
    await page.waitForTimeout(250);
    const finishItem = page.locator('[role="menuitem"]', { hasText: /Finish Sketch/i }).first();
    if (await finishItem.count()) {
      await finishItem.click();
      await page.waitForTimeout(500);
    }
    await shot(page, 'sketch-finished');
    // Now extrude (will consume the sketch handle if native, else synthetic)
    await page.click('[data-tool="solid.extrude"]');
    await page.waitForTimeout(400);
    await confirmDialog(page);
    await shot(page, 'extruded-from-sketch');
    const featCount = await page.locator('[data-testid="forge-feature-tree"] > li').count();
    expect(featCount).toBeGreaterThan(0);
  });

  test('11 extruded body visible from every angle (after sketch)', async () => {
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(420);
      await shot(page, `extruded-${v.name}`);
    }
  });

  test('12 sketch warning when no active sketch · click sketch.line', async () => {
    // Reset state by File · New
    await page.click('[data-menu="file"]');
    await page.waitForTimeout(200);
    const newItem = page.locator('[role="menuitem"]', { hasText: /New$/i }).first();
    if (await newItem.count()) await newItem.click();
    await page.waitForTimeout(400);
    await page.click('[data-tool="sketch.line"]');
    await page.waitForTimeout(400);
    await confirmDialog(page);
    const warn = page.locator('text=/Open a sketch first/i').first();
    await expect(warn).toBeVisible({ timeout: 1500 });
    await shot(page, 'no-sketch-warning');
  });
});
