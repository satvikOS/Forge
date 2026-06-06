// Forge-134 — plugin runtime + persistence.
//
// Plugins are JavaScript snippets that run against `window.Forge`. The
// plugin shape:
//
//   {
//     name:    string,         // unique stable id (also localStorage key)
//     version: string,         // semver, displayed in PluginManagerPanel
//     author:  string,
//     minApi:  string,         // semver — minimum window.Forge.VERSION
//     hooks:   ['onStartup','onToolDispatch','onBodyAdded',...],
//     menuContributions: [{ menuId, item: { id, label, icon, action? } }],
//     toolContributions: [{ id, label, icon, schema?, run }],
//     code: string|function,   // evaluated/called at install
//   }
//
// `code` is either:
//   • A string of JS source. It's wrapped in `new Function('Forge','ctx',code)`
//     so the plugin runs in its own scope but with Forge as the only
//     ambient name. The plugin's body may return a value: if it returns
//     an object exposing `{ hooks, menuContributions, toolContributions }`,
//     those are merged into the manifest at install time.
//   • A function (used by the e2e spec to install a JS literal directly).
//     The function receives `(Forge, ctx)` and may return the same shape.
//
// `ctx` is `{ plugin, manager }` so the plugin can reach back into its
// own manifest if needed.
//
// Persistence:
//   localStorage key `forge.v4.plugins` holds `{ [name]: { manifest, enabled } }`.
//   On app start, listPlugins() returns enabled plugins; installFromString /
//   installFromUrl / uninstall mutate the same record. Disabled plugins
//   stay in storage but aren't re-loaded.

import { showToast } from './Toast.jsx';
import { negotiate, installForgeAPI } from './forgeAPI.js';

const LS_KEY = 'forge.v4.plugins';

/* =====================================================================
 * In-memory live state.
 * ===================================================================== */

const _installed = new Map();     // name → { manifest, status:'live'|'disabled'|'error', error?, cleanup? }
const _listeners = new Set();

function _emitChanged() {
  for (const fn of _listeners) {
    try { fn(_list()); } catch (err) { console.warn('[forge.v4.plugins] listener threw:', err); }
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('forge:plugins-changed', {
        detail: { plugins: _list() },
      }));
    } catch {}
  }
}

function _list() {
  return Array.from(_installed.entries()).map(([name, rec]) => ({
    name,
    manifest: rec.manifest,
    status: rec.status,
    error: rec.error || null,
  }));
}

export function subscribe(fn) {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

export function listPlugins() { return _list(); }

/* =====================================================================
 * Persistence helpers.
 * ===================================================================== */

function _readStore() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const r = localStorage.getItem(LS_KEY);
    return r ? JSON.parse(r) : {};
  } catch { return {}; }
}
function _writeStore(store) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch {}
}

function _persist(name, manifest, enabled) {
  const store = _readStore();
  store[name] = { manifest, enabled: !!enabled };
  _writeStore(store);
}
function _forget(name) {
  const store = _readStore();
  delete store[name];
  _writeStore(store);
}

/* =====================================================================
 * Manifest validation + evaluation.
 * ===================================================================== */

function _validate(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Plugin manifest must be an object');
  }
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
    throw new Error('Plugin missing required field: name');
  }
  if (typeof manifest.version !== 'string') {
    throw new Error(`Plugin ${manifest.name} missing required field: version`);
  }
  if (manifest.code == null) {
    throw new Error(`Plugin ${manifest.name} missing required field: code`);
  }
  if (typeof manifest.code !== 'string' && typeof manifest.code !== 'function') {
    throw new Error(`Plugin ${manifest.name} code must be string or function`);
  }
  if (manifest.hooks && !Array.isArray(manifest.hooks)) {
    throw new Error(`Plugin ${manifest.name} hooks must be array`);
  }
  if (manifest.menuContributions && !Array.isArray(manifest.menuContributions)) {
    throw new Error(`Plugin ${manifest.name} menuContributions must be array`);
  }
  if (manifest.toolContributions && !Array.isArray(manifest.toolContributions)) {
    throw new Error(`Plugin ${manifest.name} toolContributions must be array`);
  }
  return manifest;
}

function _evaluate(manifest, Forge) {
  // Wrap user code in `new Function` with `Forge` as the only ambient
  // name. The plugin author writes top-level code: it has access to
  // Forge.* and can either return a delta object that's merged into
  // its manifest (hooks, menuContributions, toolContributions) or use
  // Forge.tools.registerTool / Forge.menu.addItem directly.
  let runner;
  if (typeof manifest.code === 'function') {
    runner = manifest.code;
  } else {
    try {
      // eslint-disable-next-line no-new-func
      runner = new Function('Forge', 'ctx', manifest.code);
    } catch (err) {
      throw new Error(`Plugin ${manifest.name} compile error: ${err.message}`);
    }
  }
  let delta;
  try {
    delta = runner(Forge, { plugin: manifest });
  } catch (err) {
    throw new Error(`Plugin ${manifest.name} run error: ${err.message}`);
  }
  return delta || {};
}

