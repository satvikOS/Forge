// Forge-119 — full-session save/load as a `.forge` project file.
//
// File > Save Project writes a `.forge` archive (a ZIP) containing the
// entire authoring session — every native body marshalled to STEP via
// the kernel, every synthetic body serialised in-line, the feature
// tree, sketches, configurations, PMI, materials, view state, and dock
// layout. File > Open Project re-imports the STEP files and rebuilds
// the bodies array with freshly-allocated handles.
//
// Layout inside the archive:
//
//   project.json                  — manifest + remap table + scene state
//   bodies/<id>.step              — one STEP file per native body
//
// project.json carries enough metadata to remap originalHandle →
// step-relative path on save, and step-relative path → newHandle on
// load. Synthetic bodies don't round-trip through OCCT — their spec is
// embedded verbatim in project.json.
//
// Pattern mirrors projectBundleExport.js (Forge-103) but with extra
// restoration metadata: scene state, dock layout, current sketch, PMI
// annotations, material assignments, view orientation. The bundle
// exporter ships everything to a delivery ZIP; this exporter ships
// everything to a session ZIP that can be re-opened.

import JSZip from 'jszip';

// ────────────────────────────────────────────── constants + helpers

const FORGE_FILE_VERSION = '1.0.0';
const FORGE_FILE_KIND    = 'forge.project';

function safeName(s) {
  return String(s ?? 'untitled')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'untitled';
}

function isoNow() {
  return new Date().toISOString();
}

function tmpStepPath(id) {
  const r = Math.random().toString(36).slice(2, 8);
  return `/tmp/forge-project-${Date.now()}-${safeName(String(id))}-${r}.step`;
}

// Read a file from disk into a Uint8Array via the file:// scheme. The
// renderer can load local files freely under the v4 webPreferences.
async function readFileBytes(filepath) {
  const url = filepath.startsWith('file://') ? filepath : `file://${filepath}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${filepath} → ${r.status}`);
  const buf = await r.arrayBuffer();
  return new Uint8Array(buf);
}

// Write Uint8Array → /tmp via the writeBlob preload bridge so the
// kernel can re-read it from disk for importStep. The renderer has no
// direct fs access under contextIsolation.
async function writeTmpStep(bytes, id) {
  const forge = (typeof window !== 'undefined' ? window.forge : null);
  if (!forge?.dialog?.writeBlob) throw new Error('writeBlob bridge missing');
  const tp = tmpStepPath(id);
  const r = await forge.dialog.writeBlob(tp, bytes);
  if (!r?.ok) throw new Error(r?.error || 'writeBlob failed');
  return r.path;
}

// Read localStorage values that the v4 shell persists per the slice
// task description. Returns an object that the caller embeds in the
// manifest under `viewState.localStorage`.
function readLocalStorageSnapshot() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  const keys = [
    'forge.v4.theme',
    'forge.v4.wb',
    'forge.v4.previewTab',
    'forge.v4.configs',
    'forge.v4.history',
    'forge.v4.pmi',
    'forge.v4.assemblyTree',
    'forge.v4.snap',
  ];
  const out = {};
  for (const k of keys) {
    try {
      const raw = window.localStorage.getItem(k);
      if (raw == null) continue;
      // Keep the raw string — the consumer is free to JSON.parse if it
      // knows the shape, but storing the raw value avoids double-parsing
      // mistakes on round-trip.
      out[k] = raw;
    } catch { /* ignore */ }
  }
  return out;
}

function writeLocalStorageSnapshot(snapshot) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  if (!snapshot || typeof snapshot !== 'object') return;
  for (const [k, v] of Object.entries(snapshot)) {
    try {
      if (typeof v === 'string') window.localStorage.setItem(k, v);
      else window.localStorage.setItem(k, JSON.stringify(v));
    } catch { /* ignore quota / sandbox failures */ }
  }
}

// ────────────────────────────────────────────── scene snapshot

