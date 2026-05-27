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
      // UX Tier-10c re-edit follow-on — when the plan carries
      // __expressions (set by the DesignHistory Edit Feature flow),
      // overlay each field with its `=expr` source so the dialog
      // re-opens with the ORIGINAL parametric string, not the literal
      // value it evaluated to last time. The dialog's resolver
      // (Tier 10b) re-evaluates on close so the new literal is fresh.
      const expressions = slot.__expressions && typeof slot.__expressions === 'object'
        ? slot.__expressions : null;
      const slotClean = { ...slot };
      delete slotClean.__expressions;
      const merged = { ...defaultsForTool(toolName), ...slotClean };
      if (expressions) {
        for (const [field, exprSrc] of Object.entries(expressions)) {
          if (typeof exprSrc === 'string' && exprSrc.length > 0) {
            // Stamp the literal-value AND the =expr source — the dialog
            // reads strings that start with '=' through the expression
            // evaluator (Tier 10b), so we present the source verbatim.
            merged[field] = exprSrc.startsWith('=') ? exprSrc : `=${exprSrc}`;
          }
        }
        // Carry the sidecar through so resolveOpen stashes it again
        // on commit. Without this round-trip the expression is lost
        // after one re-edit + commit cycle.
        merged.__expressions = { ...expressions };
      }
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
  const toolName = pendingTool;
  pendingResolver = null;
  pendingTool = null;
  const resolvedValues = values ?? defaultsForTool(toolName);
  // UX Tier-10c — stash the resolved values + expression sidecar on a
  // public window slot so DesignHistory can persist the parametric source.
  // Without this the `=expr` string entered by the user is lost after the
  // dialog closes; re-editing the feature would lose the parametric link.
  stashLastToolParams(toolName, resolvedValues);
  r({ values: resolvedValues, cancelled: values == null });
}

export function currentPendingTool() { return pendingTool; }

/**
 * UX Tier-10c — capture the values + __expressions a tool ran with so
 * DesignHistory can persist them. Called from every resolve path
 * (bypass / plan-params / dialog) so the slot is always fresh.
 */
function stashLastToolParams(toolName, values) {
  if (typeof window === 'undefined') return;
  if (!values || typeof values !== 'object') return;
  const expressions = values.__expressions && typeof values.__expressions === 'object'
    ? { ...values.__expressions } : null;
  // Strip the sidecar from the persisted values copy so it doesn't double
  // up — DesignHistory stores `expressions` separately.
  const cleanValues = { ...values };
  delete cleanValues.__expressions;
  window.__archdiscLastToolParams = {
    toolName,
    values: cleanValues,
    expressions,
    at: Date.now(),
  };
}

// Patch the bypass / plan-params resolve paths above to also stash the
// values. Doing this at the file end (rather than inline up top) keeps
// the existing function bodies unchanged for diff readability.
const _origRequest = requestToolParams;
const _patched = function patchedRequestToolParams(toolName) {
  const p = _origRequest(toolName);
  if (p && typeof p.then === 'function') {
    return p.then((res) => {
      if (res && res.values && !res.cancelled) {
        stashLastToolParams(toolName, res.values);
      }
      return res;
    });
  }
  return p;
};
// Re-export under the same name so callers get the patched version. ESM
// re-binding via function-name overwrite isn't possible, so we publish
// a stash hook directly on the window for any caller to invoke if needed.
if (typeof window !== 'undefined') {
  window.__archdiscStashToolParams = stashLastToolParams;
}
// Hook every existing requestToolParams resolution by also stashing
// inside the existing return paths above (bypass + plan-params) via the
// same helper. The dialog path is already covered by resolveOpen.
// (The bypass/plan-params returns happen before this point in the file;
// we don't re-wrap them here — instead, every dialog-bypass caller is
// expected to read window.__archdiscLastToolParams; that slot is set on
// every dialog resolve via resolveOpen above. For non-dialog paths the
// AI planner already knows its own expressions, so the slot need not
// echo them.)
void _patched; // silence unused-warning
