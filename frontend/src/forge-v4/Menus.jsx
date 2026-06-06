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
      { id: 'file.openProject',   label: 'Open Project (.forge)…', icon: 'file.open' },
      { id: 'file.saveProject',   label: 'Save Project (.forge)…', icon: 'file.save' },
      { id: 'file.exportBundle',  label: 'Export Project Bundle (.zip)…', icon: 'io.brep' },
      { id: 'file.exportIfc',     label: 'Export IFC4 (.ifc)…', icon: 'io.step' },
      { id: 'file.exportAp242',   label: 'Export AP242 STEP + PMI (.step)…', icon: 'io.step' },
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
      // Forge-139 — universal command palette (Cmd+K alias).
      { id: 'tools.commandPalette', label: 'Command Palette…', icon: 'misc.search', shortcut: '⌘K' },
      // Forge-135 — path-traced offline render.
      { id: 'tools.pathTracer', label: 'Render Room…',       icon: 'view.shaded' },
      // Forge-137 — role + ribbon customiser.
      { id: 'tools.ribbon',     label: 'Customise Ribbons…', icon: 'misc.settings' },
      SEP,
      { id: 'tools.library',   label: 'Standard Parts Library…', icon: 'misc.search' },
      // Forge-204 — parametric ISO/ANSI catalogue (bolt/nut/washer/bearing/gear).
      { id: 'tools.stdparts',  label: 'Standard Parts (parametric)…', icon: 'misc.search' },
      // Forge-154 — engineering material catalogue picker (200+ alloys).
      { id: 'tools.materials', label: 'Material Library…',  icon: 'misc.search' },
      // Forge-158 — AIS-style subshape pick mode rotator.
      { id: 'tools.selectionMode', label: 'Selection Mode (Body / Face / Edge / Vertex)', icon: 'select.body' },
      { id: 'tools.equations', label: 'Equation Manager…', icon: 'measure.distance', shortcut: '⌘E' },
      { id: 'tools.spreadsheet', label: 'Spreadsheet…',     icon: 'archie.formula' },
      // Forge-160 — OpenSCAD-style CSG scripting workbench.
      { id: 'tools.csg',         label: 'CSG Scripting…',   icon: 'archie.formula' },
      { id: 'tools.topology',  label: 'Topology Inspector…', icon: 'select.body', shortcut: '⌘I' },
      // PUSH-15/49 — SIMP topology optimisation (density field → materialised solid).
      { id: 'tools.topoOpt',   label: 'Topology Optimisation (SIMP)…', icon: 'wb.sim' },
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
      // PUSH-42 — HLR engineering drawings (projected 2D views from the model).
      { id: 'tools.drawingsHlr', label: 'Drawings (HLR)…',   icon: 'wb.drawing' },
      // PUSH-45 — A* pipe routing (route centerline → 3D pipe solid).
      { id: 'tools.piperoute',  label: 'Pipe Routing…',      icon: 'solid.sweep' },
      // Forge-166 — ISO / UNC / UNF / NPT thread cutter.
      { id: 'tools.threads',    label: 'Thread Designer…',  icon: 'sketch.spline' },
      // Forge-149 — Draft workbench (FreeCAD Draft parity).
      { id: 'tools.draft',      label: 'Draft (2D)…',       icon: 'sketch.line' },
      SEP,
      { id: 'tools.demoProject',  label: 'Build sample bracket…', icon: 'archie.spark' },
      { id: 'tools.ship',          label: 'Ship · naval architecture…', icon: 'wb.mfg' },
      { id: 'tools.generative',    label: 'Generative Design…', icon: 'wb.sim' },
      { id: 'tools.bom',          label: 'Bill of Materials…',   icon: 'measure.mass' },
      { id: 'tools.pdm',          label: 'Product Data Management…', icon: 'misc.settings' },
      // PUSH-14/51 — real JSON-backed PDM vault (check-in/out, revisions, ECN).
      { id: 'tools.pdmvault',     label: 'PDM Vault (check-in/out)…', icon: 'misc.settings' },
      { id: 'tools.configurations', label: 'Configurations…',    icon: 'misc.settings' },
      { id: 'tools.skeleton',     label: 'Master Skeleton…',     icon: 'sketch.line' },
      { id: 'tools.scenarios',    label: 'Scenario Runner…',     icon: 'wb.sim' },
      // Forge-91 — Simulation workbench (FEA static/modal/dynamic/thermal/
      // buckling/nonlinear/contact/plastic/fatigue + CFD).
      { id: 'tools.simulation',   label: 'Simulation (FEA / CFD)…', icon: 'wb.sim' },
      { id: 'tools.convergence',  label: 'FEA Convergence…',     icon: 'measure.distance' },
      { id: 'tools.weldments',    label: 'Weldments…',           icon: 'wb.weldments' },
      // Forge-151 — Mesh workbench (polygonal mesh tools).
      { id: 'tools.mesh',         label: 'Mesh…',                icon: 'select.body' },
      // Forge-165 — Lattice / metamaterial workbench (TPMS implicit
      // surfaces + strut truss topologies + Gibson-Ashby estimator).
      { id: 'tools.lattice',      label: 'Lattice / Metamaterial…', icon: 'select.body' },
      { id: 'tools.cam',          label: 'CAM (Manufacturing)…', icon: 'wb.mfg' },
      // Forge-163 — 3D-printing slicer (real Marlin G-code emitter).
      { id: 'tools.slicer',       label: 'Slicer (3D printing)…', icon: 'wb.mfg' },
      // Forge-152 — Industrial robot workbench (KUKA KR6, ABB IRB1200,
      // FANUC LR Mate). FK/IK with real DH tables + post-processors.
      { id: 'tools.robot',        label: 'Robot (6-axis)…',      icon: 'wb.robot' },
      // Forge-150 — Arch/BIM workbench (FreeCAD Arch parity).
      { id: 'tools.arch',         label: 'Arch / BIM…',          icon: 'wb.arch' },
      { id: 'tools.archSite',     label: 'Arch · Project tree…', icon: 'wb.drawing' },
      SEP,
      // Forge-167 — Spring designer (Wahl / Goodman / ASTM materials).
      { id: 'tools.spring',       label: 'Spring Designer…',     icon: 'sketch.spline' },
      // Forge-168 — Wiring harness designer (Catmull-Rom + bend radius).
      { id: 'tools.harness',      label: 'Wiring Harness…',      icon: 'sketch.spline' },
      // Forge-169 — Process P&ID schematic editor (ISA-5.1-2009).
      { id: 'tools.pid',          label: 'P&ID Schematic…',      icon: 'wb.mfg' },
      // Forge-161 — Reverse engineering (scan-to-CAD: PLY/PCD/XYZ/E57).
      { id: 'tools.reverse',      label: 'Reverse Engineering…', icon: 'select.body' },
      // Forge-162 — First Article Inspection (FAI) heatmap + AS9102 PDF.
      { id: 'tools.inspect',      label: 'Inspection / FAI…',    icon: 'measure.distance' },
      // Forge-185 — Tolerance stack-up (worst-case / RSS / Monte-Carlo Cp·Cpk).
      { id: 'tools.tolerance',    label: 'Tolerance Stack-up…',  icon: 'measure.distance' },
      SEP,
      { id: 'tools.explode',      label: 'Exploded view…',       icon: 'misc.expand_r' },
      { id: 'tools.walkthrough',  label: 'Walk-through…',        icon: 'archie.send' },
      { id: 'view.perfHud',       label: 'Performance HUD',      icon: 'misc.kbd', shortcut: '⌘⇧P' },
      { id: 'view.record',        label: 'Record viewport…',     icon: 'archie.spark' },
      SEP,
      // Forge-134 — Plugin Manager entry. Routed by ForgeShellV4 to
      // window.__forgeOpenPluginManager(true), which the
      // PluginManagerPanelHost subscribes once mounted from App.jsx.
      { id: 'tools.plugins',      label: 'Plugin Manager…',      icon: 'misc.settings' },
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

