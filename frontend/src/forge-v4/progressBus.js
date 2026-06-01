// Forge-114 — progress bus for long-running jobs.
//
// A tiny event-bus singleton that lets ANY dispatch module register a
// running job, push pct/eta updates, and finish/cancel it. The UI strip
// listens to the broadcast events on `window` — no shared React context
// required, so this module is safe to import from anywhere (renderer
// code, panels, headless tests).
//
// Event shape, fired on window via `forge:progress`:
//
//   { kind: 'start',  job }                 — full job descriptor
//   { kind: 'update', id, patch }           — partial { current, pct, eta_s, message }
//   { kind: 'finish', id, result }          — job finished naturally
//   { kind: 'cancel', id }                  — user cancelled via X button
//
// Each `job` carries:
//
//   {
//     id:        string                — unique per-run id
//     label:    string                  — what shows on the row
//     total:    number | null           — total steps if known (for pct fallback)
//     current:  number                  — last reported current
//     pct:      number                  — last reported % (0..100)
//     eta_s:    number | null           — last reported ETA, seconds
//     message:  string                  — last status message
//     startedAt: number                 — performance.now() at start
//     finishedAt: number | null         — performance.now() at finish, or null
//     status:   'running'|'done'|'cancelled'|'error'
//     onCancel: (() => void) | null     — callback wired by the dispatcher
//   }
//
// IMPORTANT: every public function tolerates being called in a non-DOM
// (Node test) environment — `window` may be undefined; in that case we
// simply skip the broadcast and keep the Map registry coherent.

const _jobs = new Map();

function _now() {
  return (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
}

function _broadcast(detail) {
  if (typeof window === 'undefined' || !window.dispatchEvent) return;
  try {
    window.dispatchEvent(new CustomEvent('forge:progress', { detail }));
  } catch {
    /* CustomEvent might be unavailable in stripped runtimes — ignore. */
  }
}

/**
 * Register a new job. Returns the stored job object.
 * Callers may mutate the job ONLY through updateJob / finishJob.
 *
 * @param {object}   args
 * @param {string}   [args.id]        — auto-generated if not supplied
 * @param {string}   args.label
 * @param {number}   [args.total]
 * @param {function} [args.onCancel]
 * @returns {object} the job descriptor
 */
export function startJob({ id, label, total = null, onCancel = null } = {}) {
  const jobId = id || `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (_jobs.has(jobId)) {
    // Idempotent re-start: treat as a fresh job (caller probably retried).
    _jobs.delete(jobId);
  }
  const job = {
    id: jobId,
    label: String(label || 'Working…'),
    total: (typeof total === 'number' && total > 0) ? total : null,
    current: 0,
    pct: 0,
    eta_s: null,
    message: '',
    startedAt: _now(),
    finishedAt: null,
    status: 'running',
    onCancel: typeof onCancel === 'function' ? onCancel : null,
  };
  _jobs.set(jobId, job);
  _broadcast({ kind: 'start', job: { ..._sanitize(job) } });
  return job;
}

/**
 * Push an update for an existing job. Silently no-ops if the job has
 * already finished or was never registered.
 *
 * @param {string} id
 * @param {object} patch — { current?, pct?, eta_s?, message? }
 */
export function updateJob(id, patch = {}) {
  const job = _jobs.get(id);
  if (!job || job.status !== 'running') return;
  if (typeof patch.current === 'number') job.current = patch.current;
  if (typeof patch.pct === 'number') {
    job.pct = Math.max(0, Math.min(100, patch.pct));
  } else if (job.total && typeof patch.current === 'number') {
    job.pct = Math.max(0, Math.min(100, (patch.current / job.total) * 100));
  }
  if (typeof patch.eta_s === 'number') job.eta_s = patch.eta_s;
  if (typeof patch.message === 'string') job.message = patch.message;
  _broadcast({
    kind: 'update',
    id,
    patch: {
      current: job.current,
      pct: job.pct,
      eta_s: job.eta_s,
      message: job.message,
    },
  });
}

/**
 * Mark a job finished. Result is opaque payload the dispatcher returned.
 * Job stays in the registry for ~2 s so the UI can animate the row out;
 * a separate timer purges it.
 *
 * @param {string} id
 * @param {object} [opts]
 * @param {*}      [opts.result]
 */
export function finishJob(id, { result = null } = {}) {
  const job = _jobs.get(id);
  if (!job) return;
  if (job.status === 'running') {
    job.status = 'done';
    job.finishedAt = _now();
    if (job.pct < 100) job.pct = 100;
  }
  _broadcast({ kind: 'finish', id, result });
  _scheduleSweep(id);
}

/**
 * User-initiated cancellation. Calls the dispatcher-supplied onCancel
 * (AbortController.abort, kernel.cancelJob, etc) BEFORE broadcasting,
 * so the dispatcher has a chance to abort the underlying op first.
 *
 * @param {string} id
 */
export function cancelJob(id) {
  const job = _jobs.get(id);
  if (!job) return;
  if (job.status === 'running') {
    try { if (job.onCancel) job.onCancel(); } catch { /* swallow */ }
    job.status = 'cancelled';
    job.finishedAt = _now();
  }
  _broadcast({ kind: 'cancel', id });
  _scheduleSweep(id);
}

/** Snapshot of every currently-known job (running + recently-finished). */
export function listJobs() {
  return Array.from(_jobs.values()).map(_sanitize);
}

/** Lookup. */
export function getJob(id) {
  const job = _jobs.get(id);
  return job ? _sanitize(job) : null;
}

/** Test-only: wipe the registry. */
export function __resetForTests() {
  _jobs.clear();
}

// ───────────────────────────────── internals

function _sanitize(job) {
  // Strip the onCancel callback so the UI never accidentally serialises
  // a closure or invokes the wrong cleanup path.
  const { onCancel, ...rest } = job;
  return rest;
}

const SWEEP_MS = 2000;
function _scheduleSweep(id) {
  if (typeof setTimeout !== 'function') return;
  setTimeout(() => {
    const job = _jobs.get(id);
    if (job && job.status !== 'running') {
      _jobs.delete(id);
    }
  }, SWEEP_MS + 50); // tiny buffer so the UI's own 2 s animation finishes
}

export default {
  startJob, updateJob, finishJob, cancelJob, listJobs, getJob,
  __resetForTests,
};
