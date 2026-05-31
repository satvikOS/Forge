import assert from 'node:assert/strict';
import { SHORTCUT_DEFS, loadShortcuts, matchEvent, formatChord } from '../useShortcuts.js';

// 1) SHORTCUT_DEFS has every binding the shell uses + view keys 1..7.
{
  const ids = SHORTCUT_DEFS.map((d) => d.id);
  ['cmd.focus','archie.toggle','theme.cycle','display.cycle',
   'undo','redo','settings.open','doc.new','verb.clear',
   'view.iso','view.front','view.back','view.top','view.bottom',
   'view.right','view.left'].forEach((id) => {
    assert.ok(ids.includes(id), `missing binding: ${id}`);
  });
  // Every def has a default chord.
  SHORTCUT_DEFS.forEach((d) => assert.ok(d.default, `no default for ${d.id}`));
}

// 2) loadShortcuts returns defaults when localStorage is unavailable
//    (the SSR + Node-test case).
{
  const b = loadShortcuts();
  assert.equal(b['cmd.focus'], 'mod+k');
  assert.equal(b['undo'], 'mod+z');
  assert.equal(b['view.iso'], '1');
}

// 3) matchEvent — modifier handling.
{
  // Cmd+K matches mod+k on mac, Ctrl+K on win.
  assert.ok(matchEvent('mod+k', { key: 'k', metaKey: true, ctrlKey: false,
                                  shiftKey: false, altKey: false }));
  assert.ok(matchEvent('mod+k', { key: 'k', metaKey: false, ctrlKey: true,
                                  shiftKey: false, altKey: false }));
  // No modifier present → mod+k should NOT match plain K.
  assert.ok(!matchEvent('mod+k', { key: 'k', metaKey: false, ctrlKey: false,
                                   shiftKey: false, altKey: false }));
  // mod+k must reject mod+shift+k.
  assert.ok(!matchEvent('mod+k', { key: 'k', metaKey: true, ctrlKey: false,
                                   shiftKey: true, altKey: false }));
  // mod+shift+z matches Cmd+Shift+Z.
  assert.ok(matchEvent('mod+shift+z', { key: 'z', metaKey: true, ctrlKey: false,
                                        shiftKey: true, altKey: false }));
  // Escape matches.
  assert.ok(matchEvent('escape', { key: 'Escape' }));
  // Bare key (no modifier): '1'.
  assert.ok(matchEvent('1', { key: '1', metaKey: false, ctrlKey: false,
                              shiftKey: false, altKey: false }));
  assert.ok(!matchEvent('1', { key: '1', metaKey: true }));
  // ',' bare.
  assert.ok(matchEvent('mod+,', { key: ',', metaKey: true }));
}

// 4) formatChord — platform-aware glyphs.
{
  // Mac.
  assert.equal(formatChord('mod+k', 'MacIntel'), '⌘K');
  assert.equal(formatChord('mod+shift+z', 'MacIntel'), '⌘⇧Z');
  assert.equal(formatChord('escape', 'MacIntel'), 'Esc');
  assert.equal(formatChord('1', 'MacIntel'), '1');
  // Windows.
  assert.equal(formatChord('mod+k', 'Win32'), 'Ctrl+K');
  assert.equal(formatChord('mod+shift+z', 'Win32'), 'Ctrl+Shift+Z');
}

console.log('[forge.v3.shortcuts] all tests passed');
