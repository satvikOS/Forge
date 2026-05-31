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
}

export default ForgeAssembly;
