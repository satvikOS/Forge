// Forge — Simulation model (task #66, SimScale→Forge CAE platform).
//
// Pure, framework-free heart of the Simulation workbench. Holds the data
// the panel + the Archie-CUA control surface + the headless gates all
// share, so the maths lives in ONE place and is unit-testable without a
// React mount or a DOM:
//
//   • MATERIALS / STUDY_TYPES / kinds / FACE_LABELS — the catalogues.
//   • defaultLoad / defaultBC                       — row factories.
//   • loadsToNodalForces / bcsToNodalConstraints    — UI rows → kernel arrays.
//   • SIM_TREE / sectionForNode                     — the SimScale left-rail
//                                                     hierarchy → DOM section.
//   • buildStudyInputs / runStudyCore               — the ONE solve path the
//                                                     panel button and the CUA
//                                                     setters both drive.
//
// No `window`, no React, no side effects beyond the kernel dispatch the
// solver calls perform (themselves guarded on kernelReady()).
//
// Units: SI throughout (m, N, Pa, s) — matches simulationDispatch.js.

import {
  solveStatic, solveModal, solveDynamic, solveThermal,
  solveBuckling, solveNonlinearStatic, solveNonlinearPlastic,
  fatigueLife as fatigueLifeDispatch, solveCFD,
  pinFace, distributeForceFace, rollerFace,
} from './simulationDispatch.js';

// ---------------------------------------------------------- catalogues
//
// Eight presets with real engineering values. E in Pa, ρ in kg/m³, σ_y
// in Pa, k thermal conductivity (W/m·K), α thermal expansion (1/K).
// Values from MMPDS / ASM Handbook / supplier datasheets.
export const MATERIALS = Object.freeze([
  { id: 'steel',     name: 'Steel A36',         E: 200e9,   nu: 0.26,  rho: 7850, sigmaY: 250e6, k: 50,    alpha: 12e-6,   color: '#8b95a5' },
  { id: 'aluminium', name: 'Aluminium 6061-T6', E:  68.9e9, nu: 0.33,  rho: 2700, sigmaY: 276e6, k: 167,   alpha: 23.6e-6, color: '#c9cfd6' },
  { id: 'brass',     name: 'Brass C26000',      E: 110e9,   nu: 0.375, rho: 8530, sigmaY: 124e6, k: 120,   alpha: 19.9e-6, color: '#caa56b' },
  { id: 'copper',    name: 'Copper C110',       E: 117e9,   nu: 0.33,  rho: 8940, sigmaY:  70e6, k: 401,   alpha: 16.5e-6, color: '#b66838' },
  { id: 'titanium',  name: 'Titanium Ti-6Al-4V',E: 113.8e9, nu: 0.342, rho: 4430, sigmaY: 880e6, k:   6.7, alpha:  9.0e-6, color: '#9aa0a8' },
  { id: 'abs',       name: 'ABS Plastic',       E:   2.3e9, nu: 0.35,  rho: 1050, sigmaY:  40e6, k:   0.17, alpha: 90e-6,   color: '#e1dccb' },
  { id: 'nylon',     name: 'Nylon 6/6',         E:   2.0e9, nu: 0.39,  rho: 1140, sigmaY:  75e6, k:   0.25, alpha: 80e-6,   color: '#dad3b9' },
  { id: 'petg',      name: 'PETG',              E:   2.1e9, nu: 0.38,  rho: 1270, sigmaY:  53e6, k:   0.20, alpha: 68e-6,   color: '#d6cfe4' },
]);

export const STUDY_TYPES = Object.freeze([
  'Static', 'Modal', 'Dynamic', 'Thermal',
  'Buckling', 'Nonlinear', 'Contact', 'Plastic',
  'Fatigue', 'CFD',
  'Topology Optimisation', 'Crack Propagation', 'Adaptive Refinement',
]);

// Study types whose solve path is owned by runStudyCore (single mesh →
// single result object). The three advanced types (Topology / Crack /
// Adaptive) keep their dedicated panel runners + result viewers.
export const CORE_STUDY_TYPES = Object.freeze([
  'Static', 'Modal', 'Dynamic', 'Thermal',
  'Buckling', 'Nonlinear', 'Plastic', 'Fatigue', 'CFD',
]);

export function isCoreStudyType(t) { return CORE_STUDY_TYPES.includes(t); }

export const LOAD_KINDS = ['Force', 'Pressure', 'BodyForce'];
export const BC_KINDS   = ['Fixed', 'Pin', 'Roller', 'Symmetry'];

// 6-AABB-face convention (the deferred Inc 3 swaps this for real BRep face
// picking). Index === faceId === bit position in mesh.nodeToFace.
export const FACE_LABELS = ['−X', '+X', '−Y', '+Y', '−Z', '+Z'];

