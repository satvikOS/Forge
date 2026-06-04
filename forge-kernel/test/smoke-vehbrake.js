// Forge-298 — vehicle braking smoke.
//
// Reference: 1500 kg sedan from 100 km/h decelerating at 6 m/s² (1 single
//   firm-but-controlled emergency stop, ABS-active wet pavement); 4 discs
//   each 5 kg cast iron c_p = 460 J/(kg·K).
//   v_0 = 100/3.6 = 27.78 m/s
//   KE_0 = 0.5·1500·27.78² = 578 700 J ≈ 579 kJ
//   t = 27.78/6 = 4.63 s
//   d = 27.78²/(2·6) = 64.3 m
//   F = 1500·6 = 9000 N total
//   F_each = 9000/4 = 2250 N
//   Q_each = 579 000/4 = 144 750 J
//   ΔT = 144 750/(460·5) = 62.9 K (typical for one moderate stop)
//   P_avg = 579 000/4.63 = 125 000 W = 125 kW

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.vehbrake.analyse({
    vehicleMassKg: 1500, initialSpeedKmH: 100,
    decelerationMs2: 6, brakeCount: 4,
    discMassKg: 5, discSpecificHeatJkgK: 460,
});
console.log(JSON.stringify(r, null, 2));

assert(Math.abs(r.initialSpeedMs - 100/3.6) < 1e-9, 'v conversion');
assert(Math.abs(r.initialKineticEnergyJ - 0.5 * 1500 * (100/3.6)**2) < 1e-3, 'KE');
assert(Math.abs(r.stopTimeS - (100/3.6)/6) < 1e-6, 'stop time');
assert(Math.abs(r.stopDistanceM - (100/3.6)**2 / 12) < 1e-6, 'stop dist');
assert(Math.abs(r.brakeForceTotalN - 9000) < 1e-6, 'F');
assert(Math.abs(r.brakeForcePerBrakeN - 2250) < 1e-9, 'F/brake');
assert(Math.abs(r.heatPerBrakeJ - r.initialKineticEnergyJ / 4) < 1e-3, 'Q each');
assert(r.discTemperatureRiseK > 60 && r.discTemperatureRiseK < 65, 'ΔT ≈ 62.9 K');
assert(r.averagePowerW > 120000 && r.averagePowerW < 130000, 'P ≈ 125 kW');

// KE ∝ v², so 2× speed = 4× KE and 4× ΔT.
const fast = kernel.vehbrake.analyse({
    vehicleMassKg: 1500, initialSpeedKmH: 200,
    decelerationMs2: 6, brakeCount: 4,
    discMassKg: 5, discSpecificHeatJkgK: 460,
});
console.log('200 km/h', JSON.stringify(fast));
assert(Math.abs(fast.initialKineticEnergyJ - 4 * r.initialKineticEnergyJ) < 1e-3, 'KE ∝ v²');
assert(Math.abs(fast.discTemperatureRiseK - 4 * r.discTemperatureRiseK) < 1e-3, 'ΔT ∝ KE');
assert(Math.abs(fast.stopDistanceM - 4 * r.stopDistanceM) < 1e-6, 'd ∝ v²');
assert(Math.abs(fast.stopTimeS - 2 * r.stopTimeS) < 1e-9, 't ∝ v');

// Heavier truck: more KE, more ΔT.
const truck = kernel.vehbrake.analyse({
    vehicleMassKg: 4500, initialSpeedKmH: 100,
    decelerationMs2: 6, brakeCount: 4,
    discMassKg: 8, discSpecificHeatJkgK: 460,
});
console.log('4.5t truck', JSON.stringify(truck));
assert(truck.initialKineticEnergyJ > r.initialKineticEnergyJ, 'truck KE bigger');
assert(truck.discTemperatureRiseK > r.discTemperatureRiseK, 'truck ΔT bigger');

// More aggressive braking (a=10): shorter time, same KE, same Q.
const hard = kernel.vehbrake.analyse({
    vehicleMassKg: 1500, initialSpeedKmH: 100,
    decelerationMs2: 10, brakeCount: 4,
    discMassKg: 5, discSpecificHeatJkgK: 460,
});
assert(Math.abs(hard.initialKineticEnergyJ - r.initialKineticEnergyJ) < 1e-6,
       'KE same regardless of a');
assert(Math.abs(hard.heatPerBrakeJ - r.heatPerBrakeJ) < 1e-6, 'Q same');
assert(hard.stopTimeS < r.stopTimeS, 'harder = faster stop');
assert(hard.averagePowerW > r.averagePowerW, 'harder = higher peak power');

// More brakes: heat shared.
const sixBrake = kernel.vehbrake.analyse({
    vehicleMassKg: 1500, initialSpeedKmH: 100,
    decelerationMs2: 6, brakeCount: 6,
    discMassKg: 5, discSpecificHeatJkgK: 460,
});
assert(Math.abs(sixBrake.heatPerBrakeJ - r.heatPerBrakeJ * 4/6) < 1e-3,
       'Q/brake = KE/n');

// Invalid throws.
let threw = false;
try {
    kernel.vehbrake.analyse({ vehicleMassKg: 0, initialSpeedKmH: 100,
        decelerationMs2: 6, brakeCount: 4,
        discMassKg: 5, discSpecificHeatJkgK: 460 });
} catch (e) { threw = true; }
assert(threw, 'm=0 throws');

console.log('Forge-298 vehicle braking smoke OK');
