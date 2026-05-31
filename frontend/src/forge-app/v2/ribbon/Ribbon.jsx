/**
 * Ribbon v2 — workbench tabs + grouped command buttons.
 *
 * Industry conventions, Forge IP. Two rows: a slim tab strip on top,
 * grouped command buttons in the body. Each group titles itself at the
 * bottom in small caps; an optional expander (↘) at the bottom-right
 * opens the matching panel/dialog. Buttons have icon + label + hover
 * tooltip with shortcut.
 */

import React, { useState } from 'react';
import { Icon } from '../../design-system/icons/Icon.jsx';
import { Tooltip } from '../../design-system/primitives/Modal.jsx';
import { KeyHint } from '../../design-system/primitives/KeyHint.jsx';

const TABS = [
  { id: 'sketch',      label: 'Sketch',      icon: 'sketchTab' },
  { id: 'part',        label: 'Part',        icon: 'partTab' },
  { id: 'surfaces',    label: 'Surfaces',    icon: 'surfacesTab' },
  { id: 'sheetmetal',  label: 'Sheet Metal', icon: 'sheetMetalTab' },
  { id: 'weldments',   label: 'Weldments',   icon: 'weldmentsTab' },
  { id: 'assembly',    label: 'Assembly',    icon: 'assemblyTab' },
  { id: 'drawing',     label: 'Drawing',     icon: 'drawingTab' },
  { id: 'simulate',    label: 'Simulate',    icon: 'simulateTab' },
  { id: 'manufacture', label: 'Manufacture', icon: 'manufactureTab' },
];

