// sciviz/clip.js — Clip filter (ParaView "Clip": plane / box / scalar).
// ============================================================================
// Task #65, Increment 2.
//
// Unlike Slice (a zero-thickness cross-section), Clip KEEPS a half-space of the
// volume and re-meshes the cells the cut passes through — VTK's
// vtkTableBasedClipDataSet model:
//
//   • a cell whose every corner is on the keep side  → kept WHOLE,
//   • a cell the cut passes through                  → RE-TESSELLATED against
//     the cut into smaller cells on the keep side (the real work),
//   • a cell whose every corner is on the drop side  → dropped.
//
// The re-tessellation is done on a TETRAHEDRAL decomposition (every hex8 →
// 6 tets, sharing the 0–6 body diagonal — the SAME split threshold.js uses for
// exact hex volumes). A tet clipped by a half-space is one of five marching-tet
// cases (0/1/2/3/4 corners kept) that re-tessellate into 0,1,3,3 or 1 tets.
// This is geometrically EXACT, so:
//   • a cube clipped at axis fraction f keeps exactly f·V (machine tolerance),
//   • the kept volume is independent of how the cube was meshed.
//
// Modes:
//   • plane  — one half-space clip (keep signedDist ≤ 0, or ≥ 0 with invert),
//   • box    — SIX successive plane clips (one per face, outward normals),
//   • scalar — clip by (field − isovalue): keep field ≤ iso (≥ iso w/ invert).
//
// Output = the kept solid as a tet soup PLUS its boundary surface, split into
// the original "skin" faces and the new "cap" faces lying on the cut, coloured
// through a sciviz TransferFunction. THREE is injected only for the render mesh
// so the volume/geometry gates run head-less. No new deps.
// ============================================================================

import { makePlane } from './slice.js';

// hex8 corner offsets + the 6-tet body-diagonal decomposition (matches
// threshold.js HEX_TETS, validated there to give exact unit-cube volume).
const HEX_OFFSETS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const HEX_TETS = [
  [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6],
  [0, 7, 4, 6], [0, 4, 5, 6], [0, 5, 1, 6],
];
const TET_FACES = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]];

// ───────────────────────────────────────────────────────────────────────────
//  Geometry helpers.
// ───────────────────────────────────────────────────────────────────────────
function signedDist(p, plane) {
  const { point: q, normal: n } = plane;
  return (p[0] - q[0]) * n[0] + (p[1] - q[1]) * n[1] + (p[2] - q[2]) * n[2];
}

/** Signed volume of a tetrahedron (a·(b×c) form about apex d). */
function tetVolSigned(a, b, c, d) {
  const ax = a[0] - d[0], ay = a[1] - d[1], az = a[2] - d[2];
  const bx = b[0] - d[0], by = b[1] - d[1], bz = b[2] - d[2];
  const cx = c[0] - d[0], cy = c[1] - d[1], cz = c[2] - d[2];
  const crx = by * cz - bz * cy;
  const cry = bz * cx - bx * cz;
  const crz = bx * cy - by * cx;
  return (ax * crx + ay * cry + az * crz) / 6;
}

/** Total (unsigned) volume of a tet soup. */
export function tetsVolume(tets) {
  let v = 0;
  for (const t of tets) v += Math.abs(tetVolSigned(t.P[0], t.P[1], t.P[2], t.P[3]));
  return v;
}

// ───────────────────────────────────────────────────────────────────────────
//  Core: clip ONE tet by a per-corner field G (keep where G ≤ 0).
//  Appends the kept sub-tets to `res`. Interpolates the colour scalar S and
//  carries the on-cut flag B (true for vertices created on the cut surface).
// ───────────────────────────────────────────────────────────────────────────
function pushTet(res, P, S, B) { res.push({ P, S, B }); }

// Tetrahedralise a triangular prism: bottom (a,b,c) ↔ top (A,B,C) with a↔A.
// Canonical 3-tet split (a,b,c,A)/(b,c,A,B)/(c,A,B,C) — tiles a convex prism
// exactly with no overlap.
function pushPrism(res, a, b, c, A, B, C, sa, sb, sc, sA, sB, sC, ba, bb, bc, bA, bB, bC) {
  pushTet(res, [a, b, c, A], [sa, sb, sc, sA], [ba, bb, bc, bA]);
  pushTet(res, [b, c, A, B], [sb, sc, sA, sB], [bb, bc, bA, bB]);
  pushTet(res, [c, A, B, C], [sc, sA, sB, sC], [bc, bA, bB, bC]);
}

