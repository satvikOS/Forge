// Forge-162 — Inspection / FAI headed e2e (click-only).
//
// Strict headed Mac-Electron flow per project memory
// feedback-headed-tests.
//
// Flow:
//   01 launch + baseline
//   02 open Tools → Inspection / FAI…
//   03 load the synthetic sample part (24 features)
//   04 compute heatmap — assert stats render + heatmap SVG present
//   05 set FAI metadata fields (part number, inspector)
//   06 generate FAI report — PDF or text fallback, asserted via dispatch
//   07 toggle theme + capture
//   08 final shot

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-inspect';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js'
);

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-162 · Inspection / FAI workbench headed', () => {
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

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('01 baseline · shell mounted', async () => {
    await shot(page, 'baseline');
    await expect(page.locator('[data-testid="forge-wb-rail"]')).toBeVisible();
  });

  test('02 open Inspection / FAI via Tools menu', async () => {
    await page.click('[data-menu="tools"]');
    await page.waitForTimeout(250);
    const item = page.locator('[role="menuitem"]', { hasText: /Inspection \/ FAI/i }).first();
    await expect(item).toBeVisible({ timeout: 2000 });
    await item.click();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="forge-inspect-workbench"]'))
      .toBeVisible({ timeout: 3000 });
    await shot(page, 'inspect-open');
  });

  test('03 load sample part', async () => {
    await page.click('[data-testid="forge-inspect-load-sample"]');
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-inspect-feature-table"]'))
      .toBeVisible({ timeout: 1500 });
    const rows = await page.locator('[data-testid="forge-inspect-feature-table"] tbody tr').count();
    expect(rows).toBeGreaterThanOrEqual(20);
    await shot(page, 'sample-loaded');
  });

  test('04 compute heatmap', async () => {
    await page.click('[data-testid="forge-inspect-compute"]');
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-inspect-heatmap"]'))
      .toBeVisible({ timeout: 1500 });
    await expect(page.locator('[data-testid="forge-inspect-stats"]'))
      .toBeVisible({ timeout: 1500 });
    await expect(page.locator('[data-testid="forge-inspect-stats"]'))
      .toContainText(/Cpk/i);
    await shot(page, 'heatmap-computed');
  });

  test('05 set metadata fields', async () => {
    await page.fill('[data-testid="forge-inspect-meta-partNumber"]', 'PN-12345');
    await page.fill('[data-testid="forge-inspect-meta-revision"]', 'A');
    await page.fill('[data-testid="forge-inspect-meta-inspector"]', 'Sam Walker');
    await page.waitForTimeout(200);
    await shot(page, 'meta-set');
  });

  test('06 generate FAI report', async () => {
    // Drive the report generation via dispatch directly so the
    // download dialog doesn't block headed test execution.
    const result = await page.evaluate(async () => {
      const d = window.__forgeInspectionDispatch;
      if (!d) return { ok: false, error: 'dispatch missing' };
      try {
        return await d.generateReport();
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    expect(result.ok).toBe(true);
    await page.waitForTimeout(400);
    await shot(page, 'report-generated');
  });

  test('07 toggle theme + capture', async () => {
    await page.click('[data-menu="view"]');
    await page.waitForTimeout(200);
    await page.locator('[role="menuitem"]', { hasText: /Toggle theme/i }).first().click();
    await page.waitForTimeout(400);
    await shot(page, 'light-theme');
    await page.click('[data-menu="view"]');
    await page.waitForTimeout(200);
    await page.locator('[role="menuitem"]', { hasText: /Toggle theme/i }).first().click();
    await page.waitForTimeout(400);
  });

  test('08 final', async () => {
    await expect(page.locator('[data-testid="forge-inspect-status"]')).toBeVisible();
    await shot(page, 'final');
  });
});
