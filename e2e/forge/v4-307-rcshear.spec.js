// v4-307-rcshear.spec.js — Forge-307 RC one-way shear ACI 318-19 §22.5.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-307-rcshear';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const STD = {
  widthMm: 300, effectiveDepthMm: 400, fc_MPa: 28,
  shearReinfAreaMm2: 142, stirrupSpacingMm: 200, fyt_MPa: 420, lambda: 1.0,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-307 · RC shear', () => {
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
      !!(window.forge && window.forge.rcshear
         && typeof window.forge.rcshear.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 300×400 f_c=28 A_v=142@200: V_n=227, φV_n=170 (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.rcshear.analyse(b), STD);
    expect(r.Vc_kN).toBeCloseTo(0.17 * 1 * Math.sqrt(28) * 300 * 400 / 1000, 2);
    expect(r.Vs_kN).toBeCloseTo(142 * 420 * 400 / 200 / 1000, 2);
    expect(r.Vn_kN).toBeGreaterThan(226);
    expect(r.Vn_kN).toBeLessThan(228);
    expect(r.phiVn_kN).toBeCloseTo(0.75 * r.Vn_kN, 5);
    expect(r.maxStirrupSpacingMm).toBe(200);
    expect(r.spacingMeetsLimit).toBe(true);
    expect(r.crushingControls).toBe(false);
    await shot(page, 'standard');
  });

  test('03 Unreinforced: V_s=0, V_n=V_c (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.rcshear.analyse({
      widthMm: 300, effectiveDepthMm: 400, fc_MPa: 28,
      shearReinfAreaMm2: 0, stirrupSpacingMm: 0, fyt_MPa: 420, lambda: 1.0,
    }));
    expect(r.Vs_kN).toBe(0);
    expect(r.Vn_kN).toBeCloseTo(r.Vc_kN, 5);
    await shot(page, 'plain');
  });

  test('04 Heavy stirrups trip crushing cap V_n,max (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.rcshear.analyse({
      widthMm: 300, effectiveDepthMm: 400, fc_MPa: 28,
      shearReinfAreaMm2: 600, stirrupSpacingMm: 50, fyt_MPa: 420, lambda: 1.0,
    }));
    expect(r.crushingControls).toBe(true);
    expect(r.Vn_kN).toBeCloseTo(r.VnMax_kN, 4);
    await shot(page, 'crushing');
  });

  test('05 Lightweight λ=0.75 scales V_c linearly (cam #5)', async () => {
    const norm = await page.evaluate((b) => window.forge.rcshear.analyse(b), STD);
    const lw   = await page.evaluate((b) => window.forge.rcshear.analyse({
      ...b, lambda: 0.75,
    }), STD);
    expect(lw.Vc_kN / norm.Vc_kN).toBeCloseTo(0.75, 5);
    expect(lw.Vs_kN).toBeCloseTo(norm.Vs_kN, 5);  // stirrup V_s unaffected
    await shot(page, 'lightweight');
  });

  test('06 V_s > 0.33·√f_c·b·d drops s_max to d/4 (cam #6)', async () => {
    const r = await page.evaluate(() => window.forge.rcshear.analyse({
      widthMm: 300, effectiveDepthMm: 400, fc_MPa: 28,
      shearReinfAreaMm2: 400, stirrupSpacingMm: 150, fyt_MPa: 420, lambda: 1.0,
    }));
    expect(r.Vs_kN).toBeGreaterThan(0.33 * Math.sqrt(28) * 300 * 400 / 1000);
    expect(r.maxStirrupSpacingMm).toBe(100);  // d/4 = 100
    expect(r.spacingMeetsLimit).toBe(false);  // 150 > 100
    await shot(page, 'tight-spacing');
  });

  test('07 Panel renders V_n + φV_n + spacing banner', async () => {
    await page.evaluate(() => { window.__forgeOpenRCShearWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-rcsh-run"]').click();
    await page.waitForSelector('[data-testid="forge-rcsh-result"]', { timeout: 5000 });
    const Vn = await page.locator('[data-testid="forge-rcsh-Vn"]').innerText();
    const phi = await page.locator('[data-testid="forge-rcsh-phiVn"]').innerText();
    const sp  = await page.locator('[data-testid="forge-rcsh-spacing"]').innerText();
    expect(Vn).toMatch(/V_n/);
    expect(phi).toMatch(/φV_n/);
    expect(sp).toMatch(/Spacing/);
  });

  test('08 Menu route opens RC shear panel', async () => {
    await page.evaluate(() => { window.__forgeCloseRCShearWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.rcshear' } }));
    });
    await page.waitForSelector('[data-testid="forge-rcsh-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
