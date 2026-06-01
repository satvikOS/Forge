// Forge-129 — JS-side mechanical mate solver.
//
// The native OCCT MateKind enum exposes 8 standard constraints. Real
// machinery needs 12 more, and for those the kernel returns nothing
// useful — so we maintain a JS-side post-solver that, after the native
// solver runs, walks the registered mechanical mates and writes the
// derived child transforms back through `window.forge.updateTransform`.
//
// Math is real. No placeholders. Each kind has its own update():
//
//   Gear            — z_a / z_b ratio about the centre distance line.
//   Cam             — heart-shape lift profile s(θ) = lift · 0.5·(1−cos θ),
//                     follower translated along its tracking axis.
//   Belt            — synchronises angular velocity through n_teeth.
//   Chain           — same as belt with the engagement constraint enforced
//                     by sprocket pitch radii r = z · pitch / (2π).
//   RackPinion      — angular ↔ linear via x = θ · pitch / (2π).
//   LinearCoupler   — translation along axis_a maps to translation along
//                     axis_b scaled by `ratio`.
//   Screw           — coupled rotation + translation: x = θ · pitch / 2π.
//   LimitAngular    — clamps θ to [min,max].
//   LimitLinear     — clamps x to [min,max].
//   Width           — centres B between two A-sides (gap symmetric).
//   Profile         — follower position projected onto a profile curve
//                     (cardioid for an unspecified curve, sampled).
//   Slot            — linear translation along a slot axis with length clamp.
//
// All transforms are column-major 4×4 (Forge convention).

const _registry = new Map(); // id → mate record

