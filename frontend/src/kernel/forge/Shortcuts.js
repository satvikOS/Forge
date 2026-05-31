/**
 * Shortcuts — keyboard registry + customizer (Forge-28).
 *
 * Two flavours of binding are supported out of the gate:
 *   - modifier combos:  "Ctrl+S"      / "Cmd+Shift+Z"
 *   - chord sequences:  "g d"          / "g g"
 *
 * Modifier order is normalised so "Shift+Ctrl+K" and "Ctrl+Shift+K" both
 * resolve to the same canonical token. The chord buffer is wall-clock
 * timed; if the second key doesn't land within `chordTimeoutMs` (1000ms
 * default), the buffer resets — matching VS Code's "chord lapsed" feel.
 *
 * Bindings persist in `localStorage` under `forge.shortcuts`. The JSON
 * export shape:
 *
 *   {
 *     "version": 1,
 *     "name": "default" | "vim" | string,
 *     "bindings": { "<commandId>": "<key>" }
 *   }
 *
 * No React. The registry is fed into the CommandRegistry (Forge-16a) so a
 * single key press resolves to `commandRegistry.invoke(id)`.
 */

// Default platform-aware bindings. `Cmd` is mapped to ⌘ on darwin and
// Ctrl elsewhere by the normaliser at parse time.
export const DEFAULT_BINDINGS = Object.freeze({
  'file.save':         'Cmd+S',
  'edit.undo':         'Cmd+Z',
  'edit.redo':         'Cmd+Shift+Z',
  'view.commandPalette': 'Cmd+K',
  'edit.cancel':       'Escape',
  'edit.deleteSelection': 'Delete',
  'view.frame':        'F',
  'create.box':        'B',
  'file.export':       'X',
});

const STORAGE_KEY = 'forge.shortcuts';

// ---------------------------------------------------------- platform
function isMac(navObj = null) {
  const n = navObj || (typeof navigator !== 'undefined' ? navigator : null);
  if (!n) return false;
  const s = (n.platform || n.userAgent || '').toLowerCase();
  return s.includes('mac');
}

// ---------------------------------------------------------- key parsing
const MOD_ALIASES = {
  cmd: 'Meta', command: 'Meta', meta: 'Meta', win: 'Meta', super: 'Meta',
  ctrl: 'Control', control: 'Control',
  alt: 'Alt', option: 'Alt', opt: 'Alt',
  shift: 'Shift',
};

const KEY_ALIASES = {
  esc: 'Escape', escape: 'Escape',
  del: 'Delete', delete: 'Delete',
  ret: 'Enter', return: 'Enter', enter: 'Enter',
  space: ' ', spc: ' ',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  plus: '+', minus: '-',
};

function normaliseKey(part) {
  const low = part.toLowerCase();
  if (KEY_ALIASES[low]) return KEY_ALIASES[low];
  if (part.length === 1) return part.toUpperCase();
  // F-keys, named keys — keep canonical case
  if (/^f\d{1,2}$/i.test(part)) return part.toUpperCase();
  return part.charAt(0).toUpperCase() + part.slice(1);
}

/**
 * Parse "Ctrl+Shift+K" / "Cmd+S" / "g d" into a sequence of canonical
 * tokens. Each token: { mods: Set<'Control'|'Shift'|'Alt'|'Meta'>, key }.
 *
 * `mac` toggles whether 'Cmd' resolves to Meta (mac) or Control (other).
 */
export function parseShortcut(spec, { mac = isMac() } = {}) {
  if (!spec || typeof spec !== 'string') {
    throw new Error('[forge.shortcut] spec must be a non-empty string');
  }
  const segments = spec.trim().split(/\s+/);
  const tokens = segments.map((seg) => parseOneCombo(seg, mac));
  return tokens;
}

function parseOneCombo(seg, mac) {
  const parts = seg.split('+').map((p) => p.trim()).filter(Boolean);
  const mods = new Set();
  let key = null;
  for (const p of parts) {
    const low = p.toLowerCase();
    if (low === 'cmd' || low === 'command') {
      mods.add(mac ? 'Meta' : 'Control');
    } else if (MOD_ALIASES[low]) {
      mods.add(MOD_ALIASES[low]);
    } else {
      key = normaliseKey(p);
    }
  }
  if (!key) throw new Error(`[forge.shortcut] no key in "${seg}"`);
  return { mods, key };
}

/** Build the canonical "Control+Shift+K" string for a single token. */
export function tokenToString(tok) {
  const order = ['Control', 'Alt', 'Shift', 'Meta'];
  const mods = order.filter((m) => tok.mods.has(m));
  return [...mods, tok.key].join('+');
}

/**
 * Match a DOM KeyboardEvent against a single canonical token. Returns
 * true if the user just pressed exactly this combo.
 */
export function eventMatches(ev, tok) {
  if (tok.mods.has('Control') !== !!ev.ctrlKey) return false;
  if (tok.mods.has('Shift')   !== !!ev.shiftKey) return false;
  if (tok.mods.has('Alt')     !== !!ev.altKey) return false;
  if (tok.mods.has('Meta')    !== !!ev.metaKey) return false;
  const evKey = ev.key && ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
  return evKey === tok.key;
}

