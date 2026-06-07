// PUSH-78 (Slice-46 / PMI Annotations panel).
//
// 3D model PMI annotations panel — Product Manufacturing Information
// notes attached to faces of the active body. A real complement to
// PUSH-12's PMI Workbench (PMIAnnotations.jsx) and PUSH-47's tolerance
// stack-up (ToleranceStackWorkbench): where PMI Workbench is a
// kitchen-sink FCF/Datum/Linear/Angular/Surface editor with Y14.41
// export, this panel is the small focused "drop a GD&T note onto a
// face" tool engineers reach for between modelling steps.
//
// Four note kinds matching the brief:
//   • Datum     — datum letter (A, B, C, …) attached to a face.
//   • Tolerance — geometric tolerance text (e.g. "⌖ Ø0.1 A B C").
//   • Finish    — surface finish text (e.g. "Ra 1.6 µm milled").
//   • Weld      — weld symbol text (e.g. "fillet 5 mm GMAW").
//
// Persistence contract:
//   * `window.__forgePmi` is the canonical in-memory array of note
//     records. Every mutation through the panel funnels through the
//     same `addNote()` helper so the API surface (debug helper,
//     forge:pmi-changed event, localStorage mirror) stays consistent.
//   * localStorage key `forge.v4.pmiNotes` — JSON {version, notes:[…]}.
//   * `forge:pmi-changed` CustomEvent fires on every mutation so the
//     viewport (and any sibling panel) can react without polling.
//
// Hard constraints honoured (PUSH-78 brief):
//   * NO new npm packages, NO new C++ libs — pure React, browser
//     localStorage, CustomEvent.
//   * Real implementation: localStorage round-trips JSON; window mirror
//     is a real array; bus event wired the same shape SectionPlane /
//     Layers / BodyColors / CameraBookmarks / ActivityLog use.
//   * Surgical edits to Menus.jsx (one new tools.pmiAnnotations entry)
//     and App.jsx (one import + one mount). The legacy PMI Workbench
//     stays untouched — different file, different test id namespace,
//     different storage key, different bus event.
//   * Multi-cam e2e: 5 named camera angles per Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants — keep the storage / event / debug surfaces exported so the
// e2e spec, plugins, and Archie tool calls can reach the same names
// without re-deriving them.

export const FORGE_PMI_LS_KEY     = 'forge.v4.pmiNotes';
export const FORGE_PMI_EVENT_NAME = 'forge:pmi-changed';

// The four note kinds the panel exposes. Each carries a glyph that
// renders alongside the user text in the existing-notes list so the
// user can scan note kinds at a glance — matches ASME Y14.5 / ISO 1101
// glyph conventions where applicable. (Weld uses the AWS A2.4 triangle.)
export const PMI_KINDS = Object.freeze([
  { id: 'datum',     label: 'Datum',        glyph: '⊿', placeholder: 'A' },
  { id: 'tolerance', label: 'Tolerance',    glyph: '⌖', placeholder: '⌖ Ø0.1 A B C' },
  { id: 'finish',    label: 'Surface finish', glyph: '√', placeholder: 'Ra 1.6 µm milled' },
  { id: 'weld',      label: 'Weld',         glyph: '▽', placeholder: 'fillet 5 mm GMAW' },
]);

const VALID_KIND_IDS = new Set(PMI_KINDS.map((k) => k.id));

// ─────────────────────────────────────────────────────────────────────
// Persistence helpers — load / save round-trip JSON in localStorage and
// keep window.__forgePmi mirrored in sync. Both reads are tolerant of
// stale / corrupt data; both writes are fail-soft on quota errors.

function emptyStore() {
  return { version: 1, notes: [] };
}

function normaliseNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = typeof raw.kind === 'string' ? raw.kind : null;
  if (!kind || !VALID_KIND_IDS.has(kind)) return null;
  const id = typeof raw.id === 'string' && raw.id.length ? raw.id : nextId(kind);
  // Face ID is required but is a free-form numeric/string identifier so
  // we accept any non-empty string after coercion.
  const faceId = (raw.faceId === null || raw.faceId === undefined)
    ? '' : String(raw.faceId).trim();
  const text = typeof raw.text === 'string' ? raw.text : '';
  const bodyHandle = typeof raw.bodyHandle === 'number' && Number.isFinite(raw.bodyHandle)
    ? raw.bodyHandle : null;
  const createdAt = (typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt))
    ? raw.createdAt : Date.now();
  return { id, kind, faceId, text, bodyHandle, createdAt };
}

