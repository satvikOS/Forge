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
function liveForge() { return (typeof window !== 'undefined' && window.forge) ? window.forge : null; }

const _f3 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 1000) / 1000 : v);

// Read-only world AABB + centre for a body. Prefers the assembly
// registry's instance AABB (already world-space); otherwise tessellates
// the raw body handle (the same read pattern InertiaTensorPanel uses).
// PURE READ — never mutates the kernel or React state; never throws.
function bodyExtent(forge, b) {
  if (!forge) return null;
  try {
    // World AABB straight from the assembly registry when this body is a
    // placed instance (transform already baked in).
    if (b.instanceId != null && typeof forge.getInstanceAABB === 'function') {
      const a = forge.getInstanceAABB(b.instanceId);
      if (a && a.length >= 6) {
        return { min: [a[0], a[1], a[2]], max: [a[3], a[4], a[5]] };
      }
    }
    if (b.handle != null && typeof forge.tessellate === 'function') {
      const t = forge.tessellate(b.handle, 0.5, 0.8);
      const P = t && (t.positions || t.vertices);
      if (P && P.length >= 3) {
        const mn = [Infinity, Infinity, Infinity];
        const mx = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < P.length; i += 3) {
          for (let k = 0; k < 3; k++) {
            const v = P[i + k];
            if (v < mn[k]) mn[k] = v;
            if (v > mx[k]) mx[k] = v;
          }
        }
        if (isFinite(mn[0])) return { min: mn, max: mx };
      }
    }
  } catch (_) { /* read-only best-effort */ }
  return null;
}

// Summarise the live mate-constraint graph (assembly.*) as a read-only
// text block so a training row can encode the surrounding assembly.
// PURE READ — only mateCount()/instanceCount(); never solves or mutates.
function matesSection(forge) {
  if (!forge || !forge.assembly) return '';
  try {
    const mc = typeof forge.assembly.mateCount === 'function' ? forge.assembly.mateCount() : 0;
    const ic = typeof forge.instanceCount === 'function' ? forge.instanceCount() : 0;
    if (!mc && !ic) return '';
    return `Mates: ${mc} mate${mc === 1 ? '' : 's'} across ${ic} placed instance${ic === 1 ? '' : 's'}.\n`;
  } catch (_) { return ''; }
}

export function forgeSelectionContext() {
  const bs = bodies();
  if (!bs.length) return '';
  const sid = selId();
  const forge = liveForge();
  const lines = bs.map((b, i) => {
    const sel = (sid != null && (b.id === sid || b.handle === sid)) ? ' [SELECTED]' : '';
    const pj = Object.entries(b.params || {}).map(([k, v]) => `${k}:${v}`).join(', ');
    // Surrounding-design context: world position + AABB per body so a
    // training row encodes where each part sits relative to its neighbours.
    let where = '';
    const ext = bodyExtent(forge, b);
    if (ext) {
      const cx = _f3((ext.min[0] + ext.max[0]) / 2);
      const cy = _f3((ext.min[1] + ext.max[1]) / 2);
      const cz = _f3((ext.min[2] + ext.max[2]) / 2);
      where = ` pos=[${cx},${cy},${cz}]`
            + ` aabb=[${ext.min.map(_f3).join(',')}]..[${ext.max.map(_f3).join(',')}]`;
    }
    return `  body handle=${b.handle != null ? b.handle : i} ${b.name || b.toolId || b.id} (${b.toolId || '?'}){${pj}}${where}${sel}`;
  });
  const mates = matesSection(forge);
  return `<viewport_state>\nScene has ${bs.length} ${bs.length === 1 ? 'body' : 'bodies'}:\n${lines.join('\n')}\n`
       + mates
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
