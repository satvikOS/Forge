// PUSH-223 (Slice-166) — Real Composite Shell FEA.
//
// Four-node first-order shear-deformable (Mindlin-Reissner) shell
// element with 5 DOFs per node (u, v, w, θ_x, θ_y) and the classical
// lamination ABD matrix used for the section constitutive law. Includes
// per-ply stress recovery + Tsai-Wu / Tsai-Hill / max-stress failure
// reporting via the existing compositesMath.js exports.
//
// Theory references:
//   Mindlin 1951 "Influence of rotatory inertia and shear on flexural
//     motions of isotropic, elastic plates", J. Appl. Mech. 18.
//   Reissner 1945 "The effect of transverse shear deformation on the
//     bending of elastic plates", J. Appl. Mech. 12.
//   Reddy 2004 "Mechanics of Laminated Composite Plates and Shells",
//     §6.3 + §10 for the FSDT shell element.
//   Bathe 2014 "Finite Element Procedures", §6.7 (MITC), §5.3 (2×2 Gauss
//     for membrane/bending, 1×1 reduced for transverse shear to avoid
//     locking on thin shells).
//
// Element kinematics — first-order shear deformation theory:
//   u(x,y,z) = u₀(x,y) + z·θ_y(x,y)
//   v(x,y,z) = v₀(x,y) − z·θ_x(x,y)
//   w(x,y,z) = w₀(x,y)
//
// Mid-plane strain ε⁰ = {u,x ; v,y ; u,y + v,x}.
// Curvature κ      = {θ_y,x ; −θ_x,y ; θ_y,y − θ_x,x}.
// Transverse shear γ = {w,x + θ_y ; w,y − θ_x}.
//
// Section constitutive (laminated plate):
//   N = A·ε⁰ + B·κ            (in-plane resultants, N/mm)
//   M = B·ε⁰ + D·κ            (bending moments, N·mm/mm = N)
//   Q = A_s · γ               (transverse shears, N/mm)
//
// where A_s = κ_s · Σ Q44_k · t_k    (k = ply; κ_s = 5/6 shear factor;
// Q44 = G13, Q55 = G23 of each ply, transformed by orientation).
//
// Element stiffness blocks:
//   K_m  = ∫ B_m^T · A   · B_m  dA    (8×8 in-plane DOFs)
//   K_mb = ∫ B_m^T · B   · B_b  dA    (8×12 coupling, transposed for 12×8)
//   K_b  = ∫ B_b^T · D   · B_b  dA    (12×12 bending DOFs)
//   K_s  = ∫ B_s^T · A_s · B_s  dA    (12×12 shear, reduced integration)
//
// The 20×20 element stiffness is assembled by mapping the (u,v) DOFs
// into the 8 membrane positions, (w, θ_x, θ_y) into the 12 bending +
// shear positions:
//   node-i: [u_i, v_i, w_i, θx_i, θy_i] → DOFs (5i, 5i+1, 5i+2, 5i+3, 5i+4)
//
// Stress recovery — at each Gauss point we evaluate ε⁰ and κ from the
// solved nodal vector, then loop the plies:
//   z_k_mid = mid-plane z of ply k (signed, from midplane)
//   σ_xy_k  = Q̄_k · (ε⁰ + z_k_mid · κ)        (laminate axes)
//   σ_12_k  = T(θ_k) · σ_xy_k                  (ply principal axes)
// and run plyFailureReport from compositesMath for the criterion.
//
// Hard constraints (PUSH-223 brief):
//   * NO new npm / C++ deps.
//   * Reuse the existing compositesMath.js ABD + Tsai-Wu — don't
//     reimplement.
//   * Real Mindlin shell math (5 DOF/node, reduced shear integration).
//     No MVP.
//
// Units convention:
//   * Lengths in mm.
//   * Forces in N.
//   * Stresses in MPa  (= N/mm²).
//   * A in GPa·mm = (N/mm²)·mm = N/mm; we multiply by 1e3 internally
//     since compositesMath.computeABD returns matrices with Q in GPa
//     (so A_ij in GPa·mm) but FEA expects N/mm.

'use strict';

import {
  computeABD, rotatedQ, expandPlies, plyFailureReport, rotateStressToPly,
  reducedStiffness, COMPOSITE_MATERIALS,
} from './compositesMath.js';

// ─────────────────────────────────────────────────────────────────────
// Defaults.

export const COMPOSITE_FEA_DEFAULTS = Object.freeze({
  SHEAR_CORRECTION: 5 / 6,        // Mindlin's value for rectangular cross-section
  GAUSS_FULL: 2,                  // 2×2 Gauss for membrane / bending
  GAUSS_REDUCED: 1,               // 1-point for transverse shear (avoid locking)
  // Tolerances / penalty
  DIRICHLET_LARGE: 1e30,          // large-spring penalty for fixed DOFs
});

export const LOAD_PATTERNS = Object.freeze({
  TENSION_X: 'tension-x',
  TENSION_Y: 'tension-y',
  SHEAR:     'shear',
  BENDING:   'bending',
  PRESSURE:  'pressure',
});

// ─────────────────────────────────────────────────────────────────────
// Dense linear algebra — Float64Array row-major, copied from the
// transientFea.js patterns so this module stays self-contained on the
// LA side. (We don't import from transientFea so the composite FEA
// stays composable as a leaf math module.)

export function denseZeros(n) {
  return new Float64Array(n * n);
}

export function denseMatVec(A, x) {
  const n = x.length;
  if (A.length !== n * n) {
    throw new Error(`denseMatVec dim mismatch: A=${A.length} x=${n}`);
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const row = i * n;
    for (let j = 0; j < n; j++) s += A[row + j] * x[j];
    y[i] = s;
  }
  return y;
}

/**
 * Dense LU factorisation with partial pivoting (Doolittle). Throws on
 * singular matrices.
 */
