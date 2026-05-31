// Forge-35 interference-detection smoke.
//
// Adds two instances of a 1×1×1 box with a half-overlap translation.
// Expects detectInterference to return exactly one pair with volume ≈ 0.5
// (1 × 1 × 0.5). A third instance translated well clear of either box
// must not appear in the result.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

function translated(x, y, z) {
  return Float64Array.from([
    1, 0, 0, x,
    0, 1, 0, y,
    0, 0, 1, z,
    0, 0, 0, 1,
  ]);
}

console.log('[interference] version =', forge.version());
assert.ok(forge.assembly && forge.assembly.detectInterference,
  'forge.assembly.detectInterference missing — Forge-35 binding not loaded');

forge.assembly.clear();
if (forge.assembly.clearHierarchy) forge.assembly.clearHierarchy();

const box = forge.makeBox(1, 1, 1);
const a = forge.addInstance(box, translated(0, 0, 0));     // [0..1]
const b = forge.addInstance(box, translated(0.5, 0, 0));    // [0.5..1.5] — overlap on x
const c = forge.addInstance(box, translated(5, 5, 5));     // far away
console.log('[interference] scene', { a, b, c });

const pairs = forge.assembly.detectInterference([a, b, c], 0);
console.log('[interference] pairs =', pairs);

assert.strictEqual(pairs.length, 1,
  `expected exactly 1 interference pair, got ${pairs.length}`);
const p = pairs[0];
assert.strictEqual(p.instA, a, `instA: expected ${a}, got ${p.instA}`);
assert.strictEqual(p.instB, b, `instB: expected ${b}, got ${p.instB}`);
assert.ok(p.volume > 0, `volume should be > 0, got ${p.volume}`);
// Half-overlap of unit boxes ≈ 0.5 mm³.
assert.ok(Math.abs(p.volume - 0.5) < 1e-3,
  `expected intersection volume ≈ 0.5, got ${p.volume}`);

// Sanity: tolerance-only pair must still report non-zero.
const tolPairs = forge.assembly.detectInterference([a, c], 0);
assert.strictEqual(tolPairs.length, 0,
  `a vs far-c expected no interference, got ${tolPairs.length}`);

forge.assembly.clear();
[a, b, c].forEach((id) => forge.removeInstance(id));
forge.release(box);

console.log('[interference] ALL PASS');
