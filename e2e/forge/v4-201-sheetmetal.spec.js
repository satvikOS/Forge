// v4-201-sheetmetal.spec.js — Forge-201 sheet metal flat-pattern.
//
// Verifies the kernel `sheetmetal` namespace + the unfold workbench
// from the renderer.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-201-sheetmetal';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-201 · sheet metal flat-pattern', () => {
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
      !!(window.forge && window.forge.sheetmetal
         && typeof window.forge.sheetmetal.computeBend === 'function'
         && typeof window.forge.sheetmetal.unfoldChain === 'function'
         && typeof window.forge.sheetmetal.kFactor === 'function'));
    expect(has).toBe(true);
  });

  test('02 K-factor rises with R/T ratio', async () => {
    const r = await page.evaluate(() => ({
      small: window.forge.sheetmetal.kFactor('mild-steel', 0.5),
      large: window.forge.sheetmetal.kFactor('mild-steel', 5.0),
    }));
    expect(r.large).toBeGreaterThan(r.small);
    expect(r.small).toBeGreaterThan(0);
    expect(r.large).toBeLessThan(1);
  });

  test('03 computeBend matches textbook 90° R=T=1 K=0.41 (cam #1)', async () => {
    const br = await page.evaluate(() => window.forge.sheetmetal.computeBend({
      angleDeg: 90, innerRadius: 1.0, thickness: 1.0, kOverride: 0.41,
    }));
    expect(br.bendAllowance).toBeCloseTo(2.2148, 3);
    expect(br.bendDeduction).toBeCloseTo(1.7852, 2);
    expect(br.neutralRadius).toBeCloseTo(1.41, 3);
    await shot(page, 'compute-bend');
  });

  test('04 unfoldChain on a 3-flange channel (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.sheetmetal.unfoldChain({
      material: 'mild-steel',
      thickness: 1, width: 30,
      flangeLengths: [50, 100, 50],
      bends: [
        { angleDeg: 90, innerRadius: 1, kOverride: 0.41 },
        { angleDeg: 90, innerRadius: 1, kOverride: 0.41 },
      ],
    }));
    expect(r.developedLength).toBeCloseTo(200 + 2 * 2.2148, 2);
    expect(r.perBend.length).toBe(2);
    expect(r.flangeStartX.length).toBe(3);
    expect(r.flangeStartX[0]).toBeCloseTo(0, 6);
    await shot(page, 'unfold-chain');
  });

  test('05 open the workbench panel (cam #3)', async () => {
    await page.evaluate(() => { window.__forgeOpenSheetMetalUnfoldWorkbench?.(); });
    await page.waitForTimeout(400);
    await shot(page, 'panel-open');
    await expect(page.locator('[data-testid="forge-sheetmetal-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-sheetmetal-unfold"]')).toBeVisible();
  });

  test('06 panel: tweak inputs + compute (cam #4)', async () => {
    await page.locator('[data-testid="forge-sheetmetal-thickness"]').fill('2');
    await page.locator('[data-testid="forge-sheetmetal-width"]').fill('40');
    await page.locator('[data-testid="forge-sheetmetal-flange-0"]').fill('60');
    await page.locator('[data-testid="forge-sheetmetal-unfold"]').click();
    await page.waitForSelector('[data-testid="forge-sheetmetal-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-sheetmetal-result"]')).toBeVisible();
    await shot(page, 'result-rendered');
  });

  test('07 add + remove a bend (cam #5)', async () => {
    const before = await page.locator('[data-testid^="forge-sheetmetal-flange-"]').count();
    await page.locator('[data-testid="forge-sheetmetal-add-bend"]').click();
    await page.waitForTimeout(150);
    const after = await page.locator('[data-testid^="forge-sheetmetal-flange-"]').count();
    expect(after).toBe(before + 1);
    await page.locator('[data-testid="forge-sheetmetal-remove-bend"]').click();
    await page.waitForTimeout(150);
    const final = await page.locator('[data-testid^="forge-sheetmetal-flange-"]').count();
    expect(final).toBe(before);
    await shot(page, 'add-remove');
  });

  test('08 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
