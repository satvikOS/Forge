// v4-283-chain.spec.js — Forge-283 roller chain drive (ANSI B29.1).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-283-chain';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const ANSI60 = {
  pitchMm: 19.05, driverTeeth: 17, drivenTeeth: 51,
  centerDistanceMm: 500, driverSpeedRpm: 1750,
};

test.describe.serial('Forge-283 · roller chain drive', () => {
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

  test('01 kernel bridge wired (cam #1 baseline)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.chain
         && typeof window.forge.chain.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 ANSI #60 17:51 → 3:1 ratio, L=88 pitches (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.chain.analyse(b), ANSI60);
    expect(r.speedRatio).toBeCloseTo(3.0, 9);
    expect(r.driverPitchDiameterMm).toBeCloseTo(19.05 / Math.sin(Math.PI / 17), 6);
    expect(r.drivenPitchDiameterMm).toBeCloseTo(19.05 / Math.sin(Math.PI / 51), 6);
    expect(r.drivenSpeedRpm).toBeCloseTo(1750 / 3, 4);
    expect(r.lengthInPitchesRounded).toBe(88);
    expect(r.lengthInPitchesRounded % 2).toBe(0);  // even
    expect(r.finalCenterDistanceMm).toBeGreaterThan(498);
    expect(r.finalCenterDistanceMm).toBeLessThan(510);  // shifts a few mm after L_round
    await shot(page, 'reference');
  });

  test('03 Chain velocity v = N_1·p·n_1/60000 (cam #3)', async () => {
    const r = await page.evaluate((b) => window.forge.chain.analyse(b), ANSI60);
    expect(r.chainVelocityMs).toBeCloseTo(17 * 19.05 * 1750 / 60000, 6);
    await shot(page, 'velocity');
  });

  test('04 1:1 ratio: equal sprockets, no correction term (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.chain.analyse({
      pitchMm: 12.7, driverTeeth: 21, drivenTeeth: 21,
      centerDistanceMm: 300, driverSpeedRpm: 1500,
    }));
    expect(r.driverPitchDiameterMm).toBeCloseTo(r.drivenPitchDiameterMm, 6);
    expect(r.speedRatio).toBeCloseTo(1.0, 9);
    expect(r.lengthInPitchesRounded).toBe(70);
    await shot(page, 'one-to-one');
  });

  test('05 v ∝ n_1 (cam #5)', async () => {
    const slow = await page.evaluate((b) => window.forge.chain.analyse(b), ANSI60);
    const fast = await page.evaluate((b) => window.forge.chain.analyse({
      ...b, driverSpeedRpm: 3500,
    }), ANSI60);
    expect(fast.chainVelocityMs / slow.chainVelocityMs).toBeCloseTo(2.0, 6);
    await shot(page, 'speed-scale');
  });

  test('06 < 9 teeth throws (cam #6)', async () => {
    let threw = false;
    try {
      await page.evaluate((b) => window.forge.chain.analyse({
        ...b, driverTeeth: 5,
      }), ANSI60);
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'throw');
  });

  test('07 Panel renders L_round + C_final rows', async () => {
    await page.evaluate(() => { window.__forgeOpenChainDriveWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-chain-run"]').click();
    await page.waitForSelector('[data-testid="forge-chain-result"]', { timeout: 5000 });
    const L = await page.locator('[data-testid="forge-chain-Lround"]').innerText();
    const C = await page.locator('[data-testid="forge-chain-Cfinal"]').innerText();
    expect(L).toMatch(/pitches/);
    expect(C).toMatch(/C_final/);
  });

  test('08 Menu route opens chain panel', async () => {
    await page.evaluate(() => { window.__forgeCloseChainDriveWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.chain' } }));
    });
    await page.waitForSelector('[data-testid="forge-chain-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
