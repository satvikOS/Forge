/**
 * ArchDisc Forge — Weldments (Forge-24)
 *
 * Thin JS facade over the native `forge.weldments.*` namespace.
 *
 * Each `structuralMember` returns a root handle that carries a
 * `MemberRecord` (profile, length, weight). Subsequent ops (end caps,
 * gussets, beads, trims) propagate that metadata so `cutList(roots)`
 * returns a BOM-ready array.
 */

import { getForge } from './index.js';

let _kernelOverride = null;
/** Test seam — Node smoke runners inject the native kernel directly. */
export function _setForgeKernel(kernel) { _kernelOverride = kernel; }
function _kernel() { return _kernelOverride || getForge(); }

export class ForgeWeldments {
  constructor() {
    const k = _kernel();
    if (!k.weldments) {
      throw new Error('[forge.weldments] native namespace missing — older kernel?');
    }
    this._w = k.weldments;
  }

  /** Build a single line edge as a path seed for structuralMember. */
  makePathEdge(x0, y0, z0, x1, y1, z1)        { return this._w.makePathEdge(x0, y0, z0, x1, y1, z1); }

  /**
   * Sweep a structural profile along a path's straight-segment approximation.
   * @param {number} pathSketchHandle  shape handle whose first edge is the centerline
   * @param {{kind:string, name?:string, dims:Object}} profile  e.g. { kind:'RectTube', dims:{w:50, h:50, t:3} }
   * @param {string} alignment  one of: 'centroid' | 'top-left' | 'top-right' | ...
   * @returns {number} new root handle
   */
  structuralMember(pathSketchHandle, profile, alignment = 'centroid') {
    return this._w.structuralMember(pathSketchHandle, profile, alignment);
  }

  /** Cap a tube end. */
  endCap(shape, openingEdgeId, capThickness, offsetMm = 0) {
    return this._w.endCap(shape, openingEdgeId, capThickness, offsetMm);
  }

  /** Triangular reinforcement at a joint. */
  gusset(shape, vertexId, gussetSize, thickness) {
    return this._w.gusset(shape, vertexId, gussetSize, thickness);
  }

  /** Add a weld bead along the given edges. `beadKind` ∈ {'fillet','square-groove','V-groove'}. */
  weldBead(shape, edgeIds, beadSize, beadKind = 'fillet') {
    return this._w.weldBead(shape, edgeIds, beadSize, beadKind);
  }

  /** Trim member A against member B. `mode` ∈ {'butt','miter','coped'}. */
  trimMember(memberA, memberB, mode = 'butt') {
    return this._w.trimMember(memberA, memberB, mode);
  }

  /**
   * Returns `[{ memberId, profileName, length, qty, weight, trim, miterDeg }, ...]`.
   * Accepts a single root handle or an array of handles (concatenates).
   */
  cutList(weldmentRoots) {
    return this._w.cutList(weldmentRoots);
  }
}

export default ForgeWeldments;
