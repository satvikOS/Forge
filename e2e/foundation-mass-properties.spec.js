import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'mass-properties');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test.describe('M50 — Full mass properties (signed-tet decomposition)', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Cube 30×30×30: V exact, COM at origin, I_xx = m a²/6 (Mirtich)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { getManifold } = await import('/src/foundation/manifoldKernel.js');
      const { manifoldMassProperties, principalInertia } = await import('/src/foundation/MassProperties.js');
      const Mod = await getManifold();
      const cube = Mod.Manifold.cube([30, 30, 30], true);
      const mp = manifoldMassProperties(cube, 2.7e-6);   // Al-6061 density kg/mm³
      const pi = principalInertia(mp.inertiaCOM);
      return { mp, pi };
    });

    // Analytical for solid cube of side a, mass m: I = m a²/6 about each
    // axis through centroid. With a=30, V=27000, m=27000·2.7e-6=0.0729kg
    // I_diag = 0.0729 · 900 / 6 = 10.935 kg·mm²
    const m = 27000 * 2.7e-6;
    const I_an = m * 900 / 6;
    console.log(`\n=== CUBE 30³ MASS PROPERTIES ===`);
    console.log(`V = ${result.mp.volume.toFixed(6)}  exact 27000`);
    console.log(`m = ${result.mp.mass.toFixed(6)} kg  exact ${m}`);
    console.log(`COM = (${result.mp.centroid.map(v => v.toFixed(6)).join(', ')})  expected (0,0,0)`);
    console.log(`I_diag (COM): ${result.mp.inertiaCOM[0][0].toFixed(4)}, ${result.mp.inertiaCOM[1][1].toFixed(4)}, ${result.mp.inertiaCOM[2][2].toFixed(4)}  exact ${I_an.toFixed(4)} kg·mm²`);
    console.log(`Principal: ${result.pi.map(p => p.value.toFixed(4)).join(', ')}`);
    fs.writeFileSync(path.join(ROOT, 'cube.json'), JSON.stringify(result, null, 2));

    expect(result.mp.volume).toBeCloseTo(27000, 4);
    expect(Math.abs(result.mp.centroid[0])).toBeLessThan(1e-9);
    expect(Math.abs(result.mp.centroid[1])).toBeLessThan(1e-9);
    expect(Math.abs(result.mp.centroid[2])).toBeLessThan(1e-9);
    expect(result.mp.inertiaCOM[0][0]).toBeCloseTo(I_an, 4);
    expect(result.mp.inertiaCOM[1][1]).toBeCloseTo(I_an, 4);
    expect(result.mp.inertiaCOM[2][2]).toBeCloseTo(I_an, 4);
    // Off-diagonal should be ~0 by symmetry
    expect(Math.abs(result.mp.inertiaCOM[0][1])).toBeLessThan(1e-6);
  });

  test('Cylinder R=10 h=50: I_zz = mR²/2, I_xx = m(3R² + h²)/12', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { getManifold } = await import('/src/foundation/manifoldKernel.js');
      const { manifoldMassProperties } = await import('/src/foundation/MassProperties.js');
      const Mod = await getManifold();
      // Cylinder Ø20 × h=50 along Z, centered at origin
      const cyl = Mod.Manifold.cylinder(50, 10, 10, 96, true);
      const mp = manifoldMassProperties(cyl, 2.7e-6);
      return mp;
    });

    // Analytical: V = π·100·50 ≈ 15707.96, m = V·ρ
    // I_zz = m R²/2 = m·100/2 = 50m
    // I_xx = I_yy = m(3R² + h²)/12 = m(300 + 2500)/12 = m·2800/12 = 233.33m
    const Vexact = Math.PI * 100 * 50;
    const m = Vexact * 2.7e-6;
    const Izz_an = m * 100 / 2;
    const Ixx_an = m * 2800 / 12;
    const errV = (result.volume - Vexact) / Vexact * 100;
    const errIzz = (result.inertiaCOM[2][2] - Izz_an) / Izz_an * 100;
    const errIxx = (result.inertiaCOM[0][0] - Ixx_an) / Ixx_an * 100;
    console.log(`\n=== CYLINDER R=10 h=50 ===`);
    console.log(`V = ${result.volume.toFixed(4)}  vs π R² h = ${Vexact.toFixed(4)} (err ${errV.toFixed(3)}%)`);
    console.log(`I_zz = ${result.inertiaCOM[2][2].toFixed(4)}  vs mR²/2 = ${Izz_an.toFixed(4)} (err ${errIzz.toFixed(3)}%)`);
    console.log(`I_xx = ${result.inertiaCOM[0][0].toFixed(4)}  vs m(3R²+h²)/12 = ${Ixx_an.toFixed(4)} (err ${errIxx.toFixed(3)}%)`);
    fs.writeFileSync(path.join(ROOT, 'cylinder.json'), JSON.stringify(result, null, 2));

    // 96-segment polygonal cylinder under-reports volume by ~0.07%
    expect(Math.abs(errV)).toBeLessThan(0.5);
    expect(Math.abs(errIzz)).toBeLessThan(0.5);
    expect(Math.abs(errIxx)).toBeLessThan(0.5);
  });

  test('Sphere R=25: I = (2/5) m R² isotropic', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { getManifold } = await import('/src/foundation/manifoldKernel.js');
      const { manifoldMassProperties, principalInertia } = await import('/src/foundation/MassProperties.js');
      const Mod = await getManifold();
      const sph = Mod.Manifold.sphere(25, 96);
      const mp = manifoldMassProperties(sph, 2.7e-6);
      const pi = principalInertia(mp.inertiaCOM);
      return { mp, pi };
    });

    const Vexact = (4 / 3) * Math.PI * 15625;
    const m = Vexact * 2.7e-6;
    const I_an = (2 / 5) * m * 625;
    console.log(`\n=== SPHERE R=25 ===`);
    console.log(`V = ${result.mp.volume.toFixed(4)}  vs 4πR³/3 = ${Vexact.toFixed(4)}`);
    console.log(`I diag = ${result.mp.inertiaCOM[0][0].toFixed(4)}, ${result.mp.inertiaCOM[1][1].toFixed(4)}, ${result.mp.inertiaCOM[2][2].toFixed(4)}  exact (2/5) m R² = ${I_an.toFixed(4)}`);
    console.log(`Principal: ${result.pi.map(p => p.value.toFixed(4)).join(', ')}`);
    fs.writeFileSync(path.join(ROOT, 'sphere.json'), JSON.stringify(result, null, 2));

    // Polygonal sphere under-reports volume by ~0.07-0.2%
    const errV = (result.mp.volume - Vexact) / Vexact * 100;
    expect(Math.abs(errV)).toBeLessThan(0.5);
    // All three principal moments equal (isotropic)
    expect(Math.abs(result.pi[0].value - result.pi[2].value) / result.pi[0].value).toBeLessThan(0.01);
  });

  test('Off-center body: parallel-axis check (cube translated)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { getManifold } = await import('/src/foundation/manifoldKernel.js');
      const { manifoldMassProperties } = await import('/src/foundation/MassProperties.js');
      const Mod = await getManifold();
      // Cube 20³ centered at (50, 0, 0) → COM should be (50, 0, 0)
      const c = Mod.Manifold.cube([20, 20, 20], true).translate([50, 0, 0]);
      const mp = manifoldMassProperties(c, 2.7e-6);
      return mp;
    });

    const m = 8000 * 2.7e-6;
    // I about origin, x-axis: I_xx_origin = I_xx_COM = m·a²/6 = m·400/6 (no parallel-axis offset for x-axis)
    // I about origin, y-axis: I_yy_origin = I_yy_COM + m·d² where d=50
    //                       = m·400/6 + m·2500
    const Iyy_origin_exact = m * 400 / 6 + m * 2500;
    console.log(`\n=== OFF-CENTER CUBE (20³ at x=50) ===`);
    console.log(`COM = (${result.centroid.map(v => v.toFixed(4)).join(', ')})  expected (50, 0, 0)`);
    console.log(`I_yy at origin = ${result.inertiaOrigin[1][1].toFixed(4)}  exact ${Iyy_origin_exact.toFixed(4)}`);
    console.log(`I_yy at COM    = ${result.inertiaCOM[1][1].toFixed(4)}     (parallel-axis subtracted)`);
    fs.writeFileSync(path.join(ROOT, 'off-center.json'), JSON.stringify(result, null, 2));

    expect(result.centroid[0]).toBeCloseTo(50, 4);
    expect(Math.abs(result.centroid[1])).toBeLessThan(1e-9);
    expect(result.inertiaOrigin[1][1]).toBeCloseTo(Iyy_origin_exact, 3);
    // I_yy at COM should be just m·a²/6 (no offset)
    expect(result.inertiaCOM[1][1]).toBeCloseTo(m * 400 / 6, 3);
  });
});
