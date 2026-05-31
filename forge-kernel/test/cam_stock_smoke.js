// cam_stock_smoke.js (Forge-33) — voxel stock simulation smoke.
//
// Run a profile op on a 100×60×20 stock, then sweep the toolpath through
// the voxel simulator. Assert:
//   * residue volume < initial stock volume (we actually removed material)
//   * collision count == 0 (no voxel cleared below stock floor)

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

console.log('[cam-stock-smoke] version =', forge.version());
assert.ok(forge.cam, 'forge.cam missing');
assert.ok(typeof forge.cam.simulateStock === 'function');

// ---------------------------------------------------------- stock
const DX = 100, DY = 60, DZ = 20;
const stock = forge.translate(forge.makeBox(DX, DY, DZ), -DX / 2, -DY / 2, 0);
const stockAabb = Float64Array.from([
  -DX / 2, -DY / 2, 0,
   DX / 2,  DY / 2, DZ,
]);

const endMill = {
  id: 31, name: '8mm endmill', diameter: 8, fluteLength: 25,
  helix: 30, flutes: 4, type: 'EndMill',
};
const params = {
  feedXY: 1000, feedZ: 250, spindleRPM: 14000,
  stepover: 4, stepdown: 4, coolant: 1.0,
};

// ---------------------------------------------------------- toolpath
const tp = forge.cam.profile(stock, forge.cam.kAutoFaceId,
                             endMill, params,
                             /*zTop*/ 20, /*zBottom*/ 5, /*leadIn*/ 0);
console.log(`[cam-stock-smoke] toolpath moves=${tp.moveCount} cuttingMm=${tp.estCuttingMm.toFixed(1)}`);

// ---------------------------------------------------------- simulate
const rep = forge.cam.simulateStock(stockAabb, tp, endMill, /*grid*/ 50);
console.log(`[cam-stock-smoke] init=${rep.initialVolume.toFixed(0)} ` +
            `remaining=${rep.remainingVolume.toFixed(0)} ` +
            `cutDepth=${rep.maxCutDepth.toFixed(2)} ` +
            `collisions=${rep.collisionCount} ` +
            `grid=${rep.gridResolution}`);

assert.ok(rep.initialVolume > 0, 'initial volume must be > 0');
assert.ok(rep.remainingVolume < rep.initialVolume,
  `residue volume (${rep.remainingVolume.toFixed(1)}) >= initial (${rep.initialVolume.toFixed(1)})`);
assert.strictEqual(rep.collisionCount, 0,
  `expected 0 collisions, got ${rep.collisionCount}`);
assert.ok(rep.maxCutDepth > 0, 'maxCutDepth must be > 0');
assert.ok(rep.residueDistribution.length === 16, 'histogram must have 16 bins');

forge.release(stock);
console.log('[cam-stock-smoke] ALL PASS');
