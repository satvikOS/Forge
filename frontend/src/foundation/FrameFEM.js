/**
 * ArchDisc Foundation — Welded-frame / space-frame FEM.
 *
 * 3D Euler-Bernoulli beam element with 6 DOF per node (3 translations
 * + 3 rotations) → 12 DOF per element. Captures axial, biaxial
 * bending, and torsion. The classical 12 × 12 LOCAL stiffness matrix
 * (Logan §8.2, Bathe §4.5):
 *
 *   K_local  =  diag-block stiffness in local axes (x = axial,
 *              y, z = principal bending axes), then transformed
 *              into global by  K_g = T^T K_l T   with T a 12 × 12
 *              block-diagonal of the 3 × 3 element rotation matrix.
 *
 * Sign convention follows right-hand rule with the local x-axis
 * along the member from node-i to node-j. The user supplies a
 * "reference up" vector (default world +Z) that the algorithm
 * orthogonalizes to define local y. If the member is parallel to
 * world Z, world +Y is used instead.
 *
 * Member properties:
 *   E, G    — Young's, shear modulus
 *   A       — cross-section area
 *   Iy, Iz  — second moments about local y and z axes
 *   J       — polar (torsional) constant
 *   ρ       — density (used by mass-matrix, future modal extension)
 *
 * Loads:
 *   - Concentrated forces and moments at nodes (6 components)
 *   - Distributed transverse load on a member (uniform w, in any
 *     direction) → equivalent nodal forces & moments per
 *     wL/2 + wL²/12 fixed-end formulas (Roark Table 8.1).
 *   - Distributed axial load (uniform p along local x).
 *
 * Boundary conditions:
 *   - Fixed (all 6 DOFs) — typical welded base plate
 *   - Pinned (all 3 translations fixed, rotations free) — bolt
 *     connection that allows rotation
 *   - Roller (single translation fixed) — slip-bearing
 *   - Free (no fixity)
 *
 * Validation in e2e:
 *   1. Cantilever 1 m, 100 N tip force → δ = PL³/(3EI)
 *   2. Cantilever 1 m, 1 kN·m tip torque → φ = TL/(GJ)
 *   3. Simply-supported beam, uniform w over span → δ_mid = 5wL⁴/(384EI)
 *   4. Portal frame with pinned base + uniform side load
 */

class SparseMatrix {
  constructor(n) {
    this.n = n;
    this.rows = Array.from({ length: n }, () => new Map());
  }
  add(i, j, v) {
    if (v === 0) return;
    const r = this.rows[i];
    r.set(j, (r.get(j) || 0) + v);
  }
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
  const tol = opts.tol ?? 1e-12;
  const maxIter = opts.maxIter ?? 50000;
  const n = b.length;
  const x = new Float64Array(n);
  const Minv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = A.diag(i);
    Minv[i] = (Math.abs(d) > 1e-30) ? 1 / d : 1;
  }
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
 * Compute the 3 × 3 element rotation matrix that takes vectors from
 * GLOBAL to LOCAL frame. Local x runs from node-i to node-j.
 */
function memberRotation(pi, pj, refUp = [0, 0, 1]) {
  const dx = pj[0] - pi[0], dy = pj[1] - pi[1], dz = pj[2] - pi[2];
  const L = Math.hypot(dx, dy, dz);
  if (L < 1e-12) throw new Error('Zero-length member');
  const ex = [dx / L, dy / L, dz / L];
  let up = refUp;
  // If member is parallel to refUp, swap to a different up vector.
  const dot = ex[0] * up[0] + ex[1] * up[1] + ex[2] * up[2];
  if (Math.abs(dot) > 0.999) up = [0, 1, 0];   // fallback
  // local z = unit(up - (up·ex) ex)
  const upDot = ex[0] * up[0] + ex[1] * up[1] + ex[2] * up[2];
  let ez = [up[0] - upDot * ex[0], up[1] - upDot * ex[1], up[2] - upDot * ex[2]];
  const ezLen = Math.hypot(ez[0], ez[1], ez[2]);
  ez = [ez[0] / ezLen, ez[1] / ezLen, ez[2] / ezLen];
  // local y = z × x
  const ey = [
    ez[1] * ex[2] - ez[2] * ex[1],
    ez[2] * ex[0] - ez[0] * ex[2],
    ez[0] * ex[1] - ez[1] * ex[0],
  ];
  // R rows are local axes expressed in global → R · v_global = v_local
  return { R: [ex, ey, ez], L };
}