function splitTet(t, G, res) {
  const P = t.P, S = t.S, B = t.B;
  const ins = [], outs = [];
  for (let i = 0; i < 4; i++) (G[i] <= 0 ? ins : outs).push(i);
  const ni = ins.length;
  if (ni === 0) return;                         // fully dropped
  if (ni === 4) {                               // fully kept
    pushTet(res, [P[0].slice(), P[1].slice(), P[2].slice(), P[3].slice()],
      [S[0], S[1], S[2], S[3]], [B[0], B[1], B[2], B[3]]);
    return;
  }
  // crossing point + interpolated scalar on edge a(keep)→b(drop)
  const cross = (a, b) => {
    const ga = G[a], gb = G[b];
    const tt = ga / (ga - gb);                  // ga≤0, gb>0 ⇒ tt∈[0,1)
    return {
      p: [
        P[a][0] + (P[b][0] - P[a][0]) * tt,
        P[a][1] + (P[b][1] - P[a][1]) * tt,
        P[a][2] + (P[b][2] - P[a][2]) * tt,
      ],
      s: S[a] + (S[b] - S[a]) * tt,
    };
  };

  if (ni === 1) {
    const a = ins[0];
    const e0 = cross(a, outs[0]), e1 = cross(a, outs[1]), e2 = cross(a, outs[2]);
    pushTet(res, [P[a].slice(), e0.p, e1.p, e2.p],
      [S[a], e0.s, e1.s, e2.s], [B[a], true, true, true]);
    return;
  }
  if (ni === 3) {
    const d = outs[0];
    const a = ins[0], b = ins[1], c = ins[2];
    const ea = cross(a, d), eb = cross(b, d), ec = cross(c, d);
    // prism: kept triangle (Pa,Pb,Pc) ↔ cut triangle (ea,eb,ec)
    pushPrism(res, P[a].slice(), P[b].slice(), P[c].slice(), ea.p, eb.p, ec.p,
      S[a], S[b], S[c], ea.s, eb.s, ec.s, B[a], B[b], B[c], true, true, true);
    return;
  }
  // ni === 2 : kept edge (a,b) ↔ two cut edges each → triangular prism (wedge)
  const a = ins[0], b = ins[1], c = outs[0], d = outs[1];
  const eac = cross(a, c), ead = cross(a, d), ebc = cross(b, c), ebd = cross(b, d);
  // prism: bottom (Pa,eac,ead) ↔ top (Pb,ebc,ebd) with Pa↔Pb, eac↔ebc, ead↔ebd
  pushPrism(res, P[a].slice(), eac.p, ead.p, P[b].slice(), ebc.p, ebd.p,
    S[a], eac.s, ead.s, S[b], ebc.s, ebd.s, B[a], true, true, B[b], true, true);
}

// One half-space pass over a tet soup, classifying by a positional g(point).
function clipPass(tets, gFn) {
  const res = [];
  for (const t of tets) {
    const G = [gFn(t.P[0]), gFn(t.P[1]), gFn(t.P[2]), gFn(t.P[3])];
    splitTet(t, G, res);
  }
  return res;
}

// ───────────────────────────────────────────────────────────────────────────
//  Clip spec dispatch.
//    { type:'plane', plane:{point,normal}, invert? }
//    { type:'box',   bounds:[xmin,xmax,ymin,ymax,zmin,zmax] }
//    { type:'scalar', isovalue, invert? }   (uses each tet's per-corner scalar)
// ───────────────────────────────────────────────────────────────────────────
export function clipTets(tets, spec) {
  const type = spec.type || 'plane';
  if (type === 'plane') {
    const pl = makePlane(spec.plane.point, spec.plane.normal);
    const sgn = spec.invert ? -1 : 1;
    return clipPass(tets, (p) => sgn * signedDist(p, pl));
  }
  if (type === 'box') {
    const [xmin, xmax, ymin, ymax, zmin, zmax] = spec.bounds;
    let cur = tets;
    cur = clipPass(cur, (p) => p[0] - xmax);   // keep x ≤ xmax
    cur = clipPass(cur, (p) => xmin - p[0]);   // keep x ≥ xmin
    cur = clipPass(cur, (p) => p[1] - ymax);
    cur = clipPass(cur, (p) => ymin - p[1]);
    cur = clipPass(cur, (p) => p[2] - zmax);
    cur = clipPass(cur, (p) => zmin - p[2]);
    return cur;
  }
  if (type === 'scalar') {
    const iso = spec.isovalue;
    const sgn = spec.invert ? -1 : 1;          // invert ⇒ keep field ≥ iso
    const res = [];
    for (const t of tets) {
      const C = t.C || t.S;                    // clip scalar (defaults to colour)
      const G = [sgn * (C[0] - iso), sgn * (C[1] - iso), sgn * (C[2] - iso), sgn * (C[3] - iso)];
      splitTet(t, G, res);
    }
    return res;
  }
  throw new Error(`clip: unknown spec.type "${type}"`);
}

