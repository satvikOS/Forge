// Forge-158 — AIS-style (Application Interactive Services) selection.
//
// OCCT's AIS gives you two layers:
//   • pre-selection — what the cursor is currently hovering over.
//                     Rendered in a soft yellow.
//   • selection     — what the user has actually clicked / picked.
//                     Rendered in saturated orange.
//
// Both layers are scoped by the active subshape mode:
//   • body   — pick whole TopoDS_Solids
//   • face   — pick TopoDS_Face entries on the body
//   • edge   — pick TopoDS_Edge polylines
//   • vertex — pick TopoDS_Vertex points
//
// This module owns the runtime state, publishes mirrors to
// window.__forgeSelection + window.__forgeHovered (the existing
// integration points the rest of the shell already reads), and
// emits two CustomEvents:
//
//   forge:selection-mode-changed → { mode }
//   forge:selection-changed      → { selection, hovered }
//
// Viewport.jsx hands us the raw pointer event objects from r3f
// (e.intersections[]), and we resolve them to a body/face/edge/vertex
// reference the highlight component can render.

const MODES = ['body', 'face', 'edge', 'vertex'];

const state = {
  mode: 'body',
  selection: null,   // { kind, bodyId, faceIdx?, edgeIdx?, vertexIdx?, point? }
  hovered:   null,   // same shape; the pre-selection layer
  // Forge-197 — multi-select set (Blender/Maya modifier-key parity).
  // `selection` stays the ACTIVE entity (last pick — gizmo target);
  // `selectionSet` holds every selected entity including it. Empty set
  // + selection=null means nothing selected; single-pick keeps the set
  // at exactly [selection].
  selectionSet: [],
};

const _listeners = new Set();

function notify() {
  if (typeof window !== 'undefined') {
    // Publish the React-friendly snapshot. Other modules that already
    // read window.__forgeSelection (e.g. ForgeShellV4's clipboard /
    // copy/paste handlers) get a back-compat shape: { kind, ids: [..] }
    // when the new selection is set.
    window.__forgeHovered   = state.hovered;
    // Compat shape carries EVERY selected body in ids (consumers that
    // read ids[0] keep working; multi-aware consumers read the array).
    const compat = state.selection ? compatShape(state.selection) : { kind: 'none', ids: [] };
    if (state.selectionSet.length > 1) {
      const ids = [];
      for (const ent of state.selectionSet) {
        if (ent && ent.bodyId != null && !ids.includes(ent.bodyId)) ids.push(ent.bodyId);
      }
      compat.ids = ids;
      compat.multi = true;
    }
    window.__forgeSelection = compat;
    window.__forgeAisSelection = {
      mode: state.mode,
      selection: state.selection,
      hovered: state.hovered,
      selectionSet: [...state.selectionSet],
    };
    window.dispatchEvent(new CustomEvent('forge:selection-changed', {
      detail: { selection: state.selection, hovered: state.hovered },
    }));
  }
  for (const fn of _listeners) {
    try { fn({ ...state }); } catch (_) { /* swallow listener errors */ }
  }
}

function compatShape(sel) {
  if (!sel) return { kind: 'none', ids: [] };
  if (sel.kind === 'body')   return { kind: 'body',   ids: [sel.bodyId] };
  if (sel.kind === 'face')   return { kind: 'face',   ids: [sel.bodyId], faceIdx: sel.faceIdx };
  if (sel.kind === 'edge')   return { kind: 'edge',   ids: [sel.bodyId], edgeIdx: sel.edgeIdx };
  if (sel.kind === 'vertex') return { kind: 'vertex', ids: [sel.bodyId], vertexIdx: sel.vertexIdx, point: sel.point };
  return { kind: 'none', ids: [] };
}

// -------------------- public API --------------------

/** Active subshape pick mode. */
export function getMode() { return state.mode; }

/** Switch to one of: 'body' | 'face' | 'edge' | 'vertex'. */
export function setMode(mode) {
  if (!MODES.includes(mode)) {
    throw new Error(`aisSelection.setMode: invalid mode '${mode}'`);
  }
  if (state.mode === mode) return;
  state.mode = mode;
  // Clear stale selections that no longer match the new mode.
  state.selection = null;
  state.hovered = null;
  state.selectionSet = [];
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('forge:selection-mode-changed',
      { detail: { mode } }));
  }
  notify();
}

