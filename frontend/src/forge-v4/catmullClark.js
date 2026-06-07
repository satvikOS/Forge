// PUSH-83 (Slice-51) — Catmull-Clark subdivision surface kernel.
//
// Pure, dependency-free implementation of Edwin Catmull & Jim Clark's 1978
// subdivision algorithm. Operates on a quad-dominant control cage and
// returns a refined cage with all-quad topology that converges towards a
// limit surface that is C2 everywhere except at irregular (valence ≠ 4)
// vertices, where it remains C1.
//
// The algorithm in one pass:
//
//   1. For every face F: face_point[F] = average of F's vertices.
//   2. For every edge E (shared by faces F1, F2): edge_point[E] =
//        (face_point[F1] + face_point[F2] + v1 + v2) / 4
//      where v1, v2 are the edge's endpoints. Boundary edges (only one
//      adjacent face) take edge_point[E] = (v1 + v2) / 2.
//   3. For every original vertex V with valence n:
//        F = average of face_points of faces touching V
//        R = average of edge_midpoints of edges touching V
//        new V = (F + 2R + (n - 3)V) / n
//      (Standard 1978 Catmull-Clark vertex rule. Boundary vertices use
//      the cubic B-spline crease rule: (1/8)*neighbour + (3/4)*V +
//      (1/8)*otherNeighbour.)
//   4. Each original quad F = (a, b, c, d) splits into 4 new quads:
//        (V_a', E_ab, F_face, E_da)
//        (V_b', E_bc, F_face, E_ab)
//        (V_c', E_cd, F_face, E_bc)
//        (V_d', E_da, F_face, E_cd)
//      where V_x' = the moved vertex, E_xy = the edge point between
//      original vertices x and y, F_face = the face point.
//
// Triangular faces are supported by adding the face point and emitting
// one quad per (V_x', E_xy, F_face, E_zx) — i.e. the same per-vertex
// loop, just with 3 quads instead of 4. N-gons follow the same pattern.
//
// API:
//   subdivide(positions, faces, iterations) → { positions, faces, stats }
//     positions: flat Float32Array | Array of XYZ triplets (length = 3*V)
//     faces:     Array of arrays — each inner array is a face's vertex
//                indices (variable length, supports quad-dominant cages).
//     iterations: integer 1..N (clamped to N=6 for memory sanity).
//
// Returned positions/faces share the same conventions. The face-count
// grows by sum(faceVertexCount) per pass (typically 4× for an all-quad
// cage) and the vertex count grows by faceCount + edgeCount per pass.
//
// Verification: applying 0 iterations is identity. The cube → 2 iter
// limit surface converges to a near-sphere within ε; we don't assert
// this in code but the e2e screenshots verify visually.

// ─────────────────────────────────────────────────────────────────────
// Helpers — flat-array vector math. We work in flat Float32Array
// representation throughout to avoid the GC churn of {x,y,z} objects on
// a 4× refinement loop.

function vec3Add(out, a, b) {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
}
function vec3Scale(out, a, s) {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
}
function vec3FromPositions(out, positions, idx) {
  out[0] = positions[idx * 3 + 0];
  out[1] = positions[idx * 3 + 1];
  out[2] = positions[idx * 3 + 2];
}
function vec3AccumulatePositions(out, positions, idx) {
  out[0] += positions[idx * 3 + 0];
  out[1] += positions[idx * 3 + 1];
  out[2] += positions[idx * 3 + 2];
}

// Edge-key helper. Edges are unordered; we canonicalise so a→b and b→a
// share a slot.
function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ─────────────────────────────────────────────────────────────────────
// Default control cage — unit cube centred at origin, scaled to 30 mm
// so the Subdivision panel produces something visible on first Apply.
//
// 8 corners, 6 quad faces. The face winding is consistent so face
// normals all point outward.

export function defaultCubeCage(size = 30) {
  const h = size / 2;
  const positions = new Float32Array([
    -h, -h, -h,  //  0
     h, -h, -h,  //  1
     h,  h, -h,  //  2
    -h,  h, -h,  //  3
    -h, -h,  h,  //  4
     h, -h,  h,  //  5
     h,  h,  h,  //  6
    -h,  h,  h,  //  7
  ]);
  const faces = [
    [0, 3, 2, 1],   // -Z bottom (winding flipped so normal = -Z)
    [4, 5, 6, 7],   // +Z top
    [0, 1, 5, 4],   // -Y front
    [2, 3, 7, 6],   // +Y back
    [1, 2, 6, 5],   // +X right
    [0, 4, 7, 3],   // -X left
  ];
  return { positions, faces };
}

