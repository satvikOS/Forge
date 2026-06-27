// Forge — Simulation event-reducer store + Archie-CUA control surface
// (task #66, Inc 2 — the keystone).
//
// WHY A STORE (NOT useState): the platform's hard rule is that window.__ /
// CUA ops must NEVER call a React state setter directly — a re-render race
// deletes the window functions and breaks tests (MEMORY: no-setState-from-
// window-API). So the Simulation panel's setup state lives in this tiny
// external store; the panel SUBSCRIBES (useSyncExternalStore) and every
// mutation — whether a human clicks a button or Archie drives a `sim.setup.*`
// setter — goes through `simStore.dispatch(action)`. ONE reducer, ONE source
// of truth, ZERO setState reachable from the window/CUA surface.
//
// The `simSetup` object is the idempotent control surface the panel buttons
// AND ForgeToolBridge's `sim.setup.*` family both call, so "Archie operated
// the panel step-by-step" and "a human clicked through it" drive identical
// state.

import {
  STUDY_TYPES, MATERIALS, defaultLoad, defaultBC,
  faceIdFromToken, materialById, sectionForNode, isCoreStudyType,
  runStudyCore, peakDisplacement,
} from './simulationModel.js';
import { mesh as meshDispatch } from './simulationDispatch.js';
import { feaMeshQuality } from './feaMeshQuality.js';

// ----------------------------------------------------------- initial state
export function makeInitialState() {
  return {
    // study setup
    name: 'Study 1',
    type: 'Static',
    materialId: 'steel',
    elemSizeMm: 3,
    // loads + BCs (start with the canonical one-load / one-fixed-BC rows)
    loads: [defaultLoad('Force')],
    bcs: [defaultBC('Fixed')],
    // solver params
    nModes: 6,
    tEnd: 0.1,
    dt: 0.001,
    alpha: 0,
    beta: 0,
    loadSteps: 5,
    fatigueCfg: { Sut: 400e6, Se: 200e6, b: -0.085, meanStressCorrection: 'goodman' },
    // geometry
    activeBodyHandle: null,
    activeBodyName: 'No body selected',
    // mesh
    meshObj: null,
    meshInfo: null,
    meshError: null,
    meshing: false,
    meshQuality: null,
    // solve / results
    solving: false,
    solveError: null,
    result: null,
    resultTab: 'Displacement',
    solveLog: [],
    // SimScale tree focus
    focusedSection: 'study',
    focusNonce: 0, // bumped on every focus dispatch so re-focusing the same node re-scrolls
  };
}

// ----------------------------------------------------------- reducer (pure)
export function simReducer(state, action) {
  switch (action.type) {
    case 'SET': {
      if (Object.is(state[action.key], action.value)) return state;
      return { ...state, [action.key]: action.value };
    }
    case 'PATCH':
      return { ...state, [action.key]: { ...state[action.key], ...action.patch } };

    case 'FOCUS': {
      const section = action.section || 'study';
      return { ...state, focusedSection: section, focusNonce: state.focusNonce + 1 };
    }

    case 'SET_BODY':
      return { ...state,
        activeBodyHandle: action.handle ?? null,
        activeBodyName: action.name || 'No body selected' };

    // ── loads ──
    case 'ADD_LOAD': {
      const load = action.load || defaultLoad('Force');
      return { ...state, loads: [...state.loads, load] };
    }
    case 'UPDATE_LOAD':
      return { ...state,
        loads: state.loads.map((x, i) => (i === action.index ? action.value : x)) };
    case 'REMOVE_LOAD':
      return { ...state, loads: state.loads.filter((_, i) => i !== action.index) };

    // ── BCs ──
    case 'ADD_BC': {
      const bc = action.bc || defaultBC('Fixed');
      return { ...state, bcs: [...state.bcs, bc] };
    }
    case 'UPDATE_BC':
      return { ...state,
        bcs: state.bcs.map((x, i) => (i === action.index ? action.value : x)) };
    case 'REMOVE_BC':
      return { ...state, bcs: state.bcs.filter((_, i) => i !== action.index) };

    // ── face assignment (6-AABB-face bitmask; real BRep picking = deferred Inc 3) ──
    case 'ASSIGN_FACE': {
      const arrKey = action.target === 'bc' ? 'bcs' : 'loads';
      const arr = state[arrKey].map((x, i) =>
        (i === action.index ? { ...x, faceId: action.faceId } : x));
      return { ...state, [arrKey]: arr };
    }

    // ── mesh lifecycle ──
    case 'MESH_BEGIN':
      return { ...state, meshing: true, meshError: null, meshInfo: null, meshQuality: null };
    case 'MESH_DONE':
      return { ...state, meshing: false,
        meshObj: action.mesh, meshInfo: action.info, meshQuality: action.quality,
        meshError: null };
    case 'MESH_ERROR':
      return { ...state, meshing: false, meshObj: null, meshInfo: null,
        meshQuality: null, meshError: action.error };

    // ── solve lifecycle ──
    case 'SOLVE_BEGIN':
      return { ...state, solving: true, solveError: null, result: null, solveLog: [] };
    case 'SOLVE_DONE':
      return { ...state, solving: false, result: action.result,
        resultTab: action.resultTab || state.resultTab,
        solveLog: action.solveLog || [] };
    case 'SOLVE_ERROR':
      return { ...state, solving: false, solveError: action.error };

    case 'REPLACE':
      return { ...makeInitialState(), ...action.state };
    case 'RESET':
      return makeInitialState();

    default:
      return state;
  }
}

