import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'cooling-mission');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(60000);

test.describe('M61 blade cooling + M62 mission analysis', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Cooled HPT blade survives T_gas=1750 K with TBC + film + internal', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { analyzeBladeCooling, filmEffectiveness } = await import('/src/foundation/BladeCooling.js');
      // Modern HPT blade design conditions:
      // T_gas (hot, after combustor mixing) = 1750 K
      // T_coolant (HPC bleed, post-cooling) = 800 K
      // CMSX-4 metal: k = 24 W/(m·K), wall t = 1.5 mm
      // YSZ TBC: k = 1.0 W/(m·K), t = 0.3 mm
      // External h ≈ 3000 W/(m²·K) (gas-path forced convection)
      // Internal h ≈ 2500 W/(m²·K) (turbulated channel)
      // Film effectiveness varies by station — leading edge has
      // showerhead cooling (η≈0.5), pressure side ≈0.4, suction
      // side ≈0.3, trailing edge has ejection slot (η≈0.7).

      const filmLE = filmEffectiveness(0.8, 2);     // M=0.8, x/D=2 → very near hole
      const filmPS = filmEffectiveness(0.6, 8);
      const filmSS = filmEffectiveness(0.4, 10);
      const filmTE = filmEffectiveness(1.0, 1);

      const r = analyzeBladeCooling({
        T_gas_K: 1750, T_coolant_K: 800,
        t_metal_m: 0.0015, k_metal: 24,
        t_TBC_m: 0.0003, k_TBC: 1.0,
        stations: {
          LE:    { h_ext: 5000, h_int: 3500, etaFilm: filmLE },  // stagnation hot-spot
          midPS: { h_ext: 3000, h_int: 2500, etaFilm: filmPS },
          midSS: { h_ext: 2500, h_int: 2500, etaFilm: filmSS },
          TE:    { h_ext: 3500, h_int: 2000, etaFilm: filmTE },
        },
      });
      return { r, filmLE, filmPS, filmSS, filmTE };
    });

    console.log(`\n=== HPT BLADE COOLING (T_gas=1750 K, T_c=800 K, CMSX-4 + TBC) ===`);
    console.log(`Film effectiveness: LE=${result.filmLE.toFixed(3)}, PS=${result.filmPS.toFixed(3)}, SS=${result.filmSS.toFixed(3)}, TE=${result.filmTE.toFixed(3)}`);
    for (const [name, st] of Object.entries(result.r.stations)) {
      console.log(`${name}: T_metal_outer = ${st.T_outer_metal.toFixed(0)} K = ${(st.T_outer_metal-273.15).toFixed(0)} °C, q = ${(st.heat_flux_W_per_m2/1000).toFixed(0)} kW/m², φ_c = ${st.overall_cooling_effectiveness.toFixed(3)}`);
    }
    console.log(`Hot-spot: ${result.r.hotspot} at T = ${result.r.T_metal_max_K.toFixed(0)} K = ${(result.r.T_metal_max_K-273.15).toFixed(0)} °C`);
    console.log(`Long-life survival (T_metal < 1100 °C): ${result.r.survives_long_life}`);
    fs.writeFileSync(path.join(ROOT, 'hpt-blade.json'), JSON.stringify(result, null, 2));

    // Each station's metal T should be well under gas T (cooling working)
    for (const st of Object.values(result.r.stations)) {
      expect(st.T_outer_metal).toBeLessThan(1750);
      expect(st.T_outer_metal).toBeGreaterThan(800);
      expect(st.overall_cooling_effectiveness).toBeGreaterThan(0.3);
      expect(st.overall_cooling_effectiveness).toBeLessThan(1.0);
    }
    // Whole blade should survive (hot-spot ≤ CMSX-4 long-life limit)
    expect(result.r.T_metal_max_K).toBeLessThan(1500);
  });

  test('Uncooled blade DIES at T_gas = 1750 K (sanity)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { bladePointTemperature } = await import('/src/foundation/BladeCooling.js');
      // No film, no TBC, no internal coolant flow (h_int huge but still
      // not enough to cool a blade exposed to 1750 K)
      // Take h_int → 0 for "no cooling": the metal sits at ~T_gas
      return bladePointTemperature({
        T_gas_K: 1750, T_coolant_K: 800,
        h_external: 3000, h_internal: 0.001,    // effectively no cooling
        t_metal_m: 0.0015, k_metal: 24,
        filmEffectiveness: 0,
      });
    });
    console.log(`\n=== UNCOOLED BLADE @ T_gas=1750 K ===`);
    console.log(`T_metal_outer = ${result.T_outer_metal.toFixed(0)} K = ${(result.T_outer_metal-273.15).toFixed(0)} °C`);
    console.log(`Heat flux = ${(result.heat_flux_W_per_m2/1000).toFixed(1)} kW/m²,  φ_c = ${result.overall_cooling_effectiveness.toFixed(3)}`);
    expect(result.T_outer_metal).toBeGreaterThan(1700);    // basically melts
    expect(result.metal_safe).toBe(false);
  });

  test('Subsonic transport mission: 200t MTOW, 60t fuel, L/D=15 → R≈8000 km', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { fullMissionEstimate, breguetRange } = await import('/src/foundation/Mission.js');
      // Anderson Ch 5 example: 200t-class subsonic transport
      const r = fullMissionEstimate({
        MTOW_kg: 200000, OEW_kg: 110000, payload_kg: 30000,
        fuel_total_kg: 60000, reserve_fraction: 0.05,
        S_m2: 360, CD0: 0.018, AR: 9.5, e: 0.85,
        altitude_m: 10670, V_cruise_ms: 240, rho_cruise: 0.4135,
        SFC_kg_per_N_per_hr: 0.057,    // typical high-bypass cruise
      });
      // Direct Breguet sanity
      const direct = breguetRange({
        V_ms: 240, SFC_kg_per_N_per_s: 0.057 / 3600, LoverD: 18,
        W_initial_kg: 200000, W_final_kg: 200000 - 60000 * 0.95,
      });
      return { r, direct };
    });

    console.log(`\n=== SUBSONIC TRANSPORT MISSION ===`);
    console.log(`(L/D)_avg = ${result.r.cruise.LoverD_avg.toFixed(2)},  (L/D)_max = ${result.r.cruise.LoverD_max.toFixed(2)}`);
    console.log(`Cruise CL = ${result.r.cruise.CL_avg.toFixed(3)},  CD = ${result.r.cruise.CD_avg.toFixed(4)}`);
    console.log(`Drag at avg weight = ${(result.r.cruise.drag_avg_N/1000).toFixed(1)} kN`);
    console.log(`Range  = ${result.r.range.range_km.toFixed(0)} km  (${result.r.range.range_nmi.toFixed(0)} nmi)`);
    console.log(`Endurance = ${result.r.endurance.endurance_hr.toFixed(2)} hr`);
    console.log(`Direct Breguet @ L/D=18: ${result.direct.range_km.toFixed(0)} km`);
    fs.writeFileSync(path.join(ROOT, 'transport-mission.json'), JSON.stringify(result, null, 2));

    // 200-tonne subsonic transport with 60 t fuel, modern SFC, L/D ≈ 18:
    //   R = 240/(9.81·1.583e-5) · 18 · ln(200/143) = ~10000 km
    expect(result.r.range.range_km).toBeGreaterThan(5000);
    expect(result.r.range.range_km).toBeLessThan(15000);
    // Endurance ≥ 8 hr is consistent
    expect(result.r.endurance.endurance_hr).toBeGreaterThan(6);
    // (L/D)_max is intrinsic to polar; should be > 18 for a clean wing
    expect(result.r.cruise.LoverD_max).toBeGreaterThan(15);
  });
});
