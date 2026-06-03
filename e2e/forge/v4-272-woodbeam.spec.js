// v4-272-woodbeam.spec.js — Forge-272 wood beam bending (NDS 2018).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-272-woodbeam';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const BASE = {
  referenceFbMPa: 6.21, emin_MPa: 4480,
  widthMm: 38, depthMm: 286, effectiveLengthMm: 2000,
  cD: 1.15, cM: 1.0, cT: 1.0,
  cF: 1.0, cFu: 1.0, cI: 1.0, cR: 1.15,
};

test.describe.serial('Forge-272 · wood beam bending', () => {
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
      !!(window.forge && window.forge.woodbeam
         && typeof window.forge.woodbeam.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 DF-L 2×12 reference: S_x = b·d²/6 (cam #2)', async () => {
    const r = await page.evaluate((base) => window.forge.woodbeam.analyse(base), BASE);
    expect(r.sectionModulusMm3).toBeCloseTo(38 * 286 * 286 / 6, 0);
    expect(r.fbStarMPa).toBeCloseTo(6.21 * 1.15 * 1.15, 6);
    expect(r.mAllowNmm).toBeCloseTo(r.fbPrimeMPa * r.sectionModulusMm3, 6);
    await shot(page, 'reference');
  });

  test('03 Short l_e: C_L ≈ 1, M_allow ≈ F*_b·S_x (cam #3)', async () => {
    const r = await page.evaluate((base) => window.forge.woodbeam.analyse({
      ...base, effectiveLengthMm: 100,
    }), BASE);
    expect(r.cL).toBeGreaterThan(0.99);
    expect(r.fbPrimeMPa).toBeGreaterThan(0.99 * r.fbStarMPa);
    await shot(page, 'short');
  });

  test('04 Long l_e drops C_L (cam #4)', async () => {
    const short = await page.evaluate((base) => window.forge.woodbeam.analyse({
      ...base, effectiveLengthMm: 100,
    }), BASE);
    const long  = await page.evaluate((base) => window.forge.woodbeam.analyse({
      ...base, effectiveLengthMm: 5000,
    }), BASE);
    expect(long.slendernessRb).toBeGreaterThan(short.slendernessRb);
    expect(long.cL).toBeLessThan(short.cL);
    expect(long.mAllowNmm).toBeLessThan(short.mAllowNmm);
    await shot(page, 'long');
  });

  test('05 C_D scales F*_b linearly (cam #5)', async () => {
    const a = await page.evaluate((base) => window.forge.woodbeam.analyse({
      ...base, cD: 1.0,  cR: 1.0,
    }), BASE);
    const b = await page.evaluate((base) => window.forge.woodbeam.analyse({
      ...base, cD: 1.6,  cR: 1.0,
    }), BASE);
    expect(b.fbStarMPa / a.fbStarMPa).toBeCloseTo(1.6, 6);
    await shot(page, 'cD');
  });

  test('06 Wider beam reduces R_B + lifts C_L (cam #6)', async () => {
    const narrow = await page.evaluate((base) => window.forge.woodbeam.analyse({
      ...base, widthMm: 38, effectiveLengthMm: 5000, cD: 1.0, cR: 1.0,
    }), BASE);
    const wide   = await page.evaluate((base) => window.forge.woodbeam.analyse({
      ...base, widthMm: 100, effectiveLengthMm: 5000, cD: 1.0, cR: 1.0,
    }), BASE);
    expect(wide.slendernessRb).toBeLessThan(narrow.slendernessRb);
    expect(wide.cL).toBeGreaterThan(narrow.cL);
    await shot(page, 'wide');
  });

  test('07 Panel renders F\'_b + M_allow rows', async () => {
    await page.evaluate(() => { window.__forgeOpenWoodBeamWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-woodbeam-run"]').click();
    await page.waitForSelector('[data-testid="forge-woodbeam-result"]', { timeout: 5000 });
    const fb = await page.locator('[data-testid="forge-woodbeam-fbprime"]').innerText();
    const M  = await page.locator('[data-testid="forge-woodbeam-mallow"]').innerText();
    expect(fb).toMatch(/F'_b/);
    expect(M).toMatch(/M_allow/);
  });

  test('08 Menu route opens wood beam panel', async () => {
    await page.evaluate(() => { window.__forgeCloseWoodBeamWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.woodbeam' } }));
    });
    await page.waitForSelector('[data-testid="forge-woodbeam-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
