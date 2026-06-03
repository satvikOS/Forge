// Forge-269 — power screw torque smoke (Shigley Ex. 8-1 numbers).
//
// Shigley Example 8-1: 32-mm square thread, pitch 4 mm (single start, L=4),
//   F = 6.4 kN, μ = μ_c = 0.08, d_c = 40 mm. d_m = 32 − 4/2 = 30 mm.
//   tan λ = 4 / (π·30) = 0.04244 → λ = 2.430°
//   T_raise = (6400·30/2)·(4 + π·0.08·30)/(π·30 − 0.08·4) ÷ 1000
//          = 96000·(4 + 7.5398)/(94.248 − 0.32) = 96000·11.5398/93.928
//          = 11792.4 N·mm = 11.79 N·m
//   T_collar = 6400·0.08·40/2 / 1000 = 10.24 N·m
//   T_total_raise ≈ 22.03 N·m
//   η = (6.4·4)/(2π·11.79·1000) ≈ 0.346  (34.6%)
//   Self-locking? μ=0.08 > tan λ=0.0424 ⇒ yes.

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.powerscrew.analyse({
    axialForceN: 6400, meanDiameterMm: 30, leadMm: 4,
    threadFriction: 0.08, collarFriction: 0.08, collarMeanDiameterMm: 40,
    threadType: 'square',
});

console.log(JSON.stringify(r, null, 2));
assert(Math.abs(r.leadAngleDeg - 2.430) < 0.05, 'λ ≈ 2.43°');
assert(Math.abs(r.raiseTorqueNm - 11.79) < 0.1, 'T_raise ≈ 11.79');
assert(Math.abs(r.collarTorqueNm - 10.24) < 0.05, 'T_collar = 10.24');
assert(Math.abs(r.totalRaiseTorqueNm - 22.03) < 0.15, 'T_total ≈ 22.03');
assert(Math.abs(r.efficiencyPct - 34.6) < 0.5, 'η ≈ 34.6%');
assert(r.selfLocking === true, 'self-locking');

// Frictionless: η → 1, T_raise → F·L/(2π), zero lower torque, not self-locking.
const fr = kernel.powerscrew.analyse({
    axialForceN: 6400, meanDiameterMm: 30, leadMm: 4,
    threadFriction: 0, collarFriction: 0, collarMeanDiameterMm: 40,
    threadType: 'square',
});
console.log('frictionless', JSON.stringify(fr));
assert(Math.abs(fr.efficiencyPct - 100) < 1e-6, 'frictionless η=100');
assert(Math.abs(fr.raiseTorqueNm - 6400 * 0.004 / (2 * Math.PI)) < 1e-9, 'frictionless T_raise');
assert(fr.selfLocking === false, 'frictionless not self-locking');

// ACME secant correction: same inputs but ACME ⇒ μ_eff = 0.08/cos(14.5°) ≈ 0.0826.
const ac = kernel.powerscrew.analyse({
    axialForceN: 6400, meanDiameterMm: 30, leadMm: 4,
    threadFriction: 0.08, collarFriction: 0.08, collarMeanDiameterMm: 40,
    threadType: 'acme',
});
console.log('acme', JSON.stringify(ac));
assert(ac.effectiveFriction > r.effectiveFriction, 'ACME μ_eff increased');
assert(ac.raiseTorqueNm > r.raiseTorqueNm, 'ACME raise > square');
assert(Math.abs(ac.effectiveFriction - 0.08 / Math.cos(14.5 * Math.PI / 180)) < 1e-9,
       'sec(14.5°) correction');

// Non-self-locking case: very large lead, low friction.
const ns = kernel.powerscrew.analyse({
    axialForceN: 1000, meanDiameterMm: 20, leadMm: 40,
    threadFriction: 0.05, collarFriction: 0, collarMeanDiameterMm: 0,
    threadType: 'square',
});
console.log('non-self-lock', JSON.stringify(ns));
assert(ns.selfLocking === false, 'large lead → not self-locking');
assert(ns.lowerTorqueNm < 0, 'lower torque negative ⇒ back-drives');

console.log('Forge-269 power screw smoke OK');