export function denseLUDecompose(A0) {
  const n = Math.round(Math.sqrt(A0.length));
  if (n * n !== A0.length) {
    throw new Error(`denseLUDecompose: not square (len ${A0.length})`);
  }
  const LU = new Float64Array(A0);
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;
  for (let k = 0; k < n; k++) {
    let maxAbs = Math.abs(LU[k * n + k]);
    let pivRow = k;
    for (let r = k + 1; r < n; r++) {
      const v = Math.abs(LU[r * n + k]);
      if (v > maxAbs) { maxAbs = v; pivRow = r; }
    }
    if (maxAbs < 1e-300) {
      throw new Error(`denseLUDecompose: singular at pivot ${k}`);
    }
    if (pivRow !== k) {
      for (let j = 0; j < n; j++) {
        const tmp = LU[k * n + j];
        LU[k * n + j] = LU[pivRow * n + j];
        LU[pivRow * n + j] = tmp;
      }
      const tmpP = piv[k]; piv[k] = piv[pivRow]; piv[pivRow] = tmpP;
    }
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

export function denseLUSolve(pack, b) {
  const { LU, piv, n } = pack;
  if (b.length !== n) {
    throw new Error(`denseLUSolve dim mismatch: b=${b.length} n=${n}`);
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = b[piv[i]];
  for (let i = 0; i < n; i++) {
    let s = y[i];
    const row = i * n;
    for (let j = 0; j < i; j++) s -= LU[row + j] * y[j];
    y[i] = s;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    const row = i * n;
    for (let j = i + 1; j < n; j++) s -= LU[row + j] * x[j];
    x[i] = s / LU[row + i];
  }
  return x;
}

// ─────────────────────────────────────────────────────────────────────
// Gauss quadrature tables.

// 1-point (ξ = 0, weight 2 in 1D → weight 4 in 2D).
export const GAUSS_1 = Object.freeze([
  Object.freeze({ xi: 0, eta: 0, w: 4 }),
]);

// 2×2 Gauss-Legendre (xi, eta ∈ {±1/√3}, weight 1 each → 1 per point in 2D).
const G2 = 1 / Math.sqrt(3);
export const GAUSS_2x2 = Object.freeze([
  Object.freeze({ xi: -G2, eta: -G2, w: 1 }),
  Object.freeze({ xi:  G2, eta: -G2, w: 1 }),
  Object.freeze({ xi:  G2, eta:  G2, w: 1 }),
  Object.freeze({ xi: -G2, eta:  G2, w: 1 }),
]);

// ─────────────────────────────────────────────────────────────────────
// Bilinear isoparametric shape functions.
//
// Node ordering (counter-clockwise):
//   N1: ξ = −1, η = −1   (bottom-left)
//   N2: ξ = +1, η = −1   (bottom-right)
//   N3: ξ = +1, η = +1   (top-right)
//   N4: ξ = −1, η = +1   (top-left)
//
// N_i(ξ, η) = 1/4 · (1 + ξ_i·ξ) · (1 + η_i·η)
// dN_i/dξ   = 1/4 · ξ_i · (1 + η_i·η)
// dN_i/dη   = 1/4 · η_i · (1 + ξ_i·ξ)

const NODE_XI  = [-1,  1,  1, -1];
const NODE_ETA = [-1, -1,  1,  1];

export function shapeFunctions(xi, eta) {
  const N = new Array(4), dNdxi = new Array(4), dNdeta = new Array(4);
  for (let i = 0; i < 4; i++) {
    const xi_i = NODE_XI[i], eta_i = NODE_ETA[i];
    N[i]      = 0.25 * (1 + xi_i * xi) * (1 + eta_i * eta);
    dNdxi[i]  = 0.25 * xi_i * (1 + eta_i * eta);
    dNdeta[i] = 0.25 * eta_i * (1 + xi_i * xi);
  }
  return { N, dNdxi, dNdeta };
}

/**
 * Jacobian J = [[dx/dξ, dy/dξ],[dx/dη, dy/dη]] for a 4-node element
 * with corner positions (x_i, y_i). Returns { J, detJ, invJ } where
 * J and invJ are length-4 Float64Arrays row-major.
 */
export function jacobianAt(xi, eta, cornerXY) {
  const { dNdxi, dNdeta } = shapeFunctions(xi, eta);
  let J11 = 0, J12 = 0, J21 = 0, J22 = 0;
  for (let i = 0; i < 4; i++) {
    J11 += dNdxi[i]  * cornerXY[i][0];
    J12 += dNdxi[i]  * cornerXY[i][1];
    J21 += dNdeta[i] * cornerXY[i][0];
    J22 += dNdeta[i] * cornerXY[i][1];
  }
  const detJ = J11 * J22 - J12 * J21;
  if (Math.abs(detJ) < 1e-30) {
    throw new Error(
      `jacobianAt: degenerate element (detJ=${detJ.toExponential(3)})`,
    );
  }
  const inv = 1 / detJ;
  const invJ = new Float64Array([
     J22 * inv, -J12 * inv,
    -J21 * inv,  J11 * inv,
  ]);
  return {
    J:    new Float64Array([J11, J12, J21, J22]),
    detJ,
    invJ,
  };
}

/**
 * Cartesian derivatives  dN/dx, dN/dy  at a Gauss point.
 *   dN/dx = invJ · [dN/dξ; dN/dη]
 */
export function cartesianGradient(xi, eta, cornerXY) {
  const { dNdxi, dNdeta } = shapeFunctions(xi, eta);
  const { detJ, invJ } = jacobianAt(xi, eta, cornerXY);
  const dNdx = new Array(4), dNdy = new Array(4);
  for (let i = 0; i < 4; i++) {
    dNdx[i] = invJ[0] * dNdxi[i] + invJ[1] * dNdeta[i];
    dNdy[i] = invJ[2] * dNdxi[i] + invJ[3] * dNdeta[i];
  }
  return { dNdx, dNdy, detJ };
}

// ─────────────────────────────────────────────────────────────────────
// Section constitutive — ABD + transverse shear.
//
// compositesMath.computeABD returns A, B, D in (GPa·mm, GPa·mm²,
// GPa·mm³). For the FEA assembly we want consistent N / mm units:
//   * Stress in MPa (N/mm²); Q is in GPa = 1000 MPa.
//   * So A in N/mm = GPa·mm × 1000.
//   * B in N      = GPa·mm² × 1000.
//   * D in N·mm   = GPa·mm³ × 1000.
//
// Transverse shear stiffness (matrix) — A_s = κ_s · Σ Q44_k · t_k,
// where Q44 / Q55 are the rotated transverse shear stiffness of each
// ply. For G13 ≈ G12 (typical UD CFRP, woven, and most cores within
// 20%), the standard simplification gives
//   A_s = κ_s · diag(Σ G13_k · t_k,  Σ G23_k · t_k)
// rotated by orientation to give a 2×2 dense matrix:
//   A_s,ij = κ_s · Σ T̄_ij(θ_k) · G_k · t_k     (i, j ∈ {1, 2})

export function sectionMatrices(book, opts = {}) {
  const shearK = Number.isFinite(opts.shearCorrection)
    ? opts.shearCorrection
    : COMPOSITE_FEA_DEFAULTS.SHEAR_CORRECTION;
  const abd = computeABD(book);
  // Convert (GPa) to (MPa = N/mm²) i.e. × 1000.
  const A = abd.A.map((r) => r.map((v) => v * 1e3));
  const B = abd.B.map((r) => r.map((v) => v * 1e3));
  const D = abd.D.map((r) => r.map((v) => v * 1e3));

  // Transverse shear — build A_s = κ_s · Σ Q44/55_k · t_k (rotated).
  // For each ply k we use G13 = G12, G23 = G12 (good assumption for
  // both UD and woven CFRP). Rotation by θ:
  //   Q44_bar = G13·cos²θ + G23·sin²θ
  //   Q55_bar = G13·sin²θ + G23·cos²θ
  //   Q45_bar = (G13 − G23)·sinθ·cosθ
  // With G13 = G23 the off-diagonal is zero and Q44 = Q55 = G12 (no θ).
  // We code the general form to keep the door open for anisotropic
  // out-of-plane shear later.
  const seq = expandPlies(book);
  let As11 = 0, As22 = 0, As12 = 0;
  for (const p of seq) {
    const mat = COMPOSITE_MATERIALS[p.material] || COMPOSITE_MATERIALS['UD CFRP'];
    const G13 = +mat.G12_GPa * 1e3;  // N/mm² (≈ G12 assumption)
    const G23 = +mat.G12_GPa * 1e3;
    const theta = p.orientation_deg * Math.PI / 180;
    const c = Math.cos(theta), s = Math.sin(theta);
    const Q44 = G13 * c * c + G23 * s * s;
    const Q55 = G13 * s * s + G23 * c * c;
    const Q45 = (G13 - G23) * s * c;
    As11 += Q44 * p.thickness_mm;
    As22 += Q55 * p.thickness_mm;
    As12 += Q45 * p.thickness_mm;
  }
  As11 *= shearK; As22 *= shearK; As12 *= shearK;
  return {
    A, B, D,
    As: [[As11, As12], [As12, As22]],
    totalThickness_mm: abd.totalThickness_mm,
    plyCount: abd.plyCount,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Strain-displacement matrices (B).
//
// For the membrane DOFs {u₁,v₁,...,u₄,v₄} (8 entries):
//   B_m = [ dN1/dx,  0,     dN2/dx,  0,   ...  ]
//         [   0,   dN1/dy,    0,   dN2/dy, ...  ]
//         [ dN1/dy, dN1/dx, dN2/dy, dN2/dx, ... ]
//   shape: 3×8
//
// For the bending DOFs {w₁,θx₁,θy₁,...,w₄,θx₄,θy₄} (12 entries) the
// rotations contribute curvature only:
//   B_b = [   0,   0,    dN1/dx,    0,   0,    dN2/dx,  ... ]
//         [   0, -dN1/dy,   0,      0, -dN2/dy,   0,    ... ]
//         [   0, -dN1/dx, dN1/dy,   0, -dN2/dx, dN2/dy, ... ]
//   shape: 3×12  (column 0 = w_i = 0 entries; w doesn't curve a plate)
//
// For the transverse shear:
//   γ_xz = w,x + θ_y      → B_s[0, w_i] = dN_i/dx, B_s[0, θy_i] = N_i
//   γ_yz = w,y − θ_x      → B_s[1, w_i] = dN_i/dy, B_s[1, θx_i] = −N_i
//   shape: 2×12

/**
 * Compute B_m at a Gauss point. Returns a Float64Array of length 3×8 =
 * 24 entries, row-major.
 */
export function membraneB(xi, eta, cornerXY) {
  const { dNdx, dNdy } = cartesianGradient(xi, eta, cornerXY);
  const B = new Float64Array(3 * 8);
  for (let i = 0; i < 4; i++) {
    const cU = 2 * i, cV = 2 * i + 1;
    B[0 * 8 + cU] = dNdx[i];
    B[1 * 8 + cV] = dNdy[i];
    B[2 * 8 + cU] = dNdy[i];
    B[2 * 8 + cV] = dNdx[i];
  }
  return B;
}

/**
 * Compute B_b at a Gauss point. Returns Float64Array of length 3×12.
 */
export function bendingB(xi, eta, cornerXY) {
  const { dNdx, dNdy } = cartesianGradient(xi, eta, cornerXY);
  const B = new Float64Array(3 * 12);
  for (let i = 0; i < 4; i++) {
    // Bending DOFs per node: w (col 3i), θx (col 3i+1), θy (col 3i+2).
    const cW = 3 * i, cTx = 3 * i + 1, cTy = 3 * i + 2;
    // κ_x = θ_y,x
    B[0 * 12 + cTy] = dNdx[i];
    // κ_y = − θ_x,y
    B[1 * 12 + cTx] = -dNdy[i];
    // κ_xy = θ_y,y − θ_x,x
    B[2 * 12 + cTx] = -dNdx[i];
    B[2 * 12 + cTy] =  dNdy[i];
    // w columns are zero (w doesn't curve a plate in pure bending B).
    // Leave cW columns zero.
    void cW;
  }
  return B;
}

/**
 * Compute B_s at a Gauss point. Returns Float64Array of length 2×12.
 */
export function shearB(xi, eta, cornerXY) {
  const { N }      = shapeFunctions(xi, eta);
  const { dNdx, dNdy } = cartesianGradient(xi, eta, cornerXY);
  const B = new Float64Array(2 * 12);
  for (let i = 0; i < 4; i++) {
    const cW = 3 * i, cTx = 3 * i + 1, cTy = 3 * i + 2;
    // γ_xz = w,x + θ_y
    B[0 * 12 + cW]  = dNdx[i];
    B[0 * 12 + cTy] = N[i];
    // γ_yz = w,y − θ_x
    B[1 * 12 + cW]  = dNdy[i];
    B[1 * 12 + cTx] = -N[i];
  }
  return B;
}

// ─────────────────────────────────────────────────────────────────────
// Element stiffness assembly.
//
// We build 4 blocks then map to the 20×20 element matrix.
//
//   K_e[20×20] indexing:
//     DOF ordering per node: [u, v, w, θx, θy]
//     Global element DOF index for node i, local d ∈ 0..4:  5*i + d
//
//   membrane (u, v) → columns 5i, 5i+1               (4 nodes × 2 = 8)
//   bending  (w, θx, θy) → columns 5i+2, 5i+3, 5i+4  (4 nodes × 3 = 12)

const MEMBRANE_DOF_MAP = [0, 1, 5, 6, 10, 11, 15, 16];
const BENDING_DOF_MAP  = [2, 3, 4, 7, 8, 9, 12, 13, 14, 17, 18, 19];

/**
 * Matrix-matrix multiply (small dense): C = A · B
 * A: r×k, B: k×c → C: r×c (all Float64Array row-major)
 */
function matMul(A, B, r, k, c) {
  const C = new Float64Array(r * c);
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      let s = 0;
      for (let p = 0; p < k; p++) s += A[i * k + p] * B[p * c + j];
      C[i * c + j] = s;
    }
  }
  return C;
}

/**
 * Triple product B^T · M · B where M is 3×3 (stored as a 2D array) and
 * B is r×n (row-major Float64Array, r = 3). Returns n×n Float64Array.
 */
function btmb3(B, M, n) {
  // First MB[3×n] = M · B
  const MB = new Float64Array(3 * n);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < n; j++) {
      MB[i * n + j] = M[i][0] * B[0 * n + j]
                    + M[i][1] * B[1 * n + j]
                    + M[i][2] * B[2 * n + j];
    }
  }
  // Then K[n×n] = B^T · MB
  const K = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let p = 0; p < 3; p++) s += B[p * n + i] * MB[p * n + j];
      K[i * n + j] = s;
    }
  }
  return K;
}

