// Forge-65 — top bar (title bar).
// Brand + 5 menus + active-workbench chip.

import React from 'react';
import { ForgeMark } from './icons/Logo.jsx';
import { WORKBENCHES } from './WorkbenchRail.jsx';

const MENUS = ['File', 'Edit', 'View', 'Tools', 'Help'];

export function TopBar({ activeWb, onMenu, version = '0.4.0' }) {
  const wb = WORKBENCHES.find((w) => w.id === activeWb) || WORKBENCHES[0];
  return (
    <header className="forge-topbar" role="banner" data-testid="forge-topbar">
      <span className="forge-topbar-brand">
        <ForgeMark size={20} title="Forge" />
        <span>Forge</span>
      </span>
      <nav className="forge-topbar-menus" aria-label="Application menu">
        {MENUS.map((m) => (
          <button key={m}
                  type="button"
                  className="forge-topbar-menu"
                  onClick={() => onMenu?.(m.toLowerCase())}>
            {m}
          </button>
        ))}
      </nav>
      <span className="forge-topbar-spacer" />
      <span className="forge-topbar-wb-chip" data-testid="forge-topbar-wb-chip">
        Workbench · <strong>{wb.label}</strong>
      </span>
      <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 8 }}>
        {version}
      </span>
    </header>
  );
}
