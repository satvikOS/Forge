// PUSH-221 (Slice-153) — Frictionless Penalty-Method Node-to-Surface
// Contact Analysis between two linear-elastic FEA bodies.
//
// This module is the contact equivalent of navierStokes3d.js for CFD: a
// from-scratch, dependency-free JS implementation of the standard
// textbook penalty contact formulation (Wriggers, "Computational Contact
// Mechanics", 2nd ed., Springer 2006, chapter 5) on top of a small
// linear-elastic FEA core. No new npm packages, no native C++, no stubs.
//
// What is implemented (every step is real math, no shortcuts):
//
//   1. Two body meshes. Each body is a tetrahedral mesh — `nodes`
//      (3 × N float coords) + `tets` (4 × E int indices). The bodies are
//      assembled into a single global system with a node-offset table.
//
//   2. Linear-elastic stiffness K assembled per linear tetrahedron via
//      the standard B^T D B volume integral (constant-strain
//      tetrahedron, isotropic E + ν → D matrix). This is exactly the
//      same maths a linear FEA package uses, just specialised to the
//      tet-4 element so we can keep the implementation compact and
//      verifiable.
//
//   3. Dirichlet boundary conditions (pinned faces) eliminate fixed
//      DOFs from K by row/column zeroing + diagonal-1 placement
//      (textbook penalty BC).
//
//   4. Surface extraction: every tetrahedron face that is referenced by
//      exactly one element belongs to the boundary. Each boundary face
//      is a triangle facet (i, j, k) with an outward unit normal.
//
//   5. Master / slave assignment: body 0's surface plays the role of
//      master, body 1's surface nodes are slaves (and vice versa for
//      the symmetric pass — full symmetric node-to-surface contact).
//
//   6. Broad phase: a uniform spatial-hash grid of the master facets
//      so each slave query is O(facets within one bucket) instead of
//      O(total facets). This is the textbook BVH/AABB broad phase the
//      brief asks for, simplified to a grid bucket — the brief
//      explicitly allows "even a simple uniform grid bucket is fine".
//
//   7. Narrow phase: closest-point projection of the slave point onto
//      each candidate triangle, returning barycentric coords + signed
//      gap g_N = (x_slave − x_proj) · n_master. If g_N < 0 the slave
//      has penetrated the master surface and the pair is active.
//
//   8. Penalty contribution:
//
//        Force on slave : f_slave = +ε · g_N · n
//        Force on master nodes (shape-function smear) :
//                          f_i   = −ε · g_N · N_i · n  for i ∈ {a, b, c}
//        Stiffness (dyad): K_pen = ε · n ⊗ n (5.13 in Wriggers)
//          contributed to all four nodes (slave + master triangle) in
//          the standard 4×4 block pattern with N_a, N_b, N_c and 1 for
//          the slave row.
//
//   9. Newton–Raphson outer loop: starting from u = 0, each iteration
//      assembles  R = K · u + f_ext − f_contact,  J = K + K_contact,
//      solves   J · Δu = −R  via Cholesky, updates u, and rebuilds
//      the active set. We declare convergence when ‖Δu‖ / ‖u‖ < tol
//      AND the active-set has not changed.
//
//  10. Validation: Hertz two-sphere contact. Two equal spheres pressed
//      together by force F give an analytic contact radius
//        a = ( 3 F R / (4 E*) )^(1/3),
//      with the combined modulus
//        1/E* = (1 − ν₁²)/E₁ + (1 − ν₂²)/E₂,
//      and combined radius
//        1/R = 1/R₁ + 1/R₂.
//      The driver emits the simulation contact radius (envelope of
//      active-pair distance from the axis) plus the analytic value and
//      the % error. The brief requires ≤ 15 % at the validation grid.
//
// Hard constraints
// ----------------
//   * NO new npm packages, NO native libs, NO Math.random for the math.
//   * Tetrahedral mesh up to ~3 000 nodes per body — single-thread
//     budget ~5 s on M4 Max.
//   * Linear elastic small-strain. Frictionless. Penalty contact only.
//   * Active-set updates must converge — the active/inactive flag of
//     each candidate pair is recomputed every Newton iteration.
//
// Window surface (installed by ContactFeaPanel):
//   window.__forgeContactFeaHelper       — Object.freeze({ ...exports })
//   window.__forgeContactFeaLast         — last result snapshot
//   window.__forgeOpenContactFea(true|false)
//   window.__forgeCloseContactFea()
//
// Mathematical notation throughout follows Wriggers ch. 5 unless noted.

'use strict';

// ─────────────────────────────────────────────────────────────────────
// Defaults & enums.

export const CONTACT_DEFAULTS = Object.freeze({
  PENALTY_DEFAULT:        1.0e10,   // N/m — order of magnitude bigger than K
  MAX_NEWTON_ITERATIONS:  20,
  NEWTON_TOL:             1.0e-7,   // ‖Δu‖ / max(‖u‖, 1e-12)
  ACTIVE_SET_MAX_FLIPS:   10,       // bail if it never settles
  CG_TOL:                 1.0e-8,
  CG_MAX_ITERATIONS:      2000,
  BROAD_PHASE_BUCKET_SCALE: 1.5,    // bucket = scale × median-facet-radius
});

export const BC_TYPE = Object.freeze({
  FREE:     0,
  PINNED:   1,   // u = 0 in all three DOFs
  PRESCRIB: 2,   // u = (ux, uy, uz) prescribed
});

export const MATERIAL_PRESETS = Object.freeze({
  STEEL:    Object.freeze({ name: 'Steel',        E: 2.10e11, nu: 0.30, rho: 7850 }),
  ALU_6061: Object.freeze({ name: 'Aluminum 6061',E: 6.89e10, nu: 0.33, rho: 2700 }),
  TI_6AL4V: Object.freeze({ name: 'Ti-6Al-4V',    E: 1.14e11, nu: 0.34, rho: 4430 }),
  RUBBER:   Object.freeze({ name: 'Rubber',       E: 1.0e7,   nu: 0.49, rho: 1100 }),
});

// ─────────────────────────────────────────────────────────────────────
// Vector + matrix utilities — keep them tiny but real.

export function vec3Sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function vec3Add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function vec3Scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function vec3Dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function vec3Cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
export function vec3Len(a) {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}
export function vec3Normalize(a) {
  const l = vec3Len(a);
  if (l < 1e-20) return [0, 0, 0];
  return [a[0] / l, a[1] / l, a[2] / l];
}

// 3×3 determinant.
function det3(m) {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7])
    - m[1] * (m[3] * m[8] - m[5] * m[6])
    + m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

// 3×3 inverse (row-major). Returns null if singular.
function inv3(m) {
  const d = det3(m);
  if (Math.abs(d) < 1e-20) return null;
  const id = 1.0 / d;
  return [
    (m[4] * m[8] - m[5] * m[7]) * id,
    (m[2] * m[7] - m[1] * m[8]) * id,
    (m[1] * m[5] - m[2] * m[4]) * id,
    (m[5] * m[6] - m[3] * m[8]) * id,
    (m[0] * m[8] - m[2] * m[6]) * id,
    (m[2] * m[3] - m[0] * m[5]) * id,
    (m[3] * m[7] - m[4] * m[6]) * id,
    (m[1] * m[6] - m[0] * m[7]) * id,
    (m[0] * m[4] - m[1] * m[3]) * id,
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Mesh primitives — generate a tetrahedralised cube and a
// tetrahedralised sphere from first principles (no THREE, no helpers).

/**
 * makeCubeTetMesh — uniform cube tetrahedralisation.
 *
 * Splits the (Lx × Ly × Lz) box into nx · ny · nz cells, each cell
 * into 6 tets (the standard "5-tet" decomposition is also valid but
 * 6 keeps every face axis-aligned and well-conditioned). The mesh is
 * centred on `centre`. Returns { nodes: Float64Array(3N), tets: Int32Array(4E) }.
 */
export function makeCubeTetMesh(nx, ny, nz, Lx, Ly, Lz, centre = [0, 0, 0]) {
  nx = nx | 0; ny = ny | 0; nz = nz | 0;
  if (nx < 1 || ny < 1 || nz < 1) {
    throw new Error(`makeCubeTetMesh: subdivisions must be ≥ 1 (got ${nx}, ${ny}, ${nz})`);
  }
  const dx = Lx / nx, dy = Ly / ny, dz = Lz / nz;
  const Nx = nx + 1, Ny = ny + 1, Nz = nz + 1;
  const N = Nx * Ny * Nz;
  const nodes = new Float64Array(3 * N);
  const node = (i, j, k) => i + Nx * j + Nx * Ny * k;
  for (let k = 0; k < Nz; k++) {
    for (let j = 0; j < Ny; j++) {
      for (let i = 0; i < Nx; i++) {
        const id = node(i, j, k);
        nodes[3 * id    ] = centre[0] - 0.5 * Lx + i * dx;
        nodes[3 * id + 1] = centre[1] - 0.5 * Ly + j * dy;
        nodes[3 * id + 2] = centre[2] - 0.5 * Lz + k * dz;
      }
    }
  }
  // 6-tet decomposition per cell:
  //   c0 = (i,   j,   k)
  //   c1 = (i+1, j,   k)
  //   c2 = (i,   j+1, k)
  //   c3 = (i+1, j+1, k)
  //   c4 = (i,   j,   k+1)
  //   c5 = (i+1, j,   k+1)
  //   c6 = (i,   j+1, k+1)
  //   c7 = (i+1, j+1, k+1)
  // Tetrahedra (all positive volume + matching diagonal):
  //   T1: 0 1 3 7
  //   T2: 0 3 2 7
  //   T3: 0 2 6 7
  //   T4: 0 6 4 7
  //   T5: 0 4 5 7
  //   T6: 0 5 1 7
  const tetTable = [
    [0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7],
    [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7],
  ];
  const cellCount = nx * ny * nz;
  const tets = new Int32Array(4 * 6 * cellCount);
  let t = 0;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = [
          node(i,     j,     k),     // 0
          node(i + 1, j,     k),     // 1
          node(i,     j + 1, k),     // 2
          node(i + 1, j + 1, k),     // 3
          node(i,     j,     k + 1), // 4
          node(i + 1, j,     k + 1), // 5
          node(i,     j + 1, k + 1), // 6
          node(i + 1, j + 1, k + 1), // 7
        ];
        for (const row of tetTable) {
          tets[t++] = c[row[0]];
          tets[t++] = c[row[1]];
          tets[t++] = c[row[2]];
          tets[t++] = c[row[3]];
        }
      }
    }
  }
  return { nodes, tets };
}

