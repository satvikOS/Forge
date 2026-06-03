// v4-257-rccolumn.spec.js — Forge-257 RC column ACI 318-19 §22.4.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-257-rccolumn';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const NILSON = () => ({
  tieType: 'tied',
  grossAreaM2: 0.16, effectiveDepthM: 0.34, overallDepthM: 0.4,
  widthM: 0.4, coverM: 0.06,
  steelAreaTotalM2: 2.322e-3,
  concreteFcPa: 28e6, steelFyPa: 414e6,
});

test.describe.serial('Forge-257 · RC column ACI 318-19 §22.4', () => {
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

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.rccolumn
         && typeof window.forge.rccolumn.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Nilson textbook tied: P_no ≈ 4714 kN, φPn,max ≈ 2451 kN (cam #1)', async () => {
    const r = await page.evaluate((inp) => window.forge.rccolumn.analyse(inp), NILSON());
    expect(r.phi).toBe(0.65);
    expect(r.maxFactor).toBe(0.80);
    expect(r.beta1).toBeCloseTo(0.85, 9);
    expect(r.nominalAxialN / 1000).toBeCloseTo(4714, 0);
    expect(r.designMaxAxialN / 1000).toBeCloseTo(2451, 0);
    await shot(page, 'tied-Pmax');
  });

  test('03 Spiral version has higher φ (cam #2)', async () => {
    const r = await page.evaluate((inp) => window.forge.rccolumn.analyse(inp),
      { ...NILSON(), tieType: 'spiral' });
    expect(r.phi).toBe(0.75);
    expect(r.maxFactor).toBe(0.85);
    expect(r.designMaxAxialN / 1000).toBeCloseTo(3005, 0);
    await shot(page, 'spiral');
  });

  test('04 spiral > tied in design axial (cam #3)', async () => {
    const tied = await page.evaluate((inp) => window.forge.rccolumn.analyse(inp), NILSON());
    const spiral = await page.evaluate((inp) => window.forge.rccolumn.analyse(inp),
      { ...NILSON(), tieType: 'spiral' });
    expect(spiral.designMaxAxialN).toBeGreaterThan(tied.designMaxAxialN);
    expect(spiral.designMaxAxialN / tied.designMaxAxialN).toBeCloseTo(0.75 * 0.85 / (0.65 * 0.80), 4);
    await shot(page, 'spiral-vs-tied');
  });

  test('05 balanced point P_nb ≈ 1623 kN, M_nb ≈ 318 kN·m (cam #4)', async () => {
    const r = await page.evaluate((inp) => window.forge.rccolumn.analyse(inp), NILSON());
    expect(r.balancedAxialN / 1000).toBeCloseTo(1623, 0);
    expect(r.balancedMomentNm / 1000).toBeCloseTo(318, 0);
    await shot(page, 'balanced');
  });

  test('06 design balanced applies φ (cam #5)', async () => {
    const r = await page.evaluate((inp) => window.forge.rccolumn.analyse(inp), NILSON());
    expect(r.designBalancedAxialN).toBeCloseTo(0.65 * r.balancedAxialN, 6);
    expect(r.designBalancedMomentNm).toBeCloseTo(0.65 * r.balancedMomentNm, 6);
    await shot(page, 'design-bal');
  });

  test('07 zero A_st throws', async () => {
    let threw = false;
    try {
      await page.evaluate((inp) => window.forge.rccolumn.analyse(inp),
        { ...NILSON(), steelAreaTotalM2: 0 });
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
  });

  test('08 panel renders P_max and balanced rows', async () => {
    await page.evaluate(() => { window.__forgeOpenRcColumnWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-rccolumn-run"]').click();
    await page.waitForSelector('[data-testid="forge-rccolumn-result"]', { timeout: 5000 });
    const pmax = await page.locator('[data-testid="forge-rccolumn-Pmax"]').innerText();
    const pmb  = await page.locator('[data-testid="forge-rccolumn-PMb"]').innerText();
    expect(pmax).toMatch(/φPn,max/);
    expect(pmb).toMatch(/φP_nb/);
  });

  test('09 menu route fires rccolumn workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseRcColumnWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.rccolumn' } }));
    });
    await page.waitForSelector('[data-testid="forge-rccolumn-panel"]', { timeout: 2000 });
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
