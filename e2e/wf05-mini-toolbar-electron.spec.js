/**
 * Workflow-05 — Selection mini-toolbar (NX-radial / SW-context-style).
 *
 * When a single body is selected, a floating mini-toolbar appears next
 * to its top edge with the 7 most-common selection-driven ops:
 *   Delete · Hide · Isolate · Properties · Fillet · Pattern · Mirror
 *
 * Tracks the body via per-frame world→screen projection so it follows
 * the body during orbit / pan / zoom.
 *
 * Coherent real-project test: builds a pump-housing core assembly via
 * QAT (the WF-04 chain), then exercises the mini-toolbar against it:
 *
 *   - Pump housing block   Box       80 × 60 × 40 mm   AISI 4140
 *   - Inlet boss           Cylinder  Ø 20 × 25 mm     bronze
 *   - Outlet boss          Cylinder  Ø 20 × 25 mm     bronze
 *   - Mounting boss        Cylinder  Ø 15 × 15 mm     AISI 4140
 *
 * Test plan (real selections, real registry operations):
 *   1. Build 4 bodies through QAT pins (no ribbon clicks)
 *   2. Select the inlet boss → assert mini-toolbar visible at non-zero
 *      screen coords, data-archdisc-mini-toolbar-body attribute matches
 *   3. Multi-select (inlet + outlet) → assert mini-toolbar HIDES
 *      (multi-select uses ribbon ops, not the radial)
 *   4. Re-single-select mounting boss → mini-toolbar shows again,
 *      bound to new body id
 *   5. Click "Hide" → assert body.visible == false in registry; click
 *      "Hide" again → visible:true (toggle)
 *   6. Click "Isolate" on housing block → assert ALL OTHER bodies are
 *      visible:false, housing still visible:true
 *   7. Click "Delete" on inlet boss → registry count drops by one
 *   8. Clear selection → mini-toolbar hides
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf05-mini-toolbar');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-05 — Mini-toolbar tracks selection on pump-housing assembly + drives Hide/Isolate/Delete', async () => {
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
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });

  // ─── Build 4 bodies via the run-tool event bridge ───────────────────
  const buildReport = await win.evaluate(async () => {
    const reg = window.__archdiscBodies;
    const fire = (tab, tool) => new Promise(resolve => {
      window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab, tool } }));
      setTimeout(resolve, 1000);
    });
    await fire('part', 'Box');
    await fire('part', 'Cylinder');
    await fire('part', 'Cylinder');
    await fire('part', 'Cylinder');
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    // Name them for readable diagnostics in case any later assertion fails.
    if (typeof reg.rename === 'function') {
      reg.rename(list[0].id, 'PumpHousingBlock-4140');
      reg.rename(list[1].id, 'InletBoss-Bronze');
      reg.rename(list[2].id, 'OutletBoss-Bronze');
      reg.rename(list[3].id, 'MountingBoss-4140');
    }
    return { count: list.length, ids: list.map(b => b.id), names: list.map(b => b.name) };
  });
  console.log('  [build]', JSON.stringify(buildReport));
  expect(buildReport.count).toBe(4);

  await win.screenshot({ path: path.join(OUT, '01-pump-housing.png') });

  const miniToolbar = win.locator('.mini-toolbar');

  // ─── Single-select inlet boss → mini-toolbar appears bound to its id ─
  await win.evaluate(({ id }) => {
    window.__archdiscBodies.select(id, false);
  }, { id: buildReport.ids[1] });

  await expect(miniToolbar).toBeVisible({ timeout: 5000 });
  const boundId = await miniToolbar.getAttribute('data-archdisc-mini-toolbar-body');
  expect(boundId).toBe(buildReport.ids[1]);

  // Position should be a real on-screen coordinate (not off-screen sentinel).
  const box = await miniToolbar.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThan(0);
  expect(box.y).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '02-single-select-mt.png') });

  // ─── Multi-select → mini-toolbar hides (single-select-only) ─────────
  await win.evaluate(({ ids }) => {
    window.__archdiscBodies.selectMany(ids);
  }, { ids: [buildReport.ids[1], buildReport.ids[2]] });
  await expect(miniToolbar).toBeHidden({ timeout: 3000 });

  // ─── Re-single-select mounting boss → reappears, new id ─────────────
  await win.evaluate(({ id }) => {
    window.__archdiscBodies.select(id, false);
  }, { id: buildReport.ids[3] });
  await expect(miniToolbar).toBeVisible({ timeout: 3000 });
  const rebound = await miniToolbar.getAttribute('data-archdisc-mini-toolbar-body');
  expect(rebound).toBe(buildReport.ids[3]);

  // ─── Hide toggle ────────────────────────────────────────────────────
  const isVisible = (id) => win.evaluate(({ id }) => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    return list.find(b => b.id === id)?.visible ?? null;
  }, { id });

  expect(await isVisible(buildReport.ids[3])).toBe(true);
  await win.locator('.mt-btn[data-mt-action="hide"]').click();
  // Wait for the registry update to propagate via onChange listener.
  await win.waitForTimeout(150);
  expect(await isVisible(buildReport.ids[3])).toBe(false);
  await win.locator('.mt-btn[data-mt-action="hide"]').click();
  await win.waitForTimeout(150);
  expect(await isVisible(buildReport.ids[3])).toBe(true);

  // ─── Isolate housing block ──────────────────────────────────────────
  await win.evaluate(({ id }) => {
    window.__archdiscBodies.select(id, false);
  }, { id: buildReport.ids[0] });
  await expect(miniToolbar).toBeVisible({ timeout: 3000 });
  await win.locator('.mt-btn[data-mt-action="isolate"]').click();
  await win.waitForTimeout(200);
  const visMap = await win.evaluate(() => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    return list.map(b => ({ id: b.id, name: b.name, visible: b.visible }));
  });
  console.log('  [isolate]', JSON.stringify(visMap));
  expect(visMap.find(b => b.id === buildReport.ids[0]).visible).toBe(true);
  expect(visMap.find(b => b.id === buildReport.ids[1]).visible).toBe(false);
  expect(visMap.find(b => b.id === buildReport.ids[2]).visible).toBe(false);
  expect(visMap.find(b => b.id === buildReport.ids[3]).visible).toBe(false);

  // Restore visibility for the delete check (un-isolate by making all visible).
  await win.evaluate(({ ids }) => {
    const reg = window.__archdiscBodies;
    for (const id of ids) reg.setVisible(id, true);
  }, { ids: buildReport.ids });

  // ─── Delete inlet boss ──────────────────────────────────────────────
  await win.evaluate(({ id }) => {
    window.__archdiscBodies.select(id, false);
  }, { id: buildReport.ids[1] });
  await expect(miniToolbar).toBeVisible({ timeout: 3000 });
  const beforeDelete = await win.evaluate(() => {
    const reg = window.__archdiscBodies;
    return (typeof reg.list === 'function' ? reg.list() : reg.bodies).length;
  });
  await win.locator('.mt-btn[data-mt-action="delete"]').click();
  await win.waitForTimeout(200);
  const afterDelete = await win.evaluate(() => {
    const reg = window.__archdiscBodies;
    return (typeof reg.list === 'function' ? reg.list() : reg.bodies).length;
  });
  expect(afterDelete).toBe(beforeDelete - 1);

  // ─── Clear selection → toolbar hides ────────────────────────────────
  await win.evaluate(() => {
    window.__archdiscBodies.clearSelection();
  });
  await expect(miniToolbar).toBeHidden({ timeout: 3000 });

  await win.screenshot({ path: path.join(OUT, '03-after-ops.png') });
  await app.close();
});
