// v4-289-circpipe.spec.js — Forge-289 circular pipe Manning partial flow.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-289-circpipe';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const SEWER = {
  pipeDiameterM: 1.0, waterDepthM: 0.5,
  manningN: 0.013, slope: 0.005,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-289 · circular pipe Manning', () => {
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
      !!(window.forge && window.forge.circpipe
         && typeof window.forge.circpipe.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Half-full: V/V_full = 1, Q/Q_full = 0.5 (Camp curve) (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.circpipe.analyse(b), SEWER);
    expect(r.depthRatio).toBeCloseTo(0.5, 6);
    expect(r.centralAngleRad).toBeCloseTo(Math.PI, 6);
    expect(r.hydraulicRadiusM).toBeCloseTo(0.25, 6);
    expect(r.areaRatio).toBeCloseTo(0.5, 6);
    expect(r.velocityRatio).toBeCloseTo(1.0, 6);
    expect(r.dischargeRatio).toBeCloseTo(0.5, 6);
    await shot(page, 'half');
  });

  test('03 Peak V at d/D ≈ 0.81 reaches V/V_full ≈ 1.14 (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.circpipe.analyse({
      pipeDiameterM: 1.0, waterDepthM: 0.81, manningN: 0.013, slope: 0.005,
    }));
    expect(r.velocityRatio).toBeGreaterThan(1.10);
    expect(r.velocityRatio).toBeLessThan(1.16);
    await shot(page, 'peak-V');
  });

  test('04 Peak Q at d/D ≈ 0.94 reaches Q/Q_full ≈ 1.08 (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.circpipe.analyse({
      pipeDiameterM: 1.0, waterDepthM: 0.94, manningN: 0.013, slope: 0.005,
    }));
    expect(r.dischargeRatio).toBeGreaterThan(1.06);
    expect(r.dischargeRatio).toBeLessThan(1.10);
    await shot(page, 'peak-Q');
  });

  test('05 Full bore: all ratios = 1 (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.circpipe.analyse({
      pipeDiameterM: 1.0, waterDepthM: 1.0, manningN: 0.013, slope: 0.005,
    }));
    expect(r.depthRatio).toBeCloseTo(1.0, 9);
    expect(r.centralAngleRad).toBeCloseTo(2 * Math.PI, 6);
    expect(r.flowAreaM2).toBeCloseTo(Math.PI / 4, 6);
    expect(r.areaRatio).toBeCloseTo(1.0, 6);
    expect(r.velocityRatio).toBeCloseTo(1.0, 6);
    expect(r.dischargeRatio).toBeCloseTo(1.0, 6);
    await shot(page, 'full');
  });

  test('06 V ∝ √S (4× S = 2× V) (cam #6)', async () => {
    const flat = await page.evaluate((b) => window.forge.circpipe.analyse(b), SEWER);
    const steep = await page.evaluate((b) => window.forge.circpipe.analyse({
      ...b, slope: 0.020,
    }), SEWER);
    expect(steep.velocityMs / flat.velocityMs).toBeCloseTo(2.0, 6);
    await shot(page, 'slope-scale');
  });

  test('07 Panel renders V + Q rows', async () => {
    await page.evaluate(() => { window.__forgeOpenCircularPipeFlowWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-circpipe-run"]').click();
    await page.waitForSelector('[data-testid="forge-circpipe-result"]', { timeout: 5000 });
    const V = await page.locator('[data-testid="forge-circpipe-V"]').innerText();
    const Q = await page.locator('[data-testid="forge-circpipe-Q"]').innerText();
    expect(V).toMatch(/V =/);
    expect(Q).toMatch(/Q =/);
  });

  test('08 Menu route opens circpipe panel', async () => {
    await page.evaluate(() => { window.__forgeCloseCircularPipeFlowWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.circpipe' } }));
    });
    await page.waitForSelector('[data-testid="forge-circpipe-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