// ----------------------------------------------------------- store factory
export function createSimStore(initial = makeInitialState()) {
  let state = initial;
  const listeners = new Set();
  return {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispatch(action) {
      const next = simReducer(state, action);
      if (next === state) return state; // no-op short-circuit (idempotent SETs)
      state = next;
      for (const l of listeners) l();
      return state;
    },
  };
}

// The singleton the panel + the CUA setters + the bridge tools all share.
export const simStore = createSimStore();

// ----------------------------------------------------------- body resolver
// Read the active native body from the live scene registry — mirrors the
// panel host's readActiveBody so the CUA path can mesh/solve even when the
// panel host has not pushed a SET_BODY yet.
export function readActiveBodyHandle() {
  if (typeof window === 'undefined') return { handle: null, name: 'No body selected' };
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  const sel = window.__forgeSelection;
  const selIds = sel && sel.ids ? sel.ids : (Array.isArray(sel) ? sel : []);
  let pick = null;
  if (selIds && selIds.length) {
    pick = bodies.find((b) => b && b.kind === 'native' && selIds.includes(b.id));
  }
  if (!pick) {
    for (let i = bodies.length - 1; i >= 0; i--) {
      if (bodies[i] && bodies[i].kind === 'native' && bodies[i].handle != null) {
        pick = bodies[i]; break;
      }
    }
  }
  if (!pick) return { handle: null, name: 'No body selected' };
  return { handle: pick.handle, name: pick.name || pick.id || 'Body' };
}

function resolveBodyHandle(store, override) {
  if (typeof override === 'number') return override;
  const s = store.getState();
  if (typeof s.activeBodyHandle === 'number') return s.activeBodyHandle;
  return readActiveBodyHandle().handle;
}

// ----------------------------------------------------------- controllers
// The two side-effecting operations (mesh / solve). They READ store state,
// call the kernel dispatch, then dispatch the result back — they never touch
// React directly, so they are safe to invoke from the window/CUA surface.

/** Mesh the active body at the current element size; compute the quality report. */
export function runMesh(store = simStore, { activeBodyHandle } = {}) {
  const handle = resolveBodyHandle(store, activeBodyHandle);
  store.dispatch({ type: 'MESH_BEGIN' });
  if (typeof handle !== 'number') {
    store.dispatch({ type: 'MESH_ERROR', error: 'No body handle — pick a body first.' });
    return { error: 'No body handle — pick a body first.' };
  }
  const elemSizeMm = store.getState().elemSizeMm;
  const r = meshDispatch(handle, elemSizeMm);
  if (r.error) {
    store.dispatch({ type: 'MESH_ERROR', error: r.error });
    return r;
  }
  const m = r.mesh;
  const info = {
    nodeCount: m.nodeCount || (m.nodes ? m.nodes.length / 3 : 0),
    elemCount: m.elemCount
      || ((m.elements || m.tets) ? (m.elements || m.tets).length / (m.elemNodeCount || 4) : 0),
    elapsedMs: r.elapsedMs,
    sizeMeters: r.sizeMeters,
  };
  let quality = null;
  try { quality = feaMeshQuality(m); } catch { quality = null; }
  store.dispatch({ type: 'MESH_DONE', mesh: m, info, quality });
  return { mesh: m, info, quality };
}

