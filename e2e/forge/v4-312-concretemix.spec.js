// v4-312-concretemix.spec.js — Forge-312 concrete mix design ACI 211.1.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-312-concretemix';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const STD = {
  targetStrengthMPa: 30, slumpMm: 100, maxAggregateSizeMm: 25,
  airContentFraction: 0.015, cementSpecificGravity: 3.15,
  sandSpecificGravity: 2.65, coarseSpecificGravity: 2.70,
  coarseDryRoddedDensity: 1600, coarseFinenessModulus: 2.6,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-312 · concrete mix', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
      timeout: 150000,
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      document.querySelectorAll('[data-testid="forge-tour-tooltip"]').forEach((n) => n.remove());
      document.querySelectorAll('[data-testid="forge-tour-overlay"]').forEach((n) => n.remove());
    });
  });
  test.afterAll(async () => {
    if (!app) return;
    try { await Promise.race([app.close(), new Promise((r) => setTimeout(r, 4000))]); }
    catch (e) { /* ignore */ }
    try { app.process()?.kill('SIGKILL'); } catch (e) { /* ignore */ }
  });

  test('01 kernel bridge wired (cam #1 baseline)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.concretemix
         && typeof window.forge.concretemix.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 f_c=30 MPa: w/c=0.685, water=179, cement=261 (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.concretemix.analyse(b), STD);
    expect(r.waterCementRatio).toBeCloseTo(0.94 - 0.0085 * 30, 5);
    expect(r.waterDemandKg).toBeCloseTo(179, 1);
    expect(r.cementMassKg).toBeCloseTo(179 / 0.685, 1);
    expect(r.coarseAggregateMassKg).toBeCloseTo(0.69 * 1600, 0);
    await shot(page, 'standard');
  });

  test('03 Volume sum = 1.000 m³ (cam #3)', async () => {
    const r = await page.evaluate((b) => window.forge.concretemix.analyse(b), STD);
    const sum = r.cementVolumeM3 + r.waterVolumeM3
              + r.coarseVolumeM3 + r.sandVolumeM3 + r.airVolumeM3;
    expect(sum).toBeCloseTo(1.0, 5);
    await shot(page, 'volume-balance');
  });

  test('04 Higher f_c → lower w/c → more cement (cam #4)', async () => {
    const r30 = await page.evaluate((b) => window.forge.concretemix.analyse(b), STD);
    const r50 = await page.evaluate((b) => window.forge.concretemix.analyse({
      ...b, targetStrengthMPa: 50,
    }), STD);
    expect(r50.waterCementRatio).toBeLessThan(r30.waterCementRatio);
    expect(r50.cementMassKg).toBeGreaterThan(r30.cementMassKg);
    await shot(page, 'high-fc');
  });

  test('05 Smaller aggregate → more water + cement (cam #5)', async () => {
    const r25 = await page.evaluate((b) => window.forge.concretemix.analyse(b), STD);
    const r10 = await page.evaluate((b) => window.forge.concretemix.analyse({
      ...b, maxAggregateSizeMm: 10,
    }), STD);
    expect(r10.waterDemandKg).toBeGreaterThan(r25.waterDemandKg);
    expect(r10.cementMassKg).toBeGreaterThan(r25.cementMassKg);
    expect(r10.coarseAggregateMassKg).toBeLessThan(r25.coarseAggregateMassKg);
    await shot(page, 'small-agg');
  });

  test('06 Fresh unit weight 2300-2450 kg/m³ for normal-weight (cam #6)', async () => {
    const r = await page.evaluate((b) => window.forge.concretemix.analyse(b), STD);
    expect(r.freshUnitWeightKgPerM3).toBeGreaterThan(2300);
    expect(r.freshUnitWeightKgPerM3).toBeLessThan(2450);
    await shot(page, 'unit-wt');
  });

  test('07 Panel renders w/c + unit weight rows', async () => {
    await page.evaluate(() => { window.__forgeOpenConcreteMixWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-cm-run"]').click();
    await page.waitForSelector('[data-testid="forge-cm-result"]', { timeout: 5000 });
    const wc = await page.locator('[data-testid="forge-cm-wc"]').innerText();
    const uw = await page.locator('[data-testid="forge-cm-unit"]').innerText();
    expect(wc).toMatch(/w\/c/);
    expect(uw).toMatch(/Fresh unit/);
  });

  test('08 Menu route opens mix panel', async () => {
    await page.evaluate(() => { window.__forgeCloseConcreteMixWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.concretemix' } }));
    });
    await page.waitForSelector('[data-testid="forge-cm-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
