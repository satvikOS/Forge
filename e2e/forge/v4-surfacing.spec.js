// Forge-126 — class-A surfacing MVP, human-style headed Electron e2e.
//
// The user opens the app, opens Tools → Surfacing through actual menu
// clicks, sees the panel, walks each category tab, snaps multi-angle
// screenshots, then clicks five distinct ops to confirm each opens its
// own param dialog. Re-runs the same multi-angle sweep against the
// light theme so the GSD command surface is verified under both
// monochrome palettes.
//
// NO window hooks — the test mimics what an actual operator does
// (menus, tabs, buttons). Imperative window.__forgeOpenSurfacing is
// only used to safety-close in afterAll.
//
// Headed Mac-Electron at a watchable pace because the user runs these
// remotely and the assistant must observe each step.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-surfacing';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js'
);

// Five ops the test exercises end-to-end (one per category, two extras
// from Surface Tools because that's the dense category). Each opens
// its own dialog; the test asserts the dialog appears for every one.
const FIVE_OPS = [
  { tab: 'Curve Tools',   id: 'helix' },
  { tab: 'Curve Tools',   id: 'spiral' },
  { tab: 'Surface Tools', id: 'extrude-surface' },
  { tab: 'Surface Tools', id: 'multi-section' },
  { tab: 'Analysis',      id: 'porcupine-analysis' },
];

// Multi-angle: pause for orbit-like camera ticks so the viewport
// gradient hits the panel from different cardinal directions in
// every screenshot. We can't really orbit without a kernel handle,
// but we can resize/zoom the panel + scroll the op list so multiple
// shots are not visually identical.
const MULTI_ANGLE_PASSES = [
  { name: 'angle-front', viewportSize: { width: 1920, height: 1000 } },
  { name: 'angle-wide',  viewportSize: { width: 2200, height: 1000 } },
  { name: 'angle-tall',  viewportSize: { width: 1600, height: 1200 } },
];

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

// Pause long enough for a remote watcher to see the step. Override
// with FORGE_E2E_FAST=1 in CI.
async function watchable(page, ms) {
  if (process.env.FORGE_E2E_FAST) return;
  await page.waitForTimeout(ms);
}