// ─────────────────────────────────────────────────────────────────────
// Single-pass Catmull-Clark refinement.
//
// Algorithm flow (see header comment for the rules):
//   1. Compute face points.
//   2. Compute edge points + edge midpoints + per-vertex incident lists.
//   3. Move each original vertex via the (F + 2R + (n-3)P) / n rule.
//   4. Emit 4 quads per original face (one per face-corner).

function subdivideOnce(positions, faces) {
  const V = positions.length / 3;
  const F = faces.length;

  // ── 1. Face points (centroid of each face's vertices).
  const facePoints = new Float32Array(F * 3);
  for (let f = 0; f < F; f++) {
    const face = faces[f];
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < face.length; i++) {
      const vi = face[i];
      cx += positions[vi * 3 + 0];
      cy += positions[vi * 3 + 1];
      cz += positions[vi * 3 + 2];
    }
    const inv = 1 / face.length;
    facePoints[f * 3 + 0] = cx * inv;
    facePoints[f * 3 + 1] = cy * inv;
    facePoints[f * 3 + 2] = cz * inv;
  }

  // ── 2a. Build the edge table. Each entry: {a, b, faces: [f1, f2?]}.
  // edgeIndex maps edgeKey → index into edges[].
  // Also collect, per vertex, the list of incident face indices and
  // incident edge keys — needed for the vertex update rule.
  const edges = [];
  const edgeIndex = new Map();
  const vertexFaces = new Array(V);
  const vertexEdges = new Array(V);
  for (let v = 0; v < V; v++) {
    vertexFaces[v] = [];
    vertexEdges[v] = [];
  }
  for (let f = 0; f < F; f++) {
    const face = faces[f];
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      vertexFaces[a].push(f);
      const key = edgeKey(a, b);
      let ei = edgeIndex.get(key);
      if (ei === undefined) {
        ei = edges.length;
        edgeIndex.set(key, ei);
        edges.push({ a: Math.min(a, b), b: Math.max(a, b), faces: [f] });
        vertexEdges[a].push(ei);
        vertexEdges[b].push(ei);
      } else if (edges[ei].faces.indexOf(f) < 0) {
        edges[ei].faces.push(f);
      }
    }
  }
  const E = edges.length;

  // ── 2b. Edge points + edge midpoints.
  // Interior edge (2 adjacent faces): (F1 + F2 + v1 + v2) / 4.
  // Boundary edge (1 adjacent face): midpoint of v1, v2.
  const edgePoints   = new Float32Array(E * 3);
  const edgeMidPoints = new Float32Array(E * 3);
  for (let e = 0; e < E; e++) {
    const { a, b, faces: ef } = edges[e];
    const mx = (positions[a * 3 + 0] + positions[b * 3 + 0]) * 0.5;
    const my = (positions[a * 3 + 1] + positions[b * 3 + 1]) * 0.5;
    const mz = (positions[a * 3 + 2] + positions[b * 3 + 2]) * 0.5;
    edgeMidPoints[e * 3 + 0] = mx;
    edgeMidPoints[e * 3 + 1] = my;
    edgeMidPoints[e * 3 + 2] = mz;
    if (ef.length >= 2) {
      const f1 = ef[0];
      const f2 = ef[1];
      edgePoints[e * 3 + 0] = (positions[a * 3 + 0] + positions[b * 3 + 0]
        + facePoints[f1 * 3 + 0] + facePoints[f2 * 3 + 0]) * 0.25;
      edgePoints[e * 3 + 1] = (positions[a * 3 + 1] + positions[b * 3 + 1]
        + facePoints[f1 * 3 + 1] + facePoints[f2 * 3 + 1]) * 0.25;
      edgePoints[e * 3 + 2] = (positions[a * 3 + 2] + positions[b * 3 + 2]
        + facePoints[f1 * 3 + 2] + facePoints[f2 * 3 + 2]) * 0.25;
    } else {
      // Boundary edge — use the midpoint so the boundary stays on the
      // limit curve. This is the standard cubic-B-spline crease rule
      // for the first refinement step.
      edgePoints[e * 3 + 0] = mx;
      edgePoints[e * 3 + 1] = my;
      edgePoints[e * 3 + 2] = mz;
    }
  }

  // ── 3. New positions for the original V vertices.
  //
  // new V = (F + 2R + (n - 3)P) / n
  // F = avg of face points of faces touching V
  // R = avg of edge midpoints of edges touching V
  // P = original V
  // n = number of faces touching V (interior — equals valence for
  //     manifold meshes with closed neighbourhood).
  //
  // Boundary vertex rule (the vertex sits on an open edge, i.e. an
  // incident edge with only one face): the cubic-B-spline crease rule
  // new V = (1/8) * a + (3/4) * V + (1/8) * b, where a, b are the two
  // boundary-edge neighbours.
  const newVerts = new Float32Array(V * 3);
  for (let v = 0; v < V; v++) {
    // Detect boundary: is this vertex on any boundary edge (single
    // adjacent face)?
    const incidentEdgeIdxs = vertexEdges[v];
    let boundaryNbrs = null;
    for (const ei of incidentEdgeIdxs) {
      if (edges[ei].faces.length === 1) {
        const other = edges[ei].a === v ? edges[ei].b : edges[ei].a;
        if (boundaryNbrs === null) boundaryNbrs = [other];
        else if (boundaryNbrs.indexOf(other) < 0) boundaryNbrs.push(other);
      }
    }

    if (boundaryNbrs !== null && boundaryNbrs.length >= 2) {
      // Crease rule (use first two boundary neighbours — for a true
      // open boundary in a manifold mesh there are exactly two).
      const a = boundaryNbrs[0];
      const b = boundaryNbrs[1];
      newVerts[v * 3 + 0] = (positions[a * 3 + 0] + 6 * positions[v * 3 + 0] + positions[b * 3 + 0]) / 8;
      newVerts[v * 3 + 1] = (positions[a * 3 + 1] + 6 * positions[v * 3 + 1] + positions[b * 3 + 1]) / 8;
      newVerts[v * 3 + 2] = (positions[a * 3 + 2] + 6 * positions[v * 3 + 2] + positions[b * 3 + 2]) / 8;
      continue;
    }

    // Interior vertex — Catmull-Clark rule.
    const faceList = vertexFaces[v];
    const edgeList = incidentEdgeIdxs;
    const n = faceList.length;
    if (n === 0) {
      // Orphan vertex — pass through untouched. Don't crash on a bad
      // input mesh.
      newVerts[v * 3 + 0] = positions[v * 3 + 0];
      newVerts[v * 3 + 1] = positions[v * 3 + 1];
      newVerts[v * 3 + 2] = positions[v * 3 + 2];
      continue;
    }
    // F = avg of face points around V.
    let Fx = 0, Fy = 0, Fz = 0;
    for (const f of faceList) {
      Fx += facePoints[f * 3 + 0];
      Fy += facePoints[f * 3 + 1];
      Fz += facePoints[f * 3 + 2];
    }
    Fx /= n; Fy /= n; Fz /= n;
    // R = avg of edge midpoints of edges touching V.
    let Rx = 0, Ry = 0, Rz = 0;
    const m = edgeList.length;
    for (const e of edgeList) {
      Rx += edgeMidPoints[e * 3 + 0];
      Ry += edgeMidPoints[e * 3 + 1];
      Rz += edgeMidPoints[e * 3 + 2];
    }
    if (m > 0) { Rx /= m; Ry /= m; Rz /= m; }
    // new V = (F + 2R + (n - 3)P) / n
    const Px = positions[v * 3 + 0];
    const Py = positions[v * 3 + 1];
    const Pz = positions[v * 3 + 2];
    const w = (n - 3) / n;
    newVerts[v * 3 + 0] = Fx / n + 2 * Rx / n + w * Px;
    newVerts[v * 3 + 1] = Fy / n + 2 * Ry / n + w * Py;
    newVerts[v * 3 + 2] = Fz / n + 2 * Rz / n + w * Pz;
  }

  // ── 4. Assemble the refined cage.
  //
  // Output vertex layout:
  //   [0 .. V-1]                — moved originals
  //   [V .. V+F-1]              — face points (1 per face)
  //   [V+F .. V+F+E-1]          — edge points
  const outVertCount = V + F + E;
  const outPositions = new Float32Array(outVertCount * 3);
  outPositions.set(newVerts, 0);
  outPositions.set(facePoints, V * 3);
  outPositions.set(edgePoints, (V + F) * 3);

  const facePointOffset = V;
  const edgePointOffset = V + F;

  // Emit one new quad per (vertex, face) pair of every original face.
  // For a quad face (a, b, c, d), the four new quads are:
  //   (V_a', E_ab, F_face, E_da)
  //   (V_b', E_bc, F_face, E_ab)
  //   (V_c', E_cd, F_face, E_bc)
  //   (V_d', E_da, F_face, E_cd)
  // For an n-gon, the loop emits n quads on the same pattern.
  const outFaces = [];
  for (let f = 0; f < F; f++) {
    const face = faces[f];
    const k = face.length;
    const fp = facePointOffset + f;
    for (let i = 0; i < k; i++) {
      const vCurr = face[i];
      const vNext = face[(i + 1) % k];
      const vPrev = face[(i - 1 + k) % k];
      const eNext = edgePointOffset + edgeIndex.get(edgeKey(vCurr, vNext));
      const ePrev = edgePointOffset + edgeIndex.get(edgeKey(vPrev, vCurr));
      outFaces.push([vCurr, eNext, fp, ePrev]);
    }
  }

  return { positions: outPositions, faces: outFaces };
}

