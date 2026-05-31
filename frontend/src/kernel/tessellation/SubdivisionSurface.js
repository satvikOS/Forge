/**
 * ArchDisc — Catmull-Clark Subdivision Surface Engine
 * Converts B-Rep topology into smooth, high-polygon meshes.
 * Supports crease edges for sharp features (fillet boundaries, chamfer edges).
 *
 * This replaces flat tessellation for curved surfaces — every cylinder,
 * sphere, fillet, and freeform surface renders with photorealistic smoothness.
 */

import Vec3 from '../math/Vec3.js';

export default class SubdivisionSurface {

  /**
   * Subdivide a mesh using Catmull-Clark algorithm.
   * @param {Float32Array} positions - Vertex positions (x,y,z repeated)
   * @param {Uint32Array} indices - Triangle indices
   * @param {Float32Array} normals - Vertex normals
   * @param {Set<string>} creaseEdges - Set of "i-j" edge keys to keep sharp
   * @param {number} iterations - Subdivision iterations (1-3, each 4x poly count)
   * @returns {{ positions, normals, indices }}
   */
  static subdivide(positions, indices, normals, creaseEdges = new Set(), iterations = 1) {
    let verts = [];
    let faces = [];

    // Convert to working format
    const vertCount = positions.length / 3;
    for (let i = 0; i < vertCount; i++) {
      verts.push([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
    }

    // Convert triangles to face lists
    for (let i = 0; i < indices.length; i += 3) {
      faces.push([indices[i], indices[i + 1], indices[i + 2]]);
    }

    // Run subdivision iterations
    for (let iter = 0; iter < iterations; iter++) {
      const result = SubdivisionSurface._catmullClarkStep(verts, faces, creaseEdges);
      verts = result.verts;
      faces = result.faces;
    }

    // Convert back to typed arrays
    const outPos = new Float32Array(verts.length * 3);
    const outNorm = new Float32Array(verts.length * 3);

    for (let i = 0; i < verts.length; i++) {
      outPos[i * 3] = verts[i][0];
      outPos[i * 3 + 1] = verts[i][1];
      outPos[i * 3 + 2] = verts[i][2];
    }

    // Compute smooth normals
    SubdivisionSurface._computeNormals(outPos, faces, outNorm);

    // Triangulate quads
    const outIdx = [];
    for (const face of faces) {
      if (face.length === 3) {
        outIdx.push(face[0], face[1], face[2]);
      } else if (face.length === 4) {
        outIdx.push(face[0], face[1], face[2]);
        outIdx.push(face[0], face[2], face[3]);
      } else {
        // Fan triangulation for n-gons
        for (let i = 1; i < face.length - 1; i++) {
          outIdx.push(face[0], face[i], face[i + 1]);
        }
      }
    }

    return {
      positions: outPos,
      normals: outNorm,
      indices: new Uint32Array(outIdx),
    };
  }

  /**
   * One step of Catmull-Clark subdivision.
   * Triangles → quads, with face points, edge midpoints, and moved original vertices.
   */
  static _catmullClarkStep(verts, faces, creaseEdges) {
    const edgeMap = new Map(); // "min-max" → { midpoint index, face indices }
    const vertFaces = new Map(); // vert index → [face indices]
    const vertEdges = new Map(); // vert index → [edge keys]
    const newVerts = [...verts.map(v => [...v])]; // copy originals
    const facePoints = []; // one per face

    // Initialize adjacency
    for (let i = 0; i < verts.length; i++) {
      vertFaces.set(i, []);
      vertEdges.set(i, []);
    }

    // 1. Compute face points (centroid of each face)
    const facePointIndices = [];
    for (let fi = 0; fi < faces.length; fi++) {
      const face = faces[fi];
      let cx = 0, cy = 0, cz = 0;
      for (const vi of face) {
        cx += verts[vi][0];
        cy += verts[vi][1];
        cz += verts[vi][2];
        vertFaces.get(vi).push(fi);
      }
      const n = face.length;
      const fp = [cx / n, cy / n, cz / n];
      facePointIndices.push(newVerts.length);
      newVerts.push(fp);

      // Register edges
      for (let i = 0; i < face.length; i++) {
        const a = face[i], b = face[(i + 1) % face.length];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, { a, b, faces: [], midIndex: -1 });
        }
        edgeMap.get(key).faces.push(fi);
        if (!vertEdges.get(a).includes(key)) vertEdges.get(a).push(key);
        if (!vertEdges.get(b).includes(key)) vertEdges.get(b).push(key);
      }
    }

    // 2. Compute edge points
    for (const [key, edge] of edgeMap) {
      const isCrease = creaseEdges.has(key);
      let ep;

      if (isCrease || edge.faces.length < 2) {
        // Crease or boundary: midpoint of edge vertices
        ep = [
          (verts[edge.a][0] + verts[edge.b][0]) / 2,
          (verts[edge.a][1] + verts[edge.b][1]) / 2,
          (verts[edge.a][2] + verts[edge.b][2]) / 2,
        ];
      } else {
        // Average of edge endpoints + adjacent face points
        const fp0 = newVerts[facePointIndices[edge.faces[0]]];
        const fp1 = newVerts[facePointIndices[edge.faces[1]]];
        ep = [
          (verts[edge.a][0] + verts[edge.b][0] + fp0[0] + fp1[0]) / 4,
          (verts[edge.a][1] + verts[edge.b][1] + fp0[1] + fp1[1]) / 4,
          (verts[edge.a][2] + verts[edge.b][2] + fp0[2] + fp1[2]) / 4,
        ];
      }

      edge.midIndex = newVerts.length;
      newVerts.push(ep);
    }

    // 3. Move original vertices
    for (let vi = 0; vi < verts.length; vi++) {
      const adjFaces = vertFaces.get(vi);
      const adjEdges = vertEdges.get(vi);
      const n = adjFaces.length;

      if (n === 0) continue;

      // Check if this is a crease vertex
      const creaseCount = adjEdges.filter(k => creaseEdges.has(k)).length;

      if (creaseCount >= 2) {
        // Crease vertex: average of crease edge midpoints
        const creaseKeys = adjEdges.filter(k => creaseEdges.has(k));
        let mx = 0, my = 0, mz = 0;
        for (const ck of creaseKeys) {
          const e = edgeMap.get(ck);
          const other = e.a === vi ? e.b : e.a;
          mx += verts[other][0];
          my += verts[other][1];
          mz += verts[other][2];
        }
        const cn = creaseKeys.length;
        newVerts[vi] = [
          (mx / cn + verts[vi][0]) / 2,
          (my / cn + verts[vi][1]) / 2,
          (mz / cn + verts[vi][2]) / 2,
        ];
      } else {
        // Interior vertex: Catmull-Clark averaging
        // F = average of adjacent face points
        let fx = 0, fy = 0, fz = 0;
        for (const fi of adjFaces) {
          const fp = newVerts[facePointIndices[fi]];
          fx += fp[0]; fy += fp[1]; fz += fp[2];
        }
        fx /= n; fy /= n; fz /= n;

        // R = average of adjacent edge midpoints
        let rx = 0, ry = 0, rz = 0;
        for (const ek of adjEdges) {
          const e = edgeMap.get(ek);
          const mid = [(verts[e.a][0] + verts[e.b][0]) / 2, (verts[e.a][1] + verts[e.b][1]) / 2, (verts[e.a][2] + verts[e.b][2]) / 2];
          rx += mid[0]; ry += mid[1]; rz += mid[2];
        }
        const en = adjEdges.length;
        rx /= en; ry /= en; rz /= en;

        // New position: (F + 2R + (n-3)P) / n
        const p = verts[vi];
        newVerts[vi] = [
          (fx + 2 * rx + (n - 3) * p[0]) / n,
          (fy + 2 * ry + (n - 3) * p[1]) / n,
          (fz + 2 * rz + (n - 3) * p[2]) / n,
        ];
      }
    }

    // 4. Create new faces (each original face → n quads)
    const newFaces = [];
    for (let fi = 0; fi < faces.length; fi++) {
      const face = faces[fi];
      const fpIdx = facePointIndices[fi];

      for (let i = 0; i < face.length; i++) {
        const prev = face[(i + face.length - 1) % face.length];
        const curr = face[i];
        const next = face[(i + 1) % face.length];

        const edgeKeyPrev = curr < prev ? `${curr}-${prev}` : `${prev}-${curr}`;
        const edgeKeyNext = curr < next ? `${curr}-${next}` : `${next}-${curr}`;

        const epPrev = edgeMap.get(edgeKeyPrev).midIndex;
        const epNext = edgeMap.get(edgeKeyNext).midIndex;

        newFaces.push([curr, epNext, fpIdx, epPrev]);
      }
    }

    return { verts: newVerts, faces: newFaces };
  }

