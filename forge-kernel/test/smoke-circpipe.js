// Forge-289 — circular pipe Manning partial-flow smoke (Camp curves).
//
// Reference textbook problem: concrete storm sewer D = 1.0 m, n = 0.013,
//   S = 0.005, water depth d = 0.5 m (half-full).
//   d/D = 0.5 → θ = 2·arccos(0) = π rad.
//   A = (1.0²/8)·(π − sin π) = (1/8)·π = 0.3927 m²  (== A_full/2)
//   P = 1.0·π/2 = 1.5708 m
//   R = A/P = 0.25 m  (== D/4 == R_full — half-full has the SAME R as full!)
//   V = (1/0.013)·0.25^(2/3)·√0.005 = 76.923·0.3969·0.07071 = 2.158 m/s
//   Q = 0.3927·2.158 = 0.8475 m³/s
//
// Key insight: at d/D = 0.5, V = V_full and Q = Q_full/2 (Camp curve property).

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const half = kernel.circpipe.analyse({
    pipeDiameterM: 1.0, waterDepthM: 0.5,
    manningN: 0.013, slope: 0.005,
});
console.log('half-full', JSON.stringify(half, null, 2));

assert(Math.abs(half.depthRatio - 0.5) < 1e-9, 'd/D = 0.5');
assert(Math.abs(half.centralAngleRad - Math.PI) < 1e-9, 'θ = π at half full');
assert(Math.abs(half.flowAreaM2 - Math.PI / 8) < 1e-9, 'A = π/8 D²');
assert(Math.abs(half.hydraulicRadiusM - 0.25) < 1e-9, 'R = D/4 (same as full)');
assert(Math.abs(half.areaRatio - 0.5) < 1e-9, 'A/A_full = 0.5');
assert(Math.abs(half.velocityRatio - 1.0) < 1e-9, 'V/V_full = 1.0 at half full');
assert(Math.abs(half.dischargeRatio - 0.5) < 1e-9, 'Q/Q_full = 0.5 at half full');
assert(Math.abs(half.velocityMs - 2.158) < 0.05, 'V ≈ 2.158 m/s');

// Camp curve maximum: V/V_full peaks near d/D ≈ 0.81 at ~1.14;
// Q/Q_full peaks near d/D ≈ 0.94 at ~1.09.
const peakV = kernel.circpipe.analyse({
    pipeDiameterM: 1.0, waterDepthM: 0.81,
    manningN: 0.013, slope: 0.005,
});
const peakQ = kernel.circpipe.analyse({
    pipeDiameterM: 1.0, waterDepthM: 0.94,
    manningN: 0.013, slope: 0.005,
});
console.log('peakV', JSON.stringify(peakV));
console.log('peakQ', JSON.stringify(peakQ));
assert(peakV.velocityRatio > 1.10 && peakV.velocityRatio < 1.16, 'V/V_full peak ≈ 1.14');
assert(peakQ.dischargeRatio > 1.06 && peakQ.dischargeRatio < 1.10, 'Q/Q_full peak ≈ 1.08');

// Full bore: d/D = 1 → θ = 2π exactly (handled by arccos cap).
const full = kernel.circpipe.analyse({
    pipeDiameterM: 1.0, waterDepthM: 1.0,
    manningN: 0.013, slope: 0.005,
});
console.log('full', JSON.stringify(full));
assert(Math.abs(full.depthRatio - 1.0) < 1e-9, 'd/D = 1');
assert(Math.abs(full.centralAngleRad - 2 * Math.PI) < 1e-6, 'θ = 2π');
assert(Math.abs(full.flowAreaM2 - Math.PI / 4) < 1e-9, 'A = πD²/4');
assert(Math.abs(full.areaRatio - 1.0) < 1e-9, 'A_full');
assert(Math.abs(full.velocityRatio - 1.0) < 1e-9, 'V_full');
assert(Math.abs(full.dischargeRatio - 1.0) < 1e-9, 'Q_full');

// Discharge scales with √S.
const flat = kernel.circpipe.analyse({
    pipeDiameterM: 1.0, waterDepthM: 0.5, manningN: 0.013, slope: 0.005,
});
const steep = kernel.circpipe.analyse({
    pipeDiameterM: 1.0, waterDepthM: 0.5, manningN: 0.013, slope: 0.020,
});
assert(Math.abs(steep.velocityMs / flat.velocityMs - 2.0) < 1e-6, 'V ∝ √S (4× S = 2× V)');

// d > D throws.
let threw = false;
try {
    kernel.circpipe.analyse({ pipeDiameterM: 1.0, waterDepthM: 1.5,
        manningN: 0.013, slope: 0.005 });
} catch (e) { threw = true; }
assert(threw, 'd > D throws');

console.log('Forge-289 circular pipe smoke OK');
