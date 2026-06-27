// Forge — FEA mesh-quality report (task #66, Inc 4).
//
// SimScale ships a per-element mesh-quality histogram (aspect ratio, min
// dihedral angle, volume) so the engineer trusts the discretisation before
// burning a solve. The existing `meshDispatch.meshStats` reports only
// surface (vertices / triangles); this module EXTENDS that idea to the
// VOLUME FEA mesh — the tet/hex element soup `forge.fea.meshFromBrep`
// returns ({ nodes, elements|tets, elemNodeCount, nodeCount, elemCount }).
//
// Metrics (per element, then reduced):
//   • aspect ratio   — normalised so a regular/cubic element = 1.0 and a
//                      sliver → ∞. (tet: longestEdge / (2√6 · inradius);
//                      hex: longestEdge / shortestEdge.)
//   • min dihedral   — smallest interior dihedral angle (deg). tet: the 6
//                      edge dihedrals; hex: the 12 face-adjacency dihedrals.
//   • volume         — |signed volume| (m³). hex via a 6-tet decomposition.
//
// Pure + framework-free + SI. No `window`, no React. Element connectivity
// uses the canonical VTK ordering (tet 0-1-2-3; hex 0-3 bottom CCW, 4-7 top
// CCW), which the native brick-grid mesher follows.

const SQRT6_2 = 2 * Math.sqrt(6); // regular-tet aspect normaliser

// Aspect ratio above this OR a min dihedral below MIN_DIHEDRAL_DEG → "poor".
export const POOR_ASPECT = 5;
export const POOR_MIN_DIHEDRAL_DEG = 10;

// Aspect histogram bins (upper edges; last bin is the +∞ catch-all).
const ASPECT_BIN_EDGES = [1.5, 2, 3, 5, 10, Infinity];

// ----------------------------------------------------------- vec3 helpers
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function len(a) { return Math.sqrt(dot(a, a)); }

function nodeAt(nodes, i) {
  return [nodes[3 * i], nodes[3 * i + 1], nodes[3 * i + 2]];
}

// Angle (deg) between two vectors.
function angleDeg(u, v) {
  const lu = len(u), lv = len(v);
  if (lu === 0 || lv === 0) return 0;
  let c = dot(u, v) / (lu * lv);
  c = Math.max(-1, Math.min(1, c));
  return Math.acos(c) * 180 / Math.PI;
}

// ----------------------------------------------------------- tetrahedron
const TET_EDGES = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
// Each face = the 3 verts opposite an edge; dihedral along an edge is the
// angle between the two faces sharing it. Faces of a tet (CCW outward):
const TET_FACES = [[1, 2, 3], [0, 3, 2], [0, 1, 3], [0, 2, 1]];

function tetVolume(p) {
  return Math.abs(dot(sub(p[1], p[0]), cross(sub(p[2], p[0]), sub(p[3], p[0])))) / 6;
}
function triArea(a, b, c) {
  return 0.5 * len(cross(sub(b, a), sub(c, a)));
}
function triNormal(a, b, c) {
  return cross(sub(b, a), sub(c, a));
}

function tetQuality(p) {
  const V = tetVolume(p);
  // edge lengths
  let maxEdge = 0;
  for (const [i, j] of TET_EDGES) {
    const L = len(sub(p[i], p[j]));
    if (L > maxEdge) maxEdge = L;
  }
  // inradius r = 3V / Σ(face area)
  let aTot = 0;
  for (const [i, j, k] of TET_FACES) aTot += triArea(p[i], p[j], p[k]);
  const inradius = aTot > 0 ? (3 * V) / aTot : 0;
  const aspect = inradius > 0 ? maxEdge / (SQRT6_2 * inradius) : Infinity;

  // min dihedral over the 6 edges — angle between the two incident faces.
  let minDihedral = 180;
  for (const [vi, vj] of TET_EDGES) {
    // the two faces (of the 4) that contain BOTH vi and vj
    const incident = TET_FACES.filter((f) => f.includes(vi) && f.includes(vj));
    if (incident.length !== 2) continue;
    const n0 = triNormal(p[incident[0][0]], p[incident[0][1]], p[incident[0][2]]);
    const n1 = triNormal(p[incident[1][0]], p[incident[1][1]], p[incident[1][2]]);
    // dihedral = 180° − angle(outward normals)
    const dih = 180 - angleDeg(n0, n1);
    if (dih < minDihedral) minDihedral = dih;
  }
  return { volume: V, aspect, minDihedralDeg: minDihedral };
}

// ----------------------------------------------------------- hexahedron
// VTK hex ordering: bottom 0-1-2-3 (CCW), top 4-5-6-7 (CCW), verticals i↔i+4.
const HEX_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
// 6 quad faces (outward CCW).
const HEX_FACES = [
  [0, 1, 2, 3], // bottom (−)
  [4, 7, 6, 5], // top (+)
  [0, 4, 5, 1], // front
  [1, 5, 6, 2], // right
  [2, 6, 7, 3], // back
  [3, 7, 4, 0], // left
];
// 6-tet decomposition of a hex (canonical) for a robust |volume|.
const HEX_TETS = [
  [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6],
  [0, 7, 4, 6], [0, 4, 5, 6], [0, 5, 1, 6],
];

