// Forge-281 — disc clutch/brake torque smoke (Shigley Ex. 16-1).
//
// Single-disc clutch: R_o = 75 mm, R_i = 30 mm, μ = 0.32, F = 4500 N,
//   n = 2 (both faces of the disc used). Uniform-wear assumption.
//
//   Uniform wear:
//     T = μ·F·(R_o + R_i)/2 · n
//       = 0.32·4500·52.5·2 = 151 200 N·mm = 151.2 N·m
//     p_max = F / (π·R_i·(R_o − R_i))
//           = 4500 / (π·30·45) = 1.061 N/mm² = 1.061 MPa
//
//   Uniform pressure:
//     T = (2/3)·μ·F·(R_o³−R_i³)/(R_o²−R_i²) · n
//       = (2/3)·0.32·4500·(421875−27000)/(5625−900)·2
//       = (2/3)·0.32·4500·83.49·2
//       = 160 305 N·mm = 160.3 N·m
//     p_max = p_avg = F/area = 4500/(π·(5625−900)) = 0.3041 MPa

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const base = {
    outerRadiusMm: 75, innerRadiusMm: 30,
    frictionCoefficient: 0.32, clampingForceN: 4500, numberOfFaces: 2,
};

const wear = kernel.discbrake.analyse({ ...base, assumption: 'uniform-wear' });
console.log('wear', JSON.stringify(wear, null, 2));
assert(Math.abs(wear.torqueNm - 151.2) < 0.1, 'T_wear ≈ 151.2 N·m');
assert(Math.abs(wear.maxPressureMPa - 4500 / (Math.PI * 30 * 45)) < 1e-6, 'p_max wear');
assert(wear.assumptionUsed === 'uniform-wear', 'assumption tag');

const pres = kernel.discbrake.analyse({ ...base, assumption: 'uniform-pressure' });
console.log('pressure', JSON.stringify(pres));
assert(Math.abs(pres.torqueNm - 160.3) < 0.2, 'T_pres ≈ 160.3 N·m');
assert(Math.abs(pres.maxPressureMPa - pres.averagePressureMPa) < 1e-9,
       'uniform-pressure p_max = p_avg');
assert(pres.assumptionUsed === 'uniform-pressure', 'assumption tag');

// Uniform pressure gives slightly higher T at same F (no concentration penalty).
assert(pres.torqueNm > wear.torqueNm, 'uniform-pressure T > uniform-wear T');

// More faces multiplies torque linearly.
const multi = kernel.discbrake.analyse({ ...base, numberOfFaces: 6, assumption: 'uniform-wear' });
console.log('6 faces', JSON.stringify(multi));
assert(Math.abs(multi.torqueNm - wear.torqueNm * 3) < 1e-6, 'T scales with n');

// Higher friction.
const slick = kernel.discbrake.analyse({ ...base, frictionCoefficient: 0.16, assumption: 'uniform-wear' });
assert(Math.abs(slick.torqueNm - wear.torqueNm * 0.5) < 1e-6, 'T scales with μ');

// Bad inputs throw.
let threw = false;
try {
    kernel.discbrake.analyse({ ...base, outerRadiusMm: 30, innerRadiusMm: 30,
        assumption: 'uniform-wear' });
} catch (e) { threw = true; }
assert(threw, 'R_i ≥ R_o throws');

threw = false;
try {
    kernel.discbrake.analyse({ ...base, frictionCoefficient: 0,
        assumption: 'uniform-wear' });
} catch (e) { threw = true; }
assert(threw, 'μ = 0 throws');

console.log('Forge-281 disc brake smoke OK');
