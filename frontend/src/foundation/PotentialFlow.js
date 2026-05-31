/**
 * ArchDisc Foundation — 2D potential-flow CFD.
 *
 * Solves Laplace's equation for the stream function ψ on a regular
 * Cartesian grid:
 *
 *     ∇²ψ = 0                              everywhere outside obstacles
 *     ψ = U·y                              on inflow / outflow boundaries
 *                                          (= U y for uniform free-stream U)
 *     ψ = const (= U·y_center on each body) on solid obstacle surfaces
 *                                          (no flow through the body)
 *     ∂ψ/∂y = U                           on top / bottom (free-slip)
 *
 * Velocity field is then  u = ∂ψ/∂y,  v = −∂ψ/∂x.
 * Pressure coefficient    Cp = 1 − (u² + v²) / U_∞²  (incompressible Bernoulli).
 *
 * Discretisation: 5-point central difference on a uniform grid →
 * iterate ψ_{i,j} = ¼ (ψ_{i−1,j} + ψ_{i+1,j} + ψ_{i,j−1} + ψ_{i,j+1}).
 * Solver: Gauss-Seidel with successive over-relaxation, factor ω≈1.85.
 *
 * Validation case: a cylinder of radius R in a uniform free-stream U
 * has the analytical stream function
 *
 *     ψ(r, θ) = U·sin(θ)·(r − R²/r)
 *
 * with surface tangential velocity 2U·sin(θ) and Cp(θ) = 1 − 4 sin²(θ).
 *
 * Limitations:
 *   - Inviscid, incompressible, irrotational (no boundary-layer separation).
 *   - 2D only.
 *   - No real lift/drag prediction (D'Alembert's paradox: Cd = 0 for
 *     symmetric bodies in pure potential flow). For real engineering
 *     drag estimates we'd add a panel method with Kutta condition or
 *     a Navier-Stokes solver.
 */

const TWO_PI = 2 * Math.PI;

/**
 * Solve potential flow over a 2D obstacle set on a structured grid.
 *
 * @param {object} args
 * @param {number} args.nx, ny     - grid vertex count
 * @param {number} args.dx, dy     - cell sizes (mm or m, consistent)
 * @param {number} args.U          - free-stream speed (units consistent with dx)
 * @param {function(x,y) → boolean} args.isSolid - true if (x,y) is inside an obstacle
 * @param {object} args.options
 * @param {number} args.options.tol    - Gauss-Seidel residual norm tol (default 1e-7)
 * @param {number} args.options.maxIter - max sweeps (default 5000)
 * @param {number} args.options.omega   - SOR factor (default 1.85)
 * @returns {object} { psi, vx, vy, Cp, residual, iterations, ... }
 */
