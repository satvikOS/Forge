import assert from 'node:assert/strict';
import { FeaWorkerPool } from '../FeaWorkerPool.js';

// In-process 'solve' — 3×3 linear system.
{
  const pool = new FeaWorkerPool({ size: 2 });
  // | 2 1 1 |  | x |   | 5 |
  // | 4 3 3 |  | y | = | 6 |
  // | 8 7 9 |  | z |   |14 |
  // Solution: x = 1, y = -1, z = 4   (check: 2-1+4 = 5 ✓, 4-3+12 = 13... wrong)
  //
  // Let's pick a simpler system with known solution: x = 1, y = 2, z = 3
  // diag(1,1,1) trivial:  Ax = x   →  b = (1,2,3) gives x = (1,2,3).
  const A = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const b = [1, 2, 3];
  const { x } = await pool.run({ kind: 'solve', payload: { A, b } });
  assert.deepEqual(x, [1, 2, 3]);
  pool.dispose();
}

// Slightly less trivial: upper-triangular.
{
  const pool = new FeaWorkerPool({ size: 2 });
  const A = [
    [2, 1, 0],
    [0, 3, 2],
    [0, 0, 4],
  ];
  // Pick x = [1, 2, 3]: b = [2*1 + 1*2, 3*2 + 2*3, 4*3] = [4, 12, 12].
  const b = [4, 12, 12];
  const { x } = await pool.run({ kind: 'solve', payload: { A, b } });
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(x[i] - (i + 1)) < 1e-9, `x[${i}] = ${x[i]}`);
  pool.dispose();
}

// 'assemble' — single element accumulation (sanity that the K block adds up).
{
  const pool = new FeaWorkerPool();
  const K = [[0, 0], [0, 0]];
  const B = [[1, -1]];
  const w = [1];
  const D = 100;   // Young's modulus / length, say
  const result = await pool.run({ kind: 'assemble', payload: { K, B, D, w } });
  // K += w * D * B^T B = 100 * [[1,-1],[-1,1]]
  assert.deepEqual(result.K, [[100, -100], [-100, 100]]);
  pool.dispose();
}

// 'integrate' — explicit Euler on dx/dt = -x with x0 = 1, dt = 0.1, 10 steps.
// Closed-form: x(1) = exp(-1) ≈ 0.367. Explicit Euler over-damps: (1 - 0.1)^10 ≈ 0.3487.
{
  const pool = new FeaWorkerPool();
  const { x } = await pool.run({
    kind: 'integrate',
    payload: {
      A: [[-1]], x0: [1], rhs: [0], dt: 0.1, steps: 10,
    },
  });
  const expected = Math.pow(0.9, 10);
  assert.ok(Math.abs(x[0] - expected) < 1e-9, `x = ${x[0]}, expected ≈ ${expected}`);
  pool.dispose();
}

// runAll — N independent solves run via the pool concurrently and return
// in order.
{
  const pool = new FeaWorkerPool({ size: 4 });
  const tasks = [];
  for (let i = 0; i < 5; i++) {
    const k = i + 1;
    tasks.push({ kind: 'solve', payload: {
      A: [[1, 0], [0, 1]], b: [k, k * 2],
    } });
  }
  const results = await pool.runAll(tasks);
  for (let i = 0; i < 5; i++) {
    const k = i + 1;
    assert.deepEqual(results[i].x, [k, k * 2], `task ${i}`);
  }
  pool.dispose();
}

// Custom runner injection — tests can drop in a mocked compute path.
{
  let called = 0;
  const pool = new FeaWorkerPool({
    runner: async (task) => { called++; return { echo: task.kind }; },
  });
  const r = await pool.run({ kind: 'whatever', payload: {} });
  assert.equal(r.echo, 'whatever');
  assert.equal(called, 1);
  pool.dispose();
}

console.log('[forge.fea-worker-pool] all tests passed');
