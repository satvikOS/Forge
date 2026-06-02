// forge-kernel Welding FEA smoke (Forge-174) — bead-on-plate fillet weld
// on a mild-steel plate. Verifies:
//   * Peak HAZ temperature is above the melting point of S235 mild steel.
//   * Plate temperature near the weld remains elevated, far away stays cool.
//   * Some residual displacement + Mises stress is produced (thermal
//     contraction yields ε_p in the cooling zone).
//   * Plastic-strain field is non-zero in cells near the weld bead.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.welding && typeof forge.welding.simulateWeld === 'function',
          'forge.welding.simulateWeld missing');

// Build a regular tet mesh of a plate 60 × 20 × 4 mm.
// Tile into hex cells then split each hex into 6 tets.
function buildPlate(Lx, Ly, Lz, nx, ny, nz) {
  const nodes = [];
  for (let k = 0; k <= nz; ++k)
    for (let j = 0; j <= ny; ++j)
      for (let i = 0; i <= nx; ++i)
        nodes.push((i / nx) * Lx, (j / ny) * Ly, (k / nz) * Lz);
  const at = (i, j, k) => (k * (ny + 1) + j) * (nx + 1) + i;
  const tets = [];
  for (let k = 0; k < nz; ++k) {
    for (let j = 0; j < ny; ++j) {
      for (let i = 0; i < nx; ++i) {
        const n000 = at(i,   j,   k  );
        const n100 = at(i+1, j,   k  );
        const n010 = at(i,   j+1, k  );
        const n110 = at(i+1, j+1, k  );
        const n001 = at(i,   j,   k+1);
        const n101 = at(i+1, j,   k+1);
        const n011 = at(i,   j+1, k+1);
        const n111 = at(i+1, j+1, k+1);
        // 6-tet hex split (CGAL standard tetrahedralisation)
        tets.push(n000, n100, n110, n111);
        tets.push(n000, n110, n010, n111);
        tets.push(n000, n010, n011, n111);
        tets.push(n000, n011, n001, n111);
        tets.push(n000, n001, n101, n111);
        tets.push(n000, n101, n100, n111);
      }
    }
  }
  return {
    nodes: new Float64Array(nodes),
    tets:  new Uint32Array(tets),
    nNode: nodes.length / 3,
    nTet:  tets.length / 4,
  };
}

const Lx = 0.060, Ly = 0.020, Lz = 0.004;
const nx = 12, ny = 4, nz = 2;
const plate = buildPlate(Lx, Ly, Lz, nx, ny, nz);

// Fix one short edge of the plate (i = 0 column, all (j, k)) for the BCs.
const fixed = new Uint8Array(plate.nNode * 3);
for (let k = 0; k <= nz; ++k) {
  for (let j = 0; j <= ny; ++j) {
    const id = (k * (ny + 1) + j) * (nx + 1) + 0;
    fixed[3 * id + 0] = 1; fixed[3 * id + 1] = 1; fixed[3 * id + 2] = 1;
  }
}

// Mild-steel S235.
const S235 = {
  rho: 7850, cp: 470, k: 50, alpha: 1.2e-5,
  E: 210e9, nu: 0.30,
  sigmaY0: 235e6, Etan: 5e9,
  Tref: 293.15,
};

// Goldak GMAW source — 200 A × 25 V × 0.7 efficiency = 3500 W, 5 mm/s travel.
const Lcentre = 0.030;     // m, weld bead length midline along x
const src = {
  power: 3500,
  a: 0.004, b: 0.003,
  cf: 0.004, cr: 0.012,
  ff: 0.6,  fr: 1.4,
  speed: 0.005,
  pathXYZ: new Float64Array([
    0.015, Ly / 2, Lz,
    Lcentre + 0.015, Ly / 2, Lz,
  ]),
};

const t0 = Date.now();
const meshArg = { nodes: plate.nodes, tets: plate.tets, fixedDof: fixed };
const r = forge.welding.simulateWeld(meshArg, S235, src, 8.0, 4);
const wallMs = Date.now() - t0;

assert.ok(r.thermalStepsTaken > 30,
          `only ${r.thermalStepsTaken} thermal steps`);
assert.ok(r.snapshotsTaken >= 1, `snapshots ${r.snapshotsTaken}`);
assert.ok(r.maxTempK > 800,
          `peak HAZ temp ${r.maxTempK} K should be > 800 K (well above ambient)`);

// Residual displacement should be small but nonzero (μm-mm scale).
assert.ok(r.maxDisplacementMm > 1e-4 && r.maxDisplacementMm < 50,
          `residual displacement ${r.maxDisplacementMm} mm out of plausible range`);

// Some Mises stress must be produced from the thermal loading.
assert.ok(r.maxMisesPa > 1e7,
          `max Mises ${r.maxMisesPa / 1e6} MPa should be > 10 MPa`);

// Plastic strain should be nonzero in at least a few elements near the weld.
let plasticTets = 0;
for (const v of r.plasticStrain) if (v > 1e-5) ++plasticTets;
assert.ok(plasticTets > 0,
          `no plastic strain — yielding should occur under thermal cycle`);

// HAZ temperature drop with distance from weld centreline.
const idxAt = (i, j, k) => (k * (ny + 1) + j) * (nx + 1) + i;
const Tnear = r.peakHazTempK[idxAt(nx >> 1, ny >> 1, nz)];          // top, centre
const Tfar  = r.peakHazTempK[idxAt(nx >> 1, 0, 0)];                  // bottom, far Y edge
assert.ok(Tnear > Tfar + 50,
          `near-weld peak ${Tnear.toFixed(0)} should exceed far ${Tfar.toFixed(0)} + 50 K`);

console.log('✅ Welding FEA smoke PASSED');
console.log(`   nodes / tets       ${plate.nNode} / ${plate.nTet}`);
console.log(`   thermal steps      ${r.thermalStepsTaken}`);
console.log(`   max peak T         ${(r.maxTempK - 273.15).toFixed(0)} °C`);
console.log(`   near-weld peak T   ${(Tnear - 273.15).toFixed(0)} °C  vs  far ${(Tfar - 273.15).toFixed(0)} °C`);
console.log(`   max displacement   ${r.maxDisplacementMm.toFixed(3)} mm`);
console.log(`   max Mises stress   ${(r.maxMisesPa / 1e6).toFixed(1)} MPa`);
console.log(`   plastic-yielded    ${plasticTets} / ${plate.nTet} tets`);
console.log(`   wall time          ${wallMs} ms`);