/**
 * Read the live scene off `window.__forge*` publishers. The shell
 * republishes these on every render (ForgeShellV4 useEffect at L137),
 * so portal-mounted panels can read them without prop drilling.
 *
 * Synthetic bodies don't have a kernel handle — their `spec` is
 * preserved verbatim.
 *
 * Returns the same shape that `saveProject` and `restoreScene` expect.
 */
export function getCurrentSceneSnapshot() {
  const w = (typeof window !== 'undefined') ? window : {};
  return {
    projectName:    w.__forgeProjectName    ?? 'Untitled Project',
    bodies:         Array.isArray(w.__forgeBodies)      ? w.__forgeBodies      : [],
    featureTree:    Array.isArray(w.__forgeFeatureTree) ? w.__forgeFeatureTree : [],
    currentSketch:  w.__forgeCurrentSketch  ?? null,
    configurations: w.__forgeConfigurations ?? null,
    pmi:            w.__forgePmi            ?? null,
    materials:      w.__forgeMaterials      ?? null,
    viewState:      w.__forgeViewState      ?? null,
    dockState:      w.__forgeDockState      ?? null,
  };
}

/**
 * Push a loaded scene back onto the shell via the published setters.
 * The shell's `__forgeSetBodies` rebuilds the feature tree in lockstep,
 * but we also call `__forgeReplaceFeatureTree` so the labels survive a
 * round-trip (loadProject restores the original `label`/`params`, not
 * the derived label that `__forgeSetBodies` would otherwise compute).
 */
export function restoreScene(scene) {
  if (!scene || typeof window === 'undefined') return;
  try { window.__forgeProjectName = scene.projectName ?? 'Untitled Project'; } catch {}
  if (typeof window.__forgeSetBodies === 'function') {
    window.__forgeSetBodies(Array.isArray(scene.bodies) ? scene.bodies : []);
  } else {
    try { window.__forgeBodies = Array.isArray(scene.bodies) ? scene.bodies : []; } catch {}
  }
  if (typeof window.__forgeReplaceFeatureTree === 'function'
   && Array.isArray(scene.featureTree)) {
    window.__forgeReplaceFeatureTree(scene.featureTree);
  } else {
    try { window.__forgeFeatureTree = Array.isArray(scene.featureTree) ? scene.featureTree : []; } catch {}
  }
  try { window.__forgeCurrentSketch  = scene.currentSketch  ?? null; } catch {}
  try { window.__forgeConfigurations = scene.configurations ?? null; } catch {}
  try { window.__forgePmi            = scene.pmi            ?? null; } catch {}
  try { window.__forgeMaterials      = scene.materials      ?? null; } catch {}
  try { window.__forgeViewState      = scene.viewState      ?? null; } catch {}
  try { window.__forgeDockState      = scene.dockState      ?? null; } catch {}
  if (scene.localStorage) writeLocalStorageSnapshot(scene.localStorage);
}

// ────────────────────────────────────────────── save

/**
 * Save the full session to a `.forge` archive.
 *
 * For each native body, exports a STEP file via `forge.io.exportStep`,
 * reads the bytes back from /tmp, and stages them inside the ZIP at
 * `bodies/<id>.step`. Synthetic bodies are serialised in-line in
 * project.json (no STEP path).
 *
 * @param {object} args
 * @param {string} args.filepath  — destination path (already resolved)
 * @param {object} args.scene     — { projectName, bodies, featureTree,
 *                                    currentSketch, configurations,
 *                                    pmi, materials, viewState, dockState }
 *
 * @returns {Promise<{ ok:boolean, path?:string, bytes?:number,
 *                     manifest?:object, error?:string }>}
 */