// ───────────────────────────────────────────────────────────────────────────
//  Tet-soup builders.
// ───────────────────────────────────────────────────────────────────────────
/**
 * Build a tet soup tiling a structured VOXEL grid (nx·ny·nz primal cells,
 * corner i at origin + i·d). Each voxel → 6 tets.
 * @param {object} grid { nx,ny,nz, dx,dy,dz, origin=[0,0,0] }
 * @param {ArrayLike} [field] per-cell colour scalar (length nx·ny·nz)
 * @param {object} [opts] { cornerField:(x,y,z)=>scalar, include:(i,j,k,cx,cy,cz)=>bool, clipField:(x,y,z)=>scalar }
 */
export function tetsFromVoxelGrid(grid, field = null, opts = {}) {
  const { nx, ny, nz, dx, dy, dz } = grid;
  const o = grid.origin || [0, 0, 0];
  const cornerField = opts.cornerField || null;
  const clipField = opts.clipField || null;
  const include = opts.include || null;
  const tets = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cx = o[0] + (i + 0.5) * dx, cy = o[1] + (j + 0.5) * dy, cz = o[2] + (k + 0.5) * dz;
    if (include && !include(i, j, k, cx, cy, cz)) continue;
    const cellScalar = field ? field[i + nx * j + nx * ny * k] : 0;
    const P8 = new Array(8), S8 = new Array(8), C8 = clipField ? new Array(8) : null;
    for (let c = 0; c < 8; c++) {
      const X = o[0] + (i + HEX_OFFSETS[c][0]) * dx;
      const Y = o[1] + (j + HEX_OFFSETS[c][1]) * dy;
      const Z = o[2] + (k + HEX_OFFSETS[c][2]) * dz;
      P8[c] = [X, Y, Z];
      S8[c] = cornerField ? cornerField(X, Y, Z) : cellScalar;
      if (C8) C8[c] = clipField(X, Y, Z);
    }
    for (const [a, b, c, d] of HEX_TETS) {
      const tet = {
        P: [P8[a].slice(), P8[b].slice(), P8[c].slice(), P8[d].slice()],
        S: [S8[a], S8[b], S8[c], S8[d]],
        B: [false, false, false, false],
      };
      if (C8) tet.C = [C8[a], C8[b], C8[c], C8[d]];
      tets.push(tet);
    }
  }
  return tets;
}

/** Build a tet soup from a hex8/tet4 FE mesh carrying a per-node scalar field. */
export function tetsFromMesh(mesh, nodalField) {
  const ENC = mesh.elemNodeCount || 8;
  const conn = mesh.tets, nodes = mesh.nodes;
  const tets = [];
  for (let e = 0; e < mesh.elemCount; e++) {
    if (ENC === 4) {
      const P = [], S = [];
      for (let c = 0; c < 4; c++) {
        const nid = conn[e * 4 + c];
        P.push([nodes[3 * nid], nodes[3 * nid + 1], nodes[3 * nid + 2]]);
        S.push(nodalField[nid]);
      }
      tets.push({ P, S, B: [false, false, false, false] });
    } else {
      const P8 = [], S8 = [];
      for (let c = 0; c < 8; c++) {
        const nid = conn[e * 8 + c];
        P8.push([nodes[3 * nid], nodes[3 * nid + 1], nodes[3 * nid + 2]]);
        S8.push(nodalField[nid]);
      }
      for (const [a, b, c, d] of HEX_TETS) {
        tets.push({
          P: [P8[a].slice(), P8[b].slice(), P8[c].slice(), P8[d].slice()],
          S: [S8[a], S8[b], S8[c], S8[d]],
          B: [false, false, false, false],
        });
      }
    }
  }
  return tets;
}

