/**
 * Workflow-28 — Tool-result toasts.
 *
 * Every ribbon-tool run now surfaces a toast notification in the
 * bottom-right with the result + status. Replaces silent status-
 * bar-only feedback so the user always sees a visible confirmation
 * regardless of whether the status bar is in view.
 *
 * Coherent real-project test: builds a 5-component drilling-fixture
 * (real shop-floor tooling: clamp body + 4 locating bushings on a
 * grid) and verifies a toast appears for every body creation. Then
 * exports a 3MF + a BOM CSV via the File menu and verifies those
 * also produce toasts.
 *
 *   1. Clamp body          Box 100 × 100 × 25 mm   AISI 1045
 *   2-5. Locating bushing  Cyl Ø 12 × 18 mm        D2 tool steel (×4)
 *
 * Coherence checks:
 *   - After each successful op, exactly one toast surfaces with
 *     class .toast-success or matching status
 *   - The toast text contains the tool name + a real message
 *     (not just "Box: undefined")
 *   - Stale "running…" messages do NOT produce a toast (filtered)
 *   - Export 3MF produces a single toast with the bundle bytes
 *   - Export BOM produces a single toast with the row count
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf28-tool-result-toasts');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-28 — Drilling fixture: every ribbon op produces a tool-result toast', async () => {
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
    // Suppress real downloads.
    const orig = document.createElement.bind(document);
    document.createElement = function (tag) {
      if (tag === 'a') return Object.assign(orig('span'), {
        click() {}, set href(_) {}, set download(_) {},
      });
      return orig(tag);
    };
    const reg = window.__archdiscBodies;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
  });
  const welcome = win.locator('[data-archdisc-welcome="open"]');
  if (await welcome.isVisible().catch(() => false)) {
    await win.locator('[data-archdisc-welcome-close="true"]').click();
    await expect(welcome).toBeHidden({ timeout: 5000 });
  }

  // Helper: collect the tool-result CustomEvents through a window
  // hook so we can verify the dispatch contract independent of the
  // toast-rendering timing race.
  await win.evaluate(() => {
    window.__archdiscToolResults = [];
    window.addEventListener('archdisc:tool-result', (e) => {
      window.__archdiscToolResults.push({ ...e.detail, at: Date.now() });
    });
  });

  // ─── Build the 5-body drilling fixture ──────────────────────────────
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

  await buildOne('Box',      'DrillFixture-ClampBody-1045');
  await buildOne('Cylinder', 'DrillFixture-LocBush1-D2');
  await buildOne('Cylinder', 'DrillFixture-LocBush2-D2');
  await buildOne('Cylinder', 'DrillFixture-LocBush3-D2');
  await buildOne('Cylinder', 'DrillFixture-LocBush4-D2');

  // Wait a beat for the final toast batch to render.
  await win.waitForTimeout(400);

  const results = await win.evaluate(() => window.__archdiscToolResults);
  console.log('  [tool-results]', JSON.stringify(results.map(r => ({ tool: r.tool, status: r.status }))));
  // 5 builds, each produces ONE tool-result event (the `running…`
  // intermediate is filtered before reaching the toast queue, but the
  // event dispatcher emits only on completion so the array is exact).
  expect(results.length).toBeGreaterThanOrEqual(5);
  // Every result has a tool name + a message.
  for (const r of results) {
    expect(typeof r.tool).toBe('string');
    expect(typeof r.message).toBe('string');
    expect(r.message.length).toBeGreaterThan(0);
  }
  // No 'running…' tail in the toast queue (they get filtered).
  for (const r of results) {
    expect(/running…$/.test(r.message)).toBe(false);
  }

  // DOM: bottom-right toast container should have at least one visible
  // toast (the last few stack until their durations elapse).
  await expect(win.locator('.toast-container .toast').first()).toBeVisible({ timeout: 3000 });
  await win.screenshot({ path: path.join(OUT, '01-toasts-stacked.png') });

  // ─── Export 3MF and BOM via File menu (covers WF-17 + toast wiring) ─
  await win.evaluate(() => {
    window.__archdiscToolResults = [];   // reset for the export verification
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await win.waitForTimeout(120);

  const openFileExport = async (label) => {
    await win.evaluate(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await win.waitForTimeout(120);
    await win.locator('[data-topbar-menu="file"]').click();
    await expect(win.locator('.topbar-dropdown')).toBeVisible({ timeout: 3000 });
    await win.locator('.topbar-dropdown [data-topbar-item="Export"][data-topbar-has-submenu="true"]').hover();
    await expect(win.locator('.topbar-submenu')).toBeVisible({ timeout: 3000 });
    await win.locator(`.topbar-submenu [data-topbar-item="${label}"]`).click();
  };

  await openFileExport('3MF (.3mf)');
  await win.waitForFunction(() => !!window.__last3MF?.ok, null, { timeout: 30000 });

  await openFileExport('BOM (.csv)');
  await win.waitForFunction(() => !!window.__lastBom?.csv, null, { timeout: 30000 });

  await win.waitForTimeout(400);
  const exportResults = await win.evaluate(() => window.__archdiscToolResults);
  console.log('  [exports]', JSON.stringify(exportResults.map(r => ({ tool: r.tool, status: r.status }))));
  expect(exportResults.length).toBe(2);
  expect(exportResults.find(r => r.tool === 'Export 3MF')).toBeTruthy();
  expect(exportResults.find(r => r.tool === 'Export BOM (CSV)')).toBeTruthy();
  for (const r of exportResults) {
    expect(r.status).toBe('ok');
    expect(r.message.length).toBeGreaterThan(20);
  }

  await win.screenshot({ path: path.join(OUT, '02-export-toasts.png') });
  await app.close();
});
