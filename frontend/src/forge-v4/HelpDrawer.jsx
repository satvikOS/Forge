// Forge-74 — Help drawer.
//
// Right-slide panel (F1 toggles). Surfaces tool-specific docs based on
// what's active, plus a search-able list of every cmd/shortcut. Sections:
// Quick Start · Active Tool · Workbench · Shortcuts · About.

import React, { useEffect, useState } from 'react';
import { Icon } from './icons/Icon.jsx';
import { MENU_SPEC, MENU_KEYS } from './Menus.jsx';
import { schemaFor } from './toolSchemas.js';

const TOOL_DOCS = {
  'solid.extrude':  {
    blurb: 'Pull a 2D sketch into a 3D solid along a direction.',
    steps: [
      'Open the sketch you want to extrude (or pick a face).',
      'Set Distance — how far to extrude.',
      'Pick Direction (Up / Down / Both sides / Mid-plane).',
      'Pick Operation (New body / Add / Cut / Intersect).',
      'Optional: draft angle for tapered extrusions; thin feature for shells.',
      'Confirm to apply.',
    ],
    seeAlso: ['solid.revolve', 'solid.sweep', 'solid.loft'],
  },
  'solid.fillet': {
    blurb: 'Round one or more edges with a constant or variable radius.',
    steps: [
      'Pick the edges to fillet.',
      'Set the Radius (mm).',
      'Optional: toggle Variable for taper.',
      'Confirm.',
    ],
    seeAlso: ['solid.chamfer'],
  },
  'solid.hole': {
    blurb: 'Hole Wizard — Simple / Counterbore / Countersink / Tapped / Pipe Tap.',
    steps: [
      'Pick the position (a sketch point or face).',
      'Pick Hole Type.',
      'Set Diameter + Depth.',
      'Pick End Condition (Blind / Through / Up-to-surface / Up-to-next).',
      'Confirm.',
    ],
  },
  'sketch.new': {
    blurb: 'Open a 2D sketch on a plane or face.',
    steps: [
      'Pick a plane (XY / YZ / XZ) or top face of a body.',
      'Sketch primitives appear in the toolbar.',
      'Finish the sketch (Esc) to exit and unlock 3D ops.',
    ],
    seeAlso: ['sketch.finish', 'sketch.line', 'sketch.rect'],
  },
  'bool.cut': {
    blurb: 'Subtract one body from another. The tool body is consumed.',
    steps: [
      'Pick Target body.',
      'Pick Cut-with body.',
      'Confirm.',
    ],
    seeAlso: ['bool.union', 'bool.common'],
  },
};

const QUICK_START = [
  'Press ⌘K to focus the natural-language command bar and tell Archie what to build.',
  'Switch workbench from the left rail (Part / Draft / Sheet / Weld / Mold / Sim / Mfg).',
  'Click any tool icon — if it has parameters a left dock will open; confirm with ⌘↵.',
  'Right-click in the viewport for selection-aware actions.',
  'Press 1–7 for named views, Cmd+D to cycle display state, Cmd+T to flip theme.',
  'Drag features in the tree to reorder; double-click to rename.',
];

export function HelpDrawer({ open, onClose, activeTool, activeWb }) {
  const [tab, setTab] = useState('quick');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (open && activeTool) setTab('tool');
  }, [open, activeTool]);

  if (!open) return null;
  return (
    <aside className="forge-help"
           role="region"
           aria-label="Help"
           data-testid="forge-help">
      <header className="forge-help-header">
        <Icon name="menu.help" size={14} />
        <span>Help</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                       color: 'var(--forge-ink-mute)' }}>F1</span>
        <button type="button" onClick={onClose} aria-label="Close help"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute)', cursor: 'pointer',
                  display: 'inline-flex', padding: 2,
                }}>
          <Icon name="select.clear" size={12} />
        </button>
      </header>
      <nav className="forge-help-tabs" role="tablist">
        {[
          { id: 'quick', label: 'Quick Start' },
          { id: 'tool',  label: 'Active Tool' },
          { id: 'shortcuts', label: 'Shortcuts' },
          { id: 'about', label: 'About' },
        ].map((t) => (
          <button key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className="forge-help-tab"
                  data-help-tab={t.id}
                  data-active={String(tab === t.id)}
                  onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="forge-help-body">
        {tab === 'quick' && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0,
                       display: 'flex', flexDirection: 'column', gap: 10 }}>
            {QUICK_START.map((s, i) => (
              <li key={i} style={{ display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--forge-accent)', fontWeight: 600,
                               minWidth: 18 }}>{i + 1}.</span>
                <span style={{ color: 'var(--forge-ink)' }}>{s}</span>
              </li>
            ))}
          </ul>
        )}
        {tab === 'tool' && (
          <ToolDocPanel toolId={activeTool} />
        )}
        {tab === 'shortcuts' && (
          <>
            <input type="text" placeholder="Filter shortcuts…"
                   value={filter}
                   onChange={(e) => setFilter(e.target.value)}
                   className="forge-tool-input"
                   style={{ width: '100%', marginBottom: 8 }} />
            <ShortcutList filter={filter} />
          </>
        )}
        {tab === 'about' && <AboutPanel />}
      </div>
    </aside>
  );
}

