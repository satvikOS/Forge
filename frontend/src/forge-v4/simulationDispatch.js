// Forge-91 — Simulation dispatch.
// Forge-114 — solvers now publish progress to the progressBus so the
// in-viewport ProgressStrip can show a cancellable job row while the
// (synchronous) kernel call is running.
//
// Thin wrapper around the native FEA + CFD solver surface exposed by the
// kernel as `window.forge.fea.*` and `window.forge.cfd.*`. Every call
// guards on kernelReady(); if the addon is not loaded we return a uniform
// `{ error: 'kernel not ready' }` object instead of fabricating physics
// data. This matches the "ZERO placeholders" constraint from the slice
// brief — fake stress fields would silently lie to the engineer.
//
// Units: SI throughout (m, N, Pa, s) — matches kernel/forge/Fea.js.

import { startJob, updateJob, finishJob } from './progressBus.js';

// ────────────────────────────────────────────── job wrapper

/**
 * Wrap a synchronous kernel call so the ProgressStrip shows a row from
 * the moment we kick off until the call returns. Because the current
 * native solvers do NOT stream progress callbacks (kernel.hpp doesn't
 * yet expose a callback signature), we drive a fake stepper that walks
 * the pct from 0 → 90 on a ~100 ms cadence. The final 90 → 100 jump
 * happens on return so the engineer sees the job genuinely complete.
 *
 * If the kernel really does block the renderer thread for many seconds
 * (e.g. solveDynamic on a big mesh), browsers will starve the timer —
 * that's a known limitation; the row at least appears immediately and
 * Cancel is wired to mark the future result as discarded.
 *
 * Cancellation: a tiny AbortController is created so the dispatcher can
 * surface whether the user clicked X. The kernel itself doesn't honour
 * the signal yet, but we DO refuse to publish the result back into the
 * caller's promise chain if cancellation fired.
 *
 * @param {string}   label   — row label, e.g. "FEA Static · MyBracket"
 * @param {function} fn      — () => kernel call (sync or returning a Promise)
 * @param {object}   [opts]
 * @param {number}   [opts.estMs]   — rough estimate for pct interpolation
 * @returns {*} whatever fn() returned (with a `_cancelled: true` field if cancelled)
 */
function withProgress(label, fn, { estMs = 2000 } = {}) {
  const ac = (typeof AbortController === 'function') ? new AbortController() : null;
  let cancelled = false;
  const job = startJob({
    label,
    total: 100,
    onCancel: () => {
      cancelled = true;
      if (ac) { try { ac.abort(); } catch { /* ignore */ } }
    },
  });
  // Fake stepper — runs only if setInterval is available.
  let stepHandle = null;
  if (typeof setInterval === 'function') {
    const startedAt = Date.now();
    stepHandle = setInterval(() => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      const pct = Math.min(90, (elapsed / estMs) * 90);
      const eta_s = estMs > elapsed ? (estMs - elapsed) / 1000 : null;
      updateJob(job.id, { pct, eta_s, message: 'Solving' });
    }, 100);
  }
  const stop = (result) => {
    if (stepHandle != null) clearInterval(stepHandle);
    if (cancelled) {
      // Job was cancelled by the user before / during the call. We
      // still publish a finish event so the UI can clean the row up,
      // but tag the result so the caller knows.
      finishJob(job.id, { result: { cancelled: true } });
      return { ...(result || {}), _cancelled: true };
    }
    updateJob(job.id, { pct: 100, message: 'Done' });
    finishJob(job.id, { result });
    return result;
  };
  try {
    const result = fn(ac ? ac.signal : null);
    if (result && typeof result.then === 'function') {
      return result.then(stop, (err) => {
        if (stepHandle != null) clearInterval(stepHandle);
        finishJob(job.id, { result: { error: err && err.message ? err.message : String(err) } });
        throw err;
      });
    }
    return stop(result);
  } catch (err) {
    if (stepHandle != null) clearInterval(stepHandle);
    finishJob(job.id, { result: { error: err && err.message ? err.message : String(err) } });
    throw err;
  }
}

