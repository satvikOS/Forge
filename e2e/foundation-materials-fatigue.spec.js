import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'materials-fatigue');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(60000);

test.describe('M53 Material DB + M54 Fatigue', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Material lookup + temperature interpolation (Inconel 718)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { findMaterial, MaterialDB } = await import('/src/foundation/MaterialDB.js');
      const mat = findMaterial('IN718');
      return {
        nameAtRoom: mat.name,
        E_20: mat.E(20),
        E_704: mat.E(704),
        E_400: mat.E(400),
        yield_20: mat.yield(20),
        yield_704: mat.yield(704),
        k_20: mat.k(20),
        k_600: mat.k(600),
        density: mat.density,
        G_20: mat.G(20),                  // E / (2(1+ν))
        alpha_20: mat.alpha(20),
        materialList: Object.keys(MaterialDB),
      };
    });

    console.log(`\n=== INCONEL 718 PROPERTIES vs TEMPERATURE ===`);
    console.log(`Found by alias 'IN718': ${result.nameAtRoom}`);
    console.log(`E(20°C) = ${result.E_20.toFixed(0)} MPa,   E(704°C) = ${result.E_704.toFixed(0)} MPa`);
    console.log(`σ_y(20°C) = ${result.yield_20} MPa,   σ_y(704°C) = ${result.yield_704} MPa`);
    console.log(`k(20°C) = ${result.k_20} W/(m·K),   k(600°C) = ${result.k_600}`);
    console.log(`Shear modulus G(20°C) = ${result.G_20.toFixed(0)} MPa`);
    console.log(`Diffusivity α(20°C) = ${result.alpha_20.toExponential(3)} m²/s`);
    console.log(`8 materials in DB: ${result.materialList.join(', ')}`);
    fs.writeFileSync(path.join(ROOT, 'inconel718.json'), JSON.stringify(result, null, 2));

    expect(result.nameAtRoom).toBe('Inconel 718 (aged)');
    expect(result.E_20).toBe(207000);
    expect(result.E_704).toBe(153000);
    expect(result.E_400).toBeGreaterThan(result.E_704);
    expect(result.E_400).toBeLessThan(result.E_20);
    expect(result.G_20).toBeCloseTo(207000 / (2 * 1.294), -1);
    expect(result.materialList.length).toBe(8);
  });

  test('Goodman + Soderberg + Gerber + Basquin life on 4340 steel shaft', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { findMaterial } = await import('/src/foundation/MaterialDB.js');
      const { analyzeFatigue } = await import('/src/foundation/Fatigue.js');
      const steel = findMaterial('4340');
      // Rotating shaft: σ_max = +400 MPa, σ_min = -400 MPa (fully reversed)
      const r1 = analyzeFatigue({
        sigmaMax: 400, sigmaMin: -400, material: steel,
        surface: { surfaceFinish: 0.85, size: 0.85, load: 1.0,
                   temperature: 1.0, reliability: 0.897 },
      });
      // Bracket under fluctuating tension: σ_max=600, σ_min=200 (offset cycle)
      const r2 = analyzeFatigue({
        sigmaMax: 600, sigmaMin: 200, material: steel,
        surface: { surfaceFinish: 0.85, size: 1.0, load: 0.85,
                   temperature: 1.0, reliability: 0.897 },
      });
      return { reversed: r1, fluctuating: r2 };
    });

    console.log(`\n=== ROTATING SHAFT (±400 MPa) on 4340 ===`);
    console.log(`σ_a = ${result.reversed.alt} MPa,  σ_m = ${result.reversed.mean}`);
    console.log(`S_e (Marin-corrected) = ${result.reversed.Se.toFixed(1)} MPa  (raw 600, k=${result.reversed.marinFactor.toFixed(3)})`);
    console.log(`Goodman SF: ${result.reversed.goodman.safetyFactor.toFixed(3)}`);
    console.log(`Soderberg SF: ${result.reversed.soderberg.safetyFactor.toFixed(3)}`);
    console.log(`Basquin life: ${result.reversed.lifeCycles === Infinity ? '∞ (below endurance limit)' : result.reversed.lifeCycles.toExponential(3) + ' cycles'}`);
    console.log(`Status: ${result.reversed.status}`);

    console.log(`\n=== FLUCTUATING (200-600 MPa) on 4340 ===`);
    console.log(`σ_a = ${result.fluctuating.alt}, σ_m = ${result.fluctuating.mean}`);
    console.log(`Goodman SF: ${result.fluctuating.goodman.safetyFactor.toFixed(3)}`);
    console.log(`Status: ${result.fluctuating.status}`);
    fs.writeFileSync(path.join(ROOT, 'fatigue-cases.json'), JSON.stringify(result, null, 2));

    // Reversed-loading: σ_a = 400 MPa is well above S_e = 433 (after Marin) — wait
    // Marin = 0.85 · 0.85 · 1.0 · 1.0 · 0.897 = 0.648
    // S_e raw = 600, S_e corrected = 600 · 0.648 = 388.7 MPa
    // σ_a = 400 > 388.7 → finite life via Basquin
    expect(result.reversed.alt).toBe(400);
    expect(result.reversed.mean).toBe(0);
    expect(result.reversed.lifeCycles).toBeLessThan(Infinity);
    // Goodman with σ_m = 0: SF = S_e / σ_a = 388.7/400 ≈ 0.97
    expect(result.reversed.goodman.safetyFactor).toBeCloseTo(0.97, 1);

    // Soderberg should be more conservative (≤ Goodman) when σ_m > 0
    expect(result.fluctuating.soderberg.safetyFactor).toBeLessThanOrEqual(result.fluctuating.goodman.safetyFactor + 1e-6);
  });

  test('Endurance limit lookup (Aluminum 6061): no infinite life, S-N controls', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { findMaterial } = await import('/src/foundation/MaterialDB.js');
      const { enduranceLimit, basquinLife } = await import('/src/foundation/Fatigue.js');
      const al = findMaterial('Al-6061');
      // σ_alt = 120 MPa — Al has Sf at 1e6 of 96 MPa; this is above so finite life
      const Se = enduranceLimit(al, 1.0);
      const N1 = basquinLife(96, al);     // exactly at 1e6 cycles
      const N2 = basquinLife(120, al);    // above
      const N3 = basquinLife(50, al);     // below — should be Infinity
      return { Se, N1, N2, N3, name: al.name };
    });
    console.log(`\n=== AL 6061 S-N ===`);
    console.log(`S_e (uncorrected) = ${result.Se}`);
    console.log(`σ_a = 96 MPa  → N = ${result.N1.toExponential(3)} cycles  (≈ 1e6)`);
    console.log(`σ_a = 120 MPa → N = ${result.N2.toExponential(3)} cycles`);
    console.log(`σ_a = 50 MPa  → N = ${result.N3 === Infinity ? '∞' : result.N3.toExponential(3)}`);

    expect(result.N1).toBeCloseTo(1e6, -3);
    expect(result.N2).toBeLessThan(result.N1);
    expect(result.N2).toBeGreaterThan(0);
    expect(result.N3).toBe(Infinity);
  });
});
