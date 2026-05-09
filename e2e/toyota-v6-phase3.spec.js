import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(process.cwd(), 'engine-output', 'Toyota-V6-2028-Hybrid');
const SS = path.join(ROOT, 'screenshots');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(600000);

test('Toyota V6 — Phase 3: block + 2 heads + bedplate, validated mating', async ({ page }) => {
  ensure(SS);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  console.log('\n========================================');
  console.log('  TOYOTA V35A-FTS — BLOCK + HEADS + BEDPLATE');
  console.log('========================================\n');

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const blockMod = await import('/src/projects/v6-block/EngineBlockBuilder.js');
    const headMod = await import('/src/projects/v6-block/CylinderHeadBuilder.js');
    const bedMod = await import('/src/projects/v6-block/BedplateBuilder.js');
    const { Assembly, AssemblyBridge, PartIDRegistry, StudioLighting } = m;
    const EngineBlockBuilder = blockMod.default;
    const CylinderHeadBuilder = headMod.default;
    const BedplateBuilder = bedMod.default;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    PartIDRegistry.reset();
    PartIDRegistry.setProject('TYV6');

    const t0 = performance.now();
    const blockResult = EngineBlockBuilder.build();
    const headA = CylinderHeadBuilder.build({ bank: 'A' });
    const headB = CylinderHeadBuilder.build({ bank: 'B' });
    const bedplate = BedplateBuilder.build();
    const buildSec = (performance.now() - t0) / 1000;

    const eng = new Assembly('Toyota V35A-FTS V6 — Block + Heads + Bedplate');
    for (const p of blockResult.partsList) {
      eng.addPart(p.solid, p.name, {
        color: p.color, position: p.position, rotation: p.rotation,
        material: p.material, category: 'BLK', subsystem: p.subsystem, metadata: p.metadata,
      });
    }
    for (const p of headA.partsList) {
      eng.addPart(p.solid, p.name, {
        color: p.color, position: p.position, rotation: p.rotation,
        material: p.material, category: 'HEAD', subsystem: p.subsystem, metadata: p.metadata,
      });
    }
    for (const p of headB.partsList) {
      eng.addPart(p.solid, p.name, {
        color: p.color, position: p.position, rotation: p.rotation,
        material: p.material, category: 'HEAD', subsystem: p.subsystem, metadata: p.metadata,
      });
    }
    for (const p of bedplate.partsList) {
      eng.addPart(p.solid, p.name, {
        color: p.color, position: p.position, rotation: p.rotation,
        material: p.material, category: 'BDPL', subsystem: p.subsystem, metadata: p.metadata,
      });
    }

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

    // Validation
    const validation = {
      headA_mate: CylinderHeadBuilder.validateMateToBlock(headA.features, blockResult.features, 'A'),
      headB_mate: CylinderHeadBuilder.validateMateToBlock(headB.features, blockResult.features, 'B'),
      bedplate_mate: BedplateBuilder.validateMateToBlock(bedplate.features, blockResult.features),
    };

    return {
      partCount: eng.partCount(),
      buildSec: +buildSec.toFixed(3),
      block_features: blockResult.features.length,
      headA_features: headA.features.length,
      headB_features: headB.features.length,
      bedplate_features: bedplate.features.length,
      total_mass_kg: blockResult.mass_kg + headA.mass_kg + headB.mass_kg + bedplate.mass_kg,
      bbox: { center: center.toArray(), size: size.toArray() },
      validation,
    };
  });

  console.log(`Build time: ${result.buildSec}s`);
  console.log(`Total components: ${result.partCount}`);
  console.log(`  Block: ${result.block_features}, Head A: ${result.headA_features}, Head B: ${result.headB_features}, Bedplate: ${result.bedplate_features}`);
  console.log(`Total mass: ${result.total_mass_kg.toFixed(1)} kg`);
  console.log('\n=== MATE VALIDATION ===');
  console.log(`Head A: ${result.validation.headA_mate.headBoltAlignment.aligned}/${result.validation.headA_mate.headBoltAlignment.total} head bolts aligned`);
  console.log(`Head B: ${result.validation.headB_mate.headBoltAlignment.aligned}/${result.validation.headB_mate.headBoltAlignment.total} head bolts aligned`);
  console.log(`Bedplate main saddles: ${result.validation.bedplate_mate.mainSaddleAlignment.aligned}/${result.validation.bedplate_mate.mainSaddleAlignment.total} aligned`);
  console.log(`Bedplate perimeter bolts: ${result.validation.bedplate_mate.perimeterBoltAlignment.aligned}/${result.validation.bedplate_mate.perimeterBoltAlignment.total} aligned`);
  console.log(`Bedplate total: ${result.validation.bedplate_mate.passed}/${result.validation.bedplate_mate.totalChecks} checks pass`);

  // Render
  const c = result.bbox.center;
  const sx = result.bbox.size[0], sy = result.bbox.size[1], sz = result.bbox.size[2];
  const dist = Math.max(sx, sy, sz) * 2.2;

  const renderView = async (name, cameraPos, lookAt, fov, label) => {
    await page.evaluate(async (s) => {
      const cam = window.__three_camera;
      cam.position.set(...s.cameraPos);
      cam.lookAt(...s.lookAt);
      cam.fov = s.fov; cam.near = 0.001; cam.far = s.far;
      cam.updateProjectionMatrix();
      window.__three_renderer.render(window.__three_scene, cam);
    }, { cameraPos, lookAt, fov, far: dist * 30 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SS, `${name}.png`), fullPage: false });
    console.log(`  ✓ ${name}.png — ${label}`);
  };

  await renderView('phase3-01-iso',
    [c[0] + dist * 0.65, c[1] + dist * 0.4, c[2] + dist * 0.65], c, 32, 'iso — full block + heads + bedplate');
  await renderView('phase3-02-side',
    [c[0] + dist, c[1] + dist * 0.05, c[2]], c, 30, 'side elevation');
  await renderView('phase3-03-front',
    [c[0], c[1] + dist * 0.1, c[2] - dist * 1.0], c, 30, 'front — bedplate visible at bottom');
  await renderView('phase3-04-bottom',
    [c[0], c[1] - dist * 0.6, c[2] + dist * 0.4], c, 32, 'bottom-up — bedplate + main saddles');

  fs.writeFileSync(path.join(ROOT, 'validation', 'phase3-mate-validation.json'),
    JSON.stringify(result.validation, null, 2));

  expect(result.partCount).toBeGreaterThan(150);
  expect(result.validation.bedplate_mate.mainSaddleAlignment.aligned).toBe(4);
  expect(result.validation.bedplate_mate.perimeterBoltAlignment.aligned).toBe(8);
});
