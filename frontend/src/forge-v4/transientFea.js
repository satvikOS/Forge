// PUSH-222 (Slice-158) — Real Transient Dynamics FEA (Newmark-β).
//
// A from-scratch, dependency-free JS implementation of the canonical
// implicit Newmark-β time integration scheme for second-order linear
// structural dynamics:
//
//     M · ü + C · u̇ + K · u = f(t)
//
// Theory — Newmark 1959 ("A method of computation for structural
// dynamics", ASCE J. Eng. Mech. Div.). Uses the parameter pair (β, γ).
// The "average-acceleration" choice (γ = 1/2, β = 1/4) is unconditionally
// stable for linear systems regardless of dt. Other useful pairs:
//
//     γ = 1/2,  β = 1/4   → average acceleration (default, A-stable)
//     γ = 1/2,  β = 1/6   → linear acceleration (conditionally stable)
//     γ = 1/2,  β = 0     → central difference (explicit, conditional)
//
// Algorithm — one step n → n+1 with timestep dt:
//
//   Predictor (with current state u_n, u̇_n, ü_n):
//       ũ_{n+1}  = u_n + dt·u̇_n + (1/2 − β)·dt²·ü_n
//       ũ̇_{n+1}  = u̇_n + (1 − γ)·dt·ü_n
//
//   Effective stiffness (constant if M, C, K are constant):
//       K_eff = K + (γ/(β·dt))·C + (1/(β·dt²))·M
//
//   Effective load:
//       f_eff = f_{n+1}
//             + M · [ (1/(β·dt²))·u_n + (1/(β·dt))·u̇_n + (1/(2β) − 1)·ü_n ]
//             + C · [ (γ/(β·dt))·u_n + (γ/β − 1)·u̇_n
//                     + dt·(γ/(2β) − 1)·ü_n ]
//
//   Linear solve:
//       K_eff · u_{n+1} = f_eff      (direct LU on dense N×N)
//
//   Corrector:
//       ü_{n+1} = (1/(β·dt²))·(u_{n+1} − u_n) − (1/(β·dt))·u̇_n
//                                              − (1/(2β) − 1)·ü_n
//       u̇_{n+1} = u̇_n + dt·[(1 − γ)·ü_n + γ·ü_{n+1}]
//
// Rayleigh damping — C = α·M + β_R·K where α (mass-prop.) and β_R
// (stiff-prop.) are user-supplied. The convention `β_R` is needed
// because the integrator already owns the symbol β.
//
// Initial acceleration — given u_0 and u̇_0, the equilibrium at t = 0
// gives M · ü_0 = f(0) − C · u̇_0 − K · u_0, which we solve once.
//
// Element library — small canonical truss / spring catalogue, fully
// pure functions. Each `element` specifies its node indices and the
// physical scalars needed for its local K and M:
//
//     spring1d   : { type: 'spring1d', a, b, k }
//                  one-DOF-per-node lateral spring.
//                  Local K = [[k,-k],[-k,k]], Local M = [[m/2,0],[0,m/2]]
//                  with element nodal mass m supplied separately on the
//                  node descriptor.
//
//     truss3d    : { type: 'truss3d', a, b, E, A, rho }
//                  3-DOF-per-node axial-only bar in 3D. Standard
//                  rotation-by-direction-cosines formulation.
//
// The solver doesn't care which element you pick — assembleK + assembleM
// walk a uniform `{ldof, kLocal, mLocal}` interface.
//
// Hard constraints (PUSH-222 brief)
// ---------------------------------
//   * NO new npm / C++ deps.
//   * Real Newmark math per the 1959 paper. No Euler-only fallback.
//   * Effective stiffness EXACTLY  K_eff = K + (γ/(β·dt))·C + (1/(β·dt²))·M.
//   * Direct LU on dense matrices — fast enough for the small canonical
//     problems we exercise (SDOF, 5-DOF chain, etc.). CG kept as a
//     fallback for larger systems.
//
// All exports are plain functions; the panel + the e2e drive them
// headlessly through window.__forgeTransientFeaHelper.

'use strict';

// ─────────────────────────────────────────────────────────────────────
// Defaults.

export const TRANSIENT_DEFAULTS = Object.freeze({
  BETA:   0.25,   // average acceleration (A-stable)
  GAMMA:  0.50,
  DT:     0.01,
  T_END:  2.0,
  ALPHA_RAYLEIGH: 0.0,
  BETA_RAYLEIGH:  0.0,
  CG_MAX_ITER: 2000,
  CG_TOL:      1e-10,
});

export const LOAD_TYPES = Object.freeze({
  IMPULSE:   'impulse',
  SINE:      'sinusoidal',
  STEP:      'step',
  ZERO:      'zero',
});

// ─────────────────────────────────────────────────────────────────────
// Dense matrix helpers — plain Float64Array stored row-major (n × n).

export function zeros(n) {
  return new Float64Array(n);
}

export function zerosMatrix(n) {
  return new Float64Array(n * n);
}