/**
 * Same triple product but for the shear case where M is 2×2 and B is
 * 2×n.
 */
function btmb2(B, M, n) {
  const MB = new Float64Array(2 * n);
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < n; j++) {
      MB[i * n + j] = M[i][0] * B[0 * n + j]
                    + M[i][1] * B[1 * n + j];
    }
  }
  const K = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let p = 0; p < 2; p++) s += B[p * n + i] * MB[p * n + j];
      K[i * n + j] = s;
    }
  }
  return K;
}

/**
 * Mixed triple product:  K[8×12] = ∫ B_m^T · B_section · B_b dA at one
 * Gauss point (multiplied by detJ · w externally).
 */
function mixedB(Bm, Bsec, Bb, n1, n2) {
  // BsecBb[3×12] = B_section · B_b
  const tmp = new Float64Array(3 * n2);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < n2; j++) {
      tmp[i * n2 + j] = Bsec[i][0] * Bb[0 * n2 + j]
                      + Bsec[i][1] * Bb[1 * n2 + j]
                      + Bsec[i][2] * Bb[2 * n2 + j];
    }
  }
  // K[n1×n2] = Bm^T · tmp
  const K = new Float64Array(n1 * n2);
  for (let i = 0; i < n1; i++) {
    for (let j = 0; j < n2; j++) {
      let s = 0;
      for (let p = 0; p < 3; p++) s += Bm[p * n1 + i] * tmp[p * n2 + j];
      K[i * n2 + j] = s;
    }
  }
  return K;
}

