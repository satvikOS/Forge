/**
 * @deprecated SP-1 S7 — Model C (kernel/features/*) — QUARANTINED 2026-05-23.
 * Dead pre-OCCT demo kernel. Production direct-edit ops (push/pull, offset
 * face, replace face) route through kernel/brep/BrepRewrite.js +
 * BrepLocalOps.js and produce SpineBodies. This native-JS direct-edit is
 * NOT used by any ribbon op.
 *
 * NEW CODE MUST NOT IMPORT THIS FILE. See PrimitiveBuilder.js header for the
 * full quarantine context.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ArchDisc Geometry Kernel — Direct Edit
 * Face-level editing operations: push/pull, move, offset, delete.
 * These modify solid geometry without sketch/feature history — direct manipulation.
 */

import Vec3, { EPSILON } from '../math/Vec3.js';
import { LineCurve } from '../math/Curve.js';
import { PlanarSurface } from '../math/Surface.js';
import Plane from '../math/Plane.js';
import TopoVertex from '../topology/TopoVertex.js';
import TopoEdge from '../topology/TopoEdge.js';
import TopoLoop from '../topology/TopoLoop.js';
import TopoFace from '../topology/TopoFace.js';
import TopoShell from '../topology/TopoShell.js';
import TopoSolid from '../topology/TopoSolid.js';

export default class DirectEdit {

  /**
   * Push/Pull a face along its normal.
   * Positive distance = push outward, negative = pull inward.
   * @param {TopoSolid} solid
   * @param {number} faceId - ID of the face to push/pull
   * @param {number} distance - Distance to move (signed)
   * @returns {TopoSolid}
   */
  static pushPull(solid, faceId, distance) {
    if (Math.abs(distance) < EPSILON) return solid;

    const targetFace = solid.faces().find(f => f.id === faceId);
    if (!targetFace) throw new Error(`Face ${faceId} not found`);

    // Get face normal
    const rawNormal = targetFace.outerLoop ? targetFace.outerLoop.computeNormal() : { x: 0, y: 1, z: 0 };
    const normal = new Vec3(rawNormal.x, rawNormal.y, rawNormal.z);
    const moveDir = targetFace.reversed ? normal.negate() : normal;
    const offset = moveDir.mul(distance);

    // Collect vertices of the target face
    const faceVerts = new Set();
    for (const v of targetFace.vertices()) {
      faceVerts.add(v);
    }

    // Identify shared vs unshared vertices
    // Shared vertices (on edges with other faces) need to be split
    const vertexMap = new Map(); // oldVertex → newVertex

    for (const vertex of faceVerts) {
      const newVertex = new TopoVertex(vertex.point.add(offset));
      vertexMap.set(vertex, newVertex);
    }

    // Rebuild faces
    const newFaces = [];

    for (const face of solid.faces()) {
      if (face.id === faceId) {
        // Move the target face
        const newVerts = face.outerLoop.orderedPoints().map((pt, i) => {
          return vertexMap.get(face.outerLoop.vertices()[i]) ||
            new TopoVertex(pt.add(offset));
        });

        const edges = [];
        for (let i = 0; i < newVerts.length; i++) {
          const next = (i + 1) % newVerts.length;
          edges.push(new TopoEdge(newVerts[i], newVerts[next],
            new LineCurve(newVerts[i].point, newVerts[next].point)));
        }

        const loop = new TopoLoop(edges.map(e => ({ edge: e, reversed: false })));
        const surface = PlanarSurface.fromPlane(
          Plane.fromNormalAndPoint(moveDir, newVerts[0].point)
        );
        newFaces.push(new TopoFace(surface, loop));
      } else {
        // Check if this face shares edges with the target face
        const faceVertices = face.vertices();
        const hasSharedVert = faceVertices.some(v => faceVerts.has(v));

        if (hasSharedVert) {
          // This face needs to be stretched — replace shared vertices with new positions
          const outerPts = face.outerLoop.orderedPoints();
          const origVerts = face.outerLoop.vertices();
          const stretchedVerts = origVerts.map((v, i) => {
            if (faceVerts.has(v)) {
              return vertexMap.get(v) || new TopoVertex(v.point.add(offset));
            }
            return new TopoVertex(v.point.clone());
          });

          const edges = [];
          for (let i = 0; i < stretchedVerts.length; i++) {
            const next = (i + 1) % stretchedVerts.length;
            edges.push(new TopoEdge(stretchedVerts[i], stretchedVerts[next],
              new LineCurve(stretchedVerts[i].point, stretchedVerts[next].point)));
          }

          const loop = new TopoLoop(edges.map(e => ({ edge: e, reversed: false })));
          const fNormal = face.outerLoop.computeNormal();
          const surface = PlanarSurface.fromPlane(
            Plane.fromNormalAndPoint(new Vec3(fNormal.x, fNormal.y, fNormal.z), stretchedVerts[0].point)
          );
          newFaces.push(new TopoFace(surface, loop));
        } else {
          // Unaffected face — clone vertices to avoid shared references
          const origVerts = face.outerLoop.vertices();
          const clonedVerts = origVerts.map(v => new TopoVertex(v.point.clone()));
          const edges = [];
          for (let i = 0; i < clonedVerts.length; i++) {
            const next = (i + 1) % clonedVerts.length;
            edges.push(new TopoEdge(clonedVerts[i], clonedVerts[next],
              new LineCurve(clonedVerts[i].point, clonedVerts[next].point)));
          }
          const loop = new TopoLoop(edges.map(e => ({ edge: e, reversed: false })));
          const fNormal = face.outerLoop.computeNormal();
          const surface = PlanarSurface.fromPlane(
            Plane.fromNormalAndPoint(new Vec3(fNormal.x, fNormal.y, fNormal.z), clonedVerts[0].point)
          );
          newFaces.push(new TopoFace(surface, loop));
        }
      }
    }

    const shell = new TopoShell(newFaces);
    const result = new TopoSolid(shell);
    result.name = 'PushPull';
    result.userData.featureType = 'pushpull';
    result.userData.params = { faceId, distance };
    return result;
  }

