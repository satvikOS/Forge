// Forge-68 — feature tree with drag-reorder, suppress, right-click menu.
//
// Mirrors SolidWorks / Fusion semantics but with Forge's own
// presentation. Drag-and-drop reorders the steps; click toggles
// active; right-click pops a context menu.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons/Icon.jsx';

export function FeatureTree({ nodes, activeId, onPick, onReorder,
                              onToggleSuppress, onDelete, onRename }) {
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  // Forge-139 — Cmd+F focuses an inline filter input that hides
  // non-matching nodes (case-insensitive substring on label / id /
  // icon). Empty filter shows every node.
  const [filter, setFilter] = useState('');
  const filterRef = useRef(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'f') {
        // Only steal Cmd+F when the feature tree is actually mounted +
        // visible. We rely on the input being focusable; if there's no
        // ref yet we let the browser handle it.
        if (filterRef.current) {
          e.preventDefault();
          filterRef.current.focus();
          filterRef.current.select?.();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const filterTerm = filter.trim().toLowerCase();
  const visibleNodes = (nodes || []).filter((n) => {
    if (!filterTerm) return true;
    const hay = `${(n.label || '').toLowerCase()} ${(n.id || '').toLowerCase()} ${(n.icon || '').toLowerCase()}`;
    return hay.includes(filterTerm);
  });

  const onDragStart = (id) => (e) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };
  const onDragOver = (id) => (e) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (overId !== id) setOverId(id);
  };
  const onDrop = (id) => (e) => {
    e.preventDefault();
    if (dragId && dragId !== id) onReorder?.(dragId, id);
    setDragId(null); setOverId(null);
  };
  const onDragEnd = () => { setDragId(null); setOverId(null); };

  useEffect(() => {
    if (!ctxMenu) return;
    const onDoc = () => setCtxMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setCtxMenu(null); };
    setTimeout(() => {
      window.addEventListener('mousedown', onDoc);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  const filterInput = (
    <input ref={filterRef}
           value={filter}
           onChange={(e) => setFilter(e.target.value)}
           onKeyDown={(e) => { if (e.key === 'Escape') { setFilter(''); e.currentTarget.blur(); } }}
           placeholder="Filter features… (⌘F)"
           data-testid="forge-feature-tree-filter"
           style={{
             width: '100%', margin: '2px 0 6px',
             background: 'var(--forge-canvas)',
             color: 'var(--forge-ink)',
             border: '1px solid var(--forge-rail-edge)',
             borderRadius: 3,
             font: 'inherit', fontSize: 11,
             padding: '4px 6px',
           }} />
  );

  if (!nodes || nodes.length === 0) {
    return (
      <>
        {filterInput}
        <div style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic',
                      padding: 4 }}>
          No features yet. Start a sketch or run an op.
        </div>
      </>
    );
  }
  return (
    <>
      {filterInput}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}
          data-testid="forge-feature-tree"
          data-feature-filter={filterTerm}
          data-feature-visible-count={visibleNodes.length}>
        {visibleNodes.map((n, i) => {
          const isActive = n.id === activeId;
          const isOver = n.id === overId;
          return (
            <li key={n.id}
                draggable
                onDragStart={onDragStart(n.id)}
                onDragOver={onDragOver(n.id)}
                onDrop={onDrop(n.id)}
                onDragEnd={onDragEnd}
                onClick={() => onPick?.(n.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ id: n.id, x: e.clientX, y: e.clientY });
                }}
                onDoubleClick={() => setRenaming(n.id)}
                style={{
                  position: 'relative',
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '3px 4px',
                  borderRadius: 3,
                  background: isActive ? 'var(--forge-accent-mute)' : (isOver ? 'var(--forge-surface)' : 'transparent'),
                  color: n.suppressed ? 'var(--forge-ink-faint)' : 'var(--forge-ink)',
                  cursor: 'pointer',
                  textDecoration: n.suppressed ? 'line-through' : 'none',
                }}>
              {/* connector spine joining the per-row status dots (harvested from legacy FeatureTreePanel) */}
              <span aria-hidden="true" style={{
                position: 'absolute', left: 6.5, width: 1,
                top: i === 0 ? 'calc(50% - 1px)' : 0,
                bottom: i === visibleNodes.length - 1 ? 'calc(50% - 1px)' : 0,
                background: 'var(--forge-rail-edge)', pointerEvents: 'none',
              }} />
              <span style={{
                position: 'relative',
                display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                background: isActive ? 'var(--forge-accent)' : 'var(--forge-ink-faint)',
              }} />
              <Icon name={n.icon || 'sketch.point'} size={12} />
              {renaming === n.id ? (
                <input autoFocus
                       defaultValue={n.label}
                       onBlur={(e) => { onRename?.(n.id, e.target.value); setRenaming(null); }}
                       onKeyDown={(e) => {
                         if (e.key === 'Enter') { onRename?.(n.id, e.currentTarget.value); setRenaming(null); }
                         if (e.key === 'Escape') setRenaming(null);
                       }}
                       style={{
                         background: 'var(--forge-canvas-3)',
                         color: 'var(--forge-ink)',
                         border: '1px solid var(--forge-rail-edge)',
                         borderRadius: 3, padding: '1px 4px',
                         font: 'inherit', fontSize: 11,
                         width: '100%', minWidth: 80,
                       }} />
              ) : (
                <span style={{ flex: 1 }}>{n.label}</span>
              )}
            </li>
          );
        })}
      </ul>
      {ctxMenu && (
        <ul role="menu"
            data-testid="forge-feature-ctx"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              left: Math.min(ctxMenu.x, window.innerWidth - 200),
              top: Math.min(ctxMenu.y, window.innerHeight - 160),
              listStyle: 'none',
              margin: 0, padding: 4,
              background: 'var(--forge-canvas-3)',
              border: '1px solid var(--forge-rail-edge)',
              borderRadius: 'var(--forge-radius)',
              boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
              minWidth: 160,
              zIndex: 1400,
            }}>
          <CtxItem icon="misc.eye"      label="Toggle suppress" onClick={() => { onToggleSuppress?.(ctxMenu.id); setCtxMenu(null); }} />
          <CtxItem icon="edit.copy"     label="Rename"          onClick={() => { setRenaming(ctxMenu.id); setCtxMenu(null); }} />
          <CtxItem icon="edit.delete"   label="Delete"          onClick={() => { onDelete?.(ctxMenu.id); setCtxMenu(null); }} />
        </ul>
      )}
    </>
  );
}

function CtxItem({ icon, label, onClick }) {
  return (
    <li role="menuitem">
      <button type="button" onClick={onClick}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%',
                padding: '5px 10px',
                background: 'transparent', border: 'none',
                color: 'var(--forge-ink)', font: 'inherit', fontSize: 12,
                cursor: 'pointer', textAlign: 'left',
                borderRadius: 3,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--forge-surface)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
        <Icon name={icon} size={12} />
        <span>{label}</span>
      </button>
    </li>
  );
}
