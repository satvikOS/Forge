/**
 * @deprecated SP-1 S7 — Model C (kernel/features/*) — QUARANTINED 2026-05-23.
 * Dead pre-OCCT demo kernel. Production fillet / chamfer route through
 * kernel/brep/BrepFeatures.js (OCCT BRepFilletAPI_MakeFillet /
 * BRepFilletAPI_MakeChamfer) and produce SpineBodies with persistent-ID
 * carry-through. This native-JS fillet/chamfer is NOT used by any ribbon op.
 *
 * NEW CODE MUST NOT IMPORT THIS FILE. See PrimitiveBuilder.js header for the
 * full quarantine context.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ArchDisc Geometry Kernel — Fillet & Chamfer
 * Edge-based rounding (fillet) and beveling (chamfer) operations.
 *
 * Approach: For each selected edge, create offset geometry that replaces
 * the sharp edge with a smooth arc (fillet) or flat bevel (chamfer),
 * then rebuild the solid topology.
 */

import Vec3, { EPSILON } from '../math/Vec3.js';
import { LineCurve, ArcCurve } from '../math/Curve.js';
import { PlanarSurface, CylindricalSurface } from '../math/Surface.js';
import Plane from '../math/Plane.js';
import TopoVertex from '../topology/TopoVertex.js';
import TopoEdge from '../topology/TopoEdge.js';
import TopoLoop from '../topology/TopoLoop.js';
import TopoFace from '../topology/TopoFace.js';
import TopoShell from '../topology/TopoShell.js';
import TopoSolid from '../topology/TopoSolid.js';

export default class FilletChamfer {

  /**
   * Apply a fillet (round) to edges of a solid.
   * @param {TopoSolid} solid - Source solid
   * @param {number[]} edgeIds - IDs of edges to fillet
   * @param {number} radius - Fillet radius
   * @param {number} segments - Arc segments (default: 8)
   * @returns {TopoSolid}
   */
  static fillet(solid, edgeIds, radius, segments = 8) {
    if (radius < EPSILON) return solid;

    const edgeSet = new Set(edgeIds);
    const newFaces = [];
    const modifiedFaces = new Map(); // original face id → new face data
    const edgeReplacements = new Map(); // edge id → replacement vertices

    // Process each edge to fillet
    for (const edge of solid.edges()) {
      if (!edgeSet.has(edge.id)) continue;

      const adjacentFaces = [...edge.faces];
      if (adjacentFaces.length !== 2) continue; // can only fillet manifold edges

      const face1 = adjacentFaces[0];
      const face2 = adjacentFaces[1];

      // Get face normals
      const n1 = face1.outerLoop ? face1.outerLoop.computeNormal() : { x: 0, y: 1, z: 0 };
      const n2 = face2.outerLoop ? face2.outerLoop.computeNormal() : { x: 0, y: 1, z: 0 };
      const normal1 = new Vec3(n1.x, n1.y, n1.z);
      const normal2 = new Vec3(n2.x, n2.y, n2.z);

      // Edge direction
      const edgeDir = edge.endVertex.point.sub(edge.startVertex.point).normalize();
      const edgeLength = edge.length();

      // Compute offset directions (perpendicular to edge, toward each face)
      const offset1 = normal1.cross(edgeDir).normalize();
      const offset2 = edgeDir.cross(normal2).normalize();

      // Check if offsets point away from edge center — flip if needed
      const edgeMid = edge.midpoint();
      const faceCentroid1 = face1.centroid();
      if (offset1.dot(faceCentroid1.sub(edgeMid)) < 0) offset1.mulInPlace(-1);

      const faceCentroid2 = face2.centroid();
      if (offset2.dot(faceCentroid2.sub(edgeMid)) < 0) offset2.mulInPlace(-1);

      // Generate fillet arc vertices along the edge
      const startReplace = [];
      const endReplace = [];

      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const angle = t * Math.PI / 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        // Offset from edge toward face1 and face2
        const offsetVec = offset1.mul(cos * radius).add(offset2.mul(sin * radius));

        // Point at start of edge
        const pStart = edge.startVertex.point
          .sub(offset1.mul(radius))
          .sub(offset2.mul(radius))
          .add(offsetVec);
        startReplace.push(new TopoVertex(pStart));

        // Point at end of edge
        const pEnd = edge.endVertex.point
          .sub(offset1.mul(radius))
          .sub(offset2.mul(radius))
          .add(offsetVec);
        endReplace.push(new TopoVertex(pEnd));
      }

      // Create fillet strip faces (quads between start and end)
      for (let s = 0; s < segments; s++) {
        const v00 = startReplace[s];
        const v10 = endReplace[s];
        const v11 = endReplace[s + 1];
        const v01 = startReplace[s + 1];

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

        // Approximate cylindrical surface for the fillet
        const center = edge.startVertex.point.lerp(edge.endVertex.point, 0.5)
          .sub(offset1.mul(radius)).sub(offset2.mul(radius));
        const surface = new CylindricalSurface(center, edgeDir, radius);

        newFaces.push(new TopoFace(surface, loop));
      }

      edgeReplacements.set(edge.id, { startReplace, endReplace });
    }

