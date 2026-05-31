/**
 * Forge assembly-mate JS facade (Forge-7).
 *
 * Mirrors the `window.forge.assembly` surface exposed by
 * `electron/preload.js`, but in a `ForgeAssembly` class that smooths the
 * topoId mnemonics into convenient `add<MateKind>(...)` methods. UI
 * panels and feature scripts should depend on this class, not the raw
 * preload object — that keeps `Assembly.js` as the single place to
 * update if the native API shifts in a later slice.
 */

import { getForge } from './index.js';

// Topo ids — schematic for Forge-7 (see AssemblySolver.hpp comment).
// A future slice swaps these for real OCCT subshape indices.
export const TopoId = Object.freeze({
  Origin:        0,
  PrimaryAxis:   1,
  PrimaryFace:   2,
  SecondaryAxis: 3,
});

export class ForgeAssembly {
  constructor() {
    const f = getForge();
    if (!f.assembly) {
      throw new Error(
        '[forge.assembly] native solver missing — Forge-7 kernel not loaded?',
      );
    }
    this._a = f.assembly;
    this.MateKind = f.assembly.MateKind;
  }

  // ---- pinning ----
  setFixed(instanceId, fixed = true) {
    this._a.setFixed(instanceId, !!fixed);
  }

  // ---- generic add ----
  addMate(kind, instA, topoA, instB, topoB, value = 0) {
    return this._a.addMate(kind, instA, topoA, instB, topoB, value);
  }

  // ---- mate helpers (ergonomics) ----
  /** Axes collinear: shared centreline (e.g. shaft into bore). */
  addConcentric(instA, instB, { axisA = TopoId.PrimaryAxis, axisB = TopoId.PrimaryAxis } = {}) {
    return this._a.addMate(this.MateKind.Concentric, instA, axisA, instB, axisB, 0);
  }

  /** Faces touching + origins on the same surface. */
  addCoincident(instA, instB, { faceA = TopoId.PrimaryFace, faceB = TopoId.PrimaryFace } = {}) {
    return this._a.addMate(this.MateKind.Coincident, instA, faceA, instB, faceB, 0);
  }

  /** Origins separated by `distance` mm. */
  addDistance(instA, instB, distance, { topoA = TopoId.Origin, topoB = TopoId.Origin } = {}) {
    return this._a.addMate(this.MateKind.Distance, instA, topoA, instB, topoB, distance);
  }

  /** Axes parallel (no sign preference). */
  addParallel(instA, instB, { axisA = TopoId.PrimaryAxis, axisB = TopoId.PrimaryAxis } = {}) {
    return this._a.addMate(this.MateKind.Parallel, instA, axisA, instB, axisB, 0);
  }

  /** Axes perpendicular (dot product = 0). */
  addPerpendicular(instA, instB, { axisA = TopoId.PrimaryAxis, axisB = TopoId.PrimaryAxis } = {}) {
    return this._a.addMate(this.MateKind.Perpendicular, instA, axisA, instB, axisB, 0);
  }

  /** Axes form a fixed angle (radians). */
  addAngle(instA, instB, angleRad, { axisA = TopoId.PrimaryAxis, axisB = TopoId.PrimaryAxis } = {}) {
    return this._a.addMate(this.MateKind.Angle, instA, axisA, instB, axisB, angleRad);
  }

  /** Face A tangent to axis/face B (Forge-7: point-on-plane test). */
  addTangent(instA, instB, { faceA = TopoId.PrimaryFace, refB = TopoId.Origin } = {}) {
    return this._a.addMate(this.MateKind.Tangent, instA, faceA, instB, refB, 0);
  }

  // ---- lifecycle ----
  removeMate(id)               { this._a.removeMate(id); }
  setMateActive(id, active)    { this._a.setMateActive(id, !!active); }
  clear()                      { this._a.clear(); }
  count()                      { return this._a.mateCount(); }

  /** Returns `{ converged, iterations, residual }`. */
  solve() { return this._a.solve(); }

  // -------------------------------------------------------------- Forge-35
  // Sub-assembly hierarchy + interference + motion study facades.
  //
  // Every method below is a thin pass-through to the native binding. They
  // raise a descriptive error when the underlying kernel pre-dates Forge-35
  // so callers can fall back to the flat-list assumption.

