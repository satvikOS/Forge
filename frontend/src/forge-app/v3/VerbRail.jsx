// Forge v3 — verb rail. Selection-contextual left rail of 8-12 verbs.
//
// Industry MCAD has 60-100+ buttons in a ribbon. Forge has 8-12 verbs
// at any moment, and they CHANGE based on what's selected. This is
// the discoverability win: the rail is short enough to scan in one
// glance, and never shows you a "Fillet" button when nothing is
// selected.

import React from 'react';

// Verb catalogue keyed by selection kind. Each verb has:
//   id      — stable string, used for hotkeys + analytics
//   label   — short verb (1-2 words)
//   icon    — single glyph (we're not pulling in the v2 icon set yet;
//             the IP is the rail itself, not the iconography)
//   hint    — tooltip + cmdbar hint
//   group   — visual divider grouping
const VERBS = {
  none: [
    { id: 'create.sketch',  label: 'Sketch',  icon: '✎', group: 'create', hint: 'New sketch' },
    { id: 'create.box',     label: 'Box',     icon: '▣', group: 'create', hint: 'Primitive box' },
    { id: 'create.cyl',     label: 'Cyl',     icon: '◯', group: 'create', hint: 'Primitive cylinder' },
    { id: 'import',         label: 'Import',  icon: '⤓', group: 'create', hint: 'Import STEP / IGES / BREP' },
    { id: 'measure',        label: 'Measure', icon: '⟶', group: 'inspect', hint: 'Measure' },
  ],
  face: [
    { id: 'modify.push',    label: 'Push',    icon: '⇲', group: 'modify', hint: 'Push / pull face' },
    { id: 'modify.fillet',  label: 'Fillet',  icon: '⌒', group: 'modify', hint: 'Round face edges' },
    { id: 'modify.chamfer', label: 'Chamfer', icon: '⟋', group: 'modify', hint: 'Chamfer face edges' },
    { id: 'modify.shell',   label: 'Shell',   icon: '◳', group: 'modify', hint: 'Hollow / shell from face' },
    { id: 'modify.delete',  label: 'Delete',  icon: '⌫', group: 'modify', hint: 'Delete and heal' },
    { id: 'pattern',        label: 'Pattern', icon: '⠿', group: 'pattern', hint: 'Linear / circular pattern' },
    { id: 'constrain',      label: 'Constrain', icon: '⚓', group: 'pattern', hint: 'Constrain face' },
    { id: 'measure',        label: 'Measure', icon: '⟶', group: 'inspect', hint: 'Measure face area / position' },
  ],
  edge: [
    { id: 'modify.fillet',  label: 'Fillet',  icon: '⌒', group: 'modify', hint: 'Fillet edges' },
    { id: 'modify.chamfer', label: 'Chamfer', icon: '⟋', group: 'modify', hint: 'Chamfer edges' },
    { id: 'dimension',      label: 'Dim',     icon: '↔', group: 'annotate', hint: 'Dimension' },
    { id: 'measure',        label: 'Measure', icon: '⟶', group: 'inspect', hint: 'Edge length' },
  ],
  body: [
    { id: 'modify.move',    label: 'Move',    icon: '✥', group: 'transform', hint: 'Translate' },
    { id: 'modify.rotate',  label: 'Rotate',  icon: '↻', group: 'transform', hint: 'Rotate' },
    { id: 'modify.scale',   label: 'Scale',   icon: '⇲', group: 'transform', hint: 'Scale' },
    { id: 'bool.cut',       label: 'Cut',     icon: '−', group: 'boolean', hint: 'Boolean cut' },
    { id: 'bool.fuse',      label: 'Fuse',    icon: '+', group: 'boolean', hint: 'Boolean fuse' },
    { id: 'bool.section',   label: 'Section', icon: '⊥', group: 'boolean', hint: 'Boolean section' },
    { id: 'pattern',        label: 'Pattern', icon: '⠿', group: 'pattern', hint: 'Pattern body' },
    { id: 'mirror',         label: 'Mirror',  icon: '⫶', group: 'pattern', hint: 'Mirror body' },
  ],
};

export function verbsFor(selectionKind) {
  return VERBS[selectionKind] || VERBS.none;
}

export function VerbRail({ selection, activeVerb, onVerb }) {
  const verbs = verbsFor(selection?.kind || 'none');
  // Insert dividers between group changes for visual rhythm.
  const items = [];
  let lastGroup = null;
  for (const v of verbs) {
    if (lastGroup !== null && v.group !== lastGroup) {
      items.push({ kind: 'divider', key: `div-${items.length}` });
    }
    items.push({ kind: 'verb', verb: v, key: v.id });
    lastGroup = v.group;
  }

  return (
    <nav className="forge-v3-verbs"
         aria-label="Forge verbs"
         data-testid="forge-v3-verbs">
      {items.map((it) => it.kind === 'divider' ? (
        <span key={it.key} className="forge-v3-verb-divider" aria-hidden="true" />
      ) : (
        <button
          key={it.key}
          type="button"
          className="forge-v3-verb"
          data-verb={it.verb.id}
          data-active={String(activeVerb === it.verb.id)}
          title={`${it.verb.label} — ${it.verb.hint}`}
          aria-label={it.verb.label}
          aria-pressed={activeVerb === it.verb.id}
          onClick={() => onVerb(it.verb.id)}
        >
          <span aria-hidden="true">{it.verb.icon}</span>
        </button>
      ))}
    </nav>
  );
}
