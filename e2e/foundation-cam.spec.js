import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'cam');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('CAM toolpath: drilled plate + bracket → real G-code', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const out = await page.evaluate(async () => {
    const { generateCAMFromFeatures, drillCycle, contourMill, programWrap }
      = await import('/src/foundation/CAMToolpath.js');
    const { recognize } = await import('/src/foundation/FeatureRecognition.js');
    const { getManifold } = await import('/src/foundation/manifoldKernel.js');
    const { Sketch2D } = await import('/src/foundation/Sketch2D.js');
    const { buildCrossSection } = await import('/src/foundation/Profile.js');
    const { extrude, subtract } = await import('/src/foundation/Features.js');
    const { buildPhoneStandBracket } = await import('/src/foundation/parts/PhoneStandBracket.js');

    const { Manifold } = await getManifold();

    // Test 1: simple plate 100×60×6 mm with 4 × Ø5 through-holes
    const sP = new Sketch2D();
    const a = sP.addPoint(0, 0, true);
    const b = sP.addPoint(100, 0);
    const c = sP.addPoint(100, 60);
    const d = sP.addPoint(0, 60);
    const profile = await buildCrossSection([[
      sP.addLine(a, b), sP.addLine(b, c),
      sP.addLine(c, d), sP.addLine(d, a),
    ]]);
    let plate = await extrude(profile, 6);
    const drill = Manifold.cylinder(8, 2.5, 2.5, 32, false).translate([0, 0, -1]);
    for (const [hx, hy] of [[15, 15], [85, 15], [85, 45], [15, 45]]) {
      plate = await subtract(plate, drill.translate([hx, hy, 0]));
    }
    const plateRecognition = recognize(plate);
    const plateBbox = plate.boundingBox();
    const plateCAM = generateCAMFromFeatures({
      recognition: plateRecognition,
      bbox: plateBbox,
      opts: { partName: 'Drilled-plate test' },
    });

    // Test 2: phone-stand bracket — feature recognition has 4 cylindrical patches
    const bracket = await buildPhoneStandBracket();
    const bracketRecognition = recognize(bracket);
    const bracketBbox = bracket.boundingBox();
    const bracketCAM = generateCAMFromFeatures({
      recognition: bracketRecognition,
      bbox: bracketBbox,
      opts: { partName: 'Phone-stand bracket' },
    });

    return {
      plate: {
        recognition: { cylinders: plateRecognition.summary.cylinders.map(c => c.diameter) },
        cam: plateCAM,
        bbox: plateBbox,
      },
      bracket: {
        recognition: { cylinders: bracketRecognition.summary.cylinders.map(c => c.diameter) },
        cam: bracketCAM,
        bbox: bracketBbox,
      },
    };
  });

  console.log(`\n=== CAM TOOLPATH ===`);
  console.log(`Plate 100×60×6 with 4 × Ø5 holes:`);
  console.log(`  recognized cyls: ${out.plate.recognition.cylinders.map(d => d.toFixed(2)).join(' Ø ')}`);
  console.log(`  drill ops:       ${out.plate.cam.stats.drillCycleCount}`);
  console.log(`  contour passes:  ${out.plate.cam.stats.contourPassCount}`);
  console.log(`  G-code lines:    ${out.plate.cam.stats.lines}`);
  console.log(``);
  console.log(`Bracket:`);
  console.log(`  recognized cyls: ${out.bracket.recognition.cylinders.map(d => d.toFixed(2)).join(' Ø ')}`);
  console.log(`  drill ops:       ${out.bracket.cam.stats.drillCycleCount}`);
  console.log(`  contour passes:  ${out.bracket.cam.stats.contourPassCount}`);
  console.log(`  G-code lines:    ${out.bracket.cam.stats.lines}`);

  fs.writeFileSync(path.join(ROOT, 'plate.gcode'), out.plate.cam.gcode);
  fs.writeFileSync(path.join(ROOT, 'bracket.gcode'), out.bracket.cam.gcode);
  fs.writeFileSync(path.join(ROOT, 'cam-summary.json'), JSON.stringify({
    plate: {
      recognized_cylinders: out.plate.recognition.cylinders,
      holes: out.plate.cam.holes,
      stats: out.plate.cam.stats,
    },
    bracket: {
      recognized_cylinders: out.bracket.recognition.cylinders,
      holes: out.bracket.cam.holes,
      stats: out.bracket.cam.stats,
    },
  }, null, 2));

  // Validation: plate should yield exactly 4 drill cycles
  expect(out.plate.cam.stats.drillCycleCount).toBe(4);
  // Bracket: 4 holes were designed
  expect(out.bracket.cam.stats.drillCycleCount).toBeGreaterThanOrEqual(4);
  // Plate G-code must contain G81 cycle commands
  expect(out.plate.cam.gcode.includes('G81') || out.plate.cam.gcode.includes('G83')).toBe(true);
  // Plate G-code must contain G54 (WCS), M3 (spindle on), M30 (program end)
  expect(out.plate.cam.gcode).toMatch(/G54/);
  expect(out.plate.cam.gcode).toMatch(/M3/);
  expect(out.plate.cam.gcode).toMatch(/M30/);
});
