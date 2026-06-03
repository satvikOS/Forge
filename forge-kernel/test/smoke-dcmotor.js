// Forge-279 — DC shunt motor smoke (Chapman Ex. 9-1 style).
//
// 250 V DC shunt motor: R_a = 0.2 Ω, K_aΦ = 2.0 V·s/rad.
// Operating point T_L = 50 Nm. Expected:
//   I_a = 50/2 = 25 A
//   E_a = 250 − 25·0.2 = 245 V
//   ω = 245/2 = 122.5 rad/s
//   n = 122.5 · 60/(2π) ≈ 1169.6 rpm
//   n_0 = 250/2 · 60/(2π) ≈ 1193.7 rpm
//   T_stall = 250·2/0.2 = 2500 Nm
//   SR = (1193.7 − 1169.6)/1169.6 · 100 ≈ 2.06 %
//   P_mech = 50 · 122.5 = 6125 W
//   P_in_arm = 250 · 25 = 6250 W
//   η_arm = 6125/6250 = 0.98

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.dcmotor.analyse({
    supplyVoltageV: 250,
    armatureResistanceOhms: 0.2,
    motorConstantVPerRadS: 2.0,
    loadTorqueNm: 50,
    fieldResistanceOhms: 250,   // 1 A field current
});
console.log(JSON.stringify(r, null, 2));

assert(Math.abs(r.armatureCurrentA - 25) < 1e-9, 'I_a = 25 A');
assert(Math.abs(r.backEmfV - 245) < 1e-9, 'E_a = 245 V');
assert(Math.abs(r.angularSpeedRadS - 122.5) < 1e-9, 'ω = 122.5 rad/s');
assert(Math.abs(r.speedRpm - 122.5 * 60 / (2 * Math.PI)) < 1e-6, 'n match');
assert(Math.abs(r.noLoadSpeedRpm - 125 * 60 / (2 * Math.PI)) < 1e-6, 'n_0');
assert(Math.abs(r.stallTorqueNm - 2500) < 1e-9, 'T_stall = 2500 Nm');
assert(Math.abs(r.mechanicalPowerW - 6125) < 1e-6, 'P_mech = 6125 W');
assert(Math.abs(r.armatureInputPowerW - 6250) < 1e-6, 'P_in_arm = 6250 W');
assert(Math.abs(r.armatureEfficiency - 0.98) < 1e-6, 'η_arm = 0.98');
assert(Math.abs(r.fieldCurrentA - 1.0) < 1e-9, 'I_f = 1 A');
assert(Math.abs(r.fieldCopperLossW - 250) < 1e-6, 'P_cu_field = 250 W');
assert(r.speedRegulationPct > 0 && r.speedRegulationPct < 5, 'SR small (~2%)');

// Heavier load → slower speed, lower η_arm.
const heavy = kernel.dcmotor.analyse({
    supplyVoltageV: 250, armatureResistanceOhms: 0.2,
    motorConstantVPerRadS: 2.0, loadTorqueNm: 200,
    fieldResistanceOhms: 250,
});
console.log('heavy', JSON.stringify(heavy));
assert(heavy.armatureCurrentA === 100, 'I_a = 100 A under heavier load');
assert(heavy.speedRpm < r.speedRpm, 'heavy load → slower');
assert(heavy.armatureEfficiency < r.armatureEfficiency, 'heavy η < light η');

// Load > stall throws.
let threw = false;
try {
    kernel.dcmotor.analyse({
        supplyVoltageV: 250, armatureResistanceOhms: 0.2,
        motorConstantVPerRadS: 2.0, loadTorqueNm: 3000,
        fieldResistanceOhms: 250,
    });
} catch (e) { threw = true; }
assert(threw, 'load > stall throws');

// No-load: T_L = 0 → ω = V/K, η = 0/0 = 0 (or 1; we return 0 per convention).
const nl = kernel.dcmotor.analyse({
    supplyVoltageV: 250, armatureResistanceOhms: 0.2,
    motorConstantVPerRadS: 2.0, loadTorqueNm: 0,
    fieldResistanceOhms: 250,
});
console.log('no-load', JSON.stringify(nl));
assert(Math.abs(nl.speedRpm - nl.noLoadSpeedRpm) < 1e-6, 'T=0 → n=n_0');
assert(nl.armatureCurrentA === 0, 'I_a = 0 at no load');

// Reducing flux (field weakening) raises speed at same T_L.
const flux_weak = kernel.dcmotor.analyse({
    supplyVoltageV: 250, armatureResistanceOhms: 0.2,
    motorConstantVPerRadS: 1.5,   // weaker flux
    loadTorqueNm: 50, fieldResistanceOhms: 250,
});
console.log('field-weakened', JSON.stringify(flux_weak));
assert(flux_weak.speedRpm > r.speedRpm, 'field weakening → higher speed');
assert(flux_weak.armatureCurrentA > r.armatureCurrentA,
       'field weakening → higher I_a at same T');

console.log('Forge-279 DC motor smoke OK');
