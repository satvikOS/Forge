import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = path.join(process.cwd(), 'engine-output', 'Trent1000');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function saveJSON(name, data) { fs.writeFileSync(path.join(OUTPUT_DIR, 'analysis', name), JSON.stringify(data, null, 2)); }
function saveText(name, content) { fs.writeFileSync(path.join(OUTPUT_DIR, name), content); }
function saveSubText(sub, name, content) {
  const dir = path.join(OUTPUT_DIR, sub);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, name), content);
}

test.setTimeout(900000);

test('Trent 1000: comprehensive engineering analysis', async ({ page }) => {
  ensureDir(path.join(OUTPUT_DIR, 'analysis'));
  ensureDir(path.join(OUTPUT_DIR, 'drawings'));
  ensureDir(path.join(OUTPUT_DIR, 'meshes'));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  console.log('\n========================================');
  console.log('  TRENT 1000 ENGINEERING ANALYSIS SUITE');
  console.log('========================================\n');

  // Run all analyses inside the browser using ArchDisc kernel
  const results = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const {
      Assembly, PrimitiveBuilder, RevolveFeature, ExtrudeFeature,
      Vec3, FastenerLibrary, FEAEngine, CFDEngine, TopologyOptimizer,
      MoldFlow, CostingEngine, Sustainability, DrawingEngine, Annotations,
      GCodeGenerator, ToolLibrary, FEAVisualizer, MATERIALS,
    } = m;

    const results = {};

    // ====================================================================
    // ANALYSIS 1: Fan Blade FEA — full bird strike load case
    // ====================================================================
    const fanBlade = PrimitiveBuilder.box(0.18, 1.40, 0.025);
    fanBlade.name = 'Fan Blade Ti-6Al-4V';
    const fanFEA = FEAEngine.linearStatic(fanBlade, {
      material: 'Titanium Ti-6Al-4V',
      loads: [{ type: 'force', magnitude: 50000, direction: new Vec3(0, -1, 0) }], // 50 kN bird strike
    });
    results.fanBladeFEA = {
      ...fanFEA.summary,
      meshElements: fanFEA.mesh.elementCount,
    };

    // ====================================================================
    // ANALYSIS 2: HP Turbine Blade FEA — high-temp + centrifugal
    // ====================================================================
    const hpTurbineBlade = PrimitiveBuilder.box(0.022, 0.085, 0.018);
    hpTurbineBlade.name = 'HPT Blade Inconel 718';
    const hptFEA = FEAEngine.linearStatic(hpTurbineBlade, {
      material: 'Inconel 718',
      loads: [{ type: 'force', magnitude: 12000, direction: new Vec3(0, 1, 0) }], // centrifugal at takeoff
    });
    results.hptBladeFEA = {
      ...hptFEA.summary,
      meshElements: hptFEA.mesh.elementCount,
    };

    // ====================================================================
    // ANALYSIS 3: HP Turbine Blade — Modal (vibration)
    // ====================================================================
    const hptModal = FEAEngine.modal(hpTurbineBlade, { material: 'Inconel 718' });
    results.hptBladeModal = {
      modes: hptModal.modes.slice(0, 5).map(m => ({
        mode: m.mode, freq: m.frequencyHz, type: m.type
      })),
      firstFreq: hptModal.modes[0].frequencyHz,
    };

    // ====================================================================
    // ANALYSIS 4: HP Turbine Blade — Thermal (gas inlet 1700K)
    // ====================================================================
    const hptThermal = FEAEngine.thermal(hpTurbineBlade, {
      material: 'Inconel 718',
      heatInput: 5000,         // 5 kW per blade
      ambientTemp: 1400,       // hot gas
      convectionCoeff: 5000,   // forced convection
    });
    results.hptThermal = hptThermal.summary;

    // ====================================================================
    // ANALYSIS 5: Fatigue on Fan Blade
    // ====================================================================
    const fanFatigue = FEAEngine.fatigue(fanBlade, {
      material: 'Titanium Ti-6Al-4V',
      loadAmplitude: 8000,
      meanLoad: 30000,
    });
    results.fanFatigue = fanFatigue.summary;

    // ====================================================================
    // ANALYSIS 6: CFD — Bypass duct flow
    // ====================================================================
    const fanCase = PrimitiveBuilder.cylinder(1.425, 0.65, 64);
    const cfdResult = CFDEngine.analyze({
      solid: fanCase,
      fluid: 'air',
      inletVelocity: 250,    // ~Mach 0.75 at takeoff
      flowDirection: '+z',
    });
    results.bypassCFD = {
      reynolds: cfdResult.reynolds,
      regime: cfdResult.regime,
      Cd: cfdResult.dragCoefficient,
      dragForceN: cfdResult.dragForceN,
      stagnationPressurePa: cfdResult.stagnationPressurePa,
      massFlowRateKgS: cfdResult.massFlowRateKgS,
      volumetricFlowM3h: cfdResult.volumetricFlowM3h,
    };

    // ====================================================================
    // ANALYSIS 7: Topology Optimization — Engine Mount
    // ====================================================================
    const mountOpt = TopologyOptimizer.optimize({
      bbox: { minX: -0.075, maxX: 0.075, minY: 0.0, maxY: 0.300, minZ: 0.75, maxZ: 2.25 },
      volumeFraction: 0.35,
      loadPoints: [
        { x: 0, y: 0.0, z: 1.000, force: { x: 0, y: -1, z: 0 } },  // engine weight 60 kN
        { x: 0, y: 0.0, z: 2.000, force: { x: 0, y: -1, z: 0.5 } },  // thrust + thrust reverse
      ],
      fixedPoints: [
        { x: 0, y: 0.300, z: 1.000 },
        { x: 0, y: 0.300, z: 2.000 },
      ],
      resolution: 24,
      iterations: 25,
      penalty: 3,
    });
    results.mountTopology = mountOpt.stats;

    // ====================================================================
    // ANALYSIS 8: Mold Flow — Fan Cowling Composite
    // ====================================================================
    const fanCowl = PrimitiveBuilder.cylinder(1.480, 1.500, 64);
    const moldFlow = MoldFlow.analyze(fanCowl, {
      material: 'Polycarbonate',  // representative; real is composite layup
      wallThickness: 0.005,
      injectionPressure: 150e6,
    });
    results.cowlingMoldFlow = moldFlow.summary;

    // ====================================================================
    // ANALYSIS 9: Costing — Fan Blade
    // ====================================================================
    const fanProps = fanBlade.massProperties();
    const fanCost = CostingEngine.analyze({
      massKg: fanProps.mass,
      material: 'Titanium Ti-6Al-4V',
      machineTimeMin: 480,  // 8 hrs of 5-axis machining
      process: 'cnc_5axis',
      setupTimeMin: 240,
      finishing: 'polish',
      toolingCostUSD: 50000,
      batchSize: 18,
      marginPercent: 35,
    });
    results.fanBladeCost = fanCost.perPart;

    // Engine total cost (all sections — rough)
    const engineParts = [
      { name: 'Fan Blade', count: 18, mass: fanProps.mass, mat: 'Titanium Ti-6Al-4V', time: 480 },
      { name: 'HPT Blade', count: 76, mass: 0.000020, mat: 'Inconel 718', time: 720 }, // single crystal
      { name: 'IPT Blade', count: 80, mass: 0.000035, mat: 'Inconel 718', time: 480 },
      { name: 'LPT Blade', count: 732, mass: 0.000060, mat: 'Inconel 718', time: 240 },
      { name: 'Compressor Blade', count: 832, mass: 0.000015, mat: 'Titanium Ti-6Al-4V', time: 90 },
    ];
    let totalEngineCost = 0;
    const engineCostBreakdown = [];
    for (const p of engineParts) {
      const c = CostingEngine.analyze({
        massKg: p.mass, material: p.mat,
        machineTimeMin: p.time, process: 'cnc_5axis',
        setupTimeMin: 60, finishing: 'polish',
        batchSize: p.count, marginPercent: 30,
      });
      const sectionCost = parseFloat(c.batch.totalCost);
      totalEngineCost += sectionCost;
      engineCostBreakdown.push({
        section: p.name, count: p.count, unitCost: c.perPart.totalCost, sectionCost: sectionCost.toFixed(2)
      });
    }
    results.engineCost = {
      breakdown: engineCostBreakdown,
      totalUSD: totalEngineCost.toFixed(2),
      // Real Trent 1000 list price ~$30M; our partial estimate reflects only blade machining
    };

    // ====================================================================
    // ANALYSIS 10: Sustainability — Full Engine
    // ====================================================================
    // Aggregate mass (rough estimate based on part counts)
    let totalEngineMassKg = 0;
    totalEngineMassKg += 18 * fanProps.mass;
    const ipcBlade = PrimitiveBuilder.box(0.018, 0.13, 0.015);
    totalEngineMassKg += 832 * ipcBlade.massProperties(MATERIALS['Titanium Ti-6Al-4V'].density).mass;
    totalEngineMassKg += 76 * 0.000020 * 8190; // HPT
    totalEngineMassKg += 80 * 0.000035 * 8190; // IPT
    totalEngineMassKg += 732 * 0.000060 * 8190; // LPT
    // Bulk components
    totalEngineMassKg += 500; // shafts, disks, casings, etc

    const sustainability = Sustainability.analyze({
      massKg: totalEngineMassKg,
      material: 'Inconel 718',
      process: 'cnc_5axis',
      transportKm: 8000, // global supply chain
      region: 'EU',
    });
    results.sustainability = {
      totalEngineMassKg: totalEngineMassKg.toFixed(1),
      ...sustainability.total,
      breakdown: sustainability.breakdown,
      recyclability: sustainability.recyclability,
    };

    // ====================================================================
    // ANALYSIS 11: G-Code for Fan Blade Manufacturing
    // ====================================================================
    const tool = ToolLibrary.createTool('endmill_ball', 0.006, null, 4);
    const sf = ToolLibrary.recommendSpeedsFeeds(tool, 'Titanium Ti-6Al-4V');
    const gcode = GCodeGenerator.pocketMill(fanBlade, {
      toolDiameter: tool.diameter,
      feedRate: sf.feedRate,
      spindleSpeed: sf.rpm,
      depthOfCut: sf.depthOfCut * 0.5,
      stepover: 0.30,
    });
    results.fanBladeGCode = {
      tool: tool.typeName,
      diameterMm: tool.diameterMm,
      flutes: tool.flutes,
      rpm: sf.rpm,
      feedRate: sf.feedRate,
      ...gcode.stats,
    };

    // ====================================================================
    // ANALYSIS 12: Drawing — Fan Blade A3 Sheet
    // ====================================================================
    const fanBladeSheet = DrawingEngine.generateSheet(fanBlade, {
      partName: 'TRENT 1000 — FAN BLADE',
      drawnBy: 'ArchDisc',
      sheetSize: 'A3',
    });
    results.fanBladeDrawingBytes = fanBladeSheet.length;

    // Drawing for HPT blade
    const hptSheet = DrawingEngine.generateSheet(hpTurbineBlade, {
      partName: 'TRENT 1000 — HPT BLADE (CMC)',
      drawnBy: 'ArchDisc',
      sheetSize: 'A3',
    });

    return {
      results,
      fanBladeSVG: fanBladeSheet,
      hptBladeSVG: hptSheet,
      gcodeText: gcode.gcode,
    };
  });

  // Print analysis summary
  const r = results.results;
  console.log('--- ANALYSIS RESULTS ---\n');

  console.log('1. FAN BLADE FEA (50kN bird strike):');
  console.log(`   Max stress: ${r.fanBladeFEA.maxStressMPa} MPa | SF: ${r.fanBladeFEA.safetyFactor} | Mass: ${r.fanBladeFEA.massKg} kg`);

  console.log('\n2. HPT BLADE FEA (12kN centrifugal):');
  console.log(`   Max stress: ${r.hptBladeFEA.maxStressMPa} MPa | SF: ${r.hptBladeFEA.safetyFactor} | Mass: ${r.hptBladeFEA.massKg} kg`);

  console.log('\n3. HPT BLADE MODAL (vibration safety):');
  for (const m of r.hptBladeModal.modes) {
    console.log(`   Mode ${m.mode}: ${m.freq} Hz (${m.type})`);
  }

  console.log('\n4. HPT BLADE THERMAL (1400K gas):');
  console.log(`   Max temp: ${r.hptThermal.maxTempC}°C | Min: ${r.hptThermal.minTempC}°C | Stress: ${r.hptThermal.thermalStressMPa} MPa | ${r.hptThermal.safeForMaterial ? 'SAFE' : 'HIGH'}`);

  console.log('\n5. FAN FATIGUE:');
  console.log(`   ${r.fanFatigue.life} | SF: ${r.fanFatigue.safetyFactor} | ${r.fanFatigue.pass ? 'PASS' : 'FAIL'}`);

  console.log('\n6. BYPASS CFD (Mach 0.75):');
  console.log(`   Re: ${parseFloat(r.bypassCFD.reynolds).toExponential(2)} | ${r.bypassCFD.regime} | Cd: ${r.bypassCFD.Cd} | Drag: ${r.bypassCFD.dragForceN} N | Flow: ${r.bypassCFD.massFlowRateKgS} kg/s`);

  console.log('\n7. ENGINE MOUNT TOPOLOGY OPT:');
  console.log(`   Mass reduction: ${r.mountTopology.massReductionPercent}% | Cells: ${r.mountTopology.totalCells} (${r.mountTopology.keptCells} kept) | Vol: ${r.mountTopology.optimizedVolumeMm3} mm³`);

  console.log('\n8. FAN COWLING MOLD FLOW:');
  console.log(`   Cycle: ${r.cowlingMoldFlow.maxStressMPa || 'N/A'} | ${r.cowlingMoldFlow.pass !== undefined ? (r.cowlingMoldFlow.pass ? 'PASS' : r.cowlingMoldFlow.summary) : ''}`);

  console.log('\n9. FAN BLADE COST:');
  console.log(`   Material: $${r.fanBladeCost.materialCost} | Machining: $${r.fanBladeCost.machiningCost} | Total: $${r.fanBladeCost.totalCost} | Sell: $${r.fanBladeCost.sellPrice}`);

  console.log('\n10. ENGINE COST (blade machining only):');
  for (const e of r.engineCost.breakdown) {
    console.log(`    ${e.section.padEnd(18)}: ${e.count.toString().padStart(4)} × $${e.unitCost.padStart(10)} = $${e.sectionCost}`);
  }
  console.log(`    TOTAL: $${parseFloat(r.engineCost.totalUSD).toLocaleString()}`);

  console.log('\n11. ENGINE SUSTAINABILITY:');
  console.log(`    Mass: ${r.sustainability.totalEngineMassKg} kg | CO₂e: ${r.sustainability.co2eKg} kg | Energy: ${r.sustainability.energyKWh} kWh`);
  console.log(`    Score: ${r.sustainability.score}/100 (${r.sustainability.rating}) | Recyclable: ${r.sustainability.recyclability.recyclablePercent}%`);

  console.log('\n12. FAN BLADE G-CODE:');
  console.log(`    Tool: ${r.fanBladeGCode.tool} Ø${r.fanBladeGCode.diameterMm}mm × ${r.fanBladeGCode.flutes} flute @ ${r.fanBladeGCode.rpm} RPM × ${r.fanBladeGCode.feedRate} mm/min`);
  console.log(`    G-code lines: ${r.fanBladeGCode.lines} | Cycle time: ${r.fanBladeGCode.cycleTimeMin} min`);

  console.log('\n13. DRAWINGS:');
  console.log(`    Fan Blade A3: ${r.fanBladeDrawingBytes.toLocaleString()} bytes SVG`);

  // Save all outputs to disk
  saveJSON('full-results.json', r);
  saveSubText('drawings', 'Fan-Blade-A3.svg', results.fanBladeSVG);
  saveSubText('drawings', 'HPT-Blade-A3.svg', results.hptBladeSVG);
  saveSubText('analysis', 'Fan-Blade-Toolpath.nc', results.gcodeText);

  // Generate human-readable report
  const report = `ROLLS-ROYCE TRENT 1000 — ARCHDISC ENGINEERING REPORT
=====================================================
Generated: ${new Date().toISOString()}
Platform: ArchDisc (Mechanical CAD)

STRUCTURAL ANALYSIS
-------------------
1. FAN BLADE (Titanium Ti-6Al-4V)
   - 50 kN bird strike load case
   - Max stress: ${r.fanBladeFEA.maxStressMPa} MPa
   - Yield strength: ${r.fanBladeFEA.yieldStrengthMPa} MPa
   - Safety factor: ${r.fanBladeFEA.safetyFactor}
   - Mass: ${r.fanBladeFEA.massKg} kg
   - Mesh: ${r.fanBladeFEA.meshElements || 'N/A'} tetrahedral elements

2. HP TURBINE BLADE (Inconel 718)
   - 12 kN centrifugal load (takeoff)
   - Max stress: ${r.hptBladeFEA.maxStressMPa} MPa
   - Safety factor: ${r.hptBladeFEA.safetyFactor}
   - Mass per blade: ${r.hptBladeFEA.massKg} kg

3. HPT MODAL ANALYSIS (vibration check)
${r.hptBladeModal.modes.map(m => `   Mode ${m.mode}: ${m.freq} Hz (${m.type})`).join('\n')}

4. HPT THERMAL ANALYSIS (1400K gas inlet)
   - Max temp: ${r.hptThermal.maxTempC}°C
   - Min temp: ${r.hptThermal.minTempC}°C
   - Thermal stress: ${r.hptThermal.thermalStressMPa} MPa
   - Material safe: ${r.hptThermal.safeForMaterial}

5. FAN FATIGUE
   - Life: ${r.fanFatigue.life}
   - Safety factor: ${r.fanFatigue.safetyFactor}
   - Status: ${r.fanFatigue.pass ? 'PASS' : 'FAIL'}

FLUID DYNAMICS
--------------
6. BYPASS DUCT CFD (Mach 0.75 air)
   - Reynolds: ${r.bypassCFD.reynolds}
   - Flow regime: ${r.bypassCFD.regime}
   - Drag coefficient: ${r.bypassCFD.Cd}
   - Drag force: ${r.bypassCFD.dragForceN} N
   - Mass flow rate: ${r.bypassCFD.massFlowRateKgS} kg/s
   - Volumetric flow: ${r.bypassCFD.volumetricFlowM3h} m³/h

OPTIMIZATION
------------
7. ENGINE MOUNT TOPOLOGY OPTIMIZATION
   - Mass reduction: ${r.mountTopology.massReductionPercent}%
   - Voxels: ${r.mountTopology.totalCells} total, ${r.mountTopology.keptCells} kept
   - Original volume: ${r.mountTopology.originalVolumeMm3} mm³
   - Optimized volume: ${r.mountTopology.optimizedVolumeMm3} mm³

MANUFACTURING
-------------
8. FAN COWLING MOLD FLOW
${Object.entries(r.cowlingMoldFlow).map(([k,v]) => `   ${k}: ${v}`).join('\n')}

9. FAN BLADE 5-AXIS G-CODE
   - Tool: ${r.fanBladeGCode.tool} Ø${r.fanBladeGCode.diameterMm}mm × ${r.fanBladeGCode.flutes} flute
   - Spindle: ${r.fanBladeGCode.rpm} RPM
   - Feed: ${r.fanBladeGCode.feedRate} mm/min
   - G-code lines: ${r.fanBladeGCode.lines}
   - Cycle time: ${r.fanBladeGCode.cycleTimeMin} min
   - Total moves: ${r.fanBladeGCode.moves}

COSTING
-------
10. FAN BLADE PER-PART COST (Ti-6Al-4V, 5-axis CNC, polish, batch 18)
    - Material:    $${r.fanBladeCost.materialCost}
    - Machining:   $${r.fanBladeCost.machiningCost}
    - Setup:       $${r.fanBladeCost.setupCost}
    - Tooling:     $${r.fanBladeCost.toolingCost}
    - Finishing:   $${r.fanBladeCost.finishingCost}
    - Overhead:    $${r.fanBladeCost.overhead}
    - Total cost:  $${r.fanBladeCost.totalCost}
    - Sell price:  $${r.fanBladeCost.sellPrice}

11. ENGINE COST (blade machining contribution)
${r.engineCost.breakdown.map(e => `    ${e.section.padEnd(20)} ${e.count.toString().padStart(5)} × $${e.unitCost.padStart(10)} = $${e.sectionCost}`).join('\n')}
    --------------------------------------------------------
    TOTAL BLADE MACHINING: $${parseFloat(r.engineCost.totalUSD).toLocaleString()}

SUSTAINABILITY
--------------
12. CARBON FOOTPRINT (cradle-to-gate + transport + EOL)
    - Engine mass: ${r.sustainability.totalEngineMassKg} kg
    - Total CO₂e: ${r.sustainability.co2eKg} kg
    - Total energy: ${r.sustainability.energyKWh} kWh
    - Score: ${r.sustainability.score}/100 (Rating: ${r.sustainability.rating})
    - Recyclable: ${r.sustainability.recyclability.recyclablePercent}%
    - Recycled content: ${r.sustainability.recyclability.currentRecycledContent}%
    Breakdown:
${r.sustainability.breakdown.map(b => `      ${b.label.padEnd(15)}: ${b.co2eGrams} g CO₂e (${b.percent}%)`).join('\n')}

ARTIFACTS
---------
- drawings/Fan-Blade-A3.svg
- drawings/HPT-Blade-A3.svg
- analysis/Fan-Blade-Toolpath.nc (G-code)
- analysis/full-results.json
- construction-log.json
- engine-summary.json

=====================================================
END OF REPORT
`;

  saveText('REPORT.txt', report);
  console.log('\n--- ARTIFACTS SAVED ---');
  console.log(`  ${OUTPUT_DIR}\\REPORT.txt`);
  console.log(`  ${OUTPUT_DIR}\\drawings\\Fan-Blade-A3.svg`);
  console.log(`  ${OUTPUT_DIR}\\drawings\\HPT-Blade-A3.svg`);
  console.log(`  ${OUTPUT_DIR}\\analysis\\Fan-Blade-Toolpath.nc`);
  console.log(`  ${OUTPUT_DIR}\\analysis\\full-results.json`);

  expect(parseFloat(r.fanBladeFEA.maxStressMPa)).toBeGreaterThan(0);
  expect(parseFloat(r.bypassCFD.reynolds)).toBeGreaterThan(1e5);
  expect(parseFloat(r.mountTopology.massReductionPercent)).toBeGreaterThan(50);
});
