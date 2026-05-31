/**
 * ArchDisc Foundation — Linear buckling eigenvalue analysis.
 *
 * Solves the linearised buckling problem
 *
 *     (K + λ K_g) φ = 0
 *
 * where K is the standard linear-elastic stiffness and K_g is the
 * geometric stiffness from a pre-stress state. The smallest positive λ
 * is the load multiplier at which the structure first becomes unstable
 * (Euler buckling load = λ × applied reference load).
 *
 * Procedure:
 *   1. Solve linear static FEM under a reference load → u_ref
 *   2. Recover element stress σ_e from u_ref
 *   3. Build K_g_e = ∫ G^T S G dV per element (linearised initial-stress
 *      stiffness) — for a constant-strain tet with constant σ_e this
 *      reduces to V_e · G^T S G with G = nodal-shape-function gradient
 *      block (9×12).
 *   4. Assemble global K_g, apply Dirichlet rows on K AND K_g
 *   5. Solve generalised eigenproblem (K + λ K_g) φ = 0 by inverse
 *      iteration on K^-1 K_g — converges to smallest |λ|.
 *
 * Validation: a slender column under axial compression has
 *
 *     P_cr = π² E I / L_e²
 *
 * where L_e is the effective length depending on end conditions:
 *
 *     pinned-pinned:   L_e = L
 *     fixed-pinned:    L_e ≈ 0.7 L
 *     fixed-fixed:     L_e = 0.5 L
 *     fixed-free:      L_e = 2 L
 *
 * Reasonable agreement (≤ 20 %) is expected on a moderate mesh; linear
 * tetrahedral elements are stiff in bending, so they over-predict P_cr
 * by 5–25 % at typical resolutions.
 */

const PI = Math.PI;

class SparseMatrix {
  constructor(n) {
    this.n = n;
    this.rows = Array.from({ length: n }, () => new Map());
  }
  add(i, j, v) { const r = this.rows[i]; r.set(j, (r.get(j) || 0) + v); }
  get(i, j) { return this.rows[i].get(j) || 0; }
  diag(i) { return this.rows[i].get(i) || 0; }
  matvec(x, y) {
    for (let i = 0; i < this.n; i++) {
      let s = 0;
      for (const [j, v] of this.rows[i]) s += v * x[j];
      y[i] = s;
    }
    return y;
  }
  copy() {
    const out = new SparseMatrix(this.n);
    for (let i = 0; i < this.n; i++) {
      for (const [j, v] of this.rows[i]) out.add(i, j, v);
    }
    return out;
  }
}

function pcg(A, b, opts = {}) {
  const tol = opts.tol ?? 1e-10;
  const maxIter = opts.maxIter ?? 8000;
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
  let iter = 0;
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
    if (Math.sqrt(r2) / bNorm < tol) break;
    for (let i = 0; i < n; i++) z[i] = Minv[i] * r[i];
    let rzNew = 0;
    for (let i = 0; i < n; i++) rzNew += r[i] * z[i];
    const beta = rzNew / rzOld;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    rzOld = rzNew;
  }
  return { x, iterations: iter };
}

function buildD(E, nu) {
  const a = E / ((1 + nu) * (1 - 2 * nu));
  const D = Array.from({ length: 6 }, () => new Float64Array(6));
  D[0][0] = D[1][1] = D[2][2] = a * (1 - nu);
  D[0][1] = D[1][0] = D[0][2] = D[2][0] = D[1][2] = D[2][1] = a * nu;
  D[3][3] = D[4][4] = D[5][5] = a * (1 - 2 * nu) / 2;
  return D;
}

