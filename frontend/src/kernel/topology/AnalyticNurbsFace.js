/**
 * ArchDisc Geometry Kernel — analytic NURBS face support for the native
 * B-rep topology kernel.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * ArchDisc's topology kernel (`TopoFace`, `TopoEdge`, `TopoLoop`, `TopoShell`,
 * `TopoSolid`) is a real boundary-representation kernel: a `TopoFace` already
 * carries an underlying geometric `surface` and is bounded by loops of edges.
 * Until now the surfaces it carried were the analytic primitives in
 * `kernel/math/Surface.js` (planar / cylindrical / spherical / a coarse NURBS
 * stub).
 *
 * This module gives the topology kernel a FIRST-CLASS analytic NURBS face:
 *
 *   - `NurbsSurfaceAdapter` wraps a pure-JS `foundation/NURBSSurface` so it
 *     presents the `surface` contract a `TopoFace` expects (`pointAt(u,v)`,
 *     `normalAt(u,v)`) while ALSO exposing the exact NURBS data — control net,
 *     knot vectors, degrees, weights — so the face is genuinely analytic, not
 *     a tessellation. STEP export reads this data directly to emit a real
 *     `B_SPLINE_SURFACE_WITH_KNOTS` entity.
 *
 *   - `Pcurve` is the parametric (2-D) representation of a boundary edge on the
 *     analytic surface — the thing OCCT calls a "pcurve" and ISO 10303-42
 *     calls the parametric curve of a `pcurve` / `surface_curve`. A non-planar
 *     B-rep face needs pcurves for every boundary edge; this is the native
 *     ArchDisc carrier for them.
 *
 *   - `makeAnalyticNurbsFace` builds a `TopoFace` on an analytic NURBS surface
 *     with a boundary wire, attaching pcurves to the boundary edges.
 *
 * The face is RETAINED analytically on the body. Tessellation (via
 * `NURBSSurface.tessellate`) is only for rendering — the exact surface is the
 * source of truth.
 *
 * Refs:
 *   ISO 10303-42 — `b_spline_surface_with_knots`, `pcurve`, `curve_bounded_surface`.
 *   Piegl & Tiller, "The NURBS Book" — tensor-product NURBS surfaces.
 */

import TopoFace from './TopoFace.js';
import TopoEdge from './TopoEdge.js';
import TopoLoop from './TopoLoop.js';
import TopoVertex from './TopoVertex.js';
import Vec3 from '../math/Vec3.js';
import { LineCurve } from '../math/Curve.js';
import { projectCurveOnSurface } from '../../foundation/PCurveProjection.js';

/**
 * Adapter: present a `foundation/NURBSSurface` through the `surface` contract
 * that `TopoFace` expects (`pointAt`, `normalAt`), while also exposing the raw
 * NURBS data so the face stays genuinely analytic and STEP-exportable.
 */
export class NurbsSurfaceAdapter {
  /**
   * @param {import('../../foundation/NURBSSurface.js').NURBSSurface} nurbs
   */
  constructor(nurbs) {
    this.type = 'nurbs';
    this.analytic = true;
    this.nurbs = nurbs;
  }

  /** Position on the surface — `TopoFace.surface.pointAt` contract. */
  pointAt(u, v) {
    const p = this.nurbs.eval(u, v);
    return { x: p[0], y: p[1], z: p[2] };
  }

  /** Unit normal at (u,v) — `TopoFace.surface.normalAt` contract. */
  normalAt(u, v) {
    const d = this.nurbs.evalDerivatives(u, v);
    return { x: d.normal[0], y: d.normal[1], z: d.normal[2] };
  }

  /** Parametric domain of the surface. */
  domain() {
    return {
      uMin: this.nurbs.uMin, uMax: this.nurbs.uMax,
      vMin: this.nurbs.vMin, vMax: this.nurbs.vMax,
    };
  }

  /**
   * The exact analytic NURBS data — degrees, control net, weights, knots.
   * STEP export consumes this to emit a `B_SPLINE_SURFACE_WITH_KNOTS`.
   */
  nurbsData() {
    return {
      degreeU: this.nurbs.p,
      degreeV: this.nurbs.q,
      controlNet: this.nurbs.controlNet,
      weights: this.nurbs.weights,
      knotsU: this.nurbs.knotsU,
      knotsV: this.nurbs.knotsV,
    };
  }

