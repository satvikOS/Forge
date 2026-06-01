// Forge-89 — assembly dispatch.
//
// Thin guarded wrapper around `window.forge.assembly.*`. Every entry point
// short-circuits to `{ ok:false, error:'kernel not ready' }` when the
// native OCCT bridge isn't installed, so the panel never throws.
//
// All functions are pure with respect to the kernel calls they make —
// they accept structured input + return structured output. No React
// state, no DOM access, no logging side effects on the happy path.

const KERNEL_NOT_READY = { ok: false, error: 'kernel not ready' };

function asm() {
  if (typeof window === 'undefined') return null;
  const a = window.forge?.assembly;
  return a || null;
}

function ready() {
  return asm() != null;
}

/** The MateKind enum, pulled from the native binding when available. */
export const MATE_KINDS = ['Coincident','Distance','Angle','Parallel',
                          'Perpendicular','Tangent','Concentric','Fixed'];

export function mateKindEnum() {
  return asm()?.MateKind || MATE_KINDS.reduce((o, k, i) => { o[k] = i; return o; }, {});
}

/**
 * Add a mate. `kind` is either the enum key (string) or the raw int.
 * a / b are { inst, token } records. Returns `{ ok, mateId }` or error.
 */
export function addMate({ kind, a, b, value }) {
  if (!ready()) return KERNEL_NOT_READY;
  const A = asm();
  const enumVal = typeof kind === 'string' ? A.MateKind?.[kind] : kind;
  if (enumVal == null) return { ok: false, error: `unknown mate kind: ${kind}` };
  if (!a || a.inst == null) return { ok: false, error: 'A is required' };
  if (!b || b.inst == null) return { ok: false, error: 'B is required' };
  try {
    const id = A.addMate(enumVal,
      a.inst, a.token ?? 0,
      b.inst, b.token ?? 0,
      typeof value === 'number' ? value : 0);
    return { ok: true, mateId: id, kind, a, b, value: value ?? 0 };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

export function removeMate(id) {
  if (!ready()) return KERNEL_NOT_READY;
  try { asm().removeMate(id); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message || String(err) }; }
}

export function setMateActive(id, on) {
  if (!ready()) return KERNEL_NOT_READY;
  try { asm().setMateActive(id, !!on); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message || String(err) }; }
}

export function setFixed(inst, on) {
  if (!ready()) return KERNEL_NOT_READY;
  try { asm().setFixed(inst, !!on); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message || String(err) }; }
}

export function setParent(child, parent) {
  if (!ready() || !asm().setParent) return KERNEL_NOT_READY;
  try { asm().setParent(child, parent ?? 0); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message || String(err) }; }
}

/**
 * Solve the assembly graph + collect updated transforms.
 * Returns `{ ok, status, instances: [{ id, transform, dof }] }`. The DOF
 * is a best-effort estimate: 6 per body minus 1 per active constraint.
 */
export function solveAndCollect(mates) {
  if (!ready()) return KERNEL_NOT_READY;
  const A = asm();
  try {
    const status = A.solve();
    const instances = [];
    const seen = new Set();
    const collect = (id) => {
      if (id == null || seen.has(id)) return;
      seen.add(id);
      const t = A.worldTransform ? A.worldTransform(id) : null;
      const consumed = Array.isArray(mates)
        ? mates.filter((m) => m.active !== false &&
            (m.a?.inst === id || m.b?.inst === id)).length
        : 0;
      instances.push({ id, transform: t, dof: Math.max(0, 6 - consumed) });
    };
    if (Array.isArray(mates)) {
      for (const m of mates) {
        if (m.a?.inst != null) collect(m.a.inst);
        if (m.b?.inst != null) collect(m.b.inst);
      }
    }
    return { ok: true, status, instances };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

export function detectInterference(ids, tol = 0) {
  if (!ready() || !asm().detectInterference) return KERNEL_NOT_READY;
  try {
    const pairs = asm().detectInterference(ids ?? [], tol);
    return { ok: true, pairs: Array.isArray(pairs) ? pairs : [] };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

export function runMotion(mateId, axis, totalRad, steps) {
  if (!ready() || !asm().runMotionStudy) return KERNEL_NOT_READY;
  if (!Array.isArray(axis) || axis.length !== 3) {
    return { ok: false, error: 'axis must be [x,y,z]' };
  }
  const n = Math.max(2, Math.min(360, Math.round(steps || 24)));
  try {
    const frames = asm().runMotionStudy(mateId, axis, +totalRad || 0, n);
    return { ok: true, frames: Array.isArray(frames) ? frames : [] };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

export function getChildren(parent) {
  if (!ready() || !asm().getChildren) return { ok: false, error: 'kernel not ready' };
  try { return { ok: true, children: asm().getChildren(parent ?? 0) }; }
  catch (err) { return { ok: false, error: err.message || String(err) }; }
}

export function mateCount() {
  if (!ready()) return 0;
  try { return asm().mateCount() || 0; } catch { return 0; }
}

export function clearAll() {
  if (!ready()) return KERNEL_NOT_READY;
  try { asm().clear(); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message || String(err) }; }
}

export function isKernelReady() { return ready(); }
