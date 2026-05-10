import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'sweep-loft');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test.describe('Sweep + Loft features (M43 — closing CAD parity gap)', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Sweep circle along straight path = cylinder, V = π R² h', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { sweep, circleProfile } = await import('/src/foundation/SweepLoft.js');
      const R = 2;     // mm
      const H = 50;    // mm
      const profile = circleProfile(R, 64);
      const path = [[0, 0, 0], [0, 0, H]];   // straight up Z
      const m = await sweep({ profile2D: profile, path, samples: 16 });
      const v = m.volume();
      const bbox = m.boundingBox();
      const isMan = m.isEmpty() ? false : true;
      return { volume: v, bbox, isManifold: isMan };
    });

    const Vtheory = Math.PI * 4 * 50;        // πR²H = 628.32
    const err = (result.volume - Vtheory) / Vtheory * 100;
    console.log(`\n=== SWEEP CIRCLE → CYLINDER ===`);
    console.log(`V = ${result.volume.toFixed(2)} mm³  vs analytical ${Vtheory.toFixed(2)} mm³  (err ${err.toFixed(3)}%)`);
    console.log(`bbox: [${result.bbox.min.map(x => x.toFixed(2))}] → [${result.bbox.max.map(x => x.toFixed(2))}]`);

    fs.writeFileSync(path.join(ROOT, 'sweep-cylinder.json'), JSON.stringify({
      volume: result.volume, analytical: Vtheory, errorPct: err, bbox: result.bbox,
    }, null, 2));

    // Sweep using a 64-segment polygonal profile under-estimates true
    // π by the polygonal-circle error (~ 0.13% for 64 sides), well
    // within 1% tolerance.
    expect(Math.abs(err)).toBeLessThan(1);
    expect(result.bbox.min[2]).toBeCloseTo(0, 4);
    expect(result.bbox.max[2]).toBeCloseTo(50, 4);
  });

  test('Sweep along NURBS quarter-arc → torus-quadrant, V = π²Rr²/2', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { sweep, circleProfile } = await import('/src/foundation/SweepLoft.js');
      const { NURBSCurve } = await import('/src/foundation/NURBSCurve.js');
      const R = 10;   // path radius
      const r = 1;    // tube radius
      const arc = NURBSCurve.quarterCircle(R);
      const profile = circleProfile(r, 96);
      const m = await sweep({ profile2D: profile, path: arc, samples: 64, referenceUp: [0, 0, 1] });
      const v = m.volume();
      const bbox = m.boundingBox();
      return { volume: v, bbox };
    });

    // Full torus volume = 2 π² R r²; quadrant = π² R r² / 2
    const Vtheory = Math.PI * Math.PI * 10 * 1 * 1 / 2;
    const err = (result.volume - Vtheory) / Vtheory * 100;
    console.log(`\n=== SWEEP CIRCLE ALONG QUARTER-ARC → TORUS QUADRANT ===`);
    console.log(`V = ${result.volume.toFixed(4)} mm³  vs analytical π²Rr²/2 = ${Vtheory.toFixed(4)} mm³  (err ${err.toFixed(3)}%)`);

    fs.writeFileSync(path.join(ROOT, 'sweep-torus-quadrant.json'), JSON.stringify({
      volume: result.volume, analytical: Vtheory, errorPct: err,
    }, null, 2));

    // Polygonal profile + path discretization → typically 1-2% under
    expect(Math.abs(err)).toBeLessThan(3);
  });

  test('Loft of 4 circles = truncated cone', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { loft, circleProfile } = await import('/src/foundation/SweepLoft.js');
      // Truncated cone: r = 5 → 1 over height H = 30 mm, 4 stations
      const heights = [0, 10, 20, 30];
      const radii = [5, 4, 2, 1];
      const profiles = heights.map((z, i) => ({
        points2D: circleProfile(radii[i], 96),
        origin: [0, 0, z],
        normal: [0, 0, 1],
        up: [1, 0, 0],
      }));
      const m = await loft({ profiles, tweenSegments: 0 });
      const v = m.volume();
      const bbox = m.boundingBox();
      return { volume: v, bbox };
    });

    // Truncated cone volume V = π h (R₁² + R₁ R₂ + R₂²) / 3
    // We have 3 frusta (5→4, 4→2, 2→1), each h = 10
    const frustum = (h, r1, r2) => Math.PI * h * (r1 ** 2 + r1 * r2 + r2 ** 2) / 3;
    const Vtheory = frustum(10, 5, 4) + frustum(10, 4, 2) + frustum(10, 2, 1);
    const err = (result.volume - Vtheory) / Vtheory * 100;

    console.log(`\n=== LOFT OF 4 CIRCLES → STACKED FRUSTUM ===`);
    console.log(`V = ${result.volume.toFixed(2)} mm³  vs analytical ${Vtheory.toFixed(2)} mm³  (err ${err.toFixed(3)}%)`);
    console.log(`bbox: z [${result.bbox.min[2].toFixed(2)}, ${result.bbox.max[2].toFixed(2)}]`);

    fs.writeFileSync(path.join(ROOT, 'loft-frustum.json'), JSON.stringify({
      volume: result.volume, analytical: Vtheory, errorPct: err, bbox: result.bbox,
    }, null, 2));

    expect(Math.abs(err)).toBeLessThan(1);
    expect(result.bbox.min[2]).toBeCloseTo(0, 4);
    expect(result.bbox.max[2]).toBeCloseTo(30, 4);
  });

  test('Loft circle → square: produces valid manifold (boolean-able)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { loft, circleProfile, squareProfile, resampleProfile } = await import('/src/foundation/SweepLoft.js');
      const M = 64;   // shared point count
      const profiles = [
        {
          points2D: circleProfile(5, M),
          origin: [0, 0, 0], normal: [0, 0, 1], up: [1, 0, 0],
        },
        {
          points2D: resampleProfile(squareProfile(8), M),
          origin: [0, 0, 20], normal: [0, 0, 1], up: [1, 0, 0],
        },
      ];
      const m = await loft({ profiles, tweenSegments: 4 });
      const v = m.volume();
      const bbox = m.boundingBox();
      // Test booleanability: subtract a small box at the top — should not throw
      const { getManifold } = await import('/src/foundation/manifoldKernel.js');
      const Mod = await getManifold();
      const cutter = Mod.Manifold.cube([3, 3, 3], true).translate([0, 0, 19]);
      const sub = m.subtract(cutter);
      const subV = sub.volume();
      return { volume: v, bbox, subVolume: subV };
    });

    console.log(`\n=== LOFT CIRCLE → SQUARE (transition shape) ===`);
    console.log(`V = ${result.volume.toFixed(2)} mm³`);
    console.log(`After subtracting Ø3 mm cube at top: V = ${result.subVolume.toFixed(2)} mm³`);
    console.log(`bbox: [${result.bbox.min.map(x => x.toFixed(2))}] → [${result.bbox.max.map(x => x.toFixed(2))}]`);

    fs.writeFileSync(path.join(ROOT, 'loft-circle-to-square.json'), JSON.stringify({
      volume: result.volume, subtractedVolume: result.subVolume, bbox: result.bbox,
    }, null, 2));

    // Circle and square start at different angular positions (no point
    // alignment), so the loft is a twisted transition — analytical
    // volume is not well-defined. Validate (a) it's a non-degenerate
    // closed manifold (positive volume, height span correct) and
    // (b) booleans operate cleanly.
    expect(result.volume).toBeGreaterThan(300);
    expect(result.volume).toBeLessThan(2000);
    expect(result.bbox.min[2]).toBeCloseTo(0, 4);
    expect(result.bbox.max[2]).toBeCloseTo(20, 4);
    // Boolean must succeed and shrink the body
    expect(result.subVolume).toBeLessThan(result.volume);
  });
});
