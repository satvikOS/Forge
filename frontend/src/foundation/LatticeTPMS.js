/**
 * LatticeTPMS — Triply-Periodic Minimal Surface (TPMS) infill SDFs for
 * additive-manufacturing-class lattice generation. This is the flagship
 * modern-AM feature in nTopology / Carbon / Creo Lattice / NX Lattice
 * that the ArchDisc kernel was missing entirely. The SDFs here are the
 * planning half; the watertight solid is built by Manifold.levelSet
 * from manifold-3d (foundation already loads it for booleans).
 *
 * What this gives Mech that it didn't have before:
 *   - Lightweight engineered infill (60-80% mass reduction at a target
 *     stiffness) by lattice substitution of a bulk body
 *   - Heat-exchanger / bioscaffold / vibration-damping topologies
 *   - A real implicit-function modelling primitive, the first step on
 *     the road to a full implicit-modelling workbench
 *
 * TPMS catalogue (level set f(x,y,z) = 0 → minimal surface):
 *   Gyroid (Schoen 1970)
 *     f = sin(ωx)·cos(ωy) + sin(ωy)·cos(ωz) + sin(ωz)·cos(ωx)
 *     The most popular AM lattice — no straight directions, isotropic,
 *     prints without supports.
 *   Schwarz-P (Schwarz 1865 "primitive")
 *     f = cos(ωx) + cos(ωy) + cos(ωz)
 *     Cubic-symmetric, larger pore size for the same cell.
 *
 * The "sheet" form thickens the iso=0 surface by t:
 *     f_sheet(x) = t − |f(x)|          (positive ⇔ inside the wall)
 * The "solid" form keeps everything on one side of an offset:
 *     f_solid(x) = t − f(x)            (positive ⇔ solid network)
 *
 * Sign convention follows manifold-3d's Manifold.levelSet contract:
 * **positive = inside, negative = outside** (typings line 619). We pass
 * `level = 0` so the surface is built at f = 0 and the f > 0 region
 * becomes the resulting watertight solid.
 */

const TWO_PI = Math.PI * 2;
const EPS = 1e-9;

/** Gyroid SDF — period = cellSize (mm). */
export function gyroidSDF(cellSize) {
  const w = TWO_PI / Math.max(EPS, cellSize);
  return function gyroid([x, y, z]) {
    const sx = Math.sin(w * x), cx = Math.cos(w * x);
    const sy = Math.sin(w * y), cy = Math.cos(w * y);
    const sz = Math.sin(w * z), cz = Math.cos(w * z);
    return sx * cy + sy * cz + sz * cx;
  };
}

/** Schwarz-P SDF — period = cellSize (mm). */
export function schwarzPSDF(cellSize) {
  const w = TWO_PI / Math.max(EPS, cellSize);
  return function schwarzP([x, y, z]) {
    return Math.cos(w * x) + Math.cos(w * y) + Math.cos(w * z);
  };
}

/** Diamond (Schwarz-D) SDF — period = cellSize (mm). */
export function diamondSDF(cellSize) {
  const w = TWO_PI / Math.max(EPS, cellSize);
  return function diamond([x, y, z]) {
    const sx = Math.sin(w * x), cx = Math.cos(w * x);
    const sy = Math.sin(w * y), cy = Math.cos(w * y);
    const sz = Math.sin(w * z), cz = Math.cos(w * z);
    return sx * sy * sz + sx * cy * cz + cx * sy * cz + cx * cy * sz;
  };
}

const FAMILIES = {
  gyroid:    gyroidSDF,
  schwarzp:  schwarzPSDF,
  schwarz:   schwarzPSDF,       // alias
  diamond:   diamondSDF,
  schwarzd:  diamondSDF,        // alias
};

/**
 * Build the sampling spec for Manifold.levelSet:
 *   { bounds, sdf, edgeLength, level }
 * The caller passes this into Mod.Manifold.levelSet(sdf, bounds, edgeLength, level).
 *
 * @param {object} opts
 * @param {string} opts.family     'gyroid' | 'schwarzP' | 'diamond'
 * @param {[number,number,number]} opts.size  bounding box size in mm (X, Y, Z)
 * @param {number} opts.cellSize   period of the TPMS in mm
 * @param {number} opts.isoLevel   wall threshold; sheet form: |f| < isoLevel = solid
 * @param {string} opts.form       'sheet' (default) or 'solid'
 * @param {number} opts.resolution marching-cubes spacing in mm (smaller = finer)
 * @param {[number,number,number]=} opts.origin  bbox origin (default 0,0,0 → bbox spans 0..size)
 */
export function buildLatticeSpec({
  family = 'gyroid',
  size,
  cellSize,
  isoLevel = 0.5,
  form = 'sheet',
  resolution,
  origin = [0, 0, 0],
}) {
  if (!Array.isArray(size) || size.length !== 3) {
    throw new Error('buildLatticeSpec: size must be [x, y, z] in mm');
  }
  if (!(cellSize > 0)) throw new Error('buildLatticeSpec: cellSize must be > 0');
  if (!(resolution > 0)) throw new Error('buildLatticeSpec: resolution must be > 0');
  const fam = String(family).toLowerCase().replace(/[-_\s]/g, '');
  const sdfBuilder = FAMILIES[fam];
  if (!sdfBuilder) {
    throw new Error(`buildLatticeSpec: unknown TPMS family '${family}' — known: ${Object.keys(FAMILIES).join(', ')}`);
  }
  const tpmsSDF = sdfBuilder(cellSize);
  // Manifold.levelSet contract: f > 0 = inside, f < 0 = outside.
  //   sheet form: f(x) = t − |TPMS(x)|  → positive inside the mid-shell wall
  //   solid form: f(x) = t − TPMS(x)    → positive on one side of an offset iso
  const sdf = form === 'solid'
    ? ((p) => isoLevel - tpmsSDF(p))
    : ((p) => isoLevel - Math.abs(tpmsSDF(p)));
  const bounds = {
    min: [origin[0], origin[1], origin[2]],
    max: [origin[0] + size[0], origin[1] + size[1], origin[2] + size[2]],
  };
  return { bounds, sdf, edgeLength: resolution, level: 0, family: fam, form };
}

/**
 * Approximate volume fraction (solid / bbox) at the given iso level —
 * useful to surface in the result message before the marching-cubes run
 * decides the true volume. Sampling-based estimate; defaults to a
 * generous 32³ Monte-Carlo grid.
 */
export function estimateVolumeFraction(spec, samplesPerSide = 32) {
  const { bounds, sdf } = spec;
  const dx = (bounds.max[0] - bounds.min[0]) / samplesPerSide;
  const dy = (bounds.max[1] - bounds.min[1]) / samplesPerSide;
  const dz = (bounds.max[2] - bounds.min[2]) / samplesPerSide;
  let inside = 0, total = 0;
  for (let i = 0; i < samplesPerSide; i++) {
    const x = bounds.min[0] + (i + 0.5) * dx;
    for (let j = 0; j < samplesPerSide; j++) {
      const y = bounds.min[1] + (j + 0.5) * dy;
      for (let k = 0; k < samplesPerSide; k++) {
        const z = bounds.min[2] + (k + 0.5) * dz;
        if (sdf([x, y, z]) > 0) inside++;
        total++;
      }
    }
  }
  return inside / total;
}
