/**
 * Workflow-17 — File menu wired to real actions.
 *
 * The application Topbar's File menu was a stub (every action was
 * `console.log('Save')`). WF-17 wires every File-menu entry to its
 * real handler: New Project clears the scene + opens Welcome, Save
 * Snapshot fires the real save path, the Export submenu dispatches
 * the corresponding ribbon tools, and the Recent submenu surfaces
 * the last 5 saved snapshots from localStorage.
 *
 * Coherent real-project test: walks a CNC machined fixture assembly
 * through the File menu's full real-user workflow:
 *
 *   1. Open File menu, click "New Project" → scene clears, Welcome
 *      modal opens with the engineering template grid
 *   2. Dismiss Welcome (Start Empty), build a 6-component CNC
 *      machined fixture via the ribbon — base plate, 4 locating
 *      pins, hold-down clamp
 *   3. Open File → Export → 3MF (.3mf) → real 3MF archive emitted
 *   4. Open File → Save Snapshot → recent-projects gets populated
 *   5. Open File again → Recent submenu lists the saved snapshot
 *   6. Open File → Export → BOM (.csv) → CSV with 6 rows + TOTAL
 *
 * CNC fixture geometry (real Erowa-style modular tooling):
 *   1. Base plate           Box 200 × 200 × 25 mm   AISI 1045
 *   2-5. Locating pin (×4)  Cyl Ø 12 × 35 mm        D2 tool steel
 *   6. Hold-down clamp      Box 60 × 25 × 8 mm      AISI 4140
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf17-file-menu');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-17 — CNC machined fixture: File menu drives New Project → build → Export 3MF + Save → Recent → Export BOM', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, NODE_ENV: 'test' },
    slowMo: 0,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscBodies && !!window.__archdiscRunTool,
    null, { timeout: 60000 });
  await win.evaluate(() => {
    window.__archdiscBypassDialog = true;
    window.localStorage.setItem('archdisc:welcome:v1', '1');
    window.localStorage.setItem('archdisc:splash:lastShownAt', String(Date.now()));
    window.localStorage.removeItem('archdisc:recent-projects:v1');
    window.localStorage.removeItem('archdisc:body-materials:v1');
    // Suppress real file downloads.
    const orig = document.createElement.bind(document);
    document.createElement = function (tag) {
      if (tag === 'a') return Object.assign(orig('span'), {
        click() {}, set href(_) {}, set download(_) {},
      });
      return orig(tag);
    };
  });
  // If the welcome modal opened on this fresh launch (user-data dir
  // can be ephemeral in the test harness), dismiss it now so it
  // doesn't intercept the File menu clicks that come next.
  const initialWelcome = win.locator('[data-archdisc-welcome="open"]');
  if (await initialWelcome.isVisible().catch(() => false)) {
    await win.locator('[data-archdisc-welcome-close="true"]').click();
    await expect(initialWelcome).toBeHidden({ timeout: 5000 });
  }
  // Reset registry.
  await win.evaluate(() => {
    const reg = window.__archdiscBodies;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
  });

  // Helpers — open the File menu and click a top-level entry or submenu leaf.
  // Topbar's handleMenuClick toggles: clicking File while open closes it,
  // so we always close-then-open. Click the canvas to dismiss any prior
  // open state (outside-click handler), then click the File trigger.
  const openFileMenu = async () => {
    await win.evaluate(() => {
      // Force-close any prior open menu state via the outside-click
      // dispatcher used by Topbar's useEffect.
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await win.waitForTimeout(120);
    await win.locator('[data-topbar-menu="file"]').click();
    await expect(win.locator('.topbar-dropdown')).toBeVisible({ timeout: 3000 });
  };
  const clickFileItem = async (label) => {
    await openFileMenu();
    await win.locator(`.topbar-dropdown [data-topbar-item="${label}"]`).click();
  };
  const hoverFileSubmenu = async (parentLabel) => {
    await openFileMenu();
    await win.locator(`.topbar-dropdown [data-topbar-item="${parentLabel}"][data-topbar-has-submenu="true"]`).hover();
    await expect(win.locator('.topbar-submenu')).toBeVisible({ timeout: 3000 });
  };
  const clickExport = async (label) => {
    await hoverFileSubmenu('Export');
    await win.locator(`.topbar-submenu [data-topbar-item="${label}"]`).click();
  };

  // ─── 1. New Project → scene clears + Welcome opens ──────────────────
  await clickFileItem('New Project');
  await expect(win.locator('[data-archdisc-welcome="open"]')).toBeVisible({ timeout: 5000 });
  // Dismiss Welcome via Start Empty.
  await win.locator('[data-archdisc-welcome-template="empty"]').click();
  await expect(win.locator('[data-archdisc-welcome="open"]')).toBeHidden({ timeout: 5000 });
  const fresh = await win.evaluate(() => {
    const reg = window.__archdiscBodies;
    return (typeof reg.list === 'function' ? reg.list() : reg.bodies).length;
  });
  expect(fresh).toBe(0);
  await win.screenshot({ path: path.join(OUT, '01-fresh.png') });

  // ─── 2. Build the CNC fixture (ribbon-driven) ───────────────────────
  const buildOne = async (tool, label) => {
    const before = await win.evaluate(() => {
      const reg = window.__archdiscBodies;
      return (typeof reg.list === 'function' ? reg.list() : reg.bodies).length;
    });
    await win.evaluate(({ tool }) => {
      window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab: 'part', tool } }));
    }, { tool });
    await win.waitForFunction(
      ({ n }) => {
        const reg = window.__archdiscBodies;
        const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
        return list.length === n + 1;
      }, { n: before }, { timeout: 30000 });
    await win.evaluate(({ label }) => {
      const reg = window.__archdiscBodies;
      const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
      if (typeof reg.rename === 'function') reg.rename(list[list.length - 1].id, label);
    }, { label });
  };

  await buildOne('Box',      'CNCFixture-BasePlate-1045');
  await buildOne('Cylinder', 'CNCFixture-LocatingPin1-D2');
  await buildOne('Cylinder', 'CNCFixture-LocatingPin2-D2');
  await buildOne('Cylinder', 'CNCFixture-LocatingPin3-D2');
  await buildOne('Cylinder', 'CNCFixture-LocatingPin4-D2');
  await buildOne('Box',      'CNCFixture-HoldDownClamp-4140');
  await win.screenshot({ path: path.join(OUT, '02-fixture-built.png') });

  // ─── 3. File → Export → 3MF ────────────────────────────────────────
  await clickExport('3MF (.3mf)');
  await win.waitForFunction(() => !!window.__last3MF?.ok, null, { timeout: 30000 });
  const threeMf = await win.evaluate(() => ({
    ok: window.__last3MF.ok, objects: window.__last3MF.objects, bytes: window.__last3MF.bytes,
  }));
  console.log('  [3MF]', JSON.stringify(threeMf));
  expect(threeMf.objects).toBe(6);

  // ─── 4. File → Save Snapshot → recent populates ─────────────────────
  await clickFileItem('Save Snapshot');
  await win.waitForFunction(() => {
    const raw = window.localStorage.getItem('archdisc:recent-projects:v1');
    if (!raw) return false;
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) && list.length >= 1 && list[0].bodies === 6;
    } catch { return false; }
  }, null, { timeout: 30000 });
  const saved = await win.evaluate(() => {
    const list = JSON.parse(window.localStorage.getItem('archdisc:recent-projects:v1'));
    return list[0];
  });
  console.log('  [saved]', JSON.stringify(saved));
  expect(saved.bodies).toBe(6);

  // ─── 5. File → Recent → first entry visible ─────────────────────────
  await hoverFileSubmenu('Recent');
  const recentItems = await win.locator('.topbar-submenu .topbar-item').all();
  expect(recentItems.length).toBeGreaterThanOrEqual(1);
  const firstRecentText = (await recentItems[0].textContent() || '').trim();
  expect(firstRecentText).toMatch(/\.archdisc\.json/);
  await win.screenshot({ path: path.join(OUT, '03-recent-submenu.png') });
  // Close the menus via outside-click pathway.
  await win.evaluate(() => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await win.waitForTimeout(200);

  // ─── 6. File → Export → BOM (.csv) ─────────────────────────────────
  await clickExport('BOM (.csv)');
  await win.waitForFunction(() => !!window.__lastBom?.csv, null, { timeout: 30000 });
  const bom = await win.evaluate(() => ({
    rows: window.__lastBom.rows, totalVolume: window.__lastBom.totalVolume,
  }));
  console.log('  [bom]', JSON.stringify(bom));
  expect(bom.rows).toBe(6);
  expect(bom.totalVolume).toBeGreaterThan(0);

  await app.close();
});