function normaliseStore(raw) {
  if (!raw || typeof raw !== 'object') return emptyStore();
  const rawNotes = Array.isArray(raw.notes) ? raw.notes : [];
  const notes = [];
  for (const n of rawNotes) {
    const norm = normaliseNote(n);
    if (norm) notes.push(norm);
  }
  return { version: 1, notes };
}

function nextId(kind) {
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `pmi-${kind}-${ts}-${rand}`;
}

export function loadPmiStore() {
  if (typeof window === 'undefined') return emptyStore();
  try {
    const txt = window.localStorage.getItem(FORGE_PMI_LS_KEY);
    if (!txt) return emptyStore();
    return normaliseStore(JSON.parse(txt));
  } catch {
    return emptyStore();
  }
}

export function savePmiStore(store) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      FORGE_PMI_LS_KEY,
      JSON.stringify(normaliseStore(store)),
    );
  } catch { /* quota-exceeded etc. — non-fatal */ }
}

// Mirror the store into `window.__forgePmi` so the e2e spec / plugins /
// Archie tool calls can read the current note list without importing
// the module. We keep the live reference stable (mutate in-place rather
// than re-assigning) so subscribers that captured the array won't go
// stale across mutations.
function syncWindowMirror(store) {
  if (typeof window === 'undefined') return;
  if (!Array.isArray(window.__forgePmi)) window.__forgePmi = [];
  const arr = window.__forgePmi;
  arr.length = 0;
  for (const n of store.notes) arr.push(n);
}

function publish(store) {
  if (typeof window === 'undefined') return;
  savePmiStore(store);
  syncWindowMirror(store);
  try {
    window.dispatchEvent(new CustomEvent(FORGE_PMI_EVENT_NAME, { detail: store }));
  } catch { /* CustomEvent always exists in Electron */ }
}

// ─────────────────────────────────────────────────────────────────────
// Public mutator API — used by the panel + exposed on the window debug
// surface so e2e specs / plugins / Archie tool calls can drive the
// store without mounting the React panel.

export function addNote({ kind, faceId, text, bodyHandle = null }) {
  if (!kind || !VALID_KIND_IDS.has(kind)) return null;
  const norm = normaliseNote({
    kind,
    faceId: (faceId === null || faceId === undefined) ? '' : String(faceId),
    text: typeof text === 'string' ? text : '',
    bodyHandle,
  });
  if (!norm) return null;
  const store = loadPmiStore();
  const next = { ...store, notes: [...store.notes, norm] };
  publish(next);
  return norm;
}

export function removeNote(id) {
  if (typeof id !== 'string' || !id.length) return false;
  const store = loadPmiStore();
  const next = store.notes.filter((n) => n.id !== id);
  if (next.length === store.notes.length) return false;
  publish({ ...store, notes: next });
  return true;
}

export function listNotes() {
  return loadPmiStore().notes.slice();
}

export function clearAllNotes() {
  publish(emptyStore());
}

