/**
 * Workflow-33 — Material colour swatch in the Body Properties Inspector.
 *
 * Each material entry in the Inspector's dropdown now ships with a
 * visible colour swatch next to the select control. When the user
 * picks a material, the swatch updates to match -- a small visual
 * cue that ties together the WF-22 OBJ/MTL colour table, the WF-24
 * viewport material-colour paint, and the BOM CSV's reported
 * density.
 *
 * Coherent real-project test: builds a 5-component injection-mould
 * actuator and assigns 4 different materials. Verifies the swatch
 * background-color matches the documented hex for each material.
 *
 *   1. Hydraulic cylinder Cyl  Ø 80 × 200 mm   AISI 4140 (steel-4140)
 *   2. Piston rod         Cyl  Ø 35 × 250 mm   stainless 316L
 *   3. Front gland        Cyl  Ø 100 × 25 mm   brass C36000
 *   4. End cap            Cyl  Ø 100 × 18 mm   brass C36000
 *   5. Mount bracket      Box  140 × 80 × 16 mm Aluminum 6061
 *
 * Coherence checks:
 *   - Swatch renders next to the dropdown with data attribute
 *   - Default no-material swatch background = #a6a8a9
 *   - Assign steel-4140 → swatch flips to #94959e
 *   - Assign stainless → swatch flips to #c7ccd1
 *   - Assign brass → swatch flips to #d9a533
 *   - Assign aluminum → swatch flips to #d4d6db
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf33-material-swatch');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

const SWATCHES = {
  'none':       'rgb(166, 168, 169)',  // #a6a8a9
  'steel-4140': 'rgb(148, 149, 158)',  // #94959e
  'stainless':  'rgb(199, 204, 209)',  // #c7ccd1
  'brass':      'rgb(217, 165, 51)',   // #d9a533
  'aluminum':   'rgb(212, 214, 219)',  // #d4d6db
};

test.describe.configure({ mode: 'serial' });

test('Workflow-33 — Hydraulic actuator: material swatch updates as the Inspector dropdown changes', async () => {
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
    window.localStorage.removeItem('archdisc:body-materials:v1');
    const reg = window.__archdiscBodies;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
  });
  const welcome = win.locator('[data-archdisc-welcome="open"]');
  if (await welcome.isVisible().catch(() => false)) {
    await win.locator('[data-archdisc-welcome-close="true"]').click();
    await expect(welcome).toBeHidden({ timeout: 5000 });
  }

  // Build the 5-body hydraulic actuator.
  const components = [
    { tool: 'Cylinder', tag: 'HydAct-Cylinder-4140',  material: 'steel-4140' },
    { tool: 'Cylinder', tag: 'HydAct-Rod-316L',       material: 'stainless' },
    { tool: 'Cylinder', tag: 'HydAct-FrontGland-Brass', material: 'brass' },
    { tool: 'Cylinder', tag: 'HydAct-EndCap-Brass',   material: 'brass' },
    { tool: 'Box',      tag: 'HydAct-MountBracket-AL6061', material: 'aluminum' },
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

  // Probe the swatch's computed background-color.
  const probeSwatch = () => win.evaluate(() => {
    const el = document.querySelector('[data-archdisc-body-material-swatch]');
    return el ? getComputedStyle(el).backgroundColor : null;
  });

  // ─── Select first body, default = none → grey ──────────────────────
  await win.evaluate(({ id }) => window.__archdiscBodies.select(id, false), { id: ids[0] });
  await expect(win.locator('[data-archdisc-properties-inspector="active"]')).toBeVisible({ timeout: 3000 });
  await win.waitForTimeout(120);
  expect(await probeSwatch()).toBe(SWATCHES['none']);
  await win.screenshot({ path: path.join(OUT, '01-default-swatch.png') });

  // ─── Assign + verify every material ────────────────────────────────
  for (let i = 0; i < components.length; i++) {
    await win.evaluate(({ id }) => window.__archdiscBodies.select(id, false), { id: ids[i] });
    await expect(win.locator('[data-archdisc-properties-inspector="active"]')).toBeVisible({ timeout: 3000 });
    await win.locator('[data-archdisc-body-material-select]').selectOption(components[i].material);
    await win.waitForTimeout(120);
    const swatch = await probeSwatch();
    console.log(`  [${components[i].tag}] swatch=${swatch} expected=${SWATCHES[components[i].material]}`);
    expect(swatch).toBe(SWATCHES[components[i].material]);
  }
  await win.screenshot({ path: path.join(OUT, '02-aluminum-swatch.png') });

  await app.close();
});
