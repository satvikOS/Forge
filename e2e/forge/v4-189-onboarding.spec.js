// v4-189-onboarding.spec.js — Forge-189 onboarding tutorial.
//
// Verifies the tour APIs exist, the tour can be started programmatically,
// stepping forward advances the index, Skip dismisses the overlay, and
// the localStorage flag persists so the tour doesn't re-appear.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-189-tour';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-189 · onboarding tour', () => {
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

  test('01 tour APIs installed', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.__forgeStartTour === 'function'
      && typeof window.__forgeFinishTour === 'function'
      && typeof window.__forgeTourActive === 'function');
    expect(has).toBe(true);
  });

  test('02 clear seen flag + manually start tour', async () => {
    await page.evaluate(() => window.localStorage.removeItem('forge.v4.onboarded'));
    await page.evaluate(() => window.__forgeStartTour());
    await page.waitForTimeout(400);
    await shot(page, 'tour-start');
    await expect(page.locator('[data-testid="forge-tour-tooltip"]')).toBeVisible();
    const text = await page.locator('[data-testid="forge-tour-tooltip"]').innerText();
    expect(text).toContain('1/6');
  });

  test('03 Next advances through steps', async () => {
    for (let i = 1; i < 5; ++i) {
      await page.locator('[data-testid="forge-tour-next"]').click();
      await page.waitForTimeout(250);
    }
    await shot(page, 'tour-step5');
    const text = await page.locator('[data-testid="forge-tour-tooltip"]').innerText();
    expect(text).toContain('5/6');
  });

  test('04 Back returns to previous step', async () => {
    await page.locator('[data-testid="forge-tour-prev"]').click();
    await page.waitForTimeout(200);
    const text = await page.locator('[data-testid="forge-tour-tooltip"]').innerText();
    expect(text).toContain('4/6');
    await shot(page, 'tour-back');
  });

  test('05 Skip dismisses tour + persists onboarded flag', async () => {
    await page.locator('[data-testid="forge-tour-skip"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="forge-tour-tooltip"]')).toHaveCount(0);
    const seen = await page.evaluate(() => window.localStorage.getItem('forge.v4.onboarded'));
    expect(seen).toBe('1');
    await shot(page, 'after-skip');
  });

  test('06 replay via __forgeStartTour after dismissal', async () => {
    await page.evaluate(() => window.__forgeStartTour());
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-tour-tooltip"]')).toBeVisible();
    await shot(page, 'replay');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
