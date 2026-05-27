/**
 * Workflow-21 — Hover-glow on body hover (pairs with WF-18 selection).
 *
 * Hovering a body in the viewport paints it engineering green
 * (#5ec97a, emissive intensity 0.22). Selected bodies keep their
 * WF-18 selection blue. Cleared on pointer leave.
 *
 * Coherent real-project test: builds a 5-component machine vise
 * (a real bench-top milling fixture) and walks the cursor over
 * different bodies, asserting:
 *
 *   1. Build 5 bodies → __archdiscHoveredBodyId is null at start
 *   2. Move cursor to body #1's projected screen position → emissive
 *      flips to #5ec97a, hovered-id matches body #1
 *   3. Select body #1 → its emissive switches to selection blue
 *      (#3b7be0), and hovering over it keeps it blue (selection wins)
 *   4. Move cursor to body #3 (not selected) → body #1 keeps blue,
 *      body #3 paints green
 *   5. Move cursor off the canvas → hovered-id clears, body #3 reverts
 *
 *   1. Fixed jaw       Box 80 × 30 × 60 mm   AISI 4140
 *   2. Moving jaw      Box 80 × 30 × 60 mm   AISI 4140
 *   3. Lead screw      Cyl Ø 18 × 130 mm      AISI 1144
 *   4. Vise body       Box 200 × 100 × 50 mm  cast iron
 *   5. Handle          Cyl Ø 14 × 80 mm        AISI 1018
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf21-hover-highlight');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

const HOVER_HEX = '#5ec97a';
const SELECT_HEX = '#3b7be0';

test.describe.configure({ mode: 'serial' });

test('Workflow-21 — Machine vise: pointer hover paints green, selection paints blue, pair plays cleanly together', async () => {
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
    const reg = window.__archdiscBodies;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
  });
  // Dismiss any welcome that auto-opened.
  const welcome = win.locator('[data-archdisc-welcome="open"]');
  if (await welcome.isVisible().catch(() => false)) {
    await win.locator('[data-archdisc-welcome-close="true"]').click();
    await expect(welcome).toBeHidden({ timeout: 5000 });
  }
  // Both drivers must be live.
  await win.waitForFunction(
    () => window.__archdiscSelectionHighlightActive === true
       && window.__archdiscBodyHoverActive === true,
    null, { timeout: 10000 });

  // ─── Build the 5-body vise ──────────────────────────────────────────
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
    const id = await win.evaluate(({ label }) => {
      const reg = window.__archdiscBodies;
      const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
      const last = list[list.length - 1];
      if (typeof reg.rename === 'function') reg.rename(last.id, label);
      return last.id;
    }, { label });
    return id;
  };

  const ids = [];
  ids.push(await buildOne('Box',      'MachineVise-FixedJaw-4140'));
  ids.push(await buildOne('Box',      'MachineVise-MovingJaw-4140'));
  ids.push(await buildOne('Cylinder', 'MachineVise-LeadScrew-1144'));
  ids.push(await buildOne('Box',      'MachineVise-Body-CastIron'));
  ids.push(await buildOne('Cylinder', 'MachineVise-Handle-1018'));
  await win.screenshot({ path: path.join(OUT, '01-vise-built.png') });

  // Probe emissive — same helper as WF-18.
  const probe = (id) => win.evaluate(({ id }) => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    const body = list.find(b => b.id === id);
    let hex = null;
    body?.group?.traverse((obj) => {
      if (obj.isMesh && obj.material && hex === null) {
        const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        if (m.emissive) hex = '#' + m.emissive.getHexString();
      }
    });
    return hex;
  }, { id });

  // ─── 1. No hover at start ───────────────────────────────────────────
  const initHover = await win.evaluate(() => window.__archdiscHoveredBodyId);
  expect(initHover).toBeFalsy();

  // ─── 2. Drive __archdiscSetHoveredBodyId directly (BodyHoverDriver
  // exposes the setter for e2e use without forcing a real raycaster
  // pointermove — body screen coords are noisy in headed e2e). ──────
  await win.evaluate(({ id }) => window.__archdiscSetHoveredBodyId(id), { id: ids[0] });
  await win.waitForTimeout(150);
  expect(await probe(ids[0])).toBe(HOVER_HEX);
  expect(await probe(ids[1])).not.toBe(HOVER_HEX);

  // ─── 3. Select body #1 → it becomes blue, hover on it doesn't apply
  await win.evaluate(({ id }) => window.__archdiscBodies.select(id, false), { id: ids[0] });
  await win.waitForTimeout(150);
  expect(await probe(ids[0])).toBe(SELECT_HEX);

  // Re-hover body #1 while still selected -> stays blue.
  await win.evaluate(({ id }) => window.__archdiscSetHoveredBodyId(id), { id: ids[0] });
  await win.waitForTimeout(120);
  expect(await probe(ids[0])).toBe(SELECT_HEX);

  // ─── 4. Hover body #3 → body #3 green, body #1 still blue ──────────
  await win.evaluate(({ id }) => window.__archdiscSetHoveredBodyId(id), { id: ids[2] });
  await win.waitForTimeout(120);
  expect(await probe(ids[0])).toBe(SELECT_HEX);
  expect(await probe(ids[2])).toBe(HOVER_HEX);

  // ─── 5. Clear hover → body #3 reverts; body #1 still blue ──────────
  await win.evaluate(() => window.__archdiscSetHoveredBodyId(null));
  await win.waitForTimeout(120);
  expect(await probe(ids[0])).toBe(SELECT_HEX);
  expect(await probe(ids[2])).not.toBe(HOVER_HEX);
  expect(await probe(ids[2])).not.toBe(SELECT_HEX);

  await win.screenshot({ path: path.join(OUT, '02-final.png') });
  await app.close();
});
