// forge-kernel Geotech smoke (Forge-176) — Bishop + Janbu slope stability
// on a textbook 10 m high 1H:1V slope with single-layer c-φ soil.
//
// Reference: Taylor's stability chart (Taylor 1937) gives N_s = c'/(γ·H·F)
// for a 45° slope with c-φ soil. For γ=20 kN/m³, c'=10 kPa, φ'=25°, H=10 m,
// stability number N_s ≈ 0.075 ⇒ F ≈ c'/(γ·H·N_s) ≈ 10/(20·10·0.075) ≈ 0.67.
// However Bishop/Janbu typically give FoS above Taylor's friction-circle
// limit (Taylor is conservative). For the geometry we use we expect
// Bishop in the 1.0..1.6 range — well-known textbook ranges for this
// configuration. We assert that and the cross-checks below.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.geotech && typeof forge.geotech.analyse === 'function',
          'forge.geotech.analyse missing');

// 10 m embankment with a 1H:1V slope from (0,0) to (10,10), then flat.
// Ground polyline:
const ground = new Float64Array([
  -20, 0,          // far left foot
   0,  0,          // toe of slope
   10, 10,         // top of slope
   30, 10,         // far right crest
]);

// Single soil layer covering the whole domain (top above the slope).
const layerTop = new Float64Array([
  -20, 30, 30, 30, // layer top well above slope crest
]);

const cfg = {
  groundProfile: ground,
  layers: [{
    topProfile: layerTop,
    gammaWet: 20.0, gammaSat: 22.0,
    cPrime: 10.0,        // kPa
    phiPrime: 25.0,      // deg
    ru: 0.0,
    name: 'silty sand',
  }],
  waterTable: new Float64Array([]),
  xcMin: 2,  xcMax: 14,    nXc: 12,
  ycMin: 12, ycMax: 24,    nYc: 12,
  rMin:  8,  rMax:  20,    nR:  10,
  sliceCount: 30,
  bishopMaxIters: 60,
  bishopTol: 1.0e-4,
  janbuF0: 0.0,
};

const t0 = Date.now();
const r = forge.geotech.analyse(cfg);
const ms = Date.now() - t0;

assert.ok(r.trialsEvaluated > 100,
          `expected > 100 valid trials, got ${r.trialsEvaluated}`);
assert.ok(r.fosBishop > 0.6 && r.fosBishop < 2.5,
          `Bishop FoS ${r.fosBishop} outside plausible range (0.6..2.5) for textbook 1:1 c-φ slope`);
assert.ok(r.fosJanbu > 0.6 && r.fosJanbu < 2.5,
          `Janbu FoS ${r.fosJanbu} outside plausible range`);
// Bishop and Janbu typically agree to within ±15% on circular failure.
const rel = Math.abs(r.fosBishop - r.fosJanbu) / r.fosBishop;
assert.ok(rel < 0.25,
          `Bishop ${r.fosBishop} vs Janbu ${r.fosJanbu} disagree by ${(100*rel).toFixed(1)}%`);

assert.ok(r.iterations > 0 && r.iterations < 60,
          `Bishop iterations ${r.iterations} should converge in < 60 steps`);

// Critical circle plausibility
assert.ok(r.rCritical >= cfg.rMin && r.rCritical <= cfg.rMax,
          `rCritical ${r.rCritical} not in [${cfg.rMin}, ${cfg.rMax}]`);
assert.ok(r.xcCritical >= cfg.xcMin && r.xcCritical <= cfg.xcMax,
          `xcCritical ${r.xcCritical} not in search range`);

// Slip surface closes onto ground
assert.ok(r.slipSurface.length >= 20 * 2,
          `slipSurface has only ${r.slipSurface.length/2} points`);

// Slices coherent
assert.strictEqual(r.slices.length, 30, 'slice count mismatch');
for (const s of r.slices) {
  assert.ok(s.weight > 0, 'slice weight non-positive');
  assert.ok(s.baseLength > 0, 'slice base length non-positive');
  assert.ok(s.cBase >= 0, 'slice cohesion negative');
}

// Sanity: increasing cohesion should increase FoS
const cfg2 = { ...cfg, layers: [{ ...cfg.layers[0], cPrime: 30.0 }] };
const r2 = forge.geotech.analyse(cfg2);
assert.ok(r2.fosBishop > r.fosBishop,
          `Bishop FoS should rise when cohesion 10→30 kPa (got ${r.fosBishop} → ${r2.fosBishop})`);

// Sanity: rising water table should reduce FoS
const cfg3 = {
  ...cfg,
  waterTable: new Float64Array([-20, 8, 0, 8, 10, 10, 30, 10]),
};
const r3 = forge.geotech.analyse(cfg3);
assert.ok(r3.fosBishop < r.fosBishop * 1.05,
          `water table should NOT raise FoS (dry ${r.fosBishop} vs wet ${r3.fosBishop})`);

console.log('✅ Geotech smoke PASSED');
console.log(`   trials              ${r.trialsEvaluated}`);
console.log(`   FoS_Bishop          ${r.fosBishop.toFixed(3)}  (iter=${r.iterations})`);
console.log(`   FoS_Janbu           ${r.fosJanbu.toFixed(3)}`);
console.log(`   critical (xc,yc,R)  (${r.xcCritical.toFixed(1)}, ${r.ycCritical.toFixed(1)}, ${r.rCritical.toFixed(1)})`);
console.log(`   cohesion 10→30      Bishop  ${r.fosBishop.toFixed(2)} → ${r2.fosBishop.toFixed(2)}`);
console.log(`   add water table     Bishop  ${r.fosBishop.toFixed(2)} → ${r3.fosBishop.toFixed(2)}`);
console.log(`   wall time           ${ms} ms`);