/** Publish the canonical static-result mirror FatigueAnalysisPanel reads. */
function publishLast(result, meshObj) {
  if (typeof window === 'undefined' || !result) return;
  window.__forgeSimulationLast = {
    maxVonMises: result.maxVonMises ?? null,
    maxDisplacement: peakDisplacement(result, meshObj),
    residual: result.residual ?? null,
    at: Date.now(),
  };
}

/**
 * Solve the current CORE study from store state (the SAME path the panel's
 * Solve button drives). Advanced studies (Topology / Crack / Adaptive) keep
 * their dedicated panel runners and are rejected here with a clear message.
 */
export function runStudy(store = simStore, { activeBodyHandle } = {}) {
  const s = store.getState();
  store.dispatch({ type: 'SOLVE_BEGIN' });
  if (!isCoreStudyType(s.type)) {
    const error = `${s.type} is an advanced study — run it from the panel.`;
    store.dispatch({ type: 'SOLVE_ERROR', error });
    return { error };
  }
  // make sure the body handle is on the state for any downstream reader
  const handle = resolveBodyHandle(store, activeBodyHandle);
  const env = runStudyCore({ state: { ...s, activeBodyHandle: handle },
                             meshObj: s.meshObj, prevResult: s.result });
  if (env.error) {
    store.dispatch({ type: 'SOLVE_ERROR', error: env.error });
    return env;
  }
  store.dispatch({ type: 'SOLVE_DONE',
    result: env.result, resultTab: env.resultTab, solveLog: env.solveLog });
  publishLast(env.result, s.meshObj);
  return env;
}

// ----------------------------------------------------------- CUA setters
// Idempotent control surface. Every method dispatches an action (NO setState),
// so it is safe from the window API + ForgeToolBridge. Returns a small JSON-
// serialisable ack so Archie can read back what it set.

function normaliseLoad(spec = {}) {
  const kind = spec.kind || 'Force';
  const base = defaultLoad(kind);
  const out = { ...base };
  if (spec.face != null || spec.faceId != null) {
    out.faceId = faceIdFromToken(spec.face ?? spec.faceId, base.faceId ?? 0);
  }
  if (kind === 'Force') {
    if (Array.isArray(spec.F)) out.F = spec.F.slice(0, 3);
    else if (Array.isArray(spec.force)) out.F = spec.force.slice(0, 3);
    else if (typeof spec.magnitude === 'number') {
      // magnitude + axis → vector (default −Y "downward")
      const axis = (spec.axis || 'y').toLowerCase();
      const sign = spec.sign != null ? Math.sign(spec.sign) : -1;
      out.F = [axis === 'x' ? sign * spec.magnitude : 0,
               axis === 'y' ? sign * spec.magnitude : 0,
               axis === 'z' ? sign * spec.magnitude : 0];
    }
  } else if (kind === 'Pressure' && typeof spec.pressure === 'number') {
    out.pressure = spec.pressure;
  } else if (kind === 'BodyForce' && Array.isArray(spec.g)) {
    out.g = spec.g.slice(0, 3);
  }
  return out;
}

function normaliseBC(spec = {}) {
  const kind = spec.kind || 'Fixed';
  const out = { ...defaultBC(kind) };
  if (spec.face != null || spec.faceId != null) {
    out.faceId = faceIdFromToken(spec.face ?? spec.faceId, out.faceId ?? 0);
  }
  if ((kind === 'Roller' || kind === 'Symmetry') && spec.axis) {
    out.axis = String(spec.axis).toLowerCase();
  }
  return out;
}

