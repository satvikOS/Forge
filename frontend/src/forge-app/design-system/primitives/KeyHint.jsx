/**
 * KeyHint — renders a shortcut as styled key caps. Accepts "Cmd+K" or
 * "g d" (chord) or arrays like ['Cmd', 'K'].
 */

import React from 'react';

const SYMBOLS = {
  cmd: '⌘', command: '⌘', meta: '⌘',
  ctrl: '⌃', control: '⌃',
  shift: '⇧',
  alt: '⌥', option: '⌥',
  enter: '↵', return: '↵',
  esc: 'Esc', escape: 'Esc',
  tab: '⇥',
  space: '␣',
  up: '↑', down: '↓', left: '←', right: '→',
  backspace: '⌫', delete: '⌦',
};

function pretty(part) {
  const lower = part.toLowerCase();
  return SYMBOLS[lower] || part;
}

export function KeyHint({ keys, separator = '+' }) {
  const parts = Array.isArray(keys) ? keys : String(keys).split(/\+|\s/).filter(Boolean);
  const cap = {
    display: 'inline-block',
    minWidth: 16,
    padding: '0 var(--space-3)',
    height: 16,
    lineHeight: '15px',
    textAlign: 'center',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-2xs)',
    color: 'var(--text-tertiary)',
    background: 'var(--surface-app)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-xs)',
    boxShadow: 'inset 0 -1px 0 var(--border-subtle)',
  };
  return (
    <span className="forge-keyhint" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          <kbd style={cap}>{pretty(p)}</kbd>
          {i < parts.length - 1 && separator !== '+' && (
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>{separator}</span>
          )}
        </React.Fragment>
      ))}
    </span>
  );
}