// Command catalog per tab. Each entry: {id, label, icon, shortcut?, size?}.
// Size: 'lg' (large stacked) | 'sm' (compact horizontal). Default 'sm'.
const TAB_GROUPS = {
  sketch: [
    { title: 'Sketch', cmds: [
      { id: 'sketch.new',  label: 'New Sketch',  icon: 'sketchTab', size: 'lg', shortcut: 'S' },
      { id: 'sketch.exit', label: 'Exit Sketch', icon: 'check' },
    ]},
    { title: 'Entities', cmds: [
      { id: 'sketch.line',    label: 'Line',     icon: 'partTab',    shortcut: 'L' },
      { id: 'sketch.rect',    label: 'Rectangle',icon: 'box' },
      { id: 'sketch.circle',  label: 'Circle',   icon: 'sphere',     shortcut: 'C' },
      { id: 'sketch.arc',     label: 'Arc',      icon: 'revolve' },
      { id: 'sketch.poly',    label: 'Polygon',  icon: 'patternCircular' },
      { id: 'sketch.spline',  label: 'Spline',   icon: 'sweep' },
    ]},
    { title: 'Modify', cmds: [
      { id: 'sketch.trim',    label: 'Trim',     icon: 'cut' },
      { id: 'sketch.extend',  label: 'Extend',   icon: 'expand' },
      { id: 'sketch.offset',  label: 'Offset',   icon: 'shell' },
      { id: 'sketch.mirror',  label: 'Mirror',   icon: 'mirror' },
    ]},
    { title: 'Constraint', cmds: [
      { id: 'sketch.coincident',    label: 'Coincident',    icon: 'check' },
      { id: 'sketch.parallel',      label: 'Parallel',      icon: 'divider' },
      { id: 'sketch.perpendicular', label: 'Perp',          icon: 'plus' },
      { id: 'sketch.tangent',       label: 'Tangent',       icon: 'arc' },
      { id: 'sketch.equal',         label: 'Equal',         icon: 'divider' },
    ]},
    { title: 'Dimension', cmds: [
      { id: 'sketch.dim.smart',   label: 'Smart Dim',  icon: 'drawingTab', size: 'lg', shortcut: 'D' },
      { id: 'sketch.dim.linear',  label: 'Linear',     icon: 'partTab' },
      { id: 'sketch.dim.radial',  label: 'Radial',     icon: 'sphere' },
      { id: 'sketch.dim.angular', label: 'Angular',    icon: 'revolve' },
    ]},
  ],
  part: [
    { title: 'Primitives', cmds: [
      { id: 'part.box',      label: 'Box',      icon: 'box',      size: 'lg' },
      { id: 'part.cylinder', label: 'Cylinder', icon: 'cylinder' },
      { id: 'part.sphere',   label: 'Sphere',   icon: 'sphere' },
      { id: 'part.cone',     label: 'Cone',     icon: 'cone' },
      { id: 'part.torus',    label: 'Torus',    icon: 'torus' },
    ]},
    { title: 'Sketch-Driven', cmds: [
      { id: 'part.extrude', label: 'Extrude',  icon: 'extrude',  size: 'lg', shortcut: 'E' },
      { id: 'part.revolve', label: 'Revolve',  icon: 'revolve' },
      { id: 'part.sweep',   label: 'Sweep',    icon: 'sweep' },
      { id: 'part.loft',    label: 'Loft',     icon: 'loft' },
      { id: 'part.rib',     label: 'Rib',      icon: 'rib' },
    ]},
    { title: 'Modify', cmds: [
      { id: 'part.shell',   label: 'Shell',    icon: 'shell' },
      { id: 'part.fillet',  label: 'Fillet',   icon: 'fillet',   size: 'lg', shortcut: 'F' },
      { id: 'part.chamfer', label: 'Chamfer',  icon: 'chamfer' },
      { id: 'part.draft',   label: 'Draft',    icon: 'draft' },
      { id: 'part.hole',    label: 'Hole',     icon: 'hole' },
    ]},
    { title: 'Boolean', cmds: [
      { id: 'part.fuse',   label: 'Combine',   icon: 'combine' },
      { id: 'part.cut',    label: 'Subtract',  icon: 'subtract' },
      { id: 'part.common', label: 'Intersect', icon: 'intersect' },
    ]},
    { title: 'Pattern', cmds: [
      { id: 'part.pat.lin', label: 'Linear',   icon: 'patternLinear' },
      { id: 'part.pat.cir', label: 'Circular', icon: 'patternCircular' },
      { id: 'part.pat.mir', label: 'Mirror',   icon: 'mirror' },
    ]},
    { title: 'Direct', cmds: [
      { id: 'part.pushpull', label: 'Push/Pull', icon: 'expand' },
      { id: 'part.movef',    label: 'Move Face', icon: 'drag' },
      { id: 'part.delf',     label: 'Delete Face', icon: 'delete' },
    ]},
  ],
  surfaces: [
    { title: 'Build', cmds: [
      { id: 'surf.patch',  label: 'Patch', icon: 'surfacesTab', size: 'lg' },
      { id: 'surf.sweep',  label: 'Swept', icon: 'sweep' },
      { id: 'surf.loft',   label: 'Lofted',icon: 'loft' },
    ]},
    { title: 'Modify', cmds: [
      { id: 'surf.trim',   label: 'Trim',   icon: 'cut' },
      { id: 'surf.sew',    label: 'Sew',    icon: 'combine' },
      { id: 'surf.refine', label: 'Refine', icon: 'plus' },
    ]},
    { title: 'Analyse', cmds: [
      { id: 'surf.eval',  label: 'Eval',         icon: 'eye' },
      { id: 'surf.classA', label: 'Class-A Analyse', icon: 'fileExport' },
    ]},
  ],
  sheetmetal: [
    { title: 'Flanges', cmds: [
      { id: 'sm.base',   label: 'Base Flange',  icon: 'sheetMetalTab', size: 'lg' },
      { id: 'sm.edge',   label: 'Edge Flange',  icon: 'sheetMetalTab' },
      { id: 'sm.miter',  label: 'Miter Flange', icon: 'sheetMetalTab' },
    ]},
    { title: 'Bends', cmds: [
      { id: 'sm.hem',  label: 'Hem',          icon: 'fillet' },
      { id: 'sm.bend', label: 'Sketched Bend',icon: 'revolve' },
      { id: 'sm.jog',  label: 'Jog',          icon: 'extrude' },
    ]},
    { title: 'Output', cmds: [
      { id: 'sm.unfold',  label: 'Unfold',       icon: 'expand', size: 'lg' },
      { id: 'sm.flatpat', label: 'Flat Pattern', icon: 'fileExport' },
    ]},
  ],
  weldments: [
    { title: 'Structural', cmds: [
      { id: 'weld.member', label: 'Structural Member', icon: 'weldmentsTab', size: 'lg' },
      { id: 'weld.cap',    label: 'End Cap',           icon: 'weldmentsTab' },
      { id: 'weld.gusset', label: 'Gusset',            icon: 'weldmentsTab' },
    ]},
    { title: 'Joint', cmds: [
      { id: 'weld.trim', label: 'Trim/Extend',    icon: 'cut' },
      { id: 'weld.bead', label: 'Fillet Bead',    icon: 'fillet' },
    ]},
    { title: 'Output', cmds: [
      { id: 'weld.cutlist', label: 'Cut List', icon: 'fileExport', size: 'lg' },
    ]},
  ],
  assembly: [
    { title: 'Components', cmds: [
      { id: 'asm.insert',  label: 'Insert Component', icon: 'insertComponent', size: 'lg' },
      { id: 'asm.replace', label: 'Replace',          icon: 'mirror' },
    ]},
    { title: 'Mate', cmds: [
      { id: 'asm.mate',     label: 'Mate',     icon: 'mate', size: 'lg', shortcut: 'M' },
      { id: 'asm.fix',      label: 'Set Fixed',icon: 'lock' },
      { id: 'asm.solve',    label: 'Solve',    icon: 'play' },
    ]},
    { title: 'Inspect', cmds: [
      { id: 'asm.explode',     label: 'Exploded',     icon: 'exploded', size: 'lg' },
      { id: 'asm.interference',label: 'Interference', icon: 'warning' },
      { id: 'asm.motion',      label: 'Motion Study', icon: 'play' },
    ]},
  ],
  drawing: [
    { title: 'New', cmds: [
      { id: 'dwg.new',  label: 'New Drawing',  icon: 'drawingTab', size: 'lg' },
      { id: 'dwg.view', label: 'View From Part', icon: 'eye' },
    ]},
    { title: 'View', cmds: [
      { id: 'dwg.section',  label: 'Section',  icon: 'cut', size: 'lg' },
      { id: 'dwg.detail',   label: 'Detail',   icon: 'frame' },
      { id: 'dwg.broken',   label: 'Broken',   icon: 'divider' },
    ]},
    { title: 'Annotate', cmds: [
      { id: 'dwg.dim',     label: 'Dimension', icon: 'drawingTab', size: 'lg', shortcut: 'D' },
      { id: 'dwg.balloon', label: 'Balloon',   icon: 'sphere' },
      { id: 'dwg.title',   label: 'Title Block', icon: 'fileSave' },
    ]},
  ],
  simulate: [
    { title: 'Mesh', cmds: [
      { id: 'sim.mesh', label: 'Mesh', icon: 'patternCircular', size: 'lg' },
    ]},
    { title: 'Static + Modal', cmds: [
      { id: 'sim.static',  label: 'Static',  icon: 'simulateTab', size: 'lg' },
      { id: 'sim.modal',   label: 'Modal',   icon: 'simulateTab' },
      { id: 'sim.buckle',  label: 'Buckling',icon: 'simulateTab' },
    ]},
    { title: 'Transient', cmds: [
      { id: 'sim.dynamic', label: 'Dynamic',  icon: 'play' },
      { id: 'sim.thermal', label: 'Thermal',  icon: 'sun' },
      { id: 'sim.cfd',     label: 'CFD',      icon: 'sweep' },
    ]},
    { title: 'Material', cmds: [
      { id: 'sim.nonlinear', label: 'Nonlinear', icon: 'fillet' },
      { id: 'sim.contact',   label: 'Contact',   icon: 'mate' },
      { id: 'sim.plastic',   label: 'Plasticity',icon: 'shell' },
      { id: 'sim.fatigue',   label: 'Fatigue',   icon: 'warning' },
    ]},
    { title: 'Playback', cmds: [
      { id: 'sim.player', label: 'Motion Player', icon: 'play', size: 'lg' },
    ]},
  ],
  manufacture: [
    { title: '2.5D', cmds: [
      { id: 'mfg.profile', label: 'Profile',   icon: 'frame', size: 'lg' },
      { id: 'mfg.pocket',  label: 'Pocket',    icon: 'shell' },
      { id: 'mfg.drill',   label: 'Drill',     icon: 'hole' },
      { id: 'mfg.face',    label: 'Face Mill', icon: 'manufactureTab' },
    ]},
    { title: 'Advanced', cmds: [
      { id: 'mfg.adaptive', label: 'Adaptive', icon: 'sweep', size: 'lg' },
      { id: 'mfg.5axis',    label: '5-Axis',   icon: 'patternCircular' },
      { id: 'mfg.stock',    label: 'Stock Sim',icon: 'box' },
      { id: 'mfg.cmm',      label: 'CMM',      icon: 'frame' },
    ]},
    { title: 'Post', cmds: [
      { id: 'mfg.gcode', label: 'Post G-code', icon: 'fileExport', size: 'lg' },
    ]},
  ],
};

