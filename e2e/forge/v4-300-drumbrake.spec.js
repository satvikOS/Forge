// v4-300-drumbrake.spec.js — Forge-300 drum brake short-shoe.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-300-drumbrake';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const SHIGLEY = {
  leverForceP_N: 200,
  leverLength_c_m: 0.300,
  contactArm_a_m: 0.150,
  drumRadius_r_m: 0.125,
  friction_mu: 0.4,
  selfEnergizing: true,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-300 · drum brake', () => {
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
      !!(window.forge && window.forge.drumbrake
         && typeof window.forge.drumbrake.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Self-energizing reference: N=600 N, T=30 N·m, gain=1.2 (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.drumbrake.analyse(b), SHIGLEY);
    expect(r.normalForceN).toBeCloseTo(600, 3);
    expect(r.brakingTorqueNm).toBeCloseTo(30, 4);
    expect(r.mechanicalAdvantage).toBeCloseTo(1.2, 4);
    expect(r.selfLockingMargin).toBeCloseTo(0.1, 6);
    expect(r.selfLocked).toBe(false);
    await shot(page, 'self-energ');
  });

  test('03 De-energizing same geometry: half the torque (cam #3)', async () => {
    const se = await page.evaluate((b) => window.forge.drumbrake.analyse(b), SHIGLEY);
    const de = await page.evaluate((b) => window.forge.drumbrake.analyse({
      ...b, selfEnergizing: false,
    }), SHIGLEY);
    expect(de.normalForceN).toBeCloseTo(300, 3);
    expect(de.brakingTorqueNm).toBeCloseTo(15, 4);
    expect(se.brakingTorqueNm / de.brakingTorqueNm).toBeCloseTo(2.0, 5);
    await shot(page, 'de-energ');
  });

  test('04 Self-lock rejection at μ ≥ a/r = 1.2 (cam #4)', async () => {
    const err = await page.evaluate((b) =>
      { try { window.forge.drumbrake.analyse({ ...b, friction_mu: 1.3 }); return null; }
        catch (e) { return String(e.message || e); } }, SHIGLEY);
    expect(err).toMatch(/self-locked|self-lock/);
    await shot(page, 'self-lock');
  });

  test('05 De-energizing brake at μ=1.3 still works (cam #5)', async () => {
    const r = await page.evaluate((b) => window.forge.drumbrake.analyse({
      ...b, friction_mu: 1.3, selfEnergizing: false,
    }), SHIGLEY);
    expect(r.normalForceN).toBeCloseTo(192, 1);
    expect(r.brakingTorqueNm).toBeCloseTo(31.2, 2);
    expect(r.selfLocked).toBe(false);
    await shot(page, 'de-strong-mu');
  });

  test('06 T/(P·r) identity = μN·r/(P·r) = μN/P (cam #6)', async () => {
    const r = await page.evaluate((b) => window.forge.drumbrake.analyse(b), SHIGLEY);
    expect(r.mechanicalAdvantage).toBeCloseTo(r.frictionForceN / SHIGLEY.leverForceP_N, 6);
    await shot(page, 'identity');
  });

  test('07 Panel renders T + gain + lock rows', async () => {
    await page.evaluate(() => { window.__forgeOpenDrumBrakeWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-drumbrake-run"]').click();
    await page.waitForSelector('[data-testid="forge-drumbrake-result"]', { timeout: 5000 });
    const T  = await page.locator('[data-testid="forge-drumbrake-T"]').innerText();
    const MA = await page.locator('[data-testid="forge-drumbrake-MA"]').innerText();
    expect(T).toMatch(/T\s*=/);
    expect(MA).toMatch(/Gain/);
  });

  test('08 Menu route opens drum-brake panel', async () => {
    await page.evaluate(() => { window.__forgeCloseDrumBrakeWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.drumbrake' } }));
    });
    await page.waitForSelector('[data-testid="forge-drumbrake-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