  setParent(childInstance, parentInstance = 0) {
    if (!this._a.setParent) {
      throw new Error('[forge.assembly] setParent requires a Forge-35+ kernel');
    }
    this._a.setParent(childInstance, parentInstance);
  }
  getChildren(parentInstance = 0) {
    if (!this._a.getChildren) {
      throw new Error('[forge.assembly] getChildren requires a Forge-35+ kernel');
    }
    return Array.from(this._a.getChildren(parentInstance));
  }
  worldTransform(instance) {
    if (!this._a.worldTransform) {
      throw new Error('[forge.assembly] worldTransform requires a Forge-35+ kernel');
    }
    return this._a.worldTransform(instance);
  }
  detectInterference(instances, tolerance = 0) {
    if (!this._a.detectInterference) {
      throw new Error('[forge.assembly] detectInterference requires a Forge-35+ kernel');
    }
    return this._a.detectInterference(instances, tolerance);
  }
  runMotionStudy(motorInstance, motorAxis, totalAngleRad, timeSteps) {
    if (!this._a.runMotionStudy) {
      throw new Error('[forge.assembly] runMotionStudy requires a Forge-35+ kernel');
    }
    return this._a.runMotionStudy(motorInstance, motorAxis, totalAngleRad, timeSteps);
  }
}

// =====================================================================
// Forge-35 — JS classes layered on the native hierarchy.
// =====================================================================

/**
 * ExplodedView — animate a set of instances along per-instance directions
 * away from their current world position. The class keeps the original
 * (pre-explode) world transforms so toggling collapses back to the
 * assembled state without any solver round-trip.
 *
 * Usage:
 *   const ev = new ExplodedView({
 *     instances: [1, 2, 3],
 *     directionPerInstance: { 1: [1,0,0], 2: [0,1,0], 3: [0,0,1] },
 *     distance: 20,           // mm at full explode
 *     animated: true,         // ramp 0→1 over 600 ms via rAF
 *   });
 *   ev.explode();   // animates outward
 *   ev.collapse();  // animates back
 *   ev.setExplodeFraction(0.5); // synchronous, for scrubbers
 *
 * `applyXform(id, transform4x4)` is a pluggable hook so the same class
 * can drive either the native ComponentRegistry (renderer) or a pure
 * Float64Array buffer (smoke tests). Defaults to the native registry.
 */
export class ExplodedView {
  constructor({
    instances,
    directionPerInstance,
    distance = 10,
    animated = false,
    durationMs = 600,
    applyXform = null,
    readXform  = null,
    now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    raf = (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : null),
  } = {}) {
    if (!Array.isArray(instances) || instances.length === 0) {
      throw new Error('[ExplodedView] requires non-empty instances array');
    }
    if (!directionPerInstance || typeof directionPerInstance !== 'object') {
      throw new Error('[ExplodedView] directionPerInstance must be an object');
    }
    this.instances = instances.slice();
    this.directions = { ...directionPerInstance };
    this.distance = distance;
    this.animated = animated;
    this.durationMs = durationMs;
    this._now = now;
    this._raf = raf || ((cb) => setTimeout(() => cb(now()), 16));
    // Snapshot original transforms so we can interpolate from a stable basis.
    this._readXform = readXform || ((id) => {
      const f = getForge();
      return f.assembly && f.assembly.worldTransform
        ? new Float64Array(f.assembly.worldTransform(id))
        : new Float64Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    });
    this._applyXform = applyXform || ((id, m16) => {
      const f = getForge();
      f.updateTransform(id, m16);
    });
    this._original = new Map();
    for (const id of this.instances) {
      this._original.set(id, this._readXform(id));
    }
    this.fraction = 0; // 0 = collapsed, 1 = fully exploded
    this._animHandle = null;
  }

  /** Interpolate every instance to the requested fraction (0..1). */
  setExplodeFraction(fraction) {
    const f = Math.max(0, Math.min(1, fraction));
    this.fraction = f;
    for (const id of this.instances) {
      const dir = this.directions[id] || [1, 0, 0];
      const orig = this._original.get(id);
      const out = new Float64Array(orig);
      // Translate the origin column by f × distance × direction.
      out[3]  = orig[3]  + f * this.distance * dir[0];
      out[7]  = orig[7]  + f * this.distance * dir[1];
      out[11] = orig[11] + f * this.distance * dir[2];
      this._applyXform(id, out);
    }
    return f;
  }