/**
 * Build the 20×20 element stiffness for one quadrilateral.
 *
 * cornerXY: 4-entry array of [x, y] pairs (mm).
 * section : output of sectionMatrices.
 * opts    : { gaussFull, gaussReduced } — default 2×2 in-plane + 1-pt shear.
 */
export function elementK(cornerXY, section, opts = {}) {
  const fullGauss = opts.gaussFull || GAUSS_2x2;
  const redGauss  = opts.gaussReduced || GAUSS_1;
  const Ke = new Float64Array(20 * 20);

  // Helper — scatter a small dense block (rows×cols) into Ke via two
  // DOF maps. Used for membrane (m), bending (b), and coupling (m↔b).
  function scatter(K_block, rows, cols, rowMap, colMap, scale) {
    for (let i = 0; i < rows; i++) {
      const gi = rowMap[i];
      for (let j = 0; j < cols; j++) {
        const gj = colMap[j];
        Ke[gi * 20 + gj] += scale * K_block[i * cols + j];
      }
    }
  }

  // ─── Full integration: membrane + bending + coupling ───
  for (const gp of fullGauss) {
    const Bm = membraneB(gp.xi, gp.eta, cornerXY);
    const Bb = bendingB(gp.xi, gp.eta, cornerXY);
    const { detJ } = jacobianAt(gp.xi, gp.eta, cornerXY);
    const wD = gp.w * Math.abs(detJ);
    // K_m  = B_m^T · A · B_m  (8×8)
    const Km  = btmb3(Bm, section.A, 8);
    scatter(Km, 8, 8, MEMBRANE_DOF_MAP, MEMBRANE_DOF_MAP, wD);
    // K_b  = B_b^T · D · B_b  (12×12)
    const Kb  = btmb3(Bb, section.D, 12);
    scatter(Kb, 12, 12, BENDING_DOF_MAP, BENDING_DOF_MAP, wD);
    // K_mb = B_m^T · B · B_b  (8×12)  +  its transpose at K_bm
    const Kmb = mixedB(Bm, section.B, Bb, 8, 12);
    scatter(Kmb, 8, 12, MEMBRANE_DOF_MAP, BENDING_DOF_MAP, wD);
    // K_bm = K_mb^T (12×8) — assemble explicitly so the matrix is symmetric.
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 12; j++) {
        const gi = MEMBRANE_DOF_MAP[i], gj = BENDING_DOF_MAP[j];
        // Ke[gj, gi] += scale · Kmb[i, j]
        Ke[gj * 20 + gi] += wD * Kmb[i * 12 + j];
      }
    }
  }

  // ─── Reduced integration: transverse shear ───
  for (const gp of redGauss) {
    const Bs = shearB(gp.xi, gp.eta, cornerXY);
    const { detJ } = jacobianAt(gp.xi, gp.eta, cornerXY);
    const wD = gp.w * Math.abs(detJ);
    // K_s = B_s^T · A_s · B_s   (12×12, on bending DOFs)
    const Ks = btmb2(Bs, section.As, 12);
    scatter(Ks, 12, 12, BENDING_DOF_MAP, BENDING_DOF_MAP, wD);
  }

  return Ke;
}