/* =====================================================================
 * Install / load entry points.
 * ===================================================================== */

function _applyContributions(manifest, Forge) {
  const registered = { tools: [], menuItems: [], menus: [], workbenches: [] };

  // 1. toolContributions declared in the manifest.
  for (const spec of (manifest.toolContributions || [])) {
    if (!spec || typeof spec.id !== 'string' || typeof spec.run !== 'function') continue;
    Forge.tools.registerTool(spec);
    registered.tools.push(spec.id);
  }

  // 2. menuContributions.
  for (const c of (manifest.menuContributions || [])) {
    if (!c || typeof c.menuId !== 'string' || !c.item) continue;
    try {
      Forge.menu.addItem(c.menuId, c.item);
      registered.menuItems.push({ menuId: c.menuId, id: c.item.id });
    } catch (err) {
      console.warn(`[forge.v4.plugins] menu contribution failed:`, err);
    }
  }

  return registered;
}

function _cleanupContributions(registered, Forge) {
  for (const toolId of registered.tools) Forge.tools.unregister(toolId);
  for (const { menuId, id } of registered.menuItems) Forge.menu.removeItem(menuId, id);
}

export function install(manifest, { enabled = true, persist = true } = {}) {
  _validate(manifest);
  // Ensure window.Forge exists (lazy install if PluginManagerPanel
  // hasn't booted yet).
  const Forge = (typeof window !== 'undefined' && window.Forge) || installForgeAPI();
  if (!Forge) throw new Error('window.Forge unavailable — cannot install plugin');

  // Reject if a plugin with the same name is already live; the caller
  // should uninstall first.
  if (_installed.has(manifest.name) && _installed.get(manifest.name).status === 'live') {
    throw new Error(`Plugin "${manifest.name}" already installed — uninstall first`);
  }

  // Version negotiation.
  const neg = negotiate(manifest.minApi);
  if (!neg.ok) {
    const rec = { manifest, status: 'error', error: neg.reason };
    _installed.set(manifest.name, rec);
    if (persist) _persist(manifest.name, manifest, false);
    _emitChanged();
    throw new Error(neg.reason);
  }

  // Run code to get delta + merge into manifest before applying.
  // Snapshot the tool/menu registries around _evaluate so tools the plugin
  // registers IMPERATIVELY (Forge.tools.registerTool inside its code, rather
  // than via declarative toolContributions) are still tracked for cleanup on
  // uninstall — otherwise uninstalling leaves orphan tools in the registry.
  const toolIdsBefore = new Set(
    (typeof Forge.tools.list === 'function' ? Forge.tools.list() : []).map((t) => t.id));
  let delta = {};
  try {
    delta = _evaluate(manifest, Forge);
  } catch (err) {
    const rec = { manifest, status: 'error', error: err.message };
    _installed.set(manifest.name, rec);
    if (persist) _persist(manifest.name, manifest, false);
    _emitChanged();
    throw err;
  }
  const imperativeToolIds = (typeof Forge.tools.list === 'function' ? Forge.tools.list() : [])
    .map((t) => t.id)
    .filter((id) => !toolIdsBefore.has(id));

  const merged = {
    ...manifest,
    hooks: Array.from(new Set([...(manifest.hooks || []), ...(delta.hooks || [])])),
    menuContributions: [...(manifest.menuContributions || []), ...(delta.menuContributions || [])],
    toolContributions: [...(manifest.toolContributions || []), ...(delta.toolContributions || [])],
  };

  const registered = _applyContributions(merged, Forge);
  // Fold in imperatively-registered tools so cleanup unregisters them too.
  for (const id of imperativeToolIds) {
    if (!registered.tools.includes(id)) registered.tools.push(id);
  }
  const cleanup = () => _cleanupContributions(registered, Forge);

  const rec = {
    manifest: merged,
    status: enabled ? 'live' : 'disabled',
    registered,
    cleanup,
  };
  _installed.set(manifest.name, rec);
  if (persist) _persist(manifest.name, merged, enabled);

  // Fire startup hooks if present.
  if (enabled) {
    for (const hookName of (merged.hooks || [])) {
      if (hookName === 'onStartup' && typeof delta.onStartup === 'function') {
        try { delta.onStartup(Forge, { plugin: merged }); }
        catch (err) { console.warn(`[forge.v4.plugins] onStartup ${merged.name}:`, err); }
      }
    }
  }

  _emitChanged();
  return rec;
}

