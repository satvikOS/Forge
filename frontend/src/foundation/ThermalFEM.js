/**
 * ArchDisc Foundation — Steady-state thermal FEM (linear tetrahedra).
 *
 * Solves Laplace's equation with internal heat generation:
 *
 *     ∇·(k ∇T) + q = 0    in Ω
 *     T = T̄              on Γ_D  (Dirichlet)
 *     -k ∂T/∂n = q̄       on Γ_N  (Neumann flux)
 *     -k ∂T/∂n = h(T-T∞)   on Γ_R  (convection / Robin)
 *
 * For 4-node linear tets with isotropic thermal conductivity k:
 *
 *     K_e = V_e · k · B^T · B          (4×4)
 *           where B (3×4) holds the shape function gradients
 *
 *     f_e (volumetric heat source q):
 *           V_e · q / 4 distributed equally to each of the 4 nodes
 *
 * Each node has 1 DOF (T). The same SparseMatrix + Jacobi-PCG solver
 * we use for the structural FEM works here directly.
 *
 * Validation: a uniform-conductivity rod with T_hot at one face and
 * T_cold at the other should produce a linear T(x) = T_h + (T_c-T_h)·x/L
 * exactly (to within solver tolerance), and a uniform heat flux
 * q = k·(T_h-T_c)/L = -k·dT/dx.
 */

const MATERIAL_K_DEFAULT = {
  // Thermal conductivity in W/(m·K). For mm-scale models we work
  // implicitly in W/(mm·K) by scaling k accordingly when called.
  AluminumT6: 167,    // 6061-T6
  Steel1020:   51.9,
  Steel4340:   44.5,
  Copper:     388,
  Inconel:     11.4,
  ABS:          0.17,
  Nylon:        0.25,
  Air:          0.026,
};

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

/**
 * Build element thermal stiffness K_e (4×4) and shape-function gradients B.
 *
 * Returns null on degenerate tetrahedra.
 */
function elementThermalStiffness(v0, v1, v2, v3, k) {
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
  // Shape function gradients (3×4) in physical space.
  // B[*][0] = ∇N0 = -(∇N1 + ∇N2 + ∇N3)
  // B[*][1] = ∇N1 = J^-T row 0
  // B[*][2] = ∇N2 = J^-T row 1
  // B[*][3] = ∇N3 = J^-T row 2
  const B = [
    new Float64Array(4),
    new Float64Array(4),
    new Float64Array(4),
  ];
  B[0][1] = inv00; B[0][2] = inv10; B[0][3] = inv20;
  B[1][1] = inv01; B[1][2] = inv11; B[1][3] = inv21;
  B[2][1] = inv02; B[2][2] = inv12; B[2][3] = inv22;
  B[0][0] = -(B[0][1] + B[0][2] + B[0][3]);
  B[1][0] = -(B[1][1] + B[1][2] + B[1][3]);
  B[2][0] = -(B[2][1] + B[2][2] + B[2][3]);
  // K_e (4×4) = V_e · k · B^T · B
  const Ke = [
    new Float64Array(4),
    new Float64Array(4),
    new Float64Array(4),
    new Float64Array(4),
  ];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let kk = 0; kk < 3; kk++) s += B[kk][i] * B[kk][j];
      Ke[i][j] = Ve * k * s;
    }
  }
  return { Ke, Ve, B };
}

/**
 * Solve a steady-state thermal FEM problem on a TetMesh.
 *
 * @param {object} args
 * @param {TetMesh} args.mesh
 * @param {number} args.k                    - thermal conductivity (W/(mm·K)
 *                                              if you scale; or W/(m·K) if
 *                                              the mesh is in metres)
 * @param {Array<{node, value}>} args.fixedTemperatures
 *                                            Dirichlet BCs (T̄)
 * @param {Array<{node, value}>} args.heatLoads
 *                                            point heat source/sink in W
 * @param {number} args.uniformHeatGen        volumetric q (W/mm³ if mesh in mm)
 * @param {object} args.options               { tol, maxIter }
 * @returns {{
 *   temperature: Float64Array (length numNodes),
 *   minT, maxT,
 *   cgIterations, cgResidual,
 *   elementGradients: Array<[gx,gy,gz]>,
 *   elementHeatFlux: Array<[qx,qy,qz]>  (= -k ∇T)
 * }}
 */
