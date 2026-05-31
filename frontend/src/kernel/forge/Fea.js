/**
 * ArchDisc Forge — FEA (Forge-12)
 *
 * Thin facade over the native `forge.fea` solver surface. The kernel does
 * the heavy lifting (assembly, factorisation, eigensolve, Newmark step
 * loop); this module is the API the renderer / scripts / e2e tests reach
 * for. There is no React UI in this slice — only a callable surface,
 * matching the pattern set by Drawings.js / Assembly.js / Sketcher.js.
 *
 * Honest scope note (mirrors Fea.hpp): the kernel ships with an axis-
 * aligned hex-grid mesher that clips against the BRep solid; the API
 * surface is shaped so the upcoming Delaunay tetrahedraliser can swap in
 * without breaking any caller.
 *
 * Units: SI. Lengths in metres, forces in newtons, pressures in pascals,
 * times in seconds, frequencies in Hz, eigenvalues in rad²/s².
 */

import { getForge } from './index.js';

// Allow Node smoke runners (no Electron preload) to inject a kernel.
let _kernelOverride = null;
export function _setForgeKernel(kernel) { _kernelOverride = kernel; }
function _kernel() {
  return _kernelOverride || getForge();
}

// ---------------------------------------------------------- defaults
//
// Library of common engineering materials. Values in SI.
// Source: Roark's / standard handbook tables, isotropic small-strain.
export const FORGE_MATERIALS = Object.freeze({
  STEEL_A36:        { E: 200e9, nu: 0.26, rho: 7850, name: 'Steel A36'        },
  STEEL_AISI_1018:  { E: 205e9, nu: 0.29, rho: 7870, name: 'Steel AISI 1018'  },
  STEEL_STRUCT:     { E: 210e9, nu: 0.30, rho: 7850, name: 'Steel (generic)'  },
  ALUMINIUM_6061:   { E:  68.9e9, nu: 0.33, rho: 2700, name: 'Aluminium 6061' },
  ALUMINIUM_7075:   { E:  71.7e9, nu: 0.33, rho: 2810, name: 'Aluminium 7075' },
  TITANIUM_TI6AL4V: { E: 113.8e9, nu: 0.342, rho: 4430, name: 'Titanium Ti-6Al-4V' },
  COPPER_C110:      { E: 117e9, nu: 0.33, rho: 8940, name: 'Copper C110'      },
  ABS_PLASTIC:      { E:   2.3e9, nu: 0.35, rho: 1050, name: 'ABS Plastic'    },
});

// AABB face id constants (used for pinning by face / pressure BCs).
export const FACE_NEG_X = 0;
export const FACE_POS_X = 1;
export const FACE_NEG_Y = 2;
export const FACE_POS_Y = 3;
export const FACE_NEG_Z = 4;
export const FACE_POS_Z = 5;

/**
 * Validate a material object — throws a descriptive Error if any of E, nu,
 * rho is missing or non-positive. Acceptable nu range: (−1, 0.5).
 */
/**
 * Cancellation: callers may pass `cancelToken` — either an AbortSignal or
 * an object with `.aborted` — to abort long FEA runs. We poll between
 * Newmark iterations and throw a DOMException-compatible 'AbortError'
 * that the ProgressBus + UI overlay treat as a clean cancellation.
 */
export class ForgeAbortError extends Error {
  constructor(msg = 'Operation aborted') {
    super(msg);
    this.name = 'AbortError';
  }
}

function checkCancel(token) {
  if (!token) return;
  const aborted = (typeof token.aborted === 'boolean') ? token.aborted
                : (token.signal && token.signal.aborted);
  if (aborted) throw new ForgeAbortError();
}

function validateMaterial(mat) {
  if (!mat || typeof mat !== 'object') {
    throw new Error('[forge.fea] material must be an object {E, nu, rho}');
  }
  if (!(mat.E > 0))   throw new Error(`[forge.fea] material.E must be > 0 (got ${mat.E})`);
  if (!(mat.rho > 0)) throw new Error(`[forge.fea] material.rho must be > 0 (got ${mat.rho})`);
  if (!(mat.nu > -1 && mat.nu < 0.5)) {
    throw new Error(`[forge.fea] material.nu must be in (-1, 0.5) (got ${mat.nu})`);
  }
}

