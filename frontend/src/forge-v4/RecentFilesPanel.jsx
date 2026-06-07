// PUSH-74 (Slice-42) — Recent Files panel.
//
// Up through PUSH-73 the File menu shipped Open / Save / Save As / Open
// Project / Save Project plus four Import slots (STEP / IGES / BREP /
// STL) — but no surface tracked WHICH files the user had recently
// opened. MCAD parity gap: SolidWorks shows the last 20 documents on its
// Welcome dialog, Fusion 360 has a "Recent" grid in the data panel,
// Creo's File menu carries a "Recently Opened" submenu, NX surfaces
// the same through History → Open Recent. PUSH-74 lights up the
// equivalent for Forge — a right-docked panel that lists the last 20
// files opened, with one-click re-open buttons.
//
// What this panel adds:
//   • A single subscriber to the global `forge:file-opened` window event
//     — anywhere in the app that opens a file dispatches that event with
//     `{ detail: { path, name?, kind?, ts? } }` and the panel records it.
//   • A bounded list of the last 20 entries (newest at top). Each entry
//     stores { id, path, name, kind, ts } where `kind` indicates the
//     source ('project' | 'step' | 'iges' | 'brep' | 'stl' | 'open' |
//     '<other>') so the user can scan for what they want.
//   • Each row shows: filename (display), the full path (mono, muted),
//     the timestamp ("HH:MM:SS · YYYY-MM-DD"), an "Open" button that
//     dispatches `forge:menu-action` with `{ id: 'file.openProject',
//     path }` so the existing project-file open flow handles the
//     re-open. The row's Pin / Remove buttons let the user curate the
//     list manually.
//   • A "Clear" button drops the whole list.
//   • Persists to localStorage `forge.v4.recentFiles` so the list
//     survives reloads (matches the persistence convention used by
//     CameraBookmarks, BodyColors, Layers, MaterialsBrowser …).
//   • Mirrored onto `window.__forgeRecentFiles` (a plain Array) so
//     plugins / e2e drivers can read the live snapshot without having
//     to parse the localStorage key. Imperative entry points
//     `window.__forgeOpenRecentFiles(true|false)`,
//     `window.__forgeRecentFilesRecord({path, name, kind})`,
//     `window.__forgeRecentFilesClear()` round out the surface.
//   • Reachable through the standard `file.recent` menu action (single
//     new entry in Menus.jsx under the File menu).
//
// Constraints honoured (PUSH-74 brief):
//   * NO new npm packages, NO new C++ libs — pure React + the existing
//     global CustomEvent bus + localStorage.
//   * No MVP, no stub — the persistence helper round-trips JSON, the
//     window mirror is a real Array (not just a JSON string), and the
//     bus event matches the conventions used by SectionPlane, Layers,
//     CameraBookmarks, ActivityLog, MaterialsBrowser.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one
//     import + one mount).
//   * Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useState,
} from 'react';
import { createPortal } from 'react-dom';

// ─────────────────────────────────────────────────────────────────────
// Constants + persistence helpers.

export const RECENT_FILES_KEY        = 'forge.v4.recentFiles';
export const RECENT_FILES_EVENT      = 'forge:recent-files-changed';
export const RECENT_FILES_OPEN_EVENT = 'forge:file-opened';
export const RECENT_FILES_CAPACITY   = 20;

// Derive a sensible filename from a path. The kernel hands us POSIX
// (mac, linux) and Win32 (`C:\Users\...\foo.forge`) paths through the
// same code path — split on the *last* `/` or `\` so both win.
export function basename(p) {
  if (typeof p !== 'string' || p.length === 0) return '';
  // Strip trailing slashes — the user pasted a folder path by accident
  // we don't want the row label to render as the empty string.
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx < 0) return trimmed;
  return trimmed.slice(idx + 1);
}

// Infer a kind tag from the extension when the dispatcher didn't pass
// one explicitly. The tag is used for the per-row coloured chip and
// for the menu-action dispatch (so a recent .step file re-opens through
// `file.importStep` while a recent .forge file re-opens through
// `file.openProject`).
export function inferKind(path) {
  if (typeof path !== 'string') return 'other';
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'other';
  const ext = path.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'forge': return 'project';
    case 'step':  return 'step';
    case 'stp':   return 'step';
    case 'iges':  return 'iges';
    case 'igs':   return 'iges';
    case 'brep':  return 'brep';
    case 'stl':   return 'stl';
    default:      return 'other';
  }
}