// ---------------------------------------------------------- storage
function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* sandboxed iframe */ }
  // In-memory fallback for tests / Node smoke runners.
  const mem = new Map();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
  };
}

// ---------------------------------------------------------- registry
export class ShortcutRegistry {
  constructor({ commandRegistry = null, storage = null, mac = isMac(),
                chordTimeoutMs = 1000 } = {}) {
    this.commandRegistry = commandRegistry;
    this.storage = storage || defaultStorage();
    this.mac = mac;
    this.chordTimeoutMs = chordTimeoutMs;
    /** @type {Map<string,{spec:string,tokens:Array,defaultSpec:string}>} */
    this._bindings = new Map();
    this._chordBuffer = [];      // [{token, ts}]
    this._chordTimer = null;
    this._installed = null;
    this._listeners = new Set();

    this._loadPersisted();
  }

  // ---- registration -----------------------------------------------
  register(id, defaultSpec) {
    if (!id) throw new Error('[forge.shortcut] register: id required');
    const existing = this._bindings.get(id);
    const customised = existing && existing.spec !== existing.defaultSpec;
    const spec = customised ? existing.spec : defaultSpec;
    this._bindings.set(id, {
      spec,
      tokens: spec ? parseShortcut(spec, { mac: this.mac }) : [],
      defaultSpec,
    });
    return this;
  }

  bind(id, spec) {
    if (!this._bindings.has(id)) {
      // Allow late-binding before register() — store with no default.
      this._bindings.set(id, { spec, tokens: spec ? parseShortcut(spec, { mac: this.mac }) : [], defaultSpec: null });
    } else {
      const b = this._bindings.get(id);
      b.spec = spec;
      b.tokens = spec ? parseShortcut(spec, { mac: this.mac }) : [];
    }
    this._persist();
    this._notify('bind', { id, spec });
    return this;
  }

  unbind(id) {
    const b = this._bindings.get(id);
    if (!b) return;
    b.spec = '';
    b.tokens = [];
    this._persist();
    this._notify('unbind', { id });
  }

  reset(id) {
    const b = this._bindings.get(id);
    if (!b || !b.defaultSpec) return;
    b.spec = b.defaultSpec;
    b.tokens = parseShortcut(b.defaultSpec, { mac: this.mac });
    this._persist();
    this._notify('reset', { id });
  }

  resetAll() {
    for (const [id, b] of this._bindings) {
      if (!b.defaultSpec) continue;
      b.spec = b.defaultSpec;
      b.tokens = parseShortcut(b.defaultSpec, { mac: this.mac });
    }
    this._persist();
    this._notify('resetAll', {});
  }

  list() {
    return [...this._bindings.entries()].map(([id, b]) => ({
      id, spec: b.spec, defaultSpec: b.defaultSpec,
    }));
  }
  get(id) {
    const b = this._bindings.get(id);
    return b ? b.spec : null;
  }

  // ---- event handling ---------------------------------------------
  /**
   * Translate a KeyboardEvent into a command id. Returns the id (string)
   * if this press completed a binding, or null otherwise. Chord state is
   * carried between calls.
   */
  handle(ev) {
    if (!ev || !ev.key) return null;
    if (this._isPureModifier(ev)) return null;
    const now = (ev.timeStamp != null) ? ev.timeStamp : Date.now();
    const last = this._chordBuffer.length
      ? this._chordBuffer[this._chordBuffer.length - 1].ts : null;
    if (last != null && (now - last) > this.chordTimeoutMs) {
      this._chordBuffer.length = 0;
    }
    const press = { key: ev.key.length === 1 ? ev.key.toUpperCase() : ev.key,
                    mods: { ctrl: !!ev.ctrlKey, shift: !!ev.shiftKey,
                            alt: !!ev.altKey, meta: !!ev.metaKey }, ts: now };
    this._chordBuffer.push(press);

    // Try to match the longest chord first; if no match, fall back to the
    // most recent single press.
    for (let startLen = this._chordBuffer.length; startLen >= 1; startLen--) {
      const tail = this._chordBuffer.slice(this._chordBuffer.length - startLen);
      const id = this._matchTokens(tail);
      if (id) {
        this._chordBuffer.length = 0;
        return id;
      }
    }
    // If no binding starts with the buffered keys, drain it.
    if (!this._anyBindingStartsWith(this._chordBuffer)) {
      this._chordBuffer.length = 0;
    }
    return null;
  }

  _isPureModifier(ev) {
    return ['Control', 'Shift', 'Alt', 'Meta'].includes(ev.key);
  }

  _matchTokens(presses) {
    for (const [id, b] of this._bindings) {
      if (b.tokens.length !== presses.length) continue;
      let ok = true;
      for (let i = 0; i < presses.length; i++) {
        if (!this._pressMatchesToken(presses[i], b.tokens[i])) { ok = false; break; }
      }
      if (ok) return id;
    }
    return null;
  }

