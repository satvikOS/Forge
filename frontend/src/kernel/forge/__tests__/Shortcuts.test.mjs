import assert from 'node:assert/strict';
import {
  ShortcutRegistry,
  DEFAULT_BINDINGS,
  SHORTCUT_PRESETS,
  parseShortcut,
  eventMatches,
  makeDefaultRegistry,
} from '../Shortcuts.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _data: m,
  };
}

function key(k, mods = {}) {
  return {
    key: k, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift,
    altKey: !!mods.alt, metaKey: !!mods.meta,
    timeStamp: mods.ts == null ? Date.now() : mods.ts,
    preventDefault() {}, stopPropagation() {},
  };
}

// ---- parser -------------------------------------------------------
{
  const toks = parseShortcut('Ctrl+Shift+K', { mac: false });
  assert.equal(toks.length, 1);
  assert.equal(toks[0].key, 'K');
  assert.ok(toks[0].mods.has('Control'));
  assert.ok(toks[0].mods.has('Shift'));

  // Cmd on mac → Meta; off-mac → Control.
  const onMac = parseShortcut('Cmd+S', { mac: true });
  assert.ok(onMac[0].mods.has('Meta'));
  const offMac = parseShortcut('Cmd+S', { mac: false });
  assert.ok(offMac[0].mods.has('Control'));

  // Chord
  const gd = parseShortcut('g d', { mac: false });
  assert.equal(gd.length, 2);
  assert.equal(gd[0].key, 'G');
  assert.equal(gd[1].key, 'D');

  // Aliases
  const esc = parseShortcut('Escape', { mac: false });
  assert.equal(esc[0].key, 'Escape');
  const del = parseShortcut('Del', { mac: false });
  assert.equal(del[0].key, 'Delete');
}

// ---- eventMatches -------------------------------------------------
{
  const tok = parseShortcut('Ctrl+S', { mac: false })[0];
  assert.equal(eventMatches(key('S', { ctrl: true }), tok), true);
  assert.equal(eventMatches(key('S', { ctrl: true, shift: true }), tok), false);
  assert.equal(eventMatches(key('S'), tok), false);
}

// ---- register + bind invokes command ------------------------------
{
  const invoked = [];
  const cmds = {
    invoke: (id) => invoked.push(id),
  };
  const reg = new ShortcutRegistry({
    commandRegistry: cmds, storage: memStorage(), mac: false,
  });
  reg.register('edit.undo', 'Ctrl+Z');
  reg.register('edit.redo', 'Ctrl+Shift+Z');

  // .handle returns the id of a completed binding.
  assert.equal(reg.handle(key('Z', { ctrl: true })), 'edit.undo');
  assert.equal(reg.handle(key('Z', { ctrl: true, shift: true })), 'edit.redo');
  assert.equal(reg.handle(key('Z')), null);
}

// ---- chord detection ---------------------------------------------
{
  const reg = new ShortcutRegistry({ storage: memStorage(), mac: false });
  reg.register('cmd.goDef', 'g d');
  reg.register('cmd.goImpl', 'g i');
  // First key: returns null because chord still in progress.
  assert.equal(reg.handle(key('G', { ts: 1000 })), null);
  // Second key within the chord window completes 'g d'.
  assert.equal(reg.handle(key('D', { ts: 1020 })), 'cmd.goDef');

  // Different chord → 'g i'
  assert.equal(reg.handle(key('G', { ts: 2000 })), null);
  assert.equal(reg.handle(key('I', { ts: 2030 })), 'cmd.goImpl');

  // Chord timeout drains the buffer.
  assert.equal(reg.handle(key('G', { ts: 3000 })), null);
  assert.equal(reg.handle(key('D', { ts: 9000 })), null,
    'chord lapses after 1s — second key alone has no binding');
}

// ---- bind() overrides default + persists -------------------------
{
  const storage = memStorage();
  const reg = new ShortcutRegistry({ storage, mac: false });
  reg.register('edit.undo', 'Ctrl+Z');
  reg.bind('edit.undo', 'Ctrl+Y');
  assert.equal(reg.handle(key('Y', { ctrl: true })), 'edit.undo');
  assert.equal(reg.handle(key('Z', { ctrl: true })), null,
    'old binding no longer matches');

  // Reopen: customised value survives.
  const raw = storage.getItem('forge.shortcuts');
  assert.ok(raw, 'shortcuts persisted');
  const reg2 = new ShortcutRegistry({ storage, mac: false });
  reg2.register('edit.undo', 'Ctrl+Z');
  assert.equal(reg2.get('edit.undo'), 'Ctrl+Y',
    'persisted custom binding wins over default on reload');
}

// ---- exportJSON / importJSON --------------------------------------
{
  const reg = makeDefaultRegistry({ storage: memStorage(), mac: false });
  const exported = reg.exportJSON('default');
  assert.equal(exported.bindings['edit.undo'], 'Cmd+Z');

  const vim = SHORTCUT_PRESETS.vim;
  reg.importJSON(vim);
  assert.equal(reg.get('edit.redo'), 'Ctrl+R');
}

// ---- attach() wires window keydown -------------------------------
{
  const listeners = new Map();
  const fakeWin = {
    addEventListener(ev, fn) { listeners.set(ev, fn); },
    removeEventListener(ev) { listeners.delete(ev); },
  };
  const invoked = [];
  const reg = new ShortcutRegistry({
    commandRegistry: { invoke: (id) => invoked.push(id) },
    storage: memStorage(), mac: false,
  });
  reg.register('edit.undo', 'Ctrl+Z');
  const dispose = reg.attach(fakeWin);
  assert.ok(listeners.get('keydown'));

  // Fire fake event.
  listeners.get('keydown')(key('Z', { ctrl: true }));
  assert.deepEqual(invoked, ['edit.undo']);

  // Skip when the target is an INPUT (unless Escape).
  listeners.get('keydown')({
    ...key('Z', { ctrl: true }),
    target: { tagName: 'INPUT' },
  });
  assert.deepEqual(invoked, ['edit.undo'], 'inputs swallow the press');

  // But Escape always fires.
  reg.register('edit.cancel', 'Escape');
  listeners.get('keydown')({
    ...key('Escape'),
    target: { tagName: 'INPUT' },
  });
  assert.deepEqual(invoked, ['edit.undo', 'edit.cancel']);

  dispose();
  assert.equal(listeners.get('keydown'), undefined);
}

console.log('[forge.shortcut] all tests passed');
