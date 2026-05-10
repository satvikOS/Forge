import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'fem');
const SS_ROOT = path.join(REPO_ROOT, 'foundation-output', 'screenshots');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(420000);

test('FEM on bracket geometry: voxelize manifold + solve + render stress contour', async ({ page }) => {
  ensure(ROOT);
  ensure(SS_ROOT);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { TetMesh } = await import('/src/foundation/TetMesh.js');
    const { solveLinearStatic } = await import('/src/foundation/LinearTetFEM.js');
    const { buildTetSurfaceColoredMesh, deformTetMesh, buildLegendSprite } = await import('/src/foundation/FEMVisualizer.js');
    const { buildPhoneStandBracket } = await import('/src/foundation/parts/PhoneStandBracket.js');
    const { StudioLighting } = await import('/src/kernel/index.js');

    const ALUM = { name: 'Aluminum 6061-T6', E: 68900, nu: 0.33, density: 2.70e-6,
                   yieldStrength: 276, ultimateStrength: 310 };

    const t0 = performance.now();
    const bracket = await buildPhoneStandBracket();
    const buildSec = (performance.now() - t0) / 1000;

    // Voxel-fill at 4 mm cell size (bracket bbox ≈ 80 × 105 × 21 mm)
    const t1 = performance.now();
    const tetMesh = await TetMesh.fromManifold(bracket, { cellSize: 4 });
    const meshSec = (performance.now() - t1) / 1000;

    // Boundary conditions: fix all vertices in the base plate (y < 5),
    // apply a downward force at the lip (y > 60, z > 30).
    const fixed = tetMesh.selectNodes(([x, y, z]) => y < 1 && z < 6);
    const lip = tetMesh.selectNodes(([x, y, z]) => z > 8 && y > 4 && y < 12);
    const FORCE_N = -50;  // 50 N downward (a phone weighs ~200 g; 50 N is a safety-test load)
    const loads = lip.map(n => ({ node: n, dof: 1, value: FORCE_N / lip.length }));

    const t2 = performance.now();
    const fem = solveLinearStatic({ mesh: tetMesh, material: ALUM, fixedNodes: fixed, loads });
    const femSec = (performance.now() - t2) / 1000;

    // Build colored stress mesh + legend
    const { mesh: stressMesh, stats } = buildTetSurfaceColoredMesh(tetMesh, fem.nodalVonMises);
    const scene = window.__three_scene;
    const renderer = window.__three_renderer;

    // Clear existing renderable children (keep cameras + lights placed by Studio)
    const toRemove = [];
    scene.traverse(o => { if (o !== scene && !o.isLight && !o.isCamera) toRemove.push(o); });
    for (const o of toRemove) o.parent?.remove(o);

    scene.add(stressMesh);

    // Optional: also visualize a deformed mesh (highly exaggerated)
    const deformScale = 200;  // tip displacement ~0.05mm → exaggerate to see it
    const deformed = deformTetMesh(tetMesh, fem.displacement, deformScale);
    const ghost = buildTetSurfaceColoredMesh(deformed, fem.nodalVonMises);
    ghost.mesh.material = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.18, wireframe: true,
    });
    scene.add(ghost.mesh);

    const box = new THREE.Box3().setFromObject(stressMesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Studio lighting
    const lightsToRemove = [];
    scene.traverse(o => { if (o.isLight && !o.userData?.studio) lightsToRemove.push(o); });
    for (const l of lightsToRemove) scene.remove(l);
    StudioLighting.apply(scene, { THREE, targetCenter: center, targetSize: size.length(), intensity: 1.6 });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    return {
      bbox: { center: center.toArray(), size: size.toArray() },
      buildSec, meshSec, femSec,
      tetStats: tetMesh.stats(),
      femStats: {
        cgIterations: fem.cgIterations,
        cgResidual: fem.cgResidual,
        maxDisplacementMm: fem.maxDisplacement,
        maxVonMisesMPa: fem.maxStress,
        safetyFactor: fem.safetyFactor,
      },
      stressFieldRange: stats,
      fixedNodes: fixed.length,
      loadNodes: lip.length,
      forceTotalN: FORCE_N,
      deformScale,
    };
  });

  console.log(`\n=== FEM ON BRACKET (manifold geometry) ===`);
  console.log(`Bracket build:  ${result.buildSec.toFixed(3)} s`);
  console.log(`Voxelize:       ${result.meshSec.toFixed(3)} s  (${result.tetStats.tetCount} tets, ${result.tetStats.vertexCount} nodes)`);
  console.log(`FEM solve:      ${result.femSec.toFixed(3)} s  (CG ${result.femStats.cgIterations} iters, residual ${result.femStats.cgResidual.toExponential(2)})`);
  console.log(`Fixed nodes:    ${result.fixedNodes}`);
  console.log(`Load nodes:     ${result.loadNodes}  (total -${Math.abs(result.forceTotalN)} N)`);
  console.log(`Max displacement: ${result.femStats.maxDisplacementMm.toFixed(4)} mm`);
  console.log(`Max von Mises:    ${result.femStats.maxVonMisesMPa.toFixed(2)} MPa`);
  console.log(`Safety factor:    ${result.femStats.safetyFactor.toFixed(1)}  (vs 276 MPa Al 6061-T6 yield)`);

  fs.writeFileSync(path.join(ROOT, 'bracket-fem.json'), JSON.stringify(result, null, 2));

  const c = result.bbox.center;
  const dist = Math.max(...result.bbox.size) * 1.6;
  const renderView = async (name, cameraPos, fov, label) => {
    await page.evaluate(async (s) => {
      const cam = window.__three_camera;
      cam.position.set(...s.cameraPos);
      cam.lookAt(...s.lookAt);
      cam.fov = s.fov; cam.near = 0.001; cam.far = s.far;
      cam.updateProjectionMatrix();
      window.__three_renderer.render(window.__three_scene, cam);
    }, { cameraPos, lookAt: c, fov, far: dist * 30 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SS_ROOT, `${name}.png`), fullPage: false });
    console.log(`  ✓ ${name}.png — ${label}`);
  };

  await renderView('fem-bracket-01-iso',  [c[0] + dist * 0.7, c[1] + dist * 0.4, c[2] + dist * 0.6], 32, 'iso, stress contour');
  await renderView('fem-bracket-02-side', [c[0] + dist, c[1] + dist * 0.05, c[2]], 30, 'side, stress contour');
  await renderView('fem-bracket-03-back', [c[0] + dist * 0.6, c[1] + dist * 0.05, c[2] - dist * 0.6], 32, '3/4 back, deformed wireframe');

  expect(result.tetStats.tetCount).toBeGreaterThan(0);
  expect(result.femStats.cgResidual).toBeLessThan(1e-6);
  expect(result.femStats.maxVonMisesMPa).toBeGreaterThan(0);
});
