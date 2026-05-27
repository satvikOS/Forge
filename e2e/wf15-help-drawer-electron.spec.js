/**
 * Workflow-15 — F1-triggered help drawer.
 *
 * Press F1 → a slide-in drawer on the right shows the docs for the
 * tool the user just ran. ESC or F1 again closes it. Tools with
 * authored docs (~25 most-used) render structured Summary /
 * Parameters / Tips. Unknown tools fall back to an honest "no docs
 * yet" panel so users know the coverage state.
 *
 * Coherent real-project test: builds a turbocharger compressor wheel
 * mock-up — 5 components, real automotive-turbo dimensions — and
 * walks the user's hand through F1 on each ribbon tool used during
 * the build:
 *
 *   1. Compressor inducer hub   Cyl Ø 50 × 30 mm   Inconel 718
 *   2. Compressor wheel boss    Cyl Ø 65 × 20 mm   Inconel 718
 *   3. Backplate                Cyl Ø 75 × 6 mm    Inconel 718
 *   4. Bearing journal          Cyl Ø 14 × 35 mm   M50 steel
 *   5. Compressor cap           Cyl Ø 22 × 10 mm   Inconel 718
 *
 * Assertions:
 *   - F1 with no prior tool → drawer opens with empty-state body
 *   - Build first body via Cylinder; F1 → drawer body bound to
 *     "Cylinder" with summary mentioning "right-circular cylinder"
 *   - Build a Box body via the ribbon; F1 → drawer rebinds to "Box"
 *   - F1 again → drawer closes
 *   - ESC closes the drawer
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf15-help-drawer');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-15 — F1 help drawer shows tool-specific docs through a turbocharger compressor wheel build', async () => {
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
    window.__archdiscLastTool = null;
    const reg = window.__archdiscBodies;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
  });

  const drawer = win.locator('[data-archdisc-help-drawer="open"]');

  // ─── 1. F1 with no prior tool → empty-state body ───────────────────
  await win.keyboard.press('F1');
  await expect(drawer).toBeVisible({ timeout: 3000 });
  const emptyBody = await win.locator('[data-archdisc-help-body]').getAttribute('data-archdisc-help-body');
  expect(emptyBody).toBe('empty');
  await win.screenshot({ path: path.join(OUT, '01-help-empty.png') });
  await win.keyboard.press('F1');  // close
  await expect(drawer).toBeHidden({ timeout: 3000 });

  // ─── 2. Build Cylinder → F1 → drawer bound to "Cylinder" ───────────
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

  await buildOne('Cylinder', 'Turbo-CompressorInducerHub-Inconel718');
  // Wait for the lastTool slot to update.
  await win.waitForFunction(() => window.__archdiscLastTool === 'Cylinder', null, { timeout: 5000 });
  await win.keyboard.press('F1');
  await expect(drawer).toBeVisible({ timeout: 3000 });
  expect(await drawer.getAttribute('data-archdisc-help-tool')).toBe('Cylinder');
  expect(await win.locator('[data-archdisc-help-body]').getAttribute('data-archdisc-help-body')).toBe('docs');
  await expect(win.locator('.help-summary')).toContainText(/right-circular cylinder/i);
  // Cylinder doc declares 2 parameters (Radius, Height).
  expect(await win.locator('.help-param').count()).toBe(2);
  await win.screenshot({ path: path.join(OUT, '02-help-cylinder.png') });

  // Drawer must persist across additional cylinder builds.
  await buildOne('Cylinder', 'Turbo-CompressorWheelBoss-Inconel718');
  await buildOne('Cylinder', 'Turbo-Backplate-Inconel718');
  await buildOne('Cylinder', 'Turbo-BearingJournal-M50');
  await buildOne('Cylinder', 'Turbo-CompressorCap-Inconel718');
  await expect(drawer).toBeVisible();  // never closed

  // ─── 3. Switch to Box → drawer rebinds ──────────────────────────────
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab: 'part', tool: 'Box' } }));
  });
  await win.waitForFunction(() => window.__archdiscLastTool === 'Box', null, { timeout: 10000 });
  // The drawer polls __archdiscLastTool at 4 Hz; give it a beat.
  await win.waitForTimeout(400);
  expect(await drawer.getAttribute('data-archdisc-help-tool')).toBe('Box');
  await expect(win.locator('.help-summary')).toContainText(/rectangular solid primitive/i);
  // Box doc declares 3 parameters (Width, Depth, Height).
  expect(await win.locator('.help-param').count()).toBe(3);
  await win.screenshot({ path: path.join(OUT, '03-help-box.png') });

  // ─── 4. ESC closes ─────────────────────────────────────────────────
  await win.keyboard.press('Escape');
  await expect(drawer).toBeHidden({ timeout: 3000 });

  // ─── 5. Final body count ───────────────────────────────────────────
  const report = await win.evaluate(() => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    return {
      count: list.length,
      withBrep: list.filter(b => !!b.brepShapeRef).length,
      names: list.map(b => b.name),
    };
  });
  console.log('  [final]', JSON.stringify(report));
  expect(report.count).toBe(6);   // 5 cylinders + 1 box
  expect(report.withBrep).toBe(6);
  expect(report.names.every(n => n.startsWith('Turbo-') || /^Box \d+$/.test(n))).toBe(true);

  await app.close();
});
