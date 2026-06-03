// Forge-288 — pitot tube velocity smoke (incompressible Bernoulli).
//
// HVAC duct traverse: Δp = 150 Pa, ρ_air = 1.20 kg/m³, C = 1.0, A = 0.5 m².
//   v = 1·√(2·150/1.20) = √250 = 15.811 m/s
//   h = 150 / (1.20·9.80665) = 12.748 m of air (very tall column!)
//   Q = 15.811·0.5 = 7.906 m³/s
//   ṁ = 1.20·15.811·0.5 = 9.487 kg/s

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.pitot.analyse({
    dynamicPressurePa: 150, densityKgM3: 1.20,
    pitotCoefficient: 1.0, flowAreaM2: 0.5,
});
console.log(JSON.stringify(r, null, 2));

const v_expected = Math.sqrt(2 * 150 / 1.20);
assert(Math.abs(r.velocityMs - v_expected) < 1e-9, 'v = √(2Δp/ρ)');
assert(Math.abs(r.velocityHeadM - 150 / (1.20 * 9.80665)) < 1e-6, 'velocity head');
assert(Math.abs(r.volumeFlowM3S - v_expected * 0.5) < 1e-6, 'Q = v·A');
assert(Math.abs(r.massFlowKgS - 1.20 * v_expected * 0.5) < 1e-6, 'ṁ = ρ·v·A');

// Doubling Δp gives √2× velocity.
const r2 = kernel.pitot.analyse({
    dynamicPressurePa: 300, densityKgM3: 1.20,
    pitotCoefficient: 1.0, flowAreaM2: 0.5,
});
console.log('2× Δp', JSON.stringify(r2));
assert(Math.abs(r2.velocityMs / r.velocityMs - Math.sqrt(2)) < 1e-6, 'v ∝ √Δp');

// Calibration coefficient C scales v linearly.
const calib = kernel.pitot.analyse({
    dynamicPressurePa: 150, densityKgM3: 1.20,
    pitotCoefficient: 0.95, flowAreaM2: 0.5,
});
assert(Math.abs(calib.velocityMs - 0.95 * v_expected) < 1e-9, 'v scales with C');

// Water vs air at same Δp — water is much denser, much slower.
const water = kernel.pitot.analyse({
    dynamicPressurePa: 1000, densityKgM3: 998,
    pitotCoefficient: 1.0, flowAreaM2: 0.01,
});
console.log('water', JSON.stringify(water));
const v_water = Math.sqrt(2 * 1000 / 998);
assert(Math.abs(water.velocityMs - v_water) < 1e-6, 'water velocity');

// A = 0 ⇒ Q and ṁ both 0 (just velocity).
const noArea = kernel.pitot.analyse({
    dynamicPressurePa: 150, densityKgM3: 1.20,
    pitotCoefficient: 1.0, flowAreaM2: 0,
});
assert(noArea.volumeFlowM3S === 0, 'Q=0 when A=0');
assert(noArea.massFlowKgS === 0, 'ṁ=0 when A=0');
assert(noArea.velocityMs > 0, 'v still positive');

// Invalid inputs throw.
let threw = false;
try {
    kernel.pitot.analyse({ dynamicPressurePa: 100, densityKgM3: 0,
        pitotCoefficient: 1, flowAreaM2: 0 });
} catch (e) { threw = true; }
assert(threw, 'ρ=0 throws');

threw = false;
try {
    kernel.pitot.analyse({ dynamicPressurePa: 100, densityKgM3: 1,
        pitotCoefficient: 1.5, flowAreaM2: 0 });
} catch (e) { threw = true; }
assert(threw, 'C > 1.05 throws');

console.log('Forge-288 pitot smoke OK');
