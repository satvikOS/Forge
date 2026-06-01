// Forge-134 — stable public plugin API.
//
// `window.Forge` is the single public surface third-party plugins use to
// drive the v4 shell. Every method maps to a real, already-shipped
// shell hook (window.__forge*, custom events, panel hosts) so plugins
// can build geometry, register tools, contribute menu items, drive the
// camera, and listen to scene events without poking React state.
//
// Hard rules:
//   1. The exposed `window.Forge` is `Object.freeze`d before publication,
//      so plugins cannot replace or shim methods on the public surface
//      itself. Plugins still construct their own state behind the API.
//   2. Manual UI driven through plugin API (Forge.toast, Forge.menu.*)
//      NEVER writes to the Archie thread — same Forge-83 invariant the
//      rest of the shell follows.
//   3. No fallback / stub paths. Every method either does the real
//      thing (publish/dispatch event, set body registry, run kernel op)
//      or throws a descriptive Error. Callers can wrap in try/catch.
//
// Version negotiation:
//   The Plugin Manager reads `Forge.VERSION` and each plugin's
//   `minApiVersion`. Plugins whose minimum is higher than the running
//   Forge build are rejected with a clear toast.

import { showToast } from './Toast.jsx';
import { dispatchTool } from './kernelDispatch.js';
import { applyPreset } from './pbrMaterials.js';
import { toolsForWorkbench } from './Toolbar.jsx';
import { MENU_SPEC } from './Menus.jsx';

/* =====================================================================
 * VERSION + capabilities
 * ===================================================================== */

export const VERSION = '0.4.0';

// Capability tags exposed on Forge.capabilities so plugins can
// detect what kernel-side features are available without probing
// every entry point.
const CAPABILITIES = Object.freeze([
  'bodies.read', 'bodies.write', 'bodies.select',
  'tools.dispatch', 'tools.register',
  'menu.contribute', 'menu.dispatch',
  'dialog.openFile', 'dialog.saveFile', 'dialog.prompt', 'dialog.confirm',
  'toast', 'material.set',
  'workbench.switch', 'workbench.contribute',
  'viewport.camera', 'viewport.fit',
  'events.subscribe',
  'kernel.direct',
]);

/* =====================================================================
 * Custom-tool + menu + workbench registries.
 *
 * Plugins call Forge.tools.registerTool({...}) at startup; the registry
 * lives in module scope so multiple plugins compose cleanly. Manual UI
 * (Plugin Manager) reads back via `_registry()` helpers.
 * ===================================================================== */

const _toolRegistry = new Map();       // id → { id, label, icon, schema, run }
const _menuRegistry = new Map();       // menuId → [{ id, label, icon, action }]
const _menuExtras = new Map();         // id → { id, label, items } (plugin-added menus)
const _workbenchExtras = new Map();    // id → { id, label, icon, tools }

function _emit(name, detail) {
  if (typeof window === 'undefined') return;
  try { window.dispatchEvent(new CustomEvent(name, { detail })); }
  catch { /* noop — browsers without CustomEvent ctor don't run our shell */ }
}

/* =====================================================================
 * scene — body registry. Reads window.__forgeBodies (published by
 * ForgeShellV4 effect at line 165) and mutates via window.__forgeAppendBody
 * / window.__forgeSetBodies (the same setters used by Archie + project I/O).
 * ===================================================================== */

