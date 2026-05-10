/**
 * ArchDisc Foundation — Topology Optimization (SIMP method).
 *
 * Solid Isotropic Material with Penalization. The classic structural
 * optimization technique used by NX Topology Optimization, Altair
 * Inspire / OptiStruct, Abaqus Tosca, etc.
 *
 * Each tet element gets a density ρ_e ∈ [ρ_min, 1]. Effective stiffness
 * is ρ_e^p · K_e_unit (p ≈ 3 penalizes intermediate densities — pushes
 * the field to ~binary 0/1). We solve the global FEM, compute element
 * strain energies, then update each ρ_e via the Optimality Criteria
 * method to minimize compliance c = u^T K u subject to ∫ ρ dV ≤ V_target.
 *
 * OC update:
 *
 *     ρ_e_new = clip( ρ_e · sqrt(B_e / λ) , ρ_min, 1 )
 *
 *   where B_e = -∂c/∂ρ_e / V_e = (p · ρ_e^(p-1) · u_e^T K_e_unit u_e) / V_e
 *   and λ is the Lagrange multiplier found by bisection so that the
 *   total volume constraint is satisfied.
 *
 * A density-sensitivity filter (linear hat over neighbors within radius)
 * is applied each iteration to suppress checkerboard patterns and give
 * mesh-independent results.
 *
 * Validation: a cantilever-beam test produces an emergent truss-like
 * topology (Michell-style flange + diagonal web pattern).
 */

const PI = Math.PI;

/**
 * Build a sparse list of (i, distance) neighbor pairs for each
 * element, where distance is centroid-to-centroid.
 * Used by the linear-hat density filter.
 */
function buildNeighborGraph(mesh, radius) {
  const numEl = mesh.tets.length;
  const centroids = new Array(numEl);
  for (let e = 0; e < numEl; e++) {
    const t = mesh.tets[e];
    const v = [
      mesh.vertices[t[0]], mesh.vertices[t[1]],
      mesh.vertices[t[2]], mesh.vertices[t[3]],
    ];
    centroids[e] = [
      (v[0][0] + v[1][0] + v[2][0] + v[3][0]) / 4,
      (v[0][1] + v[1][1] + v[2][1] + v[3][1]) / 4,
      (v[0][2] + v[1][2] + v[2][2] + v[3][2]) / 4,
    ];
  }
  // For each element, collect neighbors within radius.
  // O(n²) is fine for our part sizes (a few thousand elements).
  const neighbors = new Array(numEl);
  for (let e = 0; e < numEl; e++) {
    const list = [];
    const c = centroids[e];
    for (let f = 0; f < numEl; f++) {
      const d = Math.hypot(centroids[f][0] - c[0], centroids[f][1] - c[1], centroids[f][2] - c[2]);
      if (d <= radius) list.push({ idx: f, weight: Math.max(0, radius - d) });
    }
    // Normalize so weights sum to 1
    const sum = list.reduce((s, n) => s + n.weight, 0) || 1;
    for (const n of list) n.weight /= sum;
    neighbors[e] = list;
  }
  return { neighbors, centroids };
}

function applyFilter(neighbors, x) {
  const out = new Float64Array(x.length);
  for (let e = 0; e < x.length; e++) {
    let s = 0;
    for (const { idx, weight } of neighbors[e]) s += weight * x[idx];
    out[e] = s;
  }
  return out;
}

/**
 * Compute element volumes once (for both K assembly and volume
 * constraint evaluation).
 */
function elementVolumes(mesh) {
  const out = new Float64Array(mesh.tets.length);
  for (let e = 0; e < mesh.tets.length; e++) {
    const t = mesh.tets[e];
    const a = mesh.vertices[t[0]], b = mesh.vertices[t[1]];
    const c = mesh.vertices[t[2]], d = mesh.vertices[t[3]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const wx = d[0] - a[0], wy = d[1] - a[1], wz = d[2] - a[2];
    const det =
      ux * (vy * wz - vz * wy) -
      uy * (vx * wz - vz * wx) +
      uz * (vx * wy - vy * wx);
    out[e] = Math.abs(det) / 6;
  }
  return out;
}

/**
 * Element stiffness in unit-density form (returns the 12×12 K_e at ρ=1).
 * Caller applies ρ^p scaling per element each iteration.
 */
function elementStiffnessUnit(mesh, e, D) {
  const t = mesh.tets[e];
  const v0 = mesh.vertices[t[0]];
  const v1 = mesh.vertices[t[1]];
  const v2 = mesh.vertices[t[2]];
  const v3 = mesh.vertices[t[3]];
  const J00 = v1[0] - v0[0], J01 = v2[0] - v0[0], J02 = v3[0] - v0[0];
  const J10 = v1[1] - v0[1], J11 = v2[1] - v0[1], J12 = v3[1] - v0[1];
  const J20 = v1[2] - v0[2], J21 = v2[2] - v0[2], J22 = v3[2] - v0[2];
  const detJ =
    J00 * (J11 * J22 - J12 * J21) -
    J01 * (J10 * J22 - J12 * J20) +
    J02 * (J10 * J21 - J11 * J20);
  const Ve = Math.abs(detJ) / 6;
  if (Ve < 1e-18) return null;
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
  const Ke = Array.from({ length: 12 }, () => new Float64Array(12));
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    let s = 0;
    for (let kk = 0; kk < 6; kk++) s += B[kk][i] * DB[kk][j];
    Ke[i][j] = Ve * s;
  }
  return Ke;
}