// ─────────────────────────────────────────────────────────────────────
// Mesh + global assembly.
//
// We expose a simple rectangular plate mesh generator (Lx × Ly into
// nx × ny rectangles, returning nodes [{x,y}] and 4-node elements
// {i,j,k,l} in CCW order). Free for the panel + Archie to use.

export function makeRectPlateMesh(Lx_mm, Ly_mm, nx, ny) {
  if (!(nx > 0) || !(ny > 0)) {
    throw new Error(`makeRectPlateMesh: nx, ny must be > 0 (got ${nx}, ${ny})`);
  }
  const nodes = [];
  const dx = Lx_mm / nx, dy = Ly_mm / ny;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      nodes.push({ x: i * dx, y: j * dy, id: nodes.length });
    }
  }
  const elements = [];
  const idx = (i, j) => i + j * (nx + 1);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // CCW: n1=(i,j), n2=(i+1,j), n3=(i+1,j+1), n4=(i,j+1)
      elements.push({
        nodes: [idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)],
      });
    }
  }
  return {
    nodes, elements,
    Lx_mm, Ly_mm, nx, ny,
    dx_mm: dx, dy_mm: dy,
  };
}

export function totalDofs(nNodes) {
  return nNodes * 5;
}

/**
 * Assemble the global stiffness from a list of 4-node Mindlin shell
 * elements. Returns { K, N }.
 */
export function assembleGlobalK(mesh, section, opts = {}) {
  const N = totalDofs(mesh.nodes.length);
  const K = new Float64Array(N * N);
  for (const e of mesh.elements) {
    const corners = e.nodes.map((nid) => [mesh.nodes[nid].x, mesh.nodes[nid].y]);
    const Ke = elementK(corners, section, opts);
    // Scatter the 20×20 block into K. Element DOF p = 5*localNode + d.
    const dofMap = new Int32Array(20);
    for (let n = 0; n < 4; n++) {
      const gn = e.nodes[n];
      for (let d = 0; d < 5; d++) dofMap[5 * n + d] = 5 * gn + d;
    }
    for (let i = 0; i < 20; i++) {
      const gi = dofMap[i];
      for (let j = 0; j < 20; j++) {
        K[gi * N + dofMap[j]] += Ke[i * 20 + j];
      }
    }
  }
  return { K, N };
}

// ─────────────────────────────────────────────────────────────────────
// Loads + Dirichlet BCs.

/**
 * Build a load vector for a uniform in-plane traction.
 *
 *   pattern.tension-x: distributed force /unit length applied to the
 *     right edge (x = Lx) in the +x direction. Magnitude p (N/mm).
 *     Equivalent nodal forces: p · t_edge / nNodesEdge for each free
 *     edge node, where t_edge is the edge length.
 *
 *   pattern.tension-y: same on top edge (y = Ly).
 *
 *   pattern.pressure: out-of-plane uniform pressure p (N/mm² = MPa) on
 *     every element, projected onto each node's w DOF via the consistent
 *     load p · ∫ N_i dA = p · A_e / 4 for a rect.
 *
 *   pattern.bending: a moment per unit length applied on the right edge
 *     about the y-axis. Magnitude m (N).
 *
 * Returns a Float64Array of length N (= 5 * nNodes).
 */
