// Forge-66 — top-bar dropdown menus.
//
// File / Edit / View / Tools / Help — Industry-standard layout, each
// item dispatches a string action id that ForgeShellV4 maps to a
// concrete handler (file.new / view.shaded / tools.settings, …).
//
// One menu open at a time. Click outside or Esc closes. Arrow keys
// navigate; Enter activates. No external library — pure React.

import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons/Icon.jsx';

const SEP = { divider: true };

export const MENU_SPEC = {
  file: {
    label: 'File',
    items: [
      { id: 'file.new',     label: 'New',          icon: 'file.new',    shortcut: '⌘N' },
      { id: 'file.open',    label: 'Open…',        icon: 'file.open',   shortcut: '⌘O' },
      SEP,
      { id: 'file.save',    label: 'Save',         icon: 'file.save',   shortcut: '⌘S' },
      { id: 'file.saveAs',  label: 'Save As…',     icon: 'file.save',   shortcut: '⌘⇧S' },
      SEP,
      { id: 'file.importStep', label: 'Import STEP…', icon: 'io.step' },
      { id: 'file.importIges', label: 'Import IGES…', icon: 'io.iges' },
      { id: 'file.importBrep', label: 'Import BREP…', icon: 'io.brep' },
      { id: 'file.importStl',  label: 'Import STL…',  icon: 'io.stl' },
      SEP,
      { id: 'file.exportStep', label: 'Export STEP…', icon: 'io.step' },
      { id: 'file.exportIges', label: 'Export IGES…', icon: 'io.iges' },
      { id: 'file.exportStl',  label: 'Export STL…',  icon: 'io.stl' },
      { id: 'file.exportBrep', label: 'Export BREP…', icon: 'io.brep' },
      { id: 'file.exportPdf',  label: 'Export PDF…',  icon: 'io.pdf' },
      SEP,
      { id: 'file.settings', label: 'Settings…',   icon: 'misc.settings', shortcut: '⌘,' },
      { id: 'file.quit',     label: 'Quit Forge',  icon: null,            shortcut: '⌘Q' },
    ],
  },
  edit: {
    label: 'Edit',
    items: [
      { id: 'edit.undo',      label: 'Undo',       icon: 'edit.undo',  shortcut: '⌘Z' },
      { id: 'edit.redo',      label: 'Redo',       icon: 'edit.redo',  shortcut: '⌘⇧Z' },
      SEP,
      { id: 'edit.copy',      label: 'Copy',       icon: 'edit.copy',  shortcut: '⌘C' },
      { id: 'edit.paste',     label: 'Paste',      icon: 'edit.paste', shortcut: '⌘V' },
      { id: 'edit.delete',    label: 'Delete',     icon: 'edit.delete',shortcut: '⌫' },
      SEP,
      { id: 'edit.selectAll', label: 'Select All', icon: null,          shortcut: '⌘A' },
      { id: 'edit.selectNone',label: 'Select None',icon: 'select.clear',shortcut: '⌘⇧A' },
      SEP,
      { id: 'edit.filterFace', label: 'Filter · Faces', icon: 'select.face' },
      { id: 'edit.filterEdge', label: 'Filter · Edges', icon: 'select.edge' },
      { id: 'edit.filterVert', label: 'Filter · Vertices', icon: 'select.vertex' },
      { id: 'edit.filterBody', label: 'Filter · Bodies', icon: 'select.body' },
    ],
  },
  view: {
    label: 'View',
    items: [
      { id: 'view.iso',     label: 'Isometric',     icon: 'view.iso',   shortcut: '1' },
      { id: 'view.front',   label: 'Front',         icon: 'view.front', shortcut: '2' },
      { id: 'view.top',     label: 'Top',           icon: 'view.top',   shortcut: '3' },
      { id: 'view.right',   label: 'Right',         icon: 'view.right', shortcut: '4' },
      SEP,
      { id: 'view.shaded',     label: 'Shaded',     icon: 'view.shaded' },
      { id: 'view.wireframe',  label: 'Wireframe',  icon: 'view.wireframe' },
      { id: 'view.section',    label: 'Section',    icon: 'view.section' },
      SEP,
      { id: 'view.zoomFit',    label: 'Zoom to fit', icon: 'view.zoom_fit', shortcut: 'F' },
      SEP,
      { id: 'view.toggleRight', label: 'Toggle right panel', icon: 'misc.collapse_r' },
      { id: 'view.toggleDock',  label: 'Toggle Archie dock', icon: 'archie.thread', shortcut: '⌘/' },
      { id: 'view.preview',     label: 'Toggle preview panels', icon: 'wb.drawing', shortcut: '⌘P' },
      { id: 'view.theme',       label: 'Toggle theme (dark/light)', icon: 'misc.theme', shortcut: '⌘T' },
    ],
  },
  tools: {
    label: 'Tools',
    items: [
      { id: 'tools.settings',  label: 'Settings…',          icon: 'misc.settings', shortcut: '⌘,' },
      { id: 'tools.shortcuts', label: 'Customize Shortcuts…', icon: 'misc.kbd' },
      { id: 'tools.search',    label: 'Command Search…',    icon: 'misc.search',   shortcut: '⌘K' },
      SEP,
      { id: 'tools.library',   label: 'Standard Parts Library…', icon: 'misc.search' },
      { id: 'tools.equations', label: 'Equation Manager…', icon: 'measure.distance', shortcut: '⌘E' },
      { id: 'tools.topology',  label: 'Topology Inspector…', icon: 'select.body', shortcut: '⌘I' },
      { id: 'tools.measure',   label: 'Measure',            icon: 'measure.distance' },
      SEP,
      { id: 'tools.assembly',     label: 'Assembly…',        icon: 'wb.mech' },
      { id: 'tools.assemblyTree', label: 'Assembly tree…',   icon: 'wb.mech' },
      { id: 'tools.interfere',    label: 'Interference check', icon: 'measure.interfere' },
      SEP,
      // Forge-125 — surface the stress-test launcher in the Tools menu
      // so the e2e spec (and curious users) can reach it via real menu
      // navigation, not just the keyboard shortcut.
      { id: 'tools.stressTest', label: 'Stress test…',      icon: 'misc.kbd' },
      SEP,
      // Forge-126 — class-A surfacing MVP. Direct Edit + Heal + Surfacing
      // share an entry block so users can find the GSD command surface
      // through real menu navigation, not just the imperative open hook.
      { id: 'tools.directEdit', label: 'Direct Edit…',     icon: 'sketch.rect' },
      { id: 'tools.heal',       label: 'Heal…',            icon: 'sketch.fillet' },
      { id: 'tools.surfacing',  label: 'Surfacing…',        icon: 'sketch.spline' },
    ],
  },
  help: {
    label: 'Help',
    items: [
      { id: 'help.docs',      label: 'Documentation', icon: 'menu.help' },
      { id: 'help.shortcuts', label: 'Keyboard Shortcuts', icon: 'misc.kbd' },
      SEP,
      { id: 'help.about',     label: 'About Forge…',   icon: 'menu.help' },
    ],
  },
};

