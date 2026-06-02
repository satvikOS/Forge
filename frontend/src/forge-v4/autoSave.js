// Forge-183 — Auto-save + crash recovery.
//
// Lightweight in-browser autosave keyed by localStorage. We snapshot
// only the lossless re-buildable state (feature tree, body metadata,
// PMI annotations, viewState, project name) — not the BREP buffers,
// which can be re-derived from the feature tree by the kernel.
//
// Triggers:
//   * Every N ms via setInterval (default 30 s).
//   * On `forge:state-changed` event (debounced 3 s).
//
// On launch, if the autosave timestamp is newer than the last manual
// save (tracked via 'forge.v4.last_save_ts'), the shell mounts a
// recovery banner offering to restore the autosave.

const KEY = 'forge.v4.autosave';
const TIME_KEY = 'forge.v4.autosave.ts';
const LAST_SAVE_KEY = 'forge.v4.last_save_ts';

let _periodicTimer = null;
let _debounceTimer = null;
let _lastSnapshotJSON = null;

function stableStringify(obj) {
  // Stable JSON helps deduplicate near-identical snapshots — we skip
  // writing if nothing changed.
  return JSON.stringify(obj);
}

export function snapshot(scene) {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  if (!scene) return false;
  // Keep the snapshot small — strip native handles which are session-scoped.
  const trim = {
    projectName: scene.projectName ?? '',
    bodies:      (scene.bodies || []).map((b) => ({
      id: b.id, name: b.name, label: b.label, toolId: b.toolId,
      kind: b.kind, params: b.params || {},
    })),
    featureTree: scene.featureTree || [],
    pmi:         scene.pmi || null,
    materials:   scene.materials || null,
    viewState:   scene.viewState || null,
    dockState:   scene.dockState || null,
    configurations: scene.configurations || null,
  };
  const payload = stableStringify(trim);
  if (payload === _lastSnapshotJSON) return false;
  try {
    window.localStorage.setItem(KEY, payload);
    window.localStorage.setItem(TIME_KEY, String(Date.now()));
    _lastSnapshotJSON = payload;
    return true;
  } catch (e) {
    return false;
  }
}

export function latest() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const ts = window.localStorage.getItem(TIME_KEY);
  const payload = window.localStorage.getItem(KEY);
  if (!ts || !payload) return null;
  try {
    return {
      timestamp: parseInt(ts, 10),
      scene: JSON.parse(payload),
    };
  } catch {
    return null;
  }
}

export function clear() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem(TIME_KEY);
  _lastSnapshotJSON = null;
}

export function markManualSave() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(LAST_SAVE_KEY, String(Date.now()));
}

export function hasRecoverableSession() {
  const last = latest();
  if (!last) return false;
  const lastManual = parseInt(
    (typeof window !== 'undefined' && window.localStorage)
      ? window.localStorage.getItem(LAST_SAVE_KEY) || '0' : '0',
    10);
  return last.timestamp > lastManual + 1000;
}

export function startPeriodic(snapshotFn, intervalMs = 30000) {
  if (_periodicTimer) clearInterval(_periodicTimer);
  _periodicTimer = setInterval(() => {
    try { snapshotFn?.(); } catch {}
  }, intervalMs);
}

export function stopPeriodic() {
  if (_periodicTimer) { clearInterval(_periodicTimer); _periodicTimer = null; }
}

export function debouncedSnapshot(scene, delayMs = 3000) {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => snapshot(scene), delayMs);
}

// Window APIs — exposed so the shell + e2e can drive autosave from
// anywhere without holding a React reference.
export function installWindowApis() {
  if (typeof window === 'undefined') return;
  window.__forgeAutosave = {
    snapshot, latest, clear, markManualSave, hasRecoverableSession,
    startPeriodic, stopPeriodic, debouncedSnapshot,
  };
}
