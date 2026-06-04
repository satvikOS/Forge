// v4-302-webshear.spec.js — Forge-302 web shear AISC §G2.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-302-webshear';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const W21x73 = {
  overallDepthMm: 534, webThicknessMm: 11.4, flangeThicknessMm: 14.4,
  Fy_MPa: 345, E_MPa: 200000, stiffenerSpacingMm: 0, compactRolled: true,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-302 · web shear', () => {
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
      !!(window.forge && window.forge.webshear
         && typeof window.forge.webshear.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 W21×73 yielding regime, V_n ≈ 1260 kN, φ=1.0 (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.webshear.analyse(b), W21x73);
    expect(r.clearWebDepthMm).toBeCloseTo(505.2, 4);
    expect(r.webSlenderness).toBeCloseTo(44.32, 2);
    expect(r.k_v).toBe(5.34);
    expect(r.regime).toBe(1);
    expect(r.C_v1).toBe(1.0);
    expect(r.nominalShearN / 1000).toBeGreaterThan(1259);
    expect(r.nominalShearN / 1000).toBeLessThan(1261);
    expect(r.phi).toBe(1.0);
    expect(r.LRFDshearN).toBeCloseTo(r.nominalShearN, 5);
    await shot(page, 'w21x73');
  });

  test('03 Rolled-bonus toggle drops φ from 1.0 to 0.9 (cam #3)', async () => {
    const r1 = await page.evaluate((b) => window.forge.webshear.analyse(b), W21x73);
    const r2 = await page.evaluate((b) => window.forge.webshear.analyse({
      ...b, compactRolled: false,
    }), W21x73);
    expect(r1.phi).toBe(1.0);
    expect(r2.phi).toBe(0.9);
    expect(r2.omega).toBeCloseTo(1.67, 4);
    expect(r2.LRFDshearN / r1.LRFDshearN).toBeCloseTo(0.9, 5);
    await shot(page, 'phi');
  });

  test('04 Plate girder slender web → elastic buckling regime (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.webshear.analyse({
      overallDepthMm: 918, webThicknessMm: 9.1, flangeThicknessMm: 24,
      Fy_MPa: 345, E_MPa: 200000, stiffenerSpacingMm: 0, compactRolled: false,
    }));
    expect(r.webSlenderness).toBeCloseTo(95.6, 0);
    expect(r.regime).toBe(3);
    expect(r.C_v1).toBeLessThan(1.0);
    expect(r.C_v1).toBeGreaterThan(0.5);
    await shot(page, 'girder');
  });

  test('05 Stiffener spacing increases k_v + boosts V_n (cam #5)', async () => {
    const noStiff = await page.evaluate(() => window.forge.webshear.analyse({
      overallDepthMm: 918, webThicknessMm: 9.1, flangeThicknessMm: 24,
      Fy_MPa: 345, E_MPa: 200000, stiffenerSpacingMm: 0, compactRolled: false,
    }));
    const stiff = await page.evaluate(() => window.forge.webshear.analyse({
      overallDepthMm: 918, webThicknessMm: 9.1, flangeThicknessMm: 24,
      Fy_MPa: 345, E_MPa: 200000, stiffenerSpacingMm: 870, compactRolled: false,
    }));
    expect(stiff.k_v).toBeCloseTo(10.0, 4);
    expect(stiff.nominalShearN).toBeGreaterThan(noStiff.nominalShearN);
    await shot(page, 'stiff');
  });

  test('06 V_n = 0.6·Fy·d·tw·C_v1 identity (cam #6)', async () => {
    const r = await page.evaluate((b) => window.forge.webshear.analyse(b), W21x73);
    const calc = 0.6 * 345 * 534 * 11.4 * r.C_v1;
    expect(r.nominalShearN).toBeCloseTo(calc, 1);
    await shot(page, 'identity');
  });

  test('07 Panel renders regime + V_n + φV_n + ASD rows', async () => {
    await page.evaluate(() => { window.__forgeOpenWebShearWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-webshear-run"]').click();
    await page.waitForSelector('[data-testid="forge-webshear-result"]', { timeout: 5000 });
    const reg = await page.locator('[data-testid="forge-webshear-regime"]').innerText();
    const Vn  = await page.locator('[data-testid="forge-webshear-Vn"]').innerText();
    const ph  = await page.locator('[data-testid="forge-webshear-LRFD"]').innerText();
    const om  = await page.locator('[data-testid="forge-webshear-ASD"]').innerText();
    expect(reg).toMatch(/Yielding|buckling/);
    expect(Vn).toMatch(/V_n/);
    expect(ph).toMatch(/φV_n/);
    expect(om).toMatch(/V_n\/Ω/);
  });

  test('08 Menu route opens web-shear panel', async () => {
    await page.evaluate(() => { window.__forgeCloseWebShearWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.webshear' } }));
    });
    await page.waitForSelector('[data-testid="forge-webshear-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
