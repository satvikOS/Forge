// forge-kernel Variants smoke (Forge-187) — LHS coverage + Pareto front.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.variants && typeof forge.variants.latinHypercube === 'function',
          'forge.variants.latinHypercube missing');
assert.ok(typeof forge.variants.paretoFront === 'function',
          'forge.variants.paretoFront missing');

// -------- Latin hypercube ----------
const lhs = forge.variants.latinHypercube({
  dims: [
    { name: 'chord',    lo:  50,  hi:  300 },
    { name: 'halfSpan', lo: 200,  hi: 1500 },
    { name: 'taper',    lo:   0.3,hi:   1.0 },
  ],
  samples: 16, randomSeed: 7,
});
assert.strictEqual(lhs.nDims, 3);
assert.strictEqual(lhs.nSamples, 16);
assert.strictEqual(lhs.values.length, 48);

// LHS stratification: each dimension must have one sample per bin
// (16 bins). Bin index for each sample:
const bins = [new Set(), new Set(), new Set()];
for (let s = 0; s < 16; ++s) {
  for (let d = 0; d < 3; ++d) {
    const v = lhs.values[s * 3 + d];
    const lo = [50, 200, 0.3][d], hi = [300, 1500, 1.0][d];
    const norm = (v - lo) / (hi - lo);
    const bin = Math.floor(norm * 16);
    bins[d].add(Math.min(15, Math.max(0, bin)));
  }
}
for (let d = 0; d < 3; ++d) {
  assert.strictEqual(bins[d].size, 16,
                     `dim ${d} should cover all 16 bins, got ${bins[d].size}`);
}

// All values inside the dim ranges.
for (let s = 0; s < 16; ++s) {
  assert.ok(lhs.values[s*3 + 0] >= 50 && lhs.values[s*3 + 0] <= 300);
  assert.ok(lhs.values[s*3 + 1] >= 200 && lhs.values[s*3 + 1] <= 1500);
  assert.ok(lhs.values[s*3 + 2] >= 0.3 && lhs.values[s*3 + 2] <= 1.0);
}

// -------- Pareto front ----------
// 6 candidates in (mass, aspect_ratio) space: minimise mass, maximise AR.
const objectives = new Float64Array([
  100, 8,    // 0
  120, 10,   // 1   — dominated by (100, 8)? mass higher AR higher → not dominated by 0
  150, 12,   // 2
  200, 5,    // 3   — dominated by 0 (lower mass, higher AR)
  250, 14,   // 4
  300, 16,   // 5
]);
// Sign = [-1 (minimise mass), +1 (maximise AR)].
const idx = forge.variants.paretoFront(objectives, 2, [-1, +1]);
const set = new Set(Array.from(idx));
// Point 3 is dominated (heavier + lower AR than 0). All others are on the front.
assert.ok(!set.has(3), 'point 3 should be dominated');
assert.ok(set.has(0), 'point 0 should be on front');
assert.ok(set.has(1), 'point 1 should be on front');
assert.ok(set.has(2), 'point 2 should be on front');
assert.ok(set.has(4), 'point 4 should be on front');
assert.ok(set.has(5), 'point 5 should be on front');
assert.strictEqual(idx.length, 5);

console.log('✅ Variants smoke PASSED');
console.log(`   LHS ${lhs.nSamples} samples × ${lhs.nDims} dims — every dim covers all 16 bins`);
console.log(`   sample[0] = (${lhs.values[0].toFixed(1)}, ${lhs.values[1].toFixed(1)}, ${lhs.values[2].toFixed(2)})`);
console.log(`   Pareto front of 6 candidates → ${idx.length} non-dominated: [${Array.from(idx).join(', ')}]`);
