#!/usr/bin/env node
/**
 * Headless verification for the FULL-PHYSICS simulate.* bridge verbs added to
 * ForgeToolBridge.js. Runs the native kernel in a FRESH plain-Node process (no
 * Electron), builds simple solids, dispatches EACH new verb via
 * dispatchToolCall, and asserts a sane physics result cross-checked against the
 * matching smoke test's known values:
 *
 *   simulate.fea-buckling   — 100×10×10 steel column, 1 kN compressive preload.
 *                             Euler P_cr (fixed-free) ≈ 4.32e5 N, λ₁ > 0.
 *   simulate.fea-thermal    — 100×10×10 steel bar, 100°C → 0°C across X.
 *                             min/max T in [0,100], mean flux ≈ 50 000 W/m².
 *   simulate.fea-fatigue    — 250 MPa amplitude, steel HCF S-N curve.
 *                             life N_f ∈ [200k, 600k] cycles.
 *   simulate.fea-nonlinear  — 100×10×10 steel cantilever, -10 kN tip → yields.
 *                             maxPlasticStrain > 0, maxVonMises > 0.
 *   simulate.fea-contact    — two stacked 10 mm steel cubes, 1 kN press.
 *                             active pairs > 0, press-in |uz| < 10 mm.
 *   simulate.cfd            — lid-driven cavity, Re≈100. peak |u| ∈ [0.8,1.2],
 *                             pressure range > 0, residual drops.
 *   simulate.dynamics-motion— 3-bar linkage, 2π sweep over 36 frames.
 *                             36 frames, allConverged, driver swept 2π, moved.
 *
 * USAGE:  node forge-kernel/test/simulate_verbs_test.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import assert from 'assert';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, '..', '..');
const KERNEL_PATH = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const BRIDGE_PATH = path.resolve(REPO, 'frontend', 'src', 'ai', 'ForgeToolBridge.js');

// Minimal headless forge (raw kernel, function-bound) — same pattern as
// context_verbs_test.mjs / cadscore_harness.
function makeHeadlessForge() {
  const kernel = require(KERNEL_PATH);
  return new Proxy(kernel, {
    get(t, p) {
      if (p === 'isReady') return () => true;
      if (p === 'loadError') return () => null;
      const v = t[p];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

const STEEL = { E: 210e9, nu: 0.3, rho: 7850 };
let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  PASS — ${msg}`); }
  else { console.log(`  FAIL — ${msg}`); failures++; }
}

const { dispatchToolCall } = await import(BRIDGE_PATH);
const forge = makeHeadlessForge();
console.log('[simulate-verbs] kernel version =', forge.version());

async function call(name, args) {
  const r = await dispatchToolCall({ name, arguments: args }, { forge });
  if (!r.ok) throw new Error(`${name} dispatch failed: ${r.error}`);
  return r.result;
}

// =========================================================== BUCKLING
console.log('\n[simulate.fea-buckling] 100×10×10 mm steel column, 1 kN compressive');
{
  const beam = forge.makeBox(0.100, 0.010, 0.010);
  const I = (0.010 * 0.010 ** 3) / 12;
  const P_cr_euler = (Math.PI ** 2) * STEEL.E * I / ((2 * 0.100) ** 2);
  const r = await call('simulate.fea-buckling', {
    shape: beam, material: STEEL,
    fixedFace: '-x', loadFace: '+x', load: 1000, modes: 3, meshSize: 5,
  });
  console.log(`  firstCriticalLoad = ${r.firstCriticalLoad_N.toExponential(3)} N (Euler ${P_cr_euler.toExponential(3)} N)`);
  console.log(`  loadFactors = [${r.loadFactors.map((x) => x.toExponential(2)).join(', ')}], SF = ${r.bucklingSafetyFactor.toExponential(3)}`);
  const err = Math.abs(r.firstCriticalLoad_N - P_cr_euler) / P_cr_euler;
  ok(Number.isFinite(r.firstCriticalLoad_N) && r.firstCriticalLoad_N > 0, 'P_cr finite & positive');
  ok(r.bucklingSafetyFactor > 0, 'first load factor > 0');
  ok(err < 0.20, `P_cr within ±20% of Euler (err ${(err * 100).toFixed(1)}%)`);
  forge.release(beam);
}

// =========================================================== THERMAL
console.log('\n[simulate.fea-thermal] 100×10×10 mm steel bar, 100°C → 0°C');
{
  const bar = forge.makeBox(0.100, 0.010, 0.010);
  const qAnal = 50 * 100 / 0.100; // k·ΔT/L = 50 000 W/m²
  const r = await call('simulate.fea-thermal', {
    shape: bar, material: { k: 50 },
    hotFace: '-x', coldFace: '+x', hotTemp: 100, coldTemp: 0, meshSize: 5,
  });
  console.log(`  T range = [${r.minT_C.toFixed(2)}, ${r.maxT_C.toFixed(2)}] °C, mean flux = ${r.meanHeatFlux_W_m2.toFixed(0)} W/m² (theory ${qAnal})`);
  ok(Number.isFinite(r.maxT_C) && Number.isFinite(r.minT_C), 'T range finite');
  ok(r.minT_C >= -1 && r.maxT_C <= 101, 'T within [0,100] °C bounds');
  ok(Math.abs(r.meanHeatFlux_W_m2 - qAnal) / qAnal < 0.10, `mean flux within ±10% of ${qAnal} W/m²`);
  forge.release(bar);
}

// =========================================================== FATIGUE
console.log('\n[simulate.fea-fatigue] 250 MPa amplitude, steel HCF curve');
{
  const r = await call('simulate.fea-fatigue', {
    amplitude: 250e6, mean: 0, cycles: 200,
    sn: { N: [1e3, 1e6], S: [600e6, 200e6] }, meanCorrection: 'None',
  });
  console.log(`  lifeCycles = ${r.lifeCycles.toFixed(0)}, maxAmplitudeObserved = ${(r.maxAmplitudeObserved_Pa / 1e6).toFixed(1)} MPa`);
  ok(Number.isFinite(r.lifeCycles) && r.lifeCycles > 0, 'life finite & positive');
  ok(r.lifeCycles >= 200e3 && r.lifeCycles <= 600e3, 'life in [200k, 600k] cycles (Basquin)');
  ok(Math.abs(r.maxAmplitudeObserved_Pa - 250e6) / 250e6 < 0.05, 'observed amplitude ≈ 250 MPa');
}

// =========================================================== NONLINEAR (PLASTIC)
console.log('\n[simulate.fea-nonlinear] 100×10×10 mm steel cantilever, -10 kN tip → yield');
{
  const beam = forge.makeBox(0.100, 0.010, 0.010);
  const r = await call('simulate.fea-nonlinear', {
    shape: beam, material: { ...STEEL, sigmaY: 250e6, hardening: 1e9 },
    fixedFace: '-x', loadFace: '+x', force: [0, -10000, 0], loadSteps: 5, meshSize: 5,
  });
  console.log(`  maxPlasticStrain = ${r.maxPlasticStrain.toExponential(3)}, maxVonMises = ${r.maxVonMises_MPa.toFixed(1)} MPa, yielded = ${r.yielded}`);
  ok(Number.isFinite(r.maxVonMises_MPa) && r.maxVonMises_MPa > 0, 'max von Mises finite & positive');
  ok(r.maxPlasticStrain > 0 && r.yielded, 'part yielded (plastic strain > 0)');
  forge.release(beam);
}

// =========================================================== CONTACT
console.log('\n[simulate.fea-contact] two stacked 10 mm steel cubes, 1 kN press');
{
  const cubeA = forge.makeBox(0.010, 0.010, 0.010);
  const cubeB = forge.makeBox(0.010, 0.010, 0.010);
  const r = await call('simulate.fea-contact', {
    shapeA: cubeA, shapeB: cubeB, material: STEEL, load: 1000, meshSize: 5,
  });
  console.log(`  maxContactPressure = ${r.maxContactPressure_MPa.toExponential(3)} MPa, active = ${r.activePairs}/${r.totalPairs}, press-in = ${r.pressInDisplacement_mm.toFixed(5)} mm, iters = ${r.iterations}`);
  ok(Number.isFinite(r.maxContactPressure_MPa), 'contact pressure finite');
  ok(r.activePairs > 0, 'at least one active contact pair');
  ok(r.pressInDisplacement_mm < 10 && r.pressInDisplacement_mm >= 0, 'press-in displacement < cube edge (no blow-through)');
  ok(r.iterations <= 12, 'active-set converged within cap (≤12)');
  forge.release(cubeA); forge.release(cubeB);
}

// =========================================================== CFD
console.log('\n[simulate.cfd] lid-driven cavity, Re≈100');
{
  const r = await call('simulate.cfd', {
    domain: [0, 0, 0, 1, 1, 1], grid: 32, rho: 1.0, viscosity: 0.01,
    inletFace: '+y', velocity: [1, 0, 0], maxIter: 100,
  });
  console.log(`  peakVelocity = ${r.peakVelocity_m_s.toFixed(4)} m/s, Re = ${r.reynolds.toFixed(1)}, p range = [${r.pressureMin_Pa.toExponential(2)}, ${r.pressureMax_Pa.toExponential(2)}] Pa`);
  console.log(`  residual ${r.initialResidual.toExponential(2)} → ${r.finalResidual.toExponential(2)}, iters = ${r.iterations}`);
  ok(Number.isFinite(r.peakVelocity_m_s), 'peak velocity finite');
  ok(r.peakVelocity_m_s > 0.8 && r.peakVelocity_m_s < 1.2, 'peak |u| in [0.8,1.2] m/s (lid BC propagating)');
  ok(r.pressureMax_Pa - r.pressureMin_Pa > 0, 'pressure field non-trivial');
  ok(r.initialResidual / r.finalResidual > 1e3, 'divergence residual drops ≥1000x');
}

// =========================================================== MOTION
console.log('\n[simulate.dynamics-motion] 3-bar linkage, 2π sweep over 36 frames');
{
  forge.assembly.clear();
  if (forge.assembly.clearHierarchy) forge.assembly.clearHierarchy();
  const I = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const T = (x) => Float64Array.from([1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const box = forge.makeBox(1, 1, 1);
  const bar1 = forge.addInstance(box, I);
  const bar2 = forge.addInstance(box, T(2));
  const bar3 = forge.addInstance(box, T(5));
  forge.assembly.setFixed(bar1, true);
  const K = forge.assembly.MateKind;
  forge.assembly.addMate(K.Distance, bar1, 0, bar2, 0, 2);
  forge.assembly.addMate(K.Distance, bar2, 0, bar3, 0, 3);
  assert.ok(forge.assembly.solve().converged, 'initial mate solve failed');

  const r = await call('simulate.dynamics-motion', {
    motor: bar2, axis: 0, totalAngle: 2 * Math.PI, steps: 36,
  });
  console.log(`  frames = ${r.frames}, allConverged = ${r.allConverged}, swept = ${r.driverSwept.toFixed(4)} (2π=${(2 * Math.PI).toFixed(4)})`);
  console.log(`  startPos = [${r.startPos.map((x) => x.toFixed(3)).join(', ')}], endPos = [${r.endPos.map((x) => x.toFixed(3)).join(', ')}], pathLength = ${r.pathLength.toFixed(3)}`);
  ok(r.frames === 36, '36 frames captured');
  ok(r.allConverged === true, 'every frame converged');
  ok(Math.abs(r.driverSwept - 2 * Math.PI) < 1e-6, 'driver swept exactly 2π');
  ok(r.pathLength > 0.1, 'driven instance actually moved');

  forge.assembly.clear();
  [bar1, bar2, bar3].forEach((id) => forge.removeInstance(id));
  forge.release(box);
}

console.log(`\n[simulate-verbs] ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
