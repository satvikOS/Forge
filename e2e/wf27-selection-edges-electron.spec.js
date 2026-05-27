/**
 * Workflow-27 — Selection-edge wireframe overlay.
 *
 * Selected bodies get a white feature-edge wireframe (Three.js
 * EdgesGeometry, 30° threshold) painted as a child LineSegments
 * mesh. The overlay reads the silhouette even when the WF-18
 * selection-blue emissive + the WF-24 material-colour paint sit on
 * the surface beneath.
 *
 * Coherent real-project test: builds a 5-component CNC spindle
 * cartridge (a real machine-tool sub-assembly: spindle shaft +
 * 2 angular-contact bearings + bearing spacer + nose seal). For
 * each selection state, asserts the edges overlay is added or
 * removed from the body's group.userData accordingly:
 *
 *   1. Spindle shaft      Cyl Ø 50 × 220 mm   AISI 4340
 *   2. Front bearing      Cyl Ø 90 × 35 mm    52100 bearing steel
 *   3. Rear bearing       Cyl Ø 90 × 35 mm    52100 bearing steel
 *   4. Bearing spacer     Cyl Ø 90 × 18 mm    AISI 1018
 *   5. Nose seal          Cyl Ø 65 × 10 mm    nitrile rubber
 *
 * Coherence checks:
 *   - After build: no body has userData.__archdiscEdgesLine
 *   - Select body #1: it gains an array of LineSegments under
 *     userData.__archdiscEdgesLine, each LineSegments.geometry
 *     reports > 0 line indices
 *   - Switch to body #3: body #1's overlay removed, body #3 gains one
 *   - Multi-select 2 + 4: both gain overlays; 1, 3, 5 have none
 *   - Clear selection: every overlay removed
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf27-selection-edges');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-27 — CNC spindle cartridge: selection-edge overlay tracks single/multi/clear selection', async () => {
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
    () => !!window.__archdiscBodies && !!window.__archdiscRunTool && window.__archdiscSelectionEdgesActive === true,
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

  // ─── Build 5-body CNC spindle cartridge ─────────────────────────────
  const tags = [
    'CNCSpindle-Shaft-4340',
    'CNCSpindle-FrontBearing-52100',
    'CNCSpindle-RearBearing-52100',
    'CNCSpindle-Spacer-1018',
    'CNCSpindle-NoseSeal-Nitrile',
  ];
  const ids = [];
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
    const id = await win.evaluate(({ tag }) => {
      const reg = window.__archdiscBodies;
      const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
      const last = list[list.length - 1];
      if (typeof reg.rename === 'function') reg.rename(last.id, tag);
      return last.id;
    }, { tag });
    ids.push(id);
  }
  await win.screenshot({ path: path.join(OUT, '01-cartridge-built.png') });

  const probeEdges = () => win.evaluate(({ ids }) => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    const out = {};
    for (const id of ids) {
      const b = list.find(x => x.id === id);
      const segs = b?.group?.userData?.__archdiscEdgesLine;
      if (Array.isArray(segs) && segs.length > 0) {
        // Sum line-segment counts across every LineSegments overlay.
        let count = 0;
        for (const s of segs) {
          // EdgesGeometry stores position as the line-vertex array;
          // 2 vertices per line segment.
          const pos = s.geometry?.attributes?.position;
          if (pos) count += pos.count / 2;
        }
        out[id] = { segments: segs.length, lineCount: count };
      } else {
        out[id] = null;
      }
    }
    return out;
  }, { ids });

  // ─── 1. No selection → no overlays ─────────────────────────────────
  const baseline = await probeEdges();
  for (const id of ids) {
    expect(baseline[id]).toBeNull();
  }

  // ─── 2. Single-select body #1 → it gains an overlay ────────────────
  await win.evaluate(({ id }) => window.__archdiscBodies.select(id, false), { id: ids[0] });
  await win.waitForTimeout(160);
  const sel1 = await probeEdges();
  console.log('  [sel #1]', JSON.stringify(sel1));
  expect(sel1[ids[0]]).not.toBeNull();
  expect(sel1[ids[0]].segments).toBeGreaterThan(0);
  expect(sel1[ids[0]].lineCount).toBeGreaterThan(0);
  for (let i = 1; i < 5; i++) expect(sel1[ids[i]]).toBeNull();
  await win.screenshot({ path: path.join(OUT, '02-sel-shaft.png') });

  // ─── 3. Switch to body #3 → #1 removed, #3 added ───────────────────
  await win.evaluate(({ id }) => window.__archdiscBodies.select(id, false), { id: ids[2] });
  await win.waitForTimeout(160);
  const sel3 = await probeEdges();
  expect(sel3[ids[0]]).toBeNull();
  expect(sel3[ids[2]]).not.toBeNull();
  expect(sel3[ids[2]].lineCount).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '03-sel-rear-bearing.png') });

  // ─── 4. Multi-select 2 + 4 → both gain overlays ───────────────────
  await win.evaluate(({ a, b }) => window.__archdiscBodies.selectMany([a, b]), {
    a: ids[1], b: ids[3],
  });
  await win.waitForTimeout(160);
  const multi = await probeEdges();
  expect(multi[ids[1]]).not.toBeNull();
  expect(multi[ids[3]]).not.toBeNull();
  expect(multi[ids[0]]).toBeNull();
  expect(multi[ids[2]]).toBeNull();
  expect(multi[ids[4]]).toBeNull();
  await win.screenshot({ path: path.join(OUT, '04-multi-sel.png') });

  // ─── 5. Clear selection → every overlay removed ───────────────────
  await win.evaluate(() => window.__archdiscBodies.clearSelection());
  await win.waitForTimeout(160);
  const cleared = await probeEdges();
  for (const id of ids) expect(cleared[id]).toBeNull();
  await win.screenshot({ path: path.join(OUT, '05-cleared.png') });

  await app.close();
});
