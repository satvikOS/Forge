// cam_smoke.js (Forge-13) — exercises forge.cam + forge.cam.gcode.
//
// Geometry: 100 × 50 × 20 mm box. Operations:
//   * face-mill the top face (z 20 → 19 mm).
//   * profile around the perimeter (z 20 → 0 mm, full depth).
//   * drill 4 Ø5 mm corner holes at (±35, ±15) all the way through.
//
// For each op we print the move count + cycle time and assert both are
// strictly positive. Then we ask the post-processor for a Fanuc dump of
// the profile op and write it to /tmp/forge-profile.nc. We assert it
// starts with "G17 G21", ends with "M30", and that the file size is in
// a sensible range. Lastly we verify Haas + Grbl dispatch by checking
// that their outputs differ from the Fanuc output in the expected ways
// (M19 / shorter prologue).

const path = require('path');
const fs   = require('fs');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

console.log('[cam-smoke] version =', forge.version());
assert.ok(forge.cam, 'forge.cam namespace missing');
assert.ok(forge.cam.gcode, 'forge.cam.gcode namespace missing');

// ---------------------------------------------------------- geometry
//
// makeBox(dx, dy, dz) builds a box anchored at the origin, growing in +X,
// +Y, +Z. We translate by (-dx/2, -dy/2, 0) so the top face is centred
// on the XY origin — that places the corner holes symmetrically.
const DX = 100, DY = 50, DZ = 20;
const stock = forge.translate(forge.makeBox(DX, DY, DZ), -DX / 2, -DY / 2, 0);
console.log('[cam-smoke] stock handle =', stock);

// ---------------------------------------------------------- tools
const endMill = {
  id: 1, name: '6mm carbide endmill', diameter: 6, fluteLength: 25,
  helix: 35, flutes: 4, type: 'EndMill',
};
const faceTool = {
  id: 2, name: '12mm face mill', diameter: 12, fluteLength: 10,
  helix: 0, flutes: 4, type: 'EndMill',
};
const drillBit = {
  id: 3, name: '5mm drill', diameter: 5, fluteLength: 30,
  helix: 30, flutes: 2, type: 'Drill',
};

const cuttingParams = {
  feedXY: 800, feedZ: 200, spindleRPM: 12000,
  stepover: 4, stepdown: 4, coolant: 1.0,
};

// ---------------------------------------------------------- face mill
const tpFace = forge.cam.faceMill(stock, forge.cam.kAutoFaceId,
                                  faceTool, cuttingParams,
                                  /*zTop*/ 20, /*depth*/ 1);
console.log(`[cam-smoke] faceMill moves=${tpFace.moveCount} cycle=${tpFace.cycleTimeSec.toFixed(2)}s cuttingMm=${tpFace.estCuttingMm.toFixed(1)}`);
assert.ok(tpFace.moveCount > 0, 'faceMill moves = 0');
assert.ok(tpFace.cycleTimeSec > 0, 'faceMill cycle time = 0');

// ---------------------------------------------------------- profile
const tpProfile = forge.cam.profile(stock, forge.cam.kAutoFaceId,
                                    endMill, cuttingParams,
                                    /*zTop*/ 20, /*zBottom*/ 0, /*leadIn*/ 2);
console.log(`[cam-smoke] profile  moves=${tpProfile.moveCount} cycle=${tpProfile.cycleTimeSec.toFixed(2)}s cuttingMm=${tpProfile.estCuttingMm.toFixed(1)}`);
assert.ok(tpProfile.moveCount > 0, 'profile moves = 0');
assert.ok(tpProfile.cycleTimeSec > 0, 'profile cycle time = 0');

// ---------------------------------------------------------- drill
const holes = [
  [ 35,  15, 20],
  [-35,  15, 20],
  [-35, -15, 20],
  [ 35, -15, 20],
];
const tpDrill = forge.cam.drill(stock, holes, drillBit, cuttingParams,
                                /*zTop*/ 20, /*zBottom*/ -1, /*peck*/ true);
console.log(`[cam-smoke] drill    moves=${tpDrill.moveCount} cycle=${tpDrill.cycleTimeSec.toFixed(2)}s cuttingMm=${tpDrill.estCuttingMm.toFixed(1)}`);
assert.ok(tpDrill.moveCount > 0, 'drill moves = 0');
assert.ok(tpDrill.cycleTimeSec > 0, 'drill cycle time = 0');

// ---------------------------------------------------------- G-code dispatch
const gFanuc = forge.cam.gcode.toGcode(tpProfile, 'Fanuc', /*safeZ*/ 30);
const gHaas  = forge.cam.gcode.toGcode(tpProfile, 'Haas',  /*safeZ*/ 30);
const gGrbl  = forge.cam.gcode.toGcode(tpProfile, 'Grbl',  /*safeZ*/ 30);

// Fanuc prologue + epilogue.
assert.ok(/G17 G21/.test(gFanuc.split('\n').slice(0, 5).join('\n')),
  'Fanuc output should contain "G17 G21" near the top');
assert.ok(gFanuc.trim().endsWith('M30'), 'Fanuc output should end with M30');

// Dispatch sanity.
assert.ok(gHaas.includes('M19'),    'Haas dialect should include M19');
assert.ok(!gFanuc.includes('M19'),  'Fanuc should not include M19');
assert.ok(!gGrbl.includes('G54'),   'Grbl prologue should omit G54');
assert.ok(gFanuc.includes('G54'),   'Fanuc prologue should include G54');

// Write the Fanuc output to /tmp and check the file size.
const outPath = '/tmp/forge-profile.nc';
fs.writeFileSync(outPath, gFanuc, 'utf8');
const bytes = fs.statSync(outPath).size;
console.log(`[cam-smoke] wrote ${outPath} (${bytes} bytes)`);
assert.ok(bytes > 1024,   `Fanuc .nc too small (${bytes} B)`);
assert.ok(bytes < 204800, `Fanuc .nc too large (${bytes} B)`);

// ---------------------------------------------------------- cleanup
forge.release(stock);

console.log('[cam-smoke] ALL PASS');
