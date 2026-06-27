// sciviz/threshold.js — Threshold filter (ParaView "Threshold").
// ============================================================================
// Task #65, Increment 3.
//
// Keep cells whose scalar ∈ [lo,hi]; emit the BOUNDARY faces of the retained
// set (the outer skin PLUS the faces newly exposed where a kept cell abuts a
// dropped cell).  This generalises caeViz.js's HEX_FACES outer-skin face
// adjacency from "the whole mesh" to "an arbitrary retained sub-set".
//
//   • structured grid  — primal voxels; cell scalar = the cell-centred value
//     field[idx] (exactly the centroid value); boundary by neighbour test;
//     volume = keptCount · dx·dy·dz.
//   • hex8 / tet4 mesh  — cell scalar = mean of the element's corner nodal
//     values (= the centroid value for a linear field); boundary by
//     face-adjacency (a face kept by exactly one retained element); volume =
//     Σ kept-element volumes (hex8 → 6-tet decomposition, tet4 → |det|/6).
//
// Pure JS math; THREE injected only for the optional render mesh. No new deps.
// ============================================================================

// hex8 face quads (corner ids, same ordering as caeViz.js HEX_FACES /
// MarchingCubes corner layout).
const HEX_FACES = [
  [0, 1, 2, 3], // z-
  [4, 5, 6, 7], // z+
  [0, 1, 5, 4], // y-
  [3, 2, 6, 7], // y+
  [0, 3, 7, 4], // x-
  [1, 2, 6, 5], // x+
];
const TET_FACES = [
  [0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3],
];

const inRange = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;

