// Forge-115 — operation graph for undo / redo.
//
// Every kernel-dispatched op (sketch add, body create, fillet, bool, etc.)
// is recorded as a Node with { id, op, params, before:{bodies,featureTree},
// after:{bodies,featureTree}, ts }. Cmd+Z restores `before`; Cmd+Shift+Z
// re-applies `after`. The graph is bounded (default 100 entries) and
// persists to localStorage so undo survives a reload.

const LS = 'forge.v4.opgraph';
const MAX_NODES = 100;

function readLS() {
  if (typeof localStorage === 'undefined') return { nodes: [], head: -1 };
  try {
    const r = localStorage.getItem(LS);
    return r ? JSON.parse(r) : { nodes: [], head: -1 };
  } catch { return { nodes: [], head: -1 }; }
}
function writeLS(state) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LS, JSON.stringify(state)); } catch {}
}

let _state = readLS();

export function recordOp({ op, params, before, after }) {
  // truncate any future nodes if we recorded after an undo
  const nodes = _state.nodes.slice(0, _state.head + 1);
  const node = {
    id: `op-${Date.now().toString(36)}-${nodes.length}`,
    op, params,
    before: serialize(before),
    after: serialize(after),
    ts: Date.now(),
  };
  nodes.push(node);
  while (nodes.length > MAX_NODES) nodes.shift();
  _state = { nodes, head: nodes.length - 1 };
  writeLS(_state);
  return node.id;
}

export function canUndo() { return _state.head >= 0; }
export function canRedo() { return _state.head < _state.nodes.length - 1; }

export function undo(setters) {
  if (!canUndo()) return null;
  const node = _state.nodes[_state.head];
  _state = { ..._state, head: _state.head - 1 };
  writeLS(_state);
  applySnapshot(node.before, setters);
  return node;
}
export function redo(setters) {
  if (!canRedo()) return null;
  _state = { ..._state, head: _state.head + 1 };
  writeLS(_state);
  const node = _state.nodes[_state.head];
  applySnapshot(node.after, setters);
  return node;
}

export function listOps() { return _state.nodes.slice(); }
export function headIndex() { return _state.head; }
export function clearGraph() {
  _state = { nodes: [], head: -1 };
  writeLS(_state);
}

function serialize(snap) {
  // Strip non-serialisable fields (THREE.BufferGeometry refs etc).
  const cleanBodies = (snap.bodies || []).map((b) => ({
    id: b.id, kind: b.kind, handle: b.handle, spec: b.spec,
    toolId: b.toolId, params: b.params, name: b.name,
    instanceTag: b.instanceTag,
  }));
  const cleanTree = (snap.featureTree || []).map((n) => ({
    id: n.id, label: n.label, icon: n.icon, params: n.params,
    suppressed: !!n.suppressed,
  }));
  return { bodies: cleanBodies, featureTree: cleanTree };
}

function applySnapshot(snap, { setBodies, setFeatureTree }) {
  setBodies?.(snap.bodies);
  setFeatureTree?.(snap.featureTree);
}
