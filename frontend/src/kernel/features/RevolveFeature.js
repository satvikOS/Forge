/**
 * ArchDisc Geometry Kernel — Revolve Feature
 * Revolves a 2D profile around an axis to create a solid of revolution.
 * Supports: full revolution, partial sweep, and profile validation.
 */

import Vec3 from '../math/Vec3.js';
import Mat4 from '../math/Mat4.js';
import { LineCurve } from '../math/Curve.js';
import { PlanarSurface, CylindricalSurface } from '../math/Surface.js';
import Plane from '../math/Plane.js';
import TopoVertex from '../topology/TopoVertex.js';
import TopoEdge from '../topology/TopoEdge.js';
import TopoLoop from '../topology/TopoLoop.js';
import TopoFace from '../topology/TopoFace.js';
import TopoShell from '../topology/TopoShell.js';
import TopoSolid from '../topology/TopoSolid.js';

export default class RevolveFeature {

  /**
   * Revolve a profile around an axis.
   * @param {Vec3[]} profilePoints - Ordered points forming the profile
   * @param {Vec3} axisOrigin - Point on the revolution axis
   * @param {Vec3} axisDirection - Direction of the revolution axis
   * @param {number} sweepAngle - Angle in radians (2*PI for full revolution)
   * @param {number} segments - Number of angular segments (default: 32)
   * @returns {TopoSolid}
   */
  static revolve(profilePoints, axisOrigin, axisDirection, sweepAngle = Math.PI * 2, segments = 32) {
    if (profilePoints.length < 2) {
      throw new Error('Profile must have at least 2 points');
    }

    const axis = axisDirection.normalize();
    const isFull = Math.abs(sweepAngle - Math.PI * 2) < 1e-10;
    const n = profilePoints.length;
    const steps = isFull ? segments : segments;
    const actualSteps = isFull ? steps : steps + 1;

    // Generate vertex rings by rotating profile
    const rings = [];
    for (let s = 0; s < actualSteps; s++) {
      const angle = (s / steps) * sweepAngle;
      const rotMatrix = Mat4.rotationAxis(axis, angle);
      const translate = Mat4.translation(-axisOrigin.x, -axisOrigin.y, -axisOrigin.z);
      const untranslate = Mat4.translation(axisOrigin.x, axisOrigin.y, axisOrigin.z);
      const transform = untranslate.multiply(rotMatrix).multiply(translate);

      const ring = profilePoints.map(p => new TopoVertex(transform.transformPoint(p)));
      rings.push(ring);
    }

    const faces = [];

    // Create side faces (quads between adjacent rings)
    for (let s = 0; s < steps; s++) {
      const currRing = rings[s];
      const nextRing = isFull ? rings[(s + 1) % steps] : rings[s + 1];

      for (let i = 0; i < n - 1; i++) {
        const v00 = currRing[i];
        const v10 = nextRing[i];
        const v11 = nextRing[i + 1];
        const v01 = currRing[i + 1];

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

        // Determine surface type based on distance from axis
        const midPoint = v00.point.lerp(v11.point, 0.5);
        const toMid = midPoint.sub(axisOrigin);
        const along = axis.mul(toMid.dot(axis));
        const radial = toMid.sub(along);
        const radius = radial.length();

        let surface;
        if (radius < 1e-6) {
          surface = PlanarSurface.fromPlane(Plane.fromThreePoints(v00.point, v10.point, v01.point));
        } else {
          surface = new CylindricalSurface(axisOrigin.add(along), axis, radius);
        }

        faces.push(new TopoFace(surface, loop));
      }
    }

    // End caps for partial revolution
    if (!isFull) {
      // Start cap
      const startRing = rings[0];
      const startPoints = startRing.map(v => v.point);
      const startEdges = [];
      for (let i = 0; i < n - 1; i++) {
        startEdges.push(new TopoEdge(startRing[i], startRing[i + 1],
          new LineCurve(startRing[i].point, startRing[i + 1].point)));
      }
      const startLoop = new TopoLoop(
        startEdges.map(e => ({ edge: e, reversed: true })).reverse()
      );
      const startNormal = RevolveFeature._polyNormal(startPoints);
      faces.push(new TopoFace(
        PlanarSurface.fromPlane(Plane.fromNormalAndPoint(startNormal, startPoints[0])),
        startLoop
      ));

      // End cap
      const endRing = rings[rings.length - 1];
      const endPoints = endRing.map(v => v.point);
      const endEdges = [];
      for (let i = 0; i < n - 1; i++) {
        endEdges.push(new TopoEdge(endRing[i], endRing[i + 1],
          new LineCurve(endRing[i].point, endRing[i + 1].point)));
      }
      const endLoop = new TopoLoop(
        endEdges.map(e => ({ edge: e, reversed: false }))
      );
      const endNormal = RevolveFeature._polyNormal(endPoints).negate();
      faces.push(new TopoFace(
        PlanarSurface.fromPlane(Plane.fromNormalAndPoint(endNormal, endPoints[0])),
        endLoop
      ));
    }

    const shell = new TopoShell(faces);
    const solid = new TopoSolid(shell);
    solid.name = 'Revolve';
    solid.userData.params = {
      profilePoints: profilePoints.map(p => p.toArray()),
      axisOrigin: axisOrigin.toArray(),
      axisDirection: axis.toArray(),
      sweepAngle,
      segments
    };
    solid.userData.featureType = 'revolve';
    return solid;
  }

  static _polyNormal(points) {
    if (points.length < 3) return Vec3.unitZ();
    const a = points[1].sub(points[0]);
    const b = points[2].sub(points[0]);
    const n = a.cross(b);
    return n.length() > 1e-10 ? n.normalize() : Vec3.unitZ();
  }
}
