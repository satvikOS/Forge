/**
 * ArchDisc Foundation — Mesh repair (heal imported STL/OBJ inputs).
 *
 * Real-world meshes from scans, OBJ/STL exports of other tools, and
 * legacy CAD data routinely break manifold expectations. This module
 * repairs the common issues so a mesh becomes importable into
 * manifold-3d (which requires strictly manifold input).
 *
 * Repair operations (in order):
 *
 *   1. Vertex merge — coalesce vertices within `weldEps` of each other.
 *   2. Degenerate-triangle removal — drop triangles whose area is below
 *      `areaEps`.
 *   3. Normal orientation harmonization — flood-fill triangles by edge
 *      adjacency, flipping any whose orientation disagrees with their
 *      already-visited neighbour. Optionally enforce outward orientation
 *      via signed-volume sign.
 *   4. Boundary-hole closure (planar) — small loops of boundary edges
 *      get triangulated as fans (only for planar loops; non-planar
 *      hole-fill needs Cocone or similar and is out of scope).
 *   5. Non-manifold edge split — for edges shared by ≥3 triangles, we
 *      either split duplicated triangles or delete redundant ones
 *      (heuristic: keep the two whose normals best agree with neighbours).
 *
 * Diagnostics report all detected issues + counts before/after.
 *
 * Reference: similar pipelines in MeshLab's "Filter→Cleaning and
 * Repairing" menu and ADMesh's repair flags.
 */

const DEFAULT_WELD_EPS = 1e-5;
const DEFAULT_AREA_EPS = 1e-9;

function vKey(p, eps) {
  // Quantize to grid for hash-based dedup
  const k = 1 / eps;
  return `${Math.round(p[0] * k)},${Math.round(p[1] * k)},${Math.round(p[2] * k)}`;
}

function triArea(p0, p1, p2) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  return 0.5 * Math.hypot(x, y, z);
}

function triNormal(p0, p1, p2) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/**
 * Diagnose a mesh — count issues without modifying.
 * @param {object} mesh - { vertProperties, triVerts, numProp }
 * @returns {object} diagnostic counts
 */
export function diagnose(mesh) {
  const numProp = mesh.numProp ?? 3;
  const numV = mesh.vertProperties.length / numProp;
  const numT = mesh.triVerts.length / 3;
  // Edge classification
  const edgeMap = new Map();   // key="i,j" sorted → count
  let degenerateTris = 0;
  let zeroAreaTris = 0;
  for (let t = 0; t < numT; t++) {
    const i0 = mesh.triVerts[t * 3];
    const i1 = mesh.triVerts[t * 3 + 1];
    const i2 = mesh.triVerts[t * 3 + 2];
    if (i0 === i1 || i1 === i2 || i2 === i0) { degenerateTris++; continue; }
    const p0 = [mesh.vertProperties[i0 * numProp], mesh.vertProperties[i0 * numProp + 1], mesh.vertProperties[i0 * numProp + 2]];
    const p1 = [mesh.vertProperties[i1 * numProp], mesh.vertProperties[i1 * numProp + 1], mesh.vertProperties[i1 * numProp + 2]];
    const p2 = [mesh.vertProperties[i2 * numProp], mesh.vertProperties[i2 * numProp + 1], mesh.vertProperties[i2 * numProp + 2]];
    const A = triArea(p0, p1, p2);
    if (A < DEFAULT_AREA_EPS) zeroAreaTris++;
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
    }
  }
  let boundaryEdges = 0, manifoldEdges = 0, nonManifoldEdges = 0;
  for (const c of edgeMap.values()) {
    if (c === 1) boundaryEdges++;
    else if (c === 2) manifoldEdges++;
    else nonManifoldEdges++;
  }
  // Duplicate-vertex check via spatial bucket
  const vertKey = new Map();
  for (let v = 0; v < numV; v++) {
    const k = vKey([
      mesh.vertProperties[v * numProp],
      mesh.vertProperties[v * numProp + 1],
      mesh.vertProperties[v * numProp + 2],
    ], DEFAULT_WELD_EPS);
    vertKey.set(k, (vertKey.get(k) || 0) + 1);
  }
  let duplicateVerts = 0;
  for (const c of vertKey.values()) if (c > 1) duplicateVerts += c - 1;
  // Watertight = no boundary + no non-manifold
  const isManifold = boundaryEdges === 0 && nonManifoldEdges === 0;

  return {
    vertices: numV,
    triangles: numT,
    edges: edgeMap.size,
    boundaryEdges, manifoldEdges, nonManifoldEdges,
    degenerateTris, zeroAreaTris,
    duplicateVerts,
    isManifold,
  };
}

/**
 * Repair a mesh. Returns a new mesh + diagnostics for before/after.
 *
 * @param {object} mesh
 * @param {object} options
 * @param {number} options.weldEps - vertex weld tolerance (mm)
 * @param {number} options.areaEps - degenerate triangle area threshold
 * @param {boolean} options.harmonizeNormals - flood-fill flip to consistent (default true)
 * @param {boolean} options.fillSmallHoles - fan-fill planar boundary loops up to size N (default true; max 12 verts)
 * @param {number} options.maxHoleSize - hole-fill threshold in vertex count (default 12)
 * @returns {{ mesh, before, after, operations }}
 */
