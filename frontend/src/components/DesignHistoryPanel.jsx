import { useEffect, useState, useRef, useCallback } from 'react';
import { getHistory, clearHistory } from '../foundation/DesignHistory.js';

/**
 * Design History timeline. Appears in the right aside above the
 * Feature Tree. Lists every foundation tool run in chronological
 * order with a one-line headline ("Brayton Cycle — 380 kN, SFC 0.55").
 *
 * SEMANTIC SCOPE — important distinction (SP-3c hand-off):
 *   - THIS panel = FEATURE-level history. Every foundation tool run lands
 *     here as a one-line summary (analysis ops, build ops, AI plan steps).
 *     This is what the user thinks of as "the timeline of what I did".
 *   - The KERNEL HistoryLog (`window.__archdiscKernelHistory`) = body-level
 *     bulletin-board over the topology spine. Every primitive / boolean /
 *     feature / local-op records a forward+inverse delta there. The
 *     Rollback bar at the top of the viewport is the LIVE timeline scrubber
 *     for THAT log.
 *   - Roll Back To Here in this panel DELEGATES to the kernel bar — it
 *     drives `hist.rollBackTo(closest-kernel-entry-by-time)` so the
 *     geometry actually reverts, in addition to the app-level row dimming.
 *
 * Tier-1 #9 (SolidWorks FeatureManager parity) — right-click any row
 * → context menu with: Edit Feature / Edit Sketch / Suppress / Roll
 * Back To Here / Rename / Delete. The menu hides on click-outside,
 * on Escape, and on second right-click anywhere.
 *
 * Click a row to log its payload to the console (debug surface);
 * double-click a row to enter inline rename mode (matches the SW
 * FeatureManager F2 convention).
 */

/**
 * SP-3c delegation — when the user invokes "Roll Back To Here" on a
 * DesignHistory entry, find the closest kernel HistoryLog entry by
 * timestamp ≤ the row's `when` and drive `rollBackTo` on it. Returns a
 * diagnostic object — { ok, kernelEntryId?, reason? } — so the action
 * snapshot on `window.__lastDhAction.kernelDelegation` honestly reflects
 * what happened.
 */
