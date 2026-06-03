// Forge-282 — reciprocating compressor smoke (textbook air compression).
//
// Air compressor: p_1 = 100 kPa, T_1 = 300 K, p_2 = 800 kPa, ṁ = 0.5 kg/s,
//   n = 1.35 (polytropic, typical air), η_p = 0.80, c = 0.05, R = 287.
//   π = 8.
//   T_2 = 300 · 8^(0.35/1.35) = 300 · 8^0.2593 = 300 · 1.6920 = 507.6 K
//   H_p = (1.35/0.35) · 287 · 300 · (1.6920 − 1) = 3.857·287·300·0.6920
//       = 229 391 J/kg = 229.4 kJ/kg
//   η_v = 1 + 0.05 − 0.05 · 8^(1/1.35) = 1.05 − 0.05 · 8^0.7407
//       = 1.05 − 0.05·4.7281 = 0.8136
//   P_b = 0.5 · 229391 / 0.80 = 143 369 W = 143.4 kW

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.compressor.analyse({
    inletPressurePa: 1e5, inletTemperatureK: 300,
    dischargePressurePa: 8e5, massFlowKgS: 0.5,
    polytropicIndexN: 1.35, polytropicEfficiency: 0.80,
    clearanceRatioC: 0.05, gasConstantJkgK: 287,
});
console.log(JSON.stringify(r, null, 2));

assert(Math.abs(r.pressureRatio - 8) < 1e-9, 'π = 8');
assert(Math.abs(r.dischargeTemperatureK - 300 * Math.pow(8, 0.35 / 1.35)) < 1e-6, 'T_2');
assert(Math.abs(r.polytropicHeadJkg - (1.35/0.35) * 287 * 300 * (Math.pow(8, 0.35/1.35) - 1)) < 1e-3, 'H_p');
assert(Math.abs(r.volumetricEfficiency - (1.05 - 0.05 * Math.pow(8, 1/1.35))) < 1e-6, 'η_v');
assert(Math.abs(r.brakePowerW - 0.5 * r.polytropicHeadJkg / 0.80) < 1e-3, 'P_b');
assert(r.temperatureRiseK > 200 && r.temperatureRiseK < 220, 'ΔT ≈ 208 K');

// Isentropic case (n = 1.4): T_2 higher, H_p higher.
const isen = kernel.compressor.analyse({
    inletPressurePa: 1e5, inletTemperatureK: 300,
    dischargePressurePa: 8e5, massFlowKgS: 0.5,
    polytropicIndexN: 1.4, polytropicEfficiency: 0.80,
    clearanceRatioC: 0.05, gasConstantJkgK: 287,
});
console.log('isentropic', JSON.stringify(isen));
assert(isen.dischargeTemperatureK > r.dischargeTemperatureK, 'isentropic T_2 higher');
assert(isen.polytropicHeadJkg > r.polytropicHeadJkg, 'isentropic H_p higher');

// Isothermal limit n → 1: T_2 ≈ T_1, H_p = R·T_1·ln π.
const iso = kernel.compressor.analyse({
    inletPressurePa: 1e5, inletTemperatureK: 300,
    dischargePressurePa: 8e5, massFlowKgS: 0.5,
    polytropicIndexN: 1.0, polytropicEfficiency: 0.80,
    clearanceRatioC: 0.05, gasConstantJkgK: 287,
});
console.log('isothermal', JSON.stringify(iso));
assert(Math.abs(iso.temperatureRiseK) < 1e-9, 'isothermal ΔT = 0');
assert(Math.abs(iso.polytropicHeadJkg - 287 * 300 * Math.log(8)) < 1e-3, 'isothermal H');
assert(Math.abs(iso.polytropicHeadJkg - iso.isothermalEquivalentHeadJkg) < 1e-9, 'iso = ref iso');

// Higher π → η_v drops (more re-expansion losses).
const highPi = kernel.compressor.analyse({
    inletPressurePa: 1e5, inletTemperatureK: 300,
    dischargePressurePa: 20e5, massFlowKgS: 0.5,
    polytropicIndexN: 1.35, polytropicEfficiency: 0.80,
    clearanceRatioC: 0.05, gasConstantJkgK: 287,
});
console.log('π=20', JSON.stringify(highPi));
assert(highPi.volumetricEfficiency < r.volumetricEfficiency, 'higher π → lower η_v');

// p_2 ≤ p_1 throws.
let threw = false;
try {
    kernel.compressor.analyse({
        inletPressurePa: 1e5, inletTemperatureK: 300,
        dischargePressurePa: 5e4, massFlowKgS: 0.5,
        polytropicIndexN: 1.35, polytropicEfficiency: 0.80,
        clearanceRatioC: 0.05, gasConstantJkgK: 287,
    });
} catch (e) { threw = true; }
assert(threw, 'p_2 ≤ p_1 throws');

console.log('Forge-282 reciprocating compressor smoke OK');
