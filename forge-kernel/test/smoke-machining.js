// Forge-258 — Machining smoke.
//
// Turning steel: D=50 mm, V_c=200 m/min, f=0.30 mm/rev, a_p=2 mm,
// K_c=2500 N/mm², η=0.80, κ=90°.
//   n = 200·1000/(π·50) = 1273 rpm
//   F_c = K_c·a_p·f = 2500·2·0.30 = 1500 N
//   P  = F_c·V_c/(60·1000·η) = 1500·200/(60·1000·0.80) = 6.25 kW
//   MRR (Sandvik) = V_c·f·a_p = 200·0.30·2 = 120 cm³/min
//
// Milling: D=50 mm, V_c=200 m/min, f_z=0.10 mm, z=4, a_p=5 mm, a_e=20 mm
//   n = 1273 rpm
//   F = f_z·z·n = 0.10·4·1273 = 509.3 mm/min
//
// Drilling: D=10 mm, V_c=60 m/min, f=0.15 mm/rev, K_c=2500, η=0.80
//   n = 60·1000/(π·10) = 1909.9 rpm
//   F (feed) = 0.15·1909.9 = 286.5 mm/min

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const t = kernel.machining.turning({
  diameterMm: 50, cuttingSpeedM_min: 200,
  feedPerRevMm: 0.30, depthOfCutMm: 2,
  specificCuttingForceN_mm2: 2500,
  machineEfficiency: 0.80, leadAngleDeg: 90,
});
console.log('turning:', t);
if (!approx(t.spindleSpeedRpm, 1273.2, 0.001)) throw new Error('n off');
if (!approx(t.cuttingForceN, 1500, 0.001))     throw new Error('F_c off');
if (!approx(t.powerKw, 6.25, 0.001))           throw new Error('P off');
if (!approx(t.mrrCm3Min, 120, 0.001))          throw new Error('MRR off');

const m = kernel.machining.milling({
  diameterMm: 50, cuttingSpeedM_min: 200,
  feedPerToothMm: 0.10, numberOfTeeth: 4,
  axialDepthMm: 5, radialDepthMm: 20,
  specificCuttingForceN_mm2: 2500,
  machineEfficiency: 0.80,
});
console.log('milling:', m);
if (!approx(m.spindleSpeedRpm, 1273.2, 0.001)) throw new Error('mill n off');
if (!approx(m.feedRateMmMin, 509.3, 0.001))    throw new Error('mill F off');

const d = kernel.machining.drilling({
  diameterMm: 10, cuttingSpeedM_min: 60,
  feedPerRevMm: 0.15,
  specificCuttingForceN_mm2: 2500,
  machineEfficiency: 0.80,
});
console.log('drilling:', d);
if (!approx(d.spindleSpeedRpm, 1909.9, 0.001)) throw new Error('drill n off');
if (!approx(d.feedRateMmMin, 286.5, 0.01))      throw new Error('drill F off');

console.log('OK — machining smoke green');
