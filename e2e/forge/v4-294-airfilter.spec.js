// v4-294-airfilter.spec.js — Forge-294 air filter pressure drop + fan energy.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-294-airfilter';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const MERV13 = {
  flowRateM3S: 2.36, faceAreaM2: 1.5,
  initialPressureDropPa: 75, finalPressureDropPa: 250,
  runHours: 8760, fanEfficiency: 0.55,
  electricityRatePerKWh: 0.12,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-294 · air filter', () => {
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
      !!(window.forge && window.forge.airfilter
         && typeof window.forge.airfilter.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 MERV13 5000 cfm, 1.5 m² face → v≈1.57 m/s in range (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.airfilter.analyse(b), MERV13);
    expect(r.faceVelocityMs).toBeCloseTo(2.36 / 1.5, 6);
    expect(r.faceVelocityInRange).toBe(true);
    expect(r.averagePressureDropPa).toBeCloseTo(162.5, 6);
    expect(r.fanPowerW).toBeCloseTo(162.5 * 2.36 / 0.55, 6);
    expect(r.energyKWh).toBeCloseTo(r.fanPowerW * 8760 / 1000, 6);
    expect(r.energyCost).toBeCloseTo(r.energyKWh * 0.12, 6);
    await shot(page, 'sized');
  });

  test('03 Too tight (0.30 m²) → v > 2.5 m/s out of range (cam #3)', async () => {
    const r = await page.evaluate((b) => window.forge.airfilter.analyse({
      ...b, faceAreaM2: 0.30,
    }), MERV13);
    expect(r.faceVelocityMs).toBeGreaterThan(2.5);
    expect(r.faceVelocityInRange).toBe(false);
    await shot(page, 'tight');
  });

  test('04 Cleaner filter → less power + lower cost (cam #4)', async () => {
    const dirty = await page.evaluate((b) => window.forge.airfilter.analyse(b), MERV13);
    const clean = await page.evaluate((b) => window.forge.airfilter.analyse({
      ...b, initialPressureDropPa: 50, finalPressureDropPa: 100,
    }), MERV13);
    expect(clean.fanPowerW).toBeLessThan(dirty.fanPowerW);
    expect(clean.energyCost).toBeLessThan(dirty.energyCost);
    await shot(page, 'clean');
  });

  test('05 E ∝ t (cam #5)', async () => {
    const yr   = await page.evaluate((b) => window.forge.airfilter.analyse(b), MERV13);
    const half = await page.evaluate((b) => window.forge.airfilter.analyse({
      ...b, runHours: 4380,
    }), MERV13);
    expect(half.energyKWh / yr.energyKWh).toBeCloseTo(0.5, 6);
    await shot(page, 't-scale');
  });

  test('06 Better fan η → less power (cam #6)', async () => {
    const mid = await page.evaluate((b) => window.forge.airfilter.analyse(b), MERV13);
    const top = await page.evaluate((b) => window.forge.airfilter.analyse({
      ...b, fanEfficiency: 0.85,
    }), MERV13);
    expect(top.fanPowerW).toBeLessThan(mid.fanPowerW);
    expect(top.fanPowerW * 0.85).toBeCloseTo(mid.fanPowerW * 0.55, 4);
    await shot(page, 'eta');
  });

  test('07 Panel renders v_face + E + cost rows', async () => {
    await page.evaluate(() => { window.__forgeOpenAirFilterWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-airfilter-run"]').click();
    await page.waitForSelector('[data-testid="forge-airfilter-result"]', { timeout: 5000 });
    const v = await page.locator('[data-testid="forge-airfilter-v"]').innerText();
    const E = await page.locator('[data-testid="forge-airfilter-E"]').innerText();
    const C = await page.locator('[data-testid="forge-airfilter-cost"]').innerText();
    expect(v).toMatch(/v_face/);
    expect(E).toMatch(/Energy/);
    expect(C).toMatch(/Cost/);
  });

  test('08 Menu route opens air filter panel', async () => {
    await page.evaluate(() => { window.__forgeCloseAirFilterWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.airfilter' } }));
    });
    await page.waitForSelector('[data-testid="forge-airfilter-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