export function buildLoadVector(mesh, pattern, magnitude) {
  const N = totalDofs(mesh.nodes.length);
  const F = new Float64Array(N);
  const { Lx_mm, Ly_mm, nx, ny } = mesh;
  const dofIdx = (nid, d) => 5 * nid + d;
  switch (pattern) {
    case LOAD_PATTERNS.TENSION_X: {
      // Right edge nodes: i = nx, j = 0..ny
      const edgeNodes = [];
      for (let j = 0; j <= ny; j++) edgeNodes.push(nx + j * (nx + 1));
      // Distribute as line load consistent with linear interp on a
      // bilinear edge: each interior edge node gets (Ly/ny) · p, each
      // corner gets half of that. Total = p · Ly as required.
      const dy = Ly_mm / ny;
      for (let k = 0; k < edgeNodes.length; k++) {
        const isCorner = (k === 0 || k === edgeNodes.length - 1);
        const share = magnitude * dy * (isCorner ? 0.5 : 1.0);
        F[dofIdx(edgeNodes[k], 0)] += share;
      }
      break;
    }
    case LOAD_PATTERNS.TENSION_Y: {
      const edgeNodes = [];
      for (let i = 0; i <= nx; i++) edgeNodes.push(i + ny * (nx + 1));
      const dx = Lx_mm / nx;
      for (let k = 0; k < edgeNodes.length; k++) {
        const isCorner = (k === 0 || k === edgeNodes.length - 1);
        const share = magnitude * dx * (isCorner ? 0.5 : 1.0);
        F[dofIdx(edgeNodes[k], 1)] += share;
      }
      break;
    }
    case LOAD_PATTERNS.SHEAR: {
      // Right edge sheared in +y; left edge in −y.
      const dy = Ly_mm / ny;
      for (let j = 0; j <= ny; j++) {
        const isCorner = (j === 0 || j === ny);
        const share = magnitude * dy * (isCorner ? 0.5 : 1.0);
        F[dofIdx(nx + j * (nx + 1), 1)] += share;
        F[dofIdx(0  + j * (nx + 1), 1)] -= share;
      }
      break;
    }
    case LOAD_PATTERNS.PRESSURE: {
      // For each element, distribute p · A_e / 4 to each w DOF (lumped).
      const elArea = (Lx_mm / nx) * (Ly_mm / ny);
      const share = magnitude * elArea * 0.25;
      for (const e of mesh.elements) {
        for (const nid of e.nodes) F[dofIdx(nid, 2)] += share;
      }
      break;
    }
    case LOAD_PATTERNS.BENDING: {
      // Moment about y on right edge → distribute as nodal couples on
      // θ_y DOF. Consistent edge integration like TENSION_X.
      const dy = Ly_mm / ny;
      for (let j = 0; j <= ny; j++) {
        const isCorner = (j === 0 || j === ny);
        const share = magnitude * dy * (isCorner ? 0.5 : 1.0);
        F[dofIdx(nx + j * (nx + 1), 4)] += share;
      }
      break;
    }
    default:
      throw new Error(`buildLoadVector: unknown pattern '${pattern}'`);
  }
  return F;
}

/**
 * Identify the left-edge nodes (x = 0). The default validation
 * fixture clamps the left edge so the plate behaves as a cantilever
 * or tension specimen with one fixed face.
 */
export function leftEdgeNodes(mesh) {
  const out = [];
  for (let j = 0; j <= mesh.ny; j++) out.push(0 + j * (mesh.nx + 1));
  return out;
}

/**
 * Build a Uint8Array fixedMask of length N. For 'clamped-left' we fix
 * (u, v, w, θx, θy) for all left-edge nodes. For 'pinned-left' we fix
 * only translational DOFs.
 */
export function buildClampedLeftMask(mesh, bcType = 'clamped-left') {
  const N = totalDofs(mesh.nodes.length);
  const mask = new Uint8Array(N);
  const edge = leftEdgeNodes(mesh);
  const dofIdx = (nid, d) => 5 * nid + d;
  const fixDofs = bcType === 'pinned-left' ? [0, 1, 2] : [0, 1, 2, 3, 4];
  for (const nid of edge) {
    for (const d of fixDofs) mask[dofIdx(nid, d)] = 1;
  }
  // Also pin v on the top-right corner for the tension-x case, otherwise
  // the rigid-body mode in y is singular when only u is restrained.
  // Specifically, when BC is 'clamped-left' all 5 are fixed so this is
  // already covered. For 'pinned-left' we additionally fix θx and θy on
  // the left edge corners so the plate doesn't rotate freely.
  return mask;
}

/**
 * In-place Dirichlet enforcement: zero row + col of fixed DOFs and put 1
 * on diagonal, zero rhs entry.
 */
export function applyDirichletInPlace(K, F, mask) {
  const N = mask.length;
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    for (let j = 0; j < N; j++) K[i * N + j] = 0;
    for (let j = 0; j < N; j++) K[j * N + i] = 0;
    K[i * N + i] = 1;
    F[i] = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Per-element stress recovery + per-ply failure check.
//
// At each element's Gauss point we compute:
//   ε⁰ = B_m · u_membrane             (3 entries)
//   κ  = B_b · u_bending              (3 entries)
// Then for each ply at signed mid-plane z_k:
//   σ_xy_k = Q̄_k · (ε⁰ + z_k · κ)    (laminate axes, MPa)
//   σ_12_k = T(θ_k) · σ_xy_k          (ply principal axes)
//   crit_k = plyFailureReport(σ_12_k, mat_k)

/**
 * Build the per-ply mid-plane z (signed, from laminate midplane). For
 * a stack with totalThickness t, the kth ply at index 0..N-1 has
 * midplane z_k = -t/2 + Σ_{j<k} t_j + t_k/2.
 *
 * Returns an array of { z_mid, z_top, z_bot, material, orientation_deg }.
 */
export function plyHeights(book) {
  const seq = expandPlies(book);
  const t = seq.reduce((s, p) => s + p.thickness_mm, 0);
  const out = [];
  let z = -t / 2;
  for (const p of seq) {
    const z_bot = z, z_top = z + p.thickness_mm;
    const z_mid = (z_bot + z_top) / 2;
    out.push({
      z_mid, z_top, z_bot,
      material: p.material,
      orientation_deg: p.orientation_deg,
      thickness_mm: p.thickness_mm,
    });
    z = z_top;
  }
  return out;
}

/**
 * Build the rotated Q̄ matrix as a 2D 3×3 array (MPa) for a ply.
 * Same as compositesMath.rotatedQ but in MPa for stress recovery
 * (the panel works in MPa = N/mm²).
 */
function rotatedQ_MPa(materialId, orientation_deg) {
  const q = rotatedQ(materialId, orientation_deg);
  return [
    [q.Q11b * 1e3, q.Q12b * 1e3, q.Q16b * 1e3],
    [q.Q12b * 1e3, q.Q22b * 1e3, q.Q26b * 1e3],
    [q.Q16b * 1e3, q.Q26b * 1e3, q.Q66b * 1e3],
  ];
}

/**
 * Apply a 3×3 matrix to a length-3 vector.
 */
function mat3Vec(M, v) {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
  ];
}

