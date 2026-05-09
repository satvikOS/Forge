import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUTPUT = path.join(process.cwd(), 'engine-output', 'Trent1000');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

test('Trent 1000: render full engine in viewport with instancing', async ({ page }) => {
  ensure(path.join(OUTPUT, 'screenshots'));
  ensure(path.join(OUTPUT, 'meshes'));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  console.log('\n========================================');
  console.log('  TRENT 1000 — VIEWPORT RENDERING');
  console.log('========================================\n');

  const result = await page.evaluate(async () => {
    const builderMod = await import('/src/engines/Trent1000Builder.js');
    const m = await import('/src/kernel/index.js');
    const Trent1000Builder = builderMod.default;
    const { AssemblyBridge, ExportEngine, LODManager } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    // Build engine
    const t0 = performance.now();
    const trent = Trent1000Builder.build();
    const buildTime = performance.now() - t0;

    // Render to scene
    const t1 = performance.now();
    const root = AssemblyBridge.renderAssembly(trent, window.__three_scene, {
      instanceThreshold: 5,
    });
    const renderTime = performance.now() - t1;

    // Count InstancedMesh batches
    let instancedMeshes = 0, regularMeshes = 0, totalInstances = 0;
    root.traverse(obj => {
      if (obj.isInstancedMesh) {
        instancedMeshes++;
        totalInstances += obj.count;
      } else if (obj.isMesh) regularMeshes++;
    });

    // Frame camera — Trent 1000 is ~5m long × 3m diameter
    // Need side view showing full engine length
    if (window.__three_camera) {
      const box = new THREE.Box3().setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      // Engine axis is Z, so camera goes off to the side (X)
      const dist = Math.max(size.x, size.y, size.z) * 1.5;

      window.__three_camera.position.set(
        center.x + dist * 1.2,        // side view from +X
        center.y + dist * 0.35,        // slightly above
        center.z + dist * 0.3          // slightly off-center
      );
      window.__three_camera.lookAt(center);
      window.__three_camera.near = 0.001;
      window.__three_camera.far = dist * 20;
      window.__three_camera.updateProjectionMatrix();
    }

    // Render frame
    if (window.__three_renderer && window.__three_camera) {
      window.__three_renderer.render(window.__three_scene, window.__three_camera);
    }

    return {
      partCount: trent.partCount(),
      buildTimeSec: (buildTime / 1000).toFixed(3),
      renderTimeSec: (renderTime / 1000).toFixed(3),
      instancedMeshes,
      regularMeshes,
      totalInstances,
      drawCalls: instancedMeshes + regularMeshes,
    };
  });

  console.log(`Components: ${result.partCount.toLocaleString()}`);
  console.log(`Build: ${result.buildTimeSec}s`);
  console.log(`Render setup: ${result.renderTimeSec}s`);
  console.log(`Draw calls: ${result.drawCalls.toLocaleString()}`);
  console.log(`  InstancedMesh batches: ${result.instancedMeshes.toLocaleString()}`);
  console.log(`  Total instances: ${result.totalInstances.toLocaleString()}`);
  console.log(`  Regular meshes: ${result.regularMeshes.toLocaleString()}`);

  // Wait a moment for render to finalize
  await page.waitForTimeout(2000);

  // Take screenshots in different views
  await page.screenshot({ path: path.join(OUTPUT, 'screenshots', 'engine-overview.png'), fullPage: true });

  // Try cycling display modes
  await page.keyboard.press('z');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUTPUT, 'screenshots', 'engine-wireframe.png'), fullPage: true });
  await page.keyboard.press('z');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUTPUT, 'screenshots', 'engine-shaded-wire.png'), fullPage: true });
  await page.keyboard.press('z');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUTPUT, 'screenshots', 'engine-xray.png'), fullPage: true });

  console.log(`\nScreenshots saved to ${OUTPUT}/screenshots/`);

  expect(result.partCount).toBeGreaterThan(25000);
  expect(result.drawCalls).toBeLessThan(result.partCount); // instancing reduces draw calls
});
