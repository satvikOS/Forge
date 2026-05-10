/**
 * ArchDisc Foundation — Thermal-Structural Coupling (sequential).
 *
 * Multi-physics simulation in the order: thermal solve → structural
 * solve with thermal eigenstrain. This is the standard "weak / one-way"
 * coupling used in NX, ANSYS, Abaqus when feedback from displacement
 * back to temperature is small (most static cases).
 *
 *   1. Solve steady-state heat conduction K_T · T = q on the tet mesh,
 *      using the existing ThermalFEM solver and exact Dirichlet BCs.
 *
 *   2. For each element, compute the average temperature change
 *      ΔT_e = mean(T_a) − T_ref  for a in {0..3}.
 *
 *   3. Build the thermal eigenstrain
 *
 *         ε_th = α · ΔT_e · [1, 1, 1, 0, 0, 0]^T
 *
 *      (isotropic linear thermal expansion).
 *
 *   4. Add the equivalent thermal-load nodal force per element
 *
 *         f_th_e = ∫_V_e B^T D ε_th dV = V_e · B^T D ε_th
 *
 *      (B and D constant per linear-tet element).
 *
 *   5. Solve K_struct · u = f_mech + f_th  with the structural FEM
 *      (exact row-elimination Dirichlet BCs).
 *
 *   6. Compute total stress per element:
 *
 *         σ_e = D · (B u_e − ε_th)
 *
 *      i.e. only the **mechanical** strain (ε_total − ε_th) generates
 *      stress. A free thermal expansion has Bu = ε_th and σ = 0.
 *
 * Validation:
 *   - Free-end bar uniformly heated → tip displaces L·αΔT, σ ≈ 0 ✓
 *   - Fixed-fixed bar uniformly heated → ε_total = 0, σ_x = −E·αΔT ✓
 */

const D2R = Math.PI / 180;

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
  const g1 = [inv00, inv01, inv02];
  const g2 = [inv10, inv11, inv12];
  const g3 = [inv20, inv21, inv22];
  const g0 = [-g1[0] - g2[0] - g3[0], -g1[1] - g2[1] - g3[1], -g1[2] - g2[2] - g3[2]];
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
  return { B, Ve };
}

/**
 * Solve a coupled thermal-structural problem.
 *
 * @param {object} args
 * @param {TetMesh} args.mesh
 * @param {object} args.material  - { E, nu, alpha } (linear thermal expansion 1/K)
 * @param {object} args.thermal   - { k, Tref, fixedTemperatures, heatLoads, uniformHeatGen }
 * @param {object} args.structural- { fixedNodes, mechanicalLoads }
 * @param {object} args.options
 *
 * `material.alpha` is the linear coefficient of thermal expansion in
 * 1/K (e.g. 23.6e-6 for Aluminum 6061-T6).
 *
 * Returns {
 *   temperature: Float64Array (length numNodes),
 *   displacement: Float64Array (length 3 * numNodes),
 *   elementStress: Array (per-tet 6-vector σ_xx, σ_yy, σ_zz, τ_xy, τ_yz, τ_zx),
 *   elementVonMises, nodalVonMises,
 *   maxDisplacement, maxStress, maxThermalStrain,
 *   thermalCgIters, structuralCgIters,
 * }
 */