function elementBVe(v0, v1, v2, v3) {
  const J00 = v1[0] - v0[0], J01 = v2[0] - v0[0], J02 = v3[0] - v0[0];
  const J10 = v1[1] - v0[1], J11 = v2[1] - v0[1], J12 = v3[1] - v0[1];
  const J20 = v1[2] - v0[2], J21 = v2[2] - v0[2], J22 = v3[2] - v0[2];
  const detJ =
    J00 * (J11 * J22 - J12 * J21) -
    J01 * (J10 * J22 - J12 * J20) +
    J02 * (J10 * J21 - J11 * J20);
  const Ve = Math.abs(detJ) / 6;
  if (Ve < 1e-18) return null;
  const inv00 =  (J11 * J22 - J12 * J21) / detJ;
  const inv01 = -(J01 * J22 - J02 * J21) / detJ;
  const inv02 =  (J01 * J12 - J02 * J11) / detJ;
  const inv10 = -(J10 * J22 - J12 * J20) / detJ;
  const inv11 =  (J00 * J22 - J02 * J20) / detJ;
  const inv12 = -(J00 * J12 - J02 * J10) / detJ;
  const inv20 =  (J10 * J21 - J11 * J20) / detJ;
  const inv21 = -(J00 * J21 - J01 * J20) / detJ;
  const inv22 =  (J00 * J11 - J01 * J10) / detJ;
  // Per-node shape function gradients in physical space (3 components each)
  const grad0 = [-inv00 - inv10 - inv20, -inv01 - inv11 - inv21, -inv02 - inv12 - inv22];
  const grad1 = [inv00, inv01, inv02];
  const grad2 = [inv10, inv11, inv12];
  const grad3 = [inv20, inv21, inv22];
  const grads = [grad0, grad1, grad2, grad3];
  // B (6×12) stack
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
  return { B, Ve, grads };
}

/**
 * Compute element geometric stiffness K_g_e (12×12) for given σ.
 * Formulation: K_g_e[3i+α, 3j+β] = V_e · δ_αβ · (∇N_i)^T · σ · (∇N_j)
 * where σ is the 3×3 Cauchy stress tensor (built from σ-vec components).
 */
function elementGeometricStiffness(grads, sigma6, Ve) {
  // σ matrix: [[σxx, τxy, τzx], [τxy, σyy, τyz], [τzx, τyz, σzz]]
  const S = [
    [sigma6[0], sigma6[3], sigma6[5]],
    [sigma6[3], sigma6[1], sigma6[4]],
    [sigma6[5], sigma6[4], sigma6[2]],
  ];
  const Kg = Array.from({ length: 12 }, () => new Float64Array(12));
  for (let i = 0; i < 4; i++) {
    const gi = grads[i];
    for (let j = 0; j < 4; j++) {
      const gj = grads[j];
      // (∇N_i)^T · σ · (∇N_j)
      let s = 0;
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) s += gi[p] * S[p][q] * gj[q];
      const v = Ve * s;
      // Block: 3×3 identity scaled by v
      Kg[i * 3]    [j * 3]     += v;
      Kg[i * 3 + 1][j * 3 + 1] += v;
      Kg[i * 3 + 2][j * 3 + 2] += v;
    }
  }
  return Kg;
}

/**
 * Apply Dirichlet row-elimination to a sparse matrix. Same approach as
 * ThermoMechanical: zero row + column at fixed DOFs, set diagonal=1.
 */
function applyDirichletSparse(A, fixedDofs) {
  const fixedSet = new Set(fixedDofs);
  for (const i of fixedSet) {
    for (let r = 0; r < A.n; r++) {
      if (r === i) continue;
      if (A.rows[r].has(i)) A.rows[r].set(i, 0);
    }
    A.rows[i].clear();
    A.rows[i].set(i, 1);
  }
}
function applyDirichletKg(Kg, fixedDofs) {
  // For K_g we set rows + columns at fixed DOFs to 0 (no eigenvalue
  // contribution) — diagonal 0 because K_g is not SPD; the K diagonal=1
  // from above ensures the eigenvalue at fixed DOFs is +∞ which the
  // inverse-iteration ignores.
  const fixedSet = new Set(fixedDofs);
  for (const i of fixedSet) {
    for (let r = 0; r < Kg.n; r++) {
      if (Kg.rows[r].has(i)) Kg.rows[r].set(i, 0);
    }
    Kg.rows[i].clear();
  }
}

/**
 * Run linear buckling analysis.
 *
 * @param {object} args
 * @param {TetMesh} args.mesh
 * @param {object} args.material  - { E, nu }
 * @param {Array<{node, dof, value?}>} args.fixedDofs - per-DOF Dirichlet
 * @param {Array<{node, dof, value}>} args.referenceLoads - applied as
 *   the reference load case for the static pre-stress solve. Buckling
 *   load = λ_min × ‖referenceLoads‖.
 * @param {object} args.options
 * @returns {{ lambda, criticalLoadScale, mode, iterations }}
 */
