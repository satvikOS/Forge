/**
 * ArchDisc — Sustainability Analyzer
 *
 * Computes carbon footprint, recyclability, and energy consumption
 * for parts and assemblies. Uses cradle-to-gate emission factors.
 *
 * Data sources: ICE Database, Granta MI, Carbon Trust, ISO 14040.
 */

const MATERIAL_FOOTPRINTS = {
  // kg CO2e per kg material (cradle-to-gate)
  'Aluminum 6061-T6':       { co2: 11.5, energy: 155, recyclable: 0.95, recycled: 0.65, source: 'primary' },
  'Aluminum 7075-T6':       { co2: 12.0, energy: 162, recyclable: 0.95, recycled: 0.55, source: 'primary' },
  'Steel AISI 1020':        { co2: 1.95, energy: 21,  recyclable: 0.98, recycled: 0.85, source: 'mixed' },
  'Steel AISI 4340':        { co2: 2.30, energy: 24,  recyclable: 0.98, recycled: 0.70, source: 'mixed' },
  'Stainless Steel 316':    { co2: 6.15, energy: 75,  recyclable: 0.95, recycled: 0.60, source: 'mixed' },
  'Stainless Steel 304':    { co2: 5.80, energy: 70,  recyclable: 0.95, recycled: 0.65, source: 'mixed' },
  'Titanium Ti-6Al-4V':     { co2: 35.0, energy: 470, recyclable: 0.85, recycled: 0.30, source: 'primary' },
  'Copper C11000':          { co2: 4.50, energy: 60,  recyclable: 0.98, recycled: 0.80, source: 'mixed' },
  'Brass C26000':           { co2: 4.80, energy: 62,  recyclable: 0.95, recycled: 0.75, source: 'mixed' },
  'Cast Iron':              { co2: 1.80, energy: 19,  recyclable: 0.95, recycled: 0.85, source: 'mixed' },
  'Inconel 718':            { co2: 14.5, energy: 220, recyclable: 0.85, recycled: 0.40, source: 'primary' },
  'ABS Plastic':            { co2: 3.20, energy: 95,  recyclable: 0.50, recycled: 0.10, source: 'primary' },
  'Nylon 6/6':              { co2: 7.50, energy: 125, recyclable: 0.40, recycled: 0.05, source: 'primary' },
  'Polycarbonate':          { co2: 5.50, energy: 110, recyclable: 0.45, recycled: 0.10, source: 'primary' },
  'PLA':                    { co2: 1.80, energy: 50,  recyclable: 0.30, recycled: 0.02, source: 'biobased', biobased: true },
  'PEEK':                   { co2: 12.5, energy: 220, recyclable: 0.30, recycled: 0.02, source: 'primary' },
  'Carbon Fiber Composite': { co2: 24.0, energy: 295, recyclable: 0.20, recycled: 0.00, source: 'primary' },
  'Magnesium AZ31':         { co2: 35.0, energy: 365, recyclable: 0.92, recycled: 0.45, source: 'primary' },
};

const PROCESS_ENERGY = {
  // MJ per kg material processed (machining energy)
  cnc_3axis: 8.5,
  cnc_5axis: 14.0,
  cnc_lathe: 6.0,
  injection_mold: 5.5,
  fdm_3dprint: 25.0,    // 3D printing very energy-intensive
  sla_3dprint: 32.0,
  sls_3dprint: 60.0,
  laser_cut: 12.0,
  waterjet: 18.0,
  grinder: 9.0,
};

// Grid CO2 intensity by region (kg CO2 per kWh)
const GRID_INTENSITY = {
  global_avg: 0.475,
  EU: 0.255,
  US_avg: 0.385,
  China: 0.581,
  India: 0.708,
  norway: 0.018, // hydroelectric
  france: 0.052, // nuclear-heavy
};

export { MATERIAL_FOOTPRINTS, PROCESS_ENERGY, GRID_INTENSITY };

export default class Sustainability {

