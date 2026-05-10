import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'massive-assembly');
const SS_ROOT = path.join(REPO_ROOT, 'foundation-output', 'screenshots');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(300000);

test('Massive assembly: 60 000 ISO M5 fasteners on virtual airframe (single InstancedMesh)', async ({ page }) => {
  ensure(ROOT); ensure(SS_ROOT);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const out = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { iso4762 } = await import('/src/foundation/FastenerLib.js');
    const {
      buildInstancedAssembly, buildAirframeFastenerSet,
      virtualTriangleCount, MultiResolutionPart,
    } = await import('/src/foundation/MassiveAssembly.js');
    const { StudioLighting } = await import('/src/kernel/index.js');

    const t0 = performance.now();
    // Build base fastener: M5 SHCS, 16 mm length
    const fastener = await iso4762('M5', 16);
    const baseTriCount = fastener.numTri();
    const buildSec = (performance.now() - t0) / 1000;

    // Generate airframe layout: 30 stringer rings × 200 fasteners/ring = 6 000.
    // Multiply by 10 (more rings) for the upper-bound demo.
    const t1 = performance.now();
    const instances = buildAirframeFastenerSet({
      rows: 30, fastenersPerRow: 200, rowSpacing: 100, fastenerSpacing: 25, cylinderRadius: 1500,
    });
    // 10× density: stack 10 rings of clusters. Use a stride layout to
    // create more fasteners without over-running the demo.
    const denser = [];
    for (let cluster = 0; cluster < 10; cluster++) {
      for (const ins of instances) {
        denser.push({
          position: [ins.position[0] + cluster * 25, ins.position[1], ins.position[2]],
          rotation: ins.rotation,
        });
      }
    }
    const layoutSec = (performance.now() - t1) / 1000;

    const t2 = performance.now();
    const instanced = buildInstancedAssembly({
      basePart: fastener,
      instances: denser,
      materialOpts: { color: 0xc0c8d0, roughness: 0.3, metalness: 0.85 },
    });
    const buildInstancedSec = (performance.now() - t2) / 1000;

    const scene = window.__three_scene;
    const renderer = window.__three_renderer;
    const toRemove = [];
    scene.traverse(o => { if (o !== scene && !o.isLight && !o.isCamera) toRemove.push(o); });
    for (const o of toRemove) o.parent?.remove(o);
    scene.add(instanced);

    const box = new THREE.Box3().setFromObject(instanced);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const lightsToRemove = [];
    scene.traverse(o => { if (o.isLight && !o.userData?.studio) lightsToRemove.push(o); });
    for (const l of lightsToRemove) scene.remove(l);
    StudioLighting.apply(scene, { THREE, targetCenter: center, targetSize: size.length(), intensity: 1.5 });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const t3 = performance.now();
    renderer.render(scene, window.__three_camera);
    const firstRenderSec = (performance.now() - t3) / 1000;

    return {
      baseTriCount,
      instanceCount: denser.length,
      virtualTotalTris: virtualTriangleCount(denser, baseTriCount),
      buildSec, layoutSec, buildInstancedSec, firstRenderSec,
      bbox: { center: center.toArray(), size: size.toArray() },
    };
  });

  console.log(`\n=== MASSIVE ASSEMBLY ===`);
  console.log(`Base part:           M5 SHCS — ${out.baseTriCount} triangles`);
  console.log(`Instance count:      ${out.instanceCount.toLocaleString()}`);
  console.log(`Virtual triangles:   ${out.virtualTotalTris.toLocaleString()} (= instances × base-tris)`);
  console.log(`Equivalent draw count if separate meshes: ${out.instanceCount.toLocaleString()}`);
  console.log(`Actual draw calls (InstancedMesh): 1`);
  console.log(`Stage timing:`);
  console.log(`  build base fastener:     ${out.buildSec.toFixed(3)} s`);
  console.log(`  generate instance layout: ${out.layoutSec.toFixed(3)} s`);
  console.log(`  build InstancedMesh:     ${out.buildInstancedSec.toFixed(3)} s`);
  console.log(`  first render:            ${out.firstRenderSec.toFixed(3)} s`);
  console.log(`Bounding box: ${out.bbox.size.map(v => v.toFixed(0)).join(' × ')} mm`);

  // Render multiple angles
  const c = out.bbox.center;
  const dist = Math.max(...out.bbox.size) * 1.2;
  const renderView = async (name, cameraPos, fov, label) => {
    await page.evaluate(async (s) => {
      const cam = window.__three_camera;
      cam.position.set(...s.cameraPos);
      cam.lookAt(...s.lookAt);
      cam.fov = s.fov; cam.near = 0.1; cam.far = s.far;
      cam.updateProjectionMatrix();
      window.__three_renderer.render(window.__three_scene, cam);
    }, { cameraPos, lookAt: c, fov, far: dist * 30 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SS_ROOT, `${name}.png`), fullPage: false });
    console.log(`  ✓ ${name}.png — ${label}`);
  };
  await renderView('massive-airframe-overview', [c[0] + dist * 0.7, c[1] + dist * 0.4, c[2] + dist * 0.6], 35, 'overview');
  await renderView('massive-airframe-side',     [c[0] + dist * 1.0, c[1] + dist * 0.05, c[2]], 30, 'side');
  await renderView('massive-airframe-closeup',  [c[0] + dist * 0.15, c[1] + dist * 0.05, c[2] + dist * 0.15], 30, 'closeup');

  fs.writeFileSync(path.join(ROOT, 'massive-assembly.json'), JSON.stringify(out, null, 2));

  // 60 000 instances × 468 tris/M5 = 28 M virtual triangles
  expect(out.instanceCount).toBeGreaterThanOrEqual(50000);
  expect(out.virtualTotalTris).toBeGreaterThan(20_000_000);
});
