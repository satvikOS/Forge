import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X', 'performance');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('GE9X flight envelope: thrust + SFC across altitude × Mach grid', async ({ page }) => {
  ensure(OUT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000);

  const grid = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { BraytonCycle } = m;

    // Mass-flow scaling with altitude/Mach (real engines vary inlet airflow)
    function massFlowScale(altitude_m, M0) {
      // Approximation: m_dot ∝ ρ × A × V_in. ρ falls with altitude.
      const { T0, P0 } = BraytonCycle.isaAtmosphere(altitude_m);
      const rho = P0 / (287 * T0);
      const rhoSL = 101325 / (287 * 288.15);
      const ramFactor = 1 + 0.2 * M0 * M0;  // mild ram boost
      return (rho / rhoSL) * ramFactor;
    }

    const altitudes = [0, 1500, 3000, 5000, 7000, 9000, 10670, 12000, 13000];
    const machs = [0.0, 0.2, 0.4, 0.6, 0.8, 0.85, 0.9];
    const results = [];

    const baseMassFlow = 1361;

    for (const alt of altitudes) {
      for (const M of machs) {
        // T4 derate at altitude (real engines automatically derate)
        const T4 = 1925 - (alt / 1000) * 18 - M * 50;
        const massFlow = baseMassFlow * massFlowScale(alt, M);
        try {
          const r = BraytonCycle.analyze({
            altitude_m: alt, M0: M,
            massFlow,
            bpr: 9.9, FPR: 1.45, LPC_PR: 2.7, HPC_PR: 15.3,
            T4: Math.max(1450, T4),
          });
          results.push({
            altitude_m: alt, mach: M,
            T4_K: r.stations['4'].Tt,
            thrust_kN: +r.performance.thrust_total_kN.toFixed(1),
            SFC: +r.performance.SFC_kg_N_hr.toFixed(4),
            SFC_lbm_lbf_hr: +r.performance.TSFC_lbm_lbf_hr.toFixed(3),
            massFlow_kg_s: +massFlow.toFixed(0),
            OPR: +r.performance.OPR.toFixed(1),
            EGT_C: +r.performance.EGT_C.toFixed(0),
            propEff: +(r.performance.propulsiveEfficiency * 100).toFixed(1),
            thermalEff: +(r.performance.thermalEfficiency * 100).toFixed(1),
          });
        } catch (e) {
          results.push({ altitude_m: alt, mach: M, error: e.message });
        }
      }
    }

    return { altitudes, machs, results };
  });

  console.log('\n=== GE9X Flight Envelope ===');
  console.log(`Grid: ${grid.altitudes.length} altitudes × ${grid.machs.length} Mach numbers`);
  console.log(`Computed: ${grid.results.length} operating points`);

  // Print thrust grid
  console.log('\nThrust (kN):');
  console.log('  Alt(ft) \\ M ' + grid.machs.map(m => m.toFixed(2).padStart(7)).join(''));
  for (const alt of grid.altitudes) {
    const ftLabel = (alt * 3.281).toFixed(0).padStart(8);
    const row = grid.machs.map(m => {
      const r = grid.results.find(x => x.altitude_m === alt && x.mach === m);
      return (r?.thrust_kN ?? 0).toFixed(0).padStart(7);
    }).join('');
    console.log(`  ${ftLabel}    ${row}`);
  }

  // Print SFC grid
  console.log('\nSFC (lbm/(lbf·hr)):');
  console.log('  Alt(ft) \\ M ' + grid.machs.map(m => m.toFixed(2).padStart(7)).join(''));
  for (const alt of grid.altitudes) {
    const ftLabel = (alt * 3.281).toFixed(0).padStart(8);
    const row = grid.machs.map(m => {
      const r = grid.results.find(x => x.altitude_m === alt && x.mach === m);
      return (r?.SFC_lbm_lbf_hr ?? 0).toFixed(3).padStart(7);
    }).join('');
    console.log(`  ${ftLabel}    ${row}`);
  }

  fs.writeFileSync(path.join(OUT, 'flight-envelope.json'), JSON.stringify(grid, null, 2));

  // CSV
  const csv = ['Altitude_m,Altitude_ft,Mach,T4_K,Thrust_kN,Thrust_lbf,SFC_kg_per_Nhr,SFC_lbm_per_lbfhr,MassFlow_kg_s,OPR,EGT_C,Propulsive_eff_pct,Thermal_eff_pct'];
  for (const r of grid.results) {
    if (r.error) continue;
    csv.push([
      r.altitude_m,
      (r.altitude_m * 3.281).toFixed(0),
      r.mach.toFixed(2),
      r.T4_K.toFixed(0),
      r.thrust_kN,
      (r.thrust_kN * 224.81).toFixed(0),
      r.SFC,
      r.SFC_lbm_lbf_hr,
      r.massFlow_kg_s,
      r.OPR,
      r.EGT_C,
      r.propEff,
      r.thermalEff,
    ].join(','));
  }
  fs.writeFileSync(path.join(OUT, 'flight-envelope.csv'), csv.join('\n'));

  // Build SVG contour plot
  const W = 800, H = 500;
  const margin = { top: 50, right: 30, bottom: 60, left: 90 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  const altMax = Math.max(...grid.altitudes);
  const machMax = Math.max(...grid.machs);

  const xScale = (m) => margin.left + (m / machMax) * plotW;
  const yScale = (a) => margin.top + plotH - (a / altMax) * plotH;

  const thrustMin = Math.min(...grid.results.filter(r => !r.error).map(r => r.thrust_kN));
  const thrustMax = Math.max(...grid.results.filter(r => !r.error).map(r => r.thrust_kN));

  function thrustToColor(v) {
    const t = (v - thrustMin) / (thrustMax - thrustMin);
    const r = Math.round(255 * Math.max(0, Math.min(1, 2 * t - 0.5)));
    const g = Math.round(255 * Math.max(0, Math.min(1, 2 * t)));
    const b = Math.round(255 * (1 - t));
    return `rgb(${r},${g},${b})`;
  }

  const dots = grid.results.filter(r => !r.error).map(r => {
    const cx = xScale(r.mach);
    const cy = yScale(r.altitude_m);
    return `<circle cx="${cx}" cy="${cy}" r="14" fill="${thrustToColor(r.thrust_kN)}" stroke="#222" stroke-width="0.5"/>
            <text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="9" fill="#000" font-family="sans-serif" font-weight="bold">${r.thrust_kN.toFixed(0)}</text>`;
  }).join('\n  ');

  const xTicks = grid.machs.map(m =>
    `<text x="${xScale(m)}" y="${margin.top + plotH + 18}" text-anchor="middle" font-size="11" fill="#333">M ${m.toFixed(2)}</text>`).join('\n  ');
  const yTicks = grid.altitudes.map(a =>
    `<text x="${margin.left - 8}" y="${yScale(a) + 4}" text-anchor="end" font-size="11" fill="#333">${(a * 3.281 / 1000).toFixed(0)}k ft</text>`).join('\n  ');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#fefefe"/>
  <text x="${W/2}" y="22" text-anchor="middle" font-size="18" font-weight="700" fill="#222" font-family="sans-serif">GE9X Flight Envelope — Thrust (kN)</text>
  <text x="${W/2}" y="40" text-anchor="middle" font-size="11" fill="#666" font-family="sans-serif">Computed from BraytonCycle.analyze() across ${grid.altitudes.length}×${grid.machs.length} grid</text>
  <rect x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}" fill="#f5f5f8" stroke="#888"/>
  ${dots}
  ${xTicks}
  ${yTicks}
  <text x="${W/2}" y="${H - 20}" text-anchor="middle" font-size="13" fill="#333" font-family="sans-serif">Mach number</text>
  <text x="20" y="${H/2}" text-anchor="middle" transform="rotate(-90, 20, ${H/2})" font-size="13" fill="#333" font-family="sans-serif">Altitude</text>
</svg>`;
  fs.writeFileSync(path.join(OUT, 'flight-envelope.svg'), svg);

  // Render to PNG
  await page.setViewportSize({ width: W, height: H });
  await page.setContent(`<!doctype html><body style="margin:0;background:#fff">${svg}</body>`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'flight-envelope.png'), fullPage: false, clip: { x: 0, y: 0, width: W, height: H } });
  console.log(`\nSaved flight-envelope.{json,csv,svg,png} to ${OUT}`);

  expect(grid.results.length).toBe(grid.altitudes.length * grid.machs.length);
});