function ToolDocPanel({ toolId }) {
  if (!toolId) {
    return (
      <div style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic' }}>
        No tool active. Click a toolbar icon to see its documentation here.
      </div>
    );
  }
  const schema = schemaFor(toolId);
  const docs = TOOL_DOCS[toolId];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ margin: 0, fontSize: 14, color: 'var(--forge-ink)' }}>
        {schema?.title || toolId}
      </h3>
      {docs?.blurb && (
        <p style={{ margin: 0, color: 'var(--forge-ink-2)', lineHeight: 1.5 }}>
          {docs.blurb}
        </p>
      )}
      {docs?.steps && (
        <ol style={{ paddingLeft: 18, color: 'var(--forge-ink-2)',
                     lineHeight: 1.6, margin: 0 }}>
          {docs.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      )}
      {schema?.fields?.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <h4 style={{ margin: '0 0 6px', fontSize: 11,
                       textTransform: 'uppercase', letterSpacing: '0.06em',
                       color: 'var(--forge-ink-mute)' }}>Parameters</h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0,
                       display: 'flex', flexDirection: 'column', gap: 4 }}>
            {schema.fields.map((f) => (
              <li key={f.id} style={{ fontFamily: 'var(--forge-mono)',
                                      fontSize: 11,
                                      color: 'var(--forge-ink-2)' }}>
                <strong style={{ color: 'var(--forge-ink)' }}>{f.label}</strong>
                {' '}({f.type}{f.unit ? `, ${f.unit}` : ''})
              </li>
            ))}
          </ul>
        </div>
      )}
      {docs?.seeAlso && (
        <div>
          <h4 style={{ margin: '0 0 6px', fontSize: 11,
                       textTransform: 'uppercase', letterSpacing: '0.06em',
                       color: 'var(--forge-ink-mute)' }}>See also</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {docs.seeAlso.map((id) => (
              <span key={id} style={{
                fontSize: 11, fontFamily: 'var(--forge-mono)',
                color: 'var(--forge-ink-2)',
                background: 'var(--forge-surface)',
                border: '1px solid var(--forge-rail-edge)',
                padding: '2px 6px', borderRadius: 3,
              }}>{id}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ShortcutList({ filter }) {
  // Pull every shortcut from MENU_SPEC plus the global v4 ones.
  const all = [
    ...MENU_KEYS.flatMap((k) => MENU_SPEC[k].items
      .filter((it) => !it.divider && it.shortcut)
      .map((it) => ({ id: it.id, label: it.label, shortcut: it.shortcut }))),
    { id: 'cmd.k',  label: 'Focus command bar',       shortcut: '⌘K' },
    { id: 'cmd.t',  label: 'Cycle theme',             shortcut: '⌘T' },
    { id: 'cmd.d',  label: 'Cycle display state',     shortcut: '⌘D' },
    { id: 'cmd.slash', label: 'Toggle Archie dock',   shortcut: '⌘/' },
    { id: 'esc',    label: 'Clear active verb',       shortcut: 'Esc' },
    { id: 'view.1', label: 'View · Iso',              shortcut: '1' },
    { id: 'view.2', label: 'View · Front',            shortcut: '2' },
    { id: 'view.3', label: 'View · Back',             shortcut: '3' },
    { id: 'view.4', label: 'View · Top',              shortcut: '4' },
    { id: 'view.5', label: 'View · Bottom',           shortcut: '5' },
    { id: 'view.6', label: 'View · Right',            shortcut: '6' },
    { id: 'view.7', label: 'View · Left',             shortcut: '7' },
    { id: 'help',   label: 'Toggle help drawer',      shortcut: 'F1' },
  ];
  const f = filter.toLowerCase();
  const filtered = all.filter((s) =>
    !f || s.label.toLowerCase().includes(f) || s.shortcut.toLowerCase().includes(f));
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0,
                 display: 'flex', flexDirection: 'column', gap: 4 }}>
      {filtered.map((s) => (
        <li key={s.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '4px 8px',
              borderRadius: 3,
              background: 'var(--forge-surface)',
            }}>
          <span style={{ flex: 1, fontSize: 11 }}>{s.label}</span>
          <kbd style={{
            fontFamily: 'var(--forge-mono)', fontSize: 10,
            background: 'var(--forge-canvas)', padding: '2px 6px',
            borderRadius: 3, border: '1px solid var(--forge-rail-edge)',
            color: 'var(--forge-ink-2)',
          }}>{s.shortcut}</kbd>
        </li>
      ))}
    </ul>
  );
}

function AboutPanel() {
  return (
    <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--forge-ink-2)' }}>
      <p style={{ marginBottom: 8 }}>
        <strong style={{ color: 'var(--forge-ink)' }}>Forge</strong> v0.4.0 — Archie-first
        parametric MCAD on OCCT 7.9.3.
      </p>
      <p style={{ marginBottom: 8 }}>
        Custom visual IP: anvil-spark logo · monochrome OLED-black /
        off-white themes · 60+ custom-designed 1.5 px outlined icons · 5-zone
        CSS grid shell — no infringement on CATIA / NX / SolidWorks / Creo /
        AutoCAD.
      </p>
      <p style={{ marginBottom: 8 }}>
        Built by satvikOS. Powered by OCCT (LGPL) · planegcs (LGPL) ·
        Electron · React · three.js · @react-three/fiber.
      </p>
      <p style={{ fontSize: 11, color: 'var(--forge-ink-mute)', marginTop: 12 }}>
        Press F1 to toggle this drawer from any context.
      </p>
    </div>
  );
}
