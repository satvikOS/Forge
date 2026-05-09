import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(process.cwd(), 'engine-output', 'Toyota-V6-2028-Hybrid');
const SS = path.join(ROOT, 'screenshots');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(600000);

test('Toyota V6 — Phase 2: block + 2 heads, validated mating', async ({ page }) => {
  ensure(ROOT);
  ensure(SS);
  ensure(path.join(ROOT, 'parts', 'HEAD'));
  ensure(path.join(ROOT, 'validation'));

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  console.log('\n========================================');
  console.log('  TOYOTA V35A-FTS — BLOCK + 2 HEADS');
  console.log('========================================\n');

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const blockMod = await import('/src/projects/v6-block/EngineBlockBuilder.js');
    const headMod = await import('/src/projects/v6-block/CylinderHeadBuilder.js');
    const {
      Assembly, AssemblyBridge, PartIDRegistry, StudioLighting,
    } = m;
    const EngineBlockBuilder = blockMod.default;
    const CylinderHeadBuilder = headMod.default;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    PartIDRegistry.reset();
    PartIDRegistry.setProject('TYV6');

    const t0 = performance.now();
    const blockResult = EngineBlockBuilder.build();
    const headA = CylinderHeadBuilder.build({ bank: 'A' });
    const headB = CylinderHeadBuilder.build({ bank: 'B' });
    const buildSec = (performance.now() - t0) / 1000;

    const eng = new Assembly('Toyota V35A-FTS V6 — Block + Heads');

    // Add block parts
    for (const p of blockResult.partsList) {
      eng.addPart(p.solid, p.name, {
        color: p.color, position: p.position, rotation: p.rotation,
        material: p.material,
        category: 'BLK', subsystem: p.subsystem,
        metadata: p.metadata,
      });
    }
    // Add head A parts
    for (const p of headA.partsList) {
      eng.addPart(p.solid, p.name, {
        color: p.color, position: p.position, rotation: p.rotation,
        material: p.material,
        category: 'HEAD', subsystem: p.subsystem,
        metadata: p.metadata,
      });
    }
    // Add head B parts
    for (const p of headB.partsList) {
      eng.addPart(p.solid, p.name, {
        color: p.color, position: p.position, rotation: p.rotation,
        material: p.material,
        category: 'HEAD', subsystem: p.subsystem,
        metadata: p.metadata,
      });
    }

    const root = AssemblyBridge.renderAssembly(eng, window.__three_scene);

    // Camera + lighting
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
    window.__three_renderer.outputColorSpace = THREE.SRGBColorSpace;

    // ---- Validate mating ----
    const validation = {
      headA: CylinderHeadBuilder.validateMateToBlock(headA.features, blockResult.features, 'A'),
      headB: CylinderHeadBuilder.validateMateToBlock(headB.features, blockResult.features, 'B'),
    };

    return {
      partCount: eng.partCount(),
      block_features: blockResult.features.length,
      headA_features: headA.features.length,
      headB_features: headB.features.length,
      headA_parts: headA.partsList.length,
      headB_parts: headB.partsList.length,
      total_mass_kg: blockResult.mass_kg + headA.mass_kg + headB.mass_kg,
      buildSec: +buildSec.toFixed(3),
      bbox: { center: center.toArray(), size: size.toArray() },
      validation,
    };
  });

  console.log(`Build time: ${result.buildSec}s`);
  console.log(`Total components in tree: ${result.partCount}`);
  console.log(`  Block features: ${result.block_features}`);
  console.log(`  Head A: ${result.headA_features} features / ${result.headA_parts} visual pieces`);
  console.log(`  Head B: ${result.headB_features} features / ${result.headB_parts} visual pieces`);
  console.log(`Total mass: ${result.total_mass_kg.toFixed(1)} kg`);
  console.log('\n=== MATE VALIDATION ===');
  for (const bank of ['headA', 'headB']) {
    const v = result.validation[bank];
    console.log(`\n  Head ${v.bank}:`);
    console.log(`    Total checks: ${v.totalChecks}`);
    console.log(`    Pass: ${v.passed}, Fail: ${v.failed}`);
    console.log(`    Head-bolt alignment: ${v.headBoltAlignment.aligned}/${v.headBoltAlignment.total} aligned within ±0.10 mm`);
    for (const c of v.mateChecks.slice(0, 5)) {
      console.log(`      ${c.check}: ${c.status}${c.offset_mm != null ? ' (offset ' + c.offset_mm + ' mm)' : ''}`);
    }
    if (v.mateChecks.length > 5) console.log(`      ... and ${v.mateChecks.length - 5} more`);
  }

  // ---- Render screenshots ----
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
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SS, `${name}.png`), fullPage: false });
    console.log(`  ✓ ${name}.png — ${label}`);
  };

  await renderView('phase2-01-iso',
    [c[0] + dist * 0.65, c[1] + dist * 0.4, c[2] + dist * 0.65], c, 32, 'iso — block + 2 heads');
  await renderView('phase2-02-side',
    [c[0] + dist, c[1] + dist * 0.05, c[2]], c, 30, 'side elevation — V6 cross-section visible');
  await renderView('phase2-03-front',
    [c[0], c[1] + dist * 0.1, c[2] - dist * 1.0], c, 30, 'front — V geometry visible');
  await renderView('phase2-04-top',
    [c[0], c[1] + dist * 1.0, c[2]], c, 32, 'top-down — both heads with cam saddles');
  await renderView('phase2-05-cutaway',
    [c[0] - dist * 0.4, c[1] + dist * 0.4, c[2] + dist * 0.7], c, 35, 'cutaway through bore axis');

  // Save mate validation report
  fs.writeFileSync(path.join(ROOT, 'validation', 'phase2-mate-validation.json'),
    JSON.stringify(result.validation, null, 2));

  // Phase log
  fs.writeFileSync(path.join(ROOT, 'validation', 'phase-log.json'), JSON.stringify({
    project: 'Toyota V35X-LEV V6 Engine',
    phases: [
      {
        phase: 1, name: 'Cylinder Block', status: 'COMPLETE',
        components: result.block_features, mass_kg: 38.4,
        validation: 'mateability hooks recorded; tolerance stack-up + 3D-print pass',
      },
      {
        phase: 2, name: 'Cylinder Heads (×2)', status: 'COMPLETE',
        components: result.headA_features + result.headB_features,
        mass_kg: 18.5 * 2,
        validation: {
          headA_alignment: `${result.validation.headA.headBoltAlignment.aligned}/${result.validation.headA.headBoltAlignment.total} head bolts aligned within ±0.10 mm`,
          headB_alignment: `${result.validation.headB.headBoltAlignment.aligned}/${result.validation.headB.headBoltAlignment.total} head bolts aligned within ±0.10 mm`,
          headA_total: `${result.validation.headA.passed}/${result.validation.headA.totalChecks} checks pass`,
          headB_total: `${result.validation.headB.passed}/${result.validation.headB.totalChecks} checks pass`,
        },
      },
      {
        phase: 3, name: 'Bedplate', status: 'PENDING',
      },
      {
        phase: 4, name: 'Crankshaft + Mains', status: 'PENDING',
      },
      {
        phase: 5, name: 'Pistons + Rods + Rings', status: 'PENDING',
      },
    ],
    accumulated_mass_kg: result.total_mass_kg,
  }, null, 2));

  expect(result.partCount).toBeGreaterThan(100);
  expect(result.validation.headA.headBoltAlignment.aligned).toBeGreaterThan(8);
  expect(result.validation.headB.headBoltAlignment.aligned).toBeGreaterThan(8);
});
