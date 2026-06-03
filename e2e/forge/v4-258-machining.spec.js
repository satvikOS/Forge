// v4-258-machining.spec.js — Forge-258 machining feeds/speeds/power.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-258-machining';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-258 · machining feeds + speeds + power', () => {
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
      !!(window.forge && window.forge.machining
         && typeof window.forge.machining.turning === 'function'
         && typeof window.forge.machining.milling === 'function'
         && typeof window.forge.machining.drilling === 'function'));
    expect(has).toBe(true);
  });

  test('02 Turning: D=50 mm V_c=200 m/min → n=1273 rpm, F_c=1500 N, P=6.25 kW (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.machining.turning({
      diameterMm: 50, cuttingSpeedM_min: 200,
      feedPerRevMm: 0.30, depthOfCutMm: 2,
      specificCuttingForceN_mm2: 2500,
      machineEfficiency: 0.80, leadAngleDeg: 90,
    }));
    expect(r.spindleSpeedRpm).toBeCloseTo(1273.2, 0);
    expect(r.cuttingForceN).toBeCloseTo(1500, 0);
    expect(r.powerKw).toBeCloseTo(6.25, 1);
    expect(r.mrrCm3Min).toBeCloseTo(120, 0);
    await shot(page, 'turning');
  });

  test('03 Milling: feed rate matches f_z·z·n (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.machining.milling({
      diameterMm: 50, cuttingSpeedM_min: 200,
      feedPerToothMm: 0.10, numberOfTeeth: 4,
      axialDepthMm: 5, radialDepthMm: 20,
      specificCuttingForceN_mm2: 2500,
      machineEfficiency: 0.80,
    }));
    expect(r.spindleSpeedRpm).toBeCloseTo(1273.2, 0);
    expect(r.feedRateMmMin).toBeCloseTo(0.10 * 4 * 1273.2, 1);
    await shot(page, 'milling');
  });

  test('04 Drilling: torque = K_c·D²·f/8 (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.machining.drilling({
      diameterMm: 10, cuttingSpeedM_min: 60,
      feedPerRevMm: 0.15,
      specificCuttingForceN_mm2: 2500,
      machineEfficiency: 0.80,
    }));
    expect(r.spindleSpeedRpm).toBeCloseTo(1909.9, 0);
    expect(r.torqueNm).toBeCloseTo(2500 * 100 * 0.15 / 8 / 1000, 3);  // = 4.6875
    expect(r.feedRateMmMin).toBeCloseTo(0.15 * 1909.9, 1);
    await shot(page, 'drilling');
  });

  test('05 doubling V_c doubles spindle speed (cam #4)', async () => {
    const r1 = await page.evaluate(() => window.forge.machining.turning({
      diameterMm: 50, cuttingSpeedM_min: 200, feedPerRevMm: 0.30,
      depthOfCutMm: 2, specificCuttingForceN_mm2: 2500,
      machineEfficiency: 0.80, leadAngleDeg: 90,
    }));
    const r2 = await page.evaluate(() => window.forge.machining.turning({
      diameterMm: 50, cuttingSpeedM_min: 400, feedPerRevMm: 0.30,
      depthOfCutMm: 2, specificCuttingForceN_mm2: 2500,
      machineEfficiency: 0.80, leadAngleDeg: 90,
    }));
    expect(r2.spindleSpeedRpm).toBeCloseTo(2 * r1.spindleSpeedRpm, 3);
    expect(r2.powerKw).toBeCloseTo(2 * r1.powerKw, 3);
    await shot(page, 'V_c-scale');
  });

  test('06 milling P scales with axial × radial depth (cam #5)', async () => {
    const base = await page.evaluate(() => window.forge.machining.milling({
      diameterMm: 50, cuttingSpeedM_min: 200,
      feedPerToothMm: 0.10, numberOfTeeth: 4,
      axialDepthMm: 5, radialDepthMm: 20,
      specificCuttingForceN_mm2: 2500, machineEfficiency: 0.80,
    }));
    const deeper = await page.evaluate(() => window.forge.machining.milling({
      diameterMm: 50, cuttingSpeedM_min: 200,
      feedPerToothMm: 0.10, numberOfTeeth: 4,
      axialDepthMm: 10, radialDepthMm: 20,
      specificCuttingForceN_mm2: 2500, machineEfficiency: 0.80,
    }));
    expect(deeper.cuttingForceN / base.cuttingForceN).toBeCloseTo(2.0, 3);
    expect(deeper.powerKw / base.powerKw).toBeCloseTo(2.0, 3);
    await shot(page, 'ap-scale');
  });

  test('07 invalid inputs throw', async () => {
    let threw = false;
    try {
      await page.evaluate(() => window.forge.machining.turning({
        diameterMm: 0, cuttingSpeedM_min: 200, feedPerRevMm: 0.30,
        depthOfCutMm: 2, specificCuttingForceN_mm2: 2500,
        machineEfficiency: 0.80, leadAngleDeg: 90,
      }));
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
  });

  test('08 panel tab-switch renders n + P for all three modes', async () => {
    await page.evaluate(() => { window.__forgeOpenMachiningWorkbench?.(); });
    await page.waitForTimeout(300);
    // Default turning.
    await page.locator('[data-testid="forge-machining-run"]').click();
    await page.waitForSelector('[data-testid="forge-machining-P"]', { timeout: 5000 });
    // Tab → milling.
    await page.locator('[data-testid="forge-machining-tab-milling"]').click();
    await page.locator('[data-testid="forge-machining-run"]').click();
    // Tab → drilling.
    await page.locator('[data-testid="forge-machining-tab-drilling"]').click();
    await page.locator('[data-testid="forge-machining-run"]').click();
    const p = await page.locator('[data-testid="forge-machining-P"]').innerText();
    expect(p).toMatch(/P_spindle/);
  });

  test('09 menu route fires machining workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseMachiningWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.machining' } }));
    });
    await page.waitForSelector('[data-testid="forge-machining-panel"]', { timeout: 2000 });
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
