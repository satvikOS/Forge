/**
 * ArchDisc Foundation — composite laminate analysis (CLT + Tsai-Wu).
 *
 * Classical Lamination Theory for layered fibre-reinforced composites
 * (carbon-epoxy, glass-epoxy, aramid-epoxy, hybrid stacks). Used for:
 *   - Aircraft fan blades (Trent XWB hollow-Ti uses composite skins)
 *   - Nacelle inner barrels
 *   - Aerostructure panels (A350 fuselage, wing skins)
 *   - Wind turbine blades
 *   - Pressure vessels (filament-wound)
 *
 * Stack of plies:
 *   - Each ply: { material, thickness, theta_deg } orientation about
 *     the laminate normal.
 *   - Per-ply orthotropic constants: E1, E2, ν12, G12, X_t, X_c, Y_t,
 *     Y_c, S (in-plane shear strength).
 *
 * Outputs:
 *   - A, B, D matrices (membrane / coupling / bending stiffness)
 *   - Stress + strain in each ply (laminate-axes and material-axes)
 *   - Tsai-Wu failure index and "first ply failure" load multiplier.
 *
 * Reference: Jones, "Mechanics of Composite Materials", 2nd ed.,
 * Taylor & Francis 1999, Ch. 4.
 *
 * Stand-alone: doesn't need a mesh — operates on a unit-cell laminate.
 * The output A/B/D matrices feed the plate / shell FEM (M45) so a
 * composite plate can be analyzed end-to-end.
 */

const PI = Math.PI;

/**
 * Reduced 2D stiffness Q for a single orthotropic ply in its
 * material-axis frame (1 = fibre, 2 = transverse).
 *   σ = Q · ε    where σ = [σ1, σ2, τ12], ε = [ε1, ε2, γ12]
 */
export function plyStiffnessMaterialAxes({ E1, E2, nu12, G12 }) {
  const nu21 = nu12 * E2 / E1;
  const denom = 1 - nu12 * nu21;
  const Q11 = E1 / denom;
  const Q22 = E2 / denom;
  const Q12 = nu12 * E2 / denom;
  const Q66 = G12;
  return [
    [Q11, Q12, 0],
    [Q12, Q22, 0],
    [0,   0,   Q66],
  ];
}

/**
 * Rotate a stiffness Q by angle θ (degrees) about z. Returns Q-bar
 * (4th-order tensor rotation reduced to plane stress).
 *   Q̄ = T^-1 · Q · T^-T   (Jones eqn 2.84)
 *
 * We expand the closed-form result rather than do matrix products,
 * to keep numerical noise low at θ = 0 / 90.
 */
export function rotateStiffness(Q, thetaDeg) {
  const t = thetaDeg * PI / 180;
  const c = Math.cos(t), s = Math.sin(t);
  const c2 = c * c, s2 = s * s, cs = c * s;
  const c4 = c2 * c2, s4 = s2 * s2;
  const Q11 = Q[0][0], Q22 = Q[1][1], Q12 = Q[0][1], Q66 = Q[2][2];
  const Qb11 = Q11 * c4 + 2 * (Q12 + 2 * Q66) * s2 * c2 + Q22 * s4;
  const Qb22 = Q11 * s4 + 2 * (Q12 + 2 * Q66) * s2 * c2 + Q22 * c4;
  const Qb12 = (Q11 + Q22 - 4 * Q66) * s2 * c2 + Q12 * (s4 + c4);
  const Qb66 = (Q11 + Q22 - 2 * Q12 - 2 * Q66) * s2 * c2 + Q66 * (s4 + c4);
  const Qb16 = (Q11 - Q12 - 2 * Q66) * cs * c2 - (Q22 - Q12 - 2 * Q66) * cs * s2;
  const Qb26 = (Q11 - Q12 - 2 * Q66) * cs * s2 - (Q22 - Q12 - 2 * Q66) * cs * c2;
  return [
    [Qb11, Qb12, Qb16],
    [Qb12, Qb22, Qb26],
    [Qb16, Qb26, Qb66],
  ];
}