  /**
   * SP-1 S6 — the UNIFIED Surface contract method. Every spine `Face`'s surface
   * (OCCT-backed via `OcctSurfaceAdapter` OR spine-native via this adapter)
   * exposes `toBSplineSurface()` returning the same { degreeU, degreeV,
   * controlNet, weights, knotsU, knotsV } shape consumed by
   * `foundation/StepExport.js:nurbsSurfaceToSTEP`. For an analytic face this is
   * the EXACT analytic surface data (lossless); for an OCCT-backed face the
   * OcctSurfaceAdapter sampler approximates a B-spline (when the engine binding
   * allows) or returns null.
   *
   * @returns {{degreeU,degreeV,controlNet,weights,knotsU,knotsV}} the
   *   `B_SPLINE_SURFACE_WITH_KNOTS` payload (analytic surfaces: exact;
   *    engine-backed surfaces: approximate or null).
   */
  toBSplineSurface() {
    return this.nurbsData();
  }

  /** Triangle mesh of the analytic surface — for rendering only. */
  tessellate(opts) {
    return this.nurbs.tessellate(opts);
  }
}

/**
 * A pcurve — the 2-D parametric representation of a boundary edge in the
 * (u,v) space of an analytic surface. Wraps the degree-3 2-D B-spline produced
 * by `foundation/PCurveProjection.js`.
 */
export class Pcurve {
  /**
   * @param {{degree:number,knots:number[],controlPoints:number[][]}} bspline2d
   * @param {object} [diagnostics] projection diagnostics from projectCurveOnSurface
   */
  constructor(bspline2d, diagnostics = {}) {
    this.type = 'pcurve';
    this.degree = bspline2d.degree;
    this.knots = bspline2d.knots;
    this.controlPoints = bspline2d.controlPoints; // [[u,v], ...]
    this.diagnostics = diagnostics;
  }
}

/**
 * Build a `TopoFace` on an analytic NURBS surface.
 *
 * @param {import('../../foundation/NURBSSurface.js').NURBSSurface} nurbs
 * @param {import('./TopoLoop.js').default} outerLoop  the boundary wire
 * @param {import('./TopoLoop.js').default[]} [innerLoops]
 * @returns {TopoFace}  a TopoFace whose `surface` is a NurbsSurfaceAdapter and
 *   whose `userData.analyticNurbs` flags it as a retained analytic face.
 */
export function makeAnalyticNurbsFace(nurbs, outerLoop, innerLoops = []) {
  const adapter = new NurbsSurfaceAdapter(nurbs);
  const face = new TopoFace(adapter, outerLoop, innerLoops);
  face.userData.analyticNurbs = true;
  return face;
}

/**
 * Re-seat a `TopoFace` onto a NEW analytic NURBS surface — the native
 * arbitrary-face-replacement primitive.
 *
 * The face keeps its boundary loops (the edges and their 3-D geometry are
 * unchanged), but its underlying surface is swapped for `newNurbs`. Fresh
 * pcurves for every boundary edge are generated by projecting each edge's
 * 3-D curve onto the new surface (`projectCurveOnSurface`). Each edge gets a
 * `Pcurve` attached, keyed by the face, in `edge.userData.pcurves`.
 *
 * @param {TopoFace} face                       the face to re-seat
 * @param {import('../../foundation/NURBSSurface.js').NURBSSurface} newNurbs
 * @param {object} [opts]
 * @param {number} [opts.edgeSamples=24]  polyline samples per boundary edge
 * @param {number} [opts.gridU], [opts.gridV] point-inversion seed grid
 * @returns {{
 *   face: TopoFace,
 *   pcurves: Pcurve[],
 *   maxProjectionError: number,
 *   maxPushForwardError: number,
 *   degenerate: boolean,
 *   allConverged: boolean
 * }}
 */
export function reseatFaceOnSurface(face, newNurbs, opts = {}) {
  const edgeSamples = Math.max(4, opts.edgeSamples || 24);
  const adapter = new NurbsSurfaceAdapter(newNurbs);

  const pcurves = [];
  let maxProjectionError = 0;
  let maxPushForwardError = 0;
  let degenerate = false;
  let allConverged = true;

  // Walk every boundary edge of the face, project its 3-D curve onto the new
  // surface, fit a pcurve, attach it.
  for (const loop of face.allLoops()) {
    for (const he of loop.halfEdges) {
      const edge = he.edge;
      // Sample the edge's 3-D curve into a polyline (oriented for this loop).
      const poly = sampleEdgePolyline(edge, he.reversed, edgeSamples);
      const proj = projectCurveOnSurface(newNurbs, poly, {
        gridU: opts.gridU || 14,
        gridV: opts.gridV || 14,
      });
      const pc = new Pcurve(proj.pcurve, {
        maxProjectionError: proj.maxProjectionError,
        maxPushForwardError: proj.maxPushForwardError,
        allConverged: proj.allConverged,
        degenerate: proj.degenerate,
      });
      // Attach the pcurve to the edge, keyed by the owning face.
      if (!edge.userData.pcurves) edge.userData.pcurves = new Map();
      edge.userData.pcurves.set(face, pc);
      pcurves.push(pc);

      if (proj.maxProjectionError > maxProjectionError) {
        maxProjectionError = proj.maxProjectionError;
      }
      if (proj.maxPushForwardError > maxPushForwardError) {
        maxPushForwardError = proj.maxPushForwardError;
      }
      if (proj.degenerate) degenerate = true;
      if (!proj.allConverged) allConverged = false;
    }
  }

  // Swap the surface — the face is now analytic on the new NURBS surface.
  face.surface = adapter;
  face.userData.analyticNurbs = true;
  face.userData.reseated = true;

  return {
    face,
    pcurves,
    maxProjectionError,
    maxPushForwardError,
    degenerate,
    allConverged,
  };
}