function quadNormal(p, f) {
  // Newell-ish: use the diagonal cross-product (robust for planar-ish quads).
  return cross(sub(p[f[2]], p[f[0]]), sub(p[f[3]], p[f[1]]));
}

function hexQuality(p) {
  let minEdge = Infinity, maxEdge = 0;
  for (const [i, j] of HEX_EDGES) {
    const L = len(sub(p[i], p[j]));
    if (L < minEdge) minEdge = L;
    if (L > maxEdge) maxEdge = L;
  }
  const aspect = minEdge > 0 ? maxEdge / minEdge : Infinity;

  let V = 0;
  for (const t of HEX_TETS) V += tetVolume([p[t[0]], p[t[1]], p[t[2]], p[t[3]]]);

  // min dihedral between every pair of faces that share an edge.
  const normals = HEX_FACES.map((f) => quadNormal(p, f));
  let minDihedral = 180;
  for (let a = 0; a < HEX_FACES.length; a++) {
    for (let b = a + 1; b < HEX_FACES.length; b++) {
      if (!facesShareEdge(HEX_FACES[a], HEX_FACES[b])) continue;
      const dih = 180 - angleDeg(normals[a], normals[b]);
      if (dih < minDihedral) minDihedral = dih;
    }
  }
  return { volume: V, aspect, minDihedralDeg: minDihedral };
}

function facesShareEdge(fa, fb) {
  let shared = 0;
  for (const v of fa) if (fb.includes(v)) shared++;
  return shared >= 2;
}

// ----------------------------------------------------------- public API

/**
 * Per-element quality report for an FEA volume mesh.
 *
 * @param {object} mesh  — { nodes:Float*Array, elements|tets:Int*Array,
 *                           elemNodeCount?, nodeCount?, elemCount? }
 * @returns {{
 *   elementType: 'tet'|'hex',
 *   nodeCount: number, elemCount: number,
 *   aspect: { min, avg, max, worst },
 *   minDihedralDeg: { min, avg, max },
 *   volume: { min, avg, max, total },
 *   histogram: Array<{ loEdge, hiEdge, count }>,
 *   poorCount: number, poorFraction: number,
 *   poor: number[]
 * }}
 */
export function feaMeshQuality(mesh, { poorAspect = POOR_ASPECT,
                                       poorMinDihedral = POOR_MIN_DIHEDRAL_DEG,
                                       maxPoorList = 64 } = {}) {
  if (!mesh) throw new Error('feaMeshQuality: no mesh');
  const nodes = mesh.nodes;
  const elements = mesh.elements || mesh.tets;
  if (!nodes || !elements) throw new Error('feaMeshQuality: mesh lacks nodes/elements');

  const enc = mesh.elemNodeCount || (mesh.tets ? 4 : 8);
  const elementType = enc === 8 ? 'hex' : 'tet';
  const qf = elementType === 'hex' ? hexQuality : tetQuality;
  const elemCount = mesh.elemCount || Math.floor(elements.length / enc);
  const nodeCount = mesh.nodeCount || Math.floor(nodes.length / 3);

  const histogram = ASPECT_BIN_EDGES.map((hi, i) => ({
    loEdge: i === 0 ? 1 : ASPECT_BIN_EDGES[i - 1],
    hiEdge: hi,
    count: 0,
  }));

  let aMin = Infinity, aMax = -Infinity, aSum = 0;
  let dMin = Infinity, dMax = -Infinity, dSum = 0;
  let vMin = Infinity, vMax = -Infinity, vSum = 0;
  let poorCount = 0;
  const poor = [];

  for (let e = 0; e < elemCount; e++) {
    const base = e * enc;
    const p = [];
    for (let q = 0; q < enc; q++) p.push(nodeAt(nodes, elements[base + q]));
    const { volume, aspect, minDihedralDeg } = qf(p);

    if (aspect < aMin) aMin = aspect;
    if (aspect > aMax) aMax = aspect;
    aSum += Number.isFinite(aspect) ? aspect : poorAspect * 10;

    if (minDihedralDeg < dMin) dMin = minDihedralDeg;
    if (minDihedralDeg > dMax) dMax = minDihedralDeg;
    dSum += minDihedralDeg;

    if (volume < vMin) vMin = volume;
    if (volume > vMax) vMax = volume;
    vSum += volume;

    // histogram bin
    for (let b = 0; b < histogram.length; b++) {
      if (aspect < histogram[b].hiEdge) { histogram[b].count++; break; }
    }

    const isPoor = !Number.isFinite(aspect) || aspect > poorAspect
                   || minDihedralDeg < poorMinDihedral;
    if (isPoor) {
      poorCount++;
      if (poor.length < maxPoorList) poor.push(e);
    }
  }

  const n = Math.max(1, elemCount);
  return {
    elementType,
    nodeCount, elemCount,
    aspect: {
      min: elemCount ? aMin : 0,
      avg: aSum / n,
      max: elemCount ? aMax : 0,
      worst: elemCount ? aMax : 0, // largest aspect = most distorted element
    },
    minDihedralDeg: {
      min: elemCount ? dMin : 0,
      avg: dSum / n,
      max: elemCount ? dMax : 0,
    },
    volume: {
      min: elemCount ? vMin : 0,
      avg: vSum / n,
      max: elemCount ? vMax : 0,
      total: vSum,
    },
    histogram,
    poorCount,
    poorFraction: poorCount / n,
    poor,
  };
}