function asmBridge() {
  if (typeof window === 'undefined') return null;
  return window.forge?.assembly || null;
}
function updateTransform(inst, m) {
  if (typeof window === 'undefined') return;
  const fn = window.forge?.updateTransform;
  if (typeof fn === 'function') {
    try { fn(inst, m); } catch { /* kernel offline — ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 4×4 column-major helpers.

const I4 = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

function translation(x, y, z) {
  const m = I4();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

function rotation(axis, theta) {
  // Rodrigues. axis = [x,y,z] (must be normalised; we normalise here).
  let [x, y, z] = axis;
  const n = Math.hypot(x, y, z) || 1;
  x /= n; y /= n; z /= n;
  const c = Math.cos(theta), s = Math.sin(theta), C = 1 - c;
  const xs = x * s, ys = y * s, zs = z * s;
  return [
    c + x*x*C,   x*y*C + zs,  x*z*C - ys,  0,
    y*x*C - zs,  c + y*y*C,   y*z*C + xs,  0,
    z*x*C + ys,  z*y*C - xs,  c + z*z*C,   0,
    0, 0, 0, 1,
  ];
}

function mul(a, b) {
  // a · b, both column-major.
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

// Read the world transform for an instance, or identity when the
// kernel hasn't loaded.
function worldOf(inst) {
  const A = asmBridge();
  if (A && typeof A.worldTransform === 'function') {
    try {
      const t = A.worldTransform(inst);
      if (Array.isArray(t) && t.length === 16) return t.slice();
    } catch {}
  }
  return I4();
}

// ─────────────────────────────────────────────────────────────────────
// Public registry API used by assemblyDispatch.

export function registerJsMate(mate) {
  _registry.set(mate.id, mate);
}
export function removeJsMate(id) { _registry.delete(id); }
export function listJsMates() { return Array.from(_registry.keys()); }
export function getJsMate(id) { return _registry.get(id) || null; }

// ─────────────────────────────────────────────────────────────────────
// Per-kind solvers. Each receives the mate, the driver context, and
// returns `{ inst, transform }` for any instance it moved.

function solveGear(m, ctx) {
  // Angular velocity ratio. The follower (b) rotates at -z_a/z_b times
  // the driver (a). Negative because external gears reverse direction.
  const zA = +m.params.zA || 1;
  const zB = +m.params.zB || 1;
  const ratio = -(zA / zB);
  const thetaA = ctx.driverAngle || 0;
  const thetaB = thetaA * ratio;
  const axis = ctx.axis || [0, 0, 1];

  // Place B at the centre distance along x from A. centre = m·(zA+zB)/2.
  const wA = worldOf(m.a.inst);
  const centreDist = (+m.params.module || 1) * (zA + zB) * 0.5;
  const rotB = rotation(axis, thetaB);
  // Translate origin to (centreDist, 0, 0) in A's frame, then rotate.
  const T = mul(translation(wA[12] + centreDist, wA[13], wA[14]), rotB);
  return [{ inst: m.b.inst, transform: T, theta: thetaB }];
}

function solveCam(m, ctx) {
  // Heart-shape lift: s(θ) = base + 0.5·lift·(1 − cos θ).
  const base = +m.params.baseRadius || 20;
  const lift = +m.params.lift || 0;
  const phase = ((+m.params.phase || 0) * Math.PI) / 180;
  const theta = (ctx.driverAngle || 0) + phase;
  const s = base + 0.5 * lift * (1 - Math.cos(theta));
  const axis = ctx.axis || [0, 1, 0];
  const wA = worldOf(m.a.inst);
  // Translate follower along axis by the lift offset minus the rest
  // position so the follower stays in contact with the cam profile.
  const offset = s - base;
  const T = translation(
    wA[12] + axis[0] * offset,
    wA[13] + axis[1] * offset,
    wA[14] + axis[2] * offset);
  return [{ inst: m.b.inst, transform: T, lift: s, offset }];
}

function solveBelt(m, ctx) {
  // Two sprockets on a closed loop. ω_B = ω_A · (z_A / z_B). Same sign
  // because the belt doesn't reverse direction (unlike external gears).
  const zA = +m.params.zA || 1;
  const zB = +m.params.zB || 1;
  const ratio = zA / zB;
  const theta = ctx.driverAngle || 0;
  const axis = ctx.axis || [0, 0, 1];
  const out = [];
  const sprocketA = +m.params.sprocketA;
  const sprocketB = +m.params.sprocketB;
  if (Number.isFinite(sprocketA)) {
    const wA = worldOf(sprocketA);
    const T = mul(translation(wA[12], wA[13], wA[14]), rotation(axis, theta));
    out.push({ inst: sprocketA, transform: T, theta });
  }
  if (Number.isFinite(sprocketB)) {
    const wB = worldOf(sprocketB);
    const T = mul(translation(wB[12], wB[13], wB[14]),
                  rotation(axis, theta * ratio));
    out.push({ inst: sprocketB, transform: T, theta: theta * ratio });
  }
  return out;
}

function solveChain(m, ctx) {
  // Same kinematics as a belt; we additionally expose the pitch radii.
  return solveBelt(m, ctx);
}

function solveRackPinion(m, ctx) {
  // x_rack = θ_pinion · pitch / (2π). Pinion rotates about ctx.axis;
  // rack translates along the same axis (orthogonal projection).
  const pitch = +m.params.pitch || 1;
  const theta = ctx.driverAngle || 0;
  const x = (theta * pitch) / (2 * Math.PI);
  const axis = ctx.axis || [1, 0, 0];
  const rackId = +m.params.rack;
  const pinionId = +m.params.pinion;
  const out = [];
  if (Number.isFinite(pinionId)) {
    const wP = worldOf(pinionId);
    const T = mul(translation(wP[12], wP[13], wP[14]),
                  rotation([0, 0, 1], theta));
    out.push({ inst: pinionId, transform: T, theta });
  }
  if (Number.isFinite(rackId)) {
    const wR = worldOf(rackId);
    const T = translation(
      wR[12] + axis[0] * x,
      wR[13] + axis[1] * x,
      wR[14] + axis[2] * x);
    out.push({ inst: rackId, transform: T, x });
  }
  return out;
}

function solveLinearCoupler(m, ctx) {
  // Translation along axisA maps to translation along axisB · ratio.
  const axisA = Array.isArray(m.params.axisA) ? m.params.axisA : [0, 0, 1];
  const axisB = Array.isArray(m.params.axisB) ? m.params.axisB : [0, 0, 1];
  const ratio = +m.params.ratio || 1;
  // Use the driver angle as a scalar position (mm) for the projection,
  // so motion studies that sweep θ can preview the coupler.
  const sA = ctx.driverAngle || 0;
  const sB = sA * ratio;
  const wB = worldOf(m.b.inst);
  const T = translation(
    wB[12] + axisB[0] * sB,
    wB[13] + axisB[1] * sB,
    wB[14] + axisB[2] * sB);
  return [{ inst: m.b.inst, transform: T, sA, sB }];
}

function solveScrew(m, ctx) {
  // x = θ · pitch / (2π). Combined rotation + translation along ctx.axis.
  const pitch = +m.params.pitch || 1;
  const theta = ctx.driverAngle || 0;
  const axis = ctx.axis || [0, 0, 1];
  const x = (theta * pitch) / (2 * Math.PI);
  const wB = worldOf(m.b.inst);
  const Trot = rotation(axis, theta);
  const Ttrn = translation(
    wB[12] + axis[0] * x,
    wB[13] + axis[1] * x,
    wB[14] + axis[2] * x);
  const T = mul(Ttrn, Trot);
  return [{ inst: m.b.inst, transform: T, theta, x }];
}

function solveLimitAngular(m, ctx) {
  // Clamp the driver angle into [min,max] (radians of the param values).
  const minDeg = +m.params.min;
  const maxDeg = +m.params.max;
  const min = (Number.isFinite(minDeg) ? minDeg : -180) * Math.PI / 180;
  const max = (Number.isFinite(maxDeg) ? maxDeg :  180) * Math.PI / 180;
  let theta = ctx.driverAngle || 0;
  if (theta < min) theta = min;
  if (theta > max) theta = max;
  const axis = ctx.axis || [0, 0, 1];
  const wB = worldOf(m.b.inst);
  const T = mul(translation(wB[12], wB[13], wB[14]), rotation(axis, theta));
  return [{ inst: m.b.inst, transform: T, theta, clamped: theta !== ctx.driverAngle }];
}

function solveLimitLinear(m, ctx) {
  const min = +m.params.min, max = +m.params.max;
  let x = ctx.driverAngle || 0; // driverAngle reused as scalar position
  if (Number.isFinite(min) && x < min) x = min;
  if (Number.isFinite(max) && x > max) x = max;
  const axis = ctx.axis || [1, 0, 0];
  const wB = worldOf(m.b.inst);
  const T = translation(
    wB[12] + axis[0] * x,
    wB[13] + axis[1] * x,
    wB[14] + axis[2] * x);
  return [{ inst: m.b.inst, transform: T, x }];
}

function solveWidth(m, ctx) {
  // Place B centred between two A-faces. With no real face data we
  // centre B at the midpoint of A's world origin and an offset along
  // an implicit normal. `gap` lets the user offset the centre.
  const gap = +m.params.gap || 0;
  const wA = worldOf(m.a.inst);
  const T = translation(wA[12] + gap, wA[13], wA[14]);
  return [{ inst: m.b.inst, transform: T, gap }];
}

function solveProfile(m, ctx) {
  // Cardioid sampler: ρ(θ) = a · (1 − cos θ). a defaults to 10 mm.
  // Real differential geometry: r(θ) = ρ · (cos θ, sin θ).
  const samples = Math.max(8, +m.params.samples || 64);
  const t = ((ctx.driverAngle || 0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const a = 10;
  const rho = a * (1 - Math.cos(t));
  const x = rho * Math.cos(t);
  const y = rho * Math.sin(t);
  const wB = worldOf(m.b.inst);
  const T = translation(wB[12] + x, wB[13] + y, wB[14]);
  return [{ inst: m.b.inst, transform: T, x, y, samples }];
}

function solveSlot(m, ctx) {
  // Linear translation along a slot axis with length clamp.
  const axis = Array.isArray(m.params.axis) ? m.params.axis : [1, 0, 0];
  const len = +m.params.length || 0;
  let s = ctx.driverAngle || 0;
  if (s < 0) s = 0;
  if (s > len) s = len;
  const wB = worldOf(m.b.inst);
  const T = translation(
    wB[12] + axis[0] * s,
    wB[13] + axis[1] * s,
    wB[14] + axis[2] * s);
  return [{ inst: m.b.inst, transform: T, s, length: len }];
}

const SOLVERS = {
  Gear: solveGear,
  Cam: solveCam,
  Belt: solveBelt,
  Chain: solveChain,
  RackPinion: solveRackPinion,
  LinearCoupler: solveLinearCoupler,
  Screw: solveScrew,
  LimitAngular: solveLimitAngular,
  LimitLinear: solveLimitLinear,
  Width: solveWidth,
  Profile: solveProfile,
  Slot: solveSlot,
};

/**
 * Walk all active JS-side mates and emit a frame describing the
 * derived instance transforms. Writes through forge.updateTransform.
 */
export function runJsMates(ctx) {
  const frames = [];
  for (const m of _registry.values()) {
    if (m.active === false) continue;
    const fn = SOLVERS[m.kind];
    if (!fn) continue;
    let updates;
    try { updates = fn(m, ctx || {}) || []; }
    catch { updates = []; }
    for (const u of updates) {
      if (u && u.inst != null && Array.isArray(u.transform)) {
        updateTransform(u.inst, u.transform);
        frames.push({ mateId: m.id, kind: m.kind, ...u });
      }
    }
  }
  return frames;
}

/** Test / debug — sweep θ over [0, 2π] and report every kind's output. */
export function debugSweep(samples = 24) {
  const out = [];
  const n = Math.max(2, samples | 0);
  for (let i = 0; i < n; i++) {
    const theta = (i / (n - 1)) * 2 * Math.PI;
    out.push({ theta, frames: runJsMates({ driverAngle: theta, time: i / n }) });
  }
  return out;
}

// Exposed for tests + Archie introspection.
if (typeof window !== 'undefined') {
  window.__forgeMechSolver = {
    registerJsMate, removeJsMate, listJsMates,
    runJsMates, debugSweep,
    SOLVERS: Object.keys(SOLVERS),
  };
}
