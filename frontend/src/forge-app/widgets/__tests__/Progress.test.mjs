/**
 * Headless tests for the ProgressBus + the cancellation contract honoured
 * by ForgeFEA. The React `<ProgressOverlay>` host is exercised by the
 * Playwright suite under Electron.
 */

import assert from 'node:assert/strict';
import * as Bus from '../../../kernel/forge/ProgressBus.js';
import { ForgeFEA, ForgeAbortError } from '../../../kernel/forge/Fea.js';

// ---- start / update / done lifecycle ------------------------------
{
  Bus.clear();
  const seen = [];
  const dispose = Bus.onChange((ev) => seen.push(ev.status));
  const op = Bus.start({ kind: 'export', msg: 'STEP' });
  assert.equal(op.status, 'running');
  Bus.update(op.id, { pct: 0.3, msg: 'Writing entities…' });
  Bus.update(op.id, { pct: 0.7 });
  Bus.done(op.id);
  // statuses in order: running, running, running, done
  assert.equal(seen[0], 'running');
  assert.equal(seen.at(-1), 'done');
  dispose();
}

// ---- cancel aborts the controller --------------------------------
{
  Bus.clear();
  const op = Bus.start({ kind: 'solve', msg: 'FEA' });
  let abortedSeen = false;
  if (op.controller) {
    op.controller.signal.addEventListener('abort', () => { abortedSeen = true; });
  }
  Bus.cancel(op.id);
  assert.equal(op.status, 'cancelled');
  if (op.controller) assert.ok(abortedSeen, 'AbortController fired abort event');
}

// ---- track() wraps a promise, surfaces signal --------------------
{
  Bus.clear();
  let receivedSignal = null;
  await Bus.track({ kind: 'tessellate', msg: 'remesh' }, async ({ signal, update }) => {
    receivedSignal = signal;
    update({ pct: 0.5 });
    return 42;
  });
  if (typeof AbortController !== 'undefined') {
    assert.ok(receivedSignal, 'track() exposes signal');
  }
}

// ---- track() bubbles AbortError as cancellation ------------------
{
  Bus.clear();
  let captured = null;
  try {
    await Bus.track({ kind: 'export', msg: 'STL' }, async ({ id }) => {
      Bus.cancel(id);
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
  } catch (e) {
    captured = e;
  }
  assert.equal(captured?.name, 'AbortError');
}

// ---- FEA honours cancelToken --------------------------------------
{
  // Stub kernel so we don't need the native addon during the smoke.
  const fakeMesh = { nodes: new Float64Array(3), nodeCount: 1, elemCount: 0 };
  const calls = { static: 0, dynamic: 0 };
  const stubKernel = {
    fea: {
      solveStatic: (...args) => { calls.static++; return { u: new Float64Array(3) }; },
      solveDynamic: (...args) => { calls.dynamic++; return { displacements: [], times: new Float64Array(0) }; },
    },
  };
  const fea = new ForgeFEA(stubKernel);

  // Static: pre-aborted token throws.
  const ac = new AbortController();
  ac.abort();
  assert.throws(
    () => fea.runStatic({
      material: { E: 200e9, nu: 0.3, rho: 7800 },
      mesh: fakeMesh, loads: [], bcs: [],
      cancelToken: ac.signal,
    }),
    ForgeAbortError,
    'static solve rejects pre-aborted signal',
  );
  assert.equal(calls.static, 0, 'native solveStatic skipped on abort');

  // Static: live token allows solve.
  const ac2 = new AbortController();
  fea.runStatic({
    material: { E: 200e9, nu: 0.3, rho: 7800 },
    mesh: fakeMesh, loads: [], bcs: [],
    cancelToken: ac2.signal,
  });
  assert.equal(calls.static, 1);

  // Dynamic: pre-aborted token throws before iteration.
  const ac3 = new AbortController();
  ac3.abort();
  assert.throws(
    () => fea.runDynamic({
      material: { E: 200e9, nu: 0.3, rho: 7800 },
      mesh: fakeMesh, tEnd: 1, dt: 0.1,
      cancelToken: ac3.signal,
    }),
    ForgeAbortError,
  );
}

console.log('[forge.progress] all tests passed');
