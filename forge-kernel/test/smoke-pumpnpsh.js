// Forge-273 — pump NPSH smoke (Hydraulic Institute ANSI/HI 9.6).
//
// Water at 20 °C: p_atm = 101 325 Pa (sea level), p_v = 2 339 Pa,
//   ρ = 998 kg/m³, flooded suction z_s = +3 m, h_f = 1.5 m, NPSH_R = 4 m.
//   pressureHead = (101325 − 2339)/(998·9.80665) = 10.115 m
//   NPSH_A = 10.115 + 3 − 1.5 = 11.615 m
//   margin = 11.615 − 4 = 7.615 m;  marginPct = 7.615 / 4 · 100 = 190.4 %
//   cavitating? false;  marginal? false  (≥ 1.1·NPSH_R = 4.4 and > 1 m margin)

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.pumpnpsh.analyse({
    atmosphericPressurePa: 101325,
    vapourPressurePa:      2339,
    densityKgM3:           998,
    staticSuctionHeadM:    3,
    frictionHeadM:         1.5,
    requiredNpshM:         4,
});
console.log(JSON.stringify(r, null, 2));
assert(Math.abs(r.pressureHeadM - 10.115) < 0.05, 'pressure head ≈ 10.115');
assert(Math.abs(r.availableNpshM - 11.615) < 0.05, 'NPSH_A ≈ 11.615');
assert(Math.abs(r.marginM - 7.615) < 0.05, 'margin ≈ 7.615');
assert(Math.abs(r.marginPct - 190.4) < 1, 'marginPct ≈ 190%');
assert(r.cavitating === false, 'not cavitating');
assert(r.marginalPerHi === false, 'not marginal per HI');

// Suction lift case: NPSH_A drops by (h_lift − h_flooded) amount.
const lift = kernel.pumpnpsh.analyse({
    atmosphericPressurePa: 101325,
    vapourPressurePa:      2339,
    densityKgM3:           998,
    staticSuctionHeadM:   -6,     // lift 6 m
    frictionHeadM:         1.5,
    requiredNpshM:         4,
});
console.log('lift', JSON.stringify(lift));
assert(Math.abs(lift.availableNpshM - (r.availableNpshM - 9)) < 1e-6, 'lift drops NPSH_A by 9 m');
assert(lift.cavitating === true, 'lift cavitates');
assert(lift.marginM < 0, 'margin negative');

// Hot water case (90 °C): p_v ≈ 70.1 kPa, ρ ≈ 965 kg/m³.
const hot = kernel.pumpnpsh.analyse({
    atmosphericPressurePa: 101325,
    vapourPressurePa:      70140,
    densityKgM3:           965,
    staticSuctionHeadM:    3,
    frictionHeadM:         1.5,
    requiredNpshM:         4,
});
console.log('hot', JSON.stringify(hot));
assert(hot.pressureHeadM < r.pressureHeadM, 'hot water has lower pressure head');
assert(hot.cavitating === true || hot.marginalPerHi === true, 'hot water cavitates or marginal');

// Altitude: p_atm = 70 kPa (≈ 3000 m) drops NPSH_A.
const alt = kernel.pumpnpsh.analyse({
    atmosphericPressurePa: 70000,
    vapourPressurePa:      2339,
    densityKgM3:           998,
    staticSuctionHeadM:    3,
    frictionHeadM:         1.5,
    requiredNpshM:         4,
});
console.log('alt', JSON.stringify(alt));
assert(alt.availableNpshM < r.availableNpshM, 'altitude drops NPSH_A');

// Marginal-per-HI flag: NPSH_A just above NPSH_R but margin < 1 m.
const marg = kernel.pumpnpsh.analyse({
    atmosphericPressurePa: 101325,
    vapourPressurePa:      2339,
    densityKgM3:           998,
    staticSuctionHeadM:    0,
    frictionHeadM:         5.5,
    requiredNpshM:         4,
});
console.log('marginal', JSON.stringify(marg));
assert(marg.cavitating === false, 'not cavitating yet');
assert(marg.marginalPerHi === true, 'marginal per HI flag');

console.log('Forge-273 pump NPSH smoke OK');
