// PUSH-163 (Slice 119) — BREP binary cache (streamed load for 100k-part
// assemblies).
//
// At 100k parts the in-memory authoring model OCCT keeps balloons out of
// the renderer's reach; restoring a session by re-running every feature
// is a non-starter. The PUSH-163 strategy:
//
//   1. SAVE  — for every native body in the scene, ask the kernel to
//      write its OCCT TopoDS_Shape to a BREP ASCII file on disk via
//      `forge.io.exportBrep(handle, /tmp/...)`. We read the bytes back
//      into the renderer, stage them inside a single JSZip archive at
//      `brep/<id>.brep`, append a `manifest.json` index, then ship the
//      archive bytes to disk via `forge.dialog.writeBlob`.
//
//   2. LOAD  — read the .forgeCache.zip back from disk via
//      `fetch('file://…')`, parse with `JSZip.loadAsync`, and for each
//      body the manifest names: stage the BREP bytes back in /tmp via
//      writeBlob, call `forge.io.importBrep(tmpPath) → handle`, and
//      append the resulting body to `window.__forgeBodies` via
//      `window.__forgeAppendBody`. Volumes are sampled before
//      writeBlob (via forge.massProps) and re-verified after the
//      import so the e2e can assert round-trip parity.
//
// Pure functions — no React, no DOM. All side effects (forge kernel
// calls + fetch + JSZip) flow through callbacks passed in from the
// panel + e2e so the pipeline stays headlessly drivable.

import JSZip from 'jszip';

const FORGE_CACHE_VERSION = '1.0.0';
const FORGE_CACHE_KIND    = 'forge.brepCache';

// ─────────────────────────────────────────────────────────────────────
// Helpers.

function safeName(s) {
  return String(s ?? 'untitled')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'untitled';
}

function isoNow() {
  return new Date().toISOString();
}

function tmpBrepPath(id) {
  const r = Math.random().toString(36).slice(2, 8);
  return `/tmp/forge-brepcache-${Date.now()}-${safeName(String(id))}-${r}.brep`;
}

async function readFileBytes(filepath) {
  if (typeof fetch !== 'function') {
    throw new Error('readFileBytes: fetch unavailable');
  }
  const url = filepath.startsWith('file://') ? filepath : `file://${filepath}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${filepath} → ${r.status}`);
  const buf = await r.arrayBuffer();
  return new Uint8Array(buf);
}

async function writeTmpBlob(bytes, id) {
  const forge = (typeof window !== 'undefined') ? window.forge : null;
  if (!forge?.dialog?.writeBlob) {
    throw new Error('writeBlob bridge missing');
  }
  const tp = tmpBrepPath(id);
  const r = await forge.dialog.writeBlob(tp, bytes);
  if (!r?.ok) throw new Error(r?.error || 'writeBlob failed');
  return r.path;
}

