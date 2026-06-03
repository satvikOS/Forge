// v4-253-lighting.spec.js — Forge-253 lighting design (IES lumen method).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-253-lighting';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-253 · lighting design IES lumen method', () => {
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
      !!(window.forge && window.forge.lighting
         && typeof window.forge.lighting.roomCavityRatio === 'function'
         && typeof window.forge.lighting.coefficientOfUtilization === 'function'
         && typeof window.forge.lighting.lumenMethod === 'function'));
    expect(has).toBe(true);
  });

  test('02 RCR closed form (cam #1)', async () => {
    const rcr = await page.evaluate(() => window.forge.lighting.roomCavityRatio({
      lengthM: 10, widthM: 8, mountingHeightM: 1.83,
    }));
    // 5·1.83·(18)/80 = 2.0588
    expect(rcr).toBeCloseTo(2.0588, 3);
    await shot(page, 'RCR');
  });

  test('03 CU approximation (cam #2)', async () => {
    const cu = await page.evaluate(() => window.forge.lighting.coefficientOfUtilization(2.0588));
    expect(cu).toBeCloseTo(0.7637, 3);
    // Clamping for RCR > 10:
    const high = await page.evaluate(() => window.forge.lighting.coefficientOfUtilization(20));
    expect(high).toBeGreaterThanOrEqual(0.05);
    await shot(page, 'CU');
  });

  test('04 solve N: office requires 19 luminaires (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.lighting.lumenMethod({
      room: { lengthM: 10, widthM: 8, mountingHeightM: 1.83 },
      lumensPerLuminaire: 3500, luminaireCount: 0,
      targetIlluminanceLux: 500, cuOverride: 0, lightLossFactor: 0.80,
    }));
    expect(r.requiredLuminaires).toBe(19);
    expect(r.illuminanceLux).toBeGreaterThan(500);
    expect(r.computedTotalLumens).toBeCloseTo(19 * 3500, 6);
    await shot(page, 'solveN');
  });

  test('05 forward E recovers ~506 lux at N=19 (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.lighting.lumenMethod({
      room: { lengthM: 10, widthM: 8, mountingHeightM: 1.83 },
      lumensPerLuminaire: 3500, luminaireCount: 19,
      targetIlluminanceLux: 0, cuOverride: 0, lightLossFactor: 0.80,
    }));
    expect(r.illuminanceLux).toBeCloseTo(508, 0);
    await shot(page, 'forward-E');
  });

  test('06 CU override is honoured (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.lighting.lumenMethod({
      room: { lengthM: 10, widthM: 8, mountingHeightM: 1.83 },
      lumensPerLuminaire: 3500, luminaireCount: 19,
      targetIlluminanceLux: 0, cuOverride: 0.65, lightLossFactor: 0.80,
    }));
    expect(r.cu).toBeCloseTo(0.65, 6);
    await shot(page, 'CU-override');
  });

  test('07 doubling room area roughly halves illuminance (loose)', async () => {
    const small = await page.evaluate(() => window.forge.lighting.lumenMethod({
      room: { lengthM: 5, widthM: 4, mountingHeightM: 1.83 },
      lumensPerLuminaire: 3500, luminaireCount: 10,
      targetIlluminanceLux: 0, cuOverride: 0.75, lightLossFactor: 0.80,
    }));
    const big = await page.evaluate(() => window.forge.lighting.lumenMethod({
      room: { lengthM: 10, widthM: 4, mountingHeightM: 1.83 },
      lumensPerLuminaire: 3500, luminaireCount: 10,
      targetIlluminanceLux: 0, cuOverride: 0.75, lightLossFactor: 0.80,
    }));
    // Same CU override, double the area → half the E.
    expect(big.illuminanceLux / small.illuminanceLux).toBeCloseTo(0.5, 2);
  });

  test('08 panel renders N + E rows', async () => {
    await page.evaluate(() => { window.__forgeOpenLightingWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-lighting-run"]').click();
    await page.waitForSelector('[data-testid="forge-lighting-result"]', { timeout: 5000 });
    const n = await page.locator('[data-testid="forge-lighting-N-out"]').innerText();
    const e = await page.locator('[data-testid="forge-lighting-E"]').innerText();
    expect(n).toMatch(/luminaires/);
    expect(e).toMatch(/lux/);
  });

  test('09 menu route fires lighting workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseLightingWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.lighting' } }));
    });
    await page.waitForSelector('[data-testid="forge-lighting-panel"]', { timeout: 2000 });
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
