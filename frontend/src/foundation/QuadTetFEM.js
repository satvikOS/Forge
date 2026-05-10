/**
 * ArchDisc Foundation — Linear-static FEM with 10-node quadratic
 * tetrahedral elements.
 *
 * Same B^T D B machinery as the linear-tet solver, but each element
 * has 10 nodes (4 corners + 6 mid-edges) and shape functions are
 * quadratic in barycentric coordinates. Strain therefore varies
 * LINEARLY inside the element — bending mode captured cleanly.
 *
 * Shape functions in barycentric L_0 + L_1 + L_2 + L_3 = 1:
 *   Corner i:      N_i = L_i (2 L_i − 1),   i = 0..3
 *   Mid-edge a-b:  N = 4 L_a L_b
 *
 * Local node order (matches QuadraticTetMesh):
 *   0..3  corners
 *   4 = mid(0-1), 5 = mid(1-2), 6 = mid(2-0)
 *   7 = mid(0-3), 8 = mid(1-3), 9 = mid(2-3)
 *
 * 4-point Gauss integration (degree-2 exact, sufficient for the
 * quadratic-in-strain integrand B^T D B):
 *   α = (5 + 3√5) / 20 ≈ 0.585410196
 *   β = (5 − √5) / 20  ≈ 0.138196601
 *   Points (in (L_0, L_1, L_2, L_3) barycentric, dropping L_0 = 1−...):
 *     (α, β, β),  (β, α, β),  (β, β, α),  (β, β, β)   weight 1/24 each
 *   Sum of weights = 1/6 = volume of reference simplex.
 *
 * Per Gauss point:
 *   1. Compute J = ∂x/∂(L_1, L_2, L_3) using the 4 corner positions
 *      (J is constant — same as linear tet)
 *   2. Compute ∂N_i/∂(x, y, z) via chain rule:
 *        ∂L_j/∂x_k from J^-1
 *        ∂N_corner_i/∂L_i = 4 L_i − 1 (other ∂N_i/∂L_j = 0)
 *        ∂N_edge_ij/∂L_i = 4 L_j, ∂N_edge_ij/∂L_j = 4 L_i
 *   3. Build B (6 × 30)
 *   4. K_e += w · |det J| · B^T D B
 *
 * Validation: cantilever bending error drops from linear-tet's −33 %
 * (20×4×4) to under 5 % at the same node count.
 */

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
  const maxIter = opts.maxIter ?? 20000;
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

// 4-point Gauss for quadratic tet (degree 2 exact)
const ALPHA = (5 + 3 * Math.sqrt(5)) / 20;
const BETA  = (5 - Math.sqrt(5)) / 20;
// Each row is (L_1, L_2, L_3) — L_0 = 1 - (L_1 + L_2 + L_3)
const GAUSS_PTS = [
  [ALPHA, BETA,  BETA ],
  [BETA,  ALPHA, BETA ],
  [BETA,  BETA,  ALPHA],
  [BETA,  BETA,  BETA ],
];
const GAUSS_W = [1 / 24, 1 / 24, 1 / 24, 1 / 24];   // sum = 1/6 = ref-tet volume

/**
 * Compute the inverse Jacobian for a linear tet from its 4 corner
 * positions. Returns { invT, detJ } where invT is J^-T (used for
 * gradient transformations).
 */
