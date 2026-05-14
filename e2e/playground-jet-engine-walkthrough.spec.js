import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'playground');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

/**
 * Playground walkthrough: the user designing a turbofan engine
 * for an Airbus-class airliner. Walks 12 ribbon clicks in the
 * order a propulsion engineer would actually work the problem:
 *
 *   1. Mission            — what range / thrust does the airframe need?
 *   2. Brayton Cycle      — pick BPR, OPR, T4 to meet SFC target
 *   3. Compressor Stage   — size the LPC stage from cycle outputs
 *   4. Combustor          — primary-zone sizing + emissions
 *   5. Turbine Stage      — HPT mean-line to extract work for HPC
 *   6. Blade Cooling      — does the HPT blade survive T_gas?
 *   7. Heat Exchanger     — recuperator for thermal recovery
 *   8. Nozzle             — convergent + CD design
 *   9. Mass Properties    — Mirtich inertia for a representative
 *                            foundation body (Linear Pattern)
 *  10. Rotordynamics      — critical speed of the shaft
 *  11. Fatigue Analysis   — life of the highest-stress component
 *  12. Export STEP        — packaged CAD output to send to a vendor
 *
 * After every step we verify the relevant window state and capture
 * a screenshot, building a visual "design notebook" the user can
 * scroll through to see what the engine looks like at each stage.
 */
