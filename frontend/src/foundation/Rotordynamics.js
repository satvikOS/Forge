/**
 * ArchDisc Foundation — 1D rotordynamics (shaft + disks + bearings).
 *
 * Computes lateral natural frequencies and Campbell diagrams for
 * rotor systems built from:
 *   - A flexible shaft (Euler-Bernoulli beam, axisymmetric)
 *   - Concentrated rigid disks (mass + polar/transverse inertia)
 *   - Bearing supports (linear stiffness in lateral DOFs)
 *
 * The shaft is discretised as a 1D mesh of Euler-Bernoulli beam
 * elements with 4 lateral DOFs per node (translation x, y +
 * rotation about x, y). Axial and torsional DOFs are not included
 * because lateral whirl dominates rotordynamic critical speeds.
 *
 * For each spin speed Ω, gyroscopic moments couple the planes.
 * Equation of motion (linearised about the spinning equilibrium):
 *
 *      M ü + (C - Ω G) u̇ + K u = f
 *
 * For undamped rotordynamics we solve the quadratic eigenproblem
 *      (K - ω² M - i ω Ω G) φ = 0
 * which decouples into forward and backward whirl branches whose
 * frequencies vary with Ω. The Campbell diagram plots ω(Ω) for
 * each mode and the synchronous excitation line ω = Ω. Crossings
 * mark critical speeds.
 *
 * For a first cut we drop gyroscopic coupling (G = 0) and report
 * the non-rotating natural frequencies — the lowest of which gives
 * the synchronous critical speed (Ω_cr ≈ ω_1) for a balanced rotor.
 * This is the standard "Jeffcott rotor" approximation and matches
 * textbook references for design-stage analysis.
 *
 * Reference: Childs, "Turbomachinery Rotordynamics with Case
 * Studies", Wiley 2013, Chapters 3-5.
 *
 * Validation:
 *   1. Single-disk Jeffcott rotor on a uniform shaft, simply
 *      supported at the ends: Ω_cr = √(k/m) where k = 48 EI / L³
 *      (mid-span point stiffness for a simply-supported beam).
 *   2. Cantilever shaft with tip mass: Ω_cr = √(3 EI / (m L³))
 */

const PI = Math.PI;

// Sparse-matrix utility (small problems — dense is fine here)
function denseMatVec(A, x, y) {
  const n = A.length;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += A[i][j] * x[j];
    y[i] = s;
  }
  return y;
}

/**
 * Build mass + stiffness matrices for an Euler-Bernoulli beam
 * element of length L, area A, density ρ, second moment I, modulus E
 * with 4 lateral DOFs per node: [v, θ_v, w, θ_w]_i where v and w are
 * the two lateral displacements (x and y planes).
 *
 * For pure-bending Euler-Bernoulli the two planes decouple, so the
 * 8×8 element matrix is block-diagonal in 2 copies of the standard
 * 4×4 beam matrix.
 */
function elementBeamMatrices(L, E, I, rho, A) {
  const k4 = (E * I / (L * L * L)) * [
    [12,    6 * L,    -12,    6 * L],
    [6 * L,  4 * L * L, -6 * L,  2 * L * L],
    [-12,   -6 * L,    12,    -6 * L],
    [6 * L,  2 * L * L, -6 * L,  4 * L * L],
  ].length;
  // Use scalar-times-matrix
  const sK = E * I / (L * L * L);
  const Klocal4 = [
    [12 * sK,           6 * L * sK,        -12 * sK,         6 * L * sK],
    [6 * L * sK,        4 * L * L * sK,    -6 * L * sK,      2 * L * L * sK],
    [-12 * sK,          -6 * L * sK,        12 * sK,         -6 * L * sK],
    [6 * L * sK,        2 * L * L * sK,    -6 * L * sK,      4 * L * L * sK],
  ];
  // Consistent mass matrix (Euler-Bernoulli)
  const sM = rho * A * L / 420;
  const Mlocal4 = [
    [156 * sM,           22 * L * sM,        54 * sM,         -13 * L * sM],
    [22 * L * sM,        4 * L * L * sM,     13 * L * sM,     -3 * L * L * sM],
    [54 * sM,            13 * L * sM,        156 * sM,        -22 * L * sM],
    [-13 * L * sM,       -3 * L * L * sM,    -22 * L * sM,    4 * L * L * sM],
  ];
  return { Klocal4, Mlocal4 };
}

/**
 * Build the shaft global K and M (no disks, no bearings).
 * Returns 4(N+1) × 4(N+1) matrices.
 *
 *   DOF order per node i: [u_x, θ_y, u_y, θ_x]
 *   ('x' plane uses u_x with rotation about y; 'y' plane uses u_y
 *    with rotation about -x. The two planes decouple in pure bending.)
 *
 * @param {object} args
 * @param {number} args.length      shaft length (mm)
 * @param {number} args.diameter    shaft diameter (mm)
 * @param {number} args.E           Young's modulus (MPa)
 * @param {number} args.density     kg / mm³
 * @param {number} args.elements    element count along the shaft
 */