  _anyBindingStartsWith(presses) {
    for (const [, b] of this._bindings) {
      if (b.tokens.length <= presses.length) continue;
      let ok = true;
      for (let i = 0; i < presses.length; i++) {
        if (!this._pressMatchesToken(presses[i], b.tokens[i])) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  _pressMatchesToken(press, tok) {
    if (tok.mods.has('Control') !== press.mods.ctrl) return false;
    if (tok.mods.has('Shift')   !== press.mods.shift) return false;
    if (tok.mods.has('Alt')     !== press.mods.alt) return false;
    if (tok.mods.has('Meta')    !== press.mods.meta) return false;
    return press.key === tok.key;
  }

  /**
   * Attach a global keydown handler to `target` (defaults to window). On
   * each completed binding, calls `commandRegistry.invoke(id)`.
   *
   * Returns a disposer that uninstalls the handler.
   */
  attach(target = (typeof window !== 'undefined' ? window : null)) {
    if (!target || typeof target.addEventListener !== 'function') {
      throw new Error('[forge.shortcut] attach: target lacks addEventListener');
    }
    if (this._installed) this._installed();
    const listener = (ev) => {
      // Skip when the user is typing into an input/textarea/contenteditable.
      const t = ev.target;
      if (t && t.tagName && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        // Still allow Escape — many UIs use it to clear focus.
        if (ev.key !== 'Escape') return;
      }
      const id = this.handle(ev);
      if (id) {
        ev.preventDefault?.();
        ev.stopPropagation?.();
        try {
          if (this.commandRegistry) this.commandRegistry.invoke(id);
          else this._notify('invoke', { id });
        } catch (e) {
          console.warn('[forge.shortcut] invoke failed:', id, e);
        }
      }
    };
    target.addEventListener('keydown', listener, true);
    this._installed = () => target.removeEventListener('keydown', listener, true);
    return this._installed;
  }

  // ---- persistence ------------------------------------------------
  _persist() {
    try {
      const out = { version: 1, name: 'custom', bindings: {} };
      for (const [id, b] of this._bindings) {
        if (b.spec !== b.defaultSpec) out.bindings[id] = b.spec;
      }
      this.storage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch (e) {
      console.warn('[forge.shortcut] persist failed:', e);
    }
  }

  _loadPersisted() {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const j = JSON.parse(raw);
      for (const [id, spec] of Object.entries(j.bindings || {})) {
        this._bindings.set(id, { spec, tokens: spec ? parseShortcut(spec, { mac: this.mac }) : [], defaultSpec: null });
      }
    } catch (e) {
      console.warn('[forge.shortcut] load failed:', e);
    }
  }

  // ---- JSON IO ----------------------------------------------------
  exportJSON(name = 'custom') {
    return {
      version: 1, name,
      bindings: Object.fromEntries(
        [...this._bindings.entries()].map(([id, b]) => [id, b.spec]),
      ),
    };
  }
  importJSON(json) {
    if (!json || !json.bindings) throw new Error('[forge.shortcut] importJSON: missing bindings');
    for (const [id, spec] of Object.entries(json.bindings)) {
      if (!spec) continue;
      const existing = this._bindings.get(id);
      this._bindings.set(id, {
        spec, tokens: parseShortcut(spec, { mac: this.mac }),
        defaultSpec: existing ? existing.defaultSpec : null,
      });
    }
    this._persist();
    this._notify('import', { name: json.name });
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
  _notify(kind, payload) {
    for (const fn of this._listeners) {
      try { fn({ kind, ...payload }); } catch (e) { console.error('[forge.shortcut]', e); }
    }
  }
}

// ---------------------------------------------------------- presets
export const SHORTCUT_PRESETS = Object.freeze({
  default: { version: 1, name: 'default', bindings: { ...DEFAULT_BINDINGS } },
  vim: {
    version: 1, name: 'vim',
    bindings: {
      'edit.undo': 'U',
      'edit.redo': 'Ctrl+R',
      'view.commandPalette': 'Cmd+P',
      'edit.cancel': 'Escape',
      'edit.deleteSelection': 'D D',
      'view.frame': 'Z Z',
      'create.box': 'B',
      'file.save': 'Cmd+S',
      'file.export': 'X',
    },
  },
});

/**
 * Build a registry pre-populated with Forge's default bindings.
 */
export function makeDefaultRegistry({ commandRegistry = null, storage = null,
                                       mac = isMac() } = {}) {
  const reg = new ShortcutRegistry({ commandRegistry, storage, mac });
  for (const [id, spec] of Object.entries(DEFAULT_BINDINGS)) {
    reg.register(id, spec);
  }
  return reg;
}

export default {
  ShortcutRegistry,
  DEFAULT_BINDINGS,
  SHORTCUT_PRESETS,
  parseShortcut,
  tokenToString,
  eventMatches,
  makeDefaultRegistry,
};
