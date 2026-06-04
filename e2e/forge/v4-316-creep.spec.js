// v4-316-creep.spec.js — Forge-316 concrete creep + shrinkage ACI 209R-92.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-316-creep';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const STD = {
  sustainedStressMPa: 10, concreteModulusMPa: 30000,
  ambientHumidityPercent: 50, loadingAgeDays: 28, timeAfterLoadingDays: 10000,
  ultimateCreepCoeff: 0, ultimateShrinkageStrain: 0,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-316 · creep + shrinkage', () => {
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
      !!(window.forge && window.forge.concretecreep
         && typeof window.forge.concretecreep.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 σ=10, H=50, t_la=28, t=10000: φ≈1.78, ε_sh≈692 µε (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.concretecreep.analyse(b), STD);
    expect(r.humidityFactorCreep).toBeCloseTo(1.27 - 0.0067 * 50, 5);
    expect(r.humidityFactorShrink).toBeCloseTo(1.40 - 0.0102 * 50, 5);
    expect(r.creepCoefficient).toBeGreaterThan(1.7);
    expect(r.creepCoefficient).toBeLessThan(1.85);
    expect(r.shrinkageStrain * 1e6).toBeGreaterThan(680);
    expect(r.shrinkageStrain * 1e6).toBeLessThan(700);
    expect(r.instantaneousStrain).toBeCloseTo(10 / 30000, 7);
    await shot(page, 'standard');
  });

  test('03 Short-term t=1 day: φ tiny, ε_sh tiny (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.concretecreep.analyse({
      sustainedStressMPa: 10, concreteModulusMPa: 30000,
      ambientHumidityPercent: 50, loadingAgeDays: 28, timeAfterLoadingDays: 1,
      ultimateCreepCoeff: 0, ultimateShrinkageStrain: 0,
    }));
    expect(r.creepCoefficient).toBeLessThan(0.20);
    expect(r.shrinkageStrain * 1e6).toBeLessThan(25);
    await shot(page, 'short-term');
  });

  test('04 High H drops creep + shrinkage (cam #4)', async () => {
    const r50 = await page.evaluate((b) => window.forge.concretecreep.analyse(b), STD);
    const r90 = await page.evaluate((b) => window.forge.concretecreep.analyse({
      ...b, ambientHumidityPercent: 90,
    }), STD);
    expect(r90.humidityFactorCreep).toBeLessThan(r50.humidityFactorCreep);
    expect(r90.humidityFactorShrink).toBeLessThan(r50.humidityFactorShrink);
    expect(r90.creepCoefficient).toBeLessThan(r50.creepCoefficient);
    await shot(page, 'humid');
  });

  test('05 ε_total = ε_inst·(1+φ) + ε_sh identity (cam #5)', async () => {
    const r = await page.evaluate((b) => window.forge.concretecreep.analyse(b), STD);
    const identity = r.instantaneousStrain * (1 + r.creepCoefficient) + r.shrinkageStrain;
    expect(r.totalLongTermStrain).toBeCloseTo(identity, 8);
    expect(r.creepStrain).toBeCloseTo(r.instantaneousStrain * r.creepCoefficient, 8);
    await shot(page, 'identity');
  });

  test('06 User φ_u override bypasses ACI default (cam #6)', async () => {
    const r = await page.evaluate(() => window.forge.concretecreep.analyse({
      sustainedStressMPa: 10, concreteModulusMPa: 30000,
      ambientHumidityPercent: 50, loadingAgeDays: 28, timeAfterLoadingDays: 10000,
      ultimateCreepCoeff: 3.0, ultimateShrinkageStrain: 0,
    }));
    expect(r.appliedUltimateCreep).toBe(3.0);
    expect(r.creepCoefficient).toBeGreaterThan(2.8);
    await shot(page, 'override');
  });

  test('07 Panel renders φ + ε_sh + ε_total rows', async () => {
    await page.evaluate(() => { window.__forgeOpenConcreteCreepWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-cr-run"]').click();
    await page.waitForSelector('[data-testid="forge-cr-result"]', { timeout: 5000 });
    const phi = await page.locator('[data-testid="forge-cr-phi"]').innerText();
    const esh = await page.locator('[data-testid="forge-cr-eps_sh"]').innerText();
    const tot = await page.locator('[data-testid="forge-cr-total"]').innerText();
    expect(phi).toMatch(/φ/);
    expect(esh).toMatch(/ε_sh/);
    expect(tot).toMatch(/ε_total/);
  });

  test('08 Menu route opens creep panel', async () => {
    await page.evaluate(() => { window.__forgeCloseConcreteCreepWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.concretecreep' } }));
    });
    await page.waitForSelector('[data-testid="forge-cr-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
