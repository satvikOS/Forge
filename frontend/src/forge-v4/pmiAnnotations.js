// Forge-109 — PMI annotations registry.
//
// In-memory list of PMI (Product Manufacturing Information) annotations
// attached to body faces / edges. Each entry carries:
//
//   {
//     id:       'pmi-<ts>-<hash>',
//     kind:     'gdt' | 'finish' | 'weld',
//     viewId:   <drawing-view-id>,        // optional — render placement
//     bodyId:   <body-id> | null,         // owning body in the project
//     handle:   <kernel-handle> | null,   // for STEP-with-PMI export
//     faceTag:  <kernel-face-tag> | null, // OCCT subshape id (if any)
//     edgeTag:  <kernel-edge-tag> | null,
//     anchor:   [x, y],                   // sheet coords for arrow tip
//     frame:    [x, y],                   // sheet coords for symbol box
//     payload:  { …kind-specific spec… }, // see GdtFcf / SurfaceFinish / WeldSymbol
//     createdAt:Date.now()
//   }
//
// Two entry points are persisted:
//   • In-memory module state (used by React via useSyncExternalStore-style
//     subscribe / getSnapshot wiring).
//   • localStorage under key 'forge.v4.pmi' — autosave on every change.
//
// The STEP-export adaptor below converts the list into the payload
// window.forge.io.exportStepWithPmi(handle, filepath, notes) expects.

const LS_KEY = 'forge.v4.pmi';
const subs   = new Set();

let _state = loadFromLocalStorage();

function loadFromLocalStorage() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function saveToLocalStorage(state) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {}
}

function notify() {
  for (const s of subs) {
    try { s(); } catch (err) { /* keep going */ }
  }
}

function nextId(kind) {
  const hash = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `pmi-${kind}-${Date.now()}-${hash}`;
}

// ── Public API ──────────────────────────────────────────────────────

export function listAnnotations() {
  return _state.slice();
}
export function listAnnotationsForBody(bodyId) {
  return _state.filter((a) => a.bodyId === bodyId);
}
export function listAnnotationsForView(viewId) {
  return _state.filter((a) => a.viewId === viewId);
}
export function getAnnotation(id) {
  return _state.find((a) => a.id === id) || null;
}

export function addAnnotation({
  kind, viewId = null, bodyId = null, handle = null,
  faceTag = null, edgeTag = null,
  anchor = null, frame = null, payload = {},
}) {
  if (!['gdt', 'finish', 'weld'].includes(kind)) {
    throw new Error(`pmiAnnotations: unknown kind "${kind}"`);
  }
  const entry = {
    id: nextId(kind),
    kind,
    viewId, bodyId, handle, faceTag, edgeTag,
    anchor, frame, payload,
    createdAt: Date.now(),
  };
  _state = [..._state, entry];
  saveToLocalStorage(_state);
  notify();
  return entry;
}

export function updateAnnotation(id, patch) {
  let updated = null;
  _state = _state.map((a) => {
    if (a.id !== id) return a;
    updated = { ...a, ...patch, updatedAt: Date.now() };
    return updated;
  });
  if (updated) { saveToLocalStorage(_state); notify(); }
  return updated;
}

export function removeAnnotation(id) {
  const next = _state.filter((a) => a.id !== id);
  const removed = next.length !== _state.length;
  if (removed) {
    _state = next;
    saveToLocalStorage(_state);
    notify();
  }
  return removed;
}

export function clearAnnotations() {
  if (_state.length === 0) return;
  _state = [];
  saveToLocalStorage(_state);
  notify();
}

export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  subs.add(fn);
  return () => { subs.delete(fn); };
}

// Bulk-replace for hydration in tests / multi-doc switching.
export function setAnnotations(arr) {
  _state = Array.isArray(arr) ? arr.slice() : [];
  saveToLocalStorage(_state);
  notify();
}

// ── STEP-with-PMI serialisation ─────────────────────────────────────
//
// window.forge.io.exportStepWithPmi(handle, filepath, notes) expects
//   notes : Array<{
//     kind: 'gdt' | 'finish' | 'weld',
//     faceTag?: number | null,
//     edgeTag?: number | null,
//     spec: object,            // payload (kernel ignores extra keys)
//     text: string,            // pre-rendered AP242 PMI text
//   }>
// We pre-render `text` here so the kernel can write it verbatim into
// the AP242 SEMANTIC_PMI_REPRESENTATION block — the kernel doesn't
// need to know the glyph rules.

