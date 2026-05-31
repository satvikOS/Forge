/**
 * ArchDisc Foundation — 2D incompressible viscous Navier-Stokes
 * (vorticity-streamfunction formulation).
 *
 * Governing equations on a unit-square (or scaled) Cartesian grid:
 *
 *     ∂ω/∂t + u·∂ω/∂x + v·∂ω/∂y = (1/Re) ∇²ω        (vorticity transport)
 *     ∇²ψ = −ω                                       (Poisson for ψ)
 *     u = ∂ψ/∂y,  v = −∂ψ/∂x                          (velocity from ψ)
 *
 * Time integration: explicit forward-Euler with first-order upwind
 * advection. CFL stability requires Δt < min(Δx/|u|, Δy/|v|, Re·Δx²/4).
 *
 * Boundary conditions (lid-driven cavity benchmark):
 *   ψ = 0           on every wall (closed cavity)
 *   u = U_lid       on the top wall (y = H)
 *   u = v = 0       on the other three walls (no-slip)
 *
 * Wall vorticity from Thom's first-order formula:
 *
 *     ω_wall = -2 (ψ_wall_neighbour − ψ_wall) / Δn²  + correction(U_lid)
 *
 * Validation: lid-driven cavity at Re = 100. Ghia, Ghia & Shin (1982)
 * give widely-cited reference values of u along the vertical centerline
 * (x = 0.5L). We compare to those at convergence.
 */

/**
 * Solve steady incompressible 2D NS in a lid-driven cavity.
 *
 * @param {object} args
 * @param {number} args.Re             Reynolds number = U·L/ν
 * @param {number} args.U              lid velocity (in the units the
 *                                     domain is described in)
 * @param {number} args.L              cavity side length (1 by default)
 * @param {number} args.nx             grid vertices in x  (default 51)
 * @param {number} args.ny             grid vertices in y  (default 51)
 * @param {number} args.maxIter        time steps          (default 30000)
 * @param {number} args.tol            convergence on ω    (default 1e-5)
 * @param {number} args.psiSweeps      Gauss-Seidel sweeps per time step
 *                                     to update ψ (default 30, ω≈1.85)
 *
 * @returns {{ psi, omega, u, v, iterations, residual, dt, dx, dy }}
 */