export function solvePotentialFlow({
  nx, ny, dx, dy, U,
  isSolid = () => false,
  options = {},
}) {
  const tol = options.tol ?? 1e-7;
  const maxIter = options.maxIter ?? 5000;
  const omega = options.omega ?? 1.85;
  const xMax = (nx - 1) * dx;
  const yMax = (ny - 1) * dy;

  const psi = new Float64Array(nx * ny);
  const solid = new Uint8Array(nx * ny);
  const idx = (i, j) => j * nx + i;

  // Initialize ψ to the free-stream solution everywhere
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const y = j * dy;
      psi[idx(i, j)] = U * y;
      const x = i * dx;
      if (isSolid(x, y)) solid[idx(i, j)] = 1;
    }
  }

  // BC handlers for obstacle nodes: ψ = U·y_avg of the body so that
  // the obstacle surface is a streamline. For a single body centered
  // somewhere in the domain, we compute the mean y of solid nodes.
  let yBodySum = 0, nBody = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (solid[idx(i, j)]) { yBodySum += j * dy; nBody++; }
  }
  const yBody = nBody > 0 ? yBodySum / nBody : 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (solid[idx(i, j)]) psi[idx(i, j)] = U * yBody;
  }

  // Gauss-Seidel SOR
  let residual = Infinity, iter = 0;
  const dx2 = dx * dx, dy2 = dy * dy;
  const denom = 2 * (dx2 + dy2);
  for (; iter < maxIter; iter++) {
    let r = 0;
    // Update interior nodes (skip boundary + solid)
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        if (solid[idx(i, j)]) continue;
        const old = psi[idx(i, j)];
        const newVal = (
          dy2 * (psi[idx(i - 1, j)] + psi[idx(i + 1, j)]) +
          dx2 * (psi[idx(i, j - 1)] + psi[idx(i, j + 1)])
        ) / denom;
        const next = (1 - omega) * old + omega * newVal;
        psi[idx(i, j)] = next;
        r += (next - old) * (next - old);
      }
    }
    // Top + bottom boundaries: ∂ψ/∂y = U → ψ stays U·y (Dirichlet) ✓
    // Left + right: ∂ψ/∂x = 0 → ψ_left = ψ_(i+1,j) ; ψ_right = ψ_(i-1,j)
    // We instead pin them to U·y (they're far enough that uniform-flow
    // assumption holds). No update needed.
    residual = Math.sqrt(r / (nx * ny));
    if (residual < tol) break;
  }

  // Compute velocity field via central differences
  const vx = new Float64Array(nx * ny);
  const vy = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // ∂ψ/∂y → u    (vertical neighbour difference)
      // ∂ψ/∂x → -v   (horizontal neighbour difference, sign flipped)
      const jm = Math.max(0, j - 1);
      const jp = Math.min(ny - 1, j + 1);
      const im = Math.max(0, i - 1);
      const ip = Math.min(nx - 1, i + 1);
      vx[idx(i, j)] = (psi[idx(i, jp)] - psi[idx(i, jm)]) / ((jp - jm) * dy || 1);
      vy[idx(i, j)] = -(psi[idx(ip, j)] - psi[idx(im, j)]) / ((ip - im) * dx || 1);
    }
  }

  // Cp field
  const Cp = new Float64Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) {
    const v2 = vx[k] * vx[k] + vy[k] * vy[k];
    Cp[k] = 1 - v2 / (U * U);
  }

  return {
    psi, vx, vy, Cp, solid,
    residual, iterations: iter,
    nx, ny, dx, dy, U,
    domain: { xMax, yMax },
  };
}

/**
 * Sample the surface Cp around a circular obstacle at center (cx, cy)
 * with radius R. Returns { theta_deg, Cp_FEM, Cp_analytical } points.
 */
/**
 * Sample Cp around a circular obstacle at radial distance `r` from
 * its center (cx, cy). Uses the analytical free-stream-with-doublet
 * solution for the reference value:
 *
 *     u_r = U cos(θ) (1 − R²/r²)
 *     u_θ = −U sin(θ) (1 + R²/r²)
 *     Cp(r,θ) = 1 − [(1−R²/r²)² cos²θ + (1+R²/r²)² sin²θ]
 *
 * At the surface (r=R) this reduces to the classical Cp = 1 − 4 sin²θ.
 *
 * @param {object} result
 * @param {number} cx, cy, R
 * @param {number} samples - number of θ samples
 * @param {number} sampleRadius - r/R ratio (default 1.5 for stable
 *                                interpolation away from the staircased
 *                                voxel boundary)
 */
export function sampleCylinderSurfaceCp(result, cx, cy, R, samples = 60, sampleRadius = 1.5) {
  const out = [];
  const { vx, vy, U } = result;
  const rOverR = sampleRadius;
  const r = rOverR * R;
  const ratio2 = 1 / (rOverR * rOverR);    // R²/r²
  const minusFactor = 1 - ratio2;
  const plusFactor = 1 + ratio2;
  for (let s = 0; s < samples; s++) {
    const theta = (s / samples) * TWO_PI;
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    const ux = sampleField(result, x, y, vx);
    const uy = sampleField(result, x, y, vy);
    const v2 = ux * ux + uy * uy;
    const Cp = 1 - v2 / (U * U);
    const c = Math.cos(theta), si = Math.sin(theta);
    const CpAnalytical = 1 - (minusFactor * minusFactor * c * c + plusFactor * plusFactor * si * si);
    out.push({ theta_deg: theta * 180 / Math.PI, Cp_FEM: Cp, Cp_analytical: CpAnalytical });
  }
  return out;
}

function sampleField(result, x, y, field) {
  const { nx, ny, dx, dy } = result;
  const i = Math.max(0, Math.min(nx - 1, Math.round(x / dx)));
  const j = Math.max(0, Math.min(ny - 1, Math.round(y / dy)));
  return field[j * nx + i];
}

