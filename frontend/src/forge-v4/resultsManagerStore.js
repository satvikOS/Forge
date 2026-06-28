// Forge — Results-manager event-reducer store + Archie-CUA control surface
// (task #66, Inc 6).
//
// Same keystone pattern as simulationStore (Inc 2): the results-manager UI
// state (active sci-viz filter, the field it cuts/clips/isos, the plane,
// isovalue, opacity, and the probe history) lives in this tiny external store.
// The FeaResultViewer SUBSCRIBES (useSyncExternalStore); every mutation —
// whether a human drags a slider / clicks to probe, or Archie drives a
// `sim.results.*` setter — goes through `dispatch(action)`. NO window/CUA path
// ever calls a React setState, so the re-render race the platform rule warns
// about (window.__ ops must not call setState) cannot occur.

// ----------------------------------------------------------- initial state
export function makeInitialResultsState() {
  return {
    mode: 'none',          // 'none' | 'slice' | 'clip' | 'iso'
    field: 'vonMises',     // sci-viz field key (resultFilters.RESULT_FIELDS)
    axis: 'x',             // 'x' | 'y' | 'z' — cut/clip plane axis
    position01: 0.5,       // plane position along axis, normalised to the bbox
    invert: false,         // flip the kept half-space (clip) / plane sense
    isovalue: null,        // null ⇒ use the field's σ_mean default
    opacity: 1,            // overlay opacity
    preset: 'Cool to Warm',// TransferFunction colour preset
    dimBase: true,         // dim the base result mesh while a cut/clip is active
    probes: [],            // [{ nodeId, value, position, field, at }]
  };
}

// ----------------------------------------------------------- reducer (pure)
export function resultsReducer(state, action) {
  switch (action.type) {
    case 'SET': {
      if (Object.is(state[action.key], action.value)) return state;
      return { ...state, [action.key]: action.value };
    }
    case 'ADD_PROBE': {
      const probe = action.probe;
      if (!probe) return state;
      // de-dup: re-probing the same node updates rather than appends
      const existing = state.probes.findIndex((p) => p.nodeId === probe.nodeId);
      const probes = existing >= 0
        ? state.probes.map((p, i) => (i === existing ? probe : p))
        : [...state.probes, probe];
      return { ...state, probes };
    }
    case 'CLEAR_PROBES':
      return { ...state, probes: [] };
    case 'RESET':
      return makeInitialResultsState();
    default:
      return state;
  }
}

// ----------------------------------------------------------- store factory
export function createResultsStore(initial = makeInitialResultsState()) {
  let state = initial;
  const listeners = new Set();
  return {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispatch(action) {
      const next = resultsReducer(state, action);
      if (next === state) return state;
      state = next;
      for (const l of listeners) l();
      return state;
    },
  };
}

export const resultsStore = createResultsStore();

// ----------------------------------------------------------- CUA setters
// Idempotent control surface. Every method ONLY dispatches (never setState),
// so it is safe to mount on the window API.
export const resultsManager = {
  store: resultsStore,
  setMode(mode) {
    const ok = ['none', 'slice', 'clip', 'iso'].includes(mode);
    if (!ok) return { ok: false, error: `unknown mode "${mode}"` };
    resultsStore.dispatch({ type: 'SET', key: 'mode', value: mode });
    return { ok: true, mode };
  },
  setField(field) {
    resultsStore.dispatch({ type: 'SET', key: 'field', value: field });
    return { ok: true, field };
  },
  setAxis(axis) {
    const a = String(axis).toLowerCase();
    if (!['x', 'y', 'z'].includes(a)) return { ok: false, error: `bad axis "${axis}"` };
    resultsStore.dispatch({ type: 'SET', key: 'axis', value: a });
    return { ok: true, axis: a };
  },
  setPosition(p01) {
    const v = Math.max(0, Math.min(1, Number(p01)));
    resultsStore.dispatch({ type: 'SET', key: 'position01', value: v });
    return { ok: true, position01: v };
  },
  setIsovalue(v) {
    resultsStore.dispatch({ type: 'SET', key: 'isovalue', value: v == null ? null : Number(v) });
    return { ok: true, isovalue: v };
  },
  setOpacity(v) {
    const o = Math.max(0, Math.min(1, Number(v)));
    resultsStore.dispatch({ type: 'SET', key: 'opacity', value: o });
    return { ok: true, opacity: o };
  },
  setInvert(b) { resultsStore.dispatch({ type: 'SET', key: 'invert', value: !!b }); return { ok: true, invert: !!b }; },
  setPreset(name) { resultsStore.dispatch({ type: 'SET', key: 'preset', value: name }); return { ok: true, preset: name }; },
  addProbe(probe) { resultsStore.dispatch({ type: 'ADD_PROBE', probe }); return { ok: true }; },
  clearProbes() { resultsStore.dispatch({ type: 'CLEAR_PROBES' }); return { ok: true }; },
  reset() { resultsStore.dispatch({ type: 'RESET' }); return { ok: true }; },
  read() { return { ok: true, ...resultsStore.getState() }; },
};

// ----------------------------------------------------------- window install
export function installResultsManagerApi() {
  if (typeof window === 'undefined') return resultsManager;
  window.sim = window.sim || {};
  window.sim.results = resultsManager;
  return resultsManager;
}

export default {
  makeInitialResultsState, resultsReducer, createResultsStore,
  resultsStore, resultsManager, installResultsManagerApi,
};
