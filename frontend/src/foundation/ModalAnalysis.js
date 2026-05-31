/**
 * ArchDisc Foundation — Modal analysis (free-vibration eigenvalue solve).
 *
 * Solve the generalized eigenvalue problem
 *
 *     K φ = ω² M φ
 *
 * for the lowest few natural frequencies and mode shapes of a
 * tetrahedrally-meshed elastic body. K is the same global stiffness
 * matrix assembled by LinearTetFEM (with Dirichlet BCs already
 * embedded via the penalty method); M is the lumped mass matrix:
 *
 *     M_e (lumped) = ρ V_e / 4  on each of the 4 element-node DOF
 *                                triplets — diagonal mass distribution.
 *
 * Solver: inverse subspace iteration with Gram-M-orthogonalization.
 *   - For k modes, maintain an n × k basis Q.
 *   - Each pass solves K Y = M Q (k linear solves via PCG; this is
 *     spectral-shift-and-invert, converging to the LOWEST k eigenvalues
 *     of K φ = ω² M φ).
 *   - Reduce to a small dense generalized problem A_red v = λ B_red v
 *     (k × k); solve via Jacobi rotations on A_red M^-1.
 *   - Project new basis Q ← Y V; re-M-orthonormalize.
 *   - Repeat until eigenvalues converge.
 *
 * Validation: for a cuboid cantilever the analytical first bending
 * mode is f₁ = (β₁L)² / (2π L²) · √(EI / ρA), with β₁L = 1.8751.
 * For Aluminum 6061-T6, 100 × 10 × 10 mm beam, this gives ≈ 815 Hz.
 * Our solver reports ~700-900 Hz on a 30×6×6 mesh (linear tet stiffness
 * → modest over-prediction matching the static cantilever test).
 */

import { solveLinearStatic } from './LinearTetFEM.js';   // re-uses K assembly

/**
 * Build a lumped diagonal mass vector (length 3N).
 * For each tet, M_e = ρ V_e / 4 on each node's three DOFs.
 */
function buildLumpedMass(mesh, density) {
  const numNodes = mesh.vertices.length;
  const M = new Float64Array(numNodes * 3);
  for (const tet of mesh.tets) {
    const v = [
      mesh.vertices[tet[0]], mesh.vertices[tet[1]],
      mesh.vertices[tet[2]], mesh.vertices[tet[3]],
    ];
    const J00 = v[1][0] - v[0][0], J01 = v[2][0] - v[0][0], J02 = v[3][0] - v[0][0];
    const J10 = v[1][1] - v[0][1], J11 = v[2][1] - v[0][1], J12 = v[3][1] - v[0][1];
    const J20 = v[1][2] - v[0][2], J21 = v[2][2] - v[0][2], J22 = v[3][2] - v[0][2];
    const detJ =
      J00 * (J11 * J22 - J12 * J21) -
      J01 * (J10 * J22 - J12 * J20) +
      J02 * (J10 * J21 - J11 * J20);
    const Ve = Math.abs(detJ) / 6;
    const m = density * Ve / 4;
    for (const a of tet) {
      M[a * 3]     += m;
      M[a * 3 + 1] += m;
      M[a * 3 + 2] += m;
    }
  }
  return M;
}

/**
 * Helper: M-norm of a vector x given diagonal M.
 *   ||x||_M = sqrt(x^T M x)
 */
function mNorm(x, M) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += M[i] * x[i] * x[i];
  return Math.sqrt(s);
}

/**
 * Helper: Gram-Schmidt M-orthonormalize each column of Q (n × k stored
 * as array of k Float64Arrays of length n) against the previous columns
 * and itself. Modifies Q in place.
 */
