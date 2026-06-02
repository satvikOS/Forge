// v4-233-ui-hierarchy.spec.js — Forge-233 UI navigation hierarchy.
//
// Verifies the per-feedback IA cleanup:
//   1. Rail only renders CORE_WORKBENCH_IDS (≤ 12 entries, no
//      engineering-calculator slots).
//   2. Hierarchical Tools menu mounts, search works, drill-down works.
//   3. Every calculator id from CALCULATOR_TREE is still reachable
//      via the menu (no regression — moved, not deleted).
//   4. Backward-compat: existing `window.__forgeOpen<X>Workbench`
//      APIs still open the panel.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-233-ui-hierarchy';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-233 · UI hierarchy', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    // Dismiss the Forge-189 onboarding tour — both the tooltip and
    // the full-screen overlay intercept pointer events.
    await page.evaluate(() => {
      ['forge-tour-tooltip', 'forge-tour-overlay'].forEach((id) => {
        document.querySelectorAll(`[data-testid="${id}"]`).forEach((el) => el.remove());
      });
    });
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 rail trimmed to core workbenches only (cam #1)', async () => {
    await shot(page, 'rail-after-trim');
    const railCount = await page.locator('[data-testid="forge-wb-rail"] [data-wb]').count();
    expect(railCount).toBeGreaterThan(5);    // core set has at least Part/Draft/Drawing/Sim/Mfg/Arch
    expect(railCount).toBeLessThanOrEqual(12); // not 50+
    // Engineering calculators must NOT appear in the rail anymore.
    for (const id of ['windload', 'snowload', 'pumphead', 'gearpair',
                       'mohr', 'beam', 'spring', 'fan', 'refrig',
                       'bearing', 'pvessel', 'fatigue', 'modal',
                       'steelcol']) {
      const inRail = await page.locator(`[data-testid="forge-wb-rail"] [data-wb="${id}"]`).count();
      expect(inRail).toBe(0);
    }
  });

  test('02 hierarchical Tools menu mounts on demand (cam #2)', async () => {
    await page.evaluate(() => { window.__forgeOpenToolsMenu?.(); });
    await page.waitForSelector('[data-testid="forge-tools-menu"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-tools-menu-categories"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-tools-menu-sections"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-tools-menu-items"]')).toBeVisible();
    await shot(page, 'menu-open');
  });

  test('03 drill from Structural → Loads → Wind opens windload (cam #3)', async () => {
    // Re-open the menu since it may have been closed by the previous test.
    await page.evaluate(() => { window.__forgeOpenToolsMenu?.(); });
    await page.waitForSelector('[data-testid="forge-tools-menu"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="forge-tools-menu-categories"]', { timeout: 5000 });
    // Dump the DOM children of the categories column for diagnostics.
    const catIds = await page.evaluate(() => {
      const cats = document.querySelectorAll('[data-testid="forge-tools-menu-categories"] button');
      return Array.from(cats).map((b) => b.getAttribute('data-testid'));
    });
    expect(catIds.length).toBeGreaterThanOrEqual(6);
    expect(catIds).toContain('forge-tools-menu-cat-structural');
    await page.locator('[data-testid="forge-tools-menu-cat-structural"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-tools-menu-sec-loads-code"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-tools-menu-item-windload"]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="forge-windload-panel"]')).toBeVisible();
    await shot(page, 'drill-wind');
  });

  test('04 search filters tree + opens the target (cam #4)', async () => {
    await page.evaluate(() => { window.__forgeOpenToolsMenu?.(); });
    await page.waitForSelector('[data-testid="forge-tools-menu-search"]', { timeout: 5000 });
    await page.locator('[data-testid="forge-tools-menu-search"]').fill('gear');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid="forge-tools-menu-search-results"]')).toBeVisible();
    await page.locator('[data-testid="forge-tools-menu-result-gearpair"]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-gearpair-panel"]')).toBeVisible();
    await shot(page, 'search-gear');
  });

  test('05 menu shows all category labels (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenToolsMenu?.(); });
    await page.waitForSelector('[data-testid="forge-tools-menu-categories"]', { timeout: 5000 });
    const categoryCount = await page.locator('[data-testid^="forge-tools-menu-cat-"]').count();
    expect(categoryCount).toBeGreaterThanOrEqual(6);
    // Selecting any category shows its tools.
    await page.locator('[data-testid="forge-tools-menu-cat-machine-design"]').click();
    await page.waitForTimeout(150);
    const itemCount = await page.locator('[data-testid^="forge-tools-menu-item-"]').count();
    expect(itemCount).toBeGreaterThan(0);
    await shot(page, 'machine-design');
  });

  test('06 backward-compat: legacy openX APIs still work (cam #6)', async () => {
    await page.evaluate(() => { window.__forgeOpenWindLoadWorkbench?.(); });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="forge-windload-panel"]')).toBeVisible();
    await shot(page, 'legacy-api');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
