import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-gltf');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt GLTF Export — OCCT Khronos glTF 2.0, filleted cube', async () => {
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
    window.__archdiscPlanParams['Sculpt GLTF Export'] = {
      boxSize: 40, filletR: 4, deflection: 0.1,
      x: 0, y: 0, z: 0, color: 0xe6c990,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt GLTF Export"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastGltfReport && window.__lastGltfReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastGltfReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[GLTF] ${r.boxSize}³ fillet R=${r.filletR} defl=${r.deflection} | glTF ${r.gltfBytes} bytes schema=${r.gltfSchema} verts=${r.vertCount} tris=${r.triCount} asset v=${r.assetVersion} gen='${r.assetGenerator}' meshes=${r.meshCount} nodes=${r.nodeCount} scenes=${r.sceneCount} accessors=${r.accessorsCount} export=${r.exportMs}ms`);

  // glTF schema declares version 2.0.
  expect(r.assetVersion).toBe('2.0');
  // Generator should mention ArchDisc.
  expect((r.assetGenerator || '').toLowerCase()).toContain('archdisc');
  // Real meshes / nodes / scenes / accessors all present.
  expect(r.meshCount).toBeGreaterThanOrEqual(1);
  expect(r.nodeCount).toBeGreaterThanOrEqual(1);
  expect(r.sceneCount).toBeGreaterThanOrEqual(1);
  expect(r.accessorsCount).toBeGreaterThanOrEqual(3);  // pos + normal + indices
  // Non-trivial mesh size.
  expect(r.vertCount).toBeGreaterThan(100);
  expect(r.triCount).toBeGreaterThan(100);
  expect(r.gltfBytes).toBeGreaterThan(5000);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
