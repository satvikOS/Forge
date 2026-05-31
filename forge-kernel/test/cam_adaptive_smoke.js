// cam_adaptive_smoke.js (Forge-33) — 3-axis adaptive clearing smoke.
//
// Geometry: 100 × 60 × 20 mm box of stock. Operation: adaptive-clear from
// z = 20 down to z = 5 with a 6 mm endmill and 4 mm stepover. Asserts:
//   * move count > 50 (real spiral, not a degenerate one-pass)
//   * cycle time > 0
//   * engagement-arc feedrate modulation visible (at least two distinct
//     cutting feedrates in the output stream).

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

console.log('[cam-adaptive-smoke] version =', forge.version());
assert.ok(forge.cam, 'forge.cam missing');
assert.ok(typeof forge.cam.adaptiveClear === 'function',
  'forge.cam.adaptiveClear missing');

// ---------------------------------------------------------- stock
const DX = 100, DY = 60, DZ = 20;
const stock = forge.translate(forge.makeBox(DX, DY, DZ), -DX / 2, -DY / 2, 0);

const stockAabb = Float64Array.from([
  -DX / 2, -DY / 2, 0,
   DX / 2,  DY / 2, DZ,
]);

const endMill = {
  id: 11, name: '6mm carbide endmill', diameter: 6, fluteLength: 25,
  helix: 35, flutes: 4, type: 'EndMill',
};

const cuttingParams = {
  feedXY: 1200, feedZ: 300, spindleRPM: 16000,
  stepover: 4, stepdown: 3, coolant: 1.0,
};

const adaptive = {
  stepover:   4,    // mm
  zMax:       20,
  zMin:       5,
  helixAngle: 3,    // degrees
  minRadius:  6,    // mm — below this, feed scales down
};

// ---------------------------------------------------------- run
const tp = forge.cam.adaptiveClear(stock, stockAabb, endMill, cuttingParams, adaptive);
console.log(`[cam-adaptive-smoke] moves=${tp.moveCount} cycle=${tp.cycleTimeSec.toFixed(2)}s ` +
            `cuttingMm=${tp.estCuttingMm.toFixed(1)}`);

// move count
assert.ok(tp.moveCount > 50,
  `expected moves > 50, got ${tp.moveCount}`);

// cycle time
assert.ok(tp.cycleTimeSec > 0,
  `expected cycle time > 0, got ${tp.cycleTimeSec}`);

// engagement-arc feedrate modulation: collect distinct cutting feedrates.
const distinctFeeds = new Set();
for (let i = 0; i < tp.moveCount; ++i) {
  const cutting = tp.moves[i * 5 + 3] > 0.5;
  if (cutting) {
    // Round to 0.1 mm/min to dedup floating-point noise.
    distinctFeeds.add(Math.round(tp.moves[i * 5 + 4] * 10) / 10);
  }
}
console.log(`[cam-adaptive-smoke] distinct cutting feeds = ${distinctFeeds.size}`);
assert.ok(distinctFeeds.size >= 2,
  `expected >= 2 distinct cutting feeds (engagement-arc modulation), got ${distinctFeeds.size}`);

// cleanup
forge.release(stock);

console.log('[cam-adaptive-smoke] ALL PASS');
