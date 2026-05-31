// Forge-73 — Body context menu (right-click in viewport).
//
// Selection-aware action list. Body selected → Edit / Duplicate /
// Visibility / Suppress / Delete / Appearance. Face / Edge / Vertex
// have their own appropriate sub-items.

import React, { useEffect, useState } from 'react';
import { Icon } from './icons/Icon.jsx';

function itemsFor(selection) {
  if (selection?.kind === 'body' && selection.ids?.length > 0) {
    return [
      { id: 'edit',       label: 'Edit feature',    icon: 'menu.edit',     shortcut: 'Enter' },
      { id: 'duplicate',  label: 'Duplicate',       icon: 'edit.copy',     shortcut: '⌘D' },
      { id: 'hide',       label: 'Hide',            icon: 'misc.eye_off',  shortcut: 'H' },
      { id: 'isolate',    label: 'Isolate',         icon: 'misc.eye' },
      { divider: true },
      { id: 'pattern',    label: 'Pattern…',        icon: 'pattern.linear' },
      { id: 'mirror',     label: 'Mirror…',         icon: 'pattern.mirror' },
      { id: 'transform',  label: 'Transform…',      icon: 'sketch.line' },
      { divider: true },
      { id: 'appearance', label: 'Appearance…',     icon: 'misc.theme' },
      { id: 'material',   label: 'Material…',       icon: 'measure.mass' },
      { divider: true },
      { id: 'suppress',   label: 'Suppress',        icon: 'misc.lock' },
      { id: 'delete',     label: 'Delete',          icon: 'edit.delete',   shortcut: '⌫' },
    ];
  }
  if (selection?.kind === 'face') {
    return [
      { id: 'pushPull',   label: 'Push / pull',     icon: 'solid.face_push' },
      { id: 'fillet',     label: 'Fillet',          icon: 'solid.fillet' },
      { id: 'chamfer',    label: 'Chamfer',         icon: 'solid.chamfer' },
      { id: 'delete',     label: 'Delete face & heal', icon: 'edit.delete' },
      { divider: true },
      { id: 'sketch',     label: 'Sketch on face',  icon: 'sketch.rect' },
      { id: 'normalTo',   label: 'Normal to',       icon: 'misc.expand_r' },
    ];
  }
  if (selection?.kind === 'edge') {
    return [
      { id: 'fillet',     label: 'Fillet edges',    icon: 'solid.fillet' },
      { id: 'chamfer',    label: 'Chamfer edges',   icon: 'solid.chamfer' },
      { id: 'dimension',  label: 'Dimension',       icon: 'sketch.dim' },
    ];
  }
  return [
    { id: 'create.box', label: 'Create box',     icon: 'sketch.rect' },
    { id: 'create.cyl', label: 'Create cylinder', icon: 'sketch.circle' },
    { divider: true },
    { id: 'view.zoomFit', label: 'Zoom to fit',  icon: 'view.zoom_fit', shortcut: 'F' },
    { id: 'view.iso',     label: 'Isometric',     icon: 'view.iso',      shortcut: '1' },
  ];
}

export function BodyContextMenu({ open, x, y, selection, onPick, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onDoc = () => onClose?.();
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    setTimeout(() => {
      window.addEventListener('mousedown', onDoc);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  const items = itemsFor(selection);
  return (
    <ul role="menu"
        data-testid="forge-body-ctx"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: Math.min(x, window.innerWidth - 200),
          top: Math.min(y, window.innerHeight - 320),
          listStyle: 'none',
          margin: 0, padding: 4,
          background: 'var(--forge-canvas-3)',
          border: '1px solid var(--forge-rail-edge)',
          borderRadius: 'var(--forge-radius)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
          minWidth: 200,
          zIndex: 1500,
        }}>
      {items.map((it, i) => it.divider ? (
        <li key={`sep-${i}`} role="separator"
            style={{ height: 1, background: 'var(--forge-rail-edge)',
                     margin: '4px 6px' }} />
      ) : (
        <li key={it.id} role="menuitem">
          <button type="button"
                  onClick={() => { onPick?.(it); onClose?.(); }}
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
            <Icon name={it.icon} size={12} />
            <span style={{ flex: 1 }}>{it.label}</span>
            {it.shortcut && (
              <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                             color: 'var(--forge-ink-mute)' }}>{it.shortcut}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
