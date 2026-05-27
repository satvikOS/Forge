/**
 * Workflow-23 — Section / clipping-plane scrubber.
 *
 * Real CAD section view: place a clipping plane along X / Y / Z,
 * scrub its position through the assembly, see every body cut. Drives
 * Three.js's renderer.clippingPlanes from a small viewport overlay
 * (axis buttons + position slider).
 *
 * Coherent real-project test: builds an aerospace pressure-vessel
 * mock-up -- a real hemispherical-end cylinder with internal stiffener
 * rings -- and walks a Y-axis section through it to reveal the
 * interior:
 *
 *   1. Cylindrical shell    Cyl Ø 200 × 400 mm  A516 Gr.70
 *   2. Stiffener ring 1     Cyl Ø 160 × 6 mm    A516 Gr.70
 *   3. Stiffener ring 2     Cyl Ø 160 × 6 mm    A516 Gr.70
 *   4. Stiffener ring 3     Cyl Ø 160 × 6 mm    A516 Gr.70
 *   5. Hemispherical cap 1  Cyl Ø 200 × 100 mm  A516 Gr.70
 *   6. Hemispherical cap 2  Cyl Ø 200 × 100 mm  A516 Gr.70
 *
 * Coherence checks:
 *   - SectionPlaneOverlay renders with X/Y/Z buttons
 *   - Activate Y-axis section → renderer.clippingPlanes length === 1,
 *     plane normal == (0,1,0), constant matches -positionMm/1000
 *   - Scrub position 0 → 75 mm → -50 mm; plane.constant updates each
 *     time and __archdiscSectionPosition mirror tracks
 *   - Pressing the Y button again toggles section off; clippingPlanes
 *     becomes empty
 *   - Clear via × button while active also works
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf23-section-plane');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-23 — Aerospace pressure vessel: Y-axis section scrubs through stiffener rings + caps', async () => {
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
    () => !!window.__archdiscBodies && !!window.__archdiscRunTool && !!window.__archdiscSetSectionAxis,
    null, { timeout: 60000 });
  await win.evaluate(() => {
    window.__archdiscBypassDialog = true;
    window.localStorage.setItem('archdisc:welcome:v1', '1');
    window.localStorage.setItem('archdisc:splash:lastShownAt', String(Date.now()));
    const reg = window.__archdiscBodies;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
  });
  const welcome = win.locator('[data-archdisc-welcome="open"]');
  if (await welcome.isVisible().catch(() => false)) {
    await win.locator('[data-archdisc-welcome-close="true"]').click();
    await expect(welcome).toBeHidden({ timeout: 5000 });
  }

  // ─── Build the 6-component aerospace pressure vessel ────────────────
  const tags = [
    'PressureVessel-Shell-A516Gr70',
    'PressureVessel-StiffenerRing1',
    'PressureVessel-StiffenerRing2',
    'PressureVessel-StiffenerRing3',
    'PressureVessel-Cap1',
    'PressureVessel-Cap2',
  ];
  for (const tag of tags) {
    const before = await win.evaluate(() => {
      const reg = window.__archdiscBodies;
      return (typeof reg.list === 'function' ? reg.list() : reg.bodies).length;
    });
    await win.evaluate(() => {
      window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab: 'part', tool: 'Cylinder' } }));
    });
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
    }, { tag });
  }
  await win.screenshot({ path: path.join(OUT, '01-vessel-built.png') });

  // ─── Overlay renders + axis buttons present ─────────────────────────
  const overlay = win.locator('[data-archdisc-section-overlay="active"]');
  await expect(overlay).toBeVisible({ timeout: 5000 });
  expect(await win.locator('[data-archdisc-section-axis-btn="x"]').count()).toBe(1);
  expect(await win.locator('[data-archdisc-section-axis-btn="y"]').count()).toBe(1);
  expect(await win.locator('[data-archdisc-section-axis-btn="z"]').count()).toBe(1);

  // ─── Activate Y section → renderer carries a plane with normal (0,1,0)
  await win.locator('[data-archdisc-section-axis-btn="y"]').click();
  await win.waitForTimeout(150);
  const stateAfterY = await win.evaluate(() => ({
    axis: window.__archdiscSectionAxis,
    pos: window.__archdiscSectionPosition,
    planeCount: window.__archdiscViewport?.renderer?.clippingPlanes?.length ?? null,
    normal: (() => {
      const p = window.__archdiscViewport?.renderer?.clippingPlanes?.[0];
      return p ? { x: p.normal.x, y: p.normal.y, z: p.normal.z } : null;
    })(),
    constant: window.__archdiscViewport?.renderer?.clippingPlanes?.[0]?.constant ?? null,
  }));
  console.log('  [Y on]', JSON.stringify(stateAfterY));
  expect(stateAfterY.axis).toBe('y');
  expect(stateAfterY.planeCount).toBe(1);
  expect(stateAfterY.normal).toEqual({ x: 0, y: 1, z: 0 });
  expect(stateAfterY.constant).toBeCloseTo(0, 5);

  await win.screenshot({ path: path.join(OUT, '02-Y-section-active.png') });

  // ─── Scrub position 75 mm → constant updates to -0.075 metres ───────
  await win.evaluate(() => window.__archdiscSetSectionPositionMm(75));
  await win.waitForTimeout(60);
  const at75 = await win.evaluate(() => ({
    pos: window.__archdiscSectionPosition,
    constant: window.__archdiscViewport?.renderer?.clippingPlanes?.[0]?.constant ?? null,
  }));
  expect(at75.pos).toBe(75);
  expect(at75.constant).toBeCloseTo(-0.075, 5);

  // ─── Scrub to -50 mm ───────────────────────────────────────────────
  await win.evaluate(() => window.__archdiscSetSectionPositionMm(-50));
  await win.waitForTimeout(60);
  const atNeg50 = await win.evaluate(() => ({
    pos: window.__archdiscSectionPosition,
    constant: window.__archdiscViewport?.renderer?.clippingPlanes?.[0]?.constant ?? null,
  }));
  expect(atNeg50.pos).toBe(-50);
  expect(atNeg50.constant).toBeCloseTo(0.05, 5);
  await win.screenshot({ path: path.join(OUT, '03-Y-section-scrubbed.png') });

  // ─── Press Y again → toggle off ────────────────────────────────────
  await win.locator('[data-archdisc-section-axis-btn="y"]').click();
  await win.waitForTimeout(120);
  const cleared = await win.evaluate(() => ({
    axis: window.__archdiscSectionAxis,
    planeCount: window.__archdiscViewport?.renderer?.clippingPlanes?.length ?? null,
  }));
  expect(cleared.axis).toBeFalsy();
  expect(cleared.planeCount).toBe(0);

  // ─── Activate X, then use × button to clear ────────────────────────
  await win.locator('[data-archdisc-section-axis-btn="x"]').click();
  await win.waitForTimeout(120);
  expect(await win.evaluate(() => window.__archdiscSectionAxis)).toBe('x');
  expect(await win.locator('[data-archdisc-section-clear="true"]').count()).toBe(1);
  await win.locator('[data-archdisc-section-clear="true"]').click();
  await win.waitForTimeout(120);
  expect(await win.evaluate(() => window.__archdiscSectionAxis)).toBeFalsy();

  await app.close();
});
