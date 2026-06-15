// Forge selection-aware editing + parametric adjust (tasks #56/#59/#60).
//
// #59 selection-context — forgeSelectionContext() summarises the live scene
//     (window.__forgeBodies) + the current selection into a <viewport_state>
//     block Archie reads, so "fillet the selected part" / "make the bore bigger"
//     resolve to the right body handle. ForgeRunner auto-prepends it.
// #56 parametric-reliability + local-slider adjust — forgeAdjustParam(bodyId,
//     param, value) re-invokes the body's OWN builder (toolId) with one param
//     changed → a fresh, deterministic body. Same params → same geometry.
// #60 feature-tree / region re-prompt — forgeEditSelected(instruction) runs Archie
//     with the selection context so it edits the selected body in place.

import { dispatchToolCall } from '../ai/ForgeToolBridge.js';

function bodies() { return (typeof window !== 'undefined' && Array.isArray(window.__forgeBodies)) ? window.__forgeBodies : []; }
function selection() { return (typeof window !== 'undefined') ? window.__forgeSelection : null; }
function selId() { const s = selection(); return s && (s.id != null ? s.id : (typeof s === 'string' ? s : null)); }

export function forgeSelectionContext() {
  const bs = bodies();
  if (!bs.length) return '';
  const sid = selId();
  const lines = bs.map((b, i) => {
    const sel = (sid != null && (b.id === sid || b.handle === sid)) ? ' [SELECTED]' : '';
    const pj = Object.entries(b.params || {}).map(([k, v]) => `${k}:${v}`).join(', ');
    return `  body handle=${b.handle != null ? b.handle : i} ${b.name || b.toolId || b.id} (${b.toolId || '?'}){${pj}}${sel}`;
  });
  return `<viewport_state>\nScene has ${bs.length} ${bs.length === 1 ? 'body' : 'bodies'}:\n${lines.join('\n')}\n`
       + `Pass a body's handle as "shape" to edit it (fillet/chamfer/shell/cut/translate/etc.).\n</viewport_state>`;
}

// Re-parametrize a body: rebuild from its builder with one param overridden.
export async function forgeAdjustParam(bodyId, param, value, opts = {}) {
  const b = bodies().find((x) => x.id === bodyId || x.handle === bodyId);
  if (!b) return { ok: false, error: `no body ${bodyId}` };
  if (!b.toolId) return { ok: false, error: `body ${bodyId} has no toolId to rebuild` };
  const params = { ...(b.params || {}), [param]: value };
  const resp = await dispatchToolCall({ name: b.toolId, arguments: params }, opts.forge ? { forge: opts.forge } : {});
  if (!resp.ok) return { ok: false, error: resp.error };
  const handle = resp.result && resp.result.shape;
  if (typeof window !== 'undefined' && typeof window.__forgeAppendBody === 'function' && !opts.noCommit) {
    window.__forgeAppendBody({ ...b, handle, params, name: b.name || b.toolId });
  }
  return { ok: true, handle, params, toolId: b.toolId };
}

// Edit the selected body in place via Archie, with selection context prepended.
export async function forgeEditSelected(instruction, opts = {}) {
  if (typeof window === 'undefined' || typeof window.__forgeRun !== 'function') return { ok: false, error: '__forgeRun unavailable' };
  const ctx = forgeSelectionContext();
  return window.__forgeRun({ prompt: instruction, discipline: 'part', viewportState: ctx, ...opts });
}

export function installForgeEdit() {
  if (typeof window === 'undefined') return;
  window.__forgeSelectionContext = forgeSelectionContext;
  window.__forgeAdjustParam = (id, p, v, o) => forgeAdjustParam(id, p, v, o || {});
  window.__forgeEditSelected = (instr, o) => forgeEditSelected(instr, o || {});
}

export default installForgeEdit;
