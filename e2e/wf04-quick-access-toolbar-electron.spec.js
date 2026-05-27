/**
 * Workflow-04 — Quick Access Toolbar (QAT).
 *
 * SolidWorks/NX-style persistent strip above the ribbon: one-click
 * access to Save / Undo / Redo / Box / Cylinder / Extrude / Bundle
 * regardless of which ribbon tab is active. Right-click unpins; the
 * (+) action opens a picker listing every ribbon tool; pins persist
 * across reloads via localStorage `archdisc:qat:v1`.
 *
 * Coherent real-project test: builds a die-set tooling stack via QAT
 * pins only — no ribbon clicks. A die-set is a real metal-stamping
 * tooling assembly:
 *
 *   - Die shoe       Box       200 × 150 × 25 mm   AISI 4140
 *   - Punch holder   Box       200 × 150 × 25 mm   AISI 4140
 *   - Guide post 1   Cylinder  Ø 30 × 200 mm       casehardened 8620
 *   - Guide post 2   Cylinder  Ø 30 × 200 mm       casehardened 8620
 *   - Punch          Cylinder  Ø 20 × 80 mm        D2 tool steel
 *
 * Coherence checks:
 *   • QAT renders 7 default pins (Save, Undo, Redo, Box, Cylinder,
 *     Extrude, Export Bundle)
 *   • Clicking the "Box" pin TWICE creates two distinct bodies
 *   • Clicking the "Cylinder" pin THREE TIMES creates three more
 *   • localStorage key `archdisc:qat:v1` is populated after first
 *     reload (default set persisted)
 *   • Right-click on the Box pin removes it from the pin row
 *   • Pin removal also survives a reload
 *   • Final body count = 5 (no extras from accidental dispatches)
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf04-quick-access-toolbar');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-04 — Die-set tooling stack built entirely through QAT pin clicks', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  // ─── PASS 1 ─ Build assembly through pins; unpin Box; reload check ──
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

  // Hard-reset QAT localStorage so the test is deterministic when
  // re-run (a prior failure could leave a partial pin set behind, and
  // the harness reuses the Electron user-data directory across runs).
  // After clearing, reload so QuickAccessToolbar re-reads defaults.
  await win.evaluate(() => { window.localStorage.removeItem('archdisc:qat:v1'); });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscBodies && !!window.__archdiscRunTool,
    null, { timeout: 60000 });
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });

  // QAT visible with all 7 defaults.
  const qat = win.locator('.qat');
  await expect(qat).toBeVisible({ timeout: 5000 });
  await expect(win.locator('.qat-pin')).toHaveCount(7, { timeout: 5000 });
  const pinCount = await win.locator('.qat-pin').count();
  expect(pinCount).toBe(7);

  // The pins SHOULD be exactly the default set in the documented order.
  const pinLabels = await win.locator('.qat-pin .qat-label').allInnerTexts();
  expect(pinLabels).toEqual(['Save', 'Undo', 'Redo', 'Box', 'Cylinder', 'Extrude', 'Export Bundle']);

  const bodyCount = () => win.evaluate(() => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    return list.length;
  });
  expect(await bodyCount()).toBe(0);

  // ─── Die shoe: pin click "Box" ─────────────────────────────────────
  const clickPin = async (label) => {
    const sel = `.qat-pin[data-qat-pin]`;
    const handles = await win.locator(sel).all();
    for (const h of handles) {
      const text = await h.locator('.qat-label').textContent();
      if ((text || '').trim() === label) {
        await h.click();
        return true;
      }
    }
    return false;
  };

  expect(await clickPin('Box')).toBe(true);
  await win.waitForFunction(() => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    return list.length === 1;
  }, null, { timeout: 30000 });
  await win.screenshot({ path: path.join(OUT, '01-die-shoe.png') });

  // ─── Punch holder: pin click "Box" again ───────────────────────────
  expect(await clickPin('Box')).toBe(true);
  await win.waitForFunction(() => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    return list.length === 2;
  }, null, { timeout: 30000 });

  // ─── Guide posts ×2 + Punch ×1: pin click "Cylinder" three times ───
  for (let i = 0; i < 3; i++) {
    expect(await clickPin('Cylinder')).toBe(true);
    const expected = 3 + i;
    await win.waitForFunction(
      ({ n }) => {
        const reg = window.__archdiscBodies;
        const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
        return list.length === n;
      }, { n: expected }, { timeout: 30000 });
  }

  await win.screenshot({ path: path.join(OUT, '02-die-set-assembled.png') });

  // ─── Sanity: 5 bodies, real kernel-backed brep refs ────────────────
  const report = await win.evaluate(() => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    return {
      count: list.length,
      sources: list.map(b => b.sourceTool),
      withBrep: list.filter(b => !!b.brepShapeRef).length,
      qatStored: window.localStorage.getItem('archdisc:qat:v1'),
    };
  });
  console.log('  [pass1]', JSON.stringify({ ...report, qatStored: !!report.qatStored }));
  expect(report.count).toBe(5);
  expect(report.withBrep).toBe(5);
  expect(report.sources.filter(s => s === 'Box').length).toBe(2);
  expect(report.sources.filter(s => s === 'Cylinder').length).toBe(3);
  expect(typeof report.qatStored).toBe('string');
  expect(report.qatStored.includes('"Box"')).toBe(true);

  // ─── Unpin Box via right-click ─────────────────────────────────────
  const boxPin = win.locator('.qat-pin[data-qat-pin="Box"]');
  await boxPin.click({ button: 'right' });
  await expect(win.locator('.qat-pin[data-qat-pin="Box"]')).toHaveCount(0);
  const afterUnpinLabels = await win.locator('.qat-pin .qat-label').allInnerTexts();
  expect(afterUnpinLabels).not.toContain('Box');
  expect(afterUnpinLabels.length).toBe(6);

  await win.screenshot({ path: path.join(OUT, '03-after-unpin.png') });
  await app.close();

  // ─── PASS 2 ─ Reload and confirm unpinned state persists ───────────
  const app2 = await electron.launch({
    args: [MAIN],
    env: { ...process.env, NODE_ENV: 'test' },
    slowMo: 0,
  });
  const win2 = await app2.firstWindow();
  await win2.waitForLoadState('domcontentloaded');
  await expect(win2.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await expect(win2.locator('.qat')).toBeVisible({ timeout: 5000 });

  const reloadedLabels = await win2.locator('.qat-pin .qat-label').allInnerTexts();
  console.log('  [pass2 reload]', JSON.stringify(reloadedLabels));
  expect(reloadedLabels.length).toBe(6);
  expect(reloadedLabels).not.toContain('Box');
  // The 6 surviving pins are the defaults minus Box, in original order.
  expect(reloadedLabels).toEqual(['Save', 'Undo', 'Redo', 'Cylinder', 'Extrude', 'Export Bundle']);

  await win2.screenshot({ path: path.join(OUT, '04-reload-persisted.png') });
  await app2.close();
});
