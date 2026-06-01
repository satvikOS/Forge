// v4-wave4-multi-angle.spec.js — Forge-124 final integration multi-angle
// covering IFC, FEA convergence, skeleton, plus a regression sweep of the
// 7 named views in both themes.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-wave4';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
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

test.describe.serial('Forge-124 · wave 4 multi-angle', () => {
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

  test('01 IFC panel opens via window hook', async () => {
    await page.evaluate(() => { window.__forgeOpenIfcExport?.(true); });
    await page.waitForTimeout(700);
    await shot(page, 'ifc-panel');
    const hooked = await page.evaluate(() => typeof window.__forgeOpenIfcExport === 'function');
    expect(hooked).toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  test('02 skeleton panel opens with default entities', async () => {
    await page.evaluate(() => { window.__forgeOpenSkeleton?.(true); });
    await page.waitForTimeout(700);
    await shot(page, 'skeleton-panel');
    const skel = await page.evaluate(() => window.__forgeSkeleton);
    expect(skel).toBeTruthy();
    expect(skel.points.ORIGIN).toBeTruthy();
  });

  test('03 convergence chart opens + receives a residual broadcast', async () => {
    await page.evaluate(() => {
      window.__forgeOpenConvergence?.(true);
      const residuals = [];
      for (let i = 0; i < 12; i++)
        residuals.push({ step: i, residual: Math.pow(10, 0 - i * 0.5) });
      window.dispatchEvent(new CustomEvent('forge:fea-residual',
        { detail: { jobId: 'wave4', label: 'Forge-122 demo', residuals } }));
    });
    await page.waitForTimeout(800);
    await shot(page, 'convergence-with-curve');
    const panel = page.locator('[data-testid="forge-convergence-panel"]');
    await expect(panel).toBeVisible({ timeout: 2000 });
  });

  test('04 close all panels + extrude a body', async () => {
    await page.evaluate(() => {
      window.__forgeOpenIfcExport?.(false);
      window.__forgeOpenSkeleton?.(false);
      window.__forgeOpenConvergence?.(false);
    });
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.click('[data-tool="solid.extrude"]', { force: true });
    await page.waitForTimeout(380);
    const confirm = page.locator('[data-testid="forge-tool-confirm"]');
    if (await confirm.count()) await confirm.click();
    await page.waitForTimeout(800);
    await shot(page, 'body-extruded');
    const feats = await page.locator('[data-testid="forge-feature-tree"] > li').count();
    expect(feats).toBeGreaterThan(0);
  });

  test('05 every named view · dark theme', async () => {
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(400);
      await shot(page, `dark-${v.name}`);
    }
  });

  test('06 every named view · light theme', async () => {
    await page.keyboard.press('Meta+t');
    await page.waitForTimeout(900);
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(400);
      await shot(page, `light-${v.name}`);
    }
    await page.keyboard.press('Meta+t');
    await page.waitForTimeout(500);
  });

  test('07 manual UI · Archie thread untouched', async () => {
    const msgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(msgs).toBe(0);
  });
});
