import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'sync-model');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test.describe('Direct / synchronous modelling MVP — Phase 6 of Parasolid parity', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Parametric box: push top face → height parameter changes', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { ParametricBox, inferEdit } = await import('/src/foundation/SyncModel.js');
      const box = new ParametricBox({ width: 50, depth: 30, height: 10 });
      const v0 = (await box.manifold()).volume();
      const initial = { ...box.params, volume: v0 };

      // (1) drag top face by +5 in z direction
      const edit1 = inferEdit(box, [0, 0, 1], [0, 0, 5]);
      const v1 = (await box.manifold()).volume();
      const afterTop = { ...box.params, volume: v1, edit: edit1 };

      // (2) push +x face by +10 in x direction
      const edit2 = inferEdit(box, [1, 0, 0], [10, 0, 0]);
      const v2 = (await box.manifold()).volume();
      const afterSide = { ...box.params, volume: v2, edit: edit2 };

      // (3) push bottom face: drag the face UPWARD by 3 mm in world-space.
      //     The bottom face's outward normal is -z, but the user's drag
      //     direction is +z (up) so this is an INWARD push: bottom rises,
      //     height shrinks, anchor.z rises with the face.
      const edit3 = inferEdit(box, [0, 0, -1], [0, 0, 3]);
      const m3 = await box.manifold();
      const v3 = m3.volume();
      const bbox = m3.boundingBox();
      const afterBottom = { ...box.params, volume: v3, edit: edit3, bbox };

      return { initial, afterTop, afterSide, afterBottom };
    });

    console.log(`\n=== DIRECT EDIT — PARAMETRIC BOX ===`);
    console.log(`Initial:    50 × 30 × 10, V = ${result.initial.volume.toFixed(0)} mm³`);
    console.log(`After top push +5:`);
    console.log(`  ${result.afterTop.width} × ${result.afterTop.depth} × ${result.afterTop.height}, V = ${result.afterTop.volume.toFixed(0)} mm³`);
    console.log(`  edit: ${JSON.stringify(result.afterTop.edit)}`);
    console.log(`After +x push +10:`);
    console.log(`  ${result.afterSide.width} × ${result.afterSide.depth} × ${result.afterSide.height}, V = ${result.afterSide.volume.toFixed(0)} mm³`);
    console.log(`  edit: ${JSON.stringify(result.afterSide.edit)}`);
    console.log(`After bottom push -3 in -z (bottom rises 3):`);
    console.log(`  ${result.afterBottom.width} × ${result.afterBottom.depth} × ${result.afterBottom.height}, V = ${result.afterBottom.volume.toFixed(0)} mm³`);
    console.log(`  bbox z range: [${result.afterBottom.bbox.min[2].toFixed(2)}, ${result.afterBottom.bbox.max[2].toFixed(2)}]`);
    console.log(`  edit: ${JSON.stringify(result.afterBottom.edit)}`);

    fs.writeFileSync(path.join(ROOT, 'box-direct-edit.json'), JSON.stringify(result, null, 2));

    // Verify each step's volume matches expected:
    //   initial:        50 × 30 × 10 = 15000
    //   after top +5:   50 × 30 × 15 = 22500
    //   after +x +10:   60 × 30 × 15 = 27000
    //   after bottom +3 (top stays at z=15, bottom rises to z=3, height=12):
    //                   60 × 30 × 12 = 21600
    expect(result.initial.volume).toBeCloseTo(15000, 0);
    expect(result.afterTop.height).toBe(15);
    expect(result.afterTop.volume).toBeCloseTo(22500, 0);
    expect(result.afterSide.width).toBe(60);
    expect(result.afterSide.volume).toBeCloseTo(27000, 0);
    // Bottom push: height drops by 3, anchor z rises by 3
    expect(result.afterBottom.height).toBe(12);
    expect(result.afterBottom.volume).toBeCloseTo(21600, 0);
    // bbox z range moved up by 3
    expect(result.afterBottom.bbox.min[2]).toBeCloseTo(3, 5);
    expect(result.afterBottom.bbox.max[2]).toBeCloseTo(15, 5);
  });

  test('Parametric cylinder: push axial cap → height changes; push radial → radius', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { ParametricCylinder, inferEdit } = await import('/src/foundation/SyncModel.js');
      const cyl = new ParametricCylinder({ radius: 5, height: 10 });
      const v0 = (await cyl.manifold()).volume();

      // Push top axial cap up by 8 → height grows
      const e1 = inferEdit(cyl, [0, 0, 1], [0, 0, 8]);
      const v1 = (await cyl.manifold()).volume();

      // Push radial face outward by 3 (along +x, normal also along +x)
      const e2 = inferEdit(cyl, [1, 0, 0], [3, 0, 0]);
      const v2 = (await cyl.manifold()).volume();

      return {
        initial: { ...cyl.params, volume: v0 },
        afterAxialPush: { ...cyl.params, volume: v1, edit: e1 },
        afterRadialPush: { ...cyl.params, volume: v2, edit: e2 },
      };
    });

    console.log(`\n=== DIRECT EDIT — PARAMETRIC CYLINDER ===`);
    console.log(`Initial:    R=${result.initial.radius}, H=${result.initial.height}, V=${result.initial.volume.toFixed(2)}  (analytical πR²H = ${(Math.PI * 25 * 10).toFixed(2)})`);
    console.log(`After axial cap push +8:`);
    console.log(`  R=${result.afterAxialPush.radius}, H=${result.afterAxialPush.height}, V=${result.afterAxialPush.volume.toFixed(2)}  (analytical = ${(Math.PI * 25 * 18).toFixed(2)})`);
    console.log(`After +x radial push +3:`);
    console.log(`  R=${result.afterRadialPush.radius}, H=${result.afterRadialPush.height}, V=${result.afterRadialPush.volume.toFixed(2)}  (analytical = ${(Math.PI * 64 * 18).toFixed(2)})`);

    fs.writeFileSync(path.join(ROOT, 'cylinder-direct-edit.json'), JSON.stringify(result, null, 2));

    // Polygonal cylinder volume sits below the analytical πR²H by
    // about 0.16% (segment count 64). Use ratio-based tolerance.
    const ratio = (a, b) => Math.abs(a - b) / b;
    expect(ratio(result.initial.volume,         Math.PI * 25 * 10)).toBeLessThan(0.005);
    expect(result.afterAxialPush.height).toBe(18);
    expect(ratio(result.afterAxialPush.volume,  Math.PI * 25 * 18)).toBeLessThan(0.005);
    expect(result.afterRadialPush.radius).toBe(8);
    expect(ratio(result.afterRadialPush.volume, Math.PI * 64 * 18)).toBeLessThan(0.005);
  });

  test('Drag direction not aligned with face: only normal-projected component edits', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { ParametricBox, inferEdit } = await import('/src/foundation/SyncModel.js');
      const box = new ParametricBox({ width: 50, depth: 30, height: 10 });
      // Drag top face along an oblique vector (3, 4, 7).
      // Projection onto +z normal = 7. So height should grow by 7.
      const e = inferEdit(box, [0, 0, 1], [3, 4, 7]);
      return { params: box.params, edit: e };
    });

    console.log(`\nOblique drag onto +z face: ${JSON.stringify(result.edit)}`);
    console.log(`Final height: ${result.params.height}  (expected 17 = 10 + 7-projection)`);

    expect(result.edit.delta).toBeCloseTo(7, 9);
    expect(result.params.height).toBeCloseTo(17, 9);
  });

  test('Direct edit + STEP export round-trip: NURBS-aware part round-trips', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { ParametricCylinder, inferEdit } = await import('/src/foundation/SyncModel.js');
      const { manifoldToSTEP } = await import('/src/foundation/StepExport.js');
      const cyl = new ParametricCylinder({ radius: 10, height: 20 });
      // Initial export
      let m = await cyl.manifold();
      const stepInitial = manifoldToSTEP(m, { name: 'BeforeEdit_R10_H20' });
      // Direct edit: push axial face up by 5 mm
      inferEdit(cyl, [0, 0, 1], [0, 0, 5]);
      m = await cyl.manifold();
      const stepEdited = manifoldToSTEP(m, { name: 'AfterEdit_R10_H25' });
      return {
        initialBytes: stepInitial.length,
        editedBytes: stepEdited.length,
        editedHeight: cyl.params.height,
      };
    });

    console.log(`\n=== DIRECT EDIT → STEP ROUND-TRIP ===`);
    console.log(`Initial cylinder STEP: ${(result.initialBytes / 1024).toFixed(1)} KB`);
    console.log(`After +5 mm axial drag: H = ${result.editedHeight} mm`);
    console.log(`Edited cylinder STEP: ${(result.editedBytes / 1024).toFixed(1)} KB`);

    expect(result.editedHeight).toBe(25);
    expect(result.initialBytes).toBeGreaterThan(1000);
    expect(result.editedBytes).toBeGreaterThan(1000);
  });
});
