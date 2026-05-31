// Forge-73 — Rollback timeline scrubber.
//
// Slim vertical strip on the right gutter (just inside the right
// panel). User drags the playhead to time-travel through the feature
// tree; clicking a card jumps to that step. Replicates the legacy
// "Rollback Bar" widget — common in SolidWorks, Fusion 360.

import React, { useRef, useState } from 'react';
import { Icon } from './icons/Icon.jsx';

export function RollbackBar({ features, activeIndex, onRollback,
                              onSuppress, onDelete, onRename }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const containerRef = useRef(null);

  if (!features || features.length === 0) return null;

  return (
    <div className="forge-rollback"
         ref={containerRef}
         role="region"
         aria-label="Rollback timeline"
         data-testid="forge-rollback">
      <div className="forge-rollback-track">
        {features.map((f, i) => (
          <div key={f.id}
               className="forge-rollback-card"
               data-active={String(i === activeIndex)}
               data-hover={String(i === hoverIndex)}
               data-suppressed={String(!!f.suppressed)}
               onMouseEnter={() => setHoverIndex(i)}
               onMouseLeave={() => setHoverIndex(null)}
               onClick={() => onRollback?.(i)}
               onContextMenu={(e) => {
                 e.preventDefault();
                 setCtxMenu({ index: i, x: e.clientX, y: e.clientY });
               }}>
            <Icon name={f.icon || 'sketch.point'} size={11} />
            <span className="forge-rollback-card-label">{f.label}</span>
          </div>
        ))}
        <div className="forge-rollback-playhead"
             style={{ top: `${activeIndex * 26 + 12}px` }}
             aria-label="Playhead" />
      </div>
      {ctxMenu && (
        <ul role="menu"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              left: Math.min(ctxMenu.x, window.innerWidth - 180),
              top: Math.min(ctxMenu.y, window.innerHeight - 120),
              listStyle: 'none',
              margin: 0, padding: 4,
              background: 'var(--forge-canvas-3)',
              border: '1px solid var(--forge-rail-edge)',
              borderRadius: 'var(--forge-radius)',
              boxShadow: '0 12px 36px rgba(0,0,0,0.55)',
              minWidth: 160,
              zIndex: 1400,
            }}>
          <CtxItem icon="misc.eye"    label="Toggle suppress"
                   onClick={() => { onSuppress?.(ctxMenu.index); setCtxMenu(null); }} />
          <CtxItem icon="edit.copy"   label="Rename"
                   onClick={() => { onRename?.(ctxMenu.index); setCtxMenu(null); }} />
          <CtxItem icon="edit.delete" label="Delete"
                   onClick={() => { onDelete?.(ctxMenu.index); setCtxMenu(null); }} />
        </ul>
      )}
    </div>
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
