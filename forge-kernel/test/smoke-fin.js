// Forge-261 — Fin efficiency smoke (Incropera Ex 3.10).
//
// Rectangular fin: L = 50 mm, t = 5 mm, w = 100 mm.
// k = 200 W/m·K (Al), h = 100 W/m²·K, ΔT = 100 K.
//
//   L_c = 0.05 + 0.005/2 = 0.0525 m
//   m = √(2·100/(200·0.005)) = √200 = 14.14 m^-1
//   m·L_c = 14.14·0.0525 = 0.7424
//   tanh(0.7424) = 0.6303
//   η_f = 0.6303/0.7424 = 0.849 (84.9%)
//   A_f = 2·0.1·0.0525 = 0.0105 m² per face → total fin surface = 0.0105 m²
//   q_f = 0.849·100·0.0105·100 = 89.1 W
//   A_c (base) = 0.1·0.005 = 5e-4 m²
//   ε_f = q_f/(h·A_c·ΔT) = 89.1/(100·5e-4·100) = 17.8
//
// Pin fin: L = 50 mm, D = 5 mm. Same k, h, ΔT.
//   L_c = 0.05 + 0.005/4 = 0.05125 m
//   m = √(4·100/(200·0.005)) = √400 = 20 m^-1
//   m·L_c = 1.025
//   tanh(1.025) = 0.772
//   η_f = 0.772/1.025 = 0.753 (75.3%)
//   A_f = π·0.005·0.05125 = 8.050e-4 m²
//   q_f = 0.753·100·8.050e-4·100 = 6.06 W

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const rec = kernel.fin.rectangular({
  heightM: 0.05, thicknessM: 0.005, widthM: 0.1,
  thermalConductivity: 200, convectionH: 100, temperatureDiffK: 100,
});
console.log('rect:', rec);
if (!approx(rec.parameter_m, 14.142, 0.001))    throw new Error('m off');
if (!approx(rec.correctedLength, 0.0525, 0.001)) throw new Error('L_c off');
if (!approx(rec.finEfficiency, 0.849, 0.01))    throw new Error('η_f off');
if (!approx(rec.heatRateW, 89.1, 0.02))         throw new Error('q_f off');
if (!approx(rec.finEffectiveness, 17.8, 0.02))  throw new Error('ε_f off');

const pin = kernel.fin.pin({
  lengthM: 0.05, diameterM: 0.005,
  thermalConductivity: 200, convectionH: 100, temperatureDiffK: 100,
});
console.log('pin:', pin);
if (!approx(pin.parameter_m, 20, 0.001))         throw new Error('pin m off');
if (!approx(pin.finEfficiency, 0.753, 0.01))     throw new Error('pin η_f off');
if (!approx(pin.heatRateW, 6.06, 0.02))          throw new Error('pin q_f off');

console.log('OK — fin smoke green');
