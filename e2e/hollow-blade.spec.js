import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X', 'hollow-blade');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('Hollow turbine blade: build cooled blade with cooling channels', async ({ page }) => {
  ensure(OUT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const {
      HollowBlade, PartIDRegistry, Assembly, AssemblyBridge,
      ExportEngine, StudioLighting,
    } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    PartIDRegistry.reset();
    PartIDRegistry.setProject('GE9X');

    const t0 = performance.now();
    const result = HollowBlade.build({
      rHub: 0.18, rTip: 0.32, chord: 0.055,
      numChannels: 5, channelDia: 0.004, wallThickness: 0.0015,
    });
    const buildSec = (performance.now() - t0) / 1000;

    // Add to assembly so it renders
    const asm = new Assembly('Cooled HPT Stage 1 Blade');
    const part = asm.addPart(result.solid, 'GE9X HPT-1 Cooled Blade', {
      material: 'CMC SiC/SiC',
      category: 'HPT', subsystem: 'BLD',
      metadata: { coolingChannels: result.channelCount, ...result.info },
    });

    const root = AssemblyBridge.renderAssembly(asm, window.__three_scene);
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Lighting
    const existingLights = [];
    window.__three_scene.traverse(o => { if (o.isLight && !o.userData?.studio) existingLights.push(o); });
    for (const l of existingLights) window.__three_scene.remove(l);
    StudioLighting.apply(window.__three_scene, {
      THREE, targetCenter: center, targetSize: size.length(), intensity: 1.6,
    });
    window.__three_renderer.toneMapping = THREE.ACESFilmicToneMapping;
    window.__three_renderer.toneMappingExposure = 1.0;
    window.__three_renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Frame on blade — blade spans y=0.18..0.32 (140mm), thin in x/z
    window.__three_camera.position.set(0.30, 0.50, 0.30);
    window.__three_camera.lookAt(0, 0.25, 0);
    window.__three_camera.near = 0.0001;
    window.__three_camera.far = 10;
    window.__three_camera.fov = 35;
    window.__three_camera.updateProjectionMatrix();
    window.__three_renderer.render(window.__three_scene, window.__three_camera);

    // Try to STL-export the blade for archival
    let stlText = null;
    try {
      stlText = ExportEngine.toSTL(result.solid, 'GE9X-HPT-Cooled-Blade');
    } catch (e) {
      stlText = `STL export failed: ${e.message}`;
    }

    return {
      buildSec: +buildSec.toFixed(3),
      partID: part.partID,
      channelCount: result.channelCount,
      channels: result.channels,
      info: result.info,
      stlSizeBytes: stlText ? stlText.length : 0,
      stlPreview: stlText ? stlText.split('\n').slice(0, 3).join('\n') : null,
      bbox: { center: center.toArray(), size: size.toArray() },
    };
  });

  console.log('\n=== Hollow Cooled Turbine Blade ===');
  console.log(`Built in ${result.buildSec}s`);
  console.log(`Part ID: ${result.partID}`);
  console.log(`Cooling channels: ${result.channelCount}`);
  for (const c of result.channels) {
    console.log(`  Channel ${c.index} @ ${(c.chordPos * 100).toFixed(0)}% chord — dia ${c.diameter_mm.toFixed(2)} mm — ${c.type}`);
  }
  console.log(`Span: ${result.info.spanLength_mm.toFixed(1)} mm, chord: ${result.info.chord_mm.toFixed(1)} mm`);
  console.log(`STL: ${result.stlSizeBytes.toLocaleString()} bytes`);

  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'cooled-blade-iso.png'), fullPage: true });

  // Cutaway through blade midspan
  await page.evaluate(async (c) => {
    const m = await import('/src/kernel/index.js');
    const { CutawayRenderer } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');
    CutawayRenderer.apply(window.__three_scene, window.__three_renderer, {
      mode: 'axial-half',
      axis: new THREE.Vector3(0, 1, 0),  // cut along radial axis
      center: new THREE.Vector3(c[0], c[1], c[2]),
    });
    window.__three_renderer.render(window.__three_scene, window.__three_camera);
  }, result.bbox.center);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'cooled-blade-cutaway.png'), fullPage: true });

  // Save metadata
  fs.writeFileSync(path.join(OUT, 'metadata.json'), JSON.stringify(result, null, 2));

  expect(result.channelCount).toBe(5);
  expect(result.partID).toMatch(/^GE9X-HPT-BLD-\d{4}$/);
});
