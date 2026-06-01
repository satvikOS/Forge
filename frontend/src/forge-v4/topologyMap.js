// Forge-140 — topology-naming persistence.
//
// OCCT does not guarantee that edge/face IDs survive a regenerate(). When
// the user fillets edge #7 of a body, then re-runs the upstream extrude
// with a different distance, edge #7 may now refer to a different edge —
// or be gone. The dependent fillet then either fails or fillets the wrong
// edge.
//
// This module gives every selectable entity (edge, face, vertex) a
// content-derived hash key that's stable across regen, by recording its
// position + adjacency fingerprint. On regen, dependents look up the
// nearest matching topology by hash (exact → fuzzy fallback).
//
// The map persists into the .forge project file (via projectFile.js).

const LS = 'forge.v4.topology';

const _table = new Map();   // bodyId → Map<entityKey, fingerprint>
let _dirty = false;

function rehydrate() {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return;
    for (const [bodyId, byKey] of Object.entries(data)) {
      const m = new Map();
      for (const [k, v] of Object.entries(byKey)) m.set(k, v);
      _table.set(bodyId, m);
    }
  } catch (err) {
    console.warn('[forge.v4.topology] rehydrate failed:', err.message);
  }
}
rehydrate();

function persist() {
  if (!_dirty || typeof localStorage === 'undefined') return;
  try {
    const data = {};
    for (const [bodyId, byKey] of _table.entries()) {
      data[bodyId] = Object.fromEntries(byKey);
    }
    localStorage.setItem(LS, JSON.stringify(data));
    _dirty = false;
  } catch (err) {
    console.warn('[forge.v4.topology] persist failed:', err.message);
  }
}

/**
 * Capture the topology fingerprint of a body and store it under bodyId.
 * Fingerprint = per-entity { centroid:[x,y,z], adjacentCount, length?, area? }.
 *
 * @param {string} bodyId
 * @param {object} entities — { edges:[{id, centroid, length, neighbors:[ids]}],
 *                              faces:[{id, centroid, area, neighbors:[ids]}],
 *                              vertices:[{id, pos, neighbors:[ids]}] }
 */
export function captureTopology(bodyId, entities) {
  const byKey = new Map();
  for (const e of entities.edges || []) {
    byKey.set(`edge:${e.id}`, {
      kind: 'edge',
      centroid: e.centroid,
      length: e.length,
      neigh: (e.neighbors || []).length,
      hash: hashEdge(e),
    });
  }
  for (const f of entities.faces || []) {
    byKey.set(`face:${f.id}`, {
      kind: 'face',
      centroid: f.centroid,
      area: f.area,
      neigh: (f.neighbors || []).length,
      hash: hashFace(f),
    });
  }
  for (const v of entities.vertices || []) {
    byKey.set(`vertex:${v.id}`, {
      kind: 'vertex',
      pos: v.pos,
      neigh: (v.neighbors || []).length,
      hash: hashVertex(v),
    });
  }
  _table.set(bodyId, byKey);
  _dirty = true;
  persist();
  return byKey.size;
}

/**
 * Resolve a stored entity key against the current topology of bodyId
 * after a regen. Strategy:
 *   1. exact match on hash
 *   2. closest by centroid within 1mm tolerance
 *   3. closest by centroid (any distance) with adjacency-count match
 *   4. null — caller surfaces an error toast
 *
 * @param {string} bodyId
 * @param {string} entityKey  e.g. 'edge:7'
 * @param {object} currentEntities  same shape as captureTopology input
 * @returns {string|null}  new entityKey under the regenerated body
 */
export function resolveEntity(bodyId, entityKey, currentEntities) {
  const stored = _table.get(bodyId)?.get(entityKey);
  if (!stored) return null;
  const candidates = stored.kind === 'edge' ? (currentEntities.edges || [])
                  : stored.kind === 'face' ? (currentEntities.faces || [])
                  : (currentEntities.vertices || []);
  if (!candidates.length) return null;
  // 1) exact hash
  for (const c of candidates) {
    const h = stored.kind === 'edge' ? hashEdge(c)
            : stored.kind === 'face' ? hashFace(c)
            : hashVertex(c);
    if (h === stored.hash) return `${stored.kind}:${c.id}`;
  }
  // 2) centroid + adjacency-count match within 1mm
  let bestId = null;
  let bestD = Infinity;
  const sc = stored.centroid || stored.pos;
  for (const c of candidates) {
    const cc = c.centroid || c.pos;
    if (!sc || !cc) continue;
    const d = dist3(sc, cc);
    if (d < 1.0 && (c.neighbors?.length ?? 0) === stored.neigh && d < bestD) {
      bestD = d;
      bestId = c.id;
    }
  }
  if (bestId != null) return `${stored.kind}:${bestId}`;
  // 3) closest centroid with matching adjacency
  for (const c of candidates) {
    const cc = c.centroid || c.pos;
    if (!sc || !cc) continue;
    const d = dist3(sc, cc);
    if ((c.neighbors?.length ?? 0) === stored.neigh && d < bestD) {
      bestD = d;
      bestId = c.id;
    }
  }
  if (bestId != null) return `${stored.kind}:${bestId}`;
  return null;
}

export function clearTopology(bodyId) {
  _table.delete(bodyId);
  _dirty = true;
  persist();
}

export function topologySnapshot() {
  const out = {};
  for (const [bodyId, byKey] of _table.entries()) {
    out[bodyId] = Object.fromEntries(byKey);
  }
  return out;
}

export function restoreTopologySnapshot(snap) {
  _table.clear();
  if (snap && typeof snap === 'object') {
    for (const [bodyId, byKey] of Object.entries(snap)) {
      const m = new Map();
      for (const [k, v] of Object.entries(byKey)) m.set(k, v);
      _table.set(bodyId, m);
    }
  }
  _dirty = true;
  persist();
}

// ---------------------------------------------------------- hash helpers
function hashEdge(e) {
  // Edge hash = centroid (mm × 1000 rounded) + length (× 1000 rounded)
  // + sorted adjacent-face-count signature.
  const c = e.centroid || [0, 0, 0];
  return [
    Math.round(c[0] * 1000),
    Math.round(c[1] * 1000),
    Math.round(c[2] * 1000),
    Math.round((e.length || 0) * 1000),
    (e.neighbors || []).length,
  ].join('|');
}

function hashFace(f) {
  const c = f.centroid || [0, 0, 0];
  return [
    Math.round(c[0] * 1000),
    Math.round(c[1] * 1000),
    Math.round(c[2] * 1000),
    Math.round((f.area || 0) * 1000),
    (f.neighbors || []).length,
  ].join('|');
}

function hashVertex(v) {
  const p = v.pos || [0, 0, 0];
  return [
    Math.round(p[0] * 1000),
    Math.round(p[1] * 1000),
    Math.round(p[2] * 1000),
    (v.neighbors || []).length,
  ].join('|');
}

function dist3(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}
