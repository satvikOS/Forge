// v4-305-hertzpoint.spec.js — Forge-305 Hertz point contact.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-305-hertzpoint';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const STEEL_BALL = {
  normalForceN: 1000, radius1Mm: 6, radius2Mm: 1e9,
  E1_MPa: 200000, E2_MPa: 200000, nu1: 0.3, nu2: 0.3,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-305 · Hertz point', () => {
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
      !!(window.forge && window.forge.hertzpoint
         && typeof window.forge.hertzpoint.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 12 mm ball on flat steel race: E*=110 GPa, p_max≈4 GPa (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.hertzpoint.analyse(b), STEEL_BALL);
    expect(r.effectiveModulusMPa).toBeCloseTo(200000 / (2 * (1 - 0.09)), 0);
    expect(r.effectiveRadiusMm).toBeCloseTo(6, 5);
    expect(r.contactRadiusMm).toBeGreaterThan(0.34);
    expect(r.contactRadiusMm).toBeLessThan(0.35);
    expect(r.maxPressureMPa).toBeGreaterThan(4000);
    expect(r.maxPressureMPa).toBeLessThan(4030);
    expect(r.meanPressureMPa).toBeCloseTo(r.maxPressureMPa * 2 / 3, 4);
    expect(r.maxShearStressMPa).toBeCloseTo(r.maxPressureMPa * 0.31, 4);
    expect(r.depthOfMaxShearMm).toBeCloseTo(r.contactRadiusMm * 0.48, 6);
    await shot(page, 'ball');
  });

  test('03 a ∝ F^(1/3), p_max ∝ F^(1/3) (cam #3)', async () => {
    const r1 = await page.evaluate((b) => window.forge.hertzpoint.analyse(b), STEEL_BALL);
    const r2 = await page.evaluate((b) => window.forge.hertzpoint.analyse({
      ...b, normalForceN: 2000,
    }), STEEL_BALL);
    expect(r2.contactRadiusMm / r1.contactRadiusMm).toBeCloseTo(Math.cbrt(2), 5);
    expect(r2.maxPressureMPa / r1.maxPressureMPa).toBeCloseTo(Math.cbrt(2), 5);
    await shot(page, 'F-scaling');
  });

  test('04 Two equal balls: R* halves, a × 0.7937 (cam #4)', async () => {
    const plane = await page.evaluate((b) => window.forge.hertzpoint.analyse(b), STEEL_BALL);
    const twoBalls = await page.evaluate((b) => window.forge.hertzpoint.analyse({
      ...b, radius2Mm: 6,
    }), STEEL_BALL);
    expect(twoBalls.effectiveRadiusMm).toBeCloseTo(3.0, 5);
    expect(twoBalls.contactRadiusMm / plane.contactRadiusMm)
      .toBeCloseTo(Math.cbrt(0.5), 4);
    await shot(page, 'twin-balls');
  });

  test('05 δ ∝ F^(2/3) (cam #5)', async () => {
    const r1 = await page.evaluate((b) => window.forge.hertzpoint.analyse(b), STEEL_BALL);
    const r2 = await page.evaluate((b) => window.forge.hertzpoint.analyse({
      ...b, normalForceN: 4000,
    }), STEEL_BALL);
    expect(r2.mutualApproachMm / r1.mutualApproachMm)
      .toBeCloseTo(Math.cbrt(16), 4);
    await shot(page, 'approach');
  });

  test('06 p_max = (6·F·E*²/(π³·R*²))^(1/3) closed-form identity (cam #6)', async () => {
    const r = await page.evaluate((b) => window.forge.hertzpoint.analyse(b), STEEL_BALL);
    const closed = Math.cbrt(6 * 1000 * Math.pow(r.effectiveModulusMPa, 2)
                  / (Math.pow(Math.PI, 3) * Math.pow(r.effectiveRadiusMm, 2)));
    expect(r.maxPressureMPa).toBeCloseTo(closed, 3);
    await shot(page, 'identity');
  });

  test('07 Panel renders p_max + τ_max rows', async () => {
    await page.evaluate(() => { window.__forgeOpenHertzPointWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-hpt-run"]').click();
    await page.waitForSelector('[data-testid="forge-hpt-result"]', { timeout: 5000 });
    const p = await page.locator('[data-testid="forge-hpt-pmax"]').innerText();
    const t = await page.locator('[data-testid="forge-hpt-tau"]').innerText();
    expect(p).toMatch(/p_max/);
    expect(t).toMatch(/τ_max/);
  });

  test('08 Menu route opens Hertz panel', async () => {
    await page.evaluate(() => { window.__forgeCloseHertzPointWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.hertzpoint' } }));
    });
    await page.waitForSelector('[data-testid="forge-hpt-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
