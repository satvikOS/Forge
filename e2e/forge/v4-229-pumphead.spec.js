// v4-229-pumphead.spec.js — Forge-229 Pump head / pipe flow.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-229-pumphead';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-229 · pump head', () => {
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
      !!(window.forge && window.forge.pumphead
         && typeof window.forge.pumphead.reynoldsNumber === 'function'
         && typeof window.forge.pumphead.frictionFactor === 'function'
         && typeof window.forge.pumphead.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Re = ρVD/μ closed form (cam #1)', async () => {
    const Re = await page.evaluate(() =>
      window.forge.pumphead.reynoldsNumber(2.0, 0.05, 1000, 1e-3));
    expect(Re).toBeCloseTo(1000 * 2 * 0.05 / 1e-3, 9);
    await shot(page, 'reynolds');
  });

  test('03 laminar uses 64/Re (cam #2)', async () => {
    const r = await page.evaluate(() => {
      const Re = 1000;
      return { f: window.forge.pumphead.frictionFactor(Re, 0.05, 1e-5), Re };
    });
    expect(r.f).toBeCloseTo(64 / r.Re, 9);
    await shot(page, 'laminar');
  });

  test('04 turbulent friction is below 0.05 for typical commercial steel (cam #3)', async () => {
    const f = await page.evaluate(() =>
      window.forge.pumphead.frictionFactor(2.5e5, 0.05, 4.6e-5));
    expect(f).toBeGreaterThan(0.015);
    expect(f).toBeLessThan(0.05);
    await shot(page, 'turbulent');
  });

  test('05 analyse: 10 L/s through 50 mm pipe (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.pumphead.analyse({
      flowRate: 0.010, diameter: 0.050, pipeLength: 100,
      roughness: 4.6e-5, density: 998, dynamicViscosity: 1.0e-3,
      staticHead: 0, pumpEfficiency: 0.7,
    }));
    expect(r.meanVelocity).toBeCloseTo(0.010 / (Math.PI * 0.025 * 0.025), 6);
    expect(r.reynolds).toBeGreaterThan(2e5);
    expect(r.frictionHead).toBeGreaterThan(40);
    expect(r.shaftPower).toBeGreaterThan(5000);
    await shot(page, 'analyse');
  });

  test('06 panel compute renders shaft power (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenPumpHeadWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-pumphead-run"]').click();
    await page.waitForSelector('[data-testid="forge-pumphead-result"]', { timeout: 5000 });
    const text = await page.locator('[data-testid="forge-pumphead-power"]').innerText();
    expect(text).toMatch(/Shaft P/);
    expect(text).toMatch(/kW/);
    await shot(page, 'panel');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
