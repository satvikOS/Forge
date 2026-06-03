// Forge-286 — capstan / bollard friction smoke (Eytelwein 1832).
//
// Classic marine bollard problem: a ship pulls with 100 kN on the dock side;
// the longshoreman holds the other side. μ = 0.3 (rope on bollard), wrap = 3
// turns = 1080°.
//   θ = 1080·π/180 = 18.8496 rad
//   amp = e^(0.3·18.8496) = e^5.6549 ≈ 285.7
//   T_2 (held) such that T_1 = 100 000 ⇒ T_2 = 100 000 / 285.7 ≈ 350 N
// Inversely, with T_2 = 350, T_1 = 100 000.

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.capstan.analyse({
    holdingForceN: 350,
    frictionCoefficient: 0.3,
    wrapAngleDeg: 1080,
});
console.log(JSON.stringify(r, null, 2));

assert(Math.abs(r.wrapAngleRad - 1080 * Math.PI / 180) < 1e-9, 'rad conversion');
assert(Math.abs(r.amplificationRatio - Math.exp(0.3 * 1080 * Math.PI / 180)) < 1e-6, 'amp closed form');
assert(Math.abs(r.maxLoadN - 350 * r.amplificationRatio) < 1e-6, 'T_1 = T_2·amp');
assert(r.maxLoadN > 95000 && r.maxLoadN < 105000, 'T_1 ≈ 100 kN');
assert(Math.abs(r.mechanicalAdvantage - (r.amplificationRatio - 1)) < 1e-9, 'MA = amp − 1');

// Single 360° wrap with μ=0.5: amp = e^(0.5·2π) = e^π ≈ 23.14
const oneTurn = kernel.capstan.analyse({
    holdingForceN: 100, frictionCoefficient: 0.5, wrapAngleDeg: 360,
});
console.log('1 turn μ=0.5', JSON.stringify(oneTurn));
assert(Math.abs(oneTurn.amplificationRatio - Math.exp(Math.PI)) < 1e-6, 'amp = e^π');
assert(Math.abs(oneTurn.maxLoadN - 100 * Math.exp(Math.PI)) < 1e-6, 'T_1 from amp');

// Doubling μ doubles the EXPONENT (huge effect on amp).
const lowMu  = kernel.capstan.analyse({ holdingForceN: 100, frictionCoefficient: 0.25, wrapAngleDeg: 1080 });
const highMu = kernel.capstan.analyse({ holdingForceN: 100, frictionCoefficient: 0.50, wrapAngleDeg: 1080 });
console.log('μ scan', lowMu.amplificationRatio, '->', highMu.amplificationRatio);
assert(Math.abs(Math.log(highMu.amplificationRatio) - 2 * Math.log(lowMu.amplificationRatio)) < 1e-6,
       'ln(amp) ∝ μ');

// Half angle, half exponent.
const halfAngle = kernel.capstan.analyse({
    holdingForceN: 100, frictionCoefficient: 0.3, wrapAngleDeg: 540,
});
assert(Math.abs(Math.log(r.amplificationRatio) - 2 * Math.log(halfAngle.amplificationRatio))
       < 1e-6, 'ln(amp) ∝ θ (3 turns = 2×1.5 turns exponent)');

// Invalid inputs throw.
let threw = false;
try {
    kernel.capstan.analyse({ holdingForceN: -10, frictionCoefficient: 0.3, wrapAngleDeg: 360 });
} catch (e) { threw = true; }
assert(threw, 'T_2 ≤ 0 throws');

threw = false;
try {
    kernel.capstan.analyse({ holdingForceN: 100, frictionCoefficient: 0, wrapAngleDeg: 360 });
} catch (e) { threw = true; }
assert(threw, 'μ ≤ 0 throws');

threw = false;
try {
    kernel.capstan.analyse({ holdingForceN: 100, frictionCoefficient: 0.3, wrapAngleDeg: 10000 });
} catch (e) { threw = true; }
assert(threw, 'wrap > 20 turns throws');

console.log('Forge-286 capstan smoke OK');
