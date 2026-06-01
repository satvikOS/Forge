// Forge-89 / Forge-129 — assembly dispatch.
//
// Thin guarded wrapper around `window.forge.assembly.*`. Every entry point
// short-circuits to `{ ok:false, error:'kernel not ready' }` when the
// native OCCT bridge isn't installed, so the panel never throws.
//
// All functions are pure with respect to the kernel calls they make —
// they accept structured input + return structured output. No React
// state, no DOM access, no logging side effects on the happy path.
//
// Forge-129 — extends the native MateKind enum with 12 advanced kinds
// that are post-solved in JS:
//   Gear, Cam, Belt, Chain, RackPinion, LinearCoupler, Screw,
//   LimitAngular, LimitLinear, Width, Profile, Slot
// JS-side mates are stored in a module-local registry. solveAndCollect()
// dispatches them to MechanicalMateSolver after the native solver runs,
// which writes derived transforms via window.forge.updateTransform.

import { runJsMates, registerJsMate, removeJsMate, listJsMates } from
  './MechanicalMateSolver.js';

const KERNEL_NOT_READY = { ok: false, error: 'kernel not ready' };

function asm() {
  if (typeof window === 'undefined') return null;
  const a = window.forge?.assembly;
  return a || null;
}

function ready() {
  return asm() != null;
}

// ─────────────────────────────────────────────────────────────────────
// Mate kind catalogue.
//
// The first 8 are native OCCT enum entries; the remaining 12 are
// JS-side mates handled by MechanicalMateSolver.

export const NATIVE_MATE_KINDS = [
  'Coincident', 'Distance', 'Angle', 'Parallel',
  'Perpendicular', 'Tangent', 'Concentric', 'Fixed',
];

export const JS_MATE_KINDS = [
  'Gear', 'Cam', 'Belt', 'Chain',
  'RackPinion', 'LinearCoupler', 'Screw',
  'LimitAngular', 'LimitLinear',
  'Width', 'Profile', 'Slot',
];

export const MATE_KINDS = [...NATIVE_MATE_KINDS, ...JS_MATE_KINDS];

// Categorised view used by the AssemblyPanel dropdown.
export const MATE_CATEGORIES = [
  { id: 'standard', label: 'Standard',
    kinds: ['Coincident', 'Distance', 'Angle', 'Parallel',
            'Perpendicular', 'Tangent', 'Concentric', 'Fixed'] },
  { id: 'mechanical', label: 'Mechanical',
    kinds: ['Gear', 'Cam', 'Belt', 'Chain', 'RackPinion',
            'LinearCoupler', 'Screw'] },
  { id: 'advanced', label: 'Advanced',
    kinds: ['Width', 'Profile', 'Slot'] },
  { id: 'limits', label: 'Limits',
    kinds: ['LimitAngular', 'LimitLinear'] },
];

// Params surface for each kind. The AssemblyPanel uses this to render the
// correct form fields. `unit` only documents the value; the field is a
// plain number input. `required` rejects the Apply until populated.
export const MATE_PARAM_SCHEMA = {
  Coincident:    [],
  Distance:      [{ key: 'value',  label: 'Distance', unit: 'mm',  required: false, default: 0 }],
  Angle:         [{ key: 'value',  label: 'Angle',    unit: 'deg', required: false, default: 0 }],
  Parallel:      [],
  Perpendicular: [],
  Tangent:       [],
  Concentric:    [],
  Fixed:         [],
  Gear: [
    { key: 'zA',     label: 'Teeth A',  unit: 'count',  required: true, default: 24 },
    { key: 'zB',     label: 'Teeth B',  unit: 'count',  required: true, default: 36 },
    { key: 'module', label: 'Module',   unit: 'mm',     required: true, default: 2 },
  ],
  Cam: [
    { key: 'baseRadius', label: 'Base radius', unit: 'mm',  required: true, default: 20 },
    { key: 'lift',       label: 'Lift',        unit: 'mm',  required: true, default: 8 },
    { key: 'phase',      label: 'Phase',       unit: 'deg', required: false, default: 0 },
  ],
  Belt: [
    { key: 'sprocketA', label: 'Sprocket A inst', unit: 'inst',  required: true },
    { key: 'sprocketB', label: 'Sprocket B inst', unit: 'inst',  required: true },
    { key: 'zA',        label: 'Teeth A',         unit: 'count', required: true, default: 18 },
    { key: 'zB',        label: 'Teeth B',         unit: 'count', required: true, default: 36 },
  ],
  Chain: [
    { key: 'links',     label: 'Links',     unit: 'count', required: true, default: 40 },
    { key: 'sprocketA', label: 'Sprocket A inst', unit: 'inst',  required: true },
    { key: 'sprocketB', label: 'Sprocket B inst', unit: 'inst',  required: true },
    { key: 'zA',        label: 'Teeth A',  unit: 'count', required: true, default: 16 },
    { key: 'zB',        label: 'Teeth B',  unit: 'count', required: true, default: 16 },
  ],
  RackPinion: [
    { key: 'rack',      label: 'Rack inst',   unit: 'inst', required: true },
    { key: 'pinion',    label: 'Pinion inst', unit: 'inst', required: true },
    { key: 'pitch',     label: 'Pitch',       unit: 'mm/rev', required: true, default: 12.566 },
  ],
  LinearCoupler: [
    { key: 'axisA',     label: 'Axis A (xyz)', unit: 'vec3',  required: true,
      default: [0, 0, 1] },
    { key: 'axisB',     label: 'Axis B (xyz)', unit: 'vec3',  required: true,
      default: [0, 0, 1] },
    { key: 'ratio',     label: 'Ratio',        unit: 'scalar',required: true, default: 1 },
  ],
  Screw: [
    { key: 'pitch',     label: 'Pitch',  unit: 'mm/rev', required: true, default: 1.5 },
  ],
  LimitAngular: [
    { key: 'min',       label: 'Min angle', unit: 'deg', required: true, default: -45 },
    { key: 'max',       label: 'Max angle', unit: 'deg', required: true, default:  45 },
  ],
  LimitLinear: [
    { key: 'min',       label: 'Min',    unit: 'mm', required: true, default: 0 },
    { key: 'max',       label: 'Max',    unit: 'mm', required: true, default: 50 },
  ],
  Width: [
    { key: 'gap',       label: 'Gap',    unit: 'mm', required: false, default: 0 },
  ],
  Profile: [
    { key: 'samples',   label: 'Samples', unit: 'count', required: false, default: 64 },
  ],
  Slot: [
    { key: 'axis',      label: 'Axis (xyz)', unit: 'vec3', required: true,
      default: [1, 0, 0] },
    { key: 'length',    label: 'Length',     unit: 'mm',   required: true, default: 20 },
  ],
};

