// v4-243-weir.spec.js — Forge-243 weir / V-notch / orifice.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-243-weir';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-243 · weir / V-notch / orifice', () => {
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
      !!(window.forge && window.forge.weir
         && typeof window.forge.weir.rectWeirDischarge === 'function'
         && typeof window.forge.weir.vNotchDischarge === 'function'
         && typeof window.forge.weir.orificeDischarge === 'function'));
    expect(has).toBe(true);
  });

  test('02 rectangular weir textbook Q ≈ 0.602 m³/s (cam #1)', async () => {
    const Q = await page.evaluate(() => window.forge.weir.rectWeirDischarge({
      crestLengthM: 2.0, headM: 0.3, dischargeCoeff: 0.62,
      endContractions: 0, gravityG: 9.81,
    }));
    expect(Q).toBeCloseTo(0.6017, 2);
    await shot(page, 'rect');
  });

  test('03 Q ∝ H^1.5 for rectangular weir (cam #2)', async () => {
    const Q1 = await page.evaluate(() => window.forge.weir.rectWeirDischarge({
      crestLengthM: 2.0, headM: 0.3, dischargeCoeff: 0.62,
      endContractions: 0, gravityG: 9.81,
    }));
    const Q4 = await page.evaluate(() => window.forge.weir.rectWeirDischarge({
      crestLengthM: 2.0, headM: 1.2, dischargeCoeff: 0.62,
      endContractions: 0, gravityG: 9.81,
    }));
    expect(Q4 / Q1).toBeCloseTo(8.0, 4);   // (4)^1.5 = 8
    await shot(page, 'H15-scaling');
  });

  test('04 V-notch 90° textbook Q ≈ 0.0245 m³/s (cam #3)', async () => {
    const Q = await page.evaluate(() => window.forge.weir.vNotchDischarge({
      notchAngleDeg: 90, headM: 0.2, dischargeCoeff: 0.58, gravityG: 9.81,
    }));
    expect(Q).toBeCloseTo(0.02451, 3);
    await shot(page, 'vnotch-90');
  });

  test('05 V-notch Q ∝ H^2.5 (cam #4)', async () => {
    const Q1 = await page.evaluate(() => window.forge.weir.vNotchDischarge({
      notchAngleDeg: 90, headM: 0.2, dischargeCoeff: 0.58, gravityG: 9.81,
    }));
    const Q2 = await page.evaluate(() => window.forge.weir.vNotchDischarge({
      notchAngleDeg: 90, headM: 0.4, dischargeCoeff: 0.58, gravityG: 9.81,
    }));
    // (2)^2.5 = 5.657
    expect(Q2 / Q1).toBeCloseTo(Math.pow(2, 2.5), 4);
    await shot(page, 'vnotch-scaling');
  });

  test('06 orifice textbook Q ≈ 0.0336 m³/s', async () => {
    const Q = await page.evaluate(() => window.forge.weir.orificeDischarge({
      areaM2: 0.01, headM: 1.5, dischargeCoeff: 0.62, gravityG: 9.81,
    }));
    expect(Q).toBeCloseTo(0.03363, 3);
  });

  test('07 orifice Q ∝ √H', async () => {
    const Q1 = await page.evaluate(() => window.forge.weir.orificeDischarge({
      areaM2: 0.01, headM: 1.5, dischargeCoeff: 0.62, gravityG: 9.81,
    }));
    const Q4 = await page.evaluate(() => window.forge.weir.orificeDischarge({
      areaM2: 0.01, headM: 6.0, dischargeCoeff: 0.62, gravityG: 9.81,
    }));
    expect(Q4 / Q1).toBeCloseTo(2.0, 4);  // √4 = 2
  });

  test('08 end contractions reduce rectangular weir Q', async () => {
    const Q0 = await page.evaluate(() => window.forge.weir.rectWeirDischarge({
      crestLengthM: 2.0, headM: 0.3, dischargeCoeff: 0.62,
      endContractions: 0, gravityG: 9.81,
    }));
    const Q2 = await page.evaluate(() => window.forge.weir.rectWeirDischarge({
      crestLengthM: 2.0, headM: 0.3, dischargeCoeff: 0.62,
      endContractions: 2, gravityG: 9.81,
    }));
    expect(Q2).toBeLessThan(Q0);
  });

  test('09 panel tab switching renders all three result widgets (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenWeirWorkbench?.(); });
    await page.waitForTimeout(300);
    // Default rect tab is active.
    await page.locator('[data-testid="forge-weir-run"]').click();
    await page.waitForSelector('[data-testid="forge-weir-result"]', { timeout: 5000 });
    // Switch to V-notch.
    await page.locator('[data-testid="forge-weir-tab-vnotch"]').click();
    await page.locator('[data-testid="forge-weir-run"]').click();
    await page.waitForSelector('[data-testid="forge-weir-vH"]', { timeout: 5000 });
    // Switch to orifice.
    await page.locator('[data-testid="forge-weir-tab-orifice"]').click();
    await page.locator('[data-testid="forge-weir-run"]').click();
    await page.waitForSelector('[data-testid="forge-weir-A"]', { timeout: 5000 });
    const r = await page.locator('[data-testid="forge-weir-result"]').innerText();
    expect(r).toMatch(/Q/);
    expect(r).toMatch(/m³\/s/);
    await shot(page, 'panel');
  });

  test('10 menu route fires weir workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseWeirWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.weir' } }));
    });
    await page.waitForSelector('[data-testid="forge-weir-panel"]', { timeout: 2000 });
  });

  test('11 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
