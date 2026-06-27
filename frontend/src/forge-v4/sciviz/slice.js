// sciviz/slice.js — arbitrary (point, normal) Slice filter (ParaView "Slice").
// ============================================================================
// Task #65, Increment 1.
//
// Generalises the single CFD pressure mid-plane (cfdVisualisation.js
// buildPressureMidplane) into an arbitrary plane cut that works over BOTH:
//
//   • the structured, cell-centred CFD grid (nx,ny,nz,dx,dy,dz + a scalar
//     field of length N) — sliced on its DUAL lattice (corners at cell
//     centres) so the scalar is reconstructed by exact corner interpolation;
//   • a hex8 / tet4 FE mesh ({nodes, tets, nodeCount, elemCount,
//     elemNodeCount} — the structure caeViz.js already consumes) carrying a
//     per-node scalar field.
//
// Algorithm (marching-cells cross-section):
//   for every cell:
//     1. signed distance of each corner to the plane,
//     2. for each cell EDGE that straddles the plane, interpolate BOTH the
//        crossing position AND the scalar at the crossing (linear interp is
//        exact for a linear field → the linear-field gate is machine-exact),
//     3. order the crossing points around their centroid in the plane basis
//        and fan-triangulate → a coloured cross-section polygon.
//
// Colours come from a sciviz TransferFunction.  THREE is injected only to
// build the optional render mesh, so the geometry/gate math runs head-less.
// No new deps.
// ============================================================================

// hex8 corner offsets (binary x,y,z) — matches MarchingCubes.js / the CFD grid.
//   0=(0,0,0) 1=(1,0,0) 2=(1,1,0) 3=(0,1,0)
//   4=(0,0,1) 5=(1,0,1) 6=(1,1,1) 7=(0,1,1)
const HEX_OFFSETS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const HEX_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
const TET_EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
];

// ───────────────────────────────────────────────────────────────────────────
//  Plane helpers.
// ───────────────────────────────────────────────────────────────────────────

/** Normalise a (point, normal) plane. */
export function makePlane(point, normal) {
  const [nx, ny, nz] = normal;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { point: [point[0], point[1], point[2]], normal: [nx / len, ny / len, nz / len] };
}

function signedDist(p, plane) {
  const { point: q, normal: n } = plane;
  return (p[0] - q[0]) * n[0] + (p[1] - q[1]) * n[1] + (p[2] - q[2]) * n[2];
}

/** Orthonormal in-plane basis (e1,e2) ⟂ normal. */
function planeBasis(n) {
  const ax = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const dot = ax[0] * n[0] + ax[1] * n[1] + ax[2] * n[2];
  let e1 = [ax[0] - dot * n[0], ax[1] - dot * n[1], ax[2] - dot * n[2]];
  const l = Math.hypot(e1[0], e1[1], e1[2]) || 1;
  e1 = [e1[0] / l, e1[1] / l, e1[2] / l];
  const e2 = [
    n[1] * e1[2] - n[2] * e1[1],
    n[2] * e1[0] - n[0] * e1[2],
    n[0] * e1[1] - n[1] * e1[0],
  ];
  return { e1, e2 };
}

