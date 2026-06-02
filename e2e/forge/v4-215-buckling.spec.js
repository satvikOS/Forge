// v4-215-buckling.spec.js — Forge-215 Euler buckling analysis.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-215-buckling';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-215 · column buckling', () => {
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
      !!(window.forge && window.forge.buckling
         && typeof window.forge.buckling.sectionSolidCircle === 'function'
         && typeof window.forge.buckling.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 solid circle section formulas (cam #1)', async () => {
    const s = await page.evaluate(() => window.forge.buckling.sectionSolidCircle(0.020));
    expect(s.area).toBeCloseTo(Math.PI * 0.020 * 0.020 / 4, 12);
    expect(s.secondMomentI).toBeCloseTo(Math.PI * Math.pow(0.020, 4) / 64, 15);
    await shot(page, 'section');
  });

  test('03 long pinned column → Euler regime, P_cr matches (cam #2)', async () => {
    const r = await page.evaluate(() => {
      const s = window.forge.buckling.sectionSolidCircle(0.020);
      return window.forge.buckling.analyse({
        area: s.area, secondMomentI: s.secondMomentI, length: 2.0,
        youngsModulus: 2e11, yieldStrength: 250e6, ends: 'pinned-pinned',
      });
    });
    expect(r.mode).toBe('euler');
    const I = Math.PI * Math.pow(0.020, 4) / 64;
    expect(r.criticalLoad).toBeCloseTo(Math.PI * Math.PI * 2e11 * I / 4, 1);
    await shot(page, 'euler');
  });

  test('04 short column triggers Johnson (cam #3)', async () => {
    const r = await page.evaluate(() => {
      const s = window.forge.buckling.sectionSolidCircle(0.020);
      return window.forge.buckling.analyse({
        area: s.area, secondMomentI: s.secondMomentI, length: 0.05,
        youngsModulus: 2e11, yieldStrength: 250e6, ends: 'pinned-pinned',
      });
    });
    expect(r.mode).toBe('johnson');
    expect(r.criticalLoad).toBeGreaterThan(50000);
    await shot(page, 'johnson');
  });

  test('05 fixed-fixed gives 4× pinned-pinned (cam #4)', async () => {
    const r = await page.evaluate(() => {
      const s = window.forge.buckling.sectionSolidCircle(0.020);
      const pin = window.forge.buckling.analyse({
        area: s.area, secondMomentI: s.secondMomentI, length: 2.0,
        youngsModulus: 2e11, yieldStrength: 250e6, ends: 'pinned-pinned',
      });
      const fix = window.forge.buckling.analyse({
        area: s.area, secondMomentI: s.secondMomentI, length: 2.0,
        youngsModulus: 2e11, yieldStrength: 250e6, ends: 'fixed-fixed',
      });
      return { ratio: fix.criticalLoad / pin.criticalLoad };
    });
    expect(r.ratio).toBeCloseTo(4, 3);
    await shot(page, 'fixed-fixed');
  });

  test('06 panel open + analyse (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenBucklingWorkbench?.(); });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-buckling-panel"]')).toBeVisible();
    await page.locator('[data-testid="forge-buckling-run"]').click();
    await page.waitForSelector('[data-testid="forge-buckling-result"]', { timeout: 5000 });
    const mode = await page.locator('[data-testid="forge-buckling-mode"]').innerText();
    expect(mode).toMatch(/EULER|JOHNSON/);
    await shot(page, 'panel-result');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
