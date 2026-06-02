// v4-240-retwall.spec.js — Forge-240 retaining wall (Rankine + stability).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-240-retwall';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const DAS = () => ({
  totalHeightM: 6.0, embedmentDepthM: 1.0,
  baseWidthM: 4.0, toeWidthM: 1.0,
  stemThicknessM: 0.4, baseThicknessM: 0.6,
  unitWeightSoilNPerM3: 18000, frictionAngleDeg: 30,
  cohesionPa: 0, frictionCoeffBase: 0.5,
  surchargePa: 0, unitWeightConcreteNPerM3: 23600,
  allowableBearingPa: 200000,
});

test.describe.serial('Forge-240 · retaining wall (Rankine + stability)', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      document.querySelectorAll('[data-testid="forge-tour-tooltip"]').forEach((n) => n.remove());
      document.querySelectorAll('[data-testid="forge-tour-overlay"]').forEach((n) => n.remove());
    });
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.retwall
         && typeof window.forge.retwall.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Das textbook stability check (cam #1)', async () => {
    const r = await page.evaluate((inp) => window.forge.retwall.analyse(inp), DAS());
    // K_a = 1/3, K_p = 3
    expect(r.Ka).toBeCloseTo(1 / 3, 4);
    expect(r.Kp).toBeCloseTo(3.0, 4);
    expect(r.activeForceN / 1000).toBeCloseTo(108, 0);
    expect(r.passiveForceN / 1000).toBeCloseTo(27, 0);
    expect(r.weightTotalN / 1000).toBeCloseTo(394.08, 0);
    expect(r.safetyFactorOverturning).toBeCloseTo(4.35, 1);
    expect(r.safetyFactorSliding).toBeCloseTo(2.07, 1);
    expect(r.safetyFactorBearing).toBeCloseTo(1.63, 1);
    await shot(page, 'das-textbook');
  });

  test('03 K_a / K_p reciprocity (cam #2)', async () => {
    const r = await page.evaluate((inp) => window.forge.retwall.analyse(inp), DAS());
    expect(r.Ka * r.Kp).toBeCloseTo(1.0, 6);
    await shot(page, 'reciprocity');
  });

  test('04 surcharge increases overturning moment (cam #3)', async () => {
    const base = await page.evaluate((inp) => window.forge.retwall.analyse(inp), DAS());
    const surc = await page.evaluate((inp) => window.forge.retwall.analyse(inp),
      { ...DAS(), surchargePa: 10000 });
    expect(surc.overturningMomentNm).toBeGreaterThan(base.overturningMomentNm);
    expect(surc.activeForceN).toBeGreaterThan(base.activeForceN);
    await shot(page, 'surcharge');
  });

  test('05 wider base improves all three FS (cam #4)', async () => {
    const narrow = await page.evaluate((inp) => window.forge.retwall.analyse(inp), DAS());
    const wide = await page.evaluate((inp) => window.forge.retwall.analyse(inp),
      { ...DAS(), baseWidthM: 5.0 });
    expect(wide.safetyFactorOverturning).toBeGreaterThan(narrow.safetyFactorOverturning);
    expect(wide.safetyFactorSliding).toBeGreaterThan(narrow.safetyFactorSliding);
    expect(wide.safetyFactorBearing).toBeGreaterThan(narrow.safetyFactorBearing);
    await shot(page, 'wider-base');
  });

  test('06 narrow base fails overturning FS', async () => {
    const fail = await page.evaluate((inp) => window.forge.retwall.analyse(inp),
      { ...DAS(), baseWidthM: 2.0 });
    expect(fail.safetyFactorOverturning).toBeLessThan(2.0);
  });

  test('07 panel renders all three FS rows (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenRetWallWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-retwall-run"]').click();
    await page.waitForSelector('[data-testid="forge-retwall-result"]', { timeout: 5000 });
    const ot = await page.locator('[data-testid="forge-retwall-fs-ot"]').innerText();
    const sl = await page.locator('[data-testid="forge-retwall-fs-s"]').innerText();
    const br = await page.locator('[data-testid="forge-retwall-fs-b"]').innerText();
    expect(ot).toMatch(/FS overturning/);
    expect(sl).toMatch(/FS sliding/);
    expect(br).toMatch(/FS bearing/);
    await shot(page, 'panel');
  });

  test('08 menu route fires retwall workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseRetWallWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.retwall' } }));
    });
    await page.waitForSelector('[data-testid="forge-retwall-panel"]', { timeout: 2000 });
  });

  test('09 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
