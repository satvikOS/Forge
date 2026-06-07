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