// ───────────────────────────────────────────────────────────────────────────
//  Core: slice ONE convex cell → append triangles to `out`.
//
//  P     = [[x,y,z]×K] corner positions
//  S     = [scalar×K]  corner scalar values
//  edges = [[a,b],…]   cell connectivity
// ───────────────────────────────────────────────────────────────────────────
function sliceOneCell(P, S, edges, plane, basis, out) {
  const K = P.length;
  // signed distances
  const d = new Array(K);
  for (let i = 0; i < K; i++) d[i] = signedDist(P[i], plane);

  // edge crossings (position + scalar)
  const pts = [];   // [x,y,z]
  const vals = [];
  for (const [a, b] of edges) {
    const da = d[a], db = d[b];
    if ((da < 0 && db < 0) || (da > 0 && db > 0)) continue; // same side
    if (da === 0 && db === 0) continue;                     // edge in plane — skip (faces handle it)
    const denom = da - db;
    if (denom === 0) continue;
    const t = da / denom;                                   // crossing param on a→b
    if (t < 0 || t > 1) continue;
    const Pa = P[a], Pb = P[b];
    pts.push([
      Pa[0] + (Pb[0] - Pa[0]) * t,
      Pa[1] + (Pb[1] - Pa[1]) * t,
      Pa[2] + (Pb[2] - Pa[2]) * t,
    ]);
    vals.push(S[a] + (S[b] - S[a]) * t);
  }
  if (pts.length < 3) return;

  // de-duplicate coincident crossings (corner exactly on the plane)
  const uniq = [];
  const uvals = [];
  const EPS = 1e-12;
  for (let i = 0; i < pts.length; i++) {
    let dup = false;
    for (let j = 0; j < uniq.length; j++) {
      const q = uniq[j];
      if (Math.abs(q[0] - pts[i][0]) < EPS && Math.abs(q[1] - pts[i][1]) < EPS
        && Math.abs(q[2] - pts[i][2]) < EPS) { dup = true; break; }
    }
    if (!dup) { uniq.push(pts[i]); uvals.push(vals[i]); }
  }
  if (uniq.length < 3) return;

  // order around centroid in the plane basis
  let cx = 0, cy = 0, cz = 0;
  for (const q of uniq) { cx += q[0]; cy += q[1]; cz += q[2]; }
  cx /= uniq.length; cy /= uniq.length; cz /= uniq.length;
  const { e1, e2 } = basis;
  const ang = uniq.map((q, i) => {
    const rx = q[0] - cx, ry = q[1] - cy, rz = q[2] - cz;
    const u = rx * e1[0] + ry * e1[1] + rz * e1[2];
    const v = rx * e2[0] + ry * e2[1] + rz * e2[2];
    return { i, a: Math.atan2(v, u) };
  });
  ang.sort((p, q) => p.a - q.a);

  // emit fan triangles
  const base = out.verts.length;
  for (let i = 0; i < uniq.length; i++) {
    out.verts.push(uniq[ang[i].i]);
    out.vals.push(uvals[ang[i].i]);
  }
  for (let i = 1; i < uniq.length - 1; i++) {
    out.tris.push([base, base + i, base + i + 1]);
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Cell iterators.
// ───────────────────────────────────────────────────────────────────────────

/** Slice a structured cell-centred grid on its dual lattice. */
export function sliceStructuredGrid(grid, field, plane, opts = {}) {
  const { nx, ny, nz, dx, dy, dz } = grid;
  const sliceXY = grid.sliceXY || nx * ny;
  const idx = (i, j, k) => i + nx * j + sliceXY * k;
  const out = { verts: [], vals: [], tris: [] };
  const basis = planeBasis(plane.normal);
  const P = [[], [], [], [], [], [], [], []];
  const S = new Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        for (let c = 0; c < 8; c++) {
          const I = i + HEX_OFFSETS[c][0];
          const J = j + HEX_OFFSETS[c][1];
          const Kk = k + HEX_OFFSETS[c][2];
          P[c] = [(I + 0.5) * dx, (J + 0.5) * dy, (Kk + 0.5) * dz];
          S[c] = field[idx(I, J, Kk)];
        }
        sliceOneCell(P, S, HEX_EDGES, plane, basis, out);
      }
    }
  }
  return finalizeSlice(out, opts);
}

