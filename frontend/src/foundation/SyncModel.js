/**
 * ArchDisc Foundation — Direct / synchronous modeling (Phase 6 of
 * Parasolid parity).
 *
 * "Direct" or "synchronous" modeling lets a user grab a face in the
 * viewport and drag it; the modeller then INFERS which parametric
 * feature owns that face and updates its driving parameters so the
 * model rebuilds with the user's intent. This is the inverse of
 * forward feature evaluation and is one of the hardest items in
 * production CAD (NX Synchronous Modeling, SolidWorks Instant3D,
 * Fusion's Direct Edit).
 *
 * Honest scope of this MVP:
 *
 *   - Supports ParametricPart objects whose feature graph is a small
 *     dictionary of named parameters + a build() that produces a
 *     manifold-3d Manifold from those parameters.
 *   - Supports two primitives: ParametricBox and ParametricCylinder.
 *     Each declares which face-normal directions correspond to which
 *     parameter.
 *   - inferEdit(part, faceNormal, dragVector) projects the drag onto
 *     the face normal and updates the matching parameter.
 *   - Re-evaluation is full rebuild (no incremental geometry update).
 *
 * What's NOT in scope here (real Parasolid-grade direct modelling
 * needs all of this and is multi-month):
 *
 *   - Face classification on arbitrary multi-feature solids. We rely
 *     on each parametric primitive declaring its own face → param
 *     mapping; classifying a face produced by, say, "fillet of edge
 *     X of extrude Y" requires the full naming graph from M14.
 *   - Inferring INTENT when a drag matches multiple parameters (e.g.
 *     pushing a fillet face could mean "increase fillet radius" or
 *     "shift the host edge"). NX uses heuristics + conflict resolution.
 *   - Automatic constraint propagation (push one face → adjacent
 *     fillet snaps to new geometry). We rebuild from scratch each edit.
 *
 * The MVP gets to "real numbers from a real direct-edit pipeline".
 * Tier-2 work brings full multi-feature face classification.
 */

import { getManifold } from './manifoldKernel.js';

/**
 * Base class — a part driven by a named-parameter dictionary.
 */
export class ParametricPart {
  constructor(params = {}) {
    this.params = { ...params };
    this._cache = null;
  }

  /**
   * Set a single parameter, invalidating the geometry cache.
   */
  setParam(name, value) {
    if (!(name in this.params))
      throw new Error(`Unknown parameter '${name}' on ${this.constructor.name}. Known: ${Object.keys(this.params).join(', ')}`);
    this.params[name] = value;
    this._cache = null;
  }

  /**
   * Subclasses override this to produce a Manifold from this.params.
   */
  async build() { throw new Error('Subclass must override build()'); }

  /**
   * Get cached or freshly-built Manifold.
   */
  async manifold() {
    if (!this._cache) this._cache = await this.build();
    return this._cache;
  }

  /**
   * Subclasses override to declare:
   *   { faceNormal: [x,y,z],  paramName: '...',  sign: +1|-1 }
   * for each axis-aligned face. inferEdit() looks these up.
   *
   * @returns {Array<{faceNormal: number[], paramName: string, sign: number}>}
   */
  faceMap() { return []; }
}

/**
 * Parametric axis-aligned box anchored at origin (lower-left-front
 * corner), driven by width / depth / height + an optional anchor.
 */
export class ParametricBox extends ParametricPart {
  constructor({ width = 50, depth = 30, height = 10, anchor = [0, 0, 0] } = {}) {
    super({ width, depth, height, ax: anchor[0], ay: anchor[1], az: anchor[2] });
  }

  async build() {
    const { Manifold } = await getManifold();
    return Manifold.cube([this.params.width, this.params.depth, this.params.height], false)
      .translate([this.params.ax, this.params.ay, this.params.az]);
  }

  faceMap() {
    return [
      { axis: 0, positive: true,  paramName: 'width'  },
      { axis: 0, positive: false, paramName: 'width',  anchorParam: 'ax' },
      { axis: 1, positive: true,  paramName: 'depth'  },
      { axis: 1, positive: false, paramName: 'depth',  anchorParam: 'ay' },
      { axis: 2, positive: true,  paramName: 'height' },
      { axis: 2, positive: false, paramName: 'height', anchorParam: 'az' },
    ];
  }
}

/**
 * Parametric cylinder along z-axis from z=0 to z=height, radius R.
 */
