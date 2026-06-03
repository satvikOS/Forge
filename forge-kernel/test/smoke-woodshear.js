// Forge-292 — wood shear wall smoke (NDS + SDPWS-21).
//
// Reference: 2.4 m × 3.0 m blocked OSB shear wall, V = 15 kN.
//   v = 15 / 2.4 = 6.25 kN/m (≈ 428 plf)
//   v_allow = 8.5 kN/m (typical 3/8" OSB w/ 8d nails @ 100 mm o.c.)
//   h/b = 3.0/2.4 = 1.25 (well under 3.5 aspect limit)
//   T = C = 15·3.0/2.4 = 18.75 kN
//   Chord stud: 89×140 mm = 12 460 mm²; f_c_allow = 12 MPa
//   σ_c = 18 750 / 12 460 = 1.504 MPa
//   shearDCR = 6.25/8.5 = 0.735 ✓
//   chordDCR = 1.504/12 = 0.125 ✓
//   aspect 1.25 ≤ 3.5 ✓ → overall PASS

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const ok = kernel.woodshear.analyse({
    shearLoadKN: 15, wallLengthM: 2.4, wallHeightM: 3.0,
    allowableShearKNm: 8.5,
    chordAreaMm2: 89 * 140, chordAllowableStressMPa: 12,
});
console.log(JSON.stringify(ok, null, 2));

assert(Math.abs(ok.unitShearKNm - 15 / 2.4) < 1e-9, 'v = V/b');
assert(Math.abs(ok.shearDCR - 6.25 / 8.5) < 1e-9, 'shear DCR');
assert(Math.abs(ok.aspectRatio - 1.25) < 1e-9, 'h/b');
assert(ok.aspectOK === true, 'aspect ≤ 3.5');
assert(Math.abs(ok.chordForceKN - 18.75) < 1e-9, 'T = V·h/b');
assert(Math.abs(ok.chordStressMPa - 18750 / (89 * 140)) < 1e-9, 'σ_c');
assert(ok.shearOK === true, 'shear passes');
assert(ok.chordOK === true, 'chord passes');
assert(ok.overallOK === true, 'overall pass');

// Tall narrow wall: aspect ratio > 3.5 fails.
const tall = kernel.woodshear.analyse({
    shearLoadKN: 15, wallLengthM: 0.8, wallHeightM: 3.0,
    allowableShearKNm: 8.5,
    chordAreaMm2: 89 * 140, chordAllowableStressMPa: 12,
});
console.log('tall', JSON.stringify(tall));
assert(tall.aspectRatio > 3.5, 'aspect > 3.5');
assert(tall.aspectOK === false, 'aspect fails');
assert(tall.overallOK === false, 'overall fail due to aspect');

// Overloaded shear: v > v_allow.
const overload = kernel.woodshear.analyse({
    shearLoadKN: 30, wallLengthM: 2.4, wallHeightM: 3.0,
    allowableShearKNm: 8.5,
    chordAreaMm2: 89 * 140, chordAllowableStressMPa: 12,
});
console.log('overload', JSON.stringify(overload));
assert(overload.shearDCR > 1.0, 'shear DCR > 1');
assert(overload.shearOK === false, 'shear fails');

// Slender chord: σ_c > f_c_allow.
const slimChord = kernel.woodshear.analyse({
    shearLoadKN: 50, wallLengthM: 2.4, wallHeightM: 3.0,
    allowableShearKNm: 25,
    chordAreaMm2: 38 * 89, chordAllowableStressMPa: 8,
});
console.log('slim chord', JSON.stringify(slimChord));
assert(slimChord.chordDCR > 1.0, 'chord DCR > 1');
assert(slimChord.chordOK === false, 'chord fails');

// Chord force scales linearly with h.
const taller = kernel.woodshear.analyse({
    shearLoadKN: 15, wallLengthM: 2.4, wallHeightM: 4.5,
    allowableShearKNm: 8.5,
    chordAreaMm2: 89 * 140, chordAllowableStressMPa: 12,
});
assert(Math.abs(taller.chordForceKN - 1.5 * ok.chordForceKN) < 1e-6, 'T ∝ h');

// Validation throws.
let threw = false;
try {
    kernel.woodshear.analyse({ shearLoadKN: 0, wallLengthM: 2.4, wallHeightM: 3.0,
        allowableShearKNm: 8.5, chordAreaMm2: 12460, chordAllowableStressMPa: 12 });
} catch (e) { threw = true; }
assert(threw, 'V = 0 throws');

console.log('Forge-292 wood shear wall smoke OK');