function buildShaftMatrices({ length, diameter, E, density, elements }) {
  const N = elements;
  const L = length / N;
  const A = PI * (diameter / 2) ** 2;
  const I = PI * (diameter / 2) ** 4 / 4;
  const ndof = 4 * (N + 1);
  const K = Array.from({ length: ndof }, () => new Float64Array(ndof));
  const M = Array.from({ length: ndof }, () => new Float64Array(ndof));
  const { Klocal4, Mlocal4 } = elementBeamMatrices(L, E, I, density, A);
  for (let e = 0; e < N; e++) {
    const i = e, j = e + 1;
    // x-plane DOFs: u_x at node i = i*4, θ_y at i*4+1, u_x at j = j*4, θ_y at j*4+1
    const xdof = [i * 4, i * 4 + 1, j * 4, j * 4 + 1];
    const ydof = [i * 4 + 2, i * 4 + 3, j * 4 + 2, j * 4 + 3];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      K[xdof[a]][xdof[b]] += Klocal4[a][b];
      K[ydof[a]][ydof[b]] += Klocal4[a][b];
      M[xdof[a]][xdof[b]] += Mlocal4[a][b];
      M[ydof[a]][ydof[b]] += Mlocal4[a][b];
    }
  }
  return { K, M, N, L, A, I };
}

/**
 * Solve a rotordynamics problem.
 *
 * @param {object} args
 * @param {object} args.shaft   - { length, diameter, E, density, elements }
 * @param {Array<{ position, mass, polarInertia?, transverseInertia? }>} args.disks
 *           position = mm from station 0; mass kg; inertias kg·mm²
 * @param {Array<{ position, kxx, kyy }>} args.bearings
 *           bearing stiffness in N/mm (lateral only)
 * @param {string=} args.boundary   'simply-supported' | 'cantilever' | 'free'
 * @param {number=} args.numModes   how many natural frequencies to return
 * @returns {{ frequenciesHz, criticalSpeedRPM, modeShapes, ndof }}
 */
export function solveRotordynamics({
  shaft, disks = [], bearings = [],
  boundary = 'simply-supported', numModes = 6,
}) {
  const { K, M, N, L } = buildShaftMatrices(shaft);
  const ndof = 4 * (N + 1);

  // Add disk masses + transverse inertias as concentrated terms on
  // the nearest node. (More accurate: linear interpolation between
  // adjacent stations.)
  for (const d of disks) {
    const station = Math.round(d.position / L);
    const idx = Math.max(0, Math.min(N, station));
    M[idx * 4][idx * 4]         += d.mass;
    M[idx * 4 + 2][idx * 4 + 2] += d.mass;
    if (d.transverseInertia) {
      M[idx * 4 + 1][idx * 4 + 1] += d.transverseInertia;
      M[idx * 4 + 3][idx * 4 + 3] += d.transverseInertia;
    }
  }
  // Add bearing stiffnesses (lateral only)
  for (const b of bearings) {
    const station = Math.round(b.position / L);
    const idx = Math.max(0, Math.min(N, station));
    K[idx * 4][idx * 4]         += b.kxx;
    K[idx * 4 + 2][idx * 4 + 2] += b.kyy;
  }

  // Apply Dirichlet BCs based on boundary type
  const fixed = new Set();
  if (boundary === 'simply-supported') {
    // Pin both ends in lateral translation (rotations free)
    fixed.add(0);              // u_x at left
    fixed.add(2);              // u_y at left
    fixed.add(N * 4);          // u_x at right
    fixed.add(N * 4 + 2);      // u_y at right
  } else if (boundary === 'cantilever') {
    // Fix all 4 DOFs at left
    for (let d = 0; d < 4; d++) fixed.add(d);
  }
  // Apply via penalty method (avoid row deletion which would shift indices)
  let maxK = 0;
  for (let i = 0; i < ndof; i++) maxK = Math.max(maxK, K[i][i]);
  const penalty = 1e8 * Math.max(maxK, 1);
  for (const d of fixed) K[d][d] += penalty;

  // Generalized eigenvalue problem K φ = ω² M φ.
  // For small (ndof < 100) we just convert to standard form
  // M⁻¹ K φ = ω² φ with M lumped — but here M has off-diagonal
  // (consistent), so we use Cholesky-style: solve M = L L^T then
  // L⁻¹ K L⁻ᵀ φ = ω² φ.
  // For simplicity at this size we use power-iteration on M⁻¹K
  // for the lowest few eigenvalues.
  const freqs = [];
  const modes = [];
  // Inverse iteration on (K, M)
  for (let modeIdx = 0; modeIdx < numModes; modeIdx++) {
    const x = lowestEigvec(K, M, modes, ndof);
    if (!x) break;
    // Rayleigh quotient
    const Kx = new Float64Array(ndof);
    const Mx = new Float64Array(ndof);
    denseMatVec(K, x, Kx);
    denseMatVec(M, x, Mx);
    let num = 0, den = 0;
    for (let i = 0; i < ndof; i++) { num += x[i] * Kx[i]; den += x[i] * Mx[i]; }
    const lambda = num / Math.max(den, 1e-30);
    if (lambda <= 0) continue;
    const omega = Math.sqrt(lambda);
    const fHz = omega / (2 * PI);
    freqs.push(fHz);
    modes.push(x);
  }
  // First lateral natural frequency = synchronous critical speed
  const f1 = freqs[0] || 0;
  const criticalSpeedRPM = f1 * 60;
  return { frequenciesHz: freqs, criticalSpeedRPM, modeShapes: modes, ndof };
}

