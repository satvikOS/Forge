// v4-221-gearpair.spec.js — Forge-221 spur gear pair (Lewis + Hertz).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-221-gearpair';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-221 · spur gear pair', () => {
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
      !!(window.forge && window.forge.gearpair
         && typeof window.forge.gearpair.lewisFormFactor === 'function'
         && typeof window.forge.gearpair.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Lewis form factor monotone in N (cam #1)', async () => {
    const r = await page.evaluate(() => ({
      n17: window.forge.gearpair.lewisFormFactor(17),
      n50: window.forge.gearpair.lewisFormFactor(50),
      n100: window.forge.gearpair.lewisFormFactor(100),
    }));
    expect(r.n50).toBeGreaterThan(r.n17);
    expect(r.n100).toBeGreaterThan(r.n50);
    expect(r.n17).toBeCloseTo(0.484 - 0.2745 / Math.sqrt(17), 12);
    await shot(page, 'lewis-Y');
  });

  test('03 geometry: m=2,N₁=20,N₂=60 → d₁=40,d₂=120,C=80 (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.gearpair.analyse({
      module: 2, teeth1: 20, teeth2: 60, faceWidth: 25, torque1: 200000,
      pressureAngleDeg: 20,
      materialE1: 200e9, materialE2: 200e9,
      materialNu1: 0.3, materialNu2: 0.3,
    }));
    expect(r.pitchDiameter1).toBeCloseTo(40, 12);
    expect(r.pitchDiameter2).toBeCloseTo(120, 12);
    expect(r.centreDistance).toBeCloseTo(80, 12);
    expect(r.gearRatio).toBeCloseTo(3, 12);
    expect(r.tangentialLoadN).toBeCloseTo(10000, 12);
    await shot(page, 'geometry');
  });

  test('04 Lewis bending stress matches W_t/(b·m·Y) (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.gearpair.analyse({
      module: 2, teeth1: 20, teeth2: 60, faceWidth: 25, torque1: 200000,
      pressureAngleDeg: 20,
      materialE1: 200e9, materialE2: 200e9,
      materialNu1: 0.3, materialNu2: 0.3,
    }));
    const Y1 = 0.484 - 0.2745 / Math.sqrt(20);
    const expected = 10000 / (25 * 2 * Y1) * 1e6;
    expect(r.bendingStressLewis1).toBeCloseTo(expected, 1);
    await shot(page, 'lewis-bending');
  });

  test('05 AGMA factor multiplies the baseline (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.gearpair.analyse({
      module: 2, teeth1: 20, teeth2: 60, faceWidth: 25, torque1: 200000,
      pressureAngleDeg: 20,
      materialE1: 200e9, materialE2: 200e9,
      materialNu1: 0.3, materialNu2: 0.3,
      KO: 1.5, KV: 1.2,
    }));
    expect(r.bendingStressAGMA1 / r.bendingStressLewis1).toBeCloseTo(1.8, 9);
    await shot(page, 'agma');
  });

  test('06 panel analyse renders result card (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenGearPairWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-gearpair-run"]').click();
    await page.waitForSelector('[data-testid="forge-gearpair-result"]', { timeout: 5000 });
    const text = await page.locator('[data-testid="forge-gearpair-result"]').innerText();
    expect(text).toMatch(/σ_b,Lewis/);
    expect(text).toMatch(/σ_H Hertz/);
    await shot(page, 'panel-result');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
