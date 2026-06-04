// v4-314-airpipe.spec.js — Forge-314 compressed-air pipe sizing.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-314-airpipe';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const STD = {
  supplyPressureBarGauge: 7, freeAirDeliveryM3PerMin: 20,
  velocityLimitMs: 10, pipeLengthM: 100,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-314 · compressed air', () => {
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
      !!(window.forge && window.forge.airpipe
         && typeof window.forge.airpipe.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 7 barg 20 m³/min v=10: p_abs=8.013, DN=80 (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.airpipe.analyse(b), STD);
    expect(r.absolutePressureBar).toBeCloseTo(8.013, 4);
    expect(r.airDensityKgPerM3).toBeCloseTo(1.225 * 8.013 / 1.013, 3);
    expect(r.requiredDiameterMm).toBeGreaterThan(73);
    expect(r.requiredDiameterMm).toBeLessThan(74);
    expect(r.standardDN).toBe(80);
    expect(r.actualVelocityMs).toBeLessThan(10);
    await shot(page, 'standard');
  });

  test('03 Boyle identity: Q_FAD = Q_line × p_abs/p_atm (cam #3)', async () => {
    const r = await page.evaluate((b) => window.forge.airpipe.analyse(b), STD);
    const fad_check = r.actualVolumeFlowM3PerS * (r.absolutePressureBar / 1.013) * 60;
    expect(fad_check).toBeCloseTo(20, 3);
    await shot(page, 'boyle');
  });

  test('04 Higher pressure → smaller pipe (cam #4)', async () => {
    const r7 = await page.evaluate((b) => window.forge.airpipe.analyse(b), STD);
    const r10 = await page.evaluate((b) => window.forge.airpipe.analyse({
      ...b, supplyPressureBarGauge: 10,
    }), STD);
    expect(r10.actualVolumeFlowM3PerS).toBeLessThan(r7.actualVolumeFlowM3PerS);
    expect(r10.requiredDiameterMm).toBeLessThan(r7.requiredDiameterMm);
    await shot(page, 'high-P');
  });

  test('05 D_req ∝ √Q_FAD (cam #5)', async () => {
    const r1 = await page.evaluate((b) => window.forge.airpipe.analyse(b), STD);
    const r4 = await page.evaluate((b) => window.forge.airpipe.analyse({
      ...b, freeAirDeliveryM3PerMin: 80,
    }), STD);
    expect(r4.requiredDiameterMm / r1.requiredDiameterMm).toBeCloseTo(2.0, 3);
    await shot(page, 'flow-scaling');
  });

  test('06 ΔP linear in pipe length (cam #6)', async () => {
    const r100 = await page.evaluate((b) => window.forge.airpipe.analyse(b), STD);
    const r200 = await page.evaluate((b) => window.forge.airpipe.analyse({
      ...b, pipeLengthM: 200,
    }), STD);
    expect(r200.totalPressureDropBar / r100.totalPressureDropBar).toBeCloseTo(2.0, 4);
    expect(r200.pressureDropBarPer100m).toBeCloseTo(r100.pressureDropBarPer100m, 5);
    await shot(page, 'dP-length');
  });

  test('07 Panel renders DN + V_actual + ΔP rows', async () => {
    await page.evaluate(() => { window.__forgeOpenAirPipeWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-ap-run"]').click();
    await page.waitForSelector('[data-testid="forge-ap-result"]', { timeout: 5000 });
    const DN = await page.locator('[data-testid="forge-ap-DN"]').innerText();
    const V  = await page.locator('[data-testid="forge-ap-V"]').innerText();
    const dP = await page.locator('[data-testid="forge-ap-dP"]').innerText();
    expect(DN).toMatch(/DN/);
    expect(V).toMatch(/V_actual/);
    expect(dP).toMatch(/ΔP_total/);
  });

  test('08 Menu route opens air pipe panel', async () => {
    await page.evaluate(() => { window.__forgeCloseAirPipeWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.airpipe' } }));
    });
    await page.waitForSelector('[data-testid="forge-ap-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
