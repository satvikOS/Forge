// PUSH-68 (Slice-36) — Camera Bookmarks panel.
//
// MCAD parity gap closed: SolidWorks "Save View", Fusion "Named Views",
// Creo "Saved Views", NX "Custom Views", CATIA "Named Views". Up through
// PUSH-67 Forge could fit-to-bounds (Viewport.__forgeFitToBounds) and
// switch to canonical iso/front/top/right views (handleMenuAction), but
// the user had no way to *save* the camera state they'd carefully framed
// — pan/zoom/rotate setup vanished the moment they pressed `1` for iso.
//
// What this panel adds:
//   • Save the current camera state (position + target) under a label
//     — single-click capture of what the user is currently looking at.
//   • Restore by clicking a bookmark row → camera + OrbitControls target
//     snap back to the saved state and `update()` is called so the
//     damped controls land cleanly on the new orientation.
//   • Delete a bookmark with one button.
//   • Persists to localStorage `forge.v4.cameraBookmarks` so the list
//     survives reloads (matches the persistence convention used by
//     EquationManager → `forge.v4.equations`, MaterialsBrowser →
//     `forge.v4.materials`, …).
//   • Reachable through the standard `tools.cameraBookmarks` menu
//     action (single new entry in Menus.jsx) and the imperative
//     `window.__forgeOpenCameraBookmarks(true)` host hook so Archie /
//     plugins / e2e drivers can toggle the panel without round-tripping
//     through the menu bus.
//
// Constraints honoured (PUSH-68 brief):
//   * NO new npm packages, NO new C++ libs — uses React + the OrbitControls
//     already exposed off `window.__forgeOrbit` by Viewport.jsx (PUSH-27).
//   * No MVP, no stub — the panel reads/writes the real camera through
//     the OrbitControls ref. No "TODO wire later" comments.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one import +
//     one mount). Viewport.jsx is untouched.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// ────────────── storage ──────────────

export const STORAGE_KEY = 'forge.v4.cameraBookmarks';

// Bookmarks are JSON-serialisable. Each entry:
//   { id: string, name: string, ts: number,
//     position: [x,y,z], target: [x,y,z] }
//
// id is a monotonically-incrementing string (`bm-<ms>-<rand>`) so two
// bookmarks saved in the same animation frame don't collide.
export function loadBookmarks() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Reject malformed entries on read — defensive against any older
    // schema bleed-through (we own the key, but be safe).
    return arr.filter((e) =>
      e && typeof e === 'object'
      && typeof e.id === 'string'
      && typeof e.name === 'string'
      && Array.isArray(e.position) && e.position.length === 3
      && Array.isArray(e.target)   && e.target.length === 3
      && e.position.every((n) => Number.isFinite(Number(n)))
      && e.target.every((n)   => Number.isFinite(Number(n))),
    ).map((e) => ({
      id: e.id,
      name: e.name,
      ts: Number.isFinite(Number(e.ts)) ? Number(e.ts) : Date.now(),
      position: e.position.map(Number),
      target:   e.target.map(Number),
    }));
  } catch { return []; }
}

export function saveBookmarks(arr) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch {}
}

// ────────────── camera read / write ──────────────

// Read the current camera state straight off the OrbitControls ref the
// Viewport exposes via window.__forgeOrbit. Returns null when the
// viewport hasn't mounted yet (e.g. the panel is the first thing the
// user opens before any 3D bodies have triggered the Canvas render).
export function readCameraState() {
  if (typeof window === 'undefined') return null;
  const orbit = window.__forgeOrbit;
  if (!orbit || !orbit.object || !orbit.target) return null;
  const p = orbit.object.position;
  const t = orbit.target;
  if (typeof p?.x !== 'number' || typeof t?.x !== 'number') return null;
  return {
    position: [Number(p.x), Number(p.y), Number(p.z)],
    target:   [Number(t.x), Number(t.y), Number(t.z)],
  };
}

// Restore a saved camera state onto the live OrbitControls. Sets the
// camera position + the orbit target, then calls update() so the
// damped controls land cleanly on the new orientation. Returns true
// when the write actually landed.
export function applyCameraState(state) {
  if (typeof window === 'undefined') return false;
  const orbit = window.__forgeOrbit;
  if (!orbit || !orbit.object || !orbit.target) return false;
  if (!state
      || !Array.isArray(state.position) || state.position.length < 3
      || !Array.isArray(state.target)   || state.target.length   < 3) return false;
  const [px, py, pz] = state.position.map(Number);
  const [tx, ty, tz] = state.target.map(Number);
  if (![px, py, pz, tx, ty, tz].every(Number.isFinite)) return false;
  orbit.object.position.set(px, py, pz);
  orbit.target.set(tx, ty, tz);
  // OrbitControls' damped state needs explicit update() — without it
  // the camera will drift back to wherever the damping was mid-flight.
  if (typeof orbit.object.updateProjectionMatrix === 'function') {
    orbit.object.updateProjectionMatrix();
  }
  if (typeof orbit.update === 'function') orbit.update();
  return true;
}