// ───────────────────────────────────────────────────────────────────────────
//  Structured cell-centred grid.
// ───────────────────────────────────────────────────────────────────────────
export function thresholdStructuredGrid(grid, field, range, opts = {}) {
  const lo = range[0], hi = range[1];
  const { nx, ny, nz, dx, dy, dz } = grid;
  const sliceXY = grid.sliceXY || nx * ny;
  const idx = (i, j, k) => i + nx * j + sliceXY * k;
  const cellVolume = dx * dy * dz;

  // 1) mark kept voxels
  const kept = new Uint8Array(nx * ny * nz);
  let keptCount = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const id = idx(i, j, k);
    if (inRange(field[id], lo, hi)) { kept[id] = 1; keptCount++; }
  }

  // 2) boundary faces — a face is on the skin where the neighbour voxel is not kept
  const faces = [];
  const isKept = (i, j, k) =>
    (i >= 0 && i < nx && j >= 0 && j < ny && k >= 0 && k < nz) ? kept[idx(i, j, k)] : 0;
  const quad = (corners, scalar) => faces.push({ verts: corners, scalar });
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!kept[idx(i, j, k)]) continue;
    const s = field[idx(i, j, k)];
    const x0 = i * dx, x1 = (i + 1) * dx;
    const y0 = j * dy, y1 = (j + 1) * dy;
    const z0 = k * dz, z1 = (k + 1) * dz;
    if (!isKept(i - 1, j, k)) quad([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], s); // x-
    if (!isKept(i + 1, j, k)) quad([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], s); // x+
    if (!isKept(i, j - 1, k)) quad([[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]], s); // y-
    if (!isKept(i, j + 1, k)) quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], s); // y+
    if (!isKept(i, j, k - 1)) quad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], s); // z-
    if (!isKept(i, j, k + 1)) quad([[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]], s); // z+
  }

  return {
    keptCount, keptVolume: keptCount * cellVolume, cellVolume,
    faces, faceCount: faces.length, range: [lo, hi], kind: 'structured',
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  hex8 / tet4 element volumes.
// ───────────────────────────────────────────────────────────────────────────
function tetVolSigned(a, b, c, d) {
  const bx = b[0] - d[0], by = b[1] - d[1], bz = b[2] - d[2];
  const cx = c[0] - d[0], cy = c[1] - d[1], cz = c[2] - d[2];
  const ax = a[0] - d[0], ay = a[1] - d[1], az = a[2] - d[2];
  // a · (b × c)
  const crx = by * cz - bz * cy;
  const cry = bz * cx - bx * cz;
  const crz = bx * cy - by * cx;
  return (ax * crx + ay * cry + az * crz) / 6;
}

// 6-tet decomposition of a hex8 (corner ordering 0..7 as HEX_FACES) about
// the body diagonal 0–6.
const HEX_TETS = [
  [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6],
  [0, 7, 4, 6], [0, 4, 5, 6], [0, 5, 1, 6],
];
function hexVolume(P) {
  let v = 0;
  for (const [a, b, c, d] of HEX_TETS) v += tetVolSigned(P[a], P[b], P[c], P[d]);
  return Math.abs(v);
}
function tetVolume(P) { return Math.abs(tetVolSigned(P[0], P[1], P[2], P[3])); }

// ───────────────────────────────────────────────────────────────────────────
//  hex8 / tet4 FE mesh.
// ───────────────────────────────────────────────────────────────────────────
export function thresholdMesh(mesh, nodalField, range, opts = {}) {
  const lo = range[0], hi = range[1];
  const ENC = mesh.elemNodeCount || 8;
  const FACES = ENC === 4 ? TET_FACES : HEX_FACES;
  const conn = mesh.tets;
  const nodes = mesh.nodes;

  const keptElems = [];
  let keptVolume = 0;
  const cellScalars = [];
  for (let e = 0; e < mesh.elemCount; e++) {
    let mean = 0;
    const P = new Array(ENC);
    for (let c = 0; c < ENC; c++) {
      const nid = conn[e * ENC + c];
      mean += nodalField[nid];
      P[c] = [nodes[3 * nid], nodes[3 * nid + 1], nodes[3 * nid + 2]];
    }
    mean /= ENC;
    cellScalars[e] = mean;
    if (inRange(mean, lo, hi)) {
      keptElems.push(e);
      keptVolume += ENC === 4 ? tetVolume(P) : hexVolume(P);
    }
  }

  // boundary faces: face shared by exactly ONE kept element (generalised
  // outer-skin face adjacency over the retained sub-set).
  const faceMap = new Map();
  for (const e of keptElems) {
    for (const fdef of FACES) {
      const gids = fdef.map((c) => conn[e * ENC + c]);
      const key = gids.slice().sort((a, b) => a - b).join(',');
      const prev = faceMap.get(key);
      if (prev) prev.count++;
      else faceMap.set(key, { gids, count: 1, scalar: cellScalars[e] });
    }
  }
  const faces = [];
  for (const f of faceMap.values()) {
    if (f.count !== 1) continue;
    const verts = f.gids.map((nid) => [nodes[3 * nid], nodes[3 * nid + 1], nodes[3 * nid + 2]]);
    faces.push({ verts, scalar: f.scalar });
  }

  return {
    keptCount: keptElems.length, keptVolume,
    faces, faceCount: faces.length, range: [lo, hi], kind: 'mesh',
    cellScalars,
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Render mesh (optional, needs THREE).  Triangulates every boundary face as
//  a fan and colours each vertex through the TF.
// ───────────────────────────────────────────────────────────────────────────
export function buildThresholdMesh(THREE, result, tf, opts = {}) {
  if (!THREE) throw new Error('threshold: THREE namespace required to build a mesh');
  const positions = [];
  const colors = [];
  for (const f of result.faces) {
    const rgb = tf ? tf.sampleColor(f.scalar) : [0.7, 0.7, 0.75];
    const V = f.verts;
    for (let i = 1; i < V.length - 1; i++) {
      const tri = [V[0], V[i], V[i + 1]];
      for (const p of tri) {
        positions.push(p[0], p[1], p[2]);
        colors.push(rgb[0], rgb[1], rgb[2]);
      }
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.05, roughness: 0.7, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'sciviz-threshold';
  mesh.userData = { sciviz: 'threshold', keptCount: result.keptCount, keptVolume: result.keptVolume };
  return mesh;
}

export default {
  thresholdStructuredGrid, thresholdMesh, buildThresholdMesh,
};