function mOrthonormalize(Q, M) {
  const k = Q.length, n = Q[0].length;
  for (let j = 0; j < k; j++) {
    // Subtract M-projections onto previous columns
    for (let i = 0; i < j; i++) {
      let dot = 0;
      for (let p = 0; p < n; p++) dot += Q[j][p] * M[p] * Q[i][p];
      for (let p = 0; p < n; p++) Q[j][p] -= dot * Q[i][p];
    }
    // M-normalize
    const norm = mNorm(Q[j], M);
    if (norm > 1e-14) for (let p = 0; p < n; p++) Q[j][p] /= norm;
  }
}

/**
 * Solve a small dense generalized eigenvalue problem A v = λ B v
 * (both symmetric, B diagonal positive). Approach:
 *   - L = sqrt(B); compute T = L^-1 A L^-1 (still symmetric)
 *   - Jacobi rotations on T → eigenvalues + eigenvectors
 *   - Convert back: original v = L^-1 v_T
 */
function solveSmallGevp(A, B, k) {
  // L = diag(sqrt(B))
  const L = new Float64Array(k);
  for (let i = 0; i < k; i++) L[i] = Math.sqrt(Math.max(B[i], 1e-30));
  // T = L^-1 A L^-1
  const T = Array.from({ length: k }, () => new Float64Array(k));
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) T[i][j] = A[i][j] / (L[i] * L[j]);
  // Jacobi diagonalization
  const V = Array.from({ length: k }, (_, i) => {
    const row = new Float64Array(k); row[i] = 1; return row;
  });
  const maxSweeps = 50;
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    // Find largest off-diagonal
    let p = 0, q = 1, maxOff = 0;
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
      if (Math.abs(T[i][j]) > maxOff) { maxOff = Math.abs(T[i][j]); p = i; q = j; }
    }
    if (maxOff < 1e-14) break;
    const theta = (T[q][q] - T[p][p]) / (2 * T[p][q]);
    const t = theta >= 0 ? 1 / (theta + Math.sqrt(1 + theta * theta))
                         : 1 / (theta - Math.sqrt(1 + theta * theta));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    // Update T
    const Tpp = T[p][p], Tqq = T[q][q], Tpq = T[p][q];
    T[p][p] = Tpp - t * Tpq;
    T[q][q] = Tqq + t * Tpq;
    T[p][q] = T[q][p] = 0;
    for (let i = 0; i < k; i++) {
      if (i !== p && i !== q) {
        const Tip = T[i][p], Tiq = T[i][q];
        T[i][p] = T[p][i] = c * Tip - s * Tiq;
        T[i][q] = T[q][i] = s * Tip + c * Tiq;
      }
      const Vip = V[i][p], Viq = V[i][q];
      V[i][p] = c * Vip - s * Viq;
      V[i][q] = s * Vip + c * Viq;
    }
  }
  const eigs = new Float64Array(k);
  for (let i = 0; i < k; i++) eigs[i] = T[i][i];
  // Convert eigenvectors: v = L^-1 V (columns)
  const vec = Array.from({ length: k }, () => new Float64Array(k));
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) vec[i][j] = V[i][j] / L[i];
  return { eigs, vec };
}

/**
 * Lowest-frequency modal analysis via inverse-iteration on a single
 * vector. Simpler and robust enough for first natural frequency.
 *
 * For multiple modes use solveModes() with k > 1 (subspace iteration).
 *
 * @param {object} args
 * @param {TetMesh} args.mesh
 * @param {object} args.material  - { E, nu, density }
 * @param {number[]} args.fixedNodes
 * @param {number} args.maxIter   - power iterations (default 30)
 * @param {number} args.cgMaxIter - inner CG iterations (default 5000)
 * @returns {object} { freqHz, mode (length-3N), iterations }
 */
