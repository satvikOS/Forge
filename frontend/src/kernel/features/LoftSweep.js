/**
 * @deprecated SP-1 S7 — Model C (kernel/features/*) — QUARANTINED 2026-05-23.
 * Dead pre-OCCT demo kernel. Production loft / sweep route through
 * kernel/brep/BrepSurfacing.js + BrepFinal.js (OCCT BRepOffsetAPI_MakePipe /
 * ThruSections / MakePipeShell) and produce SpineBodies. This native-JS
 * loft/sweep is NOT used by any ribbon op.
 *
 * NEW CODE MUST NOT IMPORT THIS FILE. See PrimitiveBuilder.js header for the
 * full quarantine context.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ArchDisc Geometry Kernel — Loft & Sweep
 * Loft: Creates a solid by interpolating between two or more profiles.
 * Sweep: Extrudes a profile along a curve path.
 */

import Vec3, { EPSILON } from '../math/Vec3.js';
import Mat4 from '../math/Mat4.js';
import { LineCurve } from '../math/Curve.js';
import { PlanarSurface } from '../math/Surface.js';
import Plane from '../math/Plane.js';
import TopoVertex from '../topology/TopoVertex.js';
import TopoEdge from '../topology/TopoEdge.js';
import TopoLoop from '../topology/TopoLoop.js';
import TopoFace from '../topology/TopoFace.js';
import TopoShell from '../topology/TopoShell.js';
import TopoSolid from '../topology/TopoSolid.js';

export default class LoftSweep {

  /**
   * Loft between two or more profiles.
   * Profiles must have the same number of points.
   * @param {Vec3[][]} profiles - Array of ordered point arrays (each profile is a closed polygon)
   * @param {number} steps - Interpolation steps between profiles (default: 1 per pair)
   * @param {boolean} closed - Close the loft into a loop (default: false)
   * @returns {TopoSolid}
   */
  static loft(profiles, steps = 1, closed = false) {
    if (profiles.length < 2) throw new Error('Loft requires at least 2 profiles');

    const pointCount = profiles[0].length;
    for (const p of profiles) {
      if (p.length !== pointCount) {
        throw new Error('All profiles must have the same number of points');
      }
    }

    // Generate interpolated rings
    const rings = [];
    for (let p = 0; p < profiles.length - 1; p++) {
      const from = profiles[p];
      const to = profiles[p + 1];
      for (let s = 0; s <= steps; s++) {
        if (s === steps && p < profiles.length - 2) continue; // avoid duplicate
        const t = s / steps;
        const ring = from.map((pt, i) => new TopoVertex(pt.lerp(to[i], t)));
        rings.push(ring);
      }
    }

    if (closed && rings.length > 2) {
      rings.push(rings[0]); // wrap around
    }

    return LoftSweep._buildSolidFromRings(rings, pointCount, closed, 'Loft');
  }

  /**
   * Sweep a profile along a path curve.
   * @param {Vec3[]} profile - Closed profile points (in XY plane, centered at origin)
   * @param {Vec3[]} pathPoints - Ordered points along the sweep path
   * @param {boolean} closedPath - Is the path a closed loop?
   * @returns {TopoSolid}
   */
  static sweep(profile, pathPoints, closedPath = false) {
    if (pathPoints.length < 2) throw new Error('Sweep path needs at least 2 points');
    if (profile.length < 3) throw new Error('Sweep profile needs at least 3 points');

    const rings = [];

    for (let i = 0; i < pathPoints.length; i++) {
      const point = pathPoints[i];

      // Compute local frame (tangent, normal, binormal) using Frenet–Serret
      let tangent;
      if (i === 0) {
        tangent = pathPoints[1].sub(pathPoints[0]).normalize();
      } else if (i === pathPoints.length - 1) {
        tangent = pathPoints[i].sub(pathPoints[i - 1]).normalize();
      } else {
        tangent = pathPoints[i + 1].sub(pathPoints[i - 1]).normalize();
      }

      // Build rotation matrix to align Z-axis with tangent
      const zAxis = tangent;
      let xAxis = zAxis.isParallelTo(Vec3.unitY())
        ? Vec3.unitX()
        : Vec3.unitY().cross(zAxis).normalize();
      const yAxis = zAxis.cross(xAxis).normalize();
      xAxis = yAxis.cross(zAxis).normalize();

      // Transform each profile point
      const ring = profile.map(p => {
        const worldP = point
          .add(xAxis.mul(p.x))
          .add(yAxis.mul(p.y))
          .add(zAxis.mul(p.z));
        return new TopoVertex(worldP);
      });

      rings.push(ring);
    }

    if (closedPath && rings.length > 2) {
      rings.push(rings[0]);
    }

    return LoftSweep._buildSolidFromRings(rings, profile.length, closedPath, 'Sweep');
  }