/**
 * Build A, B, D matrices for a stack of plies.
 * Convention: laminate midplane at z=0, ply k extends z_{k-1} … z_k
 *
 * @param {Array<{material, thickness, theta_deg}>} stack - bottom to top
 * @returns {{ A: 3×3, B: 3×3, D: 3×3, totalThickness, plyZ }}
 */
export function laminateABD(stack) {
  // Compute ply z boundaries
  const totalThickness = stack.reduce((s, p) => s + p.thickness, 0);
  const plyZ = [-totalThickness / 2];
  for (const p of stack) plyZ.push(plyZ[plyZ.length - 1] + p.thickness);

  const A = Array.from({ length: 3 }, () => new Float64Array(3));
  const B = Array.from({ length: 3 }, () => new Float64Array(3));
  const D = Array.from({ length: 3 }, () => new Float64Array(3));

  for (let k = 0; k < stack.length; k++) {
    const ply = stack[k];
    const Q = plyStiffnessMaterialAxes(ply.material);
    const Qb = rotateStiffness(Q, ply.theta_deg);
    const z0 = plyZ[k], z1 = plyZ[k + 1];
    const dh = z1 - z0;
    const dh2 = (z1 * z1 - z0 * z0) / 2;
    const dh3 = (z1 ** 3 - z0 ** 3) / 3;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      A[i][j] += Qb[i][j] * dh;
      B[i][j] += Qb[i][j] * dh2;
      D[i][j] += Qb[i][j] * dh3;
    }
  }
  return { A, B, D, totalThickness, plyZ };
}

/**
 * Solve the laminate constitutive equation
 *   [N; M] = [A B; B D] [ε⁰; κ]
 * for given mid-plane resultants N (membrane force/length, units
 * F/L) and M (bending moment/length, F·L/L = F).
 *
 * @returns { strains: { eps0: 3, kappa: 3 }, plyStrains, plyStresses }
 */
export function solveLaminate(stack, N, M) {
  const { A, B, D, totalThickness, plyZ } = laminateABD(stack);
  // Build 6×6 [A B; B D] and solve
  const K = Array.from({ length: 6 }, () => new Float64Array(6));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    K[i][j] = A[i][j];
    K[i][j + 3] = B[i][j];
    K[i + 3][j] = B[i][j];
    K[i + 3][j + 3] = D[i][j];
  }
  const rhs = new Float64Array([N[0], N[1], N[2], M[0], M[1], M[2]]);
  // Direct 6x6 LU (small matrix, fine in JS)
  const x = solve6x6(K, rhs);
  const eps0 = [x[0], x[1], x[2]];
  const kappa = [x[3], x[4], x[5]];

  // Compute per-ply strains/stresses at top and bottom of each ply
  const plyStrains = [];
  const plyStresses = [];
  for (let k = 0; k < stack.length; k++) {
    const z = (plyZ[k] + plyZ[k + 1]) / 2;   // mid-ply
    const epsLam = [
      eps0[0] + z * kappa[0],
      eps0[1] + z * kappa[1],
      eps0[2] + z * kappa[2],
    ];
    plyStrains.push(epsLam);
    // Rotate strain into material frame: ε_mat = R · ε_lam
    const t = stack[k].theta_deg * PI / 180;
    const c = Math.cos(t), s = Math.sin(t);
    const epsMat = [
      epsLam[0] * c * c + epsLam[1] * s * s + epsLam[2] * c * s,
      epsLam[0] * s * s + epsLam[1] * c * c - epsLam[2] * c * s,
      -2 * (epsLam[0] - epsLam[1]) * c * s + epsLam[2] * (c * c - s * s),
    ];
    const Q = plyStiffnessMaterialAxes(stack[k].material);
    const sigMat = [
      Q[0][0] * epsMat[0] + Q[0][1] * epsMat[1],
      Q[1][0] * epsMat[0] + Q[1][1] * epsMat[1],
      Q[2][2] * epsMat[2],
    ];
    plyStresses.push({ matAxes: sigMat, thetaDeg: stack[k].theta_deg, midZ: z });
  }
  return { eps0, kappa, plyStrains, plyStresses, A, B, D, totalThickness };
}

