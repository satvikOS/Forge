/**
 * Workflow-18 — Selection rim-highlight via emissive material override.
 *
 * Selected bodies get a cool-blue emissive (0x3b7be0, intensity 0.42)
 * painted onto every mesh material. Deselect restores the original
 * emissive precisely (cached per-material on first touch via WeakMap).
 * Plays cleanly with the WF-07 PBR environment lighting (emissive
 * sits on top of env reflection).
 *
 * Coherent real-project test: builds a 6-component reduction gearbox
 * (a real industrial transmission part) and walks every body through
 * the selection lifecycle:
 *
 *   1. Build all 6 bodies → no body has the selected emissive
 *   2. Select body #1 → its material emissive becomes 0x3b7be0
 *   3. Select body #3 → body #1 reverts to its original emissive,
 *      body #3 takes the highlight
 *   4. Multi-select bodies 2, 4, 5 → all three light up; the others
 *      stay default
 *   5. Clear selection → every body reverts to its original emissive
 *
 *   1. Input shaft          Cyl Ø 20 × 80 mm   AISI 4140
 *   2. Pinion gear          Cyl Ø 45 × 22 mm   AISI 8620
 *   3. Intermediate shaft   Cyl Ø 25 × 60 mm   AISI 4140
 *   4. Spur gear            Cyl Ø 90 × 18 mm   AISI 8620
 *   5. Output shaft         Cyl Ø 28 × 60 mm   AISI 4140
 *   6. Reduction housing    Box 180×120×80 mm  A48 Cl40 cast iron
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf18-selection-highlight');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-18 — Reduction gearbox: emissive rim-highlight tracks single/multi/clear selection across 6 bodies', async () => {
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

  // Selection highlight installed (attached on workbench mount).
  await win.waitForFunction(() => window.__archdiscSelectionHighlightActive === true, null, { timeout: 5000 });

  // ─── Build reduction gearbox ────────────────────────────────────────
  const components = [
    { tool: 'Cylinder', tag: 'Gearbox-InputShaft-4140' },
    { tool: 'Cylinder', tag: 'Gearbox-Pinion-8620' },
    { tool: 'Cylinder', tag: 'Gearbox-IntermediateShaft-4140' },
    { tool: 'Cylinder', tag: 'Gearbox-SpurGear-8620' },
    { tool: 'Cylinder', tag: 'Gearbox-OutputShaft-4140' },
    { tool: 'Box',      tag: 'Gearbox-Housing-A48Cl40' },
  ];
  const ids = [];
  for (const c of components) {
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
    const id = await win.evaluate(({ tag }) => {
      const reg = window.__archdiscBodies;
      const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
      const last = list[list.length - 1];
      if (typeof reg.rename === 'function') reg.rename(last.id, tag);
      return last.id;
    }, { tag: c.tag });
    ids.push(id);
  }
  await win.screenshot({ path: path.join(OUT, '01-gearbox-built.png') });

  // Probe emissive for every body — helper returns {id → {hex, intensity}}.
  const SELECTED_HEX = '#3b7be0';
  const probeEmissive = () => win.evaluate(({ ids }) => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    const out = {};
    for (const id of ids) {
      const body = list.find(b => b.id === id);
      let hex = null, intensity = null;
      body?.group?.traverse((obj) => {
        if (obj.isMesh && obj.material && hex === null) {
          const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
          if (m.emissive) hex = '#' + m.emissive.getHexString();
          if (typeof m.emissiveIntensity === 'number') intensity = m.emissiveIntensity;
        }
      });
      out[id] = { hex, intensity };
    }
    return out;
  }, { ids });

  // ─── 1. After build, no body has the selected emissive ─────────────
  const baseline = await probeEmissive();
  console.log('  [baseline]', JSON.stringify(baseline));
  for (const id of ids) {
    expect(baseline[id].hex).not.toBe(SELECTED_HEX);
  }

  // ─── 2. Single-select body #1 → it lights, others stay baseline ────
  await win.evaluate(({ id }) => window.__archdiscBodies.select(id, false), { id: ids[0] });
  await win.waitForTimeout(120);
  const sel1 = await probeEmissive();
  console.log('  [sel #1]', JSON.stringify(sel1));
  expect(sel1[ids[0]].hex).toBe(SELECTED_HEX);
  expect(sel1[ids[0]].intensity).toBeCloseTo(0.42, 2);
  for (let i = 1; i < 6; i++) {
    expect(sel1[ids[i]].hex).not.toBe(SELECTED_HEX);
  }
  await win.screenshot({ path: path.join(OUT, '02-sel-shaft1.png') });

  // ─── 3. Single-select body #3 → #1 reverts, #3 lights ──────────────
  await win.evaluate(({ id }) => window.__archdiscBodies.select(id, false), { id: ids[2] });
  await win.waitForTimeout(120);
  const sel3 = await probeEmissive();
  expect(sel3[ids[0]].hex).not.toBe(SELECTED_HEX);
  expect(sel3[ids[2]].hex).toBe(SELECTED_HEX);
  await win.screenshot({ path: path.join(OUT, '03-sel-intermediate.png') });

  // ─── 4. Multi-select 2 + 4 + 5 → only those three light ────────────
  await win.evaluate(({ a, b, c }) => window.__archdiscBodies.selectMany([a, b, c]), {
    a: ids[1], b: ids[3], c: ids[4],
  });
  await win.waitForTimeout(120);
  const selMulti = await probeEmissive();
  expect(selMulti[ids[1]].hex).toBe(SELECTED_HEX);
  expect(selMulti[ids[3]].hex).toBe(SELECTED_HEX);
  expect(selMulti[ids[4]].hex).toBe(SELECTED_HEX);
  expect(selMulti[ids[0]].hex).not.toBe(SELECTED_HEX);
  expect(selMulti[ids[2]].hex).not.toBe(SELECTED_HEX);
  expect(selMulti[ids[5]].hex).not.toBe(SELECTED_HEX);
  await win.screenshot({ path: path.join(OUT, '04-sel-multi.png') });

  // ─── 5. Clear selection → every body reverts ──────────────────────
  await win.evaluate(() => window.__archdiscBodies.clearSelection());
  await win.waitForTimeout(120);
  const cleared = await probeEmissive();
  for (const id of ids) {
    expect(cleared[id].hex).not.toBe(SELECTED_HEX);
  }
  console.log('  [cleared]', JSON.stringify(cleared));
  await win.screenshot({ path: path.join(OUT, '05-cleared.png') });

  await app.close();
});
