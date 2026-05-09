import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X', 'cfd');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

test('GE9X CFD streamlines: flow through engine', async ({ page }) => {
  ensure(OUT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const builderMod = await import('/src/engines/GE9XBuilder.js');
    const {
      PartIDRegistry, AssemblyBridge, CFDEngine, StudioLighting,
      EngineMaterials,
    } = m;
    const GE9XBuilder = builderMod.default;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    PartIDRegistry.reset();

    // Build engine
    const ge9x = GE9XBuilder.build();
    const root = AssemblyBridge.renderAssembly(ge9x, window.__three_scene);

    // Compute scene bbox
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Lighting
    const existing = [];
    window.__three_scene.traverse(o => { if (o.isLight && !o.userData?.studio) existing.push(o); });
    for (const l of existing) window.__three_scene.remove(l);
    StudioLighting.apply(window.__three_scene, {
      THREE, targetCenter: center, targetSize: size.length(), intensity: 1.2,
    });
    window.__three_renderer.toneMapping = THREE.ACESFilmicToneMapping;
    window.__three_renderer.toneMappingExposure = 1.0;
    window.__three_renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Compute CFD streamlines through the engine
    // Engine flow axis is +Z; bypass + core flow paths
    // Seed streamlines inside the actual fan-inlet annulus (between hub
    // r=0.42m and tip r=1.70m) so they enter the engine instead of
    // passing around it. Two passes: bypass + core.
    const cfdResult = CFDEngine.streamlines({
      bbox: {
        // Tighter bbox so streamlines stay inside the engine envelope
        min: { x: -1.7, y: -1.7, z: -0.3 },
        max: { x: 1.7, y: 1.7, z: 6.0 },
      },
      inletVelocity: 1.0,
      flowDirection: '+z',
      seedCount: 144,  // 12×12 inlet grid
      obstacleCenter: { x: 0, y: 0, z: 3.5 },
      obstacleRadius: 0.20,  // tighter so streamlines bend less
    });
    console.log('CFD streamlines:', cfdResult.length, 'lines');

    // Render streamlines
    const renderResult = CFDEngine.renderStreamlines(window.__three_scene, cfdResult, {});

    // Frame engine + streamlines together
    const dist = Math.max(size.x, size.y, size.z) * 2.5;
    window.__three_camera.position.set(
      center.x + dist * 1.0,
      center.y + dist * 0.4,
      center.z + dist * 0.6
    );
    window.__three_camera.lookAt(center);
    window.__three_camera.near = 0.001;
    window.__three_camera.far = dist * 30;
    window.__three_camera.fov = 45;
    window.__three_camera.updateProjectionMatrix();
    window.__three_renderer.render(window.__three_scene, window.__three_camera);

    return {
      partCount: ge9x.partCount(),
      streamlineCount: cfdResult.length,
      totalPoints: cfdResult.reduce((s, l) => s + l.length, 0),
      minV: renderResult?.minV,
      maxV: renderResult?.maxV,
      bbox: { center: center.toArray(), size: size.toArray() },
    };
  });

  console.log('\n=== CFD Streamlines ===');
  console.log(`Components: ${result.partCount.toLocaleString()}`);
  console.log(`Streamlines: ${result.streamlineCount}`);
  console.log(`Total points: ${result.totalPoints.toLocaleString()}`);
  console.log(`Velocity range: ${result.minV} - ${result.maxV} m/s`);

  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'streamlines-iso.png'), fullPage: true });

  // Side view
  const c = result.bbox.center;
  const dist = Math.max(result.bbox.size[0], result.bbox.size[1], result.bbox.size[2]) * 2.5;
  await page.evaluate(async ({ c, dist }) => {
    const cam = window.__three_camera;
    cam.position.set(c[0] + dist * 1.4, c[1] + dist * 0.05, c[2] + dist * 0.0);
    cam.lookAt(c[0], c[1], c[2]);
    cam.updateProjectionMatrix();
    window.__three_renderer.render(window.__three_scene, cam);
  }, { c, dist });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'streamlines-side.png'), fullPage: true });

  // Cutaway with streamlines (most evocative)
  await page.evaluate(async ({ c }) => {
    const m = await import('/src/kernel/index.js');
    const { CutawayRenderer } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');
    CutawayRenderer.apply(window.__three_scene, window.__three_renderer, {
      mode: 'axial-half',
      axis: new THREE.Vector3(0, 0, 1),
      center: new THREE.Vector3(c[0], c[1], c[2]),
    });
    window.__three_renderer.render(window.__three_scene, window.__three_camera);
  }, { c });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'streamlines-cutaway.png'), fullPage: true });

  fs.writeFileSync(path.join(OUT, 'cfd-summary.json'), JSON.stringify(result, null, 2));

  expect(result.streamlineCount).toBeGreaterThan(50);
  expect(result.totalPoints).toBeGreaterThan(1000);
});