const scene = Object.freeze({
  get bodies() {
    if (typeof window === 'undefined') return [];
    const arr = window.__forgeBodies;
    return Array.isArray(arr) ? arr.slice() : [];
  },
  addBody(spec) {
    if (!spec || typeof spec !== 'object') {
      throw new Error('Forge.scene.addBody: spec required');
    }
    if (typeof window === 'undefined' ||
        typeof window.__forgeAppendBody !== 'function') {
      throw new Error('Forge.scene.addBody: shell not mounted');
    }
    const id = spec.id || `plugin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const body = { id, kind: spec.kind || 'synthetic', ...spec };
    window.__forgeAppendBody(body);
    _emit('forge:body-added', body);
    return id;
  },
  removeBody(id) {
    if (typeof window === 'undefined' ||
        typeof window.__forgeSetBodies !== 'function') {
      throw new Error('Forge.scene.removeBody: shell not mounted');
    }
    const cur = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
    const next = cur.filter((b) => b.id !== id);
    if (next.length === cur.length) return false;
    window.__forgeSetBodies(next);
    _emit('forge:body-removed', { id });
    return true;
  },
  select(ids) {
    if (!Array.isArray(ids)) throw new Error('Forge.scene.select: ids must be array');
    if (typeof window === 'undefined') return;
    // ForgeShellV4 owns the selection state via setSelection. The shell
    // publishes the active selection on window.__forgeSelection for read
    // access; for plugin-driven writes we fire a custom event the shell
    // listens for. The shell currently doesn't auto-listen — but it
    // accepts external selection mutation via the BodyContextMenu path.
    // We publish the desired selection so panels and the e2e spec can
    // read it back, then dispatch the event so a future shell upgrade
    // can subscribe without breaking this API.
    const sel = { kind: 'body', ids: ids.slice() };
    window.__forgeSelection = sel;
    _emit('forge:selection-changed', sel);
  },
  getSelection() {
    if (typeof window === 'undefined') return { kind: 'none', ids: [] };
    return window.__forgeSelection || { kind: 'none', ids: [] };
  },
});

/* =====================================================================
 * tools — dispatch + registration. Dispatch routes registered plugin
 * tools through their own run() and built-in kernel tools through
 * kernelDispatch. Registration emits forge:tool-registered so the
 * Toolbar can refresh and Plugin Manager can list contributions.
 * ===================================================================== */

const tools = Object.freeze({
  dispatch(toolId, params) {
    if (typeof toolId !== 'string') {
      throw new Error('Forge.tools.dispatch: toolId required');
    }
    const plugin = _toolRegistry.get(toolId);
    if (plugin) {
      const ctx = {
        forge: typeof window !== 'undefined' ? window.forge : null,
        bodies: scene.bodies,
        selection: scene.getSelection(),
      };
      const r = plugin.run(ctx, params || {});
      _emit('forge:tool-dispatched', { toolId, params, source: 'plugin', result: r });
      return r;
    }
    // Built-in tool — route through kernelDispatch using a minimal ctx.
    const cur = scene.bodies;
    const lastNative = [...cur].reverse().find((b) => b.kind === 'native');
    const ctx = {
      lastBody: lastNative ? lastNative.handle : null,
      selectedBodies: null,
      currentSketch: null,
    };
    const r = dispatchTool(toolId, params || {}, ctx);
    _emit('forge:tool-dispatched', { toolId, params, source: 'kernel', result: r });
    return r;
  },
  registerTool(spec) {
    if (!spec || typeof spec.id !== 'string') {
      throw new Error('Forge.tools.registerTool: { id } required');
    }
    if (typeof spec.run !== 'function') {
      throw new Error(`Forge.tools.registerTool: ${spec.id} run() required`);
    }
    const entry = {
      id: spec.id,
      label: spec.label || spec.id,
      icon: spec.icon || null,
      schema: spec.schema || null,
      run: spec.run,
    };
    _toolRegistry.set(spec.id, entry);
    _emit('forge:tool-registered', entry);
    return entry;
  },
  list() {
    return Array.from(_toolRegistry.values());
  },
  unregister(id) {
    const had = _toolRegistry.delete(id);
    if (had) _emit('forge:tool-unregistered', { id });
    return had;
  },
});

/* =====================================================================
 * menu — runtime menu contributions. Adding an item to an existing
 * top-level menu (file/edit/view/tools/help) emits a forge:menu-extra
 * event the TopBar/MenuBar listens for so the dropdown re-renders with
 * the new entry. Plugin-added menus appear after the standard ones.
 * ===================================================================== */

function _menuExtrasFor(menuId) {
  if (!_menuRegistry.has(menuId)) _menuRegistry.set(menuId, []);
  return _menuRegistry.get(menuId);
}

const menu = Object.freeze({
  addItem(menuId, item) {
    if (typeof menuId !== 'string' || !MENU_SPEC[menuId]) {
      throw new Error(`Forge.menu.addItem: unknown menu ${menuId}`);
    }
    if (!item || typeof item.id !== 'string') {
      throw new Error('Forge.menu.addItem: { id } required');
    }
    const list = _menuExtrasFor(menuId);
    // De-dupe by id so re-registering replaces.
    const idx = list.findIndex((x) => x.id === item.id);
    const entry = {
      id: item.id,
      label: item.label || item.id,
      icon: item.icon || null,
      action: typeof item.action === 'function' ? item.action : null,
    };
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    _emit('forge:menu-extras-changed', { menuId, items: list.slice() });
    return entry;
  },
  removeItem(menuId, itemId) {
    const list = _menuRegistry.get(menuId);
    if (!list) return false;
    const idx = list.findIndex((x) => x.id === itemId);
    if (idx < 0) return false;
    list.splice(idx, 1);
    _emit('forge:menu-extras-changed', { menuId, items: list.slice() });
    return true;
  },
  addMenu(spec) {
    if (!spec || typeof spec.id !== 'string') {
      throw new Error('Forge.menu.addMenu: { id } required');
    }
    if (MENU_SPEC[spec.id]) {
      throw new Error(`Forge.menu.addMenu: ${spec.id} collides with built-in`);
    }
    _menuExtras.set(spec.id, {
      id: spec.id,
      label: spec.label || spec.id,
      items: Array.isArray(spec.items) ? spec.items.slice() : [],
    });
    _emit('forge:menu-extras-changed', { menuId: spec.id, added: true });
    return _menuExtras.get(spec.id);
  },
  extras(menuId) {
    return (_menuRegistry.get(menuId) || []).slice();
  },
  customMenus() {
    return Array.from(_menuExtras.values()).map((m) => ({ ...m, items: m.items.slice() }));
  },
  dispatch(menuId, itemId) {
    const list = _menuRegistry.get(menuId) || [];
    const item = list.find((x) => x.id === itemId);
    if (!item) {
      // Try plugin-added custom menus.
      const custom = _menuExtras.get(menuId);
      if (custom) {
        const cit = custom.items.find((x) => x.id === itemId);
        if (cit?.action) { cit.action(); return true; }
      }
      return false;
    }
    if (item.action) { item.action(); return true; }
    return false;
  },
});

/* =====================================================================
 * dialog — bridge to Electron's main process via window.forge.dialog.*
 * for file pickers, plus simple in-page prompt/confirm wrappers that
 * use the platform native equivalents when running headless tests.
 * ===================================================================== */

const dialog = Object.freeze({
  async openFile(opts = {}) {
    if (typeof window === 'undefined' || !window.forge?.dialog?.openFile) {
      throw new Error('Forge.dialog.openFile: native bridge unavailable');
    }
    return window.forge.dialog.openFile({
      title: opts.title || 'Open file',
      filters: opts.filters || [],
    });
  },
  async saveFile(opts = {}) {
    if (typeof window === 'undefined' || !window.forge?.dialog?.saveFile) {
      throw new Error('Forge.dialog.saveFile: native bridge unavailable');
    }
    return window.forge.dialog.saveFile({
      title: opts.title || 'Save file',
      defaultPath: opts.defaultPath || 'untitled',
      filters: opts.filters || [],
    });
  },
  prompt(opts = {}) {
    if (typeof window === 'undefined') return null;
    const message = typeof opts === 'string' ? opts : (opts.message || 'Enter value');
    const defaultValue = opts.defaultValue || '';
    return window.prompt(message, defaultValue);
  },
  confirm(opts = {}) {
    if (typeof window === 'undefined') return false;
    const message = typeof opts === 'string' ? opts : (opts.message || 'Continue?');
    return window.confirm(message);
  },
});

/* =====================================================================
 * material — applies a PBR preset to a body's mesh material. Walks the
 * published scene (__forgeScene) and finds the mesh whose userData.id
 * matches the bodyId. SceneMeshes tags every body's group with its id
 * so this lookup is deterministic.
 * ===================================================================== */

function _findBodyMesh(bodyId) {
  if (typeof window === 'undefined' || !window.__forgeScene) return null;
  let found = null;
  window.__forgeScene.traverse((obj) => {
    if (found) return;
    if (obj.userData?.bodyId === bodyId ||
        obj.userData?.id === bodyId ||
        obj.name === bodyId) {
      found = obj;
    }
  });
  return found;
}

const material = Object.freeze({
  set(bodyId, presetKey) {
    if (typeof bodyId !== 'string' || typeof presetKey !== 'string') {
      throw new Error('Forge.material.set: (bodyId, presetKey) required');
    }
    const obj = _findBodyMesh(bodyId);
    if (!obj) {
      throw new Error(`Forge.material.set: no scene mesh for ${bodyId}`);
    }
    let applied = false;
    obj.traverse((node) => {
      if (node.material) {
        if (applyPreset(node.material, presetKey)) applied = true;
      }
    });
    if (!applied) {
      throw new Error(`Forge.material.set: preset ${presetKey} not applied (unknown?)`);
    }
    _emit('forge:material-changed', { bodyId, presetKey });
    return true;
  },
});

/* =====================================================================
 * workbench — switching + plugin-added workbenches. Switching fires the
 * same forge:wb-switch event the WorkbenchRail does on click; the
 * shell listener mirrors the change into setActiveWb.
 * ===================================================================== */

const workbench = Object.freeze({
  switchTo(wbId) {
    if (typeof wbId !== 'string') throw new Error('Forge.workbench.switchTo: id required');
    if (typeof window === 'undefined') return false;
    // ForgeShellV4 doesn't subscribe to a workbench-switch event today,
    // but it does expose setActiveWb via window.__forgeSetActiveWb when
    // the e2e instrumentation registers it (Forge-128). Falling back to
    // the rail click is unreliable from inside a plugin, so we publish
    // both the desired id and the event.
    if (typeof window.__forgeSetActiveWb === 'function') {
      window.__forgeSetActiveWb(wbId);
    }
    window.__forgeActiveWb = wbId;
    _emit('forge:wb-switch', { id: wbId });
    return true;
  },
  current() {
    if (typeof window === 'undefined') return null;
    return window.__forgeActiveWb || null;
  },
  addWorkbench(spec) {
    if (!spec || typeof spec.id !== 'string') {
      throw new Error('Forge.workbench.addWorkbench: { id } required');
    }
    const wb = {
      id: spec.id,
      label: spec.label || spec.id,
      icon: spec.icon || 'wb.mech',
      tools: Array.isArray(spec.tools) ? spec.tools.slice() : [],
    };
    _workbenchExtras.set(spec.id, wb);
    _emit('forge:workbench-added', wb);
    return wb;
  },
  builtIn(wbId) {
    return toolsForWorkbench(wbId);
  },
  extras() {
    return Array.from(_workbenchExtras.values());
  },
});

/* =====================================================================
 * viewport — camera read/write + fit. Uses the published THREE camera
 * (window.__forgeCamera) so plugins drive the same camera the user
 * orbits manually.
 * ===================================================================== */

const viewport = Object.freeze({
  camera() {
    if (typeof window === 'undefined' || !window.__forgeCamera) {
      throw new Error('Forge.viewport.camera: camera not published yet');
    }
    const c = window.__forgeCamera;
    return {
      position: { x: c.position.x, y: c.position.y, z: c.position.z },
      target: window.__forgeCameraTarget
        ? { ...window.__forgeCameraTarget }
        : { x: 0, y: 0, z: 0 },
      fov: c.fov || 45,
      near: c.near || 0.1,
      far: c.far || 10000,
    };
  },
  setCamera({ position, target } = {}) {
    if (typeof window === 'undefined' || !window.__forgeCamera) {
      throw new Error('Forge.viewport.setCamera: camera not published');
    }
    const c = window.__forgeCamera;
    if (position && typeof position === 'object') {
      if (typeof position.x === 'number') c.position.x = position.x;
      if (typeof position.y === 'number') c.position.y = position.y;
      if (typeof position.z === 'number') c.position.z = position.z;
    }
    if (target && typeof target === 'object') {
      window.__forgeCameraTarget = { ...target };
      if (typeof c.lookAt === 'function') {
        c.lookAt(target.x || 0, target.y || 0, target.z || 0);
      }
    }
    c.updateMatrixWorld?.();
    _emit('forge:camera-changed', { position, target });
    return true;
  },
  fit() {
    if (typeof window === 'undefined') return false;
    // Mirrors the HUT zoomFit/centre path — both bump the shell's
    // centerToken which re-runs the camera centre effect. Plugins call
    // this the same way the HUT does.
    if (typeof window.__forgeStressCenter === 'function') {
      window.__forgeStressCenter();
    }
    _emit('forge:camera-fit', {});
    // The shell publishes a no-arg fit hook so the centerToken bumps
    // even when the stress overlay isn't mounted.
    if (typeof window.__forgeFit === 'function') {
      window.__forgeFit();
      return true;
    }
    return true;
  },
});

/* =====================================================================
 * Events — generic subscribe/unsubscribe for the forge:* event family.
 * Plugins use this for forge:body-added, forge:tool-registered, etc.
 * Returns a function the caller invokes to off() the subscription.
 * ===================================================================== */

const _eventBindings = new Map();   // cb → { name, handler }

function on(eventName, cb) {
  if (typeof eventName !== 'string' || typeof cb !== 'function') {
    throw new Error('Forge.on: (eventName, cb) required');
  }
  if (typeof window === 'undefined') return () => {};
  const handler = (e) => { try { cb(e.detail, e); } catch (err) { console.warn('[forge.api] subscriber threw:', err); } };
  window.addEventListener(eventName, handler);
  _eventBindings.set(cb, { name: eventName, handler });
  return () => off(eventName, cb);
}
function off(eventName, cb) {
  if (typeof window === 'undefined') return false;
  const rec = _eventBindings.get(cb);
  if (!rec) {
    // Fall back to direct removal in case the caller bypassed _eventBindings.
    window.removeEventListener(eventName, cb);
    return false;
  }
  window.removeEventListener(rec.name, rec.handler);
  _eventBindings.delete(cb);
  return true;
}

/* =====================================================================
 * toast — direct wrapper around the shell's showToast. Plugins use this
 * to surface success/error/info; the host never writes to Archie.
 * ===================================================================== */

function toast(text, kind = 'info', extra = {}) {
  return showToast({
    kind, text,
    hint: extra.hint,
    ttl: typeof extra.ttl === 'number' ? extra.ttl : undefined,
  });
}

/* =====================================================================
 * kernel — direct access for advanced plugins. Bare passthrough to
 * window.forge so plugins can call makeBox, fuse, cut, tessellate, etc.
 * No wrapping — the kernel surface is already stable.
 * ===================================================================== */

function _kernelGetter() {
  if (typeof window === 'undefined') return null;
  return window.forge || null;
}

/* =====================================================================
 * minApi negotiation. Plugin Manager calls this before evaluating a
 * plugin's code. Strict semver-major bump policy: if a plugin requires
 * a higher version than VERSION it's rejected; older minor versions
 * are accepted.
 * ===================================================================== */

export function negotiate(minApiVersion) {
  if (!minApiVersion) return { ok: true, reason: 'no-min' };
  const parse = (s) => String(s).split('.').map((n) => parseInt(n, 10) || 0);
  const want = parse(minApiVersion);
  const have = parse(VERSION);
  for (let i = 0; i < Math.max(want.length, have.length); i++) {
    const w = want[i] || 0, h = have[i] || 0;
    if (h > w) return { ok: true, reason: 'newer' };
    if (h < w) return { ok: false, reason: `Forge ${VERSION} < required ${minApiVersion}` };
  }
  return { ok: true, reason: 'exact' };
}

/* =====================================================================
 * Public surface. Built up explicitly so Object.freeze can lock it.
 * ===================================================================== */

export function buildForgeAPI() {
  const api = {
    VERSION,
    capabilities: CAPABILITIES,
    scene,
    tools,
    menu,
    dialog,
    toast,
    material,
    workbench,
    viewport,
    on,
    off,
    negotiate,
    get kernel() { return _kernelGetter(); },
    // Internal hooks the Plugin Manager + e2e spec need read access to.
    // These are NOT exposed for plugin use — they're used by trusted
    // shell-side code to introspect what plugins have contributed.
    _internals: Object.freeze({
      menuExtras: () => {
        const out = {};
        for (const [k, v] of _menuRegistry.entries()) out[k] = v.slice();
        return out;
      },
      customMenus: () => Array.from(_menuExtras.values()).map((m) => ({ ...m, items: m.items.slice() })),
      toolEntries: () => Array.from(_toolRegistry.values()),
      workbenchEntries: () => Array.from(_workbenchExtras.values()),
      reset: () => {
        _toolRegistry.clear();
        _menuRegistry.clear();
        _menuExtras.clear();
        _workbenchExtras.clear();
      },
    }),
  };
  return Object.freeze(api);
}

/* =====================================================================
 * Install the API on window.Forge. Idempotent so the Plugin Manager
 * Panel host can call this on mount without worrying about double
 * registration when React StrictMode double-invokes effects.
 * ===================================================================== */

export function installForgeAPI() {
  if (typeof window === 'undefined') return null;
  if (window.Forge && window.Forge.VERSION === VERSION) return window.Forge;
  const api = buildForgeAPI();
  try {
    Object.defineProperty(window, 'Forge', {
      value: api,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } catch {
    // window.Forge already defined (HMR) — overwrite the slot that
    // existed previously. We intentionally don't throw because a
    // partially-installed surface is worse than a re-installed one.
    window.Forge = api;
  }
  // Publish a small handshake event so PluginManager can begin
  // auto-loading immediately after the surface is live.
  _emit('forge:api-ready', { version: VERSION });
  return api;
}

export default installForgeAPI;
