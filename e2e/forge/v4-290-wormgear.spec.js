// v4-290-wormgear.spec.js — Forge-290 worm gear drive (Shigley §13 / AGMA).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-290-wormgear';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const SHIGLEY = {
  moduleMm: 4, wormStarts: 2, gearTeeth: 50,
  wormPitchDiameterMm: 40, frictionCoefficient: 0.04,
  inputSpeedRpm: 1750, inputTorqueNm: 10,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-290 · worm gear drive', () => {
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
      !!(window.forge && window.forge.wormgear
         && typeof window.forge.wormgear.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Shigley §13: m=4, N_w=2, N_g=50 → η≈82.7%, T_g≈207 N·m (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.wormgear.analyse(b), SHIGLEY);
    expect(r.velocityRatio).toBeCloseTo(25, 9);
    expect(r.leadMm).toBeCloseTo(2 * 4 * Math.PI, 6);
    expect(r.leadAngleDeg).toBeCloseTo(Math.atan(0.2) * 180 / Math.PI, 4);
    expect(r.gearPitchDiameterMm).toBeCloseTo(200, 6);
    expect(r.centreDistanceMm).toBeCloseTo(120, 6);
    expect(r.efficiencyPct).toBeGreaterThan(80);
    expect(r.efficiencyPct).toBeLessThan(85);
    expect(r.outputTorqueNm).toBeGreaterThan(195);
    expect(r.outputTorqueNm).toBeLessThan(215);
    expect(r.selfLocking).toBe(false);
    await shot(page, 'shigley');
  });

  test('03 Single-start high friction → self-locking (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.wormgear.analyse({
      moduleMm: 4, wormStarts: 1, gearTeeth: 50,
      wormPitchDiameterMm: 50, frictionCoefficient: 0.15,
      inputSpeedRpm: 1750, inputTorqueNm: 10,
    }));
    expect(r.selfLocking).toBe(true);
    expect(r.efficiencyPct).toBeLessThan(50);
    await shot(page, 'self-lock');
  });

  test('04 Frictionless: η=100%, T_g = T_w·i (cam #4)', async () => {
    const r = await page.evaluate((b) => window.forge.wormgear.analyse({
      ...b, frictionCoefficient: 0,
    }), SHIGLEY);
    expect(r.efficiencyPct).toBeCloseTo(100, 6);
    expect(r.outputTorqueNm).toBeCloseTo(10 * 25, 6);
    await shot(page, 'ideal');
  });

  test('05 More starts → larger γ + higher η + smaller i (cam #5)', async () => {
    const base = await page.evaluate((b) => window.forge.wormgear.analyse(b), SHIGLEY);
    const four = await page.evaluate((b) => window.forge.wormgear.analyse({
      ...b, wormStarts: 4,
    }), SHIGLEY);
    expect(four.leadAngleDeg).toBeGreaterThan(base.leadAngleDeg);
    expect(four.efficiencyPct).toBeGreaterThan(base.efficiencyPct);
    expect(four.velocityRatio).toBeLessThan(base.velocityRatio);
    await shot(page, 'four-starts');
  });

  test('06 V_s ∝ n_w (cam #6)', async () => {
    const slow = await page.evaluate((b) => window.forge.wormgear.analyse(b), SHIGLEY);
    const fast = await page.evaluate((b) => window.forge.wormgear.analyse({
      ...b, inputSpeedRpm: 3500,
    }), SHIGLEY);
    expect(fast.slidingVelocityMs / slow.slidingVelocityMs).toBeCloseTo(2.0, 6);
    await shot(page, 'speed-scale');
  });

  test('07 Panel renders η + T_g + lock rows', async () => {
    await page.evaluate(() => { window.__forgeOpenWormGearWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-wormgear-run"]').click();
    await page.waitForSelector('[data-testid="forge-wormgear-result"]', { timeout: 5000 });
    const eta = await page.locator('[data-testid="forge-wormgear-eta"]').innerText();
    const T   = await page.locator('[data-testid="forge-wormgear-T"]').innerText();
    const lk  = await page.locator('[data-testid="forge-wormgear-lock"]').innerText();
    expect(eta).toMatch(/η/);
    expect(T).toMatch(/T_g/);
    expect(lk).toMatch(/Self-locking|Back-drives/);
  });

  test('08 Menu route opens worm gear panel', async () => {
    await page.evaluate(() => { window.__forgeCloseWormGearWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.wormgear' } }));
    });
    await page.waitForSelector('[data-testid="forge-wormgear-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
