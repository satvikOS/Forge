/**
 * ArchDisc Foundation — Linear-static FEM with 8-node trilinear
 * hexahedral elements.
 *
 * Why hex over the linear-tet from LinearTetFEM:
 *   - Linear tetrahedra are constant-strain elements; they suffer
 *     "shear locking" under bending, dramatically over-stiffening
 *     thin beams.
 *   - 8-node trilinear hexes integrate over 2×2×2 Gauss points so
 *     strain varies linearly inside the element. Bending mode is
 *     captured properly.
 *   - For axis-aligned cuboid geometries (the common case for our
 *     validation cantilevers + plate problems) the hex Jacobian is
 *     constant per element so the integration is exact for the
 *     linear-elastic stiffness term.
 *   - Result: cantilever bending error drops from linear-tet's −19 %
 *     to ~5 % at the same mesh density. Same K matrix structure, same
 *     CG solver, just a different element formulation.
 *
 * Implementation (Cook/Malkus/Plesha §6, Bathe §5):
 *   - Trilinear shape functions
 *       N_i(ξ, η, ζ) = (1/8)(1 + ξ_i ξ)(1 + η_i η)(1 + ζ_i ζ)
 *   - 2×2×2 Gauss quadrature at ξ, η, ζ ∈ {±1/√3}, weight = 1 each
 *   - At each Gauss point:
 *       1. compute Jacobian J = Σ_i (∇_ξ N_i) ⊗ x_i
 *       2. compute physical-space gradients ∇_x N_i = J^-1 ∇_ξ N_i
 *       3. assemble strain-displacement matrix B (6×24)
 *       4. accumulate K_e += det(J) · B^T D B
 *   - Same global SparseMatrix + Jacobi-PCG + row-elimination Dirichlet
 *     BC as the linear-tet solver.
 *
 * Validation: cantilever 100 × 10 × 10 mm Al 6061-T6, 100 N tip load.
 * On a 20 × 4 × 4 hex grid the FEM tip deflection should be within
 * about 5 % of Euler-Bernoulli δ = PL³/(3EI). The same problem on the
 * tet solver showed −19 %.
 */

import { HEX_NATURAL_SIGNS } from './HexMesh.js';

// Gauss point coordinates and weights for 2×2×2 quadrature
const GAUSS = [-1 / Math.sqrt(3), +1 / Math.sqrt(3)];

class SparseMatrix {
  constructor(n) {
    this.n = n;
    this.rows = Array.from({ length: n }, () => new Map());
  }
  add(i, j, v) { const r = this.rows[i]; r.set(j, (r.get(j) || 0) + v); }
  diag(i) { return this.rows[i].get(i) || 0; }
  matvec(x, y) {
    for (let i = 0; i < this.n; i++) {
      let s = 0;
      for (const [j, v] of this.rows[i]) s += v * x[j];
      y[i] = s;
    }
    return y;
  }
}

function pcg(A, b, opts = {}) {
  const tol = opts.tol ?? 1e-10;
  const maxIter = opts.maxIter ?? 12000;
  const n = b.length;
  const x = new Float64Array(n);
  const Minv = new Float64Array(n);
  for (let i = 0; i < n; i++) { const d = A.diag(i); Minv[i] = d > 0 ? 1 / d : 1; }
  const r = new Float64Array(n);
  const Ax = new Float64Array(n);
  A.matvec(x, Ax);
  for (let i = 0; i < n; i++) r[i] = b[i] - Ax[i];
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = Minv[i] * r[i];
  const p = z.slice();
  let rzOld = 0;
  for (let i = 0; i < n; i++) rzOld += r[i] * z[i];
  let bNorm = 0;
  for (let i = 0; i < n; i++) bNorm += b[i] * b[i];
  bNorm = Math.sqrt(bNorm) || 1;
  let iter = 0, resNorm = Infinity;
  for (; iter < maxIter; iter++) {
    A.matvec(p, Ax);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * Ax[i];
    if (Math.abs(pAp) < 1e-30) break;
    const alpha = rzOld / pAp;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Ax[i];
    }
    let r2 = 0;
    for (let i = 0; i < n; i++) r2 += r[i] * r[i];
    resNorm = Math.sqrt(r2) / bNorm;
    if (resNorm < tol) break;
    for (let i = 0; i < n; i++) z[i] = Minv[i] * r[i];
    let rzNew = 0;
    for (let i = 0; i < n; i++) rzNew += r[i] * z[i];
    const beta = rzNew / rzOld;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    rzOld = rzNew;
  }
  return { x, iterations: iter, residualNorm: resNorm };
}

function buildD(E, nu) {
  const a = E / ((1 + nu) * (1 - 2 * nu));
  const D = Array.from({ length: 6 }, () => new Float64Array(6));
  D[0][0] = D[1][1] = D[2][2] = a * (1 - nu);
  D[0][1] = D[1][0] = D[0][2] = D[2][0] = D[1][2] = D[2][1] = a * nu;
  D[3][3] = D[4][4] = D[5][5] = a * (1 - 2 * nu) / 2;
  return D;
}

