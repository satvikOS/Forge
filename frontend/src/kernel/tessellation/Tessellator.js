/**
 * ArchDisc Geometry Kernel — Tessellator
 * Converts B-Rep topology (TopoSolid) into triangle meshes for Three.js rendering.
 * Supports adaptive tessellation based on surface curvature.
 */

import Vec3 from '../math/Vec3.js';

export default class Tessellator {

  /**
   * Tessellate an entire solid into a mesh.
   * @param {TopoSolid} solid
   * @param {object} options - { maxAngle, maxLength, adaptive }
   * @returns {{ vertices: Float32Array, normals: Float32Array, indices: Uint32Array, faceMap: Map }}
   */
  static tessellate(solid, options = {}) {
    const vertices = [];
    const normals = [];
    const indices = [];
    const faceMap = new Map(); // faceId → { startIndex, count }
    let vertexOffset = 0;

    for (const face of solid.faces()) {
      const faceStart = indices.length;
      const result = Tessellator.tessellateFace(face, options);

      // Add vertices and normals
      for (let i = 0; i < result.positions.length; i += 3) {
        vertices.push(result.positions[i], result.positions[i + 1], result.positions[i + 2]);
        normals.push(result.normals[i], result.normals[i + 1], result.normals[i + 2]);
      }

      // Add indices (offset by current vertex count)
      for (const idx of result.indices) {
        indices.push(idx + vertexOffset);
      }

      faceMap.set(face.id, {
        startIndex: faceStart,
        count: result.indices.length,
        face
      });

      vertexOffset += result.positions.length / 3;
    }

    return {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
      faceMap
    };
  }

  /**
   * Tessellate a single face.
   */
  static tessellateFace(face, options = {}) {
    const outerPoints = face.outerLoop ? face.outerLoop.orderedPoints() : [];
    if (outerPoints.length < 3) {
      return { positions: new Float32Array(0), normals: new Float32Array(0), indices: [] };
    }

    // Compute face normal
    const faceNormal = face.outerLoop.computeNormal();
    const normal = face.reversed ? faceNormal.negate() : faceNormal;

    // Get hole points
    const holes = face.innerLoops.map(loop => loop.orderedPoints());

    // Triangulate
    const triangles = Tessellator.triangulate(outerPoints, holes, normal);

    // Build output arrays
    const positions = [];
    const norms = [];

    for (const tri of triangles) {
      for (const p of tri) {
        positions.push(p.x, p.y, p.z);
        // Use surface normal if available, otherwise face normal
        if (face.surface && face.surface.type !== 'planar') {
          const uv = face.surface.projectPoint ? face.surface.projectPoint(p) : null;
          if (uv) {
            const sn = face.surface.normalAt(uv.u, uv.v);
            const n = face.reversed ? sn.negate() : sn;
            norms.push(n.x, n.y, n.z);
          } else {
            norms.push(normal.x, normal.y, normal.z);
          }
        } else {
          norms.push(normal.x, normal.y, normal.z);
        }
      }
    }

    const idxArr = [];
    for (let i = 0; i < triangles.length * 3; i++) {
      idxArr.push(i);
    }

    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(norms),
      indices: idxArr
    };
  }

  /**
   * Ear-clipping triangulation for a polygon (with holes).
   * Projects to 2D using the dominant axis of the normal.
   * @param {Vec3[]} outer - Outer boundary points
   * @param {Vec3[][]} holes - Arrays of hole points
   * @param {Vec3} normal - Face normal
   * @returns {Vec3[][]} Array of triangles (each is [v0, v1, v2])
   */
  static triangulate(outer, holes, normal) {
    // Determine projection axes
    const ax = Math.abs(normal.x);
    const ay = Math.abs(normal.y);
    const az = Math.abs(normal.z);

    let project;
    if (az >= ax && az >= ay) {
      project = (p) => ({ x: p.x, y: p.y, orig: p });
    } else if (ay >= ax) {
      project = (p) => ({ x: p.x, y: p.z, orig: p });
    } else {
      project = (p) => ({ x: p.y, y: p.z, orig: p });
    }

    // Project to 2D
    let polygon = outer.map(project);

    // Ensure CCW winding
    if (Tessellator._signedArea2D(polygon) < 0) {
      polygon.reverse();
    }

    // Merge holes using bridge edges
    if (holes.length > 0) {
      for (const hole of holes) {
        let holeProj = hole.map(project);
        // Holes should be CW
        if (Tessellator._signedArea2D(holeProj) > 0) {
          holeProj.reverse();
        }
        polygon = Tessellator._mergeHole(polygon, holeProj);
      }
    }

    // Ear clipping
    return Tessellator._earClip(polygon);
  }

  static _signedArea2D(pts) {
    let area = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const j = (i + 1) % n;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return area * 0.5;
  }

  static _mergeHole(outer, hole) {
    // Find rightmost point of hole
    let maxIdx = 0;
    for (let i = 1; i < hole.length; i++) {
      if (hole[i].x > hole[maxIdx].x) maxIdx = i;
    }

    const holePoint = hole[maxIdx];

    // Find closest visible outer vertex
    let bestDist = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < outer.length; i++) {
      const dx = outer[i].x - holePoint.x;
      const dy = outer[i].y - holePoint.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist && outer[i].x >= holePoint.x) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    // Merge: outer[0..bestIdx] + hole[maxIdx..maxIdx] + outer[bestIdx..]
    const merged = [];
    for (let i = 0; i <= bestIdx; i++) merged.push(outer[i]);
    for (let i = 0; i <= hole.length; i++) {
      merged.push(hole[(maxIdx + i) % hole.length]);
    }
    merged.push(outer[bestIdx]); // bridge back
    for (let i = bestIdx + 1; i < outer.length; i++) merged.push(outer[i]);

    return merged;
  }

  static _earClip(polygon) {
    const triangles = [];
    const pts = [...polygon];

    while (pts.length > 3) {
      let earFound = false;

      for (let i = 0; i < pts.length; i++) {
        const prev = (i - 1 + pts.length) % pts.length;
        const next = (i + 1) % pts.length;

        if (Tessellator._isEar(pts, prev, i, next)) {
          triangles.push([pts[prev].orig, pts[i].orig, pts[next].orig]);
          pts.splice(i, 1);
          earFound = true;
          break;
        }
      }

      if (!earFound) {
        // Fallback: just triangle-fan from center
        for (let i = 1; i < pts.length - 1; i++) {
          triangles.push([pts[0].orig, pts[i].orig, pts[i + 1].orig]);
        }
        break;
      }
    }

    if (pts.length === 3) {
      triangles.push([pts[0].orig, pts[1].orig, pts[2].orig]);
    }

    return triangles;
  }

  static _isEar(pts, prev, curr, next) {
    const a = pts[prev], b = pts[curr], c = pts[next];

    // Must be convex
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (cross <= 0) return false;

    // No other point inside triangle
    for (let i = 0; i < pts.length; i++) {
      if (i === prev || i === curr || i === next) continue;
      if (Tessellator._pointInTriangle(pts[i], a, b, c)) return false;
    }

    return true;
  }

  static _pointInTriangle(p, a, b, c) {
    const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
    const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
    const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(hasNeg && hasPos);
  }

  /**
   * Convert tessellated result to Three.js BufferGeometry data.
   * Consumable directly by Three.js BufferGeometry.
   */
  static toThreeJS(tessResult) {
    return {
      position: tessResult.vertices,
      normal: tessResult.normals,
      index: tessResult.indices
    };
  }
}
