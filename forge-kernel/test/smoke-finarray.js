// Forge-295 — heat sink fin array smoke (Incropera Ex. 3.10 numbers).
//
// Reference Incropera/DeWitt heat sink: aluminum (k = 200 W/m·K) base
//   W = 60 mm × b = 100 mm with N = 10 fins, each t = 1 mm, L_f = 20 mm,
//   forced air h = 100 W/m²·K, base T_b = 80°C, T_amb = 20°C.
//
//   In SI for the math (m):
//     t = 0.001 m, L_f = 0.02 m
//     m = √(2·100/(200·0.001)) = √1000 = 31.62 m⁻¹
//     L_c = 0.02 + 0.0005 = 0.0205 m
//     mL_c = 31.62·0.0205 = 0.648
//     tanh(0.648) = 0.5715 → η_f = 0.5715 / 0.648 = 0.882
//     A_f = 2·0.0205·0.060 = 0.00246 m²
//     N·A_f = 0.0246 m²
//     A_b = (0.100 − 0.010)·0.060 = 0.0054 m²
//     A_t = 0.0246 + 0.0054 = 0.0300 m²
//     η_o = 1 − (0.0246/0.0300)·(1 − 0.882) = 1 − 0.82·0.118 = 1 − 0.0968 = 0.903
//     R_t = 1/(0.903·100·0.0300) = 1/2.709 = 0.369 K/W
//     Q = 60 / 0.369 = 162.6 W (vs ~85 W if no fins, just A_b · h · ΔT = 32.4 W)

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.finarray.analyse({
    baseWidthMm: 60, baseLengthMm: 100,
    finCount: 10, finThicknessMm: 1, finLengthMm: 20,
    materialConductivityWmK: 200, convectionCoefficientWm2K: 100,
    baseTemperatureC: 80, ambientTemperatureC: 20,
});
console.log(JSON.stringify(r, null, 2));

assert(Math.abs(r.finParameterPerM - Math.sqrt(1000)) < 1e-6, 'm = √(2h/kt)');
assert(Math.abs(r.correctedLengthMm - 20.5) < 1e-6, 'L_c = L_f + t/2');
assert(r.singleFinEfficiency > 0.86 && r.singleFinEfficiency < 0.90, 'η_f ≈ 0.88');
assert(r.overallSurfaceEfficiency > 0.88 && r.overallSurfaceEfficiency < 0.92, 'η_o ≈ 0.90');
assert(r.thermalResistanceKW > 0.34 && r.thermalResistanceKW < 0.40, 'R_t ≈ 0.37 K/W');
assert(r.heatDissipatedW > 150 && r.heatDissipatedW < 175, 'Q ≈ 162 W');

// Doubling number of fins (with same total base; need to spread on more
// area but t·N must remain < b). Just check more fins → more Q at fixed
// other params:
const moreFins = kernel.finarray.analyse({
    baseWidthMm: 60, baseLengthMm: 100,
    finCount: 20, finThicknessMm: 1, finLengthMm: 20,
    materialConductivityWmK: 200, convectionCoefficientWm2K: 100,
    baseTemperatureC: 80, ambientTemperatureC: 20,
});
console.log('20 fins', JSON.stringify(moreFins));
assert(moreFins.totalFinAreaMm2 > r.totalFinAreaMm2, 'more area');
assert(moreFins.heatDissipatedW > r.heatDissipatedW, 'more Q');

// Longer fins: greater m·L_c → η_f drops, but absolute Q rises until
// diminishing returns set in.
const tall = kernel.finarray.analyse({
    baseWidthMm: 60, baseLengthMm: 100,
    finCount: 10, finThicknessMm: 1, finLengthMm: 50,
    materialConductivityWmK: 200, convectionCoefficientWm2K: 100,
    baseTemperatureC: 80, ambientTemperatureC: 20,
});
console.log('tall', JSON.stringify(tall));
assert(tall.singleFinEfficiency < r.singleFinEfficiency, 'η_f drops with L');
assert(tall.heatDissipatedW > r.heatDissipatedW, 'longer fin still helps overall');

// Copper instead of aluminum: η_f rises.
const copper = kernel.finarray.analyse({
    baseWidthMm: 60, baseLengthMm: 100,
    finCount: 10, finThicknessMm: 1, finLengthMm: 20,
    materialConductivityWmK: 400, convectionCoefficientWm2K: 100,
    baseTemperatureC: 80, ambientTemperatureC: 20,
});
assert(copper.singleFinEfficiency > r.singleFinEfficiency,
       'higher k → higher η_f');

// Higher h (fan upgrade): more total Q (but lower η).
const forced = kernel.finarray.analyse({
    baseWidthMm: 60, baseLengthMm: 100,
    finCount: 10, finThicknessMm: 1, finLengthMm: 20,
    materialConductivityWmK: 200, convectionCoefficientWm2K: 200,
    baseTemperatureC: 80, ambientTemperatureC: 20,
});
console.log('h=200', JSON.stringify(forced));
assert(forced.heatDissipatedW > r.heatDissipatedW, 'higher h → higher Q');
assert(forced.singleFinEfficiency < r.singleFinEfficiency,
       'higher h → lower η_f (Bi increases)');

// Invalid: fin count × t ≥ b throws.
let threw = false;
try {
    kernel.finarray.analyse({
        baseWidthMm: 60, baseLengthMm: 50,
        finCount: 60, finThicknessMm: 1, finLengthMm: 20,
        materialConductivityWmK: 200, convectionCoefficientWm2K: 100,
        baseTemperatureC: 80, ambientTemperatureC: 20,
    });
} catch (e) { threw = true; }
assert(threw, 'overcrowded fins throw');

console.log('Forge-295 fin array smoke OK');