/**
 * Compute per-Gauss-point shape function natural-coord gradients.
 * Returns an 8 × 3 array dN[i][k] = ∂N_i/∂(natural coord k).
 */
function shapeGradsNatural(xi, et, ze) {
  const dN = Array.from({ length: 8 }, () => new Float64Array(3));
  for (let i = 0; i < 8; i++) {
    const [xs, es, zs] = HEX_NATURAL_SIGNS[i];
    dN[i][0] = (1 / 8) * xs * (1 + es * et) * (1 + zs * ze);
    dN[i][1] = (1 / 8) * es * (1 + xs * xi) * (1 + zs * ze);
    dN[i][2] = (1 / 8) * zs * (1 + xs * xi) * (1 + es * et);
  }
  return dN;
}

function inv3(M) {
  const det =
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
  - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
  + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  if (Math.abs(det) < 1e-18) return null;
  const inv = [
    [(M[1][1] * M[2][2] - M[1][2] * M[2][1]) / det, -(M[0][1] * M[2][2] - M[0][2] * M[2][1]) / det,  (M[0][1] * M[1][2] - M[0][2] * M[1][1]) / det],
    [-(M[1][0] * M[2][2] - M[1][2] * M[2][0]) / det,  (M[0][0] * M[2][2] - M[0][2] * M[2][0]) / det, -(M[0][0] * M[1][2] - M[0][2] * M[1][0]) / det],
    [(M[1][0] * M[2][1] - M[1][1] * M[2][0]) / det, -(M[0][0] * M[2][1] - M[0][1] * M[2][0]) / det,  (M[0][0] * M[1][1] - M[0][1] * M[1][0]) / det],
  ];
  return { inv, det };
}

/**
 * Element stiffness via 2×2×2 Gauss integration.
 * Also returns the per-Gauss-point B matrices + det J for stress recovery.
 */
function elementStiffness(corners, D) {
  const Ke = Array.from({ length: 24 }, () => new Float64Array(24));
  const Bs = [];
  const detJs = [];
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
    const xi = GAUSS[a], et = GAUSS[b], ze = GAUSS[c];
    const dNn = shapeGradsNatural(xi, et, ze);
    // Jacobian
    const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 8; i++) {
      for (let p = 0; p < 3; p++)
        for (let q = 0; q < 3; q++)
          J[p][q] += dNn[i][q] * corners[i][p];
    }
    const inv = inv3(J);
    if (!inv) continue;
    // Physical-space gradients ∇_x N_i = J^-T · (∇_ξ N_i)
    // (since J transforms from natural to physical, ∂N/∂x = J^-T ∂N/∂ξ)
    const dNphys = Array.from({ length: 8 }, () => new Float64Array(3));
    for (let i = 0; i < 8; i++) {
      for (let p = 0; p < 3; p++) {
        let s = 0;
        for (let q = 0; q < 3; q++) s += inv.inv[q][p] * dNn[i][q];
        dNphys[i][p] = s;
      }
    }
    // B matrix (6 × 24)
    const B = Array.from({ length: 6 }, () => new Float64Array(24));
    for (let i = 0; i < 8; i++) {
      const bx = dNphys[i][0], by = dNphys[i][1], bz = dNphys[i][2];
      const c0 = i * 3;
      B[0][c0] = bx;
      B[1][c0 + 1] = by;
      B[2][c0 + 2] = bz;
      B[3][c0] = by;     B[3][c0 + 1] = bx;
      B[4][c0 + 1] = bz; B[4][c0 + 2] = by;
      B[5][c0] = bz;     B[5][c0 + 2] = bx;
    }
    // DB (6×24)
    const DB = Array.from({ length: 6 }, () => new Float64Array(24));
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 24; j++) {
        let s = 0;
        for (let k = 0; k < 6; k++) s += D[i][k] * B[k][j];
        DB[i][j] = s;
      }
    }
    // K_e += det(J) · weight · B^T DB ; weight = 1 for 2×2×2 Gauss
    const w = inv.det;
    for (let i = 0; i < 24; i++) {
      for (let j = 0; j < 24; j++) {
        let s = 0;
        for (let k = 0; k < 6; k++) s += B[k][i] * DB[k][j];
        Ke[i][j] += w * s;
      }
    }
    Bs.push(B);
    detJs.push(inv.det);
  }
  return { Ke, Bs, detJs };
}

/**
 * Solve linear-static FEM on a HexMesh.
 *
 * Same API surface as LinearTetFEM.solveLinearStatic so callers can
 * swap element type by switching mesh type.
 *
 * @param {object} args
 * @param {HexMesh} args.mesh
 * @param {object} args.material - { E, nu, yieldStrength? }
 * @param {number[]} args.fixedNodes - all 3 DOFs fixed at these node indices
 * @param {Array<{node, dof, value?}>} args.fixedDofs - per-DOF fixity
 * @param {Array<{node, dof, value}>} args.loads
 * @param {object} args.options
 * @returns {object} similar shape to LinearTetFEM
 */
