// Forge-293 — crane hook smoke (DIN 15400 / ASME B30.10).
//
// Reference: 5-tonne single-point hook (WLL = 50 kN per ASME B30.10 #2.5).
//   Shank d_s = 50 mm → A_shank = π·25² = 1963.5 mm²
//   σ_shank = 50 000 / 1963.5 = 25.46 MPa
//   σ_shank,allow = 80 MPa (general forging) → DCR_shank = 0.318 ✓
//
//   Throat (trapezoidal, equiv rectangular Z = 80 000 mm³)
//   Load eccentricity L_arm = 75 mm.
//   M = 50 000 · 75 = 3 750 000 N·mm
//   σ_throat = 3.75e6 / 8e4 = 46.88 MPa
//   σ_throat,allow = 130 MPa (curved-beam adjusted) → DCR_throat = 0.360 ✓
//   Overall PASS (governing DCR = 0.360).

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.hook.analyse({
    wllKN: 50, shankDiameterMm: 50, shankAllowableStressMPa: 80,
    throatSectionModulusMm3: 80000, throatMomentArmMm: 75,
    throatAllowableStressMPa: 130,
});
console.log(JSON.stringify(r, null, 2));

assert(Math.abs(r.shankAreaMm2 - Math.PI * 625) < 1e-9, 'A_shank');
assert(Math.abs(r.shankStressMPa - 50000 / r.shankAreaMm2) < 1e-9, 'σ_shank');
assert(Math.abs(r.bendingMomentNmm - 3.75e6) < 1e-9, 'M = WLL·L');
assert(Math.abs(r.throatStressMPa - 46.875) < 1e-9, 'σ_throat');
assert(r.shankOK === true, 'shank passes');
assert(r.throatOK === true, 'throat passes');
assert(r.overallOK === true, 'overall pass');
assert(Math.abs(r.governingDCR - 0.36058) < 1e-3, 'governing DCR');

// Overload: 200 kN on same hook.
const overload = kernel.hook.analyse({
    wllKN: 200, shankDiameterMm: 50, shankAllowableStressMPa: 80,
    throatSectionModulusMm3: 80000, throatMomentArmMm: 75,
    throatAllowableStressMPa: 130,
});
console.log('overload', JSON.stringify(overload));
assert(overload.throatDCR > 1.0, 'throat overloaded');
assert(overload.throatOK === false, 'throat fails');
assert(overload.overallOK === false, 'overall fail');

// Very small shank: shank governs.
const slim = kernel.hook.analyse({
    wllKN: 50, shankDiameterMm: 20, shankAllowableStressMPa: 80,
    throatSectionModulusMm3: 80000, throatMomentArmMm: 75,
    throatAllowableStressMPa: 130,
});
console.log('slim shank', JSON.stringify(slim));
assert(slim.shankDCR > slim.throatDCR, 'shank governs');
assert(slim.shankOK === false, 'shank overloaded');

// Throat stress scales linearly with WLL and L_arm.
const big = kernel.hook.analyse({
    wllKN: 100, shankDiameterMm: 60, shankAllowableStressMPa: 100,
    throatSectionModulusMm3: 80000, throatMomentArmMm: 75,
    throatAllowableStressMPa: 130,
});
assert(Math.abs(big.throatStressMPa - 2 * r.throatStressMPa) < 1e-6,
       'σ_throat ∝ WLL');

const longArm = kernel.hook.analyse({
    wllKN: 50, shankDiameterMm: 50, shankAllowableStressMPa: 80,
    throatSectionModulusMm3: 80000, throatMomentArmMm: 150,
    throatAllowableStressMPa: 130,
});
assert(Math.abs(longArm.throatStressMPa - 2 * r.throatStressMPa) < 1e-6,
       'σ_throat ∝ L_arm');

// Invalid inputs throw.
let threw = false;
try {
    kernel.hook.analyse({ wllKN: 0, shankDiameterMm: 50,
        shankAllowableStressMPa: 80, throatSectionModulusMm3: 80000,
        throatMomentArmMm: 75, throatAllowableStressMPa: 130 });
} catch (e) { threw = true; }
assert(threw, 'WLL = 0 throws');

console.log('Forge-293 crane hook smoke OK');