function readBodyVolume(handle) {
  if (typeof window === 'undefined' || typeof handle !== 'number') return null;
  const mp = window.forge?.massProps;
  if (typeof mp !== 'function') return null;
  try {
    const k = mp(handle);
    if (!k) return null;
    const v = +(k.volume ?? k.Volume ?? 0) || 0;
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public API.

/**
 * Pack every body in `bodies` into a JSZip archive of BREP files +
 * a `manifest.json` index. Returns `{ ok, bytes, archive, manifest,
 * entries, totalBytes }` where `archive` is a `Uint8Array` ready to
 * hand to `forge.dialog.writeBlob`.
 *
 * Per-body steps:
 *   - call `forge.io.exportBrep(handle, /tmp/...)` → BREP ASCII on disk
 *   - read the bytes back via `fetch('file://…')`
 *   - stage at `brep/<id>.brep` inside the ZIP
 *   - record { id, name, brepPath, bytes, volume_mm3, status } in the
 *     manifest so `loadFromCache` can restore exactly the same set.
 *
 * Bodies that aren't native or have no handle are skipped with a
 * recorded `reason`. The function never throws — failures land in the
 * per-entry `status` / `error` field so the panel can render a row.
 */
export async function cacheBodies(bodies, opts = {}) {
  const list = Array.isArray(bodies) ? bodies.filter(Boolean) : [];
  const forge = (typeof window !== 'undefined') ? window.forge : null;

  const zip = new JSZip();
  zip.folder('brep');

  const entries = [];
  let totalBytes = 0;

  for (const b of list) {
    const id   = b.id ?? `body-${entries.length}`;
    const name = b.name || String(id);
    const safeId = safeName(id);

    if (b.kind !== 'native' || typeof b.handle !== 'number') {
      entries.push({
        id, name,
        kind: b.kind || 'unknown',
        status: 'skipped',
        reason: 'no-native-handle',
      });
      continue;
    }
    if (!forge?.io?.exportBrep || !forge?.dialog?.writeBlob) {
      entries.push({
        id, name,
        kind: 'native',
        originalHandle: b.handle,
        status: 'failed',
        error: 'forge.io.exportBrep / writeBlob unavailable',
      });
      continue;
    }
    try {
      // 1) Kernel writes the TopoDS_Shape → BREP ASCII at /tmp/<…>.brep.
      const tp = tmpBrepPath(safeId);
      const r  = forge.io.exportBrep(b.handle, tp);
      if (r === false) {
        throw new Error('forge.io.exportBrep returned false');
      }
      // 2) Read the bytes back into the renderer.
      const bytes = await readFileBytes(tp);
      const zipPath = `brep/${safeId}.brep`;
      zip.file(zipPath, bytes);
      totalBytes += bytes.length;

      // 3) Volume snapshot lets the e2e prove round-trip parity.
      const volume_mm3 = readBodyVolume(b.handle);

      entries.push({
        id, name,
        kind: 'native',
        originalHandle: b.handle,
        brepPath: zipPath,
        bytes:    bytes.length,
        volume_mm3,
        toolId:   b.toolId ?? null,
        params:   b.params ?? null,
        spec:     b.spec   ?? null,
        material: b.material ?? null,
        status:   'ok',
      });
    } catch (err) {
      entries.push({
        id, name,
        kind: 'native',
        originalHandle: b.handle,
        status: 'failed',
        error: err.message,
      });
    }
  }

  const manifest = {
    kind: FORGE_CACHE_KIND,
    forgeCacheVersion: FORGE_CACHE_VERSION,
    savedAt: isoNow(),
    label: opts.label || 'BREP Cache',
    kernel: (() => {
      try { return forge?.version ? forge.version() : null; } catch { return null; }
    })(),
    entries,
    totals: {
      requested: list.length,
      ok:        entries.filter((e) => e.status === 'ok').length,
      failed:    entries.filter((e) => e.status === 'failed').length,
      skipped:   entries.filter((e) => e.status === 'skipped').length,
      bytes:     totalBytes,
    },
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const archive = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return {
    ok: manifest.totals.ok > 0,
    archive,
    archiveBytes: archive.length,
    manifest,
    entries,
    totalBytes,
  };
}

/**
 * Stream every body out of `.forgeCache.zip` and back into the scene.
 *
 * For each manifest entry with `status === 'ok'`:
 *   1. Extract the BREP bytes from the ZIP.
 *   2. Stage them in `/tmp/...` via `forge.dialog.writeBlob`.
 *   3. Call `forge.io.importBrep(tmpPath) → newHandle`.
 *   4. Sample the new volume via `forge.massProps`.
 *   5. Push `{ id, kind:'native', handle: newHandle, … }` to
 *      `window.__forgeAppendBody` so the body lands in the scene
 *      under the same id + name + toolId as it was saved.
 *
 * Returns `{ ok, manifest, restored, errors, handleRemap }` where
 * `restored` is the array of per-body records actually appended to
 * the scene, and `handleRemap` maps `originalHandle → newHandle` for
 * downstream consumers (drawings, BOM, etc).
 *
 * Bodies whose volume mismatches the cached volume by > 1e-3 of the
 * cached value (relative) land in `errors` with kind 'volume-mismatch'
 * — that's the e2e's round-trip integrity assertion.
 */
export async function loadFromCache(filepath, opts = {}) {
  if (!filepath) return { ok: false, error: 'filepath required' };
  const forge = (typeof window !== 'undefined') ? window.forge : null;
  if (!forge?.io?.importBrep) {
    return { ok: false, error: 'forge.io.importBrep unavailable' };
  }
  if (!forge?.dialog?.writeBlob) {
    return { ok: false, error: 'forge.dialog.writeBlob unavailable' };
  }

  let bytes;
  try {
    bytes = await readFileBytes(filepath);
  } catch (err) {
    return { ok: false, error: `read failed: ${err.message}` };
  }
  if (!bytes || bytes.length < 4) {
    return { ok: false, error: 'empty or truncated cache archive' };
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    return { ok: false, error: `not a valid zip: ${err.message}` };
  }

  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) {
    return { ok: false, error: 'manifest.json missing from archive' };
  }
  let manifest;
  try {
    const text = await manifestEntry.async('string');
    manifest = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `manifest.json parse failed: ${err.message}` };
  }
  if (manifest.kind !== FORGE_CACHE_KIND) {
    return { ok: false, error: `unexpected kind: ${manifest.kind}` };
  }

  const restored = [];
  const errors   = [];
  const handleRemap = {};
  const appendBody = (typeof window !== 'undefined')
    ? window.__forgeAppendBody : null;

  for (const e of (manifest.entries || [])) {
    if (!e || e.status !== 'ok' || !e.brepPath) continue;
    const stepEntry = zip.file(e.brepPath);
    if (!stepEntry) {
      errors.push({ id: e.id, kind: 'brep-missing', error: `entry missing: ${e.brepPath}` });
      continue;
    }
    try {
      const brepBytes = await stepEntry.async('uint8array');
      const tp = await writeTmpBlob(brepBytes, e.id);
      const newHandle = forge.io.importBrep(tp);
      if (typeof newHandle !== 'number') {
        errors.push({ id: e.id, kind: 'import-failed', error: 'importBrep returned non-number' });
        continue;
      }
      const newVolume = readBodyVolume(newHandle);
      const cachedVol = (typeof e.volume_mm3 === 'number') ? e.volume_mm3 : null;
      const volumeMatch = (cachedVol != null && newVolume != null)
        ? Math.abs(newVolume - cachedVol) / Math.max(1e-9, Math.abs(cachedVol)) < 1e-3
        : (cachedVol == null && newVolume == null);

      const body = {
        id:      e.id,
        kind:    'native',
        handle:  newHandle,
        name:    e.name || String(e.id),
        toolId:  e.toolId  ?? null,
        params:  e.params  ?? null,
        spec:    e.spec    ?? null,
        material: e.material ?? null,
      };

      if (typeof appendBody === 'function') {
        try { appendBody(body); } catch (err) {
          errors.push({ id: e.id, kind: 'append-failed', error: err.message });
        }
      } else {
        // Fallback for headless callers (no React shell mounted): poke
        // straight into __forgeBodies so loadFromCache stays drivable.
        try {
          if (!Array.isArray(window.__forgeBodies)) window.__forgeBodies = [];
          window.__forgeBodies.push(body);
        } catch { /* ignore */ }
      }

      restored.push({
        id: e.id,
        originalHandle: e.originalHandle ?? null,
        newHandle,
        cachedVolume:   cachedVol,
        restoredVolume: newVolume,
        volumeMatch,
        name: e.name || String(e.id),
        bytes: e.bytes ?? null,
      });
      if (typeof e.originalHandle === 'number') {
        handleRemap[String(e.originalHandle)] = newHandle;
      }
      if (!volumeMatch) {
        errors.push({
          id: e.id, kind: 'volume-mismatch',
          cached: cachedVol, restored: newVolume,
        });
      }
    } catch (err) {
      errors.push({ id: e.id, kind: 'restore-failed', error: err.message });
    }
  }

  return {
    ok: restored.length > 0,
    manifest,
    restored,
    errors,
    handleRemap,
  };
}

export const FORGE_BREP_CACHE_KIND    = FORGE_CACHE_KIND;
export const FORGE_BREP_CACHE_VERSION = FORGE_CACHE_VERSION;

// ─────────────────────────────────────────────────────────────────────
// PUSH-215 (Slice-154) — Active load path.
//
// PUSH-163 caches whole scenes to a single `.forgeCache.zip` on disk.
// PUSH-215 is the *live* path the next-session loader hits: per-body
// BREP bytes kept in an in-memory `Map<id, entry>` (persisted to
// `localStorage` as base64) so reopening a session restores every body
// directly through `forge.io.importBrep` without re-running its
// feature script.
//
// `saveBodyToActiveCache` exports one native body's BREP, reads the
// bytes back, stores the entry, and returns it. `loadBodyFromActiveCache`
// stages the bytes back into `/tmp`, calls `forge.io.importBrep`, and
// returns a fresh body record with the new kernel handle.
//
// Hard rules per the user mandate: NO MVP, NO fallback. If
// `forge.io.exportBrep` / `forge.io.importBrep` is missing on the
// kernel surface, the helpers throw with a real error (not a silent
// no-op) so the panel can render it to the user.

const ACTIVE_LS_KEY        = 'forge.v4.brepCacheActive';
const ACTIVE_CACHE_VERSION = '1.0.0';

function activeBytesToBase64(u8) {
  if (!(u8 instanceof Uint8Array)) return '';
  // Chunked to dodge the JS engine's spread-arg limit on > 100 kB blobs.
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return (typeof btoa === 'function') ? btoa(s) : '';
}

function activeBase64ToBytes(b64) {
  if (!b64) return new Uint8Array(0);
  if (typeof atob !== 'function') return new Uint8Array(0);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

function activeReadLs() {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage?.getItem(ACTIVE_LS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && obj.kind === FORGE_CACHE_KIND) return obj;
    return null;
  } catch { return null; }
}

function activeWriteLs(obj) {
  try {
    if (typeof window === 'undefined') return false;
    window.localStorage?.setItem(ACTIVE_LS_KEY, JSON.stringify(obj));
    return true;
  } catch { return false; }
}

/**
 * In-memory active cache. Keyed by body id; each entry stores the
 * BREP bytes (as Uint8Array) + tracking metadata.
 *
 * Schema per entry:
 *   { id, name, bytes, size_bytes, savedAt, kind, toolId, params, spec,
 *     material, volume_mm3, originalHandle }
 */
const __activeCache = (() => {
  if (typeof window === 'undefined') return new Map();
  // Stash on window so HMR + multiple imports share one source of truth.
  if (!window.__forgeBrepActiveCacheMap) {
    window.__forgeBrepActiveCacheMap = new Map();
    // Rehydrate from localStorage on first import. We decode lazily so
    // the bytes only land in memory if the user opens the panel.
    const ls = activeReadLs();
    if (ls && Array.isArray(ls.entries)) {
      for (const e of ls.entries) {
        if (!e || !e.id || typeof e.b64 !== 'string') continue;
        const bytes = activeBase64ToBytes(e.b64);
        if (bytes.length === 0) continue;
        window.__forgeBrepActiveCacheMap.set(e.id, {
          id:       e.id,
          name:     e.name || String(e.id),
          bytes,
          size_bytes: bytes.length,
          savedAt:  Number.isFinite(e.savedAt) ? e.savedAt : Date.now(),
          kind:     'native',
          toolId:   e.toolId  ?? null,
          params:   e.params  ?? null,
          spec:     e.spec    ?? null,
          material: e.material ?? null,
          volume_mm3:     (typeof e.volume_mm3 === 'number') ? e.volume_mm3 : null,
          originalHandle: (typeof e.originalHandle === 'number') ? e.originalHandle : null,
        });
      }
    }
  }
  return window.__forgeBrepActiveCacheMap;
})();

function activePersist() {
  const entries = [];
  for (const e of __activeCache.values()) {
    entries.push({
      id:        e.id,
      name:      e.name,
      savedAt:   e.savedAt,
      toolId:    e.toolId  ?? null,
      params:    e.params  ?? null,
      spec:      e.spec    ?? null,
      material:  e.material ?? null,
      volume_mm3:     (typeof e.volume_mm3 === 'number') ? e.volume_mm3 : null,
      originalHandle: (typeof e.originalHandle === 'number') ? e.originalHandle : null,
      b64:       activeBytesToBase64(e.bytes),
      size_bytes: e.size_bytes,
    });
  }
  activeWriteLs({
    kind: FORGE_CACHE_KIND,
    activeCacheVersion: ACTIVE_CACHE_VERSION,
    savedAt: isoNow(),
    entries,
  });
}

/**
 * Save a single native body to the active cache. Returns the cache
 * entry. Throws (real error) if the body isn't native or the kernel
 * surface (`forge.io.exportBrep` + `forge.dialog.writeBlob`) is missing
 * — silent no-op is explicitly forbidden per the PUSH-215 spec.
 */
export async function saveBodyToActiveCache(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('saveBodyToActiveCache: body object required');
  }
  if (body.kind !== 'native' || typeof body.handle !== 'number') {
    throw new Error(`saveBodyToActiveCache: body ${body.id || '?'} is not native (kind=${body.kind})`);
  }
  const forge = (typeof window !== 'undefined') ? window.forge : null;
  if (!forge?.io?.exportBrep) {
    throw new Error('forge.io.exportBrep unavailable on kernel surface');
  }
  if (!forge?.dialog?.writeBlob) {
    throw new Error('forge.dialog.writeBlob unavailable on kernel surface');
  }
  const id     = body.id ?? `body-${Date.now()}`;
  const safeId = safeName(id);
  const tp     = tmpBrepPath(safeId);
  const r      = forge.io.exportBrep(body.handle, tp);
  if (r === false) {
    throw new Error(`forge.io.exportBrep returned false for ${id}`);
  }
  const bytes = await readFileBytes(tp);
  const entry = {
    id,
    name:       body.name || String(id),
    bytes,
    size_bytes: bytes.length,
    savedAt:    Date.now(),
    kind:       'native',
    toolId:     body.toolId  ?? null,
    params:     body.params  ?? null,
    spec:       body.spec    ?? null,
    material:   body.material ?? null,
    volume_mm3: readBodyVolume(body.handle),
    originalHandle: body.handle,
  };
  __activeCache.set(id, entry);
  activePersist();
  return entry;
}

