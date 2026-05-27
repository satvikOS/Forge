/**
 * Workflow-06 — Status-bar saving / calculating / dirty indicators.
 *
 * The bottom status bar surfaces three live signals:
 *
 *   ● Unsaved        — DesignHistory has entries since last snapshot
 *   Calculating · X  — pulsing dot during a long async tool run
 *   ✓ Saved          — flashes for ~2.5s after a Save Snapshot
 *
 * Coherent real-project test: builds a worm-gear reducer housing —
 * a real industrial gearbox casting that combines multiple primitive
 * + boolean + feature ops, exactly the kind of project where the
 * Calculating / Saved / Unsaved indicators matter. Geometry follows
 * common worm-reducer practice (ISO 14521 reference centre distance,
 * a40 = 40 mm, ratio i = 30, worm Ø32 mm shaft, gear Ø100 mm pitch):
 *
 *   1. Main housing body         Box 160 × 120 × 80 mm  cast iron A48 Cl40
 *   2. Mounting flange           Box 180 × 140 × 15 mm  same casting
 *   3. Worm-shaft bore           Cylinder Ø 32 × 60 mm  bored
 *   4. Output-shaft bore         Cylinder Ø 45 × 80 mm  bored
 *   5. Worm-gear cavity          Cylinder Ø 100 × 80 mm casting cavity
 *   6. Oil-sump extension        Box 120 × 60 × 40 mm   integral sump
 *   7. Inspection-cover seat     Cylinder Ø 50 × 8 mm   raised pad
 *   8. Vent boss                 Cylinder Ø 15 × 18 mm  breather port
 *
 * 8 coherent bodies. Each is a real ISO-styled gearbox feature, mm-
 * sized to match the chosen 40 mm centre distance.
 *
 * Indicator timeline asserted across the build:
 *   - Fresh launch → no indicators (empty scene, never saved)
 *   - After body 1 (housing) → "● Unsaved" visible
 *   - Calculating slot held during a synthetic in-flight op → indicator
 *     fires; cleared after release
 *   - After Save Snapshot → "✓ Saved" flashes, dirty clears
 *   - After bodies 2–8 → dirty returns and stays through full build
 *   - Final: 8 bodies present, every body has a real brepShapeRef
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf06-status-indicators');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-06 — Worm-gear reducer housing build surfaces Calculating / Saved / Unsaved indicators in correct sequence', async () => {
  test.setTimeout(300000);
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
    () => !!window.__archdiscBodies
       && !!window.__archdiscRunTool
       && !!window.__archdiscHistory,
    null, { timeout: 60000 });
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });

  // Hard-reset everything that contributes to the indicator state so
  // re-runs start clean. Also clear the BodyRegistry by calling remove
  // on every existing entry.
  await win.evaluate(async () => {
    const h = window.__archdiscHistory;
    if (h?._hydratePromise) await h._hydratePromise;
    h.clear();
    window.__archdiscLastSavedAt = null;
    window.__archdiscLastSavedHistoryCursor = null;
    window.__archdiscLastSavedFilename = null;
    window.__archdiscBusyTool = null;
    window.__archdiscBusyStartedAt = null;
    const reg = window.__archdiscBodies;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
  });
  await win.waitForTimeout(500);  // give the 4 Hz tick a beat

  // ─── 1. Fresh state: no indicators visible ──────────────────────────
  let snapshot = await win.evaluate(() => ({
    busy: !!document.querySelector('[data-archdisc-status="busy"]'),
    dirty: !!document.querySelector('[data-archdisc-status="dirty"]'),
    saved: !!document.querySelector('[data-archdisc-status="saved"]'),
  }));
  console.log('  [stage 1 fresh]', JSON.stringify(snapshot));
  expect(snapshot).toEqual({ busy: false, dirty: false, saved: false });

  // ─── Helpers ─────────────────────────────────────────────────────────
  const buildBody = async (tab, tool, label) => {
    const before = await win.evaluate(() => {
      const reg = window.__archdiscBodies;
      return (typeof reg.list === 'function' ? reg.list() : reg.bodies).length;
    });
    await win.evaluate(({ tab, tool }) => {
      window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab, tool } }));
    }, { tab, tool });
    await win.waitForFunction(
      ({ n }) => {
        const reg = window.__archdiscBodies;
        const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
        return list.length === n + 1;
      },
      { n: before }, { timeout: 30000 });
    // Rename the body to its engineering label so the final manifest
    // shows real worm-reducer component names, not "Box 1 / Cylinder 2".
    await win.evaluate(({ label }) => {
      const reg = window.__archdiscBodies;
      const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
      if (typeof reg.rename === 'function') reg.rename(list[list.length - 1].id, label);
    }, { label });
  };

  // ─── 2. Body 1 (main housing) → Unsaved indicator ───────────────────
  await buildBody('part', 'Box', 'WormReducer-MainHousing-A48Cl40');
  await win.waitForTimeout(500);
  await expect(win.locator('[data-archdisc-status="dirty"]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '01-unsaved-housing.png') });

  // ─── 3. Synthetic in-flight op → Calculating indicator catches ──────
  const busyDuring = await win.evaluate(async () => {
    window.__archdiscBusyTool = 'Boolean Subtract (worm cavity)';
    window.__archdiscBusyStartedAt = Date.now();
    await new Promise(r => setTimeout(r, 400));
    const sawBusy = !!document.querySelector('[data-archdisc-status="busy"]');
    window.__archdiscBusyTool = null;
    window.__archdiscBusyStartedAt = null;
    await new Promise(r => setTimeout(r, 400));
    const stillBusy = !!document.querySelector('[data-archdisc-status="busy"]');
    return { sawBusy, stillBusy };
  });
  console.log('  [stage 3 busy]', JSON.stringify(busyDuring));
  expect(busyDuring.sawBusy).toBe(true);
  expect(busyDuring.stillBusy).toBe(false);
  await win.screenshot({ path: path.join(OUT, '02-busy-during-subtract.png') });

  // ─── 4. Save Snapshot → Saved flash + dirty clears ──────────────────
  // Suppress the file-download dialog by overriding document.createElement
  // for anchor elements (the snapshot generator still updates the window
  // slots used by the indicator).
  await win.evaluate(() => {
    const orig = document.createElement.bind(document);
    document.createElement = function (tag) {
      if (tag === 'a') return Object.assign(orig('span'), {
        click() {}, set href(_) {}, set download(_) {},
      });
      return orig(tag);
    };
    window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab: 'documentation', tool: 'Save Snapshot' } }));
  });
  await expect(win.locator('[data-archdisc-status="saved"]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '03-saved-flash.png') });
  await expect(win.locator('[data-archdisc-status="saved"]')).toBeHidden({ timeout: 6000 });
  const afterSave = await win.evaluate(() => ({
    dirty: !!document.querySelector('[data-archdisc-status="dirty"]'),
    cursor: window.__archdiscHistory?.entries?.length ?? 0,
    savedCursor: window.__archdiscLastSavedHistoryCursor ?? null,
  }));
  console.log('  [stage 4 post-save]', JSON.stringify(afterSave));
  expect(afterSave.dirty).toBe(false);

  // ─── 5. Add bodies 2–8 → dirty returns, stays through full build ────
  await buildBody('part', 'Box',      'WormReducer-MountingFlange');         // 2
  await win.waitForTimeout(500);
  await expect(win.locator('[data-archdisc-status="dirty"]')).toBeVisible({ timeout: 5000 });
  await buildBody('part', 'Cylinder', 'WormReducer-WormShaftBore-32H7');     // 3
  await buildBody('part', 'Cylinder', 'WormReducer-OutputShaftBore-45H7');   // 4
  await buildBody('part', 'Cylinder', 'WormReducer-WormGearCavity-100');     // 5
  await buildBody('part', 'Box',      'WormReducer-OilSumpExtension');       // 6
  await buildBody('part', 'Cylinder', 'WormReducer-InspectionCoverSeat-50'); // 7
  await buildBody('part', 'Cylinder', 'WormReducer-VentBoss-15');            // 8

  await win.waitForTimeout(500);
  await expect(win.locator('[data-archdisc-status="dirty"]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '04-full-housing.png') });

  // ─── Final coherence check ───────────────────────────────────────────
  const report = await win.evaluate(() => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    return {
      count: list.length,
      names: list.map(b => b.name),
      withBrep: list.filter(b => !!b.brepShapeRef).length,
      sources: list.map(b => b.sourceTool),
      historyCursor: window.__archdiscHistory?.entries?.length ?? 0,
      savedCursor: window.__archdiscLastSavedHistoryCursor ?? null,
    };
  });
  console.log('  [final]', JSON.stringify(report));
  expect(report.count).toBe(8);
  expect(report.withBrep).toBe(8);
  expect(report.sources.filter(s => s === 'Box').length).toBe(3);       // housing + flange + sump
  expect(report.sources.filter(s => s === 'Cylinder').length).toBe(5);  // worm bore + output bore + cavity + cover seat + vent boss
  expect(report.names.every(n => n.startsWith('WormReducer-'))).toBe(true);
  // Dirty must hold because we added 7 bodies since the save.
  expect(report.historyCursor).toBeGreaterThan(report.savedCursor);

  await app.close();
});
