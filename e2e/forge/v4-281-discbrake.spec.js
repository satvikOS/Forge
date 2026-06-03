// v4-281-discbrake.spec.js — Forge-281 disc clutch/brake torque.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-281-discbrake';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const SHIGLEY = {
  outerRadiusMm: 75, innerRadiusMm: 30,
  frictionCoefficient: 0.32, clampingForceN: 4500, numberOfFaces: 2,
};

test.describe.serial('Forge-281 · disc clutch / brake', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      document.querySelectorAll('[data-testid="forge-tour-tooltip"]').forEach((n) => n.remove());
      document.querySelectorAll('[data-testid="forge-tour-overlay"]').forEach((n) => n.remove());
    });
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 kernel bridge wired (cam #1 baseline)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.discbrake
         && typeof window.forge.discbrake.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Shigley Ex. 16-1 wear: T=151.2 N·m, p_max=1.06 MPa (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.discbrake.analyse({
      ...b, assumption: 'uniform-wear',
    }), SHIGLEY);
    expect(r.torqueNm).toBeCloseTo(151.2, 1);
    expect(r.maxPressureMPa).toBeCloseTo(4500 / (Math.PI * 30 * 45), 6);
    expect(r.assumptionUsed).toBe('uniform-wear');
    await shot(page, 'wear');
  });

  test('03 Uniform-pressure case higher T (cam #3)', async () => {
    const w = await page.evaluate((b) => window.forge.discbrake.analyse({
      ...b, assumption: 'uniform-wear',
    }), SHIGLEY);
    const p = await page.evaluate((b) => window.forge.discbrake.analyse({
      ...b, assumption: 'uniform-pressure',
    }), SHIGLEY);
    expect(p.torqueNm).toBeGreaterThan(w.torqueNm);
    expect(p.maxPressureMPa).toBeCloseTo(p.averagePressureMPa, 9);
    await shot(page, 'pressure');
  });

  test('04 T scales linearly with # faces (cam #4)', async () => {
    const n2 = await page.evaluate((b) => window.forge.discbrake.analyse({
      ...b, numberOfFaces: 2, assumption: 'uniform-wear',
    }), SHIGLEY);
    const n6 = await page.evaluate((b) => window.forge.discbrake.analyse({
      ...b, numberOfFaces: 6, assumption: 'uniform-wear',
    }), SHIGLEY);
    expect(n6.torqueNm / n2.torqueNm).toBeCloseTo(3.0, 6);
    await shot(page, 'multi-disc');
  });

  test('05 T scales linearly with μ (cam #5)', async () => {
    const mu032 = await page.evaluate((b) => window.forge.discbrake.analyse({
      ...b, frictionCoefficient: 0.32, assumption: 'uniform-wear',
    }), SHIGLEY);
    const mu016 = await page.evaluate((b) => window.forge.discbrake.analyse({
      ...b, frictionCoefficient: 0.16, assumption: 'uniform-wear',
    }), SHIGLEY);
    expect(mu016.torqueNm / mu032.torqueNm).toBeCloseTo(0.5, 6);
    await shot(page, 'mu');
  });

  test('06 R_i ≥ R_o throws (cam #6)', async () => {
    let threw = false;
    try {
      await page.evaluate((b) => window.forge.discbrake.analyse({
        ...b, outerRadiusMm: 30, innerRadiusMm: 30, assumption: 'uniform-wear',
      }), SHIGLEY);
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'throw');
  });

  test('07 Panel renders T row', async () => {
    await page.evaluate(() => { window.__forgeOpenDiscBrakeWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-discbrake-run"]').click();
    await page.waitForSelector('[data-testid="forge-discbrake-result"]', { timeout: 5000 });
    const T = await page.locator('[data-testid="forge-discbrake-T"]').innerText();
    expect(T).toMatch(/T =/);
  });

  test('08 Menu route opens disc brake panel', async () => {
    await page.evaluate(() => { window.__forgeCloseDiscBrakeWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.discbrake' } }));
    });
    await page.waitForSelector('[data-testid="forge-discbrake-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
