import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(process.cwd(), 'foundation-output');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

/**
 * Foundation acceptance tests.
 *
 * These exercise the real sketch → profile → manifold-3d feature
 * pipeline + STL export + assembly mate solver. They prove the
 * foundation works end-to-end. If any test here fails, ArchDisc
 * cannot deliver its M2-M7 milestones.
 *
 * Output (STL files + reports) lands in ./foundation-output/ for
 * visual inspection / actual 3D printing.
 */
test.describe('Foundation kernel — real sketch+features+booleans+STL+mates', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Sketch2D solves a fully-constrained square', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { Sketch2D } = await import('/src/foundation/Sketch2D.js');
      const s = new Sketch2D();
      // 4 corners — initial values intentionally wrong so solver must work
      const A = s.addPoint(0, 0, true);          // fixed origin
      const B = s.addPoint(80, 5);               // should land at (50,0)
      const C = s.addPoint(60, 60);              // should land at (50,50)
      const D = s.addPoint(-3, 47);              // should land at (0, 50)
      const ab = s.addLine(A, B);
      const bc = s.addLine(B, C);
      const cd = s.addLine(C, D);
      const da = s.addLine(D, A);
      s.horizontal(ab);
      s.vertical(bc);
      s.horizontal(cd);
      s.vertical(da);
      s.distance(A, B, 50);
      s.distance(B, C, 50);
      const r = s.solve();
      return { result: r, A: A.toArray(), B: B.toArray(), C: C.toArray(), D: D.toArray() };
    });

    expect(result.result.converged).toBe(true);
    expect(result.A).toEqual([0, 0]);
    expect(Math.abs(result.B[0] - 50)).toBeLessThan(1e-6);
    expect(Math.abs(result.B[1])).toBeLessThan(1e-6);
    expect(Math.abs(result.C[0] - 50)).toBeLessThan(1e-6);
    expect(Math.abs(result.C[1] - 50)).toBeLessThan(1e-6);
    expect(Math.abs(result.D[0])).toBeLessThan(1e-6);
    expect(Math.abs(result.D[1] - 50)).toBeLessThan(1e-6);
  });

  test('Sketch2D solves perpendicular + tangent constraints', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { Sketch2D } = await import('/src/foundation/Sketch2D.js');
      const s = new Sketch2D();
      const O = s.addPoint(0, 0, true);
      const P1 = s.addPoint(10, 0);
      const P2 = s.addPoint(0, 10);
      const l1 = s.addLine(O, P1);
      const l2 = s.addLine(O, P2);
      s.perpendicular(l1, l2);
      s.distance(O, P1, 30);
      s.distance(O, P2, 40);
      s.horizontal(l1);
      const r = s.solve();
      return {
        result: r,
        l1: { p1: P1.toArray(), len: l1.length() },
        l2: { p2: P2.toArray(), len: l2.length() },
        dot: l1.dx() * l2.dx() + l1.dy() * l2.dy(),
      };
    });
    expect(result.result.converged).toBe(true);
    expect(Math.abs(result.l1.len - 30)).toBeLessThan(1e-6);
    expect(Math.abs(result.l2.len - 40)).toBeLessThan(1e-6);
    expect(Math.abs(result.dot)).toBeLessThan(1e-6); // perpendicular
  });

  test('Profile + Extrude: build a 50×30×10 mm plate, watertight, correct volume', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const { result, stl } = await page.evaluate(async () => {
      const { Sketch2D } = await import('/src/foundation/Sketch2D.js');
      const { buildCrossSection } = await import('/src/foundation/Profile.js');
      const { extrude } = await import('/src/foundation/Features.js');
      const { toBinarySTL, buildPrintReport } = await import('/src/foundation/STLExport.js');

      const s = new Sketch2D();
      const A = s.addPoint(0, 0, true);
      const B = s.addPoint(50, 0);
      const C = s.addPoint(50, 30);
      const D = s.addPoint(0, 30);
      const ab = s.addLine(A, B), bc = s.addLine(B, C), cd = s.addLine(C, D), da = s.addLine(D, A);
      const profile = await buildCrossSection([[ab, bc, cd, da]]);
      const m = await extrude(profile, 10);
      const report = buildPrintReport(m);
      const stlBytes = toBinarySTL(m);
      // Convert to base64 for transport
      let bin = '';
      for (let i = 0; i < stlBytes.length; i++) bin += String.fromCharCode(stlBytes[i]);
      return { result: report, stl: btoa(bin) };
    });

    expect(result.manifold).toBe(true);
    expect(result.triangles).toBeGreaterThan(0);
    // Expected volume: 50 * 30 * 10 = 15000 mm^3
    expect(Math.abs(result.volumeMm3 - 15000)).toBeLessThan(1);
    // Bounding box should match
    const bb = result.boundingBoxMm;
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(50, 4);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(30, 4);
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(10, 4);

    // Save STL
    const buf = Buffer.from(stl, 'base64');
    fs.writeFileSync(path.join(ROOT, 'plate-50x30x10.stl'), buf);
    fs.writeFileSync(path.join(ROOT, 'plate-50x30x10-report.json'), JSON.stringify(result, null, 2));
  });

  test('Subtract: bracket with 4 mounting holes', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const { result, stl } = await page.evaluate(async () => {
      const { Sketch2D } = await import('/src/foundation/Sketch2D.js');
      const { buildCrossSection } = await import('/src/foundation/Profile.js');
      const { extrude, subtract, translate } = await import('/src/foundation/Features.js');
      const { toBinarySTL, buildPrintReport } = await import('/src/foundation/STLExport.js');
      const { getManifold } = await import('/src/foundation/manifoldKernel.js');

      // Outer plate: 80 × 40 × 5 mm
      const sOuter = new Sketch2D();
      const A = sOuter.addPoint(0, 0, true);
      const B = sOuter.addPoint(80, 0);
      const C = sOuter.addPoint(80, 40);
      const D = sOuter.addPoint(0, 40);
      const profileOuter = await buildCrossSection([[
        sOuter.addLine(A, B), sOuter.addLine(B, C),
        sOuter.addLine(C, D), sOuter.addLine(D, A),
      ]]);
      let bracket = await extrude(profileOuter, 5);

      // 4 holes Ø6 mm at the corners 10 mm in
      const { Manifold } = await getManifold();
      // cylinder(height, radiusLow, radiusHigh, segments, center)
      const hole = Manifold.cylinder(8, 3, 3, 32, true).translate([0, 0, 4]);
      const positions = [[10, 10], [70, 10], [70, 30], [10, 30]];
      for (const [x, y] of positions) {
        bracket = await subtract(bracket, hole.translate([x, y, 0]));
      }

      const report = buildPrintReport(bracket);
      const stlBytes = toBinarySTL(bracket);
      let bin = ''; for (let i = 0; i < stlBytes.length; i++) bin += String.fromCharCode(stlBytes[i]);
      return { result: report, stl: btoa(bin) };
    });

    expect(result.manifold).toBe(true);
    // Volume = 80*40*5 - 4 * π*3² * 5 = 16000 - 565.5 ≈ 15434
    expect(result.volumeMm3).toBeGreaterThan(15300);
    expect(result.volumeMm3).toBeLessThan(15600);

    fs.writeFileSync(path.join(ROOT, 'bracket-4holes.stl'), Buffer.from(stl, 'base64'));
    fs.writeFileSync(path.join(ROOT, 'bracket-4holes-report.json'), JSON.stringify(result, null, 2));
  });

  test('100 sequential subtractions stay manifold', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { getManifold } = await import('/src/foundation/manifoldKernel.js');
      const { Manifold } = await getManifold();
      // Starting with a 100x100x10 box, subtract 100 little Ø3 holes in a 10x10 grid
      let body = Manifold.cube([100, 100, 10], false);
      // Drill goes from -1 to +11, fully through 0..10 box
      const drill = Manifold.cylinder(12, 1.5, 1.5, 16, true);
      let count = 0;
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 10; j++) {
          const x = 5 + i * 10, y = 5 + j * 10;
          body = Manifold.difference(body, drill.translate([x, y, 5]));
          count++;
        }
      }
      return {
        ops: count,
        triangles: body.numTri(),
        volume: body.volume(),
        surfaceArea: body.surfaceArea(),
        genus: body.genus(),
      };
    });

    expect(result.ops).toBe(100);
    expect(result.triangles).toBeGreaterThan(0);
    expect(result.genus).toBe(100); // 100 through-holes
    // Expected: 100*100*10 - 100 * (π * 1.5² * 10) = 100000 - 7068.6 ≈ 92931
    expect(result.volume).toBeGreaterThan(92500);
    expect(result.volume).toBeLessThan(93500);
  });

  test('Revolve: bottle silhouette → solid bottle, watertight', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { Sketch2D } = await import('/src/foundation/Sketch2D.js');
      const { buildCrossSection } = await import('/src/foundation/Profile.js');
      const { revolve } = await import('/src/foundation/Features.js');
      const { buildPrintReport } = await import('/src/foundation/STLExport.js');

      // Profile: half-cross-section of a bottle (in XZ plane via Sketch2D xy)
      // Note: manifold's revolve uses the y-axis as revolution axis; profile
      // is in xy plane with x ≥ 0. We mark it accordingly.
      const s = new Sketch2D();
      // Anti-clockwise outer profile, all x > 0 except the axis line
      const p1 = s.addPoint(0, 0, true);     // base, on axis
      const p2 = s.addPoint(30, 0, true);    // base outer
      const p3 = s.addPoint(30, 60, true);   // shoulder corner outer
      const p4 = s.addPoint(10, 80, true);   // neck outer
      const p5 = s.addPoint(10, 100, true);  // top outer
      const p6 = s.addPoint(0, 100, true);   // top, on axis
      const profile = await buildCrossSection([[
        s.addLine(p1, p2), s.addLine(p2, p3), s.addLine(p3, p4),
        s.addLine(p4, p5), s.addLine(p5, p6), s.addLine(p6, p1),
      ]]);
      const bottle = await revolve(profile, 360, { circularSegments: 64 });
      const report = buildPrintReport(bottle);
      return report;
    });

    expect(result.manifold).toBe(true);
    expect(result.triangles).toBeGreaterThan(0);
    // Body should have non-trivial volume
    expect(result.volumeMm3).toBeGreaterThan(50000);
  });

  test('Mate solver: concentric + coincident on two parts converges', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { Part } = await import('/src/foundation/Part.js');
      const { Assembly } = await import('/src/foundation/AssemblyMate.js');
      const { getManifold } = await import('/src/foundation/manifoldKernel.js');
      await getManifold();

      const block = new Part('block');
      block.transform.translation = [0, 0, 0];
      const bolt = new Part('bolt');
      bolt.transform.translation = [50, 50, 50];   // intentionally off
      bolt.transform.rotation = [10, 20, 30];

      const asm = new Assembly('test');
      asm.addPart(block);
      asm.addPart(bolt);
      asm.fix(block);
      // bolt's bottom face center coincides with block's hole center
      // bolt axis (local +Z) concentric with block hole axis (local +Z at origin)
      asm.concentric(
        block, { type: 'axis', origin: [10, 10, 0], dir: [0, 0, 1] },
        bolt,  { type: 'axis', origin: [0, 0, 0],   dir: [0, 0, 1] },
      );
      asm.coincident(
        block, { type: 'point', xyz: [10, 10, 0] },
        bolt,  { type: 'point', xyz: [0, 0, 0] },
      );
      const r = asm.solve();
      return {
        result: r,
        boltTrans: bolt.transform.translation,
        boltRot: bolt.transform.rotation,
      };
    });

    expect(result.result.converged).toBe(true);
    // Bolt should land at (10, 10, 0)
    expect(Math.abs(result.boltTrans[0] - 10)).toBeLessThan(1e-3);
    expect(Math.abs(result.boltTrans[1] - 10)).toBeLessThan(1e-3);
    expect(Math.abs(result.boltTrans[2] - 0)).toBeLessThan(1e-3);
  });

  test('Sketch over-constrained reports failure', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { Sketch2D } = await import('/src/foundation/Sketch2D.js');
      const s = new Sketch2D();
      const A = s.addPoint(0, 0, true);
      const B = s.addPoint(50, 0);
      s.distance(A, B, 50);
      s.distance(A, B, 60);   // contradictory
      s.horizontal(s.addLine(A, B));
      const r = s.solve();
      return r;
    });
    expect(result.converged).toBe(false);
    expect(['over-constrained', 'max-iterations', 'singular-jacobian']).toContain(result.status);
  });
});
