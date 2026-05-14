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

import { getSchemaForTool, defaultsForTool } from './ToolParamSchemas.js';

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
