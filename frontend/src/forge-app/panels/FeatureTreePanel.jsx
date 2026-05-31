import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

/**
 * FeatureTreePanel — list view of a ForgeProject.featureTree.
 *
 * - Rows render in tree.list() order with suppress checkbox + edit-in-
 *   place rename.
 * - Drag-and-drop reorders rows (HTML5 DnD). The underlying tree's
 *   `reorder()` will throw on DAG violations; we surface the error
 *   inline so the user knows why a move was rejected.
 * - The rollback slider at the bottom moves `rollbackAfterId` along
 *   the order array.
 *
 * Subscribes to `tree.onChange()` so external mutations (e.g. AI
 * autonomy) re-render the panel immediately.
 */
export default function FeatureTreePanel({ tree }) {
  // Force re-render on tree changes.
  const [, bump] = useState(0);
  useEffect(() => {
    if (!tree) return undefined;
    return tree.onChange(() => bump((n) => n + 1));
  }, [tree]);

  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [dragId, setDragId] = useState(null);
  const [error, setError] = useState(null);

  if (!tree) {
    return (
      <div className="forge-panel">
        <div className="forge-panel-header">Feature Tree</div>
        <div className="forge-panel-body" style={{ color: 'var(--muted)' }}>
          No active document. Open or create one to begin authoring.
        </div>
      </div>
    );
  }

  const features = tree.list();

  function onToggleSuppress(id, on) {
    try { tree.suppress(id, on); } catch (e) { setError(String(e.message || e)); }
  }
  function commitRename(id) {
    const node = tree.byId(id);
    if (node && editValue.trim()) {
      // FeatureTree has no rename helper, but `name` is a plain field
      // and we still want a change-notify, so edit-as-passthrough.
      node.name = editValue.trim();
      tree._notify(); // intentional: see FeatureTree.js — _notify is the
                     // documented escape hatch for in-place field tweaks.
    }
    setEditingId(null);
    setEditValue('');
  }
  function onDragStart(id) { setDragId(id); }
  function onDrop(targetId) {
    setError(null);
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const idx = tree.list().findIndex((f) => f.id === targetId);
    try {
      tree.reorder(dragId, idx);
    } catch (e) {
      setError(String(e.message || e));
    }
    setDragId(null);
  }
  function onRollbackChange(e) {
    const idx = Number(e.target.value);
    if (idx >= features.length - 1 || idx < 0) {
      tree.rollbackTo(null);
    } else {
      tree.rollbackTo(features[idx].id);
    }
  }

  // Derive the current slider value from rollback marker.
  const rollbackIdx = tree.rollbackAfterId
    ? features.findIndex((f) => f.id === tree.rollbackAfterId)
    : features.length - 1;

  return (
    <div className="forge-panel">
      <div className="forge-panel-header">
        Feature Tree
        <div className="spacer" />
        <span style={{ color: 'var(--muted)', textTransform: 'none', fontSize: 11 }}>
          {features.length} feature{features.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="forge-panel-body">
        {features.length === 0 && (
          <div style={{ color: 'var(--muted)' }}>
            Empty. Add a sketch from the Sketch ribbon to begin.
          </div>
        )}
        {features.map((f) => {
          const rolled = tree.isRolledBack(f.id);
          return (
            <div
              key={f.id}
              data-feature-id={f.id}
              draggable
              onDragStart={() => onDragStart(f.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(f.id)}
              className={`forge-feature-row${rolled ? ' rolled-back' : ''}${f.suppressed ? ' suppressed' : ''}`}
            >
              <input
                type="checkbox"
                aria-label={`suppress ${f.name}`}
                checked={!f.suppressed}
                onChange={(e) => onToggleSuppress(f.id, !e.target.checked)}
              />
              {editingId === f.id ? (
                <input
                  type="text"
                  className="name"
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => commitRename(f.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(f.id);
                    else if (e.key === 'Escape') { setEditingId(null); setEditValue(''); }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="name"
                  style={{ textAlign: 'left', cursor: 'text' }}
                  onDoubleClick={() => { setEditingId(f.id); setEditValue(f.name); }}
                >
                  {f.name}
                  <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 11 }}>
                    {f.kind}
                  </span>
                </button>
              )}
              {f.error ? (
                <span style={{ color: 'var(--error)', fontSize: 11 }} title={f.error}>!</span>
              ) : null}
            </div>
          );
        })}
        {features.length > 0 && (
          <div className="forge-rollback-bar">
            <span style={{ color: 'var(--muted)' }}>Rollback</span>
            <input
              type="range"
              min={0}
              max={features.length - 1}
              value={rollbackIdx < 0 ? features.length - 1 : rollbackIdx}
              onChange={onRollbackChange}
              aria-label="Rollback marker"
            />
          </div>
        )}
        {error && (
          <div style={{ color: 'var(--error)', fontSize: 11, marginTop: 6 }}>{error}</div>
        )}
      </div>
    </div>
  );
}

FeatureTreePanel.propTypes = {
  tree: PropTypes.object,
};
