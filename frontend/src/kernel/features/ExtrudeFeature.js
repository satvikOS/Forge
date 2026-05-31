/**
 * @deprecated SP-1 S7 — Model C (kernel/features/*) — QUARANTINED 2026-05-23.
 * Dead pre-OCCT demo kernel. Production extrude routes through
 * kernel/brep/BrepFeatures.js::extrudeRect (the OCCT BRepPrimAPI_MakePrism
 * path) and produces a SpineBody. This native-JS extrude is NOT used by
 * any ribbon op.
 *
 * NEW CODE MUST NOT IMPORT THIS FILE. See PrimitiveBuilder.js header for the
 * full quarantine context.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ArchDisc Geometry Kernel — Extrude Feature
 * Extrudes a 2D profile (loop of edges) along a direction to create a solid.
 * Supports: boss (add material), cut (remove material), mid-plane, direction, taper angle.
 */

import Vec3 from '../math/Vec3.js';
import { LineCurve } from '../math/Curve.js';
import { PlanarSurface } from '../math/Surface.js';
import Plane from '../math/Plane.js';
import TopoVertex from '../topology/TopoVertex.js';
import TopoEdge from '../topology/TopoEdge.js';
import TopoLoop from '../topology/TopoLoop.js';
import TopoFace from '../topology/TopoFace.js';
import TopoShell from '../topology/TopoShell.js';
import TopoSolid from '../topology/TopoSolid.js';

export default class ExtrudeFeature {

  /**
   * Extrude a profile to create a solid.
   * @param {Vec3[]} profilePoints - Ordered 2D/3D points forming a closed profile
   * @param {Vec3} direction - Extrusion direction (normalized)
   * @param {number} distance - Extrusion distance
   * @param {object} options
   * @param {number} options.taperAngle - Taper angle in radians (0 = no taper)
   * @param {boolean} options.midPlane - Extrude equally in both directions
   * @param {boolean} options.reversed - Reverse direction
   * @returns {TopoSolid}
   */
  static extrude(profilePoints, direction, distance, options = {}) {
    const {
      taperAngle = 0,
      midPlane = false,
      reversed = false,
    } = options;

    if (profilePoints.length < 3) {
      throw new Error('Profile must have at least 3 points');
    }

    const dir = reversed ? direction.negate() : direction;
    const n = profilePoints.length;

    let startOffset = Vec3.zero();
    let endOffset = dir.mul(distance);

    if (midPlane) {
      startOffset = dir.mul(-distance / 2);
      endOffset = dir.mul(distance / 2);
    }

    // Create bottom and top vertices
    const bottomVerts = [];
    const topVerts = [];

    for (let i = 0; i < n; i++) {
      const basePoint = profilePoints[i];
      bottomVerts.push(new TopoVertex(basePoint.add(startOffset)));

      if (taperAngle !== 0) {
        // Taper: offset point toward/away from centroid
        const centroid = ExtrudeFeature._centroid(profilePoints);
        const radial = basePoint.sub(centroid);
        const taperOffset = radial.mul(Math.tan(taperAngle) * distance);
        topVerts.push(new TopoVertex(basePoint.add(endOffset).add(taperOffset)));
      } else {
        topVerts.push(new TopoVertex(basePoint.add(endOffset)));
      }
    }

    // Create edges
    const bottomEdges = [];
    const topEdges = [];
    const sideEdges = [];

    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      bottomEdges.push(new TopoEdge(bottomVerts[i], bottomVerts[next],
        new LineCurve(bottomVerts[i].point, bottomVerts[next].point)));
      topEdges.push(new TopoEdge(topVerts[i], topVerts[next],
        new LineCurve(topVerts[i].point, topVerts[next].point)));
      sideEdges.push(new TopoEdge(bottomVerts[i], topVerts[i],
        new LineCurve(bottomVerts[i].point, topVerts[i].point)));
    }

    const faces = [];

    // Bottom face (reversed winding for outward normal)
    const bottomLoop = new TopoLoop(
      bottomEdges.map((e, i) => ({ edge: e, reversed: true })).reverse()
    );
    const bottomNormal = dir.negate();
    faces.push(new TopoFace(
      PlanarSurface.fromPlane(Plane.fromNormalAndPoint(bottomNormal, bottomVerts[0].point)),
      bottomLoop
    ));

    // Top face
    const topLoop = new TopoLoop(
      topEdges.map((e, i) => ({ edge: e, reversed: false }))
    );
    faces.push(new TopoFace(
      PlanarSurface.fromPlane(Plane.fromNormalAndPoint(dir, topVerts[0].point)),
      topLoop
    ));

    // Side faces
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const sideLoop = new TopoLoop([
        { edge: bottomEdges[i], reversed: false },
        { edge: sideEdges[next], reversed: false },
        { edge: topEdges[i], reversed: true },
        { edge: sideEdges[i], reversed: true },
      ]);

      // Compute side face normal
      const edgeDir = bottomVerts[(i + 1) % n].point.sub(bottomVerts[i].point);
      const sideNormal = edgeDir.cross(dir).normalize();

      faces.push(new TopoFace(
        PlanarSurface.fromPlane(Plane.fromNormalAndPoint(sideNormal, bottomVerts[i].point)),
        sideLoop
      ));
    }

    const shell = new TopoShell(faces);
    const solid = new TopoSolid(shell);
    solid.name = 'Extrude';
    solid.userData.params = {
      profilePoints: profilePoints.map(p => p.toArray()),
      direction: dir.toArray(),
      distance,
      taperAngle,
      midPlane,
      reversed
    };
    solid.userData.featureType = 'extrude';
    return solid;
  }

  /**
   * Extrude a rectangular profile (convenience).
   */
  static extrudeRect(width, height, depth, center) {
    const c = center || Vec3.zero();
    const hw = width / 2, hh = height / 2;
    const profile = [
      new Vec3(c.x - hw, c.y - hh, c.z),
      new Vec3(c.x + hw, c.y - hh, c.z),
      new Vec3(c.x + hw, c.y + hh, c.z),
      new Vec3(c.x - hw, c.y + hh, c.z),
    ];
    return ExtrudeFeature.extrude(profile, Vec3.unitZ(), depth);
  }

  /**
   * Extrude a circular profile (convenience).
   */
  static extrudeCircle(radius, depth, segments = 32, center) {
    const c = center || Vec3.zero();
    const profile = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      profile.push(new Vec3(
        c.x + Math.cos(angle) * radius,
        c.y + Math.sin(angle) * radius,
        c.z
      ));
    }
    return ExtrudeFeature.extrude(profile, Vec3.unitZ(), depth);
  }

  static _centroid(points) {
    let sum = Vec3.zero();
    for (const p of points) sum = sum.add(p);
    return sum.div(points.length);
  }
}
