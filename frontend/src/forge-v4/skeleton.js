// Forge-123 — parametric master skeleton.
//
// The skeleton is a scene-wide registry of named geometric references
// (points, axes, planes, lines) that downstream features can depend on.
// Editing a skeleton entity invalidates every feature whose params carry
// a `{ skelRef: '<name>' }` reference, so the regen pass in
// ForgeShellV4.regenerate() can rebuild from a single source of truth.
//
// Persisted to localStorage under `forge.v4.skeleton`. The shape is
// kept JSON-trivial (plain objects + number arrays) so we can survive
// a reload + .forge round-trip without a custom serializer.

const STORAGE_KEY = 'forge.v4.skeleton';

/** Build a fresh skeleton with the canonical world references. */
export function defaultSkeleton() {
  return {
    points: {
      ORIGIN: [0, 0, 0],
      P1:     [10, 0, 0],
      P2:     [0, 10, 0],
      P3:     [0, 0, 10],
    },
    axes: {
      X: { origin: [0, 0, 0], dir: [1, 0, 0] },
      Y: { origin: [0, 0, 0], dir: [0, 1, 0] },
      Z: { origin: [0, 0, 0], dir: [0, 0, 1] },
    },
    planes: {
      XY: { origin: [0, 0, 0], normal: [0, 0, 1] },
      YZ: { origin: [0, 0, 0], normal: [1, 0, 0] },
      XZ: { origin: [0, 0, 0], normal: [0, 1, 0] },
    },
    lines: {},
  };
}

/** Valid entity kinds — used as guards across set/resolve/dependents. */
export const KINDS = ['points', 'axes', 'planes', 'lines'];

/**
 * Set (or replace) an entity in the skeleton. Returns a NEW skeleton
 * object — never mutates the input. Caller can then persist + dispatch.
 *
 * @param {object} skel  current skeleton
 * @param {string} kind  'points' | 'axes' | 'planes' | 'lines'
 * @param {string} name  entity name (e.g. 'P_TEST')
 * @param {*}      value point: [x,y,z]; axis: { origin, dir };
 *                       plane: { origin, normal }; line: { a, b }
 */
export function setEntity(skel, kind, name, value) {
  if (!KINDS.includes(kind)) {
    throw new Error(`skeleton.setEntity: invalid kind '${kind}'`);
  }
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('skeleton.setEntity: name must be a non-empty string');
  }
  const base = skel || defaultSkeleton();
  const next = {
    points: { ...(base.points || {}) },
    axes:   { ...(base.axes   || {}) },
    planes: { ...(base.planes || {}) },
    lines:  { ...(base.lines  || {}) },
  };
  if (value === undefined || value === null) {
    delete next[kind][name];
  } else {
    next[kind][name] = value;
  }
  return next;
}

/**
 * Remove an entity by kind + name. Convenience wrapper around setEntity
 * for the panel's delete button.
 */
export function removeEntity(skel, kind, name) {
  return setEntity(skel, kind, name, null);
}

/**
 * Resolve a reference. Accepts either:
 *   - a string name → searches points first, then lines, axes, planes
 *   - an object { kind: 'point'|'axis'|'plane'|'line', name: 'P1' }
 *     where kind is singular (matches the natural language form params
 *     carry — e.g. `{ skelRef: { kind: 'point', name: 'P_TEST' } }`).
 *
 * Returns the stored value (e.g. [x,y,z] for a point) or null when
 * not found. Callers must handle the null case (the dispatch path
 * leaves the original ref in place so we don't silently drop edits).
 */
export function resolveRef(skel, ref) {
  if (!skel || ref == null) return null;
  if (typeof ref === 'string') {
    if (skel.points?.[ref] != null) return skel.points[ref];
    if (skel.lines?.[ref]  != null) return skel.lines[ref];
    if (skel.axes?.[ref]   != null) return skel.axes[ref];
    if (skel.planes?.[ref] != null) return skel.planes[ref];
    return null;
  }
  if (typeof ref === 'object') {
    const kindMap = { point: 'points', axis: 'axes', plane: 'planes', line: 'lines' };
    const bucket = kindMap[ref.kind] || (KINDS.includes(ref.kind) ? ref.kind : null);
    if (!bucket || typeof ref.name !== 'string') return null;
    return skel[bucket]?.[ref.name] ?? null;
  }
  return null;
}

/**
 * Walk a feature tree finding every feature whose params (deeply) carry
 * a `{ skelRef: '<name>' }` or `{ skelRef: { kind, name } }` matching
 * the given (kind, name) pair. Returns the matching feature ids in
 * tree order — the right panel's "Dependents: N" badge consumes this.
 *
 * Implementation note: we walk arbitrary param shapes (nested objects,
 * arrays) because real-world feature params often nest refs under
 * `position`, `axis`, etc. Cycle-safety is not required because params
 * come from JSON serialization.
 */
export function entitiesDependentOn(featureTree, kind, name) {
  if (!Array.isArray(featureTree)) return [];
  const wantBucket = kind;                                  // 'points', …
  const singular = { points: 'point', axes: 'axis',
                     planes: 'plane', lines: 'line' }[kind] || kind;
  const ids = [];
  for (const f of featureTree) {
    if (!f || !f.params) continue;
    if (paramsReference(f.params, wantBucket, singular, name)) {
      ids.push(f.id);
    }
  }
  return ids;
}

function paramsReference(node, wantBucket, singular, name) {
  if (node == null) return false;
  if (Array.isArray(node)) {
    for (const v of node) {
      if (paramsReference(v, wantBucket, singular, name)) return true;
    }
    return false;
  }
  if (typeof node !== 'object') return false;
  // Shorthand: { skelRef: 'P1' } — string match wins for ANY kind because
  // the resolver searches all buckets.
  if (typeof node.skelRef === 'string' && node.skelRef === name) return true;
  // Structured: { skelRef: { kind: 'point', name: 'P1' } }
  if (node.skelRef && typeof node.skelRef === 'object') {
    const k = node.skelRef.kind;
    if (typeof k === 'string' &&
        (k === singular || k === wantBucket) &&
        node.skelRef.name === name) {
      return true;
    }
  }
  // Recurse into nested params.
  for (const k of Object.keys(node)) {
    if (k === 'skelRef') continue;
    if (paramsReference(node[k], wantBucket, singular, name)) return true;
  }
  return false;
}

/** Load the persisted skeleton, or build a fresh one if missing/broken. */
export function loadSkeleton() {
  if (typeof localStorage === 'undefined') return defaultSkeleton();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSkeleton();
    const parsed = JSON.parse(raw);
    // Backfill missing buckets so older payloads keep working after we
    // add new kinds (lines arrived after the initial release).
    return {
      points: parsed.points || {},
      axes:   parsed.axes   || {},
      planes: parsed.planes || {},
      lines:  parsed.lines  || {},
    };
  } catch {
    return defaultSkeleton();
  }
}

/** Persist the skeleton to localStorage. Silent on failure. */
export function saveSkeleton(skel) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(skel)); } catch {}
}

export const SKELETON_STORAGE_KEY = STORAGE_KEY;
