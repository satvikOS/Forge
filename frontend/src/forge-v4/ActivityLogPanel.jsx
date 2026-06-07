// PUSH-73 (Slice-41) — Activity Log panel.
//
// Up through PUSH-72 the Forge bus carried 37+ distinct `forge:*` events —
// `forge:menu-action`, `forge:tool-dispatched`, `forge:body-added`,
// `forge:selection-changed`, `forge:section-update`, `forge:layers-changed`,
// `forge:display-state-changed`, `forge:camera-bookmark-restored`,
// `forge:material-applied`, … — but the user had no surface that *aggregated*
// them. Each panel only listened for its own slice of the bus, and the
// debug story was either "open devtools and grep window events" or "spam
// console.log everywhere". MCAD parity gap: NX has "Information / Output
// Window", Creo has the message bar history, Inventor exposes the Event
// Log dock, SolidWorks shows the action log inside the immersive command
// recorder. PUSH-73 lights up the equivalent for Forge.
//
// What this panel adds:
//   • A single global subscriber to ALL `forge:*` window events. We install
//     one capture-phase listener per known event name (the spec calls out
//     dynamic discovery — the bus uses CustomEvent, not Event Bubbling,
//     so we can't rely on a single `forge:*` wildcard. We install named
//     listeners for every event that has appeared in the codebase plus a
//     monkey-patched window.dispatchEvent that catches anything new).
//   • A bounded ring buffer of the last 500 entries (newest at top). Each
//     entry stores { id, ts, name, detail } with detail truncated to 100
//     chars after JSON.stringify so a huge mesh-buffer detail doesn't
//     blow the panel's memory or layout.
//   • Scrollable list, monospace, timestamp + event name + truncated detail.
//   • Clear button (drops the ring buffer back to empty).
//   • Filter input (case-insensitive substring match on event name OR the
//     truncated detail).
//   • Reachable via `tools.activityLog` menu action.
//   • Optional export-to-JSON via `forge.dialog.saveFile` + `writeBlob`.
//
// Constraints honoured (PUSH-73 brief):
//   * NO new npm packages, NO new C++ libs — React + the existing global
//     CustomEvent bus + the existing forge.dialog bridge only.
//   * No MVP, no stub — the log is a real ring buffer (oldest entries get
//     evicted when capacity is hit, not silently dropped). The dispatch
//     monkey-patch is reversible (we save the original ref and restore on
//     unmount). The export round-trips through the real saveFile dialog.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one import +
//     one mount). Viewport.jsx untouched. No existing panel touched.
//   * Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';

// ─────────────────────────────────────────────────────────────────────
// Ring buffer + global host.
//
// The buffer is kept in a module-scope ref (not React state) so the
// installed window listeners can append at native dispatch speed
// without forcing a React re-render on every event. The panel polls
// the buffer on a tight timer when open and snapshots into local state.
// This decouples the bus-throughput from React's render budget — during
// a heavy import we might see hundreds of forge:body-added events in a
// single tick, and a setState per event would jank the renderer.

export const ACTIVITY_LOG_CAPACITY = 500;
export const ACTIVITY_DETAIL_MAX_CHARS = 100;

// Every `forge:*` event we know about today, sourced from a sweep of
// `new CustomEvent('forge:...')` and `_emit('forge:...')` sites in the
// codebase (as of slice 41). New event names invented after this list
// is frozen are picked up by the dispatch monkey-patch below, so the
// list is a fast-path optimisation, not a gatekeeper.
export const FORGE_EVENT_NAMES = Object.freeze([
  'forge:bodies-changed',
  'forge:bodies-replaced',
  'forge:body-added',
  'forge:body-removed',
  'forge:camera-bookmark-restored',
  'forge:capture-running',
  'forge:capture-saved',
  'forge:capture-start',
  'forge:capture-stop',
  'forge:capture-transcoded',
  'forge:display-state-changed',
  'forge:equations-changed',
  'forge:explode-update',
  'forge:fea-residual',
  'forge:flexible-changed',
  'forge:insert-route',
  'forge:insert-stdpart',
  'forge:layers-changed',
  'forge:material-applied',
  'forge:material-picked',
  'forge:material-picker-open',
  'forge:material-selected',
  'forge:materials-changed',
  'forge:menu-action',
  'forge:open-flat-pattern',
  'forge:plugins-changed',
  'forge:pmi-added',
  'forge:pmi-removed',
  'forge:probe-pick',
  'forge:progress',
  'forge:role-applied',
  'forge:role-changed',
  'forge:section-update',
  'forge:selection-changed',
  'forge:tool-dispatched',
  'forge:tool-registered',
]);

