/**
 * Forge NURBS surfacing (Forge-36).
 *
 * Wraps `forge.surfacing.*` from the preload bridge. Every operation that
 * yields a TopoDS shape returns a `ForgeBody`; evaluation / projection /
 * Class-A QA return plain data so callers can fold them into their own UI
 * state. The face inputs are always `ForgeBody` handles — patches built
 * via `buildPatch` are themselves bodies that other forge ops (tessellate,
 * massProps, …) can consume directly.
 */

import { getForge, ForgeBody } from './index.js';

function requireSurfacing() {
  const f = getForge();
  if (!f.surfacing) {
    throw new Error('[forge.surfacing] not present on bridge — rebuild forge-kernel >= Forge-36');
  }
  return f.surfacing;
}

function toFloat64(xyz) {
  if (xyz instanceof Float64Array) return xyz;
  if (Array.isArray(xyz)) return Float64Array.from(xyz);
  throw new Error('[forge.surfacing] xyz must be Float64Array or number[]');
}

export class ForgeSurfacing {
  /**
   * Build a NURBS patch from a 2D control-point grid.
   * `grid = { uCount, vCount, xyz }` where `xyz` is row-major (u runs
   * fastest) with `uCount * vCount * 3` doubles. Returns a `ForgeBody`.
   */
  static buildPatch(grid, { uDegree = 3, vDegree = 3, uKnots, vKnots } = {}) {
    const packed = { uCount: grid.uCount, vCount: grid.vCount, xyz: toFloat64(grid.xyz) };
    const h = requireSurfacing().buildPatch(packed, uDegree, vDegree,
                                            uKnots ? toFloat64(uKnots) : null,
                                            vKnots ? toFloat64(vKnots) : null);
    return new ForgeBody(h, { source: 'surfacing.buildPatch', uDegree, vDegree });
  }

  /**
   * Trim a NURBS face with a 2D (u, v) wire. `trimUV` is a flat array of
   * (u, v) pairs that close into a polygon.
   */
  static trim(face, trimUV) {
    const h = requireSurfacing().trim(face.handle, toFloat64(trimUV));
    return new ForgeBody(h, { source: 'surfacing.trim' });
  }

  /** Sew an array of `ForgeBody` faces into a single shell. */
  static sew(faces, tolerance = 1e-3) {
    if (!Array.isArray(faces) || faces.length < 2) {
      throw new Error('[forge.surfacing.sew] need >= 2 faces');
    }
    const handles = faces.map((b) => b.handle);
    const h = requireSurfacing().sew(handles, tolerance);
    return new ForgeBody(h, { source: 'surfacing.sew', tolerance });
  }

  /** Refine a NURBS face by increasing its u/v degree. */
  static refine(face, uTimes = 1, vTimes = 1) {
    const h = requireSurfacing().refine(face.handle, uTimes, vTimes);
    return new ForgeBody(h, { source: 'surfacing.refine', uTimes, vTimes });
  }

  /** Evaluate point + first derivatives + curvature at (u, v). */
  static eval(face, u, v) {
    return requireSurfacing().eval(face.handle, u, v);
  }

  /** BRepAlgoAPI_Section between two faces; returns the section compound. */
  static intersect(faceA, faceB) {
    const h = requireSurfacing().intersect(faceA.handle, faceB.handle);
    return new ForgeBody(h, { source: 'surfacing.intersect' });
  }

  /** Project a 3D point onto the face — returns `{ uv, point, distance }`. */
  static projectPoint(face, pt) {
    const arr = pt instanceof Float64Array ? pt : Float64Array.from(pt);
    return requireSurfacing().projectPoint(face.handle, arr);
  }

  /**
   * Class-A QA: returns a Gauss-curvature spread + isophote bucket count.
   * For a Class-A reference (sphere, plane) the spread should be tight and
   * the bucket count low.
   */
  static classAAnalyse(face, samples = 16) {
    return requireSurfacing().classAAnalyse(face.handle, samples);
  }
}
