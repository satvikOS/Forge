// Forge-65 — left workbench rail.
//
// 60 px slim column hosting one tab per workbench. Active tab gets a
// copper border + label + a 3 px left stripe; the rest sit muted.
// Designed for at-a-glance recognition: the user always sees which
// workbench they're in without reading.

import React from 'react';
import { Icon } from './icons/Icon.jsx';
import { Tooltip } from './Tooltip.jsx';

export const WORKBENCHES = [
  { id: 'mech',     icon: 'wb.mech',     label: 'Part' },
  { id: 'drawing',  icon: 'wb.drawing',  label: 'Draft' },
  { id: 'sheet',    icon: 'wb.sheet',    label: 'Sheet' },
  { id: 'weld',     icon: 'wb.weldments',label: 'Weld' },
  { id: 'mold',     icon: 'wb.mold',     label: 'Mold' },
  { id: 'sim',      icon: 'wb.sim',      label: 'Sim' },
  { id: 'mfg',      icon: 'wb.mfg',      label: 'Mfg' },
];

export function WorkbenchRail({ activeId, onSwitch }) {
  return (
    <nav className="forge-wb-rail"
         aria-label="Workbenches"
         data-testid="forge-wb-rail">
      {WORKBENCHES.map((wb) => (
        <Tooltip key={wb.id} label={wb.label} placement="right">
          <button
            type="button"
            className="forge-wb-tab"
            data-wb={wb.id}
            data-active={String(activeId === wb.id)}
            onClick={() => onSwitch?.(wb.id)}
            aria-pressed={activeId === wb.id}
          >
            <Icon name={wb.icon} size={24} className="forge-wb-tab-glyph" />
            <span className="forge-wb-tab-label">{wb.label}</span>
          </button>
        </Tooltip>
      ))}
    </nav>
  );
}
