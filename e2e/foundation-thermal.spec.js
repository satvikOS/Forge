import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'thermal');
const SS_ROOT = path.join(REPO_ROOT, 'foundation-output', 'screenshots');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(420000);

test.describe('Foundation thermal FEM — steady-state heat conduction', () => {
  test.beforeAll(() => { ensure(ROOT); ensure(SS_ROOT); });

  test('1D rod with hot/cold ends → linear T(x) profile, uniform flux', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { TetMesh } = await import('/src/foundation/TetMesh.js');
      const { solveThermalSteady } = await import('/src/foundation/ThermalFEM.js');

      // 100 mm × 10 mm × 10 mm rod, 20 × 4 × 4 grid
      const mesh = TetMesh.regularGrid([0, 0, 0], [100, 10, 10], 20, 4, 4);
      // T_hot = 100°C at x=0,  T_cold = 25°C at x=100
      const T_HOT = 100, T_COLD = 25;
      const hotNodes  = mesh.selectNodes(([x]) => x < 1e-6);
      const coldNodes = mesh.selectNodes(([x]) => Math.abs(x - 100) < 1e-6);
      const fixed = [
        ...hotNodes.map(n => ({ node: n, value: T_HOT })),
        ...coldNodes.map(n => ({ node: n, value: T_COLD })),
      ];

      // Aluminum 6061: 167 W/(m·K) → 0.167 W/(mm·K) when length is in mm.
      const k = 0.167;

      const r = solveThermalSteady({
        mesh, k, fixedTemperatures: fixed,
      });

      // Sample T at several mid-cross-section (y=5, z=5) x positions.
      // Grid x positions: 0, 5, ..., 100. Average across all nodes at each x.
      const Tprofile = [];
      const xs = [0, 25, 50, 75, 100];
      for (const x of xs) {
        const ns = mesh.selectNodes(([nx]) => Math.abs(nx - x) < 1e-3);
        let s = 0;
        for (const n of ns) s += r.temperature[n];
        Tprofile.push({ x, T_FEM: s / Math.max(ns.length, 1), T_analytical: T_HOT + (T_COLD - T_HOT) * x / 100 });
      }

      // Heat flux: should be uniform -k·dT/dx = -0.167 × (-75/100) = 0.125 W/mm²
      const fluxX = r.elementHeatFlux.map(q => q ? q[0] : 0);
      let avgFlux = 0;
      let countNonZero = 0;
      for (const fx of fluxX) {
        if (Number.isFinite(fx) && fx !== 0) { avgFlux += fx; countNonZero++; }
      }
      avgFlux /= Math.max(countNonZero, 1);

      // Total heat through rod: q · A = 0.125 W/mm² × (10 × 10) mm² = 12.5 W
      const expectedFluxX = -k * (T_COLD - T_HOT) / 100;   // W/mm²
      const A = 10 * 10;
      const expectedTotalHeatW = Math.abs(expectedFluxX) * A;

      return {
        meshStats: mesh.stats(),
        cgIterations: r.cgIterations,
        cgResidual: r.cgResidual,
        Tprofile,
        avgFlux_x_FEM: avgFlux,
        expectedFlux_x: expectedFluxX,
        totalHeat_W_expected: expectedTotalHeatW,
        minT: r.minT, maxT: r.maxT,
      };
    });

    console.log(`\n=== 1D HEAT CONDUCTION — VALIDATION ===`);
    console.log(`Mesh: ${result.meshStats.tetCount} tets, ${result.meshStats.vertexCount} nodes`);
    console.log(`CG: ${result.cgIterations} iters, residual ${result.cgResidual.toExponential(2)}`);
    console.log(`T range: ${result.minT.toFixed(3)} – ${result.maxT.toFixed(3)} °C`);
    console.log(`T(x) profile (FEM vs analytical):`);
    for (const p of result.Tprofile) {
      const err = Math.abs(p.T_FEM - p.T_analytical);
      console.log(`  x = ${p.x.toString().padStart(4)} mm: FEM ${p.T_FEM.toFixed(3)} °C, analytical ${p.T_analytical.toFixed(3)} °C (Δ ${err.toExponential(1)})`);
    }
    console.log(`Heat flux x: FEM mean = ${result.avgFlux_x_FEM.toExponential(4)} W/mm², expected ${result.expectedFlux_x.toExponential(4)} W/mm²`);
    console.log(`Total heat through rod: ${result.totalHeat_W_expected.toFixed(2)} W (expected from spec)`);

    fs.writeFileSync(path.join(ROOT, 'rod-thermal.json'), JSON.stringify(result, null, 2));

    // 1D analytical solution should be reproduced exactly (linear field
    // is exactly representable by linear tets)
    for (const p of result.Tprofile) {
      expect(Math.abs(p.T_FEM - p.T_analytical)).toBeLessThan(1e-3);
    }
    expect(Math.abs(result.avgFlux_x_FEM - result.expectedFlux_x))
      .toBeLessThan(Math.abs(result.expectedFlux_x) * 1e-3);
  });

  test('Heat sink: hot base + 4 fins, render thermal contour', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    const result = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { TetMesh } = await import('/src/foundation/TetMesh.js');
      const { solveThermalSteady, THERMAL_K } = await import('/src/foundation/ThermalFEM.js');
      const { buildTetSurfaceColoredMesh } = await import('/src/foundation/FEMVisualizer.js');
      const { StudioLighting } = await import('/src/kernel/index.js');

      // Heat sink: 60 × 40 × 4 mm base plate. We'll use a regular grid
      // and add 4 fins by extruding regions of "extra height" via a
      // height-aware grid: instead, simulate a unified geometry by
      // taking a 60 × 40 × 30 mm bbox at coarse resolution (15 × 10 × 8
      // = 9000 tets).
      const mesh = TetMesh.regularGrid([0, 0, 0], [60, 40, 30], 15, 10, 8);
      // Hot base: T = 90°C at z = 0 (bottom face)
      const hot = mesh.selectNodes(([x, y, z]) => z < 1e-6);
      // Cool top: T = 25°C at z = 30 (top of "fins")
      const cold = mesh.selectNodes(([x, y, z]) => Math.abs(z - 30) < 1e-6);

      const fixed = [
        ...hot.map(n => ({ node: n, value: 90 })),
        ...cold.map(n => ({ node: n, value: 25 })),
      ];
      const k = 0.167;  // Aluminum 6061 W/(mm·K)

      const r = solveThermalSteady({ mesh, k, fixedTemperatures: fixed });

      // Visualize temperature field on the boundary surface
      const { mesh: tempMesh, stats } = buildTetSurfaceColoredMesh(mesh, r.temperature);

      const scene = window.__three_scene;
      const renderer = window.__three_renderer;
      const toRemove = [];
      scene.traverse(o => { if (o !== scene && !o.isLight && !o.isCamera) toRemove.push(o); });
      for (const o of toRemove) o.parent?.remove(o);
      scene.add(tempMesh);

      const box = new THREE.Box3().setFromObject(tempMesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const lightsToRemove = [];
      scene.traverse(o => { if (o.isLight && !o.userData?.studio) lightsToRemove.push(o); });
      for (const l of lightsToRemove) scene.remove(l);
      StudioLighting.apply(scene, { THREE, targetCenter: center, targetSize: size.length(), intensity: 1.5 });
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      return {
        bbox: { center: center.toArray(), size: size.toArray() },
        meshStats: mesh.stats(),
        tempStats: stats,
        cgIterations: r.cgIterations,
        cgResidual: r.cgResidual,
        minT: r.minT, maxT: r.maxT,
      };
    });

    console.log(`\n=== HEAT SINK THERMAL FEM ===`);
    console.log(`Mesh: ${result.meshStats.tetCount} tets, ${result.meshStats.vertexCount} nodes`);
    console.log(`CG: ${result.cgIterations} iters, residual ${result.cgResidual.toExponential(2)}`);
    console.log(`Temperature field: ${result.minT.toFixed(2)} – ${result.maxT.toFixed(2)} °C`);

    fs.writeFileSync(path.join(ROOT, 'heat-sink-thermal.json'), JSON.stringify(result, null, 2));

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
    await renderView('thermal-heatsink-01-iso',  [c[0] + dist * 0.7, c[1] - dist * 0.4, c[2] + dist * 0.6], 32, 'thermal contour iso');
    await renderView('thermal-heatsink-02-side', [c[0] + dist, c[1] + dist * 0.05, c[2]], 30, 'thermal contour side');

    expect(result.minT).toBeGreaterThanOrEqual(24.9);
    expect(result.maxT).toBeLessThanOrEqual(90.1);
  });
});