/**
 * Sample a `TopoEdge`'s 3-D curve into an ordered polyline of points.
 * Honours the half-edge orientation so the polyline runs the way the loop
 * traverses the edge.
 */
function sampleEdgePolyline(edge, reversed, nSamples) {
  const pts = [];
  if (edge.curve && typeof edge.curve.tessellate === 'function') {
    const tess = edge.curve.tessellate(nSamples);
    for (const p of tess) {
      pts.push(toArr(p));
    }
  } else if (edge.curve && typeof edge.curve.pointAt === 'function') {
    for (let i = 0; i <= nSamples; i++) {
      pts.push(toArr(edge.curve.pointAt(i / nSamples)));
    }
  } else {
    // Straight edge — interpolate the two vertices.
    const a = toArr(edge.startVertex.point);
    const b = toArr(edge.endVertex.point);
    for (let i = 0; i <= nSamples; i++) {
      const t = i / nSamples;
      pts.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ]);
    }
  }
  return reversed ? pts.slice().reverse() : pts;
}

/** Coerce a Vec3-like / array point to a plain [x,y,z]. */
function toArr(p) {
  if (Array.isArray(p)) return [p[0], p[1], p[2]];
  return [p.x, p.y, p.z];
}

/**
 * Build a complete, self-bounded analytic NURBS `TopoFace` from a fitted
 * `NURBSSurface`. The boundary wire is the surface's natural rectangular trim
 * — four corner vertices joined by four edges that run along the four
 * parametric domain borders. Each boundary edge gets a `Pcurve` along its
 * domain border (a straight line in (u,v) space — exact for a domain border).
 *
 * This is the native carrier the G2 Blend op uses to RETAIN its fitted
 * degree-3×5 surface as a genuine analytic face on the body.
 *
 * @param {import('../../foundation/NURBSSurface.js').NURBSSurface} nurbs
 * @returns {{
 *   face: TopoFace,
 *   loop: TopoLoop,
 *   edges: TopoEdge[],
 *   vertices: TopoVertex[]
 * }}
 */
export function buildAnalyticNurbsFace(nurbs) {
  const u0 = nurbs.uMin, u1 = nurbs.uMax;
  const v0 = nurbs.vMin, v1 = nurbs.vMax;

  // Four parametric corners — exact surface points.
  const cornersUV = [
    [u0, v0], [u1, v0], [u1, v1], [u0, v1],
  ];
  const cornerXYZ = cornersUV.map(([u, v]) => nurbs.eval(u, v));
  const verts = cornerXYZ.map(
    (p) => new TopoVertex(new Vec3(p[0], p[1], p[2])));

  // Four boundary edges around the rectangular parametric trim. Each carries a
  // LineCurve in 3-D (chord of the domain border) — coarse but topologically
  // correct; the analytic SURFACE is the geometry of record.
  const edges = [];
  for (let i = 0; i < 4; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % 4];
    edges.push(new TopoEdge(a, b, new LineCurve(a.point.clone(), b.point.clone())));
  }

  // The boundary loop — half-edges all forward.
  const loop = new TopoLoop(edges.map((e) => ({ edge: e, reversed: false })));

  // The analytic NURBS face.
  const face = makeAnalyticNurbsFace(nurbs, loop);

  // Attach a pcurve to each boundary edge: a straight 2-D line along the
  // parametric domain border (exact — a domain border IS a u- or v-isoline).
  const borderUV = [
    [cornersUV[0], cornersUV[1]],
    [cornersUV[1], cornersUV[2]],
    [cornersUV[2], cornersUV[3]],
    [cornersUV[3], cornersUV[0]],
  ];
  for (let i = 0; i < 4; i++) {
    const [pa, pb] = borderUV[i];
    const pc = new Pcurve(
      { degree: 1, knots: [0, 0, 1, 1], controlPoints: [pa.slice(), pb.slice()] },
      { domainBorder: true, maxProjectionError: 0, maxPushForwardError: 0 });
    if (!edges[i].userData.pcurves) edges[i].userData.pcurves = new Map();
    edges[i].userData.pcurves.set(face, pc);
  }

  return { face, loop, edges, vertices: verts };
}
