import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'slicer');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('Slicer: cube + bracket → layers + G-code', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const out = await page.evaluate(async () => {
    const { sliceManifold, renderLayersSVG, generateGCode, estimatePrint }
      = await import('/src/foundation/Slicer.js');
    const { getManifold } = await import('/src/foundation/manifoldKernel.js');
    const { buildPhoneStandBracket } = await import('/src/foundation/parts/PhoneStandBracket.js');

    const { Manifold } = await getManifold();

    // Test 1: 20×20×10 mm cube — exactly 50 layers at 0.2 mm
    const cube = Manifold.cube([20, 20, 10], false);
    const cubeLayers = sliceManifold(cube, { layerHeight: 0.2 });
    const cubeGCode = generateGCode(cubeLayers, { layerHeightMm: 0.2 });
    const cubeStats = estimatePrint(cubeGCode);
    const cubeSVG = renderLayersSVG(cubeLayers, { layerStride: 5 });

    // Test 2: phone-stand bracket
    const bracket = await buildPhoneStandBracket();
    const bracketLayers = sliceManifold(bracket, { layerHeight: 0.2 });
    const bracketGCode = generateGCode(bracketLayers, { layerHeightMm: 0.2 });
    const bracketStats = estimatePrint(bracketGCode);
    const bracketSVG = renderLayersSVG(bracketLayers, { layerStride: 5 });

    // Per-layer count: cube should have one closed polygon per layer, square 80 mm perimeter
    let cubePerimAvg = 0, cubeCount = 0;
    for (const L of cubeLayers) {
      for (const p of L.polygons) {
        let perim = 0;
        for (let i = 0; i < p.points.length; i++) {
          const a = p.points[i], b = p.points[(i + 1) % p.points.length];
          perim += Math.hypot(a[0] - b[0], a[1] - b[1]);
        }
        cubePerimAvg += perim;
        cubeCount++;
      }
    }
    cubePerimAvg /= Math.max(cubeCount, 1);

    return {
      cube: {
        layers: cubeLayers.length,
        perimeterMmAvg: cubePerimAvg,
        gcodeLines: cubeGCode.split('\n').length,
        gcode: cubeGCode,
        svg: cubeSVG,
        printStats: cubeStats,
      },
      bracket: {
        layers: bracketLayers.length,
        gcodeLines: bracketGCode.split('\n').length,
        svg: bracketSVG,
        gcode: bracketGCode,
        printStats: bracketStats,
      },
    };
  });

  console.log(`\n=== SLICER ===`);
  console.log(`Cube 20×20×10 (layer 0.2 mm):`);
  console.log(`  layers:           ${out.cube.layers}  (expected 50)`);
  console.log(`  avg perimeter:    ${out.cube.perimeterMmAvg.toFixed(2)} mm  (expected 80)`);
  console.log(`  G-code lines:     ${out.cube.gcodeLines}`);
  console.log(`  filament:         ${out.cube.printStats.filamentMm.toFixed(1)} mm`);
  console.log(`  print time:       ${out.cube.printStats.printTimeMin.toFixed(1)} min`);
  console.log(`Phone bracket:`);
  console.log(`  layers:           ${out.bracket.layers}`);
  console.log(`  G-code lines:     ${out.bracket.gcodeLines}`);
  console.log(`  filament:         ${out.bracket.printStats.filamentMm.toFixed(1)} mm`);
  console.log(`  print time:       ${out.bracket.printStats.printTimeMin.toFixed(1)} min`);

  fs.writeFileSync(path.join(ROOT, 'cube-layers.svg'), out.cube.svg);
  fs.writeFileSync(path.join(ROOT, 'cube.gcode'), out.cube.gcode);
  fs.writeFileSync(path.join(ROOT, 'bracket-layers.svg'), out.bracket.svg);
  fs.writeFileSync(path.join(ROOT, 'bracket.gcode'), out.bracket.gcode);
  fs.writeFileSync(path.join(ROOT, 'slicer-summary.json'), JSON.stringify({
    cube: {
      layers: out.cube.layers,
      perimeterMmAvg: out.cube.perimeterMmAvg,
      gcodeLines: out.cube.gcodeLines,
      printStats: out.cube.printStats,
    },
    bracket: {
      layers: out.bracket.layers,
      gcodeLines: out.bracket.gcodeLines,
      printStats: out.bracket.printStats,
    },
  }, null, 2));

  // Cube validation
  expect(out.cube.layers).toBeGreaterThanOrEqual(48);
  expect(out.cube.layers).toBeLessThanOrEqual(52);
  expect(Math.abs(out.cube.perimeterMmAvg - 80)).toBeLessThan(0.5);
  // Bracket validation
  expect(out.bracket.layers).toBeGreaterThan(50);
  expect(out.bracket.printStats.filamentMm).toBeGreaterThan(0);
});