/**
 * Save every native body in `bodies` to the active cache. Returns
 * `{ ok, saved, errors }` where `saved` is the entry list (id + size +
 * savedAt). Per-body failures land in `errors` so the panel can render
 * them — the function does not throw.
 */
export async function saveSceneToActiveCache(bodies) {
  const list   = Array.isArray(bodies) ? bodies.filter(Boolean) : [];
  const saved  = [];
  const errors = [];
  for (const b of list) {
    try {
      const e = await saveBodyToActiveCache(b);
      saved.push({
        id: e.id, name: e.name,
        size_bytes: e.size_bytes,
        savedAt:    e.savedAt,
      });
    } catch (err) {
      errors.push({
        id:    b?.id ?? null,
        name:  b?.name ?? null,
        error: err.message || String(err),
      });
    }
  }
  return { ok: errors.length === 0 && saved.length > 0, saved, errors };
}

/**
 * Restore a single cached entry → returns the new body record (with
 * a fresh `forge.io.importBrep` kernel handle).
 */
export async function loadBodyFromActiveCache(entry) {
  if (!entry || typeof entry !== 'object' || !entry.id) {
    throw new Error('loadBodyFromActiveCache: entry object required');
  }
  const forge = (typeof window !== 'undefined') ? window.forge : null;
  if (!forge?.io?.importBrep) {
    throw new Error('forge.io.importBrep unavailable on kernel surface');
  }
  if (!forge?.dialog?.writeBlob) {
    throw new Error('forge.dialog.writeBlob unavailable on kernel surface');
  }
  const tp = await writeTmpBlob(entry.bytes, entry.id);
  const h  = forge.io.importBrep(tp);
  if (typeof h !== 'number') {
    throw new Error(`forge.io.importBrep returned non-number for ${entry.id} (got ${typeof h})`);
  }
  return {
    id:       entry.id,
    kind:     'native',
    handle:   h,
    name:     entry.name || String(entry.id),
    toolId:   entry.toolId  ?? null,
    params:   entry.params  ?? null,
    spec:     entry.spec    ?? null,
    material: entry.material ?? null,
    cachedVolume:   (typeof entry.volume_mm3 === 'number') ? entry.volume_mm3 : null,
    restoredVolume: readBodyVolume(h),
  };
}

