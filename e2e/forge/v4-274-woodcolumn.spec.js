// v4-274-woodcolumn.spec.js — Forge-274 wood column buckling (NDS 2018 §3.7).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-274-woodcolumn';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const BASE = {
  referenceFcMPa: 6.62, emin_MPa: 4140,
  areaMm2: 38 * 140, effectiveLengthMm: 2440, leastDimensionMm: 140,
  columnType: 'sawn',
  cD: 1.0, cM: 1.0, cT: 1.0, cF: 1.0, cI: 1.0,
};

test.describe.serial('Forge-274 · wood column buckling', () => {
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
      !!(window.forge && window.forge.woodcolumn
         && typeof window.forge.woodcolumn.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 SPF 2×6 strong axis l_e=2440/d=140 (cam #2)', async () => {
    const r = await page.evaluate((base) => window.forge.woodcolumn.analyse(base), BASE);
    expect(r.slendernessLeOverD).toBeCloseTo(17.43, 1);
    expect(r.cFactor).toBeCloseTo(0.8, 6);
    expect(r.cP).toBeGreaterThan(0.5);
    expect(r.cP).toBeLessThan(1.0);
    expect(r.fcPrimeMPa).toBeCloseTo(r.fStarCMPa * r.cP, 6);
    expect(r.pAllowN).toBeCloseTo(r.fcPrimeMPa * BASE.areaMm2, 6);
    await shot(page, 'sawn');
  });

  test('03 Glulam c=0.9 gives larger C_p than sawn (cam #3)', async () => {
    const sawn   = await page.evaluate((base) => window.forge.woodcolumn.analyse(base), BASE);
    const glulam = await page.evaluate((base) => window.forge.woodcolumn.analyse({
      ...base, columnType: 'glulam',
    }), BASE);
    expect(glulam.cFactor).toBeCloseTo(0.9, 6);
    expect(glulam.cP).toBeGreaterThan(sawn.cP);
    await shot(page, 'glulam');
  });

  test('04 Short column → C_p ≈ 1 (cam #4)', async () => {
    const r = await page.evaluate((base) => window.forge.woodcolumn.analyse({
      ...base, effectiveLengthMm: 500,
    }), BASE);
    expect(r.cP).toBeGreaterThan(0.98);
    expect(r.fcPrimeMPa).toBeGreaterThan(0.98 * r.fStarCMPa);
    await shot(page, 'short');
  });

  test('05 Long column → C_p ≪ 1, P_allow drops sharply (cam #5)', async () => {
    const short = await page.evaluate((base) => window.forge.woodcolumn.analyse({
      ...base, effectiveLengthMm: 500,
    }), BASE);
    const long  = await page.evaluate((base) => window.forge.woodcolumn.analyse({
      ...base, effectiveLengthMm: 6000,
    }), BASE);
    expect(long.cP).toBeLessThan(short.cP);
    expect(long.pAllowN).toBeLessThan(short.pAllowN);
    await shot(page, 'long');
  });

  test('06 Slenderness λ > 50 throws (cam #6)', async () => {
    let threw = false;
    try {
      await page.evaluate((base) => window.forge.woodcolumn.analyse({
        ...base, effectiveLengthMm: 2440, leastDimensionMm: 38,  // λ ≈ 64
      }), BASE);
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'slenderness-limit');
  });

  test('07 Panel renders F\'_c + P_allow rows', async () => {
    await page.evaluate(() => { window.__forgeOpenWoodColumnWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-woodcolumn-run"]').click();
    await page.waitForSelector('[data-testid="forge-woodcolumn-result"]', { timeout: 5000 });
    const fc = await page.locator('[data-testid="forge-woodcolumn-fcprime"]').innerText();
    const P  = await page.locator('[data-testid="forge-woodcolumn-pallow"]').innerText();
    expect(fc).toMatch(/F'_c/);
    expect(P).toMatch(/P_allow/);
  });

  test('08 Menu route opens wood column panel', async () => {
    await page.evaluate(() => { window.__forgeCloseWoodColumnWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.woodcolumn' } }));
    });
    await page.waitForSelector('[data-testid="forge-woodcolumn-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