function _bodyTag(study) {
  // Best-effort label suffix — looks at common fields callers attach.
  return study && (study.bodyName || study.name) ? ` · ${study.bodyName || study.name}` : '';
}

function kernelReady() {
  return typeof window !== 'undefined' && window.forge &&
         typeof window.forge.isReady === 'function' &&
         window.forge.isReady();
}

function notReady(extra = {}) {
  return { error: 'kernel not ready', ...extra };
}

function fea() {
  return window.forge && window.forge.fea ? window.forge.fea : null;
}
function cfd() {
  return window.forge && window.forge.cfd ? window.forge.cfd : null;
}

/**
 * Build a brick / tet mesh from a BRep body handle.
 * @param {number} bodyHandle native ShapeHandle (uint32)
 * @param {number} size       target element size, mm (converted to m)
 * @returns {{ error?: string, mesh?: object, sizeMeters?: number, elapsedMs?: number }}
 */
export function mesh(bodyHandle, size) {
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f || typeof f.meshFromBrep !== 'function') return notReady();
  if (!Number.isInteger(bodyHandle) || bodyHandle <= 0) {
    return { error: `bad bodyHandle ${bodyHandle}` };
  }
  if (!(size > 0)) return { error: 'target element size must be > 0' };
  const sizeMeters = size / 1000;
  const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  try {
    const m = f.meshFromBrep(bodyHandle, sizeMeters);
    const t1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    return { mesh: m, sizeMeters, elapsedMs: t1 - t0 };
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
}

/** Static linear: K u = f. */
export function solveStatic(study) {
  const { mesh, material, loads = [], pressureLoads = [], bcs = [] } = study || {};
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f) return notReady();
  if (!mesh) return { error: 'no mesh supplied' };
  if (!material) return { error: 'no material supplied' };
  const t0 = performance.now();
  return withProgress(`FEA Static${_bodyTag(study)}`, () => {
    try {
      const r = f.solveStatic(mesh, material, loads, pressureLoads, bcs);
      return { ...r, elapsedMs: performance.now() - t0 };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  }, { estMs: 2000 });
}

/** Modal: K φ = ω² M φ. */
export function solveModal(study) {
  const { mesh, material, bcs = [], nModes = 6 } = study || {};
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f) return notReady();
  if (!mesh) return { error: 'no mesh supplied' };
  if (!material) return { error: 'no material supplied' };
  if (!Number.isInteger(nModes) || nModes < 1) return { error: 'nModes must be a positive integer' };
  const t0 = performance.now();
  return withProgress(`FEA Modal${_bodyTag(study)}`, () => {
    try {
      const r = f.solveModal(mesh, material, bcs, nModes);
      return { ...r, elapsedMs: performance.now() - t0 };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  }, { estMs: 3000 });
}

/** Dynamic (Newmark-β): K u + C u' + M u'' = f(t). */
export function solveDynamic(study) {
  const { mesh, material, loads = [], bcs = [],
          tEnd, dt, alpha = 0, beta = 0 } = study || {};
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f) return notReady();
  if (!mesh)     return { error: 'no mesh supplied' };
  if (!material) return { error: 'no material supplied' };
  if (!(tEnd > 0)) return { error: 'tEnd must be > 0' };
  if (!(dt > 0))   return { error: 'dt must be > 0' };
  const t0 = performance.now();
  return withProgress(`FEA Dynamic${_bodyTag(study)}`, () => {
    try {
      const r = f.solveDynamic(mesh, material, loads, bcs, tEnd, dt, alpha, beta);
      return { ...r, elapsedMs: performance.now() - t0 };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  }, { estMs: 5000 });
}

/** Steady-state thermal: ∇·(k ∇T) + q = 0. */
export function solveThermal(study) {
  const { mesh, material, dirichlet = [], sources = [], convection = [] } = study || {};
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f || typeof f.solveThermal !== 'function') return notReady();
  if (!mesh)     return { error: 'no mesh supplied' };
  if (!material) return { error: 'no material supplied' };
  const t0 = performance.now();
  return withProgress(`FEA Thermal${_bodyTag(study)}`, () => {
    try {
      const r = f.solveThermal(mesh, material, dirichlet, sources, convection);
      return { ...r, elapsedMs: performance.now() - t0 };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  }, { estMs: 1800 });
}