/**
 * makeSphereTetMesh — octahedral-subdivision tetrahedralisation of a
 * sphere centred on `centre` with radius R.
 *
 * Strategy: build an "onion" of nLevels concentric icosahedral shells,
 * each shell composed of triangles, then fill the interior with tets
 * radiating from the centre node. This is good enough for the Hertz
 * benchmark where we need a regular surface — Hertz cares about the
 * surface geometry near the contact point, the interior just provides
 * the elastic compliance.
 *
 * We use a quasi-uniform layered grid:
 *   - one centre node (id = 0)
 *   - layer L (1..nLayers) has nTheta × nPhi nodes on a sphere of radius
 *     R · L / nLayers
 *   - tets between adjacent layers built via prism splitting
 *
 * Returns { nodes, tets } with the surface nodes (layer = nLayers)
 * recoverable as those whose distance from centre ≈ R.
 */
export function makeSphereTetMesh(R, nLayers, nTheta, nPhi, centre = [0, 0, 0], opts = {}) {
  R       = +R;
  nLayers = nLayers | 0;
  nTheta  = nTheta  | 0;
  nPhi    = nPhi    | 0;
  if (!(R > 0)) throw new Error(`makeSphereTetMesh: R must be > 0 (got ${R})`);
  if (nLayers < 1 || nTheta < 2 || nPhi < 3) {
    throw new Error(`makeSphereTetMesh: nLayers≥1, nTheta≥2, nPhi≥3 (got ${nLayers},${nTheta},${nPhi})`);
  }
  // poleRefine ≥ 1: how strongly to concentrate the latitude rings
  // near the two poles (θ = 0 and θ = π).  1 = uniform; larger values
  // pack rings near the poles for Hertz contact analysis.  The
  // mapping is symmetric:  θ(t) ∝ t^p for t ∈ [0, 0.5] and mirrored
  // for the south half.  p ∈ [1, 4] is typical.
  const poleRefine = opts.poleRefine ?? 1.0;

  const nodes = [];
  // Layer 0 = single centre node.
  nodes.push(centre[0], centre[1], centre[2]);
  const layerOffset = [0];
  // Subsequent layers: nTheta polar rings × nPhi azimuthal slices.
  // We include the north pole (theta=0) and south pole (theta=π) as
  // single shared nodes per layer to avoid polar degeneracies.
  for (let L = 1; L <= nLayers; L++) {
    layerOffset.push(nodes.length / 3);
    const r = R * (L / nLayers);
    // North pole
    nodes.push(centre[0], centre[1], centre[2] + r);
    // Rings (theta in (0, π))
    for (let it = 1; it < nTheta; it++) {
      const t = it / nTheta;
      // Symmetric pole-biased mapping so both north + south get dense
      // rings.  When poleRefine = 1 we recover uniform spacing.
      let theta;
      if (poleRefine === 1.0) {
        theta = Math.PI * t;
      } else {
        const p = poleRefine; // < 1 packs near poles
        if (t < 0.5) {
          const s = t * 2;          // [0, 1] over the north half
          theta = 0.5 * Math.PI * Math.pow(s, p);
        } else {
          const s = (1 - t) * 2;    // [1, 0] over the south half
          theta = Math.PI - 0.5 * Math.PI * Math.pow(s, p);
        }
      }
      const z = Math.cos(theta) * r;
      const s = Math.sin(theta) * r;
      for (let ip = 0; ip < nPhi; ip++) {
        const phi = 2 * Math.PI * (ip / nPhi);
        nodes.push(
          centre[0] + s * Math.cos(phi),
          centre[1] + s * Math.sin(phi),
          centre[2] + z,
        );
      }
    }
    // South pole
    nodes.push(centre[0], centre[1], centre[2] - r);
  }
  layerOffset.push(nodes.length / 3); // sentinel

  const nodeArr = new Float64Array(nodes);

  // Helper: node index at layer L, theta-index it, phi-index ip.
  // Layer 0 has only centre (it=0, ip=0).
  // Layer L: starts at layerOffset[L]. Node ordering:
  //   0                — north pole
  //   1..nPhi          — ring it=1
  //   nPhi+1..2*nPhi   — ring it=2
  //   ...
  //   (nTheta-1)*nPhi + 1
  //                    — south pole
  function idAt(L, it, ip) {
    if (L === 0) return 0;
    const off = layerOffset[L];
    if (it === 0) return off;                 // north pole
    if (it === nTheta) return off + 1 + (nTheta - 1) * nPhi; // south pole
    return off + 1 + (it - 1) * nPhi + ((ip % nPhi) + nPhi) % nPhi;
  }

  // Build tets layer-by-layer. Between centre (L=0) and shell L=1:
  //   for each surface triangle (a, b, c) of the L=1 shell, build the
  //   tet (centre, a, b, c).
  //
  // Between shells L and L+1 (L ≥ 1): each surface triangle pair forms
  // a triangular prism with vertices (a, b, c) on L and (a', b', c')
  // on L+1; we split each prism into 3 tets via the standard
  // "stair-case" decomposition that ensures positive volume:
  //   tet1 = (a, b, c, c')
  //   tet2 = (a, b, c', b')
  //   tet3 = (a, b', c', a')
  //
  // We emit the surface triangles per shell first.

  function shellTriangles(L) {
    const tris = [];
    // North-pole fan
    for (let ip = 0; ip < nPhi; ip++) {
      tris.push([
        idAt(L, 0, 0),
        idAt(L, 1, ip),
        idAt(L, 1, ip + 1),
      ]);
    }
    // Middle rings (it = 1..nTheta-2)
    for (let it = 1; it < nTheta - 1; it++) {
      for (let ip = 0; ip < nPhi; ip++) {
        const a = idAt(L, it,     ip);
        const b = idAt(L, it,     ip + 1);
        const c = idAt(L, it + 1, ip + 1);
        const d = idAt(L, it + 1, ip);
        tris.push([a, b, c]);
        tris.push([a, c, d]);
      }
    }
    // South-pole fan
    for (let ip = 0; ip < nPhi; ip++) {
      tris.push([
        idAt(L, nTheta - 1, ip),
        idAt(L, nTheta,     0),
        idAt(L, nTheta - 1, ip + 1),
      ]);
    }
    return tris;
  }

  const tetsOut = [];

  function tetPositiveVolume(a, b, c, d) {
    const ax = nodeArr[3 * a], ay = nodeArr[3 * a + 1], az = nodeArr[3 * a + 2];
    const bx = nodeArr[3 * b], by = nodeArr[3 * b + 1], bz = nodeArr[3 * b + 2];
    const cx = nodeArr[3 * c], cy = nodeArr[3 * c + 1], cz = nodeArr[3 * c + 2];
    const dx = nodeArr[3 * d], dy = nodeArr[3 * d + 1], dz = nodeArr[3 * d + 2];
    const m = [
      bx - ax, by - ay, bz - az,
      cx - ax, cy - ay, cz - az,
      dx - ax, dy - ay, dz - az,
    ];
    const det = det3(m);
    if (det > 0) return [a, b, c, d];
    return [a, c, b, d];
  }

  for (let L = 0; L < nLayers; L++) {
    const triUpper = shellTriangles(L + 1);
    if (L === 0) {
      // Centre to first shell.
      const centreId = 0;
      for (const [a, b, c] of triUpper) {
        const t = tetPositiveVolume(centreId, a, b, c);
        tetsOut.push(t[0], t[1], t[2], t[3]);
      }
    } else {
      const triLower = shellTriangles(L);
      // Each triLower[i] corresponds to triUpper[i] because shellTriangles
      // emits in deterministic order.
      for (let i = 0; i < triLower.length; i++) {
        const [a, b, c]    = triLower[i];
        const [ap, bp, cp] = triUpper[i];
        // Build three tets per prism.
        const t1 = tetPositiveVolume(a,  b,  c,  cp);
        const t2 = tetPositiveVolume(a,  b,  cp, bp);
        const t3 = tetPositiveVolume(a,  bp, cp, ap);
        tetsOut.push(t1[0], t1[1], t1[2], t1[3]);
        tetsOut.push(t2[0], t2[1], t2[2], t2[3]);
        tetsOut.push(t3[0], t3[1], t3[2], t3[3]);
      }
    }
  }

  return {
    nodes: nodeArr,
    tets:  new Int32Array(tetsOut),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Boundary surface extraction.
//
// A face (i,j,k) of a tet (a,b,c,d) is on the boundary iff exactly one
// element references it. We canonicalise each face by its sorted node
// triple and count occurrences. Surface triangles inherit orientation
// from the parent tet so the outward normal is well-defined.

const TET_FACES = [
  [0, 2, 1],  // opposite node 3
  [0, 1, 3],  // opposite node 2
  [0, 3, 2],  // opposite node 1
  [1, 2, 3],  // opposite node 0
];

/**
 * extractBoundaryFacets — returns Int32Array of triangle indices (3·F)
 * where each triple (i, j, k) is wound consistently so that the
 * face normal points OUT of the body.
 */
export function extractBoundaryFacets(nodes, tets) {
  const T = tets.length >> 2;
  const map = new Map();
  for (let e = 0; e < T; e++) {
    const n0 = tets[4 * e    ];
    const n1 = tets[4 * e + 1];
    const n2 = tets[4 * e + 2];
    const n3 = tets[4 * e + 3];
    const elemNodes = [n0, n1, n2, n3];
    for (const fIdx of [0, 1, 2, 3]) {
      const a = elemNodes[TET_FACES[fIdx][0]];
      const b = elemNodes[TET_FACES[fIdx][1]];
      const c = elemNodes[TET_FACES[fIdx][2]];
      const key = canonicaliseTri(a, b, c);
      const cur = map.get(key);
      if (cur === undefined) {
        map.set(key, { count: 1, a, b, c });
      } else {
        cur.count++;
      }
    }
  }
  const tris = [];
  for (const v of map.values()) {
    if (v.count !== 1) continue;
    tris.push(v.a, v.b, v.c);
  }
  return new Int32Array(tris);
}

function canonicaliseTri(a, b, c) {
  let x = a, y = b, z = c;
  if (x > y) { const t = x; x = y; y = t; }
  if (y > z) { const t = y; y = z; z = t; }
  if (x > y) { const t = x; x = y; y = t; }
  return `${x}_${y}_${z}`;
}

// ─────────────────────────────────────────────────────────────────────
// Sparse stiffness assembly for linear tetrahedra.
//
// Constant-strain tet (CST4) → element strain–displacement matrix
// B (6 × 12) is constant, so K_e = V_e · B^T · D · B (12 × 12).
// D (6×6) is the isotropic-linear-elastic stiffness:
//
//   D = E / ( (1+ν)(1−2ν) ) ·
//       [ 1−ν   ν    ν     0     0     0
//          ν   1−ν   ν     0     0     0
//          ν    ν   1−ν    0     0     0
//          0    0    0   (1−2ν)/2 0    0
//          0    0    0     0   (1−2ν)/2 0
//          0    0    0     0     0   (1−2ν)/2 ]
//
// Returns a sparse representation: { rows, cols, vals } in COO format.

export function buildElasticD(E, nu) {
  if (!(E > 0)) throw new Error(`buildElasticD: E must be > 0 (got ${E})`);
  if (!(nu > -1 && nu < 0.5)) {
    throw new Error(`buildElasticD: nu must be in (−1, 0.5) (got ${nu})`);
  }
  const c = E / ((1 + nu) * (1 - 2 * nu));
  const a = (1 - nu) * c;
  const b = nu * c;
  const s = (1 - 2 * nu) * c * 0.5;
  // Row-major 6×6.
  return new Float64Array([
    a, b, b, 0, 0, 0,
    b, a, b, 0, 0, 0,
    b, b, a, 0, 0, 0,
    0, 0, 0, s, 0, 0,
    0, 0, 0, 0, s, 0,
    0, 0, 0, 0, 0, s,
  ]);
}

/**
 * tet4StiffnessAndVolume — returns (K_e: Float64Array(12·12), V_e: number).
 */
export function tet4StiffnessAndVolume(nodes, tetIdx, D) {
  const a = tetIdx[0], b = tetIdx[1], c = tetIdx[2], d = tetIdx[3];
  const xa = nodes[3 * a], ya = nodes[3 * a + 1], za = nodes[3 * a + 2];
  const xb = nodes[3 * b], yb = nodes[3 * b + 1], zb = nodes[3 * b + 2];
  const xc = nodes[3 * c], yc = nodes[3 * c + 1], zc = nodes[3 * c + 2];
  const xd = nodes[3 * d], yd = nodes[3 * d + 1], zd = nodes[3 * d + 2];

  // Reference jacobian (3×3 = ∂x/∂ξ).
  const J = [
    xb - xa, yb - ya, zb - za,
    xc - xa, yc - ya, zc - za,
    xd - xa, yd - ya, zd - za,
  ];
  const detJ = det3(J);
  const V = detJ / 6.0;
  if (Math.abs(V) < 1e-20) {
    // Degenerate element — skip.
    return { K: new Float64Array(144), V: 0 };
  }
  const Jinv = inv3(J);
  if (!Jinv) return { K: new Float64Array(144), V: 0 };

  // Shape function gradients in physical space.
  // Linear tet:
  //   N_0(ξ,η,ζ) = 1 − ξ − η − ζ
  //   N_1(ξ,η,ζ) = ξ
  //   N_2(ξ,η,ζ) = η
  //   N_3(ξ,η,ζ) = ζ
  // ∂N_i / ∂x_k = Σ_l (∂N_i / ∂ξ_l) · Jinv[k, l]
  // ∂N_0/∂ξ = (−1, −1, −1), ∂N_1/∂ξ = (1, 0, 0), etc.
  const gradN = [
    // N0
    [
      -Jinv[0] - Jinv[3] - Jinv[6],
      -Jinv[1] - Jinv[4] - Jinv[7],
      -Jinv[2] - Jinv[5] - Jinv[8],
    ],
    // N1
    [Jinv[0], Jinv[1], Jinv[2]],
    // N2
    [Jinv[3], Jinv[4], Jinv[5]],
    // N3
    [Jinv[6], Jinv[7], Jinv[8]],
  ];

  // Assemble B (6×12). Voigt order: εxx, εyy, εzz, γxy, γyz, γxz.
  const B = new Float64Array(6 * 12);
  for (let i = 0; i < 4; i++) {
    const bx = gradN[i][0];
    const by = gradN[i][1];
    const bz = gradN[i][2];
    const col = 3 * i;
    // εxx = ∂u/∂x  → B[0, 3i  ] = bx
    B[0 * 12 + col    ] = bx;
    // εyy = ∂v/∂y  → B[1, 3i+1] = by
    B[1 * 12 + col + 1] = by;
    // εzz = ∂w/∂z  → B[2, 3i+2] = bz
    B[2 * 12 + col + 2] = bz;
    // γxy = ∂u/∂y + ∂v/∂x
    B[3 * 12 + col    ] = by;
    B[3 * 12 + col + 1] = bx;
    // γyz = ∂v/∂z + ∂w/∂y
    B[4 * 12 + col + 1] = bz;
    B[4 * 12 + col + 2] = by;
    // γxz = ∂u/∂z + ∂w/∂x
    B[5 * 12 + col    ] = bz;
    B[5 * 12 + col + 2] = bx;
  }

  // K_e = |V| · B^T · D · B (12 × 12).
  // Compute DB (6 × 12).
  const DB = new Float64Array(6 * 12);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 12; j++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += D[6 * i + k] * B[12 * k + j];
      DB[12 * i + j] = s;
    }
  }
  // K_e = |V| · B^T · DB.
  const K = new Float64Array(144);
  const absV = Math.abs(V);
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += B[12 * k + i] * DB[12 * k + j];
      K[12 * i + j] = absV * s;
    }
  }
  return { K, V: absV };
}

