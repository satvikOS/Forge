// Forge-71 — Quick-Access Toolbar.
//
// Slim strip under the title bar with the user's pinned commands.
// Defaults: Save · Undo · Redo · New Box · New Cyl · Extrude · Export
// Bundle. User can pin any toolbar item via right-click → "Pin to QAT".
// Persists to localStorage at `forge.v4.qat`.

import React, { useEffect, useState } from 'react';
import { Icon } from './icons/Icon.jsx';
import { Tooltip } from './Tooltip.jsx';

const STORAGE_KEY = 'forge.v4.qat';

const DEFAULT_PINS = [
  { id: 'file.save',    label: 'Save',     icon: 'file.save',    hint: '⌘S' },
  { id: 'edit.undo',    label: 'Undo',     icon: 'edit.undo',    hint: '⌘Z' },
  { id: 'edit.redo',    label: 'Redo',     icon: 'edit.redo',    hint: '⌘⇧Z' },
  { id: 'sep1', divider: true },
  { id: 'sketch.new',   label: 'Sketch',   icon: 'sketch.rect' },
  { id: 'solid.extrude',label: 'Extrude',  icon: 'solid.extrude', hint: 'E' },
  { id: 'solid.fillet', label: 'Fillet',   icon: 'solid.fillet',  hint: 'F' },
  { id: 'sep2', divider: true },
  { id: 'view.zoomFit', label: 'Zoom fit', icon: 'view.zoom_fit', hint: 'F' },
  { id: 'view.iso',     label: 'Iso',      icon: 'view.iso',      hint: '1' },
  { id: 'sep3', divider: true },
  { id: 'file.importStep', label: 'Import STEP', icon: 'io.step' },
  { id: 'file.exportStep', label: 'Export STEP', icon: 'io.step' },
];

export function loadQAT() {
  if (typeof localStorage === 'undefined') return DEFAULT_PINS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PINS;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length ? arr : DEFAULT_PINS;
  } catch { return DEFAULT_PINS; }
}
export function saveQAT(pins) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pins)); } catch {}
}

export function QuickAccessBar({ onInvoke }) {
  const [pins, setPins] = useState(() => loadQAT());
  useEffect(() => { saveQAT(pins); }, [pins]);
  return (
    <div className="forge-qat" data-testid="forge-qat"
         role="toolbar" aria-label="Quick access">
      {pins.map((p) => p.divider ? (
        <span key={p.id} className="forge-qat-sep" aria-hidden="true" />
      ) : (
        <Tooltip key={p.id} label={p.label} hint={p.hint} placement="bottom">
          <button type="button"
                  className="forge-qat-btn"
                  data-qat-id={p.id}
                  onClick={() => onInvoke?.(p.id)}
                  aria-label={p.label}>
            <Icon name={p.icon} size={14} />
          </button>
        </Tooltip>
      ))}
      <span style={{ flex: 1 }} />
      <Tooltip label="Customise QAT" placement="left">
        <button type="button"
                className="forge-qat-btn forge-qat-btn-customise"
                onClick={() => onInvoke?.('qat.customise')}
                aria-label="Customise QAT">
          <Icon name="misc.settings" size={12} />
        </button>
      </Tooltip>
    </div>
  );
}