function delegateRollbackToKernel(dhEntry) {
  if (typeof window === 'undefined') return { ok: false, reason: 'no-window' };
  const hist = window.__archdiscKernelHistory;
  if (!hist || !Array.isArray(hist.entries)) {
    return { ok: false, reason: 'kernel-history-not-installed' };
  }
  if (hist.entries.length === 0) {
    return { ok: false, reason: 'kernel-history-empty' };
  }
  // Map the DH entry's `when` (ISO string) to ms. The kernel entry `time`
  // field is `Date.now()` so it's already ms.
  let dhMs;
  try { dhMs = new Date(dhEntry.when).getTime(); }
  catch { dhMs = NaN; }
  if (!Number.isFinite(dhMs)) {
    return { ok: false, reason: 'dh-entry-has-no-time' };
  }
  // Find the last kernel entry whose time <= dhMs. We roll back TO that
  // entry (so the timeline cursor sits at the kernel op that produced the
  // model state the user "saw" at the moment they recorded the DH row).
  let targetIdx = -1;
  for (let i = 0; i < hist.entries.length; i++) {
    const e = hist.entries[i];
    if (typeof e.time === 'number' && e.time <= dhMs) targetIdx = i;
    else break;  // entries are in cursor order; once we pass dhMs we're done.
  }
  if (targetIdx < 0) {
    return { ok: false, reason: 'no-kernel-entry-before-this-row' };
  }
  const targetEntry = hist.entries[targetIdx];
  // Fire-and-forget — the kernel rollback is async but the caller doesn't
  // await. The kernel emits `archdisc:history-changed` on completion so
  // the Rollback bar re-renders to reflect the cursor move.
  Promise.resolve(hist.rollBackTo(targetEntry)).catch((err) => {
    window.__lastDhRollbackKernelError = err && err.message ? err.message : String(err);
  });
  return { ok: true, kernelEntryId: targetEntry.id, kernelEntryIdx: targetIdx };
}
export default function DesignHistoryPanel() {
  const [entries, setEntries] = useState([]);
  const [ctx, setCtx] = useState(null);      // { x, y, entry }
  const [renameId, setRenameId] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const [rolledBackId, setRolledBackId] = useState(null);
  const renameRef = useRef(null);

  useEffect(() => {
    const h = getHistory();
    setEntries([...h.entries]);
    const unsub = h.onChange((next) => setEntries([...next]));
    return unsub;
  }, []);

  // Close context menu on outside click / Escape.
  useEffect(() => {
    if (!ctx) return undefined;
    const onClick = (e) => {
      // Don't dismiss when the click landed inside the menu itself.
      const menu = document.querySelector('.dh-context-menu');
      if (menu && menu.contains(e.target)) return;
      setCtx(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setCtx(null); };
    const onContext = () => setCtx(null);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    document.addEventListener('contextmenu', onContext);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('contextmenu', onContext);
    };
  }, [ctx]);

  // Focus the rename input when it appears.
  useEffect(() => {
    if (renameId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renameId]);

  const handleRowClick = useCallback((entry) => {
    if (entry.payloadKey && typeof window !== 'undefined') {
      console.log(`[DesignHistory] ${entry.tool} →`, window[entry.payloadKey]);
    }
  }, []);

  const handleContextMenu = useCallback((e, entry) => {
    e.preventDefault();
    e.stopPropagation();
    // Clamp to viewport so the menu can't render off-screen.
    const x = Math.min(e.clientX, (window.innerWidth || 9999) - 220);
    const y = Math.min(e.clientY, (window.innerHeight || 9999) - 220);
    setCtx({ x: Math.max(8, x), y: Math.max(8, y), entry });
  }, []);

  const isSketchLike = (entry) => {
    // Sketch-creating tools whose "Edit Sketch" is a meaningful gesture.
    // We're conservative: anything with `Sketch` in the tool name OR a
    // payloadKey that mentions sketch counts.
    const t = (entry.tool || '').toLowerCase();
    const p = (entry.payloadKey || '').toLowerCase();
    return t.includes('sketch') || p.includes('sketch');
  };

  const startRename = useCallback((entry) => {
    setRenameId(entry.id);
    setRenameVal(entry.name || entry.tool || '');
    setCtx(null);
  }, []);

  const commitRename = useCallback(() => {
    if (renameId) getHistory().rename(renameId, renameVal);
    setRenameId(null);
  }, [renameId, renameVal]);

  const cancelRename = useCallback(() => setRenameId(null), []);

  const doMenuAction = useCallback((action, entry) => {
    const h = getHistory();
    switch (action) {
      case 'edit-feature':
        if (entry.payloadKey && typeof window !== 'undefined') {
          console.log(`[DesignHistory] Edit Feature → ${entry.tool}`, window[entry.payloadKey]);
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('archdisc:dh-edit-feature', { detail: { entry } }));
          window.__lastDhAction = { action, entry };
        }
        break;
      case 'edit-sketch':
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('archdisc:dh-edit-sketch', { detail: { entry } }));
          window.__lastDhAction = { action, entry };
        }
        break;
      case 'suppress':
        h.setSuppressed(entry.id, !entry.suppressed);
        if (typeof window !== 'undefined') {
          window.__lastDhAction = { action, entry, suppressed: !entry.suppressed };
        }
        break;
      case 'rollback':
        // SP-3c — Tier-1 #10: the "Roll Back To Here" menu item DELEGATES
        // to the kernel HistoryLog via the Rollback bar's machinery. This
        // panel is the FEATURE history (foundation-level tool runs),
        // semantically DIFFERENT from the kernel-level bulletin-board over
        // body-producing ops (`window.__archdiscKernelHistory`). The user
        // experience the user wants is "scrubbing this row reverts the
        // model" — so we drive BOTH layers:
        //   1. App-level: the foundation DesignHistory still gets its row-
        //      anchored suppression (the visual "rolled-back" state on the
        //      rows below the anchor).
        //   2. Kernel-level: we find the closest kernel HistoryLog entry by
        //      timestamp ≤ the row's `when`, then call
        //      `hist.rollBackTo(entry)` so the geometry actually reverts.
        //      If no kernel entry exists yet (the row is older than the log
        //      or the row is a pure analysis tool with no geometry side
        //      effect), the geometry doesn't move — surfaced honestly in
        //      `__lastDhAction.kernelDelegation`.
        {
          const res = h.rollBackToHere(entry.id);
          setRolledBackId(res.ok ? entry.id : null);
          const kernelDelegation = delegateRollbackToKernel(entry);
          if (typeof window !== 'undefined') {
            window.__lastDhAction = { action, entry, result: res, kernelDelegation };
          }
        }
        break;
      case 'rename':
        startRename(entry);
        return; // don't clear ctx — startRename did it.
      case 'delete':
        h.remove(entry.id);
        if (rolledBackId === entry.id) setRolledBackId(null);
        if (typeof window !== 'undefined') {
          window.__lastDhAction = { action, entry };
        }
        break;
    }
    setCtx(null);
  }, [rolledBackId, startRename]);

  return (
    <div className="design-history-panel" data-archdisc-dh-panel="active"
         title="Design History — feature-level run log. The body-level kernel timeline + scrubber lives in the viewport's Rollback bar.">
      <div className="dh-header">
        <span className="dh-title">Design History</span>
        <span className="dh-count">{entries.length}</span>
        {entries.length > 0 && (
          <button className="dh-clear-btn" onClick={() => clearHistory()} title="Clear history">
            ×
          </button>
        )}
      </div>
      {/* Scope note (SP-3c semantic): the bare debug text
       *   "Feature timeline · viewport Rollback bar = kernel timeline"
       *   that used to render below the header was removed in the
       *   UX cleanup (2026-05-24) — it was leftover developer text and
       *   the explanation is preserved as a `title` tooltip on the
       *   parent panel + on each row. */}
      <div className="dh-list">
        {entries.length === 0 && (
          <div className="dh-empty">No tools run yet.</div>
        )}
        {entries.map((e) => {
          const isAfterRollback =
            rolledBackId &&
            entries.findIndex(x => x.id === e.id) >
              entries.findIndex(x => x.id === rolledBackId);
          const isRollbackAnchor = rolledBackId === e.id;
          const className =
            'dh-row' +
            (e.suppressed ? ' dh-row-suppressed' : '') +
            (isAfterRollback ? ' dh-row-after-rollback' : '') +
            (isRollbackAnchor ? ' dh-row-rollback-anchor' : '');
          return (
            <div
              key={e.id}
              className={className}
              data-archdisc-dh-row={e.id}
              data-archdisc-dh-suppressed={e.suppressed ? 'true' : 'false'}
              onClick={() => handleRowClick(e)}
              onContextMenu={(ev) => handleContextMenu(ev, e)}
              onDoubleClick={() => startRename(e)}
              title="Right-click for context menu"
            >
              <div className="dh-row-head">
                {renameId === e.id ? (
                  <input
                    ref={renameRef}
                    className="dh-rename-input"
                    value={renameVal}
                    onChange={(ev) => setRenameVal(ev.target.value)}
                    onBlur={commitRename}
                    onClick={(ev) => ev.stopPropagation()}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') commitRename();
                      else if (ev.key === 'Escape') cancelRename();
                    }}
                    data-archdisc-dh-rename={e.id}
                  />
                ) : (
                  <span className="dh-tool" data-archdisc-dh-name={e.id}>
                    {e.suppressed && <span className="dh-suppressed-mark" title="Suppressed">⊘ </span>}
                    {e.name || e.tool}
                  </span>
                )}
                <span className="dh-time">{formatTime(e.when)}</span>
              </div>
              {e.headline && <div className="dh-headline">{e.headline}</div>}
              {e.tab && <div className="dh-tab">{e.tab}{e.category ? ` · ${e.category}` : ''}</div>}
            </div>
          );
        })}
      </div>

      {/* Tier-1 #9 — Right-click context menu */}
      {ctx && (
        <div
          className="dh-context-menu"
          style={{ left: ctx.x, top: ctx.y }}
          data-archdisc-dh-menu="open"
          onClick={(ev) => ev.stopPropagation()}
          onMouseDown={(ev) => ev.stopPropagation()}
          onContextMenu={(ev) => ev.preventDefault()}
        >
          <button
            className="dh-ctx-item"
            onClick={() => doMenuAction('edit-feature', ctx.entry)}
            data-archdisc-dh-action="edit-feature"
          >
            <span className="dh-ctx-icon">⚙</span>
            <span className="dh-ctx-text">Edit Feature</span>
          </button>
          {isSketchLike(ctx.entry) && (
            <button
              className="dh-ctx-item"
              onClick={() => doMenuAction('edit-sketch', ctx.entry)}
              data-archdisc-dh-action="edit-sketch"
            >
              <span className="dh-ctx-icon">✎</span>
              <span className="dh-ctx-text">Edit Sketch</span>
            </button>
          )}
          <button
            className="dh-ctx-item"
            onClick={() => doMenuAction('suppress', ctx.entry)}
            data-archdisc-dh-action="suppress"
          >
            <span className="dh-ctx-icon">{ctx.entry.suppressed ? '◯' : '●'}</span>
            <span className="dh-ctx-text">{ctx.entry.suppressed ? 'Unsuppress' : 'Suppress'}</span>
          </button>
          <button
            className="dh-ctx-item"
            onClick={() => doMenuAction('rollback', ctx.entry)}
            data-archdisc-dh-action="rollback"
            title="Drives the viewport Rollback bar to the matching kernel entry. The geometry rolls back; this row dims to reflect the new cursor."
          >
            <span className="dh-ctx-icon">↶</span>
            <span className="dh-ctx-text">Roll Back To Here</span>
            <span className="dh-ctx-tag">→ kernel bar</span>
          </button>
          <div className="dh-ctx-divider" />
          <button
            className="dh-ctx-item"
            onClick={() => doMenuAction('rename', ctx.entry)}
            data-archdisc-dh-action="rename"
          >
            <span className="dh-ctx-icon">A|</span>
            <span className="dh-ctx-text">Rename</span>
          </button>
          <button
            className="dh-ctx-item dh-ctx-item-danger"
            onClick={() => doMenuAction('delete', ctx.entry)}
            data-archdisc-dh-action="delete"
          >
            <span className="dh-ctx-icon">✗</span>
            <span className="dh-ctx-text">Delete</span>
          </button>
        </div>
      )}
    </div>
  );
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ''; }
}
