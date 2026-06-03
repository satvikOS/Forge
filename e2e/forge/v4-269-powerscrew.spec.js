// v4-269-powerscrew.spec.js — Forge-269 power screw torque (Shigley §8-2).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-269-powerscrew';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-269 · power screw torque & efficiency', () => {
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
      !!(window.forge && window.forge.powerscrew
         && typeof window.forge.powerscrew.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Shigley Ex. 8-1: 32mm square × 4mm lead, 6.4 kN, μ=0.08 (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.powerscrew.analyse({
      axialForceN: 6400, meanDiameterMm: 30, leadMm: 4,
      threadFriction: 0.08, collarFriction: 0.08, collarMeanDiameterMm: 40,
      threadType: 'square',
    }));
    expect(r.leadAngleDeg).toBeCloseTo(2.430, 2);
    expect(r.raiseTorqueNm).toBeCloseTo(11.79, 1);
    expect(r.collarTorqueNm).toBeCloseTo(10.24, 2);
    expect(r.totalRaiseTorqueNm).toBeCloseTo(22.03, 1);
    expect(r.efficiencyPct).toBeCloseTo(34.5, 1);
    expect(r.selfLocking).toBe(true);
    await shot(page, 'shigley');
  });

  test('03 Frictionless: η=100%, lower T = −raise (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.powerscrew.analyse({
      axialForceN: 6400, meanDiameterMm: 30, leadMm: 4,
      threadFriction: 0, collarFriction: 0, collarMeanDiameterMm: 40,
      threadType: 'square',
    }));
    expect(r.efficiencyPct).toBeCloseTo(100, 6);
    expect(r.raiseTorqueNm).toBeCloseTo(6400 * 0.004 / (2 * Math.PI), 6);
    expect(r.lowerTorqueNm).toBeCloseTo(-r.raiseTorqueNm, 6);
    expect(r.selfLocking).toBe(false);
    await shot(page, 'frictionless');
  });

  test('04 ACME secant correction: μ_eff = μ/cos(14.5°) (cam #4)', async () => {
    const sq = await page.evaluate(() => window.forge.powerscrew.analyse({
      axialForceN: 6400, meanDiameterMm: 30, leadMm: 4,
      threadFriction: 0.08, collarFriction: 0, collarMeanDiameterMm: 0,
      threadType: 'square',
    }));
    const ac = await page.evaluate(() => window.forge.powerscrew.analyse({
      axialForceN: 6400, meanDiameterMm: 30, leadMm: 4,
      threadFriction: 0.08, collarFriction: 0, collarMeanDiameterMm: 0,
      threadType: 'acme',
    }));
    expect(ac.effectiveFriction).toBeCloseTo(0.08 / Math.cos(14.5 * Math.PI / 180), 8);
    expect(ac.raiseTorqueNm).toBeGreaterThan(sq.raiseTorqueNm);
    await shot(page, 'acme');
  });

  test('05 Non-self-locking: large lead, low friction (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.powerscrew.analyse({
      axialForceN: 1000, meanDiameterMm: 20, leadMm: 40,
      threadFriction: 0.05, collarFriction: 0, collarMeanDiameterMm: 0,
      threadType: 'square',
    }));
    expect(r.selfLocking).toBe(false);
    expect(r.lowerTorqueNm).toBeLessThan(0);
    await shot(page, 'non-self-lock');
  });

  test('06 Collar torque scales linearly with d_c (cam #6)', async () => {
    const a = await page.evaluate(() => window.forge.powerscrew.analyse({
      axialForceN: 1000, meanDiameterMm: 20, leadMm: 4,
      threadFriction: 0.1, collarFriction: 0.1, collarMeanDiameterMm: 30,
      threadType: 'square',
    }));
    const b = await page.evaluate(() => window.forge.powerscrew.analyse({
      axialForceN: 1000, meanDiameterMm: 20, leadMm: 4,
      threadFriction: 0.1, collarFriction: 0.1, collarMeanDiameterMm: 60,
      threadType: 'square',
    }));
    expect(b.collarTorqueNm / a.collarTorqueNm).toBeCloseTo(2.0, 6);
    await shot(page, 'collar-scale');
  });

  test('07 Panel renders T_raise + η + lock rows', async () => {
    await page.evaluate(() => { window.__forgeOpenPowerScrewWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-powerscrew-run"]').click();
    await page.waitForSelector('[data-testid="forge-powerscrew-result"]', { timeout: 5000 });
    const T   = await page.locator('[data-testid="forge-powerscrew-traise"]').innerText();
    const eta = await page.locator('[data-testid="forge-powerscrew-eta"]').innerText();
    const lk  = await page.locator('[data-testid="forge-powerscrew-lock"]').innerText();
    expect(T).toMatch(/T_raise/);
    expect(eta).toMatch(/η/);
    expect(lk).toMatch(/Self-locking|Back-drives/);
  });

  test('08 Menu route opens power screw panel', async () => {
    await page.evaluate(() => { window.__forgeClosePowerScrewWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.powerscrew' } }));
    });
    await page.waitForSelector('[data-testid="forge-powerscrew-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
