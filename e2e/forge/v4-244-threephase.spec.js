// v4-244-threephase.spec.js — Forge-244 3-phase power + PF + p.u.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-244-threephase';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-244 · three-phase power', () => {
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

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.threephase
         && typeof window.forge.threephase.balancedPower === 'function'
         && typeof window.forge.threephase.powerFactorCorrection === 'function'
         && typeof window.forge.threephase.perUnit === 'function'));
    expect(has).toBe(true);
  });

  test('02 textbook 415 V / 100 A / pf=0.866 lag → S=71.88 kVA (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.threephase.balancedPower({
      connection: 'star', lineLineVoltageV: 415, lineCurrentA: 100,
      powerFactor: 0.866, leading: false,
    }));
    expect(r.phaseVoltageV).toBeCloseTo(415 / Math.sqrt(3), 6);
    expect(r.phaseCurrentA).toBeCloseTo(100, 6);
    expect(r.apparentVA / 1000).toBeCloseTo(71.88, 1);
    expect(r.realW / 1000).toBeCloseTo(62.25, 1);
    expect(r.reactiveVAR / 1000).toBeCloseTo(35.94, 1);
    expect(r.reactiveVAR).toBeGreaterThan(0);  // lag → +
    await shot(page, 'balanced-star');
  });

  test('03 delta vs star: V_LL same, V_ph differs (cam #2)', async () => {
    const star = await page.evaluate(() => window.forge.threephase.balancedPower({
      connection: 'star', lineLineVoltageV: 415, lineCurrentA: 100,
      powerFactor: 0.866, leading: false,
    }));
    const delta = await page.evaluate(() => window.forge.threephase.balancedPower({
      connection: 'delta', lineLineVoltageV: 415, lineCurrentA: 100,
      powerFactor: 0.866, leading: false,
    }));
    expect(star.apparentVA).toBeCloseTo(delta.apparentVA, 6);
    expect(delta.phaseVoltageV).toBeCloseTo(415, 6);
    expect(delta.phaseCurrentA).toBeCloseTo(100 / Math.sqrt(3), 6);
    await shot(page, 'delta-vs-star');
  });

  test('04 leading PF flips Q sign (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.threephase.balancedPower({
      connection: 'star', lineLineVoltageV: 415, lineCurrentA: 100,
      powerFactor: 0.866, leading: true,
    }));
    expect(r.reactiveVAR).toBeLessThan(0);
    await shot(page, 'leading');
  });

  test('05 PF correction textbook: ΔQ_c=42.13 kVAR, C ≈ 778 μF (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.threephase.powerFactorCorrection({
      realPowerW: 100000, powerFactor1: 0.8, powerFactor2: 0.95,
      lineLineVoltageV: 415, frequencyHz: 50,
    }));
    expect(r.reactiveBeforeVAR / 1000).toBeCloseTo(75.0, 1);
    expect(r.reactiveAfterVAR / 1000).toBeCloseTo(32.87, 1);
    expect(r.capacitorVAR / 1000).toBeCloseTo(42.13, 1);
    expect(r.capacitanceF * 1e6).toBeCloseTo(778.5, 0);
    await shot(page, 'pf-correction');
  });

  test('06 per-unit: 100 MVA @ 138 kV → Z_base=190.4 Ω (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.threephase.perUnit({
      baseVA: 100e6, baseVoltageLineLineV: 138e3, ohmicZ: 50,
    }));
    expect(r.baseImpedanceOhm).toBeCloseTo(190.44, 1);
    expect(r.baseCurrentA).toBeCloseTo(418.37, 0);
    expect(r.zpu).toBeCloseTo(50 / 190.44, 4);
    await shot(page, 'per-unit');
  });

  test('07 panel tab switching renders all three result cards', async () => {
    await page.evaluate(() => { window.__forgeOpenThreePhaseWorkbench?.(); });
    await page.waitForTimeout(300);
    // Tab 1: power.
    await page.locator('[data-testid="forge-threephase-run"]').click();
    await page.waitForSelector('[data-testid="forge-threephase-Q"]', { timeout: 5000 });
    // Tab 2: pf correction.
    await page.locator('[data-testid="forge-3p-tab-pf"]').click();
    await page.locator('[data-testid="forge-threephase-run"]').click();
    await page.waitForSelector('[data-testid="forge-threephase-C"]', { timeout: 5000 });
    // Tab 3: per-unit.
    await page.locator('[data-testid="forge-3p-tab-pu"]').click();
    await page.locator('[data-testid="forge-threephase-run"]').click();
    await page.waitForSelector('[data-testid="forge-threephase-Zpu"]', { timeout: 5000 });
    const zpu = await page.locator('[data-testid="forge-threephase-Zpu"]').innerText();
    expect(zpu).toMatch(/Z_pu/);
  });

  test('08 menu route fires threephase workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseThreePhaseWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.threephase' } }));
    });
    await page.waitForSelector('[data-testid="forge-threephase-panel"]', { timeout: 2000 });
  });

  test('09 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