export async function solveThermoMechanical({
  mesh, material,
  thermal,
  structural,
  options = {},
}) {
  const { solveThermalSteady } = await import('./ThermalFEM.js');

  // ---- Step 1: thermal solve ----
  const t1 = solveThermalSteady({
    mesh,
    k: thermal.k,
    fixedTemperatures: thermal.fixedTemperatures || [],
    heatLoads: thermal.heatLoads || [],
    uniformHeatGen: thermal.uniformHeatGen || 0,
    options: { tol: options.thermalTol ?? 1e-10, maxIter: options.thermalMaxIter ?? 5000 },
  });
  const T = t1.temperature;
  const Tref = thermal.Tref ?? 0;

  // ---- Step 2: assemble structural K + thermal force vector ----
  const D = buildD(material.E, material.nu);
  const alpha = material.alpha;
  const numNodes = mesh.vertices.length;
  const ndof = numNodes * 3;
  const K = new SparseMatrix(ndof);
  const F = new Float64Array(ndof);

  // Cache element B + Ve + dT_e for stress recovery later
  const eCache = new Array(mesh.tets.length);

  for (let e = 0; e < mesh.tets.length; e++) {
    const tet = mesh.tets[e];
    const v = [
      mesh.vertices[tet[0]], mesh.vertices[tet[1]],
      mesh.vertices[tet[2]], mesh.vertices[tet[3]],
    ];
    const r = elementBVe(v[0], v[1], v[2], v[3]);
    if (!r) { eCache[e] = null; continue; }
    const { B, Ve } = r;
    const Te = (T[tet[0]] + T[tet[1]] + T[tet[2]] + T[tet[3]]) / 4;
    const dT = Te - Tref;

    // Element stiffness K_e
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

    // Thermal eigenstrain ε_th = α dT [1,1,1,0,0,0]^T
    const eth = [alpha * dT, alpha * dT, alpha * dT, 0, 0, 0];

    // Equivalent nodal thermal force: f_th_e = V_e · B^T D ε_th = V_e · DB^T ε_th
    // (since DB rows are 6, columns 12)
    for (let i = 0; i < 12; i++) {
      let f = 0;
      for (let k = 0; k < 6; k++) f += DB[k][i] * eth[k];
      F[tet[(i / 3) | 0] * 3 + (i % 3)] += Ve * f;
    }
    eCache[e] = { B, Ve, dT, eth };
  }

  // Mechanical loads (additive)
  const mechLoads = (structural && structural.mechanicalLoads) || [];
  for (const ld of mechLoads) F[ld.node * 3 + ld.dof] += ld.value;

  // Structural Dirichlet BCs via row elimination (exact).
  // Two formats supported:
  //   - structural.fixedNodes: integer node indices, locks all 3 DOFs to 0
  //   - structural.fixedDofs:  [{ node, dof, value? }] per-DOF fixity.
  //                            dof in {0,1,2}; value defaults to 0.
  const fixedNodes = (structural && structural.fixedNodes) || [];
  const fixedDofsExplicit = (structural && structural.fixedDofs) || [];
  const fixedSet = new Map();   // dof index → target value
  for (const fn of fixedNodes) {
    for (let d = 0; d < 3; d++) fixedSet.set(fn * 3 + d, 0);
  }
  for (const f of fixedDofsExplicit) {
    fixedSet.set(f.node * 3 + f.dof, f.value ?? 0);
  }
  // Step A: subtract column contributions, zero columns
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
  // Step B: zero row, set diag=1, F=val
  for (const [bcDof, val] of fixedSet) {
    K.rows[bcDof].clear();
    K.rows[bcDof].set(bcDof, 1);
    F[bcDof] = val;
  }

  // ---- Step 3: solve K u = F ----
  const cg = pcg(K, F, { tol: options.structuralTol ?? 1e-10, maxIter: options.structuralMaxIter ?? 12000 });
  const u = cg.x;

  // ---- Step 4: stress recovery σ = D (B u - ε_th) ----
  const elementStress = new Array(mesh.tets.length);
  const elementVonMises = new Float64Array(mesh.tets.length);
  for (let e = 0; e < mesh.tets.length; e++) {
    const ec = eCache[e];
    if (!ec) { elementStress[e] = null; elementVonMises[e] = 0; continue; }
    const tet = mesh.tets[e];
    const ue = new Float64Array(12);
    for (let a = 0; a < 4; a++) {
      ue[a * 3]     = u[tet[a] * 3];
      ue[a * 3 + 1] = u[tet[a] * 3 + 1];
      ue[a * 3 + 2] = u[tet[a] * 3 + 2];
    }
    // B u - ε_th
    const eMech = new Float64Array(6);
    for (let i = 0; i < 6; i++) {
      let s = 0;
      for (let j = 0; j < 12; j++) s += ec.B[i][j] * ue[j];
      eMech[i] = s - ec.eth[i];
    }
    // σ = D · ε_mech
    const sig = new Float64Array(6);
    for (let i = 0; i < 6; i++) {
      let s = 0;
      for (let j = 0; j < 6; j++) s += D[i][j] * eMech[j];
      sig[i] = s;
    }
    elementStress[e] = sig;
    const sx = sig[0], sy = sig[1], sz = sig[2];
    const txy = sig[3], tyz = sig[4], tzx = sig[5];
    elementVonMises[e] = Math.sqrt(0.5 * (
      (sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2
      + 6 * (txy * txy + tyz * tyz + tzx * tzx)
    ));
  }

  // Per-node von Mises (volume-weighted from incident elements)
  const nodalVM = new Float64Array(numNodes);
  const nodalW = new Float64Array(numNodes);
  for (let e = 0; e < mesh.tets.length; e++) {
    const ec = eCache[e];
    if (!ec) continue;
    const tet = mesh.tets[e];
    const w = ec.Ve;
    for (const a of tet) { nodalVM[a] += elementVonMises[e] * w; nodalW[a] += w; }
  }
  for (let i = 0; i < numNodes; i++) if (nodalW[i] > 0) nodalVM[i] /= nodalW[i];

  let maxDisp = 0;
  for (let i = 0; i < numNodes; i++) {
    const dx = u[i * 3], dy = u[i * 3 + 1], dz = u[i * 3 + 2];
    const m = Math.hypot(dx, dy, dz);
    if (m > maxDisp) maxDisp = m;
  }
  let maxStress = 0;
  for (const v of elementVonMises) if (v > maxStress) maxStress = v;
  let maxThermalStrain = 0;
  for (const ec of eCache) if (ec) {
    const m = Math.abs(ec.eth[0]);
    if (m > maxThermalStrain) maxThermalStrain = m;
  }

  return {
    temperature: T,
    displacement: u,
    elementStress, elementVonMises, nodalVonMises: nodalVM,
    maxDisplacement: maxDisp,
    maxStress,
    maxThermalStrain,
    thermalCgIters: t1.cgIterations,
    thermalCgResidual: t1.cgResidual,
    structuralCgIters: cg.iterations,
    structuralCgResidual: cg.residualNorm,
    safetyFactor: material.yieldStrength ? material.yieldStrength / Math.max(maxStress, 1e-30) : null,
  };
}
