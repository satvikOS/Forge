// v4-292-woodshear.spec.js — Forge-292 wood shear wall (NDS + SDPWS-21).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-292-woodshear';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const OK = {
  shearLoadKN: 15, wallLengthM: 2.4, wallHeightM: 3.0,
  allowableShearKNm: 8.5,
  chordAreaMm2: 89 * 140, chordAllowableStressMPa: 12,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-292 · wood shear wall', () => {
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
      !!(window.forge && window.forge.woodshear
         && typeof window.forge.woodshear.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Reference 2.4×3 wall V=15 kN → all checks pass (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.woodshear.analyse(b), OK);
    expect(r.unitShearKNm).toBeCloseTo(6.25, 6);
    expect(r.aspectRatio).toBeCloseTo(1.25, 6);
    expect(r.chordForceKN).toBeCloseTo(18.75, 6);
    expect(r.aspectOK).toBe(true);
    expect(r.shearOK).toBe(true);
    expect(r.chordOK).toBe(true);
    expect(r.overallOK).toBe(true);
    await shot(page, 'pass');
  });

  test('03 Tall narrow wall: h/b > 3.5 fails aspect (cam #3)', async () => {
    const r = await page.evaluate((b) => window.forge.woodshear.analyse({
      ...b, wallLengthM: 0.8,
    }), OK);
    expect(r.aspectRatio).toBeGreaterThan(3.5);
    expect(r.aspectOK).toBe(false);
    expect(r.overallOK).toBe(false);
    await shot(page, 'aspect-fail');
  });

  test('04 Shear overload: v > v_allow fails (cam #4)', async () => {
    const r = await page.evaluate((b) => window.forge.woodshear.analyse({
      ...b, shearLoadKN: 30,
    }), OK);
    expect(r.shearDCR).toBeGreaterThan(1.0);
    expect(r.shearOK).toBe(false);
    expect(r.overallOK).toBe(false);
    await shot(page, 'shear-fail');
  });

  test('05 Slim chord: σ_c > f_c_allow fails (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.woodshear.analyse({
      shearLoadKN: 50, wallLengthM: 2.4, wallHeightM: 3.0,
      allowableShearKNm: 25,
      chordAreaMm2: 38 * 89, chordAllowableStressMPa: 8,
    }));
    expect(r.chordDCR).toBeGreaterThan(1.0);
    expect(r.chordOK).toBe(false);
    expect(r.overallOK).toBe(false);
    await shot(page, 'chord-fail');
  });

  test('06 T ∝ h (linear) (cam #6)', async () => {
    const lo = await page.evaluate((b) => window.forge.woodshear.analyse(b), OK);
    const hi = await page.evaluate((b) => window.forge.woodshear.analyse({
      ...b, wallHeightM: 4.5,
    }), OK);
    expect(hi.chordForceKN / lo.chordForceKN).toBeCloseTo(1.5, 6);
    await shot(page, 'h-scale');
  });

  test('07 Panel renders overall status', async () => {
    await page.evaluate(() => { window.__forgeOpenWoodShearWallWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-woodshear-run"]').click();
    await page.waitForSelector('[data-testid="forge-woodshear-result"]', { timeout: 5000 });
    const overall = await page.locator('[data-testid="forge-woodshear-overall"]').innerText();
    expect(overall).toMatch(/Wall (passes|FAILS)/);
  });

  test('08 Menu route opens shear wall panel', async () => {
    await page.evaluate(() => { window.__forgeCloseWoodShearWallWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.woodshear' } }));
    });
    await page.waitForSelector('[data-testid="forge-woodshear-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
