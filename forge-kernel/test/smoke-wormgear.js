// Forge-290 — worm gear drive smoke (Shigley §13).
//
// Reference Shigley-style design: m = 4 mm, N_w = 2 starts, N_g = 50 teeth,
//   d_w = 40 mm, μ = 0.04, n_w = 1750 rpm, T_w = 10 N·m.
//   i = 50/2 = 25
//   L = 2·4·π = 25.133 mm
//   γ = atan(2·4/40) = atan(0.2) = 11.31°
//   d_g = 50·4 = 200 mm
//   C = (40+200)/2 = 120 mm
//   φ = atan(0.04) = 2.291°  (< γ ⇒ NOT self-locking)
//   η = tan(11.31°)/tan(11.31°+2.291°) = 0.2/tan(13.6°) = 0.2/0.2417 = 0.827
//   n_g = 1750/25 = 70 rpm
//   T_g = 10·25·0.827 = 206.8 N·m

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.wormgear.analyse({
    moduleMm: 4, wormStarts: 2, gearTeeth: 50,
    wormPitchDiameterMm: 40, frictionCoefficient: 0.04,
    inputSpeedRpm: 1750, inputTorqueNm: 10,
});
console.log(JSON.stringify(r, null, 2));

assert(Math.abs(r.velocityRatio - 25) < 1e-9, 'i = 25');
assert(Math.abs(r.leadMm - 2 * 4 * Math.PI) < 1e-9, 'L = N_w·m·π');
assert(Math.abs(r.leadAngleDeg - Math.atan(0.2) * 180 / Math.PI) < 1e-6, 'γ');
assert(Math.abs(r.gearPitchDiameterMm - 200) < 1e-9, 'd_g = N_g·m');
assert(Math.abs(r.centreDistanceMm - 120) < 1e-9, 'C');
assert(Math.abs(r.outputSpeedRpm - 70) < 1e-9, 'n_g = n_w/i');
assert(r.selfLocking === false, 'not self-locking (γ > φ)');
assert(r.efficiencyPct > 80 && r.efficiencyPct < 85, 'η ≈ 82%');
assert(r.outputTorqueNm > 195 && r.outputTorqueNm < 215, 'T_g ≈ 207');

// Single-start worm with high friction → self-locking.
const single = kernel.wormgear.analyse({
    moduleMm: 4, wormStarts: 1, gearTeeth: 50,
    wormPitchDiameterMm: 50, frictionCoefficient: 0.15,
    inputSpeedRpm: 1750, inputTorqueNm: 10,
});
console.log('single start μ=0.15', JSON.stringify(single));
assert(single.selfLocking === true, 'single-start high μ self-locks');
assert(single.efficiencyPct < 50, 'self-locking ⇒ low η');

// Frictionless: η → 100%, lossless torque amplification.
const ideal = kernel.wormgear.analyse({
    moduleMm: 4, wormStarts: 2, gearTeeth: 50,
    wormPitchDiameterMm: 40, frictionCoefficient: 0,
    inputSpeedRpm: 1750, inputTorqueNm: 10,
});
assert(Math.abs(ideal.efficiencyPct - 100) < 1e-6, 'frictionless η=100%');
assert(Math.abs(ideal.outputTorqueNm - 10 * 25) < 1e-6, 'T_g = T_w·i ideally');

// More starts → larger γ → higher η, but smaller i (for same N_g).
const morestarts = kernel.wormgear.analyse({
    moduleMm: 4, wormStarts: 4, gearTeeth: 50,
    wormPitchDiameterMm: 40, frictionCoefficient: 0.04,
    inputSpeedRpm: 1750, inputTorqueNm: 10,
});
console.log('4 starts', JSON.stringify(morestarts));
assert(morestarts.leadAngleDeg > r.leadAngleDeg, '4 starts → larger γ');
assert(morestarts.efficiencyPct > r.efficiencyPct, '4 starts → higher η');
assert(morestarts.velocityRatio < r.velocityRatio, '4 starts → smaller i');

// Higher input speed → higher sliding velocity (proportional).
const fast = kernel.wormgear.analyse({
    moduleMm: 4, wormStarts: 2, gearTeeth: 50,
    wormPitchDiameterMm: 40, frictionCoefficient: 0.04,
    inputSpeedRpm: 3500, inputTorqueNm: 10,
});
assert(Math.abs(fast.slidingVelocityMs - 2 * r.slidingVelocityMs) < 1e-6, 'V_s ∝ n_w');

// Bad inputs.
let threw = false;
try {
    kernel.wormgear.analyse({ moduleMm: 0, wormStarts: 2, gearTeeth: 50,
        wormPitchDiameterMm: 40, frictionCoefficient: 0.04,
        inputSpeedRpm: 1750, inputTorqueNm: 10 });
} catch (e) { threw = true; }
assert(threw, 'm = 0 throws');

threw = false;
try {
    kernel.wormgear.analyse({ moduleMm: 4, wormStarts: 8, gearTeeth: 50,
        wormPitchDiameterMm: 40, frictionCoefficient: 0.04,
        inputSpeedRpm: 1750, inputTorqueNm: 10 });
} catch (e) { threw = true; }
assert(threw, 'N_w = 8 throws');

console.log('Forge-290 worm gear smoke OK');
