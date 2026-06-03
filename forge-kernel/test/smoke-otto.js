// Forge-276 — air-standard Otto cycle smoke (Cengel Ex. 9-2 numbers).
//
// Cengel & Boles thermodynamics example: r = 8, T_1 = 290 K, p_1 = 95 kPa,
//   q_in = 800 kJ/kg, γ = 1.4 (so T_3 = T_2 + q_in/c_v).
// Closed forms with γ = 1.4:
//   c_v = 0.287/0.4 = 0.7175 kJ/(kg·K)
//   T_2 = 290 · 8^0.4 = 290 · 2.297 = 666.2 K
//   q_in = 800 ⇒ T_3 = 666.2 + 800/0.7175 = 1781 K
//   T_4 = 1781 · 8^-0.4 = 1781 / 2.297 = 775.2 K
//   q_out = 0.7175 · (775.2 − 290) = 348.2 kJ/kg
//   w_net = 800 − 348.2 = 451.8 kJ/kg
//   η = 1 − 8^-0.4 = 1 − 0.4353 = 0.5647 (56.5 %)
//
// We feed T_3 directly (1781 K) so the test is a closed-form match.

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.otto.analyse({
    compressionRatio: 8,
    intakeTemperatureK: 290,
    intakePressureKPa: 95,
    peakTemperatureK: 1781,
    specificHeatRatio: 1.4,
});
console.log(JSON.stringify(r, null, 2));

assert(Math.abs(r.cVKJkgK - 0.7175) < 1e-3, 'c_v ≈ 0.7175');
assert(Math.abs(r.t2K - 290 * Math.pow(8, 0.4)) < 1e-6, 'T_2 from r^(γ−1)');
assert(Math.abs(r.t4K - 1781 / Math.pow(8, 0.4)) < 1e-6, 'T_4 from r^-(γ−1)');
assert(Math.abs(r.qInKJkg - r.cVKJkgK * (r.t3K - r.t2K)) < 1e-6, 'q_in identity');
assert(Math.abs(r.qOutKJkg - r.cVKJkgK * (r.t4K - 290)) < 1e-6, 'q_out identity');
assert(Math.abs(r.wNetKJkg - (r.qInKJkg - r.qOutKJkg)) < 1e-9, 'w_net = q_in − q_out');
assert(Math.abs(r.thermalEfficiency - (1 - Math.pow(8, -0.4))) < 1e-9, 'η = 1 − r^-(γ−1)');
assert(Math.abs(r.thermalEfficiency - r.wNetKJkg / r.qInKJkg) < 1e-6, 'η = w/q_in');

// MEP sanity: w_net (kJ/kg) / (v_1 − v_2) (m³/kg) = kPa
const v1 = 0.287 * 290 / 95;   // ≈ 0.876 m³/kg
const v2 = v1 / 8;
const MEP_check = r.wNetKJkg / (v1 - v2);
assert(Math.abs(r.meanEffectivePressureKPa - MEP_check) < 1e-6, 'MEP identity');

// Higher compression ratio raises η.
const r12 = kernel.otto.analyse({
    compressionRatio: 12, intakeTemperatureK: 290, intakePressureKPa: 95,
    peakTemperatureK: 2200, specificHeatRatio: 1.4,
});
console.log('r=12', JSON.stringify(r12));
assert(r12.thermalEfficiency > r.thermalEfficiency, 'higher r → higher η');
assert(Math.abs(r12.thermalEfficiency - (1 - Math.pow(12, -0.4))) < 1e-9, 'η formula');

// γ → 1.667 (monatomic limit) → still η = 1 − r^-(γ−1).
const mono = kernel.otto.analyse({
    compressionRatio: 8, intakeTemperatureK: 290, intakePressureKPa: 95,
    peakTemperatureK: 2000, specificHeatRatio: 1.667,
});
assert(Math.abs(mono.thermalEfficiency - (1 - Math.pow(8, -0.667))) < 1e-9, 'monatomic η');

// r ≤ 1 throws.
let threw = false;
try {
    kernel.otto.analyse({ compressionRatio: 0.5, intakeTemperatureK: 290,
        intakePressureKPa: 95, peakTemperatureK: 1500, specificHeatRatio: 1.4 });
} catch (e) { threw = true; }
assert(threw, 'r ≤ 1 throws');

// T_3 ≤ T_1 throws.
threw = false;
try {
    kernel.otto.analyse({ compressionRatio: 8, intakeTemperatureK: 290,
        intakePressureKPa: 95, peakTemperatureK: 250, specificHeatRatio: 1.4 });
} catch (e) { threw = true; }
assert(threw, 'T_3 ≤ T_1 throws');

console.log('Forge-276 Otto cycle smoke OK');