const RIBBON_TAB_KEY = 'forge.ribbon.activeTab';

export function Ribbon({ onInvoke, density = 'comfortable' }) {
  const [active, setActive] = useState(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem(RIBBON_TAB_KEY)) || 'part');

  const setTab = (id) => {
    setActive(id);
    if (typeof localStorage !== 'undefined') localStorage.setItem(RIBBON_TAB_KEY, id);
  };

  const groups = TAB_GROUPS[active] || [];

  return (
    <div className="forge-ribbon" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Tab strip */}
      <div role="tablist" aria-label="Workbench tabs"
        style={{
          display: 'flex',
          padding: '0 var(--space-7)',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--surface-panel)',
        }}>
        {TABS.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)',
                padding: 'var(--space-4) var(--space-7)',
                background: 'transparent',
                color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-medium)',
                border: 'none',
                borderBottom: selected ? '2px solid var(--accent-bg)' : '2px solid transparent',
                marginBottom: -1,
                cursor: 'pointer',
                transition: 'color var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out)',
              }}
            >
              <Icon name={t.icon} size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Group strip */}
      <div role="tabpanel" id={`ribbon-${active}`} style={{
        display: 'flex',
        alignItems: 'stretch',
        padding: 'var(--space-5) var(--space-6)',
        gap: 0,
        overflowX: 'auto',
        height: density === 'compact' ? 78 : 100,
      }}>
        {groups.map((g, gi) => (
          <Group key={g.title || gi} group={g} onInvoke={onInvoke} density={density} />
        ))}
        {groups.length === 0 && (
          <div style={{ color: 'var(--text-tertiary)', padding: 'var(--space-7)' }}>
            No commands wired for <strong>{active}</strong> yet.
          </div>
        )}
      </div>
    </div>
  );
}