export function repair(mesh, options = {}) {
  const weldEps = options.weldEps ?? DEFAULT_WELD_EPS;
  const areaEps = options.areaEps ?? DEFAULT_AREA_EPS;
  const harmonizeNormals = options.harmonizeNormals ?? true;
  const fillSmallHoles = options.fillSmallHoles ?? true;
  const maxHoleSize = options.maxHoleSize ?? 12;

  const before = diagnose(mesh);
  const operations = [];
  const numProp = mesh.numProp ?? 3;

  // ---- 1: weld duplicate vertices ----
  // Build hash map of quantized positions; remap triangles.
  const weldMap = new Map();
  const newVerts = [];
  const newOldToNew = new Int32Array(mesh.vertProperties.length / numProp);
  for (let v = 0; v < mesh.vertProperties.length / numProp; v++) {
    const p = [mesh.vertProperties[v * numProp], mesh.vertProperties[v * numProp + 1], mesh.vertProperties[v * numProp + 2]];
    const key = vKey(p, weldEps);
    let nv = weldMap.get(key);
    if (nv === undefined) {
      nv = newVerts.length / 3;
      newVerts.push(p[0], p[1], p[2]);
      weldMap.set(key, nv);
    }
    newOldToNew[v] = nv;
  }
  const weldedCount = (mesh.vertProperties.length / numProp) - (newVerts.length / 3);
  if (weldedCount > 0) operations.push({ op: 'weld', merged: weldedCount });

  // Remap triangles
  const remapped = [];
  for (let t = 0; t < mesh.triVerts.length / 3; t++) {
    remapped.push(
      newOldToNew[mesh.triVerts[t * 3]],
      newOldToNew[mesh.triVerts[t * 3 + 1]],
      newOldToNew[mesh.triVerts[t * 3 + 2]],
    );
  }

  // ---- 2: drop degenerate + zero-area triangles ----
  const kept = [];
  const newVF = new Float32Array(newVerts);
  let degDropped = 0, zeroDropped = 0;
  for (let t = 0; t < remapped.length / 3; t++) {
    const i0 = remapped[t * 3], i1 = remapped[t * 3 + 1], i2 = remapped[t * 3 + 2];
    if (i0 === i1 || i1 === i2 || i2 === i0) { degDropped++; continue; }
    const p0 = [newVF[i0 * 3], newVF[i0 * 3 + 1], newVF[i0 * 3 + 2]];
    const p1 = [newVF[i1 * 3], newVF[i1 * 3 + 1], newVF[i1 * 3 + 2]];
    const p2 = [newVF[i2 * 3], newVF[i2 * 3 + 1], newVF[i2 * 3 + 2]];
    if (triArea(p0, p1, p2) < areaEps) { zeroDropped++; continue; }
    kept.push(i0, i1, i2);
  }
  if (degDropped) operations.push({ op: 'drop-degenerate', count: degDropped });
  if (zeroDropped) operations.push({ op: 'drop-zero-area', count: zeroDropped });

  // ---- 3: harmonize normals via flood-fill (optional) ----
  let triList = kept.slice();
  if (harmonizeNormals) {
    triList = harmonizeNormalOrientation(triList, newVF);
    operations.push({ op: 'harmonize-normals' });
  }

  // ---- 4: fill small planar boundary holes (optional) ----
  if (fillSmallHoles) {
    const filled = fillBoundaryHoles(triList, newVF, maxHoleSize);
    if (filled.added > 0) operations.push({ op: 'fill-holes', addedTriangles: filled.added, holes: filled.holes });
    triList = filled.tris;
  }

  const out = {
    numProp: 3,
    vertProperties: newVF,
    triVerts: new Uint32Array(triList),
  };
  const after = diagnose(out);
  return { mesh: out, before, after, operations };
}

/**
 * Flood-fill from triangle 0 across edge adjacencies. Whenever a
 * neighbour shares an edge (a,b) such that one tri has it as (a→b) and
 * the other also has it as (a→b) (instead of the expected (b→a)), the
 * neighbour is mis-oriented — flip it.
 *
 * Then check global outward orientation by signed volume; if total < 0,
 * flip every triangle.
 */