export function matIdx(n, i, j) { return i * n + j; }

export function copyVec(src) {
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i];
  return out;
}

export function addVec(a, b) {
  const n = a.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] + b[i];
  return out;
}

export function scaleVec(v, s) {
  const n = v.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = v[i] * s;
  return out;
}

export function dot(a, b) {
  const n = a.length;
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/**
 * matVec — dense matrix · vector, with n = √M.length.
 */
export function matVec(M, x) {
  const n = x.length;
  if (M.length !== n * n) {
    throw new Error(`matVec dimension mismatch: M=${M.length} x=${n}`);
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const row = i * n;
    for (let j = 0; j < n; j++) s += M[row + j] * x[j];
    y[i] = s;
  }
  return y;
}

/**
 * addMat — C = A + s · B, both dense n × n.
 */
export function addMatScaled(A, B, s) {
  const n = A.length;
  if (B.length !== n) {
    throw new Error(`addMatScaled dimension mismatch: A=${n} B=${B.length}`);
  }
  const C = new Float64Array(n);
  for (let i = 0; i < n; i++) C[i] = A[i] + s * B[i];
  return C;
}

// ─────────────────────────────────────────────────────────────────────
// Dense LU with partial pivoting — Doolittle factorisation.
// Returns { LU, piv } where LU is the in-place factorisation and
// piv[i] is the row swapped to row i. Throws on singular matrix.

export function luDecompose(A0) {
  const n = Math.round(Math.sqrt(A0.length));
  if (n * n !== A0.length) {
    throw new Error(`luDecompose: matrix not square (length ${A0.length})`);
  }
  const LU = new Float64Array(A0);
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;

  for (let k = 0; k < n; k++) {
    // pivot — find row with largest |LU[r,k]| among r ≥ k
    let maxAbs = Math.abs(LU[k * n + k]);
    let pivRow = k;
    for (let r = k + 1; r < n; r++) {
      const v = Math.abs(LU[r * n + k]);
      if (v > maxAbs) { maxAbs = v; pivRow = r; }
    }
    if (maxAbs < 1e-300) {
      throw new Error(`luDecompose: matrix singular at pivot ${k}`);
    }
    if (pivRow !== k) {
      // swap rows k and pivRow
      for (let j = 0; j < n; j++) {
        const tmp = LU[k * n + j];
        LU[k * n + j] = LU[pivRow * n + j];
        LU[pivRow * n + j] = tmp;
      }
      const tmpP = piv[k]; piv[k] = piv[pivRow]; piv[pivRow] = tmpP;
    }
    // eliminate
    const akk = LU[k * n + k];
    for (let r = k + 1; r < n; r++) {
      const m = LU[r * n + k] / akk;
      LU[r * n + k] = m;
      for (let j = k + 1; j < n; j++) {
        LU[r * n + j] -= m * LU[k * n + j];
      }
    }
  }
  return { LU, piv, n };
}

export function luSolve(luPack, b) {
  const { LU, piv, n } = luPack;
  if (b.length !== n) {
    throw new Error(`luSolve dim mismatch: b=${b.length} expected ${n}`);
  }
  // Apply pivot permutation: y = P · b
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = b[piv[i]];
  // Forward solve L · z = y  (L has unit diagonal)
  for (let i = 0; i < n; i++) {
    let s = y[i];
    const row = i * n;
    for (let j = 0; j < i; j++) s -= LU[row + j] * y[j];
    y[i] = s;
  }
  // Back solve U · x = z
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    const row = i * n;
    for (let j = i + 1; j < n; j++) s -= LU[row + j] * x[j];
    x[i] = s / LU[row + i];
  }
  return x;
}

/**
 * conjugateGradient — fallback for symmetric positive-definite systems
 * when the user picks 'cg' over the default direct LU. The Newmark
 * effective stiffness is SPD when M, C, K all are (Rayleigh damping
 * preserves SPD-ness of the combination for β > 0).
 */
export function conjugateGradient(A, b, opts = {}) {
  const maxIter = opts.maxIter ?? TRANSIENT_DEFAULTS.CG_MAX_ITER;
  const tol     = opts.tol     ?? TRANSIENT_DEFAULTS.CG_TOL;
  const n = b.length;
  const x = new Float64Array(n);  // x0 = 0
  const r = copyVec(b);
  const p = copyVec(r);
  let rsOld = dot(r, r);
  const bNorm = Math.sqrt(dot(b, b));
  if (bNorm === 0) return { x, iters: 0, residual: 0 };
  let iters = 0;
  for (let k = 0; k < maxIter; k++) {
    const Ap = matVec(A, p);
    const denom = dot(p, Ap);
    if (denom === 0) break;
    const alpha = rsOld / denom;
    for (let i = 0; i < n; i++) x[i] += alpha * p[i];
    for (let i = 0; i < n; i++) r[i] -= alpha * Ap[i];
    const rsNew = dot(r, r);
    iters = k + 1;
    if (Math.sqrt(rsNew) / bNorm < tol) break;
    const ratio = rsNew / rsOld;
    for (let i = 0; i < n; i++) p[i] = r[i] + ratio * p[i];
    rsOld = rsNew;
  }
  return { x, iters, residual: Math.sqrt(rsOld) };
}

