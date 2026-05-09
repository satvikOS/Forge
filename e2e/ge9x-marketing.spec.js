import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X', 'marketing');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

test('GE9X marketing cutaway: GE-style color-coded poster render', async ({ page }) => {
  ensure(OUT);

  // Use a wide aspect ratio for marketing renders (engine is 5.7m long)
  await page.setViewportSize({ width: 1920, height: 800 });

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const setup = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const builderMod = await import('/src/engines/GE9XBuilder.js');
    const {
      PartIDRegistry, AssemblyBridge, MarketingCutaway, StudioLighting,
    } = m;
    const GE9XBuilder = builderMod.default;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    PartIDRegistry.reset();
    const ge9x = GE9XBuilder.build();
    const root = AssemblyBridge.renderAssembly(ge9x, window.__three_scene);

    // Compute scene bbox before transformations
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Lighting tuned for marketing: brighter, more even
    const existing = [];
    window.__three_scene.traverse(o => { if (o.isLight && !o.userData?.studio) existing.push(o); });
    for (const l of existing) window.__three_scene.remove(l);
    StudioLighting.apply(window.__three_scene, {
      THREE,
      targetCenter: center,
      targetSize: size.length(),
      intensity: 1.2,
      keyColor: 0xffffff,
      fillColor: 0xddddee,
      rimColor: 0xffffff,
    });
    // Set a clean dark-grey background so colors pop
    window.__three_scene.background = new THREE.Color(0x1a1a26);

    window.__three_renderer.toneMapping = THREE.ACESFilmicToneMapping;
    window.__three_renderer.toneMappingExposure = 1.0;
    window.__three_renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Apply marketing cutaway
    const result = MarketingCutaway.apply(window.__three_scene, window.__three_renderer, {
      axisDir: new THREE.Vector3(0, 0, 1),  // engine axis is +Z
      center,
      hideAccessories: true,
      colorBySection: true,
    });

    // Camera: stand on +X side looking back toward -X. The axial-half cut
    // removes +X half, so the cut surface faces +X = camera. Camera high
    // enough above to skim the top of the nacelle giving a 3/4 view.
    const camDist = size.z * 0.6;
    window.__three_camera.position.set(
      center.x + camDist,
      center.y + camDist * 0.05,
      center.z
    );
    window.__three_camera.lookAt(center.x, center.y, center.z);
    window.__three_camera.near = 0.01;
    window.__three_camera.far = camDist * 50;
    window.__three_camera.fov = 60;  // wider FOV for full engine length
    window.__three_camera.updateProjectionMatrix();
    window.__three_renderer.render(window.__three_scene, window.__three_camera);

    return {
      partCount: ge9x.partCount(),
      bbox: { center: center.toArray(), size: size.toArray() },
      legend: MarketingCutaway.sectionLegend(),
    };
  });

  console.log(`Components: ${setup.partCount.toLocaleString()}`);
  console.log(`Engine size: ${setup.bbox.size.map(s => s.toFixed(2)).join(' × ')} m`);
  console.log('\nSection legend:');
  for (const l of setup.legend) console.log(`  ${l.category.padEnd(8)} ${l.colorHex}`);

  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'marketing-side-elevation.png'), fullPage: true });
  console.log('  ✓ marketing-side-elevation.png');

  // Slight perspective angle
  const c = setup.bbox.center;
  const sz = setup.bbox.size;
  await page.evaluate(async ({ c, sz }) => {
    const cam = window.__three_camera;
    const dist = sz[2] * 1.5;
    cam.position.set(c[0] - dist * 0.85, c[1] + dist * 0.18, c[2] - dist * 0.10);
    cam.lookAt(c[0], c[1], c[2]);
    cam.fov = 38;
    cam.updateProjectionMatrix();
    window.__three_renderer.render(window.__three_scene, window.__three_camera);
  }, { c, sz });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'marketing-3-4-view.png'), fullPage: true });
  console.log('  ✓ marketing-3-4-view.png');

  // Closer zoom to compressor section
  await page.evaluate(async ({ c }) => {
    const cam = window.__three_camera;
    cam.position.set(c[0] - 3.5, c[1] + 0.8, c[2] + 1.0);
    cam.lookAt(c[0], c[1], 2.0);
    cam.fov = 30;
    cam.updateProjectionMatrix();
    window.__three_renderer.render(window.__three_scene, window.__three_camera);
  }, { c });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'marketing-compressor-detail.png'), fullPage: true });
  console.log('  ✓ marketing-compressor-detail.png');

  // Closer zoom to combustor + HPT
  await page.evaluate(async ({ c }) => {
    const cam = window.__three_camera;
    cam.position.set(c[0] - 3.0, c[1] + 0.5, c[2] + 0.8);
    cam.lookAt(c[0], c[1], 3.6);
    cam.fov = 28;
    cam.updateProjectionMatrix();
    window.__three_renderer.render(window.__three_scene, window.__three_camera);
  }, { c });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'marketing-combustor-hpt.png'), fullPage: true });
  console.log('  ✓ marketing-combustor-hpt.png');

  fs.writeFileSync(path.join(OUT, 'legend.json'), JSON.stringify(setup.legend, null, 2));

  expect(setup.partCount).toBeGreaterThan(20000);
});
