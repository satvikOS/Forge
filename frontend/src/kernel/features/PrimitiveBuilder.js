/**
 * ArchDisc Geometry Kernel — Primitive Builder
 * Creates B-Rep solids from parametric definitions.
 * Each primitive is a fully closed, manifold solid with proper topology.
 */

import Vec3 from '../math/Vec3.js';
import { LineCurve, ArcCurve } from '../math/Curve.js';
import { PlanarSurface, CylindricalSurface, SphericalSurface, ConicalSurface, ToroidalSurface } from '../math/Surface.js';
import Plane from '../math/Plane.js';
import TopoVertex from '../topology/TopoVertex.js';
import TopoEdge from '../topology/TopoEdge.js';
import TopoLoop from '../topology/TopoLoop.js';
import TopoFace from '../topology/TopoFace.js';
import TopoShell from '../topology/TopoShell.js';
import TopoSolid from '../topology/TopoSolid.js';

export default class PrimitiveBuilder {

  /**
   * Create a box solid.
   * @param {number} width - X dimension
   * @param {number} height - Y dimension
   * @param {number} depth - Z dimension
   * @param {Vec3} center - Center position (default: origin)
   */
  static box(width, height, depth, center) {
    const c = center || Vec3.zero();
    const hw = width / 2, hh = height / 2, hd = depth / 2;

    // 8 vertices
    const v = [
      new TopoVertex(c.add(new Vec3(-hw, -hh, -hd))), // 0: left-bottom-back
      new TopoVertex(c.add(new Vec3( hw, -hh, -hd))), // 1: right-bottom-back
      new TopoVertex(c.add(new Vec3( hw,  hh, -hd))), // 2: right-top-back
      new TopoVertex(c.add(new Vec3(-hw,  hh, -hd))), // 3: left-top-back
      new TopoVertex(c.add(new Vec3(-hw, -hh,  hd))), // 4: left-bottom-front
      new TopoVertex(c.add(new Vec3( hw, -hh,  hd))), // 5: right-bottom-front
      new TopoVertex(c.add(new Vec3( hw,  hh,  hd))), // 6: right-top-front
      new TopoVertex(c.add(new Vec3(-hw,  hh,  hd))), // 7: left-top-front
    ];

    // 12 edges
    const e = [];
    const makeEdge = (i, j) => {
      const edge = new TopoEdge(v[i], v[j], new LineCurve(v[i].point, v[j].point));
      e.push(edge);
      return edge;
    };

    // Bottom edges: 0-3
    const e01 = makeEdge(0, 1);
    const e12 = makeEdge(1, 2);
    const e23 = makeEdge(2, 3);
    const e30 = makeEdge(3, 0);
    // Top edges: 4-7
    const e45 = makeEdge(4, 5);
    const e56 = makeEdge(5, 6);
    const e67 = makeEdge(6, 7);
    const e74 = makeEdge(7, 4);
    // Vertical edges: 8-11
    const e04 = makeEdge(0, 4);
    const e15 = makeEdge(1, 5);
    const e26 = makeEdge(2, 6);
    const e37 = makeEdge(3, 7);

    // 6 faces (outward normals)
    const faces = [];

    const makeLoop = (halfEdges) => {
      const loop = new TopoLoop(halfEdges);
      return loop;
    };

    // Front face (z+): 4,5,6,7
    const frontLoop = makeLoop([
      { edge: e45, reversed: false },
      { edge: e56, reversed: false },
      { edge: e67, reversed: false },
      { edge: e74, reversed: false },
    ]);
    faces.push(new TopoFace(
      PlanarSurface.fromPlane(Plane.fromNormalAndPoint(Vec3.unitZ(), v[4].point)),
      frontLoop
    ));

    // Back face (z-): 0,3,2,1
    const backLoop = makeLoop([
      { edge: e30, reversed: true },
      { edge: e23, reversed: true },
      { edge: e12, reversed: true },
      { edge: e01, reversed: true },
    ]);
    faces.push(new TopoFace(
      PlanarSurface.fromPlane(Plane.fromNormalAndPoint(Vec3.unitZ().negate(), v[0].point)),
      backLoop
    ));

    // Top face (y+): 3,2,6,7
    const topLoop = makeLoop([
      { edge: e23, reversed: false },
      { edge: e26, reversed: false },
      { edge: e67, reversed: true },
      { edge: e37, reversed: true },
    ]);
    faces.push(new TopoFace(
      PlanarSurface.fromPlane(Plane.fromNormalAndPoint(Vec3.unitY(), v[3].point)),
      topLoop
    ));

    // Bottom face (y-): 0,1,5,4
    const bottomLoop = makeLoop([
      { edge: e01, reversed: false },
      { edge: e15, reversed: false },
      { edge: e45, reversed: true },
      { edge: e04, reversed: true },
    ]);
    faces.push(new TopoFace(
      PlanarSurface.fromPlane(Plane.fromNormalAndPoint(Vec3.unitY().negate(), v[0].point)),
      bottomLoop
    ));

    // Right face (x+): 1,2,6,5
    const rightLoop = makeLoop([
      { edge: e12, reversed: false },
      { edge: e26, reversed: false },
      { edge: e56, reversed: true },
      { edge: e15, reversed: true },
    ]);
    faces.push(new TopoFace(
      PlanarSurface.fromPlane(Plane.fromNormalAndPoint(Vec3.unitX(), v[1].point)),
      rightLoop
    ));

    // Left face (x-): 0,4,7,3
    const leftLoop = makeLoop([
      { edge: e04, reversed: false },
      { edge: e74, reversed: true },
      { edge: e37, reversed: false },
      { edge: e30, reversed: false },
    ]);
    faces.push(new TopoFace(
      PlanarSurface.fromPlane(Plane.fromNormalAndPoint(Vec3.unitX().negate(), v[0].point)),
      leftLoop
    ));

    const shell = new TopoShell(faces);
    const solid = new TopoSolid(shell);
    solid.name = 'Box';
    solid.userData.params = { width, height, depth, center: c };
    return solid;
  }