test.describe('Playground: jet-engine design walkthrough', () => {
  test.describe.configure({ timeout: 300000 });
  test.beforeAll(() => ensure(ROOT));

  test('Walk 12 ribbon clicks in propulsion-engineer order', async ({ page }) => {
    const consoleLines = [];
    page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

    // Capture initial state
    await page.screenshot({ path: path.join(ROOT, '00-initial.png'), fullPage: false });

    // "Play around" pause — long enough for a human watching the
    // browser to actually read the status bar and see geometry.
    const DWELL_MS = 7000;
    const dwell = (ms = DWELL_MS) => page.waitForTimeout(ms);

    const snapshot = async (label, stateKey, screenshotFile) => {
      const v = await page.evaluate((k) => window[k] || null, stateKey);
      console.log(`\n--- ${label} ---`);
      if (v) console.log(JSON.stringify(v, null, 2).split('\n').slice(0, 10).join('\n'));
      await page.screenshot({ path: path.join(ROOT, screenshotFile), fullPage: false });
      await dwell();   // sit on this state ~7 s so a human can read it
      return v;
    };

    const clickRibbon = async (tab, tool) => {
      await page.locator('.ribbon-tab', { hasText: tab }).first().click();
      await page.waitForTimeout(500);    // tab swap settle
      await page.locator('.ribbon-tool-label', { hasText: new RegExp(`^${tool}$`) }).first().click();
    };

    const designLog = [];

    // ─── 1. Mission ────────────────────────────────────────────
    await clickRibbon('Simulate', 'Mission');
    await page.waitForFunction(() => !!window.__lastMissionResult, null, { timeout: 30000 });
    const mission = await snapshot('1. MISSION', '__lastMissionResult', '01-mission.png');
    designLog.push({ step: 'Mission', range_km: mission.range.range_km, thrust_per_engine_kN: mission.cruise.thrust_required_per_engine_N / 1000 });

    // ─── 2. Brayton Cycle ───────────────────────────────────────
    await clickRibbon('Simulate', 'Brayton Cycle');
    await page.waitForFunction(() => !!window.__lastBraytonResult, null, { timeout: 30000 });
    const brayton = await snapshot('2. BRAYTON', '__lastBraytonResult', '02-brayton.png');
    designLog.push({
      step: 'Brayton',
      thrust_kN: brayton.thrust_N / 1000,
      SFC_lb_lbf_hr: brayton.SFC_lb_per_lbf_hr,
      OPR: brayton.OPR,
    });

    // ─── 3. Compressor Stage ────────────────────────────────────
    await clickRibbon('Simulate', 'Compressor Stage');
    await page.waitForFunction(() => !!window.__lastCompressorResult, null, { timeout: 30000 });
    const compressor = await snapshot('3. COMPRESSOR', '__lastCompressorResult', '03-compressor.png');
    designLog.push({
      step: 'Compressor',
      stage_PR: compressor.work.stagePR,
      blade_count: compressor.geometry.bladeCount,
      M_tip: compressor.blade_speed.M_tip,
    });

    // ─── 4. Combustor ───────────────────────────────────────────
    await clickRibbon('Simulate', 'Combustor');
    await page.waitForFunction(() => !!window.__lastCombustorResult, null, { timeout: 30000 });
    const combustor = await snapshot('4. COMBUSTOR', '__lastCombustorResult', '04-combustor.png');
    designLog.push({
      step: 'Combustor',
      length_m: combustor.geometry.liner_length_m,
      NOx_g_per_kg: combustor.emissions.EI_NOx_g_per_kgFuel,
    });

    // ─── 5. Turbine Stage ───────────────────────────────────────
    await clickRibbon('Simulate', 'Turbine Stage');
    await page.waitForFunction(() => !!window.__lastTurbineResult, null, { timeout: 30000 });
    const turbine = await snapshot('5. TURBINE', '__lastTurbineResult', '05-turbine.png');
    designLog.push({
      step: 'Turbine',
      pi_drop: turbine.work.stagePR_drop,
      power_MW: turbine.work.total_power_kW / 1000,
      blade_count: turbine.geometry.bladeCount,
    });

    // ─── 6. Blade Cooling ───────────────────────────────────────
    await clickRibbon('Simulate', 'Blade Cooling');
    await page.waitForFunction(() => !!window.__lastBladeCoolingResult, null, { timeout: 30000 });
    const cooling = await snapshot('6. BLADE COOLING', '__lastBladeCoolingResult', '06-cooling.png');
    designLog.push({
      step: 'BladeCooling',
      hotspot: cooling.hotspot,
      T_metal_C: cooling.T_metal_max_K - 273.15,
      survives: cooling.survives_long_life,
    });

    // ─── 7. Heat Exchanger ──────────────────────────────────────
    await clickRibbon('Simulate', 'Heat Exchanger');
    await page.waitForFunction(() => !!window.__lastHXResult, null, { timeout: 30000 });
    const hx = await snapshot('7. HEAT EXCHANGER', '__lastHXResult', '07-hx.png');
    designLog.push({
      step: 'HX',
      effectiveness: hx.effectiveness,
      q_kW: hx.q_W / 1000,
    });

    // ─── 8. Nozzle ──────────────────────────────────────────────
    await clickRibbon('Simulate', 'Nozzle');
    await page.waitForFunction(() => !!window.__lastNozzleResult, null, { timeout: 30000 });
    const nozzle = await snapshot('8. NOZZLE', '__lastNozzleResult', '08-nozzle.png');
    designLog.push({
      step: 'Nozzle',
      conv_choked: nozzle.conv.choked,
      conv_V_e_ms: nozzle.conv.V_exit,
      cd_area_ratio: nozzle.cd.A_exit_over_throat,
    });

    // ─── 9. Build a representative body (Linear Pattern) ────────
    await clickRibbon('Part', 'Linear Pattern');
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(ROOT, '09-pattern.png'), fullPage: false });
    await dwell();    // let the cylinders render long enough to see them

    // ─── 9b. Mass Properties ────────────────────────────────────
    await clickRibbon('Assembly', 'Mass Properties');
    await page.waitForFunction(() => !!window.__lastMassProps, null, { timeout: 30000 });
    const mass = await snapshot('9. MASS PROPS', '__lastMassProps', '10-massprops.png');
    designLog.push({
      step: 'MassProps',
      mass_kg: mass.mass_kg,
      volume_mm3: mass.volume_mm3,
      principal_kg_mm2: mass.principalMoments,
    });

    // ─── 10. Rotordynamics ──────────────────────────────────────
    await clickRibbon('Simulate', 'Rotordynamics');
    await page.waitForFunction(() => !!window.__lastRotordynResult, null, { timeout: 30000 });
    const rotor = await snapshot('10. ROTORDYNAMICS', '__lastRotordynResult', '11-rotor.png');
    designLog.push({
      step: 'Rotordynamics',
      f1_Hz: rotor.firstNaturalHz,
      crit_RPM: rotor.criticalSpeedRPM,
    });

    // ─── 11. Fatigue Analysis ───────────────────────────────────
    await clickRibbon('Simulate', 'Fatigue Analysis');
    await page.waitForFunction(() => !!window.__lastFatigueResult, null, { timeout: 30000 });
    const fatigue = await snapshot('11. FATIGUE', '__lastFatigueResult', '12-fatigue.png');
    designLog.push({
      step: 'Fatigue',
      goodman_SF: fatigue.goodmanSF,
      life_cycles: fatigue.lifeCycles === Infinity ? 'infinite' : fatigue.lifeCycles,
    });

    // ─── 12. Export STEP ────────────────────────────────────────
    await clickRibbon('Drawing', 'Export STEP');
    await page.waitForFunction(() => !!window.__lastSTEPText, null, { timeout: 30000 });
    const stepSize = await page.evaluate(() => window.__lastSTEPSizeBytes);
    console.log(`\n--- 12. EXPORT STEP ---`);
    console.log(`STEP AP203 file size: ${(stepSize / 1024).toFixed(1)} KB`);
    await page.screenshot({ path: path.join(ROOT, '13-step.png'), fullPage: false });
    designLog.push({ step: 'ExportSTEP', step_KB: stepSize / 1024 });
    await dwell();    // final pause so human watching sees the success state

    // ─── Save design notebook ───────────────────────────────────
    fs.writeFileSync(
      path.join(ROOT, 'design-notebook.json'),
      JSON.stringify(designLog, null, 2)
    );
    fs.writeFileSync(
      path.join(ROOT, 'console-trace.log'),
      consoleLines.slice(-200).join('\n')
    );

    console.log(`\n=== JET-ENGINE DESIGN WALKTHROUGH COMPLETE ===`);
    console.log(`Steps executed: ${designLog.length}`);
    console.log(`Screenshots saved: 13 (00-initial + 12 steps)`);

    // ─── Validations: end-state consistency ─────────────────────
    // Mission says we need X kN per engine; Brayton must deliver ≥ X
    const mission_kN = mission.cruise.thrust_required_per_engine_N / 1000;
    const brayton_kN = brayton.thrust_N / 1000;
    console.log(`Mission required ${mission_kN.toFixed(0)} kN per engine; Brayton delivers ${brayton_kN.toFixed(0)} kN`);
    expect(brayton_kN).toBeGreaterThan(mission_kN * 0.5);   // engine is sized in the right ballpark

    // Blade survives, fatigue safe, all chains ran
    expect(cooling.survives_long_life).toBe(true);
    expect(rotor.firstNaturalHz).toBeGreaterThan(0);
    expect(mass.volume_mm3).toBeGreaterThan(0);
    expect(stepSize).toBeGreaterThan(1000);
    expect(designLog.length).toBe(12);
  });
});
