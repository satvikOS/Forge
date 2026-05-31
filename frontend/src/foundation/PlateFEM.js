/**
 * ArchDisc Foundation — Plate / thin-shell bending FEM via 3D solid.
 *
 * Closes the thin-walled FEM gap by meshing a plate as a thin 3D
 * slab and reusing the validated quadratic-tet solver (M41).
 *
 * Why this approach over a dedicated 2D plate element:
 *   - Quadratic-tet captures bending without shear locking (-1.4 %
 *     vs Euler-Bernoulli on the canonical cantilever, see M41).
 *   - One code path for plates and solids → no double-validation.
 *   - Boundary conditions are natural (fix nodes on edges, apply
 *     pressure on top face).
 *
 * Trade-off: ~3-5× more DOFs than a dedicated DKT element at
 * equivalent accuracy. Acceptable for the thin-walled aerospace
 * components (combustor liners, nacelle skin, sheet weldments)
 * we're targeting — they fit comfortably in the 100K-DOF JS budget.
 *
 * API mirrors the other plate FEM tools so the ribbon "Plate FEA"
 * handler can call it without conditionals.
 */

import { TetMesh } from './TetMesh.js';
import { QuadraticTetMesh } from './QuadraticTetMesh.js';
import { solveLinearStaticQuadTet } from './QuadTetFEM.js';

/** Plate flexural rigidity D = E h³ / (12 (1 − ν²)). */
export function plateRigidity(E, nu, h) {
  return (E * h ** 3) / (12 * (1 - nu * nu));
}

/**
 * Build a thin-slab tet mesh for a rectangular plate.
 * Plate lies in the XY plane with thickness h along +Z.
 */
function buildSlabMesh(L, W, h, nx, ny, nz = 1) {
  return TetMesh.regularGrid([0, 0, 0], [L, W, h], nx, ny, nz);
}

/**
 * Solve a flat rectangular plate-bending problem.
 *
 * Convention:
 *   - Plate in XY, thickness along Z (length h).
 *   - "w" = transverse deflection = displacement Z component at the
 *     midplane (we read it at z = h/2 nodes).
 *   - "Simply-supported" = fix Z-displacement on the 4 edges of the
 *     midplane.
 *   - "Clamped" = fix Z-displacement AND tangential X/Y on the entire
 *     edge cross-section (top + bottom).
 *
 * @param {object} args
 * @param {number} args.L          plate length (mm)
 * @param {number} args.W          plate width  (mm)
 * @param {number} args.thickness  h            (mm)
 * @param {object} args.material   { E, nu, yieldStrength? }
 * @param {string} args.boundary   'simply-supported' | 'clamped'
 * @param {number} args.uniformPressure  q (MPa, +Z applied on top face)
 * @param {object} args.options    { nx, ny, nz, ...solver opts }
 * @returns {{ wMaxAbs, wMaxAt, displacement, mesh, ... }}
 */
export function solvePlate({
  L, W, thickness, material,
  boundary = 'simply-supported',
  uniformPressure = 0,
  options = {},
}) {
  const nx = options.nx ?? Math.max(8, Math.round(L / 10));
  const ny = options.ny ?? Math.max(8, Math.round(W / 10));
  const nz = options.nz ?? 1;
  const linMesh = buildSlabMesh(L, W, thickness, nx, ny, nz);
  const mesh = QuadraticTetMesh.fromLinearTetMesh(linMesh);

  const TOL = 1e-6;
  const onEdge = (x, y) =>
    x < TOL || y < TOL || Math.abs(x - L) < TOL || Math.abs(y - W) < TOL;

  // Build BC lists. Simply-supported = Z-only fixity on edges (with
  // small in-plane stabilization at one corner to prevent rigid-body
  // translation in X-Y). Clamped = all 3 DOFs on edge cross-section.
  const fixed = [];          // whole-node clamps
  const fixedDofs = [];      // per-DOF (used for SS Z-only)
  if (boundary === 'simply-supported') {
    // Z-only fixity on every edge node
    for (let i = 0; i < mesh.vertices.length; i++) {
      const [x, y] = mesh.vertices[i];
      if (onEdge(x, y)) fixedDofs.push({ node: i, dof: 2, value: 0 });
    }
    // RBM stabilization: pin one corner in X-Y
    const corner = mesh.vertices.findIndex(([x, y, z]) =>
      x < TOL && y < TOL && z < TOL);
    if (corner >= 0) {
      fixedDofs.push({ node: corner, dof: 0, value: 0 });
      fixedDofs.push({ node: corner, dof: 1, value: 0 });
    }
    // RBM rotation about Z: pin Y at the +X / 0 corner
    const xAxis = mesh.vertices.findIndex(([x, y, z]) =>
      Math.abs(x - L) < TOL && y < TOL && z < TOL);
    if (xAxis >= 0) {
      fixedDofs.push({ node: xAxis, dof: 1, value: 0 });
    }
  } else if (boundary === 'clamped') {
    for (let i = 0; i < mesh.vertices.length; i++) {
      const [x, y] = mesh.vertices[i];
      if (onEdge(x, y)) fixed.push(i);
    }
  }

  // Distributed pressure → equivalent nodal Z forces on top face
  // (z = thickness). Node area share = (L/nx)(W/ny) / (1 corner per
  // grid quad, but mid-edge nodes contribute too — use a simple
  // tributary area weighting based on x,y coords falling inside the
  // top face).
  const loads = [];
  if (uniformPressure !== 0) {
    const topNodes = [];
    for (let i = 0; i < mesh.vertices.length; i++) {
      if (Math.abs(mesh.vertices[i][2] - thickness) < TOL) topNodes.push(i);
    }
    // Equal share — coarse but fine for a uniform-pressure benchmark.
    const totalForce = uniformPressure * L * W;
    const fPer = totalForce / topNodes.length;
    for (const n of topNodes) loads.push({ node: n, dof: 2, value: fPer });
  }

  const r = solveLinearStaticQuadTet({
    mesh, material, fixedNodes: fixed, fixedDofs, loads, options,
  });

  // Find midplane Z-deflection at center
  let wMaxAbs = 0, wMaxAt = -1;
  for (let i = 0; i < mesh.vertices.length; i++) {
    const [x, y, z] = mesh.vertices[i];
    if (Math.abs(z - thickness / 2) > TOL) continue;
    const w = r.displacement[i * 3 + 2];
    if (Math.abs(w) > Math.abs(wMaxAbs)) { wMaxAbs = w; wMaxAt = i; }
  }
  // Fallback if mesh has no midplane node (nz=1 doesn't): use top
  if (wMaxAt < 0) {
    for (let i = 0; i < mesh.vertices.length; i++) {
      const [x, y, z] = mesh.vertices[i];
      if (Math.abs(z - thickness) > TOL) continue;
      const w = r.displacement[i * 3 + 2];
      if (Math.abs(w) > Math.abs(wMaxAbs)) { wMaxAbs = w; wMaxAt = i; }
    }
  }

  return {
    wMax: wMaxAbs,
    wMaxNode: wMaxAt,
    nodeCount: mesh.vertices.length,
    elementCount: mesh.tets.length,
    cgIterations: r.cgIterations,
    cgResidual: r.cgResidual,
    maxStress: r.maxStress,
    displacement: r.displacement,
    mesh,
  };
}
