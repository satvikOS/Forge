/**
 * EquationManager — modal overlay for UX Tier 10.
 *
 * Mounts as a sibling of the other Tier-1 overlays (SwUxOverlays.jsx mount
 * tree → WorkbenchMechanical). Listens for the global event
 * `archdisc:open-equation-manager` (fired by the ribbon handler or
 * programmatically by the AI orchestration layer), reads the singleton
 * `equationStore()`, and renders a table the user can edit live.
 *
 * Visual style matches the existing Tier-1 overlay tokens
 * (sw-panel-*, sw-text-*, sw-accent-* — see SwUxOverlays.css).
 *
 * Table columns:
 *   Variable name | Expression | Value (evaluated) | Comment | Delete
 *
 * Each row is editable in place; the dependency cascade runs through
 * EquationStore on every commit (Enter / blur).
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { X, Plus, Sigma, Trash2, AlertTriangle } from 'lucide-react';
import { equationStore } from '../foundation/EquationStore.js';
import './EquationManager.css';

export function EquationManager() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState({ name: '', expression: '', comment: '' });
  const [feedback, setFeedback] = useState(null);    // { type:'ok'|'err', message }
  const [editingCell, setEditingCell] = useState(null); // { name, column:'expression'|'comment', value }
  const draftNameRef = useRef(null);

  // Subscribe to the open event + the store's change events.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const refresh = () => setRows(equationStore().list());
    const onOpen = () => { setOpen(true); refresh(); };
    const onClose = () => { setOpen(false); setFeedback(null); setEditingCell(null); };
    window.addEventListener('archdisc:open-equation-manager', onOpen);
    window.addEventListener('archdisc:close-equation-manager', onClose);
    window.addEventListener('archdisc:equation-store:changed', refresh);
    // Seed once so the modal opens with current contents on first show.
    refresh();
    return () => {
      window.removeEventListener('archdisc:open-equation-manager', onOpen);
      window.removeEventListener('archdisc:close-equation-manager', onClose);
      window.removeEventListener('archdisc:equation-store:changed', refresh);
    };
  }, []);

  // Focus the draft name field when the modal opens.
  useEffect(() => {
    if (open && draftNameRef.current) {
      setTimeout(() => { try { draftNameRef.current?.focus(); } catch (_) {} }, 60);
    }
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const commitDraft = useCallback(() => {
    const store = equationStore();
    const { name, expression, comment } = draft;
    if (!name.trim() || !expression.trim()) {
      setFeedback({ type: 'err', message: 'Variable name and expression are required.' });
      return;
    }
    const r = store.set(name.trim(), expression.trim(), { comment });
    if (!r.ok) {
      setFeedback({ type: 'err', message: r.reason || 'Failed to add variable.' });
      return;
    }
    setFeedback({ type: 'ok', message: `Added "${name.trim()}" = ${formatValue(r.value)}` });
    setDraft({ name: '', expression: '', comment: '' });
    setTimeout(() => { try { draftNameRef.current?.focus(); } catch (_) {} }, 30);
  }, [draft]);

  const commitEdit = useCallback(() => {
    if (!editingCell) return;
    const store = equationStore();
    const { name, column, value } = editingCell;
    const row = store.getRow(name);
    if (!row) {
      setEditingCell(null);
      return;
    }
    if (column === 'expression') {
      const r = store.set(name, value, { comment: row.comment });
      if (!r.ok) {
        setFeedback({ type: 'err', message: `${name}: ${r.reason}` });
      } else {
        setFeedback({ type: 'ok', message: `Updated "${name}" = ${formatValue(r.value)}` });
      }
    } else if (column === 'comment') {
      const r = store.set(name, row.expression, { comment: value });
      if (!r.ok) {
        setFeedback({ type: 'err', message: `${name}: ${r.reason}` });
      }
    }
    setEditingCell(null);
  }, [editingCell]);

  const deleteRow = useCallback((name) => {
    const r = equationStore().delete(name);
    if (!r.ok) {
      setFeedback({ type: 'err', message: r.reason || `Could not delete "${name}".` });
      return;
    }
    setFeedback({ type: 'ok', message: `Deleted "${name}".` });
  }, []);

  if (!open) return null;

  return (
    <div
      className="archdisc-eqmgr-backdrop"
      data-archdisc-eqmgr="open"
      onMouseDown={(e) => {
        // Click outside the modal closes it (but not when clicking inside the body).
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="archdisc-eqmgr-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Equation Manager"
        data-archdisc-eqmgr-modal="open"
        data-archdisc-eqmgr-row-count={String(rows.length)}
      >
        <header className="archdisc-eqmgr-header">
          <div className="archdisc-eqmgr-title">
            <Sigma size={14} />
            <span>Equation Manager</span>
            <span className="archdisc-eqmgr-subtitle">Global variables · parametric expressions</span>
          </div>
          <button
            type="button"
            className="archdisc-eqmgr-close"
            title="Close (Esc)"
            aria-label="Close Equation Manager"
            data-archdisc-eqmgr-close
            onClick={() => setOpen(false)}
          >
            <X size={14} strokeWidth={3} />
          </button>
        </header>

        <div className="archdisc-eqmgr-hint">
          Reference variables in sketch dimensions or other equations
          (e.g. <code>width</code>, <code>=width*0.6</code>, <code>=sqrt(width^2 + height^2)</code>).
          Use <code>=</code> prefix or omit it — both forms work.
        </div>

        <div className="archdisc-eqmgr-table-wrap">
          <table className="archdisc-eqmgr-table" data-archdisc-eqmgr-table="rendered">
            <thead>
              <tr>
                <th className="col-name">Variable</th>
                <th className="col-expr">Expression</th>
                <th className="col-value">Value</th>
                <th className="col-comment">Comment</th>
                <th className="col-actions" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !editingCell ? (
                <tr className="archdisc-eqmgr-empty-row">
                  <td colSpan={5} className="archdisc-eqmgr-empty">
                    No variables yet. Add one below — e.g. <code>width = 80</code>,
                    then <code>holeSpacing = =width/4</code>.
                  </td>
                </tr>
              ) : rows.map((row) => (
                <tr
                  key={row.name}
                  data-archdisc-eqmgr-row={row.name}
                  data-archdisc-eqmgr-row-value={row.value === null ? '' : String(row.value)}
                  data-archdisc-eqmgr-row-type={row.type}
                  data-archdisc-eqmgr-row-error={row.error ? 'true' : 'false'}
                  className={row.error ? 'has-error' : ''}
                >
                  <td className="col-name">
                    <span className="archdisc-eqmgr-name-pill">{row.name}</span>
                  </td>
                  <td className="col-expr">
                    {editingCell && editingCell.name === row.name && editingCell.column === 'expression' ? (
                      <input
                        className="archdisc-eqmgr-cell-input"
                        autoFocus
                        value={editingCell.value}
                        onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit();
                          else if (e.key === 'Escape') setEditingCell(null);
                        }}
                        data-archdisc-eqmgr-cell-input="expression"
                      />
                    ) : (
                      <button
                        type="button"
                        className="archdisc-eqmgr-cell-button"
                        onClick={() => setEditingCell({ name: row.name, column: 'expression', value: row.expression })}
                        title="Edit expression"
                        data-archdisc-eqmgr-edit-expr={row.name}
                      >
                        <code>{row.expression}</code>
                      </button>
                    )}
                  </td>
                  <td className="col-value">
                    {row.error ? (
                      <span className="archdisc-eqmgr-value-err" title={row.error}>
                        <AlertTriangle size={11} />
                        <span>error</span>
                      </span>
                    ) : (
                      <span
                        className="archdisc-eqmgr-value-num"
                        data-archdisc-eqmgr-value={row.name}
                      >
                        {formatValue(row.value)}
                      </span>
                    )}
                  </td>
                  <td className="col-comment">
                    {editingCell && editingCell.name === row.name && editingCell.column === 'comment' ? (
                      <input
                        className="archdisc-eqmgr-cell-input"
                        autoFocus
                        value={editingCell.value}
                        onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit();
                          else if (e.key === 'Escape') setEditingCell(null);
                        }}
                        data-archdisc-eqmgr-cell-input="comment"
                      />
                    ) : (
                      <button
                        type="button"
                        className="archdisc-eqmgr-cell-button archdisc-eqmgr-cell-button-muted"
                        onClick={() => setEditingCell({ name: row.name, column: 'comment', value: row.comment || '' })}
                        title="Edit comment"
                        data-archdisc-eqmgr-edit-comment={row.name}
                      >
                        {row.comment ? row.comment : <span className="archdisc-eqmgr-placeholder">add note…</span>}
                      </button>
                    )}
                  </td>
                  <td className="col-actions">
                    <button
                      type="button"
                      className="archdisc-eqmgr-delete"
                      title={`Delete "${row.name}"`}
                      aria-label={`Delete variable ${row.name}`}
                      data-archdisc-eqmgr-delete={row.name}
                      onClick={() => deleteRow(row.name)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}

              {/* Add-row draft */}
              <tr className="archdisc-eqmgr-draft-row" data-archdisc-eqmgr-draft-row="active">
                <td className="col-name">
                  <input
                    ref={draftNameRef}
                    className="archdisc-eqmgr-cell-input"
                    placeholder="name"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitDraft(); }}
                    data-archdisc-eqmgr-draft-name
                  />
                </td>
                <td className="col-expr">
                  <input
                    className="archdisc-eqmgr-cell-input"
                    placeholder="expression — e.g. 80 or =width*0.6"
                    value={draft.expression}
                    onChange={(e) => setDraft({ ...draft, expression: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitDraft(); }}
                    data-archdisc-eqmgr-draft-expression
                  />
                </td>
                <td className="col-value">
                  <span className="archdisc-eqmgr-value-placeholder">—</span>
                </td>
                <td className="col-comment">
                  <input
                    className="archdisc-eqmgr-cell-input"
                    placeholder="optional"
                    value={draft.comment}
                    onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitDraft(); }}
                    data-archdisc-eqmgr-draft-comment
                  />
                </td>
                <td className="col-actions">
                  <button
                    type="button"
                    className="archdisc-eqmgr-add"
                    title="Add variable (Enter)"
                    aria-label="Add variable"
                    data-archdisc-eqmgr-add
                    onClick={commitDraft}
                  >
                    <Plus size={12} />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {feedback && (
          <div
            className={`archdisc-eqmgr-feedback archdisc-eqmgr-feedback-${feedback.type}`}
            data-archdisc-eqmgr-feedback={feedback.type}
          >
            {feedback.message}
          </div>
        )}

        <footer className="archdisc-eqmgr-footer">
          <div className="archdisc-eqmgr-footer-meta">
            {rows.length} variable{rows.length === 1 ? '' : 's'} · persists across sessions
          </div>
          <button
            type="button"
            className="archdisc-eqmgr-done"
            title="Done (Esc)"
            data-archdisc-eqmgr-done
            onClick={() => setOpen(false)}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

function formatValue(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs >= 10000 || abs < 0.001) return v.toExponential(4);
  if (abs >= 100) return v.toFixed(2);
  if (abs >= 10) return v.toFixed(3);
  return v.toFixed(4);
}

export default EquationManager;