function Group({ group, onInvoke, density }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      borderRight: '1px solid var(--border-subtle)',
      padding: '0 var(--space-6)',
      minWidth: 'fit-content',
    }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        {group.cmds.map((c) => (
          <RibbonButton key={c.id} cmd={c} onInvoke={onInvoke} density={density} />
        ))}
      </div>
      {group.title && (
        <div style={{
          marginTop: 'var(--space-3)',
          textAlign: 'center',
          fontSize: 'var(--text-2xs)',
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>{group.title}</div>
      )}
    </div>
  );
}

function RibbonButton({ cmd, onInvoke, density }) {
  const large = cmd.size === 'lg' && density !== 'compact';
  return (
    <Tooltip
      content={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-5)' }}>
          <span>{cmd.label}</span>
          {cmd.shortcut && <KeyHint keys={cmd.shortcut} />}
        </span>
      }
    >
      <button
        type="button"
        onClick={() => onInvoke?.(cmd.id, cmd)}
        style={{
          display: 'inline-flex',
          flexDirection: large ? 'column' : 'row',
          alignItems: 'center',
          gap: large ? 'var(--space-3)' : 'var(--space-3)',
          padding: large ? 'var(--space-3) var(--space-5)' : 'var(--space-3) var(--space-5)',
          background: 'transparent',
          color: 'var(--text-secondary)',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          fontSize: large ? 'var(--text-2xs)' : 'var(--text-xs)',
          cursor: 'pointer',
          minWidth: large ? 56 : undefined,
          transition: 'background var(--motion-fast), color var(--motion-fast)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
      >
        <Icon name={cmd.icon} size={large ? 22 : 14} />
        <span style={{ whiteSpace: 'nowrap', textAlign: large ? 'center' : 'left' }}>{cmd.label}</span>
      </button>
    </Tooltip>
  );
}