export function serializeForStep(annotations = _state) {
  return annotations.map((a) => ({
    id:      a.id,
    kind:    a.kind,
    faceTag: a.faceTag ?? null,
    edgeTag: a.edgeTag ?? null,
    spec:    a.payload,
    text:    annotationToText(a),
  }));
}

export function annotationToText(a) {
  if (!a) return '';
  switch (a.kind) {
    case 'gdt': {
      const p = a.payload || {};
      const sym = GDT_SYMBOLS_MIRROR[p.characteristic] || '?';
      const zone = ZONE_PREFIX[p.zoneShape] || '';
      const matMod = MAT_GLYPH[p.materialMod] || '';
      const datums = (p.datums || [])
        .map((d) => `${d.ref}${MAT_GLYPH[d.mod] ? ' ' + MAT_GLYPH[d.mod] : ''}`)
        .join('|');
      return `[${sym}|${zone}${p.tolerance}${matMod ? ' ' + matMod : ''}` +
             `${datums ? '|' + datums : ''}]`;
    }
    case 'finish': {
      const p = a.payload || {};
      const lay = p.lay ? ` lay=${p.lay}` : '';
      return `[${p.variant}/${p.param} ${p.value}μm${lay}]`;
    }
    case 'weld': {
      const p = a.payload || {};
      const proc = p.process ? ` ${p.process}` : '';
      const flags = (p.allAround ? ' allAround' : '') + (p.fieldWeld ? ' field' : '');
      return `[${p.type}/${p.side} size=${p.size}${proc}${flags}]`;
    }
    default: return '';
  }
}

// We mirror just the glyph maps we need locally so this module has no
// cyclic dependency back on the React components.
const GDT_SYMBOLS_MIRROR = Object.freeze({
  flatness:        '⏥',
  straightness:    '—',
  circularity:     '○',
  cylindricity:    '⌭',
  profileLine:     '⌒',
  profileSurface:  '⌓',
  parallelism:     '∥',
  perpendicularity:'⟂',
  angularity:      '∠',
  position:        '⊕',
  concentricity:   '◎',
  symmetry:        '=',
  circularRunout:  '⌖',
  totalRunout:     '↗↗',
  runout:          '↗',
});
const ZONE_PREFIX = Object.freeze({
  none: '', diameter: '⌀', spherical: 'S⌀', square: '□',
});
const MAT_GLYPH = Object.freeze({
  RFS: '', MMC: 'Ⓜ', LMC: 'Ⓛ',
});

// ── STEP export driver ─────────────────────────────────────────────
// Calls window.forge.io.exportStepWithPmi if available; otherwise
// returns a graceful "kernel-unavailable" result so the UI can display
// a toast rather than throw.

export async function exportStepWithPmi({ handle, filepath, annotations }) {
  const list = annotations || _state;
  const notes = serializeForStep(list);
  const w = (typeof window !== 'undefined') ? window : null;
  const fn = w?.forge?.io?.exportStepWithPmi;
  if (typeof fn !== 'function') {
    return {
      ok: false, source: 'fallback',
      error: 'window.forge.io.exportStepWithPmi unavailable',
      filepath, count: notes.length, notes,
    };
  }
  try {
    const result = await Promise.resolve(fn.call(w.forge.io, handle, filepath, notes));
    return { ok: true, source: 'kernel', filepath, count: notes.length, result };
  } catch (err) {
    return {
      ok: false, source: 'kernel-error',
      error: err?.message || String(err),
      filepath, count: notes.length,
    };
  }
}

// ── Convenience for tests / debugging ────────────────────────────────

export const __TEST__ = {
  reset() { _state = []; saveToLocalStorage(_state); notify(); },
  LS_KEY,
};

export default {
  listAnnotations,
  addAnnotation,
  updateAnnotation,
  removeAnnotation,
  clearAnnotations,
  subscribe,
  serializeForStep,
  exportStepWithPmi,
  annotationToText,
};