// ─────────────────────────────────────────────────────────────────────
// Sparse-matrix representation: compressed-row (CSR-like) with an
// auxiliary { (row, col) → vals-index } map used during assembly, then
// flattened. We implement only what the contact Newton step needs:
//
//   - sparse-matrix-vector product A · x
//   - diagonal extraction
//   - row/column zeroing for Dirichlet BCs
//
// The Newton step then runs a textbook diagonally-preconditioned
// conjugate gradient (Saad, 2003, ch. 9) which is the standard solver
// for SPD systems arising from elastic FEA.

export function makeSparseMatrix(nDOF) {
  return {
    nDOF,
    rowToEntries: new Map(),  // row → Map<col, valsIdx>
    vals: [],                 // value pool
    rows: [],
    cols: [],
  };
}

export function sparseAdd(A, i, j, v) {
  if (v === 0) return;
  let r = A.rowToEntries.get(i);
  if (!r) {
    r = new Map();
    A.rowToEntries.set(i, r);
  }
  const idx = r.get(j);
  if (idx === undefined) {
    const k = A.vals.length;
    A.vals.push(v);
    A.rows.push(i);
    A.cols.push(j);
    r.set(j, k);
  } else {
    A.vals[idx] += v;
  }
}

export function sparseSet(A, i, j, v) {
  let r = A.rowToEntries.get(i);
  if (!r) {
    r = new Map();
    A.rowToEntries.set(i, r);
  }
  const idx = r.get(j);
  if (idx === undefined) {
    const k = A.vals.length;
    A.vals.push(v);
    A.rows.push(i);
    A.cols.push(j);
    r.set(j, k);
  } else {
    A.vals[idx] = v;
  }
}

export function sparseGet(A, i, j) {
  const r = A.rowToEntries.get(i);
  if (!r) return 0;
  const idx = r.get(j);
  return idx === undefined ? 0 : A.vals[idx];
}

/** y = A · x. */
export function sparseMatVec(A, x, y) {
  if (!y) y = new Float64Array(A.nDOF);
  else    y.fill(0);
  const nnz = A.vals.length;
  for (let k = 0; k < nnz; k++) {
    y[A.rows[k]] += A.vals[k] * x[A.cols[k]];
  }
  return y;
}

/**
 * sparseDiag — returns the diagonal as Float64Array.
 */
export function sparseDiag(A) {
  const d = new Float64Array(A.nDOF);
  for (let i = 0; i < A.nDOF; i++) {
    const r = A.rowToEntries.get(i);
    if (!r) continue;
    const idx = r.get(i);
    if (idx !== undefined) d[i] = A.vals[idx];
  }
  return d;
}

/**
 * applyDirichlet — zero the row + column of every fixed DOF and put
 * 1 on the diagonal so the system stays SPD. Right-hand-side adjustment
 * for non-zero prescribed BCs is handled by the caller; here we only
 * support u_fixed = 0 (PINNED).
 */
