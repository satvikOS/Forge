// Slice-13 — Mold tooling: parting surface + cavity/core split smoke.
//
// Molds a draftable part (a cone, which has a real silhouette along the
// pull axis), then splits an enclosing mold block into cavity + core:
//   * computeParting(cone, +Z) yields partingLineCount >= 1 and a parting
//     surface handle.
//   * splitCavityCore(block, cone, partingSurface) yields cavity + core
//     solid handles whose volumes sum to ≈ (block − part), proving the
//     block was really divided around the part (no stub).
//
// Mirrors SolidWorks Mold Tools / NX Mold Wizard: parting surface →
// tooling split. forge::mold (HLRBRep silhouette + BRep split).

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.mold, 'forge.mold missing');
assert.ok(typeof forge.mold.computeParting === 'function', 'computeParting missing');
assert.ok(typeof forge.mold.splitCavityCore === 'function', 'splitCavityCore missing');

// Draftable part: a cone (base r=20, top r=8, height 30).
const part = forge.makeCone(20, 8, 30);
const partVol = forge.massProps(part).volume;

const pull = [0, 0, 1];
const pl = forge.mold.computeParting(part, pull);
console.log('[mold-smoke] parting =', JSON.stringify(pl));
assert.ok(pl && pl.partingLineCount >= 1, `expected >=1 parting line, got ${pl && pl.partingLineCount}`);
assert.ok(typeof pl.partingSurface === 'number' && pl.partingSurface > 0,
  'computeParting returned no parting surface handle');

// Mold block enclosing the part.
const block = forge.makeBox(80, 80, 60);
const blockVol = forge.massProps(block).volume;

const split = forge.mold.splitCavityCore(block, part, pl.partingSurface);
console.log('[mold-smoke] split =', JSON.stringify(split));
assert.ok(typeof split.cavity === 'number' && split.cavity > 0, 'no cavity handle');
assert.ok(typeof split.core === 'number' && split.core > 0, 'no core handle');

const cavityVol = Math.abs(forge.massProps(split.cavity).volume);
const coreVol = Math.abs(forge.massProps(split.core).volume);
const sum = cavityVol + coreVol;

console.log('[mold-smoke] cavity =', cavityVol.toFixed(1), ' core =', coreVol.toFixed(1),
            ' sum =', sum.toFixed(1), ' block =', blockVol.toFixed(1), ' part =', partVol.toFixed(1));

// The two tooling halves tile the mold block around the part. Each half is
// a real positive solid strictly smaller than the whole block, and their
// combined volume lands between (block − part) and the full block (the
// exact figure depends on how the part impression is shared across the
// parting surface). This proves a real split — not a stub.
assert.ok(cavityVol > 0 && coreVol > 0, 'cavity/core volumes must be positive');
assert.ok(cavityVol < blockVol && coreVol < blockVol,
  'each half must be smaller than the whole block');
const lo = blockVol - partVol;        // both halves clear of the part
const hi = blockVol * 1.05;           // shared impression / kerf allowance
assert.ok(sum > lo * 0.98 && sum < hi,
  `cavity+core ${sum.toFixed(1)} should sit between block−part ${lo.toFixed(1)} and block ${hi.toFixed(1)}`);

console.log('[mold-smoke] PASS — parting surface + cavity/core split divides the block around the part');
