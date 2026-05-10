import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X', 'showcase');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

test('GE9X showcase: PBR materials + studio lighting + multi-angle renders', async ({ page }) => {
  ensure(OUT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  console.log('\n========================================');
  console.log('  GE9X SHOWCASE — material + lighting');
  console.log('========================================\n');

  const setup = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const builderMod = await import('/src/engines/GE9XBuilder.js');
    const { PartIDRegistry, AssemblyBridge, StudioLighting, EngineMaterials } = m;
    const GE9XBuilder = builderMod.default;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    PartIDRegistry.reset();

    // Build engine
    const t0 = performance.now();
    const ge9x = GE9XBuilder.build();
    const buildSec = (performance.now() - t0) / 1000;

    // Render with PBR materials
    const root = AssemblyBridge.renderAssembly(ge9x, window.__three_scene, {
      instanceThreshold: 5,
    });

    // Compute scene bbox
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Remove ALL existing lights (default editor lighting can wash out PBR)
    const existing = [];
    window.__three_scene.traverse(obj => {
      if (obj.isLight && !obj.userData?.studio) existing.push(obj);
    });
    for (const l of existing) window.__three_scene.remove(l);

    // Apply studio lighting
    StudioLighting.apply(window.__three_scene, {
      THREE,
      targetCenter: center,
      targetSize: Math.max(size.x, size.y, size.z),
      intensity: 1.4,
    });

    // Renderer settings for proper PBR
    if (window.__three_renderer) {
      window.__three_renderer.toneMapping = THREE.ACESFilmicToneMapping;
      window.__three_renderer.toneMappingExposure = 1.0;
      window.__three_renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    return {
      partCount: ge9x.partCount(),
      buildSec: +buildSec.toFixed(2),
      bbox: { center: center.toArray(), size: size.toArray() },
      materialCount: EngineMaterials.list().length,
    };
  });

  console.log(`Components: ${setup.partCount.toLocaleString()}`);
  console.log(`PBR materials in library: ${setup.materialCount}`);
  console.log(`Engine bbox: ${setup.bbox.size.map(s => s.toFixed(2)).join(' × ')} m`);

  // Helper: apply a camera view and render
  const applyViewAndRender = async (name, viewSpec) => {
    await page.evaluate(async (s) => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const cam = window.__three_camera;
      cam.position.set(...s.cameraPos);
      cam.lookAt(...s.lookAt);
      cam.near = s.near;
      cam.far = s.far;
      if (s.fov) cam.fov = s.fov;
      cam.updateProjectionMatrix();
      window.__three_renderer.render(window.__three_scene, cam);
    }, viewSpec);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    console.log(`  ✓ ${name}.png`);
  };

  const c = setup.bbox.center;
  const sx = setup.bbox.size[0], sy = setup.bbox.size[1], sz = setup.bbox.size[2];
  const dist = Math.max(sx, sy, sz) * 2.5;  // pull back further

  // 1. ISOMETRIC overview — material aware
  await applyViewAndRender('01-iso-overview', {
    cameraPos: [c[0] + dist * 1.0, c[1] + dist * 0.5, c[2] + dist * 0.6],
    lookAt: c, near: 0.001, far: dist * 30, fov: 50,
  });

  // 2. SIDE profile (engineering elevation)
  await applyViewAndRender('02-side-profile', {
    cameraPos: [c[0] + dist * 1.2, c[1] + dist * 0.05, c[2] + dist * 0.0],
    lookAt: c, near: 0.001, far: dist * 30, fov: 45,
  });

  // 3. FRONT (intake) — see fan
  await applyViewAndRender('03-front-intake', {
    cameraPos: [c[0] + dist * 0.05, c[1] + dist * 0.05, c[2] - dist * 1.2],
    lookAt: c, near: 0.001, far: dist * 30, fov: 45,
  });

  // 4. REAR (exhaust)
  await applyViewAndRender('04-rear-exhaust', {
    cameraPos: [c[0] + dist * 0.05, c[1] + dist * 0.05, c[2] + dist * 1.2],
    lookAt: c, near: 0.001, far: dist * 30, fov: 45,
  });

  // 5. TOP-DOWN
  await applyViewAndRender('05-top-down', {
    cameraPos: [c[0], c[1] + dist * 1.2, c[2]],
    lookAt: c, near: 0.001, far: dist * 30, fov: 45,
  });

  // 6. CUTAWAY HALF — show internals
  await page.evaluate(async (c) => {
    const m = await import('/src/kernel/index.js');
    const { CutawayRenderer } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');
    CutawayRenderer.apply(window.__three_scene, window.__three_renderer, {
      mode: 'axial-half',
      axis: new THREE.Vector3(0, 0, 1),
      center: new THREE.Vector3(c[0], c[1], c[2]),
    });
    window.__three_renderer.render(window.__three_scene, window.__three_camera);
  }, c);
  await applyViewAndRender('06-cutaway-half-side', {
    cameraPos: [c[0] + dist * 1.0, c[1] + dist * 0.15, c[2] + dist * 0.1],
    lookAt: c, near: 0.001, far: dist * 30, fov: 42,
  });

  // 7. CUTAWAY HALF — closer to compressor stages
  await applyViewAndRender('07-cutaway-compressor', {
    cameraPos: [c[0] + dist * 0.55, c[1] + dist * 0.20, c[2] - dist * 0.10],
    lookAt: [c[0], c[1], c[2] - 1.0], near: 0.001, far: dist * 30, fov: 38,
  });

  // 8. QUADRANT cutaway
  await page.evaluate(async (c) => {
    const m = await import('/src/kernel/index.js');
    const { CutawayRenderer } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');
    CutawayRenderer.restore(window.__three_scene, window.__three_renderer);
    CutawayRenderer.apply(window.__three_scene, window.__three_renderer, {
      mode: 'quadrant',
      angleDeg: 90,
      axis: new THREE.Vector3(0, 0, 1),
      center: new THREE.Vector3(c[0], c[1], c[2]),
    });
    window.__three_renderer.render(window.__three_scene, window.__three_camera);
  }, c);
  await applyViewAndRender('08-quadrant-iso', {
    cameraPos: [c[0] + dist * 0.8, c[1] + dist * 0.6, c[2] + dist * 0.5],
    lookAt: c, near: 0.001, far: dist * 30, fov: 45,
  });

  // 9. HOT MODE — engine glowing at temperature
  await page.evaluate(async (c) => {
    const m = await import('/src/kernel/index.js');
    const { CutawayRenderer, EngineMaterials, StudioLighting } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');
    CutawayRenderer.restore(window.__three_scene, window.__three_renderer);
    CutawayRenderer.apply(window.__three_scene, window.__three_renderer, {
      mode: 'axial-half',
      axis: new THREE.Vector3(0, 0, 1),
      center: new THREE.Vector3(c[0], c[1], c[2]),
    });
    StudioLighting.hot(window.__three_scene, {
      THREE, targetCenter: new THREE.Vector3(c[0], c[1], c[2]), targetSize: 6, intensity: 1.5,
    });
    EngineMaterials.setHotMode(THREE, window.__three_scene, 0.6);
    window.__three_renderer.render(window.__three_scene, window.__three_camera);
  }, c);
  await applyViewAndRender('09-hot-mode-cutaway', {
    cameraPos: [c[0] + dist * 0.9, c[1] + dist * 0.2, c[2] + dist * 0.1],
    lookAt: c, near: 0.001, far: dist * 30, fov: 42,
  });

  // Restore for final
  await page.evaluate(async (c) => {
    const m = await import('/src/kernel/index.js');
    const { CutawayRenderer, EngineMaterials, StudioLighting } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');
    CutawayRenderer.restore(window.__three_scene, window.__three_renderer);
    EngineMaterials.clearHotMode(window.__three_scene);
    StudioLighting.remove(window.__three_scene);
    StudioLighting.apply(window.__three_scene, {
      THREE, targetCenter: new THREE.Vector3(c[0], c[1], c[2]), targetSize: 6,
    });
    window.__three_renderer.render(window.__three_scene, window.__three_camera);
  }, c);

  console.log(`\nAll showcase renders saved to: ${OUT}`);

  expect(setup.partCount).toBeGreaterThan(20000);
});
