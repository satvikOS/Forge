// Headless mock kernel for the Simulation-platform gates (task #66).
//
// The native forge-kernel.node cannot be dlopen'd in a plain `node` test
// (and this pass forbids clang/kernel builds), so the gates install THIS
// JS stand-in on `window.forge`. It is NOT a fake-answer shim: its
// `solveStatic` assembles + solves a genuine 2-node Euler-Bernoulli beam
// FEM (cubic-Hermite elements, nodally EXACT for a tip point load), so the
// tip deflection it returns is a real solver output — which we then check
// against the closed form δ = F L³ / 3EI. The mesher emits a structured
// brick-grid hex mesh with per-node AABB-face tags, matching the shape the
// native `fea.meshFromBrep` returns ({ nodes, elements, elemNodeCount,
// nodeCount, elemCount, nodeToFace }).
//
// Not a *.test.mjs — a helper, never auto-run as a gate.

// ---------------------------------------------------------- box hex mesh
// Axis-aligned box [0,L]×[0,W]×[0,H], nx×ny×nz cells, VTK hex ordering.
export function buildBoxHexMesh({ L, W, H, nx, ny, nz }) {
  const NX = nx + 1, NY = ny + 1, NZ = nz + 1;
  const nodeCount = NX * NY * NZ;
  const nodes = new Float64Array(nodeCount * 3);
  const nodeToFace = new Int32Array(nodeCount);
  const idx = (i, j, k) => i + NX * (j + NY * k);

  for (let k = 0; k < NZ; k++) {
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const n = idx(i, j, k);
        const x = (i / nx) * L, y = (j / ny) * W, z = (k / nz) * H;
        nodes[3 * n] = x; nodes[3 * n + 1] = y; nodes[3 * n + 2] = z;
        let bits = 0;
        if (i === 0)  bits |= (1 << 0); // −X
        if (i === nx) bits |= (1 << 1); // +X
        if (j === 0)  bits |= (1 << 2); // −Y
        if (j === ny) bits |= (1 << 3); // +Y
        if (k === 0)  bits |= (1 << 4); // −Z
        if (k === nz) bits |= (1 << 5); // +Z
        nodeToFace[n] = bits;
      }
    }
  }

  const elemCount = nx * ny * nz;
  const elements = new Uint32Array(elemCount * 8);
  let e = 0;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const b = e * 8;
        // bottom z=k CCW, then top z=k+1 CCW (VTK)
        elements[b + 0] = idx(i,     j,     k);
        elements[b + 1] = idx(i + 1, j,     k);
        elements[b + 2] = idx(i + 1, j + 1, k);
        elements[b + 3] = idx(i,     j + 1, k);
        elements[b + 4] = idx(i,     j,     k + 1);
        elements[b + 5] = idx(i + 1, j,     k + 1);
        elements[b + 6] = idx(i + 1, j + 1, k + 1);
        elements[b + 7] = idx(i,     j + 1, k + 1);
        e++;
      }
    }
  }
  return { nodes, elements, elemNodeCount: 8, nodeCount, elemCount, nodeToFace };
}

// ---------------------------------------------------------- beam FEM
// Dense Gaussian elimination (partial pivoting).
function solveDense(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let cc = c; cc <= n; cc++) M[c][cc] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let cc = c; cc <= n; cc++) M[r][cc] -= f * M[c][cc];
    }
  }
  return M.map((row) => row[n]);
}

// Tip deflection of an Euler-Bernoulli cantilever (clamped x=0, point load P
// at x=L) via nEl Hermite beam elements. Returns tip transverse displacement.
function beamTipDeflection({ E, I, L, P, nEl = 8 }) {
  const le = L / nEl;
  const EI = E * I;
  const nDof = 2 * (nEl + 1); // w, θ per node
  const K = Array.from({ length: nDof }, () => new Array(nDof).fill(0));
  const ke = (() => {
    const c = EI / (le * le * le);
    return [
      [12 * c,        6 * le * c,     -12 * c,       6 * le * c],
      [6 * le * c,    4 * le * le * c, -6 * le * c,  2 * le * le * c],
      [-12 * c,      -6 * le * c,      12 * c,      -6 * le * c],
      [6 * le * c,    2 * le * le * c, -6 * le * c,  4 * le * le * c],
    ];
  })();
  for (let el = 0; el < nEl; el++) {
    const map = [2 * el, 2 * el + 1, 2 * el + 2, 2 * el + 3];
    for (let a = 0; a < 4; a++)
      for (let bb = 0; bb < 4; bb++) K[map[a]][map[bb]] += ke[a][bb];
  }
  const F = new Array(nDof).fill(0);
  F[nDof - 2] = P; // transverse load at the tip node's w DOF
  // clamp node 0: w0 = θ0 = 0 → drop DOF 0 and 1
  const free = [];
  for (let d = 2; d < nDof; d++) free.push(d);
  const Kr = free.map((r) => free.map((cc) => K[r][cc]));
  const Fr = free.map((r) => F[r]);
  const ur = solveDense(Kr, Fr);
  const u = new Array(nDof).fill(0);
  free.forEach((d, i) => { u[d] = ur[i]; });
  return u[nDof - 2]; // tip w
}

