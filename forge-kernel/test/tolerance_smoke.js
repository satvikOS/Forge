// forge-kernel tolerance smoke (Forge-185) — 4-link stack.
// Each link nominal 10 mm with ±0.05 mm tolerance, normal distribution.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.tolerance && typeof forge.tolerance.compute === 'function',
          'forge.tolerance.compute missing');

const cfg = {
  chain: [
    { name: 'L1', nominal: 10, tolPlus: 0.05, tolMinus: 0.05, dist: 0 },
    { name: 'L2', nominal: 10, tolPlus: 0.05, tolMinus: 0.05, dist: 0 },
    { name: 'L3', nominal: 10, tolPlus: 0.05, tolMinus: 0.05, dist: 0 },
    { name: 'L4', nominal: 10, tolPlus: 0.05, tolMinus: 0.05, dist: 0 },
  ],
  USL: 40.20,
  LSL: 39.80,
  mcSamples: 20000,
  randomSeed: 42,
};

const r = forge.tolerance.compute(cfg);

// Worst-case: nominal sum 40, range ±0.20.
assert.strictEqual(r.worstCaseNominal, 40);
assert.ok(Math.abs(r.worstCaseHigh - 40.20) < 1e-9);
assert.ok(Math.abs(r.worstCaseLow  - 39.80) < 1e-9);

// RSS: σ_i = 0.05/3 each, σ_assembly = √(4 × (0.05/3)²) = 2 × 0.05/3 ≈ 0.03333
const expectedRssSigma = 2.0 * 0.05 / 3.0;
assert.ok(Math.abs(r.rssSigma - expectedRssSigma) < 1e-4,
          `RSS sigma ${r.rssSigma} should be ≈ ${expectedRssSigma}`);
// Cp = (40.20 - 39.80) / (6 × σ) = 0.40 / (6 × 0.0333) ≈ 2.0
assert.ok(Math.abs(r.rssCp - 2.0) < 0.01,
          `Cp ${r.rssCp} should be ≈ 2.0`);
assert.ok(Math.abs(r.rssCpk - 2.0) < 0.01,
          `Cpk ${r.rssCpk} should be ≈ 2.0`);

// Monte-Carlo should agree with RSS for normal distributions.
assert.ok(Math.abs(r.mcMu - 40.0) < 0.01,
          `MC mu ${r.mcMu} should be ≈ 40`);
assert.ok(Math.abs(r.mcSigma - expectedRssSigma) / expectedRssSigma < 0.05,
          `MC sigma ${r.mcSigma} should match RSS ${expectedRssSigma}`);
// At Cp = 2 the yield should be ~ 100%.
assert.ok(r.mcYieldPct > 99.5,
          `MC yield ${r.mcYieldPct.toFixed(2)}% should be > 99.5%`);

// Now tighten spec — USL = 40.05, LSL = 39.95 → Cp = 0.5, yield ~ 79%.
const cfg2 = { ...cfg, USL: 40.05, LSL: 39.95 };
const r2 = forge.tolerance.compute(cfg2);
assert.ok(Math.abs(r2.rssCp - 0.5) < 0.01,
          `tight Cp ${r2.rssCp} should be ≈ 0.5`);
assert.ok(r2.mcYieldPct > 70 && r2.mcYieldPct < 90,
          `tight MC yield ${r2.mcYieldPct.toFixed(2)}% should be in 70-90%`);

// Uniform distribution check: σ_i = 0.05/√3 → larger spread than normal.
const cfg3 = {
  ...cfg,
  chain: cfg.chain.map((d) => ({ ...d, dist: 1 })),
};
const r3 = forge.tolerance.compute(cfg3);
assert.ok(r3.mcSigma > r.mcSigma,
          `uniform sigma ${r3.mcSigma} should exceed normal ${r.mcSigma}`);

console.log('✅ Tolerance smoke PASSED');
console.log(`   Worst-case  ${r.worstCaseLow.toFixed(3)} … ${r.worstCaseHigh.toFixed(3)}`);
console.log(`   RSS         μ ${r.rssMu.toFixed(3)}  σ ${r.rssSigma.toFixed(4)}  Cp ${r.rssCp.toFixed(2)}  Cpk ${r.rssCpk.toFixed(2)}`);
console.log(`   Monte Carlo μ ${r.mcMu.toFixed(3)}  σ ${r.mcSigma.toFixed(4)}  yield ${r.mcYieldPct.toFixed(2)}%`);
console.log(`   MC P05/50/95 ${r.mcP05.toFixed(3)} / ${r.mcP50.toFixed(3)} / ${r.mcP95.toFixed(3)}`);
console.log(`   Tight spec Cp ${r2.rssCp.toFixed(2)}  yield ${r2.mcYieldPct.toFixed(2)}%`);
console.log(`   Uniform σ ${r3.mcSigma.toFixed(4)}  vs normal ${r.mcSigma.toFixed(4)}`);