export function solveBuckling({
  mesh, material, fixedDofs, referenceLoads,
  options = {},
}) {
  const numNodes = mesh.vertices.length;
  const ndof = numNodes * 3;
  const D = buildD(material.E, material.nu);

  // ---- 1: assemble K + reference load F_ref ----
  const K = new SparseMatrix(ndof);
  const Fref = new Float64Array(ndof);
  const eCache = new Array(mesh.tets.length);
  for (let e = 0; e < mesh.tets.length; e++) {
    const tet = mesh.tets[e];
    const v = [
      mesh.vertices[tet[0]], mesh.vertices[tet[1]],
      mesh.vertices[tet[2]], mesh.vertices[tet[3]],
    ];
    const r = elementBVe(v[0], v[1], v[2], v[3]);
    if (!r) { eCache[e] = null; continue; }
    eCache[e] = r;
    const { B, Ve } = r;
    const DB = Array.from({ length: 6 }, () => new Float64Array(12));
    for (let i = 0; i < 6; i++) for (let j = 0; j < 12; j++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += D[i][k] * B[k][j];
      DB[i][j] = s;
    }
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += B[k][i] * DB[k][j];
      const Ke = Ve * s;
      const I = tet[(i / 3) | 0] * 3 + (i % 3);
      const J = tet[(j / 3) | 0] * 3 + (j % 3);
      if (Ke !== 0) K.add(I, J, Ke);
    }
  }
  for (const ld of referenceLoads) Fref[ld.node * 3 + ld.dof] += ld.value;

  // Apply Dirichlet (per-DOF)
  const fixedSet = new Map();
  for (const f of fixedDofs) fixedSet.set(f.node * 3 + f.dof, f.value ?? 0);
  // Subtract column contributions, zero columns
  for (const [bcDof, val] of fixedSet) {
    for (let i = 0; i < ndof; i++) {
      if (i === bcDof) continue;
      const v = K.rows[i].get(bcDof);
      if (v !== undefined && v !== 0) {
        Fref[i] -= v * val;
        K.rows[i].set(bcDof, 0);
      }
    }
  }
  for (const [bcDof, val] of fixedSet) {
    K.rows[bcDof].clear();
    K.rows[bcDof].set(bcDof, 1);
    Fref[bcDof] = val;
  }

  // ---- 2: solve K u = F_ref ----
  const cgStatic = pcg(K, Fref, { tol: 1e-10, maxIter: 12000 });
  const u = cgStatic.x;

  // ---- 3: recover σ_e per element ----
  const sigmas = new Array(mesh.tets.length);
  for (let e = 0; e < mesh.tets.length; e++) {
    const ec = eCache[e];
    if (!ec) { sigmas[e] = null; continue; }
    const tet = mesh.tets[e];
    const ue = new Float64Array(12);
    for (let a = 0; a < 4; a++) {
      ue[a * 3]     = u[tet[a] * 3];
      ue[a * 3 + 1] = u[tet[a] * 3 + 1];
      ue[a * 3 + 2] = u[tet[a] * 3 + 2];
    }
    const eps = new Float64Array(6);
    for (let i = 0; i < 6; i++) {
      let s = 0;
      for (let j = 0; j < 12; j++) s += ec.B[i][j] * ue[j];
      eps[i] = s;
    }
    const sig = new Float64Array(6);
    for (let i = 0; i < 6; i++) {
      let s = 0;
      for (let j = 0; j < 6; j++) s += D[i][j] * eps[j];
      sig[i] = s;
    }
    sigmas[e] = sig;
  }

  // ---- 4: assemble K_g ----
  const Kg = new SparseMatrix(ndof);
  for (let e = 0; e < mesh.tets.length; e++) {
    const ec = eCache[e];
    const sig = sigmas[e];
    if (!ec || !sig) continue;
    const Kge = elementGeometricStiffness(ec.grads, sig, ec.Ve);
    const tet = mesh.tets[e];
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
      const v = Kge[i][j];
      if (v !== 0) {
        const I = tet[(i / 3) | 0] * 3 + (i % 3);
        const J = tet[(j / 3) | 0] * 3 + (j % 3);
        Kg.add(I, J, v);
      }
    }
  }
  applyDirichletKg(Kg, Array.from(fixedSet.keys()));

  // K already has Dirichlet applied above — but we cleared rows AND
  // columns of K_g, so the constrained DOFs see K[i][i]=1, K_g[i][i]=0
  // ⇒ eigenvalue at those rows is undefined. To safely run inverse
  // iteration on (K + λ K_g) we need to mask those DOFs. We use the
  // "active" subspace of free DOFs only.
  const free = [];
  const isFree = new Uint8Array(ndof);
  for (let i = 0; i < ndof; i++) {
    if (!fixedSet.has(i)) { free.push(i); isFree[i] = 1; }
  }

  // ---- 5: inverse iteration on K^-1 (-K_g) → largest eigenvalue ----
  // We solve (K + λ K_g) φ = 0 ⇔ K φ = −λ K_g φ. Power iteration on
  // K^-1 (-K_g) converges to the eigenvalue with LARGEST absolute
  // 1/|λ|, i.e. SMALLEST |λ|. For compressive pre-stress σ < 0, K_g
  // is negative-definite, so −K_g is positive-definite and λ comes
  // out positive, equal to the buckling load multiplier.
  let phi = new Float64Array(ndof);
  for (const i of free) phi[i] = Math.random() - 0.5;
  // Normalize w.r.t. K
  function kPhiPhi(phi) {
    const Kphi = new Float64Array(ndof);
    K.matvec(phi, Kphi);
    let s = 0;
    for (let i = 0; i < ndof; i++) s += phi[i] * Kphi[i];
    return s;
  }
  function kgPhiPhi(phi) {
    const Kgphi = new Float64Array(ndof);
    Kg.matvec(phi, Kgphi);
    let s = 0;
    for (let i = 0; i < ndof; i++) s += phi[i] * Kgphi[i];
    return s;
  }
  const norm = kPhiPhi(phi);
  if (norm > 0) for (let i = 0; i < ndof; i++) phi[i] /= Math.sqrt(norm);

  const maxIter = options.maxIter ?? 50;
  let lambda = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    // RHS = -K_g φ
    const Kgphi = new Float64Array(ndof);
    Kg.matvec(phi, Kgphi);
    const rhs = new Float64Array(ndof);
    for (let i = 0; i < ndof; i++) rhs[i] = -Kgphi[i];
    // Zero out fixed DOFs
    for (const [i] of fixedSet) rhs[i] = 0;
    // Solve K y = rhs
    const cg = pcg(K, rhs, { tol: 1e-10, maxIter: 8000 });
    let y = cg.x;
    // Zero fixed DOFs in y as well
    for (const [i] of fixedSet) y[i] = 0;
    // Rayleigh quotient: λ = (y · K y) / (y · -K_g y)... actually
    // for the form K φ = −λ K_g φ with iterate y = K^-1 (-K_g) φ:
    //   λ ≈ (φ · K y) / (φ · y)   isn't quite right.
    // Cleaner: λ = (y · K y) / (y · −K_g y), evaluated at the new y.
    const num = kPhiPhi(y);
    const den = -kgPhiPhi(y);
    if (Math.abs(den) < 1e-30) break;
    const newLambda = num / den;
    // Normalize
    const yn = Math.sqrt(Math.abs(num));
    if (yn > 0) for (let i = 0; i < ndof; i++) y[i] /= yn;
    phi = y;
    if (iter > 2 && Math.abs(newLambda - lambda) / Math.max(Math.abs(newLambda), 1e-30) < 1e-5) {
      lambda = newLambda;
      return {
        lambda,
        criticalLoadScale: lambda,
        mode: phi,
        iterations: iter + 1,
        converged: true,
        cgInner: cg.iterations,
      };
    }
    lambda = newLambda;
  }
  return {
    lambda,
    criticalLoadScale: lambda,
    mode: phi,
    iterations: maxIter,
    converged: false,
  };
}