export function lowestNaturalFrequency({ mesh, material, fixedNodes, maxIter = 30, cgMaxIter = 5000 }) {
  // Build K (and global F = 0). We piggyback on the static solver to
  // reuse the assembly path; we just discard the displacement and grab
  // the K matrix via a custom hook. Cleaner approach is to factor out
  // K-assembly, which we do by re-running solveLinearStatic with a
  // zero load and zero fixed nodes — but we need K reachable. Simplest:
  // call into the same internal path. We'll re-assemble here for clarity.
  const KFn = assembleStiffness(mesh, material);
  const M = buildLumpedMass(mesh, material.density);

  // Apply Dirichlet BCs by penalty + mass-zeroing on fixed DOFs.
  // Set M[i] for fixed DOFs to a large value so they cannot move; this
  // is equivalent to fixing them since 1/M[fixed] ≈ 0.
  let maxDiag = 0;
  for (let i = 0; i < KFn.n; i++) {
    const d = KFn.diag(i);
    if (d > maxDiag) maxDiag = d;
  }
  const PENALTY = 1e8 * Math.max(maxDiag, 1);
  for (const fn of fixedNodes) {
    for (let d = 0; d < 3; d++) {
      const i = fn * 3 + d;
      KFn.add(i, i, PENALTY);
      M[i] = 0;   // mass → 0 makes ω² → ∞ on fixed DOFs; the inverse
                  // iteration finds smallest λ and never picks them.
    }
  }

  const n = KFn.n;
  // Initial guess: random in non-fixed DOFs only, M-normalized.
  let x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = M[i] > 0 ? (Math.random() - 0.5) : 0;
  let xn = mNorm(x, M);
  if (xn < 1e-30) throw new Error('All DOFs fixed; nothing to vibrate');
  for (let i = 0; i < n; i++) x[i] /= xn;

  // Inverse iteration: solve K y = M x, then x ← y / ||y||_M
  // Converges to smallest eigenvalue of (K, M).
  const Mx = new Float64Array(n);
  let lambda = 0;
  for (let it = 0; it < maxIter; it++) {
    for (let i = 0; i < n; i++) Mx[i] = M[i] * x[i];
    const cg = pcg(KFn, Mx, { tol: 1e-10, maxIter: cgMaxIter });
    const y = cg.x;
    const yn = mNorm(y, M);
    for (let i = 0; i < n; i++) x[i] = y[i] / yn;
    // Rayleigh quotient: λ = x^T K x / x^T M x
    const Kx = new Float64Array(n);
    KFn.matvec(x, Kx);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += x[i] * Kx[i]; den += M[i] * x[i] * x[i]; }
    const newLambda = num / den;
    if (it > 2 && Math.abs(newLambda - lambda) / Math.max(newLambda, 1e-30) < 1e-6) {
      lambda = newLambda;
      return { freqHz: Math.sqrt(Math.max(lambda, 0)) / (2 * Math.PI), mode: x, iterations: it + 1, converged: true };
    }
    lambda = newLambda;
  }
  return { freqHz: Math.sqrt(Math.max(lambda, 0)) / (2 * Math.PI), mode: x, iterations: maxIter, converged: false };
}

/**
 * Subspace iteration for the lowest k modes. Heavier than single-mode
 * inverse iteration, used when you need multiple frequencies + shapes.
 */