/**
 * Restore every cached body, appending each to `window.__forgeBodies`
 * (via `__forgeAppendBody` when present) and dispatching
 * `forge:bodies-changed` so listeners (viewport, BOM, drawings…) can
 * refresh. Returns `{ ok, restored, errors }`.
 */
export async function loadActiveCacheIntoScene() {
  const entries  = listActiveCacheEntries();
  const restored = [];
  const errors   = [];
  for (const e of entries) {
    try {
      const cacheEntry = __activeCache.get(e.id);
      if (!cacheEntry) {
        errors.push({ id: e.id, error: 'entry missing in active cache map' });
        continue;
      }
      const body = await loadBodyFromActiveCache(cacheEntry);
      if (typeof window !== 'undefined') {
        const appendBody = window.__forgeAppendBody;
        if (typeof appendBody === 'function') {
          appendBody(body);
        } else {
          if (!Array.isArray(window.__forgeBodies)) window.__forgeBodies = [];
          window.__forgeBodies.push(body);
        }
      }
      restored.push({
        id:             body.id,
        name:           body.name,
        newHandle:      body.handle,
        cachedVolume:   body.cachedVolume,
        restoredVolume: body.restoredVolume,
      });
    } catch (err) {
      errors.push({ id: e.id, error: err.message || String(err) });
    }
  }
  if (typeof window !== 'undefined' && restored.length > 0) {
    try {
      window.dispatchEvent(new CustomEvent('forge:bodies-changed', {
        detail: { source: 'brep-cache-active', restored: restored.length },
      }));
    } catch { /* ignore */ }
  }
  return { ok: errors.length === 0 && restored.length > 0, restored, errors };
}