/**
 * Main class — wraps the native FEA surface with ergonomic helpers.
 *
 * Typical lifecycle:
 *   const fea = new ForgeFEA();
 *   const mesh = fea.meshFromShape(shape, 0.005);
 *   const result = fea.runStatic({ material, mesh, loads, bcs });
 */
export class ForgeFEA {
  constructor(kernel = null) {
    this._kernel = kernel; // optional override; otherwise resolved on first call
  }
  _k() { return this._kernel || _kernel(); }

  /**
   * Build a brick-grid hex mesh from an OCCT shape handle.
   * @param {number} shapeHandle  — native ShapeHandle (uint32)
   * @param {number} targetElemSize — desired voxel edge length (m)
   * @returns {object} { nodes, tets, nodeToFace, elemNodeCount,
   *                     nodeCount, elemCount }
   */
  meshFromShape(shapeHandle, targetElemSize) {
    if (!Number.isInteger(shapeHandle) || shapeHandle <= 0) {
      throw new Error(`[forge.fea] meshFromShape: bad handle ${shapeHandle}`);
    }
    if (!(targetElemSize > 0)) {
      throw new Error('[forge.fea] meshFromShape: targetElemSize must be > 0');
    }
    return this._k().fea.meshFromBrep(shapeHandle, targetElemSize);
  }

  /**
   * Linear static solve: K u = f. Returns { u (Float64Array), vonMises
   * (Float64Array), maxVonMises, maxAtElem, residual }.
   *
   * @param {object} cfg
   * @param {object} cfg.material — { E, nu, rho }
   * @param {object} cfg.mesh     — from meshFromShape()
   * @param {Array}  cfg.loads    — [{ nodeId, fx, fy, fz }]
   * @param {Array}  [cfg.pressureLoads] — [{ faceId, pressure }]
   * @param {Array}  cfg.bcs      — [{ nodeId, fx, fy, fz }]
   */
  runStatic({ material, mesh, loads = [], pressureLoads = [], bcs = [], cancelToken = null }) {
    validateMaterial(material);
    checkCancel(cancelToken);
    // The native solveStatic is one shot, so we honour cancellation by
    // checking the token before invoking + once again on return. Forge-29
    // will switch the native side to chunked iteration so we can poll
    // mid-solve too.
    const result = this._k().fea.solveStatic(mesh, material, loads, pressureLoads, bcs);
    checkCancel(cancelToken);
    return result;
  }

  /**
   * Modal solve: K φ = ω² M φ. Returns { eigenvalues (Float64Array of ω²),
   * eigenvectors (Array of Float64Array), nModes }.
   */
  runModal({ material, mesh, bcs = [], modes = 3 }) {
    validateMaterial(material);
    if (!Number.isInteger(modes) || modes < 1) {
      throw new Error('[forge.fea] runModal: modes must be a positive integer');
    }
    return this._k().fea.solveModal(mesh, material, bcs, modes);
  }