/** Current selection (or null). */
export function getSelection() { return state.selection; }
/** Current hovered (pre-selection) entity (or null). */
export function getHovered()   { return state.hovered; }

/** Clear everything; equivalent to Esc + click-on-empty-canvas. */
export function clear() {
  if (!state.selection && !state.hovered && !state.selectionSet.length) return;
  state.selection = null;
  state.hovered = null;
  state.selectionSet = [];
  notify();
}

/** Subscribe to state changes. Returns an unsubscribe fn. */
export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/**
 * Resolve an r3f pointer event into an AIS-shaped entity.
 * The event carries .intersections (from react-three-fiber's
 * built-in raycaster) where each hit has { object, point, face,
 * faceIndex, instanceId } — we read body identity off
 * object.userData.body which the Viewport sets at scene build time.
 *
 * Returns null if the event hit nothing.
 */
export function resolvePointerEvent(e, mode = state.mode) {
  if (!e) return null;
  const hits = e.intersections || (e.object ? [e] : []);
  const hit = hits[0];
  if (!hit) return null;
  const obj = hit.object || e.object;
  const body = obj?.userData?.body || obj?.userData?.forgeBody || null;
  const bodyId = body?.handle ?? body?.id ?? obj?.userData?.bodyId ?? obj?.id ?? null;
  if (bodyId == null) return null;
  const point = hit.point
    ? { x: hit.point.x, y: hit.point.y, z: hit.point.z }
    : null;
  if (mode === 'body') {
    return { kind: 'body', bodyId, body, point, object: obj };
  }
  if (mode === 'face') {
    return {
      kind: 'face',
      bodyId, body,
      faceIdx: typeof hit.faceIndex === 'number' ? hit.faceIndex : -1,
      face: hit.face || null,
      point, object: obj,
    };
  }
  if (mode === 'edge') {
    // For face hits we approximate an edge by the closest of the
    // triangle's three edges. The kernel-native picker can override
    // this by attaching object.userData.edges (BufferAttribute of
    // edge polyline indices) — we then snap to the nearest one.
    return {
      kind: 'edge',
      bodyId, body,
      edgeIdx: typeof hit.faceIndex === 'number' ? hit.faceIndex : -1,
      point, object: obj,
    };
  }
  if (mode === 'vertex') {
    // Snap to the nearest triangle corner of the hit face for synthetic
    // geometry; for kernel meshes this resolves to a real TopoDS_Vertex
    // when window.forge.pickVertex is wired (Forge-160).
    const vertex = nearestVertexOnHit(hit);
    return {
      kind: 'vertex',
      bodyId, body,
      vertexIdx: vertex?.index ?? -1,
      point: vertex?.point || point,
      object: obj,
    };
  }
  return null;
}

function nearestVertexOnHit(hit) {
  const geom = hit.object?.geometry;
  if (!geom || !geom.attributes?.position || !hit.face || !hit.point) {
    return { index: -1, point: hit.point };
  }
  const positions = geom.attributes.position.array;
  const corners = [hit.face.a, hit.face.b, hit.face.c];
  let best = corners[0], bestD = Infinity;
  for (const c of corners) {
    const i = c * 3;
    const dx = positions[i]     - hit.point.x;
    const dy = positions[i + 1] - hit.point.y;
    const dz = positions[i + 2] - hit.point.z;
    const d = dx*dx + dy*dy + dz*dz;
    if (d < bestD) { bestD = d; best = c; }
  }
  const i = best * 3;
  return {
    index: best,
    point: { x: positions[i], y: positions[i + 1], z: positions[i + 2] },
  };
}

/** Drive pre-selection (hover) from an r3f onPointerMove / onPointerOver. */
export function onPointerOver(e) {
  const ent = resolvePointerEvent(e);
  if (entityEqual(ent, state.hovered)) return;
  state.hovered = ent;
  notify();
}

/** Drive selection from an r3f onClick.
 * Forge-197 — modifier-key routing (Blender/Maya parity):
 *   plain click        → replace (single select)
 *   Shift+click        → extend (add to set)
 *   Ctrl/Cmd+click     → toggle (remove if selected, add if not)
 * r3f events surface modifiers on the synthetic event AND nativeEvent;
 * read whichever carries them. */