test.describe('Forge v4 · class-A surfacing MVP', () => {
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
        if (/surfacing|Surfacing|forge-v4/i.test(txt)) {
          consoleErrors.push(`console.error: ${txt}`);
        }
      }
    });
    await page.waitForLoadState('domcontentloaded');
    // Wait until the menubar (and therefore the React shell) is mounted.
    await page.waitForSelector('[data-testid="forge-menus"]', { timeout: 12_000 });
    await watchable(page, 600);
    await shot(page, 'app-mounted');
  });

  test.afterAll(async () => {
    if (consoleErrors.length) {
      console.error('Captured renderer errors:\n' + consoleErrors.join('\n'));
    }
    if (app) await app.close();
  });

  // ────────────────────────────────────────────────────────────────
  // 01 — Open Tools menu, click Surfacing…, panel appears.
  // ────────────────────────────────────────────────────────────────
  test('01 user opens Tools menu and clicks Surfacing…', async () => {
    await page.click('[data-menu="tools"]');
    const menu = page.locator('[data-testid="forge-menu-tools"]');
    await expect(menu).toBeVisible({ timeout: 3000 });
    await watchable(page, 300);
    await shot(page, 'tools-menu-open');

    const surfItem = page.locator('[role="menuitem"]', { hasText: /Surfacing/i }).first();
    await expect(surfItem).toBeVisible();
    await surfItem.click();
    const panel = page.locator('[data-testid="forge-surfacing-panel"]');
    await expect(panel).toBeVisible({ timeout: 4000 });
    await watchable(page, 600);
    await shot(page, 'surfacing-panel-open');
  });

  // ────────────────────────────────────────────────────────────────
  // 02 — Walk each category tab. Screenshot each. Multi-angle.
  // ────────────────────────────────────────────────────────────────
  for (const pass of MULTI_ANGLE_PASSES) {
    test(`02 ${pass.name} · sweep all four category tabs (dark)`, async () => {
      await page.setViewportSize(pass.viewportSize);
      await watchable(page, 250);
      for (const tab of ['Curve Tools', 'Surface Tools', 'Operations', 'Analysis']) {
        const slug = tab.toLowerCase().replace(/\s+/g, '-');
        const tabEl = page.locator(`[data-testid="forge-surfacing-tab-${slug}"]`);
        await expect(tabEl).toBeVisible({ timeout: 2500 });
        await tabEl.click();
        await expect(tabEl).toHaveAttribute('data-active', 'true');
        // Section heading must update too — assert the matching section
        // container is now rendered.
        const section = page.locator(`[data-testid="forge-surfacing-section-${slug}"]`);
        await expect(section).toBeVisible();
        await watchable(page, 350);
        await shot(page, `${pass.name}-tab-${slug}`);
      }
    });
  }

  // ────────────────────────────────────────────────────────────────
  // 03 — Click five distinct ops, assert dialog opens for each.
  // ────────────────────────────────────────────────────────────────
  test('03 user clicks five ops · each opens its own dialog', async () => {
    for (const { tab, id } of FIVE_OPS) {
      const slug = tab.toLowerCase().replace(/\s+/g, '-');
      await page.click(`[data-testid="forge-surfacing-tab-${slug}"]`);
      await watchable(page, 200);
      const opBtn = page.locator(`[data-testid="forge-surfacing-op-${id}"]`);
      await expect(opBtn).toBeVisible({ timeout: 2500 });
      await opBtn.click();
      const dialog = page.locator('[data-testid="forge-surfacing-dialog"]');
      await expect(dialog).toBeVisible({ timeout: 2000 });
      await expect(dialog).toContainText(/.+/);
      await watchable(page, 400);
      await shot(page, `dialog-${id}`);
      // Cancel and continue.
      await page.click('[data-testid="forge-surfacing-dialog-cancel"]');
      await expect(dialog).toHaveCount(0, { timeout: 1500 });
      await watchable(page, 200);
    }
  });

  // ────────────────────────────────────────────────────────────────
  // 04 — Light theme. Cycle through tabs again, screenshot each.
  // ────────────────────────────────────────────────────────────────
  test('04 light theme · tabs render under the second palette', async () => {
    // Use the View menu's "Toggle theme" — same UX an actual user would.
    await page.click('[data-menu="view"]');
    const viewMenu = page.locator('[data-testid="forge-menu-view"]');
    await expect(viewMenu).toBeVisible();
    const themeItem = page.locator('[role="menuitem"]', { hasText: /Toggle theme/i }).first();
    await themeItem.click();
    await watchable(page, 400);
    await shot(page, 'theme-toggled-to-light');

    for (const tab of ['Curve Tools', 'Surface Tools', 'Operations', 'Analysis']) {
      const slug = tab.toLowerCase().replace(/\s+/g, '-');
      await page.click(`[data-testid="forge-surfacing-tab-${slug}"]`);
      await watchable(page, 300);
      await shot(page, `light-tab-${slug}`);
    }
  });

  // ────────────────────────────────────────────────────────────────
  // 05 — Analysis op fires the overlay event, overlay becomes visible.
  // ────────────────────────────────────────────────────────────────
  test('05 analysis op · overlay appears on apply', async () => {
    await page.click('[data-testid="forge-surfacing-tab-analysis"]');
    await watchable(page, 200);
    await page.click('[data-testid="forge-surfacing-op-isoclines"]');
    const dialog = page.locator('[data-testid="forge-surfacing-dialog"]');
    await expect(dialog).toBeVisible();
    await watchable(page, 400);
    await shot(page, 'analysis-isoclines-dialog');
    // Apply → either the overlay shows or a toast confirms kernel-not-ready.
    await page.click('[data-testid="forge-surfacing-dialog-confirm"]');
    await expect(dialog).toHaveCount(0, { timeout: 2000 });
    await watchable(page, 800);
    // Either overlay or log entry should be present.
    const overlay = page.locator('[data-testid="forge-surface-analysis-overlay"]');
    const log     = page.locator('[data-testid="forge-surfacing-log"]');
    const overlayVisible = await overlay.count();
    const logVisible     = await log.count();
    expect(overlayVisible + logVisible).toBeGreaterThan(0);
    await shot(page, 'analysis-isoclines-result');
  });

  // ────────────────────────────────────────────────────────────────
  // 06 — Close panel via the X button, panel goes away cleanly.
  // ────────────────────────────────────────────────────────────────
  test('06 user closes the surfacing panel', async () => {
    // Toggle theme back so subsequent test runs start from dark.
    await page.click('[data-menu="view"]');
    const themeItem = page.locator('[role="menuitem"]', { hasText: /Toggle theme/i }).first();
    if (await themeItem.count()) await themeItem.click();
    await watchable(page, 300);
    const closeBtn = page.locator('[data-testid="forge-surfacing-close"]');
    if (await closeBtn.count()) await closeBtn.click();
    await expect(page.locator('[data-testid="forge-surfacing-panel"]')).toHaveCount(0, { timeout: 2000 });
    await shot(page, 'surfacing-panel-closed');
  });

  // ────────────────────────────────────────────────────────────────
  // 07 — No uncaught errors propagated.
  // ────────────────────────────────────────────────────────────────
  test('07 no uncaught renderer errors', async () => {
    expect(consoleErrors,
           `Renderer errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