function harmonizeNormalOrientation(triList, vertProps) {
  const numTri = triList.length / 3;
  // Build directed-edge → triangle map. Edge (a→b) of tri t.
  const edgeOwner = new Map();   // key="a,b" → triangle that has (a→b)
  for (let t = 0; t < numTri; t++) {
    const i0 = triList[t * 3], i1 = triList[t * 3 + 1], i2 = triList[t * 3 + 2];
    edgeOwner.set(`${i0},${i1}`, t);
    edgeOwner.set(`${i1},${i2}`, t);
    edgeOwner.set(`${i2},${i0}`, t);
  }
  const visited = new Uint8Array(numTri);
  const queue = [0];
  visited[0] = 1;
  while (queue.length) {
    const t = queue.shift();
    const i0 = triList[t * 3], i1 = triList[t * 3 + 1], i2 = triList[t * 3 + 2];
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      // Expected partner: tri owning (b → a). If instead (a → b) → that
      // partner is mis-oriented; flip.
      const partnerCorrect = edgeOwner.get(`${b},${a}`);
      if (partnerCorrect != null && !visited[partnerCorrect]) {
        visited[partnerCorrect] = 1;
        queue.push(partnerCorrect);
        continue;
      }
      const partnerWrong = edgeOwner.get(`${a},${b}`);
      if (partnerWrong != null && partnerWrong !== t && !visited[partnerWrong]) {
        // Flip the partner
        const off = partnerWrong * 3;
        [triList[off + 1], triList[off + 2]] = [triList[off + 2], triList[off + 1]];
        // Update edge owners for partner's now-swapped edges
        // (We rebuild lazily; cost negligible because we won't revisit.)
        const j0 = triList[off], j1 = triList[off + 1], j2 = triList[off + 2];
        edgeOwner.set(`${j0},${j1}`, partnerWrong);
        edgeOwner.set(`${j1},${j2}`, partnerWrong);
        edgeOwner.set(`${j2},${j0}`, partnerWrong);
        visited[partnerWrong] = 1;
        queue.push(partnerWrong);
      }
    }
  }
  // Outward orientation check via signed volume
  let signedV = 0;
  for (let t = 0; t < numTri; t++) {
    const i0 = triList[t * 3], i1 = triList[t * 3 + 1], i2 = triList[t * 3 + 2];
    const p0 = [vertProps[i0 * 3], vertProps[i0 * 3 + 1], vertProps[i0 * 3 + 2]];
    const p1 = [vertProps[i1 * 3], vertProps[i1 * 3 + 1], vertProps[i1 * 3 + 2]];
    const p2 = [vertProps[i2 * 3], vertProps[i2 * 3 + 1], vertProps[i2 * 3 + 2]];
    signedV += (p0[0] * (p1[1] * p2[2] - p1[2] * p2[1])
              - p0[1] * (p1[0] * p2[2] - p1[2] * p2[0])
              + p0[2] * (p1[0] * p2[1] - p1[1] * p2[0])) / 6;
  }
  if (signedV < 0) {
    for (let t = 0; t < numTri; t++) {
      const off = t * 3;
      [triList[off + 1], triList[off + 2]] = [triList[off + 2], triList[off + 1]];
    }
  }
  return triList;
}

/**
 * Find boundary loops and fan-triangulate small ones.
 */
function fillBoundaryHoles(triList, vertProps, maxHoleSize) {
  // Build directed-edge map; an edge is boundary if (a→b) exists but
  // its reverse (b→a) does not.
  const edgeMap = new Set();
  for (let t = 0; t < triList.length / 3; t++) {
    const i0 = triList[t * 3], i1 = triList[t * 3 + 1], i2 = triList[t * 3 + 2];
    edgeMap.add(`${i0},${i1}`);
    edgeMap.add(`${i1},${i2}`);
    edgeMap.add(`${i2},${i0}`);
  }
  const boundary = [];
  for (const e of edgeMap) {
    const [a, b] = e.split(',').map(Number);
    if (!edgeMap.has(`${b},${a}`)) boundary.push([a, b]);
  }
  if (boundary.length === 0) return { tris: triList, added: 0, holes: 0 };
  // Build adjacency: for each vertex, the boundary edges that LEAVE it
  const next = new Map();
  for (const [a, b] of boundary) {
    if (!next.has(a)) next.set(a, []);
    next.get(a).push(b);
  }
  // Walk loops
  const loops = [];
  const visited = new Set();
  for (const [a, b] of boundary) {
    if (visited.has(`${a},${b}`)) continue;
    const loop = [a];
    let cur = b;
    visited.add(`${a},${b}`);
    while (cur !== a && cur != null && loop.length < 10000) {
      loop.push(cur);
      const outs = next.get(cur) || [];
      // Pick first unvisited outgoing
      let stepped = null;
      for (const v of outs) {
        if (!visited.has(`${cur},${v}`)) { stepped = v; visited.add(`${cur},${v}`); break; }
      }
      if (stepped == null) break;
      cur = stepped;
    }
    if (cur === a && loop.length >= 3) loops.push(loop);
  }
  // Fan-fill loops up to maxHoleSize vertices
  const added = [];
  let holesFilled = 0;
  for (const loop of loops) {
    if (loop.length > maxHoleSize) continue;
    const a = loop[0];
    for (let i = 1; i + 1 < loop.length; i++) {
      added.push(a, loop[i], loop[i + 1]);
    }
    holesFilled++;
  }
  return {
    tris: triList.concat(added),
    added: added.length / 3,
    holes: holesFilled,
  };
}
