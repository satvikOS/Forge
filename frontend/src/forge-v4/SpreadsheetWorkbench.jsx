// Forge-153 — Spreadsheet workbench.
//
// FreeCAD-style parametric spreadsheet living as a full-screen modal
// over the viewport. Grid is virtualised in column-rows the user can
// see (the underlying store is A1..ZZ100 = 67 600 cells, but only the
// visible window is rendered) with a sticky header row + column.
//
// Cell behaviours:
//
//   • Click a cell to select it.
//   • Double-click (or press Enter / start typing) to enter edit mode.
//     The formula bar shows the underlying source (the literal value
//     OR the formula starting with '=').
//   • Enter commits the edit, advances down. Escape cancels.
//   • Binding the selected cell: type a name in the binding input and
//     press Commit. The cell then becomes available as a parametric
//     variable in EquationManager.
//
// Manual UI never writes to Archie's thread.

import React, {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import { Icon } from './icons/Icon.jsx';
import { showToast } from './Toast.jsx';
import {
  setCell, clearCell, bindCellName, getCell,
  bindingNameFor, listBindings,
  subscribe, snapshot,
  cellId, parseCellId, colIndexToLabel,
  NUM_COLS, NUM_ROWS,
} from './spreadsheetStore.js';

export const SPREADSHEET_EVENT = 'forge:open-spreadsheet';

const VISIBLE_COLS = 26;   // A through Z by default
const VISIBLE_ROWS = 40;   // first 40 rows by default
const CELL_W       = 92;
const CELL_H       = 26;
const HEADER_W     = 56;   // row-number gutter
const HEADER_H     = 28;

// ── live store subscription ──────────────────────────────────────────

function useStore() {
  // The snapshot function in spreadsheetStore.js caches by a version
  // counter; the SAME object reference is returned until notify() is
  // called. This is what keeps useSyncExternalStore from looping
  // forever (React #185).
  const get = useCallback(() => snapshot(), []);
  return useSyncExternalStore(subscribe, get, get);
}

// ── view-window state ────────────────────────────────────────────────

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// ── header strip ─────────────────────────────────────────────────────

function ColumnHeaders({ colStart, colCount, scrollLeft }) {
  const cells = [];
  for (let i = 0; i < colCount; i++) {
    const col = colStart + i;
    if (col >= NUM_COLS) break;
    cells.push(
      <div key={col}
           data-testid={`forge-ss-colhead-${colIndexToLabel(col)}`}
           style={{
             width: CELL_W,
             height: HEADER_H,
             flexShrink: 0,
             display: 'inline-flex',
             alignItems: 'center', justifyContent: 'center',
             borderRight: '1px solid var(--forge-rail-edge)',
             borderBottom: '1px solid var(--forge-rail-edge)',
             background: 'var(--forge-canvas)',
             color: 'var(--forge-ink-mute)',
             fontFamily: 'var(--forge-mono)', fontSize: 11,
             fontWeight: 600,
           }}>
        {colIndexToLabel(col)}
      </div>
    );
  }
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 3,
      display: 'flex',
      transform: `translateX(${-scrollLeft}px)`,
      willChange: 'transform',
    }}>
      <div style={{
        width: HEADER_W, height: HEADER_H, flexShrink: 0,
        position: 'sticky', left: 0, zIndex: 4,
        borderRight: '1px solid var(--forge-rail-edge)',
        borderBottom: '1px solid var(--forge-rail-edge)',
        background: 'var(--forge-canvas)',
      }} />
      {cells}
    </div>
  );
}

function RowHeader({ row }) {
  return (
    <div data-testid={`forge-ss-rowhead-${row + 1}`}
         style={{
           width: HEADER_W,
           height: CELL_H,
           position: 'sticky', left: 0, zIndex: 2,
           display: 'inline-flex',
           alignItems: 'center', justifyContent: 'center',
           borderRight: '1px solid var(--forge-rail-edge)',
           borderBottom: '1px solid var(--forge-rail-edge)',
           background: 'var(--forge-canvas)',
           color: 'var(--forge-ink-mute)',
           fontFamily: 'var(--forge-mono)', fontSize: 11,
           fontWeight: 600,
         }}>
      {row + 1}
    </div>
  );
}