export function solveLinearStaticHex({
  mesh, material,
  fixedNodes = [], fixedDofs = [],
  loads = [],
  options = {},
}) {
  const D = buildD(material.E, material.nu);
  const numNodes = mesh.vertices.length;
  const ndof = numNodes * 3;
  const K = new SparseMatrix(ndof);
  const F = new Float64Array(ndof);

  const eCache = new Array(mesh.hexes.length);
  for (let e = 0; e < mesh.hexes.length; e++) {
    const hex = mesh.hexes[e];
    const corners = hex.map(v => mesh.vertices[v]);
    const r = elementStiffness(corners, D);
    eCache[e] = r;
    const Ke = r.Ke;
    for (let a = 0; a < 8; a++) for (let i = 0; i < 3; i++) {
      const I = hex[a] * 3 + i;
      for (let b = 0; b < 8; b++) for (let j = 0; j < 3; j++) {
        const J = hex[b] * 3 + j;
        const v = Ke[a * 3 + i][b * 3 + j];
        if (v !== 0) K.add(I, J, v);
      }
    }
  }

  for (const ld of loads) F[ld.node * 3 + ld.dof] += ld.value;

  // Symmetric row-elimination Dirichlet
  const fixedSet = new Map();
  for (const fn of fixedNodes) {
    for (let d = 0; d < 3; d++) fixedSet.set(fn * 3 + d, 0);
  }
  for (const f of fixedDofs) fixedSet.set(f.node * 3 + f.dof, f.value ?? 0);
  // Subtract column contributions
  for (const [bcDof, val] of fixedSet) {
    for (let i = 0; i < ndof; i++) {
      if (i === bcDof) continue;
      const v = K.rows[i].get(bcDof);
      if (v !== undefined && v !== 0) {
        F[i] -= v * val;
        K.rows[i].set(bcDof, 0);
      }
    }
  }
  // Zero rows + diagonal=1
  for (const [bcDof, val] of fixedSet) {
    K.rows[bcDof].clear();
    K.rows[bcDof].set(bcDof, 1);
    F[bcDof] = val;
  }

  const cg = pcg(K, F, { tol: options.tol ?? 1e-10, maxIter: options.maxIter ?? 12000 });
  const u = cg.x;

  // Stress recovery — average per element across its 8 Gauss points
  const elementStress = new Array(mesh.hexes.length);
  const elementVonMises = new Float64Array(mesh.hexes.length);
  for (let e = 0; e < mesh.hexes.length; e++) {
    const hex = mesh.hexes[e];
    const ec = eCache[e];
    const ue = new Float64Array(24);
    for (let a = 0; a < 8; a++) {
      ue[a * 3]     = u[hex[a] * 3];
      ue[a * 3 + 1] = u[hex[a] * 3 + 1];
      ue[a * 3 + 2] = u[hex[a] * 3 + 2];
    }
    // Average stress across the 8 Gauss points
    const sigAvg = [0, 0, 0, 0, 0, 0];
    for (const B of ec.Bs) {
      const eps = new Float64Array(6);
      for (let i = 0; i < 6; i++) {
        let s = 0;
        for (let j = 0; j < 24; j++) s += B[i][j] * ue[j];
        eps[i] = s;
      }
      const sig = new Float64Array(6);
      for (let i = 0; i < 6; i++) {
        let s = 0;
        for (let j = 0; j < 6; j++) s += D[i][j] * eps[j];
        sig[i] = s;
      }
      for (let i = 0; i < 6; i++) sigAvg[i] += sig[i] / ec.Bs.length;
    }
    elementStress[e] = sigAvg;
    const sx = sigAvg[0], sy = sigAvg[1], sz = sigAvg[2];
    const txy = sigAvg[3], tyz = sigAvg[4], tzx = sigAvg[5];
    elementVonMises[e] = Math.sqrt(0.5 * (
      (sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2
      + 6 * (txy * txy + tyz * tyz + tzx * tzx)
    ));
  }

  let maxDisp = 0;
  for (let i = 0; i < numNodes; i++) {
    const dx = u[i * 3], dy = u[i * 3 + 1], dz = u[i * 3 + 2];
    const m = Math.hypot(dx, dy, dz);
    if (m > maxDisp) maxDisp = m;
  }
  let maxStress = 0;
  for (const v of elementVonMises) if (v > maxStress) maxStress = v;

  return {
    displacement: u,
    elementStress, elementVonMises,
    maxDisplacement: maxDisp,
    maxStress,
    cgIterations: cg.iterations,
    cgResidual: cg.residualNorm,
    safetyFactor: material.yieldStrength ? material.yieldStrength / Math.max(maxStress, 1e-30) : null,
  };
}
