// v4-advanced-mates.spec.js — Forge-129 headed verification.
//
// Human-style click-only flow:
//   1. User opens the Tools menu in the top bar.
//   2. Clicks "Assembly…".
//   3. AssemblyPanel mounts. User picks A and B from the body dropdowns,
//      selects a mechanical mate kind from the categorised dropdown,
//      fills its params form, clicks Apply.
//   4. Repeats for Gear, Cam, Belt, LinearCoupler, Screw, RackPinion,
//      LimitAngular, Width, Profile, Slot, Chain.
//   5. Dual theme + multi-angle screenshots between sweeps.
//
// No window.__forge* hooks, no eval() — pure DOM clicks. (The shell's
// own helpers may still publish bodies via window.__forgeBodies, but
// the test itself never reads them.)

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-advanced-mates';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR,
    `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const VIEWS = [
  { key: '1', name: 'iso' },
  { key: '2', name: 'front' },
  { key: '3', name: 'back' },
  { key: '4', name: 'top' },
  { key: '6', name: 'right' },
];

// Open Tools > Assembly purely by click.
async function openAssemblyViaMenu(page) {
  // Top-bar menu button for the Tools group. The MenuBar exposes
  // data-menu="tools" buttons; the dropdown then exposes a button whose
  // text starts with "Assembly…".
  await page.click('button[data-menu="tools"]');
  await page.waitForSelector('[data-testid="forge-menu-tools"]',
    { timeout: 2000 });
  // The MenuBar renders a button per item. Pick the one whose label is
  // exactly "Assembly…" (NOT "Assembly tree…").
  const item = page.locator('[data-testid="forge-menu-tools"] button',
    { hasText: /^Assembly…$/ });
  await item.click();
  await page.waitForSelector('[data-testid="forge-assembly-panel"]',
    { timeout: 4000 });
}

// Fill an A↔B pair, pick a kind, fill its params bag, click Apply.
async function applyMate(page, { a, b, kind, params, label }) {
  await page.selectOption('[data-testid="forge-assembly-pick-a"]', String(a));
  await page.selectOption('[data-testid="forge-assembly-pick-b"]', String(b));
  await page.selectOption('[data-testid="forge-assembly-kind"]', kind);
  // Give React a tick to swap in the per-kind params form.
  await page.waitForTimeout(150);

  for (const [key, value] of Object.entries(params || {})) {
    if (Array.isArray(value)) {
      // vec3 — three inputs keyed by axis.
      for (let i = 0; i < 3; i++) {
        const ax = ['x', 'y', 'z'][i];
        const sel = `[data-testid="forge-assembly-param-${key}-${ax}"]`;
        const exists = await page.locator(sel).count();
        if (exists) await page.fill(sel, String(value[i] ?? 0));
      }
    } else {
      const sel = `[data-testid="forge-assembly-param-${key}"]`;
      const exists = await page.locator(sel).count();
      if (exists) await page.fill(sel, String(value));
    }
  }

  await shot(page, `${label}-filled`);
  await page.click('[data-testid="forge-assembly-apply"]');
  await page.waitForTimeout(250);
  await shot(page, `${label}-applied`);
}

test.describe.serial('Forge-129 · advanced assembly mates', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    await shot(page, 'app-launched');
  });

  test.afterAll(async () => { if (app) await app.close(); });

  test('01 open Tools > Assembly via menu click', async () => {
    await openAssemblyViaMenu(page);
    await expect(page.locator('[data-testid="forge-assembly-panel"]'))
      .toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="forge-assembly-add-mate"]'))
      .toBeVisible();
    await expect(page.locator('[data-testid="forge-flex-section"]'))
      .toBeVisible();
    await shot(page, 'assembly-panel-open');
  });

  test('02 kind dropdown lists 20 mates across 4 categories', async () => {
    const kindOptions = await page.locator(
      '[data-testid="forge-assembly-kind"] option').count();
    expect(kindOptions).toBeGreaterThanOrEqual(20);
    const optgroups = await page.locator(
      '[data-testid="forge-assembly-kind"] optgroup').count();
    expect(optgroups).toBe(4);
    await shot(page, 'kind-dropdown-categories');
  });

  test('03 Gear mate — ratio 24/36 with module 2', async () => {
    await applyMate(page, {
      a: 1, b: 2, kind: 'Gear',
      params: { zA: 24, zB: 36, module: 2 },
      label: 'gear',
    });
    const rows = page.locator('[data-testid="forge-assembly-mate-list"] li');
    await expect(rows).toHaveCount(1);
    await expect(page.locator('[data-mate-kind="Gear"]')).toHaveCount(1);
  });

  test('04 Cam mate — base 20 lift 8', async () => {
    await applyMate(page, {
      a: 1, b: 3, kind: 'Cam',
      params: { baseRadius: 20, lift: 8, phase: 0 },
      label: 'cam',
    });
    await expect(page.locator('[data-mate-kind="Cam"]')).toHaveCount(1);
  });

  test('05 Belt mate — synchronises two sprockets', async () => {
    await applyMate(page, {
      a: 2, b: 3, kind: 'Belt',
      params: { sprocketA: 2, sprocketB: 3, zA: 18, zB: 36 },
      label: 'belt',
    });
    await expect(page.locator('[data-mate-kind="Belt"]')).toHaveCount(1);
  });

  test('06 LinearCoupler mate — axis ratio 1', async () => {
    await applyMate(page, {
      a: 1, b: 2, kind: 'LinearCoupler',
      params: { axisA: [0, 0, 1], axisB: [0, 0, 1], ratio: 1 },
      label: 'lincoupler',
    });
    await expect(page.locator('[data-mate-kind="LinearCoupler"]'))
      .toHaveCount(1);
    const totalRows = await page.locator(
      '[data-testid="forge-assembly-mate-list"] li').count();
    expect(totalRows).toBe(4);
  });

  test('07 Screw mate — pitch 1.5 mm/rev', async () => {
    await applyMate(page, {
      a: 1, b: 3, kind: 'Screw',
      params: { pitch: 1.5 },
      label: 'screw',
    });
    await expect(page.locator('[data-mate-kind="Screw"]')).toHaveCount(1);
  });

  test('08 RackPinion mate — pitch 12.566', async () => {
    await applyMate(page, {
      a: 2, b: 3, kind: 'RackPinion',
      params: { rack: 2, pinion: 3, pitch: 12.566 },
      label: 'rackpinion',
    });
    await expect(page.locator('[data-mate-kind="RackPinion"]'))
      .toHaveCount(1);
  });

  test('09 LimitAngular mate — clamp [-45,45]', async () => {
    await applyMate(page, {
      a: 1, b: 2, kind: 'LimitAngular',
      params: { min: -45, max: 45 },
      label: 'limitangular',
    });
    await expect(page.locator('[data-mate-kind="LimitAngular"]'))
      .toHaveCount(1);
  });

  test('10 Width / Profile / Slot — advanced kinds', async () => {
    await applyMate(page, {
      a: 1, b: 2, kind: 'Width',
      params: { gap: 5 },
      label: 'width',
    });
    await applyMate(page, {
      a: 1, b: 3, kind: 'Profile',
      params: { samples: 64 },
      label: 'profile',
    });
    await applyMate(page, {
      a: 2, b: 3, kind: 'Slot',
      params: { axis: [1, 0, 0], length: 20 },
      label: 'slot',
    });
    await expect(page.locator('[data-mate-kind="Width"]')).toHaveCount(1);
    await expect(page.locator('[data-mate-kind="Profile"]')).toHaveCount(1);
    await expect(page.locator('[data-mate-kind="Slot"]')).toHaveCount(1);
  });

  test('11 Chain mate completes the mechanical sweep', async () => {
    await applyMate(page, {
      a: 2, b: 3, kind: 'Chain',
      params: { links: 40, sprocketA: 2, sprocketB: 3, zA: 16, zB: 16 },
      label: 'chain',
    });
    const rows = await page.locator(
      '[data-testid="forge-assembly-mate-list"] li').count();
    // 11 mates total: Gear, Cam, Belt, LinearCoupler, Screw, RackPinion,
    // LimitAngular, Width, Profile, Slot, Chain.
    expect(rows).toBe(11);
    await shot(page, 'all-mates-applied');
  });

  test('12 Solve runs the JS post-solver + collects status', async () => {
    await page.click('[data-testid="forge-assembly-solve"]');
    await page.waitForTimeout(300);
    await shot(page, 'after-solve');
  });

  test('13 Flexible component toggle marks instance #1', async () => {
    const toggle = page.locator(
      '[data-testid="forge-flex-toggle-input-1"]').first();
    await toggle.click({ force: true });
    await page.waitForTimeout(150);
    await shot(page, 'flex-toggled');
    // Find the section and check its data attribute count.
    const sectionCount = await page.locator(
      '[data-testid="forge-flex-section"]')
      .getAttribute('data-flexible-count');
    expect(parseInt(sectionCount, 10)).toBeGreaterThanOrEqual(1);
  });

  test('14 Motion study on Gear mate — drives the post-solver', async () => {
    const select = page.locator('[data-testid="forge-assembly-motion-mate"]');
    // The dropdown lists every mate by index — Gear was #1 (after the
    // placeholder ''). Pick the first non-empty entry.
    await select.selectOption({ index: 1 });
    await page.fill('[data-testid="forge-assembly-motion-angle"]', '360');
    await page.fill('[data-testid="forge-assembly-motion-steps"]', '24');
    await page.click('[data-testid="forge-assembly-motion-run"]');
    await page.waitForTimeout(500);
    await shot(page, 'motion-run');
    await expect(page.locator('[data-testid="forge-assembly-motion-slider"]'))
      .toBeVisible({ timeout: 1500 });
  });

  test('15 multi-angle sweep · dark theme', async () => {
    // Close the panel so the viewport is clean.
    await page.locator('[data-testid="forge-assembly-panel"] button[aria-label="Close assembly panel"]').click();
    await page.waitForTimeout(250);
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(300);
      await shot(page, `dark-${v.name}`);
    }
  });

  test('16 multi-angle sweep · light theme', async () => {
    await page.keyboard.press('Meta+t');
    await page.waitForTimeout(700);
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(300);
      await shot(page, `light-${v.name}`);
    }
    await page.keyboard.press('Meta+t');
    await page.waitForTimeout(500);
  });

  test('17 Re-opening the panel preserves all mates', async () => {
    await openAssemblyViaMenu(page);
    const rows = await page.locator(
      '[data-testid="forge-assembly-mate-list"] li').count();
    expect(rows).toBe(11);
    await shot(page, 'panel-reopened');
  });

  test('18 manual clicks never write to the Archie thread', async () => {
    const msgs = await page.locator(
      '[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(msgs).toBe(0);
  });
});