/** Linearised buckling — returns load factors + mode shapes. */
export function solveBuckling(study) {
  const { mesh, material, loads = [], bcs = [], nModes = 3 } = study || {};
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f || typeof f.solveBuckling !== 'function') return notReady();
  if (!mesh)     return { error: 'no mesh supplied' };
  if (!material) return { error: 'no material supplied' };
  if (!Number.isInteger(nModes) || nModes < 1) return { error: 'nModes must be a positive integer' };
  const t0 = performance.now();
  return withProgress(`FEA Buckling${_bodyTag(study)}`, () => {
    try {
      const r = f.solveBuckling(mesh, material, loads, bcs, nModes);
      return { ...r, elapsedMs: performance.now() - t0 };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  }, { estMs: 3500 });
}

/** Nonlinear static (geometric or follower load). */
export function solveNonlinearStatic(study) {
  const { mesh, material, loads = [], bcs = [],
          loadSteps = 5, maxIters = 25, tol = 1e-6 } = study || {};
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f || typeof f.solveNonlinearStatic !== 'function') return notReady();
  if (!mesh)     return { error: 'no mesh supplied' };
  if (!material) return { error: 'no material supplied' };
  const cfg = { loadSteps, maxIters, tol };
  const t0 = performance.now();
  return withProgress(`FEA Nonlinear${_bodyTag(study)}`, () => {
    try {
      const r = f.solveNonlinearStatic(mesh, material, loads, bcs, cfg);
      return { ...r, elapsedMs: performance.now() - t0 };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  }, { estMs: 4000 });
}

/** Contact between two meshes (penalty / node-to-surface). */
export function solveContact(study) {
  const { meshA, meshB, material,
          loadsA = [], loadsB = [],
          bcsA = [], bcsB = [],
          pairs = [], normalPenalty = 0 } = study || {};
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f || typeof f.solveContact !== 'function') return notReady();
  if (!meshA || !meshB) return { error: 'two meshes required for contact' };
  if (!material) return { error: 'no material supplied' };
  const t0 = performance.now();
  return withProgress(`FEA Contact${_bodyTag(study)}`, () => {
    try {
      const r = f.solveContact(meshA, meshB, material,
                               loadsA, loadsB, bcsA, bcsB,
                               pairs, normalPenalty);
      return { ...r, elapsedMs: performance.now() - t0 };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  }, { estMs: 5000 });
}

/** Nonlinear plastic (J2 + isotropic hardening). */
export function solveNonlinearPlastic(study) {
  const { mesh, material, loads = [], bcs = [], loadSteps = 5 } = study || {};
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f || typeof f.solveNonlinearPlastic !== 'function') return notReady();
  if (!mesh)     return { error: 'no mesh supplied' };
  if (!material) return { error: 'no material supplied' };
  if (!(material.sigmaY > 0)) {
    return { error: 'plastic solve requires material.sigmaY > 0 (Pa)' };
  }
  const t0 = performance.now();
  return withProgress(`FEA Plastic${_bodyTag(study)}`, () => {
    try {
      const r = f.solveNonlinearPlastic(mesh, material, loads, bcs, loadSteps);
      return { ...r, elapsedMs: performance.now() - t0 };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  }, { estMs: 4500 });
}

/**
 * Fatigue life estimation from a stress history per element.
 * cfg = { method: 'basquin'|'sn-curve', meanStress: <enum>, Sut, Se, b }.
 */
