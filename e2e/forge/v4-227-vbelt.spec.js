// v4-227-vbelt.spec.js — Forge-227 V-belt drive.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-227-vbelt';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-227 · V-belt drive', () => {
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
      !!(window.forge && window.forge.vbelt
         && typeof window.forge.vbelt.pitchLength === 'function'
         && typeof window.forge.vbelt.centreDistFromLength === 'function'
         && typeof window.forge.vbelt.wrapAngleSmallRad === 'function'
         && typeof window.forge.vbelt.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 pitchLength closed-form (cam #1)', async () => {
    const r = await page.evaluate(() => {
      const Lp = window.forge.vbelt.pitchLength(0.15, 0.30, 0.6);
      const expected = 2*0.6 + (Math.PI/2)*0.45 + 0.15*0.15/(4*0.6);
      return { Lp, expected };
    });
    expect(r.Lp).toBeCloseTo(r.expected, 12);
    await shot(page, 'lp');
  });

  test('03 centreDistFromLength round-trips (cam #2)', async () => {
    const r = await page.evaluate(() => {
      const Lp = window.forge.vbelt.pitchLength(0.15, 0.30, 0.6);
      const C  = window.forge.vbelt.centreDistFromLength(0.15, 0.30, Lp);
      return C;
    });
    expect(r).toBeCloseTo(0.6, 9);
    await shot(page, 'C-roundtrip');
  });

  test('04 wrap angle = π − 2·asin((d2−d1)/(2C)) (cam #3)', async () => {
    const r = await page.evaluate(() => {
      const theta = window.forge.vbelt.wrapAngleSmallRad(0.15, 0.30, 0.6);
      const expected = Math.PI - 2 * Math.asin(0.15 / 1.2);
      return { theta, expected };
    });
    expect(r.theta).toBeCloseTo(r.expected, 12);
    await shot(page, 'wrap');
  });

  test('05 analyse: belt speed, design power, belt count (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.vbelt.analyse({
      d1: 0.15, d2: 0.30, centreDist: 0.6,
      rpmSmall: 1750, nominalPower: 7500,
      serviceFactor: 1.2, ratingPerBelt: 3000,
    }));
    expect(r.beltSpeed).toBeCloseTo(Math.PI * 0.15 * 1750 / 60, 9);
    expect(r.designPower).toBeCloseTo(9000, 9);
    expect(r.beltCount).toBeCloseTo(3.0, 9);
    expect(r.wrapAngleSmallDeg).toBeGreaterThan(150);
    await shot(page, 'analyse');
  });

  test('06 panel analyse renders belt count (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenVBeltWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-vbelt-run"]').click();
    await page.waitForSelector('[data-testid="forge-vbelt-result"]', { timeout: 5000 });
    const text = await page.locator('[data-testid="forge-vbelt-count"]').innerText();
    expect(text).toMatch(/Belts needed/);
    expect(text).toMatch(/3/);
    await shot(page, 'panel');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