/**
 * Local 12 × 12 stiffness for a 3D Euler-Bernoulli beam element,
 * with local x along the member.
 *
 * DOF order per node: [u_x, u_y, u_z, θ_x, θ_y, θ_z]
 * Element: [n_i (6 DOFs), n_j (6 DOFs)] = 12 DOFs total.
 */
function localBeamStiffness(L, E, G, A, Iy, Iz, J) {
  const K = Array.from({ length: 12 }, () => new Float64Array(12));
  const EA_L = E * A / L;
  const GJ_L = G * J / L;
  const EIz = E * Iz, EIy = E * Iy;
  const a = 12 * EIz / (L ** 3);
  const b = 6  * EIz / (L ** 2);
  const c = 4  * EIz /  L;
  const d = 2  * EIz /  L;
  const e = 12 * EIy / (L ** 3);
  const f = 6  * EIy / (L ** 2);
  const g = 4  * EIy /  L;
  const h = 2  * EIy /  L;

  // Axial (u_x at i, j) — DOFs 0, 6
  K[0][0] += EA_L;  K[0][6] -= EA_L;
  K[6][0] -= EA_L;  K[6][6] += EA_L;

  // Torsion (θ_x at i, j) — DOFs 3, 9
  K[3][3] += GJ_L;  K[3][9] -= GJ_L;
  K[9][3] -= GJ_L;  K[9][9] += GJ_L;

  // Bending about local z (motion in local-y plane) — DOFs 1, 5, 7, 11
  // K_block = [[a, b, -a, b], [b, c, -b, d], [-a, -b, a, -b], [b, d, -b, c]]
  const dofs_z = [1, 5, 7, 11];
  const K_z = [
    [ a,  b, -a,  b],
    [ b,  c, -b,  d],
    [-a, -b,  a, -b],
    [ b,  d, -b,  c],
  ];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
    K[dofs_z[i]][dofs_z[j]] += K_z[i][j];

  // Bending about local y (motion in local-z plane) — DOFs 2, 4, 8, 10
  // Sign flips on the off-diagonal because rotation about +y bends z- direction.
  const dofs_y = [2, 4, 8, 10];
  const K_y = [
    [ e, -f, -e, -f],
    [-f,  g,  f,  h],
    [-e,  f,  e,  f],
    [-f,  h,  f,  g],
  ];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
    K[dofs_y[i]][dofs_y[j]] += K_y[i][j];

  return K;
}

/**
 * Build the 12 × 12 transformation matrix from global to local DOFs.
 * The element rotation R is applied to each of the 4 vector
 * sub-components: [u_i, θ_i, u_j, θ_j].
 */
function buildT(R) {
  const T = Array.from({ length: 12 }, () => new Float64Array(12));
  for (let blk = 0; blk < 4; blk++) {
    const off = blk * 3;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        T[off + i][off + j] = R[i][j];
  }
  return T;
}

function transformK(Kl, T) {
  // K_g = T^T K_l T
  const KlT = Array.from({ length: 12 }, () => new Float64Array(12));
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) {
      let s = 0;
      for (let k = 0; k < 12; k++) s += Kl[i][k] * T[k][j];
      KlT[i][j] = s;
    }
  }
  const Kg = Array.from({ length: 12 }, () => new Float64Array(12));
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) {
      let s = 0;
      for (let k = 0; k < 12; k++) s += T[k][i] * KlT[k][j];
      Kg[i][j] = s;
    }
  }
  return Kg;
}

/**
 * Equivalent nodal loads from a uniformly distributed transverse
 * load (force per unit length) applied along a chosen GLOBAL
 * direction. Returns 12 nodal-load components in GLOBAL coordinates.
 *
 * Standard fixed-end formulas (Roark Table 8.1, reaction sign
 * convention chosen to push load INTO the structure):
 *
 *   Per perpendicular component q:
 *     end-shear  = q L / 2 (each end)
 *     end-moment = q L² / 12 (with opposite signs)
 *   Per axial component p (local-x):
 *     end-axial  = p L / 2 (each end), no moment
 */