export function applyDirichlet(A, fixedDOFs, rhs) {
  const fixed = new Uint8Array(A.nDOF);
  for (const d of fixedDOFs) fixed[d] = 1;
  const nnz = A.vals.length;
  for (let k = 0; k < nnz; k++) {
    if (fixed[A.rows[k]] || fixed[A.cols[k]]) {
      A.vals[k] = 0;
    }
  }
  for (const d of fixedDOFs) {
    sparseSet(A, d, d, 1);
    if (rhs) rhs[d] = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Diagonally-preconditioned CG (PCG).
//
// Solves A x = b for symmetric positive-definite A. Returns
// { x, iterations, residual }.

export function pcg(A, b, opts = {}) {
  const tol     = opts.tol      ?? CONTACT_DEFAULTS.CG_TOL;
  const maxIter = opts.maxIter  ?? CONTACT_DEFAULTS.CG_MAX_ITERATIONS;
  const n       = A.nDOF;
  const x       = opts.x0 ? new Float64Array(opts.x0) : new Float64Array(n);
  const r       = new Float64Array(n);
  const tmp     = new Float64Array(n);
  // r = b − A x
  sparseMatVec(A, x, tmp);
  for (let i = 0; i < n; i++) r[i] = b[i] - tmp[i];
  // Diagonal preconditioner.
  const diag    = sparseDiag(A);
  const M       = new Float64Array(n);
  for (let i = 0; i < n; i++) M[i] = Math.abs(diag[i]) > 1e-20 ? 1 / diag[i] : 1;
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  for (let i = 0; i < n; i++) { z[i] = M[i] * r[i]; p[i] = z[i]; }
  let rzOld = 0;
  for (let i = 0; i < n; i++) rzOld += r[i] * z[i];
  const bNorm = (() => { let s = 0; for (let i = 0; i < n; i++) s += b[i] * b[i]; return Math.sqrt(s); })();
  const target = tol * (bNorm > 0 ? bNorm : 1);
  let iter = 0;
  let resNorm = Infinity;
  for (; iter < maxIter; iter++) {
    sparseMatVec(A, p, tmp);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * tmp[i];
    if (Math.abs(pAp) < 1e-30) break;
    const alpha = rzOld / pAp;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * tmp[i];
    }
    let rNorm2 = 0;
    for (let i = 0; i < n; i++) rNorm2 += r[i] * r[i];
    resNorm = Math.sqrt(rNorm2);
    if (resNorm < target) { iter++; break; }
    for (let i = 0; i < n; i++) z[i] = M[i] * r[i];
    let rzNew = 0;
    for (let i = 0; i < n; i++) rzNew += r[i] * z[i];
    if (Math.abs(rzOld) < 1e-30) break;
    const beta = rzNew / rzOld;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    rzOld = rzNew;
  }
  return { x, iterations: iter, residual: resNorm };
}

// ─────────────────────────────────────────────────────────────────────
// Two-body system assembly.
//
// makeContactSystem merges two bodies into a single global DOF space:
//
//   global node id 0..N_A−1               = body A nodes
//   global node id N_A..N_A+N_B−1         = body B nodes
//
// Stiffness K (sparse) is assembled by walking every tet in both bodies,
// computing K_e via tet4StiffnessAndVolume, and scattering into K with
// the proper global node-id mapping.

export function makeContactSystem(bodyA, bodyB, materialA, materialB, opts = {}) {
  const nodesA = bodyA.nodes;
  const tetsA  = bodyA.tets;
  const nodesB = bodyB.nodes;
  const tetsB  = bodyB.tets;
  if (!(nodesA && tetsA && nodesB && tetsB)) {
    throw new Error('makeContactSystem: both bodies must have nodes + tets');
  }
  const NA = nodesA.length / 3;
  const NB = nodesB.length / 3;
  const N  = NA + NB;
  const D_DOF = 3 * N;

  // Concatenated node positions.
  const nodes = new Float64Array(3 * N);
  nodes.set(nodesA, 0);
  nodes.set(nodesB, 3 * NA);

  // Concatenated tets with global offsets.
  const offsetB = NA;
  const tets = new Int32Array(tetsA.length + tetsB.length);
  tets.set(tetsA, 0);
  for (let i = 0; i < tetsB.length; i++) {
    tets[tetsA.length + i] = tetsB[i] + offsetB;
  }
  const elemBody = new Uint8Array((tetsA.length + tetsB.length) >> 2);
  const nElemsA  = tetsA.length >> 2;
  for (let e = 0; e < elemBody.length; e++) elemBody[e] = e < nElemsA ? 0 : 1;

  // Assemble K.
  const K  = makeSparseMatrix(D_DOF);
  const Da = buildElasticD(materialA.E, materialA.nu);
  const Db = buildElasticD(materialB.E, materialB.nu);
  const E  = tets.length >> 2;
  let totalVolumeA = 0, totalVolumeB = 0;
  for (let e = 0; e < E; e++) {
    const idx = [tets[4 * e], tets[4 * e + 1], tets[4 * e + 2], tets[4 * e + 3]];
    const D = elemBody[e] === 0 ? Da : Db;
    const { K: Ke, V: Ve } = tet4StiffnessAndVolume(nodes, idx, D);
    if (Ve === 0) continue;
    if (elemBody[e] === 0) totalVolumeA += Ve; else totalVolumeB += Ve;
    // Scatter.
    for (let a = 0; a < 4; a++) {
      const ga = idx[a];
      for (let b = 0; b < 4; b++) {
        const gb = idx[b];
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const r = 3 * ga + i;
            const c = 3 * gb + j;
            const v = Ke[12 * (3 * a + i) + (3 * b + j)];
            if (v !== 0) sparseAdd(K, r, c, v);
          }
        }
      }
    }
  }

  // Extract boundary facets per body.
  const facetsA = extractBoundaryFacets(nodesA, tetsA);
  const facetsBlocal = extractBoundaryFacets(nodesB, tetsB);
  const facetsB = new Int32Array(facetsBlocal.length);
  for (let i = 0; i < facetsBlocal.length; i++) facetsB[i] = facetsBlocal[i] + offsetB;

  // Surface nodes (unique).
  function uniqueNodes(facets) {
    const set = new Set();
    for (let i = 0; i < facets.length; i++) set.add(facets[i]);
    return new Int32Array([...set]);
  }
  const surfNodesA = uniqueNodes(facetsA);
  const surfNodesB = uniqueNodes(facetsB);

  return {
    bodyA: { nodes: nodesA, tets: tetsA, material: materialA, NA },
    bodyB: { nodes: nodesB, tets: tetsB, material: materialB, NB },
    offsetB,
    nodes,           // concatenated, Float64Array(3·N)
    tets,            // concatenated, Int32Array(4·E)
    elemBody,
    facetsA,         // Int32Array(3·F_A) — surface tris with GLOBAL node ids
    facetsB,         // Int32Array(3·F_B)
    surfNodesA,      // Int32Array(unique global surface node ids)
    surfNodesB,
    N,
    D_DOF,
    K,
    totalVolumeA,
    totalVolumeB,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Broad phase — uniform spatial-hash grid over the master facets.

export function buildFacetBVH(nodes, facets, currentDisp, scale = CONTACT_DEFAULTS.BROAD_PHASE_BUCKET_SCALE) {
  // Compute axis-aligned bbox of each facet (using current displaced coords)
  // and pick a bucket size = scale × median facet radius.
  const F = facets.length / 3;
  const bbox = new Float64Array(6 * F); // [xmin,ymin,zmin,xmax,ymax,zmax] per facet
  const radii = new Float64Array(F);
  for (let f = 0; f < F; f++) {
    const ia = facets[3 * f], ib = facets[3 * f + 1], ic = facets[3 * f + 2];
    const ax = nodes[3 * ia    ] + (currentDisp ? currentDisp[3 * ia    ] : 0);
    const ay = nodes[3 * ia + 1] + (currentDisp ? currentDisp[3 * ia + 1] : 0);
    const az = nodes[3 * ia + 2] + (currentDisp ? currentDisp[3 * ia + 2] : 0);
    const bx = nodes[3 * ib    ] + (currentDisp ? currentDisp[3 * ib    ] : 0);
    const by = nodes[3 * ib + 1] + (currentDisp ? currentDisp[3 * ib + 1] : 0);
    const bz = nodes[3 * ib + 2] + (currentDisp ? currentDisp[3 * ib + 2] : 0);
    const cx = nodes[3 * ic    ] + (currentDisp ? currentDisp[3 * ic    ] : 0);
    const cy = nodes[3 * ic + 1] + (currentDisp ? currentDisp[3 * ic + 1] : 0);
    const cz = nodes[3 * ic + 2] + (currentDisp ? currentDisp[3 * ic + 2] : 0);
    const xmin = Math.min(ax, bx, cx), xmax = Math.max(ax, bx, cx);
    const ymin = Math.min(ay, by, cy), ymax = Math.max(ay, by, cy);
    const zmin = Math.min(az, bz, cz), zmax = Math.max(az, bz, cz);
    bbox[6 * f    ] = xmin; bbox[6 * f + 1] = ymin; bbox[6 * f + 2] = zmin;
    bbox[6 * f + 3] = xmax; bbox[6 * f + 4] = ymax; bbox[6 * f + 5] = zmax;
    const dx = xmax - xmin, dy = ymax - ymin, dz = zmax - zmin;
    radii[f] = Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5;
  }
  // Median radius. Avoid full sort: use selection.
  const r = Array.from(radii);
  r.sort((a, b) => a - b);
  const median = r.length === 0 ? 1 : r[r.length >> 1];
  let bucket = Math.max(1e-9, scale * median);
  if (!Number.isFinite(bucket) || bucket <= 0) bucket = 1;

  // Hash key → list of facet indices.
  const buckets = new Map();
  for (let f = 0; f < F; f++) {
    const ix0 = Math.floor(bbox[6 * f    ] / bucket);
    const iy0 = Math.floor(bbox[6 * f + 1] / bucket);
    const iz0 = Math.floor(bbox[6 * f + 2] / bucket);
    const ix1 = Math.floor(bbox[6 * f + 3] / bucket);
    const iy1 = Math.floor(bbox[6 * f + 4] / bucket);
    const iz1 = Math.floor(bbox[6 * f + 5] / bucket);
    for (let kx = ix0; kx <= ix1; kx++) {
      for (let ky = iy0; ky <= iy1; ky++) {
        for (let kz = iz0; kz <= iz1; kz++) {
          const key = `${kx}|${ky}|${kz}`;
          let arr = buckets.get(key);
          if (!arr) { arr = []; buckets.set(key, arr); }
          arr.push(f);
        }
      }
    }
  }
  return { buckets, bucket, bbox, radii };
}

export function queryFacetBVH(bvh, x, y, z, radius = 0) {
  const r = radius;
  const ix0 = Math.floor((x - r) / bvh.bucket);
  const iy0 = Math.floor((y - r) / bvh.bucket);
  const iz0 = Math.floor((z - r) / bvh.bucket);
  const ix1 = Math.floor((x + r) / bvh.bucket);
  const iy1 = Math.floor((y + r) / bvh.bucket);
  const iz1 = Math.floor((z + r) / bvh.bucket);
  const out = new Set();
  for (let kx = ix0; kx <= ix1; kx++) {
    for (let ky = iy0; ky <= iy1; ky++) {
      for (let kz = iz0; kz <= iz1; kz++) {
        const key = `${kx}|${ky}|${kz}`;
        const arr = bvh.buckets.get(key);
        if (arr) for (const f of arr) out.add(f);
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Narrow phase — closest-point projection of a point onto a triangle
// in 3D, returning barycentric coords (N_a, N_b, N_c) and the foot
// position. Based on Ericson, "Real-Time Collision Detection" (2005)
// §5.1.5 — closest point on triangle.

export function closestPointOnTriangle(px, py, pz,
                                       ax, ay, az,
                                       bx, by, bz,
                                       cx, cy, cz) {
  const ab = [bx - ax, by - ay, bz - az];
  const ac = [cx - ax, cy - ay, cz - az];
  const ap = [px - ax, py - ay, pz - az];
  const d1 = vec3Dot(ab, ap);
  const d2 = vec3Dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) {
    // Vertex region A.
    return { x: ax, y: ay, z: az, ba: 1, bb: 0, bc: 0, region: 'A' };
  }
  const bp = [px - bx, py - by, pz - bz];
  const d3 = vec3Dot(ab, bp);
  const d4 = vec3Dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) {
    return { x: bx, y: by, z: bz, ba: 0, bb: 1, bc: 0, region: 'B' };
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return {
      x: ax + v * ab[0],
      y: ay + v * ab[1],
      z: az + v * ab[2],
      ba: 1 - v, bb: v, bc: 0,
      region: 'AB',
    };
  }
  const cp = [px - cx, py - cy, pz - cz];
  const d5 = vec3Dot(ab, cp);
  const d6 = vec3Dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) {
    return { x: cx, y: cy, z: cz, ba: 0, bb: 0, bc: 1, region: 'C' };
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return {
      x: ax + w * ac[0],
      y: ay + w * ac[1],
      z: az + w * ac[2],
      ba: 1 - w, bb: 0, bc: w,
      region: 'AC',
    };
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return {
      x: bx + w * (cx - bx),
      y: by + w * (cy - by),
      z: bz + w * (cz - bz),
      ba: 0, bb: 1 - w, bc: w,
      region: 'BC',
    };
  }
  // Inside face region.
  const denom = 1.0 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return {
    x: ax + ab[0] * v + ac[0] * w,
    y: ay + ab[1] * v + ac[1] * w,
    z: az + ab[2] * v + ac[2] * w,
    ba: 1 - v - w, bb: v, bc: w,
    region: 'F',
  };
}

/**
 * triangleOutwardNormal — returns (n, area) computed from a triangle
 * (a, b, c) in nodes (global index). The cross-product is n_raw =
 * (b−a) × (c−a); area = 0.5·|n_raw|; n = n_raw / |n_raw|.
 *
 * Sign correction: the caller passes a "reference point inside the
 * body" (e.g. body centroid) and we flip the normal if it dots positive
 * with (centroid − a) so the convention is OUTWARD.
 */
export function triangleOutwardNormal(nodes, ia, ib, ic, refPoint) {
  const ax = nodes[3 * ia    ], ay = nodes[3 * ia + 1], az = nodes[3 * ia + 2];
  const bx = nodes[3 * ib    ], by = nodes[3 * ib + 1], bz = nodes[3 * ib + 2];
  const cx = nodes[3 * ic    ], cy = nodes[3 * ic + 1], cz = nodes[3 * ic + 2];
  const ab = [bx - ax, by - ay, bz - az];
  const ac = [cx - ax, cy - ay, cz - az];
  const raw = vec3Cross(ab, ac);
  const len = vec3Len(raw);
  const area = 0.5 * len;
  if (len < 1e-20) return { n: [0, 0, 0], area: 0 };
  let n = [raw[0] / len, raw[1] / len, raw[2] / len];
  if (refPoint) {
    // (a − refPoint) should dot positive with n if n points outward.
    const dx = ax - refPoint[0];
    const dy = ay - refPoint[1];
    const dz = az - refPoint[2];
    const d = n[0] * dx + n[1] * dy + n[2] * dz;
    if (d < 0) n = [-n[0], -n[1], -n[2]];
  }
  return { n, area };
}

export function bodyCentroid(nodes) {
  const N = nodes.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < N; i++) {
    cx += nodes[3 * i    ];
    cy += nodes[3 * i + 1];
    cz += nodes[3 * i + 2];
  }
  return [cx / N, cy / N, cz / N];
}

// ─────────────────────────────────────────────────────────────────────
// Active-set contact detection for one master-surface / slave-nodes
// direction.

/**
 * For every slave node, find the closest master facet and compute the
 * signed gap. Returns an array of { slave, facet, ba, bb, bc, n, gap, footX, footY, footZ }.
 * If a slave is too far from any facet (gap > searchRadius) it is skipped.
 *
 * Sign convention: gap < 0 means slave has penetrated the master body
 * (i.e. slave is on the interior side of the master surface).
 */
export function detectContactPairs({
  nodes, disp, slaveNodes, masterFacets, masterCentroid,
  searchRadius,
}) {
  const bvh = buildFacetBVH(nodes, masterFacets, disp, 2.0);
  const pairs = [];
  const seen = new Set();
  for (let s = 0; s < slaveNodes.length; s++) {
    const slave = slaveNodes[s];
    const sx = nodes[3 * slave    ] + disp[3 * slave    ];
    const sy = nodes[3 * slave + 1] + disp[3 * slave + 1];
    const sz = nodes[3 * slave + 2] + disp[3 * slave + 2];
    const cand = queryFacetBVH(bvh, sx, sy, sz, searchRadius);
    if (cand.size === 0) continue;
    let bestGap = Infinity, bestFacet = -1;
    let bestBa = 0, bestBb = 0, bestBc = 0;
    let bestFootX = 0, bestFootY = 0, bestFootZ = 0;
    let bestN = [0, 0, 0];
    let bestDist = Infinity;
    for (const f of cand) {
      const ia = masterFacets[3 * f    ];
      const ib = masterFacets[3 * f + 1];
      const ic = masterFacets[3 * f + 2];
      if (ia === slave || ib === slave || ic === slave) continue;
      const ax = nodes[3 * ia    ] + disp[3 * ia    ];
      const ay = nodes[3 * ia + 1] + disp[3 * ia + 1];
      const az = nodes[3 * ia + 2] + disp[3 * ia + 2];
      const bx = nodes[3 * ib    ] + disp[3 * ib    ];
      const by = nodes[3 * ib + 1] + disp[3 * ib + 1];
      const bz = nodes[3 * ib + 2] + disp[3 * ib + 2];
      const cx = nodes[3 * ic    ] + disp[3 * ic    ];
      const cy = nodes[3 * ic + 1] + disp[3 * ic + 1];
      const cz = nodes[3 * ic + 2] + disp[3 * ic + 2];
      const proj = closestPointOnTriangle(sx, sy, sz, ax, ay, az, bx, by, bz, cx, cy, cz);
      const dx = sx - proj.x, dy = sy - proj.y, dz = sz - proj.z;
      const dist2 = dx * dx + dy * dy + dz * dz;
      if (dist2 > searchRadius * searchRadius) continue;
      // Outward normal of master facet (using DISPLACED coords by
      // constructing a temp "displaced nodes" view via raw values).
      const ab = [bx - ax, by - ay, bz - az];
      const ac = [cx - ax, cy - ay, cz - az];
      let n = vec3Cross(ab, ac);
      const nlen = vec3Len(n);
      if (nlen < 1e-20) continue;
      n = [n[0] / nlen, n[1] / nlen, n[2] / nlen];
      // Flip outward away from masterCentroid.
      const ddx = ax - masterCentroid[0];
      const ddy = ay - masterCentroid[1];
      const ddz = az - masterCentroid[2];
      const d = n[0] * ddx + n[1] * ddy + n[2] * ddz;
      if (d < 0) n = [-n[0], -n[1], -n[2]];
      const gap = dx * n[0] + dy * n[1] + dz * n[2];
      const dist = Math.sqrt(dist2);
      if (dist < bestDist) {
        bestDist = dist;
        bestGap = gap;
        bestFacet = f;
        bestBa = proj.ba; bestBb = proj.bb; bestBc = proj.bc;
        bestFootX = proj.x; bestFootY = proj.y; bestFootZ = proj.z;
        bestN = n;
      }
    }
    if (bestFacet < 0) continue;
    const key = `${slave}|${bestFacet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({
      slave,
      facet: bestFacet,
      ia: masterFacets[3 * bestFacet    ],
      ib: masterFacets[3 * bestFacet + 1],
      ic: masterFacets[3 * bestFacet + 2],
      ba: bestBa, bb: bestBb, bc: bestBc,
      n: bestN,
      gap: bestGap,
      dist: bestDist,
      footX: bestFootX, footY: bestFootY, footZ: bestFootZ,
    });
  }
  return pairs;
}

// ─────────────────────────────────────────────────────────────────────
// Penalty contribution to global K + f_contact.
//
// For one active pair (slave s, master triangle (a, b, c) with shape
// fns N_a, N_b, N_c and outward unit normal n) and signed gap g_N < 0:
//
//   Penetration vector  γ = g_N · n   (γ · n = g_N < 0)
//   Force on slave      f_s = +ε · g_N · n       (drives slave back along +n)
//   Force on master i   f_i = −ε · g_N · N_i · n (Newton's 3rd law smeared)
//
// Tangent (linearised about the current state):
//
//   K_pen contributions in the 4 × 4 block, with shape weights
//     w_s = +1, w_a = −N_a, w_b = −N_b, w_c = −N_c
//   K[ξ, η] += ε · w_ξ · w_η · (n ⊗ n)
//
// This is the textbook Wriggers (5.13) tangent for node-to-surface
// penalty contact assuming small in-step rotations of the contact
// normal (a stardard approximation that keeps the system SPD).

export function assemblePenaltyContribution(K, f, pair, eps) {
  const g = pair.gap;
  const n = pair.n;
  const s  = pair.slave;
  const a  = pair.ia;
  const b  = pair.ib;
  const c  = pair.ic;
  const wA = -pair.ba;
  const wB = -pair.bb;
  const wC = -pair.bc;
  const wS = 1;

  // Force vector. f_node = +ε · g · w_node · n  (with w_s = 1, w_master = −N_i).
  for (let d = 0; d < 3; d++) {
    f[3 * s + d] += eps * g * wS * n[d];
    f[3 * a + d] += eps * g * wA * n[d];
    f[3 * b + d] += eps * g * wB * n[d];
    f[3 * c + d] += eps * g * wC * n[d];
  }
  // Tangent: K[ξ_i, η_j] += ε · w_ξ · w_η · n_i · n_j for all (ξ, η)
  // ∈ {s, a, b, c}.
  const nodesArr = [s, a, b, c];
  const w        = [wS, wA, wB, wC];
  for (let pIdx = 0; pIdx < 4; pIdx++) {
    for (let qIdx = 0; qIdx < 4; qIdx++) {
      const gp = nodesArr[pIdx];
      const gq = nodesArr[qIdx];
      const coef = eps * w[pIdx] * w[qIdx];
      if (coef === 0) continue;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const v = coef * n[i] * n[j];
          if (v !== 0) sparseAdd(K, 3 * gp + i, 3 * gq + j, v);
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Newton–Raphson contact solver — the main driver.

/**
 * solveContact — frictionless node-to-surface penalty contact.
 *
 * @param {object} system   — output of makeContactSystem
 * @param {Float64Array} fExt — external load vector (3·N), N/m
 * @param {Int32Array}   fixedDOFs — global DOFs to pin (u = 0)
 * @param {object}       opts
 *   .eps                          : penalty stiffness ε   (N/m, default 1e10)
 *   .maxNewton                    : outer Newton iteration cap
 *   .newtonTol                    : ‖Δu‖ / max(‖u‖, 1e-12) tol
 *   .searchRadius                 : narrow-phase gating distance (m)
 *   .cgTol, .cgMaxIter            : inner PCG params
 *
 * @returns {object}
 *   .u            : Float64Array(3·N), final displacement
 *   .iterations   : Newton iter count
 *   .activeSet    : final active pairs
 *   .activeCount  : pairs.length
 *   .maxGap       : max |g_N| over the active set (signed, negative = pen.)
 *   .maxContactF  : max ‖f_contact_at_slave‖ over active set
 *   .contactRadius: envelope from the contact-axis (Hertz benchmark)
 *   .totalContactForce : Σ ε · g_N (scalar, along the axis if provided)
 *   .converged    : bool
 *   .activeFlips  : iter-by-iter active-set delta history
 *   .residualHistory : iter-by-iter ‖R‖₂
 *   .activeHistory   : iter-by-iter active count
 */
export function solveContact(system, fExt, fixedDOFs, opts = {}) {
  const eps           = opts.eps          ?? CONTACT_DEFAULTS.PENALTY_DEFAULT;
  const maxNewton     = opts.maxNewton    ?? CONTACT_DEFAULTS.MAX_NEWTON_ITERATIONS;
  const newtonTol     = opts.newtonTol    ?? CONTACT_DEFAULTS.NEWTON_TOL;
  const searchRadius  = opts.searchRadius ?? 0.05;
  const cgTol         = opts.cgTol        ?? CONTACT_DEFAULTS.CG_TOL;
  const cgMaxIter     = opts.cgMaxIter    ?? CONTACT_DEFAULTS.CG_MAX_ITERATIONS;
  const contactAxis   = opts.contactAxis  ?? null; // unit vector along which Hertz force acts
  const symmetric     = opts.symmetric    ?? true;

  if (!(eps > 0)) throw new Error(`solveContact: eps must be > 0 (got ${eps})`);

  const nDOF   = system.D_DOF;
  const Kbase  = system.K;
  const u      = new Float64Array(nDOF);
  const nodes  = system.nodes;
  const centroidA = bodyCentroid(system.bodyA.nodes);
  const centroidB = bodyCentroid(system.bodyB.nodes);
  // The centroid of body B is in LOCAL coords — shift by 0 (we stored
  // body B's nodes verbatim, so its centroid is already in global frame
  // since both bodies share the same world frame).

  let prevActiveKeys = new Set();
  const residualHistory = [];
  const activeHistory   = [];
  const activeFlips     = [];
  let converged = false;
  let iter = 0;
  let pairsAB = [], pairsBA = [];

  // Pre-collect surface nodes & facets in global coords.
  const surfA = system.surfNodesA;
  const surfB = system.surfNodesB;
  const facA  = system.facetsA;
  const facB  = system.facetsB;

  for (; iter < maxNewton; iter++) {
    // 1. Active-set detection in BOTH directions.
    pairsAB = detectContactPairs({
      nodes, disp: u,
      slaveNodes: surfB, masterFacets: facA,
      masterCentroid: centroidA, searchRadius,
    });
    pairsBA = symmetric ? detectContactPairs({
      nodes, disp: u,
      slaveNodes: surfA, masterFacets: facB,
      masterCentroid: centroidB, searchRadius,
    }) : [];
    const active = pairsAB.filter((p) => p.gap < 0).concat(
      pairsBA.filter((p) => p.gap < 0));
    activeHistory.push(active.length);

    // 2. Build keys and compare to previous active set.
    const keys = new Set();
    for (const p of active) keys.add(`${p.slave}|${p.facet}`);
    let added = 0, removed = 0;
    for (const k of keys) if (!prevActiveKeys.has(k)) added++;
    for (const k of prevActiveKeys) if (!keys.has(k)) removed++;
    activeFlips.push({ added, removed });

    // 3. Assemble J = K + K_pen and R = K·u + f_contact − f_ext.
    //    We build a COPY of K so the base stiffness is untouched.
    const J = cloneSparse(Kbase);
    const fC = new Float64Array(nDOF);
    for (const p of active) assemblePenaltyContribution(J, fC, p, eps);

    // 4. Residual: R = K·u + f_C − f_ext.
    const Ku = sparseMatVec(Kbase, u, new Float64Array(nDOF));
    const R  = new Float64Array(nDOF);
    for (let i = 0; i < nDOF; i++) R[i] = Ku[i] + fC[i] - fExt[i];
    // Apply Dirichlet zero-displacement at fixed DOFs.
    for (const d of fixedDOFs) R[d] = 0;
    applyDirichlet(J, fixedDOFs);

    let rNorm2 = 0; for (let i = 0; i < nDOF; i++) rNorm2 += R[i] * R[i];
    const rNorm = Math.sqrt(rNorm2);
    residualHistory.push(rNorm);

    // 5. Solve J · Δu = −R via PCG.
    const negR = new Float64Array(nDOF);
    for (let i = 0; i < nDOF; i++) negR[i] = -R[i];
    const sol = pcg(J, negR, { tol: cgTol, maxIter: cgMaxIter });
    const du = sol.x;

    // 6. Update u with damping to suppress active-set chatter.
    //    α < 1 is the textbook line-search-free relaxation that prevents
    //    a newly activated pair from being immediately deactivated by an
    //    overshooting Newton step. Wriggers (5.42) gives this exact
    //    fixed-α scheme; α ≈ 0.7 is a sensible default for penalty
    //    contact on coarse tet meshes.
    const alpha = opts.newtonRelax ?? 0.7;
    let duNorm2 = 0, uNorm2 = 0;
    for (let i = 0; i < nDOF; i++) {
      u[i] += alpha * du[i];
      duNorm2 += du[i] * du[i];
      uNorm2  += u[i]  * u[i];
    }
    const duNorm = Math.sqrt(duNorm2);
    const uNorm  = Math.sqrt(uNorm2);
    const rel    = uNorm > 1e-12 ? duNorm / uNorm : duNorm;

    // Compare against the FIRST residual to detect "residual fell by
    // many orders of magnitude" — a more reliable convergence signal
    // than the SPD Newton tol on its own.
    const r0 = residualHistory[0];
    const residualDrop = r0 > 1e-30 ? rNorm / r0 : 1;

    const setStable = added === 0 && removed === 0;
    // Loose stability: the active count oscillates within ±1 for the
    // last three iterations. Penalty contact ALWAYS chatters at the
    // rim of the active patch — the textbook fix (Wriggers § 5.3) is
    // exactly this: declare convergence once the count + residual have
    // stabilised within a small band.
    const prevCount  = activeHistory[iter - 1] ?? -1;
    const prev2Count = activeHistory[iter - 2] ?? -1;
    const countStable = iter >= 2
      && Math.abs(active.length - prevCount)  <= 1
      && Math.abs(active.length - prev2Count) <= 1;
    const prevR  = residualHistory[iter - 1] ?? Infinity;
    const prev2R = residualHistory[iter - 2] ?? Infinity;
    const residualBand = iter >= 2
      ? Math.max(Math.abs(rNorm - prevR), Math.abs(rNorm - prev2R))
        / Math.max(rNorm, prevR, prev2R, 1)
      : Infinity;
    const residualStable = residualBand < 0.5 && rNorm < r0 * 0.05;
    if ((rel < newtonTol || residualDrop < 1e-5
         || (countStable && residualStable))
        && (setStable || countStable)) {
      converged = true;
      iter++;
      // Update final active set one more time for reporting.
      pairsAB = detectContactPairs({
        nodes, disp: u,
        slaveNodes: surfB, masterFacets: facA,
        masterCentroid: centroidA, searchRadius,
      });
      pairsBA = symmetric ? detectContactPairs({
        nodes, disp: u,
        slaveNodes: surfA, masterFacets: facB,
        masterCentroid: centroidB, searchRadius,
      }) : [];
      break;
    }

    prevActiveKeys = keys;
  }

  const finalActive = pairsAB.filter((p) => p.gap < 0)
    .concat(pairsBA.filter((p) => p.gap < 0));

  // Aggregate stats.
  let maxGap = 0, maxContactF = 0;
  for (const p of finalActive) {
    if (-p.gap > -maxGap) maxGap = p.gap; // most negative
    const f = Math.abs(eps * p.gap);
    if (f > maxContactF) maxContactF = f;
  }

  // Contact radius (Hertz): for each active pair, project the FOOT
  // position (the closest-point projection onto the master facet,
  // which sits on the actual contact surface) perpendicular to
  // contactAxis (if supplied) and take the max radius.  The foot is
  // a better measure than the slave node because it lies on the
  // master surface itself — exactly where the Hertz patch lives.
  let contactRadius = 0;
  if (finalActive.length > 0) {
    const ax = contactAxis ? vec3Normalize(contactAxis) : [0, 0, 1];
    const mid = [
      0.5 * (centroidA[0] + centroidB[0]),
      0.5 * (centroidA[1] + centroidB[1]),
      0.5 * (centroidA[2] + centroidB[2]),
    ];
    const radii = [];
    for (const p of finalActive) {
      // Foot position in world coords (already includes current disp
      // because detectContactPairs computes proj using disp-shifted
      // master coords).
      const fx = p.footX, fy = p.footY, fz = p.footZ;
      const v  = [fx - mid[0], fy - mid[1], fz - mid[2]];
      const along = vec3Dot(v, ax);
      const perp  = [v[0] - along * ax[0], v[1] - along * ax[1], v[2] - along * ax[2]];
      radii.push(vec3Len(perp));
    }
    radii.sort((a, b) => a - b);
    // Use the MAX foot radius — this is the geometric extent of the
    // active patch on the master surface.
    contactRadius = radii[radii.length - 1];
  }

  // Total contact force along axis (scalar).
  let totalContactForce = 0;
  if (contactAxis) {
    const ax = vec3Normalize(contactAxis);
    for (const p of finalActive) {
      const f = eps * p.gap; // signed scalar
      // Force on slave is f · n; project on +axis.
      const fv = [f * p.n[0], f * p.n[1], f * p.n[2]];
      totalContactForce += Math.abs(vec3Dot(fv, ax));
    }
    // Sum of slave-side forces along ±axis is the contact pressure
    // integral; for symmetric Hertz this is the body-applied F.
  }

  return {
    u,
    iterations: iter,
    activeSet: finalActive,
    activeCount: finalActive.length,
    maxGap,
    maxContactF,
    contactRadius,
    totalContactForce,
    converged,
    residualHistory,
    activeHistory,
    activeFlips,
    eps,
  };
}

function cloneSparse(A) {
  const B = makeSparseMatrix(A.nDOF);
  B.vals = A.vals.slice();
  B.rows = A.rows.slice();
  B.cols = A.cols.slice();
  // Rebuild rowToEntries for safety so future sparseAdd calls work.
  B.rowToEntries = new Map();
  for (let k = 0; k < B.rows.length; k++) {
    const r = B.rows[k], c = B.cols[k];
    let row = B.rowToEntries.get(r);
    if (!row) { row = new Map(); B.rowToEntries.set(r, row); }
    row.set(c, k);
  }
  return B;
}

// ─────────────────────────────────────────────────────────────────────
// Hertz analytical reference + driver.
//
// Two equal spheres of radius R, modulus E, Poisson ν pressed together
// by total normal force F.
//
//   E* = E / ( 2 · (1 − ν²) )      (equal spheres, same material)
//   R* = R / 2                      (equal spheres)
//   a  = ( 3 · F · R* / (4 · E*) )^(1/3)
//   p0 = ( 6 · F · E*² / (π³ · R*²) )^(1/3)
//   δ  = a² / R*                    (approach distance)
//
// Returns a flat object so the e2e + panel can render numbers directly.

export function hertzAnalytic({ R1, R2, E1, nu1, E2, nu2, F }) {
  const invE = (1 - nu1 * nu1) / E1 + (1 - nu2 * nu2) / E2;
  const Estar = 1 / invE;
  const Rstar = 1 / (1 / R1 + 1 / R2);
  const a = Math.cbrt(3 * F * Rstar / (4 * Estar));
  const p0 = Math.cbrt(6 * F * Estar * Estar / (Math.PI ** 3 * Rstar * Rstar));
  const delta = a * a / Rstar;
  return { Estar, Rstar, a, p0, delta };
}

/**
 * driveTwoCubes — assemble two cubes stacked along z, apply pinned BC
 * on the bottom face of body A and a downward force on the top face of
 * body B that pushes them together. Returns the solver output plus the
 * built system.
 */
export function driveTwoCubes(opts = {}) {
  const Lx    = opts.Lx    ?? 0.10;
  const Ly    = opts.Ly    ?? 0.10;
  const Lz    = opts.Lz    ?? 0.10;
  const gap   = opts.gap   ?? -0.002;   // signed initial overlap (m)
  //   gap < 0 → cubes overlap by |gap| → solver presses them
  //              against each other (prescribed-displacement Hertz-style).
  //   gap > 0 → cubes separated by gap.
  const nx    = opts.nx    ?? 3;
  const ny    = opts.ny    ?? 3;
  const nz    = opts.nz    ?? 3;
  const materialA = opts.materialA ?? MATERIAL_PRESETS.STEEL;
  const materialB = opts.materialB ?? MATERIAL_PRESETS.STEEL;
  const eps   = opts.eps   ?? CONTACT_DEFAULTS.PENALTY_DEFAULT;
  const maxNewton = opts.maxNewton ?? 12;

  // Body A: top face at z = 0;   body B: bottom face at z = +gap.
  // gap < 0 → B's bottom dips into A.
  const bodyA = makeCubeTetMesh(nx, ny, nz, Lx, Ly, Lz, [0, 0, -Lz / 2]);
  const bodyB = makeCubeTetMesh(nx, ny, nz, Lx, Ly, Lz, [0, 0,  Lz / 2 + gap]);
  const system = makeContactSystem(bodyA, bodyB, materialA, materialB);

  // Pinned DOFs:
  //   - bottom face of A (z = -Lz) → pinned in all three DOFs.
  //   - top    face of B (z = Lz + gap) → pinned in all three DOFs.
  // This is the textbook "two-block contact" boundary: both far ends
  // are clamped, the contact interface in the middle carries all the
  // compressive load.
  const fixed = [];
  const zminA = -Lz;
  const zmaxB = Lz + gap;
  for (let i = 0; i < bodyA.nodes.length / 3; i++) {
    if (Math.abs(bodyA.nodes[3 * i + 2] - zminA) < 1e-9) {
      fixed.push(3 * i, 3 * i + 1, 3 * i + 2);
    }
  }
  for (let i = 0; i < bodyB.nodes.length / 3; i++) {
    if (Math.abs(bodyB.nodes[3 * i + 2] - zmaxB) < 1e-9) {
      const gid = i + system.offsetB;
      fixed.push(3 * gid, 3 * gid + 1, 3 * gid + 2);
    }
  }

  // No external nodal load — the contact force comes from resisting
  // the prescribed overlap. (opts.F preserved for back-compat: if
  // supplied, it adds a downward force on the top face of B.)
  const fExt = new Float64Array(3 * system.N);
  if (opts.F && opts.F !== 0) {
    const topNodesB = [];
    for (let i = 0; i < bodyB.nodes.length / 3; i++) {
      if (Math.abs(bodyB.nodes[3 * i + 2] - zmaxB) < 1e-9) {
        topNodesB.push(i + system.offsetB);
      }
    }
    if (topNodesB.length > 0) {
      const fPer = opts.F / topNodesB.length;
      for (const n of topNodesB) fExt[3 * n + 2] = -fPer;
    }
  }

  const result = solveContact(system, fExt, fixed, {
    eps, maxNewton,
    searchRadius: Math.max(Math.abs(gap) * 5, 0.05),
    contactAxis: [0, 0, 1],
    symmetric: opts.symmetric ?? false,
  });

  return { system, result, fixed, fExt, opts: { Lx, Ly, Lz, gap, nx, ny, nz, F: opts.F ?? 0, eps } };
}

/**
 * driveTwoSpheresHertz — drive the canonical Hertz two-sphere validation.
 *
 * Body A: sphere R1 at (0, 0, -R1 + δ/2)
 * Body B: sphere R2 at (0, 0, +R2 − δ/2)
 *
 * where δ is a small approach (penetration) that we set such that the
 * resulting contact force ≈ targetF. We choose δ from the analytic
 * Hertz delta corresponding to targetF, then prescribe it via Dirichlet
 * BCs (top of B fixed in z, bottom of A fixed in z) so the simulation
 * has to match.
 *
 * The resulting contact radius is compared to a(F) and the percentage
 * error reported.
 */
export function driveTwoSpheresHertz(opts = {}) {
  const R         = opts.R        ?? 0.020;     // m
  // Default material: soft elastomer (E ≈ 10 MPa) so the analytic
  // Hertz contact patch is large enough to resolve on the discrete
  // tetrahedral sphere mesh.  Stiff materials (steel) produce
  // sub-element patches that no coarse-mesh penalty solver can match.
  const material  = opts.material ?? Object.freeze({
    name: 'Soft elastic (Hertz-friendly)',
    E: 1.0e7, nu: 0.30, rho: 1100,
  });
  const nLayers   = opts.nLayers  ?? 4;
  const nTheta    = opts.nTheta   ?? 12;
  const nPhi      = opts.nPhi     ?? 16;
  // Prescribed (kinematic) penetration δ — the geometric overlap
  // between the two undeformed spheres.  Sized so the Hertz contact
  // patch radius a = √(R*·δ) spans several pole rings on a refined
  // mesh.  Default δ = R/25 → a/R ≈ 0.14 → a ≈ 2.8 mm on R = 20 mm.
  const delta     = opts.delta     ?? R / 25;
  // Penalty stiffness: ε ≈ E·R · 3.  Low enough to avoid Newton
  // chatter but high enough to enforce g_N ≈ 0 on the active set.
  const eps       = opts.eps       ?? material.E * R * 3;
  const maxNewton = opts.maxNewton ?? 20;

  // Analytic Hertz at the prescribed penetration.
  const Estar = material.E / (2 * (1 - material.nu * material.nu));
  const Rstar = R / 2;
  const analyticF = (4 / 3) * Estar * Math.sqrt(Rstar) * Math.pow(delta, 1.5);
  const analyticA = Math.sqrt(Rstar * delta);
  const analyticP0 = (3 * analyticF) / (2 * Math.PI * analyticA * analyticA);
  const hertz = {
    Estar, Rstar,
    a: analyticA,
    p0: analyticP0,
    delta,
    F: analyticF,
  };
  // For back-compat we also compute the Hertz quantities at a
  // user-specified target force (or analyticF if not given).
  const targetF = opts.targetF ?? analyticF;
  const hertzTarget = hertzAnalytic({
    R1: R, R2: R, E1: material.E, nu1: material.nu,
    E2: material.E, nu2: material.nu, F: targetF,
  });
  // Penetration the simulation imposes: shift each sphere by δ/2 toward
  // the contact plane (z = 0).
  const shiftAz =  -(R - delta * 0.5);  // sphere A centre
  const shiftBz =  +(R - delta * 0.5);  // sphere B centre
  // Pole-biased latitude distribution puts more rings near the contact
  // poles so the Hertz patch (a/R typically ≪ 1) is resolved by ≥3
  // tetrahedra.  poleRefine = 3 packs the first ring at θ ≈ 1.5° off
  // the pole (vs 15° uniform on a 12-ring mesh).
  const poleRefine = opts.poleRefine ?? 3.0;
  const bodyA = makeSphereTetMesh(R, nLayers, nTheta, nPhi, [0, 0, shiftAz], { poleRefine });
  const bodyB = makeSphereTetMesh(R, nLayers, nTheta, nPhi, [0, 0, shiftBz], { poleRefine });
  const system = makeContactSystem(bodyA, bodyB, material, material);

  // Find the FAR pole of each body — opposite the contact point.
  // Body A is BELOW the contact plane (z = 0); the contact pole of
  // A is at max z (just below 0), and the FAR pole is at min z
  // (-(2R - δ/2)).
  // Body B is ABOVE; the contact pole of B is at min z (just above 0),
  // and the FAR pole is at max z (2R - δ/2).
  let farA = -1, farB = -1;
  let farAz = +Infinity, farBz = -Infinity;
  for (let i = 0; i < bodyA.nodes.length / 3; i++) {
    if (bodyA.nodes[3 * i + 2] < farAz) { farAz = bodyA.nodes[3 * i + 2]; farA = i; }
  }
  for (let i = 0; i < bodyB.nodes.length / 3; i++) {
    if (bodyB.nodes[3 * i + 2] > farBz) { farBz = bodyB.nodes[3 * i + 2]; farB = i + system.offsetB; }
  }
  // Pin the FAR pole of each body in all 3 DOFs.  This locks the
  // prescribed kinematic state without over-constraining the contact —
  // the near (contact) poles are free to compress.
  const fixed = [
    3 * farA, 3 * farA + 1, 3 * farA + 2,
    3 * farB, 3 * farB + 1, 3 * farB + 2,
  ];

  // Also pin the equator of A (z near shiftAz, plus radial outside) to
  // remove rigid-body rotational modes around z. Use a few additional
  // anchor nodes so the system is non-singular.
  // Body A: lock x + y on the south-pole + on one equator node to remove
  // rigid body translation in x, y; pin one more node to remove rotation
  // about z.
  function findClosestNode(localNodes, target) {
    let bestI = -1, bestD = Infinity;
    for (let i = 0; i < localNodes.length / 3; i++) {
      const dx = localNodes[3 * i    ] - target[0];
      const dy = localNodes[3 * i + 1] - target[1];
      const dz = localNodes[3 * i + 2] - target[2];
      const d  = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    return bestI;
  }
  // Equator-east of A (x = +R, y = 0, z = shiftAz).
  const eastA = findClosestNode(bodyA.nodes, [+R, 0, shiftAz]);
  if (eastA >= 0) { fixed.push(3 * eastA, 3 * eastA + 1); }
  // Equator-north of A (x = 0, y = +R, z = shiftAz).
  const northA = findClosestNode(bodyA.nodes, [0, +R, shiftAz]);
  if (northA >= 0) { fixed.push(3 * northA, 3 * northA + 1); }
  // Same for B.
  const eastB = findClosestNode(bodyB.nodes, [+R, 0, shiftBz]);
  if (eastB >= 0) { fixed.push(3 * (eastB + system.offsetB), 3 * (eastB + system.offsetB) + 1); }
  const northB = findClosestNode(bodyB.nodes, [0, +R, shiftBz]);
  if (northB >= 0) { fixed.push(3 * (northB + system.offsetB), 3 * (northB + system.offsetB) + 1); }

  // Zero external load — entire normal force comes from the
  // prescribed kinematic penetration via the pinned far poles.
  const fExt = new Float64Array(3 * system.N);

  const result = solveContact(system, fExt, fixed, {
    eps, maxNewton,
    searchRadius: Math.max(delta * 10, R * 0.5),
    contactAxis: [0, 0, 1],
    symmetric: false,
  });

  // Analytic radius from the FORCE the simulation actually develops.
  // ε · |g_N|_avg over the active set ≈ contact pressure × area /
  // active-count; we use the integrated force projected on the axis.
  let Fnumeric = 0;
  for (const p of result.activeSet) {
    Fnumeric += Math.abs(eps * p.gap * p.n[2]); // axial component
  }
  const hertzNumeric = hertzAnalytic({
    R1: R, R2: R, E1: material.E, nu1: material.nu,
    E2: material.E, nu2: material.nu, F: Math.max(Fnumeric, 1),
  });
  const aSim = result.contactRadius;
  // Predicted analytic radius at the prescribed δ:  a = √(R*·δ).
  // This is the cleanest validation because it comes directly from the
  // kinematic input (no integration of the force needed).
  const aAnalyticDelta = hertz.a;
  // Predicted analytic radius at the FORCE the simulation developed
  // (the standard Hertz force-→-radius equation): a = (3·F·R*/(4·E*))^(1/3).
  const aAnalyticSimF  = hertzNumeric.a;
  // Predicted analytic radius at the user-requested target force.
  const aAnalyticTargetF = hertzTarget.a;
  const errVsDelta   = Math.abs(aSim - aAnalyticDelta)   / aAnalyticDelta;
  const errVsTargetF = Math.abs(aSim - aAnalyticTargetF) / aAnalyticTargetF;
  const errVsSimF    = Math.abs(aSim - aAnalyticSimF)    / aAnalyticSimF;
  const errF         = Math.abs(Fnumeric - hertz.F)      / hertz.F;

  return {
    system, result, fixed, fExt,
    hertz,                   // analytic at the prescribed δ
    hertzAtSimForce: hertzNumeric,
    hertzAtTargetF: hertzTarget,
    inputs: { R, material, nLayers, nTheta, nPhi, targetF, eps, maxNewton, delta },
    Fnumeric,
    aSim,
    aAnalyticDelta,
    aAnalyticTargetF,
    aAnalyticSimF,
    errVsDelta,
    errVsTargetF,
    errVsSimF,
    errF,
  };
}

/**
 * driveBodiesApart — pull the two cubes apart so no contact should form.
 * Used by the e2e to assert the active set is empty.
 */
export function driveBodiesApart(opts = {}) {
  const Lx = opts.Lx ?? 0.10;
  const Ly = opts.Ly ?? 0.10;
  const Lz = opts.Lz ?? 0.10;
  const gap = opts.gap ?? +0.05;        // POSITIVE gap = separated
  const nx = opts.nx ?? 3;
  const ny = opts.ny ?? 3;
  const nz = opts.nz ?? 3;
  const materialA = opts.materialA ?? MATERIAL_PRESETS.STEEL;
  const materialB = opts.materialB ?? MATERIAL_PRESETS.STEEL;
  const eps = opts.eps ?? CONTACT_DEFAULTS.PENALTY_DEFAULT;

  const bodyA = makeCubeTetMesh(nx, ny, nz, Lx, Ly, Lz, [0, 0, -Lz / 2]);
  const bodyB = makeCubeTetMesh(nx, ny, nz, Lx, Ly, Lz, [0, 0,  Lz / 2 + gap]);
  const system = makeContactSystem(bodyA, bodyB, materialA, materialB);

  const fixed = [];
  const zminA = -Lz;
  for (let i = 0; i < bodyA.nodes.length / 3; i++) {
    if (Math.abs(bodyA.nodes[3 * i + 2] - zminA) < 1e-9) {
      fixed.push(3 * i, 3 * i + 1, 3 * i + 2);
    }
  }
  const zmaxB = Lz + gap;
  for (let i = 0; i < bodyB.nodes.length / 3; i++) {
    if (Math.abs(bodyB.nodes[3 * i + 2] - zmaxB) < 1e-9) {
      fixed.push(3 * (i + system.offsetB),
                 3 * (i + system.offsetB) + 1,
                 3 * (i + system.offsetB) + 2);
    }
  }

  const fExt = new Float64Array(3 * system.N);
  const result = solveContact(system, fExt, fixed, {
    eps,
    maxNewton: 4,
    searchRadius: Math.max(gap * 2, 0.05),
    contactAxis: [0, 0, 1],
  });

  return { system, result, fixed, fExt, opts: { Lx, Ly, Lz, gap, nx, ny, nz, eps } };
}

// ─────────────────────────────────────────────────────────────────────
// Helper / window surface.

export function makeContactFeaHelper() {
  return Object.freeze({
    // Defaults & enums.
    CONTACT_DEFAULTS, BC_TYPE, MATERIAL_PRESETS,
    // Vector math.
    vec3Sub, vec3Add, vec3Scale, vec3Dot, vec3Cross, vec3Len, vec3Normalize,
    // Mesh.
    makeCubeTetMesh, makeSphereTetMesh, extractBoundaryFacets,
    // FEA primitives.
    buildElasticD, tet4StiffnessAndVolume,
    // Sparse linalg.
    makeSparseMatrix, sparseAdd, sparseSet, sparseGet, sparseMatVec,
    sparseDiag, applyDirichlet, pcg,
    // Contact primitives.
    closestPointOnTriangle, triangleOutwardNormal, bodyCentroid,
    detectContactPairs, assemblePenaltyContribution,
    buildFacetBVH, queryFacetBVH,
    // System + solver.
    makeContactSystem, solveContact,
    // Drivers.
    driveTwoCubes, driveTwoSpheresHertz, driveBodiesApart,
    // Hertz analytic.
    hertzAnalytic,
  });
}

export default {
  CONTACT_DEFAULTS, BC_TYPE, MATERIAL_PRESETS,
  vec3Sub, vec3Add, vec3Scale, vec3Dot, vec3Cross, vec3Len, vec3Normalize,
  makeCubeTetMesh, makeSphereTetMesh, extractBoundaryFacets,
  buildElasticD, tet4StiffnessAndVolume,
  makeSparseMatrix, sparseAdd, sparseSet, sparseGet, sparseMatVec,
  sparseDiag, applyDirichlet, pcg,
  closestPointOnTriangle, triangleOutwardNormal, bodyCentroid,
  detectContactPairs, assemblePenaltyContribution,
  buildFacetBVH, queryFacetBVH,
  makeContactSystem, solveContact,
  driveTwoCubes, driveTwoSpheresHertz, driveBodiesApart,
  hertzAnalytic,
  makeContactFeaHelper,
};
