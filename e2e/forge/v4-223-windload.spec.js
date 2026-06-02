// v4-223-windload.spec.js — Forge-223 Wind load (ASCE 7) calculator.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-223-windload';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-223 · wind load (ASCE 7)', () => {
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
      !!(window.forge && window.forge.windload
         && typeof window.forge.windload.kzCoefficient === 'function'
         && typeof window.forge.windload.velocityPressure === 'function'
         && typeof window.forge.windload.designPressure === 'function'));
    expect(has).toBe(true);
  });

  test('02 Kz formula at z = 10 m, Exp C (cam #1)', async () => {
    const Kz = await page.evaluate(() => window.forge.windload.kzCoefficient(10, 'C'));
    expect(Kz).toBeCloseTo(2.01 * Math.pow(10 / 274.32, 2/9.5), 9);
    await shot(page, 'kz-10');
  });

  test('03 Kz min clamp at z = 4.6 m (cam #2)', async () => {
    const r = await page.evaluate(() => ({
      low:    window.forge.windload.kzCoefficient(1.0, 'C'),
      atMin:  window.forge.windload.kzCoefficient(4.6, 'C'),
    }));
    expect(r.low).toBeCloseTo(r.atMin, 9);
    await shot(page, 'kz-min-clamp');
  });

  test('04 Kz monotone in exposure: D > C > B (cam #3)', async () => {
    const r = await page.evaluate(() => ({
      B: window.forge.windload.kzCoefficient(10, 'B'),
      C: window.forge.windload.kzCoefficient(10, 'C'),
      D: window.forge.windload.kzCoefficient(10, 'D'),
    }));
    expect(r.B).toBeLessThan(r.C);
    expect(r.C).toBeLessThan(r.D);
    await shot(page, 'kz-monotone');
  });

  test('05 q_z = 0.613·Kz·Kzt·Kd·Ke·V² (cam #4)', async () => {
    const r = await page.evaluate(() => {
      const qz = window.forge.windload.velocityPressure({
        V: 50, z: 10, exposure: 'C', Kzt: 1.0, Kd: 0.85, Ke: 1.0,
      });
      const Kz = window.forge.windload.kzCoefficient(10, 'C');
      const expected = 0.613 * Kz * 1.0 * 0.85 * 1.0 * 50 * 50;
      return { qz, expected };
    });
    expect(r.qz).toBeCloseTo(r.expected, 9);
    await shot(page, 'qz');
  });

  test('06 panel compute renders Kz/qz/p (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenWindLoadWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-windload-run"]').click();
    await page.waitForSelector('[data-testid="forge-windload-result"]', { timeout: 5000 });
    const text = await page.locator('[data-testid="forge-windload-result"]').innerText();
    expect(text).toMatch(/K_z/);
    expect(text).toMatch(/q_z/);
    expect(text).toMatch(/p \(design\)/);
    await shot(page, 'panel-result');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
