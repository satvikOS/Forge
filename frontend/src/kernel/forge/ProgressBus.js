/**
 * ProgressBus — singleton pub/sub that surfaces long-running operation
 * progress (tessellate, solve, export, AI run) to whoever wants to draw
 * the overlay (Forge-28 ships <ProgressOverlay> on top of this).
 *
 * Each in-flight op is identified by a uuid. The bus carries:
 *   - kind:    'tessellate' | 'solve' | 'export' | 'ai' | string
 *   - id:      op uuid
 *   - msg:     human label
 *   - pct:     0..1 (null = indeterminate)
 *   - status:  'running' | 'done' | 'cancelled' | 'error'
 *   - controller: AbortController (so the UI can offer Cancel)
 *
 * Cancellation goes through standard AbortController so existing
 * `fetch` calls + custom poll loops (FEA solvers) can use the same
 * signal. Bus consumers only need the abort() handle.
 */

let _seq = 1;
const _ops = new Map();          // id → op record
const _listeners = new Set();

function _notify(op) {
  for (const fn of _listeners) {
    try { fn({ ...op, ops: list() }); } catch (e) { console.error('[forge.progress]', e); }
  }
}

export function list() {
  return [..._ops.values()];
}

export function get(id) {
  return _ops.get(id) || null;
}

export function start({ kind = 'op', msg = '', pct = null } = {}) {
  const id = `op-${_seq++}-${Date.now().toString(36)}`;
  const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const op = { id, kind, msg, pct, status: 'running', startedAt: Date.now(), controller };
  _ops.set(id, op);
  _notify(op);
  return op;
}

export function update(id, { pct, msg } = {}) {
  const op = _ops.get(id);
  if (!op) return;
  if (pct !== undefined) op.pct = pct;
  if (msg !== undefined) op.msg = msg;
  _notify(op);
}

export function done(id, { msg } = {}) {
  const op = _ops.get(id);
  if (!op) return;
  op.status = 'done';
  op.pct = 1;
  if (msg !== undefined) op.msg = msg;
  _notify(op);
  // GC briefly after so listeners can observe completion.
  setTimeout(() => _ops.delete(id), 250);
}

export function fail(id, error) {
  const op = _ops.get(id);
  if (!op) return;
  op.status = 'error';
  op.error = error && error.message ? error.message : String(error);
  _notify(op);
  setTimeout(() => _ops.delete(id), 800);
}

/**
 * Cancel an op: aborts its AbortController and marks the record. Honoured
 * by `runForgePrompt` (via fetch signal) and FEA solvers (via cancelToken
 * polling — see Fea.runStatic / runDynamic).
 */
export function cancel(id) {
  const op = _ops.get(id);
  if (!op) return;
  op.status = 'cancelled';
  try { op.controller?.abort(); } catch { /* noop */ }
  _notify(op);
  setTimeout(() => _ops.delete(id), 250);
}

export function onChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function clear() {
  _ops.clear();
  _listeners.clear();
  _seq = 1;
}

/**
 * Wrap an async fn so its lifecycle is reported automatically.
 * Returns the fn's result; throws on cancel or error.
 *
 *   await track({ kind: 'export', msg: 'STEP' }, async ({ id, signal }) => {
 *     ... use signal in fetch ...
 *   });
 */
export async function track(meta, fn) {
  const op = start(meta);
  try {
    const out = await fn({ id: op.id, signal: op.controller?.signal,
                            update: (patch) => update(op.id, patch) });
    done(op.id);
    return out;
  } catch (e) {
    if (e && (e.name === 'AbortError' || op.status === 'cancelled')) {
      cancel(op.id);
    } else {
      fail(op.id, e);
    }
    throw e;
  }
}

export default { start, update, done, fail, cancel, onChange, list, get, clear, track };
