import assert from 'node:assert/strict';
import { runAssemble, runSolve, runIntegrate, HANDLERS } from '../fea-worker.js';
import { runtimeWorkerUrl } from '../FeaWorkerPool.js';

// Forge-52: the worker file's task handlers must produce identical
// results to FeaWorkerPool's in-process runner (the production guarantee
// is "off-main-thread is the same maths, just faster"). We verify by
// running each handler with the same inputs the FeaWorkerPool tests use
// and comparing the result shape.

// 1) HANDLERS map exposes the three task kinds.
{
  assert.equal(typeof HANDLERS.assemble,  'function');
  assert.equal(typeof HANDLERS.solve,     'function');
  assert.equal(typeof HANDLERS.integrate, 'function');
}

// 2) Solve identity matrix.
{
  const r = runSolve({ A: [[1,0,0],[0,1,0],[0,0,1]], b: [1, 2, 3] });
  assert.deepEqual(r.x, [1, 2, 3]);
}

// 3) Solve upper-triangular — pick x = [1, 2, 3], b derived.
{
  const r = runSolve({ A: [[2,1,0],[0,3,2],[0,0,4]], b: [4, 12, 12] });
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(r.x[i] - (i + 1)) < 1e-9);
  }
}

// 4) Assemble single element.
{
  const K = [[0,0],[0,0]];
  const { K: out } = runAssemble({ K, B: [[1,-1]], D: 100, w: [1] });
  assert.deepEqual(out, [[100,-100],[-100,100]]);
}

// 5) Integrate explicit Euler on dx/dt = -x.
{
  const { x } = runIntegrate({
    A: [[-1]], x0: [1], rhs: [0], dt: 0.1, steps: 10,
  });
  assert.ok(Math.abs(x[0] - Math.pow(0.9, 10)) < 1e-9);
}

// 6) runtimeWorkerUrl resolves to a URL ending in fea-worker.js
//    when import.meta.url is defined (Node ≥ 22 has this in ESM).
{
  const url = runtimeWorkerUrl();
  assert.ok(url !== null, 'runtimeWorkerUrl resolved');
  assert.ok(String(url).endsWith('fea-worker.js'),
            `URL should end with fea-worker.js, got ${url}`);
}

console.log('[forge.fea-worker] all tests passed');