export async function saveProject(args) {
  const { filepath, scene } = args || {};
  if (!filepath) return { ok: false, error: 'filepath required' };
  if (!scene)    return { ok: false, error: 'scene required' };

  const forge = (typeof window !== 'undefined' ? window.forge : null);
  if (!forge?.dialog?.writeBlob) {
    return { ok: false, error: 'writeBlob bridge missing' };
  }

  const zip = new JSZip();
  zip.folder('bodies');

  const manifestBodies = [];
  const remap = {}; // originalHandle → bodies/<id>.step

  for (const b of (scene.bodies || [])) {
    if (!b) continue;
    const id   = b.id ?? `body-${manifestBodies.length}`;
    const name = b.name || String(id);
    const safeId = safeName(id);

    if (b.kind === 'native' && typeof b.handle === 'number' && forge?.io?.exportStep) {
      try {
        const tp = tmpStepPath(safeId);
        forge.io.exportStep(b.handle, tp);
        const bytes = await readFileBytes(tp);
        const zipPath = `bodies/${safeId}.step`;
        zip.file(zipPath, bytes);
        remap[String(b.handle)] = zipPath;
        manifestBodies.push({
          id, name,
          kind: 'native',
          originalHandle: b.handle,
          stepPath: zipPath,
          stepBytes: bytes.length,
          toolId: b.toolId ?? null,
          params: b.params ?? null,
          status: 'ok',
        });
      } catch (err) {
        manifestBodies.push({
          id, name,
          kind: 'native',
          originalHandle: b.handle,
          stepPath: null,
          status: 'failed',
          error: err.message,
        });
      }
    } else if (b.kind === 'synthetic') {
      manifestBodies.push({
        id, name,
        kind: 'synthetic',
        spec: b.spec ?? null,
        toolId: b.toolId ?? null,
        params: b.params ?? null,
        status: 'ok',
      });
    } else {
      // Unknown body — still record it so the load path can decide.
      manifestBodies.push({
        id, name,
        kind: b.kind || 'unknown',
        toolId: b.toolId ?? null,
        params: b.params ?? null,
        status: 'skipped',
        reason: 'no-handle-or-spec',
      });
    }
  }

  const manifest = {
    kind: FORGE_FILE_KIND,
    forgeFileVersion: FORGE_FILE_VERSION,
    savedAt: isoNow(),
    projectName: scene.projectName ?? 'Untitled Project',
    kernel: (() => {
      try { return forge?.version ? forge.version() : null; } catch { return null; }
    })(),

    // Per-body restoration metadata.
    bodies: manifestBodies,
    // originalHandle → bodies/<id>.step. The load path uses this to
    // re-import and rebuild the bodies array.
    handleRemap: remap,

    // Authoring state.
    featureTree:    Array.isArray(scene.featureTree) ? scene.featureTree : [],
    currentSketch:  scene.currentSketch  ?? null,
    configurations: scene.configurations ?? null,
    pmi:            scene.pmi            ?? null,
    materials:      scene.materials      ?? null,
    viewState:      scene.viewState      ?? null,
    dockState:      scene.dockState      ?? null,

    // localStorage rollover (theme, active workbench, etc).
    localStorage: readLocalStorageSnapshot(),

    totals: {
      bodies:    manifestBodies.length,
      nativeOk:  manifestBodies.filter((b) => b.kind === 'native'    && b.status === 'ok').length,
      synthetic: manifestBodies.filter((b) => b.kind === 'synthetic').length,
    },
  };

  zip.file('project.json', JSON.stringify(manifest, null, 2));

  const u8 = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const result = await forge.dialog.writeBlob(filepath, u8);
  if (!result?.ok) {
    return { ok: false, error: result?.error || 'writeBlob failed', manifest };
  }
  return { ok: true, path: result.path, bytes: result.bytes, manifest };
}

// ────────────────────────────────────────────── load

/**
 * Open a `.forge` archive and rebuild the scene.
 *
 * Steps:
 *   1. Read the ZIP from disk via fetch('file://…') and parse with JSZip.
 *   2. Parse project.json. Reject if the kind != 'forge.project'.
 *   3. For each native body whose manifest entry has a stepPath:
 *        - Extract the STEP bytes from the ZIP
 *        - Stage them in /tmp via writeBlob
 *        - Call forge.io.importStep(tmpPath) → newHandle
 *        - Push { id, kind:'native', handle:newHandle, ... }
 *   4. Pass-through synthetic bodies verbatim.
 *   5. Remap the featureTree by id (the tree references body ids, not
 *      handles, so no rewriting is needed — but we record the new
 *      handles in `handleRemap` so callers can introspect).
 *
 * @param {string} filepath — absolute path to the .forge file
 *
 * @returns {Promise<{ ok:boolean, scene?:object, manifest?:object,
 *                     handleRemap?:object, error?:string }>}
 */
