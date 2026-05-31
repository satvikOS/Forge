/**
 * CommandPalette v2 — Cmd+K fuzzy command launcher.
 *
 * Modal-positioned, focus-trapped, ESC-closable. Search input with mode
 * prefixes: ">" commands, "@" features in active document, "?" help,
 * ":" settings shortcuts. Arrow keys move, Enter invokes. Recent and
 * frequent commands bubble to the top.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Icon } from '../../design-system/icons/Icon.jsx';
import { KeyHint } from '../../design-system/primitives/KeyHint.jsx';
import { useFocusTrap, useEscapeKey, useUniqueId } from '../../design-system/a11y.js';

const MODES = {
  '>': { label: 'Commands',  ph: 'Type a command…' },
  '@': { label: 'Features',  ph: 'Jump to feature…' },
  '?': { label: 'Help',      ph: 'Search docs…' },
  ':': { label: 'Settings',  ph: 'Quick setting…' },
};

function detectMode(text) {
  const first = text[0];
  if (MODES[first]) return { mode: first, query: text.slice(1).trim() };
  return { mode: '>', query: text };
}

function fuzzyScore(query, label) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const l = label.toLowerCase();
  if (l.startsWith(q)) return 100 - l.length;
  if (l.includes(q)) return 50 - (l.indexOf(q) * 0.5);
  // subsequence?
  let qi = 0;
  let consec = 0;
  let score = 0;
  for (let i = 0; i < l.length && qi < q.length; i++) {
    if (l[i] === q[qi]) {
      score += 1 + consec * 2;
      consec++;
      qi++;
    } else consec = 0;
  }
  if (qi < q.length) return 0;
  return score;
}

export function CommandPalette({
  open,
  onClose,
  commands = [],   // [{id, label, category, icon, shortcut, run}]
  features = [],   // [{id, label, kind}] from active document
  onInvoke,
  recent = [],     // command ids
}) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  const inputRef = useRef(null);
  const listId = useUniqueId('cmd-list');

  useFocusTrap(ref, open);
  useEscapeKey(onClose, open);

  useEffect(() => {
    if (open) {
      setText(''); setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const { mode, query } = useMemo(() => detectMode(text), [text]);

  const items = useMemo(() => {
    let source = [];
    if (mode === '>') {
      source = commands.map((c) => ({
        kind: 'command', id: c.id, label: c.label,
        secondary: c.category, icon: c.icon || 'command', shortcut: c.shortcut, run: c.run,
      }));
      // boost recent
      const recentSet = new Set(recent);
      source.forEach((s) => { if (recentSet.has(s.id)) s.boost = 10; });
    } else if (mode === '@') {
      source = features.map((f) => ({
        kind: 'feature', id: f.id, label: f.label, secondary: f.kind, icon: 'partTab',
      }));
    } else if (mode === '?') {
      source = [
        { kind: 'help', id: 'docs.kernel', label: 'Forge kernel reference', icon: 'help' },
        { kind: 'help', id: 'docs.archie', label: 'Archie tool-call schema', icon: 'archie' },
        { kind: 'help', id: 'docs.shortcuts', label: 'Keyboard shortcuts', icon: 'help' },
      ];
    } else if (mode === ':') {
      source = [
        { kind: 'setting', id: 'theme.dark', label: 'Theme: Dark', icon: 'moon' },
        { kind: 'setting', id: 'theme.light', label: 'Theme: Light', icon: 'sun' },
        { kind: 'setting', id: 'theme.contrast', label: 'Theme: High contrast', icon: 'monitor' },
        { kind: 'setting', id: 'units.mm', label: 'Units: mm', icon: 'settings' },
        { kind: 'setting', id: 'units.in', label: 'Units: in', icon: 'settings' },
      ];
    }

    if (!query) return source.sort((a, b) => (b.boost || 0) - (a.boost || 0));
    return source
      .map((s) => ({ s, score: fuzzyScore(query, s.label) + (s.boost || 0) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.s);
  }, [mode, query, commands, features, recent]);

  useEffect(() => { setActive(0); }, [text]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[active];
      if (it) {
        onInvoke?.(it);
        onClose?.();
      }
    } else if (e.key === 'Tab' && items[active]) {
      e.preventDefault();
      setText(`${mode === '>' ? '' : mode}${items[active].label} `);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
        zIndex: 'var(--z-modal)',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div ref={ref} style={{
        width: '640px', maxWidth: '92vw',
        background: 'var(--surface-overlay)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-xl)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Search row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-5)',
          padding: 'var(--space-5) var(--space-7)',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <Icon name="search" size={14} style={{ color: 'var(--text-tertiary)' }} />
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={MODES[mode]?.ph || 'Type a command…'}
            aria-label="Command search"
            aria-controls={listId}
            aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--text-lg)',
              color: 'var(--text-primary)',
            }}
          />
          <span style={{
            fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>{MODES[mode]?.label}</span>
        </div>

        {/* Mode hint row */}
        <div style={{
          display: 'flex', gap: 'var(--space-5)',
          padding: 'var(--space-3) var(--space-7)',
          background: 'var(--surface-raised)',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)',
        }}>
          <span><code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-bg)' }}>{'>'}</code> commands</span>
          <span><code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-bg)' }}>@</code> features</span>
          <span><code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-bg)' }}>?</code> help</span>
          <span><code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-bg)' }}>:</code> settings</span>
        </div>

        {/* Results */}
        <ul id={listId} role="listbox" style={{
          listStyle: 'none', margin: 0, padding: 'var(--space-3) 0',
          maxHeight: '50vh', overflowY: 'auto',
        }}>
          {items.length === 0 ? (
            <li style={{ padding: 'var(--space-9)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              No matches.
            </li>
          ) : items.map((it, i) => (
            <li
              key={`${it.kind}:${it.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => { onInvoke?.(it); onClose?.(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-5)',
                padding: 'var(--space-3) var(--space-7)',
                background: i === active ? 'var(--surface-selected)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              <Icon name={it.icon || 'command'} size={14} style={{ color: i === active ? 'var(--accent-bg)' : 'var(--text-tertiary)' }} />
              <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{it.label}</span>
              {it.secondary && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{it.secondary}</span>}
              {it.shortcut && <KeyHint keys={it.shortcut} />}
            </li>
          ))}
        </ul>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-7)',
          padding: 'var(--space-3) var(--space-7)',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--surface-raised)',
          fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)',
        }}>
          <span><KeyHint keys={['↑','↓']} /> navigate</span>
          <span><KeyHint keys="Enter" /> invoke</span>
          <span><KeyHint keys="Tab" /> auto-fill</span>
          <span><KeyHint keys="Esc" /> close</span>
        </div>
      </div>
    </div>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return { open, openPalette: () => setOpen(true), closePalette: () => setOpen(false) };
}
