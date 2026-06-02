// v4-196-a11y.spec.js — Forge-196 accessibility audit.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-196-a11y';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-196 · ARIA audit', () => {
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

  test('01 audit API wired + sample run reports issue counts', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() => typeof window.__forgeA11yAudit === 'function');
    expect(has).toBe(true);
    const r = await page.evaluate(() => window.__forgeA11yAudit());
    expect(typeof r.totalScanned).toBe('number');
    expect(r.totalScanned).toBeGreaterThan(100);
    expect(Array.isArray(r.issues)).toBe(true);
  });

  test('02 open the audit workbench panel', async () => {
    await page.evaluate(() => { window.__forgeOpenA11yWorkbench?.(); });
    await page.waitForTimeout(500);
    await shot(page, 'panel');
    await expect(page.locator('[data-testid="forge-a11y-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-a11y-summary"]')).toBeVisible();
  });

  test('03 re-run button refreshes summary', async () => {
    await page.locator('[data-testid="forge-a11y-run"]').click();
    await page.waitForTimeout(300);
    const summary = await page.locator('[data-testid="forge-a11y-summary"]').innerText();
    expect(summary).toMatch(/Total elements scanned\s+\d+/);
    expect(summary).toMatch(/Total issues\s+\d+/);
    await shot(page, 'after-rerun');
  });

  test('04 issue list visible when there is at least one issue', async () => {
    const report = await page.evaluate(() => window.__forgeA11yAudit());
    if (report.issues.length > 0) {
      await expect(page.locator('[data-testid="forge-a11y-list"]')).toBeVisible();
    }
    await shot(page, 'issue-list');
  });

  test('05 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
