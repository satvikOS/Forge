// Forge-291 — straight bevel gear pair smoke (Shigley §15, AGMA 2003).
//
// Reference design: m = 4 mm, N_p = 20, N_g = 40, F = 25 mm, φ_n = 20°,
//   T_p = 50 N·m. 90° shafts.
//   i = 40/20 = 2
//   γ_p = atan(20/40) = atan(0.5) = 26.565°
//   γ_g = 90 − 26.565 = 63.435°
//   d_p = 20·4 = 80, d_g = 40·4 = 160
//   R = √(40² + 80²) = √8000 = 89.443 mm
//   r_m_p = (89.443 − 12.5)·sin 26.565° = 76.943·0.4472 = 34.41 mm
//   N_ep = 20/cos 26.565° = 20/0.8944 = 22.36
//   N_eg = 40/cos 63.435° = 40/0.4472 = 89.44
//   W_t = (50·1000)/34.41 = 1453 N
//   W_r = 1453·tan 20°·cos 26.565° = 1453·0.3640·0.8944 = 473 N
//   W_a = 1453·tan 20°·sin 26.565° = 1453·0.3640·0.4472 = 236 N

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.bevelgear.analyse({
    moduleMm: 4, pinionTeeth: 20, gearTeeth: 40,
    faceWidthMm: 25, pressureAngleDeg: 20, pinionTorqueNm: 50,
});
console.log(JSON.stringify(r, null, 2));

assert(Math.abs(r.gearRatio - 2.0) < 1e-9, 'i = 2');
assert(Math.abs(r.pinionConeAngleDeg - Math.atan(0.5) * 180 / Math.PI) < 1e-6, 'γ_p');
assert(Math.abs(r.gearConeAngleDeg + r.pinionConeAngleDeg - 90) < 1e-6, 'γ_p + γ_g = 90');
assert(Math.abs(r.pinionPitchDiameterMm - 80) < 1e-9, 'd_p');
assert(Math.abs(r.gearPitchDiameterMm - 160) < 1e-9, 'd_g');
assert(Math.abs(r.coneDistanceMm - Math.sqrt(40*40 + 80*80)) < 1e-9, 'R');
assert(r.pinionMeanRadiusMm > 33 && r.pinionMeanRadiusMm < 36, 'r_m_p ≈ 34.4');
assert(Math.abs(r.equivalentPinionTeeth - 20 / Math.cos(Math.atan(0.5))) < 1e-6, 'N_ep');
assert(r.tangentialForceN > 1430 && r.tangentialForceN < 1480, 'W_t ≈ 1453');
assert(r.radialForceN > 460 && r.radialForceN < 490, 'W_r ≈ 473');
assert(r.axialForceN > 225 && r.axialForceN < 250, 'W_a ≈ 236');

// W_r and W_a check via tan φ_n.
const tanPhi = Math.tan(20 * Math.PI / 180);
assert(Math.abs(r.radialForceN - r.tangentialForceN * tanPhi * Math.cos(Math.atan(0.5))) < 1e-3,
       'W_r identity');
assert(Math.abs(r.axialForceN - r.tangentialForceN * tanPhi * Math.sin(Math.atan(0.5))) < 1e-3,
       'W_a identity');

// 1:1 ratio: γ_p = γ_g = 45°.
const oneToOne = kernel.bevelgear.analyse({
    moduleMm: 4, pinionTeeth: 30, gearTeeth: 30,
    faceWidthMm: 25, pressureAngleDeg: 20, pinionTorqueNm: 50,
});
console.log('1:1', JSON.stringify(oneToOne));
assert(Math.abs(oneToOne.pinionConeAngleDeg - 45) < 1e-6, 'γ_p = 45° at 1:1');
assert(Math.abs(oneToOne.gearConeAngleDeg - 45) < 1e-6, 'γ_g = 45° at 1:1');
assert(Math.abs(oneToOne.radialForceN - oneToOne.axialForceN) < 1e-6,
       'W_r = W_a at 1:1 (cos 45 = sin 45)');

// Doubling torque doubles all forces (linear).
const bigT = kernel.bevelgear.analyse({
    moduleMm: 4, pinionTeeth: 20, gearTeeth: 40,
    faceWidthMm: 25, pressureAngleDeg: 20, pinionTorqueNm: 100,
});
assert(Math.abs(bigT.tangentialForceN - 2 * r.tangentialForceN) < 1e-3, 'W_t ∝ T');
assert(Math.abs(bigT.radialForceN - 2 * r.radialForceN) < 1e-3, 'W_r ∝ T');

// Face width > cone distance throws.
let threw = false;
try {
    kernel.bevelgear.analyse({ moduleMm: 4, pinionTeeth: 20, gearTeeth: 40,
        faceWidthMm: 200, pressureAngleDeg: 20, pinionTorqueNm: 50 });
} catch (e) { threw = true; }
assert(threw, 'F > R throws');

console.log('Forge-291 bevel gear smoke OK');
