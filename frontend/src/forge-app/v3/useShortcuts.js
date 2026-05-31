// Forge-63 — shortcut customizer.
//
// Every global key binding the v3 shell installs is named, default-
// chorded, and overridable here. Storage: `forge.v3.shortcuts` →
// `{ id: chord }`. The shell reads `bindings()` once and re-renders
// when the user saves a new chord.
//
// Chord string format (deliberately minimalist):
//   "mod+k"        ⌘K on macOS, Ctrl+K on Win/Linux
//   "mod+shift+z"
//   "1", "2", ..., "7"
//   "escape"
//
// `matchEvent(chord, e)` returns true when a KeyboardEvent matches.

import { useCallback, useEffect, useState } from 'react';

export const SHORTCUT_DEFS = [
  { id: 'cmd.focus',          label: 'Focus command bar',     default: 'mod+k' },
  { id: 'archie.toggle',      label: 'Collapse / expand Archie', default: 'mod+/' },
  { id: 'theme.cycle',        label: 'Cycle theme',           default: 'mod+t' },
  { id: 'display.cycle',      label: 'Cycle display state',   default: 'mod+d' },
  { id: 'undo',               label: 'Undo',                  default: 'mod+z' },
  { id: 'redo',               label: 'Redo',                  default: 'mod+shift+z' },
  { id: 'settings.open',      label: 'Open settings',         default: 'mod+,' },
  { id: 'doc.new',            label: 'New document',          default: 'mod+n' },
  { id: 'verb.clear',         label: 'Clear active verb',     default: 'escape' },
  { id: 'view.iso',           label: 'View: iso',             default: '1' },
  { id: 'view.front',         label: 'View: front',           default: '2' },
  { id: 'view.back',          label: 'View: back',            default: '3' },
  { id: 'view.top',           label: 'View: top',             default: '4' },
  { id: 'view.bottom',        label: 'View: bottom',          default: '5' },
  { id: 'view.right',         label: 'View: right',           default: '6' },
  { id: 'view.left',          label: 'View: left',            default: '7' },
];

const KEY = 'forge.v3.shortcuts';

export function loadShortcuts() {
  if (typeof localStorage === 'undefined') {
    return SHORTCUT_DEFS.reduce((m, d) => (m[d.id] = d.default, m), {});
  }
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = {};
    for (const d of SHORTCUT_DEFS) out[d.id] = stored[d.id] || d.default;
    return out;
  } catch {
    return SHORTCUT_DEFS.reduce((m, d) => (m[d.id] = d.default, m), {});
  }
}

export function saveShortcut(id, chord) {
  if (typeof localStorage === 'undefined') return;
  try {
    const cur = JSON.parse(localStorage.getItem(KEY) || '{}');
    cur[id] = chord;
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch {}
}

/**
 * matchEvent(chord, ev): does `ev` press the chord?
 * Comparison is case-insensitive on the final key; modifiers required
 * exactly as declared.
 */
export function matchEvent(chord, e) {
  if (!chord || !e) return false;
  const parts = chord.split('+').map((s) => s.trim().toLowerCase());
  const needMod = parts.includes('mod');
  const needShift = parts.includes('shift');
  const needAlt = parts.includes('alt');
  const finalKey = parts[parts.length - 1];

  const meta = e.metaKey || e.ctrlKey;
  if (needMod && !meta) return false;
  if (!needMod && meta) return false;
  if (!!needShift !== !!e.shiftKey) return false;
  if (!!needAlt !== !!e.altKey) return false;

  const key = (e.key || '').toLowerCase();
  if (finalKey === 'escape') return e.key === 'Escape';
  if (finalKey === ',' || finalKey === '/' || /^[0-9]$/.test(finalKey)) {
    return e.key === finalKey;
  }
  return key === finalKey;
}

export function useShortcuts() {
  const [bindings, setBindings] = useState(() => loadShortcuts());
  const update = useCallback((id, chord) => {
    setBindings((b) => {
      const next = { ...b, [id]: chord };
      saveShortcut(id, chord);
      return next;
    });
  }, []);
  const reset = useCallback((id) => {
    const d = SHORTCUT_DEFS.find((x) => x.id === id);
    if (!d) return;
    setBindings((b) => {
      const next = { ...b, [id]: d.default };
      saveShortcut(id, d.default);
      return next;
    });
  }, []);
  return { bindings, update, reset, defs: SHORTCUT_DEFS };
}

/**
 * formatChord: render a chord for display, with platform-aware
 * keycap glyphs (⌘ on mac, Ctrl elsewhere; ⇧, etc.).
 */
export function formatChord(chord, platform = (typeof navigator !== 'undefined'
  ? navigator.platform : '')) {
  const mac = /^Mac/i.test(platform || '');
  return chord.split('+').map((p) => {
    const k = p.trim().toLowerCase();
    if (k === 'mod') return mac ? '⌘' : 'Ctrl';
    if (k === 'shift') return mac ? '⇧' : 'Shift';
    if (k === 'alt') return mac ? '⌥' : 'Alt';
    if (k === 'escape') return 'Esc';
    return k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1);
  }).join(mac ? '' : '+');
}
