// v4-279-dcmotor.spec.js — Forge-279 DC shunt motor analysis.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-279-dcmotor';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const CHAPMAN = {
  supplyVoltageV: 250, armatureResistanceOhms: 0.2,
  motorConstantVPerRadS: 2.0, loadTorqueNm: 50, fieldResistanceOhms: 250,
};

test.describe.serial('Forge-279 · DC shunt motor', () => {
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

  test('01 kernel bridge wired (cam #1 baseline)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.dcmotor
         && typeof window.forge.dcmotor.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Chapman 250 V / 0.2 Ω / K=2 / T_L=50 → η=98% (cam #2)', async () => {
    const r = await page.evaluate((c) => window.forge.dcmotor.analyse(c), CHAPMAN);
    expect(r.armatureCurrentA).toBeCloseTo(25, 6);
    expect(r.backEmfV).toBeCloseTo(245, 6);
    expect(r.angularSpeedRadS).toBeCloseTo(122.5, 6);
    expect(r.speedRpm).toBeCloseTo(122.5 * 60 / (2 * Math.PI), 4);
    expect(r.stallTorqueNm).toBeCloseTo(2500, 6);
    expect(r.mechanicalPowerW).toBeCloseTo(6125, 6);
    expect(r.armatureEfficiency).toBeCloseTo(0.98, 6);
    expect(r.fieldCurrentA).toBeCloseTo(1.0, 9);
    await shot(page, 'reference');
  });

  test('03 Heavier load: slower + lower η (cam #3)', async () => {
    const light = await page.evaluate((c) => window.forge.dcmotor.analyse(c), CHAPMAN);
    const heavy = await page.evaluate((c) => window.forge.dcmotor.analyse({
      ...c, loadTorqueNm: 200,
    }), CHAPMAN);
    expect(heavy.armatureCurrentA).toBeCloseTo(100, 6);
    expect(heavy.speedRpm).toBeLessThan(light.speedRpm);
    expect(heavy.armatureEfficiency).toBeLessThan(light.armatureEfficiency);
    await shot(page, 'heavy');
  });

  test('04 No-load T_L=0 → n = n_0 exactly (cam #4)', async () => {
    const r = await page.evaluate((c) => window.forge.dcmotor.analyse({
      ...c, loadTorqueNm: 0,
    }), CHAPMAN);
    expect(r.armatureCurrentA).toBeCloseTo(0, 9);
    expect(r.speedRpm).toBeCloseTo(r.noLoadSpeedRpm, 4);
    await shot(page, 'no-load');
  });

  test('05 Field weakening raises speed + I_a (cam #5)', async () => {
    const normal = await page.evaluate((c) => window.forge.dcmotor.analyse(c), CHAPMAN);
    const weak   = await page.evaluate((c) => window.forge.dcmotor.analyse({
      ...c, motorConstantVPerRadS: 1.5,
    }), CHAPMAN);
    expect(weak.speedRpm).toBeGreaterThan(normal.speedRpm);
    expect(weak.armatureCurrentA).toBeGreaterThan(normal.armatureCurrentA);
    await shot(page, 'field-weak');
  });

  test('06 Load > stall torque throws (cam #6)', async () => {
    let threw = false;
    try {
      await page.evaluate((c) => window.forge.dcmotor.analyse({
        ...c, loadTorqueNm: 3000,
      }), CHAPMAN);
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'overload');
  });

  test('07 Panel renders n + η rows', async () => {
    await page.evaluate(() => { window.__forgeOpenDcMotorWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-dcmotor-run"]').click();
    await page.waitForSelector('[data-testid="forge-dcmotor-result"]', { timeout: 5000 });
    const rpm = await page.locator('[data-testid="forge-dcmotor-rpm"]').innerText();
    const eta = await page.locator('[data-testid="forge-dcmotor-eta"]').innerText();
    expect(rpm).toMatch(/n =/);
    expect(eta).toMatch(/η_armature/);
  });

  test('08 Menu route opens DC motor panel', async () => {
    await page.evaluate(() => { window.__forgeCloseDcMotorWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.dcmotor' } }));
    });
    await page.waitForSelector('[data-testid="forge-dcmotor-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