// ─────────────────────────────────────────────────────────────────────
// Element library.

/**
 * Local stiffness + mass of a 1D linear spring element with one DOF
 * per node (1 DOF total per node × 2 nodes = 2 DOFs total).
 *
 *   K_local = k · [[ 1, -1], [-1,  1]]
 *   M_local = m · [[ 1/3, 1/6], [1/6, 1/3]]   consistent mass (line element)
 *
 * where k is the element stiffness and m is the element mass. If the
 * element supplies a `mass_node_a` / `mass_node_b` then the lumped
 * variant is used instead.
 */
export function spring1dLocal(elem) {
  const k = Number(elem.k);
  if (!Number.isFinite(k) || k <= 0) {
    throw new Error(`spring1d: bad k = ${elem.k}`);
  }
  const kLoc = new Float64Array([k, -k, -k, k]);
  let mLoc;
  if (Number.isFinite(elem.mLumpedA) && Number.isFinite(elem.mLumpedB)) {
    // Lumped diagonal mass for spring/SDOF demos.
    mLoc = new Float64Array([elem.mLumpedA, 0, 0, elem.mLumpedB]);
  } else if (Number.isFinite(elem.m) && elem.m > 0) {
    const m = elem.m;
    mLoc = new Float64Array([m / 3, m / 6, m / 6, m / 3]);
  } else {
    mLoc = new Float64Array([0, 0, 0, 0]);
  }
  return {
    ldof: 2,
    nodes: [elem.a, elem.b],
    dofsPerNode: 1,
    kLocal: kLoc,
    mLocal: mLoc,
  };
}

/**
 * 3D axial-only truss bar.
 *
 *   Length L, direction cosines (l, m, n) = (Δx/L, Δy/L, Δz/L).
 *   T = [[l, m, n, 0, 0, 0],
 *        [0, 0, 0, l, m, n]]
 *
 *   k_axial = (E·A / L) · [[ 1, -1], [-1,  1]]
 *   K_local = Tᵀ · k_axial · T                (6 × 6)
 *
 *   m_axial = (ρ·A·L) · [[ 1/3, 1/6], [1/6, 1/3]]   consistent
 *   M_local = Tᵀ · m_axial · T (lumped per direction)
 *
 * For simplicity we use the consistent axial mass projected onto each
 * coordinate axis — equivalent to ρAL/2 lumped at each end's three
 * translational DOFs.
 */
export function truss3dLocal(elem, nodes) {
  const na = nodes[elem.a], nb = nodes[elem.b];
  const dx = nb.position[0] - na.position[0];
  const dy = nb.position[1] - na.position[1];
  const dz = nb.position[2] - na.position[2];
  const L  = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (L <= 0) {
    throw new Error(`truss3d: zero-length element ${elem.a}-${elem.b}`);
  }
  const E = Number(elem.E), A = Number(elem.A);
  const rho = Number(elem.rho) || 0;
  if (!Number.isFinite(E) || E <= 0) throw new Error(`truss3d: bad E=${E}`);
  if (!Number.isFinite(A) || A <= 0) throw new Error(`truss3d: bad A=${A}`);
  const l = dx / L, mD = dy / L, n_ = dz / L;
  const c = (E * A) / L;
  // K_local = c · Tᵀ T-axial; the 6×6 result has the standard pattern
  //   [ ll  lm  ln | -ll -lm -ln
  //     lm  mm  mn | -lm -mm -mn
  //     ln  mn  nn | -ln -mn -nn
  //     ----------+-----------
  //    -ll -lm -ln |  ll  lm  ln
  //     ... ]   (× c)
  const kBlk = [
    l * l,  l * mD, l * n_,
    l * mD, mD * mD, mD * n_,
    l * n_, mD * n_, n_ * n_,
  ];
  const K = new Float64Array(36);
  // top-left
  K[0*6+0] = c * kBlk[0]; K[0*6+1] = c * kBlk[1]; K[0*6+2] = c * kBlk[2];
  K[1*6+0] = c * kBlk[1]; K[1*6+1] = c * kBlk[4]; K[1*6+2] = c * kBlk[5];
  K[2*6+0] = c * kBlk[2]; K[2*6+1] = c * kBlk[5]; K[2*6+2] = c * kBlk[8];
  // top-right = − top-left
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const v = -K[i * 6 + j];
      K[i * 6 + (j + 3)] = v;
      K[(i + 3) * 6 + j] = v;
      K[(i + 3) * 6 + (j + 3)] = -v;
    }
  }
  // consistent mass — distribute ρAL/2 to each translational DOF on
  // either end (lumped diagonal — typical for transient FEA).
  let mLoc;
  if (rho > 0) {
    const mNode = (rho * A * L) / 2;
    mLoc = new Float64Array(36);
    for (let d = 0; d < 3; d++) {
      mLoc[d * 6 + d] = mNode;
      mLoc[(d + 3) * 6 + (d + 3)] = mNode;
    }
  } else {
    mLoc = new Float64Array(36);
  }
  return {
    ldof: 6,
    nodes: [elem.a, elem.b],
    dofsPerNode: 3,
    kLocal: K,
    mLocal: mLoc,
    length: L,
  };
}

