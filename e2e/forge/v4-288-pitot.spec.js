// v4-288-pitot.spec.js — Forge-288 Pitot tube velocity measurement.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-288-pitot';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const HVAC = {
  dynamicPressurePa: 150, densityKgM3: 1.20,
  pitotCoefficient: 1.0, flowAreaM2: 0.5,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-288 · Pitot tube velocity', () => {
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
      !!(window.forge && window.forge.pitot
         && typeof window.forge.pitot.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 HVAC duct Δp=150 Pa air → v=15.81 m/s (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.pitot.analyse(b), HVAC);
    expect(r.velocityMs).toBeCloseTo(Math.sqrt(2 * 150 / 1.20), 6);
    expect(r.velocityHeadM).toBeCloseTo(150 / (1.20 * 9.80665), 6);
    expect(r.volumeFlowM3S).toBeCloseTo(r.velocityMs * 0.5, 6);
    expect(r.massFlowKgS).toBeCloseTo(1.20 * r.velocityMs * 0.5, 6);
    await shot(page, 'hvac');
  });

  test('03 v ∝ √Δp (cam #3)', async () => {
    const lo = await page.evaluate((b) => window.forge.pitot.analyse(b), HVAC);
    const hi = await page.evaluate((b) => window.forge.pitot.analyse({
      ...b, dynamicPressurePa: 300,
    }), HVAC);
    expect(hi.velocityMs / lo.velocityMs).toBeCloseTo(Math.sqrt(2), 6);
    await shot(page, 'sqrt-dp');
  });

  test('04 C calibration scales v linearly (cam #4)', async () => {
    const ideal = await page.evaluate((b) => window.forge.pitot.analyse(b), HVAC);
    const real  = await page.evaluate((b) => window.forge.pitot.analyse({
      ...b, pitotCoefficient: 0.95,
    }), HVAC);
    expect(real.velocityMs).toBeCloseTo(0.95 * ideal.velocityMs, 6);
    await shot(page, 'C-scale');
  });

  test('05 Water at same Δp slower than air (cam #5)', async () => {
    const air   = await page.evaluate((b) => window.forge.pitot.analyse(b), HVAC);
    const water = await page.evaluate(() => window.forge.pitot.analyse({
      dynamicPressurePa: 150, densityKgM3: 998,
      pitotCoefficient: 1.0, flowAreaM2: 0.01,
    }));
    expect(water.velocityMs).toBeLessThan(air.velocityMs);
    expect(water.velocityMs).toBeCloseTo(Math.sqrt(2 * 150 / 998), 6);
    await shot(page, 'water');
  });

  test('06 A=0 ⇒ Q and ṁ are 0 (cam #6)', async () => {
    const r = await page.evaluate((b) => window.forge.pitot.analyse({
      ...b, flowAreaM2: 0,
    }), HVAC);
    expect(r.volumeFlowM3S).toBe(0);
    expect(r.massFlowKgS).toBe(0);
    expect(r.velocityMs).toBeGreaterThan(0);
    await shot(page, 'no-area');
  });

  test('07 Panel renders v row', async () => {
    await page.evaluate(() => { window.__forgeOpenPitotTubeWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-pitot-run"]').click();
    await page.waitForSelector('[data-testid="forge-pitot-result"]', { timeout: 5000 });
    const v = await page.locator('[data-testid="forge-pitot-v"]').innerText();
    expect(v).toMatch(/v =/);
  });

  test('08 Menu route opens pitot panel', async () => {
    await page.evaluate(() => { window.__forgeClosePitotTubeWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.pitot' } }));
    });
    await page.waitForSelector('[data-testid="forge-pitot-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
