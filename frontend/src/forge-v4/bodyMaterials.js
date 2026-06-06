// PUSH-61 — Persistent body→material assignments.
//
// Shared bookkeeping for the per-body material choice. PUSH-60 introduced
// a `window.__forgeBodyMaterials` Map (memory-only) which the BOM panel
// wrote into when a row's material dropdown changed. That worked but the
// state vanished on every reload, and the MassPropsPanel had no way to
// see the BOM's choice — both surfaces shipped their own local steel
// default.
//
// This helper centralises the assignments behind a single localStorage
// key (`forge.v4.bodyMaterials`) and a small event bus so every surface
// (MassProps, BOM, MaterialsBrowser) stays in sync without any of them
// owning the source of truth.
//
//   getBodyMaterial(handle)             — reads the persisted assignment
//                                         (defaults to 'steel')
//   setBodyMaterial(handle, material)   — writes + emits
//                                         'forge:material-applied'
//   subscribe(cb)                       — listens; returns unsubscribe
//   getAllBodyMaterials()               — snapshot for debug + browser UI
//   clearBodyMaterials()                — test-side reset
//
// Persistence layout (JSON in localStorage):
//   {
//     "h:42":  "aluminum",
//     "h:108": "titanium",
//     ...
//   }
//
// The keys are deliberately namespaced (`h:<handle>` for native kernel
// handles, `id:<bodyId>` as a fallback for synthetic bodies that don't
// have a kernel handle yet) so a future entity model can extend the
// scheme without colliding with handles.
//
// The helper also mirrors every write into the legacy
// `window.__forgeBodyMaterials` Map so the PUSH-60 BomPanel's existing
// "persisted body materials" assertion (it iterates the Map directly)
// keeps working unchanged.

const STORAGE_KEY = 'forge.v4.bodyMaterials';
const DEFAULT_MATERIAL = 'steel';
const EVENT_NAME = 'forge:material-applied';

// ─────────────────────────────────────────────────────────────────────
// Key derivation. A body handle can arrive as either:
//   - a primitive number (the kernel handle)
//   - a body object   { handle, id, ... }
// The BOM panel passes the body object; the MassProps panel and the
// MaterialsBrowser panel pass either. We normalise to a string key.

function deriveKey(handleOrBody) {
  if (handleOrBody == null) return null;
  if (typeof handleOrBody === 'number' && Number.isFinite(handleOrBody)) {
    return `h:${handleOrBody}`;
  }
  if (typeof handleOrBody === 'string' && handleOrBody.length > 0) {
    // Already a fully-qualified key — pass through.
    if (handleOrBody.startsWith('h:') || handleOrBody.startsWith('id:')) {
      return handleOrBody;
    }
    return `id:${handleOrBody}`;
  }
  if (typeof handleOrBody === 'object') {
    if (typeof handleOrBody.handle === 'number' && Number.isFinite(handleOrBody.handle)) {
      return `h:${handleOrBody.handle}`;
    }
    if (handleOrBody.id != null) return `id:${handleOrBody.id}`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Storage layer. We keep an in-memory cache to avoid re-parsing
// localStorage on every read (the BOM panel re-builds rows on every
// render — without the cache that's a parse per row per render).

let cache = null;
let cacheLoaded = false;

function load() {
  if (cacheLoaded) return cache;
  cacheLoaded = true;
  cache = Object.create(null);
  if (typeof window === 'undefined' || !window.localStorage) {
    return cache;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (typeof raw === 'string' && raw.length > 0) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof k === 'string' && typeof v === 'string') cache[k] = v;
        }
      }
    }
  } catch (err) {
    // Corrupt localStorage payload — discard, start fresh. We deliberately
    // do not throw: the user shouldn't lose a session because a previous
    // crash truncated the JSON.
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[forge.bodyMaterials] failed to read localStorage:', err.message);
    }
  }
  // Seed the legacy Map mirror with whatever we just loaded.
  syncLegacyMap();
  return cache;
}

function persist() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache || {}));
  } catch (err) {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[forge.bodyMaterials] failed to persist localStorage:', err.message);
    }
  }
}