/**
 * Discriminate + dispatch a raw `elements` array spec.
 *
 * Each element must have `.type` ∈ {'spring1d', 'truss3d'}.
 * Returns an array of local descriptors with kLocal + mLocal.
 */
export function localiseElements(elements, nodes) {
  const out = [];
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i];
    if (!e || !e.type) {
      throw new Error(`element ${i}: missing .type`);
    }
    switch (e.type) {
      case 'spring1d': out.push(spring1dLocal(e)); break;
      case 'truss3d':  out.push(truss3dLocal(e, nodes)); break;
      default:
        throw new Error(`element ${i}: unknown type '${e.type}'`);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Assembly.
//
// `nodes` is an array describing each node. Each node carries
//   {
//     position: [x, y, z],          // optional, required for truss3d
//     dofs:     number,              // 1 for spring1d, 3 for truss3d
//     fixed:    [boolean]            // optional Dirichlet BC per DOF
//     mass:     number               // optional concentrated nodal mass
//                                    // (added to lumped diagonal of M)
//   }
//
// All elements in the model must use the same `dofsPerNode` (so the
// global DOF index of node i is i·dofsPerNode + d). We don't mix
// truss3d and spring1d in a single problem here — that's a future
// extension and not needed for the canonical validation cases.

export function totalDofs(nodes, dofsPerNode) {
  return nodes.length * dofsPerNode;
}

/**
 * assembleK — assemble a global stiffness matrix from a list of
 * element local stiffnesses produced by localiseElements().
 *
 * Returns a dense Float64Array of length N² where N = totalDofs.
 */
export function assembleK(elements, nodes, opts = {}) {
  const dofsPerNode = opts.dofsPerNode
    ?? (elements[0]?.dofsPerNode)
    ?? 1;
  const N = totalDofs(nodes, dofsPerNode);
  const K = new Float64Array(N * N);
  for (const e of elements) {
    const ldof = e.ldof;
    const dofMap = new Int32Array(ldof);
    let p = 0;
    for (const nid of e.nodes) {
      for (let d = 0; d < e.dofsPerNode; d++) {
        dofMap[p++] = nid * dofsPerNode + d;
      }
    }
    for (let i = 0; i < ldof; i++) {
      const gi = dofMap[i];
      for (let j = 0; j < ldof; j++) {
        const gj = dofMap[j];
        K[gi * N + gj] += e.kLocal[i * ldof + j];
      }
    }
  }
  return { K, N, dofsPerNode };
}

/**
 * assembleMass — assemble a global mass matrix.
 *
 * Optionally adds per-node concentrated masses from `nodes[i].mass`
 * (lumped diagonally onto every translational DOF of that node).
 */
export function assembleMass(elements, nodes, opts = {}) {
  const dofsPerNode = opts.dofsPerNode
    ?? (elements[0]?.dofsPerNode)
    ?? 1;
  const lumped = opts.lumped !== false; // default to lumped — standard
                                         // for transient FEA
  const N = totalDofs(nodes, dofsPerNode);
  const M = new Float64Array(N * N);
  for (const e of elements) {
    const ldof = e.ldof;
    const dofMap = new Int32Array(ldof);
    let p = 0;
    for (const nid of e.nodes) {
      for (let d = 0; d < e.dofsPerNode; d++) {
        dofMap[p++] = nid * dofsPerNode + d;
      }
    }
    for (let i = 0; i < ldof; i++) {
      const gi = dofMap[i];
      if (lumped) {
        // HRZ / row-sum lumping: each diagonal entry takes the row sum
        // of the consistent local mass. For our truss3d the consistent
        // mass is already diagonal so this is exact.
        let rowSum = 0;
        for (let j = 0; j < ldof; j++) {
          rowSum += e.mLocal[i * ldof + j];
        }
        M[gi * N + gi] += rowSum;
      } else {
        for (let j = 0; j < ldof; j++) {
          const gj = dofMap[j];
          M[gi * N + gj] += e.mLocal[i * ldof + j];
        }
      }
    }
  }
  // Add concentrated nodal masses.
  for (let nid = 0; nid < nodes.length; nid++) {
    const m = nodes[nid]?.mass;
    if (Number.isFinite(m) && m > 0) {
      for (let d = 0; d < dofsPerNode; d++) {
        const gi = nid * dofsPerNode + d;
        M[gi * N + gi] += m;
      }
    }
  }
  return { M, N, dofsPerNode };
}

/**
 * assembleC — Rayleigh damping  C = α · M + β_R · K.
 *
 * The convention `β_R` (the second Rayleigh coefficient) avoids
 * collision with the Newmark β. UI labels: "Rayleigh α / Rayleigh β".
 */
export function assembleC(M, K, alpha, betaR) {
  if (M.length !== K.length) {
    throw new Error(`assembleC: M, K size mismatch (${M.length} vs ${K.length})`);
  }
  const C = new Float64Array(M.length);
  for (let i = 0; i < M.length; i++) {
    C[i] = alpha * M[i] + betaR * K[i];
  }
  return C;
}

// ─────────────────────────────────────────────────────────────────────
// Dirichlet BC application.
//
// We zero rows + columns of the fixed DOFs and put 1 on the diagonal,
// and zero the corresponding entries of the load vector. This is the
// classic "penalty-free" approach for known-zero Dirichlet BCs.
//
// Returns a Uint8Array fixedMask where fixedMask[i] = 1 if DOF i is
// constrained.

export function buildFixedMask(nodes, dofsPerNode) {
  const N = totalDofs(nodes, dofsPerNode);
  const mask = new Uint8Array(N);
  for (let nid = 0; nid < nodes.length; nid++) {
    const fxd = nodes[nid]?.fixed;
    if (!fxd) continue;
    for (let d = 0; d < dofsPerNode; d++) {
      if (fxd[d]) mask[nid * dofsPerNode + d] = 1;
    }
  }
  return mask;
}

/**
 * applyDirichletInPlace — modify K_eff and f_eff to enforce u_i = 0
 * on every fixed DOF. Standard zero-row + zero-col + 1-on-diagonal.
 */
export function applyDirichletInPlace(Keff, fEff, mask) {
  const N = mask.length;
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    // Zero row i
    for (let j = 0; j < N; j++) Keff[i * N + j] = 0;
    // Zero column i
    for (let j = 0; j < N; j++) Keff[j * N + i] = 0;
    Keff[i * N + i] = 1;
    fEff[i] = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Newmark-β single step.
//
//   inputs:  M, C, K  (dense, N × N)
//            u, udot, uddot   (Float64Array length N — state at t_n)
//            fNext           (Float64Array length N — load at t_{n+1})
//            dt, beta, gamma  (scalars)
//            opts.solver     'lu' (default) | 'cg'
//            opts.fixedMask  Uint8Array length N — Dirichlet DOFs
//
//   output:  { uNext, udotNext, uddotNext, iters?, residual?, KeffPack? }

export function newmarkStep(M, C, K, u, udot, uddot, fNext, dt, beta, gamma, opts = {}) {
  const N = u.length;
  if (dt <= 0) throw new Error(`newmarkStep: dt must be > 0 (got ${dt})`);
  if (beta < 0)  throw new Error(`newmarkStep: β must be ≥ 0 (got ${beta})`);
  if (gamma < 0) throw new Error(`newmarkStep: γ must be ≥ 0 (got ${gamma})`);

  // K_eff = K + (γ/(β·dt))·C + (1/(β·dt²))·M
  const cM = 1 / (beta * dt * dt);
  const cC = gamma / (beta * dt);
  const Keff = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) {
    Keff[i] = K[i] + cC * C[i] + cM * M[i];
  }

  // f_eff = f_{n+1} + M·a_M + C·a_C
  //   where
  //   a_M = (1/(β·dt²))·u + (1/(β·dt))·u̇ + (1/(2β) − 1)·ü
  //   a_C = (γ/(β·dt))·u + (γ/β − 1)·u̇ + dt·(γ/(2β) − 1)·ü
  const c1 = 1 / (beta * dt);              // for u̇ in a_M
  const c2 = (1 / (2 * beta)) - 1;         // for ü in a_M
  const c3 = (gamma / beta) - 1;           // for u̇ in a_C
  const c4 = dt * ((gamma / (2 * beta)) - 1);  // for ü in a_C
  const aM = new Float64Array(N);
  const aC = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    aM[i] = cM * u[i] + c1 * udot[i] + c2 * uddot[i];
    aC[i] = cC * u[i] + c3 * udot[i] + c4 * uddot[i];
  }
  const MaM = matVec(M, aM);
  const CaC = matVec(C, aC);
  const fEff = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    fEff[i] = fNext[i] + MaM[i] + CaC[i];
  }

  // Dirichlet — zero rows + cols and place 1 on diagonal so that the
  // linear solver returns u_i = 0 on constrained DOFs.
  if (opts.fixedMask && opts.fixedMask.length === N) {
    applyDirichletInPlace(Keff, fEff, opts.fixedMask);
  }

  // Linear solve K_eff · u_{n+1} = f_eff
  const solver = opts.solver || 'lu';
  let uNext, solveInfo = null;
  if (solver === 'cg') {
    const r = conjugateGradient(Keff, fEff, opts.cg || {});
    uNext = r.x;
    solveInfo = { iters: r.iters, residual: r.residual };
  } else {
    const pack = luDecompose(Keff);
    uNext = luSolve(pack, fEff);
    solveInfo = { iters: N, residual: 0 };
  }

  // Corrector
  //   ü_{n+1} = (1/(β·dt²))·(u_{n+1} − u_n) − (1/(β·dt))·u̇_n − (1/(2β) − 1)·ü_n
  //   u̇_{n+1} = u̇_n + dt·[ (1 − γ)·ü_n + γ·ü_{n+1} ]
  const uddotNext = new Float64Array(N);
  const udotNext  = new Float64Array(N);
  const dt2_inv = 1 / (beta * dt * dt);
  const dt_inv  = 1 / (beta * dt);
  const oneMinusGamma = 1 - gamma;
  for (let i = 0; i < N; i++) {
    uddotNext[i] = dt2_inv * (uNext[i] - u[i])
                 - dt_inv * udot[i]
                 - c2 * uddot[i];
    udotNext[i]  = udot[i] + dt * (oneMinusGamma * uddot[i] + gamma * uddotNext[i]);
  }

  return {
    uNext, udotNext, uddotNext,
    solveInfo,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Load-function helpers — pure functions of time.
//
// Each returns a Float64Array of length N for a given time t.

export function makeLoadFn(loadType, opts) {
  const N = opts.N | 0;
  const dof = opts.dof | 0;          // DOF index where the load is applied
  const amp = Number(opts.amplitude) || 0;
  const omega = Number(opts.omega) || 0;
  const tStart = Number(opts.tStart) || 0;
  const dt = Number(opts.dt) || 0;
  if (N <= 0) throw new Error(`makeLoadFn: N must be > 0 (got ${N})`);
  if (dof < 0 || dof >= N) {
    throw new Error(`makeLoadFn: dof ${dof} out of range 0..${N - 1}`);
  }
  switch (loadType) {
    case LOAD_TYPES.ZERO:
      return () => new Float64Array(N);
    case LOAD_TYPES.STEP:
      return (t) => {
        const f = new Float64Array(N);
        if (t >= tStart) f[dof] = amp;
        return f;
      };
    case LOAD_TYPES.IMPULSE:
      // Single timestep impulse — applies a finite force over one dt
      // beginning at tStart. Real impulse loading is a Dirac function;
      // we approximate by a rectangular pulse of width dt and area
      // amp · dt.
      return (t) => {
        const f = new Float64Array(N);
        if (t >= tStart && t < tStart + dt) f[dof] = amp;
        return f;
      };
    case LOAD_TYPES.SINE:
      return (t) => {
        const f = new Float64Array(N);
        if (t >= tStart) f[dof] = amp * Math.sin(omega * (t - tStart));
        return f;
      };
    default:
      throw new Error(`makeLoadFn: unknown loadType '${loadType}'`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Initial acceleration solve.
//
// At t = 0 the equation of motion gives:
//     M · ü_0 = f(0) − C · u̇_0 − K · u_0
//
// We need to solve this once to seed the Newmark loop with a consistent
// ü_0. Otherwise the very first step contains a bogus inertia term.

export function initialAcceleration(M, C, K, u0, udot0, f0, opts = {}) {
  const N = u0.length;
  const Ku = matVec(K, u0);
  const Cv = matVec(C, udot0);
  const rhs = new Float64Array(N);
  for (let i = 0; i < N; i++) rhs[i] = f0[i] - Ku[i] - Cv[i];
  // Mass-only solve. For our lumped diagonal M this is trivial.
  // Detect diagonal M for a fast path; fall back to LU otherwise.
  let isDiag = true;
  for (let i = 0; i < N && isDiag; i++) {
    for (let j = 0; j < N && isDiag; j++) {
      if (i !== j && M[i * N + j] !== 0) isDiag = false;
    }
  }
  // Apply Dirichlet on rhs (mass-diagonal already takes care of fixed DOFs
  // for us if mask is set).
  if (opts.fixedMask) {
    const mask = opts.fixedMask;
    for (let i = 0; i < N; i++) if (mask[i]) rhs[i] = 0;
  }
  if (isDiag) {
    const a = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const m = M[i * N + i];
      if (opts.fixedMask && opts.fixedMask[i]) {
        a[i] = 0;
      } else if (m > 0) {
        a[i] = rhs[i] / m;
      } else {
        a[i] = 0;
      }
    }
    return a;
  }
  // Full M solve via LU. Modify M to enforce ü = 0 on fixed DOFs.
  const Mwork = new Float64Array(M);
  if (opts.fixedMask) {
    applyDirichletInPlace(Mwork, rhs, opts.fixedMask);
  }
  const pack = luDecompose(Mwork);
  return luSolve(pack, rhs);
}

// ─────────────────────────────────────────────────────────────────────
// solveTransient — top-level driver. Runs Newmark from t = 0 to t = T
// and returns the full time history at the requested monitor DOF plus
// optional full-state snapshots.

/**
 * @param {object} spec
 *   spec.nodes        node descriptors (positions, fixed, mass)
 *   spec.elements     element descriptors (type-tagged)
 *   spec.material     { rho, alphaRayleigh, betaRayleigh }
 *   spec.dt           time step
 *   spec.tEnd         total time
 *   spec.beta         Newmark β (default 0.25)
 *   spec.gamma        Newmark γ (default 0.5)
 *   spec.loadType     'impulse' | 'sinusoidal' | 'step' | 'zero'
 *   spec.loadDof      global DOF index to apply the load on
 *   spec.loadAmp      amplitude
 *   spec.loadOmega    forcing frequency (rad/s) for 'sinusoidal'
 *   spec.loadTStart   load start time (default 0)
 *   spec.monitorDof   DOF to record into the time-displacement history
 *   spec.initialU     optional initial displacement (Float64Array, length N)
 *   spec.initialV     optional initial velocity     (Float64Array, length N)
 *   spec.solver       'lu' | 'cg'
 */
export function solveTransient(spec) {
  if (!spec) throw new Error('solveTransient: missing spec');
  const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const beta  = spec.beta  ?? TRANSIENT_DEFAULTS.BETA;
  const gamma = spec.gamma ?? TRANSIENT_DEFAULTS.GAMMA;
  const dt    = spec.dt    ?? TRANSIENT_DEFAULTS.DT;
  const tEnd  = spec.tEnd  ?? TRANSIENT_DEFAULTS.T_END;
  const alphaR = spec.alphaRayleigh ?? TRANSIENT_DEFAULTS.ALPHA_RAYLEIGH;
  const betaR  = spec.betaRayleigh  ?? TRANSIENT_DEFAULTS.BETA_RAYLEIGH;
  const loadType = spec.loadType || LOAD_TYPES.ZERO;
  const solverName = spec.solver || 'lu';
  if (dt <= 0)   throw new Error(`solveTransient: dt must be > 0 (got ${dt})`);
  if (tEnd <= 0) throw new Error(`solveTransient: tEnd must be > 0 (got ${tEnd})`);
  if (!(Array.isArray(spec.nodes) && spec.nodes.length > 0)) {
    throw new Error('solveTransient: spec.nodes empty');
  }
  if (!(Array.isArray(spec.elements) && spec.elements.length > 0)) {
    throw new Error('solveTransient: spec.elements empty');
  }
  // Localise elements + assemble global K, M, C.
  const locals = localiseElements(spec.elements, spec.nodes);
  const dofsPerNode = locals[0].dofsPerNode;
  // Cross-check all elements use the same dofsPerNode.
  for (const e of locals) {
    if (e.dofsPerNode !== dofsPerNode) {
      throw new Error(
        `solveTransient: mixed dofsPerNode (${dofsPerNode} vs ${e.dofsPerNode}); not supported`,
      );
    }
  }
  const { K, N } = assembleK(locals, spec.nodes, { dofsPerNode });
  const { M }    = assembleMass(locals, spec.nodes, { dofsPerNode, lumped: true });
  const C = assembleC(M, K, alphaR, betaR);
  const fixedMask = buildFixedMask(spec.nodes, dofsPerNode);
  // Determine monitor / load DOF in global numbering.
  const loadDof    = (spec.loadDof    ?? 0) | 0;
  const monitorDof = (spec.monitorDof ?? loadDof) | 0;
  if (loadDof < 0 || loadDof >= N) {
    throw new Error(`solveTransient: loadDof ${loadDof} out of 0..${N - 1}`);
  }
  if (monitorDof < 0 || monitorDof >= N) {
    throw new Error(`solveTransient: monitorDof ${monitorDof} out of 0..${N - 1}`);
  }
  // Build load function.
  const loadFn = makeLoadFn(loadType, {
    N, dof: loadDof,
    amplitude: spec.loadAmp ?? 0,
    omega:    spec.loadOmega ?? 0,
    tStart:   spec.loadTStart ?? 0,
    dt,
  });
  // Initial state.
  const u    = spec.initialU ? Float64Array.from(spec.initialU) : new Float64Array(N);
  const udot = spec.initialV ? Float64Array.from(spec.initialV) : new Float64Array(N);
  // Enforce Dirichlet on initial state.
  for (let i = 0; i < N; i++) {
    if (fixedMask[i]) { u[i] = 0; udot[i] = 0; }
  }
  // Consistent ü_0 — solve M · ü_0 = f(0) − C · u̇_0 − K · u_0.
  const f0 = loadFn(0);
  const uddot = initialAcceleration(M, C, K, u, udot, f0, { fixedMask });

  // March in time.
  const nSteps = Math.max(1, Math.round(tEnd / dt));
  const times = new Float64Array(nSteps + 1);
  const dispMonitor = new Float64Array(nSteps + 1);
  const velMonitor  = new Float64Array(nSteps + 1);
  const accMonitor  = new Float64Array(nSteps + 1);
  const energy      = new Float64Array(nSteps + 1);
  times[0]       = 0;
  dispMonitor[0] = u[monitorDof];
  velMonitor[0]  = udot[monitorDof];
  accMonitor[0]  = uddot[monitorDof];
  // Total mechanical energy = (1/2) u̇ᵀ M u̇ + (1/2) uᵀ K u
  function totalEnergy(uVec, vVec) {
    const Mv = matVec(M, vVec);
    const Ku = matVec(K, uVec);
    let ke = 0, pe = 0;
    for (let i = 0; i < N; i++) { ke += 0.5 * vVec[i] * Mv[i]; pe += 0.5 * uVec[i] * Ku[i]; }
    return ke + pe;
  }
  energy[0] = totalEnergy(u, udot);

  let uCur = u, vCur = udot, aCur = uddot;
  let maxAbsDisp = Math.abs(dispMonitor[0]);
  let maxAbsVel  = Math.abs(velMonitor[0]);
  let maxAbsAcc  = Math.abs(accMonitor[0]);
  let totalIters = 0;
  for (let n = 0; n < nSteps; n++) {
    const tNext = (n + 1) * dt;
    const fNext = loadFn(tNext);
    const { uNext, udotNext, uddotNext, solveInfo } = newmarkStep(
      M, C, K, uCur, vCur, aCur, fNext, dt, beta, gamma,
      { fixedMask, solver: solverName },
    );
    totalIters += solveInfo?.iters ?? 0;
    times[n + 1]       = tNext;
    dispMonitor[n + 1] = uNext[monitorDof];
    velMonitor[n + 1]  = udotNext[monitorDof];
    accMonitor[n + 1]  = uddotNext[monitorDof];
    energy[n + 1]      = totalEnergy(uNext, udotNext);
    const ad = Math.abs(uNext[monitorDof]);
    const av = Math.abs(udotNext[monitorDof]);
    const aa = Math.abs(uddotNext[monitorDof]);
    if (ad > maxAbsDisp) maxAbsDisp = ad;
    if (av > maxAbsVel)  maxAbsVel  = av;
    if (aa > maxAbsAcc)  maxAbsAcc  = aa;
    uCur = uNext; vCur = udotNext; aCur = uddotNext;
  }
  const t1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  return {
    times,
    dispMonitor,
    velMonitor,
    accMonitor,
    energy,
    maxAbsDisp,
    maxAbsVel,
    maxAbsAcc,
    finalU: uCur,
    finalV: vCur,
    finalA: aCur,
    N, dt, tEnd, beta, gamma, alphaR, betaR,
    loadType, loadDof, monitorDof,
    nSteps, totalIters,
    elapsedMs: t1 - t0,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Canonical SDOF mass-spring fixture builder.
//
// Used by the panel "default fixture" and the e2e. A single spring1d
// element connecting two nodes; node 0 is pinned, node 1 carries the
// concentrated mass m.
//
// Frequency: ω_n = √(K/m), period T_n = 2π / ω_n.
//
//   M = 1, K = 4π²  →  ω_n = 2π,  f_n = 1 Hz, T_n = 1 s.

export function buildSdofFixture({ K = 4 * Math.PI * Math.PI, m = 1 } = {}) {
  return {
    nodes: [
      { position: [0, 0, 0], dofs: 1, fixed: [true],  mass: 0 },
      { position: [1, 0, 0], dofs: 1, fixed: [false], mass: m },
    ],
    elements: [
      { type: 'spring1d', a: 0, b: 1, k: K, mLumpedA: 0, mLumpedB: 0 },
    ],
    dofsPerNode: 1,
    naturalOmega: Math.sqrt(K / m),
    naturalFreqHz: Math.sqrt(K / m) / (2 * Math.PI),
    naturalPeriod: 2 * Math.PI / Math.sqrt(K / m),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Two-DOF chain fixture (M-K-m-K-m) — a small but non-trivial sanity
// case. Not used by the default panel but exposed for the headless
// helper smoke test.

export function buildTwoDofChainFixture({ K = 1000, m = 1 } = {}) {
  return {
    nodes: [
      { position: [0, 0, 0], dofs: 1, fixed: [true],  mass: 0 },
      { position: [1, 0, 0], dofs: 1, fixed: [false], mass: m },
      { position: [2, 0, 0], dofs: 1, fixed: [false], mass: m },
    ],
    elements: [
      { type: 'spring1d', a: 0, b: 1, k: K },
      { type: 'spring1d', a: 1, b: 2, k: K },
    ],
    dofsPerNode: 1,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helper aggregate exported through window.__forgeTransientFeaHelper.

export function makeTransientFeaHelper() {
  return Object.freeze({
    // Defaults / enums
    TRANSIENT_DEFAULTS,
    LOAD_TYPES,
    // Linear algebra
    zeros, zerosMatrix, matVec, dot, addVec, scaleVec, copyVec,
    addMatScaled, luDecompose, luSolve, conjugateGradient,
    // Element library
    spring1dLocal, truss3dLocal, localiseElements,
    // Assembly
    assembleK, assembleMass, assembleC, buildFixedMask,
    applyDirichletInPlace, initialAcceleration,
    // Time integration
    newmarkStep, makeLoadFn, solveTransient,
    // Fixtures
    buildSdofFixture, buildTwoDofChainFixture,
  });
}