export const simSetup = {
  store: simStore,

  /** Focus a tree node / section. */
  focus(nodeOrSection) {
    const section = sectionForNode(nodeOrSection) || nodeOrSection;
    simStore.dispatch({ type: 'FOCUS', section });
    return { ok: true, focusedSection: simStore.getState().focusedSection };
  },

  setStudyType(type) {
    if (!STUDY_TYPES.includes(type)) {
      return { ok: false, error: `unknown study type "${type}"`, allowed: STUDY_TYPES };
    }
    simStore.dispatch({ type: 'SET', key: 'type', value: type });
    return { ok: true, type };
  },

  setMaterial(id) {
    if (!MATERIALS.some((m) => m.id === id)) {
      return { ok: false, error: `unknown material "${id}"`,
               allowed: MATERIALS.map((m) => m.id) };
    }
    simStore.dispatch({ type: 'SET', key: 'materialId', value: id });
    const m = materialById(id);
    return { ok: true, materialId: id, E_GPa: m.E / 1e9 };
  },

  setElementSize(mm) {
    const v = Number(mm);
    if (!(v > 0)) return { ok: false, error: 'element size must be > 0 mm' };
    simStore.dispatch({ type: 'SET', key: 'elemSizeMm', value: v });
    return { ok: true, elemSizeMm: v };
  },

  setSolverParam(key, value) {
    const allowed = ['nModes', 'tEnd', 'dt', 'alpha', 'beta', 'loadSteps', 'name'];
    if (!allowed.includes(key)) return { ok: false, error: `param "${key}" not settable` };
    simStore.dispatch({ type: 'SET', key, value });
    return { ok: true, [key]: value };
  },

  mesh(opts = {}) {
    const r = runMesh(simStore, opts);
    if (r.error) return { ok: false, error: r.error };
    return { ok: true, nodeCount: r.info.nodeCount, elemCount: r.info.elemCount,
             quality: r.quality && { worstAspect: r.quality.aspect.worst,
                                     minDihedralDeg: r.quality.minDihedralDeg.min,
                                     poorCount: r.quality.poorCount } };
  },

  /** Add OR update (when `index` given) a load row. Idempotent at a fixed index. */
  addLoad(spec = {}) {
    const load = normaliseLoad(spec);
    const st = simStore.getState();
    if (Number.isInteger(spec.index) && spec.index >= 0 && spec.index < st.loads.length) {
      simStore.dispatch({ type: 'UPDATE_LOAD', index: spec.index, value: load });
      return { ok: true, index: spec.index, load };
    }
    simStore.dispatch({ type: 'ADD_LOAD', load });
    return { ok: true, index: simStore.getState().loads.length - 1, load };
  },

  /** Add OR update (when `index` given) a BC row. Idempotent at a fixed index. */
  addBC(spec = {}) {
    const bc = normaliseBC(spec);
    const st = simStore.getState();
    if (Number.isInteger(spec.index) && spec.index >= 0 && spec.index < st.bcs.length) {
      simStore.dispatch({ type: 'UPDATE_BC', index: spec.index, value: bc });
      return { ok: true, index: spec.index, bc };
    }
    simStore.dispatch({ type: 'ADD_BC', bc });
    return { ok: true, index: simStore.getState().bcs.length - 1, bc };
  },

  assignFace({ target = 'load', index = 0, face, faceId } = {}) {
    const id = faceIdFromToken(face ?? faceId, 0);
    simStore.dispatch({ type: 'ASSIGN_FACE', target, index, faceId: id });
    return { ok: true, target, index, faceId: id };
  },

  clearLoads() { simStore.dispatch({ type: 'SET', key: 'loads', value: [] }); return { ok: true }; },
  clearBCs()   { simStore.dispatch({ type: 'SET', key: 'bcs',   value: [] }); return { ok: true }; },

  solve(opts = {}) {
    const env = runStudy(simStore, opts);
    if (env.error) return { ok: false, error: env.error };
    const s = simStore.getState();
    return { ok: true, ...this.readResult() , resultTab: s.resultTab };
  },

  /** Read the solved result (or a single field). */
  readResult(field = null) {
    const s = simStore.getState();
    const r = s.result;
    if (!r) return { ok: false, error: 'no result — solve first' };
    const summary = {
      ok: true,
      maxVonMises_Pa: r.maxVonMises ?? null,
      maxVonMises_MPa: r.maxVonMises != null ? r.maxVonMises / 1e6 : null,
      maxDisplacement_m: peakDisplacement(r, s.meshObj),
      residual: r.residual ?? null,
      eigenvalues: r.eigenvalues ? Array.from(r.eigenvalues) : undefined,
    };
    if (field) return { ok: true, [field]: summary[field] ?? r[field] ?? null };
    return summary;
  },

  reset() { simStore.dispatch({ type: 'RESET' }); return { ok: true }; },
};

// ----------------------------------------------------------- window install
// Mount the CUA surface on `window.sim.setup.*`. Idempotent (safe to call on
// every panel mount). The functions only dispatch to the store — they NEVER
// call a React setter — so the re-render race the memory rule warns about
// cannot occur.
export function installSimSetupApi() {
  if (typeof window === 'undefined') return simSetup;
  window.sim = window.sim || {};
  window.sim.setup = simSetup;
  return simSetup;
}