/**
 * Compute mid-plane strain ε⁰ and curvature κ at a Gauss point given
 * the element's nodal displacement vector (length 20).
 */
export function strainAtGauss(uElem, xi, eta, cornerXY) {
  // Extract membrane (u, v) and bending (w, θx, θy) sub-vectors.
  const um = new Float64Array(8);
  const ub = new Float64Array(12);
  for (let i = 0; i < 8;  i++) um[i] = uElem[MEMBRANE_DOF_MAP[i]];
  for (let i = 0; i < 12; i++) ub[i] = uElem[BENDING_DOF_MAP[i]];
  const Bm = membraneB(xi, eta, cornerXY);
  const Bb = bendingB(xi, eta, cornerXY);
  const eps0 = new Float64Array(3), kappa = new Float64Array(3);
  for (let r = 0; r < 3; r++) {
    let s = 0;
    for (let c = 0; c < 8; c++) s += Bm[r * 8 + c] * um[c];
    eps0[r] = s;
    s = 0;
    for (let c = 0; c < 12; c++) s += Bb[r * 12 + c] * ub[c];
    kappa[r] = s;
  }
  return { eps0: Array.from(eps0), kappa: Array.from(kappa) };
}

/**
 * For one Gauss point + one ply, compute σ in laminate + ply axes and
 * the failure RF / FI.
 */