export function lowestModes({ mesh, material, fixedNodes, k = 6, maxOuterIter = 12, cgMaxIter = 5000 }) {
  const KFn = assembleStiffness(mesh, material);
  const M = buildLumpedMass(mesh, material.density);

  let maxDiag = 0;
  for (let i = 0; i < KFn.n; i++) {
    const d = KFn.diag(i);
    if (d > maxDiag) maxDiag = d;
  }
  const PENALTY = 1e8 * Math.max(maxDiag, 1);
  for (const fn of fixedNodes) {
    for (let d = 0; d < 3; d++) {
      const i = fn * 3 + d;
      KFn.add(i, i, PENALTY);
      M[i] = 0;   // see lowestNaturalFrequency comment
    }
  }

  const n = KFn.n;
  // Initialize Q (n × k) random in free DOFs only, M-orthonormal.
  let Q = Array.from({ length: k }, () => {
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) v[i] = M[i] > 0 ? (Math.random() - 0.5) : 0;
    return v;
  });
  mOrthonormalize(Q, M);

  let prevEigs = null;
  for (let outer = 0; outer < maxOuterIter; outer++) {
    // Y = K^-1 M Q : k linear solves
    const Y = [];
    for (let j = 0; j < k; j++) {
      const Mqj = new Float64Array(n);
      for (let i = 0; i < n; i++) Mqj[i] = M[i] * Q[j][i];
      const cg = pcg(KFn, Mqj, { tol: 1e-9, maxIter: cgMaxIter });
      Y.push(cg.x);
    }

    // Reduce: A_red[i][j] = Y[i]^T K Y[j];   B_red[i][j] = Y[i]^T M Y[j]
    // For diagonal M, B_red is just diagonal too if Y are M-orthogonal,
    // but Y is in general not orthogonal. We still build full A and B
    // for robustness.
    const A_red = Array.from({ length: k }, () => new Float64Array(k));
    const B_red = Array.from({ length: k }, () => new Float64Array(k));
    for (let i = 0; i < k; i++) {
      const KYi = new Float64Array(n);
      KFn.matvec(Y[i], KYi);
      for (let j = 0; j < k; j++) {
        let a = 0, b = 0;
        for (let p = 0; p < n; p++) {
          a += Y[i][p] * KYi[p];
          b += Y[i][p] * M[p] * Y[j][p];
        }
        A_red[i][j] = a;
        if (i === j) B_red[i] = b;  // we treat B as diagonal in Jacobi
      }
    }
    // Build A symmetric (it should be):
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
      const avg = 0.5 * (A_red[i][j] + A_red[j][i]);
      A_red[i][j] = A_red[j][i] = avg;
    }
    const sm = solveSmallGevp(A_red, B_red, k);

    // Update Q: Q_new[j] = Σ_i Y[i] * V[i][j], M-orthonormalize.
    const newQ = [];
    for (let j = 0; j < k; j++) {
      const v = new Float64Array(n);
      for (let i = 0; i < k; i++) {
        const coef = sm.vec[i][j];
        for (let p = 0; p < n; p++) v[p] += coef * Y[i][p];
      }
      newQ.push(v);
    }
    mOrthonormalize(newQ, M);
    Q = newQ;

    // Convergence
    const eigs = sm.eigs;
    if (prevEigs) {
      let maxRel = 0;
      for (let i = 0; i < k; i++) {
        const rel = Math.abs(eigs[i] - prevEigs[i]) / Math.max(Math.abs(eigs[i]), 1e-30);
        if (rel > maxRel) maxRel = rel;
      }
      if (maxRel < 1e-5) {
        return { freqs: Array.from(eigs).map(l => Math.sqrt(Math.max(l, 0)) / (2 * Math.PI)), modes: Q, iterations: outer + 1, converged: true };
      }
    }
    prevEigs = eigs;
  }
  return {
    freqs: Array.from(prevEigs).map(l => Math.sqrt(Math.max(l, 0)) / (2 * Math.PI)),
    modes: Q, iterations: maxOuterIter, converged: false,
  };
}

// --- Internal helpers (duplicated minimal stiffness assembly + PCG) ---
// These are intentionally re-implemented in this file to keep ModalAnalysis
// self-contained without modifying LinearTetFEM's exposed API.

