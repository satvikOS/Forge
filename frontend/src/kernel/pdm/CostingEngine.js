/**
 * ArchDisc — Should-Cost Analysis Engine
 *
 * Comprehensive cost estimation: material + machining + setup + tooling +
 * finishing + overhead + margin. Supports batch pricing curves.
 */

const MATERIAL_COSTS_PER_KG = {
  // USD per kg (typical 2026 spot prices)
  'Aluminum 6061-T6': 6.50,
  'Aluminum 7075-T6': 9.00,
  'Steel AISI 1020': 1.80,
  'Steel AISI 4340': 4.20,
  'Stainless Steel 316': 8.50,
  'Stainless Steel 304': 6.80,
  'Titanium Ti-6Al-4V': 95.00,
  'Copper C11000': 12.00,
  'Brass C26000': 11.50,
  'Cast Iron': 1.20,
  'Inconel 718': 75.00,
  'ABS Plastic': 3.20,
  'Nylon 6/6': 4.80,
  'Polycarbonate': 5.50,
  'PEEK': 110.00,
  'Carbon Fiber Composite': 45.00,
  'Magnesium AZ31': 8.00,
};

const MACHINE_RATES = {
  // USD per hour (loaded shop rate including operator + overhead)
  manual_mill: 65,
  cnc_3axis: 85,
  cnc_5axis: 145,
  lathe_manual: 60,
  cnc_lathe: 95,
  mill_turn: 175,
  edm_wire: 110,
  edm_sinker: 125,
  grinder: 90,
  fdm_3dprint: 25,
  sla_3dprint: 45,
  sls_3dprint: 95,
  injection_mold: 130,
  laser_cut: 80,
  waterjet: 95,
};

const FINISHING_COSTS = {
  none: { rate: 0, name: 'As Machined' },
  deburr: { rate: 0.50, name: 'Manual Deburring (per part)' },
  bead_blast: { rate: 1.20, name: 'Bead Blast' },
  anodize_clear: { rate: 3.50, name: 'Clear Anodize' },
  anodize_black: { rate: 4.00, name: 'Black Anodize' },
  hard_anodize: { rate: 6.00, name: 'Hard Anodize Type III' },
  paint: { rate: 5.00, name: 'Powder Coat / Paint' },
  zinc_plate: { rate: 2.50, name: 'Zinc Plate' },
  passivate: { rate: 3.00, name: 'Stainless Passivation' },
  polish: { rate: 8.00, name: 'Mirror Polish' },
  brush: { rate: 2.00, name: 'Brushed Finish' },
};

export { MATERIAL_COSTS_PER_KG, MACHINE_RATES, FINISHING_COSTS };

export default class CostingEngine {

