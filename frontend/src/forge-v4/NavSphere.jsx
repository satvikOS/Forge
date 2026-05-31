// Forge-71 — NavSphere widget.
//
// Translucent orientation gizmo in the viewport top-right corner. SVG-
// based (no THREE) so it stays cheap and crisp. Click any of the 6 face
// chips → camera snaps to that view; corner chips → iso variants. The
// camera position itself is owned by ForgeShellV4.viewName, so the
// widget just emits onSelectView(name) and the viewport reacts.

import React from 'react';

const FACES = [
  { id: 'top',    label: 'TOP',   d: 'M40 12 L60 18 L40 28 L20 18 Z', x: 40, y: 19, color: 'var(--forge-canvas-3)' },
  { id: 'front',  label: 'FRONT', d: 'M20 18 L40 28 L40 52 L20 42 Z', x: 30, y: 38, color: 'var(--forge-surface-2)' },
  { id: 'right',  label: 'RIGHT', d: 'M40 28 L60 18 L60 42 L40 52 Z', x: 50, y: 38, color: 'var(--forge-surface)' },
  // bottom/back/left are hidden silhouettes; they get triggered via the
  // small chip strip below the gizmo.
];

const CHIPS = [
  { id: 'iso',    label: 'Iso' },
  { id: 'front',  label: 'F' },
  { id: 'back',   label: 'Bk' },
  { id: 'top',    label: 'T' },
  { id: 'bottom', label: 'Bt' },
  { id: 'right',  label: 'R' },
  { id: 'left',   label: 'L' },
];

export function NavSphere({ activeView = 'iso', onSelectView }) {
  return (
    <div className="forge-navsphere"
         data-testid="forge-navsphere"
         aria-label="View navigation">
      <svg viewBox="0 0 80 64" width={80} height={64}
           style={{ pointerEvents: 'auto' }}>
        {FACES.map((f) => (
          <g key={f.id}
             onClick={() => onSelectView?.(f.id)}
             style={{ cursor: 'pointer' }}>
            <path d={f.d}
                  fill={activeView === f.id
                    ? 'var(--forge-accent-mute)'
                    : f.color}
                  stroke="var(--forge-rail-edge)"
                  strokeWidth={0.8} />
            <text x={f.x} y={f.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="var(--forge-ink-2)"
                  fontSize="6"
                  fontFamily="var(--forge-mono)"
                  pointerEvents="none">
              {f.label}
            </text>
          </g>
        ))}
        {/* Axis triad at the corner */}
        <g transform="translate(58, 56)">
          <line x1="0" y1="0" x2="6" y2="0"
                stroke="var(--forge-ink)" strokeWidth={1} />
          <line x1="0" y1="0" x2="0" y2="-6"
                stroke="var(--forge-ink-2)" strokeWidth={1} />
          <line x1="0" y1="0" x2="-3" y2="3"
                stroke="var(--forge-ink-mute)" strokeWidth={1} />
        </g>
      </svg>
      <div className="forge-navsphere-chips">
        {CHIPS.map((c) => (
          <button key={c.id}
                  type="button"
                  className="forge-navsphere-chip"
                  data-active={String(activeView === c.id)}
                  onClick={() => onSelectView?.(c.id)}
                  aria-label={c.label}
                  aria-pressed={activeView === c.id}
                  title={c.label}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
