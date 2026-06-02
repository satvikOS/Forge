// v4-214-boltjoint.spec.js — Forge-214 bolt joint calculator.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-214-boltjoint';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-214 · bolt joint', () => {
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

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.boltjoint
         && typeof window.forge.boltjoint.computePreload === 'function'
         && typeof window.forge.boltjoint.jointStiffness === 'function'
         && typeof window.forge.boltjoint.check === 'function'
         && typeof window.forge.boltjoint.metricBolt === 'function'));
    expect(has).toBe(true);
  });

  test('02 preload M10 @ 50 N·m = 25 kN (cam #1)', async () => {
    const fi = await page.evaluate(() => window.forge.boltjoint.computePreload({
      torque: 50, nutFactor: 0.2, diameter: 0.010,
    }));
    expect(fi).toBeCloseTo(25000, 6);
    await shot(page, 'preload');
  });

  test('03 metric bolt lookup matches ISO 898 (cam #2)', async () => {
    const m = await page.evaluate(() => window.forge.boltjoint.metricBolt('M10'));
    expect(m.diameter).toBeCloseTo(0.010, 9);
    expect(m.tensileArea).toBeCloseTo(57.99e-6, 9);
    expect(m.proofStrengthClass88).toBeCloseTo(580e6, -3);
    await shot(page, 'metric-bolt');
  });

  test('04 joint stiffness ratio matches textbook (cam #3)', async () => {
    const s = await page.evaluate(() => window.forge.boltjoint.jointStiffness({
      boltE: 200e9, boltAt: 58e-6, gripLength: 0.025,
      memberE: 200e9, memberArea: 200e-6,
    }));
    expect(s.loadFactor).toBeCloseTo(58 / (58 + 200), 3);
    await shot(page, 'stiffness');
  });

  test('05 MS > 0 for the textbook case (cam #4)', async () => {
    const c = await page.evaluate(() => window.forge.boltjoint.check({
      preload: 25000, externalLoad: 5000, loadFactor: 0.225,
      tensileArea: 58e-6, proofStrength: 580e6,
    }));
    expect(c.adequate).toBe(true);
    expect(c.marginOfSafety).toBeGreaterThan(0);
    await shot(page, 'mos-pos');
  });

  test('06 panel open + compute (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenBoltJointWorkbench?.(); });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-boltjoint-panel"]')).toBeVisible();
    await page.locator('[data-testid="forge-boltjoint-run"]').click();
    await page.waitForSelector('[data-testid="forge-boltjoint-result"]', { timeout: 5000 });
    const status = await page.locator('[data-testid="forge-boltjoint-status"]').innerText();
    expect(status).toMatch(/ADEQUATE/);
    await shot(page, 'panel-result');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