// ────────────── helpers ──────────────

function nextId() {
  // Crypto would be nice but is not a hard dep; ms+rand collision-free
  // enough for a user-side bookmark list that tops out in the tens.
  return `bm-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function fmtCoord(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  // 2 decimals is the right resolution for a viewport in mm.
  return v.toFixed(2);
}

// Default label — counter is computed off the current list length so
// repeated Save clicks produce "View 1", "View 2", "View 3", … without
// the user having to clear the field. The user can rename inline.
function defaultName(list) {
  const used = new Set(list.map((b) => b.name));
  let n = list.length + 1;
  while (used.has(`View ${n}`)) n += 1;
  return `View ${n}`;
}

// ────────────── styles ──────────────

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 320,
  zIndex: 1330,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};
const closeBtn = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const saveBtn = {
  background: 'var(--forge-accent-mute)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  padding: '6px 10px',
  cursor: 'pointer',
  fontFamily: 'var(--forge-mono)',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 4,
};
const rowBaseStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr auto auto',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 4,
  background: 'var(--forge-surface)',
};
const rowBtn = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 3,
  fontSize: 11,
};
const dangerBtn = {
  ...rowBtn,
  color: 'var(--forge-bad, #ff6363)',
};
const renameInputStyle = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  font: 'inherit', fontSize: 12,
  padding: '2px 4px',
  borderRadius: 3,
  minWidth: 0,
  width: '100%',
};
const coordRow = {
  fontFamily: 'var(--forge-mono)',
  fontSize: 10,
  color: 'var(--forge-ink-mute)',
  gridColumn: '1 / -1',
  display: 'flex', justifyContent: 'space-between',
  marginTop: 2,
};
const emptyHint = {
  color: 'var(--forge-ink-mute)',
  fontSize: 11,
  padding: '8px 0',
  borderTop: '1px dashed var(--forge-rail-edge)',
  borderBottom: '1px dashed var(--forge-rail-edge)',
  textAlign: 'center',
};

// ────────────── panel ──────────────

export function CameraBookmarksPanel({ open, onClose }) {
  const [bookmarks, setBookmarks] = useState(() => loadBookmarks());
  const [editing, setEditing] = useState(null); // bookmark id being renamed
  const [lastError, setLastError] = useState(null);

  // Persist on every change. We hold state in React but localStorage is
  // the source of truth across reloads.
  useEffect(() => { saveBookmarks(bookmarks); }, [bookmarks]);

  // Re-hydrate on open so the panel reflects any external mutation
  // (e.g. another browser tab / a plugin writing the key directly).
  useEffect(() => {
    if (!open) return;
    setBookmarks(loadBookmarks());
    setEditing(null);
    setLastError(null);
  }, [open]);

  const canCapture = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return !!(window.__forgeOrbit && window.__forgeOrbit.object);
  }, [open, bookmarks.length]);

  const onSave = useCallback(() => {
    const state = readCameraState();
    if (!state) {
      setLastError('Viewport not ready — orbit camera not exposed yet');
      return;
    }
    setLastError(null);
    setBookmarks((arr) => {
      const name = defaultName(arr);
      const next = [...arr, {
        id: nextId(),
        name,
        ts: Date.now(),
        position: state.position,
        target:   state.target,
      }];
      return next;
    });
  }, []);

  const onRestore = useCallback((bm) => {
    const ok = applyCameraState(bm);
    if (!ok) {
      setLastError('Viewport not ready — orbit camera not exposed yet');
      return;
    }
    setLastError(null);
    // Mirror to window so an e2e harness can deterministically read what
    // the panel just applied without poking at orbit.object.position.
    if (typeof window !== 'undefined') {
      window.__forgeCameraBookmarkLastRestored = {
        id: bm.id, name: bm.name,
        position: bm.position.slice(), target: bm.target.slice(),
        ts: Date.now(),
      };
      window.dispatchEvent(new CustomEvent('forge:camera-bookmark-restored',
                                           { detail: window.__forgeCameraBookmarkLastRestored }));
    }
  }, []);

  const onDelete = useCallback((id) => {
    setBookmarks((arr) => arr.filter((b) => b.id !== id));
  }, []);

  const onRename = useCallback((id, name) => {
    // Trim and reject all-whitespace; otherwise the row label collapses
    // and the user can't find the row again to fix the typo.
    const clean = String(name || '').trim();
    if (!clean) return;
    setBookmarks((arr) => arr.map((b) => b.id === id ? { ...b, name: clean } : b));
  }, []);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-camera-bookmarks-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between',
                       alignItems: 'center', gap: 8 }}>
        <strong>Camera Bookmarks</strong>
        <button onClick={onClose}
                data-testid="forge-camera-bookmarks-close"
                style={closeBtn}>×</button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.4 }}
           data-testid="forge-camera-bookmarks-help">
        Save the current camera framing under a label. Click a row to
        restore the saved position + target. Persists to <code>
        forge.v4.cameraBookmarks</code>.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          style={saveBtn}
          onClick={onSave}
          data-testid="forge-camera-bookmarks-save"
          disabled={!canCapture}
          title={canCapture ? 'Capture current camera as a new bookmark'
                            : 'Viewport not ready yet'}>
          Save current view
        </button>
        <span style={{ color: 'var(--forge-ink-mute)', fontSize: 11 }}
              data-testid="forge-camera-bookmarks-count"
              data-count={bookmarks.length}>
          {bookmarks.length} saved
        </span>
      </div>

      {lastError && (
        <div data-testid="forge-camera-bookmarks-error"
             style={{ color: 'var(--forge-bad, #ff6363)', fontSize: 11 }}>
          {lastError}
        </div>
      )}

      {bookmarks.length === 0 ? (
        <div style={emptyHint}
             data-testid="forge-camera-bookmarks-empty">
          No bookmarks yet — frame your view, then click <em>Save current view</em>.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0,
                     display: 'flex', flexDirection: 'column', gap: 6 }}
            data-testid="forge-camera-bookmarks-list">
          {bookmarks.map((bm) => {
            const isEditing = editing === bm.id;
            return (
              <li key={bm.id}
                  data-testid={`forge-camera-bookmark-row-${bm.id}`}
                  data-bookmark-name={bm.name}
                  style={rowBaseStyle}>
                {isEditing ? (
                  <input
                    type="text"
                    defaultValue={bm.name}
                    autoFocus
                    style={renameInputStyle}
                    data-testid={`forge-camera-bookmark-rename-${bm.id}`}
                    onBlur={(e) => { onRename(bm.id, e.target.value); setEditing(null); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { onRename(bm.id, e.target.value); setEditing(null); }
                      else if (e.key === 'Escape') { setEditing(null); }
                    }} />
                ) : (
                  <button
                    type="button"
                    onClick={() => onRestore(bm)}
                    onDoubleClick={() => setEditing(bm.id)}
                    style={{
                      ...rowBtn,
                      textAlign: 'left',
                      flex: 1,
                      borderColor: 'transparent',
                      background: 'transparent',
                      fontWeight: 600,
                      padding: '2px 0',
                    }}
                    data-testid={`forge-camera-bookmark-restore-${bm.id}`}
                    title="Click to restore · Double-click to rename">
                    {bm.name}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditing(bm.id)}
                  style={rowBtn}
                  data-testid={`forge-camera-bookmark-edit-${bm.id}`}
                  title="Rename this bookmark">
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(bm.id)}
                  style={dangerBtn}
                  data-testid={`forge-camera-bookmark-delete-${bm.id}`}
                  title="Delete this bookmark">
                  Delete
                </button>
                <div style={coordRow}
                     data-testid={`forge-camera-bookmark-coords-${bm.id}`}
                     data-position={JSON.stringify(bm.position)}
                     data-target={JSON.stringify(bm.target)}>
                  <span>
                    pos&nbsp;[{fmtCoord(bm.position[0])},&nbsp;
                    {fmtCoord(bm.position[1])},&nbsp;
                    {fmtCoord(bm.position[2])}]
                  </span>
                  <span>
                    tgt&nbsp;[{fmtCoord(bm.target[0])},&nbsp;
                    {fmtCoord(bm.target[1])},&nbsp;
                    {fmtCoord(bm.target[2])}]
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ────────────── host ──────────────

export function CameraBookmarksPanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenCameraBookmarks  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseCameraBookmarks = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.cameraBookmarks') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      delete window.__forgeOpenCameraBookmarks;
      delete window.__forgeCloseCameraBookmarks;
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <CameraBookmarksPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default CameraBookmarksPanel;
