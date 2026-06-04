// Forge-297 — 1D consolidation smoke (Terzaghi 1925).
//
// Reference: 6 m thick saturated clay over impervious bedrock (single
//   drainage), c_v = 2 m²/year, m_v = 0.5 m²/MN, surcharge Δσ' = 100 kPa.
//   H_dr = 6 m (single drainage)
//   S_∞ = 0.5·100·1e-3·6 = 0.3 m = 300 mm
//   At t=10 yr: T_v = 2·10/36 = 0.5556
//     U from Casagrande: U = 1 − (8/π²)·exp(-π²·0.5556/4)
//                        = 1 − 0.811·exp(-1.371) = 1 − 0.811·0.254
//                        = 1 − 0.206 = 0.794
//     S(10) = 0.794·300 = 238 mm
//   t_90 = 0.848·36/2 = 15.26 years.

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.consol.analyse({
    soilDepthM: 6, doubleDrainage: false,
    coefficientOfConsolidationM2yr: 2,
    volumeCompressibilityM2MN: 0.5,
    pressureIncreaseKPa: 100,
    timeYears: 10,
});
console.log(JSON.stringify(r, null, 2));

assert(Math.abs(r.drainagePathM - 6) < 1e-9, 'H_dr');
assert(Math.abs(r.timeFactor - 2 * 10 / 36) < 1e-9, 'T_v');
assert(Math.abs(r.ultimateSettlementMm - 300) < 1e-6, 'S_∞ = 300');
assert(r.degreeOfConsolidationPct > 75 && r.degreeOfConsolidationPct < 85, 'U ≈ 79%');
assert(r.settlementAtTimeMm > 220 && r.settlementAtTimeMm < 250, 'S(10) ≈ 238 mm');
assert(Math.abs(r.t90Years - 0.848 * 36 / 2) < 1e-6, 't_90 ≈ 15.3 yr');

// Double drainage: H_dr = H/2 → 4× faster consolidation.
const dbl = kernel.consol.analyse({
    soilDepthM: 6, doubleDrainage: true,
    coefficientOfConsolidationM2yr: 2,
    volumeCompressibilityM2MN: 0.5,
    pressureIncreaseKPa: 100,
    timeYears: 10,
});
console.log('double', JSON.stringify(dbl));
assert(Math.abs(dbl.drainagePathM - 3) < 1e-9, 'H_dr = H/2');
assert(Math.abs(dbl.t90Years - r.t90Years / 4) < 1e-6, 't_90 ∝ H_dr² (4× faster)');
assert(dbl.degreeOfConsolidation > r.degreeOfConsolidation, 'double drains faster');
assert(Math.abs(dbl.ultimateSettlementMm - r.ultimateSettlementMm) < 1e-6,
       'S_∞ unchanged (depends on H not H_dr)');

// At t = t_90 (using single drainage), U should be ≈ 90%.
const at90 = kernel.consol.analyse({
    soilDepthM: 6, doubleDrainage: false,
    coefficientOfConsolidationM2yr: 2,
    volumeCompressibilityM2MN: 0.5,
    pressureIncreaseKPa: 100,
    timeYears: r.t90Years,
});
console.log('at t_90', JSON.stringify(at90));
assert(Math.abs(at90.degreeOfConsolidationPct - 90) < 1, 'U ≈ 90% at t_90');

// Higher Δσ' → linear scaling of settlement.
const big = kernel.consol.analyse({
    soilDepthM: 6, doubleDrainage: false,
    coefficientOfConsolidationM2yr: 2,
    volumeCompressibilityM2MN: 0.5,
    pressureIncreaseKPa: 200,
    timeYears: 10,
});
assert(Math.abs(big.ultimateSettlementMm - 2 * r.ultimateSettlementMm) < 1e-6,
       'S_∞ ∝ Δσ\'');

// t = 0 → U = 0 → no settlement yet.
const zero = kernel.consol.analyse({
    soilDepthM: 6, doubleDrainage: false,
    coefficientOfConsolidationM2yr: 2,
    volumeCompressibilityM2MN: 0.5,
    pressureIncreaseKPa: 100,
    timeYears: 0,
});
assert(zero.degreeOfConsolidation === 0, 'U = 0 at t = 0');
assert(zero.settlementAtTimeMm === 0, 'S(0) = 0');
assert(Math.abs(zero.ultimateSettlementMm - 300) < 1e-6, 'S_∞ still 300');

// Long time → U → 1.
const long_ = kernel.consol.analyse({
    soilDepthM: 6, doubleDrainage: false,
    coefficientOfConsolidationM2yr: 2,
    volumeCompressibilityM2MN: 0.5,
    pressureIncreaseKPa: 100,
    timeYears: 100,
});
assert(long_.degreeOfConsolidation > 0.99, 'U → 1 at long t');
assert(Math.abs(long_.settlementAtTimeMm - 300) < 5, 'S(∞) → S_∞');

// Bad inputs.
let threw = false;
try {
    kernel.consol.analyse({ soilDepthM: 0, doubleDrainage: false,
        coefficientOfConsolidationM2yr: 2,
        volumeCompressibilityM2MN: 0.5,
        pressureIncreaseKPa: 100, timeYears: 10 });
} catch (e) { threw = true; }
assert(threw, 'H = 0 throws');

console.log('Forge-297 consolidation smoke OK');
