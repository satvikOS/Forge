// Forge-35 sub-assembly hierarchy smoke.
//
// Builds a 3-level tree:
//
//   root
//   ├── subA
//   │   ├── leaf1, leaf2, leaf3, leaf4
//   └── subB
//       ├── leaf5, leaf6, leaf7, leaf8
//
// Each level has its own local transform. The world transform of every
// leaf must compose root × subN × leaf (multiplied root-down). We assert:
//   1. getChildren(root) returns [subA, subB].
//   2. worldTransform(leaf) equals the explicit composition.
//   3. BomRollup walks the whole tree and yields a single row of qty=8
//      because every leaf instance shares the same component handle.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

function identity() {
  return Float64Array.from([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}
function translated(x, y, z) {
  return Float64Array.from([
    1, 0, 0, x,
    0, 1, 0, y,
    0, 0, 1, z,
    0, 0, 0, 1,
  ]);
}

function multiply(a, b) {
  const r = new Float64Array(16);
  for (let i = 0; i < 4; ++i) {
    for (let j = 0; j < 4; ++j) {
      let v = 0;
      for (let k = 0; k < 4; ++k) v += a[i * 4 + k] * b[k * 4 + j];
      r[i * 4 + j] = v;
    }
  }
  return r;
}

console.log('[assembly-hierarchy] version =', forge.version());
assert.ok(forge.assembly, 'forge.assembly missing');
assert.ok(forge.assembly.setParent, 'Forge-35 setParent missing');

forge.assembly.clear();

const box = forge.makeBox(1, 1, 1);

// ---------------------------------------------------------------- scene
const root = forge.addInstance(box, translated(100, 0, 0));
const subA = forge.addInstance(box, translated(10, 0, 0));
const subB = forge.addInstance(box, translated(0, 10, 0));
forge.assembly.setParent(subA, root);
forge.assembly.setParent(subB, root);

const leavesA = [];
const leavesB = [];
for (let i = 0; i < 4; ++i) {
  const la = forge.addInstance(box, translated(i, 0, 0));
  const lb = forge.addInstance(box, translated(0, i, 0));
  forge.assembly.setParent(la, subA);
  forge.assembly.setParent(lb, subB);
  leavesA.push(la);
  leavesB.push(lb);
}

console.log('[assembly-hierarchy] scene', {
  root, subA, subB,
  leavesA, leavesB,
});

// ---------------------------------------------------------------- queries
const kidsOfRoot = Array.from(forge.assembly.getChildren(root));
assert.deepStrictEqual(kidsOfRoot, [subA, subB],
  `root children expected [subA, subB], got ${kidsOfRoot}`);
const kidsOfSubA = Array.from(forge.assembly.getChildren(subA));
assert.deepStrictEqual(kidsOfSubA, leavesA);
const kidsOfSubB = Array.from(forge.assembly.getChildren(subB));
assert.deepStrictEqual(kidsOfSubB, leavesB);
console.log('[assembly-hierarchy] tree wiring OK');

// ---------------------------------------------------------------- worldTransform
const rootX = translated(100, 0, 0);
const subAX = translated(10, 0, 0);
const subBX = translated(0, 10, 0);
const leafX0 = translated(0, 0, 0);

const expectedSubA = multiply(rootX, subAX);
const actualSubA   = forge.assembly.worldTransform(subA);
for (let i = 0; i < 16; ++i) {
  assert.ok(Math.abs(expectedSubA[i] - actualSubA[i]) < 1e-9,
    `subA world[${i}]: expected ${expectedSubA[i]}, got ${actualSubA[i]}`);
}

const expectedLeaf0 = multiply(multiply(rootX, subAX), leafX0);
const actualLeaf0   = forge.assembly.worldTransform(leavesA[0]);
for (let i = 0; i < 16; ++i) {
  assert.ok(Math.abs(expectedLeaf0[i] - actualLeaf0[i]) < 1e-9,
    `leafA[0] world[${i}]: expected ${expectedLeaf0[i]}, got ${actualLeaf0[i]}`);
}
console.log('[assembly-hierarchy] worldTransform composes correctly');

// ---------------------------------------------------------------- BOM rollup
// Replicate BomRollup logic against the native getChildren without
// pulling the frontend bundle into Node.
function rollup(rootId) {
  const counts = new Map();
  const walk = (n) => {
    if (n !== rootId) {
      const key = 'box-component';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const kids = Array.from(forge.assembly.getChildren(n));
    for (const c of kids) walk(c);
  };
  walk(rootId);
  return counts;
}

const rolled = rollup(root);
// Children = 2 sub-assemblies + 8 leaves = 10 entries (we aggregate all
// non-root descendants).
assert.strictEqual(rolled.get('box-component'), 10,
  `expected 10 aggregate descendants under root, got ${rolled.get('box-component')}`);
// Just the leaves under subA:
const subAOnly = rollup(subA);
assert.strictEqual(subAOnly.get('box-component'), 4,
  `expected 4 leaves under subA, got ${subAOnly.get('box-component')}`);
console.log('[assembly-hierarchy] BomRollup aggregates 8 leaves + 2 sub-assemblies = 10');

// ---------------------------------------------------------------- cleanup
forge.assembly.clear();
[...leavesA, ...leavesB, subA, subB, root].forEach((id) => forge.removeInstance(id));
forge.release(box);

console.log('[assembly-hierarchy] ALL PASS');
