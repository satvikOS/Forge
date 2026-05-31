/**
 * ArchDisc — Mold Flow Analysis (simplified)
 *
 * Simulates injection molding fill, cooling, and warpage.
 * Uses simplified flow model: fill front advances at uniform velocity
 * from gate location, with pressure drop and cooling time estimates.
 *
 * Real production mold flow uses Hele-Shaw equations and FEA mesh.
 * This module provides realistic-magnitude estimates.
 */

const PLASTIC_MATERIALS = {
  'ABS': { meltTemp: 230, moldTemp: 60, density: 1040, thermalDiff: 1.1e-7, viscosity: 700 },
  'PLA': { meltTemp: 200, moldTemp: 30, density: 1240, thermalDiff: 1.4e-7, viscosity: 600 },
  'Nylon 6/6': { meltTemp: 280, moldTemp: 80, density: 1140, thermalDiff: 1.3e-7, viscosity: 800 },
  'Polycarbonate': { meltTemp: 300, moldTemp: 90, density: 1200, thermalDiff: 1.3e-7, viscosity: 900 },
  'Polypropylene': { meltTemp: 220, moldTemp: 40, density: 905, thermalDiff: 1.5e-7, viscosity: 500 },
  'PEEK': { meltTemp: 380, moldTemp: 170, density: 1320, thermalDiff: 0.9e-7, viscosity: 1200 },
};

export { PLASTIC_MATERIALS };

export default class MoldFlow {

  /**
   * Run mold flow analysis on a solid part.
   * @param {TopoSolid} solid - Part geometry
   * @param {object} options - { material, gateLocation, injectionPressure, wallThickness }
   * @returns {object} flow analysis results
   */
  static analyze(solid, options = {}) {
    const materialName = options.material || 'ABS';
    const mat = PLASTIC_MATERIALS[materialName] || PLASTIC_MATERIALS.ABS;

    const bbox = solid.boundingBox();
    const size = bbox.size();
    const volume = solid.volume();
    const surfaceArea = solid.surfaceArea();
    const wallThickness = options.wallThickness || 0.002; // 2mm typical

    // Flow length: longest path from gate to extremity
    const flowLength = Math.max(size.x, size.y, size.z);
    const gateLocation = options.gateLocation || bbox.center();

    // Fill time: simplified — based on flow length, viscosity, pressure
    const injectionPressure = options.injectionPressure || 100e6; // 100 MPa typical
    const flowRate = (injectionPressure * wallThickness ** 3) / (12 * mat.viscosity * flowLength);
    const fillTime = volume / Math.max(flowRate, 1e-9);

    // Pressure drop along flow path: ΔP = 12 × η × Q × L / h³
    const pressureDrop = 12 * mat.viscosity * flowRate * flowLength / (wallThickness ** 3);

    // Cooling time (approximate Stefan-Boltzmann simplification):
    // τ = h² / (π² × α) × ln((T_melt - T_mold) × 4 / π / (T_eject - T_mold))
    const Tmelt = mat.meltTemp;
    const Tmold = mat.moldTemp;
    const Teject = (Tmelt + Tmold) / 2 + 20; // typical eject temp
    const coolingTime = (wallThickness ** 2) / (Math.PI ** 2 * mat.thermalDiff) *
      Math.log((Tmelt - Tmold) * 4 / Math.PI / Math.max(Teject - Tmold, 1));

    // Cycle time = fill + cool + eject (open/close ~3s typical)
    const cycleTime = fillTime + coolingTime + 3.0;

    // Clamping force: rough estimate F = P × projected area (kN)
    const projectedArea = size.x * size.z; // assume Y is mold opening direction
    const clampForceKN = injectionPressure * projectedArea / 1000;

    // Warpage estimate: thicker walls = less warp, longer flow = more warp
    const warpageMm = (flowLength * 0.001 / wallThickness) * 0.5;

    // Shrinkage (typical 0.5-2% by material)
    const shrinkageMap = { ABS: 0.006, PLA: 0.003, 'Nylon 6/6': 0.018, Polycarbonate: 0.006, Polypropylene: 0.020, PEEK: 0.012 };
    const shrinkage = shrinkageMap[materialName] || 0.006;

    // Quality assessment
    const issues = [];
    if (cycleTime > 60) issues.push('Long cycle (>60s)');
    if (pressureDrop > injectionPressure * 0.8) issues.push('Pressure drop too high — increase wall or shorten flow');
    if (warpageMm > wallThickness * 1000 * 0.05) issues.push(`Warpage ${warpageMm.toFixed(2)}mm risk`);
    if (wallThickness < 0.0008) issues.push('Wall <0.8mm risks short shot');

    return {
      material: materialName,
      materialProperties: mat,
      partVolumeMm3: (volume * 1e9).toFixed(2),
      partAreaCm2: (surfaceArea * 1e4).toFixed(2),
      wallThicknessMm: (wallThickness * 1000).toFixed(2),
      flowLengthMm: (flowLength * 1000).toFixed(2),
      gateLocation: { x: gateLocation.x, y: gateLocation.y, z: gateLocation.z },

      fillTimeSec: fillTime.toFixed(3),
      coolingTimeSec: coolingTime.toFixed(2),
      cycleTimeSec: cycleTime.toFixed(2),

      injectionPressureMPa: (injectionPressure / 1e6).toFixed(1),
      pressureDropMPa: (pressureDrop / 1e6).toFixed(1),

      clampForceKN: clampForceKN.toFixed(1),
      clampForceTons: (clampForceKN / 9.81).toFixed(1),

      warpageMm: warpageMm.toFixed(3),
      shrinkagePercent: (shrinkage * 100).toFixed(2),

      meltTempC: mat.meltTemp,
      moldTempC: mat.moldTemp,
      ejectTempC: Teject.toFixed(0),

      issues,
      pass: issues.length === 0,
      summary: issues.length === 0 ? 'OK' : `${issues.length} issue(s)`,
    };
  }

  /**
   * Estimate per-cavity costs and tooling.
   */
  static toolingEstimate(solid, options = {}) {
    const bbox = solid.boundingBox();
    const size = bbox.size();
    const volume = solid.volume();
    const cavities = options.cavities || 1;
    const annualVolume = options.annualVolume || 50000;

    const flow = MoldFlow.analyze(solid, options);

    // Tool cost: scales with size + complexity (rough)
    const surfaceArea = solid.surfaceArea();
    const toolCostUSD = 8000 + surfaceArea * 5e6 + cavities * 3000;

    // Per-part cost
    const matCost = volume * (flow.materialProperties?.density || 1200) * 3.5; // $3.5/kg
    const cycleTime = parseFloat(flow.cycleTimeSec);
    const machineRate = 0.025; // $/sec
    const partCost = matCost + (cycleTime / cavities) * machineRate;

    // Break-even
    const breakEvenUnits = Math.ceil(toolCostUSD / Math.max(partCost, 0.01));

    return {
      toolCostUSD: toolCostUSD.toFixed(2),
      partCostUSD: partCost.toFixed(4),
      cavities,
      cycleTimeSec: cycleTime.toFixed(2),
      throughputPerHour: Math.floor(3600 / cycleTime * cavities),
      breakEvenUnits,
      annualUnits: annualVolume,
      profitable: annualVolume > breakEvenUnits,
    };
  }
}
