// Forge-294 — air filter smoke (ASHRAE 52.2 style sizing + cost).
//
// Reference: MERV 13 filter bank, 5000 cfm = 2.36 m³/s through 0.5×0.6 m
//   face = 0.30 m² (4 × 24"×24" cells in 2×2 array). Initial Δp = 75 Pa,
//   final (loaded) Δp = 250 Pa. Run 8760 h/yr, η_fan = 0.55, $0.12/kWh.
//
//   v_face = 2.36 / 0.30 = 7.87 m/s   ← FAR above 2.5 m/s upper bound!
//     ⇒ filter face area is too small; flag faceVelocityInRange = false.
//   Δp_avg = (75 + 250)/2 = 162.5 Pa
//   P_fan = 162.5·2.36/0.55 = 697.3 W ≈ 0.697 kW
//   E = 0.697·8760 = 6109 kWh/yr
//   $ = 6109·0.12 = $733/yr

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const tight = kernel.airfilter.analyse({
    flowRateM3S: 2.36, faceAreaM2: 0.30,
    initialPressureDropPa: 75, finalPressureDropPa: 250,
    runHours: 8760, fanEfficiency: 0.55,
    electricityRatePerKWh: 0.12,
});
console.log(JSON.stringify(tight, null, 2));

assert(Math.abs(tight.faceVelocityMs - 2.36 / 0.30) < 1e-9, 'v_face');
assert(tight.faceVelocityInRange === false, 'v > 2.5 flagged');
assert(Math.abs(tight.averagePressureDropPa - 162.5) < 1e-9, 'avg Δp');
assert(Math.abs(tight.fanPowerW - 162.5 * 2.36 / 0.55) < 1e-6, 'P_fan');
assert(Math.abs(tight.energyKWh - tight.fanPowerW * 8760 / 1000) < 1e-6, 'kWh');
assert(Math.abs(tight.energyCost - tight.energyKWh * 0.12) < 1e-6, '$');

// Increase face area to 1.5 m² (proper 4-cell deep frame).
const sized = kernel.airfilter.analyse({
    flowRateM3S: 2.36, faceAreaM2: 1.5,
    initialPressureDropPa: 75, finalPressureDropPa: 250,
    runHours: 8760, fanEfficiency: 0.55,
    electricityRatePerKWh: 0.12,
});
console.log('sized', JSON.stringify(sized));
assert(sized.faceVelocityMs > 0.5 && sized.faceVelocityMs < 2.5, 'v in range');
assert(sized.faceVelocityInRange === true, 'v_face_OK');
// Δp and P don't change with face area — same filter Δp_initial/final.

// Cleaner filter (lower Δp_final): less fan power.
const clean = kernel.airfilter.analyse({
    flowRateM3S: 2.36, faceAreaM2: 1.5,
    initialPressureDropPa: 50, finalPressureDropPa: 100,
    runHours: 8760, fanEfficiency: 0.55,
    electricityRatePerKWh: 0.12,
});
console.log('clean', JSON.stringify(clean));
assert(clean.fanPowerW < sized.fanPowerW, 'lower Δp → lower P');
assert(clean.energyCost < sized.energyCost, 'lower Δp → lower cost');

// E scales linearly with run hours.
const halfTime = kernel.airfilter.analyse({
    flowRateM3S: 2.36, faceAreaM2: 1.5,
    initialPressureDropPa: 75, finalPressureDropPa: 250,
    runHours: 4380, fanEfficiency: 0.55,
    electricityRatePerKWh: 0.12,
});
assert(Math.abs(halfTime.energyKWh - 0.5 * sized.energyKWh) < 1e-6, 'E ∝ t');

// Fan eff scaling: doubled η halves power.
const goodFan = kernel.airfilter.analyse({
    flowRateM3S: 2.36, faceAreaM2: 1.5,
    initialPressureDropPa: 75, finalPressureDropPa: 250,
    runHours: 8760, fanEfficiency: 0.85,
    electricityRatePerKWh: 0.12,
});
console.log('good fan', JSON.stringify(goodFan));
assert(goodFan.fanPowerW < sized.fanPowerW, 'better fan → less power');
assert(Math.abs(goodFan.fanPowerW * 0.85 - sized.fanPowerW * 0.55) < 1e-6,
       'P·η identity');

// Bad inputs throw.
let threw = false;
try {
    kernel.airfilter.analyse({ flowRateM3S: 2.36, faceAreaM2: 1.5,
        initialPressureDropPa: 100, finalPressureDropPa: 50,
        runHours: 8760, fanEfficiency: 0.55, electricityRatePerKWh: 0.12 });
} catch (e) { threw = true; }
assert(threw, 'Δp_final < Δp_initial throws');

console.log('Forge-294 air filter smoke OK');