function jacobianInvT(p0, p1, p2, p3) {
  const J00 = p1[0] - p0[0], J01 = p2[0] - p0[0], J02 = p3[0] - p0[0];
  const J10 = p1[1] - p0[1], J11 = p2[1] - p0[1], J12 = p3[1] - p0[1];
  const J20 = p1[2] - p0[2], J21 = p2[2] - p0[2], J22 = p3[2] - p0[2];
  const detJ =
    J00 * (J11 * J22 - J12 * J21) -
    J01 * (J10 * J22 - J12 * J20) +
    J02 * (J10 * J21 - J11 * J20);
  if (Math.abs(detJ) < 1e-18) return null;
  // J^-1 row vectors are gradients of L_1, L_2, L_3 in physical coords:
  //   grad L_1 = inv row 0,   grad L_2 = inv row 1,   grad L_3 = inv row 2
  // Then grad L_0 = -(grad L_1 + grad L_2 + grad L_3)
  const inv = [
    [ (J11 * J22 - J12 * J21) / detJ, -(J01 * J22 - J02 * J21) / detJ,  (J01 * J12 - J02 * J11) / detJ],
    [-(J10 * J22 - J12 * J20) / detJ,  (J00 * J22 - J02 * J20) / detJ, -(J00 * J12 - J02 * J10) / detJ],
    [ (J10 * J21 - J11 * J20) / detJ, -(J00 * J21 - J01 * J20) / detJ,  (J00 * J11 - J01 * J10) / detJ],
  ];
  // gradL[i] = ∂L_i/∂(x, y, z) for i = 0..3
  const gL = [
    [-inv[0][0] - inv[1][0] - inv[2][0], -inv[0][1] - inv[1][1] - inv[2][1], -inv[0][2] - inv[1][2] - inv[2][2]],
    [inv[0][0], inv[0][1], inv[0][2]],
    [inv[1][0], inv[1][1], inv[1][2]],
    [inv[2][0], inv[2][1], inv[2][2]],
  ];
  return { gL, detJ: Math.abs(detJ) };
}

/**
 * Compute ∂N_i/∂x for all 10 shape functions at given barycentric
 * (L0, L1, L2, L3) using physical-space gradients of L_i.
 *
 * Local-node-to-edge mapping:
 *   N_4 = 4 L_0 L_1   N_5 = 4 L_1 L_2   N_6 = 4 L_0 L_2
 *   N_7 = 4 L_0 L_3   N_8 = 4 L_1 L_3   N_9 = 4 L_2 L_3
 */
function shapeFunctionGradients(L, gL) {
  // L: [L_0, L_1, L_2, L_3] — barycentrics summing to 1
  // gL: [gL_0, gL_1, gL_2, gL_3] — each a 3-vector (grad in physical coords)
  const out = Array.from({ length: 10 }, () => [0, 0, 0]);
  // Corner nodes: ∂N_i/∂x = (4L_i - 1) ∂L_i/∂x
  for (let i = 0; i < 4; i++) {
    const factor = 4 * L[i] - 1;
    out[i][0] = factor * gL[i][0];
    out[i][1] = factor * gL[i][1];
    out[i][2] = factor * gL[i][2];
  }
  // Mid-edge nodes: N = 4 L_a L_b → ∂N/∂x = 4 (L_a ∂L_b + L_b ∂L_a)
  const EDGES = [[0, 1], [1, 2], [0, 2], [0, 3], [1, 3], [2, 3]];
  for (let m = 0; m < 6; m++) {
    const [a, b] = EDGES[m];
    const idx = 4 + m;
    out[idx][0] = 4 * (L[a] * gL[b][0] + L[b] * gL[a][0]);
    out[idx][1] = 4 * (L[a] * gL[b][1] + L[b] * gL[a][1]);
    out[idx][2] = 4 * (L[a] * gL[b][2] + L[b] * gL[a][2]);
  }
  return out;
}

/**
 * Compute element stiffness K_e (30 × 30) via 4-point Gauss
 * integration. Returns also the per-Gauss-point B matrices for stress
 * recovery.
 */
function elementStiffness(corners, D) {
  const Ke = Array.from({ length: 30 }, () => new Float64Array(30));
  const Bs = [];
  const detJs = [];
  const jac = jacobianInvT(corners[0], corners[1], corners[2], corners[3]);
  if (!jac) return null;
  const { gL, detJ } = jac;
  for (let g = 0; g < 4; g++) {
    const [L1, L2, L3] = GAUSS_PTS[g];
    const L0 = 1 - L1 - L2 - L3;
    const L = [L0, L1, L2, L3];
    const dN = shapeFunctionGradients(L, gL);
    // Build B (6 × 30)
    const B = Array.from({ length: 6 }, () => new Float64Array(30));
    for (let i = 0; i < 10; i++) {
      const bx = dN[i][0], by = dN[i][1], bz = dN[i][2];
      const c = i * 3;
      B[0][c] = bx;
      B[1][c + 1] = by;
      B[2][c + 2] = bz;
      B[3][c] = by;     B[3][c + 1] = bx;
      B[4][c + 1] = bz; B[4][c + 2] = by;
      B[5][c] = bz;     B[5][c + 2] = bx;
    }
    // DB = D · B (6 × 30)
    const DB = Array.from({ length: 6 }, () => new Float64Array(30));
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 30; j++) {
        let s = 0;
        for (let k = 0; k < 6; k++) s += D[i][k] * B[k][j];
        DB[i][j] = s;
      }
    }
    // K_e += w · detJ · B^T DB. Reference-tet volume is 1/6 and
    // weights sum to 1/6, so the integral over the physical element
    // is exactly |det J| · Σ w_g (·).
    const w = GAUSS_W[g] * detJ;
    for (let i = 0; i < 30; i++) {
      for (let j = 0; j < 30; j++) {
        let s = 0;
        for (let k = 0; k < 6; k++) s += B[k][i] * DB[k][j];
        Ke[i][j] += w * s;
      }
    }
    Bs.push(B);
    detJs.push(detJ);
  }
  return { Ke, Bs, detJs };
}