  /**
   * Compute smooth vertex normals from face normals.
   */
  static _computeNormals(positions, faces, outNormals) {
    const vertCount = positions.length / 3;
    const nx = new Float32Array(vertCount);
    const ny = new Float32Array(vertCount);
    const nz = new Float32Array(vertCount);

    for (const face of faces) {
      // Compute face normal (Newell's method for arbitrary polygons)
      let fnx = 0, fny = 0, fnz = 0;
      for (let i = 0; i < face.length; i++) {
        const curr = face[i];
        const next = face[(i + 1) % face.length];
        const cx = positions[curr * 3], cy = positions[curr * 3 + 1], cz = positions[curr * 3 + 2];
        const nnx = positions[next * 3], nny = positions[next * 3 + 1], nnz = positions[next * 3 + 2];
        fnx += (cy - nny) * (cz + nnz);
        fny += (cz - nnz) * (cx + nnx);
        fnz += (cx - nnx) * (cy + nny);
      }

      // Normalize
      const len = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz);
      if (len > 1e-10) { fnx /= len; fny /= len; fnz /= len; }

      // Accumulate to vertices
      for (const vi of face) {
        nx[vi] += fnx;
        ny[vi] += fny;
        nz[vi] += fnz;
      }
    }

    // Normalize per-vertex
    for (let i = 0; i < vertCount; i++) {
      const len = Math.sqrt(nx[i] * nx[i] + ny[i] * ny[i] + nz[i] * nz[i]);
      if (len > 1e-10) {
        outNormals[i * 3] = nx[i] / len;
        outNormals[i * 3 + 1] = ny[i] / len;
        outNormals[i * 3 + 2] = nz[i] / len;
      } else {
        outNormals[i * 3] = 0;
        outNormals[i * 3 + 1] = 1;
        outNormals[i * 3 + 2] = 0;
      }
    }
  }

  /**
   * Apply subdivision to a TopoSolid, returning smooth Three.js geometry data.
   * @param {TopoSolid} solid
   * @param {number} level - Subdivision level (0=flat, 1=smooth, 2=very smooth)
   * @returns {{ positions, normals, indices }}
   */
  static subdivideSolid(solid, level = 1) {
    // First tessellate to get base mesh
    const { default: Tessellator } = require('./Tessellator.js');
    const base = Tessellator.tessellate(solid);

    if (level === 0) {
      return { positions: base.vertices, normals: base.normals, indices: base.indices };
    }

    // Identify crease edges (edges between faces with sharp angle > 30°)
    const creaseEdges = new Set();
    const edgeFaceNormals = new Map();

    // Build edge → face normal map from topology
    for (const edge of solid.edges()) {
      const faces = [...edge.faces];
      if (faces.length === 2) {
        const n1 = faces[0].outerLoop?.computeNormal();
        const n2 = faces[1].outerLoop?.computeNormal();
        if (n1 && n2) {
          const dot = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
          if (dot < 0.866) { // > 30° angle
            // Mark as crease — find vertex indices
            // Simplified: mark by vertex ID pair
            creaseEdges.add(`${edge.startVertex.id}-${edge.endVertex.id}`);
          }
        }
      }
    }

    return SubdivisionSurface.subdivide(base.vertices, base.indices, base.normals, creaseEdges, level);
  }
}
