// Forge-296 — headed shear stud smoke (AISC 360-22 Eq. I8-1).
//
// Reference: 19 mm (3/4") A108 stud in f'_c=28 MPa normal-weight concrete
//   (w_c = 2400 kg/m³). F_u = 415 MPa. Single stud R_g = 1.0, R_p = 0.75
//   (with metal deck).
//   A_sc = π·19²/4 = 283.5 mm²
//   E_c = 2400^1.5·0.043·√28 = 117575·0.043·5.292 = 26737 MPa
//   Q_conc  = 0.5·283.5·√(28·26737) = 141.75·√749 K = 141.75·865.9 = 122 760 N
//   Q_steel = 1.0·0.75·283.5·415 = 88 240 N → governs
//   Q_n = 88.24 kN
//   100 studs each side → ΣQ_n = 8824 kN
//   V_h = 5000 kN → DCR = 5000/8824 = 0.567 ✓

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.headedstud.analyse({
    studDiameterMm: 19, concreteStrengthMPa: 28,
    concreteUnitWeightKgM3: 2400, studUltimateStressMPa: 415,
    groupFactorRg: 1.0, positionFactorRp: 0.75,
    studCount: 100, requiredHorizShearKN: 5000,
});
console.log(JSON.stringify(r, null, 2));

assert(Math.abs(r.studAreaMm2 - Math.PI * 19 * 19 / 4) < 1e-6, 'A_sc');
assert(Math.abs(r.concreteModulusMPa - 2400 ** 1.5 * 0.043 * Math.sqrt(28)) < 1e-3, 'E_c');
assert(r.qNominalSteelN < r.qNominalConcreteN,
       'steel governs for these params');
assert(Math.abs(r.qNominalSingleN - r.qNominalSteelN) < 1e-6, 'Q_n = min');
assert(Math.abs(r.totalCapacityKN - r.qNominalSingleN * 100 / 1000) < 1e-6, 'total Q');
assert(r.passes === true, 'passes');
assert(r.demandCapacityRatio > 0.55 && r.demandCapacityRatio < 0.60, 'DCR ≈ 0.57');

// Stronger concrete (f'_c=45) → Q_conc grows; if it still governs, capacity grows.
const hi = kernel.headedstud.analyse({
    studDiameterMm: 19, concreteStrengthMPa: 45,
    concreteUnitWeightKgM3: 2400, studUltimateStressMPa: 415,
    groupFactorRg: 1.0, positionFactorRp: 0.75,
    studCount: 100, requiredHorizShearKN: 5000,
});
console.log('f_c=45', JSON.stringify(hi));
assert(hi.qNominalConcreteN > r.qNominalConcreteN, 'stronger conc → bigger Q_conc');
// Steel still governs (independent of f'_c), so total stays the same:
assert(Math.abs(hi.totalCapacityKN - r.totalCapacityKN) < 1e-6,
       'steel-governed, total stays');

// Larger stud d=22 mm: both Q_conc and Q_steel scale with A_sc.
const big = kernel.headedstud.analyse({
    studDiameterMm: 22, concreteStrengthMPa: 28,
    concreteUnitWeightKgM3: 2400, studUltimateStressMPa: 415,
    groupFactorRg: 1.0, positionFactorRp: 0.75,
    studCount: 100, requiredHorizShearKN: 5000,
});
console.log('d=22', JSON.stringify(big));
assert(Math.abs(big.studAreaMm2 / r.studAreaMm2 - (22/19) ** 2) < 1e-6,
       'A scales d²');
assert(big.totalCapacityKN > r.totalCapacityKN, 'bigger stud → more capacity');

// Overload: V_h = 12 000 kN → DCR > 1.
const fail = kernel.headedstud.analyse({
    studDiameterMm: 19, concreteStrengthMPa: 28,
    concreteUnitWeightKgM3: 2400, studUltimateStressMPa: 415,
    groupFactorRg: 1.0, positionFactorRp: 0.75,
    studCount: 100, requiredHorizShearKN: 12000,
});
assert(fail.demandCapacityRatio > 1.0, 'DCR > 1');
assert(fail.passes === false, 'fails');

// Solid slab (R_p = 1.0) gives more steel capacity.
const solid = kernel.headedstud.analyse({
    studDiameterMm: 19, concreteStrengthMPa: 28,
    concreteUnitWeightKgM3: 2400, studUltimateStressMPa: 415,
    groupFactorRg: 1.0, positionFactorRp: 1.0,
    studCount: 100, requiredHorizShearKN: 5000,
});
assert(Math.abs(solid.qNominalSteelN / r.qNominalSteelN - 1/0.75) < 1e-6,
       'R_p=1.0 raises Q_steel by 1/0.75');

// Bad inputs throw.
let threw = false;
try {
    kernel.headedstud.analyse({
        studDiameterMm: 0, concreteStrengthMPa: 28,
        concreteUnitWeightKgM3: 2400, studUltimateStressMPa: 415,
        groupFactorRg: 1.0, positionFactorRp: 0.75,
        studCount: 100, requiredHorizShearKN: 5000,
    });
} catch (e) { threw = true; }
assert(threw, 'd=0 throws');

console.log('Forge-296 headed stud smoke OK');