// Map a human face token ("-z", "+Z", "top", "bottom", a number…) onto a
// faceId (0..5). Used by the CUA setters so Archie can say "fix the base".
const FACE_ALIASES = {
  '-x': 0, '+x': 1, '-y': 2, '+y': 3, '-z': 4, '+z': 5,
  '−x': 0, '−y': 2, '−z': 4, // unicode minus
  left: 0, right: 1, front: 2, back: 3, bottom: 4, base: 4, top: 5,
};
export function faceIdFromToken(tok, fallback = 0) {
  if (typeof tok === 'number' && Number.isFinite(tok)) {
    const id = tok | 0;
    return (id >= 0 && id <= 5) ? id : fallback;
  }
  const k = String(tok || '').toLowerCase().trim();
  return FACE_ALIASES[k] != null ? FACE_ALIASES[k] : fallback;
}

export function materialById(id) {
  return MATERIALS.find((m) => m.id === id) || MATERIALS[0];
}

// ---------------------------------------------------------- row factories

export function defaultLoad(kind) {
  switch (kind) {
    case 'Force':     return { kind, faceId: 1, F: [0, -1000, 0] };
    case 'Pressure':  return { kind, faceId: 1, pressure: 1e5 };
    case 'BodyForce': return { kind, g: [0, -9.81, 0] };
    default:          return { kind, faceId: 0 };
  }
}

export function defaultBC(kind) {
  switch (kind) {
    case 'Fixed':    return { kind, faceId: 0 };
    case 'Pin':      return { kind, faceId: 0 };
    case 'Roller':   return { kind, faceId: 0, axis: 'y' };
    case 'Symmetry': return { kind, faceId: 0, axis: 'x' };
    default:         return { kind, faceId: 0 };
  }
}

// ---------------------------------------------------------- rows → kernel

export function loadsToNodalForces(loads, meshObj) {
  if (!meshObj) return { nodal: [], pressures: [] };
  const nodal = [];
  const pressures = [];
  for (const L of loads) {
    if (L.kind === 'Force') {
      const distributed = distributeForceFace(meshObj, L.faceId, L.F);
      nodal.push(...distributed);
    } else if (L.kind === 'Pressure') {
      pressures.push({ faceId: L.faceId, pressure: L.pressure });
    } else if (L.kind === 'BodyForce') {
      // Body force — distribute g (per-node share of the resultant) over
      // every node. The kernel may accept a dedicated body-force field; if
      // not we treat it as a uniform per-node load.
      if (meshObj.nodeCount > 0) {
        const N = meshObj.nodeCount;
        const fx = L.g[0] / N;
        const fy = L.g[1] / N;
        const fz = L.g[2] / N;
        for (let i = 0; i < N; i++) nodal.push({ nodeId: i, fx, fy, fz });
      }
    }
  }
  return { nodal, pressures };
}

export function bcsToNodalConstraints(bcs, meshObj) {
  if (!meshObj) return [];
  const out = [];
  for (const B of bcs) {
    if (B.kind === 'Fixed' || B.kind === 'Pin') {
      out.push(...pinFace(meshObj, B.faceId));
    } else if (B.kind === 'Roller') {
      out.push(...rollerFace(meshObj, B.faceId, B.axis || 'y'));
    } else if (B.kind === 'Symmetry') {
      out.push(...rollerFace(meshObj, B.faceId, B.axis || 'x'));
    }
  }
  return out;
}

// ---------------------------------------------------------- SimScale tree
//
// The unified left-rail study tree. Each node FOCUSES the matching existing
// sub-section (by its `data-sim-section` id) — it does NOT own a parallel
// copy of that section's state, so the body's sub-sections stay the single
// source of truth (Inc 1: "wire the tree to them, don't rewrite them").
export const SIM_TREE = Object.freeze([
  { id: 'geometry',  label: 'Geometry',            section: 'study'    },
  { id: 'mesh',      label: 'Mesh',                section: 'mesh'     },
  { id: 'materials', label: 'Materials',           section: 'material' },
  { id: 'loads',     label: 'Loads',               section: 'loads'    },
  { id: 'bcs',       label: 'Boundary conditions', section: 'bcs'      },
  { id: 'solver',    label: 'Solver',              section: 'solve'    },
  { id: 'results',   label: 'Results',             section: 'results'  },
]);

const SIM_TREE_BY_ID = new Map(SIM_TREE.map((n) => [n.id, n]));

/** Tree node id → the `data-sim-section` it focuses. null if unknown. */
export function sectionForNode(nodeId) {
  const n = SIM_TREE_BY_ID.get(nodeId);
  return n ? n.section : null;
}

/** Inverse: a `data-sim-section` id → the owning tree node id (or null). */
export function nodeForSection(section) {
  const n = SIM_TREE.find((x) => x.section === section);
  return n ? n.id : null;
}

// ---------------------------------------------------------- the solve path
//
// buildStudyInputs + runStudyCore are the ONE place a core study is turned
// from UI state into kernel arrays and dispatched. The panel's Solve button
// and the Archie-CUA `sim.setup.solve` setter both go through runStudyCore,
// so "solved through the tree path" and "solved headless" are provably the
// same call.

/**
 * Turn the panel's load/BC rows + material id into the kernel-shaped arrays.
 * Pure — no kernel call. `meshObj` provides nodeToFace for the face bitmask.
 * @returns {{ material, nodal, pressures, constraints }}
 */