export class ParametricCylinder extends ParametricPart {
  constructor({ radius = 5, height = 10, segments = 64 } = {}) {
    super({ radius, height, segments });
  }
  async build() {
    const { Manifold } = await getManifold();
    return Manifold.cylinder(
      this.params.height, this.params.radius, this.params.radius,
      this.params.segments, false,
    );
  }
  faceMap() {
    return [
      // Radial faces — drag outward in any horizontal direction grows the radius.
      // Encoded as 4 axis-aligned approximations of the curved sidewall;
      // inferEdit picks whichever matches the queried face normal best.
      { axis: 0, positive: true,  paramName: 'radius', kind: 'radial' },
      { axis: 0, positive: false, paramName: 'radius', kind: 'radial' },
      { axis: 1, positive: true,  paramName: 'radius', kind: 'radial' },
      { axis: 1, positive: false, paramName: 'radius', kind: 'radial' },
      // Axial caps
      { axis: 2, positive: true,  paramName: 'height' },
      { axis: 2, positive: false, paramName: 'height' },     // bottom cap not anchored — cylinder builds at z=0..H
    ];
  }
}

/**
 * Direct-edit kernel: given a face normal (in world space) and a drag
 * vector (in mm), find the matching parameter and update it. Project
 * the drag onto the face normal — that's the natural "push-pull"
 * displacement.
 *
 * For axis-aligned faces of axis-aligned primitives this is exact. For
 * cylinder radial faces we use any face whose normal is in the radial
 * direction (xy-perpendicular to axis).
 *
 * @param {ParametricPart} part
 * @param {[x,y,z]} faceNormal       outward unit normal of the face being dragged
 * @param {[x,y,z]} dragVector       displacement in world space (mm)
 * @param {number}  dotThreshold     for matching face normal (default 0.7)
 * @returns {{ paramName, oldValue, newValue, delta, action }}
 */
export function inferEdit(part, faceNormal, dragVector, dotThreshold = 0.7) {
  const map = part.faceMap();
  // Pick the face entry whose declared (axis, positive) direction best
  // matches the queried face normal.
  let best = null, bestDot = -Infinity;
  for (const entry of map) {
    const ex = [0, 0, 0]; ex[entry.axis] = entry.positive ? 1 : -1;
    const dot = ex[0] * faceNormal[0] + ex[1] * faceNormal[1] + ex[2] * faceNormal[2];
    if (dot > bestDot) { bestDot = dot; best = entry; }
  }
  if (!best || bestDot < dotThreshold) {
    return { matched: false, dotMatch: bestDot };
  }
  // The "drag along the face's axis" component
  const dragAxis = dragVector[best.axis];
  const oldValue = part.params[best.paramName];
  let newValue = oldValue, anchorChange = null;
  if (best.kind === 'radial') {
    // For cylindrical sidewall: outward push grows radius.
    // Use the absolute drag along the axis (since the radial direction
    // can be ±x or ±y depending on which point on the surface we
    // touched). Use the magnitude in the chosen axis direction.
    const outwardDrag = best.positive ? dragAxis : -dragAxis;
    newValue = oldValue + outwardDrag;
    part.setParam(best.paramName, newValue);
  } else if (best.positive) {
    // Positive face (e.g. +x): part grows by drag projected onto +axis.
    newValue = oldValue + dragAxis;
    part.setParam(best.paramName, newValue);
  } else {
    // Negative face (e.g. -x = anchor face): face moves with drag,
    // anchor follows, and dimension shrinks by drag.
    newValue = oldValue - dragAxis;
    part.setParam(best.paramName, newValue);
    if (best.anchorParam) {
      const oldAnchor = part.params[best.anchorParam];
      anchorChange = { name: best.anchorParam, oldValue: oldAnchor, newValue: oldAnchor + dragAxis };
      part.setParam(best.anchorParam, anchorChange.newValue);
    }
  }
  return {
    matched: true,
    paramName: best.paramName,
    oldValue,
    newValue,
    delta: newValue - oldValue,
    dotMatch: bestDot,
    anchorChange,
    kind: best.kind ?? 'axial',
  };
}

/**
 * Convenience: classify a face on a parametric part by its outward
 * normal alone. Returns the face-map entry matched, or null.
 */
export function classifyFace(part, faceNormal, dotThreshold = 0.85) {
  const map = part.faceMap();
  let best = null, bestDot = -Infinity;
  for (const e of map) {
    const ex = [0, 0, 0]; ex[e.axis] = e.positive ? 1 : -1;
    const dot = ex[0] * faceNormal[0] + ex[1] * faceNormal[1] + ex[2] * faceNormal[2];
    if (dot > bestDot) { bestDot = dot; best = e; }
  }
  return bestDot >= dotThreshold ? best : null;
}
