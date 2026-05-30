/**
 * TopoCantilever — wraps the foundation SIMP solver for the most
 * common topology-optimisation use case: a rectangular design domain
 * with one face fixed and a downward point load on the opposite face.
 * This is the canonical "cantilever beam" benchmark — and visually the
 * most striking output (the optimiser carves an organic truss out of
 * the design box).
 *
 * The handler in ToolExecutionEngine wraps this to produce a watertight
 * Manifold by feeding the per-cube density field into Manifold.levelSet.
 * This module is pure foundation + does not pull manifold-3d itself, so
 * it can be unit-tested in Node without WASM.
 *
 * Boundary conditions:
 *   - Fixed: every node on the −X face (x ≤ ε).
 *   - Load:  every node within one cell of (+X, mid-Y, mid-Z), each
 *            taking an equal share of the total downward (−Y) force.
 *
 * Returns the per-tet density field straight from optimizeSIMP plus a
 * per-cube aggregate (mean of the 6 Kuhn tets per cube) so the caller
 * can build an SDF at the cube grid.
 */

import { TetMesh } from './TetMesh.js';
import { optimizeSIMP } from './TopologyOptimization.js';

const STEEL = { E: 210e3, nu: 0.3 };                   // N/mm² (MPa), unitless

/**
 * Run a SIMP cantilever optimisation on a W×H×T design box at nx×ny×nz
 * cells. The total downward load is split across all nodes within the
 * load patch on the +X face. Returns:
 *   {
 *     mesh,                  // TetMesh
 *     nx, ny, nz,            // grid shape
 *     dx, dy, dz,            // cell size (mm)
 *     densitiesTet,          // Float64Array per tet
 *     densitiesCube,         // Float64Array per cube (mean of 6 tets)
 *     compliance,            // final compliance (∝ strain energy)
 *     iterations,            // outer iterations actually run
 *     fixedNodes, loadNodes, // diagnostic
 *     elapsedMs,
 *   }
 */
export function runCantileverSIMP({
  W = 60, H = 40, T = 30,
  nx = 12, ny = 8, nz = 6,
  volumeFraction = 0.35,
  loadN = 1000,
  maxIter = 18,
  material = STEEL,
  filterRadius = 0,
}) {
  const t0 = Date.now();
  const mesh = TetMesh.regularGrid([0, 0, 0], [W, H, T], nx, ny, nz);
  const dx = W / nx, dy = H / ny, dz = T / nz;
  const eps = Math.min(dx, dy, dz) * 0.01;

  const fixedNodes = mesh.selectNodes((p) => p[0] <= eps);
  if (fixedNodes.length === 0) throw new Error('TopoCantilever: no fixed nodes selected at x=0');

  // Load patch: all nodes within one cell of (W, H/2, T/2) on the +X face.
  const loadNodes = mesh.selectNodes((p) =>
    Math.abs(p[0] - W) <= eps &&
    Math.abs(p[1] - H / 2) <= dy + eps &&
    Math.abs(p[2] - T / 2) <= dz + eps);
  if (loadNodes.length === 0) throw new Error('TopoCantilever: no load nodes found on +X face');
  const perNode = -loadN / loadNodes.length;
  const loads = loadNodes.map((n) => ({ node: n, dof: 1, value: perNode }));     // dof 1 = Y, negative = down

  let iterations = 0;
  const result = optimizeSIMP({
    mesh, material, fixedNodes, loads,
    volumeFraction, maxIter, penalty: 3,
    filterRadius: filterRadius || Math.max(dx, dy, dz) * 1.5,
    tol: 0.02,
    rhoMin: 1e-3,
    callback: (info) => { iterations = info.iter + 1; },
  });

  // Aggregate per-tet densities → per-cube (mean of 6 Kuhn tets).
  const nCells = nx * ny * nz;
  const densitiesCube = new Float64Array(nCells);
  for (let c = 0; c < nCells; c++) {
    let s = 0;
    for (let t = 0; t < 6; t++) s += result.densities[c * 6 + t];
    densitiesCube[c] = s / 6;
  }

  return {
    mesh, nx, ny, nz, dx, dy, dz,
    densitiesTet: result.densities,
    densitiesCube,
    compliance: result.compliance,
    iterations,
    fixedNodes, loadNodes,
    elapsedMs: Date.now() - t0,
  };
}

/**
 * Build an SDF closure suitable for Manifold.levelSet over the
 * design-box bounds. Returns +1 inside (cube density ≥ threshold),
 * −1 outside, and exact `cubeDensity − threshold` for sample
 * positions inside the design box (so the iso-surface lies where the
 * density actually crosses the threshold).
 *
 * Sample positions outside the box return −1 so levelSet caps the
 * output cleanly at the design-domain bounds.
 */
export function makeCubeDensitySDF(opt, threshold = 0.5) {
  const { densitiesCube, nx, ny, nz, dx, dy, dz } = opt;
  return function sdf(p) {
    const i = Math.floor(p[0] / dx);
    const j = Math.floor(p[1] / dy);
    const k = Math.floor(p[2] / dz);
    if (i < 0 || i >= nx || j < 0 || j >= ny || k < 0 || k >= nz) return -1;
    return densitiesCube[i + j * nx + k * nx * ny] - threshold;
  };
}