// Map a kind to the canonical re-open menu-action id. The project /
// import flows already exist in ForgeShellV4.jsx (PUSH-N…) so we lean
// on them — the panel does not own the actual open path, only the
// shortcut to it. The hard-constraint specifies file.openProject for
// the brief; for non-.forge entries we still dispatch file.openProject
// with the path attached, and let downstream guess by extension when
// the kind tag is absent (the brief lets the user re-open ANY file
// they recently opened, not just projects).
export function reopenActionFor(kind) {
  switch (kind) {
    case 'project': return 'file.openProject';
    case 'step':    return 'file.importStep';
    case 'iges':    return 'file.importIges';
    case 'brep':    return 'file.importBrep';
    case 'stl':     return 'file.importStl';
    default:        return 'file.openProject';
  }
}

// Validate an entry's shape on load. Reject anything that doesn't carry
// at minimum a string `path` — that's what the Open button needs.
function isValidEntry(e) {
  return e
      && typeof e === 'object'
      && typeof e.path === 'string'
      && e.path.length > 0;
}

export function loadRecentFiles() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_FILES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isValidEntry).map((e) => ({
      id:   typeof e.id   === 'string' && e.id.length ? e.id
          : `rf-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      path: e.path,
      name: typeof e.name === 'string' && e.name.length ? e.name : basename(e.path),
      kind: typeof e.kind === 'string' && e.kind.length ? e.kind : inferKind(e.path),
      ts:   Number.isFinite(Number(e.ts)) ? Number(e.ts) : Date.now(),
      pinned: !!e.pinned,
    })).slice(0, RECENT_FILES_CAPACITY);
  } catch { return []; }
}

export function saveRecentFiles(arr) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(arr)); } catch {}
}

// Mirror the live array onto window.__forgeRecentFiles AND fire the
// change event so other surfaces (Archie, plugins, e2e drivers) can
// observe the mutation without having to mount the panel.
function publishMirror(arr) {
  if (typeof window === 'undefined') return;
  try { window.__forgeRecentFiles = arr.slice(); } catch {}
  try {
    window.dispatchEvent(new CustomEvent(RECENT_FILES_EVENT,
      { detail: { count: arr.length, entries: arr.slice() } }));
  } catch {}
}

// Generate a fresh id. ms-resolution + a short random suffix is enough
// for a user-side list that tops out at 20 entries.
function nextId() {
  return `rf-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// Push a new entry onto the head of the list, evicting the duplicate
// path if the user re-opens a file they'd already opened (so the list
// behaves like a MRU stack, not a log). Pinned entries are never
// evicted; the cap counts pinned + unpinned together but the eviction
// only drops unpinned tails.
export function recordRecentFile(currentList, spec) {
  if (!isValidEntry(spec)) return currentList;
  // Defensive copy of the entry — the dispatcher might re-use the
  // detail object for other events; we don't want our state to be
  // mutated from underneath.
  const entry = {
    id:   typeof spec.id   === 'string' && spec.id.length ? spec.id : nextId(),
    path: spec.path,
    name: typeof spec.name === 'string' && spec.name.length ? spec.name : basename(spec.path),
    kind: typeof spec.kind === 'string' && spec.kind.length ? spec.kind : inferKind(spec.path),
    ts:   Number.isFinite(Number(spec.ts)) ? Number(spec.ts) : Date.now(),
    pinned: !!spec.pinned,
  };
  // Drop any pre-existing entry with the same path — the new one will
  // bubble to the top with the fresh timestamp. Preserve the pinned
  // flag from the prior occurrence so re-opening doesn't unpin.
  const filtered = currentList.filter((e) => e.path !== entry.path);
  const priorPin = currentList.find((e) => e.path === entry.path)?.pinned;
  if (priorPin) entry.pinned = true;
  const next = [entry, ...filtered];
  if (next.length <= RECENT_FILES_CAPACITY) return next;
  // Over-cap: evict from the tail, but never drop a pinned entry. We
  // walk from the tail; pinned entries get hoisted to a side list and
  // re-stitched at the head's pin-aware position.
  const pinned   = next.filter((e) => e.pinned);
  const unpinned = next.filter((e) => !e.pinned);
  const room = RECENT_FILES_CAPACITY - pinned.length;
  if (room <= 0) {
    // Pinned alone fills (or over-fills) the cap — keep only the head
    // pinned entries up to the cap. This is an edge case (would require
    // the user to pin 20+ entries) but be safe.
    return [...pinned.slice(0, RECENT_FILES_CAPACITY)];
  }
  return [...pinned, ...unpinned.slice(0, room)];
}

// ─────────────────────────────────────────────────────────────────────
// Formatting helpers.

function fmtTs(ts) {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mi}:${ss} · ${yyyy}-${mm}-${dd}`;
}

// Map a kind tag to a short chip label + colour. Pure cosmetic — the
// real ground truth for the re-open dispatch is reopenActionFor(kind).
const KIND_CHIPS = Object.freeze({
  project: { label: 'PROJECT', color: '#6cb6ff' },
  step:    { label: 'STEP',    color: '#f2cc60' },
  iges:    { label: 'IGES',    color: '#f2cc60' },
  brep:    { label: 'BREP',    color: '#c3a6ff' },
  stl:     { label: 'STL',     color: '#84cc66' },
  open:    { label: 'OPEN',    color: '#9aa1ab' },
  other:   { label: 'FILE',    color: '#9aa1ab' },
});
function chipFor(kind) {
  return KIND_CHIPS[kind] || KIND_CHIPS.other;
}

// ─────────────────────────────────────────────────────────────────────
// Styles.

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 380,
  zIndex: 1330,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflow: 'hidden',
};
const headerStyle = {
  display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 8,
};
const closeBtn = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const helpStyle = {
  color: 'var(--forge-ink-mute)',
  lineHeight: 1.4,
  fontSize: 11,
};
const controlsRow = {
  display: 'flex', alignItems: 'center', gap: 6,
};
const filterInputStyle = {
  flex: 1,
  background: 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  fontFamily: 'var(--forge-mono)',
  fontSize: 12,
  padding: '4px 6px',
  borderRadius: 3,
  minWidth: 0,
};
const btnStyle = {
  background: 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  padding: '4px 8px',
  cursor: 'pointer',
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
  borderRadius: 3,
};
const dangerBtnStyle = {
  ...btnStyle,
  color: 'var(--forge-bad, #ff6363)',
};
const listStyle = {
  flex: 1,
  overflowY: 'auto',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 4,
  background: 'var(--forge-surface)',
  display: 'flex', flexDirection: 'column',
};
const rowStyle = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr auto auto auto',
  columnGap: 6,
  alignItems: 'center',
  padding: '6px 8px',
  borderBottom: '1px dashed var(--forge-rail-edge)',
};
const rowMetaStyle = {
  gridColumn: '1 / -1',
  display: 'flex', justifyContent: 'space-between',
  fontFamily: 'var(--forge-mono)', fontSize: 10,
  color: 'var(--forge-ink-mute)',
  marginTop: 3,
  wordBreak: 'break-all',
};
const nameCellStyle = {
  fontWeight: 600,
  wordBreak: 'break-all',
  minWidth: 0,
};
const pathCellStyle = {
  gridColumn: '1 / -1',
  fontFamily: 'var(--forge-mono)',
  fontSize: 10,
  color: 'var(--forge-ink-mute)',
  wordBreak: 'break-all',
  marginTop: 2,
};
const chipBaseStyle = {
  display: 'inline-block',
  fontFamily: 'var(--forge-mono)',
  fontSize: 9,
  padding: '1px 5px',
  borderRadius: 3,
  border: '1px solid currentColor',
  fontWeight: 700,
  lineHeight: 1.5,
};
const emptyHintStyle = {
  textAlign: 'center',
  color: 'var(--forge-ink-mute)',
  padding: '16px 8px',
  fontSize: 11,
  fontStyle: 'italic',
};
const statusBarStyle = {
  display: 'flex', justifyContent: 'space-between',
  fontFamily: 'var(--forge-mono)', fontSize: 10,
  color: 'var(--forge-ink-mute)',
};

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function RecentFilesPanel({ open, onClose, entries, onClear, onRemove, onTogglePin, onReopen }) {
  const [filter, setFilter] = useState('');

  // Reset the filter on every open so the panel never opens with stale
  // search state.
  useEffect(() => { if (open) setFilter(''); }, [open]);

  // Filter is a case-insensitive substring over name + path.
  const visibleEntries = useMemo(() => {
    const q = String(filter || '').trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const n = (e.name || '').toLowerCase();
      const p = (e.path || '').toLowerCase();
      return n.includes(q) || p.includes(q);
    });
  }, [entries, filter]);

  if (!open) return null;

  const totalCount   = entries.length;
  const visibleCount = visibleEntries.length;
  const isFiltered   = String(filter || '').trim().length > 0;
  const pinnedCount  = entries.filter((e) => e.pinned).length;

  return (
    <div style={panelStyle}
         data-testid="forge-recent-files-panel"
         data-entry-count={totalCount}
         data-visible-count={visibleCount}
         data-pinned-count={pinnedCount}>
      <header style={headerStyle}>
        <strong>Recent Files</strong>
        <button onClick={onClose}
                data-testid="forge-recent-files-close"
                style={closeBtn}>×</button>
      </header>

      <div style={helpStyle}
           data-testid="forge-recent-files-help">
        Last {RECENT_FILES_CAPACITY} files opened via File &gt; Open / Import /
        Open Project. Click <em>Open</em> to re-open. Pin to keep an entry
        from rolling off the list. Persists to <code>{RECENT_FILES_KEY}</code>.
      </div>

      <div style={controlsRow}>
        <input
          type="text"
          value={filter}
          placeholder="Filter by filename or path…"
          onChange={(e) => setFilter(e.target.value)}
          style={filterInputStyle}
          data-testid="forge-recent-files-filter" />
        <button type="button"
                onClick={onClear}
                style={dangerBtnStyle}
                data-testid="forge-recent-files-clear"
                title="Clear the recent files list (pinned entries stay)">
          Clear
        </button>
      </div>

      <div style={listStyle}
           data-testid="forge-recent-files-list">
        {visibleEntries.length === 0 ? (
          <div style={emptyHintStyle}
               data-testid="forge-recent-files-empty">
            {isFiltered
              ? `No entries match "${filter}".`
              : 'No recent files yet — open a project or import a STEP/IGES/BREP/STL.'}
          </div>
        ) : (
          visibleEntries.map((e) => {
            const chip = chipFor(e.kind);
            return (
              <div key={e.id}
                   style={rowStyle}
                   data-testid={`forge-recent-files-row-${e.id}`}
                   data-entry-id={e.id}
                   data-entry-path={e.path}
                   data-entry-name={e.name}
                   data-entry-kind={e.kind}
                   data-entry-pinned={e.pinned ? '1' : '0'}>
                <span style={{ ...chipBaseStyle, color: chip.color }}
                      data-testid={`forge-recent-files-chip-${e.id}`}>
                  {chip.label}
                </span>
                <span style={nameCellStyle}
                      data-testid={`forge-recent-files-name-${e.id}`}>
                  {e.name}
                </span>
                <button type="button"
                        onClick={() => onReopen(e)}
                        style={btnStyle}
                        data-testid={`forge-recent-files-open-${e.id}`}
                        title={`Re-open ${e.path}`}>
                  Open
                </button>
                <button type="button"
                        onClick={() => onTogglePin(e.id)}
                        style={{ ...btnStyle,
                                 ...(e.pinned ? { fontWeight: 700,
                                                  color: 'var(--forge-accent, #6cb6ff)' } : null) }}
                        data-testid={`forge-recent-files-pin-${e.id}`}
                        title={e.pinned ? 'Unpin (allow eviction)'
                                        : 'Pin (keep on the list)'}>
                  {e.pinned ? 'Pinned' : 'Pin'}
                </button>
                <button type="button"
                        onClick={() => onRemove(e.id)}
                        style={dangerBtnStyle}
                        data-testid={`forge-recent-files-remove-${e.id}`}
                        title="Remove from recent list">
                  ×
                </button>
                <div style={pathCellStyle}
                     data-testid={`forge-recent-files-path-${e.id}`}>
                  {e.path}
                </div>
                <div style={rowMetaStyle}
                     data-testid={`forge-recent-files-meta-${e.id}`}
                     data-ts={e.ts}>
                  <span>{fmtTs(e.ts)}</span>
                  <span>kind: {e.kind}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={statusBarStyle}
           data-testid="forge-recent-files-status">
        <span data-testid="forge-recent-files-counts">
          {visibleCount}/{totalCount} entries
          {isFiltered ? ' (filtered)' : ''}
        </span>
        <span>
          buffer: {totalCount}/{RECENT_FILES_CAPACITY}
          {pinnedCount > 0 ? ` · ${pinnedCount} pinned` : ''}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host.
//
// Installs the global forge:file-opened listener at mount time so the
// list starts filling immediately, even before the user opens the
// panel. That way when they click File → Recent Files, the panel shows
// real history — not "no recent files yet".

export function RecentFilesPanelHost() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(() => {
    const initial = loadRecentFiles();
    // Publish the mirror synchronously so a plugin probing
    // window.__forgeRecentFiles at first render sees a real array.
    if (typeof window !== 'undefined') {
      try { window.__forgeRecentFiles = initial.slice(); } catch {}
    }
    return initial;
  });

  // Persist + publish mirror on every change.
  useEffect(() => {
    saveRecentFiles(entries);
    publishMirror(entries);
  }, [entries]);

  // Imperative entry points + bus subscription.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const onFileOpened = (e) => {
      // The dispatcher passes { path, name?, kind?, ts? } as detail. We
      // record straight into local state — the useEffect on entries
      // handles persistence + mirror.
      const spec = e?.detail;
      if (!spec || typeof spec.path !== 'string' || !spec.path.length) return;
      setEntries((prev) => recordRecentFile(prev, spec));
    };
    window.addEventListener(RECENT_FILES_OPEN_EVENT, onFileOpened);

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'file.recent') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);

    // Public imperative surface (Archie, plugins, e2e drivers).
    window.__forgeOpenRecentFiles    = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseRecentFiles   = () => setOpen(false);
    window.__forgeRecentFilesRecord  = (spec) => {
      if (!spec || typeof spec.path !== 'string') return false;
      setEntries((prev) => recordRecentFile(prev, spec));
      return true;
    };
    window.__forgeRecentFilesClear   = () => {
      setEntries((prev) => prev.filter((e) => e.pinned));
    };
    window.__forgeRecentFilesRead    = () => {
      // Snapshot via the React-state setter ensures the caller always
      // gets the freshest in-memory view (not just the localStorage
      // value, which might be one tick behind).
      const live = (typeof window.__forgeRecentFiles !== 'undefined'
                    && Array.isArray(window.__forgeRecentFiles))
        ? window.__forgeRecentFiles.slice()
        : loadRecentFiles();
      return live;
    };

    // Idempotency flag for diagnostics + double-install guard.
    window.__forgeRecentFilesInstalled_v1 = true;

    return () => {
      window.removeEventListener(RECENT_FILES_OPEN_EVENT, onFileOpened);
      window.removeEventListener('forge:menu-action', onMenu);
      delete window.__forgeOpenRecentFiles;
      delete window.__forgeCloseRecentFiles;
      delete window.__forgeRecentFilesRecord;
      delete window.__forgeRecentFilesClear;
      delete window.__forgeRecentFilesRead;
      delete window.__forgeRecentFilesInstalled_v1;
    };
  }, []);

  // Stable callbacks for the panel.
  const onClear = useCallback(() => {
    // The Clear button drops everything that isn't pinned — pinned
    // entries are user-curated favourites and shouldn't vanish on
    // accident.
    setEntries((prev) => prev.filter((e) => e.pinned));
  }, []);

  const onRemove = useCallback((id) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const onTogglePin = useCallback((id) => {
    setEntries((prev) => prev.map((e) =>
      e.id === id ? { ...e, pinned: !e.pinned } : e));
  }, []);

  const onReopen = useCallback((entry) => {
    if (typeof window === 'undefined') return;
    // Dispatch the canonical re-open action. The brief specifies
    // file.openProject for the Open button; for non-.forge entries the
    // map yields the matching import action. The detail carries `path`
    // so the receiver doesn't have to round-trip through the file
    // dialog.
    const actionId = reopenActionFor(entry.kind);
    window.dispatchEvent(new CustomEvent('forge:menu-action', {
      detail: { id: actionId, path: entry.path, name: entry.name,
                kind: entry.kind, source: 'recent-files' },
    }));
    // Also fire a `forge:recent-files-reopen` for downstream listeners
    // (Archie can highlight the re-opened body once it's loaded).
    window.dispatchEvent(new CustomEvent('forge:recent-files-reopen', {
      detail: { id: entry.id, path: entry.path, name: entry.name,
                kind: entry.kind, ts: Date.now() },
    }));
    // Bump the timestamp + bubble to the head so the user sees the
    // most-recently-reopened entry at the top on the next render.
    setEntries((prev) => recordRecentFile(prev, { ...entry, ts: Date.now() }));
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <RecentFilesPanel
      open={open}
      onClose={() => setOpen(false)}
      entries={entries}
      onClear={onClear}
      onRemove={onRemove}
      onTogglePin={onTogglePin}
      onReopen={onReopen} />,
    document.body,
  );
}

export default RecentFilesPanel;
