// v4-293-hook.spec.js — Forge-293 crane hook stress check.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-293-hook';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const OK = {
  wllKN: 50, shankDiameterMm: 50, shankAllowableStressMPa: 80,
  throatSectionModulusMm3: 80000, throatMomentArmMm: 75,
  throatAllowableStressMPa: 130,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-293 · crane hook', () => {
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
      !!(window.forge && window.forge.hook
         && typeof window.forge.hook.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 5-tonne hook reference passes both checks (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.hook.analyse(b), OK);
    expect(r.shankAreaMm2).toBeCloseTo(Math.PI * 625, 4);
    expect(r.shankStressMPa).toBeCloseTo(50000 / (Math.PI * 625), 4);
    expect(r.throatStressMPa).toBeCloseTo(46.875, 4);
    expect(r.shankOK).toBe(true);
    expect(r.throatOK).toBe(true);
    expect(r.overallOK).toBe(true);
    await shot(page, 'pass');
  });

  test('03 Overload 200 kN → both fail (cam #3)', async () => {
    const r = await page.evaluate((b) => window.forge.hook.analyse({
      ...b, wllKN: 200,
    }), OK);
    expect(r.shankDCR).toBeGreaterThan(1);
    expect(r.throatDCR).toBeGreaterThan(1);
    expect(r.overallOK).toBe(false);
    await shot(page, 'overload');
  });

  test('04 Slim shank governs (cam #4)', async () => {
    const r = await page.evaluate((b) => window.forge.hook.analyse({
      ...b, shankDiameterMm: 20,
    }), OK);
    expect(r.shankDCR).toBeGreaterThan(r.throatDCR);
    expect(r.shankOK).toBe(false);
    expect(r.throatOK).toBe(true);
    expect(r.overallOK).toBe(false);
    await shot(page, 'slim');
  });

  test('05 σ_throat ∝ WLL (cam #5)', async () => {
    const a = await page.evaluate((b) => window.forge.hook.analyse(b), OK);
    const b = await page.evaluate((c) => window.forge.hook.analyse({
      ...c, wllKN: 100, shankDiameterMm: 60, shankAllowableStressMPa: 100,
    }), OK);
    expect(b.throatStressMPa / a.throatStressMPa).toBeCloseTo(2.0, 6);
    await shot(page, 'wll-scale');
  });

  test('06 σ_throat ∝ L_arm (cam #6)', async () => {
    const a = await page.evaluate((b) => window.forge.hook.analyse(b), OK);
    const b = await page.evaluate((c) => window.forge.hook.analyse({
      ...c, throatMomentArmMm: 150,
    }), OK);
    expect(b.throatStressMPa / a.throatStressMPa).toBeCloseTo(2.0, 6);
    await shot(page, 'arm-scale');
  });

  test('07 Panel renders overall pass/fail', async () => {
    await page.evaluate(() => { window.__forgeOpenCraneHookWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-hook-run"]').click();
    await page.waitForSelector('[data-testid="forge-hook-result"]', { timeout: 5000 });
    const overall = await page.locator('[data-testid="forge-hook-overall"]').innerText();
    expect(overall).toMatch(/Hook (passes|FAILS)/);
  });

  test('08 Menu route opens hook panel', async () => {
    await page.evaluate(() => { window.__forgeCloseCraneHookWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.hook' } }));
    });
    await page.waitForSelector('[data-testid="forge-hook-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
