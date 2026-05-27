/**
 * Workflow-34 — Quick-export keyboard shortcuts.
 *
 * Four global hotkeys for the most-used hand-off formats:
 *
 *   Ctrl+Shift+E   Export Project Bundle (per-component STEP ZIP)
 *   Ctrl+Shift+P   Export Snapshot (PNG, 2x viewport)
 *   Ctrl+Shift+M   Export 3MF (slicer hand-off)
 *   Ctrl+Shift+B   Export BOM (CSV)
 *
 * Each shortcut dispatches `archdisc:run-tool` with the matching
 * documentation tool so the result flows through the same handler
 * the ribbon click does.
 *
 * Coherent real-project test: builds a 6-component pulley-belt drive
 * (a real power-transmission sub-assembly: driver pulley + driven
 * pulley + shaft pair + idler + tensioner) and fires every hotkey,
 * verifying each export's window slot populates correctly.
 *
 *   1. Driver pulley     Cyl Ø 100 × 25 mm   AISI 1045
 *   2. Driven pulley     Cyl Ø 250 × 25 mm   AISI 1045
 *   3. Drive shaft       Cyl Ø 25 × 100 mm   AISI 4140
 *   4. Driven shaft      Cyl Ø 30 × 100 mm   AISI 4140
 *   5. Idler pulley      Cyl Ø 60 × 18 mm    AISI 1018
 *   6. Tensioner arm     Box  120 × 30 × 12 mm AL 6061
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf34-export-hotkeys');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-34 — Pulley-belt drive: Ctrl+Shift+E/P/M/B fire bundle / snapshot / 3MF / BOM', async () => {
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
    window.__lastBundle = null;
    window.__last3MF = null;
    window.__lastBom = null;
    window.__lastSnapshot = null;
  });
  const welcome = win.locator('[data-archdisc-welcome="open"]');
  if (await welcome.isVisible().catch(() => false)) {
    await win.locator('[data-archdisc-welcome-close="true"]').click();
    await expect(welcome).toBeHidden({ timeout: 5000 });
  }

  // Build the 6-body pulley-belt drive.
  const tags = [
    { tool: 'Cylinder', tag: 'PulleyDrive-Driver-1045' },
    { tool: 'Cylinder', tag: 'PulleyDrive-Driven-1045' },
    { tool: 'Cylinder', tag: 'PulleyDrive-DriveShaft-4140' },
    { tool: 'Cylinder', tag: 'PulleyDrive-DrivenShaft-4140' },
    { tool: 'Cylinder', tag: 'PulleyDrive-Idler-1018' },
    { tool: 'Box',      tag: 'PulleyDrive-TensionerArm-AL6061' },
  ];
  for (const c of tags) {
    const before = await win.evaluate(() => {
      const reg = window.__archdiscBodies;
      return (typeof reg.list === 'function' ? reg.list() : reg.bodies).length;
    });
    await win.evaluate(({ tool }) => {
      window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab: 'part', tool } }));
    }, { tool: c.tool });
    await win.waitForFunction(
      ({ n }) => {
        const reg = window.__archdiscBodies;
        const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
        return list.length === n + 1;
      }, { n: before }, { timeout: 30000 });
    await win.evaluate(({ tag }) => {
      const reg = window.__archdiscBodies;
      const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
      if (typeof reg.rename === 'function') reg.rename(list[list.length - 1].id, tag);
    }, { tag: c.tag });
  }
  await win.screenshot({ path: path.join(OUT, '01-belt-drive-built.png') });

  // ─── Ctrl+Shift+E → Export Project Bundle ──────────────────────────
  await win.keyboard.press('Control+Shift+E');
  await win.waitForFunction(() => !!window.__lastBundle?.ok, null, { timeout: 30000 });
  const bundle = await win.evaluate(() => window.__lastBundle);
  console.log('  [Ctrl+Shift+E bundle]', JSON.stringify({ ok: bundle.ok, components: bundle.components }));
  expect(bundle.ok).toBe(true);
  expect(bundle.components).toBe(6);

  // ─── Ctrl+Shift+P → Export Snapshot ────────────────────────────────
  await win.keyboard.press('Control+Shift+P');
  await win.waitForFunction(() => !!window.__lastSnapshot?.ok, null, { timeout: 30000 });
  const snap = await win.evaluate(() => ({
    ok: window.__lastSnapshot.ok,
    width: window.__lastSnapshot.width,
    height: window.__lastSnapshot.height,
  }));
  console.log('  [Ctrl+Shift+P snap]', JSON.stringify(snap));
  expect(snap.ok).toBe(true);
  expect(snap.width).toBeGreaterThan(1000);

  // ─── Ctrl+Shift+M → Export 3MF ─────────────────────────────────────
  await win.keyboard.press('Control+Shift+M');
  await win.waitForFunction(() => !!window.__last3MF?.ok, null, { timeout: 30000 });
  const mf = await win.evaluate(() => ({ ok: window.__last3MF.ok, objects: window.__last3MF.objects }));
  console.log('  [Ctrl+Shift+M 3mf]', JSON.stringify(mf));
  expect(mf.ok).toBe(true);
  expect(mf.objects).toBe(6);

  // ─── Ctrl+Shift+B → Export BOM ─────────────────────────────────────
  await win.keyboard.press('Control+Shift+B');
  await win.waitForFunction(() => !!window.__lastBom?.csv, null, { timeout: 30000 });
  const bom = await win.evaluate(() => ({ ok: window.__lastBom.ok, rows: window.__lastBom.rows }));
  console.log('  [Ctrl+Shift+B bom]', JSON.stringify(bom));
  expect(bom.ok).toBe(true);
  expect(bom.rows).toBe(6);

  await win.screenshot({ path: path.join(OUT, '02-all-hotkeys-fired.png') });
  await app.close();
});