/** Slice a hex8/tet4 FE mesh carrying a per-node scalar field. */
export function sliceMesh(mesh, nodalField, plane, opts = {}) {
  const ENC = mesh.elemNodeCount || 8;
  const edges = ENC === 4 ? TET_EDGES : HEX_EDGES;
  const conn = mesh.tets;            // connectivity array (caeViz naming)
  const nodes = mesh.nodes;
  const out = { verts: [], vals: [], tris: [] };
  const basis = planeBasis(plane.normal);
  const P = new Array(ENC);
  const S = new Array(ENC);
  for (let e = 0; e < mesh.elemCount; e++) {
    for (let c = 0; c < ENC; c++) {
      const nid = conn[e * ENC + c];
      P[c] = [nodes[3 * nid], nodes[3 * nid + 1], nodes[3 * nid + 2]];
      S[c] = nodalField[nid];
    }
    sliceOneCell(P, S, edges, plane, basis, out);
  }
  return finalizeSlice(out, opts);
}

function finalizeSlice(out, opts) {
  let min = Infinity, max = -Infinity;
  for (const v of out.vals) { if (v < min) min = v; if (v > max) max = v; }
  if (!Number.isFinite(min)) { min = 0; max = 0; }
  return {
    verts: out.verts, vals: out.vals, tris: out.tris,
    vertexCount: out.verts.length, triangleCount: out.tris.length,
    scalarRange: [min, max], plane: opts.plane || null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Iso-contour line WITHIN a slice (marching-triangle on the cross-section).
//  Returns the zero-of-(scalar-iso) crossing points + segments — used to
//  verify the analytic circle radius of a sphere-SDF slice.
// ───────────────────────────────────────────────────────────────────────────
export function isoContourOnSlice(slice, iso = 0) {
  const { verts, vals, tris } = slice;
  const points = [];
  const segments = [];
  for (const [a, b, c] of tris) {
    const tri = [a, b, c];
    const cross = [];
    for (let e = 0; e < 3; e++) {
      const i0 = tri[e], i1 = tri[(e + 1) % 3];
      const f0 = vals[i0] - iso, f1 = vals[i1] - iso;
      if ((f0 < 0 && f1 < 0) || (f0 > 0 && f1 > 0)) continue;
      const denom = f0 - f1;
      if (denom === 0) continue;
      const t = f0 / denom;
      if (t < 0 || t > 1) continue;
      const P0 = verts[i0], P1 = verts[i1];
      cross.push([
        P0[0] + (P1[0] - P0[0]) * t,
        P0[1] + (P1[1] - P0[1]) * t,
        P0[2] + (P1[2] - P0[2]) * t,
      ]);
    }
    if (cross.length === 2) {
      const i = points.length;
      points.push(cross[0], cross[1]);
      segments.push([i, i + 1]);
    }
  }
  return { points, segments, count: points.length };
}

// ───────────────────────────────────────────────────────────────────────────
//  Render mesh (optional, needs THREE).  Colours each vertex through the TF.
// ───────────────────────────────────────────────────────────────────────────
export function buildSliceMesh(THREE, slice, tf, opts = {}) {
  if (!THREE) throw new Error('slice: THREE namespace required to build a mesh');
  const { verts, vals, tris } = slice;
  const n = verts.length;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = verts[i][0];
    positions[i * 3 + 1] = verts[i][1];
    positions[i * 3 + 2] = verts[i][2];
    const rgb = tf ? tf.sampleColor(vals[i]) : [0.8, 0.8, 0.8];
    colors[i * 3] = rgb[0];
    colors[i * 3 + 1] = rgb[1];
    colors[i * 3 + 2] = rgb[2];
  }
  const indices = new Uint32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    indices[i * 3] = tris[i][0];
    indices[i * 3 + 1] = tris[i][1];
    indices[i * 3 + 2] = tris[i][2];
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide,
    transparent: opts.opacity != null && opts.opacity < 1,
    opacity: opts.opacity != null ? opts.opacity : 1,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'sciviz-slice';
  mesh.userData = { sciviz: 'slice', scalarRange: slice.scalarRange };
  return mesh;
}

export default {
  makePlane, sliceStructuredGrid, sliceMesh, isoContourOnSlice, buildSliceMesh,
};