// ───────────────────────────────────────────────────────────────────────────
//  Boundary extraction — keep faces owned by exactly ONE kept tet (the skin +
//  the cut caps). Cap faces have all three corners on the cut (B=true).
// ───────────────────────────────────────────────────────────────────────────
function faceKey(p0, p1, p2) {
  const Q = 1e-6;
  const code = (p) => `${Math.round(p[0] / Q)},${Math.round(p[1] / Q)},${Math.round(p[2] / Q)}`;
  return [code(p0), code(p1), code(p2)].sort().join('|');
}
function triArea2(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return cx * cx + cy * cy + cz * cz;
}

export function boundaryFaces(tets) {
  const map = new Map();
  for (const t of tets) {
    for (const f of TET_FACES) {
      const p0 = t.P[f[0]], p1 = t.P[f[1]], p2 = t.P[f[2]];
      if (triArea2(p0, p1, p2) < 1e-24) continue;       // skip collapsed faces
      const k = faceKey(p0, p1, p2);
      const prev = map.get(k);
      if (prev) { prev.count++; continue; }
      map.set(k, {
        count: 1,
        verts: [p0, p1, p2],
        vals: [t.S[f[0]], t.S[f[1]], t.S[f[2]]],
        cap: t.B[f[0]] && t.B[f[1]] && t.B[f[2]],
      });
    }
  }
  const out = [];
  for (const f of map.values()) if (f.count === 1) out.push({ verts: f.verts, vals: f.vals, cap: f.cap });
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
//  High-level wrappers.
// ───────────────────────────────────────────────────────────────────────────
function finalize(keptTets, spec, opts) {
  const keptVolume = tetsVolume(keptTets);
  const boundary = (opts.boundary === false) ? [] : boundaryFaces(keptTets);
  let capCount = 0, skinCount = 0, mn = Infinity, mx = -Infinity;
  for (const f of boundary) {
    if (f.cap) capCount++; else skinCount++;
    for (const s of f.vals) { if (s < mn) mn = s; if (s > mx) mx = s; }
  }
  if (!Number.isFinite(mn)) { mn = 0; mx = 0; }
  return {
    keptVolume, tetCount: keptTets.length, tets: keptTets,
    boundary, faceCount: boundary.length, capCount, skinCount,
    scalarRange: [mn, mx], spec,
  };
}

export function clipStructuredGrid(grid, field, spec, opts = {}) {
  // a scalar clip needs the field as the clip criterion on the dual lattice;
  // pass it through cornerField/clipField so crossings interpolate the field.
  const buildOpts = { ...opts };
  if (spec.type === 'scalar' && !buildOpts.clipField && opts.cornerField) buildOpts.clipField = opts.cornerField;
  const tets = tetsFromVoxelGrid(grid, field, buildOpts);
  return finalize(clipTets(tets, spec), spec, opts);
}

export function clipMesh(mesh, nodalField, spec, opts = {}) {
  const tets = tetsFromMesh(mesh, nodalField);
  if (spec.type === 'scalar') for (const t of tets) t.C = t.S;   // clip by the nodal field itself
  return finalize(clipTets(tets, spec), spec, opts);
}

// ───────────────────────────────────────────────────────────────────────────
//  Render mesh (optional, needs THREE). Skin + caps, coloured through the TF.
//  Pass opts.capsOnly / opts.skinOnly to isolate a layer.
// ───────────────────────────────────────────────────────────────────────────
export function buildClipMesh(THREE, result, tf, opts = {}) {
  if (!THREE) throw new Error('clip: THREE namespace required to build a mesh');
  const positions = [], colors = [];
  for (const f of result.boundary) {
    if (opts.capsOnly && !f.cap) continue;
    if (opts.skinOnly && f.cap) continue;
    const V = f.verts, Vc = f.vals;
    // fan-triangulate (faces are already triangles, but keep it general)
    for (let i = 1; i < V.length - 1; i++) {
      const tri = [0, i, i + 1];
      for (const idx of tri) {
        const p = V[idx];
        const rgb = tf ? tf.sampleColor(Vc[idx]) : [0.7, 0.72, 0.78];
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
    transparent: opts.opacity != null && opts.opacity < 1,
    opacity: opts.opacity != null ? opts.opacity : 1,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'sciviz-clip';
  mesh.userData = {
    sciviz: 'clip', keptVolume: result.keptVolume,
    capCount: result.capCount, skinCount: result.skinCount,
  };
  return mesh;
}

export default {
  clipTets, tetsFromVoxelGrid, tetsFromMesh, tetsVolume, boundaryFaces,
  clipStructuredGrid, clipMesh, buildClipMesh,
};