// Mirror the cache into the legacy PUSH-60 Map so any code that reads
// `window.__forgeBodyMaterials` directly (the BOM panel's persistence
// assertion in push-60-bom-csv.spec.js does this) still sees the
// authoritative set.
function syncLegacyMap() {
  if (typeof window === 'undefined') return;
  if (!(window.__forgeBodyMaterials instanceof Map)) {
    window.__forgeBodyMaterials = new Map();
  }
  // Don't blow the Map away — merge so callers that hold a reference
  // still see live data. Remove any stale keys that aren't in the
  // canonical cache.
  const map = window.__forgeBodyMaterials;
  for (const [k] of map) {
    if (!(k in cache)) map.delete(k);
  }
  for (const [k, v] of Object.entries(cache)) {
    map.set(k, v);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Subscriber bus. Plain Set of callbacks + a window CustomEvent so both
// React (via useEffect addEventListener) and non-React callers (e.g. a
// future kernel watcher) can wire up.

const subscribers = new Set();

function emitChange(key, material, detail = {}) {
  if (typeof window === 'undefined') return;
  const event = new CustomEvent(EVENT_NAME, {
    detail: { key, material, ...detail },
  });
  try {
    window.dispatchEvent(event);
  } catch (err) {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[forge.bodyMaterials] dispatch failed:', err.message);
    }
  }
  for (const cb of Array.from(subscribers)) {
    try { cb({ key, material, ...detail }); }
    catch (err) {
      if (typeof console !== 'undefined') {
        // eslint-disable-next-line no-console
        console.warn('[forge.bodyMaterials] subscriber threw:', err.message);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public API.

export function getBodyMaterial(handleOrBody) {
  const key = deriveKey(handleOrBody);
  if (key == null) return DEFAULT_MATERIAL;
  const map = load();
  return map[key] || DEFAULT_MATERIAL;
}

export function setBodyMaterial(handleOrBody, material) {
  if (typeof material !== 'string' || material.length === 0) return false;
  const key = deriveKey(handleOrBody);
  if (key == null) return false;
  const map = load();
  const prev = map[key] || DEFAULT_MATERIAL;
  if (prev === material) {
    // Still emit so out-of-sync subscribers can rehydrate; the BOM panel
    // explicitly re-renders on every emit to pick up a programmatic
    // setBodyMaterial from a sibling panel.
    syncLegacyMap();
    emitChange(key, material, { prev, unchanged: true });
    return true;
  }
  map[key] = material;
  persist();
  syncLegacyMap();
  emitChange(key, material, { prev });
  return true;
}

export function subscribe(cb) {
  if (typeof cb !== 'function') return () => {};
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

export function getAllBodyMaterials() {
  const map = load();
  // Return a plain object copy so callers can't mutate the cache.
  return { ...map };
}

export function clearBodyMaterials() {
  cache = Object.create(null);
  cacheLoaded = true;
  persist();
  if (typeof window !== 'undefined' && window.__forgeBodyMaterials instanceof Map) {
    window.__forgeBodyMaterials.clear();
  }
  emitChange(null, null, { cleared: true });
}

// Public-facing key derivation — exposed for the MaterialsBrowserPanel
// so it can render a deterministic table indexed by handle.
export function bodyMaterialKey(handleOrBody) {
  return deriveKey(handleOrBody);
}

// ─────────────────────────────────────────────────────────────────────
// Bootstrap on module load. Calling load() now means the legacy Map is
// rehydrated before any panel mounts — otherwise a stale Map from the
// previous test would still be empty until the first read.

load();

// Expose a small debug surface on window so the e2e specs can inspect /
// reset persisted state without importing the module.
if (typeof window !== 'undefined') {
  window.__forgeBodyMaterialsHelper = Object.freeze({
    getBodyMaterial,
    setBodyMaterial,
    subscribe,
    getAllBodyMaterials,
    clearBodyMaterials,
    bodyMaterialKey,
    STORAGE_KEY,
    EVENT_NAME,
  });
}

export const FORGE_BODY_MATERIALS_STORAGE_KEY = STORAGE_KEY;
export const FORGE_BODY_MATERIALS_EVENT = EVENT_NAME;
export const FORGE_DEFAULT_MATERIAL = DEFAULT_MATERIAL;
