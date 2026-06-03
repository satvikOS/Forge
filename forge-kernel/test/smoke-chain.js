// Forge-283 — roller chain drive geometry smoke (ANSI B29.1).
//
// Reference design: ANSI #60 chain (pitch p = 19.05 mm = 0.75"),
//   N_1 = 17 teeth (driver), N_2 = 51 teeth (driven, 3:1 reduction),
//   C ≈ 500 mm desired, n_1 = 1750 rpm.
//
//   d_1 = 19.05 / sin(π/17) = 19.05 / 0.18375 = 103.66 mm
//   d_2 = 19.05 / sin(π/51) = 19.05 / 0.06156 = 309.43 mm
//   i  = 51/17 = 3.0,  n_2 = 1750/3 = 583.3 rpm
//   v  = 17·19.05·1750/60000 = 9.443 m/s
//   L  = 2·500 + (17+51)·19.05/2 + (51−17)²·19.05²/(4π²·500)
//      = 1000 + 647.7 + 21.4 = 1669.1 mm  →  87.6 pitches
//   Rounded up to next even integer: 88 pitches.

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.chain.analyse({
    pitchMm: 19.05, driverTeeth: 17, drivenTeeth: 51,
    centerDistanceMm: 500, driverSpeedRpm: 1750,
});
console.log(JSON.stringify(r, null, 2));

assert(Math.abs(r.driverPitchDiameterMm - 19.05 / Math.sin(Math.PI / 17)) < 1e-6, 'd_1');
assert(Math.abs(r.drivenPitchDiameterMm - 19.05 / Math.sin(Math.PI / 51)) < 1e-6, 'd_2');
assert(Math.abs(r.speedRatio - 3.0) < 1e-9, 'i = 3');
assert(Math.abs(r.drivenSpeedRpm - 1750 / 3) < 1e-6, 'n_2');
assert(Math.abs(r.chainVelocityMs - 17 * 19.05 * 1750 / 60000) < 1e-6, 'v');
assert(r.approxLengthMm > 1660 && r.approxLengthMm < 1680, 'L ≈ 1669');
assert(r.lengthInPitchesRounded === 88, 'rounded to 88 pitches');
assert(r.lengthInPitchesRounded % 2 === 0, 'even pitch count');
// Final C should be close to (but not exactly equal to) the original 500.
assert(Math.abs(r.finalCenterDistanceMm - 500) < 5, 'final C ≈ 500');

// 1:1 ratio: equal sprockets, no length correction term.
const oneToOne = kernel.chain.analyse({
    pitchMm: 12.7, driverTeeth: 21, drivenTeeth: 21,
    centerDistanceMm: 300, driverSpeedRpm: 1500,
});
console.log('1:1', JSON.stringify(oneToOne));
assert(Math.abs(oneToOne.driverPitchDiameterMm - oneToOne.drivenPitchDiameterMm) < 1e-6,
       'equal d for equal N');
assert(Math.abs(oneToOne.speedRatio - 1.0) < 1e-9, '1:1 ratio');
// L = 2·300 + 21·12.7 + 0 = 600 + 266.7 = 866.7 mm = 68.24 pitches → 70 (even).
assert(oneToOne.lengthInPitchesRounded === 70, '70 pitches for 1:1');

// Bad input throws.
let threw = false;
try {
    kernel.chain.analyse({ pitchMm: 19.05, driverTeeth: 5, drivenTeeth: 30,
        centerDistanceMm: 500, driverSpeedRpm: 1750 });
} catch (e) { threw = true; }
assert(threw, '< 9 teeth throws');

// Higher driver speed → proportionally higher chain velocity.
const fast = kernel.chain.analyse({
    pitchMm: 19.05, driverTeeth: 17, drivenTeeth: 51,
    centerDistanceMm: 500, driverSpeedRpm: 3500,
});
assert(Math.abs(fast.chainVelocityMs - 2 * r.chainVelocityMs) < 1e-6, 'v ∝ n_1');

console.log('Forge-283 chain drive smoke OK');
