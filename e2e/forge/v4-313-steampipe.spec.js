// v4-313-steampipe.spec.js — Forge-313 saturated steam pipe sizing.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-313-steampipe';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const STD = {
  steamPressureBarGauge: 7, steamMassFlowKgPerH: 1000,
  velocityLimitMs: 30, pipeLengthM: 100,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-313 · steam pipe', () => {
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
      !!(window.forge && window.forge.steampipe
         && typeof window.forge.steampipe.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 7 barg 1000 kg/h v=30: T=170, v_g=0.24, DN=65 (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.steampipe.analyse(b), STD);
    expect(r.saturationTempC).toBeCloseTo(170.4, 1);
    expect(r.specificVolumeM3PerKg).toBeCloseTo(0.2403, 4);
    expect(r.requiredDiameterMm).toBeGreaterThan(53);
    expect(r.requiredDiameterMm).toBeLessThan(54);
    expect(r.standardDN).toBe(65);
    expect(r.actualVelocityMs).toBeLessThan(30);  // larger DN drops V below limit
    await shot(page, 'standard');
  });

  test('03 D_req ∝ √ṁ (cam #3)', async () => {
    const r1 = await page.evaluate((b) => window.forge.steampipe.analyse(b), STD);
    const r2 = await page.evaluate((b) => window.forge.steampipe.analyse({
      ...b, steamMassFlowKgPerH: 2000,
    }), STD);
    expect(r2.requiredDiameterMm / r1.requiredDiameterMm).toBeCloseTo(Math.sqrt(2), 4);
    await shot(page, 'mass-scaling');
  });

  test('04 Higher pressure → denser steam, smaller pipe (cam #4)', async () => {
    const r7 = await page.evaluate((b) => window.forge.steampipe.analyse(b), STD);
    const r10 = await page.evaluate((b) => window.forge.steampipe.analyse({
      ...b, steamPressureBarGauge: 10,
    }), STD);
    expect(r10.specificVolumeM3PerKg).toBeLessThan(r7.specificVolumeM3PerKg);
    expect(r10.requiredDiameterMm).toBeLessThan(r7.requiredDiameterMm);
    expect(r10.standardDN).toBeLessThan(r7.standardDN);
    await shot(page, 'high-P');
  });

  test('05 Aggressive v_lim=40 → smaller pipe (cam #5)', async () => {
    const r30 = await page.evaluate((b) => window.forge.steampipe.analyse(b), STD);
    const r40 = await page.evaluate((b) => window.forge.steampipe.analyse({
      ...b, velocityLimitMs: 40,
    }), STD);
    expect(r40.requiredDiameterMm).toBeLessThan(r30.requiredDiameterMm);
    expect(r40.requiredDiameterMm / r30.requiredDiameterMm).toBeCloseTo(Math.sqrt(30/40), 3);
    await shot(page, 'aggressive');
  });

  test('06 ΔP scales linearly with length (cam #6)', async () => {
    const r100 = await page.evaluate((b) => window.forge.steampipe.analyse(b), STD);
    const r200 = await page.evaluate((b) => window.forge.steampipe.analyse({
      ...b, pipeLengthM: 200,
    }), STD);
    expect(r200.totalPressureDropBar / r100.totalPressureDropBar).toBeCloseTo(2.0, 4);
    expect(r200.pressureDropBarPer100m).toBeCloseTo(r100.pressureDropBarPer100m, 5);
    await shot(page, 'dP-length');
  });

  test('07 Panel renders DN + V_actual + ΔP rows', async () => {
    await page.evaluate(() => { window.__forgeOpenSteamPipeWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-stp-run"]').click();
    await page.waitForSelector('[data-testid="forge-stp-result"]', { timeout: 5000 });
    const DN = await page.locator('[data-testid="forge-stp-DN"]').innerText();
    const V  = await page.locator('[data-testid="forge-stp-V"]').innerText();
    const dP = await page.locator('[data-testid="forge-stp-dP"]').innerText();
    expect(DN).toMatch(/DN/);
    expect(V).toMatch(/V_actual/);
    expect(dP).toMatch(/ΔP_total/);
  });

  test('08 Menu route opens steam pipe panel', async () => {
    await page.evaluate(() => { window.__forgeCloseSteamPipeWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.steampipe' } }));
    });
    await page.waitForSelector('[data-testid="forge-stp-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
