import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(process.cwd(), 'engine-output', 'Toyota-V6-2028-Hybrid');
const SS = path.join(ROOT, 'screenshots');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(600000);

test('Toyota V6 — Phase 4: + crankshaft, validated journal mates', async ({ page }) => {
  ensure(SS);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  console.log('\n=== TOYOTA V35A V6 — BLOCK + HEADS + BEDPLATE + CRANK ===\n');

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const blockMod = await import('/src/projects/v6-block/EngineBlockBuilder.js');
    const headMod = await import('/src/projects/v6-block/CylinderHeadBuilder.js');
    const bedMod = await import('/src/projects/v6-block/BedplateBuilder.js');
    const crankMod = await import('/src/projects/v6-block/CrankshaftBuilder.js');
    const { Assembly, AssemblyBridge, PartIDRegistry, StudioLighting } = m;
    const EngineBlockBuilder = blockMod.default;
    const CylinderHeadBuilder = headMod.default;
    const BedplateBuilder = bedMod.default;
    const CrankshaftBuilder = crankMod.default;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    PartIDRegistry.reset();
    PartIDRegistry.setProject('TYV6');

    const block = EngineBlockBuilder.build();
    const headA = CylinderHeadBuilder.build({ bank: 'A' });
    const headB = CylinderHeadBuilder.build({ bank: 'B' });
    const bedplate = BedplateBuilder.build();
    const crank = CrankshaftBuilder.build();

    const eng = new Assembly('Toyota V35A V6 — Phase 4');
    const addAll = (parts, cat) => {
      for (const p of parts) {
        eng.addPart(p.solid, p.name, {
          color: p.color, position: p.position, rotation: p.rotation,
          material: p.material, category: cat, subsystem: p.subsystem, metadata: p.metadata,
        });
      }
    };
    addAll(block.partsList, 'BLK');
    addAll(headA.partsList, 'HEAD');
    addAll(headB.partsList, 'HEAD');
    addAll(bedplate.partsList, 'BDPL');
    addAll(crank.partsList, 'CRNK');

    const root = AssemblyBridge.renderAssembly(eng, window.__three_scene);

    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const existing = [];
    window.__three_scene.traverse(o => { if (o.isLight && !o.userData?.studio) existing.push(o); });
    for (const l of existing) window.__three_scene.remove(l);
    StudioLighting.apply(window.__three_scene, {
      THREE, targetCenter: center, targetSize: size.length(), intensity: 1.6,
    });
    window.__three_renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const validation = {
      crank_mate: CrankshaftBuilder.validateMate(crank.features, block.features, bedplate.features),
    };

    return {
      partCount: eng.partCount(),
      crank_features: crank.features.length,
      total_mass_kg: block.mass_kg + headA.mass_kg + headB.mass_kg + bedplate.mass_kg + crank.mass_kg,
      bbox: { center: center.toArray(), size: size.toArray() },
      validation,
    };
  });

  console.log(`Total components: ${result.partCount}`);
  console.log(`Crank features: ${result.crank_features}`);
  console.log(`Total mass: ${result.total_mass_kg.toFixed(1)} kg`);
  console.log(`Crank main alignment: ${result.validation.crank_mate.mainJournalAlignment.aligned}/${result.validation.crank_mate.mainJournalAlignment.total}`);
  console.log(`Crank mate checks: ${result.validation.crank_mate.passed}/${result.validation.crank_mate.totalChecks} pass`);

  const c = result.bbox.center;
  const dist = Math.max(...result.bbox.size) * 2.2;
  const renderView = async (name, cameraPos, fov, label) => {
    await page.evaluate(async (s) => {
      const cam = window.__three_camera;
      cam.position.set(...s.cameraPos);
      cam.lookAt(...s.lookAt);
      cam.fov = s.fov; cam.near = 0.001; cam.far = s.far;
      cam.updateProjectionMatrix();
      window.__three_renderer.render(window.__three_scene, cam);
    }, { cameraPos, lookAt: c, fov, far: dist * 30 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SS, `${name}.png`), fullPage: false });
    console.log(`  ✓ ${name}.png — ${label}`);
  };

  await renderView('phase4-01-iso',
    [c[0] + dist * 0.6, c[1] + dist * 0.4, c[2] + dist * 0.6], 32, 'block + heads + bedplate + crank');
  await renderView('phase4-02-side',
    [c[0] + dist, c[1] + dist * 0.05, c[2]], 30, 'side — crank centerline visible');
  await renderView('phase4-03-front',
    [c[0], c[1] + dist * 0.05, c[2] - dist * 1.0], 30, 'front — crank pulley + V banks');
  await renderView('phase4-04-bottom',
    [c[0], c[1] - dist * 0.7, c[2] + dist * 0.4], 32, 'bottom — bedplate + crank journals visible');

  fs.writeFileSync(path.join(ROOT, 'validation', 'phase4-mate-validation.json'),
    JSON.stringify(result.validation, null, 2));

  expect(result.partCount).toBeGreaterThan(180);
  expect(result.validation.crank_mate.mainJournalAlignment.aligned).toBe(4);
});
