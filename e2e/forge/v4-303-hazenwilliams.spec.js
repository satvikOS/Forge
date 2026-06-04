// v4-303-hazenwilliams.spec.js — Forge-303 Hazen-Williams pipe friction.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-303-hazenwilliams';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const STD = {
  pipeLengthM: 100, innerDiameterMm: 100, flowLpm: 500, hazenWilliamsC: 120,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-303 · Hazen-Williams', () => {
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
      !!(window.forge && window.forge.hazenwilliams
         && typeof window.forge.hazenwilliams.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 100 m DN100 steel C=120 Q=500 → V=1.06 m/s, ΔP=15.7 kPa (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.hazenwilliams.analyse(b), STD);
    expect(r.velocityMs).toBeGreaterThan(1.05);
    expect(r.velocityMs).toBeLessThan(1.07);
    expect(r.reynoldsApprox).toBeGreaterThan(100000);
    expect(r.regimeFlag).toBe(3);
    expect(r.totalPressureLossKpa).toBeGreaterThan(15.6);
    expect(r.totalPressureLossKpa).toBeLessThan(15.8);
    expect(r.velocityHeadKpa).toBeCloseTo(0.5 * 1000 * 1.061 * 1.061 / 1000, 2);
    await shot(page, 'steel');
  });

  test('03 PVC C=150 ratio = (150/120)^1.85 (cam #3)', async () => {
    const steel = await page.evaluate((b) => window.forge.hazenwilliams.analyse(b), STD);
    const pvc   = await page.evaluate((b) => window.forge.hazenwilliams.analyse({
      ...b, hazenWilliamsC: 150,
    }), STD);
    expect(steel.totalPressureLossKpa / pvc.totalPressureLossKpa)
      .toBeCloseTo(Math.pow(150 / 120, 1.85), 4);
    await shot(page, 'pvc');
  });

  test('04 Doubled Q → ΔP × 2^1.85 (cam #4)', async () => {
    const r1 = await page.evaluate((b) => window.forge.hazenwilliams.analyse(b), STD);
    const r2 = await page.evaluate((b) => window.forge.hazenwilliams.analyse({
      ...b, flowLpm: 1000,
    }), STD);
    expect(r2.totalPressureLossKpa / r1.totalPressureLossKpa)
      .toBeCloseTo(Math.pow(2, 1.85), 4);
    await shot(page, 'doubled-Q');
  });

  test('05 Doubled D → ΔP / 2^4.87 (cam #5)', async () => {
    const r1 = await page.evaluate((b) => window.forge.hazenwilliams.analyse(b), STD);
    const r2 = await page.evaluate((b) => window.forge.hazenwilliams.analyse({
      ...b, innerDiameterMm: 200,
    }), STD);
    expect(r1.totalPressureLossKpa / r2.totalPressureLossKpa)
      .toBeCloseTo(Math.pow(2, 4.87), 3);
    await shot(page, 'doubled-D');
  });

  test('06 Laminar flow flagged invalid (Q=5 L/min, Re < 2000) (cam #6)', async () => {
    const r = await page.evaluate((b) => window.forge.hazenwilliams.analyse({
      ...b, flowLpm: 5,
    }), STD);
    expect(r.reynoldsApprox).toBeLessThan(2000);
    expect(r.regimeFlag).toBe(1);
    await shot(page, 'laminar');
  });

  test('07 Panel renders V + regime + ΔP rows', async () => {
    await page.evaluate(() => { window.__forgeOpenHazenWilliamsWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-hw-run"]').click();
    await page.waitForSelector('[data-testid="forge-hw-result"]', { timeout: 5000 });
    const reg = await page.locator('[data-testid="forge-hw-regime"]').innerText();
    const dP  = await page.locator('[data-testid="forge-hw-dP"]').innerText();
    const vh  = await page.locator('[data-testid="forge-hw-vhead"]').innerText();
    expect(reg).toMatch(/Turbulent|Transitional|Laminar/);
    expect(dP).toMatch(/ΔP_total/);
    expect(vh).toMatch(/Velocity head/);
  });

  test('08 Menu route opens HW panel', async () => {
    await page.evaluate(() => { window.__forgeCloseHazenWilliamsWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.hazenwilliams' } }));
    });
    await page.waitForSelector('[data-testid="forge-hw-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