export function solveLidDrivenCavity({
  Re = 100,
  U = 1,
  L = 1,
  nx = 51, ny = 51,
  maxIter = 30000,
  tol = 1e-5,
  psiSweeps = 30,
} = {}) {
  const dx = L / (nx - 1);
  const dy = L / (ny - 1);

  // Choose Δt to satisfy stability on the worst axis. Use conservative
  // safety factors because the lid-corner velocity can spike to ~2U.
  // CFL:        Δt < 0.2 · dx / U_max
  // Diffusion:  Δt < 0.2 · Re · min(dx², dy²) / 4
  const dtCFL = 0.2 * Math.min(dx, dy) / Math.max(Math.abs(U), 1e-9);
  const dtDiff = 0.2 * Re * Math.min(dx * dx, dy * dy);
  const dt = Math.min(dtCFL, dtDiff);

  // Smooth the lid velocity at the corners to avoid the well-known
  // singularity (Ghia uses an idealised step function but at low Re the
  // first-order method needs a small ramp). 5% ramp on each side.
  const lidU = new Float64Array(nx);
  const rampLen = Math.max(2, Math.floor(0.05 * nx));
  for (let i = 0; i < nx; i++) {
    if (i < rampLen) lidU[i] = U * (i / rampLen);
    else if (i > nx - 1 - rampLen) lidU[i] = U * ((nx - 1 - i) / rampLen);
    else lidU[i] = U;
  }

  const N = nx * ny;
  const psi = new Float64Array(N);
  const omega = new Float64Array(N);
  const omegaNew = new Float64Array(N);
  const u = new Float64Array(N);
  const v = new Float64Array(N);
  const idx = (i, j) => j * nx + i;

  // Lid-velocity profile: u(top) = U everywhere on top wall (sharp corners
  // at top-left + top-right. This gives the classic Ghia singularity but
  // stabilises with smoothing on a fine enough grid.)

  let lastResidual = Infinity;
  let it = 0;
  for (; it < maxIter; it++) {
    // 1. Update wall vorticity from Thom's formula
    //    Top wall (j = ny-1, moving with U):
    //       ω = -2 (ψ[j-1] - ψ[j]) / Δy² - 2 U / Δy
    //    Other walls (stationary):
    //       ω = -2 (ψ_neighbour - ψ_wall) / Δn²
    for (let i = 0; i < nx; i++) {
      // bottom wall j=0
      omega[idx(i, 0)] = -2 * (psi[idx(i, 1)] - psi[idx(i, 0)]) / (dy * dy);
      // top wall j=ny-1, moving lid (ramped at corners to avoid singularity)
      omega[idx(i, ny - 1)] = -2 * (psi[idx(i, ny - 2)] - psi[idx(i, ny - 1)]) / (dy * dy) - 2 * lidU[i] / dy;
    }
    for (let j = 0; j < ny; j++) {
      // left wall i=0
      omega[idx(0, j)] = -2 * (psi[idx(1, j)] - psi[idx(0, j)]) / (dx * dx);
      // right wall i=nx-1
      omega[idx(nx - 1, j)] = -2 * (psi[idx(nx - 2, j)] - psi[idx(nx - 1, j)]) / (dx * dx);
    }

    // 2. Compute u, v from ψ (interior)
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        u[idx(i, j)] = (psi[idx(i, j + 1)] - psi[idx(i, j - 1)]) / (2 * dy);
        v[idx(i, j)] = -(psi[idx(i + 1, j)] - psi[idx(i - 1, j)]) / (2 * dx);
      }
    }

    // 3. Advance vorticity (explicit Euler, upwind advection)
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = idx(i, j);
        const uu = u[k], vv = v[k];
        // Upwind advection
        const dwdx = uu >= 0
          ? (omega[k] - omega[idx(i - 1, j)]) / dx
          : (omega[idx(i + 1, j)] - omega[k]) / dx;
        const dwdy = vv >= 0
          ? (omega[k] - omega[idx(i, j - 1)]) / dy
          : (omega[idx(i, j + 1)] - omega[k]) / dy;
        // Diffusion (central)
        const lap = (omega[idx(i + 1, j)] - 2 * omega[k] + omega[idx(i - 1, j)]) / (dx * dx)
                  + (omega[idx(i, j + 1)] - 2 * omega[k] + omega[idx(i, j - 1)]) / (dy * dy);
        omegaNew[k] = omega[k] + dt * (-uu * dwdx - vv * dwdy + lap / Re);
      }
    }
    // Copy interior; walls handled at top of next loop
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        omega[idx(i, j)] = omegaNew[idx(i, j)];
      }
    }

    // 4. Update ψ: solve ∇²ψ = -ω via SOR
    const omegaSOR = 1.85;
    const dx2 = dx * dx, dy2 = dy * dy;
    const denom = 2 * (dx2 + dy2);
    for (let s = 0; s < psiSweeps; s++) {
      for (let j = 1; j < ny - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const k = idx(i, j);
          const old = psi[k];
          const newVal = (
            dy2 * (psi[idx(i - 1, j)] + psi[idx(i + 1, j)]) +
            dx2 * (psi[idx(i, j - 1)] + psi[idx(i, j + 1)]) +
            dx2 * dy2 * omega[k]
          ) / denom;
          psi[k] = (1 - omegaSOR) * old + omegaSOR * newVal;
        }
      }
    }

    // 5. Convergence check every 100 steps (cheap)
    if ((it + 1) % 100 === 0) {
      let r = 0;
      for (let k = 0; k < N; k++) {
        const d = omegaNew[k] - omega[k];
        r += d * d;
      }
      lastResidual = Math.sqrt(r / N);
      if (lastResidual < tol) { it++; break; }
    }
  }

  // Final velocity field
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      u[idx(i, j)] = (psi[idx(i, j + 1)] - psi[idx(i, j - 1)]) / (2 * dy);
      v[idx(i, j)] = -(psi[idx(i + 1, j)] - psi[idx(i - 1, j)]) / (2 * dx);
    }
  }
  // Lid velocity on top wall (matches the ramp profile we applied)
  for (let i = 0; i < nx; i++) u[idx(i, ny - 1)] = lidU[i];

  return {
    psi, omega, u, v,
    iterations: it,
    residual: lastResidual,
    dt, dx, dy, nx, ny, Re, U, L,
  };
}

/**
 * Sample u along the vertical centerline x = 0.5 L.
 * Returns array of { y, u, ghia } where `ghia` is the published
 * Re=100 reference (or null for points without published data).
 */
export function sampleCenterlineU(result, ghiaRef = GHIA_RE100_U) {
  const { u, nx, ny, L } = result;
  const i = Math.round((nx - 1) / 2);
  const out = [];
  for (const ref of ghiaRef) {
    const j = Math.round((ref.y / L) * (ny - 1));
    out.push({
      y: ref.y,
      u_FEM: u[j * nx + i],
      u_Ghia: ref.u,
    });
  }
  return out;
}

