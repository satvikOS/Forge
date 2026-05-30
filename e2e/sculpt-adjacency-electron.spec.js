import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-adjacency');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Topology Adjacency — OCCT three-tier graph walk on cube', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscRegistry, null, { timeout: 60000 });
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });
  const wc = win.locator('[data-archdisc-welcome-close="true"]').first();
  if (await wc.count() > 0) {
    await wc.dispatchEvent('click');
    await win.locator('[data-archdisc-welcome="open"]').waitFor({ state: 'hidden', timeout: 5000 });
  }
  await win.locator('[data-ribbon-tab-key="part"]').dispatchEvent('click');
  await win.waitForTimeout(2000);

  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Sculpt Topology Adjacency'] = {
      boxSize: 40, x: 0, y: 0, z: 0, color: 0xb8b8c8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Topology Adjacency"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastAdjReport && window.__lastAdjReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastAdjReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Adjacency] ${r.boxSize}³ | F=${r.faceCount} E=${r.edgeCount} V=${r.vertexCount} | F0→${r.face1EdgeCount}E | E0→${r.edge1FaceCount}F/${r.edge1VertexCount}V/${r.edge1CoedgeCount}coE | V0→${r.vertex1FaceCount}F/${r.vertex1EdgeCount}E`);

  // Cube combinatorial contract.
  expect(r.faceCount).toBe(6);
  expect(r.edgeCount).toBe(12);
  expect(r.vertexCount).toBe(8);
  // Each face has 4 edges.
  expect(r.face1EdgeCount).toBe(4);
  // Each edge has 2 adjacent faces (manifold) and 2 vertices (start/end).
  expect(r.edge1FaceCount).toBe(2);
  expect(r.edge1VertexCount).toBe(2);
  // Each edge has 2 coedges (radial set on a manifold edge).
  expect(r.edge1CoedgeCount).toBe(2);
  // Each vertex of a cube touches 3 faces and 3 edges.
  expect(r.vertex1FaceCount).toBe(3);
  expect(r.vertex1EdgeCount).toBe(3);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