export function onClick(e) {
  const ent = resolvePointerEvent(e);
  if (!ent) return;
  const ne = (e && e.nativeEvent) || e || {};
  const ctrl  = !!(ne.ctrlKey || ne.metaKey || (e && (e.ctrlKey || e.metaKey)));
  const shift = !!(ne.shiftKey || (e && e.shiftKey));
  if (ctrl)       { toggleSelection(ent); return; }
  if (shift)      { addToSelection(ent); return; }
  if (entityEqual(ent, state.selection) && state.selectionSet.length <= 1) return;
  state.selection = ent;
  state.selectionSet = [ent];
  notify();
}

// Forge-197 — selection-set operations. Pure state transforms; the
// active entity always tracks the most recent meaningful pick.
export function addToSelection(ent) {
  if (!ent) return;
  if (!state.selectionSet.some((x) => entityEqual(x, ent))) {
    state.selectionSet = [...state.selectionSet, ent];
  }
  state.selection = ent;
  notify();
}

export function toggleSelection(ent) {
  if (!ent) return;
  const had = state.selectionSet.some((x) => entityEqual(x, ent));
  if (had) {
    state.selectionSet = state.selectionSet.filter((x) => !entityEqual(x, ent));
    if (entityEqual(state.selection, ent)) {
      state.selection = state.selectionSet.length
        ? state.selectionSet[state.selectionSet.length - 1] : null;
    }
  } else {
    state.selectionSet = [...state.selectionSet, ent];
    state.selection = ent;
  }
  notify();
}

export function removeFromSelection(ent) {
  if (!ent) return;
  if (!state.selectionSet.some((x) => entityEqual(x, ent))) return;
  state.selectionSet = state.selectionSet.filter((x) => !entityEqual(x, ent));
  if (entityEqual(state.selection, ent)) {
    state.selection = state.selectionSet.length
      ? state.selectionSet[state.selectionSet.length - 1] : null;
  }
  notify();
}

export function getSelectionSet() { return [...state.selectionSet]; }
export function isMultiSelect()   { return state.selectionSet.length > 1; }

/** Clear hover when the cursor leaves a body. */
export function onPointerOut() {
  if (!state.hovered) return;
  state.hovered = null;
  notify();
}

/** Click on empty canvas → drop selection (the whole set). */
export function onMissed() {
  if (!state.selection && !state.hovered && !state.selectionSet.length) return;
  state.selection = null;
  state.hovered = null;
  state.selectionSet = [];
  notify();
}

function entityEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.bodyId !== b.bodyId) return false;
  if (a.faceIdx !== b.faceIdx) return false;
  if (a.edgeIdx !== b.edgeIdx) return false;
  if (a.vertexIdx !== b.vertexIdx) return false;
  return true;
}

// Install a window-level helper so the menu (tools.selectionMode) and
// e2e specs can rotate through the modes without importing the module
// directly. Stays idempotent on module re-evaluation.
if (typeof window !== 'undefined') {
  window.__forgeSelectionApi = {
    getMode, setMode, getSelection, getHovered, clear, subscribe,
    // E2E + DevTools drivers: route a synthetic r3f-shaped event
    // straight through the live state machine. The viewport uses the
    // same `onPointerOver`/`onClick` functions internally, so any
    // assertion this surface satisfies also applies to a real mouse.
    onPointerOver, onPointerOut, onClick, onMissed, resolvePointerEvent,
    MODES: [...MODES],
  };
  // Initial publish so consumers reading window.__forgeAisSelection
  // synchronously after import get a populated snapshot.
  window.__forgeAisSelection = {
    mode: state.mode, selection: state.selection, hovered: state.hovered,
  };
}

export const SELECTION_MODES = [...MODES];

export const PRESELECT_COLOR = '#b9bbc0';   // monochrome — light-grey preselect (tone, not hue)
export const SELECT_COLOR    = '#ffffff';   // monochrome — white select (tone, not hue)

export default {
  getMode, setMode, getSelection, getHovered, clear, subscribe,
  resolvePointerEvent, onPointerOver, onPointerOut, onClick, onMissed,
  MODES, PRESELECT_COLOR, SELECT_COLOR,
};
