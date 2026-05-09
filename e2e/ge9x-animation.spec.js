import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X', 'animation');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

test('GE9X animation: rotating fan + cutaway sweep frames', async ({ page }) => {
  ensure(path.join(OUT, 'fan-spin'));
  ensure(path.join(OUT, 'cutaway-sweep'));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const setup = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const builderMod = await import('/src/engines/GE9XBuilder.js');
    const { PartIDRegistry, AssemblyBridge, StudioLighting } = m;
    const GE9XBuilder = builderMod.default;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    PartIDRegistry.reset();
    const ge9x = GE9XBuilder.build();
    const root = AssemblyBridge.renderAssembly(ge9x, window.__three_scene);

    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const existing = [];
    window.__three_scene.traverse(o => { if (o.isLight && !o.userData?.studio) existing.push(o); });
    for (const l of existing) window.__three_scene.remove(l);
    StudioLighting.apply(window.__three_scene, {
      THREE, targetCenter: center, targetSize: size.length(), intensity: 1.4,
    });
    window.__three_renderer.toneMapping = THREE.ACESFilmicToneMapping;
    window.__three_renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Find rotating subsystems we want to spin
    const rotatingGroups = [];
    root.traverse(obj => {
      if (!obj.userData?.partIDs) return;
      // Rotate fan blades, LPC/HPC/HPT/LPT rotor blades + disks
      const ids = obj.userData.partIDs.join(' ');
      if (ids.match(/-(FAN|LPC|HPC|HPT|LPT)-(BLD|DSK|DVT)/)) {
        rotatingGroups.push(obj);
      }
    });

    return {
      partCount: ge9x.partCount(),
      rotatingGroupCount: rotatingGroups.length,
      bbox: { center: center.toArray(), size: size.toArray() },
    };
  });

  console.log(`Components: ${setup.partCount.toLocaleString()}`);
  console.log(`Rotating groups: ${setup.rotatingGroupCount}`);

  const c = setup.bbox.center;
  const dist = Math.max(setup.bbox.size[0], setup.bbox.size[1], setup.bbox.size[2]) * 2.5;

  // ---- Phase 1: Fan spin animation ----
  // Camera fixed at front-intake; rotate the fan-related instanced meshes
  console.log('\n--- Fan spin animation ---');
  const FAN_FRAMES = 24;
  await page.evaluate(({ c, dist }) => {
    const cam = window.__three_camera;
    cam.position.set(c[0] + 0.05, c[1] + 0.05, c[2] - dist * 1.3);
    cam.lookAt(c[0], c[1], c[2]);
    cam.fov = 45;
    cam.near = 0.001;
    cam.far = dist * 30;
    cam.updateProjectionMatrix();
  }, { c, dist });

  for (let f = 0; f < FAN_FRAMES; f++) {
    const angle = (f / FAN_FRAMES) * 2 * Math.PI;
    await page.evaluate(async (angle) => {
      const root = window.__three_scene.children.find(o => o.userData?.isAssembly);
      if (!root) return;
      // Rotate every rotor-related mesh group around Z axis
      root.traverse(obj => {
        if (!obj.userData?.partIDs) return;
        const ids = obj.userData.partIDs.join(' ');
        if (ids.match(/-(FAN|LPC|HPC|HPT|LPT)-(BLD|DSK|DVT)/)) {
          obj.rotation.z = angle;
        }
      });
      window.__three_renderer.render(window.__three_scene, window.__three_camera);
    }, angle);
    await page.waitForTimeout(50);
    const num = String(f).padStart(3, '0');
    await page.screenshot({ path: path.join(OUT, 'fan-spin', `frame-${num}.png`), fullPage: true });
  }
  console.log(`  Saved ${FAN_FRAMES} fan-spin frames`);

  // Reset rotation
  await page.evaluate(async () => {
    const root = window.__three_scene.children.find(o => o.userData?.isAssembly);
    if (!root) return;
    root.traverse(obj => {
      if (!obj.userData?.partIDs) return;
      const ids = obj.userData.partIDs.join(' ');
      if (ids.match(/-(FAN|LPC|HPC|HPT|LPT)-(BLD|DSK|DVT)/)) {
        obj.rotation.z = 0;
      }
    });
  });

  // ---- Phase 2: Cutaway sweep animation ----
  console.log('\n--- Cutaway sweep animation ---');
  const SWEEP_FRAMES = 30;
  await page.evaluate(({ c, dist }) => {
    const cam = window.__three_camera;
    cam.position.set(c[0] + dist * 1.0, c[1] + dist * 0.15, c[2] + dist * 0.1);
    cam.lookAt(c[0], c[1], c[2]);
    cam.fov = 42;
    cam.updateProjectionMatrix();
  }, { c, dist });

  for (let f = 0; f < SWEEP_FRAMES; f++) {
    const t = f / (SWEEP_FRAMES - 1);
    const z = -1 + t * 7;  // sweep from before fan to after exhaust
    await page.evaluate(async ({ z }) => {
      const m = await import('/src/kernel/index.js');
      const { CutawayRenderer } = m;
      const THREE = await import('/node_modules/.vite/deps/three.js');
      CutawayRenderer.restore(window.__three_scene, window.__three_renderer);
      CutawayRenderer.apply(window.__three_scene, window.__three_renderer, {
        mode: 'axial-slice',
        axis: new THREE.Vector3(0, 0, 1),
        center: new THREE.Vector3(0, 0, z),
        thickness: 0.15,
      });
      window.__three_renderer.render(window.__three_scene, window.__three_camera);
    }, { z });
    await page.waitForTimeout(50);
    const num = String(f).padStart(3, '0');
    await page.screenshot({ path: path.join(OUT, 'cutaway-sweep', `frame-${num}.png`), fullPage: true });
  }
  console.log(`  Saved ${SWEEP_FRAMES} cutaway-sweep frames`);

  // Restore
  await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { CutawayRenderer } = m;
    CutawayRenderer.restore(window.__three_scene, window.__three_renderer);
  });

  fs.writeFileSync(path.join(OUT, 'metadata.json'), JSON.stringify({
    fanFrames: FAN_FRAMES,
    sweepFrames: SWEEP_FRAMES,
    rotatingGroups: setup.rotatingGroupCount,
    captureRate: '20 fps target',
  }, null, 2));

  expect(setup.rotatingGroupCount).toBeGreaterThan(0);
});
