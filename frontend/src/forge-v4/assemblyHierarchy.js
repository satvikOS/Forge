// Forge-101 — Nested assembly hierarchy.
//
// Maintains a tree of instances on top of the body registry. Each instance
// references a body by id, has an optional parent (for sub-assemblies),
// carries a local 4×4 column-major transform and a multiplicity (qty).
// The local cache reconciles with the native OCCT bridge whenever
// window.forge.assembly.* is available — the cache is the source of
// truth when the kernel hasn't loaded yet, so the UI can render the
// hierarchy in either mode.
//
// Persistence: forge.v4.assemblyTree (matches the existing forge.v4.*
// localStorage pattern used by ConfigurationsPanel + QuickAccessBar).
//
// Pure dispatch — no React, no DOM, no Archie-thread writes.

const LS_KEY = 'forge.v4.assemblyTree';

// 4×4 column-major identity. We deliberately use a flat Array (not a
// Float32Array) so JSON round-trips and structuredClone both work.
export const IDENTITY = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

// ─────────────────────────────────────────────────────────────────────
// Module-private state.

let _state = loadState();
let _nextId = computeNextId(_state);

function loadState() {
  if (typeof localStorage === 'undefined') {
    return { instances: {}, rootIds: [] };
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { instances: {}, rootIds: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { instances: {}, rootIds: [] };
    }
    parsed.instances = parsed.instances || {};
    parsed.rootIds = Array.isArray(parsed.rootIds) ? parsed.rootIds : [];
    return parsed;
  } catch {
    return { instances: {}, rootIds: [] };
  }
}

function saveState() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(_state)); } catch {}
}

