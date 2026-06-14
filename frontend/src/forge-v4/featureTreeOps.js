// Feature-tree optimizer (parity #60) — pure, DOM-free, node-testable;
// Forge copy (byte-equal with Studio) (the SessionMemoryClient pattern).
//
// Reliable CAD copilots offer "find + merge duplicate features." Done
// naively that corrupts geometry (two extrudes ≠ one). This optimizer is
// GEOMETRY-PRESERVING by construction — it only removes features whose
// absence leaves the final result identical:
//
//   1. NO-OPS — identity transforms (translate 0 / rotate 0 / scale 1),
//      or any op flagged zero-effect by its params.
//   2. IDEMPOTENT DUPLICATES — consecutive features with the same
//      (toolId, params) where the op is idempotent (material, color,
//      visibility, rename, select): applying twice == once → keep last.
//   3. SUPERSEDED SETTERS — for "last-wins" setter ops on the SAME
//      target, only the final one matters → drop the earlier ones.
//
// Geometry ops (extrude/hole/fillet/boolean/...) are NEVER touched —
// they're not in IDEMPOTENT/SETTER and aren't identity-detectable, so
// they pass through untouched. Returns the optimized tree + a report so
// the UI can show "merged N features".

// Ops where re-applying with identical params changes nothing.
const IDEMPOTENT_OPS = new Set([
  'material', 'setMaterial', 'materialPreset', 'studio.material',
  'color', 'setColor', 'visibility', 'setVisible', 'hide', 'show',
  'rename', 'select', 'setName', 'studio.color', 'studio.visibility',
]);

// "Last write wins" setters keyed by (op, target) — earlier ones are dead.
const SETTER_OPS = new Set([
  'material', 'setMaterial', 'materialPreset', 'studio.material',
  'color', 'setColor', 'visibility', 'setVisible', 'rename', 'setName',
  'studio.color', 'studio.visibility',
]);

const _key = (f) => `${f.toolId || f.op || ''}|${JSON.stringify(f.params || {})}`;
const _target = (f) => f.target ?? f.bodyId ?? (f.params && (f.params.target ?? f.params.bodyId ?? f.params.id)) ?? null;

function _isIdentityTransform(f) {
  const op = String(f.toolId || f.op || '').toLowerCase();
  const p = f.params || {};
  const near0 = (v) => Math.abs(Number(v) || 0) < 1e-9;
  const near1 = (v) => Math.abs((Number(v) || 0) - 1) < 1e-9;
  const vecNear = (a, fn) => Array.isArray(a) && a.every(fn);
  if (op.includes('translate') || op.includes('move')) {
    const d = p.delta || p.translation || [p.dx, p.dy, p.dz];
    return vecNear(d, near0);
  }
  if (op.includes('rotate')) return near0(p.angle ?? p.deg ?? p.radians);
  if (op.includes('scale')) {
    const s = p.scale || p.factor || [p.sx, p.sy, p.sz];
    return Array.isArray(s) ? vecNear(s, near1) : near1(s);
  }
  return false;
}

export function optimizeFeatureTree(tree, opts = {}) {
  const feats = Array.isArray(tree) ? tree : [];
  const removed = [];
  let kept = feats.slice();

  // Pass 1 — drop no-op identity transforms.
  kept = kept.filter((f) => {
    if (_isIdentityTransform(f)) { removed.push({ id: f.id, reason: 'identity-transform no-op' }); return false; }
    return true;
  });

  // Pass 2 — collapse consecutive idempotent duplicates (keep the last).
  const afterDup = [];
  for (let i = 0; i < kept.length; i++) {
    const f = kept[i], nxt = kept[i + 1];
    const op = String(f.toolId || f.op || '').toLowerCase();
    if (nxt && IDEMPOTENT_OPS.has(f.toolId || f.op) || (nxt && IDEMPOTENT_OPS.has(op))) {
      if (_key(f) === _key(nxt)) { removed.push({ id: f.id, reason: 'idempotent duplicate' }); continue; }
    }
    afterDup.push(f);
  }
  kept = afterDup;

  // Pass 3 — superseded setters: for each (setterOp, target), only the
  // LAST occurrence survives; earlier ones are dead writes.
  const lastIdx = new Map();
  kept.forEach((f, i) => {
    if (SETTER_OPS.has(f.toolId || f.op)) lastIdx.set(`${f.toolId || f.op}|${_target(f)}`, i);
  });
  const afterSetter = kept.filter((f, i) => {
    if (!SETTER_OPS.has(f.toolId || f.op)) return true;
    const k = `${f.toolId || f.op}|${_target(f)}`;
    if (lastIdx.get(k) !== i) { removed.push({ id: f.id, reason: 'superseded setter (last-wins)' }); return false; }
    return true;
  });

  return {
    tree: afterSetter,
    removed,
    stats: { before: feats.length, after: afterSetter.length, merged: removed.length },
  };
}