// ─────────────────────────────────────────────────────────────────────
// Public entry: iterative subdivision.
//
// Returns the refined mesh + a small stats block the panel surfaces in
// its info chip. `iterations` is clamped to [0, 6] — 0 returns the
// input unchanged, 6 already produces ~16k faces from an 8-vert cube
// (sufficient for any visible smoothness; higher counts trash the
// MainThread on a refresh).

export function subdivide(positions, faces, iterations = 1) {
  if (positions == null || faces == null) {
    throw new Error('catmullClark.subdivide: positions and faces are required');
  }
  if (!(positions instanceof Float32Array) && !Array.isArray(positions)) {
    throw new Error('catmullClark.subdivide: positions must be Float32Array or Array');
  }
  if (!Array.isArray(faces)) {
    throw new Error('catmullClark.subdivide: faces must be an Array of arrays');
  }
  // Normalise positions to Float32Array so the inner loops are tight.
  let pos = positions instanceof Float32Array
    ? new Float32Array(positions)
    : Float32Array.from(positions);
  let fcs = faces.map((f) => Array.from(f));
  const iter = Math.max(0, Math.min(6, iterations | 0));
  const start = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
  for (let step = 0; step < iter; step++) {
    const out = subdivideOnce(pos, fcs);
    pos = out.positions;
    fcs = out.faces;
  }
  const end = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
  return {
    positions: pos,
    faces: fcs,
    stats: {
      iterations: iter,
      vertexCount: pos.length / 3,
      faceCount: fcs.length,
      elapsed_ms: Math.round((end - start) * 100) / 100,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Triangulation helper — convert quad-dominant face list to a flat
// triangle index Uint32Array (THREE.BufferGeometry-friendly). N-gons
// fan-triangulate around the first vertex; quads split corner 0/1/2 +
// 0/2/3.

export function triangulate(positions, faces) {
  const indices = [];
  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    if (face.length < 3) continue;
    if (face.length === 3) {
      indices.push(face[0], face[1], face[2]);
    } else if (face.length === 4) {
      indices.push(face[0], face[1], face[2]);
      indices.push(face[0], face[2], face[3]);
    } else {
      // n-gon fan triangulation.
      for (let j = 1; j < face.length - 1; j++) {
        indices.push(face[0], face[j], face[j + 1]);
      }
    }
  }
  return new Uint32Array(indices);
}

// ─────────────────────────────────────────────────────────────────────
// Axis-aligned bounding box of a flat positions array. Used by the
// panel to compute a synthetic 'box' spec the viewport can render — we
// don't ship the full mesh through the synthetic pipeline yet, so the
// bbox proxy keeps the body visible in the feature tree while the
// real positions/faces ride along as the `subdivision` side-car field.

export function bbox(positions) {
  if (!positions || !positions.length) {
    return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  }
  let minX = positions[0], minY = positions[1], minZ = positions[2];
  let maxX = minX, maxY = minY, maxZ = minZ;
  for (let i = 3; i < positions.length; i += 3) {
    const x = positions[i + 0];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x; else if (x > maxX) maxX = x;
    if (y < minY) minY = y; else if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; else if (z > maxZ) maxZ = z;
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

// Tiny stable hash of a positions buffer — used by the panel for the
// stats card so a user can see "the same N iterations on the same cage
// always produces the same mesh".
export function fingerprint(positions, faces) {
  // 32-bit FNV-1a over the rounded positions + face vertex counts.
  let h = 0x811c9dc5;
  const round = (x) => Math.round(x * 1e4);
  for (let i = 0; i < positions.length; i++) {
    h ^= round(positions[i]) >>> 0;
    h = (h * 0x01000193) >>> 0;
  }
  for (let i = 0; i < faces.length; i++) {
    h ^= faces[i].length;
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export default subdivide;