function buildD(E, nu) {
  const a = E / ((1 + nu) * (1 - 2 * nu));
  const D = Array.from({ length: 6 }, () => new Float64Array(6));
  D[0][0] = D[1][1] = D[2][2] = a * (1 - nu);
  D[0][1] = D[1][0] = D[0][2] = D[2][0] = D[1][2] = D[2][1] = a * nu;
  D[3][3] = D[4][4] = D[5][5] = a * (1 - 2 * nu) / 2;
  return D;
}

class SparseAssembly {
  constructor(n) {
    this.n = n;
    this.rows = Array.from({ length: n }, () => new Map());
  }
  reset() { for (const r of this.rows) r.clear(); }
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
  const tol = opts.tol ?? 1e-8;
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
 * Run SIMP topology optimization.
 *
 * @param {object} args
 * @param {TetMesh} args.mesh
 * @param {object} args.material - { E, nu }
 * @param {number[]} args.fixedNodes
 * @param {Array<{node, dof, value}>} args.loads
 * @param {number} args.volumeFraction - target V/V_total in [0..1]
 * @param {number} args.penalty - SIMP exponent (default 3)
 * @param {number} args.filterRadius - density filter radius (default 0)
 * @param {number} args.maxIter - outer iterations (default 50)
 * @param {number} args.tol - convergence on max|Δρ| (default 0.01)
 * @param {number} args.rhoMin - minimum density (default 1e-3)
 * @param {function} args.callback - per-iteration { iter, compliance, vol, maxDelta }
 * @returns {{ densities, compliance, history }}
 */
export function optimizeSIMP({
  mesh, material, fixedNodes, loads,
  volumeFraction = 0.4, penalty = 3,
  filterRadius = 0, maxIter = 50, tol = 0.01, rhoMin = 1e-3,
  callback,
}) {
  const numEl = mesh.tets.length;
  const numNodes = mesh.vertices.length;
  const ndof = numNodes * 3;

  const D = buildD(material.E, material.nu);
  const Ve = elementVolumes(mesh);
  const totalV = Ve.reduce((s, v) => s + v, 0);

  // Pre-compute element unit stiffness matrices (these don't change).
  const KeUnit = new Array(numEl);
  for (let e = 0; e < numEl; e++) KeUnit[e] = elementStiffnessUnit(mesh, e, D);

  // Density field — start at volume fraction.
  let rho = new Float64Array(numEl).fill(volumeFraction);

  // Optional filter
  let filterGraph = null;
  if (filterRadius > 0) filterGraph = buildNeighborGraph(mesh, filterRadius);

  // Build force vector (constant across iterations)
  const F = new Float64Array(ndof);
  for (const ld of loads) F[ld.node * 3 + ld.dof] += ld.value;

  // Penalty for Dirichlet BCs
  // We compute it once on K with all densities = 1 (worst case max diag).
  const Ktest = new SparseAssembly(ndof);
  for (let e = 0; e < numEl; e++) {
    if (!KeUnit[e]) continue;
    const tet = mesh.tets[e];
    for (let a = 0; a < 4; a++) for (let i = 0; i < 3; i++) {
      const I = tet[a] * 3 + i;
      for (let b = 0; b < 4; b++) for (let j = 0; j < 3; j++) {
        const J = tet[b] * 3 + j;
        const v = KeUnit[e][a * 3 + i][b * 3 + j];
        if (v !== 0) Ktest.add(I, J, v);
      }
    }
  }
  let maxDiag = 0;
  for (let i = 0; i < ndof; i++) maxDiag = Math.max(maxDiag, Ktest.diag(i));
  const PENALTY = 1e8 * maxDiag;

  const history = [];
  const K = new SparseAssembly(ndof);
  for (let outer = 0; outer < maxIter; outer++) {
    // Assemble K with ρ_e^p scaling
    K.reset();
    for (let e = 0; e < numEl; e++) {
      if (!KeUnit[e]) continue;
      const scale = Math.pow(rho[e], penalty);
      const tet = mesh.tets[e];
      for (let a = 0; a < 4; a++) for (let i = 0; i < 3; i++) {
        const I = tet[a] * 3 + i;
        for (let b = 0; b < 4; b++) for (let j = 0; j < 3; j++) {
          const J = tet[b] * 3 + j;
          const v = scale * KeUnit[e][a * 3 + i][b * 3 + j];
          if (v !== 0) K.add(I, J, v);
        }
      }
    }
    for (const fn of fixedNodes) {
      for (let d = 0; d < 3; d++) K.add(fn * 3 + d, fn * 3 + d, PENALTY);
    }

    // Solve K u = F
    const cg = pcg(K, F, { tol: 1e-7, maxIter: 8000 });
    const u = cg.x;

    // Compliance c = u · F (= u^T K u)
    let compliance = 0;
    for (let i = 0; i < ndof; i++) compliance += u[i] * F[i];

    // Element strain energies and sensitivities.
    // dc/dρ_e = -p · ρ_e^(p-1) · (u_e^T K_e_unit u_e)
    const dc = new Float64Array(numEl);
    for (let e = 0; e < numEl; e++) {
      if (!KeUnit[e]) { dc[e] = 0; continue; }
      const tet = mesh.tets[e];
      const ue = new Float64Array(12);
      for (let a = 0; a < 4; a++) {
        ue[a * 3]     = u[tet[a] * 3];
        ue[a * 3 + 1] = u[tet[a] * 3 + 1];
        ue[a * 3 + 2] = u[tet[a] * 3 + 2];
      }
      let strainE = 0;
      for (let i = 0; i < 12; i++) {
        let s = 0;
        for (let j = 0; j < 12; j++) s += KeUnit[e][i][j] * ue[j];
        strainE += ue[i] * s;
      }
      dc[e] = -penalty * Math.pow(Math.max(rho[e], rhoMin), penalty - 1) * strainE;
    }

    // Apply density filter to sensitivities (mesh independence, suppress checkerboard).
    const dcFiltered = filterGraph ? applyFilter(filterGraph.neighbors, dc) : dc;

    // OC update: bisect λ to satisfy volume constraint.
    let l1 = 1e-9, l2 = 1e9;
    const move = 0.2;   // max change per iteration
    let rhoNew = new Float64Array(numEl);
    while ((l2 - l1) / (l1 + l2) > 1e-3) {
      const lmid = 0.5 * (l1 + l2);
      let totalRhoV = 0;
      for (let e = 0; e < numEl; e++) {
        // B_e = -dc_e / λ; ρ_new = clip(ρ × sqrt(B), low, high) within move bounds
        const B_e = -dcFiltered[e] / Math.max(lmid * Ve[e], 1e-30);
        const target = rho[e] * Math.sqrt(Math.max(B_e, 0));
        const clamped = Math.max(rhoMin, Math.max(rho[e] - move,
                          Math.min(1, Math.min(rho[e] + move, target))));
        rhoNew[e] = clamped;
        totalRhoV += clamped * Ve[e];
      }
      // Constraint: totalRhoV ≤ volumeFraction × totalV
      if (totalRhoV - volumeFraction * totalV > 0) l1 = lmid;
      else l2 = lmid;
    }

    // Convergence check
    let maxDelta = 0;
    for (let e = 0; e < numEl; e++) {
      const d = Math.abs(rhoNew[e] - rho[e]);
      if (d > maxDelta) maxDelta = d;
    }
    rho = rhoNew;

    let totalRhoV = 0;
    for (let e = 0; e < numEl; e++) totalRhoV += rho[e] * Ve[e];
    const volFracActual = totalRhoV / totalV;
    history.push({ iter: outer, compliance, volFracActual, maxDelta, cgIters: cg.iterations });
    if (callback) callback({ iter: outer, compliance, volFracActual, maxDelta });

    if (maxDelta < tol) break;
  }

  return {
    densities: rho,
    compliance: history[history.length - 1]?.compliance ?? 0,
    history,
  };
}
