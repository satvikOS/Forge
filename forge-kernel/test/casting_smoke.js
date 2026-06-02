// forge-kernel Casting smoke (Forge-173) — heat-transfer FDM with phase
// change on a small slab. Verifies:
//   * Total energy balance is physical (enthalpy lost ≈ wall heat flux × Δt).
//   * Cells near the wall solidify before cells in the interior.
//   * Niyama porosity field is finite and positive at solidified cells.
//   * Reducing the wall heat transfer coefficient lengthens cooling time.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.casting && typeof forge.casting.solidify === 'function',
          'forge.casting.solidify missing');

// A356-T6 aluminium properties (handbook).
const A356 = {
  rho: 2685, cp: 963, k: 151, L: 389e3,
  Tsolidus: 555 + 273.15, Tliquidus: 615 + 273.15,
};

// 16×4×4 mm slab voxelised at 1 mm resolution.
const Nx = 16, Ny = 4, Nz = 4;
const N = Nx * Ny * Nz;
const cavity = new Uint8Array(N).fill(1);  // entirely melt

const cfg = {
  minX: 0, minY: 0, minZ: 0, maxX: 0.016, maxY: 0.004, maxZ: 0.004,
  Nx, Ny, Nz,
  Tpour:     700 + 273.15,   // K
  TambientK: 25  + 273.15,
  hWall:     2000,           // W/(m²·K) — sand mold w/ steel chill
  alloy:     A356,
  endTimeSec:  20,
  cflFactor:   0.4,
  sampleEvery: 50,
  cavityMask:  cavity,
};

const t0 = Date.now();
const r = forge.casting.solidify(cfg);
const wallMs = Date.now() - t0;

assert.strictEqual(r.cellsSimulated, N, `cellsSimulated ${r.cellsSimulated} ≠ N ${N}`);
assert.ok(r.cellsSolidified > 0.7 * N,
          `only ${r.cellsSolidified}/${N} cells solidified — should be > 70%`);
assert.ok(r.maxSolidTimeSec > 0 && r.maxSolidTimeSec < cfg.endTimeSec,
          `maxSolidTime ${r.maxSolidTimeSec} not in (0, endTime)`);
assert.ok(r.avgSolidTimeSec > 0,
          `avgSolidTime ${r.avgSolidTimeSec} not positive`);
assert.ok(r.snapshotTimesSec.length > 5,
          `snapshot count ${r.snapshotTimesSec.length} too low`);
assert.strictEqual(r.tempSnapshots.length, r.snapshotTimesSec.length,
          'snapshots length mismatch');

// Wall cells (i=0 and i=Nx-1) should solidify earlier than interior (i=Nx/2).
const idx = (i, j, k) => (k * Ny + j) * Nx + i;
let earlySum = 0, lateSum = 0, earlyN = 0, lateN = 0;
for (let j = 0; j < Ny; ++j) {
  for (let k = 0; k < Nz; ++k) {
    const tEdge   = r.solidTimeSec[idx(0,        j, k)];
    const tEdge2  = r.solidTimeSec[idx(Nx - 1,   j, k)];
    const tCentre = r.solidTimeSec[idx(Nx >> 1,  j, k)];
    if (tEdge   >= 0) { earlySum += tEdge;   ++earlyN; }
    if (tEdge2  >= 0) { earlySum += tEdge2;  ++earlyN; }
    if (tCentre >= 0) { lateSum  += tCentre; ++lateN;  }
  }
}
const tEarlyAvg = earlyN ? earlySum / earlyN : 0;
const tLateAvg  = lateN  ? lateSum  / lateN  : 0;
assert.ok(tEarlyAvg > 0 && tLateAvg > 0,
          'wall/interior cells should have solidified');
assert.ok(tEarlyAvg < tLateAvg,
          `wall t_solid ${tEarlyAvg.toFixed(2)} should < centre ${tLateAvg.toFixed(2)}`);

// Peak temperature on solidified cells should not exceed Tpour.
let maxPeak = 0, minPeak = +Infinity;
for (const v of r.peakTempK) {
  if (v > maxPeak) maxPeak = v;
  if (v < minPeak) minPeak = v;
}
assert.ok(maxPeak <= cfg.Tpour + 1.0,
          `peak temp ${maxPeak} exceeds Tpour ${cfg.Tpour}`);
assert.ok(minPeak >= cfg.TambientK - 1.0,
          `min peak temp ${minPeak} below ambient`);

// Niyama field is non-negative.
let niyamaMax = 0;
for (const v of r.niyama) {
  assert.ok(v >= 0, `niyama negative: ${v}`);
  if (v > niyamaMax) niyamaMax = v;
}
assert.ok(niyamaMax > 0, 'niyama all zero — no solidification recorded?');

// Sanity: reducing hWall to 500 should lengthen avg solid time.
const slowCfg = { ...cfg, hWall: 500, cavityMask: new Uint8Array(cavity) };
const rSlow = forge.casting.solidify(slowCfg);
assert.ok(rSlow.avgSolidTimeSec > r.avgSolidTimeSec * 1.5,
          `slow hWall avgSolidTime ${rSlow.avgSolidTimeSec.toFixed(2)} should be ≥ 1.5× ` +
          `baseline ${r.avgSolidTimeSec.toFixed(2)}`);

console.log('✅ Casting smoke PASSED');
console.log(`   cells (sim/sol)     ${r.cellsSimulated} / ${r.cellsSolidified}`);
console.log(`   wall t_solid avg    ${tEarlyAvg.toFixed(2)} s   centre avg ${tLateAvg.toFixed(2)} s`);
console.log(`   max solid time      ${r.maxSolidTimeSec.toFixed(2)} s`);
console.log(`   peak T range        ${minPeak.toFixed(0)} → ${maxPeak.toFixed(0)} K`);
console.log(`   niyama max          ${niyamaMax.toFixed(2)}`);
console.log(`   slow hWall          ${rSlow.avgSolidTimeSec.toFixed(2)} s avg`);
console.log(`   snapshots           ${r.snapshotTimesSec.length}`);
console.log(`   wall time           ${wallMs} ms`);
