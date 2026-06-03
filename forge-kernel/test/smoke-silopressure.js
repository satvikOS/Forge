// Forge-275 — Janssen silo wall pressure smoke (1895 closed form).
//
// Reference grain silo: D = 8 m (R = D/4 = 2 m), γ = 8 kN/m³ (wheat),
//   μ = 0.4, k = 0.4 → z_c = R/(μk) = 2/(0.16) = 12.5 m.
// At z = z_c → factor = 1 − e^-1 ≈ 0.632
//   p_v_inf = γ·R/(μk) = 8·2/0.16 = 100 kPa
//   p_w_inf = γ·R/μ    = 8·2/0.4  = 40 kPa
//   τ_inf   = γ·R      = 16 kPa
// So at z=z_c:  p_v ≈ 63.2 kPa, p_w ≈ 25.3 kPa, τ ≈ 10.1 kPa.

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const base = {
    bulkUnitWeightKnM3: 8,
    hydraulicRadiusM: 2,
    wallFrictionCoefficient: 0.4,
    horizontalRatioK: 0.4,
};

// z = 0 ⇒ all pressures zero.
const top = kernel.silopressure.analyse({ ...base, depthM: 0 });
console.log('top', JSON.stringify(top, null, 2));
assert(Math.abs(top.verticalPressureKPa) < 1e-9, 'p_v(0) = 0');
assert(Math.abs(top.wallPressureKPa) < 1e-9, 'p_w(0) = 0');
assert(Math.abs(top.asymptoticVerticalKPa - 100) < 1e-6, 'p_v_inf = 100 kPa');
assert(Math.abs(top.asymptoticWallKPa - 40) < 1e-6, 'p_w_inf = 40 kPa');
assert(Math.abs(top.asymptoticFrictionKPa - 16) < 1e-6, 'τ_inf = 16 kPa');

// At z = z_c = 12.5 m, factor = 1 − e^-1 ≈ 0.6321.
const zc = kernel.silopressure.analyse({ ...base, depthM: 12.5 });
console.log('zc', JSON.stringify(zc));
assert(Math.abs(zc.depthRatioToZc - 1.0) < 1e-9, 'z/z_c = 1');
assert(Math.abs(zc.verticalPressureKPa - 100 * (1 - Math.exp(-1))) < 1e-6, 'p_v ≈ 63.2');
assert(Math.abs(zc.wallPressureKPa - 40 * (1 - Math.exp(-1))) < 1e-6, 'p_w ≈ 25.3');
assert(Math.abs(zc.frictionStressKPa - 16 * (1 - Math.exp(-1))) < 1e-6, 'τ ≈ 10.1');

// Deep silo: z → ∞ ⇒ pressures asymptote.
const deep = kernel.silopressure.analyse({ ...base, depthM: 100 });
console.log('deep', JSON.stringify(deep));
assert(deep.verticalPressureKPa > 0.999 * deep.asymptoticVerticalKPa, 'p_v → asymptote');
assert(deep.wallPressureKPa     > 0.999 * deep.asymptoticWallKPa,     'p_w → asymptote');
assert(deep.frictionStressKPa   > 0.999 * deep.asymptoticFrictionKPa, 'τ → asymptote');

// k = ratio: at same z, k smaller ⇒ z_c larger ⇒ slower asymptote.
const lowK = kernel.silopressure.analyse({ ...base, horizontalRatioK: 0.25, depthM: 12.5 });
console.log('lowK', JSON.stringify(lowK));
assert(lowK.depthRatioToZc < 1.0, 'lower k → larger z_c → smaller z/z_c');

// Smaller R (thinner silo) ⇒ smaller asymptote.
const thin = kernel.silopressure.analyse({ ...base, hydraulicRadiusM: 0.5, depthM: 12.5 });
console.log('thin', JSON.stringify(thin));
assert(thin.asymptoticVerticalKPa < zc.asymptoticVerticalKPa, 'smaller R → smaller p_v_inf');

console.log('Forge-275 silo pressure smoke OK');
