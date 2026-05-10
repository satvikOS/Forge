import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'patterns');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test.describe('Pattern features (M44 — linear / circular / mirror)', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Linear pattern: 5 cubes spaced 20 mm apart along X', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { getManifold } = await import('/src/foundation/manifoldKernel.js');
      const { linearPattern } = await import('/src/foundation/PatternFeatures.js');
      const Mod = await getManifold();
      const seed = Mod.Manifold.cube([10, 10, 10], true);   // centered 10×10×10 cube
      const arr = await linearPattern(seed, [1, 0, 0], 5, 20);
      const v = arr.volume();
      const bb = arr.boundingBox();
      return { volume: v, bbox: bb };
    });

    // 5 disjoint 10³ cubes = 5000 mm³
    const Vexpected = 5 * 1000;
    const err = (result.volume - Vexpected) / Vexpected * 100;
    console.log(`\n=== LINEAR PATTERN — 5 cubes × 10³ along X ===`);
    console.log(`V = ${result.volume.toFixed(2)} mm³  vs expected ${Vexpected}  (err ${err.toFixed(3)}%)`);
    console.log(`bbox: [${result.bbox.min.map(x => x.toFixed(2))}] → [${result.bbox.max.map(x => x.toFixed(2))}]`);

    fs.writeFileSync(path.join(ROOT, 'linear-pattern.json'), JSON.stringify({
      volume: result.volume, expected: Vexpected, errorPct: err, bbox: result.bbox,
    }, null, 2));

    expect(Math.abs(err)).toBeLessThan(0.001);
    // First cube spans [-5, +5] in X. Fifth cube center is at 4·20=80, so spans [75, 85].
    expect(result.bbox.min[0]).toBeCloseTo(-5, 4);
    expect(result.bbox.max[0]).toBeCloseTo(85, 4);
  });

  test('Linear pattern 2D: 4 × 3 grid of small cylinders (bolt-hole grid)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { getManifold } = await import('/src/foundation/manifoldKernel.js');
      const { linearPattern2D } = await import('/src/foundation/PatternFeatures.js');
      const Mod = await getManifold();
      const cyl = Mod.Manifold.cylinder(15, 3, 3, 64, true);
      // Place a 4 × 3 grid spaced 25 mm × 20 mm
      const arr = await linearPattern2D(cyl, [1, 0, 0], 4, 25, [0, 1, 0], 3, 20);
      return { volume: arr.volume(), bbox: arr.boundingBox() };
    });

    // π·3²·15 per cylinder, 12 cylinders, no overlap (25 > 6 spacing > diameter)
    const Vsingle = Math.PI * 9 * 15;
    const Vexp = 12 * Vsingle;
    const err = (result.volume - Vexp) / Vexp * 100;
    console.log(`\n=== LINEAR PATTERN 2D — 4 × 3 grid ===`);
    console.log(`V = ${result.volume.toFixed(2)} mm³  vs expected ${Vexp.toFixed(2)} mm³  (err ${err.toFixed(3)}%)`);
    console.log(`bbox: [${result.bbox.min.map(x => x.toFixed(2))}] → [${result.bbox.max.map(x => x.toFixed(2))}]`);

    fs.writeFileSync(path.join(ROOT, 'linear-2d-pattern.json'), JSON.stringify({
      volume: result.volume, expected: Vexp, errorPct: err, bbox: result.bbox,
    }, null, 2));

    expect(Math.abs(err)).toBeLessThan(1);  // polygonal cylinder ~0.16% under
    // Grid spans 25*3 + 6 = 81 in X, 20*2 + 6 = 46 in Y
    expect(result.bbox.max[0] - result.bbox.min[0]).toBeCloseTo(81, 0);
    expect(result.bbox.max[1] - result.bbox.min[1]).toBeCloseTo(46, 0);
  });

  test('Circular pattern: 6 fins at 60° spacing around Z (impeller)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { getManifold } = await import('/src/foundation/manifoldKernel.js');
      const { circularPattern } = await import('/src/foundation/PatternFeatures.js');
      const Mod = await getManifold();
      // A small fin: 2 × 6 × 10 mm box, offset along +X by 20 mm.
      // At 6-fold symmetry (60° spacing) and radius 20, adjacent fins are
      // ~21 mm apart center-to-center — the 6-mm-tangential width fits
      // comfortably with no overlap.
      const seed = Mod.Manifold.cube([2, 6, 10], true).translate([20, 0, 0]);
      const seedV = seed.volume();
      const arr = await circularPattern({
        body: seed, axis: [0, 0, 1], anchor: [0, 0, 0], count: 6,
      });
      return { single: seedV, total: arr.volume(), bbox: arr.boundingBox() };
    });

    // 6 disjoint copies (no overlap because each fin is offset 20 in radial direction)
    const Vexpected = 6 * result.single;
    const err = (result.total - Vexpected) / Vexpected * 100;
    console.log(`\n=== CIRCULAR PATTERN — 6 fins around Z ===`);
    console.log(`Single fin V = ${result.single.toFixed(2)} mm³`);
    console.log(`Total V = ${result.total.toFixed(2)} mm³  vs expected ${Vexpected.toFixed(2)} mm³  (err ${err.toFixed(3)}%)`);
    console.log(`bbox: [${result.bbox.min.map(x => x.toFixed(2))}] → [${result.bbox.max.map(x => x.toFixed(2))}]`);

    fs.writeFileSync(path.join(ROOT, 'circular-pattern.json'), JSON.stringify({
      singleVolume: result.single, totalVolume: result.total, expected: Vexpected, errorPct: err, bbox: result.bbox,
    }, null, 2));

    expect(Math.abs(err)).toBeLessThan(0.5);
    // 6-fold rotational symmetry of an anisotropic fin gives near-
    // (but not exactly) symmetric XY bbox; allow ±5 mm tolerance.
    const dx = result.bbox.max[0] - result.bbox.min[0];
    const dy = result.bbox.max[1] - result.bbox.min[1];
    expect(Math.abs(dx - dy)).toBeLessThan(5);
  });

  test('Mirror across XZ plane: doubles a half-body symmetric part', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { getManifold } = await import('/src/foundation/manifoldKernel.js');
      const { mirrorAndUnion } = await import('/src/foundation/PatternFeatures.js');
      const Mod = await getManifold();
      // Half-body: 20×10×10 cube positioned entirely in +Y half-space
      const half = Mod.Manifold.cube([20, 10, 10]).translate([0, 0, 0]);
      // mirror across the Y=0 plane (plane normal = [0, 1, 0])
      const sym = await mirrorAndUnion(half, [0, 1, 0], [0, 0, 0]);
      return { halfV: half.volume(), symV: sym.volume(), bbox: sym.boundingBox() };
    });

    const Vexpected = 2 * result.halfV;   // full body = double the half
    const err = (result.symV - Vexpected) / Vexpected * 100;
    console.log(`\n=== MIRROR + UNION — symmetric body construction ===`);
    console.log(`Half V = ${result.halfV.toFixed(2)} mm³`);
    console.log(`Mirrored full V = ${result.symV.toFixed(2)} mm³  vs expected ${Vexpected.toFixed(2)} mm³  (err ${err.toFixed(3)}%)`);
    console.log(`bbox: [${result.bbox.min.map(x => x.toFixed(2))}] → [${result.bbox.max.map(x => x.toFixed(2))}]`);

    fs.writeFileSync(path.join(ROOT, 'mirror-symmetric.json'), JSON.stringify({
      halfVolume: result.halfV, symmetricVolume: result.symV,
      expected: Vexpected, errorPct: err, bbox: result.bbox,
    }, null, 2));

    expect(Math.abs(err)).toBeLessThan(0.001);
    // Y span should be symmetric around 0
    expect(result.bbox.min[1]).toBeCloseTo(-10, 4);
    expect(result.bbox.max[1]).toBeCloseTo(10, 4);
  });
});