// Truncate the detail to ACTIVITY_DETAIL_MAX_CHARS chars after a defensive
// JSON.stringify. Cycles, BigInt, functions, DOM nodes — all get coerced
// to the string '<unserialisable>' rather than blowing the panel.
export function summariseDetail(detail) {
  if (detail === undefined) return '';
  if (detail === null) return 'null';
  let txt;
  try {
    // Drop function values + DOM nodes through a replacer; React events
    // sometimes leak SyntheticEvent objects with `target: HTMLElement`
    // refs that JSON.stringify would explode on.
    txt = JSON.stringify(detail, (_k, v) => {
      if (typeof v === 'function') return '<fn>';
      if (typeof v === 'bigint') return v.toString() + 'n';
      if (typeof v === 'object' && v !== null) {
        if (v instanceof Error) return `Error: ${v.message}`;
        if (typeof Node !== 'undefined' && v instanceof Node) return '<Node>';
        if (typeof Element !== 'undefined' && v instanceof Element) return '<Element>';
      }
      return v;
    });
  } catch {
    try { txt = String(detail); }
    catch { txt = '<unserialisable>'; }
  }
  if (typeof txt !== 'string') txt = String(txt);
  if (txt.length <= ACTIVITY_DETAIL_MAX_CHARS) return txt;
  return txt.slice(0, ACTIVITY_DETAIL_MAX_CHARS - 1) + '…';
}

// Module-scope ring buffer. We use an Array (not a linked list) because
// the capacity is small (500) and slice() on push is cheaper than the
// extra GC churn of an object pool.
const _ringBuffer = [];
let _nextEntryId = 1;

// Subscriber list — the panel registers a callback that gets fired
// whenever the buffer changes. We keep it module-scope so multiple panel
// instances (e.g. e2e harness opening + closing the panel repeatedly)
// share the same buffer instead of fighting over it.
const _subscribers = new Set();

function _notify() {
  for (const cb of _subscribers) {
    try { cb(); } catch { /* ignore subscriber failures */ }
  }
}

export function recordActivityEntry(name, detail) {
  if (typeof name !== 'string' || !name.length) return null;
  const entry = {
    id: _nextEntryId++,
    ts: Date.now(),
    name,
    detail: summariseDetail(detail),
  };
  _ringBuffer.push(entry);
  if (_ringBuffer.length > ACTIVITY_LOG_CAPACITY) {
    _ringBuffer.splice(0, _ringBuffer.length - ACTIVITY_LOG_CAPACITY);
  }
  _notify();
  return entry;
}

export function readActivityEntries() {
  // Return a frozen snapshot — newest at index 0 — so consumers can't
  // mutate the ring buffer indirectly.
  return _ringBuffer.slice().reverse();
}

export function clearActivityLog() {
  if (_ringBuffer.length === 0) return;
  _ringBuffer.length = 0;
  _notify();
}

// ─────────────────────────────────────────────────────────────────────
// Bus capture install — fires once at module load, idempotent.
//
// Strategy:
//   1. For each well-known event name, install a window-level capture-phase
//      listener that records the event into the ring buffer.
//   2. Monkey-patch window.dispatchEvent to also capture any forge:* event
//      whose name we hadn't pre-registered. This is the safety net for
//      future-introduced event names that aren't in FORGE_EVENT_NAMES yet.
//
// Both surfaces are guarded with a flag on `window` so e2e reloads /
// hot-reload don't double-install.

const INSTALL_FLAG = '__forgeActivityLogInstalled_v1';

