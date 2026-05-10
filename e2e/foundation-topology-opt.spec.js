import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'topology-opt');
const SS_ROOT = path.join(REPO_ROOT, 'foundation-output', 'screenshots');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

const ALUM = { name: 'Aluminum 6061-T6', E: 68900, nu: 0.33 };

test('SIMP topology optimization on a cantilever beam', async ({ page }) => {
  ensure(ROOT);
  ensure(SS_ROOT);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async (mat) => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { TetMesh } = await import('/src/foundation/TetMesh.js');
    const { optimizeSIMP } = await import('/src/foundation/TopologyOptimization.js');
    const { StudioLighting } = await import('/src/kernel/index.js');

    // 80 × 20 × 12 mm beam at 4 mm cells (20 × 5 × 3 → 300 hex cells × 6 = 1800 tets)
    const mesh = TetMesh.regularGrid([0, 0, 0], [80, 20, 12], 20, 5, 3);
    // Fix one end (x = 0) entirely
    const fixed = mesh.selectNodes(([x]) => x < 1e-6);
    // Apply downward point load at the bottom-right edge tip (concentrated)
    const tipNodes = mesh.selectNodes(([x, y, z]) => Math.abs(x - 80) < 1e-6 && y < 1e-6 && Math.abs(z - 6) < 7);
    const loads = tipNodes.map(n => ({ node: n, dof: 1, value: -200 / Math.max(tipNodes.length, 1) }));

    const t0 = performance.now();
    const opt = optimizeSIMP({
      mesh, material: mat,
      fixedNodes: fixed, loads,
      volumeFraction: 0.35,
      penalty: 3,
      filterRadius: 8,    // 2 × cell size for proper smoothing
      maxIter: 30,
      tol: 0.01,
    });
    const elapsed = (performance.now() - t0) / 1000;

    // Stats
    let avgRho = 0;
    for (const r of opt.densities) avgRho += r;
    avgRho /= opt.densities.length;
    let aboveThresh = 0;
    for (const r of opt.densities) if (r > 0.5) aboveThresh++;

    // Render the result: extract elements with ρ > 0.5 as a deduped vertex+face mesh.
    const scene = window.__three_scene;
    const renderer = window.__three_renderer;
    const toRemove = [];
    scene.traverse(o => { if (o !== scene && !o.isLight && !o.isCamera) toRemove.push(o); });
    for (const o of toRemove) o.parent?.remove(o);

    // Each "kept" tet contributes 4 triangles. Collect with per-face vertex
    // colors (greyscale by density) for visualization.
    const vertices = mesh.vertices;
    const triCount = aboveThresh * 4;
    const positions = new Float32Array(triCount * 9);
    const colors = new Float32Array(triCount * 9);
    let idx = 0;
    const TET_FACES = [[0,1,2],[0,1,3],[0,2,3],[1,2,3]];
    for (let e = 0; e < opt.densities.length; e++) {
      if (opt.densities[e] < 0.5) continue;
      const t = mesh.tets[e];
      const c = Math.min(1, opt.densities[e]);
      // map density to a warm color (yellow → orange → red)
      const r = 1, g = 0.7 - 0.6 * c, b = 0.3 - 0.3 * c;
      for (const f of TET_FACES) {
        for (let v = 0; v < 3; v++) {
          const vp = vertices[t[f[v]]];
          positions[idx]     = vp[0];
          positions[idx + 1] = vp[1];
          positions[idx + 2] = vp[2];
          colors[idx]     = r;
          colors[idx + 1] = g;
          colors[idx + 2] = b;
          idx += 3;
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide,
    });
    const optMesh = new THREE.Mesh(geometry, material);
    scene.add(optMesh);

    // Lighting
    const box = new THREE.Box3().setFromObject(optMesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const lightsToRemove = [];
    scene.traverse(o => { if (o.isLight && !o.userData?.studio) lightsToRemove.push(o); });
    for (const l of lightsToRemove) scene.remove(l);
    StudioLighting.apply(scene, { THREE, targetCenter: center, targetSize: size.length(), intensity: 1.6 });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    return {
      bbox: { center: center.toArray(), size: size.toArray() },
      meshStats: mesh.stats(),
      elapsed: +elapsed.toFixed(3),
      iterations: opt.history.length,
      finalCompliance: opt.compliance,
      avgRho,
      aboveThresh,
      totalElements: opt.densities.length,
      history: opt.history.map(h => ({
        iter: h.iter, compliance: h.compliance,
        volFrac: h.volFracActual, maxDelta: h.maxDelta, cg: h.cgIters,
      })),
      densities: Array.from(opt.densities),
    };
  }, ALUM);

  console.log(`\n=== SIMP TOPOLOGY OPTIMIZATION (cantilever, 1800 tets) ===`);
  console.log(`Solve time:       ${result.elapsed} s, ${result.iterations} outer iterations`);
  console.log(`Volume fraction:  ${(result.aboveThresh / result.totalElements).toFixed(3)} solid (${result.aboveThresh}/${result.totalElements} elements)`);
  console.log(`Avg density (incl voids): ${result.avgRho.toFixed(3)}`);
  console.log(`Final compliance: ${result.finalCompliance.toExponential(3)}`);
  console.log(`Convergence trace (last 5):`);
  for (const h of result.history.slice(-5)) {
    console.log(`  iter ${h.iter}: c=${h.compliance.toExponential(2)}, V=${h.volFrac.toFixed(3)}, max|Δρ|=${h.maxDelta.toFixed(4)}, CG ${h.cg}`);
  }

  fs.writeFileSync(path.join(ROOT, 'cantilever-simp.json'), JSON.stringify({
    input: { material: ALUM, volumeFraction: 0.35, penalty: 3, filterRadius: 8, maxIter: 30 },
    meshStats: result.meshStats,
    summary: {
      iterations: result.iterations,
      elapsedSec: result.elapsed,
      finalCompliance: result.finalCompliance,
      finalVolFrac: result.aboveThresh / result.totalElements,
    },
    history: result.history,
    densities: result.densities,
  }, null, 2));

  // Render the optimized topology from multiple angles
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
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SS_ROOT, `${name}.png`), fullPage: false });
    console.log(`  ✓ ${name}.png — ${label}`);
  };

  await renderView('topo-opt-cantilever-01-iso',  [c[0] + dist * 0.7, c[1] + dist * 0.4, c[2] + dist * 0.6], 32, 'iso, optimized topology');
  await renderView('topo-opt-cantilever-02-side', [c[0], c[1] + dist * 0.05, c[2] + dist], 30, 'side, truss-like load path');
  await renderView('topo-opt-cantilever-03-front',[c[0] + dist, c[1] + dist * 0.05, c[2]], 30, 'front, optimized cross-section');

  expect(result.iterations).toBeGreaterThan(5);
  expect(result.aboveThresh).toBeGreaterThan(50);
  // Density should converge near the target volume fraction (allow drift)
  const finalVolFrac = result.aboveThresh / result.totalElements;
  expect(finalVolFrac).toBeGreaterThan(0.20);
  expect(finalVolFrac).toBeLessThan(0.55);
});
