// forge-kernel Carbon LCA smoke (Forge-180) — Al6061 bracket.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.carbon && typeof forge.carbon.computeLca === 'function',
          'forge.carbon.computeLca missing');

const cfg = {
  material: {
    name: 'Al6061',
    densityKgM3: 2700,
    co2PerKg: 8.2,
    recycledContent: 0.40,
    recyclingCredit: 0.85,    // most of the embodied energy is recoverable
  },
  process: { name: '3-axis CNC', spindleKW: 5, overheadFactor: 1.5 },
  volumeCm3: 150,
  stockVolumeCm3: 300,
  machiningTimeMin: 10,
  gridCo2PerKwh: 0.385,        // EU 2024 average
  transportKm: 800,
  transportEmissionsPerTkm: 0.062,  // EURO 6 truck
  qty: 50,
};

const r = forge.carbon.computeLca(cfg);

// Hand calc:
//   mass = 0.405 kg
//   material = 0.405 × 8.2 = 3.321 kg CO2e
//   energy = 5 × 1.5 × (10/60) = 1.25 kWh   →  manuf = 1.25 × 0.385 = 0.481
//   transport = 0.000405 t × 800 km × 0.062 = 0.0201 kg
//   recycling credit = -0.85 × 0.405 × 8.2 = -2.823
//   unit = 3.321 + 0.481 + 0.0201 − 2.823 = 0.999 kg CO2e
//   batch = 0.999 × 50 = 49.95
assert.ok(Math.abs(r.massKg - 0.405) < 0.001);
assert.ok(Math.abs(r.unitMaterialKgCo2 - 3.321) < 0.01);
assert.ok(Math.abs(r.unitManufKgCo2 - 0.481) < 0.01);
assert.ok(Math.abs(r.unitTransportKgCo2 - 0.0201) < 0.005);
assert.ok(Math.abs(r.unitRecyclingCreditKgCo2 + 2.823) < 0.01);
assert.ok(Math.abs(r.unitTotalKgCo2 - 0.999) < 0.05,
          `unit ${r.unitTotalKgCo2} not ~0.999`);
assert.ok(Math.abs(r.batchTotalKgCo2 - r.unitTotalKgCo2 * 50) < 0.05);
assert.ok(Math.abs(r.energyKwh - 1.25) < 0.01);

// Switching to Ti6Al4V should massively increase carbon footprint.
const cfgTi = {
  ...cfg,
  material: {
    name: 'Ti6Al4V',
    densityKgM3: 4430, co2PerKg: 75.0,
    recycledContent: 0.10, recyclingCredit: 0.30,
  },
};
const rTi = forge.carbon.computeLca(cfgTi);
assert.ok(rTi.unitTotalKgCo2 > 10 * r.unitTotalKgCo2,
          `Ti unit CO2 ${rTi.unitTotalKgCo2} should be >> Al ${r.unitTotalKgCo2}`);

// Lower grid carbon intensity should reduce manufacturing CO2.
const cfgNorway = { ...cfg, gridCo2PerKwh: 0.020 };
const rNo = forge.carbon.computeLca(cfgNorway);
assert.ok(rNo.unitManufKgCo2 < r.unitManufKgCo2 * 0.1,
          `Norway grid manuf ${rNo.unitManufKgCo2} should be much less than EU ${r.unitManufKgCo2}`);

console.log('✅ Carbon LCA smoke PASSED');
console.log(`   Al6061 bracket mass     ${(r.massKg * 1000).toFixed(0)} g`);
console.log(`   Material                ${r.unitMaterialKgCo2.toFixed(3)} kgCO2e`);
console.log(`   Manufacturing           ${r.unitManufKgCo2.toFixed(3)} kgCO2e  (${r.energyKwh.toFixed(2)} kWh)`);
console.log(`   Transport               ${r.unitTransportKgCo2.toFixed(3)} kgCO2e`);
console.log(`   Recycling credit        ${r.unitRecyclingCreditKgCo2.toFixed(3)} kgCO2e`);
console.log(`   Unit total              ${r.unitTotalKgCo2.toFixed(3)} kgCO2e`);
console.log(`   Batch (×${cfg.qty})            ${r.batchTotalKgCo2.toFixed(1)} kgCO2e`);
console.log(`   Ti6Al4V unit            ${rTi.unitTotalKgCo2.toFixed(2)} kgCO2e (${(rTi.unitTotalKgCo2/r.unitTotalKgCo2).toFixed(1)}× Al)`);
console.log(`   Norway grid unit        ${rNo.unitTotalKgCo2.toFixed(2)} kgCO2e (manuf ${rNo.unitManufKgCo2.toFixed(3)})`);
