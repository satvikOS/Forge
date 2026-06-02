// forge-kernel Psychrometric smoke (Forge-192) — known reference states.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.psychro && typeof forge.psychro.stateFromTwo === 'function',
          'forge.psychro.stateFromTwo missing');

const P = 101325; // Pa, sea level

// 1. Saturation pressure at 0 °C ≈ 611 Pa, at 100 °C ≈ 101 325 Pa.
const ps0 = forge.psychro.saturationPressurePa(0);
const ps100 = forge.psychro.saturationPressurePa(100);
assert.ok(Math.abs(ps0 - 611) < 5,
          `ps(0) ${ps0} should be ≈ 611 Pa`);
assert.ok(Math.abs(ps100 - 101325) / 101325 < 0.01,
          `ps(100) ${ps100} should be ≈ 101325 Pa`);

// 2. Standard ASHRAE reference: 25 °C, 50 % RH at 101.325 kPa.
//   Expected (ASHRAE 2017 Ch 1 example):
//     ps(25)        ≈ 3169 Pa
//     pw            ≈ 1585 Pa
//     W             ≈ 0.00988 kg/kg
//     h             ≈ 50.43 kJ/kg
//     Tdp           ≈ 13.85 °C
//     Twb           ≈ 17.93 °C
const s1 = forge.psychro.stateFromTwo(1 | 2, 25.0, 0.50, P);
assert.ok(Math.abs(s1.tdbC - 25.0) < 1e-6);
assert.ok(Math.abs(s1.rh - 0.50) < 1e-4);
assert.ok(Math.abs(s1.humidityRatio - 0.00988) < 5e-4,
          `W ${s1.humidityRatio} should be ≈ 0.00988`);
assert.ok(Math.abs(s1.enthalpyKJperKg - 50.43) < 0.5,
          `h ${s1.enthalpyKJperKg} should be ≈ 50.4 kJ/kg`);
assert.ok(Math.abs(s1.tdpC - 13.85) < 0.5,
          `Tdp ${s1.tdpC} should be ≈ 13.85 °C`);
assert.ok(Math.abs(s1.twbC - 17.93) < 0.5,
          `Twb ${s1.twbC} should be ≈ 17.93 °C`);

// 3. Cross-check: state from (Tdb, W) should agree with state from (Tdb, RH).
const s2 = forge.psychro.stateFromTwo(1 | 4, 25.0, s1.humidityRatio, P);
assert.ok(Math.abs(s2.rh - s1.rh) < 1e-4);
assert.ok(Math.abs(s2.enthalpyKJperKg - s1.enthalpyKJperKg) < 0.01);

// 4. State from (Tdb, Tdp) should reproduce W.
const s3 = forge.psychro.stateFromTwo(1 | 8, 25.0, s1.tdpC, P);
assert.ok(Math.abs(s3.humidityRatio - s1.humidityRatio) / s1.humidityRatio < 0.01);

// 5. State from (Tdb, Twb) should reproduce RH.
const s4 = forge.psychro.stateFromTwo(1 | 16, 25.0, s1.twbC, P);
assert.ok(Math.abs(s4.rh - s1.rh) < 0.01,
          `(Tdb,Twb) returned RH ${s4.rh}, expected ${s1.rh}`);

// 6. State from (Tdb, h) should reproduce W.
const s5 = forge.psychro.stateFromTwo(1 | 32, 25.0, s1.enthalpyKJperKg, P);
assert.ok(Math.abs(s5.humidityRatio - s1.humidityRatio) / s1.humidityRatio < 0.01);

// 7. Hot humid: 35 °C, 80 % RH.
const s6 = forge.psychro.stateFromTwo(1 | 2, 35.0, 0.80, P);
assert.ok(s6.humidityRatio > 0.025 && s6.humidityRatio < 0.035,
          `35 °C 80 % W = ${s6.humidityRatio} out of range`);
assert.ok(s6.tdpC > 30 && s6.tdpC < 33,
          `35 °C 80 % Tdp = ${s6.tdpC} should be ≈ 31 °C`);
// Heatstroke territory — Twb > 30 °C is dangerous.
assert.ok(s6.twbC > 30 && s6.twbC < 33,
          `35 °C 80 % Twb = ${s6.twbC} should be ≈ 31.5 °C`);

console.log('✅ Psychrometric smoke PASSED');
console.log(`   ps(0 / 100)        ${ps0.toFixed(0)} Pa  /  ${ps100.toFixed(0)} Pa`);
console.log(`   25 °C 50 % RH      W ${s1.humidityRatio.toFixed(4)} kg/kg`);
console.log(`                      h ${s1.enthalpyKJperKg.toFixed(2)} kJ/kg`);
console.log(`                      Tdp ${s1.tdpC.toFixed(2)} °C   Twb ${s1.twbC.toFixed(2)} °C`);
console.log(`   35 °C 80 % RH      W ${s6.humidityRatio.toFixed(4)} · Twb ${s6.twbC.toFixed(1)} °C`);
console.log(`   round-trips (Tdb,W)=(Tdb,RH)=(Tdb,Tdp)=(Tdb,Twb)=(Tdb,h) ✓`);
