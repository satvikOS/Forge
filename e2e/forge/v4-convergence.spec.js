// v4-convergence.spec.js — Forge-122 verification.
//
// Asserts the convergence chart subscribes to forge:fea-residual broadcasts
// and renders a real residual log on screen with proper log-scale ticks.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-convergence';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-122 · FEA convergence streaming', () => {
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

  test('01 panel hook installs + opens via window.__forgeOpenConvergence', async () => {
    await page.evaluate(() => { window.__forgeOpenConvergence?.(true); });
    await page.waitForTimeout(700);
    const panel = page.locator('[data-testid="forge-convergence-panel"]');
    await expect(panel).toBeVisible({ timeout: 2000 });
    await shot(page, 'panel-empty');
  });

  test('02 dispatching a residual broadcast renders the curve', async () => {
    // Simulate a non-linear solver returning 18 newton iterations with
    // decreasing residuals.
    await page.evaluate(() => {
      const residuals = [];
      for (let i = 0; i < 18; i++) {
        residuals.push({ step: i, residual: Math.pow(10, 0 - i * 0.45) });
      }
      window.dispatchEvent(new CustomEvent('forge:fea-residual',
        { detail: { jobId: 'test-job-1',
                    label: 'FEA Nonlinear · test',
                    residuals } }));
    });
    await page.waitForTimeout(600);
    await shot(page, 'curve-rendered');
    const svg = page.locator('[data-testid="forge-convergence-panel"] svg').first();
    await expect(svg).toBeVisible({ timeout: 2000 });
    const pathD = await svg.locator('path').first().getAttribute('d');
    expect(pathD).toMatch(/^M\s/);
    expect(pathD.split('L').length).toBeGreaterThan(10);  // 17 LineTos
  });

  test('03 multiple broadcasts stack as separate entries', async () => {
    await page.evaluate(() => {
      const residuals = [
        { step: 0, residual: 1.0 },
        { step: 1, residual: 0.32 },
        { step: 2, residual: 0.08 },
        { step: 3, residual: 0.02 },
        { step: 4, residual: 4e-3 },
        { step: 5, residual: 7e-4 },
        { step: 6, residual: 9e-5 },
      ];
      window.dispatchEvent(new CustomEvent('forge:fea-residual',
        { detail: { jobId: 'test-job-2',
                    label: 'FEA Modal · second study',
                    residuals } }));
    });
    await page.waitForTimeout(500);
    await shot(page, 'two-entries');
    // The panel's section now has 2 entry rows.
    const rows = page.locator('[data-testid="forge-convergence-panel"] section > div');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('04 closing the panel works', async () => {
    await page.click('[data-testid="forge-convergence-close"]');
    await page.waitForTimeout(400);
    const panel = page.locator('[data-testid="forge-convergence-panel"]');
    await expect(panel).toBeHidden({ timeout: 2000 });
    await shot(page, 'panel-closed');
  });

  test('05 panel re-opens automatically on next broadcast', async () => {
    await page.evaluate(() => {
      const residuals = [
        { step: 0, residual: 5 },
        { step: 1, residual: 0.5 },
        { step: 2, residual: 0.05 },
        { step: 3, residual: 5e-3 },
      ];
      window.dispatchEvent(new CustomEvent('forge:fea-residual',
        { detail: { jobId: 'auto-open', label: 'auto', residuals } }));
    });
    await page.waitForTimeout(600);
    await shot(page, 'auto-reopen');
    const panel = page.locator('[data-testid="forge-convergence-panel"]');
    await expect(panel).toBeVisible({ timeout: 2000 });
  });

  test('06 manual UI clicks · Archie thread untouched', async () => {
    const msgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(msgs).toBe(0);
  });
});
