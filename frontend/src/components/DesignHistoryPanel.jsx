import { useEffect, useState, useRef, useCallback } from 'react';
import { getHistory, clearHistory } from '../foundation/DesignHistory.js';

/**
 * Design History timeline. Appears in the right aside above the
 * Feature Tree. Lists every foundation tool run in chronological
 * order with a one-line headline ("Brayton Cycle — 380 kN, SFC 0.55").
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
        // Tier-1 #9 — honest placeholder. Records a row-anchored
        // rollback by suppressing every entry AFTER the chosen one.
        // Real feature-tree rollback depends on SP-3 (design history
        // rebackground) which is not in this Tier-1 pass.
        {
          const res = h.rollBackToHere(entry.id);
          setRolledBackId(res.ok ? entry.id : null);
          if (typeof window !== 'undefined') {
            window.__lastDhAction = { action, entry, result: res };
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
    <div className="design-history-panel" data-archdisc-dh-panel="active">
      <div className="dh-header">
        <span className="dh-title">Design History</span>
        <span className="dh-count">{entries.length}</span>
        {entries.length > 0 && (
          <button className="dh-clear-btn" onClick={() => clearHistory()} title="Clear history">
            ×
          </button>
        )}
      </div>
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
            title="Suppress every entry below this one (placeholder — full feature-tree rollback depends on SP-3)"
          >
            <span className="dh-ctx-icon">↶</span>
            <span className="dh-ctx-text">Roll Back To Here</span>
            <span className="dh-ctx-tag">(approx.)</span>
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