  /**
   * Comprehensive cost analysis for a part.
   * @param {object} options
   * @param {number} options.massKg - Part mass in kg
   * @param {string} options.material - Material name
   * @param {number} options.machineTimeMin - Cycle time in minutes
   * @param {string} options.process - Machine type (cnc_3axis, cnc_5axis, etc)
   * @param {number} options.setupTimeMin - Setup time in minutes
   * @param {string} options.finishing - Finishing type
   * @param {number} options.toolingCostUSD - Amortized tooling cost
   * @param {number} options.batchSize - Number of parts in batch
   * @param {number} options.marginPercent - Profit margin
   */
  static analyze(options = {}) {
    const massKg = options.massKg || 0.1;
    const material = options.material || 'Aluminum 6061-T6';
    const machineTimeMin = options.machineTimeMin || 5;
    const process = options.process || 'cnc_3axis';
    const setupTimeMin = options.setupTimeMin || 30;
    const finishing = options.finishing || 'deburr';
    const toolingCostUSD = options.toolingCostUSD || 0;
    const batchSize = options.batchSize || 1;
    const marginPercent = options.marginPercent || 25;
    const wastePercent = options.wastePercent || 15;

    // Material cost (with waste factor for stock)
    const matRate = MATERIAL_COSTS_PER_KG[material] || 5.0;
    const grossMass = massKg * (1 + wastePercent / 100);
    const materialCost = grossMass * matRate;

    // Machining cost
    const machineRate = MACHINE_RATES[process] || 85;
    const machiningCost = (machineTimeMin / 60) * machineRate;

    // Setup cost (amortized over batch)
    const setupCost = (setupTimeMin / 60) * machineRate / batchSize;

    // Tooling (amortized over batch)
    const toolingPerPart = toolingCostUSD / batchSize;

    // Finishing
    const fin = FINISHING_COSTS[finishing] || FINISHING_COSTS.none;
    const finishingCost = fin.rate;

    // Overhead (15% of direct costs)
    const directCost = materialCost + machiningCost + setupCost + toolingPerPart + finishingCost;
    const overhead = directCost * 0.15;

    // Total cost & price with margin
    const totalCost = directCost + overhead;
    const sellPrice = totalCost * (1 + marginPercent / 100);

    // Batch totals
    const batchCost = totalCost * batchSize + toolingCostUSD - toolingPerPart * batchSize;
    const batchRevenue = sellPrice * batchSize;

    return {
      perPart: {
        materialCost: materialCost.toFixed(4),
        machiningCost: machiningCost.toFixed(4),
        setupCost: setupCost.toFixed(4),
        toolingCost: toolingPerPart.toFixed(4),
        finishingCost: finishingCost.toFixed(2),
        overhead: overhead.toFixed(4),
        totalCost: totalCost.toFixed(4),
        sellPrice: sellPrice.toFixed(2),
      },
      batch: {
        size: batchSize,
        totalCost: batchCost.toFixed(2),
        totalRevenue: batchRevenue.toFixed(2),
        profit: (batchRevenue - batchCost).toFixed(2),
      },
      breakdown: [
        { label: 'Material', value: parseFloat(materialCost.toFixed(4)), pct: ((materialCost / totalCost) * 100).toFixed(1) },
        { label: 'Machining', value: parseFloat(machiningCost.toFixed(4)), pct: ((machiningCost / totalCost) * 100).toFixed(1) },
        { label: 'Setup', value: parseFloat(setupCost.toFixed(4)), pct: ((setupCost / totalCost) * 100).toFixed(1) },
        { label: 'Tooling', value: parseFloat(toolingPerPart.toFixed(4)), pct: ((toolingPerPart / totalCost) * 100).toFixed(1) },
        { label: 'Finishing', value: parseFloat(finishingCost.toFixed(2)), pct: ((finishingCost / totalCost) * 100).toFixed(1) },
        { label: 'Overhead', value: parseFloat(overhead.toFixed(4)), pct: ((overhead / totalCost) * 100).toFixed(1) },
      ],
      params: { material, process, finishing, batchSize, marginPercent, wastePercent },
      finishingDetails: fin,
      machineRate,
      materialRate: matRate,
    };
  }

  /**
   * Generate batch pricing curve: cost per part at different quantities.
   */
  static batchPricingCurve(baseOptions, quantities = [1, 10, 50, 100, 500, 1000, 5000]) {
    return quantities.map(qty => {
      const result = CostingEngine.analyze({ ...baseOptions, batchSize: qty });
      return {
        qty,
        unitCost: parseFloat(result.perPart.totalCost),
        unitPrice: parseFloat(result.perPart.sellPrice),
        totalRevenue: parseFloat(result.batch.totalRevenue),
      };
    });
  }

  /**
   * Compare costs across different materials/processes for a given part.
   */
  static compare(baseOptions, alternatives) {
    return alternatives.map(alt => {
      const opts = { ...baseOptions, ...alt };
      const result = CostingEngine.analyze(opts);
      return {
        label: alt.label || `${opts.material} / ${opts.process}`,
        unitCost: parseFloat(result.perPart.totalCost),
        unitPrice: parseFloat(result.perPart.sellPrice),
        breakdown: result.breakdown,
      };
    });
  }
}