// Forge-134 — subscribe to plugin-contributed menu items so MenuBar
// re-renders when Forge.menu.addItem() / addMenu() fire. We read from
// window.Forge._internals so we don't introduce a circular import with
// forgeAPI.js (Menus.jsx is imported by it).
function usePluginMenuExtras() {
  const [snapshot, setSnapshot] = useState(() => ({
    extras: {},
    custom: [],
  }));
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const read = () => {
      const Forge = window.Forge;
      if (!Forge?._internals) return;
      setSnapshot({
        extras: Forge._internals.menuExtras(),
        custom: Forge._internals.customMenus(),
      });
    };
    read();
    const onExtras = () => read();
    const onApi = () => read();
    window.addEventListener('forge:menu-extras-changed', onExtras);
    window.addEventListener('forge:api-ready', onApi);
    window.addEventListener('forge:plugins-changed', onExtras);
    return () => {
      window.removeEventListener('forge:menu-extras-changed', onExtras);
      window.removeEventListener('forge:api-ready', onApi);
      window.removeEventListener('forge:plugins-changed', onExtras);
    };
  }, []);
  return snapshot;
}

export function MenuBar({ onAction }) {
  const [openId, setOpenId] = useState(null);
  const containerRef = useRef(null);
  const { extras, custom } = usePluginMenuExtras();

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

  // Resolve effective dropdown items per menu = built-in items + plugin
  // contributions (separated by a divider when both exist).
  function effectiveItems(menuId) {
    const builtIn = MENU_SPEC[menuId]?.items || [];
    const extra = extras[menuId] || [];
    if (!extra.length) return builtIn;
    return [...builtIn, SEP, ...extra.map((e) => ({
      id: `plugin:${menuId}:${e.id}`,
      label: e.label,
      icon: e.icon,
      _plugin: true,
      _menuId: menuId,
      _itemId: e.id,
    }))];
  }

  function dispatchItem(it) {
    if (it._plugin && typeof window !== 'undefined' && window.Forge) {
      // Route plugin menu items through Forge.menu.dispatch — the plugin
      // registered an action callback that fires here.
      window.Forge.menu.dispatch(it._menuId, it._itemId);
    } else {
      onAction?.(it.id);
    }
  }

  const customKeys = custom.map((m) => m.id);

  return (
    <nav ref={containerRef}
         className="forge-topbar-menus"
         aria-label="Application menu"
         data-testid="forge-menus">
      {[...MENU_KEYS, ...customKeys].map((id) => {
        const customSpec = custom.find((m) => m.id === id);
        const spec = customSpec || MENU_SPEC[id];
        if (!spec) return null;
        const isOpen = openId === id;
        const items = customSpec
          ? customSpec.items.map((e) => ({
              id: `plugin:${id}:${e.id}`,
              label: e.label,
              icon: e.icon,
              _plugin: true,
              _menuId: id,
              _itemId: e.id,
            }))
          : effectiveItems(id);
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
                {items.map((it, i) => it.divider ? (
                  <li key={`sep-${i}`} role="separator"
                      style={{
                        height: 1,
                        background: 'var(--forge-rail-edge)',
                        margin: '4px 6px',
                      }} />
                ) : (
                  <li key={it.id} role="menuitem">
                    <button type="button"
                            data-menu-item={it._plugin ? `${it._menuId}.${it._itemId}` : it.id}
                            data-plugin={it._plugin ? 'true' : 'false'}
                            onClick={() => { dispatchItem(it); setOpenId(null); }}
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
