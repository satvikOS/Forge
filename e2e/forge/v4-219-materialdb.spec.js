// v4-219-materialdb.spec.js — Forge-219 material properties database.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-219-materialdb';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-219 · material database', () => {
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

  test('01 catalogue exposed on window', async () => {
    await shot(page, 'baseline');
    const r = await page.evaluate(() => ({
      count: window.__forgeMaterialCatalogue?.length ?? 0,
      hasLookup: typeof window.__forgeMaterialLookup === 'function',
      hasSearch: typeof window.__forgeMaterialSearch === 'function',
    }));
    expect(r.count).toBeGreaterThan(10);
    expect(r.hasLookup).toBe(true);
    expect(r.hasSearch).toBe(true);
  });

  test('02 lookup by ID returns full record (cam #1)', async () => {
    const m = await page.evaluate(() => window.__forgeMaterialLookup('al-6061-t6'));
    expect(m).not.toBeNull();
    expect(m.name).toMatch(/6061/);
    expect(m.E).toBeCloseTo(68.9e9, 1);
    expect(m.density).toBe(2700);
    expect(m.alpha).toBeCloseTo(23.6e-6, 9);
    await shot(page, 'lookup');
  });

  test('03 search by name filters (cam #2)', async () => {
    const r = await page.evaluate(() => ({
      steel: window.__forgeMaterialSearch('steel').length,
      ti:    window.__forgeMaterialSearch('Ti-6Al').length,
      nul:   window.__forgeMaterialSearch('nonexistent').length,
    }));
    expect(r.steel).toBeGreaterThan(3);
    expect(r.ti).toBe(1);
    expect(r.nul).toBe(0);
    await shot(page, 'search');
  });

  test('04 panel open + list renders (cam #3)', async () => {
    await page.evaluate(() => { window.__forgeOpenMaterialWorkbench?.(); });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-material-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-material-list"]')).toBeVisible();
    await shot(page, 'panel-open');
  });

  test('05 click row → details + "Use" (cam #4)', async () => {
    await page.locator('[data-testid="forge-material-row-al-7075-t6"]').click();
    await expect(page.locator('[data-testid="forge-material-details"]')).toBeVisible();
    await page.locator('[data-testid="forge-material-use"]').click();
    const r = await page.evaluate(() => window.__forgeActiveMaterial);
    expect(r.id).toBe('al-7075-t6');
    expect(r.name).toMatch(/7075/);
    await shot(page, 'use-7075');
  });

  test('06 search field filters the list (cam #5)', async () => {
    const total = await page.evaluate(() => window.__forgeMaterialCatalogue.length);
    await page.locator('[data-testid="forge-material-search"]').fill('aluminium');
    await page.waitForTimeout(150);
    const count = await page.locator('[data-testid^="forge-material-row-"]').count();
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThan(total);
    await shot(page, 'filtered');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