// ── single cell ──────────────────────────────────────────────────────

function GridCell({
  id, cellRecord, selected, editing,
  onSelect, onBeginEdit, onCommit, onCancel,
  binding,
}) {
  const inputRef = useRef(null);
  const [draft, setDraft] = useState(() => {
    if (cellRecord.formula) return cellRecord.formula;
    if (cellRecord.value == null) return '';
    return String(cellRecord.value);
  });

  // When entering edit mode, sync the draft to the underlying source.
  useEffect(() => {
    if (editing) {
      const src = cellRecord.formula != null ? cellRecord.formula
                : cellRecord.value == null   ? ''
                : String(cellRecord.value);
      setDraft(src);
      // Focus + select-all on the next tick (after the input mounts).
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(0, el.value.length);
      }
    }
  }, [editing, cellRecord.formula, cellRecord.value]);

  const display = useMemo(() => {
    if (cellRecord.error) return cellRecord.error;
    if (cellRecord.value === null || cellRecord.value === undefined) return '';
    if (typeof cellRecord.value === 'number') {
      // Trim noisy floating-point tails for readability.
      const rounded = Math.round(cellRecord.value * 1e9) / 1e9;
      return String(rounded);
    }
    if (typeof cellRecord.value === 'boolean') return cellRecord.value ? 'TRUE' : 'FALSE';
    return String(cellRecord.value);
  }, [cellRecord.value, cellRecord.error]);

  const baseStyle = {
    width: CELL_W, height: CELL_H,
    flexShrink: 0,
    boxSizing: 'border-box',
    borderRight: '1px solid var(--forge-rail-edge)',
    borderBottom: '1px solid var(--forge-rail-edge)',
    padding: '0 6px',
    display: 'inline-flex', alignItems: 'center',
    fontFamily: 'var(--forge-mono)', fontSize: 12,
    color: cellRecord.error ? 'var(--forge-err)' : 'var(--forge-ink)',
    background: selected
      ? 'var(--forge-accent-mute)'
      : (binding ? 'rgba(92, 200, 143, 0.06)' : 'transparent'),
    outline: selected ? '1px solid var(--forge-accent-rim)' : 'none',
    outlineOffset: -1,
    cursor: 'cell',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        data-testid={`forge-ss-cell-input-${id}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit(draft, { advance: 'down' });
          } else if (e.key === 'Tab') {
            e.preventDefault();
            onCommit(draft, { advance: e.shiftKey ? 'left' : 'right' });
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => onCommit(draft, { advance: null })}
        style={{
          ...baseStyle,
          cursor: 'text',
          background: 'var(--forge-surface)',
          color: 'var(--forge-ink)',
          border: '1px solid var(--forge-accent-rim)',
          outline: 'none',
        }} />
    );
  }

  return (
    <div data-testid={`forge-ss-cell-${id}`}
         data-cell-id={id}
         data-cell-selected={selected ? 'true' : 'false'}
         data-cell-binding={binding || ''}
         data-cell-value={cellRecord.value == null ? '' : String(cellRecord.value)}
         onMouseDown={(e) => { e.preventDefault(); onSelect(); }}
         onDoubleClick={onBeginEdit}
         title={cellRecord.formula || display}
         style={baseStyle}>
      <span style={{ flex: 1 }}>{display}</span>
      {binding && (
        <span style={{
          marginLeft: 4,
          padding: '0 4px',
          fontSize: 9,
          letterSpacing: '0.04em',
          color: 'var(--forge-ok)',
          border: '1px solid var(--forge-ok)',
          borderRadius: 2,
          flexShrink: 0,
        }}>{binding}</span>
      )}
    </div>
  );
}

// ── main panel ───────────────────────────────────────────────────────

export function SpreadsheetWorkbench({ open, onClose }) {
  const store = useStore();
  const [selected, setSelected] = useState('A1');
  const [editing, setEditing]   = useState(null);   // cell id being edited, or null
  const [bindDraft, setBindDraft] = useState('');
  const [colStart, setColStart] = useState(0);
  const [rowStart, setRowStart] = useState(0);
  const scrollRef = useRef(null);

  // Keep binding draft synced when the selection changes.
  useEffect(() => {
    setBindDraft(bindingNameFor(selected) || '');
  }, [selected, store.version]);

  // Esc closes when not editing.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !editing) {
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, editing, onClose]);

  // Keyboard navigation on the grid (when not editing).
  useEffect(() => {
    if (!open || editing) return undefined;
    const onKey = (e) => {
      const cur = parseCellId(selected);
      if (!cur) return;
      let col = cur.col, row = cur.row;
      if (e.key === 'ArrowUp')    row = clamp(row - 1, 0, NUM_ROWS - 1);
      else if (e.key === 'ArrowDown')  row = clamp(row + 1, 0, NUM_ROWS - 1);
      else if (e.key === 'ArrowLeft')  col = clamp(col - 1, 0, NUM_COLS - 1);
      else if (e.key === 'ArrowRight') col = clamp(col + 1, 0, NUM_COLS - 1);
      else if (e.key === 'Enter')      setEditing(selected);
      else if (e.key === 'F2')         setEditing(selected);
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        try { clearCell(selected); } catch {}
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Bare character starts editing with that character pre-filled.
        // We do this by setting the cell to a draft value and then
        // entering edit mode.
        setEditing(selected);
        // The cell input will pick up the underlying value on focus;
        // we rely on the user replacing it. Pass-through char is
        // approximate without a separate buffer — keep simple.
        return;
      } else {
        return;
      }
      e.preventDefault();
      const nextId = cellId(col, row);
      setSelected(nextId);
      // Scroll into view if the new selection falls outside the window.
      if (col < colStart)                          setColStart(col);
      else if (col >= colStart + VISIBLE_COLS)     setColStart(col - VISIBLE_COLS + 1);
      if (row < rowStart)                          setRowStart(row);
      else if (row >= rowStart + VISIBLE_ROWS)     setRowStart(row - VISIBLE_ROWS + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, editing, selected, colStart, rowStart]);

  const onSelect = useCallback((id) => {
    setSelected(id);
    setEditing(null);
  }, []);

  const advanceFrom = useCallback((id, dir) => {
    const cur = parseCellId(id);
    if (!cur) return;
    let { col, row } = cur;
    if (dir === 'down')  row = clamp(row + 1, 0, NUM_ROWS - 1);
    if (dir === 'up')    row = clamp(row - 1, 0, NUM_ROWS - 1);
    if (dir === 'right') col = clamp(col + 1, 0, NUM_COLS - 1);
    if (dir === 'left')  col = clamp(col - 1, 0, NUM_COLS - 1);
    setSelected(cellId(col, row));
  }, []);

  const onCommit = useCallback((id, draft, opts = {}) => {
    try {
      setCell(id, draft);
    } catch (err) {
      showToast({ kind: 'err', text: `Cell ${id}: ${err.message}`, ttl: 2200 });
    }
    setEditing(null);
    if (opts.advance) advanceFrom(id, opts.advance);
  }, [advanceFrom]);

  const onCancelEdit = useCallback(() => setEditing(null), []);

  const onCommitBinding = useCallback(() => {
    try {
      bindCellName(selected, bindDraft.trim());
      showToast({
        kind: 'ok',
        text: bindDraft.trim()
          ? `Bound ${selected} = ${bindDraft.trim()}`
          : `Cleared binding for ${selected}`,
        ttl: 1800,
      });
    } catch (err) {
      showToast({ kind: 'err', text: err.message, ttl: 2400 });
    }
  }, [selected, bindDraft]);

  // Formula-bar source string for the selected cell.
  const selectedCell = useMemo(() => {
    const c = store.cells[selected];
    if (!c) return { id: selected, value: null, formula: null, error: null };
    return { id: selected, ...c };
  }, [store, selected]);

  const formulaSource = selectedCell.formula != null
    ? selectedCell.formula
    : (selectedCell.value == null ? '' : String(selectedCell.value));

  const visibleColEnd = Math.min(colStart + VISIBLE_COLS, NUM_COLS);
  const visibleRowEnd = Math.min(rowStart + VISIBLE_ROWS, NUM_ROWS);

  if (!open) return null;

  return (
    <div role="dialog"
         aria-label="Spreadsheet Workbench"
         data-testid="forge-spreadsheet"
         style={{
           position: 'fixed',
           top:    'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
           left:   0,
           right:  0,
           bottom: 'var(--forge-cmdbar-h)',
           background: 'var(--forge-canvas-2)',
           display: 'flex', flexDirection: 'column',
           zIndex: 1290,
           color: 'var(--forge-ink)',
         }}>
      {/* Header strip */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px',
        borderBottom: '1px solid var(--forge-rail-edge)',
        background: 'var(--forge-canvas)',
        flexShrink: 0,
      }}>
        <Icon name="archie.formula" size={14} />
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Spreadsheet</h2>
        <span style={{
          color: 'var(--forge-ink-mute)', fontSize: 11,
          fontFamily: 'var(--forge-mono)',
        }}>
          {NUM_COLS} cols × {NUM_ROWS} rows · {Object.keys(store.cells).length} populated · {Object.keys(store.bindings).length} bound
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                data-testid="forge-spreadsheet-close"
                onClick={onClose}
                aria-label="Close"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--forge-rail-edge)',
                  color: 'var(--forge-ink)',
                  cursor: 'pointer',
                  padding: '4px 10px',
                  fontSize: 11,
                  borderRadius: 3,
                }}>
          Close
        </button>
      </header>

      {/* Formula bar + binding bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 14px',
        borderBottom: '1px solid var(--forge-rail-edge)',
        background: 'var(--forge-canvas-2)',
        flexShrink: 0,
      }}>
        <span data-testid="forge-ss-selected-id"
              style={{
                width: 48,
                fontFamily: 'var(--forge-mono)', fontSize: 12, fontWeight: 600,
                color: 'var(--forge-accent)',
              }}>{selected}</span>
        <span style={{
          width: 14, textAlign: 'center',
          color: 'var(--forge-ink-mute)', fontFamily: 'var(--forge-mono)',
        }}>fx</span>
        <input
          type="text"
          data-testid="forge-ss-formula-bar"
          value={formulaSource}
          onChange={(e) => {
            // The formula bar acts as an alternate editor for the
            // selected cell. On change, treat it as a pending draft;
            // committing happens on Enter / blur.
            const v = e.target.value;
            // Mirror into the underlying store immediately so the grid
            // shows feedback; if the user hits Escape, the cell can be
            // cleared. Keeping it imperative here would diverge UI
            // state — the simplest correct path is to live-write.
            try { setCell(selected, v); }
            catch (err) {
              showToast({ kind: 'err', text: err.message, ttl: 1800 });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              advanceFrom(selected, 'down');
            }
          }}
          placeholder="Type a value or =formula"
          style={{
            flex: 1,
            background: 'var(--forge-surface)',
            border: '1px solid var(--forge-rail-edge)',
            color: 'var(--forge-ink)',
            padding: '5px 8px',
            fontFamily: 'var(--forge-mono)', fontSize: 12,
            borderRadius: 3,
          }} />
        <span style={{
          color: 'var(--forge-ink-mute)', fontSize: 11,
        }}>Name:</span>
        <input
          type="text"
          data-testid="forge-ss-binding-input"
          value={bindDraft}
          placeholder="(none)"
          onChange={(e) => setBindDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onCommitBinding(); }}
          style={{
            width: 140,
            background: 'var(--forge-surface)',
            border: '1px solid var(--forge-rail-edge)',
            color: 'var(--forge-ink)',
            padding: '5px 8px',
            fontFamily: 'var(--forge-mono)', fontSize: 12,
            borderRadius: 3,
          }} />
        <button type="button"
                data-testid="forge-ss-binding-commit"
                onClick={onCommitBinding}
                style={{
                  background: 'var(--forge-accent-mute)',
                  border: '1px solid var(--forge-accent-rim)',
                  color: 'var(--forge-ink)',
                  cursor: 'pointer',
                  padding: '5px 10px',
                  fontSize: 11,
                  borderRadius: 3,
                }}>Commit</button>
      </div>

      {/* Grid surface */}
      <div ref={scrollRef}
           data-testid="forge-ss-grid"
           style={{
             flex: 1,
             overflow: 'auto',
             background: 'var(--forge-canvas)',
             position: 'relative',
           }}>
        <ColumnHeaders colStart={colStart} colCount={VISIBLE_COLS} scrollLeft={0} />
        <div>
          {Array.from({ length: visibleRowEnd - rowStart }, (_, ri) => {
            const row = rowStart + ri;
            return (
              <div key={row} style={{
                display: 'flex',
                whiteSpace: 'nowrap',
                height: CELL_H,
              }}>
                <RowHeader row={row} />
                {Array.from({ length: visibleColEnd - colStart }, (_, ci) => {
                  const col = colStart + ci;
                  const id = cellId(col, row);
                  const record = store.cells[id]
                    ? { id, ...store.cells[id] }
                    : { id, value: null, formula: null, error: null };
                  return (
                    <GridCell
                      key={id}
                      id={id}
                      cellRecord={record}
                      selected={id === selected}
                      editing={editing === id}
                      onSelect={() => onSelect(id)}
                      onBeginEdit={() => setEditing(id)}
                      onCommit={(draft, opts) => onCommit(id, draft, opts)}
                      onCancel={onCancelEdit}
                      binding={bindingNameFor(id)} />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Status footer */}
      <footer style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '5px 14px',
        borderTop: '1px solid var(--forge-rail-edge)',
        background: 'var(--forge-canvas)',
        fontFamily: 'var(--forge-mono)', fontSize: 11,
        color: 'var(--forge-ink-mute)',
        flexShrink: 0,
      }}>
        <span>Viewport: {colIndexToLabel(colStart)}{rowStart + 1}
              :{colIndexToLabel(visibleColEnd - 1)}{visibleRowEnd}</span>
        <span style={{ flex: 1 }} />
        <span>Use ←↑→↓ to move · Enter to edit · F2 to edit · Esc to close</span>
      </footer>
    </div>
  );
}

// ── self-mounting host ───────────────────────────────────────────────

export function SpreadsheetWorkbenchHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSpreadsheet  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseSpreadsheet = () => setOpen(false);
    const onEvt = (e) => {
      if (e?.detail?.which === 'spreadsheet' || !e?.detail) setOpen(true);
    };
    window.addEventListener(SPREADSHEET_EVENT, onEvt);
    return () => {
      window.removeEventListener(SPREADSHEET_EVENT, onEvt);
      try { delete window.__forgeOpenSpreadsheet;  } catch {}
      try { delete window.__forgeCloseSpreadsheet; } catch {}
    };
  }, []);
  return <SpreadsheetWorkbench open={open} onClose={() => setOpen(false)} />;
}

export default SpreadsheetWorkbench;

// Re-export so other modules (EquationManager) can query bindings
// without pulling the store path directly through the JSX module.
export { listBindings };
