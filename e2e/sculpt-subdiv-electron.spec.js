import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-subdiv');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Loop Subdivision — OCCT piecewise-smooth SubD, cube', async () => {
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
    window.__archdiscPlanParams['Sculpt Loop Subdivision'] = {
      boxSize: 40, levels: 2, dihedralDeg: 30, deflection: 1.0,
      x: 0, y: 0, z: 0, color: 0xd2a8e6,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Loop Subdivision"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastSubdivReport && window.__lastSubdivReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastSubdivReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Subdiv] ${r.boxSize}³ levels=${r.levels} dihedral=${r.dihedralDeg}° defl=${r.deflection} | base ${r.baseTris} tris (${r.baseVerts} verts → welded ${r.weldedVerts}) → refined ${r.refinedTris} tris (${r.refinedVerts} verts), ${r.creaseEdges} crease edges`);

  // Base tessellation has at least 12 triangles (2 per cube face).
  expect(r.baseTris).toBeGreaterThanOrEqual(12);
  // Welding compresses 24 face-local copies into 8 shared cube corners
  // (or more if the tessellation produced more, but always < baseVerts).
  expect(r.weldedVerts).toBeLessThan(r.baseVerts);
  expect(r.weldedVerts).toBeGreaterThanOrEqual(8);
  // Loop subdivision at level 2 grows tri count by ~4× per level → 16×
  // total. Base 12 tris → at least 12·16 = 192 refined tris.
  expect(r.refinedTris).toBeGreaterThan(r.baseTris * 4);
  expect(r.refinedVerts).toBeGreaterThan(r.weldedVerts);
  // Cube edges (90° >> 30° threshold) should all be detected as creases.
  expect(r.creaseEdges).toBeGreaterThanOrEqual(12);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