  _ramp(from, to) {
    if (!this.animated) {
      this.setExplodeFraction(to);
      return Promise.resolve(to);
    }
    return new Promise((resolve) => {
      const t0 = this._now();
      const tick = (t) => {
        const elapsed = t - t0;
        const u = Math.max(0, Math.min(1, elapsed / this.durationMs));
        const f = from + (to - from) * u;
        this.setExplodeFraction(f);
        if (u < 1) {
          this._animHandle = this._raf(tick);
        } else {
          this._animHandle = null;
          resolve(to);
        }
      };
      this._animHandle = this._raf(tick);
    });
  }

  explode()  { return this._ramp(this.fraction, 1); }
  collapse() { return this._ramp(this.fraction, 0); }
  toggle()   { return this.fraction > 0.5 ? this.collapse() : this.explode(); }
}

/**
 * BomRollup — walk a sub-assembly tree and aggregate every leaf instance
 * into a `{ partId, qty, mass, totalCost }[]` summary.
 *
 * `partOf(instanceId)` returns the catalogue ID for a given instance —
 * defaults to ComponentRegistry's component handle so duplicate fasteners
 * fold into one BOM row. Override to map a real `Part` model.
 * `massOf(partId)` and `costOf(partId)` are pluggable so callers can plug
 * their material/pricing tables without round-tripping through the kernel.
 */
export function BomRollup(rootInstance, {
  partOf = null,
  massOf = (_partId) => 0,
  costOf = (_partId) => 0,
  forge  = null,
} = {}) {
  const f = forge || (typeof window !== 'undefined' && window.forge ? window.forge : getForge());
  if (!f.assembly || !f.assembly.getChildren) {
    throw new Error('[BomRollup] requires a Forge-35+ kernel with assembly.getChildren');
  }
  // Default partOf: read the underlying ShapeHandle so two instances of
  // the same primitive collapse into a single BOM row.
  const partLookup = partOf || ((id) => `comp-${f.getComponentHandle ? f.getComponentHandle(id) : id}`);

  const rows = new Map(); // partId → row
  const walk = (node) => {
    if (node !== rootInstance) {
      const pid = partLookup(node);
      const r = rows.get(pid) || { partId: pid, qty: 0, mass: 0, totalCost: 0 };
      r.qty += 1;
      r.mass += massOf(pid);
      r.totalCost += costOf(pid);
      rows.set(pid, r);
    }
    const kids = f.assembly.getChildren(node);
    for (const c of kids) walk(c);
  };
  walk(rootInstance);
  return Array.from(rows.values()).sort((a, b) => String(a.partId).localeCompare(String(b.partId)));
}

/**
 * ComponentPattern — generate a list of instance "seed → target"
 * transform plans for any of the four kinds. The caller is expected to
 * `addInstance(seedShape, transformPlan[i].m)` and (optionally) parent
 * each instance under the same sub-assembly as the seed.
 *
 * For consistency with Forge-22's part patterns, the linear/circular/
 * mirror/on-curve parameters mirror the same field names.
 *
 * Returns `Float64Array[]` — each entry is a row-major 4×4 ready to feed
 * into `addInstance`.
 */
