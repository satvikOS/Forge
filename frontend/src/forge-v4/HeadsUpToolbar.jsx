// Forge-71 — Heads-Up viewport toolbar.
//
// Floats top-center over the viewport (industry convention — Inventor,
// SolidWorks). Zoom Fit · View Orientation · Display Style · Section
// toggle · Normal-To. Each tool also has its own keyboard shortcut.

import React from 'react';
import { Icon } from './icons/Icon.jsx';
import { Tooltip } from './Tooltip.jsx';

const HUT_TOOLS = [
  { id: 'view.zoomFit',    label: 'Zoom fit',     icon: 'view.zoom_fit', hint: 'F' },
  { id: 'view.iso',        label: 'Iso',          icon: 'view.iso',      hint: '1' },
  { sep: true, id: 's1' },
  { id: 'view.shaded',     label: 'Shaded',       icon: 'view.shaded' },
  { id: 'view.wireframe',  label: 'Wireframe',    icon: 'view.wireframe' },
  { id: 'view.section',    label: 'Section',      icon: 'view.section' },
  { sep: true, id: 's2' },
  { id: 'gizmo.translate', label: 'Move (T)',     icon: 'sketch.line',     hint: 'T' },
  { id: 'gizmo.rotate',    label: 'Rotate (R)',   icon: 'edit.redo',       hint: 'R' },
  { id: 'gizmo.scale',     label: 'Scale (Y)',    icon: 'misc.expand_r',   hint: 'Y' },
  { sep: true, id: 's3' },
  { id: 'view.normalTo',   label: 'Normal to',    icon: 'misc.expand_r' },
];

export function HeadsUpToolbar({ activeDisplay = 'shaded', activeGizmo = null, onAction }) {
  return (
    <div className="forge-hut"
         role="toolbar"
         aria-label="Viewport tools"
         data-testid="forge-hut">
      {HUT_TOOLS.map((t) => t.sep ? (
        <span key={t.id} className="forge-hut-sep" aria-hidden="true" />
      ) : (
        <Tooltip key={t.id} label={t.label} hint={t.hint} placement="bottom">
          <button type="button"
                  className="forge-hut-btn"
                  data-hut-id={t.id}
                  data-active={String(t.id === `view.${activeDisplay}` || t.id === `gizmo.${activeGizmo}`)}
                  onClick={() => onAction?.(t.id)}
                  aria-label={t.label}>
            <Icon name={t.icon} size={14} />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
