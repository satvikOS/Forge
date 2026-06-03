// Forge-277 — air-standard Diesel cycle smoke.
//
// Reference: Cengel Ex. 9-3 (r = 18, r_c = 2, T_1 = 300 K, p_1 = 100 kPa,
//   γ = 1.4). Expected η = 1 − (1/18^0.4)·(2^1.4 − 1)/(1.4·1) ≈ 0.6325.
//
// State temperatures from closed form:
//   c_v = 0.7175, c_p = 1.005 kJ/(kg·K)
//   T_2 = 300·18^0.4 = 300·3.1779 = 953.3 K
//   T_3 = T_2·r_c   = 953.3·2 = 1906.6 K
//   T_4 = T_3·(r_c/r)^(γ−1) = 1906.6·(1/9)^0.4 = 1906.6·0.4179 = 796.9 K

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.diesel.analyse({
    compressionRatio: 18, cutoffRatio: 2,
    intakeTemperatureK: 300, intakePressureKPa: 100,
    specificHeatRatio: 1.4,
});
console.log(JSON.stringify(r, null, 2));

assert(Math.abs(r.cVKJkgK - 0.7175) < 1e-3, 'c_v');
assert(Math.abs(r.cPKJkgK - 1.0045) < 1e-3, 'c_p = γ·c_v ≈ 1.005');
assert(Math.abs(r.t2K - 300 * Math.pow(18, 0.4)) < 1e-6, 'T_2 isentropic');
assert(Math.abs(r.t3K - r.t2K * 2) < 1e-6, 'T_3 = T_2·r_c');
assert(Math.abs(r.p3KPa - r.p2KPa) < 1e-6, 'p_3 = p_2 (const press)');
assert(Math.abs(r.t4K - r.t3K * Math.pow(2/18, 0.4)) < 1e-6, 'T_4 isentropic expansion');
assert(Math.abs(r.qInKJkg - r.cPKJkgK * (r.t3K - r.t2K)) < 1e-6, 'q_in identity (c_p)');
assert(Math.abs(r.qOutKJkg - r.cVKJkgK * (r.t4K - 300)) < 1e-6, 'q_out identity (c_v)');
assert(Math.abs(r.wNetKJkg - (r.qInKJkg - r.qOutKJkg)) < 1e-9, 'w_net');

const eta_expected = 1 - (1 / Math.pow(18, 0.4))
                       * (Math.pow(2, 1.4) - 1) / (1.4 * (2 - 1));
assert(Math.abs(r.thermalEfficiency - eta_expected) < 1e-9, 'η closed form');
assert(Math.abs(r.thermalEfficiency - r.wNetKJkg / r.qInKJkg) < 1e-6, 'η = w/q_in');

// r_c = 1 ⇒ Diesel collapses to Otto.
const dieselLim = kernel.diesel.analyse({
    compressionRatio: 8, cutoffRatio: 1.0,
    intakeTemperatureK: 290, intakePressureKPa: 95,
    specificHeatRatio: 1.4,
});
const ottoSame = kernel.otto.analyse({
    compressionRatio: 8, intakeTemperatureK: 290, intakePressureKPa: 95,
    peakTemperatureK: 290 * Math.pow(8, 0.4) + 1,  // any T_3 > T_2
    specificHeatRatio: 1.4,
});
assert(Math.abs(dieselLim.thermalEfficiency - ottoSame.thermalEfficiency) < 1e-9,
       'Diesel r_c=1 → Otto efficiency');

// Higher r_c at fixed r → lower η (more energy at lower temperature).
const lowRc  = kernel.diesel.analyse({
    compressionRatio: 18, cutoffRatio: 1.5,
    intakeTemperatureK: 300, intakePressureKPa: 100,
    specificHeatRatio: 1.4,
});
const highRc = kernel.diesel.analyse({
    compressionRatio: 18, cutoffRatio: 3.0,
    intakeTemperatureK: 300, intakePressureKPa: 100,
    specificHeatRatio: 1.4,
});
assert(lowRc.thermalEfficiency > highRc.thermalEfficiency, 'lower r_c → higher η');

// Higher r raises η.
const r12 = kernel.diesel.analyse({
    compressionRatio: 12, cutoffRatio: 2,
    intakeTemperatureK: 300, intakePressureKPa: 100,
    specificHeatRatio: 1.4,
});
const r24 = kernel.diesel.analyse({
    compressionRatio: 24, cutoffRatio: 2,
    intakeTemperatureK: 300, intakePressureKPa: 100,
    specificHeatRatio: 1.4,
});
assert(r24.thermalEfficiency > r12.thermalEfficiency, 'higher r → higher η');

// Bad input throws.
let threw = false;
try {
    kernel.diesel.analyse({ compressionRatio: 18, cutoffRatio: 0.5,
        intakeTemperatureK: 300, intakePressureKPa: 100, specificHeatRatio: 1.4 });
} catch (e) { threw = true; }
assert(threw, 'r_c < 1 throws');

threw = false;
try {
    kernel.diesel.analyse({ compressionRatio: 5, cutoffRatio: 6,
        intakeTemperatureK: 300, intakePressureKPa: 100, specificHeatRatio: 1.4 });
} catch (e) { threw = true; }
assert(threw, 'r_c ≥ r throws');

console.log('Forge-277 Diesel cycle smoke OK');
