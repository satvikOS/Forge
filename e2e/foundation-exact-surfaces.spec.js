import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'exact-surfaces');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(60000);

test.describe('Exact analytical surfaces (M48) — closed-form mass properties', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Cylinder: V = π R² h, A = 2π R (R + h), centroid on axis', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { Cylinder } = await import('/src/foundation/ExactSurfaces.js');
      const c = new Cylinder({ radius: 10, height: 50 });
      return {
        volume: c.volume(),
        surfaceArea: c.surfaceArea(),
        centroid: c.centroid(),
        inertia: c.inertiaLocal(2700e-9),  // kg/mm³ for Al
      };
    });

    const Vexact = Math.PI * 100 * 50;
    const Aexact = 2 * Math.PI * 10 * (10 + 50);
    console.log(`\n=== EXACT CYLINDER (R=10, h=50) ===`);
    console.log(`V = ${result.volume.toFixed(10)}  exact ${Vexact.toFixed(10)}`);
    console.log(`A = ${result.surfaceArea.toFixed(10)}  exact ${Aexact.toFixed(10)}`);
    console.log(`Centroid: (${result.centroid.join(', ')})  expected (0, 0, 25)`);
    fs.writeFileSync(path.join(ROOT, 'cylinder.json'), JSON.stringify(result, null, 2));

    expect(result.volume).toBeCloseTo(Vexact, 12);
    expect(result.surfaceArea).toBeCloseTo(Aexact, 12);
    expect(result.centroid[2]).toBeCloseTo(25, 12);
    expect(result.inertia.mass).toBeGreaterThan(0);
  });

  test('Sphere: V = 4π R³/3, A = 4π R², I = (2/5) m R²', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { Sphere } = await import('/src/foundation/ExactSurfaces.js');
      const s = new Sphere({ radius: 25 });
      return {
        volume: s.volume(),
        area: s.surfaceArea(),
        inertia: s.inertia(2700e-9),
      };
    });
    const Vexact = (4 / 3) * Math.PI * 25 ** 3;
    const Aexact = 4 * Math.PI * 625;
    console.log(`\n=== EXACT SPHERE (R=25) ===`);
    console.log(`V = ${result.volume.toFixed(8)}  exact ${Vexact.toFixed(8)}`);
    console.log(`A = ${result.area.toFixed(8)}  exact ${Aexact.toFixed(8)}`);
    console.log(`Inertia diag I = ${result.inertia.Ixx.toExponential(4)} kg·mm²,  m = ${result.inertia.mass.toFixed(4)} kg`);
    fs.writeFileSync(path.join(ROOT, 'sphere.json'), JSON.stringify(result, null, 2));
    expect(result.volume).toBeCloseTo(Vexact, 10);
    expect(result.area).toBeCloseTo(Aexact, 10);
    // I = (2/5) m R² = 0.4 · m · 625
    expect(result.inertia.Ixx).toBeCloseTo(0.4 * result.inertia.mass * 625, 8);
  });

  test('Torus: V = 2π² R r², A = 4π² R r', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { Torus } = await import('/src/foundation/ExactSurfaces.js');
      const t = new Torus({ majorRadius: 20, minorRadius: 5 });
      return { volume: t.volume(), area: t.surfaceArea() };
    });
    const Vexact = 2 * Math.PI ** 2 * 20 * 25;
    const Aexact = 4 * Math.PI ** 2 * 20 * 5;
    console.log(`\n=== EXACT TORUS (R=20, r=5) ===`);
    console.log(`V = ${result.volume.toFixed(8)}  exact ${Vexact.toFixed(8)}`);
    console.log(`A = ${result.area.toFixed(8)}  exact ${Aexact.toFixed(8)}`);
    fs.writeFileSync(path.join(ROOT, 'torus.json'), JSON.stringify(result, null, 2));
    expect(result.volume).toBeCloseTo(Vexact, 10);
    expect(result.area).toBeCloseTo(Aexact, 10);
  });

  test('Cone (frustum) volume formula', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { Cone } = await import('/src/foundation/ExactSurfaces.js');
      const f = new Cone({ radius1: 10, radius2: 4, height: 20 });
      const fullCone = new Cone({ radius1: 10, radius2: 0, height: 20 });
      return {
        frustumV: f.volume(),
        coneV: fullCone.volume(),
        frustumA: f.surfaceArea(),
      };
    });
    // Frustum: π · 20 · (100 + 40 + 16) / 3 = π · 20 · 156 / 3 = π · 1040
    const Vexact = Math.PI * 1040;
    // Full cone: (π/3) · R² · h = π · 100 · 20 / 3
    const VconeExact = Math.PI * 100 * 20 / 3;
    console.log(`\n=== EXACT CONE / FRUSTUM ===`);
    console.log(`Frustum (R1=10, R2=4, h=20)  V = ${result.frustumV.toFixed(6)}  exact ${Vexact.toFixed(6)}`);
    console.log(`Full cone (R=10, h=20)       V = ${result.coneV.toFixed(6)}  exact ${VconeExact.toFixed(6)}`);
    fs.writeFileSync(path.join(ROOT, 'cone.json'), JSON.stringify(result, null, 2));
    expect(result.frustumV).toBeCloseTo(Vexact, 10);
    expect(result.coneV).toBeCloseTo(VconeExact, 10);
  });

  test('Plane: signed distance', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { Plane } = await import('/src/foundation/ExactSurfaces.js');
      const p = new Plane([0, 0, 1], [0, 0, 5]);    // z = 5
      return {
        d_above: p.signedDistance([3, 4, 10]),     // expect 5
        d_below: p.signedDistance([0, 0, 0]),      // expect -5
        d_on:    p.signedDistance([100, -200, 5]), // expect 0
      };
    });
    expect(result.d_above).toBeCloseTo(5, 12);
    expect(result.d_below).toBeCloseTo(-5, 12);
    expect(result.d_on).toBeCloseTo(0, 12);
  });
});
