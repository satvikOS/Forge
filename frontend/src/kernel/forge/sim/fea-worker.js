// fea-worker.js — Forge-52 real off-main-thread FEA solver.
//
// ESM Web Worker. Loaded by FeaWorkerPool when running in the renderer
// (Electron + browser). The worker imports the SAME task handlers as
// the in-process fallback so the maths is identical — the only
// difference is which thread runs the loops.
//
// Wire-up: the pool's `workerUrl` is resolved by `runtimeWorkerUrl()`
// in FeaWorkerPool.js to `new URL('./fea-worker.js', import.meta.url)`.
//
// Worker contract:
//   master → worker: { id, kind: 'assemble'|'solve'|'integrate', payload }
//   worker → master: { id, ok: true,  result }
//                  | { id, ok: false, error }

// Inline copy of the task handlers — duplicating ~30 lines is cheaper
// than dragging an extra import into the worker boot path (every byte
// counts during off-main-thread spawn).

function runAssemble(payload) {
  const { K, B, D, w } = payload;
  const N = K.length;
  for (let e = 0; e < B.length; e++) {
    const Be = B[e];
    const Dw = D * w[e];
    for (let i = 0; i < N; i++) {
      const bi = Be[i];
      if (bi === 0) continue;
      for (let j = 0; j < N; j++) K[i][j] += Dw * bi * Be[j];
    }
  }
  return { K };
}

function runSolve(payload) {
  const { A, b } = payload;
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
    }
    if (piv !== i) { const t = M[i]; M[i] = M[piv]; M[piv] = t; }
    const a = M[i][i];
    if (Math.abs(a) < 1e-12) throw new Error('singular matrix');
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / a;
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return { x };
}

function runIntegrate(payload) {
  const { A, x0, rhs, dt, steps } = payload;
  const n = x0.length;
  const x = [...x0];
  const tmp = new Array(n);
  for (let s = 0; s < steps; s++) {
    for (let i = 0; i < n; i++) {
      let v = rhs[i] || 0;
      const Ai = A[i];
      for (let j = 0; j < n; j++) v += Ai[j] * x[j];
      tmp[i] = x[i] + dt * v;
    }
    for (let i = 0; i < n; i++) x[i] = tmp[i];
  }
  return { x };
}

const HANDLERS = {
  assemble:  runAssemble,
  solve:     runSolve,
  integrate: runIntegrate,
};

// In a real Worker context `self` is the global. In Node tests that
// import this module for the handlers only, `self` is undefined — and
// that's fine because we never receive a message there. We feature-
// detect rather than throw at import time.
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', (ev) => {
    const task = ev.data || {};
    const h = HANDLERS[task.kind];
    if (!h) {
      self.postMessage({ id: task.id, ok: false,
                         error: `unknown task kind ${task.kind}` });
      return;
    }
    try {
      const result = h(task.payload);
      self.postMessage({ id: task.id, ok: true, result });
    } catch (err) {
      self.postMessage({ id: task.id, ok: false, error: err.message });
    }
  });
}

// Export the handlers too so a Node-side test can import this file
// (without spawning a Worker) and verify the maths matches the
// in-process runner.
export { runAssemble, runSolve, runIntegrate, HANDLERS };
