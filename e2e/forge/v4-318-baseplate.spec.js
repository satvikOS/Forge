// v4-318-baseplate.spec.js — Forge-318 steel column base plate.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-318-baseplate';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const STD = {
  appliedAxialKn: 2000,
  plateWidthB_mm: 600, plateLengthN_mm: 600,
  columnDepthD_mm: 308, columnFlangeBf_mm: 305,
  supportWidthB2_mm: 1200, supportLengthN2_mm: 1200,
  fc_MPa: 28, Fy_MPa: 250,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-318 · base plate', () => {
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
      !!(window.forge && window.forge.baseplate
         && typeof window.forge.baseplate.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 W12×65 fixture: P_p=17136 kN, φP_p=11138 kN, t_req=46.5 (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.baseplate.analyse(b), STD);
    expect(r.A_1_mm2).toBe(360000);
    expect(r.A_2_mm2).toBe(1440000);
    expect(r.sqrtA2A1).toBe(2.0);
    expect(r.bearingStrength_Pp_kN).toBeCloseTo(0.85 * 28 * 360000 * 2.0 / 1000, 0);
    expect(r.LRFD_phiPp_kN).toBeCloseTo(0.65 * r.bearingStrength_Pp_kN, 0);
    expect(r.projection_m_mm).toBeCloseTo((600 - 0.95 * 308) / 2, 1);
    expect(r.projection_n_mm).toBeCloseTo((600 - 0.80 * 305) / 2, 1);
    expect(r.requiredPlateThickness_mm).toBeGreaterThan(46);
    expect(r.requiredPlateThickness_mm).toBeLessThan(47);
    expect(r.bearingPasses).toBe(true);
    await shot(page, 'standard');
  });

  test('03 √(A_2/A_1) caps at 2.0 (cam #3)', async () => {
    const r1 = await page.evaluate((b) => window.forge.baseplate.analyse(b), STD);
    const r2 = await page.evaluate((b) => window.forge.baseplate.analyse({
      ...b, supportWidthB2_mm: 2400, supportLengthN2_mm: 2400,  // A_2/A_1 = 16 → √=4 capped to 2
    }), STD);
    expect(r1.sqrtA2A1).toBe(2.0);
    expect(r2.sqrtA2A1).toBe(2.0);
    expect(r2.bearingStrength_Pp_kN).toBeCloseTo(r1.bearingStrength_Pp_kN, 1);
    await shot(page, 'cap');
  });

  test('04 Smaller support reduces P_p (cam #4)', async () => {
    const r_big = await page.evaluate((b) => window.forge.baseplate.analyse(b), STD);
    const r_sm  = await page.evaluate((b) => window.forge.baseplate.analyse({
      ...b, supportWidthB2_mm: 700, supportLengthN2_mm: 700,
    }), STD);
    expect(r_sm.sqrtA2A1).toBeLessThan(r_big.sqrtA2A1);
    expect(r_sm.bearingStrength_Pp_kN).toBeLessThan(r_big.bearingStrength_Pp_kN);
    expect(r_sm.sqrtA2A1).toBeCloseTo(Math.sqrt(700 * 700 / 360000), 4);
    await shot(page, 'small-support');
  });

  test('05 Overload trips bearing fail (cam #5)', async () => {
    const r = await page.evaluate((b) => window.forge.baseplate.analyse({
      ...b, appliedAxialKn: 15000,
    }), STD);
    expect(r.bearingPasses).toBe(false);
    expect(r.requiredPlateThickness_mm).toBeGreaterThan(STD.appliedAxialKn / 1000); // bigger
    await shot(page, 'overload');
  });

  test('06 Governing projection = max(m, n, n′) (cam #6)', async () => {
    const r = await page.evaluate((b) => window.forge.baseplate.analyse(b), STD);
    expect(r.governingProjection_mm).toBeCloseTo(
      Math.max(Math.abs(r.projection_m_mm), Math.abs(r.projection_n_mm), r.thorntonLambda_nprime_mm),
      4);
    await shot(page, 'projections');
  });

  test('07 Panel renders φP_p + t_req + passes banner', async () => {
    await page.evaluate(() => { window.__forgeOpenBasePlateWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-bp-run"]').click();
    await page.waitForSelector('[data-testid="forge-bp-result"]', { timeout: 5000 });
    const phi  = await page.locator('[data-testid="forge-bp-phiPp"]').innerText();
    const treq = await page.locator('[data-testid="forge-bp-treq"]').innerText();
    const pas  = await page.locator('[data-testid="forge-bp-passes"]').innerText();
    expect(phi).toMatch(/φP_p/);
    expect(treq).toMatch(/t_req/);
    expect(pas).toMatch(/Bearing/);
  });

  test('08 Menu route opens base plate panel', async () => {
    await page.evaluate(() => { window.__forgeCloseBasePlateWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.baseplate' } }));
    });
    await page.waitForSelector('[data-testid="forge-bp-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
