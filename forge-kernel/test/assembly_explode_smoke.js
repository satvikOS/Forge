// Forge-35 exploded-view smoke (JS-only, native kernel not required).
//
// Verifies that ExplodedView linearly interpolates instance positions
// from 0 → 1 across the animation ramp. We feed it stub `readXform` /
// `applyXform` hooks so the test runs in plain Node without Electron.
//
// Assertions:
//   * setExplodeFraction(0)   = original position.
//   * setExplodeFraction(0.5) = midway.
//   * setExplodeFraction(1.0) = original + distance × direction.
//   * Animated explode resolves to the final fraction (1.0).

const path = require('path');
const assert = require('assert');

const url = require('url');

// The frontend bundle is an ESM module — load it via createRequire +
// dynamic import so we keep this smoke a single self-contained file.
const assemblyPath = url.pathToFileURL(
  path.resolve(__dirname, '..', '..', 'frontend', 'src', 'kernel', 'forge', 'Assembly.js')
).href;

(async () => {
  const { ExplodedView, ComponentPattern, BomRollup, SmartComponent } =
    await import(assemblyPath);

  // ---------- ExplodedView ----------
  const positions = new Map();
  const original = {
    1: Float64Array.from([1,0,0,10,  0,1,0,20,  0,0,1,30,  0,0,0,1]),
    2: Float64Array.from([1,0,0,5,   0,1,0,5,   0,0,1,5,   0,0,0,1]),
  };
  const read = (id) => new Float64Array(original[id]);
  const apply = (id, m) => positions.set(id, new Float64Array(m));

  // Drive a manual rAF so we can advance time deterministically.
  let pending = null;
  const raf = (cb) => { pending = cb; return 1; };
  let now = 0;
  const ev = new ExplodedView({
    instances: [1, 2],
    directionPerInstance: { 1: [1, 0, 0], 2: [0, 0, 1] },
    distance: 100,
    animated: true,
    durationMs: 600,
    readXform: read,
    applyXform: apply,
    now: () => now,
    raf,
  });

  // f = 0
  ev.setExplodeFraction(0);
  assert.deepStrictEqual(Array.from(positions.get(1).slice(3, 4)), [10],
    'instance 1 origin x at f=0 should be 10');
  assert.deepStrictEqual(Array.from(positions.get(2).slice(11, 12)), [5],
    'instance 2 origin z at f=0 should be 5');

  // f = 0.5
  ev.setExplodeFraction(0.5);
  assert.ok(Math.abs(positions.get(1)[3] - (10 + 0.5 * 100)) < 1e-9,
    `instance 1 origin x at f=0.5 should be 60, got ${positions.get(1)[3]}`);
  assert.ok(Math.abs(positions.get(2)[11] - (5 + 0.5 * 100)) < 1e-9,
    `instance 2 origin z at f=0.5 should be 55, got ${positions.get(2)[11]}`);

  // f = 1
  ev.setExplodeFraction(1.0);
  assert.ok(Math.abs(positions.get(1)[3] - 110) < 1e-9, 'instance 1 origin x at f=1 should be 110');
  assert.ok(Math.abs(positions.get(2)[11] - 105) < 1e-9, 'instance 2 origin z at f=1 should be 105');
  console.log('[explode] setExplodeFraction OK');

  // ---------- animated ramp ----------
  ev.setExplodeFraction(0);
  const explodePromise = ev.explode();
  // Drive the rAF clock to durationMs / completion.
  while (pending) {
    const cb = pending;
    pending = null;
    now += 100;
    cb(now);
  }
  const finalFrac = await explodePromise;
  assert.ok(Math.abs(finalFrac - 1.0) < 1e-9,
    `animated explode should resolve to 1.0, got ${finalFrac}`);
  assert.ok(Math.abs(positions.get(1)[3] - 110) < 1e-9,
    'after animated explode, instance 1 origin x should be 110');
  console.log('[explode] animated ramp 0→1 OK');

  // ---------- ComponentPattern: linear ----------
  const linear = ComponentPattern({ kind: 'linear', params: { count: 3, dx: 5 } });
  assert.strictEqual(linear.length, 3);
  assert.ok(Math.abs(linear[0][3] - 0)  < 1e-9, 'linear[0].x = 0');
  assert.ok(Math.abs(linear[1][3] - 5)  < 1e-9, 'linear[1].x = 5');
  assert.ok(Math.abs(linear[2][3] - 10) < 1e-9, 'linear[2].x = 10');
  console.log('[explode] ComponentPattern linear OK');

  // ---------- ComponentPattern: mirror ----------
  const mirror = ComponentPattern({
    kind: 'mirror',
    seedTransform: Float64Array.from([
      1,0,0,3, 0,1,0,4, 0,0,1,5, 0,0,0,1,
    ]),
    params: { plane: { n: [1, 0, 0], d: 0 } },
  });
  assert.strictEqual(mirror.length, 2);
  assert.ok(Math.abs(mirror[1][3] + 3) < 1e-9, 'mirror reflects x = 3 → -3');
  console.log('[explode] ComponentPattern mirror OK');

  // ---------- BomRollup ----------
  const tree = { 0: [10, 20], 10: [11, 12], 20: [21] };
  const fakeForge = {
    assembly: {
      getChildren: (id) => tree[id] || [],
    },
  };
  const bom = BomRollup(0, {
    forge: fakeForge,
    partOf: (id) => (id < 20 ? 'partA' : 'partB'),
    massOf: () => 1,
    costOf: () => 2,
  });
  // children of root = 10, 20; children of 10 = 11, 12; children of 20 = 21.
  // partA: 10, 11, 12 = 3. partB: 20, 21 = 2.
  const partA = bom.find((r) => r.partId === 'partA');
  const partB = bom.find((r) => r.partId === 'partB');
  assert.strictEqual(partA.qty, 3, `partA qty expected 3, got ${partA.qty}`);
  assert.strictEqual(partB.qty, 2, `partB qty expected 2, got ${partB.qty}`);
  assert.strictEqual(partA.mass, 3);
  assert.strictEqual(partA.totalCost, 6);
  console.log('[explode] BomRollup OK');

  // ---------- SmartComponent ----------
  const sc = new SmartComponent({
    configMap: { 'M3': 100, 'M6': 200, 'M8': 300 },
    defaultKey: 'M3',
  });
  assert.strictEqual(sc.currentPartId(), 100);
  sc.setContext('M6');
  assert.strictEqual(sc.currentPartId(), 200);
  assert.deepStrictEqual(sc.configurations().sort(), ['M3', 'M6', 'M8']);
  console.log('[explode] SmartComponent OK');

  console.log('[explode] ALL PASS');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
