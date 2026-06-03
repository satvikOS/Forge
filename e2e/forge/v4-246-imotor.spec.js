// v4-246-imotor.spec.js — Forge-246 induction motor Thevenin + T-s.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-246-imotor';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const CHAPMAN = () => ({
  phaseVoltageV: 460 / Math.sqrt(3),
  frequencyHz: 60, poles: 4,
  stator_R1: 0.641, stator_X1: 1.106,
  rotor_R2: 0.332, rotor_X2: 0.464,
  mag_Xm: 26.3,
  slip: 0.022,
});

test.describe.serial('Forge-246 · induction motor Thevenin + T-s', () => {
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
      !!(window.forge && window.forge.inductionmotor
         && typeof window.forge.inductionmotor.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Chapman 7-5: n_s = 1800, n_m = 1760 rpm (cam #1)', async () => {
    const r = await page.evaluate((inp) => window.forge.inductionmotor.analyse(inp), CHAPMAN());
    expect(r.synchronousRpm).toBeCloseTo(1800, 6);
    expect(r.mechanicalRpm).toBeCloseTo(1800 * (1 - 0.022), 6);
    await shot(page, 'speeds');
  });

  test('03 Thevenin equivalents textbook (cam #2)', async () => {
    const r = await page.evaluate((inp) => window.forge.inductionmotor.analyse(inp), CHAPMAN());
    expect(r.thevenin_V).toBeCloseTo(254.7, 0);
    expect(r.thevenin_R).toBeCloseTo(0.59, 1);
    expect(r.thevenin_X).toBeCloseTo(1.06, 1);
    await shot(page, 'thevenin');
  });

  test('04 developed torque ≈ 62.8 N·m at s=0.022 (cam #3)', async () => {
    const r = await page.evaluate((inp) => window.forge.inductionmotor.analyse(inp), CHAPMAN());
    expect(r.developedTorqueNm).toBeCloseTo(62.8, 0);
    expect(r.airGapPowerW).toBeCloseTo(r.developedTorqueNm * r.synchronousRadPerS, 6);
    expect(r.mechPowerW).toBeCloseTo((1 - 0.022) * r.airGapPowerW, 6);
    await shot(page, 'T_d');
  });

  test('05 breakdown slip ≈ R₂/√(R_th² + (X_th+X₂)²) (cam #4)', async () => {
    const r = await page.evaluate((inp) => window.forge.inductionmotor.analyse(inp), CHAPMAN());
    const expected = 0.332 / Math.sqrt(r.thevenin_R * r.thevenin_R
                                       + (r.thevenin_X + 0.464) * (r.thevenin_X + 0.464));
    expect(r.breakdownSlip).toBeCloseTo(expected, 6);
    expect(r.breakdownTorqueNm).toBeGreaterThan(r.developedTorqueNm);
    await shot(page, 'breakdown');
  });

  test('06 starting current >> running current (cam #5)', async () => {
    const r = await page.evaluate((inp) => window.forge.inductionmotor.analyse(inp), CHAPMAN());
    expect(r.startingCurrentA).toBeGreaterThan(r.rotorCurrentA * 4);
    expect(r.startingTorqueNm).toBeGreaterThan(0);
    await shot(page, 'starting');
  });

  test('07 6-pole drops n_s to 1200 rpm', async () => {
    const r = await page.evaluate((inp) => window.forge.inductionmotor.analyse(inp),
      { ...CHAPMAN(), poles: 6 });
    expect(r.synchronousRpm).toBeCloseTo(1200, 6);
  });

  test('08 panel renders T_d, T_max, T_start rows', async () => {
    await page.evaluate(() => { window.__forgeOpenIMotorWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-imotor-run"]').click();
    await page.waitForSelector('[data-testid="forge-imotor-result"]', { timeout: 5000 });
    const td = await page.locator('[data-testid="forge-imotor-Td"]').innerText();
    const tmax = await page.locator('[data-testid="forge-imotor-Tmax"]').innerText();
    const tstart = await page.locator('[data-testid="forge-imotor-Tstart"]').innerText();
    expect(td).toMatch(/T_d/);
    expect(tmax).toMatch(/T_max/);
    expect(tstart).toMatch(/T_start/);
  });

  test('09 menu route fires imotor workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseIMotorWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.imotor' } }));
    });
    await page.waitForSelector('[data-testid="forge-imotor-panel"]', { timeout: 2000 });
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