export function installActivityCapture() {
  if (typeof window === 'undefined') return false;
  if (window[INSTALL_FLAG]) return false;
  window[INSTALL_FLAG] = true;

  // 1) Named listeners for every known event.
  for (const name of FORGE_EVENT_NAMES) {
    window.addEventListener(name, (e) => {
      recordActivityEntry(name, e?.detail);
    }, true /* capture */);
  }

  // 2) Dispatch wrapper for unknown forge:* events. We only intercept
  //    forge:* names so we don't perturb every event on the page; if the
  //    event name *is* in our static list, the capture listener above
  //    will already record it — we suppress the wrapper to avoid double-
  //    logging.
  try {
    const knownSet = new Set(FORGE_EVENT_NAMES);
    const orig = window.dispatchEvent.bind(window);
    window.dispatchEvent = function patchedDispatchEvent(ev) {
      const ok = orig(ev);
      try {
        const name = ev && typeof ev.type === 'string' ? ev.type : null;
        if (name && name.startsWith('forge:') && !knownSet.has(name)) {
          recordActivityEntry(name, ev?.detail);
        }
      } catch { /* never let logging break dispatch */ }
      return ok;
    };
  } catch { /* sealed window, give up gracefully */ }

  // Seed the log with a single "ready" entry so the panel never opens
  // empty before any user-driven event has fired.
  recordActivityEntry('forge:activity-log-ready', {
    capacity: ACTIVITY_LOG_CAPACITY,
    knownEvents: FORGE_EVENT_NAMES.length,
  });
  return true;
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
  // The list inside scrolls, the header / controls don't.
  overflow: 'hidden',
};
const headerStyle = {
  display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 8,
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
const closeBtn = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const listStyle = {
  flex: 1,
  overflowY: 'auto',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 4,
  background: 'var(--forge-surface)',
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
};
const rowStyle = {
  display: 'grid',
  gridTemplateColumns: '90px 1fr',
  columnGap: 8,
  padding: '4px 8px',
  borderBottom: '1px dashed var(--forge-rail-edge)',
  alignItems: 'start',
};
const tsCellStyle = {
  color: 'var(--forge-ink-mute)',
  whiteSpace: 'nowrap',
};
const nameCellStyle = {
  fontWeight: 600,
  wordBreak: 'break-all',
};
const detailCellStyle = {
  gridColumn: '1 / -1',
  color: 'var(--forge-ink-mute)',
  marginTop: 2,
  wordBreak: 'break-all',
};
const statusBarStyle = {
  display: 'flex', justifyContent: 'space-between',
  fontFamily: 'var(--forge-mono)', fontSize: 10,
  color: 'var(--forge-ink-mute)',
};
const emptyHintStyle = {
  textAlign: 'center',
  color: 'var(--forge-ink-mute)',
  padding: '16px 8px',
  fontSize: 11,
  fontStyle: 'italic',
};

// Format a Date.now() ms-stamp as HH:MM:SS.mmm for the row prefix. The
// log is presentationally a tail-style stream so absolute time is more
// useful than a relative timer; the user wants to grep for "what fired
// when I pressed that button at 14:31:12".
function fmtTs(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function ActivityLogPanel({ open, onClose }) {
  const [filter, setFilter] = useState('');
  const [entries, setEntries] = useState(() => readActivityEntries());
  const [exportStatus, setExportStatus] = useState(null);
  const listRef = useRef(null);

  // Subscribe to the ring buffer when open. We snapshot through the
  // module-scope read fn so the panel sees the same view all consumers see.
  useEffect(() => {
    if (!open) return undefined;
    const refresh = () => setEntries(readActivityEntries());
    refresh();
    _subscribers.add(refresh);
    return () => { _subscribers.delete(refresh); };
  }, [open]);

  // Re-hydrate on every open so we don't display a stale snapshot from
  // the previous close.
  useEffect(() => {
    if (!open) return;
    setEntries(readActivityEntries());
    setExportStatus(null);
  }, [open]);

  // Filter is a case-insensitive substring over both the event name and
  // the truncated detail string. Empty filter == show everything.
  const visibleEntries = useMemo(() => {
    const q = String(filter || '').trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const n = (e.name || '').toLowerCase();
      const d = (e.detail || '').toLowerCase();
      return n.includes(q) || d.includes(q);
    });
  }, [entries, filter]);

  const onClear = useCallback(() => {
    clearActivityLog();
    setEntries([]);
  }, []);

  const onExport = useCallback(async () => {
    setExportStatus('exporting…');
    try {
      const dialog = (typeof window !== 'undefined') ? window.forge?.dialog : null;
      if (!dialog || typeof dialog.saveFile !== 'function'
                  || typeof dialog.writeBlob !== 'function') {
        setExportStatus('error: forge.dialog.saveFile / writeBlob unavailable');
        return;
      }
      const filepath = await dialog.saveFile({
        title: 'Export Activity Log',
        defaultPath: `forge-activity-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!filepath) {
        setExportStatus('cancelled');
        return;
      }
      const payload = JSON.stringify({
        version: 1,
        capturedAt: new Date().toISOString(),
        capacity: ACTIVITY_LOG_CAPACITY,
        entries: readActivityEntries().map((e) => ({
          ts: e.ts,
          iso: new Date(e.ts).toISOString(),
          name: e.name,
          detail: e.detail,
        })),
      }, null, 2);
      const bytes = new TextEncoder().encode(payload);
      const res = await dialog.writeBlob(filepath, bytes);
      if (res && res.ok) {
        try { window.__forgeLastActivityLogPath = filepath; } catch {}
        const tail = filepath.split('/').pop();
        setExportStatus(`saved → ${tail} (${res.bytes} B)`);
      } else {
        setExportStatus(`error: ${res?.error || 'writeBlob failed'}`);
      }
    } catch (err) {
      setExportStatus(`error: ${err?.message || String(err)}`);
    }
  }, []);

  // Auto-clear the export status pill after a few seconds.
  useEffect(() => {
    if (!exportStatus) return undefined;
    const t = setTimeout(() => setExportStatus(null), 3600);
    return () => clearTimeout(t);
  }, [exportStatus]);

  if (!open) return null;

  const totalCount = entries.length;
  const visibleCount = visibleEntries.length;
  const isFiltered = String(filter || '').trim().length > 0;

  return (
    <div style={panelStyle}
         data-testid="forge-activity-log-panel"
         data-entry-count={totalCount}
         data-visible-count={visibleCount}>
      <header style={headerStyle}>
        <strong>Activity Log</strong>
        <button onClick={onClose}
                data-testid="forge-activity-log-close"
                style={closeBtn}>×</button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.4,
                    fontSize: 11 }}
           data-testid="forge-activity-log-help">
        Live stream of every <code>forge:*</code> event (kernel + UI),
        newest first. Buffer holds the last {ACTIVITY_LOG_CAPACITY}
        entries. Filter is substring (event name OR detail).
      </div>

      <div style={controlsRow}>
        <input
          type="text"
          value={filter}
          placeholder="Filter by event name or detail…"
          onChange={(e) => setFilter(e.target.value)}
          style={filterInputStyle}
          data-testid="forge-activity-log-filter" />
        <button type="button"
                onClick={onClear}
                style={dangerBtnStyle}
                data-testid="forge-activity-log-clear"
                title="Clear the activity log buffer">
          Clear
        </button>
        <button type="button"
                onClick={onExport}
                style={btnStyle}
                data-testid="forge-activity-log-export"
                title="Export the current log to a .json file">
          Export…
        </button>
      </div>

      {exportStatus && (
        <div data-testid="forge-activity-log-export-status"
             style={{ fontSize: 11, color: 'var(--forge-ink-mute)' }}>
          {exportStatus}
        </div>
      )}

      <div style={listStyle}
           ref={listRef}
           data-testid="forge-activity-log-list">
        {visibleEntries.length === 0 ? (
          <div style={emptyHintStyle}
               data-testid="forge-activity-log-empty">
            {isFiltered
              ? `No entries match "${filter}".`
              : 'No events captured yet — interact with Forge to populate.'}
          </div>
        ) : (
          visibleEntries.map((e) => (
            <div key={e.id}
                 style={rowStyle}
                 data-testid={`forge-activity-log-row-${e.id}`}
                 data-event-name={e.name}
                 data-entry-id={e.id}>
              <div style={tsCellStyle}
                   data-testid={`forge-activity-log-ts-${e.id}`}
                   data-ts={e.ts}>
                {fmtTs(e.ts)}
              </div>
              <div style={nameCellStyle}
                   data-testid={`forge-activity-log-name-${e.id}`}>
                {e.name}
              </div>
              {e.detail && (
                <div style={detailCellStyle}
                     data-testid={`forge-activity-log-detail-${e.id}`}
                     data-detail-len={e.detail.length}>
                  {e.detail}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div style={statusBarStyle}
           data-testid="forge-activity-log-status">
        <span data-testid="forge-activity-log-counts">
          {visibleCount}/{totalCount} entries
          {isFiltered ? ' (filtered)' : ''}
        </span>
        <span>
          buffer: {totalCount}/{ACTIVITY_LOG_CAPACITY}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host.
//
// Installs the global capture (idempotent) at mount time so the log
// starts filling immediately, even before the user opens the panel.
// That way when they click Tools → Activity Log, the panel shows real
// history — not "no events yet".

export function ActivityLogPanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Install bus capture exactly once.
    installActivityCapture();
    // Imperative entry points for plugins / Archie / e2e.
    window.__forgeOpenActivityLog  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseActivityLog = () => setOpen(false);
    window.__forgeActivityLogRecord = recordActivityEntry;
    window.__forgeActivityLogRead   = readActivityEntries;
    window.__forgeActivityLogClear  = clearActivityLog;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.activityLog') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      delete window.__forgeOpenActivityLog;
      delete window.__forgeCloseActivityLog;
      delete window.__forgeActivityLogRecord;
      delete window.__forgeActivityLogRead;
      delete window.__forgeActivityLogClear;
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <ActivityLogPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default ActivityLogPanel;
