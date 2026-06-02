// v4-235-shaft.spec.js — Forge-235 Shaft (combined bending + torsion).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-235-shaft';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-235 · shaft (combined bending + torsion)', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    // Dismiss Forge-189 onboarding tour so menu-route test can click freely.
    await page.evaluate(() => {
      document.querySelectorAll('[data-testid="forge-tour-tooltip"]').forEach((n) => n.remove());
      document.querySelectorAll('[data-testid="forge-tour-overlay"]').forEach((n) => n.remove());
    });
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.shaft
         && typeof window.forge.shaft.analyseStatic === 'function'
         && typeof window.forge.shaft.analyseFatigue === 'function'));
    expect(has).toBe(true);
  });

  test('02 static von Mises matches textbook (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.shaft.analyseStatic({
      diameterM: 0.025, bendingMomentNm: 200, torqueNm: 150, yieldMPa: 600,
    }));
    // Z   = π·d³/32 = 1.534e-6; σ_x = 200/Z/1e6 ≈ 130.4 MPa
    // Zp  = π·d³/16 = 3.068e-6; τ   = 150/Zp/1e6 ≈ 48.9 MPa
    // σ_vm = √(130.4² + 3·48.9²) ≈ 155.5 MPa
    expect(r.bendingStressMPa).toBeCloseTo(130.4, 0);
    expect(r.shearStressMPa).toBeCloseTo(48.9, 0);
    expect(r.vonMisesStressMPa).toBeCloseTo(155.5, 0);
    expect(r.safetyFactor).toBeCloseTo(600 / r.vonMisesStressMPa, 9);
    await shot(page, 'static');
  });

  test('03 pure bending: σ_vm = σ_x, τ = 0 (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.shaft.analyseStatic({
      diameterM: 0.025, bendingMomentNm: 200, torqueNm: 0, yieldMPa: 600,
    }));
    expect(r.shearStressMPa).toBeCloseTo(0, 12);
    expect(r.vonMisesStressMPa).toBeCloseTo(r.bendingStressMPa, 12);
    await shot(page, 'pure-bending');
  });

  test('04 pure torsion: σ_vm = √3·τ (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.shaft.analyseStatic({
      diameterM: 0.025, bendingMomentNm: 0, torqueNm: 150, yieldMPa: 600,
    }));
    expect(r.bendingStressMPa).toBeCloseTo(0, 12);
    expect(r.vonMisesStressMPa).toBeCloseTo(Math.sqrt(3) * r.shearStressMPa, 9);
    await shot(page, 'pure-torsion');
  });

  test('05 fatigue: Goodman matches textbook (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.shaft.analyseFatigue({
      diameterM: 0.025, bendingMomentNm: 200, torqueNm: 150,
      ultimateMPa: 800, marinFactor: 0.8, kfBending: 1.5, kfsTorsion: 1.3,
    }));
    // S_e' = 0.5·800 = 400; S_e = 0.8·400 = 320
    // σ_a = K_f · 32M/πd³/1e6 = 1.5·130.4 = 195.6
    // σ_m = √3·K_fs · 16T/πd³/1e6 = √3·1.3·48.9 ≈ 110.1
    // 1/n = 195.6/320 + 110.1/800 = 0.749 ; n ≈ 1.335
    expect(r.enduranceLimitMPa).toBeCloseTo(320, 6);
    expect(r.alternatingMPa).toBeCloseTo(195.6, 0);
    expect(r.meanMPa).toBeCloseTo(110.1, 0);
    expect(r.safetyFactor).toBeCloseTo(1.335, 1);
    await shot(page, 'fatigue');
  });

  test('06 S_ut > 1400 MPa caps S_e\' at 700 MPa (Shigley)', async () => {
    const r = await page.evaluate(() => window.forge.shaft.analyseFatigue({
      diameterM: 0.025, bendingMomentNm: 200, torqueNm: 150,
      ultimateMPa: 1500, marinFactor: 1.0, kfBending: 1.0, kfsTorsion: 1.0,
    }));
    expect(r.enduranceLimitMPa).toBeCloseTo(700, 6);
  });

  test('07 panel renders both static and fatigue cards (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenShaftWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-shaft-run"]').click();
    await page.waitForSelector('[data-testid="forge-shaft-static"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="forge-shaft-fatigue"]', { timeout: 5000 });
    const sfS = await page.locator('[data-testid="forge-shaft-sf-static"]').innerText();
    const sfF = await page.locator('[data-testid="forge-shaft-sf-fatigue"]').innerText();
    expect(sfS).toMatch(/SF static/);
    expect(sfF).toMatch(/Goodman/);
    await shot(page, 'panel');
  });

  test('08 menu route fires shaft workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseShaftWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.shaft' } }));
    });
    await page.waitForSelector('[data-testid="forge-shaft-panel"]', { timeout: 2000 });
  });

  test('09 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
