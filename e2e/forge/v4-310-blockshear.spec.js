// v4-310-blockshear.spec.js — Forge-310 block-shear rupture AISC §J4.3.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-310-blockshear';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const STD = {
  A_gv_mm2: 2000, A_nv_mm2: 1600, A_nt_mm2: 250,
  U_bs: 1.0, Fy_MPa: 345, Fu_MPa: 450,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-310 · block shear', () => {
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
      !!(window.forge && window.forge.blockshear
         && typeof window.forge.blockshear.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Shear tab A992: R_n=526.5 kN, φR_n=394.9 kN, yielding governs (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.blockshear.analyse(b), STD);
    expect(r.shearRuptureCapN).toBe(0.6 * 450 * 1600);
    expect(r.shearYieldingCapN).toBe(0.6 * 345 * 2000);
    expect(r.tensionRuptureN).toBe(1.0 * 450 * 250);
    expect(r.governingPath).toBe(2);
    expect(r.nominalCapN).toBe(414000 + 112500);
    expect(r.LRFDcapN).toBe(0.75 * 526500);
    expect(r.ASDcapN).toBe(526500 / 2.00);
    await shot(page, 'standard');
  });

  test('03 Small A_nv → shear rupture governs (cam #3)', async () => {
    const r = await page.evaluate((b) => window.forge.blockshear.analyse({
      ...b, A_nv_mm2: 1200,
    }), STD);
    expect(r.governingPath).toBe(1);
    expect(r.governingShearN).toBeCloseTo(r.shearRuptureCapN, 4);
    await shot(page, 'rupture-gov');
  });

  test('04 Non-uniform U_bs=0.5 halves tension term (cam #4)', async () => {
    const u1 = await page.evaluate((b) => window.forge.blockshear.analyse(b), STD);
    const u5 = await page.evaluate((b) => window.forge.blockshear.analyse({
      ...b, U_bs: 0.5,
    }), STD);
    expect(u5.tensionRuptureN).toBeCloseTo(u1.tensionRuptureN * 0.5, 4);
    await shot(page, 'ubs');
  });

  test('05 LRFD/ASD identity: φ·R_n × 2 / (R_n/Ω) = 0.75·2/(1/2) = 3 (cam #5)', async () => {
    const r = await page.evaluate((b) => window.forge.blockshear.analyse(b), STD);
    expect(r.LRFDcapN * 2 / r.ASDcapN).toBeCloseTo(0.75 * 2 * 2.00, 6);
    expect(r.nominalCapN).toBeCloseTo(r.governingShearN + r.tensionRuptureN, 4);
    await shot(page, 'identity');
  });

  test('06 A_nv > A_gv throws (cam #6)', async () => {
    const err = await page.evaluate(() => {
      try { window.forge.blockshear.analyse({
        A_gv_mm2: 1000, A_nv_mm2: 1200, A_nt_mm2: 250,
        U_bs: 1.0, Fy_MPa: 345, Fu_MPa: 450,
      }); return null; }
      catch (e) { return String(e.message || e); }
    });
    expect(err).toMatch(/A_nv.*A_gv/);
    await shot(page, 'rejected');
  });

  test('07 Panel renders R_n + φR_n + path banner', async () => {
    await page.evaluate(() => { window.__forgeOpenBlockShearWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-bs-run"]').click();
    await page.waitForSelector('[data-testid="forge-bs-result"]', { timeout: 5000 });
    const Rn  = await page.locator('[data-testid="forge-bs-Rn"]').innerText();
    const phi = await page.locator('[data-testid="forge-bs-LRFD"]').innerText();
    const path = await page.locator('[data-testid="forge-bs-path"]').innerText();
    expect(Rn).toMatch(/R_n/);
    expect(phi).toMatch(/φR_n/);
    expect(path).toMatch(/Governing/);
  });

  test('08 Menu route opens block shear panel', async () => {
    await page.evaluate(() => { window.__forgeCloseBlockShearWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.blockshear' } }));
    });
    await page.waitForSelector('[data-testid="forge-bs-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
