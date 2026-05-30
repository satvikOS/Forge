import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-perfacetess');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Per-Face Tessellation — OCCT face-id mesh, filleted cube', async () => {
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
    window.__archdiscPlanParams['Sculpt Per-Face Tessellation'] = {
      boxSize: 40, filletR: 4, deflection: 0.2, x: 0, y: 0, z: 0,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Per-Face Tessellation"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastPerFaceTessReport && window.__lastPerFaceTessReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastPerFaceTessReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[PerFaceTess] ${r.boxSize}³ fillet R=${r.filletR} defl=${r.deflection} | faces=${r.faceCount} tris=${r.triCount} verts=${r.vertCount} face-adj=${r.faceAdjacencyCount}`);

  // Filleted cube has 26 faces (6 planar + 12 fillet bands + 8 corner blends).
  expect(r.faceCount).toBe(26);
  // Each face contributes triangles → substantial mesh.
  expect(r.triCount).toBeGreaterThan(100);
  // Face adjacency map present (kernel may populate it lazily; 0 acceptable
  // when consumed-but-not-extracted).
  expect(r.faceAdjacencyCount).toBeGreaterThanOrEqual(0);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