  /**
   * Build a solid from a sequence of vertex rings.
   */
  static _buildSolidFromRings(rings, pointCount, closedEnds, name) {
    const faces = [];
    const ringCount = rings.length;

    // Side faces: quads between adjacent rings
    for (let r = 0; r < ringCount - 1; r++) {
      const currRing = rings[r];
      const nextRing = rings[r + 1];

      for (let i = 0; i < pointCount; i++) {
        const next = (i + 1) % pointCount;

        const v00 = currRing[i];
        const v10 = nextRing[i];
        const v11 = nextRing[next];
        const v01 = currRing[next];

        // Skip degenerate faces
        if (v00 === v10 && v01 === v11) continue;

        const e1 = new TopoEdge(v00, v10, new LineCurve(v00.point, v10.point));
        const e2 = new TopoEdge(v10, v11, new LineCurve(v10.point, v11.point));
        const e3 = new TopoEdge(v11, v01, new LineCurve(v11.point, v01.point));
        const e4 = new TopoEdge(v01, v00, new LineCurve(v01.point, v00.point));

        const loop = new TopoLoop([
          { edge: e1, reversed: false },
          { edge: e2, reversed: false },
          { edge: e3, reversed: false },
          { edge: e4, reversed: false },
        ]);

        const faceNormal = LoftSweep._triNormal(v00.point, v10.point, v01.point);
        const surface = PlanarSurface.fromPlane(
          Plane.fromNormalAndPoint(faceNormal, v00.point)
        );

        faces.push(new TopoFace(surface, loop));
      }
    }

    // End caps (if not closed path)
    if (!closedEnds) {
      // Start cap
      const startRing = rings[0];
      faces.push(LoftSweep._createCapFace(startRing, true));

      // End cap
      const endRing = rings[ringCount - 1];
      faces.push(LoftSweep._createCapFace(endRing, false));
    }

    const shell = new TopoShell(faces);
    const solid = new TopoSolid(shell);
    solid.name = name;
    solid.userData.featureType = name.toLowerCase();
    return solid;
  }

  /**
   * Create a cap face from a ring of vertices.
   */
  static _createCapFace(ring, flip) {
    const verts = flip ? [...ring].reverse() : ring;
    const edges = [];

    for (let i = 0; i < verts.length; i++) {
      const next = (i + 1) % verts.length;
      edges.push(new TopoEdge(verts[i], verts[next],
        new LineCurve(verts[i].point, verts[next].point)));
    }

    const loop = new TopoLoop(
      edges.map(e => ({ edge: e, reversed: false }))
    );

    const normal = LoftSweep._polyNormal(verts.map(v => v.point));
    const surface = PlanarSurface.fromPlane(
      Plane.fromNormalAndPoint(normal, verts[0].point)
    );

    return new TopoFace(surface, loop);
  }

  static _triNormal(a, b, c) {
    const ab = b.sub(a);
    const ac = c.sub(a);
    const n = ab.cross(ac);
    return n.length() > EPSILON ? n.normalize() : Vec3.unitZ();
  }

  static _polyNormal(pts) {
    if (pts.length < 3) return Vec3.unitZ();
    return LoftSweep._triNormal(pts[0], pts[1], pts[2]);
  }
}