  /**
   * Dynamic solve via Newmark-β (β=1/4, γ=1/2). Returns { displacements
   * (Array of Float64Array, one per time step including t=0), times
   * (Float64Array), maxStressEnvelope (Float64Array), cpuMs, stepCount }.
   *
   * @param {object} cfg
   * @param {object} cfg.material
   * @param {object} cfg.mesh
   * @param {Array}  cfg.loads
   * @param {Array}  cfg.bcs
   * @param {number} cfg.tEnd  — total simulation time (s)
   * @param {number} cfg.dt    — time step (s)
   * @param {number} [cfg.alpha=0] — Rayleigh damping α (mass-proportional)
   * @param {number} [cfg.beta=0]  — Rayleigh damping β (stiffness-proportional)
   */
  runDynamic({ material, mesh, loads = [], bcs = [], tEnd, dt,
               alpha = 0, beta = 0, cancelToken = null, onProgress = null }) {
    validateMaterial(material);
    if (!(tEnd > 0)) throw new Error('[forge.fea] runDynamic: tEnd must be > 0');
    if (!(dt > 0))   throw new Error('[forge.fea] runDynamic: dt must be > 0');
    if (dt > tEnd / 2) {
      console.warn(`[forge.fea] runDynamic: dt=${dt} is large relative to tEnd=${tEnd}; ` +
                   `accuracy may suffer.`);
    }
    checkCancel(cancelToken);
    // If the kernel exposes a per-step variant we honour cancellation
    // between iterations; otherwise we wrap the single-shot call.
    const k = this._k().fea;
    if (typeof k.solveDynamicStep === 'function' && cancelToken) {
      const ctx = k.solveDynamicBegin(mesh, material, loads, bcs, tEnd, dt, alpha, beta);
      const steps = Math.ceil(tEnd / dt);
      for (let i = 0; i < steps; i++) {
        checkCancel(cancelToken);
        k.solveDynamicStep(ctx);
        if (onProgress) onProgress((i + 1) / steps);
      }
      return k.solveDynamicEnd(ctx);
    }
    const out = k.solveDynamic(mesh, material, loads, bcs, tEnd, dt, alpha, beta);
    checkCancel(cancelToken);
    return out;
  }

  /**
   * Linearised buckling (Forge-31). Returns
   *   { loadFactors: Float64Array,
   *     modes: Array<Float64Array>,
   *     firstCriticalLoad,
   *     nModes, cpuMs }
   * where loadFactors[0] is the smallest critical load multiplier and
   * firstCriticalLoad = loadFactors[0] × Σ‖preload‖.
   *
   * The `loads` array is the *axial pre-load* — its magnitude scales the
   * eigenvalue; its direction sets the sign convention (compressive load
   * is what produces positive eigenvalues / a real buckling response).
   */
  runBuckling({ material, mesh, loads = [], bcs = [], modes = 3 }) {
    validateMaterial(material);
    if (!Number.isInteger(modes) || modes < 1) {
      throw new Error('[forge.fea] runBuckling: modes must be a positive integer');
    }
    const k = this._k().fea;
    if (typeof k.solveBuckling !== 'function') {
      throw new Error('[forge.fea] runBuckling: native solveBuckling not present (rebuild kernel)');
    }
    return k.solveBuckling(mesh, material, loads, bcs, modes);
  }

  /**
   * Penalty-method node-to-surface contact between two brick meshes
   * (Forge-31). Returns
   *   { uA: Float64Array, uB: Float64Array,
   *     contactPressure: Float64Array,
   *     iterations, penaltyUsed, converged, cpuMs }
   * Each entry of `contactPairs` is `{ nodeA, faceB }`. `normalPenalty` may
   * be 0 → auto-scaled from diag(K).
   */
  runContact({ material, meshA, meshB,
               loadsA = [], loadsB = [],
               bcsA = [], bcsB = [],
               contactPairs = [], normalPenalty = 0 }) {
    validateMaterial(material);
    const k = this._k().fea;
    if (typeof k.solveContact !== 'function') {
      throw new Error('[forge.fea] runContact: native solveContact not present (rebuild kernel)');
    }
    return k.solveContact(meshA, meshB, material,
                          loadsA, loadsB, bcsA, bcsB,
                          contactPairs, normalPenalty);
  }