export function buildStudyInputs(state, meshObj) {
  const m = materialById(state.materialId);
  const { nodal, pressures } = loadsToNodalForces(state.loads || [], meshObj);
  const constraints = bcsToNodalConstraints(state.bcs || [], meshObj);
  const material = {
    E: m.E, nu: m.nu, rho: m.rho, sigmaY: m.sigmaY, k: m.k, alpha: m.alpha,
  };
  return { material, nodal, pressures, constraints };
}

/** Pull a convergence log out of a solver result (mirrors the panel). */
function logFromResult(r) {
  if (Array.isArray(r.iterations)) {
    return r.iterations.map((it, i) => ({ step: i, residual: it.residual ?? it }));
  }
  if (Array.isArray(r.stepResiduals)) {
    return r.stepResiduals.map((res, i) => ({ step: i, residual: res }));
  }
  return [];
}

/**
 * Run a CORE study from UI state. Returns a normalised envelope:
 *   { result, resultTab, solveLog }   on success
 *   { error }                          on a guarded failure
 *
 * @param {object}  args
 * @param {object}  args.state       — { type, materialId, loads, bcs, nModes,
 *                                       tEnd, dt, alpha, beta, loadSteps,
 *                                       fatigueCfg, name }
 * @param {object}  args.meshObj     — kernel mesh (required for all but CFD)
 * @param {object} [args.prevResult] — prior result (Fatigue reads its stress)
 */
export function runStudyCore({ state, meshObj, prevResult = null }) {
  const type = state.type;
  if (!isCoreStudyType(type)) {
    return { error: `runStudyCore: "${type}" is not a core study type` };
  }
  if (!meshObj && type !== 'CFD') {
    return { error: 'Mesh the body first.' };
  }
  const { material, nodal, pressures, constraints } = buildStudyInputs(state, meshObj);

  let r;
  let resultTab = 'Displacement';
  try {
    switch (type) {
      case 'Static':
        r = solveStatic({ mesh: meshObj, material,
                          loads: nodal, pressureLoads: pressures, bcs: constraints,
                          bodyName: state.name });
        break;
      case 'Modal':
        r = solveModal({ mesh: meshObj, material, bcs: constraints,
                         nModes: state.nModes, bodyName: state.name });
        resultTab = 'Modes';
        break;
      case 'Dynamic':
        r = solveDynamic({ mesh: meshObj, material, loads: nodal, bcs: constraints,
                           tEnd: state.tEnd, dt: state.dt,
                           alpha: state.alpha, beta: state.beta, bodyName: state.name });
        break;
      case 'Thermal': {
        const sources = (state.loads || []).filter((L) => L.kind === 'BodyForce')
          .map((L) => ({ value: L.g[1] || 0 }));
        const dirichlet = (state.bcs || []).filter((B) => B.kind === 'Fixed')
          .map((B) => ({ faceId: B.faceId, T: 293.15 }));
        r = solveThermal({ mesh: meshObj, material, dirichlet, sources, convection: [],
                           bodyName: state.name });
        resultTab = 'Temperature';
        break;
      }
      case 'Buckling':
        r = solveBuckling({ mesh: meshObj, material, loads: nodal, bcs: constraints,
                            nModes: state.nModes, bodyName: state.name });
        resultTab = 'Modes';
        break;
      case 'Nonlinear':
        r = solveNonlinearStatic({ mesh: meshObj, material, loads: nodal, bcs: constraints,
                                   loadSteps: state.loadSteps, bodyName: state.name });
        break;
      case 'Plastic':
        r = solveNonlinearPlastic({ mesh: meshObj, material, loads: nodal, bcs: constraints,
                                    loadSteps: state.loadSteps, bodyName: state.name });
        break;
      case 'Fatigue': {
        if (!prevResult || !prevResult.stress) {
          return { error: 'Run a Static study first; Fatigue consumes its stress history.' };
        }
        const nE = meshObj.elemCount
          || (meshObj.elements ? meshObj.elements.length / (meshObj.elemNodeCount || 4) : 0);
        r = fatigueLifeDispatch({
          stressHistory: prevResult.stress, nElem: nE, nSteps: 1, cfg: state.fatigueCfg,
        });
        resultTab = 'Fatigue Life';
        break;
      }
      case 'CFD':
        r = solveCFD({ velocityInlet: [0.1, 0, 0], pressureOutlet: 0,
                       viscosity: 1e-3, density: 1000 });
        break;
      default:
        return { error: `Unknown study type "${type}"` };
    }
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }

  if (!r) return { error: 'solver returned nothing' };
  if (r.error) return { error: r.error };
  return { result: r, resultTab, solveLog: logFromResult(r) };
}

/** Peak nodal displacement magnitude (m) from a result's DOF vector. */
export function peakDisplacement(result, meshObj) {
  const u = (result && (result.u || result.displacement)) || null;
  if (!u || !meshObj) return 0;
  let maxDisp = 0;
  const N = meshObj.nodeCount || (u.length / 3);
  for (let i = 0; i < N; i++) {
    const dx = u[3 * i] || 0, dy = u[3 * i + 1] || 0, dz = u[3 * i + 2] || 0;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > maxDisp) maxDisp = d;
  }
  return maxDisp;
}
