// v4-220-mohr.spec.js — Forge-220 Mohr's circle.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-220-mohr';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-220 · Mohr\'s circle', () => {
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
      !!(window.forge && window.forge.mohr
         && typeof window.forge.mohr.principal2D === 'function'
         && typeof window.forge.mohr.stressAtAngle === 'function'
         && typeof window.forge.mohr.principal3D === 'function'));
    expect(has).toBe(true);
  });

  test('02 pure tension: σ_1=σ_x, σ_2=0, τ=σ/2 (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.mohr.principal2D({ sx: 100, sy: 0, txy: 0 }));
    expect(r.sigma1).toBeCloseTo(100, 12);
    expect(r.sigma2).toBeCloseTo(0, 12);
    expect(r.tauMax).toBeCloseTo(50, 12);
    expect(r.thetaPRad).toBeCloseTo(0, 12);
    await shot(page, 'tension');
  });

  test('03 pure shear: σ_1=τ, σ_2=-τ, θ_p=π/4 (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.mohr.principal2D({ sx: 0, sy: 0, txy: 50 }));
    expect(r.sigma1).toBeCloseTo(50, 12);
    expect(r.sigma2).toBeCloseTo(-50, 12);
    expect(r.thetaPRad).toBeCloseTo(Math.PI / 4, 12);
    await shot(page, 'shear');
  });

  test('04 stress at principal angle has zero shear (cam #3)', async () => {
    const r = await page.evaluate(() => {
      const s = { sx: 80, sy: 20, txy: 30 };
      const p = window.forge.mohr.principal2D(s);
      return window.forge.mohr.stressAtAngle(s, p.thetaPRad);
    });
    expect(Math.abs(r.tau)).toBeLessThan(1e-9);
    expect(r.sigma).toBeCloseTo(50 + Math.sqrt(900 + 900), 9);
    await shot(page, 'theta-p');
  });

  test('05 3D uniaxial recovers σ_1=100 (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.mohr.principal3D({
      sx: 100, sy: 0, sz: 0, txy: 0, tyz: 0, tzx: 0,
    }));
    expect(r.sigma1).toBeCloseTo(100, 9);
    expect(r.sigma3).toBeCloseTo(0, 9);
    await shot(page, '3d');
  });

  test('06 panel compute renders Mohr SVG (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenMohrWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-mohr-run"]').click();
    await page.waitForSelector('[data-testid="forge-mohr-result"]', { timeout: 5000 });
    const circles = await page.locator('[data-testid="forge-mohr-panel"] svg circle').count();
    expect(circles).toBeGreaterThanOrEqual(5);  // Mohr + 4 dots
    await shot(page, 'panel-svg');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
