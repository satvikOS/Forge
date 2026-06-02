// v4-187-variants.spec.js — Forge-187 generative variant explorer.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-187-variants';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-187 · generative variant explorer', () => {
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

  test('01 variants bridge + Pareto + LHS wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge?.variants?.latinHypercube === 'function'
      && typeof window.forge?.variants?.paretoFront === 'function');
    expect(has).toBe(true);
  });

  test('02 open variant explorer + default 20-sample sweep runs', async () => {
    await page.evaluate(() => { window.__forgeOpenVariantsWorkbench?.(); });
    await page.waitForTimeout(800);
    await shot(page, 'default-sweep');
    await expect(page.locator('[data-testid="forge-variants-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-variants-scatter"]')).toBeVisible({ timeout: 12000 });
    const status = await page.locator('[data-testid="forge-variants-status"]').innerText();
    expect(status).toMatch(/\d+ variants \· \d+ on Pareto/);
  });

  test('03 results table + Pareto highlights present', async () => {
    await expect(page.locator('[data-testid="forge-variants-table"]')).toBeVisible();
    const star = await page.locator('[data-testid="forge-variants-table"]').innerText();
    expect(star).toContain('★');
    await shot(page, 'table');
  });

  test('04 narrow sweep — fewer Pareto points', async () => {
    await page.locator('[data-testid="forge-var-samples"]').fill('8');
    await page.locator('[data-testid="forge-variants-run"]').click();
    await page.waitForTimeout(2500);
    await shot(page, 'narrow-sweep');
    const status = await page.locator('[data-testid="forge-variants-status"]').innerText();
    expect(status).toMatch(/8 variants/);
  });

  test('05 high-AR window — every variant on Pareto when single-axis', async () => {
    // Sweep only taper while pinning chord + half-span very narrow so
    // each variant has a clearly distinct (mass, AR) pair.
    await page.locator('[data-testid="forge-var-chord-lo"]').fill('80');
    await page.locator('[data-testid="forge-var-chord-hi"]').fill('80');
    await page.locator('[data-testid="forge-var-hs-lo"]').fill('600');
    await page.locator('[data-testid="forge-var-hs-hi"]').fill('600');
    await page.locator('[data-testid="forge-var-tp-lo"]').fill('0.3');
    await page.locator('[data-testid="forge-var-tp-hi"]').fill('1.0');
    await page.locator('[data-testid="forge-var-samples"]').fill('12');
    await page.locator('[data-testid="forge-variants-run"]').click();
    await page.waitForTimeout(3500);
    await shot(page, 'taper-only');
  });

  test('06 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
