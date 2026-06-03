// Forge-285 — AASHTO 93 flexible pavement smoke.
//
// Reference: AASHTO 1993 textbook example
//   W_18 = 5e6 ESAL, R = 95%, S_0 = 0.45, ΔPSI = 4.2 - 2.5 = 1.7,
//   M_R = 5000 psi.
//   Z_R = Φ⁻¹(0.05) ≈ -1.6449
//   Solve nonlinear equation → SN ≈ 4.3-4.5 (typical textbook range)

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.aashto.analyse({
    w18Esals: 5e6, reliabilityPct: 95, overallStdDev: 0.45,
    deltaPSI: 1.7, subgradeMrPsi: 5000,
});
console.log(JSON.stringify(r, null, 2));

assert(Math.abs(r.zR - (-1.6449)) < 0.001, 'Z_R for R=95%');
assert(Math.abs(r.logW18 - Math.log10(5e6)) < 1e-9, 'log W_18');
assert(r.structuralNumber > 4.0 && r.structuralNumber < 5.5, 'SN reasonable');
assert(r.iterations > 0 && r.iterations < 30, 'iterations bounded');

// Higher reliability requires bigger SN.
const r99 = kernel.aashto.analyse({
    w18Esals: 5e6, reliabilityPct: 99, overallStdDev: 0.45,
    deltaPSI: 1.7, subgradeMrPsi: 5000,
});
console.log('R=99', JSON.stringify(r99));
assert(r99.structuralNumber > r.structuralNumber, 'higher R → bigger SN');

// Stronger subgrade (higher M_R) reduces SN.
const stiff = kernel.aashto.analyse({
    w18Esals: 5e6, reliabilityPct: 95, overallStdDev: 0.45,
    deltaPSI: 1.7, subgradeMrPsi: 15000,
});
console.log('M_R=15k', JSON.stringify(stiff));
assert(stiff.structuralNumber < r.structuralNumber, 'stiffer subgrade → smaller SN');

// Heavier traffic raises SN.
const heavy = kernel.aashto.analyse({
    w18Esals: 5e7, reliabilityPct: 95, overallStdDev: 0.45,
    deltaPSI: 1.7, subgradeMrPsi: 5000,
});
assert(heavy.structuralNumber > r.structuralNumber, 'more ESALs → bigger SN');

// R = 50% gives Z_R = 0 (and smaller SN than R=95%).
const r50 = kernel.aashto.analyse({
    w18Esals: 5e6, reliabilityPct: 50.5, overallStdDev: 0.45,
    deltaPSI: 1.7, subgradeMrPsi: 5000,
});
console.log('R=50.5', JSON.stringify(r50));
assert(Math.abs(r50.zR) < 0.02, 'Z_R ≈ 0 at R=50');
assert(r50.structuralNumber < r.structuralNumber, 'R=50 → smaller SN');

// Reliability out of range throws.
let threw = false;
try {
    kernel.aashto.analyse({ w18Esals: 5e6, reliabilityPct: 30,
        overallStdDev: 0.45, deltaPSI: 1.7, subgradeMrPsi: 5000 });
} catch (e) { threw = true; }
assert(threw, 'R < 50 throws');

console.log('Forge-285 AASHTO pavement smoke OK');