  /**
   * Move a face by a translation vector (not necessarily along normal).
   * @param {TopoSolid} solid
   * @param {number} faceId
   * @param {Vec3} translation
   * @returns {TopoSolid}
   */
  static moveFace(solid, faceId, translation) {
    return DirectEdit.pushPull(solid, faceId,
      translation.length() * Math.sign(translation.dot(
        (() => {
          const face = solid.faces().find(f => f.id === faceId);
          if (!face || !face.outerLoop) return Vec3.unitY();
          const n = face.outerLoop.computeNormal();
          return new Vec3(n.x, n.y, n.z);
        })()
      ))
    );
  }

  /**
   * Delete a face from a solid (creates an open shell).
   * @param {TopoSolid} solid
   * @param {number} faceId
   * @returns {TopoSolid}
   */
  static deleteFace(solid, faceId) {
    const remainingFaces = [];
    for (const face of solid.faces()) {
      if (face.id === faceId) continue;
      // Clone face vertices
      const origVerts = face.outerLoop.vertices();
      const clonedVerts = origVerts.map(v => new TopoVertex(v.point.clone()));
      const edges = [];
      for (let i = 0; i < clonedVerts.length; i++) {
        const next = (i + 1) % clonedVerts.length;
        edges.push(new TopoEdge(clonedVerts[i], clonedVerts[next],
          new LineCurve(clonedVerts[i].point, clonedVerts[next].point)));
      }
      const loop = new TopoLoop(edges.map(e => ({ edge: e, reversed: false })));
      const fNormal = face.outerLoop.computeNormal();
      const surface = PlanarSurface.fromPlane(
        Plane.fromNormalAndPoint(new Vec3(fNormal.x, fNormal.y, fNormal.z), clonedVerts[0].point)
      );
      remainingFaces.push(new TopoFace(surface, loop));
    }

    const shell = new TopoShell(remainingFaces);
    const result = new TopoSolid(shell);
    result.name = 'DeleteFace';
    result.userData.featureType = 'delete_face';
    result.userData.params = { faceId };
    return result;
  }

  /**
   * Shell a solid: remove specified faces and offset remaining faces inward.
   * Creates a hollow solid with uniform wall thickness.
   * @param {TopoSolid} solid
   * @param {number[]} removeFaceIds - Faces to remove (openings)
   * @param {number} thickness - Wall thickness
   * @returns {TopoSolid}
   */
  static shell(solid, removeFaceIds, thickness) {
    const removeSet = new Set(removeFaceIds);
    const outerFaces = [];
    const innerFaces = [];

    for (const face of solid.faces()) {
      if (removeSet.has(face.id)) continue;

      // Keep outer face
      const outerVerts = face.outerLoop.vertices();
      const clonedOuter = outerVerts.map(v => new TopoVertex(v.point.clone()));
      const outerEdges = [];
      for (let i = 0; i < clonedOuter.length; i++) {
        const next = (i + 1) % clonedOuter.length;
        outerEdges.push(new TopoEdge(clonedOuter[i], clonedOuter[next],
          new LineCurve(clonedOuter[i].point, clonedOuter[next].point)));
      }
      const outerLoop = new TopoLoop(outerEdges.map(e => ({ edge: e, reversed: false })));
      const fNormal = face.outerLoop.computeNormal();
      const normal = new Vec3(fNormal.x, fNormal.y, fNormal.z);
      outerFaces.push(new TopoFace(
        PlanarSurface.fromPlane(Plane.fromNormalAndPoint(normal, clonedOuter[0].point)),
        outerLoop
      ));

      // Create inner face (offset inward)
      const inwardDir = face.reversed ? normal : normal.negate();
      const innerVerts = outerVerts.map(v =>
        new TopoVertex(v.point.add(inwardDir.mul(thickness)))
      );
      // Reverse winding for inner surface
      innerVerts.reverse();
      const innerEdges = [];
      for (let i = 0; i < innerVerts.length; i++) {
        const next = (i + 1) % innerVerts.length;
        innerEdges.push(new TopoEdge(innerVerts[i], innerVerts[next],
          new LineCurve(innerVerts[i].point, innerVerts[next].point)));
      }
      const innerLoop = new TopoLoop(innerEdges.map(e => ({ edge: e, reversed: false })));
      innerFaces.push(new TopoFace(
        PlanarSurface.fromPlane(Plane.fromNormalAndPoint(normal.negate(), innerVerts[0].point)),
        innerLoop
      ));
    }

    const allFaces = [...outerFaces, ...innerFaces];
    const shellObj = new TopoShell(allFaces);
    const result = new TopoSolid(shellObj);
    result.name = 'Shell';
    result.userData.featureType = 'shell';
    result.userData.params = { removeFaceIds, thickness };
    return result;
  }
}