export const MENU_KEYS = ['file', 'edit', 'view', 'tools', 'help'];

export function MenuBar({ onAction }) {
  const [openId, setOpenId] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!openId) return;
    const onDoc = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpenId(null);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpenId(null); };
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [openId]);

  return (
    <nav ref={containerRef}
         className="forge-topbar-menus"
         aria-label="Application menu"
         data-testid="forge-menus">
      {MENU_KEYS.map((id) => {
        const spec = MENU_SPEC[id];
        const isOpen = openId === id;
        return (
          <div key={id} style={{ position: 'relative' }}>
            <button
              type="button"
              className="forge-topbar-menu"
              aria-haspopup="menu"
              aria-expanded={isOpen ? 'true' : 'false'}
              data-menu={id}
              onMouseEnter={() => openId && openId !== id && setOpenId(id)}
              onClick={() => setOpenId(isOpen ? null : id)}
            >
              {spec.label}
            </button>
            {isOpen && (
              <ul role="menu"
                  data-testid={`forge-menu-${id}`}
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    margin: 0,
                    padding: 4,
                    listStyle: 'none',
                    minWidth: 220,
                    background: 'var(--forge-canvas-3)',
                    border: '1px solid var(--forge-rail-edge)',
                    borderRadius: 'var(--forge-radius)',
                    boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
                    zIndex: 1200,
                  }}>
                {spec.items.map((it, i) => it.divider ? (
                  <li key={`sep-${i}`} role="separator"
                      style={{
                        height: 1,
                        background: 'var(--forge-rail-edge)',
                        margin: '4px 6px',
                      }} />
                ) : (
                  <li key={it.id} role="menuitem">
                    <button type="button"
                            onClick={() => { onAction?.(it.id); setOpenId(null); }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              width: '100%',
                              gap: 10,
                              padding: '5px 10px',
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--forge-ink)',
                              font: 'inherit', fontSize: 12,
                              textAlign: 'left',
                              cursor: 'pointer',
                              borderRadius: 3,
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--forge-surface)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                      <span style={{
                        width: 16, height: 16,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        color: 'var(--forge-ink-2)',
                      }}>
                        {it.icon ? <Icon name={it.icon} size={14} /> : null}
                      </span>
                      <span style={{ flex: 1 }}>{it.label}</span>
                      {it.shortcut && (
                        <span style={{
                          fontFamily: 'var(--forge-mono)',
                          fontSize: 10,
                          color: 'var(--forge-ink-mute)',
                        }}>{it.shortcut}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