/**
 * Tsai-Wu failure criterion in material axes:
 *   F_i σ_i + F_ij σ_i σ_j ≤ 1
 * with F_1 = 1/X_t − 1/X_c, F_2 = 1/Y_t − 1/Y_c,
 *      F_11 = 1/(X_t X_c), F_22 = 1/(Y_t Y_c),
 *      F_66 = 1/S²,  F_12 = −0.5 √(F_11 F_22)
 *
 * Returns the failure index value and the multiplier on the applied
 * load that would cause first-ply failure.
 */
export function tsaiWu(sigma, strength) {
  const { Xt, Xc, Yt, Yc, S } = strength;
  const F1 = 1 / Xt - 1 / Xc;
  const F2 = 1 / Yt - 1 / Yc;
  const F11 = 1 / (Xt * Xc);
  const F22 = 1 / (Yt * Yc);
  const F66 = 1 / (S * S);
  const F12 = -0.5 * Math.sqrt(F11 * F22);
  const s1 = sigma[0], s2 = sigma[1], s12 = sigma[2];
  const linear = F1 * s1 + F2 * s2;
  const quad = F11 * s1 * s1 + F22 * s2 * s2 + F66 * s12 * s12 + 2 * F12 * s1 * s2;
  const FI = linear + quad;
  // Solve a + b·k + c·k² = 1 for the load multiplier k that causes failure
  // where a = 0, b = linear, c = quad → b·k + c·k² = 1
  let R;
  if (Math.abs(quad) < 1e-30) {
    R = linear === 0 ? Infinity : 1 / Math.abs(linear);
  } else {
    const disc = linear * linear + 4 * quad;
    R = (-linear + Math.sqrt(Math.max(disc, 0))) / (2 * quad);
  }
  return { failureIndex: FI, strengthRatio: Math.abs(R) };
}

/**
 * Whole-laminate Tsai-Wu: returns the lowest strength ratio across
 * all plies (= "first ply failure" load multiplier).
 */
export function laminateFirstPlyFailure(stack, sigmaPerPly) {
  let minR = Infinity, governingPly = -1;
  for (let k = 0; k < stack.length; k++) {
    const tw = tsaiWu(sigmaPerPly[k].matAxes, stack[k].material);
    if (tw.strengthRatio < minR) {
      minR = tw.strengthRatio;
      governingPly = k;
    }
  }
  return { strengthRatio: minR, governingPly };
}

// ─── tiny 6x6 LU for the laminate constitutive solve ─────────────
function solve6x6(A, b) {
  const n = 6;
  const M = Array.from({ length: n }, (_, i) => [...A[i]]);
  const r = [...b];
  for (let k = 0; k < n; k++) {
    let piv = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[piv][k])) piv = i;
    if (piv !== k) {
      [M[k], M[piv]] = [M[piv], M[k]];
      [r[k], r[piv]] = [r[piv], r[k]];
    }
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      for (let j = k; j < n; j++) M[i][j] -= f * M[k][j];
      r[i] -= f * r[k];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = r[i];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/** Standard reference materials. Properties in MPa. */
export const Materials = {
  CarbonEpoxyT300_5208: {
    E1: 132000, E2: 10800, nu12: 0.24, G12: 5650,
    Xt: 1500, Xc: 1500, Yt: 40, Yc: 246, S: 68,
  },
  GlassEpoxyE: {
    E1: 39000, E2: 8270, nu12: 0.26, G12: 4140,
    Xt: 1080, Xc: 620, Yt: 39, Yc: 128, S: 89,
  },
  AS4_3501_6: {
    E1: 138000, E2: 8960, nu12: 0.30, G12: 7100,
    Xt: 1448, Xc: 1448, Yt: 51.7, Yc: 206, S: 93,
  },
};
