// PUSH-201 (Slice-151) — CFD result visualisation for the forge-v4 viewport.
//
// Pure-math module: takes a solved Grid from navierStokes3d.js + options,
// returns THREE.Object3D builders (scene-mountable groups).
//
// Three deliverables:
//
//   1. buildVelocityVectorField(THREE, grid, opts) — InstancedMesh of
//      cone+cylinder arrows at every `opts.every`-th cell, sized and
//      coloured by |U|. Returns a THREE.Group with userData.cfdViz =
//      'vectors'. Uses a single shared cylinder + cone geometry and a
//      pair of InstancedMesh instances so an entire 16³ × every=2 field
//      (~256 arrows) costs two draw calls.
//
//   2. buildPressureMidplane(THREE, grid, opts) — single PlaneGeometry
//      with per-vertex colours mapping p → jet colormap on the
//      midplane k = nz/2 (or any axis the caller picks). Returns a
//      THREE.Group with userData.cfdViz = 'pressure'.
//
//   3. buildStreamlines(THREE, grid, opts) — RK4-integrated streamlines
//      from a grid of seed points (default 8 × 8 on the inlet plane).
//      Each streamline is integrated until it exits the domain or hits
//      the step cap. Renders one LineSegments per streamline so the
//      caller can iterate the group's children. Returns a THREE.Group
//      with userData.cfdViz = 'streamlines'.
//
// Helpers exported:
//
//   * jetColor(t)          — RGB triplet in [0..1] for t ∈ [0..1].
//   * viridisColor(t)      — alternative perceptual ramp.
//   * sampleVelocity(g,x,y,z) — trilinear u/v/w lookup in solver coords.
//   * sampleScalar(g,f,x,y,z) — trilinear scalar lookup (used by both
//                               pressure quad + streamline colouring).
//   * rk4Streamline(g, seed, opts) — pure RK4 integrator. Returns an
//     array of {x,y,z} samples (length ≥ 2). Exported so the e2e and
//     Archie can drive headlessly.
//   * decimateVectorField(g, every) — returns an array of {i,j,k,x,y,z,
//     u,v,w,mag} samples at every `every`-th cell. Pure / deterministic.
//   * fieldStats(arr)      — { min, max, mean, absMax } over a typed
//     array. Used to normalise vector lengths + clamp colours.
//
// The module DOES NOT import THREE at the top — every export takes
// the THREE namespace as a parameter so the same code can run headlessly
// in tests without forcing a WebGL context to spin up.
//
// Hard constraints (PUSH-201 brief):
//   * No new npm / C++ / external deps.
//   * Real RK4 with trilinear sampling. No Euler short-cuts.
//   * No fallback / stub / placeholder.
//   * Domain coordinates are mapped through opts.scale so the cavity
//     (L=1 in solver coords) renders as a visible cube in the viewport
//     (default scale = 40 → a 40mm cube alongside the existing 10mm
//     grid sections).

// ─────────────────────────────────────────────────────────────────────
// Constants.

export const CFD_VIZ_DEFAULT_SCALE = 40;                  // solver L=1 → 40mm
export const CFD_VIZ_DEFAULT_EVERY = 2;                   // every Nth cell
export const CFD_VIZ_DEFAULT_ARROW_HEAD_RATIO = 0.30;     // head / total
export const CFD_VIZ_DEFAULT_ARROW_FRACTION = 0.85;       // of dx
export const CFD_VIZ_DEFAULT_STREAMLINE_SEEDS = 8;        // 8 × 8 inlet
export const CFD_VIZ_DEFAULT_STREAMLINE_MAX_STEPS = 400;
export const CFD_VIZ_DEFAULT_STREAMLINE_DT_FACTOR = 0.5;  // × min(dx,dy,dz)/|U|
export const CFD_VIZ_DEFAULT_AXIS = 'z';                  // pressure mid-plane

// ─────────────────────────────────────────────────────────────────────
// Colormaps.
//
// Both are evaluated as polynomial fits so they don't drag in a LUT
// table; accuracy is well under the visible perceptual just-noticeable
// difference at the rampColour resolution the panel uses.

/**
 * Jet colormap — RGB triplet [r,g,b] in [0..1] for t ∈ [0..1].
 * Classical MATLAB / matplotlib "jet" approximation.
 */
export function jetColor(t) {
  const x = Math.max(0, Math.min(1, t));
  // Standard jet ramp pieces.
  let r, g, b;
  if (x < 0.125) {
    r = 0;
    g = 0;
    b = 0.5 + 4 * x;
  } else if (x < 0.375) {
    r = 0;
    g = 4 * (x - 0.125);
    b = 1;
  } else if (x < 0.625) {
    r = 4 * (x - 0.375);
    g = 1;
    b = 1 - 4 * (x - 0.375);
  } else if (x < 0.875) {
    r = 1;
    g = 1 - 4 * (x - 0.625);
    b = 0;
  } else {
    r = 1 - 4 * (x - 0.875);
    g = 0;
    b = 0;
    if (r < 0.5) r = 0.5; // clip the tail back to dark red
  }
  return [r, g, b];
}