export function loadFromString(code, opts = {}) {
  // The caller may pass either:
  //   • A raw JS string that itself returns a manifest object, or
  //   • A JSON manifest string with `{ name, version, code: "..." }`.
  //
  // To keep the API stable we always wrap raw strings into a manifest
  // when callers pass plain JS via PluginManagerPanel; the panel passes
  // a manifest JSON. For e2e + power-user direct calls, opts.manifest
  // can be provided explicitly.
  if (opts.manifest && typeof opts.manifest === 'object') {
    return install({ ...opts.manifest, code }, opts);
  }
  // Try JSON first.
  let parsed;
  try { parsed = JSON.parse(code); }
  catch { parsed = null; }
  if (parsed && typeof parsed === 'object' && parsed.name && parsed.code) {
    return install(parsed, opts);
  }
  // Otherwise the string itself IS plugin code, with a header comment
  // line like `// @name foo` / `// @version 1.0` extracted.
  const meta = _parseHeader(code);
  if (!meta.name) throw new Error('loadFromString: missing @name header');
  const manifest = { ...meta, code };
  return install(manifest, opts);
}

export async function loadFromUrl(url, opts = {}) {
  if (typeof fetch !== 'function') throw new Error('loadFromUrl: fetch unavailable');
  const r = await fetch(url, { headers: { 'Accept': 'application/json, text/javascript' } });
  if (!r.ok) throw new Error(`loadFromUrl: ${r.status} ${r.statusText}`);
  const text = await r.text();
  return loadFromString(text, opts);
}

function _parseHeader(code) {
  const lines = code.split('\n').slice(0, 20);
  const meta = { name: null, version: '0.0.1', author: 'unknown', minApi: '0.0.0', hooks: [] };
  for (const line of lines) {
    const m = line.match(/^\s*\/\/\s*@(\w+)\s+(.+?)\s*$/);
    if (!m) continue;
    const [, key, val] = m;
    if (key === 'name') meta.name = val;
    else if (key === 'version') meta.version = val;
    else if (key === 'author') meta.author = val;
    else if (key === 'minApi' || key === 'minapi') meta.minApi = val;
    else if (key === 'hook' || key === 'hooks') {
      meta.hooks.push(...val.split(',').map((s) => s.trim()));
    }
  }
  return meta;
}

/* =====================================================================
 * Uninstall — drops the plugin from live registries + persistence.
 * ===================================================================== */

export function uninstall(name) {
  const rec = _installed.get(name);
  if (!rec) {
    _forget(name);
    _emitChanged();
    return false;
  }
  try { rec.cleanup?.(); } catch (err) { console.warn('[forge.v4.plugins] cleanup threw:', err); }
  _installed.delete(name);
  _forget(name);
  _emitChanged();
  return true;
}

export function disable(name) {
  const rec = _installed.get(name);
  if (!rec) return false;
  try { rec.cleanup?.(); } catch {}
  rec.status = 'disabled';
  const store = _readStore();
  if (store[name]) { store[name].enabled = false; _writeStore(store); }
  _emitChanged();
  return true;
}

export function enable(name) {
  const rec = _installed.get(name);
  if (rec && rec.status === 'live') return true;
  const store = _readStore();
  const persisted = store[name];
  if (!persisted) return false;
  // Re-install fresh so the run code re-fires and contributions reapply.
  if (rec) _installed.delete(name);
  try {
    install(persisted.manifest, { enabled: true, persist: true });
  } catch (err) {
    showToast({ kind: 'err', text: `Enable failed: ${err.message}`, ttl: 3500 });
    return false;
  }
  return true;
}

/* =====================================================================
 * Auto-load on app start. Called by the PluginManagerPanelHost mount
 * effect so we don't run before window.Forge is published.
 * ===================================================================== */

let _bootstrapped = false;
export function bootstrap() {
  if (_bootstrapped) return _list();
  _bootstrapped = true;
  installForgeAPI();
  const store = _readStore();
  for (const [name, rec] of Object.entries(store)) {
    if (!rec || !rec.enabled) continue;
    try {
      install(rec.manifest, { enabled: true, persist: false });
    } catch (err) {
      console.warn(`[forge.v4.plugins] bootstrap "${name}" failed:`, err);
      // Record the error so PluginManagerPanel shows it instead of
      // silently dropping the plugin.
      _installed.set(name, {
        manifest: rec.manifest,
        status: 'error',
        error: err.message,
      });
    }
  }
  _emitChanged();
  return _list();
}

export function reset() {
  for (const rec of _installed.values()) {
    try { rec.cleanup?.(); } catch {}
  }
  _installed.clear();
  if (typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(LS_KEY); } catch {}
  }
  _bootstrapped = false;
  _emitChanged();
}

export default {
  install, uninstall, enable, disable,
  loadFromString, loadFromUrl,
  listPlugins, subscribe, bootstrap, reset,
};