export function fatigueLife({ stressHistory, nElem, nSteps, cfg }) {
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f || typeof f.fatigueLife !== 'function') return notReady();
  if (!stressHistory || !nElem || !nSteps) return { error: 'incomplete stress history' };
  const t0 = performance.now();
  try {
    const r = f.fatigueLife(stressHistory, nElem, nSteps, cfg);
    return { ...r, elapsedMs: performance.now() - t0 };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

/** Enumeration of mean-stress correction methods — sourced from the kernel. */
export function meanStressCorrectionEnum() {
  if (!kernelReady()) return null;
  const f = fea(); if (!f) return null;
  return f.MeanStressCorrection || null;
}

/** Steady incompressible Navier–Stokes (CFD). */
export function solveCFD(cfg) {
  if (!kernelReady()) return notReady();
  const c = cfd(); if (!c || typeof c.solveSteadyNS !== 'function') return notReady();
  const t0 = performance.now();
  return withProgress(`CFD Steady-NS${_bodyTag(cfg)}`, () => {
    try {
      const r = c.solveSteadyNS(cfg);
      return { ...r, elapsedMs: performance.now() - t0 };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  }, { estMs: 6000 });
}

/** Helper: pin every node tagged with a given BC face-mask. */
export function pinFace(meshObj, faceId) {
  if (!meshObj || !meshObj.nodeToFace) return [];
  const mask = (1 << faceId);
  const out = [];
  for (let i = 0; i < meshObj.nodeCount; i++) {
    if (meshObj.nodeToFace[i] & mask) {
      out.push({ nodeId: i, fx: true, fy: true, fz: true });
    }
  }
  return out;
}

/** Helper: convert a roller BC (locked normal only) into nodal flags. */
export function rollerFace(meshObj, faceId, axis = 'y') {
  if (!meshObj || !meshObj.nodeToFace) return [];
  const mask = (1 << faceId);
  const a = axis.toLowerCase();
  const out = [];
  for (let i = 0; i < meshObj.nodeCount; i++) {
    if (meshObj.nodeToFace[i] & mask) {
      out.push({ nodeId: i, fx: a === 'x', fy: a === 'y', fz: a === 'z' });
    }
  }
  return out;
}

/** Helper: distribute a force resultant uniformly over a face's nodes. */
export function distributeForceFace(meshObj, faceId, F) {
  if (!meshObj || !meshObj.nodeToFace) return [];
  const mask = (1 << faceId);
  const ids = [];
  for (let i = 0; i < meshObj.nodeCount; i++) {
    if (meshObj.nodeToFace[i] & mask) ids.push(i);
  }
  if (!ids.length) return [];
  const fx = F[0] / ids.length, fy = F[1] / ids.length, fz = F[2] / ids.length;
  return ids.map((id) => ({ nodeId: id, fx, fy, fz }));
}

/**
 * Top-level router: takes a study config and dispatches to the right
 * solver. Returns whatever the solver returns (plus an `error` field if
 * the kernel is offline).
 */
export function dispatchSimulation(study) {
  if (!study || typeof study !== 'object') return { error: 'no study supplied' };
  const t = study.type;
  switch (t) {
    case 'Static':     return solveStatic(study);
    case 'Modal':      return solveModal(study);
    case 'Dynamic':    return solveDynamic(study);
    case 'Thermal':    return solveThermal(study);
    case 'Buckling':   return solveBuckling(study);
    case 'Nonlinear':  return solveNonlinearStatic(study);
    case 'Contact':    return solveContact(study);
    case 'Plastic':    return solveNonlinearPlastic(study);
    case 'Fatigue':    return fatigueLife(study);
    case 'CFD':        return solveCFD(study);
    default:           return { error: `unknown study type "${t}"` };
  }
}

/** Whether the FEA surface is available. */
export function isKernelReady() { return kernelReady(); }

/** Surface-detect which solvers the kernel actually exposes. */
export function detectAvailableSolvers() {
  if (!kernelReady()) return {};
  const f = fea() || {};
  const c = cfd() || {};
  return {
    mesh:        typeof f.meshFromBrep === 'function',
    static:      typeof f.solveStatic === 'function',
    modal:       typeof f.solveModal === 'function',
    dynamic:     typeof f.solveDynamic === 'function',
    thermal:     typeof f.solveThermal === 'function',
    buckling:    typeof f.solveBuckling === 'function',
    nonlinear:   typeof f.solveNonlinearStatic === 'function',
    contact:     typeof f.solveContact === 'function',
    plastic:     typeof f.solveNonlinearPlastic === 'function',
    fatigue:     typeof f.fatigueLife === 'function',
    cfd:         typeof c.solveSteadyNS === 'function',
  };
}