/**
 * Returns a sorted snapshot of every cached entry (newest first).
 * Each row is { id, name, size_bytes, savedAt, age_ms } so the panel
 * table can render without holding bytes in JSX state.
 */
export function listActiveCacheEntries() {
  const now = Date.now();
  const rows = [];
  for (const e of __activeCache.values()) {
    rows.push({
      id:         e.id,
      name:       e.name,
      size_bytes: e.size_bytes,
      savedAt:    e.savedAt,
      age_ms:     Math.max(0, now - e.savedAt),
      toolId:     e.toolId,
      kind:       e.kind,
      volume_mm3: e.volume_mm3,
    });
  }
  rows.sort((a, b) => b.savedAt - a.savedAt);
  return rows;
}

/**
 * Returns the list of cached body ids.
 */
export function listCachedActiveIds() {
  return listActiveCacheEntries().map((e) => e.id);
}

/**
 * Wipe the active cache (RAM map + localStorage). Returns the
 * pre-clear entry count so the panel can flash a confirmation.
 */
export function clearActiveCache() {
  const n = __activeCache.size;
  __activeCache.clear();
  activePersist();
  return n;
}

/**
 * Used by the panel for test-time introspection. NOT part of the
 * production caller surface — the panel reads `listActiveCacheEntries`
 * + the load/save APIs above.
 */
export function _activeCacheRawMap() {
  return __activeCache;
}

export const FORGE_BREP_CACHE_ACTIVE_VERSION = ACTIVE_CACHE_VERSION;
export const FORGE_BREP_CACHE_ACTIVE_LS_KEY  = ACTIVE_LS_KEY;
