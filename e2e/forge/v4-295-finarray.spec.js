// v4-295-finarray.spec.js — Forge-295 heat sink fin array.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-295-finarray';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const INCROPERA = {
  baseWidthMm: 60, baseLengthMm: 100,
  finCount: 10, finThicknessMm: 1, finLengthMm: 20,
  materialConductivityWmK: 200, convectionCoefficientWm2K: 100,
  baseTemperatureC: 80, ambientTemperatureC: 20,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-295 · heat sink fin array', () => {
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
      !!(window.forge && window.forge.finarray
         && typeof window.forge.finarray.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Incropera Ex. 3.10: η_f≈0.88, Q≈162 W (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.finarray.analyse(b), INCROPERA);
    expect(r.finParameterPerM).toBeCloseTo(Math.sqrt(1000), 4);
    expect(r.correctedLengthMm).toBeCloseTo(20.5, 6);
    expect(r.singleFinEfficiency).toBeGreaterThan(0.86);
    expect(r.singleFinEfficiency).toBeLessThan(0.90);
    expect(r.overallSurfaceEfficiency).toBeGreaterThan(0.88);
    expect(r.heatDissipatedW).toBeGreaterThan(150);
    expect(r.heatDissipatedW).toBeLessThan(175);
    await shot(page, 'incropera');
  });

  test('03 More fins → more Q (cam #3)', async () => {
    const lo = await page.evaluate((b) => window.forge.finarray.analyse(b), INCROPERA);
    const hi = await page.evaluate((b) => window.forge.finarray.analyse({
      ...b, finCount: 20,
    }), INCROPERA);
    expect(hi.heatDissipatedW).toBeGreaterThan(lo.heatDissipatedW);
    expect(hi.totalFinAreaMm2).toBeGreaterThan(lo.totalFinAreaMm2);
    await shot(page, 'more-fins');
  });

  test('04 Taller fin: η_f drops, Q still rises (cam #4)', async () => {
    const lo = await page.evaluate((b) => window.forge.finarray.analyse(b), INCROPERA);
    const hi = await page.evaluate((b) => window.forge.finarray.analyse({
      ...b, finLengthMm: 50,
    }), INCROPERA);
    expect(hi.singleFinEfficiency).toBeLessThan(lo.singleFinEfficiency);
    expect(hi.heatDissipatedW).toBeGreaterThan(lo.heatDissipatedW);
    await shot(page, 'taller');
  });

  test('05 Higher k → higher η_f (cam #5)', async () => {
    const al = await page.evaluate((b) => window.forge.finarray.analyse(b), INCROPERA);
    const cu = await page.evaluate((b) => window.forge.finarray.analyse({
      ...b, materialConductivityWmK: 400,
    }), INCROPERA);
    expect(cu.singleFinEfficiency).toBeGreaterThan(al.singleFinEfficiency);
    await shot(page, 'copper');
  });

  test('06 Higher h: more Q, lower η_f (cam #6)', async () => {
    const lo = await page.evaluate((b) => window.forge.finarray.analyse(b), INCROPERA);
    const hi = await page.evaluate((b) => window.forge.finarray.analyse({
      ...b, convectionCoefficientWm2K: 200,
    }), INCROPERA);
    expect(hi.heatDissipatedW).toBeGreaterThan(lo.heatDissipatedW);
    expect(hi.singleFinEfficiency).toBeLessThan(lo.singleFinEfficiency);
    await shot(page, 'forced-air');
  });

  test('07 Panel renders Q row', async () => {
    await page.evaluate(() => { window.__forgeOpenFinArrayWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-finarray-run"]').click();
    await page.waitForSelector('[data-testid="forge-finarray-result"]', { timeout: 5000 });
    const Q = await page.locator('[data-testid="forge-finarray-Q"]').innerText();
    const eo = await page.locator('[data-testid="forge-finarray-eta-o"]').innerText();
    expect(Q).toMatch(/Q =/);
    expect(eo).toMatch(/η_o/);
  });

  test('08 Menu route opens fin array panel', async () => {
    await page.evaluate(() => { window.__forgeCloseFinArrayWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.finarray' } }));
    });
    await page.waitForSelector('[data-testid="forge-finarray-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
