// v4-190-circuit.spec.js — Forge-190 electrical schematic + circuit analysis.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-190-circuit';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-190 · circuit analysis', () => {
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

  test('01 circuit bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge?.circuit?.dcAnalysis === 'function'
      && typeof window.forge?.circuit?.acAnalysis === 'function');
    expect(has).toBe(true);
  });

  test('02 default voltage divider opens + solves', async () => {
    await page.evaluate(() => { window.__forgeOpenCircuitWorkbench?.(); });
    await page.waitForTimeout(600);
    await shot(page, 'voltage-divider');
    await expect(page.locator('[data-testid="forge-circuit-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-circuit-result"]')).toBeVisible({ timeout: 4000 });
    // 12 V × 2 kΩ / 3 kΩ = 8.00 V at n2.
    const result = await page.locator('[data-testid="forge-circuit-result"]').innerText();
    expect(result).toMatch(/n2\s+8\.0000/);
  });

  test('03 schematic SVG renders', async () => {
    await expect(page.locator('[data-testid="forge-circuit-schematic"]')).toBeVisible();
    await shot(page, 'schematic');
  });

  test('04 swap R2 to 4 kΩ → V_out drops to 9.6 V', async () => {
    await page.locator('[data-testid="forge-circuit-val-2"]').fill('4000');
    await page.locator('[data-testid="forge-circuit-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'r2-4k');
    const result = await page.locator('[data-testid="forge-circuit-result"]').innerText();
    expect(result).toMatch(/n2\s+9\.6000/);
  });

  test('05 add an extra resistor in parallel', async () => {
    // R3 = 1 kΩ between n2 and gnd, in parallel with R2.
    await page.locator('[data-testid="forge-circuit-add"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-circuit-name-3"]').fill('R3');
    await page.locator('[data-testid="forge-circuit-na-3"]').fill('2');
    await page.locator('[data-testid="forge-circuit-nb-3"]').fill('0');
    await page.locator('[data-testid="forge-circuit-val-3"]').fill('1000');
    await page.locator('[data-testid="forge-circuit-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'parallel');
  });

  test('06 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
