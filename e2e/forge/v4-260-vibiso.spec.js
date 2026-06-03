// v4-260-vibiso.spec.js — Forge-260 vibration isolation.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-260-vibiso';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-260 · vibration isolation', () => {
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
      !!(window.forge && window.forge.vibiso
         && typeof window.forge.vibiso.response === 'function'
         && typeof window.forge.vibiso.sizeIsolator === 'function'));
    expect(has).toBe(true);
  });

  test('02 Size isolator for 90% isolation @ 50 Hz, m=200 kg (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.vibiso.sizeIsolator({
      massKg: 200, drivingFrequencyHz: 50,
      targetIsolationPct: 90, dampingRatio: 0.05,
    }));
    expect(r.requiredFrequencyRatio).toBeCloseTo(Math.sqrt(11), 3);
    expect(r.requiredNaturalFrequencyHz).toBeCloseTo(15.07, 1);
    expect(r.requiredStiffnessNPerM).toBeCloseTo(1.794e6, -3);
    await shot(page, 'size');
  });

  test('03 Response at sized k matches target (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.vibiso.response({
      massKg: 200, stiffnessNPerM: 1.794e6,
      dampingCoefficientNsm: 2 * 0.05 * Math.sqrt(200 * 1.794e6),
      drivingFrequencyHz: 50,
    }));
    expect(r.naturalFrequencyHz).toBeCloseTo(15.07, 1);
    expect(r.dampingRatio).toBeCloseTo(0.05, 9);
    expect(r.frequencyRatio).toBeCloseTo(Math.sqrt(11), 1);
    expect(r.isolationPct).toBeGreaterThan(85);
    expect(r.isolationPct).toBeLessThan(95);
    await shot(page, 'response');
  });

  test('04 r < √2 gives zero isolation (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.vibiso.response({
      massKg: 200, stiffnessNPerM: 2e8,  // very stiff
      dampingCoefficientNsm: 0, drivingFrequencyHz: 50,
    }));
    expect(r.frequencyRatio).toBeLessThan(Math.sqrt(2));
    expect(r.isolationPct).toBe(0);
    await shot(page, 'no-iso');
  });

  test('05 Higher target isolation needs softer isolator (cam #4)', async () => {
    const r80 = await page.evaluate(() => window.forge.vibiso.sizeIsolator({
      massKg: 200, drivingFrequencyHz: 50,
      targetIsolationPct: 80, dampingRatio: 0.05,
    }));
    const r95 = await page.evaluate(() => window.forge.vibiso.sizeIsolator({
      massKg: 200, drivingFrequencyHz: 50,
      targetIsolationPct: 95, dampingRatio: 0.05,
    }));
    expect(r95.requiredStiffnessNPerM).toBeLessThan(r80.requiredStiffnessNPerM);
    await shot(page, 'softer');
  });

  test('06 ω_n = √(k/m) closed form (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.vibiso.response({
      massKg: 100, stiffnessNPerM: 4e6, dampingCoefficientNsm: 0,
      drivingFrequencyHz: 10,
    }));
    const omega_n_expected = Math.sqrt(4e6 / 100) / (2 * Math.PI);
    expect(r.naturalFrequencyHz).toBeCloseTo(omega_n_expected, 6);
    await shot(page, 'omega_n');
  });

  test('07 isolation = 0 % at target > 100 throws', async () => {
    let threw = false;
    try {
      await page.evaluate(() => window.forge.vibiso.sizeIsolator({
        massKg: 200, drivingFrequencyHz: 50,
        targetIsolationPct: 100, dampingRatio: 0.05,
      }));
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
  });

  test('08 panel tab-switch renders k + iso rows', async () => {
    await page.evaluate(() => { window.__forgeOpenVibIsoWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-vibiso-run"]').click();
    await page.waitForSelector('[data-testid="forge-vibiso-k-out"]', { timeout: 5000 });
    await page.locator('[data-testid="forge-vibiso-tab-response"]').click();
    await page.locator('[data-testid="forge-vibiso-run"]').click();
    await page.waitForSelector('[data-testid="forge-vibiso-iso"]', { timeout: 5000 });
    const iso = await page.locator('[data-testid="forge-vibiso-iso"]').innerText();
    expect(iso).toMatch(/Isolation/);
  });

  test('09 menu route fires vibiso workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseVibIsoWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.vibiso' } }));
    });
    await page.waitForSelector('[data-testid="forge-vibiso-panel"]', { timeout: 2000 });
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
