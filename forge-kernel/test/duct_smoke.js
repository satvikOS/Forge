// forge-kernel Ductwork smoke (Forge-186) — typical office HVAC run.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.duct && typeof forge.duct.compute === 'function',
          'forge.duct.compute missing');

// Standard air @ 20 °C, galvanised steel.
const air = { rhoKgM3: 1.204, nuM2s: 1.516e-5, epsilonMm: 0.09 };

// 1000 cfm = 0.472 m³/s. 10 m of 300 mm round + a 90° elbow + 5 m of 300 mm round.
const Q = 0.472;
const route = [
  { kind: 0, diameterMm: 300, lengthM: 10 },   // RoundRun
  { kind: 2, diameterMm: 300 },                 // Elbow90
  { kind: 0, diameterMm: 300, lengthM:  5 },
];

const r = forge.duct.compute({ flowRateM3s: Q, air, route });
assert.strictEqual(r.segments.length, 3);
// Velocity = Q / (π·0.150²) ≈ 6.68 m/s.
const V = Q / (Math.PI * 0.150 * 0.150);
assert.ok(Math.abs(r.maxVelocityMs - V) < 0.05,
          `velocity ${r.maxVelocityMs.toFixed(2)} should be ≈ ${V.toFixed(2)} m/s`);

// Reynolds ≈ V·D/ν = 6.68 × 0.3 / 1.516e-5 ≈ 1.32e5 → fully turbulent.
const Re = V * 0.3 / air.nuM2s;
assert.ok(Math.abs(r.segments[0].reynolds - Re) / Re < 0.01);

// Total friction drop on the runs is roughly f·(L/D)·dyn. For galvanised
// steel at this Reynolds, f ≈ 0.020-0.022. dyn = 0.5·1.204·6.68² ≈ 26.85 Pa.
// Per-meter drop ≈ f·dyn/D ≈ 0.021 × 26.85 / 0.3 ≈ 1.88 Pa/m. Across
// 15 m run that's about 28 Pa.
assert.ok(r.segments[0].frictionDropPa > 10 && r.segments[0].frictionDropPa < 40,
          `seg0 friction ${r.segments[0].frictionDropPa.toFixed(1)} Pa out of range`);

// Elbow K = 0.22 → ΔP_K = 0.22 × 26.85 ≈ 5.9 Pa.
assert.ok(Math.abs(r.segments[1].fittingDropPa - 0.22 * 0.5 * 1.204 * V * V) < 0.5,
          `elbow K drop wrong: ${r.segments[1].fittingDropPa}`);

assert.ok(r.totalDropPa > 30 && r.totalDropPa < 80,
          `total drop ${r.totalDropPa.toFixed(1)} Pa out of plausible range`);

// Sizing: target 1 Pa/m → larger D than 300 mm.
const D = forge.duct.sizeRoundForFriction(Q, 1.0, air);
assert.ok(D > 300,
          `1 Pa/m sizing ${D.toFixed(0)} mm should exceed 300 mm baseline`);
assert.ok(D < 600,
          `1 Pa/m sizing ${D.toFixed(0)} mm should be < 600 mm`);

// Branch tee should produce a much bigger fitting drop than straight tee.
const route2 = [{ kind: 7, diameterMm: 300 }];   // TeeBranch
const r2 = forge.duct.compute({ flowRateM3s: Q, air, route: route2 });
const route3 = [{ kind: 6, diameterMm: 300 }];   // TeeStraight
const r3 = forge.duct.compute({ flowRateM3s: Q, air, route: route3 });
assert.ok(r2.totalDropPa > 4 * r3.totalDropPa,
          `branch tee ${r2.totalDropPa} should >> straight tee ${r3.totalDropPa}`);

console.log('✅ Ductwork smoke PASSED');
console.log(`   velocity       ${r.maxVelocityMs.toFixed(2)} m/s   (Re ${r.segments[0].reynolds.toFixed(0)})`);
console.log(`   friction f     ${r.segments[0].frictionFactor.toFixed(4)}`);
console.log(`   seg0 ΔP_f      ${r.segments[0].frictionDropPa.toFixed(2)} Pa   (10 m)`);
console.log(`   90° elbow ΔP_K ${r.segments[1].fittingDropPa.toFixed(2)} Pa`);
console.log(`   total ΔP       ${r.totalDropPa.toFixed(2)} Pa over ${r.totalLengthM} m`);
console.log(`   sizing 1 Pa/m  D = ${D.toFixed(0)} mm`);
console.log(`   branch vs straight tee  ${r2.totalDropPa.toFixed(1)} vs ${r3.totalDropPa.toFixed(1)} Pa`);