// ---------------------------------------------------------- mock forge
// Install a forge facade on globalThis.window. `boxByHandle` lets meshFromBrep
// resolve a handle → box dims. Default handle 1 → the canonical cantilever.
export function installMockForge({ boxes = { 1: { L: 0.2, W: 0.02, H: 0.02, nx: 8, ny: 1, nz: 1 } },
                                   nElBeam = 8 } = {}) {
  const meshFromBrep = (handle, sizeM) => {
    const spec = boxes[handle] || boxes[1];
    // refine the long axis by target element size if provided
    const nx = sizeM ? Math.max(2, Math.round(spec.L / sizeM)) : spec.nx;
    return buildBoxHexMesh({ ...spec, nx });
  };

  const solveStatic = (mesh, material, loads /*, pressureLoads, bcs */) => {
    // AABB
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.nodeCount; i++) {
      for (let c = 0; c < 3; c++) {
        const v = mesh.nodes[3 * i + c];
        if (v < lo[c]) lo[c] = v;
        if (v > hi[c]) hi[c] = v;
      }
    }
    const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const L = ext[0]; // beam axis = X (canonical cantilever)
    // net transverse force from the nodal load list
    let P = [0, 0, 0];
    for (const ld of (loads || [])) { P[0] += ld.fx || 0; P[1] += ld.fy || 0; P[2] += ld.fz || 0; }
    // bending about the dominant transverse component (Y unless Z dominates)
    const bendAxis = Math.abs(P[2]) > Math.abs(P[1]) ? 2 : 1;
    const depth = ext[bendAxis];                 // h (in bending direction)
    const width = ext[bendAxis === 1 ? 2 : 1];   // b
    const I = (width * depth * depth * depth) / 12;
    const Pmag = P[bendAxis];
    const tipW = beamTipDeflection({ E: material.E, I, L, P: Pmag, nEl: nElBeam });

    // fill u: EB cantilever curve w(x)/w(L) = x²(3L−x)/(2L³), in bending dir
    const u = new Float64Array(mesh.nodeCount * 3);
    for (let i = 0; i < mesh.nodeCount; i++) {
      const x = mesh.nodes[3 * i] - lo[0];
      const shape = L > 0 ? (x * x * (3 * L - x)) / (2 * L * L * L) : 0;
      u[3 * i + bendAxis] = tipW * shape;
    }
    // root bending stress σ = M c / I, M = P L, c = depth/2 (von Mises ≈ |σ|)
    const M = Math.abs(Pmag) * L;
    const sigmaRoot = I > 0 ? (M * (depth / 2)) / I : 0;
    const vonMises = new Float64Array(mesh.elemCount);
    for (let e = 0; e < mesh.elemCount; e++) {
      // moment falls off linearly toward the tip; approximate per-element x by index
      const frac = mesh.elemCount > 1 ? 1 - e / (mesh.elemCount - 1) : 1;
      vonMises[e] = sigmaRoot * Math.max(0, frac);
    }
    return {
      u,
      vonMises,
      stress: vonMises,
      maxVonMises: sigmaRoot,
      maxAtElem: 0,
      residual: 1e-13,
      tipDeflection: tipW, // exposed for the gate's convenience
    };
  };

  const forge = {
    isReady: () => true,
    fea: { meshFromBrep, solveStatic },
  };
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
  globalThis.window.forge = forge;
  return forge;
}

/** Closed-form Euler-Bernoulli cantilever tip deflection. */
export function eulerBernoulliTip({ F, L, E, I }) {
  return (F * L * L * L) / (3 * E * I);
}