/**
 * Find the lowest eigenvector of (K, M) orthogonal to the previously-
 * found modes (deflation). Uses inverse iteration with shift = 0.
 */
function lowestEigvec(K, M, prevModes, ndof) {
  // Solve K y = M x repeatedly. Use Gauss elimination (small ndof).
  // To keep this self-contained we copy K and do partial-pivot LU
  // once outside the loop.
  const n = ndof;
  // Decompose K once (LU with partial pivot)
  const A = K.map(row => Array.from(row));
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[p][k])) p = i;
    if (p !== k) { [A[k], A[p]] = [A[p], A[k]]; [piv[k], piv[p]] = [piv[p], piv[k]]; }
    if (Math.abs(A[k][k]) < 1e-30) return null;
    for (let i = k + 1; i < n; i++) {
      const f = A[i][k] / A[k][k];
      A[i][k] = f;
      for (let j = k + 1; j < n; j++) A[i][j] -= f * A[k][j];
    }
  }
  function solveLU(b) {
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) r[i] = b[piv[i]];
    for (let i = 1; i < n; i++) {
      let s = r[i];
      for (let j = 0; j < i; j++) s -= A[i][j] * r[j];
      r[i] = s;
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = r[i];
      for (let j = i + 1; j < n; j++) s -= A[i][j] * r[j];
      r[i] = s / A[i][i];
    }
    return r;
  }
  // Random initial guess orthogonalized against prev modes (M-orthogonal)
  let x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.random() - 0.5;
  for (let it = 0; it < 100; it++) {
    // Deflate against prev modes:  x ← x - Σ ((x^T M φ_k) / (φ_k^T M φ_k)) φ_k
    for (const pm of prevModes) {
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) {
        let mxi = 0;
        for (let j = 0; j < n; j++) mxi += M[i][j] * pm[j];
        num += x[i] * mxi;
        den += pm[i] * mxi;
      }
      if (Math.abs(den) > 1e-30) {
        const c = num / den;
        for (let i = 0; i < n; i++) x[i] -= c * pm[i];
      }
    }
    // y = K⁻¹ M x
    const Mx = new Float64Array(n);
    denseMatVec(M, x, Mx);
    const y = solveLU(Mx);
    // Normalize wrt M
    let mn = 0;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += M[i][j] * y[j];
      mn += y[i] * s;
    }
    mn = Math.sqrt(Math.max(mn, 1e-30));
    for (let i = 0; i < n; i++) x[i] = y[i] / mn;
  }
  return x;
}

/**
 * Compute a Campbell diagram (frequency vs spin speed) by sampling.
 * For a non-gyroscopic system frequencies are constant in Ω; this
 * still produces useful "synchronous excitation" crossings.
 *
 * @param {object} args  same as solveRotordynamics + { rpmRange: [lo, hi], steps }
 * @returns {{
 *   rpms: number[],
 *   frequencies: number[][],   // frequencies[mode][rpm]
 *   criticalSpeedsRPM: number[],
 * }}
 */
export function campbellDiagram(args) {
  const { rpmRange = [0, 30000], steps = 31 } = args;
  const sol = solveRotordynamics(args);
  const freqs = sol.frequenciesHz;
  const rpms = [];
  const frequencies = freqs.map(() => []);
  for (let s = 0; s < steps; s++) {
    const rpm = rpmRange[0] + (rpmRange[1] - rpmRange[0]) * s / (steps - 1);
    rpms.push(rpm);
    for (let m = 0; m < freqs.length; m++) frequencies[m].push(freqs[m]);
  }
  // Critical speeds: where mode-frequency line crosses synchronous line
  // (ω = Ω), i.e. f_mode (Hz) = rpm / 60.
  const criticalSpeedsRPM = freqs.map(f => f * 60);
  return { rpms, frequencies, criticalSpeedsRPM };
}