function computeNextId(state) {
  let max = 0;
  for (const id of Object.keys(state.instances || {})) {
    const n = parseInt(id, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

function asm() {
  if (typeof window === 'undefined') return null;
  return window.forge?.assembly || null;
}

// ─────────────────────────────────────────────────────────────────────
// Public API.

/**
 * Create a fresh instance and append it to the tree.
 * Returns the instance record `{ id, bodyId, parentId, transform, name, qty }`.
 */
export function createInstance({
  bodyId,
  parentId = null,
  transform = IDENTITY,
  name = null,
  qty = 1,
} = {}) {
  const id = _nextId++;
  const inst = {
    id,
    bodyId: bodyId ?? null,
    parentId: parentId == null ? null : parentId,
    transform: Array.isArray(transform) && transform.length === 16
      ? transform.slice()
      : IDENTITY.slice(),
    name: name || `Instance ${id}`,
    qty: Math.max(1, Math.floor(qty || 1)),
  };
  _state.instances[id] = inst;
  if (inst.parentId == null) {
    _state.rootIds.push(id);
  }
  saveState();

  const A = asm();
  if (A?.createInstance) {
    try {
      A.createInstance(id, {
        bodyId: inst.bodyId,
        parentId: inst.parentId ?? 0,
        transform: inst.transform,
        name: inst.name,
        qty: inst.qty,
      });
    } catch (err) {
      // Soft-fail: the cache still tracks the instance.
      console.warn('[forge.v4.assemblyTree] kernel.createInstance threw:', err.message);
    }
  }
  return inst;
}

/**
 * Reparent a child instance. Pass `parentId = null` to promote to root.
 * Mirrors the change into the kernel when available.
 */
export function setParent(childId, parentId) {
  const child = _state.instances[childId];
  if (!child) return { ok: false, error: `no instance ${childId}` };
  if (childId === parentId) return { ok: false, error: 'cannot parent to self' };
  if (parentId != null && wouldCycle(childId, parentId)) {
    return { ok: false, error: 'would cycle' };
  }

  // Remove from old parent's root entry if needed.
  if (child.parentId == null) {
    _state.rootIds = _state.rootIds.filter((id) => id !== childId);
  }
  child.parentId = parentId == null ? null : parentId;
  if (child.parentId == null && !_state.rootIds.includes(childId)) {
    _state.rootIds.push(childId);
  }
  saveState();

  const A = asm();
  if (A?.setParent) {
    try { A.setParent(childId, parentId ?? 0); }
    catch (err) {
      console.warn('[forge.v4.assemblyTree] kernel.setParent threw:', err.message);
      return { ok: false, error: err.message };
    }
  }
  return { ok: true };
}

/**
 * Children of `parentId` (pass `null` or `0` for root).
 * Reconciles with `window.forge.assembly.getChildren` when present —
 * any kernel-side child the cache doesn't know about gets stubbed in.
 */
export function getChildren(parentId) {
  const local = Object.values(_state.instances).filter((i) => {
    const want = parentId == null || parentId === 0 ? null : parentId;
    const have = i.parentId == null ? null : i.parentId;
    return have === want;
  });
  const A = asm();
  if (A?.getChildren) {
    try {
      const kernelIds = A.getChildren(parentId ?? 0);
      if (Array.isArray(kernelIds)) {
        const known = new Set(local.map((l) => l.id));
        for (const kid of kernelIds) {
          if (!known.has(kid)) {
            const stub = {
              id: kid,
              bodyId: null,
              parentId: parentId == null ? null : parentId,
              transform: IDENTITY.slice(),
              name: `Instance ${kid}`,
              qty: 1,
            };
            _state.instances[kid] = stub;
            local.push(stub);
          }
        }
      }
    } catch (err) {
      console.warn('[forge.v4.assemblyTree] kernel.getChildren threw:', err.message);
    }
  }
  // Sort by id for deterministic ordering.
  local.sort((a, b) => a.id - b.id);
  return local;
}

/**
 * BFS walk of the subtree rooted at `rootId`. Visitor receives
 * `(instance, depth)` — returning `false` halts the walk.
 */
export function walkTree(rootId, visitor) {
  if (typeof visitor !== 'function') return;
  if (rootId == null || rootId === 0) {
    // Walk every root subtree.
    const queue = _state.rootIds
      .map((id) => ({ id, depth: 0 }))
      .filter((x) => _state.instances[x.id]);
    return bfs(queue, visitor);
  }
  if (!_state.instances[rootId]) return;
  return bfs([{ id: rootId, depth: 0 }], visitor);
}

function bfs(queue, visitor) {
  while (queue.length) {
    const { id, depth } = queue.shift();
    const inst = _state.instances[id];
    if (!inst) continue;
    const cont = visitor(inst, depth);
    if (cont === false) return;
    const kids = getChildren(id);
    for (const k of kids) queue.push({ id: k.id, depth: depth + 1 });
  }
}

/**
 * Composed world transform for an instance, walking up through parents.
 * Returns a freshly-allocated 4×4 column-major array.
 * Refreshes from kernel.worldTransform when available.
 */
export function worldTransform(instanceId) {
  const A = asm();
  if (A?.worldTransform) {
    try {
      const m = A.worldTransform(instanceId);
      if (Array.isArray(m) && m.length === 16) {
        const inst = _state.instances[instanceId];
        if (inst) inst._worldCache = m.slice();
        return m.slice();
      }
    } catch (err) {
      console.warn('[forge.v4.assemblyTree] kernel.worldTransform threw:', err.message);
    }
  }
  return composeUp(instanceId);
}

function composeUp(instanceId) {
  const stack = [];
  let cur = _state.instances[instanceId];
  while (cur) {
    stack.push(cur.transform || IDENTITY);
    if (cur.parentId == null) break;
    cur = _state.instances[cur.parentId];
  }
  let m = IDENTITY.slice();
  for (let i = stack.length - 1; i >= 0; i--) {
    m = mul4(m, stack[i]);
  }
  return m;
}

/** Column-major 4×4 matrix multiply: returns A * B. */
function mul4(A, B) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += A[k * 4 + r] * B[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/**
 * Combined axis-aligned bounding box of every instance in a subassembly.
 * Returns `{ min:[x,y,z], max:[x,y,z], empty:false }` or `{ empty:true }`.
 *
 * Per-instance bounds are pulled from window.forge.bounds(bodyHandle)
 * when available; otherwise the bbox of `body.spec` is used; otherwise
 * a 25 mm cube around the instance's world origin.
 */
export function subassemblyBounds(rootId, bodies = []) {
  const bodyById = new Map();
  for (const b of bodies || []) bodyById.set(b.id, b);

  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  let any = false;

  walkTree(rootId, (inst) => {
    const body = bodyById.get(inst.bodyId);
    const local = localBoundsForBody(body);
    if (!local) return;
    const world = worldTransform(inst.id);
    // 8 corners of the local bbox transformed to world.
    for (let i = 0; i < 8; i++) {
      const lx = (i & 1) ? local.max[0] : local.min[0];
      const ly = (i & 2) ? local.max[1] : local.min[1];
      const lz = (i & 4) ? local.max[2] : local.min[2];
      const wx = world[0] * lx + world[4] * ly + world[8]  * lz + world[12];
      const wy = world[1] * lx + world[5] * ly + world[9]  * lz + world[13];
      const wz = world[2] * lx + world[6] * ly + world[10] * lz + world[14];
      if (wx < mn[0]) mn[0] = wx; if (wy < mn[1]) mn[1] = wy; if (wz < mn[2]) mn[2] = wz;
      if (wx > mx[0]) mx[0] = wx; if (wy > mx[1]) mx[1] = wy; if (wz > mx[2]) mx[2] = wz;
      any = true;
    }
  });
  if (!any) return { empty: true, min: [0, 0, 0], max: [0, 0, 0] };
  return { empty: false, min: mn, max: mx };
}

function localBoundsForBody(body) {
  if (!body) return null;
  // 1) Try the kernel.
  if (typeof window !== 'undefined' && typeof body.handle === 'number') {
    const fn = window.forge?.bounds || window.forge?.boundingBox;
    if (typeof fn === 'function') {
      try {
        const b = fn(body.handle);
        if (b && Array.isArray(b.min) && Array.isArray(b.max)) {
          return { min: b.min.slice(0, 3), max: b.max.slice(0, 3) };
        }
      } catch { /* fall through */ }
    }
  }
  // 2) Spec geometry.
  const s = body.spec;
  if (s) {
    if (typeof s.dx === 'number' && typeof s.dy === 'number' && typeof s.dz === 'number') {
      return { min: [-s.dx / 2, -s.dy / 2, 0], max: [s.dx / 2, s.dy / 2, s.dz] };
    }
    if (typeof s.r === 'number' && typeof s.h === 'number') {
      return { min: [-s.r, -s.r, 0], max: [s.r, s.r, s.h] };
    }
    if (typeof s.R === 'number' && typeof s.r === 'number') {
      const o = s.R + s.r;
      return { min: [-o, -o, -s.r], max: [o, o, s.r] };
    }
  }
  // 3) 25 mm cube fallback.
  return { min: [-12.5, -12.5, 0], max: [12.5, 12.5, 25] };
}

// ─────────────────────────────────────────────────────────────────────
// Mutation helpers used by the panel.

export function getInstance(id) { return _state.instances[id] || null; }
export function listInstances() { return Object.values(_state.instances); }
export function listRoots() { return _state.rootIds.slice(); }

export function renameInstance(id, name) {
  const inst = _state.instances[id];
  if (!inst) return { ok: false, error: 'no instance' };
  inst.name = String(name || '').slice(0, 80) || `Instance ${id}`;
  saveState();
  return { ok: true };
}

export function deleteInstance(id) {
  const inst = _state.instances[id];
  if (!inst) return { ok: false, error: 'no instance' };
  // Promote orphans to root so they aren't lost.
  for (const child of Object.values(_state.instances)) {
    if (child.parentId === id) {
      child.parentId = null;
      if (!_state.rootIds.includes(child.id)) _state.rootIds.push(child.id);
    }
  }
  delete _state.instances[id];
  _state.rootIds = _state.rootIds.filter((rid) => rid !== id);
  saveState();
  const A = asm();
  if (A?.removeInstance) { try { A.removeInstance(id); } catch {} }
  return { ok: true };
}

export function setVisibility(id, kind, on) {
  const inst = _state.instances[id];
  if (!inst) return { ok: false, error: 'no instance' };
  if (kind === 'hidden') inst.hidden = !!on;
  if (kind === 'suppressed') inst.suppressed = !!on;
  if (kind === 'isolated') inst.isolated = !!on;
  saveState();
  return { ok: true };
}

export function isolate(id) {
  for (const i of Object.values(_state.instances)) i.isolated = false;
  const inst = _state.instances[id];
  if (!inst) return { ok: false, error: 'no instance' };
  inst.isolated = true;
  saveState();
  return { ok: true };
}

/** Test-only: wipe everything. */
export function _resetForTests() {
  _state = { instances: {}, rootIds: [] };
  _nextId = 1;
  saveState();
}

function wouldCycle(childId, candidateParent) {
  let cur = _state.instances[candidateParent];
  let guard = 0;
  while (cur && guard++ < 1000) {
    if (cur.id === childId) return true;
    if (cur.parentId == null) return false;
    cur = _state.instances[cur.parentId];
  }
  return false;
}
