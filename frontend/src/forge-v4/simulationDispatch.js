// Forge-91 — Simulation dispatch.
//
// Thin wrapper around the native FEA + CFD solver surface exposed by the
// kernel as `window.forge.fea.*` and `window.forge.cfd.*`. Every call
// guards on kernelReady(); if the addon is not loaded we return a uniform
// `{ error: 'kernel not ready' }` object instead of fabricating physics
// data. This matches the "ZERO placeholders" constraint from the slice
// brief — fake stress fields would silently lie to the engineer.
//
// Units: SI throughout (m, N, Pa, s) — matches kernel/forge/Fea.js.

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
export function solveStatic({ mesh, material, loads = [], pressureLoads = [], bcs = [] }) {
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f) return notReady();
  if (!mesh) return { error: 'no mesh supplied' };
  if (!material) return { error: 'no material supplied' };
  const t0 = performance.now();
  try {
    const r = f.solveStatic(mesh, material, loads, pressureLoads, bcs);
    return { ...r, elapsedMs: performance.now() - t0 };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

/** Modal: K φ = ω² M φ. */
export function solveModal({ mesh, material, bcs = [], nModes = 6 }) {
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f) return notReady();
  if (!mesh) return { error: 'no mesh supplied' };
  if (!material) return { error: 'no material supplied' };
  if (!Number.isInteger(nModes) || nModes < 1) return { error: 'nModes must be a positive integer' };
  const t0 = performance.now();
  try {
    const r = f.solveModal(mesh, material, bcs, nModes);
    return { ...r, elapsedMs: performance.now() - t0 };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

/** Dynamic (Newmark-β): K u + C u' + M u'' = f(t). */
export function solveDynamic({ mesh, material, loads = [], bcs = [],
                               tEnd, dt, alpha = 0, beta = 0 }) {
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f) return notReady();
  if (!mesh)     return { error: 'no mesh supplied' };
  if (!material) return { error: 'no material supplied' };
  if (!(tEnd > 0)) return { error: 'tEnd must be > 0' };
  if (!(dt > 0))   return { error: 'dt must be > 0' };
  const t0 = performance.now();
  try {
    const r = f.solveDynamic(mesh, material, loads, bcs, tEnd, dt, alpha, beta);
    return { ...r, elapsedMs: performance.now() - t0 };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

/** Steady-state thermal: ∇·(k ∇T) + q = 0. */
export function solveThermal({ mesh, material, dirichlet = [], sources = [], convection = [] }) {
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f || typeof f.solveThermal !== 'function') return notReady();
  if (!mesh)     return { error: 'no mesh supplied' };
  if (!material) return { error: 'no material supplied' };
  const t0 = performance.now();
  try {
    const r = f.solveThermal(mesh, material, dirichlet, sources, convection);
    return { ...r, elapsedMs: performance.now() - t0 };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

/** Linearised buckling — returns load factors + mode shapes. */
export function solveBuckling({ mesh, material, loads = [], bcs = [], nModes = 3 }) {
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f || typeof f.solveBuckling !== 'function') return notReady();
  if (!mesh)     return { error: 'no mesh supplied' };
  if (!material) return { error: 'no material supplied' };
  if (!Number.isInteger(nModes) || nModes < 1) return { error: 'nModes must be a positive integer' };
  const t0 = performance.now();
  try {
    const r = f.solveBuckling(mesh, material, loads, bcs, nModes);
    return { ...r, elapsedMs: performance.now() - t0 };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

/** Nonlinear static (geometric or follower load). */
export function solveNonlinearStatic({ mesh, material, loads = [], bcs = [],
                                       loadSteps = 5, maxIters = 25, tol = 1e-6 }) {
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f || typeof f.solveNonlinearStatic !== 'function') return notReady();
  if (!mesh)     return { error: 'no mesh supplied' };
  if (!material) return { error: 'no material supplied' };
  const cfg = { loadSteps, maxIters, tol };
  const t0 = performance.now();
  try {
    const r = f.solveNonlinearStatic(mesh, material, loads, bcs, cfg);
    return { ...r, elapsedMs: performance.now() - t0 };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

/** Contact between two meshes (penalty / node-to-surface). */
export function solveContact({ meshA, meshB, material,
                               loadsA = [], loadsB = [],
                               bcsA = [], bcsB = [],
                               pairs = [], normalPenalty = 0 }) {
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f || typeof f.solveContact !== 'function') return notReady();
  if (!meshA || !meshB) return { error: 'two meshes required for contact' };
  if (!material) return { error: 'no material supplied' };
  const t0 = performance.now();
  try {
    const r = f.solveContact(meshA, meshB, material,
                             loadsA, loadsB, bcsA, bcsB,
                             pairs, normalPenalty);
    return { ...r, elapsedMs: performance.now() - t0 };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

/** Nonlinear plastic (J2 + isotropic hardening). */
export function solveNonlinearPlastic({ mesh, material, loads = [], bcs = [], loadSteps = 5 }) {
  if (!kernelReady()) return notReady();
  const f = fea(); if (!f || typeof f.solveNonlinearPlastic !== 'function') return notReady();
  if (!mesh)     return { error: 'no mesh supplied' };
  if (!material) return { error: 'no material supplied' };
  if (!(material.sigmaY > 0)) {
    return { error: 'plastic solve requires material.sigmaY > 0 (Pa)' };
  }
  const t0 = performance.now();
  try {
    const r = f.solveNonlinearPlastic(mesh, material, loads, bcs, loadSteps);
    return { ...r, elapsedMs: performance.now() - t0 };
  } catch (err) {
    return { error: err.message || String(err) };
  }
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
  try {
    const r = c.solveSteadyNS(cfg);
    return { ...r, elapsedMs: performance.now() - t0 };
  } catch (err) {
    return { error: err.message || String(err) };
  }
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
