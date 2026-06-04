// v4-311-sectclass.spec.js — Forge-311 AISC §B4.1b section classification.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-311-sectclass';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const W21x73 = {
  bf_mm: 210, tf_mm: 14.4, d_mm: 534, tw_mm: 11.4,
  Fy_MPa: 345, E_MPa: 200000,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-311 · section classification', () => {
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
      !!(window.forge && window.forge.sectclass
         && typeof window.forge.sectclass.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 W21×73 A992 = compact (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.sectclass.analyse(b), W21x73);
    const sqrtR = Math.sqrt(200000 / 345);
    expect(r.flangeSlenderness).toBeCloseTo(210 / 2 / 14.4, 4);
    expect(r.flangeLambda_p).toBeCloseTo(0.38 * sqrtR, 3);
    expect(r.flangeLambda_r).toBeCloseTo(1.00 * sqrtR, 3);
    expect(r.flangeClass).toBe('compact');
    expect(r.webSlenderness).toBeCloseTo((534 - 2 * 14.4) / 11.4, 3);
    expect(r.webLambda_p).toBeCloseTo(3.76 * sqrtR, 2);
    expect(r.webLambda_r).toBeCloseTo(5.70 * sqrtR, 2);
    expect(r.webClass).toBe('compact');
    expect(r.overallClass).toBe('compact');
    await shot(page, 'compact');
  });

  test('03 Thin flange → non-compact (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.sectclass.analyse({
      bf_mm: 210, tf_mm: 8, d_mm: 534, tw_mm: 11.4,
      Fy_MPa: 345, E_MPa: 200000,
    }));
    expect(r.flangeClass).toBe('non-compact');
    expect(r.overallClass).toBe('non-compact');
    await shot(page, 'noncompact');
  });

  test('04 Slender plate-girder web (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.sectclass.analyse({
      bf_mm: 300, tf_mm: 25, d_mm: 1200, tw_mm: 8,
      Fy_MPa: 345, E_MPa: 200000,
    }));
    expect(r.webClass).toBe('slender');
    expect(r.overallClass).toBe('slender');  // slender web governs over compact flange
    await shot(page, 'slender');
  });

  test('05 Higher F_y tightens λ_p (cam #5)', async () => {
    const g50 = await page.evaluate((b) => window.forge.sectclass.analyse(b), W21x73);
    const g65 = await page.evaluate((b) => window.forge.sectclass.analyse({
      ...b, Fy_MPa: 450,
    }), W21x73);
    expect(g65.flangeLambda_p).toBeLessThan(g50.flangeLambda_p);
    expect(g65.webLambda_p).toBeLessThan(g50.webLambda_p);
    expect(g65.flangeLambda_p / g50.flangeLambda_p).toBeCloseTo(Math.sqrt(345 / 450), 4);
    await shot(page, 'higher-Fy');
  });

  test('06 Overall class = max(flange, web) (cam #6)', async () => {
    const r = await page.evaluate(() => window.forge.sectclass.analyse({
      bf_mm: 200, tf_mm: 8, d_mm: 1200, tw_mm: 8,
      Fy_MPa: 345, E_MPa: 200000,
    }));
    expect(r.webClass).toBe('slender');
    expect(r.overallClass).toBe('slender');
    await shot(page, 'overall');
  });

  test('07 Panel renders flange + web + overall sections', async () => {
    await page.evaluate(() => { window.__forgeOpenSectionClassWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-sc-run"]').click();
    await page.waitForSelector('[data-testid="forge-sc-result"]', { timeout: 5000 });
    const fl = await page.locator('[data-testid="forge-sc-flange"]').innerText();
    const wb = await page.locator('[data-testid="forge-sc-web"]').innerText();
    const ov = await page.locator('[data-testid="forge-sc-overall"]').innerText();
    expect(fl).toMatch(/Flange/);
    expect(wb).toMatch(/Web/);
    expect(ov).toMatch(/Section/);
  });

  test('08 Menu route opens classification panel', async () => {
    await page.evaluate(() => { window.__forgeCloseSectionClassWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.sectclass' } }));
    });
    await page.waitForSelector('[data-testid="forge-sc-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
