// v4-301-wirerope.spec.js — Forge-301 wire rope FOS + bending fatigue.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-301-wirerope';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const HOIST = {
  ropeClass: '6x19', applicationClass: 'hoist',
  nominalDiameterMm: 19, workingLoadN: 30000,
  sheaveDiameterMm: 646, accelerationG: 1.0,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-301 · wire rope', () => {
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
      !!(window.forge && window.forge.wirerope
         && typeof window.forge.wirerope.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 6×19 IPS d=19 → F_u=238 kN, σ_b=22 MPa, FOS pass (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.wirerope.analyse(b), HOIST);
    expect(r.breakingStrengthN).toBeCloseTo(660 * 19 * 19, 3);
    expect(r.outerWireDiameterMm).toBeCloseTo(19 / 16, 6);
    expect(r.bendingStressMPa).toBeGreaterThan(22.0);
    expect(r.bendingStressMPa).toBeLessThan(22.1);
    expect(r.factorOfSafetyTotal).toBeGreaterThan(7.0);
    expect(r.sheaveRatio).toBeCloseTo(34, 5);
    expect(r.passes).toBe(true);
    await shot(page, 'hoist-pass');
  });

  test('03 Smaller sheave (D=400) fails D/d criterion (cam #3)', async () => {
    const r = await page.evaluate((b) => window.forge.wirerope.analyse({
      ...b, sheaveDiameterMm: 400,
    }), HOIST);
    expect(r.sheaveRatio).toBeLessThan(34);
    expect(r.sheavePasses).toBe(false);
    expect(r.passes).toBe(false);
    expect(r.bendingStressMPa).toBeGreaterThan(22.06);  // worse fatigue
    await shot(page, 'small-sheave');
  });

  test('04 Elevator FOS req 11 fails same loading (cam #4)', async () => {
    const r = await page.evaluate((b) => window.forge.wirerope.analyse({
      ...b, applicationClass: 'elevator',
    }), HOIST);
    expect(r.recommendedFOS).toBe(11);
    expect(r.factorOfSafetyTotal).toBeLessThan(11);
    expect(r.strengthPasses).toBe(false);
    await shot(page, 'elevator-fail');
  });

  test('05 1.5 g acceleration: FOS_dyn = FOS_static/1.5 (cam #5)', async () => {
    const r0 = await page.evaluate((b) => window.forge.wirerope.analyse(b), HOIST);
    const r1 = await page.evaluate((b) => window.forge.wirerope.analyse({
      ...b, accelerationG: 1.5,
    }), HOIST);
    expect(r1.factorOfSafetyDynamic).toBeCloseTo(r0.factorOfSafetyStatic / 1.5, 4);
    expect(r1.factorOfSafetyTotal).toBeLessThan(r0.factorOfSafetyTotal);
    await shot(page, 'accel');
  });

  test('06 6×37: lower K + finer wires (cam #6)', async () => {
    const r = await page.evaluate(() => window.forge.wirerope.analyse({
      ropeClass: '6x37', applicationClass: 'hoist',
      nominalDiameterMm: 19, workingLoadN: 30000,
      sheaveDiameterMm: 437, accelerationG: 1.0,
    }));
    expect(r.breakingStrengthN).toBeCloseTo(600 * 19 * 19, 3);
    expect(r.outerWireDiameterMm).toBeCloseTo(19 / 22, 6);
    expect(r.recommendedMinSheaveRatio).toBe(23);
    expect(r.sheaveRatio).toBeCloseTo(23, 4);
    expect(r.bendingStressMPa).toBeLessThan(22.06);  // finer wires → lower σ_b
    await shot(page, '6x37');
  });

  test('07 Panel renders FOS + D/d + pass banner', async () => {
    await page.evaluate(() => { window.__forgeOpenWireRopeWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-wirerope-run"]').click();
    await page.waitForSelector('[data-testid="forge-wirerope-result"]', { timeout: 5000 });
    const FOS  = await page.locator('[data-testid="forge-wirerope-FOS"]').innerText();
    const Dd   = await page.locator('[data-testid="forge-wirerope-Dd"]').innerText();
    const pass = await page.locator('[data-testid="forge-wirerope-pass"]').innerText();
    expect(FOS).toMatch(/FOS/);
    expect(Dd).toMatch(/D\/d/);
    expect(pass).toMatch(/Rope sized OK|Resize required/);
  });

  test('08 Menu route opens wire-rope panel', async () => {
    await page.evaluate(() => { window.__forgeCloseWireRopeWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.wirerope' } }));
    });
    await page.waitForSelector('[data-testid="forge-wirerope-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