// Ghia et al. 1982 — lid-driven cavity, Re = 100, vertical centerline u(y)
// (Table I of their paper; column for Re=100).
export const GHIA_RE100_U = [
  { y: 0.0000, u:  0.00000 },
  { y: 0.0547, u: -0.03717 },
  { y: 0.0625, u: -0.04192 },
  { y: 0.0703, u: -0.04775 },
  { y: 0.1016, u: -0.06434 },
  { y: 0.1719, u: -0.10150 },
  { y: 0.2813, u: -0.15662 },
  { y: 0.4531, u: -0.21090 },
  { y: 0.5000, u: -0.20581 },
  { y: 0.6172, u: -0.13641 },
  { y: 0.7344, u:  0.00332 },
  { y: 0.8516, u:  0.23151 },
  { y: 0.9531, u:  0.68717 },
  { y: 0.9609, u:  0.73722 },
  { y: 0.9688, u:  0.78871 },
  { y: 0.9766, u:  0.84123 },
  { y: 1.0000, u:  1.00000 },
];

/**
 * Render velocity-magnitude / streamfunction iso-contours as SVG.
 */
export function renderCavitySVG(result, options = {}) {
  const { psi, nx, ny, L } = result;
  const margin = options.marginMm ?? 8;
  const cellSize = options.cellSizeMm ?? 4;
  const W = (nx - 1) * cellSize + 2 * margin;
  const H = (ny - 1) * cellSize + 2 * margin;
  const lines = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">`);
  lines.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="white"/>`);
  // Domain box
  lines.push(`<rect x="${margin}" y="${margin}" width="${(nx - 1) * cellSize}" height="${(ny - 1) * cellSize}" fill="none" stroke="black" stroke-width="0.5"/>`);
  // Marching-squares iso-contours of ψ
  let psiMin = Infinity, psiMax = -Infinity;
  for (const v of psi) { if (v < psiMin) psiMin = v; if (v > psiMax) psiMax = v; }
  const N = options.contours ?? 22;
  for (let lvl = 1; lvl < N; lvl++) {
    const isoVal = psiMin + (psiMax - psiMin) * (lvl / N);
    const segs = marchingSquares(psi, nx, ny, isoVal);
    for (const [x1, y1, x2, y2] of segs) {
      const X1 = margin + x1 * cellSize;
      const Y1 = margin + ((ny - 1) - y1) * cellSize;
      const X2 = margin + x2 * cellSize;
      const Y2 = margin + ((ny - 1) - y2) * cellSize;
      const isCenterline = Math.abs(isoVal) < 1e-6;
      lines.push(`<line x1="${X1.toFixed(3)}" y1="${Y1.toFixed(3)}" x2="${X2.toFixed(3)}" y2="${Y2.toFixed(3)}" stroke="${isCenterline ? '#000' : '#3060c0'}" stroke-width="${isCenterline ? 0.4 : 0.18}"/>`);
    }
  }
  // Lid arrow
  const arrowY = margin - 3;
  lines.push(`<text x="${margin + (nx - 1) * cellSize / 2}" y="${arrowY}" font-family="monospace" font-size="3.0" text-anchor="middle">→ lid moves at U = ${result.U}, Re = ${result.Re}</text>`);
  lines.push(`<text x="${margin}" y="${H - 2}" font-family="monospace" font-size="2.5">Stream-function ψ contours · ${nx}×${ny} grid · ${result.iterations} time steps</text>`);
  lines.push(`</svg>`);
  return lines.join('\n');
}

function marchingSquares(field, nx, ny, isoVal) {
  const segs = [];
  const idx = (i, j) => j * nx + i;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v00 = field[idx(i, j)];
      const v10 = field[idx(i + 1, j)];
      const v11 = field[idx(i + 1, j + 1)];
      const v01 = field[idx(i, j + 1)];
      let code = 0;
      if (v00 >= isoVal) code |= 1;
      if (v10 >= isoVal) code |= 2;
      if (v11 >= isoVal) code |= 4;
      if (v01 >= isoVal) code |= 8;
      if (code === 0 || code === 15) continue;
      const interp = (a, b, fa, fb) => (isoVal - fa) / (fb - fa);
      const e0 = [i + interp(0, 1, v00, v10), j];
      const e1 = [i + 1, j + interp(0, 1, v10, v11)];
      const e2 = [i + interp(0, 1, v01, v11), j + 1];
      const e3 = [i, j + interp(0, 1, v00, v01)];
      const tableEdges = [
        [], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [[3, 0], [1, 2]], [[0, 2]], [[3, 2]],
        [[2, 3]], [[2, 0]], [[0, 1], [2, 3]], [[2, 1]], [[1, 3]], [[1, 0]], [[0, 3]], [],
      ];
      const E = [e0, e1, e2, e3];
      for (const [a, b] of tableEdges[code]) {
        segs.push([E[a][0], E[a][1], E[b][0], E[b][1]]);
      }
    }
  }
  return segs;
}
