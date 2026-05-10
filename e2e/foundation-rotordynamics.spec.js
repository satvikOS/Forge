import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'rotordynamics');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test.describe('M51 — Rotordynamics 1D (shaft + bearings + disks)', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Cantilever shaft + tip disk: Ω_cr = √(3 E I / m L³)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { solveRotordynamics } = await import('/src/foundation/Rotordynamics.js');
      // Steel shaft Ø20 × L=300 mm, tip mass 1 kg.
      // E = 200 GPa = 200000 MPa, density = 7.85e-6 kg/mm³
      const r = solveRotordynamics({
        shaft: { length: 300, diameter: 20, E: 200000, density: 7.85e-6, elements: 10 },
        disks: [{ position: 300, mass: 1.0 }],
        boundary: 'cantilever',
        numModes: 4,
      });
      return r;
    });

    // Analytical for cantilever + tip mass (shaft mass neglected):
    //   k_tip = 3 EI / L³,  ω₁ = √(k_tip / m)
    const E = 200000, dia = 20, L = 300, m = 1.0;
    const I = Math.PI * (dia / 2) ** 4 / 4;
    const k = 3 * E * I / (L ** 3);
    const omegaAn = Math.sqrt(k / m);
    const fAn = omegaAn / (2 * Math.PI);
    const fNum = result.frequenciesHz[0];
    const errPct = (fNum - fAn) / fAn * 100;

    console.log(`\n=== CANTILEVER SHAFT + TIP DISK ===`);
    console.log(`Shaft: Ø20 × L=300 mm steel,  tip mass 1 kg`);
    console.log(`I = π R⁴/4 = ${I.toFixed(2)} mm⁴`);
    console.log(`k = 3 EI / L³ = ${k.toFixed(2)} N/mm`);
    console.log(`Analytical ω₁ = √(k/m) = ${omegaAn.toFixed(2)} rad/s,  f₁ = ${fAn.toFixed(2)} Hz`);
    console.log(`FEA   f₁ = ${fNum.toFixed(2)} Hz  (err ${errPct.toFixed(2)} %)`);
    console.log(`Critical speed = ${result.criticalSpeedRPM.toFixed(0)} RPM`);
    console.log(`First 4 mode frequencies (Hz): ${result.frequenciesHz.slice(0, 4).map(f => f.toFixed(2)).join(', ')}`);
    fs.writeFileSync(path.join(ROOT, 'cantilever-tip-disk.json'), JSON.stringify({
      analyticalHz: fAn, feaHz: fNum, errorPct: errPct, allModes: result.frequenciesHz,
      criticalRPM: result.criticalSpeedRPM,
    }, null, 2));

    // Beam-FEM with tip mass + shaft mass should over-predict slightly
    // (shaft mass adds inertia neglected in analytical Jeffcott form).
    expect(Math.abs(errPct)).toBeLessThan(20);
    expect(result.criticalSpeedRPM).toBeGreaterThan(0);
  });

  test('Simply-supported shaft + mid-span disk: Ω_cr = √(48 E I / m L³)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { solveRotordynamics } = await import('/src/foundation/Rotordynamics.js');
      // Steel shaft Ø30 × L=600 mm, mid-span mass 5 kg.
      const r = solveRotordynamics({
        shaft: { length: 600, diameter: 30, E: 200000, density: 7.85e-6, elements: 12 },
        disks: [{ position: 300, mass: 5.0 }],
        boundary: 'simply-supported',
        numModes: 4,
      });
      return r;
    });

    const E = 200000, dia = 30, L = 600, m = 5.0;
    const I = Math.PI * (dia / 2) ** 4 / 4;
    const k = 48 * E * I / (L ** 3);
    const omegaAn = Math.sqrt(k / m);
    const fAn = omegaAn / (2 * Math.PI);
    const fNum = result.frequenciesHz[0];
    const errPct = (fNum - fAn) / fAn * 100;

    console.log(`\n=== SIMPLY-SUPPORTED SHAFT + MID-SPAN DISK ===`);
    console.log(`Shaft Ø30 × L=600 mm steel,  mid-span mass 5 kg`);
    console.log(`Analytical f₁ = ${fAn.toFixed(2)} Hz`);
    console.log(`FEA       f₁ = ${fNum.toFixed(2)} Hz  (err ${errPct.toFixed(2)} %)`);
    console.log(`Critical speed = ${result.criticalSpeedRPM.toFixed(0)} RPM`);
    fs.writeFileSync(path.join(ROOT, 'simply-supported-mid-disk.json'), JSON.stringify({
      analyticalHz: fAn, feaHz: fNum, errorPct: errPct,
      criticalRPM: result.criticalSpeedRPM,
    }, null, 2));
    expect(Math.abs(errPct)).toBeLessThan(20);
  });

  test('Bearings as flexible supports — frequency drops vs rigid', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { solveRotordynamics } = await import('/src/foundation/Rotordynamics.js');
      // Same shaft + mid-disk, but supported by ball bearings of finite
      // stiffness instead of rigid pins. Frequency must drop because
      // the bearings add compliance.
      const baseline = solveRotordynamics({
        shaft: { length: 600, diameter: 30, E: 200000, density: 7.85e-6, elements: 12 },
        disks: [{ position: 300, mass: 5.0 }],
        boundary: 'simply-supported',
        numModes: 1,
      });
      const flexBrg = solveRotordynamics({
        shaft: { length: 600, diameter: 30, E: 200000, density: 7.85e-6, elements: 12 },
        disks: [{ position: 300, mass: 5.0 }],
        bearings: [
          { position: 0, kxx: 5e5, kyy: 5e5 },     // 500 kN/mm — very stiff but finite
          { position: 600, kxx: 5e5, kyy: 5e5 },
        ],
        boundary: 'free',                          // let bearings carry it
        numModes: 1,
      });
      return {
        rigidHz: baseline.frequenciesHz[0],
        flexBrgHz: flexBrg.frequenciesHz[0],
      };
    });

    console.log(`\n=== RIGID vs FLEXIBLE BEARINGS ===`);
    console.log(`Rigid simply-supported: f₁ = ${result.rigidHz.toFixed(2)} Hz`);
    console.log(`Flexible bearings (k=500 kN/mm each): f₁ = ${result.flexBrgHz.toFixed(2)} Hz`);
    fs.writeFileSync(path.join(ROOT, 'rigid-vs-flex-bearings.json'), JSON.stringify(result, null, 2));
    // Flexible bearings should give LOWER frequency than rigid pins
    expect(result.flexBrgHz).toBeLessThan(result.rigidHz);
    expect(result.flexBrgHz).toBeGreaterThan(0);
  });
});