/**
 * Render the stream function as an SVG with iso-contours +
 * obstacle filled.
 *
 * Default colour: streamlines as black lines, body as grey fill.
 */
export function renderStreamlinesSVG(result, options = {}) {
  const { nx, ny, dx, dy, U, psi, solid } = result;
  const xMax = (nx - 1) * dx, yMax = (ny - 1) * dy;
  const margin = options.marginMm ?? 8;
  const W = xMax + 2 * margin, H = yMax + 2 * margin;
  const lines = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">`);
  lines.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="white"/>`);
  // Outline domain
  lines.push(`<rect x="${margin}" y="${margin}" width="${xMax}" height="${yMax}" fill="none" stroke="#888" stroke-width="0.3"/>`);
  // Iso-contours of ψ — pick N levels evenly spread
  let psiMin = Infinity, psiMax = -Infinity;
  for (const v of psi) { if (v < psiMin) psiMin = v; if (v > psiMax) psiMax = v; }
  const N = options.contours ?? 24;
  // Marching squares per level — small inline implementation
  for (let lvl = 1; lvl < N; lvl++) {
    const isoVal = psiMin + (psiMax - psiMin) * (lvl / N);
    const segs = marchingSquares(psi, nx, ny, isoVal);
    for (const [x1, y1, x2, y2] of segs) {
      const X1 = margin + x1 * dx, Y1 = margin + (yMax - y1 * dy);
      const X2 = margin + x2 * dx, Y2 = margin + (yMax - y2 * dy);
      lines.push(`<line x1="${X1.toFixed(3)}" y1="${Y1.toFixed(3)}" x2="${X2.toFixed(3)}" y2="${Y2.toFixed(3)}" stroke="#3060c0" stroke-width="0.18"/>`);
    }
  }
  // Body fill
  const body = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (solid[j * nx + i]) {
      const X = margin + i * dx, Y = margin + (yMax - j * dy);
      body.push(`<rect x="${X - dx/2}" y="${Y - dy/2}" width="${dx}" height="${dy}" fill="#888"/>`);
    }
  }
  lines.push(...body);
  lines.push(`<text x="${margin}" y="${H - 2}" font-family="monospace" font-size="3.0">2D potential flow · U = ${U} · grid ${nx}×${ny}</text>`);
  lines.push(`</svg>`);
  return lines.join('\n');
}

/**
 * 2-D marching squares for iso-contour extraction.
 */
function marchingSquares(field, nx, ny, isoVal) {
  const segs = [];
  const idx = (i, j) => j * nx + i;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v00 = field[idx(i,     j    )];
      const v10 = field[idx(i + 1, j    )];
      const v11 = field[idx(i + 1, j + 1)];
      const v01 = field[idx(i,     j + 1)];
      let code = 0;
      if (v00 >= isoVal) code |= 1;
      if (v10 >= isoVal) code |= 2;
      if (v11 >= isoVal) code |= 4;
      if (v01 >= isoVal) code |= 8;
      if (code === 0 || code === 15) continue;
      // Edge interpolations
      const interp = (a, b, fa, fb) => (isoVal - fa) / (fb - fa);
      const e0 = [i + interp(0, 1, v00, v10), j];          // bottom
      const e1 = [i + 1, j + interp(0, 1, v10, v11)];      // right
      const e2 = [i + interp(0, 1, v01, v11), j + 1];      // top
      const e3 = [i, j + interp(0, 1, v00, v01)];          // left
      // 16-case standard
      const tableEdges = [
        [],                    // 0
        [[3, 0]],              // 1
        [[0, 1]],              // 2
        [[3, 1]],              // 3
        [[1, 2]],              // 4
        [[3, 0], [1, 2]],      // 5 (saddle)
        [[0, 2]],              // 6
        [[3, 2]],              // 7
        [[2, 3]],              // 8
        [[2, 0]],              // 9
        [[0, 1], [2, 3]],      // 10 (saddle)
        [[2, 1]],              // 11
        [[1, 3]],              // 12
        [[1, 0]],              // 13
        [[0, 3]],              // 14
        [],                    // 15
      ];
      const E = [e0, e1, e2, e3];
      for (const [a, b] of tableEdges[code]) {
        segs.push([E[a][0], E[a][1], E[b][0], E[b][1]]);
      }
    }
  }
  return segs;
}