export async function loadProject(filepath) {
  if (!filepath) return { ok: false, error: 'filepath required' };
  const forge = (typeof window !== 'undefined' ? window.forge : null);

  let bytes;
  try {
    bytes = await readFileBytes(filepath);
  } catch (err) {
    return { ok: false, error: `read failed: ${err.message}` };
  }
  if (!bytes || bytes.length < 4) {
    return { ok: false, error: 'empty or truncated archive' };
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    return { ok: false, error: `not a valid zip: ${err.message}` };
  }

  const manifestEntry = zip.file('project.json');
  if (!manifestEntry) {
    return { ok: false, error: 'project.json missing from archive' };
  }
  let manifest;
  try {
    const text = await manifestEntry.async('string');
    manifest = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `project.json parse failed: ${err.message}` };
  }
  if (manifest.kind !== FORGE_FILE_KIND) {
    return { ok: false, error: `unexpected kind: ${manifest.kind}` };
  }

  // Rebuild bodies. Native handles change after import; synthetic
  // bodies pass through verbatim.
  const newBodies = [];
  const newHandleRemap = {}; // originalHandle → newHandle
  const restoreErrors = [];

  for (const b of (manifest.bodies || [])) {
    if (!b) continue;
    if (b.kind === 'native' && b.stepPath) {
      const stepEntry = zip.file(b.stepPath);
      if (!stepEntry) {
        restoreErrors.push({ id: b.id, error: `step missing: ${b.stepPath}` });
        continue;
      }
      if (!forge?.io?.importStep) {
        restoreErrors.push({ id: b.id, error: 'importStep bridge missing' });
        continue;
      }
      try {
        const stepBytes = await stepEntry.async('uint8array');
        const tp = await writeTmpStep(stepBytes, b.id);
        const handle = forge.io.importStep(tp);
        if (typeof handle !== 'number') {
          restoreErrors.push({ id: b.id, error: 'importStep returned non-number' });
          continue;
        }
        newBodies.push({
          id: b.id,
          kind: 'native',
          handle,
          toolId: b.toolId ?? null,
          params: b.params ?? null,
          name: b.name || String(b.id),
        });
        if (typeof b.originalHandle === 'number') {
          newHandleRemap[String(b.originalHandle)] = handle;
        }
      } catch (err) {
        restoreErrors.push({ id: b.id, error: err.message });
      }
    } else if (b.kind === 'synthetic') {
      newBodies.push({
        id: b.id,
        kind: 'synthetic',
        spec: b.spec ?? null,
        toolId: b.toolId ?? null,
        params: b.params ?? null,
        name: b.name || String(b.id),
      });
    }
    // unknown / skipped entries are dropped — they had no payload to
    // restore in the first place.
  }

  // Feature tree references body ids (not handles), so no rewriting
  // is needed beyond defensive copying.
  const featureTree = Array.isArray(manifest.featureTree)
    ? manifest.featureTree.map((n) => ({ ...n }))
    : [];

  const scene = {
    projectName:    manifest.projectName ?? 'Untitled Project',
    bodies:         newBodies,
    featureTree,
    currentSketch:  manifest.currentSketch  ?? null,
    configurations: manifest.configurations ?? null,
    pmi:            manifest.pmi            ?? null,
    materials:      manifest.materials      ?? null,
    viewState:      manifest.viewState      ?? null,
    dockState:      manifest.dockState      ?? null,
    localStorage:   manifest.localStorage   ?? null,
  };

  return {
    ok: true,
    scene,
    manifest,
    handleRemap: newHandleRemap,
    errors: restoreErrors,
  };
}

// Re-exports for tests and panels.
export const __test = { safeName, readLocalStorageSnapshot };
