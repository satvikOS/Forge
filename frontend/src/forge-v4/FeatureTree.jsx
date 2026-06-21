// Forge-68 — feature tree with drag-reorder, suppress, right-click menu.
//
// Mirrors SolidWorks / Fusion semantics but with Forge's own
// presentation. Drag-and-drop reorders the steps; click toggles
// active; right-click pops a context menu.
//
// Visual chrome upgraded to CATIA / SolidWorks / NX grade: tight
// 22px rows, indentation-aware padding, expand/collapse chevron slot,
// per-node icons, full hover / active / selected / suppressed states,
// hover-reveal row actions, an inline rename affordance, and a sticky
// search/filter header — all on the Foundation design-system tokens
// (.fds-ft-* / --fds-*) via treeStyles.jsx. Behaviour, handlers, hooks
// and every data-testid are unchanged.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons/Icon.jsx';
import { EmptyState } from './EmptyState.jsx';
import { ensureTreeStyles, TreeChevron } from './treeStyles.jsx';

export function FeatureTree({ nodes, activeId, onPick, onReorder,
                              onToggleSuppress, onDelete, onRename }) {
  ensureTreeStyles();
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
    <div className="fds-ft-search">
      <span className="fds-ft-search-glyph"><Icon name="misc.search" size={12} /></span>
      <input ref={filterRef}
             value={filter}
             onChange={(e) => setFilter(e.target.value)}
             onKeyDown={(e) => { if (e.key === 'Escape') { setFilter(''); e.currentTarget.blur(); } }}
             placeholder="Filter features…  ⌘F"
             aria-label="Filter features"
             data-testid="forge-feature-tree-filter"
             className="fds-ft-search-input" />
    </div>
  );

  if (!nodes || nodes.length === 0) {
    return (
      <>
        {filterInput}
        <EmptyState
          inline
          icon="sketch.rect"
          title="No features yet"
          hint="Start a sketch or run an operation — every step lands here in order."
        />
      </>
    );
  }
  return (
    <>
      {filterInput}
      <ul className="fds-ft-list"
          data-testid="forge-feature-tree"
          data-feature-filter={filterTerm}
          data-feature-visible-count={visibleNodes.length}>
        {visibleNodes.map((n) => {
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
                className="fds-ft-row"
                data-active={isActive ? 'true' : undefined}
                data-drag-over={isOver ? 'true' : undefined}
                data-suppressed={n.suppressed ? 'true' : undefined}
                style={{ '--ft-indent': 'var(--fds-space-3)' }}>
              {/* leaf chevron slot keeps every label column-aligned */}
              <span className="fds-ft-twisty" data-leaf="true" aria-hidden="true">
                <TreeChevron size={12} />
              </span>
              <span className="fds-ft-dot" aria-hidden="true" />
              <span className="fds-ft-icon"><Icon name={n.icon || 'sketch.point'} size={12} /></span>
              {renaming === n.id ? (
                <input autoFocus
                       defaultValue={n.label}
                       className="fds-ft-rename"
                       onClick={(e) => e.stopPropagation()}
                       onBlur={(e) => { onRename?.(n.id, e.target.value); setRenaming(null); }}
                       onKeyDown={(e) => {
                         if (e.key === 'Enter') { onRename?.(n.id, e.currentTarget.value); setRenaming(null); }
                         if (e.key === 'Escape') setRenaming(null);
                       }} />
              ) : (
                <>
                  <span className="fds-ft-label">{n.label}</span>
                  <span className="fds-ft-row-actions">
                    <button type="button"
                            tabIndex={-1}
                            title={n.suppressed ? 'Unsuppress' : 'Suppress'}
                            data-on={n.suppressed ? 'true' : undefined}
                            onClick={(e) => { e.stopPropagation(); onToggleSuppress?.(n.id); }}>
                      <Icon name={n.suppressed ? 'misc.eye_off' : 'misc.eye'} size={12} />
                    </button>
                    <button type="button"
                            tabIndex={-1}
                            title="Rename"
                            onClick={(e) => { e.stopPropagation(); setRenaming(n.id); }}>
                      <Icon name="edit.copy" size={12} />
                    </button>
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {ctxMenu && (
        <ul role="menu"
            data-testid="forge-feature-ctx"
            className="fds-ft-menu"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              left: Math.min(ctxMenu.x, window.innerWidth - 200),
              top: Math.min(ctxMenu.y, window.innerHeight - 160),
              zIndex: 'var(--fds-z-popover)',
            }}>
          <CtxItem icon="misc.eye"      label="Toggle suppress" onClick={() => { onToggleSuppress?.(ctxMenu.id); setCtxMenu(null); }} />
          <CtxItem icon="edit.copy"     label="Rename"          onClick={() => { setRenaming(ctxMenu.id); setCtxMenu(null); }} />
          <li className="fds-ft-menu-sep" role="separator" />
          <CtxItem icon="edit.delete"   label="Delete"   danger onClick={() => { onDelete?.(ctxMenu.id); setCtxMenu(null); }} />
        </ul>
      )}
    </>
  );
}

function CtxItem({ icon, label, onClick, danger }) {
  return (
    <li role="menuitem">
      <button type="button" onClick={onClick}
              className="fds-ft-menu-item"
              data-danger={danger ? 'true' : undefined}>
        <Icon name={icon} size={12} />
        <span>{label}</span>
      </button>
    </li>
  );
}
