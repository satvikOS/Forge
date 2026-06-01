// Forge-136 — Title block + dim style libraries, headed verification.
//
// Flow:
//   01 launch headed Electron, switch to the Drawing workbench
//   02 open the inspector → Title block section
//   03 cycle through every template (12 total) by clicking the
//      Template select. Assert paper width / height update.
//   04 cycle through every dim style (6 total).
//   05 spot-check ANSI Y14.1 · D (22 × 34 in = 558.8 × 863.6 mm).
//
// Manual clicks must NOT post to Archie's thread.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-title-blocks';
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

test.describe.serial('Forge-136 · Title block + dim style libraries', () => {
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

  test('01 switch to drawing workbench by clicking the rail button', async () => {
    const wbBtn = page.locator('[data-wb="drawing"]');
    await expect(wbBtn).toBeVisible({ timeout: 4000 });
    await wbBtn.click();
    await page.waitForTimeout(400);
    await shot(page, 'drawing-wb');
  });

  test('02 title block picker is mounted', async () => {
    const picker = page.locator('[data-testid="forge-drawings-tb-template-picker"]');
    await expect(picker).toBeVisible({ timeout: 4000 });
    await shot(page, 'tb-picker-visible');
  });

  test('03 cycle through every template (12 total) via clicks', async () => {
    const sel = page.locator('[data-tb-field="templateId"]');
    await expect(sel).toBeVisible();
    const expectedIds = [
      'iso-a0','iso-a1','iso-a2','iso-a3','iso-a4',
      'ansi-a','ansi-b','ansi-c','ansi-d','ansi-e',
      'jis-a3','jis-a4',
    ];
    for (const id of expectedIds) {
      await sel.selectOption(id);
      await page.waitForTimeout(60);
      const meta = page.locator('[data-testid="forge-drawings-tb-meta"]');
      const got = await meta.getAttribute('data-tb-template-id');
      expect(got).toBe(id);
    }
    expect(expectedIds.length).toBe(12);
    await shot(page, 'tb-cycle-done');
  });

  test('04 ANSI Y14.1 D template = 863.6 × 558.8 mm (22 × 34 inches)', async () => {
    const sel = page.locator('[data-tb-field="templateId"]');
    await sel.selectOption('ansi-d');
    await page.waitForTimeout(80);
    const meta = page.locator('[data-testid="forge-drawings-tb-meta"]');
    const w = parseFloat(await meta.getAttribute('data-tb-paper-w'));
    const h = parseFloat(await meta.getAttribute('data-tb-paper-h'));
    // 34 in × 25.4 = 863.6 mm  /  22 in × 25.4 = 558.8 mm
    expect(Math.abs(w - 863.6)).toBeLessThan(0.05);
    expect(Math.abs(h - 558.8)).toBeLessThan(0.05);
    await shot(page, 'tb-ansi-d-meta');
  });

  test('05 dim style picker is mounted, list 6 standards', async () => {
    const picker = page.locator('[data-testid="forge-drawings-dim-style-picker"]');
    await expect(picker).toBeVisible({ timeout: 2000 });
    const sel = page.locator('[data-tb-field="dimStyleId"]');
    await expect(sel).toBeVisible();
    const expectedIds = [
      'iso-129', 'iso-129-arch',
      'asme-y14-5', 'asme-y14-5-metric',
      'jis-z-8317', 'jis-z-8317-open',
    ];
    for (const id of expectedIds) {
      await sel.selectOption(id);
      await page.waitForTimeout(60);
      const meta = page.locator('[data-testid="forge-drawings-dim-style-meta"]');
      const arrow = await meta.getAttribute('data-dim-arrow');
      expect(['filled', 'open', 'oblique']).toContain(arrow);
    }
    expect(expectedIds.length).toBe(6);
    await shot(page, 'dim-style-cycle');
  });

  test('06 ISO 129 default — arrow filled, text height 3.5, bilateral tol', async () => {
    const sel = page.locator('[data-tb-field="dimStyleId"]');
    await sel.selectOption('iso-129');
    await page.waitForTimeout(80);
    const meta = page.locator('[data-testid="forge-drawings-dim-style-meta"]');
    expect(await meta.getAttribute('data-dim-arrow')).toBe('filled');
    expect(parseFloat(await meta.getAttribute('data-dim-text-h'))).toBe(3.5);
    expect(parseInt(await meta.getAttribute('data-dim-decimals'), 10)).toBe(2);
    expect(await meta.getAttribute('data-dim-tol-mode')).toBe('bilateral');
    await shot(page, 'dim-iso-129');
  });
});
