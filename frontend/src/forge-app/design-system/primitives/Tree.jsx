/**
 * Tree — keyboard-navigable tree-view primitive.
 *
 * Each node: { id, label, icon?, badge?, children?: Node[], suppressed?, status? }.
 * Selection: single by default; pass `multiSelect` to enable Shift/Ctrl.
 * Keyboard: ↑/↓ moves, →/← expand/collapse (or jump to parent), Space
 * toggles suppress (if `onToggleSuppress`), F2 renames, Del deletes,
 * Enter activates.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Icon } from '../icons/Icon.jsx';

function flatten(nodes, expanded, depth = 0, parent = null, out = []) {
  for (const n of nodes) {
    out.push({ node: n, depth, parent });
    if (n.children && n.children.length && expanded.has(n.id)) {
      flatten(n.children, expanded, depth + 1, n.id, out);
    }
  }
  return out;
}

export function Tree({
  nodes,
  selected = [],
  onSelect,
  onActivate,
  onContextMenu,
  expanded: controlledExpanded,
  defaultExpanded,
  onExpandedChange,
  multiSelect = false,
  onRename,
  onDelete,
  onToggleSuppress,
}) {
  const [internalExpanded, setInternalExpanded] = useState(() =>
    new Set(defaultExpanded || nodes.map((n) => n.id)));
  const expanded = controlledExpanded ? new Set(controlledExpanded) : internalExpanded;
  const setExpanded = (next) => {
    if (controlledExpanded) onExpandedChange?.([...next]);
    else { setInternalExpanded(next); onExpandedChange?.([...next]); }
  };

  const [editingId, setEditingId] = useState(null);
  const containerRef = useRef(null);
  const rows = flatten(nodes, expanded);
  const sel = new Set(selected);

  const focusRow = (idx) => {
    const el = containerRef.current?.querySelectorAll('[data-tree-row]')[idx];
    if (el) el.focus();
  };

  const toggle = (id) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  const handleClick = (n, e) => {
    if (multiSelect && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      if (sel.has(n.id)) sel.delete(n.id); else sel.add(n.id);
      onSelect?.([...sel]);
    } else {
      onSelect?.([n.id]);
    }
  };

  const handleKey = (e, idx, n) => {
    if (editingId) return; // editing keys are handled inline
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault(); focusRow(Math.min(idx + 1, rows.length - 1)); break;
      case 'ArrowUp':
        e.preventDefault(); focusRow(Math.max(idx - 1, 0)); break;
      case 'ArrowRight':
        if (n.children?.length && !expanded.has(n.id)) toggle(n.id);
        else focusRow(idx + 1);
        e.preventDefault(); break;
      case 'ArrowLeft':
        if (n.children?.length && expanded.has(n.id)) { toggle(n.id); e.preventDefault(); }
        break;
      case 'Enter':
        e.preventDefault(); onActivate?.(n); break;
      case ' ':
        if (onToggleSuppress) { e.preventDefault(); onToggleSuppress(n); }
        break;
      case 'F2':
        if (onRename) { e.preventDefault(); setEditingId(n.id); }
        break;
      case 'Delete':
      case 'Backspace':
        if (onDelete) { e.preventDefault(); onDelete(n); }
        break;
      default: break;
    }
  };

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-multiselectable={multiSelect || undefined}
      style={{ outline: 'none' }}
    >
      {rows.map(({ node, depth }, idx) => {
        const isSelected = sel.has(node.id);
        const isExpanded = expanded.has(node.id);
        const hasChildren = !!node.children?.length;
        return (
          <div
            key={node.id}
            data-tree-row
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={hasChildren ? isExpanded : undefined}
            aria-selected={isSelected}
            tabIndex={isSelected || (idx === 0 && !selected.length) ? 0 : -1}
            onKeyDown={(e) => handleKey(e, idx, node)}
            onClick={(e) => handleClick(node, e)}
            onDoubleClick={() => { if (onRename) setEditingId(node.id); else onActivate?.(node); }}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(node, { x: e.clientX, y: e.clientY }); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: `var(--space-2) var(--space-5)`,
              paddingLeft: `calc(var(--space-5) + ${depth * 16}px)`,
              background: isSelected ? 'var(--surface-selected)' : 'transparent',
              color: node.suppressed ? 'var(--text-disabled)' : 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              userSelect: 'none',
              opacity: node.suppressed ? 0.55 : 1,
            }}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggle(node.id); }}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-tertiary)', padding: 0,
                  display: 'inline-flex', width: 14, justifyContent: 'center',
                }}
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
              >
                <Icon name={isExpanded ? 'chevronDown' : 'chevronRight'} size={10} />
              </button>
            ) : (
              <span style={{ width: 14 }} />
            )}
            {node.icon}
            {editingId === node.id ? (
              <input
                autoFocus
                defaultValue={node.label}
                onBlur={(e) => { onRename(node, e.target.value); setEditingId(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { onRename(node, e.currentTarget.value); setEditingId(null); }
                  if (e.key === 'Escape') setEditingId(null);
                }}
                style={{
                  flex: 1, border: '1px solid var(--accent-bg)',
                  background: 'var(--surface-app)', color: 'var(--text-primary)',
                  fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)',
                  padding: '0 var(--space-3)', borderRadius: 'var(--radius-xs)',
                  outline: 'none',
                }}
              />
            ) : (
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {node.label}
              </span>
            )}
            {node.status === 'error' && <Icon name="error" size={12} style={{ color: 'var(--danger-bg)' }} />}
            {node.status === 'warning' && <Icon name="warning" size={12} style={{ color: 'var(--warning-bg)' }} />}
            {node.suppressed && <Icon name="suppress" size={12} />}
            {node.badge !== undefined && node.badge !== null && (
              <span style={{
                fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
              }}>{node.badge}</span>
            )}
          </div>
        );
      })}
      {rows.length === 0 && (
        <div style={{ padding: 'var(--space-7)', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
          (empty)
        </div>
      )}
    </div>
  );
}