function distributedLoadEquivalent(R, L, qGlobal) {
  // Convert global load vector to local components
  const qx = R[0][0] * qGlobal[0] + R[0][1] * qGlobal[1] + R[0][2] * qGlobal[2];
  const qy = R[1][0] * qGlobal[0] + R[1][1] * qGlobal[1] + R[1][2] * qGlobal[2];
  const qz = R[2][0] * qGlobal[0] + R[2][1] * qGlobal[1] + R[2][2] * qGlobal[2];

  // Build local 12-vector of equivalent nodal loads.
  // DOF order per node: [Fx, Fy, Fz, Mx, My, Mz]
  const fL = new Float64Array(12);
  // Axial (qx along local x) — split equally
  fL[0] += qx * L / 2;
  fL[6] += qx * L / 2;
  // Transverse local-y: equal shear, opposite moments about local-z
  fL[1]  += qy * L / 2;
  fL[5]  += qy * L * L / 12;       // M_z at i
  fL[7]  += qy * L / 2;
  fL[11] -= qy * L * L / 12;       // M_z at j
  // Transverse local-z: equal shear, opposite moments about local-y
  // (sign of moment opposite to that for y because of right-hand rule)
  fL[2]  += qz * L / 2;
  fL[4]  -= qz * L * L / 12;       // M_y at i
  fL[8]  += qz * L / 2;
  fL[10] += qz * L * L / 12;       // M_y at j

  // Transform to global: f_g = T^T f_l with T from buildT(R)
  const T = buildT(R);
  const fG = new Float64Array(12);
  for (let i = 0; i < 12; i++) {
    let s = 0;
    for (let k = 0; k < 12; k++) s += T[k][i] * fL[k];
    fG[i] = s;
  }
  return fG;
}

export class FrameModel {
  constructor() {
    this.nodes = [];      // [x, y, z]
    this.members = [];    // {ni, nj, section, material, refUp}
    this.bcs = [];        // {node, dofs: [bool×6], values: [×6]}
    this.nodalLoads = []; // {node, vec: [Fx, Fy, Fz, Mx, My, Mz]}
    this.distributedLoads = []; // {member, qGlobal: [qx, qy, qz]}
  }
  addNode(p) { this.nodes.push([...p]); return this.nodes.length - 1; }
  addMember(ni, nj, props) {
    this.members.push({
      ni, nj,
      section: props.section,        // {A, Iy, Iz, J}
      material: props.material,      // {E, G, rho?}
      refUp: props.refUp || [0, 0, 1],
    });
    return this.members.length - 1;
  }
  addFixedSupport(node) {
    this.bcs.push({ node, dofs: [true, true, true, true, true, true], values: [0, 0, 0, 0, 0, 0] });
  }
  addPinnedSupport(node) {
    this.bcs.push({ node, dofs: [true, true, true, false, false, false], values: [0, 0, 0, 0, 0, 0] });
  }
  addRollerSupport(node, lockedDof) {
    const dofs = [false, false, false, false, false, false];
    dofs[lockedDof] = true;
    this.bcs.push({ node, dofs, values: [0, 0, 0, 0, 0, 0] });
  }
  addNodalLoad(node, vec) {
    this.nodalLoads.push({ node, vec: [...vec] });
  }
  addDistributedLoad(member, qGlobal) {
    this.distributedLoads.push({ member, qGlobal: [...qGlobal] });
  }
}