  /**
   * Create a cylinder solid.
   * @param {number} radius - Cylinder radius
   * @param {number} height - Cylinder height
   * @param {number} segments - Number of circumferential segments (default: 32)
   * @param {Vec3} center - Base center position
   */
  static cylinder(radius, height, segments = 64, center) {
    const c = center || Vec3.zero();

    // Create vertices: bottom ring + top ring + 2 center vertices
    const bottomVerts = [];
    const topVerts = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = c.x + Math.cos(angle) * radius;
      const z = c.z + Math.sin(angle) * radius;
      bottomVerts.push(new TopoVertex(new Vec3(x, c.y, z)));
      topVerts.push(new TopoVertex(new Vec3(x, c.y + height, z)));
    }

    const bottomCenter = new TopoVertex(c.clone());
    const topCenter = new TopoVertex(new Vec3(c.x, c.y + height, c.z));

    const faces = [];

    // Side faces (quads split into topology)
    const bottomEdges = [];
    const topEdges = [];
    const verticalEdges = [];

    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      bottomEdges.push(new TopoEdge(bottomVerts[i], bottomVerts[next],
        new LineCurve(bottomVerts[i].point, bottomVerts[next].point)));
      topEdges.push(new TopoEdge(topVerts[i], topVerts[next],
        new LineCurve(topVerts[i].point, topVerts[next].point)));
      verticalEdges.push(new TopoEdge(bottomVerts[i], topVerts[i],
        new LineCurve(bottomVerts[i].point, topVerts[i].point)));
    }

    // Side faces
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const loop = new TopoLoop([
        { edge: bottomEdges[i], reversed: false },
        { edge: verticalEdges[next], reversed: false },
        { edge: topEdges[i], reversed: true },
        { edge: verticalEdges[i], reversed: true },
      ]);

      const midAngle = ((i + 0.5) / segments) * Math.PI * 2;
      const faceNormal = new Vec3(Math.cos(midAngle), 0, Math.sin(midAngle));
      faces.push(new TopoFace(
        new CylindricalSurface(c, Vec3.unitY(), radius),
        loop
      ));
    }

    // Bottom cap
    const bottomCapEdges = [];
    for (let i = 0; i < segments; i++) {
      bottomCapEdges.push(new TopoEdge(bottomCenter, bottomVerts[i],
        new LineCurve(bottomCenter.point, bottomVerts[i].point)));
    }

    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const loop = new TopoLoop([
        { edge: bottomCapEdges[i], reversed: false },
        { edge: bottomEdges[i], reversed: false },
        { edge: bottomCapEdges[next], reversed: true },
      ]);
      faces.push(new TopoFace(
        PlanarSurface.fromPlane(Plane.fromNormalAndPoint(Vec3.unitY().negate(), c)),
        loop
      ));
    }

    // Top cap
    const topCapEdges = [];
    for (let i = 0; i < segments; i++) {
      topCapEdges.push(new TopoEdge(topCenter, topVerts[i],
        new LineCurve(topCenter.point, topVerts[i].point)));
    }

    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const loop = new TopoLoop([
        { edge: topCapEdges[i], reversed: false },
        { edge: topEdges[i], reversed: false },
        { edge: topCapEdges[next], reversed: true },
      ]);
      const topPoint = new Vec3(c.x, c.y + height, c.z);
      faces.push(new TopoFace(
        PlanarSurface.fromPlane(Plane.fromNormalAndPoint(Vec3.unitY(), topPoint)),
        loop
      ));
    }

    const shell = new TopoShell(faces);
    const solid = new TopoSolid(shell);
    solid.name = 'Cylinder';
    solid.userData.params = { radius, height, segments, center: c };
    return solid;
  }

  /**
   * Create a thin-walled cylindrical shell (tube) for casings, cowls,
   * and other structural shells.
   *
   * The B-Rep geometry is a normal solid cylinder so tessellation and
   * rendering still work, but `volume()` is overridden to return the
   * shell wall volume (π(R²−r²)h) so `massProperties()` and BOM mass
   * reflect the real thin-walled construction. Tagged with _isShell.
   *
   * @param {number} outerR
   * @param {number} innerR
   * @param {number} height
   * @param {number} segments
   * @param {Vec3} [center]
   */
  static cylinderShell(outerR, innerR, height, segments = 64, center) {
    if (innerR <= 0 || innerR >= outerR) {
      return PrimitiveBuilder.cylinder(outerR, height, segments, center);
    }
    const solid = PrimitiveBuilder.cylinder(outerR, height, segments, center);
    const shellVol = Math.PI * (outerR * outerR - innerR * innerR) * height;
    solid.name = 'CylinderShell';
    solid.userData = solid.userData || {};
    solid.userData.params = { outerR, innerR, height, segments, wallThickness: outerR - innerR };
    solid.volume = () => shellVol;  // override for correct mass
    solid._isShell = true;
    return solid;
  }

  /**
   * Create a sphere solid.
   * @param {number} radius - Sphere radius
   * @param {number} widthSegments - Longitudinal segments (default: 32)
   * @param {number} heightSegments - Latitudinal segments (default: 16)
   * @param {Vec3} center - Center position
   */
  static sphere(radius, widthSegments = 64, heightSegments = 32, center) {
    const c = center || Vec3.zero();
    const verts = [];
    const faces = [];

    // Generate vertex grid
    for (let j = 0; j <= heightSegments; j++) {
      const phi = (j / heightSegments) * Math.PI;
      const row = [];
      for (let i = 0; i <= widthSegments; i++) {
        const theta = (i / widthSegments) * Math.PI * 2;
        const x = c.x + radius * Math.sin(phi) * Math.cos(theta);
        const y = c.y + radius * Math.cos(phi);
        const z = c.z + radius * Math.sin(phi) * Math.sin(theta);
        // Share vertices at poles and wrap-around
        if (j === 0) {
          if (i === 0) row.push(new TopoVertex(new Vec3(x, y, z)));
          else row.push(row[0]); // north pole shared
        } else if (j === heightSegments) {
          if (i === 0) row.push(new TopoVertex(new Vec3(x, y, z)));
          else row.push(row[0]); // south pole shared
        } else if (i === widthSegments) {
          row.push(row[0]); // wrap-around
        } else {
          row.push(new TopoVertex(new Vec3(x, y, z)));
        }
      }
      verts.push(row);
    }

    // Create faces (triangles at poles, quads elsewhere)
    const surface = new SphericalSurface(c, radius);

    for (let j = 0; j < heightSegments; j++) {
      for (let i = 0; i < widthSegments; i++) {
        const v00 = verts[j][i];
        const v10 = verts[j][i + 1];
        const v01 = verts[j + 1][i];
        const v11 = verts[j + 1][i + 1];

        if (j === 0) {
          // Triangle at north pole
          if (v01 !== v11) {
            const e1 = new TopoEdge(v00, v11, new LineCurve(v00.point, v11.point));
            const e2 = new TopoEdge(v11, v01, new LineCurve(v11.point, v01.point));
            const e3 = new TopoEdge(v01, v00, new LineCurve(v01.point, v00.point));
            const loop = new TopoLoop([
              { edge: e1, reversed: false },
              { edge: e2, reversed: false },
              { edge: e3, reversed: false },
            ]);
            faces.push(new TopoFace(surface, loop));
          }
        } else if (j === heightSegments - 1) {
          // Triangle at south pole
          if (v00 !== v10) {
            const e1 = new TopoEdge(v00, v10, new LineCurve(v00.point, v10.point));
            const e2 = new TopoEdge(v10, v01, new LineCurve(v10.point, v01.point));
            const e3 = new TopoEdge(v01, v00, new LineCurve(v01.point, v00.point));
            const loop = new TopoLoop([
              { edge: e1, reversed: false },
              { edge: e2, reversed: false },
              { edge: e3, reversed: false },
            ]);
            faces.push(new TopoFace(surface, loop));
          }
        } else {
          // Quad face
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
          faces.push(new TopoFace(surface, loop));
        }
      }
    }

    const shell = new TopoShell(faces);
    const solid = new TopoSolid(shell);
    solid.name = 'Sphere';
    solid.userData.params = { radius, widthSegments, heightSegments, center: c };
    return solid;
  }

  /**
   * Create a cone solid.
   * @param {number} radius - Base radius
   * @param {number} height - Cone height
   * @param {number} segments - Circumferential segments (default: 32)
   * @param {Vec3} center - Base center position
   */
  static cone(radius, height, segments = 64, center) {
    const c = center || Vec3.zero();
    const apex = new TopoVertex(new Vec3(c.x, c.y + height, c.z));
    const baseCenter = new TopoVertex(c.clone());
    const baseVerts = [];

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      baseVerts.push(new TopoVertex(new Vec3(
        c.x + Math.cos(angle) * radius,
        c.y,
        c.z + Math.sin(angle) * radius
      )));
    }

    const faces = [];
    const baseEdges = [];
    const sideEdges = [];
    const baseCapEdges = [];

    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      baseEdges.push(new TopoEdge(baseVerts[i], baseVerts[next],
        new LineCurve(baseVerts[i].point, baseVerts[next].point)));
      sideEdges.push(new TopoEdge(baseVerts[i], apex,
        new LineCurve(baseVerts[i].point, apex.point)));
      baseCapEdges.push(new TopoEdge(baseCenter, baseVerts[i],
        new LineCurve(baseCenter.point, baseVerts[i].point)));
    }

    const halfAngle = Math.atan2(radius, height);

    // Side faces (triangles)
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const loop = new TopoLoop([
        { edge: baseEdges[i], reversed: false },
        { edge: sideEdges[next], reversed: false },
        { edge: sideEdges[i], reversed: true },
      ]);
      faces.push(new TopoFace(
        new ConicalSurface(apex.point, Vec3.unitY().negate(), halfAngle),
        loop
      ));
    }

    // Base cap
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const loop = new TopoLoop([
        { edge: baseCapEdges[i], reversed: false },
        { edge: baseEdges[i], reversed: false },
        { edge: baseCapEdges[next], reversed: true },
      ]);
      faces.push(new TopoFace(
        PlanarSurface.fromPlane(Plane.fromNormalAndPoint(Vec3.unitY().negate(), c)),
        loop
      ));
    }

    const shell = new TopoShell(faces);
    const solid = new TopoSolid(shell);
    solid.name = 'Cone';
    solid.userData.params = { radius, height, segments, center: c };
    return solid;
  }

  /**
   * Create a torus solid.
   * @param {number} majorRadius - Distance from center to ring center
   * @param {number} minorRadius - Radius of the ring tube
   * @param {number} majorSegments - Segments around the ring (default: 32)
   * @param {number} minorSegments - Segments around the tube (default: 16)
   * @param {Vec3} center - Center position
   */
  static torus(majorRadius, minorRadius, majorSegments = 64, minorSegments = 32, center) {
    const c = center || Vec3.zero();
    const verts = [];
    const faces = [];

    // Generate vertex grid
    for (let i = 0; i <= majorSegments; i++) {
      const u = (i / majorSegments) * Math.PI * 2;
      const row = [];
      for (let j = 0; j <= minorSegments; j++) {
        const v = (j / minorSegments) * Math.PI * 2;
        const x = c.x + (majorRadius + minorRadius * Math.cos(v)) * Math.cos(u);
        const y = c.y + minorRadius * Math.sin(v);
        const z = c.z + (majorRadius + minorRadius * Math.cos(v)) * Math.sin(u);

        if (i === majorSegments) {
          row.push(verts[0][j === minorSegments ? 0 : j]);
        } else if (j === minorSegments) {
          row.push(row[0]);
        } else {
          row.push(new TopoVertex(new Vec3(x, y, z)));
        }
      }
      verts.push(row);
    }

    const surface = new ToroidalSurface(c, Vec3.unitY(), majorRadius, minorRadius);

    for (let i = 0; i < majorSegments; i++) {
      for (let j = 0; j < minorSegments; j++) {
        const v00 = verts[i][j];
        const v10 = verts[i + 1][j];
        const v11 = verts[i + 1][j + 1];
        const v01 = verts[i][j + 1];

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
        faces.push(new TopoFace(surface, loop));
      }
    }

    const shell = new TopoShell(faces);
    const solid = new TopoSolid(shell);
    solid.name = 'Torus';
    solid.userData.params = { majorRadius, minorRadius, majorSegments, minorSegments, center: c };
    return solid;
  }
}