/**
 * Solve linear-static FEM on a QuadraticTetMesh.
 *
 * @param {object} args
 * @param {QuadraticTetMesh} args.mesh
 * @param {object} args.material
 * @param {number[]} args.fixedNodes - all 3 DOFs fixed
 * @param {Array<{node, dof, value}>} args.loads
 * @returns same shape as LinearTetFEM
 */
export function solveLinearStaticQuadTet({
  mesh, material,
  fixedNodes = [], fixedDofs = [], loads = [],
  options = {},
}) {
  const D = buildD(material.E, material.nu);
  const numNodes = mesh.vertices.length;
  const ndof = numNodes * 3;
  const K = new SparseMatrix(ndof);
  const F = new Float64Array(ndof);

  const eCache = new Array(mesh.tets.length);
  for (let e = 0; e < mesh.tets.length; e++) {
    const tet = mesh.tets[e];
    const corners = [
      mesh.vertices[tet[0]], mesh.vertices[tet[1]],
      mesh.vertices[tet[2]], mesh.vertices[tet[3]],
    ];
    const r = elementStiffness(corners, D);
    eCache[e] = r;
    if (!r) continue;
    const Ke = r.Ke;
    for (let a = 0; a < 10; a++) for (let i = 0; i < 3; i++) {
      const I = tet[a] * 3 + i;
      for (let b = 0; b < 10; b++) for (let j = 0; j < 3; j++) {
        const J = tet[b] * 3 + j;
        const v = Ke[a * 3 + i][b * 3 + j];
        if (v !== 0) K.add(I, J, v);
      }
    }
  }

  for (const ld of loads) F[ld.node * 3 + ld.dof] += ld.value;

  // Row-elimination Dirichlet
  const fixedSet = new Map();
  for (const fn of fixedNodes) {
    for (let d = 0; d < 3; d++) fixedSet.set(fn * 3 + d, 0);
  }
  // Per-DOF Dirichlet (lets callers fix only Z, only Y, etc.)
  for (const fd of fixedDofs) {
    fixedSet.set(fd.node * 3 + fd.dof, fd.value ?? 0);
  }
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
  for (const [bcDof, val] of fixedSet) {
    K.rows[bcDof].clear();
    K.rows[bcDof].set(bcDof, 1);
    F[bcDof] = val;
  }

  const cg = pcg(K, F, { tol: options.tol ?? 1e-10, maxIter: options.maxIter ?? 30000 });
  const u = cg.x;

  // Stress recovery — average across Gauss points per element
  const elementStress = new Array(mesh.tets.length);
  const elementVonMises = new Float64Array(mesh.tets.length);
  for (let e = 0; e < mesh.tets.length; e++) {
    const ec = eCache[e];
    if (!ec) { elementStress[e] = null; elementVonMises[e] = 0; continue; }
    const tet = mesh.tets[e];
    const ue = new Float64Array(30);
    for (let a = 0; a < 10; a++) {
      ue[a * 3]     = u[tet[a] * 3];
      ue[a * 3 + 1] = u[tet[a] * 3 + 1];
      ue[a * 3 + 2] = u[tet[a] * 3 + 2];
    }
    const sigAvg = [0, 0, 0, 0, 0, 0];
    for (const B of ec.Bs) {
      const eps = new Float64Array(6);
      for (let i = 0; i < 6; i++) {
        let s = 0;
        for (let j = 0; j < 30; j++) s += B[i][j] * ue[j];
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
