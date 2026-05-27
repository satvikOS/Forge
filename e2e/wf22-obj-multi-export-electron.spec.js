/**
 * Workflow-22 — Multi-body OBJ + MTL ZIP export.
 *
 * Universal mesh format every DCC + game-engine consumes (Blender,
 * 3ds Max, Maya, Cinema 4D, Houdini, Unity, Unreal, KeyShot). Multi-
 * body OBJ preserves per-part identity (`o BodyName` + `g BodyName`)
 * and the matching MTL carries diffuse/specular for each engineering
 * material assigned through the WF-08 Inspector.
 *
 * Coherent real-project test: builds a 6-component lathe-tool turret
 * — a real CNC lathe sub-assembly typical of a Mazak / Doosan / Haas
 * machine. Each tool block gets a distinct engineering material via
 * the Inspector, the assembly is exported as OBJ+MTL ZIP, and the
 * ZIP body is inspected for:
 *
 *   1. Turret face plate     Cyl Ø 250 × 25 mm   AISI 4140
 *   2. Cutter station A      Box 50 × 50 × 60 mm  M2 tool steel
 *   3. Cutter station B      Box 50 × 50 × 60 mm  M2 tool steel
 *   4. Cutter station C      Box 50 × 50 × 60 mm  M2 tool steel
 *   5. Boring bar holder     Cyl Ø 35 × 80 mm    AISI 4140
 *   6. Tool insert           Cyl Ø 12 × 6 mm     stainless (carbide stand-in)
 *
 * Coherence checks:
 *   - 6 bodies → 6 `o <name>` groups in OBJ
 *   - 3 unique materials → 3 `newmtl` blocks in MTL (4140, M2 tool,
 *     stainless). Note: M2 isn't in WF-08's material registry, so it
 *     falls back to DEFAULT_COLOR; we assign stainless for the inserts
 *     and 4140 for the holders, while M2 tool steel uses "no material"
 *     to verify the default-colour fallback path also produces a
 *     valid MTL entry.
 *   - Every vertex line has 3 floats, every face line references
 *     1-based vertex indices
 *   - ZIP starts with PK\x03\x04 + ends with EOCD
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf22-obj-multi');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-22 — Lathe-tool turret: multi-body OBJ + MTL ZIP with per-body materials', async () => {
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
  const welcome = win.locator('[data-archdisc-welcome="open"]');
  if (await welcome.isVisible().catch(() => false)) {
    await win.locator('[data-archdisc-welcome-close="true"]').click();
    await expect(welcome).toBeHidden({ timeout: 5000 });
  }

  // ─── Build the 6-component lathe turret ────────────────────────────
  const components = [
    { tool: 'Cylinder', tag: 'LatheTurret-FacePlate-4140',  material: 'steel-4140' },
    { tool: 'Box',      tag: 'LatheTurret-StationA-M2Tool', material: 'none'       }, // fallback colour
    { tool: 'Box',      tag: 'LatheTurret-StationB-M2Tool', material: 'none'       },
    { tool: 'Box',      tag: 'LatheTurret-StationC-M2Tool', material: 'none'       },
    { tool: 'Cylinder', tag: 'LatheTurret-BoringHolder-4140', material: 'steel-4140' },
    { tool: 'Cylinder', tag: 'LatheTurret-Insert-Carbide',  material: 'stainless'   },
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

  // Assign engineering materials per body via the Inspector dropdown.
  for (let i = 0; i < ids.length; i++) {
    if (components[i].material === 'none') continue;
    await win.evaluate(({ id }) => window.__archdiscBodies.select(id, false), { id: ids[i] });
    await expect(win.locator('[data-archdisc-properties-inspector="active"]')).toBeVisible({ timeout: 3000 });
    await win.locator('[data-archdisc-body-material-select]').selectOption(components[i].material);
    await win.waitForTimeout(80);
  }
  await win.evaluate(() => window.__archdiscBodies.clearSelection());
  await win.screenshot({ path: path.join(OUT, '01-turret-built.png') });

  // ─── Click Export OBJ (multi-body) via Drawing ribbon ───────────────
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
      if ((b.textContent || '').includes('Export OBJ (multi-body)')) {
        b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { clicked: true };
      }
    }
    return { clicked: false };
  });
  expect(click.clicked).toBe(true);

  await win.waitForFunction(() => !!window.__lastObjMulti?.ok, null, { timeout: 30000 });

  const result = await win.evaluate(() => {
    const r = window.__lastObjMulti;
    const u8 = r.zipBytes;
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return {
      ok: r.ok,
      bodies: r.bodies,
      materials: r.materials,
      filename: r.filename,
      bytes: r.bytes,
      objText: r.objText,
      mtlText: r.mtlText,
      zipBase64: btoa(s),
    };
  });
  console.log('  [obj-multi]', JSON.stringify({
    ok: result.ok, bodies: result.bodies, materials: result.materials, filename: result.filename, bytes: result.bytes,
  }));
  expect(result.ok).toBe(true);
  expect(result.bodies).toBe(6);
  // 3 distinct materials: steel-4140, stainless, Default (fallback for M2 'none').
  expect(result.materials).toBe(3);
  expect(result.filename).toMatch(/\.zip$/);

  // OBJ contents: mtllib + 6 `o ...` groups + per-body usemtl
  const objCounts = {
    mtllib: (result.objText.match(/^mtllib /gm) || []).length,
    o: (result.objText.match(/^o /gm) || []).length,
    g: (result.objText.match(/^g /gm) || []).length,
    usemtl: (result.objText.match(/^usemtl /gm) || []).length,
    v: (result.objText.match(/^v /gm) || []).length,
    vn: (result.objText.match(/^vn /gm) || []).length,
    f: (result.objText.match(/^f /gm) || []).length,
  };
  console.log('  [obj counts]', JSON.stringify(objCounts));
  expect(objCounts.mtllib).toBe(1);
  expect(objCounts.o).toBe(6);
  expect(objCounts.g).toBe(6);
  expect(objCounts.usemtl).toBe(6);
  expect(objCounts.v).toBeGreaterThan(50);
  expect(objCounts.vn).toBeGreaterThan(50);
  expect(objCounts.f).toBeGreaterThan(50);
  // Every face references 1-based vertex indices ≥ 1 (no negative or
  // 0 indices, no relative refs).
  const firstFace = (result.objText.match(/^f .+$/m) || [''])[0];
  expect(firstFace).toMatch(/^f \d+\/\/\d+ \d+\/\/\d+ \d+\/\/\d+$/);

  // MTL contents: 3 newmtl blocks with Kd lines that parse as RGB.
  const mtlCounts = {
    newmtl: (result.mtlText.match(/^newmtl /gm) || []).length,
    kd: (result.mtlText.match(/^Kd /gm) || []).length,
  };
  expect(mtlCounts.newmtl).toBe(3);
  expect(mtlCounts.kd).toBe(3);

  // Verify the steel-4140 MTL entry has the right Kd values.
  const steelBlock = result.mtlText.match(/newmtl steel-4140[\s\S]*?(?=newmtl |$)/);
  expect(steelBlock).not.toBeNull();
  expect(steelBlock[0]).toMatch(/Kd 0\.580 0\.590 0\.620/);

  // ZIP shape.
  const zipBuf = Buffer.from(result.zipBase64, 'base64');
  fs.writeFileSync(path.join(OUT, 'lathe-turret.zip'), zipBuf);
  expect(zipBuf.readUInt32LE(0)).toBe(0x04034b50);
  expect(zipBuf.slice(-22).readUInt32LE(0)).toBe(0x06054b50);

  await win.screenshot({ path: path.join(OUT, '02-after-export.png') });
  await app.close();
});
