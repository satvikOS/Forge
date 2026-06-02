// v4-228-pvessel.spec.js — Forge-228 pressure vessel (ASME VIII Div 1).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-228-pvessel';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-228 · pressure vessel', () => {
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
      !!(window.forge && window.forge.pvessel
         && typeof window.forge.pvessel.stress === 'function'
         && typeof window.forge.pvessel.requiredThickness === 'function'));
    expect(has).toBe(true);
  });

  test('02 cylinder σ_h = pD/2t exact (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.pvessel.stress({
      pressure: 2e6, diameter: 1.0, wallThickness: 0.01, geometry: 'cylinder',
    }));
    expect(r.hoopStress).toBeCloseTo(100e6, 0);
    expect(r.longitudinalStress).toBeCloseTo(50e6, 0);
    await shot(page, 'cyl-stress');
  });

  test('03 sphere membrane = pD/4t (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.pvessel.stress({
      pressure: 2e6, diameter: 1.0, wallThickness: 0.01, geometry: 'sphere',
    }));
    expect(r.hoopStress).toBeCloseTo(50e6, 0);
    expect(r.longitudinalStress).toBeCloseTo(0, 9);
    await shot(page, 'sphere-stress');
  });

  test('04 ASME cylinder thickness formula (cam #3)', async () => {
    const t = await page.evaluate(() => window.forge.pvessel.requiredThickness({
      pressure: 2e6, insideRadius: 0.5, allowableStress: 120e6,
      jointEfficiency: 0.85, geometry: 'cylinder',
    }));
    const expected = 2e6 * 0.5 / (120e6 * 0.85 - 0.6 * 2e6);
    expect(t).toBeCloseTo(expected, 9);
    await shot(page, 'cyl-thickness');
  });

  test('05 sphere thinner than cylinder for same conditions (cam #4)', async () => {
    const r = await page.evaluate(() => ({
      cyl:    window.forge.pvessel.requiredThickness({ pressure:2e6, insideRadius:0.5, allowableStress:120e6, jointEfficiency:0.85, geometry:'cylinder' }),
      sphere: window.forge.pvessel.requiredThickness({ pressure:2e6, insideRadius:0.5, allowableStress:120e6, jointEfficiency:0.85, geometry:'sphere' }),
    }));
    expect(r.sphere).toBeLessThan(r.cyl);
    await shot(page, 'sphere-vs-cyl');
  });

  test('06 panel compute renders σ_h + required t (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenPVesselWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-pvessel-run"]').click();
    await page.waitForSelector('[data-testid="forge-pvessel-result"]', { timeout: 5000 });
    const text = await page.locator('[data-testid="forge-pvessel-result"]').innerText();
    expect(text).toMatch(/σ_h/);
    expect(text).toMatch(/Required t/);
    await shot(page, 'panel');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