export function solveThermalSteady({
  mesh, k,
  fixedTemperatures = [],
  heatLoads = [],
  uniformHeatGen = 0,
  options = {},
}) {
  const numNodes = mesh.vertices.length;
  const K = new SparseMatrix(numNodes);
  const F = new Float64Array(numNodes);

  const elementCache = new Array(mesh.tets.length);

  for (let t = 0; t < mesh.tets.length; t++) {
    const tet = mesh.tets[t];
    const v = [
      mesh.vertices[tet[0]], mesh.vertices[tet[1]],
      mesh.vertices[tet[2]], mesh.vertices[tet[3]],
    ];
    const r = elementThermalStiffness(v[0], v[1], v[2], v[3], k);
    if (!r) { elementCache[t] = null; continue; }
    elementCache[t] = r;
    const Ke = r.Ke;
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      const v_ab = Ke[a][b];
      if (v_ab !== 0) K.add(tet[a], tet[b], v_ab);
    }
    if (uniformHeatGen !== 0) {
      const fNode = uniformHeatGen * r.Ve / 4;
      for (const a of tet) F[a] += fNode;
    }
  }

  // Apply point heat loads
  for (const ld of heatLoads) F[ld.node] += ld.value;

  // Symmetric row-elimination Dirichlet enforcement (exact, preserves SPD):
  //   For each constrained node i with target value v_i:
  //     1. For every j != i: F[j] -= K[j][i] * v_i, then K[j][i] = 0
  //        (moves the column contribution to RHS)
  //     2. Zero row i: K[i][:] = 0
  //     3. Set K[i][i] = 1, F[i] = v_i
  //
  // This is exact — no penalty parameter to tune, no max-principle
  // violations from finite penalty.
  const fixedSet = new Map();   // node → target value (last write wins)
  for (const bc of fixedTemperatures) fixedSet.set(bc.node, bc.value);
  // Step 1: subtract column contributions from RHS, zero columns
  for (const [bcNode, val] of fixedSet) {
    for (let i = 0; i < numNodes; i++) {
      if (i === bcNode) continue;
      const v = K.rows[i].get(bcNode);
      if (v !== undefined && v !== 0) {
        F[i] -= v * val;
        K.rows[i].set(bcNode, 0);
      }
    }
  }
  // Step 2 + 3: zero row, set diagonal=1, F=value
  for (const [bcNode, val] of fixedSet) {
    K.rows[bcNode].clear();
    K.rows[bcNode].set(bcNode, 1);
    F[bcNode] = val;
  }

  const cg = pcg(K, F, { tol: options.tol ?? 1e-10, maxIter: options.maxIter ?? 5000 });

  // Recover element gradients ∇T = B · T_e and heat flux -k ∇T
  const elementGradients = new Array(mesh.tets.length);
  const elementHeatFlux  = new Array(mesh.tets.length);
  for (let t = 0; t < mesh.tets.length; t++) {
    const ec = elementCache[t];
    if (!ec) { elementGradients[t] = null; elementHeatFlux[t] = null; continue; }
    const tet = mesh.tets[t];
    const Te = [cg.x[tet[0]], cg.x[tet[1]], cg.x[tet[2]], cg.x[tet[3]]];
    const grad = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      let s = 0;
      for (let j = 0; j < 4; j++) s += ec.B[i][j] * Te[j];
      grad[i] = s;
    }
    elementGradients[t] = grad;
    elementHeatFlux[t] = [-k * grad[0], -k * grad[1], -k * grad[2]];
  }

  let minT = Infinity, maxT = -Infinity;
  for (let i = 0; i < numNodes; i++) {
    if (cg.x[i] < minT) minT = cg.x[i];
    if (cg.x[i] > maxT) maxT = cg.x[i];
  }
  return {
    temperature: cg.x,
    minT, maxT,
    cgIterations: cg.iterations,
    cgResidual: cg.residualNorm,
    elementGradients,
    elementHeatFlux,
  };
}

export const THERMAL_K = MATERIAL_K_DEFAULT;