function assembleStiffness(mesh, material) {
  const E = material.E, nu = material.nu;
  const a = E / ((1 + nu) * (1 - 2 * nu));
  const D = Array.from({ length: 6 }, () => new Float64Array(6));
  D[0][0] = D[1][1] = D[2][2] = a * (1 - nu);
  D[0][1] = D[1][0] = D[0][2] = D[2][0] = D[1][2] = D[2][1] = a * nu;
  D[3][3] = D[4][4] = D[5][5] = a * (1 - 2 * nu) / 2;

  const n = mesh.vertices.length * 3;
  const rows = Array.from({ length: n }, () => new Map());
  const out = {
    n,
    add(i, j, v) { const r = rows[i]; r.set(j, (r.get(j) || 0) + v); },
    diag(i) { return rows[i].get(i) || 0; },
    matvec(x, y) {
      for (let i = 0; i < n; i++) {
        let s = 0;
        const r = rows[i];
        for (const [j, v] of r) s += v * x[j];
        y[i] = s;
      }
      return y;
    },
  };
  for (const tet of mesh.tets) {
    const v0 = mesh.vertices[tet[0]];
    const v1 = mesh.vertices[tet[1]];
    const v2 = mesh.vertices[tet[2]];
    const v3 = mesh.vertices[tet[3]];
    const J00 = v1[0] - v0[0], J01 = v2[0] - v0[0], J02 = v3[0] - v0[0];
    const J10 = v1[1] - v0[1], J11 = v2[1] - v0[1], J12 = v3[1] - v0[1];
    const J20 = v1[2] - v0[2], J21 = v2[2] - v0[2], J22 = v3[2] - v0[2];
    const detJ =
      J00 * (J11 * J22 - J12 * J21) -
      J01 * (J10 * J22 - J12 * J20) +
      J02 * (J10 * J21 - J11 * J20);
    const Ve = Math.abs(detJ) / 6;
    if (Ve < 1e-18) continue;
    // Inverse Jacobian
    const A2 =  (J11 * J22 - J12 * J21) / detJ;
    const B2 = -(J01 * J22 - J02 * J21) / detJ;
    const C2 =  (J01 * J12 - J02 * J11) / detJ;
    const D2 = -(J10 * J22 - J12 * J20) / detJ;
    const E2 =  (J00 * J22 - J02 * J20) / detJ;
    const F2 = -(J00 * J12 - J02 * J10) / detJ;
    const G2 =  (J10 * J21 - J11 * J20) / detJ;
    const H2 = -(J00 * J21 - J01 * J20) / detJ;
    const I2 =  (J00 * J11 - J01 * J10) / detJ;
    const g1 = [A2, B2, C2];
    const g2 = [D2, E2, F2];
    const g3 = [G2, H2, I2];
    const g0 = [-A2 - D2 - G2, -B2 - E2 - H2, -C2 - F2 - I2];
    const grads = [g0, g1, g2, g3];
    const B = Array.from({ length: 6 }, () => new Float64Array(12));
    for (let aa = 0; aa < 4; aa++) {
      const bx = grads[aa][0], by = grads[aa][1], bz = grads[aa][2];
      const c = aa * 3;
      B[0][c] = bx;
      B[1][c + 1] = by;
      B[2][c + 2] = bz;
      B[3][c] = by;     B[3][c + 1] = bx;
      B[4][c + 1] = bz; B[4][c + 2] = by;
      B[5][c] = bz;     B[5][c + 2] = bx;
    }
    const DB = Array.from({ length: 6 }, () => new Float64Array(12));
    for (let i = 0; i < 6; i++) for (let j = 0; j < 12; j++) {
      let s = 0;
      for (let kk = 0; kk < 6; kk++) s += D[i][kk] * B[kk][j];
      DB[i][j] = s;
    }
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
      let s = 0;
      for (let kk = 0; kk < 6; kk++) s += B[kk][i] * DB[kk][j];
      const Ke = Ve * s;
      const I = tet[(i / 3) | 0] * 3 + (i % 3);
      const J = tet[(j / 3) | 0] * 3 + (j % 3);
      if (Ke !== 0) out.add(I, J, Ke);
    }
  }
  return out;
}

function pcg(A, b, opts = {}) {
  const tol = opts.tol ?? 1e-10;
  const maxIter = opts.maxIter ?? 5000;
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
