// Forge-287 — earthwork prismoidal volume smoke.
//
// Reference textbook problem: roadway segment 20 m long, A_1 = 50 m², A_m = 80 m²,
//   A_2 = 110 m² (linearly growing cross-section). For linear growth, prismoidal
//   and AEA give the same answer.
//   V_p = 20/6·(50 + 320 + 110) = 20/6·480 = 1600 m³.
//   V_aea = 20·(50 + 110)/2 = 1600 m³.
//   Difference = 0; error = 0%.

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const lin = kernel.prismoidal.analyse({
    lengthM: 20, areaStartM2: 50, areaMiddleM2: 80, areaEndM2: 110,
});
console.log('linear', JSON.stringify(lin, null, 2));
assert(Math.abs(lin.prismoidalVolumeM3 - 1600) < 1e-9, 'V_prismoidal');
assert(Math.abs(lin.averageEndAreaVolumeM3 - 1600) < 1e-9, 'V_AEA');
assert(Math.abs(lin.differenceM3) < 1e-9, 'linear case zero diff');
assert(Math.abs(lin.aeaErrorPct) < 1e-9, 'zero error');
assert(Math.abs(lin.prismoidalVolumeCubicYards - 1600 * 1.30795061931439) < 1e-6, 'cu yd');

// Concave (pyramidal): A_1=100, A_m=49, A_2=0 (truncated pyramid).
// V_p = L/6·(A_1 + 4·A_m + A_2) = 30/6·(100 + 196 + 0) = 5·296 = 1480 m³.
// V_aea = 30·(100+0)/2 = 1500. AEA over-estimates here.
const pyr = kernel.prismoidal.analyse({
    lengthM: 30, areaStartM2: 100, areaMiddleM2: 49, areaEndM2: 0,
});
console.log('pyramid', JSON.stringify(pyr));
assert(Math.abs(pyr.prismoidalVolumeM3 - 1480) < 1e-6, 'pyramid V_p');
assert(Math.abs(pyr.averageEndAreaVolumeM3 - 1500) < 1e-9, 'pyramid V_AEA');
assert(pyr.averageEndAreaVolumeM3 > pyr.prismoidalVolumeM3, 'AEA over-estimates concave');

// Convex (truncated cone): A_1 = π·1² = 3.14, A_m = π·1.5² = 7.07, A_2 = π·2² = 12.57
// True frustum volume = π·L/3·(r_1² + r_1·r_2 + r_2²)
// For L=5: V_true = π·5/3·(1+2+4) = 35π/3 ≈ 36.65 m³
// Prismoidal should match closely.
const cone = kernel.prismoidal.analyse({
    lengthM: 5, areaStartM2: Math.PI * 1, areaMiddleM2: Math.PI * 2.25, areaEndM2: Math.PI * 4,
});
const V_true = Math.PI * 5 / 3 * (1 + 2 + 4);
console.log('frustum', JSON.stringify(cone));
assert(Math.abs(cone.prismoidalVolumeM3 - V_true) < 1e-6, 'frustum exact via prismoidal');

// Validate inputs: negative area throws.
let threw = false;
try {
    kernel.prismoidal.analyse({ lengthM: 10, areaStartM2: -1, areaMiddleM2: 0, areaEndM2: 0 });
} catch (e) { threw = true; }
assert(threw, 'negative area throws');

threw = false;
try {
    kernel.prismoidal.analyse({ lengthM: 0, areaStartM2: 10, areaMiddleM2: 10, areaEndM2: 10 });
} catch (e) { threw = true; }
assert(threw, 'zero length throws');

console.log('Forge-287 prismoidal smoke OK');
