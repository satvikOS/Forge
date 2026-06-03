// Forge-267 — punching shear smoke. Hand-checked interior column case.
//
// Interior 400×400 column, f'_c = 30 MPa, d = 200 mm, V_u = 600 kN.
//   b_0 = 2(400+200) + 2(400+200) = 2400 mm
//   β_c = 1.0  →  vc2 = (0.17 + 0.33/1) · 1 · √30 = 0.5·5.477 = 2.738 MPa
//   α_s = 40   →  vc3 = (0.083·40·200/2400 + 0.17)·√30 = (0.2767+0.17)·5.477 = 2.447 MPa
//   vc1 = 0.33·√30 = 1.807 MPa  → GOVERNS
//   V_c = 1.807·2400·200 = 867 360 N
//   φV_c = 0.75·867 360 = 650 520 N → DCR = 600 000 / 650 520 = 0.922  (pass)

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.rcpunching.analyse({
    concreteStrengthMPa: 30,
    effectiveDepthMm: 200,
    columnWidthMm: 400,
    columnDepthMm: 400,
    location: 'interior',
    lambdaLightweight: 1.0,
    factoredShearN: 600000,
});

console.log('interior', JSON.stringify(r, null, 2));
assert(Math.abs(r.criticalPerimeterMm - 2400) < 1, 'b0 ≈ 2400 mm');
assert(Math.abs(r.betaC - 1.0) < 1e-9, 'βc = 1 for square column');
assert(Math.abs(r.vc1MPa - 0.33 * Math.sqrt(30)) < 1e-6, 'vc1');
assert(Math.abs(r.vcMPa - 0.33 * Math.sqrt(30)) < 1e-6, 'vc governs by vc1');
assert(r.demandCapacityRatio > 0.9 && r.demandCapacityRatio < 0.95, 'DCR ≈ 0.92');
assert(r.passes === true, 'passes');

// Edge column - shorter perimeter, lower capacity.
const e = kernel.rcpunching.analyse({
    concreteStrengthMPa: 30,
    effectiveDepthMm: 200,
    columnWidthMm: 400,
    columnDepthMm: 400,
    location: 'edge',
    lambdaLightweight: 1.0,
    factoredShearN: 600000,
});
console.log('edge', JSON.stringify(e));
assert(e.criticalPerimeterMm < r.criticalPerimeterMm, 'edge perimeter < interior');
assert(e.phiVcN < r.phiVcN, 'edge capacity < interior');

// Corner column - smallest perimeter.
const c = kernel.rcpunching.analyse({
    concreteStrengthMPa: 30,
    effectiveDepthMm: 200,
    columnWidthMm: 400,
    columnDepthMm: 400,
    location: 'corner',
    lambdaLightweight: 1.0,
    factoredShearN: 200000,
});
console.log('corner', JSON.stringify(c));
assert(c.criticalPerimeterMm < e.criticalPerimeterMm, 'corner perimeter < edge');

// Elongated column triggers vc2 (β_c effect).
const elong = kernel.rcpunching.analyse({
    concreteStrengthMPa: 30,
    effectiveDepthMm: 200,
    columnWidthMm: 200,
    columnDepthMm: 1200,
    location: 'interior',
    lambdaLightweight: 1.0,
    factoredShearN: 100000,
});
console.log('elong', JSON.stringify(elong));
assert(elong.betaC === 6, 'βc = 6');
assert(Math.abs(elong.vc2MPa - (0.17 + 0.33 / 6) * Math.sqrt(30)) < 1e-6, 'vc2 elongated');
assert(elong.vcMPa <= elong.vc1MPa, 'governing must be ≤ vc1');

// Higher f'_c gives proportional √f'_c bump.
const hf = kernel.rcpunching.analyse({
    concreteStrengthMPa: 60,
    effectiveDepthMm: 200,
    columnWidthMm: 400,
    columnDepthMm: 400,
    location: 'interior',
    lambdaLightweight: 1.0,
    factoredShearN: 0,
});
assert(Math.abs(hf.vcMPa / r.vcMPa - Math.sqrt(2)) < 1e-6, 'vc scales with √f_c');

console.log('Forge-267 punching shear smoke OK');
