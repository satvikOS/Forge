import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'thermomech');
const SS_ROOT = path.join(REPO_ROOT, 'foundation-output', 'screenshots');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(420000);

const ALUM = {
  name: 'Aluminum 6061-T6',
  E: 68900,            // MPa
  nu: 0.33,
  alpha: 23.6e-6,      // 1/K
  density: 2.70e-6,
  yieldStrength: 276,
  // Thermal conductivity 167 W/(m·K) → 0.167 W/(mm·K) for mm-scale models
  k: 0.167,
};

test.describe('Foundation thermal-structural coupling', () => {
  test.beforeAll(() => { ensure(ROOT); ensure(SS_ROOT); });

  test('Free-end bar uniformly heated → δ = LαΔT, σ ≈ 0', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async (mat) => {
      const { TetMesh } = await import('/src/foundation/TetMesh.js');
      const { solveThermoMechanical } = await import('/src/foundation/ThermoMechanical.js');

      // 100 × 10 × 10 mm bar, fixed at x=0 (all 3 DOF), free elsewhere
      // Thermal: T = T_hot at x=0 AND x=100 — uniformly hot bar
      const mesh = TetMesh.regularGrid([0, 0, 0], [100, 10, 10], 20, 4, 4);
      // Kill rigid-body modes only — let the cross-section Poisson-
      // contract freely. This is the textbook way to validate free
      // thermal expansion (otherwise the fully-clamped face creates
      // spurious boundary stress).
      //   • node at (0,0,0): full 3-DOF fix
      //   • node at (0,10,0) i.e. y-edge of x=0: lock X + Z (kills X-trans, X-rotation)
      //   • node at (0,0,10) i.e. z-edge of x=0: lock X (kills Y-rotation)
      const corner000 = mesh.selectNodes(([x, y, z]) => x < 1e-6 && y < 1e-6 && z < 1e-6)[0];
      const cornerY10 = mesh.selectNodes(([x, y, z]) => x < 1e-6 && Math.abs(y - 10) < 1e-6 && z < 1e-6)[0];
      const cornerZ10 = mesh.selectNodes(([x, y, z]) => x < 1e-6 && y < 1e-6 && Math.abs(z - 10) < 1e-6)[0];
      // RBM-only fixity (6 DOFs total → kills 3 translations + 3 rotations):
      //   corner000 (0,0,0): all 3 DOFs fixed → kills X/Y/Z translation
      //   cornerY10 (0,10,0): X + Z fixed → kills Z and X rotation about origin
      //   cornerZ10 (0,0,10): X fixed → kills Y rotation about origin
      // Y/Z stay free elsewhere on the x=0 face → cross-section can poisson-contract.
      const fixedDofs = [
        { node: corner000, dof: 0 }, { node: corner000, dof: 1 }, { node: corner000, dof: 2 },
        { node: cornerY10, dof: 0 }, { node: cornerY10, dof: 2 },
        { node: cornerZ10, dof: 0 },
      ];
      const allNodes = mesh.selectNodes(() => true);
      const T_HOT = 100;   // °C
      const T_REF = 25;    // °C

      const r = await solveThermoMechanical({
        mesh, material: mat,
        thermal: {
          k: mat.k,
          Tref: T_REF,
          fixedTemperatures: allNodes.map(n => ({ node: n, value: T_HOT })),
        },
        structural: {
          fixedDofs,
          mechanicalLoads: [],
        },
      });

      // Sample displacement at the free end (x = 100 plane), x-component.
      const tipNodes = mesh.selectNodes(([x]) => Math.abs(x - 100) < 1e-6);
      let avgDispX = 0;
      for (const n of tipNodes) avgDispX += r.displacement[n * 3];
      avgDispX /= tipNodes.length;

      // Average von Mises across all elements
      let sumVM = 0, count = 0;
      for (const v of r.elementVonMises) { if (v > 0) { sumVM += v; count++; } }
      const meanVM = sumVM / Math.max(count, 1);

      return {
        meshStats: mesh.stats(),
        tipDispX: avgDispX,
        maxDispMm: r.maxDisplacement,
        maxVonMisesMPa: r.maxStress,
        meanVonMisesMPa: meanVM,
        thermalCg: { iters: r.thermalCgIters, res: r.thermalCgResidual },
        structuralCg: { iters: r.structuralCgIters, res: r.structuralCgResidual },
      };
    }, ALUM);

    const dT = 100 - 25;
    const expectedTipDispMm = 100 * ALUM.alpha * dT;   // L · α · ΔT
    console.log(`\n=== FREE-END THERMAL EXPANSION ===`);
    console.log(`Mesh: ${result.meshStats.tetCount} tets, ${result.meshStats.vertexCount} nodes`);
    console.log(`ΔT: ${dT} K`);
    console.log(`Tip δx (FEM):       ${result.tipDispX.toFixed(6)} mm`);
    console.log(`Tip δx (analytical): ${expectedTipDispMm.toFixed(6)} mm  (= L·α·ΔT)`);
    console.log(`Pct error: ${((result.tipDispX - expectedTipDispMm) / expectedTipDispMm * 100).toFixed(3)} %`);
    console.log(`Max von Mises: ${result.maxVonMisesMPa.toFixed(6)} MPa  (expected ≈ 0)`);
    console.log(`Mean von Mises: ${result.meanVonMisesMPa.toFixed(6)} MPa  (expected ≈ 0)`);

    fs.writeFileSync(path.join(ROOT, 'free-end-thermal.json'), JSON.stringify({
      input: { dT, material: ALUM, expectedTipDispMm },
      fem: result,
      pctError: (result.tipDispX - expectedTipDispMm) / expectedTipDispMm * 100,
    }, null, 2));

    // Tip displacement matches L·α·ΔT to within 0.5 % (linear-tet stiffness in axial mode is exact for uniform strain, so this should be very tight).
    expect(Math.abs(result.tipDispX - expectedTipDispMm) / expectedTipDispMm).toBeLessThan(0.005);
    // Stress should be near zero (free expansion produces no stress).
    expect(result.maxVonMisesMPa).toBeLessThan(1.0);   // 1 MPa tolerance for numerical noise
  });

  test('Fixed-fixed bar uniformly heated → σ_x = -E·α·ΔT', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async (mat) => {
      const { TetMesh } = await import('/src/foundation/TetMesh.js');
      const { solveThermoMechanical } = await import('/src/foundation/ThermoMechanical.js');

      const mesh = TetMesh.regularGrid([0, 0, 0], [100, 10, 10], 20, 4, 4);
      // Fix BOTH ends in x-direction. Free in y/z so bar can poisson-contract.
      // Use partial DOF locking — easiest is to fix ALL DOFs at both ends;
      // the resulting σ_x prediction approximates σ_x = -E α ΔT closely
      // because the dominant constraint is axial.
      const leftNodes  = mesh.selectNodes(([x]) => x < 1e-6);
      const rightNodes = mesh.selectNodes(([x]) => Math.abs(x - 100) < 1e-6);
      const fixedMech = [...leftNodes, ...rightNodes];
      const allNodes = mesh.selectNodes(() => true);
      const T_HOT = 100, T_REF = 25;

      const r = await solveThermoMechanical({
        mesh, material: mat,
        thermal: { k: mat.k, Tref: T_REF, fixedTemperatures: allNodes.map(n => ({ node: n, value: T_HOT })) },
        structural: { fixedNodes: fixedMech, mechanicalLoads: [] },
      });

      // Mean σ_xx in interior (away from constraint edges)
      const interiorElems = [];
      for (let e = 0; e < r.elementStress.length; e++) {
        if (!r.elementStress[e]) continue;
        // get tet centroid x
        const { TetMesh } = await import('/src/foundation/TetMesh.js');
        const tet = mesh.tets[e];
        const cx = (mesh.vertices[tet[0]][0] + mesh.vertices[tet[1]][0]
                  + mesh.vertices[tet[2]][0] + mesh.vertices[tet[3]][0]) / 4;
        if (cx > 30 && cx < 70) interiorElems.push(e);
      }
      let sumSxx = 0, sumSyy = 0, sumSzz = 0;
      for (const e of interiorElems) {
        sumSxx += r.elementStress[e][0];
        sumSyy += r.elementStress[e][1];
        sumSzz += r.elementStress[e][2];
      }
      const n = interiorElems.length;
      return {
        meshStats: mesh.stats(),
        interiorSampleN: n,
        meanSigmaXX: sumSxx / n,
        meanSigmaYY: sumSyy / n,
        meanSigmaZZ: sumSzz / n,
        maxVonMises: r.maxStress,
        maxDispMm: r.maxDisplacement,
        thermalCg: { iters: r.thermalCgIters, res: r.thermalCgResidual },
        structuralCg: { iters: r.structuralCgIters, res: r.structuralCgResidual },
      };
    }, ALUM);

    const dT = 100 - 25;
    const expectedSigmaX = -ALUM.E * ALUM.alpha * dT;   // MPa, compressive
    console.log(`\n=== FIXED-FIXED THERMAL STRESS ===`);
    console.log(`ΔT: ${dT} K`);
    console.log(`Interior elements sampled: ${result.interiorSampleN}`);
    console.log(`Mean σ_xx (FEM):       ${result.meanSigmaXX.toFixed(2)} MPa`);
    console.log(`Mean σ_xx (analytical): ${expectedSigmaX.toFixed(2)} MPa  (= -E·α·ΔT)`);
    console.log(`Pct error: ${((result.meanSigmaXX - expectedSigmaX) / expectedSigmaX * 100).toFixed(2)} %`);
    console.log(`Mean σ_yy: ${result.meanSigmaYY.toFixed(2)} MPa  (expected ≈ 0 since y free)`);
    console.log(`Mean σ_zz: ${result.meanSigmaZZ.toFixed(2)} MPa  (expected ≈ 0 since z free)`);
    console.log(`Max displacement: ${result.maxDispMm.toFixed(6)} mm  (expected small)`);

    fs.writeFileSync(path.join(ROOT, 'fixed-fixed-thermal.json'), JSON.stringify({
      input: { dT, material: ALUM, expectedSigmaXMPa: expectedSigmaX },
      fem: result,
      pctError: (result.meanSigmaXX - expectedSigmaX) / expectedSigmaX * 100,
    }, null, 2));

    // Linear tet should give σ_xx within 5 % of -EαΔT in the interior.
    // Note y-z DOFs are locked too at the ends (full 3-DOF clamp), which
    // adds a slight Poisson-coupling effect — accept ±10 %.
    const pctError = Math.abs((result.meanSigmaXX - expectedSigmaX) / expectedSigmaX);
    expect(pctError).toBeLessThan(0.10);
    // σ_yy / σ_zz should be much smaller than σ_xx
    expect(Math.abs(result.meanSigmaYY)).toBeLessThan(Math.abs(expectedSigmaX) * 0.30);
    expect(Math.abs(result.meanSigmaZZ)).toBeLessThan(Math.abs(expectedSigmaX) * 0.30);
  });

  test('Bracket: hot base + cold lip → thermal stress contour render', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    const result = await page.evaluate(async (mat) => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { TetMesh } = await import('/src/foundation/TetMesh.js');
      const { solveThermoMechanical } = await import('/src/foundation/ThermoMechanical.js');
      const { buildPhoneStandBracket } = await import('/src/foundation/parts/PhoneStandBracket.js');
      const { buildTetSurfaceColoredMesh } = await import('/src/foundation/FEMVisualizer.js');
      const { StudioLighting } = await import('/src/kernel/index.js');

      const bracket = await buildPhoneStandBracket();
      const mesh = await TetMesh.fromManifold(bracket, { cellSize: 4 });
      const fixedMech = mesh.selectNodes(([x, y, z]) => z <= 0.5);
      const hotBase = mesh.selectNodes(([x, y, z]) => z <= 0.5);
      const coldLip = mesh.selectNodes(([x, y, z]) => z > 7 && y > 4 && y < 12);

      const r = await solveThermoMechanical({
        mesh, material: mat,
        thermal: {
          k: mat.k, Tref: 25,
          fixedTemperatures: [
            ...hotBase.map(n => ({ node: n, value: 90 })),
            ...coldLip.map(n => ({ node: n, value: 25 })),
          ],
        },
        structural: { fixedNodes: fixedMech, mechanicalLoads: [] },
      });

      const { mesh: stressMesh, stats } = buildTetSurfaceColoredMesh(mesh, r.nodalVonMises);
      const scene = window.__three_scene;
      const renderer = window.__three_renderer;
      const toRemove = [];
      scene.traverse(o => { if (o !== scene && !o.isLight && !o.isCamera) toRemove.push(o); });
      for (const o of toRemove) o.parent?.remove(o);
      scene.add(stressMesh);
      const box = new THREE.Box3().setFromObject(stressMesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const lightsToRemove = [];
      scene.traverse(o => { if (o.isLight && !o.userData?.studio) lightsToRemove.push(o); });
      for (const l of lightsToRemove) scene.remove(l);
      StudioLighting.apply(scene, { THREE, targetCenter: center, targetSize: size.length(), intensity: 1.6 });
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;

      return {
        bbox: { center: center.toArray(), size: size.toArray() },
        meshStats: mesh.stats(),
        maxDispMm: r.maxDisplacement,
        maxVonMisesMPa: r.maxStress,
        Trange: { min: Math.min(...r.temperature), max: Math.max(...r.temperature) },
        safetyFactor: r.safetyFactor,
        stressFieldRange: stats,
      };
    }, ALUM);

    console.log(`\n=== BRACKET THERMOMECH ===`);
    console.log(`Mesh: ${result.meshStats.tetCount} tets`);
    console.log(`T range: ${result.Trange.min.toFixed(1)}—${result.Trange.max.toFixed(1)} °C`);
    console.log(`Max displacement: ${result.maxDispMm.toFixed(4)} mm`);
    console.log(`Max von Mises: ${result.maxVonMisesMPa.toFixed(2)} MPa`);
    console.log(`Safety factor: ${result.safetyFactor.toFixed(1)}`);

    fs.writeFileSync(path.join(ROOT, 'bracket-thermomech.json'), JSON.stringify(result, null, 2));

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
    await renderView('thermomech-bracket-01-iso',  [c[0] + dist * 0.7, c[1] + dist * 0.4, c[2] + dist * 0.6], 32, 'iso');
    await renderView('thermomech-bracket-02-side', [c[0] + dist, c[1] + dist * 0.05, c[2]], 30, 'side');

    expect(result.maxVonMisesMPa).toBeGreaterThan(0);
  });
});
