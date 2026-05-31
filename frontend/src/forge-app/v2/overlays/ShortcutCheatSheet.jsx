/**
 * ShortcutCheatSheet — `?` key opens a modal listing every shortcut
 * grouped by category, with a fuzzy search. Industry convention from
 * GitHub, Linear, Notion etc. — pressing `?` from anywhere shows the
 * cheat sheet.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from '../../design-system/primitives/Modal.jsx';
import { Input } from '../../design-system/primitives/Input.jsx';
import { Stack, Inline, Divider } from '../../design-system/primitives/Card.jsx';
import { KeyHint } from '../../design-system/primitives/KeyHint.jsx';
import { Icon } from '../../design-system/icons/Icon.jsx';

const SHORTCUTS = [
  { group: 'Application', items: [
    ['Command palette',       'Cmd K'],
    ['New project',           'Cmd N'],
    ['Open project',          'Cmd O'],
    ['Save',                  'Cmd S'],
    ['Save As',               'Cmd Shift S'],
    ['Settings',              'Cmd ,'],
    ['Close tab',             'Cmd W'],
    ['Help / cheat sheet',    '?'],
  ]},
  { group: 'Edit', items: [
    ['Undo',                  'Cmd Z'],
    ['Redo',                  'Cmd Shift Z'],
    ['Cut',                   'Cmd X'],
    ['Copy',                  'Cmd C'],
    ['Paste',                 'Cmd V'],
    ['Delete',                'Delete'],
    ['Rename feature',        'F2'],
  ]},
  { group: 'View', items: [
    ['Frame all',             'F'],
    ['Front view',            'Ctrl 1'],
    ['Top view',              'Ctrl 2'],
    ['Right view',            'Ctrl 3'],
    ['Iso view',              'Ctrl 7'],
    ['Toggle section view',   'Shift Z'],
    ['Toggle wireframe',      'Shift W'],
    ['Hide selection',        'H'],
    ['Isolate',               'Shift H'],
  ]},
  { group: 'Sketch', items: [
    ['New sketch',            'S'],
    ['Line',                  'L'],
    ['Circle',                'C'],
    ['Rectangle',             'R'],
    ['Trim',                  'T'],
    ['Smart dimension',       'D'],
    ['Mirror',                'Cmd M'],
    ['Exit sketch',           'Esc'],
  ]},
  { group: 'Part', items: [
    ['Extrude',               'E'],
    ['Revolve',               'Shift E'],
    ['Fillet',                'F'],
    ['Chamfer',               'Shift F'],
    ['Shell',                 'Shift S'],
    ['Hole',                  'H'],
    ['Combine',               'Cmd J'],
  ]},
  { group: 'Assembly', items: [
    ['Mate',                  'M'],
    ['Insert component',      'I'],
    ['Fix component',         'X'],
    ['Exploded view',         'Shift X'],
    ['Run motion',            'Cmd P'],
  ]},
  { group: 'Drawing', items: [
    ['New drawing',           'Cmd D'],
    ['Section view',          'Shift S'],
    ['Detail view',           'Shift D'],
    ['Dimension',             'D'],
    ['Balloon',               'B'],
  ]},
  { group: 'Simulate', items: [
    ['Run static',            'Cmd R'],
    ['Run modal',             'Cmd Shift R'],
    ['Play motion',           'Space'],
    ['Step forward',          '→'],
    ['Step back',             '←'],
  ]},
  { group: 'Archie', items: [
    ['Focus Archie composer', 'Cmd .'],
    ['Send message',          'Cmd Enter'],
    ['New Archie thread',     'Cmd Shift .'],
  ]},
];

export function ShortcutCheatSheet({ open, onClose }) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    if (!query) return SHORTCUTS;
    const q = query.toLowerCase();
    return SHORTCUTS
      .map((g) => ({
        ...g,
        items: g.items.filter(([cmd, keys]) =>
          cmd.toLowerCase().includes(q) || keys.toLowerCase().includes(q)),
      }))
      .filter((g) => g.items.length > 0);
  }, [query]);

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Keyboard shortcuts">
      <Stack gap="var(--space-7)">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter shortcuts…"
          prefix={<Icon name="search" size={12} />}
        />
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 'var(--space-7)',
        }}>
          {groups.map((g) => (
            <section key={g.group}>
              <h3 style={{
                margin: '0 0 var(--space-3)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                fontWeight: 'var(--weight-semibold)',
              }}>{g.group}</h3>
              <Stack gap="var(--space-2)">
                {g.items.map(([cmd, keys]) => (
                  <Inline key={cmd} justify="space-between" align="center"
                    style={{ padding: 'var(--space-2) 0' }}>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{cmd}</span>
                    <KeyHint keys={keys} />
                  </Inline>
                ))}
              </Stack>
            </section>
          ))}
          {groups.length === 0 && (
            <div style={{ color: 'var(--text-tertiary)', padding: 'var(--space-9)', textAlign: 'center' }}>
              No shortcuts match <code style={{ fontFamily: 'var(--font-mono)' }}>{query}</code>.
            </div>
          )}
        </div>
      </Stack>
    </Modal>
  );
}

export function useShortcutCheatSheet() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onKey = (e) => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey
          // ignore when typing into inputs
          && !(e.target instanceof HTMLInputElement)
          && !(e.target instanceof HTMLTextAreaElement)
          && !e.target?.isContentEditable) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return { open, openSheet: () => setOpen(true), closeSheet: () => setOpen(false) };
}