    // Rebuild: keep non-filleted faces, add fillet faces
    const allFaces = [];
    for (const face of solid.faces()) {
      // Check if this face has any filleted edges
      const faceEdges = face.edges();
      const hasFilletedEdge = faceEdges.some(e => edgeSet.has(e.id));

      if (!hasFilletedEdge) {
        allFaces.push(face);
      } else {
        // Keep the face but it will be trimmed — for now keep as-is
        // Full implementation would trim face boundaries to fillet curves
        allFaces.push(face);
      }
    }

    // Add fillet strip faces
    allFaces.push(...newFaces);

    const shell = new TopoShell(allFaces);
    const result = new TopoSolid(shell);
    result.name = 'Fillet';
    result.userData.featureType = 'fillet';
    result.userData.params = { edgeIds, radius, segments };
    return result;
  }

  /**
   * Apply a chamfer (bevel) to edges of a solid.
   * @param {TopoSolid} solid - Source solid
   * @param {number[]} edgeIds - IDs of edges to chamfer
   * @param {number} distance - Chamfer distance (equal distance from edge)
   * @returns {TopoSolid}
   */
  static chamfer(solid, edgeIds, distance) {
    if (distance < EPSILON) return solid;

    const edgeSet = new Set(edgeIds);
    const newFaces = [];

    for (const edge of solid.edges()) {
      if (!edgeSet.has(edge.id)) continue;

      const adjacentFaces = [...edge.faces];
      if (adjacentFaces.length !== 2) continue;

      const face1 = adjacentFaces[0];
      const face2 = adjacentFaces[1];

      const n1 = face1.outerLoop ? face1.outerLoop.computeNormal() : { x: 0, y: 1, z: 0 };
      const n2 = face2.outerLoop ? face2.outerLoop.computeNormal() : { x: 0, y: 1, z: 0 };
      const normal1 = new Vec3(n1.x, n1.y, n1.z);
      const normal2 = new Vec3(n2.x, n2.y, n2.z);

      const edgeDir = edge.endVertex.point.sub(edge.startVertex.point).normalize();

      // Offset directions
      const offset1 = normal1.cross(edgeDir).normalize();
      const offset2 = edgeDir.cross(normal2).normalize();

      const edgeMid = edge.midpoint();
      if (offset1.dot(face1.centroid().sub(edgeMid)) < 0) offset1.mulInPlace(-1);
      if (offset2.dot(face2.centroid().sub(edgeMid)) < 0) offset2.mulInPlace(-1);

      // Create chamfer as a single flat strip
      const v00 = new TopoVertex(edge.startVertex.point.add(offset1.mul(distance)));
      const v01 = new TopoVertex(edge.startVertex.point.add(offset2.mul(distance)));
      const v10 = new TopoVertex(edge.endVertex.point.add(offset1.mul(distance)));
      const v11 = new TopoVertex(edge.endVertex.point.add(offset2.mul(distance)));

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

      const chamferNormal = offset1.add(offset2).normalize();
      const surface = PlanarSurface.fromPlane(
        Plane.fromNormalAndPoint(chamferNormal, v00.point)
      );

      newFaces.push(new TopoFace(surface, loop));
    }

    const allFaces = [...solid.faces(), ...newFaces];
    const shell = new TopoShell(allFaces);
    const result = new TopoSolid(shell);
    result.name = 'Chamfer';
    result.userData.featureType = 'chamfer';
    result.userData.params = { edgeIds, distance };
    return result;
  }

  /**
   * Get all edge IDs of a solid (for UI selection).
   */
  static getEdgeInfo(solid) {
    return solid.edges().map(e => ({
      id: e.id,
      start: e.startVertex.point.toArray(),
      end: e.endVertex.point.toArray(),
      length: e.length(),
      isBoundary: e.isBoundary(),
      faceCount: e.faces.size,
    }));
  }
}
