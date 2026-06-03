// Forge-278 — air-standard Brayton cycle smoke.
//
// Cengel Ex. 9-5 ideal Brayton: r_p = 8, T_1 = 300 K, p_1 = 100 kPa,
//   T_3 = 1300 K, γ = 1.4, η_c = η_t = 1.0.
//   exp_ratio = 0.4/1.4 = 0.2857
//   T_2 = 300 · 8^0.2857 = 300 · 1.8114 = 543.4 K
//   T_4 = 1300 · 8^-0.2857 = 1300/1.8114 = 717.7 K
//   η = 1 − 8^-0.2857 = 1 − 0.5519 = 0.4481 (44.8 %)

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.brayton.analyse({
    pressureRatio: 8, intakeTemperatureK: 300, intakePressureKPa: 100,
    turbineInletTemperatureK: 1300, specificHeatRatio: 1.4,
    compressorIsentropicEff: 1.0, turbineIsentropicEff: 1.0,
});
console.log(JSON.stringify(r, null, 2));

const exp_ratio = 0.4 / 1.4;
assert(Math.abs(r.t2K - 300 * Math.pow(8, exp_ratio)) < 1e-6, 'T_2 isentropic');
assert(Math.abs(r.t4K - 1300 * Math.pow(8, -exp_ratio)) < 1e-6, 'T_4 isentropic');
assert(Math.abs(r.thermalEfficiency - (1 - Math.pow(8, -exp_ratio))) < 1e-9, 'η ideal');
assert(Math.abs(r.cPKJkgK - 1.0045) < 1e-3, 'c_p ≈ 1.005');
assert(Math.abs(r.wNetKJkg - (r.turbineWorkKJkg - r.compressorWorkKJkg)) < 1e-6, 'w_net');
assert(r.backWorkRatio > 0.3 && r.backWorkRatio < 0.5, 'BWR ≈ 0.4 ideal');

// Non-ideal: η_c = 0.8, η_t = 0.85.
const real = kernel.brayton.analyse({
    pressureRatio: 8, intakeTemperatureK: 300, intakePressureKPa: 100,
    turbineInletTemperatureK: 1300, specificHeatRatio: 1.4,
    compressorIsentropicEff: 0.8, turbineIsentropicEff: 0.85,
});
console.log('real', JSON.stringify(real));
assert(real.t2K > r.t2K, 'real T_2 > ideal T_2 (compressor inefficiency)');
assert(real.t4K > r.t4K, 'real T_4 > ideal T_4 (turbine inefficiency)');
assert(real.thermalEfficiency < r.thermalEfficiency, 'real η < ideal η');
assert(real.backWorkRatio > r.backWorkRatio, 'real BWR > ideal BWR');

// Higher r_p raises ideal η.
const rp16 = kernel.brayton.analyse({
    pressureRatio: 16, intakeTemperatureK: 300, intakePressureKPa: 100,
    turbineInletTemperatureK: 1300, specificHeatRatio: 1.4,
    compressorIsentropicEff: 1.0, turbineIsentropicEff: 1.0,
});
assert(rp16.thermalEfficiency > r.thermalEfficiency, 'higher r_p → higher η');
assert(Math.abs(rp16.thermalEfficiency - (1 - Math.pow(16, -exp_ratio))) < 1e-9, 'r_p=16 η');

// Bad inputs throw.
let threw = false;
try {
    kernel.brayton.analyse({ pressureRatio: 0.5, intakeTemperatureK: 300, intakePressureKPa: 100,
        turbineInletTemperatureK: 1300, specificHeatRatio: 1.4,
        compressorIsentropicEff: 1.0, turbineIsentropicEff: 1.0 });
} catch (e) { threw = true; }
assert(threw, 'r_p ≤ 1 throws');

threw = false;
try {
    // r_p = 8, T_1 = 300 → T_2 ≈ 543; pick T_3 < T_2 to trigger error.
    kernel.brayton.analyse({ pressureRatio: 8, intakeTemperatureK: 300, intakePressureKPa: 100,
        turbineInletTemperatureK: 500, specificHeatRatio: 1.4,
        compressorIsentropicEff: 1.0, turbineIsentropicEff: 1.0 });
} catch (e) { threw = true; }
assert(threw, 'T_2 ≥ T_3 throws');

console.log('Forge-278 Brayton cycle smoke OK');
