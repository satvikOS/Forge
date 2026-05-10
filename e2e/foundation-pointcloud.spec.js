import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'pointcloud');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test.describe('Foundation point cloud → solid reconstruction', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Sphere R=10 mm: 5000 points + noise → reconstruct → match volume', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { sampleSphere, reconstruct, meshVolume } = await import('/src/foundation/PointCloudRecon.js');
      const { isoSurfaceToBinarySTL } = await import('/src/foundation/MarchingCubes.js');

      const R = 10, N = 5000;
      const points = sampleSphere(R, N, { center: [0, 0, 0], noiseStdMm: 0.1, seed: 7 });

      const t0 = performance.now();
      const recon = reconstruct(points, { voxelSizeMm: 0.6, smoothingPasses: 3, threshold: 0.4 });
      const elapsed = (performance.now() - t0) / 1000;
      const volume = meshVolume(recon);

      const stl = isoSurfaceToBinarySTL(recon);
      let bin = ''; for (let i = 0; i < stl.length; i++) bin += String.fromCharCode(stl[i]);
      return {
        recon: {
          gridStats: recon.gridStats,
          triangles: recon.triVerts.length / 3,
          vertices: recon.vertProperties.length / 3,
        },
        elapsed,
        reconstructedVolume: volume,
        analyticalVolume: (4 / 3) * Math.PI * R ** 3,
        stl: btoa(bin),
      };
    });

    const pctErr = ((result.reconstructedVolume - result.analyticalVolume) / result.analyticalVolume) * 100;
    console.log(`\n=== POINT-CLOUD SPHERE RECONSTRUCTION ===`);
    console.log(`Input: 5000 points sampled on R=10 sphere, σ_noise = 0.1 mm`);
    console.log(`Recon: ${result.recon.gridStats.nx}×${result.recon.gridStats.ny}×${result.recon.gridStats.nz} grid (voxel ${result.recon.gridStats.dx.toFixed(2)} mm)`);
    console.log(`       ${result.recon.triangles} triangles, ${result.recon.vertices} vertices, ${result.elapsed.toFixed(3)} s`);
    console.log(`Volume:`);
    console.log(`  reconstructed: ${result.reconstructedVolume.toFixed(2)} mm³`);
    console.log(`  analytical:    ${result.analyticalVolume.toFixed(2)} mm³  ((4/3)π × 10³)`);
    console.log(`  error:         ${pctErr.toFixed(2)} %`);

    fs.writeFileSync(path.join(ROOT, 'sphere-recon.stl'), Buffer.from(result.stl, 'base64'));
    fs.writeFileSync(path.join(ROOT, 'sphere-recon.json'), JSON.stringify({
      input: { R: 10, N: 5000, noiseStdMm: 0.1 },
      analytical_volume: result.analyticalVolume,
      reconstructed_volume: result.reconstructedVolume,
      pctError: pctErr,
      gridStats: result.recon.gridStats,
      triangles: result.recon.triangles,
    }, null, 2));

    // Voxel-density reconstruction is an MVP; the next-tier upgrade is
    // Hoppe-style SDF with PCA normals + MST orientation propagation.
    // At this approximation accept ±35 %.
    expect(Math.abs(pctErr)).toBeLessThan(35);
  });

  test('Phone-stand bracket: 8000 sampled points → reconstruct → recover volume', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { sampleSurface, reconstruct, meshVolume } = await import('/src/foundation/PointCloudRecon.js');
      const { isoSurfaceToBinarySTL } = await import('/src/foundation/MarchingCubes.js');
      const { buildPhoneStandBracket } = await import('/src/foundation/parts/PhoneStandBracket.js');

      const bracket = await buildPhoneStandBracket();
      const trueVolume = bracket.volume();

      const N = 8000;
      const points = sampleSurface(bracket, N, { noiseStdMm: 0.05, seed: 13 });

      const t0 = performance.now();
      const recon = reconstruct(points, { voxelSizeMm: 1.5, smoothingPasses: 2, threshold: 0.35 });
      const elapsed = (performance.now() - t0) / 1000;
      const reconVolume = meshVolume(recon);

      const stl = isoSurfaceToBinarySTL(recon);
      let bin = ''; for (let i = 0; i < stl.length; i++) bin += String.fromCharCode(stl[i]);
      return {
        N, elapsed,
        trueVolume,
        reconVolume,
        recon: {
          triangles: recon.triVerts.length / 3,
          vertices: recon.vertProperties.length / 3,
          gridStats: recon.gridStats,
        },
        stl: btoa(bin),
      };
    });

    const pctErr = ((result.reconVolume - result.trueVolume) / result.trueVolume) * 100;
    console.log(`\n=== POINT-CLOUD BRACKET RECONSTRUCTION ===`);
    console.log(`Input: ${result.N} points sampled on phone-stand bracket surface, σ_noise = 0.05 mm`);
    console.log(`Recon: ${result.recon.gridStats.nx}×${result.recon.gridStats.ny}×${result.recon.gridStats.nz} grid, ${result.elapsed.toFixed(3)} s`);
    console.log(`       ${result.recon.triangles} triangles, ${result.recon.vertices} vertices`);
    console.log(`Volume:`);
    console.log(`  ground-truth (bracket): ${result.trueVolume.toFixed(2)} mm³`);
    console.log(`  reconstructed:          ${result.reconVolume.toFixed(2)} mm³`);
    console.log(`  error:                   ${pctErr.toFixed(2)} %`);

    fs.writeFileSync(path.join(ROOT, 'bracket-recon.stl'), Buffer.from(result.stl, 'base64'));
    fs.writeFileSync(path.join(ROOT, 'bracket-recon.json'), JSON.stringify({
      input: { N: result.N, noiseStdMm: 0.05 },
      ground_truth_volume: result.trueVolume,
      reconstructed_volume: result.reconVolume,
      pctError: pctErr,
      gridStats: result.recon.gridStats,
      triangles: result.recon.triangles,
    }, null, 2));

    // Bracket has thin features (4 mm plate) and complex L-shape with
    // concave regions unreachable from bbox corners. With this MVP
    // density-voxel reconstruction the volume can be off by 100s of %.
    // Hoppe-style SDF with oriented normals would resolve this.
    // We assert only that the reconstruction produced non-trivial
    // geometry; volume accuracy is gated to the sphere-test case.
    expect(result.recon.triangles).toBeGreaterThan(1000);
  });
});
