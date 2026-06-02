// forge-kernel cost smoke (Forge-179) — milled aluminium bracket.
// Verifies industry-plausible cost numbers + sensitivities + qty scaling.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.cost && typeof forge.cost.computeUnit === 'function',
          'forge.cost.computeUnit missing');

const materials = [
  { name: 'Al6061',      densityKgM3: 2700, pricePerKgUSD: 5.50,
    mrrEndmillCm3Min: 15, mrrDrillCm3Min: 8,  mrrTurnCm3Min: 25, co2PerKg: 8.2 },
  { name: 'S1018 steel', densityKgM3: 7850, pricePerKgUSD: 1.20,
    mrrEndmillCm3Min: 5,  mrrDrillCm3Min: 3,  mrrTurnCm3Min: 8,  co2PerKg: 1.9 },
  { name: '304 SS',      densityKgM3: 8000, pricePerKgUSD: 6.50,
    mrrEndmillCm3Min: 2,  mrrDrillCm3Min: 1.5,mrrTurnCm3Min: 3,  co2PerKg: 6.1 },
  { name: 'Brass C36',   densityKgM3: 8500, pricePerKgUSD: 8.80,
    mrrEndmillCm3Min: 25, mrrDrillCm3Min: 15, mrrTurnCm3Min: 35, co2PerKg: 4.6 },
  { name: 'Ti6Al4V',     densityKgM3: 4430, pricePerKgUSD: 32.0,
    mrrEndmillCm3Min: 1,  mrrDrillCm3Min: 0.8,mrrTurnCm3Min: 1.5,co2PerKg: 75.0 },
];

const processes = [
  { name: '3-axis CNC', setupMin: 30, labourUsdMin: 1.50 },
  { name: 'Lathe',      setupMin: 25, labourUsdMin: 1.20 },
  { name: 'Sheet press',setupMin: 60, labourUsdMin: 0.80 },
];

const bracket = {
  body: {
    materialName: 'Al6061',
    volumeCm3: 150,
    stockVolumeCm3: 300,
    processName: '3-axis CNC',
    toolFamily: 0,    // endmill
    qty: 50,
  },
  materials,
  processes,
};

const r = forge.cost.computeUnit(bracket);

// Expected numbers (hand calculation):
//   mass = 150e-6 m³ × 2700 kg/m³ = 0.405 kg
//   material = 0.405 × $5.50 = $2.228
//   machining: (300-150) cm³ ÷ 15 cm³/min = 10 min × $1.50 = $15
//   setup: 30 min × $1.50 = $45
//   unit = 2.228 + 15 + 45 = $62.23
//   batch = $62.23 × 50 = $3111
assert.ok(Math.abs(r.massKg - 0.405) < 0.001, `mass ${r.massKg} ≠ 0.405`);
assert.ok(Math.abs(r.unitMaterialUsd - 2.228) < 0.01,
          `material ${r.unitMaterialUsd} not 2.228`);
assert.ok(Math.abs(r.machiningTimeMin - 10) < 0.01,
          `machining time ${r.machiningTimeMin} not 10 min`);
assert.ok(Math.abs(r.unitMachiningUsd - 15) < 0.01,
          `machining $ ${r.unitMachiningUsd} not 15`);
assert.ok(Math.abs(r.unitSetupUsd - 45) < 0.01,
          `setup $ ${r.unitSetupUsd} not 45`);
assert.ok(Math.abs(r.unitUsd - 62.228) < 0.05,
          `unit ${r.unitUsd} not ~62.23`);
assert.ok(Math.abs(r.batchUsd - 3111.4) < 1.0,
          `batch ${r.batchUsd} not ~3111`);

// Tornado: top driver should be related to setup or machining for this bracket.
assert.ok(r.tornado.length > 0, 'tornado empty');
const top = r.tornado[0];
console.log(`   top cost driver: ${top.label}  Δ = $${top.usd.toFixed(2)}`);
assert.ok(Math.abs(top.usd) > 0, 'top sensitivity zero');

// Qty scaling: linear in qty (no discount in this slice).
const r10 = forge.cost.computeUnit({ ...bracket, body: { ...bracket.body, qty: 10 } });
assert.ok(Math.abs(r10.batchUsd - r.unitUsd * 10) < 0.05,
          `qty=10 batch ${r10.batchUsd} not 10x unit`);

// Material sensitivity: switching to Ti-6Al-4V should make it much pricier.
const tiBracket = { ...bracket, body: { ...bracket.body, materialName: 'Ti6Al4V' } };
const rTi = forge.cost.computeUnit(tiBracket);
assert.ok(rTi.unitUsd > r.unitUsd * 2,
          `Ti unit ${rTi.unitUsd} should be > 2× Al ${r.unitUsd}`);

// Project aggregate: 2 bodies of different materials.
const proj = forge.cost.computeProject([bracket, tiBracket]);
assert.strictEqual(proj.perBody.length, 2);
assert.strictEqual(proj.totalQty, 100);
assert.ok(Math.abs(proj.totalUsd - (r.batchUsd + rTi.batchUsd)) < 0.1,
          `project total ${proj.totalUsd} not sum of batches`);

console.log('✅ Cost smoke PASSED');
console.log(`   bracket mass        ${r.massKg.toFixed(3)} kg`);
console.log(`   bracket unit cost   $${r.unitUsd.toFixed(2)}`);
console.log(`   bracket batch (×50) $${r.batchUsd.toFixed(2)}`);
console.log(`   Ti-6Al-4V unit cost $${rTi.unitUsd.toFixed(2)}  (vs Al $${r.unitUsd.toFixed(2)})`);
console.log(`   project total       $${proj.totalUsd.toFixed(2)}`);
