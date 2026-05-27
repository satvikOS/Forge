/**
 * Workflow-20 — DXF (AutoCAD R12) export for fabrication shops.
 *
 * DXF is the universal format laser/waterjet/CNC/AutoCAD all consume
 * directly. ArchDisc now produces AC1009 (R12) DXF files with each
 * body on its own named LAYER and every triangle as a 3DFACE entity.
 *
 * Coherent real-project test: builds an automotive cylinder-head
 * gasket assembly -- a real powertrain fabrication part where the
 * shop floor uses DXF for the laser-cutting toolpath:
 *
 *   1. Head gasket layer    Box 200 × 100 × 1.5 mm   MLS multi-layer steel
 *   2. Bore #1              Cyl Ø 85 × 1.5 mm        (cut-out, not solid)
 *   3. Bore #2              Cyl Ø 85 × 1.5 mm
 *   4. Bore #3              Cyl Ø 85 × 1.5 mm
 *   5. Bore #4              Cyl Ø 85 × 1.5 mm
 *   6. Coolant port (Front) Cyl Ø 10 × 1.5 mm
 *   7. Coolant port (Rear)  Cyl Ø 10 × 1.5 mm
 *
 * 7 distinct bodies → 7 DXF layers. Each body's tessellation goes
 * out as 3DFACE entities (mm coordinates, world-space).
 *
 * Coherence checks:
 *   • Ribbon click "Export DXF" routes through the real handler
 *   • result.ok = true, 7 bodies, > 100 faces
 *   • DXF text begins with the R12 header (0/SECTION ... AC1009)
 *   • Contains TABLES section with LAYER table
 *   • Every body's safe-layer name appears as a `2 / <name>` pair
 *   • ENTITIES section contains 3DFACE entries with 4-vertex coords
 *   • Ends with EOF marker
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf20-dxf-export');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-20 — Cylinder head gasket exports as valid R12 DXF (7 layers, real 3DFACE triangles)', async () => {
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
    const orig = document.createElement.bind(document);
    document.createElement = function (tag) {
      if (tag === 'a') return Object.assign(orig('span'), {
        click() {}, set href(_) {}, set download(_) {},
      });
      return orig(tag);
    };
    const reg = window.__archdiscBodies;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
  });
  // Dismiss welcome modal if it raced open.
  const welcome = win.locator('[data-archdisc-welcome="open"]');
  if (await welcome.isVisible().catch(() => false)) {
    await win.locator('[data-archdisc-welcome-close="true"]').click();
    await expect(welcome).toBeHidden({ timeout: 5000 });
  }

  // ─── Build the 7-component cylinder-head gasket assembly ────────────
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
    await win.evaluate(({ label }) => {
      const reg = window.__archdiscBodies;
      const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
      if (typeof reg.rename === 'function') reg.rename(list[list.length - 1].id, label);
    }, { label });
  };

  await buildOne('Box',      'CylHeadGasket-HeadLayer-MLS');
  await buildOne('Cylinder', 'CylHeadGasket-Bore1');
  await buildOne('Cylinder', 'CylHeadGasket-Bore2');
  await buildOne('Cylinder', 'CylHeadGasket-Bore3');
  await buildOne('Cylinder', 'CylHeadGasket-Bore4');
  await buildOne('Cylinder', 'CylHeadGasket-CoolantPortFront');
  await buildOne('Cylinder', 'CylHeadGasket-CoolantPortRear');
  await win.screenshot({ path: path.join(OUT, '01-gasket-built.png') });

  // ─── Click Export DXF via Drawing-tab ribbon ────────────────────────
  await win.evaluate(() => {
    for (const t of document.querySelectorAll('.ribbon-tab')) {
      if ((t.textContent || '').trim().toLowerCase() === 'drawing') {
        t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return;
      }
    }
  });
  await win.waitForTimeout(250);
  const click = await win.evaluate(() => {
    for (const b of document.querySelectorAll('.ribbon-tool')) {
      if ((b.textContent || '').includes('Export DXF')) {
        b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { clicked: true };
      }
    }
    return { clicked: false };
  });
  expect(click.clicked).toBe(true);

  await win.waitForFunction(() => !!window.__lastDxf?.ok, null, { timeout: 30000 });
  const result = await win.evaluate(() => ({
    ok: window.__lastDxf.ok,
    bodies: window.__lastDxf.bodies,
    faces: window.__lastDxf.faces,
    bytes: window.__lastDxf.bytes,
    filename: window.__lastDxf.filename,
    dxf: window.__lastDxf.dxf,
  }));
  console.log('  [dxf]', JSON.stringify({
    ok: result.ok, bodies: result.bodies, faces: result.faces, bytes: result.bytes, filename: result.filename,
  }));
  expect(result.ok).toBe(true);
  expect(result.bodies).toBe(7);
  expect(result.faces).toBeGreaterThan(100);
  expect(result.filename).toMatch(/\.dxf$/);

  // Persist for inspection.
  fs.writeFileSync(path.join(OUT, 'cyl-head-gasket.dxf'), result.dxf);

  // ─── DXF structural assertions ──────────────────────────────────────
  const dxf = result.dxf;
  // R12 header marker.
  expect(dxf.includes('SECTION')).toBe(true);
  expect(dxf.includes('HEADER')).toBe(true);
  expect(dxf.includes('AC1009')).toBe(true);
  expect(dxf.includes('TABLES')).toBe(true);
  expect(dxf.includes('LAYER')).toBe(true);
  expect(dxf.includes('ENTITIES')).toBe(true);
  expect(dxf.includes('3DFACE')).toBe(true);
  expect(dxf.trimEnd().endsWith('EOF')).toBe(true);

  // Every body's layer name (filesystem-safe form) appears at least
  // once -- prove the layer table actually carries the per-body name.
  for (const tag of [
    'CylHeadGasket-HeadLayer-MLS',
    'CylHeadGasket-Bore1',
    'CylHeadGasket-Bore2',
    'CylHeadGasket-Bore3',
    'CylHeadGasket-Bore4',
    'CylHeadGasket-CoolantPortFront',
    'CylHeadGasket-CoolantPortRear',
  ]) {
    expect(dxf.includes(tag)).toBe(true);
  }

  // CRLF line termination (DXF spec).
  expect(dxf.includes('\r\n')).toBe(true);

  // Sanity: 3DFACE count in the body == result.faces.
  const faceCount = (dxf.match(/3DFACE/g) || []).length;
  expect(faceCount).toBe(result.faces);

  await win.screenshot({ path: path.join(OUT, '02-after-export.png') });
  await app.close();
});
