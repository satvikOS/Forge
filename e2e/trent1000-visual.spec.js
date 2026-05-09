import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = path.join(process.cwd(), 'engine-output', 'Trent1000');
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

test('Trent 1000: render full engine and export STL', async ({ page }) => {
  ensureDir(path.join(OUTPUT_DIR, 'screenshots'));
  ensureDir(path.join(OUTPUT_DIR, 'meshes'));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  // Build the engine + render in scene + export STL of fan blade
  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const {
      Assembly, PrimitiveBuilder, Vec3, FastenerLibrary, BearingLibrary,
      AssemblyBridge, ExportEngine,
    } = m;

    const trent = new Assembly('Rolls-Royce Trent 1000');

    // Fan section
    const fanDisk = PrimitiveBuilder.cylinder(0.40, 0.080, 32);
    trent.addPart(fanDisk, 'Fan Disk', { color: 0xc8c8c8, position: new Vec3(0, 0, 0) });

    const spinner = PrimitiveBuilder.cone(0.30, 0.45, 32);
    trent.addPart(spinner, 'Fan Spinner', { color: 0xe8e8e8, position: new Vec3(0, 0, -0.225) });

    const fanBladeGeo = PrimitiveBuilder.box(0.18, 1.40, 0.025);
    fanBladeGeo.name = 'Fan Blade Ti-6Al-4V';
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      trent.addPart(fanBladeGeo, `Fan Blade ${i + 1}`, {
        color: 0xb8b8b8,
        position: new Vec3(Math.cos(angle) * 1.1, 0, Math.sin(angle) * 1.1),
        rotation: new Vec3(0, angle, Math.PI / 24),
      });
    }

    // Compressor stages — 2 representative stages with rings of blades
    let zPos = 0.45;
    for (let stage = 0; stage < 4; stage++) {
      const r = 0.36 - stage * 0.02;
      const disk = PrimitiveBuilder.cylinder(r, 0.030, 32);
      trent.addPart(disk, `Comp S${stage + 1} Disk`, { color: 0xa8a8a8, position: new Vec3(0, 0, zPos) });

      const bladeGeo = PrimitiveBuilder.box(0.020, r * 0.35, 0.014);
      const count = 50 + stage * 8;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        trent.addPart(bladeGeo, `Comp S${stage + 1} R${i + 1}`, {
          color: 0x9a9a9a,
          position: new Vec3(Math.cos(a) * r * 1.1, 0, zPos),
          rotation: new Vec3(0, a, Math.PI / 12),
        });
      }
      zPos += 0.08;
    }

    // Combustor
    const combOuter = PrimitiveBuilder.cylinder(0.350, 0.45, 32);
    trent.addPart(combOuter, 'Combustor Outer', { color: 0xa0a0a0, position: new Vec3(0, 0, 1.0) });

    // Turbine stages
    for (let stage = 0; stage < 4; stage++) {
      const r = 0.42 + stage * 0.04;
      const disk = PrimitiveBuilder.cylinder(r, 0.040, 32);
      trent.addPart(disk, `Turb S${stage + 1} Disk`, { color: 0xc88844, position: new Vec3(0, 0, 1.4 + stage * 0.12) });

      const bladeGeo = PrimitiveBuilder.box(0.025, r * 0.25, 0.020);
      const count = 80 + stage * 12;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        trent.addPart(bladeGeo, `Turb S${stage + 1} R${i + 1}`, {
          color: 0xee9966,
          position: new Vec3(Math.cos(a) * r * 1.08, 0, 1.4 + stage * 0.12),
          rotation: new Vec3(0, a, Math.PI / 12),
        });
      }
    }

    // Render to scene with instancing
    const root = AssemblyBridge.renderAssembly(trent, window.__three_scene);

    // Frame camera on the entire engine — directly compute fitting position
    if (window.__three_camera) {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const box = new THREE.Box3().setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length() || 5;
      const dist = size * 1.2;
      window.__three_camera.position.set(center.x + dist * 0.7, center.y + dist * 0.4, center.z + dist * 0.7);
      window.__three_camera.lookAt(center);
      window.__three_camera.far = Math.max(window.__three_camera.far, size * 5);
      window.__three_camera.updateProjectionMatrix();
    }

    // Export fan blade as STL (ASCII)
    const stlContent = ExportEngine.toSTL(fanBladeGeo, 'TrentFanBlade');

    return {
      partCount: trent.partCount(),
      stlBytes: stlContent.length,
      stlPreview: stlContent.substring(0, 500),
      stlContent,
    };
  });

  console.log('\n--- VISUAL RENDERING ---');
  console.log(`  Components rendered: ${result.partCount.toLocaleString()}`);
  console.log(`  Fan Blade STL size: ${result.stlBytes.toLocaleString()} bytes`);

  // Save STL
  fs.writeFileSync(path.join(OUTPUT_DIR, 'meshes', 'Fan-Blade.stl'), result.stlContent);
  console.log(`  STL saved: ${OUTPUT_DIR}\\meshes\\Fan-Blade.stl`);

  // Take screenshot of full engine
  await page.waitForTimeout(2000); // wait for render
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'screenshots', 'engine-full.png'), fullPage: true });

  // Cycle display modes and screenshot each
  await page.keyboard.press('z'); // wireframe
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'screenshots', 'engine-wireframe.png'), fullPage: true });

  await page.keyboard.press('z'); // shaded+wire
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'screenshots', 'engine-shaded-wire.png'), fullPage: true });

  await page.keyboard.press('z'); // xray
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'screenshots', 'engine-xray.png'), fullPage: true });

  console.log(`  Screenshots: ${OUTPUT_DIR}\\screenshots\\`);

  expect(result.partCount).toBeGreaterThan(400);
  expect(result.stlBytes).toBeGreaterThan(100);
});