  /**
   * Comprehensive sustainability analysis for a part.
   * @param {object} options
   * @param {number} options.massKg
   * @param {string} options.material
   * @param {string} options.process
   * @param {number} options.transportKm - distance to customer
   * @param {string} options.region - power grid region
   */
  static analyze(options = {}) {
    const massKg = options.massKg || 0.1;
    const material = options.material || 'Aluminum 6061-T6';
    const process = options.process || 'cnc_3axis';
    const transportKm = options.transportKm || 500;
    const region = options.region || 'global_avg';

    const matFP = MATERIAL_FOOTPRINTS[material] || MATERIAL_FOOTPRINTS['Aluminum 6061-T6'];
    const procEnergy = PROCESS_ENERGY[process] || 8.5;
    const gridCO2 = GRID_INTENSITY[region] || 0.475;

    // Material CO2 (cradle-to-gate)
    const materialCO2 = massKg * matFP.co2;
    const materialMJ = massKg * matFP.energy;

    // Manufacturing CO2 (energy × grid intensity)
    const procEnergyMJ = massKg * procEnergy;
    const procEnergyKWh = procEnergyMJ / 3.6;
    const processCO2 = procEnergyKWh * gridCO2;

    // Transport (truck, ~0.062 kg CO2 per kg per km, ~0.025 for short rail/ship)
    const transportCO2 = massKg * transportKm * 0.000062;

    // End-of-life: recyclability
    const recyclableKg = massKg * matFP.recyclable;
    const wasteKg = massKg * (1 - matFP.recyclable);
    const eolCO2 = wasteKg * 0.5; // landfill emissions

    const totalCO2 = materialCO2 + processCO2 + transportCO2 + eolCO2;

    // Score: lower = better. Compared to typical CNC aluminum part baseline
    const baseline = 0.150 * 11.5 + 0.150 * 8.5 / 3.6 * 0.475; // 150g aluminum baseline
    const score = Math.max(0, Math.min(100, (1 - totalCO2 / (baseline * 5)) * 100));

    // Identify dominant contributor
    const breakdown = [
      { label: 'Material', co2: materialCO2 },
      { label: 'Manufacturing', co2: processCO2 },
      { label: 'Transport', co2: transportCO2 },
      { label: 'End-of-Life', co2: eolCO2 },
    ];
    breakdown.sort((a, b) => b.co2 - a.co2);
    const dominant = breakdown[0];

    return {
      total: {
        co2eKg: totalCO2.toFixed(4),
        co2eGrams: (totalCO2 * 1000).toFixed(2),
        energyMJ: (materialMJ + procEnergyMJ).toFixed(2),
        energyKWh: ((materialMJ + procEnergyMJ) / 3.6).toFixed(2),
        score: score.toFixed(0),
        rating: score > 75 ? 'A' : score > 60 ? 'B' : score > 40 ? 'C' : score > 20 ? 'D' : 'E',
      },
      breakdown: breakdown.map(b => ({
        label: b.label,
        co2eGrams: (b.co2 * 1000).toFixed(2),
        percent: ((b.co2 / totalCO2) * 100).toFixed(1),
      })),
      dominant: dominant.label,
      recyclability: {
        material: material,
        recyclablePercent: (matFP.recyclable * 100).toFixed(0),
        currentRecycledContent: (matFP.recycled * 100).toFixed(0),
        recyclableMassKg: recyclableKg.toFixed(4),
        wasteMassKg: wasteKg.toFixed(4),
        biobased: !!matFP.biobased,
      },
      params: { massKg, material, process, transportKm, region, gridCO2intensity: gridCO2 },
    };
  }

  /**
   * Suggest material substitutions to reduce footprint.
   */
  static suggestAlternatives(currentOptions) {
    const alternatives = [
      'Aluminum 6061-T6', 'Steel AISI 1020', 'Stainless Steel 316',
      'PLA', 'ABS Plastic', 'Nylon 6/6',
    ];

    const baseline = Sustainability.analyze(currentOptions);
    const baselineCO2 = parseFloat(baseline.total.co2eKg);

    const results = alternatives
      .filter(alt => alt !== currentOptions.material)
      .map(alt => {
        const r = Sustainability.analyze({ ...currentOptions, material: alt });
        const co2 = parseFloat(r.total.co2eKg);
        const reduction = ((baselineCO2 - co2) / baselineCO2 * 100);
        return {
          material: alt,
          co2eKg: co2.toFixed(4),
          reductionPercent: reduction.toFixed(1),
          rating: r.total.rating,
          recyclablePercent: r.recyclability.recyclablePercent,
        };
      })
      .sort((a, b) => parseFloat(b.reductionPercent) - parseFloat(a.reductionPercent));

    return {
      current: { material: currentOptions.material, co2eKg: baselineCO2.toFixed(4), rating: baseline.total.rating },
      alternatives: results,
      bestAlternative: results[0],
    };
  }

  /**
   * Compute lightweighting opportunity: how much CO2 saved per gram removed.
   */
  static lightweightSensitivity(options) {
    const base = Sustainability.analyze(options);
    const reduced = Sustainability.analyze({ ...options, massKg: options.massKg * 0.9 });
    const baseCO2 = parseFloat(base.total.co2eKg);
    const redCO2 = parseFloat(reduced.total.co2eKg);
    const savings = baseCO2 - redCO2;
    return {
      baseMassKg: options.massKg,
      reducedMassKg: options.massKg * 0.9,
      co2SavedPer10pctReduction: savings.toFixed(4),
      co2SavedPerGram: (savings / (options.massKg * 100)).toFixed(6),
    };
  }
}