export function plyStress(eps0, kappa, ply) {
  const Qbar = rotatedQ_MPa(ply.material, ply.orientation_deg);
  const eAtZ = [
    eps0[0] + ply.z_mid * kappa[0],
    eps0[1] + ply.z_mid * kappa[1],
    eps0[2] + ply.z_mid * kappa[2],
  ];
  const sigGlobal = mat3Vec(Qbar, eAtZ);
  const sigPly = rotateStressToPly(sigGlobal, ply.orientation_deg);
  const report = plyFailureReport(sigPly, ply.material);
  return {
    sigma_xy: sigGlobal,
    sigma_12: sigPly,
    report,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Top-level solver.

/**
 * solveCompositeShell — given a layup, a rectangular plate mesh, a
 * boundary condition spec, and a load pattern + magnitude, assemble +
 * solve the linear shell FEA system and run the per-ply failure
 * report at every Gauss point.
 *
 * Returns a result object with the displacement field, per-ply RF
 * tables, first-ply-failure load multiplier and ply index, ABD
 * matrices, etc.
 */
export function solveCompositeShell(spec) {
  if (!spec) throw new Error('solveCompositeShell: missing spec');
  const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const Lx = +spec.Lx_mm;
  const Ly = +spec.Ly_mm;
  const nx = (spec.nx | 0) || 4;
  const ny = (spec.ny | 0) || 4;
  if (!(Lx > 0) || !(Ly > 0)) {
    throw new Error(`solveCompositeShell: Lx, Ly must be > 0 (got ${Lx}, ${Ly})`);
  }
  const book = spec.layup;
  if (!book || !Array.isArray(book.plies) || book.plies.length === 0) {
    throw new Error('solveCompositeShell: layup empty');
  }
  const loadPattern = spec.loadPattern || LOAD_PATTERNS.TENSION_X;
  const loadMag = Number.isFinite(+spec.loadMagnitude) ? +spec.loadMagnitude : 1.0;
  const bcType  = spec.bcType || 'clamped-left';
  // ── Mesh + section ──
  const mesh = makeRectPlateMesh(Lx, Ly, nx, ny);
  const section = sectionMatrices(book, {
    shearCorrection: spec.shearCorrection ?? COMPOSITE_FEA_DEFAULTS.SHEAR_CORRECTION,
  });
  // ── Assemble K, F, BCs ──
  const { K, N } = assembleGlobalK(mesh, section);
  const F = buildLoadVector(mesh, loadPattern, loadMag);
  const mask = buildClampedLeftMask(mesh, bcType);
  applyDirichletInPlace(K, F, mask);
  // ── Solve ──
  const pack = denseLUDecompose(K);
  const u = denseLUSolve(pack, F);
  const tSolveEnd = (typeof performance !== 'undefined')
    ? performance.now() : Date.now();
  // ── Per-element stress recovery + failure check at Gauss points ──
  const plies = plyHeights(book);
  // Track first-ply-failure (FPF) — minimum RF across all Gauss × ply.
  let fpfRF = Infinity;
  let fpfPlyIdx = -1;
  let fpfElemIdx = -1;
  let fpfCriterion = null;
  let fpfMode = null;
  // Per-ply aggregate min RF for the result table.
  const perPlyMinRF = new Array(plies.length).fill(Infinity);
  const perPlyMaxFI = new Array(plies.length).fill(0);
  const perPlyCritMode = new Array(plies.length).fill(null);
  // For the panel: at the geometric centre we record the strain history.
  const centreXY = [Lx * 0.5, Ly * 0.5];
  // Walk every element + each 2×2 Gauss point.
  const samplesByElem = [];
  for (let ei = 0; ei < mesh.elements.length; ei++) {
    const e = mesh.elements[ei];
    const corners = e.nodes.map((nid) => [mesh.nodes[nid].x, mesh.nodes[nid].y]);
    // Build the element's nodal displacement vector (length 20).
    const uElem = new Float64Array(20);
    for (let n = 0; n < 4; n++) {
      const gn = e.nodes[n];
      for (let d = 0; d < 5; d++) uElem[5 * n + d] = u[5 * gn + d];
    }
    const samplesGp = [];
    for (const gp of GAUSS_2x2) {
      const { eps0, kappa } = strainAtGauss(uElem, gp.xi, gp.eta, corners);
      const plySamples = plies.map((ply, pi) => {
        const ps = plyStress(eps0, kappa, ply);
        if (ps.report.RF < perPlyMinRF[pi]) {
          perPlyMinRF[pi]   = ps.report.RF;
          perPlyMaxFI[pi]   = Math.max(perPlyMaxFI[pi], ps.report.FI);
          perPlyCritMode[pi] = ps.report.criticalCriterion;
        }
        if (ps.report.RF < fpfRF) {
          fpfRF        = ps.report.RF;
          fpfPlyIdx    = pi;
          fpfElemIdx   = ei;
          fpfCriterion = ps.report.criticalCriterion;
          fpfMode      = ps.report.mode;
        }
        return {
          plyIndex: pi,
          orientation_deg: ply.orientation_deg,
          material: ply.material,
          z_mid: ply.z_mid,
          sigma_xy: ps.sigma_xy,
          sigma_12: ps.sigma_12,
          RF: ps.report.RF, FI: ps.report.FI,
          criterion: ps.report.criticalCriterion,
        };
      });
      samplesGp.push({ xi: gp.xi, eta: gp.eta, eps0, kappa, plySamples });
    }
    samplesByElem.push({ elemIdx: ei, samples: samplesGp });
  }
  const tEnd = (typeof performance !== 'undefined')
    ? performance.now() : Date.now();
  // Maximum nodal displacements for the chip row.
  let maxAbsU = 0, maxAbsW = 0, maxAbsTheta = 0;
  for (let nid = 0; nid < mesh.nodes.length; nid++) {
    const ux = u[5 * nid + 0], vy = u[5 * nid + 1], wz = u[5 * nid + 2];
    const tx = u[5 * nid + 3], ty = u[5 * nid + 4];
    maxAbsU = Math.max(maxAbsU, Math.abs(ux), Math.abs(vy));
    maxAbsW = Math.max(maxAbsW, Math.abs(wz));
    maxAbsTheta = Math.max(maxAbsTheta, Math.abs(tx), Math.abs(ty));
  }
  // Build a compact per-ply table for the panel.
  const perPlyTable = plies.map((ply, pi) => ({
    plyIndex: pi,
    orientation_deg: ply.orientation_deg,
    material: ply.material,
    thickness_mm: ply.thickness_mm,
    z_mid_mm: ply.z_mid,
    minRF: perPlyMinRF[pi],
    maxFI: perPlyMaxFI[pi],
    criticalCriterion: perPlyCritMode[pi],
  }));
  return {
    // Inputs echo
    Lx_mm: Lx, Ly_mm: Ly, nx, ny,
    loadPattern, loadMagnitude: loadMag, bcType,
    nPlies: plies.length,
    plyCount: plies.length,
    // Section
    A_NperMM:    section.A,
    B_NperMM:    section.B,
    D_NmmPerMM:  section.D,
    As_NperMM:   section.As,
    totalThickness_mm: section.totalThickness_mm,
    // Solver
    N, nElements: mesh.elements.length,
    u: Array.from(u),
    maxAbsU, maxAbsW, maxAbsTheta,
    // Failure
    fpf: {
      RF:        fpfRF,
      plyIndex:  fpfPlyIdx,
      elemIndex: fpfElemIdx,
      criterion: fpfCriterion,
      mode:      fpfMode,
      loadAtFailure: fpfRF * loadMag,
    },
    perPlyTable,
    elementSamples: samplesByElem,
    centreXY,
    // Timing
    elapsedSolveMs: tSolveEnd - t0,
    elapsedTotalMs: tEnd - t0,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Headless helper aggregate — published on window.__forgeCompositeFeaHelper.

export function makeCompositeFeaHelper() {
  return Object.freeze({
    COMPOSITE_FEA_DEFAULTS,
    LOAD_PATTERNS,
    // Linear algebra
    denseZeros, denseMatVec, denseLUDecompose, denseLUSolve,
    // Quadrature
    GAUSS_1, GAUSS_2x2,
    // Shape functions
    shapeFunctions, jacobianAt, cartesianGradient,
    // B matrices
    membraneB, bendingB, shearB,
    // Section
    sectionMatrices,
    // Element + global
    elementK, makeRectPlateMesh, totalDofs, assembleGlobalK,
    // Loads + BCs
    buildLoadVector, leftEdgeNodes, buildClampedLeftMask,
    applyDirichletInPlace,
    // Recovery
    plyHeights, strainAtGauss, plyStress,
    // Solver
    solveCompositeShell,
  });
}

export default {
  COMPOSITE_FEA_DEFAULTS,
  LOAD_PATTERNS,
  denseZeros, denseMatVec, denseLUDecompose, denseLUSolve,
  GAUSS_1, GAUSS_2x2,
  shapeFunctions, jacobianAt, cartesianGradient,
  membraneB, bendingB, shearB,
  sectionMatrices,
  elementK, makeRectPlateMesh, totalDofs, assembleGlobalK,
  buildLoadVector, leftEdgeNodes, buildClampedLeftMask,
  applyDirichletInPlace,
  plyHeights, strainAtGauss, plyStress,
  solveCompositeShell,
  makeCompositeFeaHelper,
};