export function solveFrame(model, options = {}) {
  const ndof = model.nodes.length * 6;
  const K = new SparseMatrix(ndof);
  const F = new Float64Array(ndof);

  const memberData = model.members.map(m => {
    const { R, L } = memberRotation(model.nodes[m.ni], model.nodes[m.nj], m.refUp);
    const { E, G } = m.material;
    const { A, Iy, Iz, J } = m.section;
    const Kl = localBeamStiffness(L, E, G, A, Iy, Iz, J);
    const T = buildT(R);
    const Kg = transformK(Kl, T);
    return { R, L, T, Kl, Kg, ni: m.ni, nj: m.nj };
  });

  for (const md of memberData) {
    const dofMap = [
      md.ni * 6 + 0, md.ni * 6 + 1, md.ni * 6 + 2, md.ni * 6 + 3, md.ni * 6 + 4, md.ni * 6 + 5,
      md.nj * 6 + 0, md.nj * 6 + 1, md.nj * 6 + 2, md.nj * 6 + 3, md.nj * 6 + 4, md.nj * 6 + 5,
    ];
    for (let i = 0; i < 12; i++)
      for (let j = 0; j < 12; j++)
        K.add(dofMap[i], dofMap[j], md.Kg[i][j]);
  }

  for (const ld of model.nodalLoads) {
    for (let d = 0; d < 6; d++) F[ld.node * 6 + d] += ld.vec[d];
  }
  for (const dl of model.distributedLoads) {
    const md = memberData[dl.member];
    const fG = distributedLoadEquivalent(md.R, md.L, dl.qGlobal);
    const dofMap = [
      md.ni * 6, md.ni * 6 + 1, md.ni * 6 + 2, md.ni * 6 + 3, md.ni * 6 + 4, md.ni * 6 + 5,
      md.nj * 6, md.nj * 6 + 1, md.nj * 6 + 2, md.nj * 6 + 3, md.nj * 6 + 4, md.nj * 6 + 5,
    ];
    for (let i = 0; i < 12; i++) F[dofMap[i]] += fG[i];
  }

  // Row-elimination Dirichlet
  const fixedSet = new Map();
  for (const bc of model.bcs) {
    for (let d = 0; d < 6; d++) {
      if (bc.dofs[d]) fixedSet.set(bc.node * 6 + d, bc.values[d]);
    }
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

  const cg = pcg(K, F, { tol: options.tol ?? 1e-12, maxIter: options.maxIter ?? 100000 });
  const u = cg.x;

  // Member-level forces (axial, shears, torsion, end-moments) in LOCAL
  // coordinates. These are what an engineer reads off a structural
  // calc sheet.
  const memberForces = memberData.map((md) => {
    const ue = new Float64Array(12);
    const dofMap = [
      md.ni * 6 + 0, md.ni * 6 + 1, md.ni * 6 + 2, md.ni * 6 + 3, md.ni * 6 + 4, md.ni * 6 + 5,
      md.nj * 6 + 0, md.nj * 6 + 1, md.nj * 6 + 2, md.nj * 6 + 3, md.nj * 6 + 4, md.nj * 6 + 5,
    ];
    for (let i = 0; i < 12; i++) ue[i] = u[dofMap[i]];
    // u_local = T · u_global
    const uL = new Float64Array(12);
    for (let i = 0; i < 12; i++) {
      let s = 0;
      for (let k = 0; k < 12; k++) s += md.T[i][k] * ue[k];
      uL[i] = s;
    }
    // f_local = K_local · u_local
    const fL = new Float64Array(12);
    for (let i = 0; i < 12; i++) {
      let s = 0;
      for (let k = 0; k < 12; k++) s += md.Kl[i][k] * uL[k];
      fL[i] = s;
    }
    return {
      length: md.L,
      Ni: -fL[0], Nj: fL[6],            // axial (tension positive at end-j)
      Vyi: fL[1], Vyj: -fL[7],          // shear in local y
      Vzi: fL[2], Vzj: -fL[8],          // shear in local z
      Ti:  -fL[3], Tj: fL[9],           // torsion
      Myi: -fL[4], Myj: fL[10],         // bending moment about local y
      Mzi: -fL[5], Mzj: fL[11],         // bending moment about local z
    };
  });

  return {
    displacement: u,
    memberForces,
    cgIterations: cg.iterations,
    cgResidual: cg.residualNorm,
  };
}

/**
 * Standard cross-section library — values in mm units.
 * For a square box tube h×w with wall t the full closed-form values
 * are used (no thin-wall approximations).
 */
export const Sections = {
  rectangle(b, h) {
    return {
      A: b * h,
      Iz: (b * h ** 3) / 12,
      Iy: (h * b ** 3) / 12,
      // Saint-Venant torsional constant, Roark Table 10.2 case 1
      J: rectangleJ(b, h),
    };
  },
  circle(r) {
    const A = Math.PI * r * r;
    const I = Math.PI * (r ** 4) / 4;
    return { A, Iy: I, Iz: I, J: 2 * I };
  },
  pipe(rOuter, rInner) {
    const A = Math.PI * (rOuter * rOuter - rInner * rInner);
    const I = Math.PI * (rOuter ** 4 - rInner ** 4) / 4;
    return { A, Iy: I, Iz: I, J: 2 * I };
  },
  squareTube(b, t) {
    const bo = b, bi = b - 2 * t;
    const A = bo * bo - bi * bi;
    const Iz = (bo ** 4 - bi ** 4) / 12;
    return {
      A,
      Iz, Iy: Iz,
      // Closed thin-wall torsion: J = 4 A_m² t / s where A_m = (b - t)²,  s = 4(b - t)
      J: 4 * ((b - t) ** 2) ** 2 * t / (4 * (b - t)),
    };
  },
};

function rectangleJ(b, h) {
  // Saint-Venant torsion constant for a rectangle, from the series
  // J = α b h³ where α depends on the aspect ratio (Roark Table 10.2)
  const a = Math.max(b, h) / 2;
  const c = Math.min(b, h) / 2;
  // β series coefficient (5-term Roark)
  const ratio = c / a;
  const beta = (1 / 3) - 0.21 * ratio * (1 - ratio ** 4 / 12);
  // J = β · (2a)(2c)³ when c < a
  return beta * 16 * a * (c ** 3);
}
