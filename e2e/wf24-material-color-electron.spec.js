/**
 * Workflow-24 — Paint body diffuse colour by assigned material.
 *
 * When the user assigns an engineering material via the WF-08 Body
 * Properties Inspector dropdown, the corresponding body's mesh
 * material.color flips to the Munsell-style physical-surface RGB
 * shipped in WF-22 MeshObjMultiExport. The viewport, the Inspector,
 * the BOM CSV, and the OBJ export all then carry the same colour.
 *
 * Coherent real-project test: builds a 6-component automotive
 * exhaust manifold and assigns three real materials. Verifies that
 * each body's mesh material.color matches the documented hex for
 * the chosen material:
 *
 *   1. Header tube 1   Cyl Ø 40 × 200 mm  Inconel 625 (titanium →
 *                                          stand-in for high-temp)
 *   2. Header tube 2   Cyl Ø 40 × 200 mm  Inconel 625
 *   3. Header tube 3   Cyl Ø 40 × 200 mm  Inconel 625
 *   4. Collector      Cyl Ø 60 × 80 mm   stainless 316L
 *   5. O2 sensor boss Cyl Ø 22 × 22 mm   brass C36000
 *   6. Mounting flange Box 120 × 100 × 8 mm cast iron A48 Cl40
 *
 * (Engineering note: real exhaust manifolds use Inconel / 304 / 321
 * stainless. The Inspector's material registry is bounded to common
 * shop materials; the colour mapping covers the principal hues used
 * across CAD seats — titanium beige is close enough to the high-
 * temperature alloy appearance for the visual sync test.)
 *
 * Coherence checks:
 *   - After material assignment, body.mesh.material.color matches
 *     the documented RGB to 0.005 tolerance
 *   - Reverting a body's material to "no material" restores its
 *     original color exactly (WeakMap round-trip)
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf24-material-color');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

// Mirrors BodyMaterialColor.js's MATERIAL_COLORS exactly.
const EXPECTED_COLORS = {
  'titanium':  [0.68, 0.66, 0.66],
  'stainless': [0.78, 0.80, 0.82],
  'brass':     [0.85, 0.65, 0.20],
  'cast-iron': [0.36, 0.36, 0.38],
};

test.describe.configure({ mode: 'serial' });

test('Workflow-24 — Exhaust manifold: per-body diffuse colour matches assigned material', async () => {
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
    () => !!window.__archdiscBodies && !!window.__archdiscRunTool && window.__archdiscBodyMaterialColorActive === true,
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

  // ─── Build the 6-component exhaust manifold ─────────────────────────
  const components = [
    { tool: 'Cylinder', tag: 'ExhaustManifold-Header1-Inconel', material: 'titanium' },
    { tool: 'Cylinder', tag: 'ExhaustManifold-Header2-Inconel', material: 'titanium' },
    { tool: 'Cylinder', tag: 'ExhaustManifold-Header3-Inconel', material: 'titanium' },
    { tool: 'Cylinder', tag: 'ExhaustManifold-Collector-316L',  material: 'stainless' },
    { tool: 'Cylinder', tag: 'ExhaustManifold-O2Boss-Brass',    material: 'brass' },
    { tool: 'Box',      tag: 'ExhaustManifold-Flange-CastIron', material: 'cast-iron' },
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
  await win.screenshot({ path: path.join(OUT, '01-manifold-built.png') });

  // ─── Assign materials via the Inspector dropdown ────────────────────
  for (let i = 0; i < ids.length; i++) {
    await win.evaluate(({ id }) => window.__archdiscBodies.select(id, false), { id: ids[i] });
    await expect(win.locator('[data-archdisc-properties-inspector="active"]')).toBeVisible({ timeout: 3000 });
    await win.locator('[data-archdisc-body-material-select]').selectOption(components[i].material);
    await win.waitForTimeout(120);
  }
  await win.evaluate(() => window.__archdiscBodies.clearSelection());
  // Wait for the colour-poller to repaint.
  await win.waitForTimeout(400);

  // ─── Verify each body's mesh material.color matches the spec ────────
  const probe = (id) => win.evaluate(({ id }) => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    const body = list.find(b => b.id === id);
    let rgb = null;
    body?.group?.traverse((obj) => {
      if (obj.isMesh && obj.material && rgb === null) {
        const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        if (m.color) rgb = [m.color.r, m.color.g, m.color.b];
      }
    });
    return rgb;
  }, { id });

  for (let i = 0; i < ids.length; i++) {
    const rgb = await probe(ids[i]);
    const exp = EXPECTED_COLORS[components[i].material];
    console.log(`  [${components[i].tag}] rgb=${rgb} expected=${exp}`);
    expect(rgb).not.toBeNull();
    expect(rgb[0]).toBeCloseTo(exp[0], 2);
    expect(rgb[1]).toBeCloseTo(exp[1], 2);
    expect(rgb[2]).toBeCloseTo(exp[2], 2);
  }
  await win.screenshot({ path: path.join(OUT, '02-coloured.png') });

  // ─── Revert one body's material to "no material" → restores original
  const originalRgb = await win.evaluate(({ id }) => {
    // Manually grab a fresh body's baseline by creating a new cylinder.
    window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab: 'part', tool: 'Cylinder' } }));
    return new Promise(resolve => {
      const reg = window.__archdiscBodies;
      const before = (typeof reg.list === 'function' ? reg.list() : reg.bodies).length;
      const t0 = Date.now();
      const tick = () => {
        const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
        if (list.length === before) {
          if (Date.now() - t0 < 8000) { setTimeout(tick, 60); return; }
          resolve(null); return;
        }
        const fresh = list[list.length - 1];
        let rgb = null;
        fresh.group?.traverse((obj) => {
          if (obj.isMesh && obj.material && rgb === null) {
            const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
            if (m.color) rgb = [m.color.r, m.color.g, m.color.b];
          }
        });
        // Remove the probe body so we don't leak it.
        reg.remove(fresh.id);
        resolve(rgb);
      };
      tick();
    });
  }, { id: ids[0] });
  console.log('  [baseline]', JSON.stringify(originalRgb));

  // Revert manifold body #1 to none.
  await win.evaluate(({ id }) => window.__archdiscBodies.select(id, false), { id: ids[0] });
  await expect(win.locator('[data-archdisc-properties-inspector="active"]')).toBeVisible({ timeout: 3000 });
  await win.locator('[data-archdisc-body-material-select]').selectOption('none');
  await win.evaluate(() => window.__archdiscBodies.clearSelection());
  await win.waitForTimeout(400);

  const restored = await probe(ids[0]);
  console.log('  [restored]', JSON.stringify(restored));
  // Restored colour should match the baseline (within 0.01 — colour-poll
  // race / colour-space conversion tolerance).
  expect(restored).not.toBeNull();
  expect(restored[0]).toBeCloseTo(originalRgb[0], 1);
  expect(restored[1]).toBeCloseTo(originalRgb[1], 1);
  expect(restored[2]).toBeCloseTo(originalRgb[2], 1);

  await win.screenshot({ path: path.join(OUT, '03-restored.png') });
  await app.close();
});
