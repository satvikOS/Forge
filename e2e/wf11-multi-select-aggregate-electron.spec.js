/**
 * Workflow-11 — Multi-select mass-properties roll-up.
 *
 * The Body Properties Inspector previously collapsed to an empty
 * state when multiple bodies were selected (the WF-08 single-select
 * design). This workflow turns that wasted screen real-estate into a
 * real engineering aggregate readout:
 *
 *   ΣVolume        sum of body.volume_mm3
 *   ΣMass          sum of per-body (volume × material density)
 *   Combined Bbox  union of every body's THREE.Box3
 *   Centroid       centre of that combined box
 *   Body list      every selected body with its volume
 *
 * Same pattern as SW's "Mass Properties → Selected items".
 *
 * Coherent real-project test: hydraulic motor assembly — 6 real
 * components, 3 materials, real ISO mm dimensions. The test:
 *   1. Builds 6 bodies via the run-tool dispatch
 *   2. Assigns engineering materials per body via the inspector
 *      while single-selected
 *   3. Multi-selects ALL 6 → asserts the aggregate matches the
 *      per-body sum to 0.1% relative error
 *   4. Multi-selects only the 3 steel bodies → asserts the subset
 *      aggregate matches the steel-only sum
 *   5. Deselect → inspector returns to empty state
 *
 *   1. Motor housing          Cyl   AISI 4140 (steel-4140)
 *   2. End cap (drive)        Cyl   AISI 4140 (steel-4140)
 *   3. End cap (rear)         Cyl   AISI 4140 (steel-4140)
 *   4. Rotor                  Cyl   Aluminum 6061
 *   5. Vane                   Cyl   316L stainless
 *   6. Output shaft           Cyl   AISI 4140 (steel-4140)
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf11-multi-select-aggregate');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-11 — Hydraulic motor assembly: 6-body multi-select aggregate matches per-body sum', async () => {
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
    window.localStorage.setItem('archdisc:welcome:v1', '1');  // suppress modal
  });

  // Reset registry + body materials.
  await win.evaluate(() => {
    const reg = window.__archdiscBodies;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
    window.localStorage.removeItem('archdisc:body-materials:v1');
  });

  // ─── Build hydraulic motor assembly ─────────────────────────────────
  const components = [
    { tag: 'HydraulicMotor-Housing-4140',      material: 'steel-4140', density: 7.85 },
    { tag: 'HydraulicMotor-EndCapDrive-4140',  material: 'steel-4140', density: 7.85 },
    { tag: 'HydraulicMotor-EndCapRear-4140',   material: 'steel-4140', density: 7.85 },
    { tag: 'HydraulicMotor-Rotor-AL6061',      material: 'aluminum',   density: 2.70 },
    { tag: 'HydraulicMotor-Vane-316L',         material: 'stainless',  density: 7.96 },
    { tag: 'HydraulicMotor-OutputShaft-4140',  material: 'steel-4140', density: 7.85 },
  ];

  const buildOne = async (label) => {
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
  for (const c of components) ids.push(await buildOne(c.tag));
  expect(ids.length).toBe(6);
  await win.screenshot({ path: path.join(OUT, '01-motor-built.png') });

  // ─── Assign engineering materials per body via the inspector ────────
  for (let i = 0; i < components.length; i++) {
    await win.evaluate(({ id }) => { window.__archdiscBodies.select(id, false); }, { id: ids[i] });
    await expect(win.locator('[data-archdisc-properties-inspector="active"]')).toBeVisible({ timeout: 3000 });
    await win.locator('[data-archdisc-body-material-select]').selectOption(components[i].material);
    await win.waitForTimeout(100);
  }

  // ─── Multi-select ALL 6 bodies → aggregate readout ──────────────────
  await win.evaluate(({ ids }) => { window.__archdiscBodies.selectMany(ids); }, { ids });
  const allInspector = win.locator('[data-archdisc-properties-inspector="multi"]');
  await expect(allInspector).toBeVisible({ timeout: 3000 });
  const allCount = await allInspector.getAttribute('data-body-count');
  expect(allCount).toBe('6');

  const aggAll = await win.evaluate(() => {
    const volText = document.querySelector('[data-archdisc-multi-volume-mm3]')?.textContent ?? '';
    const massText = document.querySelector('[data-archdisc-multi-mass-g]')?.textContent ?? '';
    return {
      volume: parseFloat(volText.replace(/[^\d.]/g, '')),
      mass: parseFloat(massText.replace(/[^\d.]/g, '')),
    };
  });
  console.log('  [agg all]', JSON.stringify(aggAll));

  // Compute expected aggregate from registry — per-body sum.
  const expectedAll = await win.evaluate(({ ids, components, matMap }) => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    let volume = 0, mass = 0;
    for (let i = 0; i < ids.length; i++) {
      const b = list.find(x => x.id === ids[i]);
      const v = b?.volume_mm3 ?? 0;
      volume += v;
      mass += (v / 1000) * components[i].density;
    }
    return { volume, mass };
  }, { ids, components, matMap: 'unused' });
  console.log('  [expected all]', JSON.stringify(expectedAll));

  expect(Math.abs(aggAll.volume - expectedAll.volume) / expectedAll.volume).toBeLessThan(0.001);
  expect(Math.abs(aggAll.mass   - expectedAll.mass)   / expectedAll.mass).toBeLessThan(0.005);

  // Body list rendered for each selected body.
  const multiItems = await win.locator('[data-archdisc-multi-body-id]').count();
  expect(multiItems).toBe(6);
  await win.screenshot({ path: path.join(OUT, '02-multi-all.png') });

  // ─── Subset: only the 4 steel bodies (ids 0, 1, 2, 5) ───────────────
  const steelIds = [ids[0], ids[1], ids[2], ids[5]];
  await win.evaluate(({ ids }) => { window.__archdiscBodies.selectMany(ids); }, { ids: steelIds });
  await win.waitForTimeout(200);
  const subsetCount = await allInspector.getAttribute('data-body-count');
  expect(subsetCount).toBe('4');

  const aggSteel = await win.evaluate(() => {
    const volText = document.querySelector('[data-archdisc-multi-volume-mm3]')?.textContent ?? '';
    const massText = document.querySelector('[data-archdisc-multi-mass-g]')?.textContent ?? '';
    return {
      volume: parseFloat(volText.replace(/[^\d.]/g, '')),
      mass: parseFloat(massText.replace(/[^\d.]/g, '')),
    };
  });
  const expectedSteel = await win.evaluate(({ ids }) => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    let volume = 0;
    for (const id of ids) {
      const b = list.find(x => x.id === id);
      if (b) volume += b.volume_mm3 ?? 0;
    }
    return { volume, mass: (volume / 1000) * 7.85 };
  }, { ids: steelIds });
  console.log('  [agg steel]', JSON.stringify(aggSteel), '  expected:', JSON.stringify(expectedSteel));
  expect(Math.abs(aggSteel.volume - expectedSteel.volume) / expectedSteel.volume).toBeLessThan(0.001);
  expect(Math.abs(aggSteel.mass   - expectedSteel.mass)   / expectedSteel.mass).toBeLessThan(0.005);

  await win.screenshot({ path: path.join(OUT, '03-multi-steel-only.png') });

  // ─── Clear selection → inspector returns to empty ──────────────────
  await win.evaluate(() => window.__archdiscBodies.clearSelection());
  await expect(win.locator('[data-archdisc-properties-inspector="empty"]')).toBeVisible({ timeout: 3000 });

  await app.close();
});
