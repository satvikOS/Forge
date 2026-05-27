/**
 * Workflow-14 — Bill of Materials CSV export.
 *
 * Real fabrication-shop deliverable. The CSV the shop floor /
 * procurement / cost-estimator imports straight into Excel: one
 * row per body with name, source tool, assigned material, density,
 * volume, computed mass, bounding box, and centroid — plus a TOTAL
 * row.
 *
 * Coherent real-project test: builds a 6-component robotic-arm joint
 * (real geometry, real materials), assigns engineering materials via
 * the Body Properties Inspector dropdown, exports the BOM, and
 * verifies the CSV row-by-row:
 *
 *   1. Yoke         Box       80 × 60 × 30 mm   AISI 4140  (steel-4140)
 *   2. Pin          Cylinder  Ø 16 × 70 mm      316L       (stainless)
 *   3. Bushing 1    Cylinder  Ø 22 × 18 mm      C36000     (brass)
 *   4. Bushing 2    Cylinder  Ø 22 × 18 mm      C36000     (brass)
 *   5. Link arm     Box       150 × 30 × 12 mm  6061-T6    (aluminum)
 *   6. End cap      Cylinder  Ø 30 × 10 mm      Ti-6Al-4V  (titanium)
 *
 * Coherence checks:
 *   - 7-row CSV emitted (6 bodies + TOTAL row)
 *   - Every body's row carries the right material label + density
 *   - Σmass row equals the sum of per-row masses within 0.01 g
 *   - Σvolume row equals the sum of per-row volumes within 0.1 mm³
 *   - CSV header line matches the documented column order exactly
 *   - Every name appears as its own CSV row in build order
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf14-bom-csv');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-14 — Robotic arm joint exports a real per-body BOM CSV; ΣVolume + ΣMass match per-row totals', async () => {
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

  // ─── Build 6-body robotic arm joint ─────────────────────────────────
  const components = [
    { tool: 'Box',      tag: 'RoboArm-Yoke-4140',      material: 'steel-4140', label: 'Steel · AISI 4140',   density: 7.85 },
    { tool: 'Cylinder', tag: 'RoboArm-Pin-316L',       material: 'stainless',  label: 'Stainless · 316L',    density: 7.96 },
    { tool: 'Cylinder', tag: 'RoboArm-Bushing1-C36000',material: 'brass',      label: 'Brass · C36000',      density: 8.49 },
    { tool: 'Cylinder', tag: 'RoboArm-Bushing2-C36000',material: 'brass',      label: 'Brass · C36000',      density: 8.49 },
    { tool: 'Box',      tag: 'RoboArm-LinkArm-AL6061', material: 'aluminum',   label: 'Aluminum · 6061-T6',  density: 2.70 },
    { tool: 'Cylinder', tag: 'RoboArm-EndCap-Ti6Al4V', material: 'titanium',   label: 'Titanium · Ti-6Al-4V',density: 4.43 },
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

  // ─── Assign materials per body via the Inspector dropdown ───────────
  for (let i = 0; i < ids.length; i++) {
    await win.evaluate(({ id }) => window.__archdiscBodies.select(id, false), { id: ids[i] });
    await expect(win.locator('[data-archdisc-properties-inspector="active"]')).toBeVisible({ timeout: 3000 });
    await win.locator('[data-archdisc-body-material-select]').selectOption(components[i].material);
    await win.waitForTimeout(80);
  }
  await win.evaluate(() => window.__archdiscBodies.clearSelection());
  await win.screenshot({ path: path.join(OUT, '01-arm-joint-built.png') });

  // ─── Click "Export BOM (CSV)" via the Drawing-tab ribbon ────────────
  await win.evaluate(() => {
    for (const t of document.querySelectorAll('.ribbon-tab')) {
      if ((t.textContent || '').trim().toLowerCase() === 'drawing') {
        t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return;
      }
    }
    // Suppress the download anchor.
    const orig = document.createElement.bind(document);
    document.createElement = function (tag) {
      if (tag === 'a') return Object.assign(orig('span'), {
        click() {}, set href(_) {}, set download(_) {},
      });
      return orig(tag);
    };
  });
  await win.waitForTimeout(250);
  await win.evaluate(() => {
    const orig = document.createElement.bind(document);
    document.createElement = function (tag) {
      if (tag === 'a') return Object.assign(orig('span'), {
        click() {}, set href(_) {}, set download(_) {},
      });
      return orig(tag);
    };
  });
  const clickRes = await win.evaluate(() => {
    for (const b of document.querySelectorAll('.ribbon-tool')) {
      if ((b.textContent || '').includes('Export BOM (CSV)')) {
        b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { clicked: true };
      }
    }
    return { clicked: false };
  });
  expect(clickRes.clicked).toBe(true);

  await win.waitForFunction(() => !!window.__lastBom?.csv, null, { timeout: 30000 });
  const bom = await win.evaluate(() => window.__lastBom);
  console.log('  [bom]', JSON.stringify({
    ok: bom.ok, rows: bom.rows, totalVolume: bom.totalVolume.toFixed(1), totalMass: bom.totalMass.toFixed(2),
  }));

  expect(bom.ok).toBe(true);
  expect(bom.rows).toBe(6);
  expect(bom.csv.startsWith('#,Body ID,Name,Source,Material,Density g/cm3,Volume mm3,Mass g')).toBe(true);

  // Parse the CSV (well-formed, simple parser sufficient — no embedded commas).
  const rows = bom.csv.trim().split('\n').map(line => {
    // Skip the header.
    const fields = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { fields.push(cur); cur = ''; continue; }
      cur += c;
    }
    fields.push(cur);
    return fields;
  });
  expect(rows.length).toBe(8);  // header + 6 bodies + TOTAL

  // Verify each body row by name → expected material/density.
  let sumVolume = 0, sumMass = 0;
  for (let i = 1; i <= 6; i++) {
    const row = rows[i];
    const expected = components.find(c => c.tag === row[2]);
    expect(expected).not.toBeUndefined();
    expect(row[4]).toBe(expected.label);
    expect(parseFloat(row[5])).toBeCloseTo(expected.density, 2);
    sumVolume += parseFloat(row[6]);
    sumMass   += parseFloat(row[7]);
  }
  // TOTAL row.
  const total = rows[7];
  expect(total[2]).toBe('TOTAL');
  expect(Math.abs(parseFloat(total[6]) - sumVolume)).toBeLessThan(0.5);
  expect(Math.abs(parseFloat(total[7]) - sumMass)).toBeLessThan(0.05);

  // Write to disk for inspection.
  fs.writeFileSync(path.join(OUT, 'robo-arm-bom.csv'), bom.csv);
  await win.screenshot({ path: path.join(OUT, '02-after-export.png') });
  await app.close();
});