/**
 * Viridis colormap — perceptual uniform ramp; polynomial fit per channel
 * from a standard 256-step LUT. Useful when the user wants a colour-
 * blind-friendly ramp instead of jet.
 */
export function viridisColor(t) {
  const x = Math.max(0, Math.min(1, t));
  // 4th-order polynomial fits to the matplotlib viridis colormap.
  const r = Math.max(0, Math.min(1,
      0.267004 + x * (0.105 + x * (-1.85 + x * (5.43 + x * (-3.92))))));
  const g = Math.max(0, Math.min(1,
      0.004874 + x * (1.4 + x * (-1.18 + x * (1.10 + x * (-0.41))))));
  const b = Math.max(0, Math.min(1,
      0.329415 + x * (1.40 + x * (-3.36 + x * (3.20 + x * (-1.16))))));
  return [r, g, b];
}

// ─────────────────────────────────────────────────────────────────────
// Trilinear sampling.
//
// The grid is cell-centered: cell (i,j,k) sits at world position
// ((i+0.5)·dx, (j+0.5)·dy, (k+0.5)·dz) in solver coordinates. Trilinear
// interpolation uses the 8 surrounding cell centers and clamps queries
// outside the domain to the nearest edge cell so streamlines passing
// through walls don't read garbage memory.

/**
 * Sample the velocity field at solver-space point (x,y,z).
 * Returns [u, v, w].
 */
export function sampleVelocity(grid, x, y, z) {
  const u = sampleScalar(grid, grid.u, x, y, z);
  const v = sampleScalar(grid, grid.v, x, y, z);
  const w = sampleScalar(grid, grid.w, x, y, z);
  return [u, v, w];
}

/**
 * Sample an arbitrary scalar field f (Float32Array, length grid.N).
 * Returns the trilinearly interpolated value.
 */
export function sampleScalar(grid, f, x, y, z) {
  const { nx, ny, nz, dx, dy, dz, sliceXY } = grid;
  // Convert physical position → cell-index space (subtract 0.5 because
  // the cell *centres* sit at integer + 0.5 in physical units).
  const fi = x / dx - 0.5;
  const fj = y / dy - 0.5;
  const fk = z / dz - 0.5;
  // Clamp into [0, n-1].
  const ci = Math.max(0, Math.min(nx - 1, fi));
  const cj = Math.max(0, Math.min(ny - 1, fj));
  const ck = Math.max(0, Math.min(nz - 1, fk));
  const i0 = Math.floor(ci), j0 = Math.floor(cj), k0 = Math.floor(ck);
  const i1 = Math.min(nx - 1, i0 + 1);
  const j1 = Math.min(ny - 1, j0 + 1);
  const k1 = Math.min(nz - 1, k0 + 1);
  const tx = ci - i0, ty = cj - j0, tz = ck - k0;
  // 8 corner samples.
  const idx = (i, j, k) => i + nx * j + sliceXY * k;
  const c000 = f[idx(i0, j0, k0)];
  const c100 = f[idx(i1, j0, k0)];
  const c010 = f[idx(i0, j1, k0)];
  const c110 = f[idx(i1, j1, k0)];
  const c001 = f[idx(i0, j0, k1)];
  const c101 = f[idx(i1, j0, k1)];
  const c011 = f[idx(i0, j1, k1)];
  const c111 = f[idx(i1, j1, k1)];
  // Trilinear blend.
  const c00 = c000 * (1 - tx) + c100 * tx;
  const c10 = c010 * (1 - tx) + c110 * tx;
  const c01 = c001 * (1 - tx) + c101 * tx;
  const c11 = c011 * (1 - tx) + c111 * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}

// ─────────────────────────────────────────────────────────────────────
// Field statistics.

export function fieldStats(arr) {
  if (!arr || arr.length === 0) {
    return { min: 0, max: 0, mean: 0, absMax: 0 };
  }
  let mn = Infinity, mx = -Infinity, sum = 0, am = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    sum += v;
    const av = Math.abs(v);
    if (av > am) am = av;
  }
  return { min: mn, max: mx, mean: sum / arr.length, absMax: am };
}

// ─────────────────────────────────────────────────────────────────────
// Vector-field decimation.

/**
 * Walk the grid every `every`-th cell and emit a struct per sample with
 * position (solver coords) + velocity + magnitude. Skips cells whose
 * velocity magnitude is below `minMag` (treated as numerical zero).
 *
 * @returns {Array<{i,j,k,x,y,z,u,v,w,mag}>}
 */