  /**
   * Material-nonlinear Newton solve with J2 plasticity + linear isotropic
   * hardening (Forge-31). `material` is `{ E, nu, rho, sigmaY, hardening }`
   * — the hardening modulus `H` is in Pa.
   * Returns
   *   { stepDisplacements: Array<Float64Array>,
   *     stepPlasticStrain: Array<Float64Array>,
   *     stepStress: Array<Float64Array>,
   *     stepIterations, stepResiduals, converged, cpuMs }.
   */
  runNonlinearPlastic({ material, mesh, loads = [], bcs = [], loadSteps = 5 }) {
    if (!material || typeof material !== 'object') {
      throw new Error('[forge.fea] runNonlinearPlastic: material must be an object');
    }
    if (!(material.E > 0))     throw new Error('[forge.fea] runNonlinearPlastic: material.E > 0');
    if (!(material.sigmaY > 0))throw new Error('[forge.fea] runNonlinearPlastic: material.sigmaY > 0');
    if (!Number.isInteger(loadSteps) || loadSteps < 1) {
      throw new Error('[forge.fea] runNonlinearPlastic: loadSteps must be a positive integer');
    }
    const k = this._k().fea;
    if (typeof k.solveNonlinearPlastic !== 'function') {
      throw new Error('[forge.fea] runNonlinearPlastic: native solveNonlinearPlastic not present (rebuild kernel)');
    }
    return k.solveNonlinearPlastic(mesh, material, loads, bcs, loadSteps);
  }

  // ----- helpers ------------------------------------------------------

  /**
   * Find every node whose AABB-face bitmask includes `faceId` (0..5).
   * Useful for pinning a whole face or applying a per-node load to the
   * tip of a cantilever beam.
   */
  static findFaceNodes(mesh, faceId) {
    const out = [];
    const mask = (1 << faceId);
    for (let i = 0; i < mesh.nodeCount; i++) {
      if (mesh.nodeToFace[i] & mask) out.push(i);
    }
    return out;
  }

  /**
   * Build a list of pinned-BC entries pinning all 3 translational DOFs of
   * the given node ids. The returned shape is ready to feed runStatic /
   * runModal / runDynamic.
   */
  static pinNodes(nodeIds) {
    return nodeIds.map((id) => ({ nodeId: id, fx: true, fy: true, fz: true }));
  }

  /**
   * Distribute a single resultant force evenly across the given node ids.
   * Returns the LoadNodal[] suitable for the runXxx APIs.
   */
  static distributeForce(nodeIds, fx, fy, fz) {
    if (!nodeIds.length) return [];
    const n = nodeIds.length;
    return nodeIds.map((id) => ({ nodeId: id, fx: fx/n, fy: fy/n, fz: fz/n }));
  }

  /**
   * Return the 3-vector displacement (ux, uy, uz) at the given node id
   * from a static or dynamic-step `u` array. Works on the flat Float64Array
   * shape returned by every solver.
   */
  static nodalDisplacement(uFlat, nodeId) {
    const base = 3 * nodeId;
    return [uFlat[base], uFlat[base + 1], uFlat[base + 2]];
  }

  /**
   * Convenience: extract one component of one node from a static result.
   * `result` may be either the StaticResult shape (with `.u`) or a raw
   * displacement Float64Array. `axis` is 'x'|'y'|'z' or 0|1|2.
   */
  static tipDeflection(result, atNode, axis = 'y') {
    const u = result && result.u ? result.u : result;
    const idx = typeof axis === 'string'
      ? { x: 0, y: 1, z: 2 }[axis.toLowerCase()]
      : axis | 0;
    return u[3 * atNode + idx];
  }
}

/**
 * Convert an angular eigenvalue (ω², rad²/s²) to a natural frequency in
 * Hz. Negative numerical noise is clamped to 0.
 */
export function omega2ToHz(w2) {
  return Math.sqrt(Math.max(0, w2)) / (2 * Math.PI);
}

/**
 * Compute the first natural frequency of a clamped-free cantilever beam
 * using Euler-Bernoulli theory: f₁ = (1.875²/(2π L²)) √(EI/(ρA)).
 * Helper for design-side comparison / validation.
 */
export function cantileverFirstFreq({ L, E, I, rho, A }) {
  const lambda1 = 1.875;
  return (lambda1 * lambda1) / (2 * Math.PI * L * L)
       * Math.sqrt((E * I) / (rho * A));
}

export default {
  ForgeFEA,
  FORGE_MATERIALS,
  FACE_NEG_X, FACE_POS_X,
  FACE_NEG_Y, FACE_POS_Y,
  FACE_NEG_Z, FACE_POS_Z,
  omega2ToHz,
  cantileverFirstFreq,
};
