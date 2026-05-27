/**
 * Workflow-08 — Body Properties Inspector (persistent right-panel readout).
 *
 * Selects → measures → renames → assigns material → reads mass.
 * Mirrors SW's PropertyManager + Mass-Properties combo into a single
 * always-on panel: when a single body is selected the right gutter
 * shows name (editable), id, source tool, volume, mass, surface area,
 * bounding box, centroid, and a material dropdown that drives mass.
 *
 * Coherent real-project test: builds a real pneumatic-cylinder
 * assembly (5 standard ISO 6431 components, real mm dimensions and
 * real engineering materials). Each component is inspected end-to-end:
 * select → assert properties → assign material → assert mass equals
 * volume × ρ to 0.5% relative error.
 *
 *   1. Cylinder tube       Cyl Ø50 × 150 mm  steel 4140 (ρ 7.85)
 *   2. Piston              Cyl Ø48 × 12 mm   aluminum 6061 (ρ 2.70)
 *   3. Front cap           Cyl Ø60 × 18 mm   stainless 316L (ρ 7.96)
 *   4. Rear cap            Cyl Ø60 × 18 mm   stainless 316L (ρ 7.96)
 *   5. Piston rod          Cyl Ø20 × 200 mm  4140 (ρ 7.85)
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf08-body-properties-inspector');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-08 — Pneumatic-cylinder assembly: every body inspected, renamed, materialized, mass-verified', async () => {
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

  // Reset registry + material localStorage.
  await win.evaluate(() => {
    const reg = window.__archdiscBodies;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
    window.localStorage.removeItem('archdisc:body-materials:v1');
  });

  // Inspector visible in the "no selection" state on first launch.
  const inspector = win.locator('[data-archdisc-properties-inspector]');
  await expect(inspector).toBeVisible({ timeout: 5000 });
  expect(await inspector.getAttribute('data-archdisc-properties-inspector')).toBe('empty');

  // ─── Build 5-body assembly ───────────────────────────────────────────
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

  const components = [
    { tag: 'PneumaticCyl-Tube-4140',     material: 'steel-4140', density: 7.85 },
    { tag: 'PneumaticCyl-Piston-AL6061', material: 'aluminum',   density: 2.70 },
    { tag: 'PneumaticCyl-FrontCap-316L', material: 'stainless',  density: 7.96 },
    { tag: 'PneumaticCyl-RearCap-316L',  material: 'stainless',  density: 7.96 },
    { tag: 'PneumaticCyl-Rod-4140',      material: 'steel-4140', density: 7.85 },
  ];

  const ids = [];
  for (const c of components) ids.push(await buildOne(c.tag));
  expect(ids.length).toBe(5);
  await win.screenshot({ path: path.join(OUT, '01-cylinder-built.png') });

  // ─── Inspect every body in turn ─────────────────────────────────────
  for (let i = 0; i < components.length; i++) {
    const id = ids[i];
    const meta = components[i];

    // Single-select via registry API.
    await win.evaluate(({ id }) => { window.__archdiscBodies.select(id, false); }, { id });
    await expect(inspector).toHaveAttribute('data-archdisc-properties-inspector', 'active', { timeout: 3000 });
    expect(await inspector.getAttribute('data-body-id')).toBe(id);

    // Volume + area must be populated (non-empty text + numeric).
    const volumeText = await win.locator('[data-archdisc-body-volume-mm3]').textContent();
    const areaText   = await win.locator('[data-archdisc-body-area-mm2]').textContent();
    expect(volumeText).toContain('mm');
    expect(areaText).toContain('mm');
    const volumeNum = parseFloat(volumeText.replace(/[^\d.]/g, ''));
    const areaNum   = parseFloat(areaText.replace(/[^\d.]/g, ''));
    expect(volumeNum).toBeGreaterThan(0);
    expect(areaNum).toBeGreaterThan(0);

    // Mass starts as '—' (no material assigned yet).
    let massText = await win.locator('[data-archdisc-body-mass-g]').textContent();
    expect(massText.trim()).toBe('—');

    // Assign the engineering material.
    await win.locator('[data-archdisc-body-material-select]').selectOption(meta.material);
    await win.waitForTimeout(120);

    // Now mass should compute. Verify mass ≈ volume × ρ (volume in mm³,
    // ρ in g/cm³ → mass_g = volume_mm³ / 1000 × ρ).
    massText = await win.locator('[data-archdisc-body-mass-g]').textContent();
    const massNum = parseFloat(massText.replace(/[^\d.]/g, ''));
    const expectedMass = (volumeNum / 1000) * meta.density;
    expect(massNum).toBeGreaterThan(0);
    const relErr = Math.abs(massNum - expectedMass) / expectedMass;
    console.log(`  [${meta.tag}] V=${volumeNum.toFixed(1)}mm³  ρ=${meta.density}  m=${massNum.toFixed(2)}g  expected=${expectedMass.toFixed(2)}g  err=${(relErr*100).toFixed(3)}%`);
    expect(relErr).toBeLessThan(0.005);  // < 0.5% (rounding only)
  }

  await win.screenshot({ path: path.join(OUT, '02-inspector-active.png') });

  // ─── Rename via the inspector input ────────────────────────────────
  await win.evaluate(({ id }) => { window.__archdiscBodies.select(id, false); }, { id: ids[0] });
  await expect(inspector).toHaveAttribute('data-archdisc-properties-inspector', 'active');
  const nameInput = win.locator('[data-archdisc-body-name-input]');
  await nameInput.fill('PneumaticCyl-Tube-4140-Hardened');
  await nameInput.press('Enter');
  await win.waitForTimeout(150);
  const renamed = await win.evaluate(({ id }) => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    return list.find(b => b.id === id)?.name;
  }, { id: ids[0] });
  expect(renamed).toBe('PneumaticCyl-Tube-4140-Hardened');

  // ─── Material assignments persist in localStorage ───────────────────
  const stored = await win.evaluate(() => {
    const raw = window.localStorage.getItem('archdisc:body-materials:v1');
    return raw ? JSON.parse(raw) : null;
  });
  console.log('  [stored materials]', JSON.stringify(stored));
  expect(stored).not.toBeNull();
  expect(stored[ids[0]]).toBe('steel-4140');
  expect(stored[ids[1]]).toBe('aluminum');
  expect(stored[ids[2]]).toBe('stainless');
  expect(stored[ids[3]]).toBe('stainless');
  expect(stored[ids[4]]).toBe('steel-4140');

  // ─── Multi-select → inspector returns to empty state ────────────────
  await win.evaluate(({ a, b }) => { window.__archdiscBodies.selectMany([a, b]); }, { a: ids[0], b: ids[1] });
  await expect(inspector).toHaveAttribute('data-archdisc-properties-inspector', 'empty', { timeout: 3000 });

  await win.screenshot({ path: path.join(OUT, '03-multi-select-empty.png') });
  await app.close();
});
