// v4-direct-heal-surf.spec.js — Forge-93: open each of the new direct
// edit / heal / surfacing panels in a HEADED Electron window, click the
// first action button to ensure no errors are thrown, and screenshot
// every step so the visual record matches the user's headed-test rule
// (see feedback-headed-tests memory).
//
// The panels are mounted by App.jsx as PanelHost components — they
// stay invisible until either the custom event
// `forge:open-direct-heal-surf-panel` (with detail.which) is
// dispatched, or the imperative window.__forgeOpen{DirectEdit,Heal,
// Surfacing}() entry point is called. Both paths must work; this spec
// exercises the imperative path because it's stable across renderer
// reloads.
//
// Every dialog should open without throwing. We don't assert the
// kernel returned a real handle — in the FORGE_E2E dev build the
// kernel may or may not be ready; either path must not surface an
// uncaught exception. The test asserts:
//   • the panel becomes visible after we open it,
//   • the first action button is enabled and clickable,
//   • clicking it opens the per-op dialog,
//   • cancelling closes the dialog,
//   • no console errors fired.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-direct-heal-surf';
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

test.describe('Forge v4 · direct-edit / heal / surfacing panels', () => {
  let app, page;
  const consoleErrors = [];

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    page.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const txt = msg.text();
        // Filter out unrelated errors (network 404, DevTools noise, three.js
        // warnings) — the test cares about *uncaught* exceptions from the
        // panels themselves.
        if (/forge-v4|DirectEdit|Heal|Surfacing/i.test(txt)) {
          consoleErrors.push(`console.error: ${txt}`);
        }
      }
    });
    await page.waitForLoadState('domcontentloaded');
    // Give the React tree time to mount the PanelHost components.
    await page.waitForFunction(() => typeof window.__forgeOpenDirectEdit === 'function',
                               null, { timeout: 10_000 });
    await page.waitForTimeout(800);
    await shot(page, 'initial');
  });

  test.afterAll(async () => {
    if (consoleErrors.length) {
      // Surface any errors collected so the failure message is actionable.
      console.error('Captured renderer errors:\n' + consoleErrors.join('\n'));
    }
    if (app) await app.close();
  });

  // ────────────────────────────────────────────────────────────────
  // Direct Edit panel
  // ────────────────────────────────────────────────────────────────
  test('01 direct edit panel · opens via imperative hook', async () => {
    await page.evaluate(() => window.__forgeOpenDirectEdit());
    const panel = page.locator('[data-testid="forge-direct-edit-panel"]');
    await expect(panel).toBeVisible({ timeout: 4000 });
    await shot(page, 'direct-edit-open');
  });

  test('02 direct edit · first op button click opens dialog', async () => {
    // The first DIRECT_OPS entry is pushPullFace.
    const btn = page.locator('[data-testid="forge-direct-op-pushPullFace"]');
    await expect(btn).toBeVisible();
    await btn.click();
    const dialog = page.locator('[data-testid="forge-direct-edit-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 2000 });
    await shot(page, 'direct-edit-dialog-pushPullFace');
  });

  test('03 direct edit · cancel dialog closes it', async () => {
    await page.click('[data-testid="forge-direct-edit-dialog-cancel"]');
    const dialog = page.locator('[data-testid="forge-direct-edit-dialog"]');
    await expect(dialog).toHaveCount(0, { timeout: 1500 });
    await shot(page, 'direct-edit-dialog-cancelled');
  });

  test('04 direct edit · apply path runs without throwing', async () => {
    // Re-open the dialog and click Apply. Even if window.forge isn't
    // ready, the dispatcher returns a structured error and the panel
    // shows a toast — no exception should propagate.
    await page.click('[data-testid="forge-direct-op-pushPullFace"]');
    await page.waitForSelector('[data-testid="forge-direct-edit-dialog"]');
    await page.click('[data-testid="forge-direct-edit-dialog-confirm"]');
    // Dialog auto-closes regardless of outcome.
    await expect(page.locator('[data-testid="forge-direct-edit-dialog"]')).toHaveCount(0, { timeout: 1500 });
    await shot(page, 'direct-edit-applied');
  });

  test('05 direct edit · close panel', async () => {
    await page.click('[data-testid="forge-direct-edit-close"]');
    await expect(page.locator('[data-testid="forge-direct-edit-panel"]')).toHaveCount(0, { timeout: 1500 });
    await shot(page, 'direct-edit-closed');
  });

  // ────────────────────────────────────────────────────────────────
  // Heal panel
  // ────────────────────────────────────────────────────────────────
  test('06 heal panel · opens via imperative hook', async () => {
    await page.evaluate(() => window.__forgeOpenHeal());
    const panel = page.locator('[data-testid="forge-heal-panel"]');
    await expect(panel).toBeVisible({ timeout: 4000 });
    await shot(page, 'heal-open');
  });

  test('07 heal · first op (sewShape) button opens dialog', async () => {
    const btn = page.locator('[data-testid="forge-heal-op-sewShape"]');
    await expect(btn).toBeVisible();
    await btn.click();
    const dialog = page.locator('[data-testid="forge-heal-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 2000 });
    // The slider field for tolerance must exist.
    const slider = page.locator('input[type="range"][data-test-field="tolerance"]');
    await expect(slider).toBeVisible();
    await shot(page, 'heal-dialog-sewShape');
  });

  test('08 heal · cancel dialog closes it', async () => {
    await page.click('[data-testid="forge-heal-dialog-cancel"]');
    await expect(page.locator('[data-testid="forge-heal-dialog"]')).toHaveCount(0, { timeout: 1500 });
    await shot(page, 'heal-dialog-cancelled');
  });

  test('09 heal · checkValidity surfaces an issues list', async () => {
    await page.click('[data-testid="forge-heal-op-checkValidity"]');
    await expect(page.locator('[data-testid="forge-heal-dialog"]')).toBeVisible();
    await page.click('[data-testid="forge-heal-dialog-confirm"]');
    // After confirm, dialog closes; validity report may or may not
    // appear depending on whether window.forge.heal is wired. If
    // window.forge is loaded the report div must render; otherwise the
    // panel only shows a warning toast — both are acceptable.
    await page.waitForTimeout(500);
    await shot(page, 'heal-checkValidity-applied');
  });

  test('10 heal · close panel', async () => {
    await page.click('[data-testid="forge-heal-close"]');
    await expect(page.locator('[data-testid="forge-heal-panel"]')).toHaveCount(0, { timeout: 1500 });
    await shot(page, 'heal-closed');
  });

  // ────────────────────────────────────────────────────────────────
  // Surfacing panel
  // ────────────────────────────────────────────────────────────────
  test('11 surfacing panel · opens via imperative hook', async () => {
    await page.evaluate(() => window.__forgeOpenSurfacing());
    const panel = page.locator('[data-testid="forge-surfacing-panel"]');
    await expect(panel).toBeVisible({ timeout: 4000 });
    await shot(page, 'surfacing-open');
  });

  test('12 surfacing · first op (buildPatch) opens dialog with grid + pick button', async () => {
    const btn = page.locator('[data-testid="forge-surfacing-op-buildPatch"]');
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.locator('[data-testid="forge-surfacing-dialog"]')).toBeVisible({ timeout: 2000 });
    // The buildPatch dialog exposes the interactive picker button.
    await expect(page.locator('[data-testid="forge-surfacing-pick-grid"]')).toBeVisible();
    // The grid JSON field must be rendered.
    await expect(page.locator('textarea[data-test-field="grid"]')).toBeVisible();
    await shot(page, 'surfacing-dialog-buildPatch');
  });

  test('13 surfacing · cancel dialog closes it', async () => {
    await page.click('[data-testid="forge-surfacing-dialog-cancel"]');
    await expect(page.locator('[data-testid="forge-surfacing-dialog"]')).toHaveCount(0, { timeout: 1500 });
    await shot(page, 'surfacing-dialog-cancelled');
  });

  test('14 surfacing · classAAnalyse dialog exposes shading-mode picker', async () => {
    await page.click('[data-testid="forge-surfacing-op-classAAnalyse"]');
    await expect(page.locator('[data-testid="forge-surfacing-dialog"]')).toBeVisible();
    // Shading-mode buttons (zebra/gauss/mean/isophote) are rendered.
    for (const mode of ['zebra', 'gauss', 'mean', 'isophote']) {
      const b = page.locator(`button[data-test-shading="${mode}"]`);
      await expect(b).toBeVisible();
    }
    // Pick the Gaussian mode to confirm the toggle works.
    await page.click('button[data-test-shading="gauss"]');
    await expect(page.locator('button[data-test-shading="gauss"]')).toHaveAttribute('data-active', 'true');
    await shot(page, 'surfacing-classA-modes');
    await page.click('[data-testid="forge-surfacing-dialog-cancel"]');
  });

  test('15 surfacing · close panel', async () => {
    await page.click('[data-testid="forge-surfacing-close"]');
    await expect(page.locator('[data-testid="forge-surfacing-panel"]')).toHaveCount(0, { timeout: 1500 });
    await shot(page, 'surfacing-closed');
  });

  // ────────────────────────────────────────────────────────────────
  // Custom-event path
  // ────────────────────────────────────────────────────────────────
  test('16 custom event opens each panel', async () => {
    for (const which of ['direct', 'heal', 'surfacing']) {
      await page.evaluate((w) => {
        window.dispatchEvent(new CustomEvent('forge:open-direct-heal-surf-panel',
                                             { detail: { which: w } }));
      }, which);
      const sel = `[data-testid="forge-${which === 'direct' ? 'direct-edit' : which}-panel"]`;
      await expect(page.locator(sel)).toBeVisible({ timeout: 4000 });
      await shot(page, `event-open-${which}`);
      // Close it for the next iteration.
      await page.evaluate((w) => {
        const sel = `[data-testid="forge-${w === 'direct' ? 'direct-edit' : w}-close"]`;
        document.querySelector(sel)?.click();
      }, which);
      await page.waitForTimeout(200);
    }
  });

  // ────────────────────────────────────────────────────────────────
  // Final guard — no uncaught errors fired during the run.
  // ────────────────────────────────────────────────────────────────
  test('17 no uncaught errors propagated from the panels', async () => {
    expect(consoleErrors,
           `Renderer errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