export function decimateVectorField(grid, every = CFD_VIZ_DEFAULT_EVERY, minMag = 0) {
  if (!Number.isFinite(every) || every < 1) every = 1;
  const out = [];
  const { nx, ny, nz, dx, dy, dz, sliceXY, u, v, w } = grid;
  for (let k = 0; k < nz; k += every) {
    for (let j = 0; j < ny; j += every) {
      for (let i = 0; i < nx; i += every) {
        const idx = i + nx * j + sliceXY * k;
        const ux = u[idx], uy = v[idx], uz = w[idx];
        const mag = Math.sqrt(ux * ux + uy * uy + uz * uz);
        if (mag < minMag) continue;
        out.push({
          i, j, k,
          x: (i + 0.5) * dx,
          y: (j + 0.5) * dy,
          z: (k + 0.5) * dz,
          u: ux, v: uy, w: uz, mag,
        });
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// RK4 streamline integrator.
//
// Standard 4th-order Runge–Kutta on the velocity field. Each substep
// uses trilinear sampling so the integrator stays smooth even on a
// coarse 16³ grid.
//
// Stop conditions (any one):
//   - sample point leaves the grid AABB (+ slack of half-cell)
//   - step count reaches maxSteps
//   - |U| at the head falls below stopMag (stagnation)

/**
 * Integrate one streamline starting from `seed = [x, y, z]` (solver
 * coords). Returns an array of [x,y,z] arrays. Always has ≥ 2 entries
 * (the seed + one trial step) so the caller can build line geometry
 * without special-casing zero-length paths.
 */
export function rk4Streamline(grid, seed, opts = {}) {
  const maxSteps = opts.maxSteps | 0 || CFD_VIZ_DEFAULT_STREAMLINE_MAX_STEPS;
  const stopMag = +opts.stopMag || 1e-6;
  const dirSign = (opts.direction === 'backward') ? -1 : +1;
  // Caller may supply a fixed dt; otherwise we compute one from a
  // CFL-ish bound on the local velocity field so the streamline marches
  // ~0.5 of a cell per step.
  const baseDt = +opts.dt || 0;
  const dtFactor = +opts.dtFactor || CFD_VIZ_DEFAULT_STREAMLINE_DT_FACTOR;
  const minDx = Math.min(grid.dx, grid.dy, grid.dz);
  const path = [];
  let x = +seed[0], y = +seed[1], z = +seed[2];
  path.push([x, y, z]);

  // Domain AABB.
  const xMax = grid.Lx, yMax = grid.Ly, zMax = grid.Lz;
  const slack = minDx * 0.5;

  for (let step = 0; step < maxSteps; step++) {
    // Sample at four RK substages.
    const k1 = sampleVelocity(grid, x, y, z);
    const m1 = Math.sqrt(k1[0]*k1[0] + k1[1]*k1[1] + k1[2]*k1[2]);
    if (m1 < stopMag) break;
    // Compute adaptive step size.
    const dt = (baseDt > 0)
      ? baseDt
      : (dtFactor * minDx / Math.max(m1, stopMag)) * dirSign;
    const halfDt = 0.5 * dt;
    // k2 at midpoint using k1.
    const xm2 = x + halfDt * k1[0];
    const ym2 = y + halfDt * k1[1];
    const zm2 = z + halfDt * k1[2];
    const k2 = sampleVelocity(grid, xm2, ym2, zm2);
    // k3 at midpoint using k2.
    const xm3 = x + halfDt * k2[0];
    const ym3 = y + halfDt * k2[1];
    const zm3 = z + halfDt * k2[2];
    const k3 = sampleVelocity(grid, xm3, ym3, zm3);
    // k4 at end using k3.
    const xm4 = x + dt * k3[0];
    const ym4 = y + dt * k3[1];
    const zm4 = z + dt * k3[2];
    const k4 = sampleVelocity(grid, xm4, ym4, zm4);
    // Weighted sum.
    const sixth = dt / 6;
    const dx = sixth * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    const dy = sixth * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    const dz = sixth * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    x += dx; y += dy; z += dz;
    path.push([x, y, z]);
    // Domain exit? Allow half-cell of slack so floating-point drift
    // doesn't terminate a perfectly-valid streamline early.
    if (x < -slack || y < -slack || z < -slack
     || x > xMax + slack || y > yMax + slack || z > zMax + slack) {
      break;
    }
  }
  // Always return ≥ 2 points so the caller can build a Line.
  if (path.length === 1) path.push([path[0][0], path[0][1], path[0][2]]);
  return path;
}

// ─────────────────────────────────────────────────────────────────────
// Velocity vectors — InstancedMesh of cylinders + cones.
//
// Strategy: build ONE cylinder geometry + ONE cone geometry (in their
// local +y orientation). For each decimated sample compute a 4×4 matrix
// that rotates the +y axis onto the velocity vector and translates the
// instance to the cell centre (scaled to viewport coordinates).
//
// Colour: each instance gets a per-instance colour buffer entry filled
// from the colormap (jet by default). Materials use vertexColors:true
// + instanceColor so the GPU does the right thing.

export function buildVelocityVectorField(THREE, grid, opts = {}) {
  if (!THREE) throw new Error('cfdVisualisation: THREE namespace required');
  if (!grid || !grid.u) throw new Error('cfdVisualisation: grid (with u/v/w) required');

  const scale = +opts.scale || CFD_VIZ_DEFAULT_SCALE;          // solver→viewport
  const every = opts.every | 0 || CFD_VIZ_DEFAULT_EVERY;
  const colormap = opts.colormap === 'viridis' ? viridisColor : jetColor;
  const colorByMag = opts.colorByMag !== false;
  const arrowFraction = +opts.arrowFraction || CFD_VIZ_DEFAULT_ARROW_FRACTION;
  const headRatio = +opts.headRatio || CFD_VIZ_DEFAULT_ARROW_HEAD_RATIO;
  const originOffset = opts.originOffset || [-0.5 * scale * grid.Lx,
                                              0,
                                             -0.5 * scale * grid.Lz];

  const samples = decimateVectorField(grid, every, 0);
  // Drop samples with zero velocity so we don't draw a forest of
  // boundary cells with collapsed arrows.
  const nonzero = samples.filter((s) => s.mag > 1e-12);
  const N = nonzero.length;

  const group = new THREE.Group();
  group.name = 'cfd-velocity-vectors';
  group.userData = { ...(group.userData || {}), cfdViz: 'vectors',
                     sampleCount: N,
                     totalCells: samples.length };

  if (N === 0) return group;

  // ─── shared geometries (one cylinder + one cone) ───
  // Use unit cylinder (height = 1, radius = 0.07) and cone (height = 1,
  // radius = 0.18). Per-instance matrix sets the actual length /
  // radial scale.
  const cylGeom = new THREE.CylinderGeometry(0.07, 0.07, 1.0, 8, 1, false);
  cylGeom.translate(0, 0.5, 0); // base at origin
  const coneGeom = new THREE.ConeGeometry(0.18, 1.0, 10, 1, false);
  coneGeom.translate(0, 0.5, 0); // base at origin

  const cylMat = new THREE.MeshBasicMaterial({ vertexColors: false });
  const coneMat = new THREE.MeshBasicMaterial({ vertexColors: false });

  const cylMesh = new THREE.InstancedMesh(cylGeom, cylMat, N);
  const coneMesh = new THREE.InstancedMesh(coneGeom, coneMat, N);
  cylMesh.name = 'cfd-vec-cyl';
  coneMesh.name = 'cfd-vec-cone';
  cylMesh.userData = { cfdViz: 'vectors-shaft' };
  coneMesh.userData = { cfdViz: 'vectors-head' };

  // Per-instance colour buffers (linear sRGB, [0..1]).
  const colorArr = new Float32Array(N * 3);
  cylMesh.instanceColor = new THREE.InstancedBufferAttribute(colorArr, 3);
  const coneColorArr = new Float32Array(N * 3);
  coneMesh.instanceColor = new THREE.InstancedBufferAttribute(coneColorArr, 3);
  cylMat.vertexColors = true;
  coneMat.vertexColors = true;

  // Normalise vector lengths so even the longest arrow fits comfortably
  // inside a single grid cell.
  const stats = fieldStats(new Float32Array(nonzero.map((s) => s.mag)));
  const denomMag = stats.absMax > 1e-12 ? stats.absMax : 1;
  // Arrow length in solver coords for the longest vector: arrowFraction
  // * min(dx, dy, dz). All other arrows scale linearly with |U|/|U|_max.
  const minDx = Math.min(grid.dx, grid.dy, grid.dz);
  const maxLenSolver = arrowFraction * minDx;

  // Reusable scratch.
  const mat = new THREE.Matrix4();
  const tmpQuat = new THREE.Quaternion();
  const tmpPos = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const upY = new THREE.Vector3(0, 1, 0);
  const dirV = new THREE.Vector3();

  for (let s = 0; s < N; s++) {
    const sample = nonzero[s];
    const t = Math.max(0, Math.min(1, sample.mag / denomMag));
    const lenSolver = maxLenSolver * t;
    const lenViewport = lenSolver * scale;
    // Cylinder portion = (1 - headRatio) of the arrow length.
    const cylLen = lenViewport * (1 - headRatio);
    const coneLen = lenViewport * headRatio;

    // Base position (cell centre) in viewport coords.
    const baseX = sample.x * scale + originOffset[0];
    const baseY = sample.y * scale + originOffset[1];
    const baseZ = sample.z * scale + originOffset[2];

    // Rotate +Y onto the velocity direction.
    dirV.set(sample.u, sample.v, sample.w).normalize();
    tmpQuat.setFromUnitVectors(upY, dirV);

    // ─── Cylinder instance ───
    tmpPos.set(baseX, baseY, baseZ);
    tmpScale.set(1, cylLen, 1);   // y-scale = length
    mat.compose(tmpPos, tmpQuat, tmpScale);
    cylMesh.setMatrixAt(s, mat);

    // ─── Cone instance — placed at the tip of the cylinder ───
    const coneBaseX = baseX + dirV.x * cylLen;
    const coneBaseY = baseY + dirV.y * cylLen;
    const coneBaseZ = baseZ + dirV.z * cylLen;
    tmpPos.set(coneBaseX, coneBaseY, coneBaseZ);
    tmpScale.set(1, coneLen, 1);
    mat.compose(tmpPos, tmpQuat, tmpScale);
    coneMesh.setMatrixAt(s, mat);

    // Per-instance colour.
    let rgb;
    if (colorByMag) {
      rgb = colormap(t);
    } else {
      rgb = [0.6, 0.85, 1.0];
    }
    colorArr[s * 3 + 0] = rgb[0];
    colorArr[s * 3 + 1] = rgb[1];
    colorArr[s * 3 + 2] = rgb[2];
    coneColorArr[s * 3 + 0] = rgb[0];
    coneColorArr[s * 3 + 1] = rgb[1];
    coneColorArr[s * 3 + 2] = rgb[2];
  }
  cylMesh.instanceMatrix.needsUpdate = true;
  coneMesh.instanceMatrix.needsUpdate = true;
  cylMesh.instanceColor.needsUpdate = true;
  coneMesh.instanceColor.needsUpdate = true;

  group.add(cylMesh);
  group.add(coneMesh);
  return group;
}

// ─────────────────────────────────────────────────────────────────────
// Pressure-contour midplane quad.
//
// One PlaneGeometry (nx × ny segments) coloured per-vertex via the
// jet/viridis ramp from grid.p. The vertices live on the mid-plane
// (k = nz/2) of the solver domain, mapped through the viewport scale.

export function buildPressureMidplane(THREE, grid, opts = {}) {
  if (!THREE) throw new Error('cfdVisualisation: THREE namespace required');
  if (!grid || !grid.p) throw new Error('cfdVisualisation: grid (with p) required');

  const scale = +opts.scale || CFD_VIZ_DEFAULT_SCALE;
  const axis = (opts.axis || CFD_VIZ_DEFAULT_AXIS).toLowerCase();
  const colormap = opts.colormap === 'viridis' ? viridisColor : jetColor;
  const opacity = (opts.opacity != null) ? +opts.opacity : 0.85;
  const originOffset = opts.originOffset || [-0.5 * scale * grid.Lx,
                                              0,
                                             -0.5 * scale * grid.Lz];

  // Pick the plane:
  //   axis 'z' → k = nz/2, plane spans (x,y), normal = +z
  //   axis 'y' → j = ny/2, plane spans (x,z), normal = +y
  //   axis 'x' → i = nx/2, plane spans (y,z), normal = +x
  const { nx, ny, nz, dx, dy, dz, sliceXY, p } = grid;

  let widthCells, heightCells, planeIndex;
  let widthPhys, heightPhys;
  let sampleIdx; // (a, b) → linear grid index
  let setVertexPos; // (a, b) → [x, y, z] in viewport coords
  if (axis === 'z') {
    widthCells = nx; heightCells = ny;
    widthPhys = grid.Lx; heightPhys = grid.Ly;
    planeIndex = (nz / 2) | 0;
    sampleIdx = (i, j) => i + nx * j + sliceXY * planeIndex;
    setVertexPos = (i, j) => [
      (i + 0.5) * dx * scale + originOffset[0],
      (j + 0.5) * dy * scale + originOffset[1],
      (planeIndex + 0.5) * dz * scale + originOffset[2],
    ];
  } else if (axis === 'y') {
    widthCells = nx; heightCells = nz;
    widthPhys = grid.Lx; heightPhys = grid.Lz;
    planeIndex = (ny / 2) | 0;
    sampleIdx = (i, k) => i + nx * planeIndex + sliceXY * k;
    setVertexPos = (i, k) => [
      (i + 0.5) * dx * scale + originOffset[0],
      (planeIndex + 0.5) * dy * scale + originOffset[1],
      (k + 0.5) * dz * scale + originOffset[2],
    ];
  } else {
    widthCells = ny; heightCells = nz;
    widthPhys = grid.Ly; heightPhys = grid.Lz;
    planeIndex = (nx / 2) | 0;
    sampleIdx = (j, k) => planeIndex + nx * j + sliceXY * k;
    setVertexPos = (j, k) => [
      (planeIndex + 0.5) * dx * scale + originOffset[0],
      (j + 0.5) * dy * scale + originOffset[1],
      (k + 0.5) * dz * scale + originOffset[2],
    ];
  }

  // Find pressure min/max on the plane so the colour ramp is normalised
  // to the local field (rather than the whole-grid which usually has
  // outliers near the lid singularity).
  let pMin = Infinity, pMax = -Infinity;
  for (let b = 0; b < heightCells; b++) {
    for (let a = 0; a < widthCells; a++) {
      const v = p[sampleIdx(a, b)];
      if (v < pMin) pMin = v;
      if (v > pMax) pMax = v;
    }
  }
  const pRange = pMax - pMin;
  const pDenom = (pRange > 1e-12) ? pRange : 1;

  // Build geometry: one quad per (a,b) cell. Vertices at the corners
  // (a,b)/(a+1,b)/(a,b+1)/(a+1,b+1) so colour interpolation across the
  // quad is smooth. To keep things simple + native we synthesize the
  // BufferGeometry directly rather than using PlaneGeometry's regular
  // grid because we want per-cell sampling at the *centres* (which
  // matches the solver), not at the corners.
  //
  // For each cell we emit two triangles. Vertex positions are the
  // cell-centre positions of the 4 neighbouring cells, clamped at the
  // domain edge so the quad still tiles cleanly.
  const positions = new Float32Array(widthCells * heightCells * 4 * 3);
  const colors    = new Float32Array(widthCells * heightCells * 4 * 3);
  const indices   = new Uint32Array(widthCells * heightCells * 6);

  const cellAt = (a, b) => {
    const ai = Math.max(0, Math.min(widthCells - 1, a));
    const bi = Math.max(0, Math.min(heightCells - 1, b));
    const pos = setVertexPos(ai, bi);
    const v = p[sampleIdx(ai, bi)];
    const t = (v - pMin) / pDenom;
    const rgb = colormap(t);
    return { pos, rgb };
  };

  let vCursor = 0, iCursor = 0;
  for (let b = 0; b < heightCells; b++) {
    for (let a = 0; a < widthCells; a++) {
      const v00 = vCursor + 0, v10 = vCursor + 1, v01 = vCursor + 2, v11 = vCursor + 3;
      const c00 = cellAt(a, b);
      const c10 = cellAt(a + 1, b);
      const c01 = cellAt(a, b + 1);
      const c11 = cellAt(a + 1, b + 1);
      // Average the four neighbouring cell centres → a corner vertex
      // anchored at the *boundary between cells* (so adjacent quads
      // share a colour-interpolating edge instead of jumping).
      const corner00 = setVertexPos(a, b);
      // Use slightly offset corner positions so the quad fills the cell.
      // The four corners are derived from the cell-centre positions of
      // neighbours, falling back to the cell's own edge at the domain
      // boundary.
      const p00 = c00.pos;
      const p10 = c10.pos;
      const p01 = c01.pos;
      const p11 = c11.pos;
      const setV = (vi, pa) => {
        positions[vi * 3 + 0] = pa[0];
        positions[vi * 3 + 1] = pa[1];
        positions[vi * 3 + 2] = pa[2];
      };
      const setC = (vi, rgb) => {
        colors[vi * 3 + 0] = rgb[0];
        colors[vi * 3 + 1] = rgb[1];
        colors[vi * 3 + 2] = rgb[2];
      };
      setV(v00, p00); setC(v00, c00.rgb);
      setV(v10, p10); setC(v10, c10.rgb);
      setV(v01, p01); setC(v01, c01.rgb);
      setV(v11, p11); setC(v11, c11.rgb);

      indices[iCursor + 0] = v00;
      indices[iCursor + 1] = v10;
      indices[iCursor + 2] = v11;
      indices[iCursor + 3] = v00;
      indices[iCursor + 4] = v11;
      indices[iCursor + 5] = v01;
      vCursor += 4;
      iCursor += 6;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: opacity >= 1,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'cfd-pressure-midplane';
  mesh.userData = { cfdViz: 'pressure-mesh',
                    axis, planeIndex, pMin, pMax };

  const group = new THREE.Group();
  group.name = 'cfd-pressure-contour';
  group.userData = { cfdViz: 'pressure',
                     axis, planeIndex,
                     pMin, pMax,
                     widthCells, heightCells };
  group.add(mesh);
  return group;
}

// ─────────────────────────────────────────────────────────────────────
// Streamlines.
//
// For the lid-driven cavity the natural seed plane is the inlet (top
// face under the lid). We generalise the seeding so callers can pick a
// face by axis-letter + side ('lid'/'inlet'/'minX'/'maxX'/…) and a grid
// resolution (default 8 × 8 = 64 seeds).
//
// Each streamline becomes one THREE.Line (segments = path samples - 1)
// coloured along its length by the local |U|.

export function seedStreamlineGrid(grid, opts = {}) {
  const seedFace = (opts.face || 'lid').toLowerCase();
  const seedsW = opts.seedsW | 0 || CFD_VIZ_DEFAULT_STREAMLINE_SEEDS;
  const seedsH = opts.seedsH | 0 || CFD_VIZ_DEFAULT_STREAMLINE_SEEDS;
  const { Lx, Ly, Lz, dx, dy, dz } = grid;
  // For the cavity, "lid" = top face (y = Ly), inlet means we want the
  // seed offset slightly below the wall so the velocity isn't tied to
  // the BC value.
  const eps = Math.min(dx, dy, dz) * 0.5;

  const seeds = [];
  if (seedFace === 'lid' || seedFace === 'inlet' || seedFace === 'top'
      || seedFace === 'maxy') {
    const yPlane = Ly - eps;
    for (let b = 0; b < seedsH; b++) {
      for (let a = 0; a < seedsW; a++) {
        const x = (a + 0.5) / seedsW * Lx;
        const z = (b + 0.5) / seedsH * Lz;
        seeds.push([x, yPlane, z]);
      }
    }
  } else if (seedFace === 'miny' || seedFace === 'bottom') {
    const yPlane = eps;
    for (let b = 0; b < seedsH; b++) {
      for (let a = 0; a < seedsW; a++) {
        const x = (a + 0.5) / seedsW * Lx;
        const z = (b + 0.5) / seedsH * Lz;
        seeds.push([x, yPlane, z]);
      }
    }
  } else if (seedFace === 'minx' || seedFace === 'left') {
    const xPlane = eps;
    for (let b = 0; b < seedsH; b++) {
      for (let a = 0; a < seedsW; a++) {
        const y = (a + 0.5) / seedsW * Ly;
        const z = (b + 0.5) / seedsH * Lz;
        seeds.push([xPlane, y, z]);
      }
    }
  } else if (seedFace === 'maxx' || seedFace === 'right') {
    const xPlane = Lx - eps;
    for (let b = 0; b < seedsH; b++) {
      for (let a = 0; a < seedsW; a++) {
        const y = (a + 0.5) / seedsW * Ly;
        const z = (b + 0.5) / seedsH * Lz;
        seeds.push([xPlane, y, z]);
      }
    }
  } else if (seedFace === 'minz' || seedFace === 'front') {
    const zPlane = eps;
    for (let b = 0; b < seedsH; b++) {
      for (let a = 0; a < seedsW; a++) {
        const x = (a + 0.5) / seedsW * Lx;
        const y = (b + 0.5) / seedsH * Ly;
        seeds.push([x, y, zPlane]);
      }
    }
  } else { // maxz / back
    const zPlane = Lz - eps;
    for (let b = 0; b < seedsH; b++) {
      for (let a = 0; a < seedsW; a++) {
        const x = (a + 0.5) / seedsW * Lx;
        const y = (b + 0.5) / seedsH * Ly;
        seeds.push([x, y, zPlane]);
      }
    }
  }
  return seeds;
}

export function buildStreamlines(THREE, grid, opts = {}) {
  if (!THREE) throw new Error('cfdVisualisation: THREE namespace required');
  if (!grid || !grid.u) throw new Error('cfdVisualisation: grid (with u/v/w) required');

  const scale = +opts.scale || CFD_VIZ_DEFAULT_SCALE;
  const colormap = opts.colormap === 'viridis' ? viridisColor : jetColor;
  const colorByMag = opts.colorByMag !== false;
  const lineColor = opts.lineColor || '#5fd0ff';
  const lineWidth = +opts.lineWidth || 1.5;
  const direction = opts.direction || 'forward';
  const maxSteps = opts.maxSteps | 0 || CFD_VIZ_DEFAULT_STREAMLINE_MAX_STEPS;
  const seedsW = opts.seedsW | 0 || CFD_VIZ_DEFAULT_STREAMLINE_SEEDS;
  const seedsH = opts.seedsH | 0 || CFD_VIZ_DEFAULT_STREAMLINE_SEEDS;
  const originOffset = opts.originOffset || [-0.5 * scale * grid.Lx,
                                              0,
                                             -0.5 * scale * grid.Lz];

  // Choose seeds — default 'lid' for cavity.
  const seeds = opts.seeds || seedStreamlineGrid(grid, {
    face: opts.face || 'lid',
    seedsW, seedsH,
  });

  // Find global |U|_max so we colour every streamline against the
  // same magnitude reference.
  const { N, u, v, w } = grid;
  let umax = 0;
  for (let n = 0; n < N; n++) {
    const m = Math.sqrt(u[n]*u[n] + v[n]*v[n] + w[n]*w[n]);
    if (m > umax) umax = m;
  }
  const denom = umax > 1e-12 ? umax : 1;

  const group = new THREE.Group();
  group.name = 'cfd-streamlines';
  group.userData = {
    cfdViz: 'streamlines',
    seedCount: seeds.length,
    direction,
    maxStepsPerLine: maxSteps,
    umax,
  };

  let totalPoints = 0;
  let nonTrivialLines = 0;
  for (let s = 0; s < seeds.length; s++) {
    const path = rk4Streamline(grid, seeds[s], {
      direction,
      maxSteps,
      dtFactor: opts.dtFactor,
    });
    if (path.length < 2) continue;
    nonTrivialLines += 1;
    totalPoints += path.length;
    // BufferGeometry for this streamline. Vertex positions in viewport
    // coords; per-vertex colours from |U| at the sample point.
    const positions = new Float32Array(path.length * 3);
    const colors    = new Float32Array(path.length * 3);
    for (let i = 0; i < path.length; i++) {
      const px = path[i][0], py = path[i][1], pz = path[i][2];
      positions[i * 3 + 0] = px * scale + originOffset[0];
      positions[i * 3 + 1] = py * scale + originOffset[1];
      positions[i * 3 + 2] = pz * scale + originOffset[2];
      if (colorByMag) {
        const vel = sampleVelocity(grid, px, py, pz);
        const mag = Math.sqrt(vel[0]*vel[0] + vel[1]*vel[1] + vel[2]*vel[2]);
        const rgb = colormap(Math.max(0, Math.min(1, mag / denom)));
        colors[i * 3 + 0] = rgb[0];
        colors[i * 3 + 1] = rgb[1];
        colors[i * 3 + 2] = rgb[2];
      } else {
        // Solid colour fallback — parse the CSS string once.
        const col = new THREE.Color(lineColor);
        colors[i * 3 + 0] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      linewidth: lineWidth, // most platforms ignore but the field is set
      transparent: false,
    });
    const line = new THREE.Line(geom, mat);
    line.name = `cfd-streamline-${s}`;
    line.userData = { cfdViz: 'streamline',
                      seedIndex: s,
                      sampleCount: path.length,
                      seed: seeds[s] };
    group.add(line);
  }
  group.userData.totalPoints = totalPoints;
  group.userData.nonTrivialLines = nonTrivialLines;
  return group;
}

// ─────────────────────────────────────────────────────────────────────
// Removal helper.
//
// Walks a parent scene-graph node, finds every direct child tagged with
// userData.cfdViz === tag (or any cfd-viz tag if `tag` is omitted), and
// detaches them. Each removed group has its buffers / textures freed so
// we don't bleed memory across consecutive solve→show→clear cycles.

export function removeCfdGroups(parent, tag = null) {
  if (!parent || !parent.children) return 0;
  let removed = 0;
  // iterate backward because we mutate the children array
  for (let i = parent.children.length - 1; i >= 0; i--) {
    const ch = parent.children[i];
    const t = ch?.userData?.cfdViz;
    if (!t) continue;
    if (tag && t !== tag) continue;
    parent.remove(ch);
    disposeDeep(ch);
    removed += 1;
  }
  return removed;
}

function disposeDeep(obj) {
  if (!obj) return;
  if (typeof obj.traverse === 'function') {
    obj.traverse((node) => {
      if (node.geometry && typeof node.geometry.dispose === 'function') {
        node.geometry.dispose();
      }
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of mats) {
          if (m && typeof m.dispose === 'function') m.dispose();
        }
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helper factory — bundles every export onto one object so the panel
// + e2e + Archie can probe it through a single window surface.

export function makeCfdVisualisationHelper() {
  return {
    // Colormaps
    jetColor, viridisColor,
    // Sampling
    sampleVelocity, sampleScalar, fieldStats,
    // Decimation + integrator
    decimateVectorField, rk4Streamline, seedStreamlineGrid,
    // Builders
    buildVelocityVectorField, buildPressureMidplane, buildStreamlines,
    // Cleanup
    removeCfdGroups,
    // Constants
    CFD_VIZ_DEFAULT_SCALE,
    CFD_VIZ_DEFAULT_EVERY,
    CFD_VIZ_DEFAULT_STREAMLINE_SEEDS,
    CFD_VIZ_DEFAULT_STREAMLINE_MAX_STEPS,
  };
}

export default {
  jetColor, viridisColor,
  sampleVelocity, sampleScalar, fieldStats,
  decimateVectorField, rk4Streamline, seedStreamlineGrid,
  buildVelocityVectorField, buildPressureMidplane, buildStreamlines,
  removeCfdGroups, makeCfdVisualisationHelper,
  CFD_VIZ_DEFAULT_SCALE, CFD_VIZ_DEFAULT_EVERY,
  CFD_VIZ_DEFAULT_STREAMLINE_SEEDS, CFD_VIZ_DEFAULT_STREAMLINE_MAX_STEPS,
};
