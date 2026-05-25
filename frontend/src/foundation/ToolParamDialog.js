/**
 * Async coordinator between ToolExecutionEngine and ToolParamDialog.
 *
 * Handlers call `requestToolParams(toolName)` which returns a
 * promise that resolves to `{values, cancelled}`. The React
 * component (mounted once at the app root) listens for "open"
 * events and calls `resolveOpen(values | null)` when the user
 * submits or cancels.
 *
 * Why a side-channel rather than React state: handlers live in
 * ToolExecutionEngine, a plain JS module. Crossing that boundary
 * via context would require threading a hook through every tool
 * dispatch. A tiny event-emitter keeps the handler code clean.
 *
 * E2E bypass: setting `window.__archdiscBypassDialog = true`
 * resolves immediately with the schema defaults. All existing
 * tests use this so they don't have to UI-drive the modal.
 */

import { getSchemaForTool, defaultsForTool, TOOL_PARAM_SCHEMAS } from './ToolParamSchemas.js';

const listeners = new Set();
let pendingResolver = null;
let pendingTool = null;

/** Called by handlers. Resolves to {values, cancelled}. */
export function requestToolParams(toolName) {
  // Planner-supplied overrides: when a plan step carries `params`,
  // the executor stashes them on window.__archdiscPlanParams[toolName]
  // for one-shot consumption. Merge with defaults; drop the slot
  // after use so the next manual click reverts to the dialog.
  if (typeof window !== 'undefined') {
    const slot = window.__archdiscPlanParams?.[toolName];
    if (slot && typeof slot === 'object') {
      delete window.__archdiscPlanParams[toolName];
      const merged = { ...defaultsForTool(toolName), ...slot };
      // UX Tier-12a — when the plan carries legacy <name>X/<name>Y/<name>Z
      // keys for a tool whose schema declares a `vector` field with
      // matching `legacyKeys`, fold them into the vector value so the
      // handler's `values.<vector>.x/y/z` reads stay consistent. AI plans
      // / pre-12a callers wrote dirX/dirY/dirZ directly; the merge above
      // would otherwise leave the vector at its default (e.g. +Z) and the
      // handler would silently pick the default. We do this lazily here
      // because the schema lives in a separate module — importing it for
      // every dispatch would re-trigger the schema-init cycle.
      try {
        const sch = TOOL_PARAM_SCHEMAS?.[toolName];
        if (sch && Array.isArray(sch.fields)) {
          for (const f of sch.fields) {
            if (f.type !== 'vector' || !f.legacyKeys) continue;
            const lx = f.legacyKeys.x, ly = f.legacyKeys.y, lz = f.legacyKeys.z;
            if (slot[lx] !== undefined || slot[ly] !== undefined || slot[lz] !== undefined) {
              const cur = merged[f.name] && typeof merged[f.name] === 'object'
                ? merged[f.name] : { mode: 'custom', x: 0, y: 0, z: 0 };
              merged[f.name] = {
                ...cur,
                mode: 'custom',
                x: slot[lx] !== undefined ? Number(slot[lx]) || 0 : cur.x ?? 0,
                y: slot[ly] !== undefined ? Number(slot[ly]) || 0 : cur.y ?? 0,
                z: slot[lz] !== undefined ? Number(slot[lz]) || 0 : cur.z ?? 0,
              };
            }
          }
        }
      } catch { /* schema lookup failed — fall through, handler legacy-key fallback covers it */ }
      return Promise.resolve({ values: merged, cancelled: false });
    }
  }
  // Bypass mode: explicit opt-in, OR auto-on under Playwright /
  // Selenium where navigator.webdriver is true (so existing e2e
  // suites that don't UI-drive the modal keep passing). Tests
  // that want to actually exercise the dialog set
  // window.__archdiscBypassDialog = false before triggering.
  if (typeof window !== 'undefined') {
    const explicit = window.__archdiscBypassDialog;
    const automated = explicit === undefined && typeof navigator !== 'undefined' && navigator.webdriver;
    if (explicit === true || (explicit !== false && automated)) {
      return Promise.resolve({ values: defaultsForTool(toolName), cancelled: false });
    }
  }
  const schema = getSchemaForTool(toolName);
  if (!schema) {
    return Promise.resolve({ values: {}, cancelled: false });
  }
  return new Promise((resolve) => {
    pendingResolver = resolve;
    pendingTool = toolName;
    for (const fn of listeners) {
      try { fn({ toolName, schema }); } catch (err) { console.warn('param dialog listener', err); }
    }
  });
}

/** Subscribe to open-events (the React component does this once). */
export function onParamRequest(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Called by the React component on submit/cancel. */
export function resolveOpen(values) {
  if (!pendingResolver) return;
  const r = pendingResolver;
  pendingResolver = null;
  pendingTool = null;
  r({ values: values ?? defaultsForTool(pendingTool), cancelled: values == null });
}

export function currentPendingTool() { return pendingTool; }