export function paramSchemaFor(kind) {
  return MATE_PARAM_SCHEMA[kind] || [];
}

export function isJsMateKind(kind) {
  return JS_MATE_KINDS.indexOf(kind) >= 0;
}

export function mateKindEnum() {
  return asm()?.MateKind || NATIVE_MATE_KINDS.reduce(
    (o, k, i) => { o[k] = i; return o; }, {});
}

// ─────────────────────────────────────────────────────────────────────
// JS-side mate registry — anything not natively expressed by OCCT lives
// here. Each entry carries the kind, the two instances, and the
// per-kind params bag. solveAndCollect() runs them after the native
// solver.

let _jsNextId = 1;
const _jsMates = new Map();      // id (string) → mate record

function makeJsId(kind) { return `js:${kind}:${_jsNextId++}`; }

export function listAllJsMates() {
  return Array.from(_jsMates.values());
}

// ─────────────────────────────────────────────────────────────────────
// Add / remove / toggle mates. Native + JS kinds share one external API.

/**
 * Add a mate. `kind` is either a native enum key (string), a JS kind
 * key (string), or a raw native int. a / b are { inst, token } records.
 * `params` is the per-kind bag (see MATE_PARAM_SCHEMA).
 * Returns `{ ok, mateId }` or error.
 */
export function addMate({ kind, a, b, value, params }) {
  if (!a || a.inst == null) return { ok: false, error: 'A is required' };
  if (!b || b.inst == null) return { ok: false, error: 'B is required' };

  // JS-side kinds bypass the native bridge entirely.
  if (typeof kind === 'string' && isJsMateKind(kind)) {
    const id = makeJsId(kind);
    const rec = {
      id, kind, a, b,
      params: { ...(params || {}) },
      value: typeof value === 'number' ? value : 0,
      active: true,
      jsSide: true,
    };
    _jsMates.set(id, rec);
    registerJsMate(rec);
    return { ok: true, mateId: id, kind, a, b, params: rec.params, jsSide: true };
  }

  if (!ready()) return KERNEL_NOT_READY;
  const A = asm();
  const enumVal = typeof kind === 'string' ? A.MateKind?.[kind] : kind;
  if (enumVal == null) return { ok: false, error: `unknown mate kind: ${kind}` };
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
  if (typeof id === 'string' && id.startsWith('js:')) {
    _jsMates.delete(id);
    removeJsMate(id);
    return { ok: true };
  }
  if (!ready()) return KERNEL_NOT_READY;
  try { asm().removeMate(id); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message || String(err) }; }
}

export function setMateActive(id, on) {
  if (typeof id === 'string' && id.startsWith('js:')) {
    const m = _jsMates.get(id);
    if (m) m.active = !!on;
    return { ok: true };
  }
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
 *
 * After the native solver returns, we run the JS-side mate post-solver
 * which writes derived transforms back through window.forge.updateTransform.
 */
export function solveAndCollect(mates) {
  if (!ready()) {
    // Even in kernel-offline mode we still want JS-side mates to run
    // (e.g. gear ratio preview) so the UI can demonstrate the math.
    const r = runJsMates({ driverAngle: 0, time: 0 });
    return { ok: false, error: 'kernel not ready', jsFrames: r };
  }
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
    // Run JS post-solver so mechanical mates can drive their followers.
    const jsFrames = runJsMates({ driverAngle: 0, time: 0 });
    return { ok: true, status, instances, jsFrames };
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
  if (!Array.isArray(axis) || axis.length !== 3) {
    return { ok: false, error: 'axis must be [x,y,z]' };
  }
  const n = Math.max(2, Math.min(360, Math.round(steps || 24)));

  // JS-side mate driver — sweep theta and call runJsMates per step.
  if (typeof mateId === 'string' && mateId.startsWith('js:')) {
    const frames = [];
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1);
      const theta = t * (+totalRad || 0);
      const instances = runJsMates({ driverAngle: theta, time: t,
                                     driverMateId: mateId, axis });
      frames.push({ step: i, theta, instances });
    }
    return { ok: true, frames };
  }

  if (!ready() || !asm().runMotionStudy) return KERNEL_NOT_READY;
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
  let n = _jsMates.size;
  if (ready()) {
    try { n += asm().mateCount() || 0; } catch {}
  }
  return n;
}

export function clearAll() {
  _jsMates.clear();
  if (typeof listJsMates === 'function') {
    for (const id of listJsMates()) removeJsMate(id);
  }
  if (!ready()) return KERNEL_NOT_READY;
  try { asm().clear(); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message || String(err) }; }
}

export function isKernelReady() { return ready(); }
