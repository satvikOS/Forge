import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const SM_ROOT = path.join(REPO_ROOT, 'foundation-output', 'sheetmetal');
const TN_ROOT = path.join(REPO_ROOT, 'foundation-output', 'topological-naming');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test.describe('Foundation sheet-metal unfold + topological naming', () => {
  test.beforeAll(() => { ensure(SM_ROOT); ensure(TN_ROOT); });

  test('Sheet-metal U-bracket unfold: flat length matches Σ flats + Σ BAs', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { unfold, renderFlatPatternSVG, bendAllowance, bendDeduction } = await import('/src/foundation/SheetMetalUnfold.js');

      // Validation: textbook 90° bend, K = 0.4, r = 1.5, t = 1.5
      // BA = (π/2)(1.5 + 0.4 × 1.5) = (π/2)(2.1) = 3.299 mm
      const ba = bendAllowance(90, 1.5, 1.5, 0.4);
      const bd = bendDeduction(90, 1.5, 1.5, 0.4);

      // U-bracket: 2 flanges (25 mm) + center (50 mm) + 2 × 90° bends
      // Material: 1.5 mm aluminum 5052-H32, K = 0.4 (medium bend)
      const uBracket = {
        thickness: 1.5,
        defaultK: 0.4,
        segments: [
          { type: 'flat', length: 25, width: 30 },
          { type: 'bend', angle_deg: 90, radius_mm: 1.5 },
          { type: 'flat', length: 50, width: 30 },
          { type: 'bend', angle_deg: 90, radius_mm: 1.5 },
          { type: 'flat', length: 25, width: 30 },
        ],
      };
      const flat = unfold(uBracket);
      const svg = renderFlatPatternSVG(flat, { title: 'U-Bracket (1.5 mm Al 5052-H32)' });

      // Five-bend stair-step part for stress-test:
      // 5 bends at varying angles
      const stairStep = {
        thickness: 2.0, defaultK: 0.4,
        segments: [
          { type: 'flat', length: 20, width: 40 },
          { type: 'bend', angle_deg: 90, radius_mm: 2 },
          { type: 'flat', length: 15, width: 40 },
          { type: 'bend', angle_deg: 60, radius_mm: 2 },
          { type: 'flat', length: 25, width: 40 },
          { type: 'bend', angle_deg: 120, radius_mm: 3 },
          { type: 'flat', length: 20, width: 40 },
          { type: 'bend', angle_deg: 45, radius_mm: 1.5 },
          { type: 'flat', length: 30, width: 40 },
        ],
      };
      const flatStair = unfold(stairStep);
      const svgStair = renderFlatPatternSVG(flatStair, { title: 'Stair-Step Bracket (2 mm steel)' });

      return {
        validation: { ba, bd },
        uBracket: { spec: uBracket, flat, svg },
        stairStep: { spec: stairStep, flat: flatStair, svg: svgStair },
      };
    });

    // Save SVGs + JSON
    fs.writeFileSync(path.join(SM_ROOT, 'u-bracket-flat.svg'), result.uBracket.svg);
    fs.writeFileSync(path.join(SM_ROOT, 'u-bracket-flat.json'), JSON.stringify(result.uBracket.flat, null, 2));
    fs.writeFileSync(path.join(SM_ROOT, 'stair-step-flat.svg'), result.stairStep.svg);
    fs.writeFileSync(path.join(SM_ROOT, 'stair-step-flat.json'), JSON.stringify(result.stairStep.flat, null, 2));

    console.log(`\n=== SHEET METAL UNFOLD ===`);
    console.log(`90° bend, r=1.5, t=1.5, K=0.4:`);
    console.log(`  BA  = ${result.validation.ba.toFixed(4)} mm  (analytical = ${(Math.PI/2 * 2.1).toFixed(4)})`);
    console.log(`  BD  = ${result.validation.bd.toFixed(4)} mm`);
    console.log(``);
    console.log(`U-bracket (25+50+25 mm flanges, 2 × 90° bends, t=1.5, K=0.4):`);
    console.log(`  Total developed length: ${result.uBracket.flat.totalDevelopedLengthMm.toFixed(2)} mm`);
    console.log(`  = 100 mm flat + 2 × ${result.validation.ba.toFixed(4)} mm BA = ${(100 + 2 * result.validation.ba).toFixed(4)}`);
    console.log(``);
    console.log(`Stair-step (5 bends, t=2):`);
    console.log(`  Total developed length: ${result.stairStep.flat.totalDevelopedLengthMm.toFixed(2)} mm`);

    // Validation: BA = (π/2)(2.1) = 3.299
    expect(Math.abs(result.validation.ba - Math.PI / 2 * 2.1)).toBeLessThan(1e-9);
    // U-bracket total = 100 + 2 × 3.299 ≈ 106.60
    const uExpected = 100 + 2 * (Math.PI / 2 * 2.1);
    expect(Math.abs(result.uBracket.flat.totalDevelopedLengthMm - uExpected)).toBeLessThan(1e-6);
    expect(result.stairStep.flat.totalDevelopedLengthMm).toBeGreaterThan(110);
  });

  test('Topological naming: face survives subtract operations', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { namedCube, namedCylinder, namedSubtract, namedTranslate }
        = await import('/src/foundation/TopologicalNaming.js');

      // Build a 50 × 30 × 10 block, named "block"
      const block = await namedCube('block', [50, 30, 10], false);
      // 4 corner Ø4 holes, each named individually
      const drillSize = 2;   // radius
      let solid = block;
      const holeNames = [];
      const holePositions = [[8, 8], [42, 8], [42, 22], [8, 22]];
      for (let i = 0; i < holePositions.length; i++) {
        const [x, y] = holePositions[i];
        const holeName = `hole-${i + 1}`;
        const c = await namedCylinder(holeName, 12, drillSize, 32, true);
        const placed = namedTranslate(c, [x, y, 5]);
        solid = await namedSubtract(solid, placed);
        holeNames.push(holeName);
      }

      // Inspect: every named feature should still resolve
      const inspection = solid.inspect();
      // For each hole, get details
      const resolutions = {};
      resolutions['block'] = solid.resolve('block');
      for (const h of holeNames) resolutions[h] = solid.resolve(h);

      return {
        nameTable: Array.from(solid.nameTable.entries()),
        inspection,
        resolutions: Object.fromEntries(Object.entries(resolutions).map(([k, v]) =>
          [k, v ? { triangleCount: v.triangleCount, originalID: v.originalID } : null])),
        finalManifold: {
          triangles: solid.manifold.numTri(),
          volume: solid.manifold.volume(),
          genus: solid.manifold.genus(),
        },
      };
    });

    console.log(`\n=== TOPOLOGICAL NAMING ===`);
    console.log(`Final manifold: ${result.finalManifold.triangles} tri, V=${result.finalManifold.volume.toFixed(1)}, genus=${result.finalManifold.genus}`);
    console.log(`Name table:`);
    for (const [name, id] of result.nameTable) {
      const res = result.resolutions[name];
      console.log(`  ${name.padEnd(10)} originalID=${id}, ${res ? res.triangleCount + ' triangles' : 'NOT FOUND'}`);
    }

    fs.writeFileSync(path.join(TN_ROOT, 'naming-test.json'), JSON.stringify(result, null, 2));

    // Block face provenance must survive 4 subtract operations.
    expect(result.resolutions['block']).not.toBeNull();
    expect(result.resolutions['block'].triangleCount).toBeGreaterThan(0);
    // Each hole's cylindrical surface must also survive.
    expect(result.resolutions['hole-1']).not.toBeNull();
    expect(result.resolutions['hole-2']).not.toBeNull();
    expect(result.resolutions['hole-3']).not.toBeNull();
    expect(result.resolutions['hole-4']).not.toBeNull();
    // Volume = 50×30×10 - 4 × π × 2² × 10 = 15000 - 502.65 ≈ 14497
    expect(result.finalManifold.volume).toBeGreaterThan(14400);
    expect(result.finalManifold.volume).toBeLessThan(14600);
    expect(result.finalManifold.genus).toBe(4);   // 4 holes
  });
});