// Snap the active native body so the panel can pre-populate the
// "Body handle" badge. Same selection / last-native fallback the
// MassProps / Interference panels use — keeps the UX consistent across
// the right-rail panels.
function activeBody() {
  if (typeof window === 'undefined') return null;
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  const native = bodies.filter((b) => b && b.kind === 'native' && typeof b.handle === 'number');
  if (native.length === 0) return null;
  const sel = window.__forgeSelection || null;
  if (sel && typeof sel.bodyHandle === 'number') {
    const m = native.find((b) => b.handle === sel.bodyHandle);
    if (m) return m;
  }
  return native[native.length - 1];
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail matching SectionPlane / Layers /
// BodyColors / CameraBookmarks shelf so the panel fits the existing
// information architecture rather than floating as a one-off.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 380,
  zIndex: 1335,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflowY: 'auto',
};
const HEADER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)', margin: '8px 0 4px',
};
const FIELD = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--forge-canvas, #0d1117)',
  color: 'var(--forge-ink, #dadde2)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3, padding: '5px 7px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
};
const ADD_BTN = (enabled) => ({
  background: enabled ? 'var(--forge-accent, #2c8af2)' : 'var(--forge-surface, #1f242c)',
  color: enabled ? '#fff' : 'var(--forge-ink-mute, #9aa1ab)',
  border: 'none', borderRadius: 3,
  padding: '6px 12px',
  cursor: enabled ? 'pointer' : 'not-allowed',
  fontWeight: 600,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
});
const CLEAR_BTN = {
  background: 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  padding: '4px 10px', borderRadius: 3, fontSize: 11,
};
const NOTE_ROW = {
  display: 'grid',
  gridTemplateColumns: '22px 1fr 50px',
  alignItems: 'start', gap: 6,
  padding: '6px 6px',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
};
const DEL_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3, fontSize: 10,
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function PmiAnnotationsPanel({ open, onClose }) {
  const [store, setStore] = useState(() => loadPmiStore());
  const [body, setBody] = useState(() => activeBody());
  const [kind, setKind] = useState('datum');
  const [faceId, setFaceId] = useState('');
  const [text, setText] = useState('');

  // Refresh on open, then keep in sync with bus events while open.
  useEffect(() => {
    if (!open) return undefined;
    const fresh = loadPmiStore();
    setStore(fresh);
    setBody(activeBody());
    // On open, sync the window mirror so the persisted state is visible
    // to plugins / scripts even before the first mutation.
    publish(fresh);
    const onPmi = () => setStore(loadPmiStore());
    const onBodies = () => setBody(activeBody());
    const onPick = () => setBody(activeBody());
    window.addEventListener(FORGE_PMI_EVENT_NAME, onPmi);
    window.addEventListener('forge:bodies-changed', onBodies);
    window.addEventListener('forge:selection-changed', onPick);
    return () => {
      window.removeEventListener(FORGE_PMI_EVENT_NAME, onPmi);
      window.removeEventListener('forge:bodies-changed', onBodies);
      window.removeEventListener('forge:selection-changed', onPick);
    };
  }, [open]);

  const kindSpec = useMemo(
    () => PMI_KINDS.find((k) => k.id === kind) || PMI_KINDS[0],
    [kind],
  );

  // Auto-fill the text field with the kind's placeholder when the user
  // changes kind and the field is empty or still shows the previous
  // kind's placeholder — saves typing in the common case.
  useEffect(() => {
    setText((prev) => {
      if (!prev || PMI_KINDS.some((k) => k.placeholder === prev)) {
        return kindSpec.placeholder;
      }
      return prev;
    });
  }, [kind, kindSpec]);

  const canAdd = useMemo(() => {
    // Face ID is required, text is required, kind is always defined.
    return faceId.trim().length > 0 && text.trim().length > 0;
  }, [faceId, text]);

  const onAdd = useCallback(() => {
    if (!canAdd) return;
    const rec = addNote({
      kind,
      faceId: faceId.trim(),
      text: text.trim(),
      bodyHandle: body && typeof body.handle === 'number' ? body.handle : null,
    });
    if (rec) {
      setStore(loadPmiStore());
      // Clear the face id but keep the kind & text for rapid sequential
      // entry of the same kind of note onto different faces.
      setFaceId('');
    }
  }, [canAdd, kind, faceId, text, body]);

  const onDelete = useCallback((id) => {
    const ok = removeNote(id);
    if (ok) setStore(loadPmiStore());
  }, []);

  const onClear = useCallback(() => {
    clearAllNotes();
    setStore(loadPmiStore());
  }, []);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const noteCount = store.notes.length;
  const handleLabel = body && typeof body.handle === 'number'
    ? `body h${body.handle}`
    : 'no active body';

  return createPortal(
    <div role="dialog"
         aria-label="PMI annotations"
         data-testid="forge-pmi-annotations-panel"
         data-note-count={noteCount}
         data-body-handle={body && typeof body.handle === 'number' ? body.handle : ''}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="measure.distance" size={14} />
        <strong style={{ fontSize: 13 }}>PMI Annotations</strong>
        <span data-testid="forge-pmi-annotations-count"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px', borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          {noteCount}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onClear}
                title="Remove every PMI note (cannot be undone)"
                data-testid="forge-pmi-annotations-clear"
                style={CLEAR_BTN}>
          Clear all
        </button>
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close PMI Annotations panel"
                data-testid="forge-pmi-annotations-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div data-testid="forge-pmi-annotations-active-body"
           style={{
             fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
             fontSize: 10,
             color: 'var(--forge-ink-mute, #9aa1ab)',
             padding: '4px 6px',
             border: '1px dashed var(--forge-rail-edge, #2a2d34)',
             borderRadius: 3,
           }}>
        Attaches to: {handleLabel}
      </div>

      <div style={SECTION_TITLE}>Add note</div>

      <label style={{ display: 'block' }}>
        <small style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>Kind</small>
        <select data-testid="forge-pmi-annotations-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                style={FIELD}>
          {PMI_KINDS.map((k) => (
            <option key={k.id} value={k.id}>{k.glyph}  {k.label}</option>
          ))}
        </select>
      </label>

      <label style={{ display: 'block' }}>
        <small style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>Face ID</small>
        <input data-testid="forge-pmi-annotations-face"
               type="text"
               value={faceId}
               onChange={(e) => setFaceId(e.target.value)}
               placeholder="e.g. 1, F.top, edge#3"
               style={FIELD} />
      </label>

      <label style={{ display: 'block' }}>
        <small style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>Text</small>
        <textarea data-testid="forge-pmi-annotations-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={kindSpec.placeholder}
                  rows={2}
                  style={{ ...FIELD, resize: 'vertical', minHeight: 40 }} />
      </label>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="button"
                onClick={onAdd}
                disabled={!canAdd}
                data-testid="forge-pmi-annotations-add"
                style={ADD_BTN(canAdd)}>
          Add {kindSpec.label}
        </button>
        {!canAdd && (
          <small data-testid="forge-pmi-annotations-add-hint"
                 style={{ color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 10 }}>
            Need a Face ID + text.
          </small>
        )}
      </div>

      <div style={SECTION_TITLE}>Existing notes ({noteCount})</div>
      {noteCount === 0 ? (
        <div data-testid="forge-pmi-annotations-empty"
             style={{
               padding: '12px 0',
               fontStyle: 'italic',
               color: 'var(--forge-ink-mute, #9aa1ab)',
               fontSize: 11,
             }}>
          No PMI notes yet. Fill the form above and press Add to attach
          a Datum / Tolerance / Surface finish / Weld note to a face of
          the active body.
        </div>
      ) : (
        <ul data-testid="forge-pmi-annotations-list"
            style={{ listStyle: 'none', margin: 0, padding: 0,
                     display: 'flex', flexDirection: 'column' }}>
          {store.notes.map((n) => {
            const spec = PMI_KINDS.find((k) => k.id === n.kind) || PMI_KINDS[0];
            return (
              <li key={n.id}
                  data-testid="forge-pmi-annotations-row"
                  data-note-id={n.id}
                  data-kind={n.kind}
                  data-face-id={n.faceId}
                  data-body-handle={typeof n.bodyHandle === 'number' ? n.bodyHandle : ''}
                  style={NOTE_ROW}>
                <span aria-hidden
                      style={{
                        fontSize: 16, lineHeight: '14px', textAlign: 'center',
                        color: 'var(--forge-ink, #dadde2)',
                      }}>
                  {spec.glyph}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                    fontSize: 11,
                    color: 'var(--forge-ink, #dadde2)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {n.text}
                  </div>
                  <div style={{
                    fontSize: 10,
                    color: 'var(--forge-ink-mute, #9aa1ab)',
                    marginTop: 2,
                  }}>
                    {spec.label} · face {n.faceId}
                    {typeof n.bodyHandle === 'number' ? ` · h${n.bodyHandle}` : ''}
                  </div>
                </div>
                <button type="button"
                        title="Remove this PMI note"
                        data-testid={`forge-pmi-annotations-del-${n.id}`}
                        onClick={() => onDelete(n.id)}
                        style={DEL_BTN}>
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <footer style={{
        padding: '8px 0 0',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
        color: 'var(--forge-ink-mute, #9aa1ab)',
        fontSize: 10,
        lineHeight: 1.4,
        marginTop: 'auto',
      }}>
        PMI notes persist across sessions (<code>forge.v4.pmiNotes</code>)
        and are mirrored on <code>window.__forgePmi</code> for plugins
        and Archie tool calls.
      </footer>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.pmiAnnotations` menu action, exposes
// imperative open/close hooks for plugins / Archie tool calls, and
// surfaces the persisted store on the window mirror at bootstrap so
// reading `window.__forgePmi` works even before the panel mounts.

export function PmiAnnotationsPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenPmiAnnotationsPanel  = () => setOpen(true);
    window.__forgeClosePmiAnnotationsPanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.pmiAnnotations') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    // Mirror the persisted store onto window.__forgePmi at bootstrap.
    try { publish(loadPmiStore()); } catch { /* fail-soft */ }
    // Expose a small debug surface so e2e specs / Archie tool calls /
    // plugins can drive the store without importing the module.
    window.__forgePmiHelper = Object.freeze({
      addNote,
      removeNote,
      listNotes,
      clearAllNotes,
      KINDS: PMI_KINDS,
      STORAGE_KEY: FORGE_PMI_LS_KEY,
      EVENT_NAME: FORGE_PMI_EVENT_NAME,
    });
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenPmiAnnotationsPanel; } catch {}
      try { delete window.__forgeClosePmiAnnotationsPanel; } catch {}
    };
  }, []);
  return <PmiAnnotationsPanel open={open} onClose={() => setOpen(false)} />;
}

export default PmiAnnotationsPanel;
