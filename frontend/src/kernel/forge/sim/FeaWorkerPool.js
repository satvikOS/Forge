/**
 * Forge-44 — FEA / CFD worker pool.
 *
 * Distributes element-matrix assembly and per-substep solves across N
 * workers so a 200k-element static analysis doesn't pin the main thread.
 * Mirrors the Forge-25 tessellation worker pattern: pull-based queue
 * with workers reporting back through a shared message channel.
 *
 * Two backends:
 *   1. Browser / Electron renderer — `new Worker(url, { type: 'module' })`
 *      from a workerUrl supplied by the caller.
 *   2. Node test harness — synchronous in-process runner (no Worker
 *      threads import — keeps tests dependency-free and deterministic).
 *
 * Tasks are pure-data objects of the form:
 *   { id, kind: 'assemble'|'solve'|'integrate', payload, transferables? }
 * Workers respond with `{ id, ok, result?, error? }`.
 */

let _nextTaskId = 1;
function uid() { return 'fea-task-' + (_nextTaskId++); }

/**
 * The synchronous fallback runner. Used in Node tests and as a safe
 * default when a workerUrl isn't supplied. Operations are kept small
 * and deterministic so they don't accidentally become a performance
 * trap in production — production callers MUST pass a real worker URL.
 *
 * Supported task kinds (the FEA "vertical slice" demoed in Forge-31):
 *   - 'assemble' { K: number[N][N], B: number[E][N], D: number, w: number[E] }
 *       Returns the symmetric stiffness matrix K += sum(w * B^T D B).
 *   - 'solve'    { A: n×n, b: n }  — Gauss-elimination solver.
 *   - 'integrate'{ A: n×n, x0: n[], rhs: n[], dt: number, steps: number }
 *       Explicit time integration  x_{k+1} = x_k + dt * (A x_k + rhs).
 */
function inProcessRun(task) {
  if (task.kind === 'assemble') {
    const { K, B, D, w } = task.payload;
    const N = K.length;
    for (let e = 0; e < B.length; e++) {
      const Be = B[e];
      const Dw = D * w[e];
      for (let i = 0; i < N; i++) {
        const bi = Be[i];
        if (bi === 0) continue;
        for (let j = 0; j < N; j++) {
          K[i][j] += Dw * bi * Be[j];
        }
      }
    }
    return { K };
  }
  if (task.kind === 'solve') {
    const { A, b } = task.payload;
    const n = b.length;
    // Build augmented matrix.
    const M = A.map((row, i) => [...row, b[i]]);
    // Forward elim with partial pivot.
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
    // Back-sub.
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = M[i][n];
      for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return { x };
  }
  if (task.kind === 'integrate') {
    const { A, x0, rhs, dt, steps } = task.payload;
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
  throw new Error(`[forge.fea-pool] unknown task kind: ${task.kind}`);
}

export class FeaWorkerPool {
  /**
   * @param {object} opts
   * @param {string|null} opts.workerUrl URL of the worker module (the
   *   worker should `addEventListener('message', …)` and reply with the
   *   `{ id, ok, result/error }` envelope). When null, runs in-process.
   * @param {number}      opts.size  Pool size — defaults to navigator.hardware
   *   Concurrency - 1, clamped to [1, 8].
   * @param {Function?}   opts.runner Override runner for tests:
   *   (task) => Promise<result>. Defaults to inProcessRun (sync).
   */
  constructor({ workerUrl = null, size = 4, runner = null } = {}) {
    this.workerUrl = workerUrl;
    this.size = Math.max(1, Math.min(8, size | 0));
    this.runner = runner || (async (task) => inProcessRun(task));
    this._workers = [];
    this._pending = new Map();   // taskId → { resolve, reject }
    this._queue = [];
    this._busy = new Array(this.size).fill(false);
    if (workerUrl && typeof Worker !== 'undefined') {
      for (let i = 0; i < this.size; i++) this._spawnWorker(i);
    }
  }

  _spawnWorker(slot) {
    try {
      const w = new Worker(this.workerUrl, { type: 'module' });
      w.addEventListener('message', (ev) => this._onWorkerReply(slot, ev.data));
      w.addEventListener('error',   (ev) => this._onWorkerError(slot, ev));
      this._workers[slot] = w;
    } catch (err) {
      // Spawn failed (e.g. CSP, missing URL) — fall back to in-process.
      this._workers[slot] = null;
    }
  }

  _onWorkerReply(slot, msg) {
    this._busy[slot] = false;
    const p = this._pending.get(msg.id);
    if (p) {
      this._pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error || 'worker task failed'));
    }
    this._drain();
  }

  _onWorkerError(slot, ev) {
    this._busy[slot] = false;
    // Re-spawn so a one-shot fault doesn't permanently shrink the pool.
    this._spawnWorker(slot);
    this._drain();
  }

  _findIdle() {
    for (let i = 0; i < this.size; i++) {
      if (!this._busy[i] && this._workers[i]) return i;
    }
    return -1;
  }

  async _drain() {
    while (this._queue.length > 0) {
      const slot = this._findIdle();
      if (slot < 0) return;
      const task = this._queue.shift();
      this._busy[slot] = true;
      this._workers[slot].postMessage(task, task.transferables || []);
    }
  }

  /**
   * Submit one task. Returns a Promise<result>.
   *
   *   pool.run({ kind: 'solve', payload: { A, b } }) → { x }
   */
  run(task) {
    if (!task.id) task = { ...task, id: uid() };
    // Worker-backed path.
    if (this.workerUrl && this._workers.some(Boolean)) {
      return new Promise((resolve, reject) => {
        this._pending.set(task.id, { resolve, reject });
        this._queue.push(task);
        this._drain();
      });
    }
    // In-process fallback (default in tests + headless Node).
    return this.runner(task);
  }

  /**
   * Submit N tasks; resolves to N results in the same order. The pool
   * runs them concurrently up to its size.
   */
  async runAll(tasks) {
    return Promise.all(tasks.map((t) => this.run(t)));
  }

  /** Tear down all worker threads. Idempotent. */
  dispose() {
    for (const w of this._workers) {
      if (w && typeof w.terminate === 'function') {
        try { w.terminate(); } catch { /* ignore */ }
      }
    }
    this._workers = [];
    this._pending.clear();
    this._queue.length = 0;
  }
}
