// Forge-280 — wire rope sling smoke (ASME B30.9, OSHA 1926.251).
//
// 1/2" IWRC EIPS wire rope: BS ≈ 19.5 tonnes-force = 191 200 N.
// Design factor 5 → single-leg WLL = 191 200/5 = 38 240 N (3.9 tonnes).

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

// Single vertical leg.
const v = kernel.sling.analyse({
    breakingStrengthN: 191200, designFactor: 5,
    numberOfLegs: 1, legAngleFromVerticalDeg: 0,
    hitchType: 'vertical',
});
console.log('vertical', JSON.stringify(v, null, 2));
assert(Math.abs(v.singleLegWllN - 38240) < 1, 'WLL single = BS/DF');
assert(v.hitchFactor === 1.0, 'vertical hitch factor');
assert(v.cosTheta === 1.0, 'cos 0 = 1');
assert(Math.abs(v.assemblyWllN - 38240) < 1, 'single vertical leg = single WLL');
assert(v.angleStatus === 'safe', '0° is safe');

// 2-leg sling at 30° from vertical (60° included angle).
const twoLeg30 = kernel.sling.analyse({
    breakingStrengthN: 191200, designFactor: 5,
    numberOfLegs: 2, legAngleFromVerticalDeg: 30,
    hitchType: 'vertical',
});
console.log('2-leg 30', JSON.stringify(twoLeg30));
assert(Math.abs(twoLeg30.assemblyWllN - 38240 * 2 * Math.cos(Math.PI/6)) < 1,
       '2 legs · cos 30° · WLL_single');
assert(twoLeg30.angleStatus === 'safe', '30° is safe');

// 2-leg at 60° from vertical (120° included angle — caution).
const twoLeg60 = kernel.sling.analyse({
    breakingStrengthN: 191200, designFactor: 5,
    numberOfLegs: 2, legAngleFromVerticalDeg: 60,
    hitchType: 'vertical',
});
console.log('2-leg 60', JSON.stringify(twoLeg60));
assert(twoLeg60.angleStatus === 'caution', '60° is caution');
assert(Math.abs(twoLeg60.assemblyWllN - 38240 * 2 * 0.5) < 1,
       'cos 60° = 0.5 ⇒ assembly WLL = legs');

// 2-leg at 75° — danger zone.
const danger = kernel.sling.analyse({
    breakingStrengthN: 191200, designFactor: 5,
    numberOfLegs: 2, legAngleFromVerticalDeg: 75,
    hitchType: 'vertical',
});
console.log('2-leg 75', JSON.stringify(danger));
assert(danger.angleStatus === 'danger', '75° is danger');
assert(danger.assemblyWllN < twoLeg60.assemblyWllN, 'capacity drops at 75°');

// Choker hitch reduces capacity 25%.
const choker = kernel.sling.analyse({
    breakingStrengthN: 191200, designFactor: 5,
    numberOfLegs: 1, legAngleFromVerticalDeg: 0,
    hitchType: 'choker',
});
console.log('choker', JSON.stringify(choker));
assert(Math.abs(choker.assemblyWllN - 38240 * 0.75) < 1, 'choker = 75% vertical');

// Basket hitch doubles capacity.
const basket = kernel.sling.analyse({
    breakingStrengthN: 191200, designFactor: 5,
    numberOfLegs: 1, legAngleFromVerticalDeg: 0,
    hitchType: 'basket',
});
console.log('basket', JSON.stringify(basket));
assert(Math.abs(basket.assemblyWllN - 38240 * 2.0) < 1, 'basket = 2x vertical');

// 4-leg sling at 45° from vertical.
const fourLeg = kernel.sling.analyse({
    breakingStrengthN: 191200, designFactor: 5,
    numberOfLegs: 4, legAngleFromVerticalDeg: 45,
    hitchType: 'vertical',
});
console.log('4-leg 45', JSON.stringify(fourLeg));
assert(Math.abs(fourLeg.assemblyWllN - 38240 * 4 * Math.SQRT1_2) < 1,
       '4 legs · cos 45° · WLL_single');
assert(fourLeg.angleStatus === 'safe', '45° still safe');

// Bad inputs throw.
let threw = false;
try {
    kernel.sling.analyse({ breakingStrengthN: 191200, designFactor: 5,
        numberOfLegs: 5, legAngleFromVerticalDeg: 0, hitchType: 'vertical' });
} catch (e) { threw = true; }
assert(threw, '5 legs throws');

threw = false;
try {
    kernel.sling.analyse({ breakingStrengthN: 191200, designFactor: 5,
        numberOfLegs: 2, legAngleFromVerticalDeg: 95, hitchType: 'vertical' });
} catch (e) { threw = true; }
assert(threw, 'θ > 89° throws');

console.log('Forge-280 wire rope sling smoke OK');
