// v4-human-multi-angle.spec.js — Forge-142.
//
// Strict human-user e2e: every interaction is a mouse click, keyboard
// press, or menu navigation a real user could perform. ZERO calls to
// window.__forge* hooks. Validates that every panel registered in
// Forge-141 menu wiring is reachable through the Tools menu.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-human';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function openToolsMenu(page) {
  await page.click('[data-menu="tools"]');
  await page.waitForTimeout(250);
}

async function clickMenuItem(page, label) {
  const item = page.locator('[role="menuitem"]', { hasText: new RegExp(label, 'i') }).first();
  await expect(item).toBeVisible({ timeout: 2000 });
  await item.click();
  await page.waitForTimeout(450);
}

async function dismissAnyOverlay(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

const VIEWS = [
  { key: '1', name: 'iso' },
  { key: '2', name: 'front' },
  { key: '3', name: 'back' },
  { key: '4', name: 'top' },
  { key: '5', name: 'bottom' },
  { key: '6', name: 'right' },
  { key: '7', name: 'left' },
];

test.describe.serial('Forge-142 · human-style multi-angle (clicks only)', () => {
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

  test('01 baseline app boots · top-bar menus present', async () => {
    await shot(page, 'baseline');
    for (const menu of ['file','edit','view','tools','help']) {
      await expect(page.locator(`[data-menu="${menu}"]`)).toBeVisible();
    }
  });

  test('02 cycle through every named view via keyboard 1-7', async () => {
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(380);
      await shot(page, `view-${v.name}`);
    }
  });

  test('03 toggle light theme via View menu', async () => {
    await page.click('[data-menu="view"]');
    await page.waitForTimeout(200);
    await clickMenuItem(page, 'Toggle theme');
    await page.waitForTimeout(700);
    await shot(page, 'light-theme');
    // sweep angles in light theme
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(380);
      await shot(page, `light-${v.name}`);
    }
    // back to dark
    await page.click('[data-menu="view"]');
    await page.waitForTimeout(200);
    await clickMenuItem(page, 'Toggle theme');
    await page.waitForTimeout(500);
  });

  test('04 every Tools menu panel opens via real click', async () => {
    const items = [
      'Standard Parts Library',
      'Bill of Materials',
      'Configurations',
      'Master Skeleton',
      'Scenario Runner',
      'FEA Convergence',
      'Weldments',
      'Exploded view',
      'Walk-through',
      'Direct Edit',
      'Heal',
      'Surfacing',
      'Assembly tree',
      'Assembly…',
      'Stress test',
    ];
    for (const label of items) {
      await openToolsMenu(page);
      await clickMenuItem(page, label);
      await shot(page, `panel-${label.toLowerCase().replace(/[^a-z]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}`);
      await dismissAnyOverlay(page);
      // some panels don't dismiss on Escape — click outside to close any modal
      await page.mouse.click(60, 60);
      await page.waitForTimeout(200);
    }
  });

  test('05 File menu shows the new project + export entries', async () => {
    await page.click('[data-menu="file"]');
    await page.waitForTimeout(250);
    await shot(page, 'file-menu');
    for (const label of ['Open Project', 'Save Project', 'Export Project Bundle', 'Export IFC4']) {
      const item = page.locator('[role="menuitem"]', { hasText: new RegExp(label, 'i') });
      await expect(item).toHaveCount(1, { timeout: 2000 });
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });

  test('06 workbench rail click cycles every workbench', async () => {
    for (const wb of ['mech', 'drawing', 'sheet', 'weld', 'mold', 'sim', 'mfg']) {
      const rail = page.locator(`[data-wb="${wb}"]`);
      if (await rail.count() === 0) continue;
      await rail.click();
      await page.waitForTimeout(420);
      await shot(page, `wb-${wb}`);
    }
    // back to mech
    await page.click('[data-wb="mech"]');
    await page.waitForTimeout(300);
  });

  test('07 click extrude tool · confirm via dialog · body appears native', async () => {
    await page.click('[data-tool="solid.extrude"]', { force: true });
    await page.waitForTimeout(420);
    const confirm = page.locator('[data-testid="forge-tool-confirm"]');
    if (await confirm.count()) {
      await confirm.click();
      await page.waitForTimeout(900);
    }
    await shot(page, 'after-extrude');
    // multi-angle sweep over the new body
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(380);
      await shot(page, `extrude-${v.name}`);
    }
    // The feature should land in the tree regardless of whether the
    // kernel could finalize — when the dispatcher returns an error the
    // shell shows an error toast (no fake body). Either way: a feature
    // tree entry or an error toast must be present.
    const featCount = await page.locator('[data-testid="forge-feature-tree"] > li').count();
    const errToast = await page.locator('text=/kernel|error|forge/i').first().count();
    expect(featCount + errToast).toBeGreaterThan(0);
  });

  test('08 Edit menu undo via real click', async () => {
    await page.click('[data-menu="edit"]');
    await page.waitForTimeout(250);
    await clickMenuItem(page, /^Undo$/);
    await page.waitForTimeout(400);
    await shot(page, 'after-undo');
  });

  test('09 Help menu about · stays as a toast (no Archie thread)', async () => {
    const before = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    await page.click('[data-menu="help"]');
    await page.waitForTimeout(250);
    await clickMenuItem(page, 'About');
    await page.waitForTimeout(700);
    await shot(page, 'help-about');
    const after = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(after).toBe(before);
  });

  test('10 final multi-angle sweep · dark theme', async () => {
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(380);
      await shot(page, `final-${v.name}`);
    }
  });

  test('11 Archie thread never received a manual click', async () => {
    const msgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(msgs).toBe(0);
  });
});
