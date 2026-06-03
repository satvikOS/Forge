// Forge-274 — wood column smoke (NDS 2018 §3.7).
//
// 2×6 SPF stud (38×140 mm dressed): F_c = 6.62 MPa, E_min = 4140 MPa,
//   l_e = 2440 mm (8 ft single-story stud), d_least = 38 mm (weak axis).
//   λ = 2440/38 = 64.2 — exceeds NDS limit 50 → expect throw.
//
// Resize to studs at 24" o.c. with sheathing bracing weak axis:
//   l_e_weak = sheathing pitch ≈ 600 mm (24"), l_e_strong = 2440 mm.
//   λ_weak = 600/38 = 15.8;  λ_strong = 2440/140 = 17.4 — strong axis governs.
//   Use d = 140 mm (strong axis dimension) and l_e = 2440 mm so λ = 17.4.

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.woodcolumn.analyse({
    referenceFcMPa: 6.62, emin_MPa: 4140,
    areaMm2: 38 * 140, effectiveLengthMm: 2440,
    leastDimensionMm: 140,  // strong-axis check
    columnType: 'sawn',
    cD: 1.0, cM: 1.0, cT: 1.0, cF: 1.0, cI: 1.0,
});
console.log('sawn-strong', JSON.stringify(r, null, 2));
assert(Math.abs(r.slendernessLeOverD - 17.43) < 0.05, 'λ ≈ 17.43');
assert(r.cFactor === 0.8, 'c = 0.8 for sawn');
assert(r.cP > 0.5 && r.cP < 1.0, 'C_p reasonable');
assert(Math.abs(r.fcPrimeMPa - r.fStarCMPa * r.cP) < 1e-6, 'F\'_c identity');
assert(Math.abs(r.pAllowN - r.fcPrimeMPa * 38 * 140) < 1e-6, 'P_allow identity');

// Slenderness limit > 50 throws.
let threw = false;
try {
    kernel.woodcolumn.analyse({
        referenceFcMPa: 6.62, emin_MPa: 4140,
        areaMm2: 38 * 140, effectiveLengthMm: 2440,
        leastDimensionMm: 38,  // λ = 64.2 — exceeds 50
        columnType: 'sawn',
        cD: 1.0, cM: 1.0, cT: 1.0, cF: 1.0, cI: 1.0,
    });
} catch (e) { threw = true; }
assert(threw, 'λ > 50 throws');

// Glulam c = 0.9 → higher C_p than sawn at same λ (curve transitions sharper).
const glulam = kernel.woodcolumn.analyse({
    referenceFcMPa: 6.62, emin_MPa: 4140,
    areaMm2: 38 * 140, effectiveLengthMm: 2440, leastDimensionMm: 140,
    columnType: 'glulam',
    cD: 1.0, cM: 1.0, cT: 1.0, cF: 1.0, cI: 1.0,
});
console.log('glulam', JSON.stringify(glulam));
assert(glulam.cFactor === 0.9, 'c = 0.9 for glulam');
assert(glulam.cP > r.cP, 'glulam c=0.9 gives larger C_p at same α');

// Short column → C_p → 1.
const short = kernel.woodcolumn.analyse({
    referenceFcMPa: 6.62, emin_MPa: 4140,
    areaMm2: 38 * 140, effectiveLengthMm: 500, leastDimensionMm: 140,
    columnType: 'sawn',
    cD: 1.0, cM: 1.0, cT: 1.0, cF: 1.0, cI: 1.0,
});
console.log('short', JSON.stringify(short));
assert(short.cP > 0.98, 'C_p ≈ 1 for short column');

// Long column → F_cE governs, P_allow drops sharply.
const long = kernel.woodcolumn.analyse({
    referenceFcMPa: 6.62, emin_MPa: 4140,
    areaMm2: 38 * 140, effectiveLengthMm: 6000, leastDimensionMm: 140,
    columnType: 'sawn',
    cD: 1.0, cM: 1.0, cT: 1.0, cF: 1.0, cI: 1.0,
});
console.log('long', JSON.stringify(long));
assert(long.cP < r.cP, 'long column has smaller C_p');
assert(long.pAllowN < r.pAllowN, 'long column smaller P_allow');

console.log('Forge-274 wood column smoke OK');
