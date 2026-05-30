import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-retopo');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Retopo — OCCT Botsch-Kobbelt remesh, filleted cube', async () => {
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
    window.__archdiscPlanParams['Sculpt Retopo'] = {
      boxSize: 40, filletR: 6, targetEdge: 4, iterations: 5, deflection: 0.5,
      x: 0, y: 0, z: 0, color: 0xc8e6a8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Retopo"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastRetopoReport && window.__lastRetopoReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastRetopoReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Retopo] ${r.boxSize}³ fillet R=${r.filletR} target=${r.targetEdge} iters=${r.iterations} | base ${r.baseTris} tris (${r.baseVerts} verts → welded ${r.weldedVerts}) → retopo ${r.retopoTris} tris (${r.retopoVerts} verts), ${r.projections} surface projections, max Δ=${r.maxProjectionDelta.toFixed(4)} mm`);

  // Base + retopo have non-trivial mesh sizes.
  expect(r.baseTris).toBeGreaterThan(100);
  expect(r.retopoTris).toBeGreaterThan(100);
  // Surface pull-back happened — at least N projections (split + relax).
  expect(r.projections).toBeGreaterThan(0);
  // Pull-back projection delta should be small (verts stay near surface).
  expect(r.maxProjectionDelta).toBeLessThan(2);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
