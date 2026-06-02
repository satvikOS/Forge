// v4-212-fatigue.spec.js — Forge-212 S-N fatigue calculator.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-212-fatigue';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-212 · S-N fatigue', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.fatigue
         && typeof window.forge.fatigue.cyclesToFailure === 'function'
         && typeof window.forge.fatigue.cumulativeDamage === 'function'));
    expect(has).toBe(true);
  });

  test('02 material defaults loaded (cam #1)', async () => {
    const r = await page.evaluate(() => ({
      ms: window.forge.fatigue.materialDefaults('mild-steel'),
      al: window.forge.fatigue.materialDefaults('7075-T6'),
    }));
    expect(r.ms.sigmaFCoef).toBeCloseTo(1000, 9);
    expect(r.ms.bExponent).toBeCloseTo(-0.085, 9);
    expect(r.al.sigmaFCoef).toBeGreaterThan(1000);
    await shot(page, 'materials');
  });

  test('03 Basquin identity Nf at σ=σf is 0.5 (cam #2)', async () => {
    const Nf = await page.evaluate(() =>
      window.forge.fatigue.cyclesToFailure(1000, 1000, -0.085));
    expect(Nf).toBeCloseTo(0.5, 9);
    await shot(page, 'basquin');
  });

  test('04 Miner damage sums = totalDamage (cam #3)', async () => {
    const r = await page.evaluate(() => {
      const mat = window.forge.fatigue.materialDefaults('mild-steel');
      return window.forge.fatigue.cumulativeDamage({
        material: mat,
        blocks: [
          { stressAmplitudeMPa: 500, appliedCycles: 100 },
          { stressAmplitudeMPa: 400, appliedCycles: 500 },
          { stressAmplitudeMPa: 300, appliedCycles: 1000 },
        ],
      });
    });
    expect(r.perBlock.length).toBe(3);
    const sum = r.perBlock.reduce((s, b) => s + b.damageContribution, 0);
    expect(Math.abs(sum - r.totalDamage)).toBeLessThan(1e-9);
    expect(r.failed).toBe(false);
    expect(r.cyclesRemaining).toBeGreaterThan(0);
    await shot(page, 'miner');
  });

  test('05 overload triggers failed flag (cam #4)', async () => {
    const r = await page.evaluate(() => {
      const mat = window.forge.fatigue.materialDefaults('mild-steel');
      return window.forge.fatigue.cumulativeDamage({
        material: mat,
        blocks: [{ stressAmplitudeMPa: 1000, appliedCycles: 1 }],
      });
    });
    expect(r.failed).toBe(true);
    expect(r.totalDamage).toBeGreaterThanOrEqual(1);
    await shot(page, 'overload');
  });

  test('06 open the workbench panel + run (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenFatigueWorkbench?.(); });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-fatigue-panel"]')).toBeVisible();
    await page.locator('[data-testid="forge-fatigue-run"]').click();
    await page.waitForSelector('[data-testid="forge-fatigue-result"]', { timeout: 5000 });
    const status = await page.locator('[data-testid="forge-fatigue-status"]').innerText();
    expect(status).toMatch(/PASS/);
    await shot(page, 'panel-result');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