export function ComponentPattern({ seedTransform, kind, params = {} }) {
  const seed = seedTransform || new Float64Array([
    1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1,
  ]);
  const translateOf = (dx, dy, dz) => Float64Array.from([
    1, 0, 0, seed[3]  + dx,
    0, 1, 0, seed[7]  + dy,
    0, 0, 1, seed[11] + dz,
    0, 0, 0, 1,
  ]);
  switch (kind) {
    case 'linear': {
      const { count = 2, dx = 0, dy = 0, dz = 0 } = params;
      const out = [];
      for (let i = 0; i < count; ++i) {
        out.push(translateOf(i * dx, i * dy, i * dz));
      }
      return out;
    }
    case 'circular': {
      const { count = 2, axis = [0, 0, 1], center = [0, 0, 0], totalAngleRad = 2 * Math.PI } = params;
      const out = [];
      const step = totalAngleRad / Math.max(1, count - 1);
      const [ax, ay, az] = axis;
      // Rodrigues rotation around (ax,ay,az) by theta, applied to the
      // seed origin vector relative to `center`.
      for (let i = 0; i < count; ++i) {
        const theta = step * i;
        const c = Math.cos(theta), s = Math.sin(theta);
        const t = 1 - c;
        const r00 = c + ax*ax*t,    r01 = ax*ay*t - az*s, r02 = ax*az*t + ay*s;
        const r10 = ay*ax*t + az*s, r11 = c + ay*ay*t,    r12 = ay*az*t - ax*s;
        const r20 = az*ax*t - ay*s, r21 = az*ay*t + ax*s, r22 = c + az*az*t;
        const ox = seed[3]  - center[0];
        const oy = seed[7]  - center[1];
        const oz = seed[11] - center[2];
        const tx = center[0] + r00*ox + r01*oy + r02*oz;
        const ty = center[1] + r10*ox + r11*oy + r12*oz;
        const tz = center[2] + r20*ox + r21*oy + r22*oz;
        out.push(Float64Array.from([
          r00, r01, r02, tx,
          r10, r11, r12, ty,
          r20, r21, r22, tz,
          0,   0,   0,   1,
        ]));
      }
      return out;
    }
    case 'mirror': {
      const { plane = { n: [1, 0, 0], d: 0 } } = params;
      // Reflect the seed translation through plane n·x = d.
      const [nx, ny, nz] = plane.n;
      const d = plane.d ?? 0;
      const sx = seed[3], sy = seed[7], sz = seed[11];
      const dot = nx*sx + ny*sy + nz*sz - d;
      const rx = sx - 2 * dot * nx;
      const ry = sy - 2 * dot * ny;
      const rz = sz - 2 * dot * nz;
      return [
        seed,
        Float64Array.from([
          1, 0, 0, rx,
          0, 1, 0, ry,
          0, 0, 1, rz,
          0, 0, 0, 1,
        ]),
      ];
    }
    case 'on-curve': {
      const { curve = [], count = 2 } = params; // curve is an array of [x,y,z] samples
      if (curve.length < 2) {
        throw new Error('[ComponentPattern] on-curve requires ≥ 2 curve samples');
      }
      const out = [];
      for (let i = 0; i < count; ++i) {
        const u = count === 1 ? 0 : i / (count - 1);
        const idxF = u * (curve.length - 1);
        const idx0 = Math.floor(idxF);
        const idx1 = Math.min(curve.length - 1, idx0 + 1);
        const t = idxF - idx0;
        const a = curve[idx0], b = curve[idx1];
        const px = a[0] + (b[0] - a[0]) * t;
        const py = a[1] + (b[1] - a[1]) * t;
        const pz = a[2] + (b[2] - a[2]) * t;
        out.push(Float64Array.from([
          1, 0, 0, px,
          0, 1, 0, py,
          0, 0, 1, pz,
          0, 0, 0, 1,
        ]));
      }
      return out;
    }
    default:
      throw new Error(`[ComponentPattern] unknown kind '${kind}'`);
  }
}

/**
 * SmartComponent — wraps a `Configuration`-style map so the same
 * instance handle can resolve to different actual parts depending on the
 * runtime context (e.g. an M3 vs M6 bolt picked from the same row in the
 * fastener catalogue).
 *
 * `configMap` is `{ [contextKey]: partId }`. The caller switches contexts
 * via `setContext(key)` and queries `currentPartId()` before adding an
 * instance into the ComponentRegistry.
 */
export class SmartComponent {
  constructor({ partId = null, configMap = {}, defaultKey = 'default' } = {}) {
    this.configMap = { ...configMap };
    this.defaultKey = defaultKey;
    this._activeKey = defaultKey;
    if (partId !== null && !(defaultKey in this.configMap)) {
      this.configMap[defaultKey] = partId;
    }
  }
  setContext(key) {
    if (!(key in this.configMap)) {
      throw new Error(`[SmartComponent] unknown context key '${key}'`);
    }
    this._activeKey = key;
  }
  currentContext() { return this._activeKey; }
  currentPartId() {
    return this.configMap[this._activeKey] ?? this.configMap[this.defaultKey] ?? null;
  }
  configurations() { return Object.keys(this.configMap); }
}

export default ForgeAssembly;
