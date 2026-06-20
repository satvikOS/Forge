#!/usr/bin/env node
/**
 * chunk3_bridge_verbs_test.mjs — proves the 6 chunk-3 verb fixes in
 * ForgeToolBridge.js really work end-to-end against the native kernel.
 *
 * Dispatches each verb through the REAL bridge dispatchToolCall(), injecting
 * the native forge-kernel.node as opts.forge (same pattern the cadscore
 * harness uses). No Electron, no mocks of the methods under test.
 *
 * Verbs:
 *   io.import                  (was: missing-from-bridge)
 *   manufacture.cam-profile    (was: object-vs-positional throw)
 *   manufacture.cam-pocket     (was: object-vs-positional throw)
 *   manufacture.cam-drill      (was: object-vs-positional throw)
 *   manufacture.gcode          (was: gcode is a namespace, not a function)
 *   heal.check-validity        (was: missing verb id)
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import assert from 'assert';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

const { dispatchToolCall } = await import(
  path.resolve(__dirname, '..', '..', 'frontend', 'src', 'ai', 'ForgeToolBridge.js')
);

const call = (name, args) => dispatchToolCall({ name, arguments: args }, { forge });
const ok = (r, label) => {
  if (!r.ok) { console.error(`[FAIL] ${label}:`, r.error); process.exit(1); }
  return r.result;
};

console.log('[chunk3] kernel', JSON.stringify(forge.version()));

// ---------------------------------------------------------------- geometry
// 80×30×20 box centred on XY origin (top face at z=20) — matches the prompt args.
const DX = 80, DY = 30, DZ = 20;
const box = forge.translate(forge.makeBox(DX, DY, DZ), -DX / 2, -DY / 2, 0);
console.log('[chunk3] box handle =', box);

const endMill   = { id: 1, name: '6mm', diameter: 6, fluteLength: 25, helix: 35, flutes: 4, type: 'EndMill' };
const drillBit  = { id: 3, name: '5mm', diameter: 5, fluteLength: 30, helix: 30, flutes: 2, type: 'Drill' };
const cutParams = { feedXY: 800, feedZ: 200, spindleRPM: 12000, stepover: 4, stepdown: 4, coolant: 1.0 };

// ============================================================ cam-profile
{
  const r = ok(await call('manufacture.cam-profile',
    { shape: box, face: 0, tool: endMill, cutParams, zTop: 20, zBottom: 0 }), 'cam-profile');
  console.log(`[chunk3] cam-profile  moves=${r.moveCount} cycle=${r.cycleTimeSec.toFixed(1)}s cuttingMm=${r.estCuttingMm.toFixed(0)}`);
  assert.ok(r.moveCount > 0, 'profile moveCount must be > 0');
  assert.ok(r.cycleTimeSec > 0, 'profile cycle time must be > 0');
  assert.ok(r.toolpath && r.toolpath.moves, 'profile must surface a toolpath for gcode');

  // ======================================================== gcode (uses profile toolpath)
  const g = ok(await call('manufacture.gcode',
    { toolpath: r, dialect: 'Fanuc', safeZ: 5 }), 'gcode');
  console.log(`[chunk3] gcode        dialect=${g.dialect} bytes=${g.bytes} head="${g.gcode.split('\n')[0]}"`);
  assert.ok(g.bytes > 200, `gcode dump too small (${g.bytes})`);
  assert.ok(/G17 G21/.test(g.gcode.split('\n').slice(0, 5).join('\n')), 'Fanuc dump must contain "G17 G21" near top');
  assert.ok(g.gcode.trim().endsWith('M30'), 'Fanuc dump must end with M30');
}

// ============================================================ cam-pocket
{
  const r = ok(await call('manufacture.cam-pocket',
    { shape: box, face: 0, tool: endMill, cutParams, zTop: 20, zBottom: 5 }), 'cam-pocket');
  console.log(`[chunk3] cam-pocket   moves=${r.moveCount} cycle=${r.cycleTimeSec.toFixed(1)}s cuttingMm=${r.estCuttingMm.toFixed(0)}`);
  assert.ok(r.moveCount > 0, 'pocket moveCount must be > 0');
  assert.ok(r.cycleTimeSec > 0, 'pocket cycle time must be > 0');
}

// ============================================================ cam-drill
{
  const holes = [[35, 15, 20], [-35, 15, 20], [-35, -15, 20], [35, -15, 20]];
  const r = ok(await call('manufacture.cam-drill',
    { shape: box, holes, bit: drillBit, cutParams, zTop: 20, zBottom: -1, peck: true }), 'cam-drill');
  console.log(`[chunk3] cam-drill    moves=${r.moveCount} cycle=${r.cycleTimeSec.toFixed(1)}s holes=${r.holes}`);
  assert.ok(r.moveCount > 0, 'drill moveCount must be > 0');
  assert.strictEqual(r.holes, 4, 'drill must report 4 holes');
}

// ============================================================ io.import
{
  // Export a STEP first, then import it through the bridge verb and verify volume.
  const stepPath = '/tmp/forge-chunk3-import.step';
  forge.io.exportStep(box, stepPath);
  const r = ok(await call('io.import', { filepath: stepPath }), 'io.import (step, inferred)');
  console.log(`[chunk3] io.import     format=${r.format} shape=${r.shape}`);
  assert.strictEqual(r.format, 'step', 'format should infer to step from .step');
  assert.ok(r.shape > 0, 'io.import must return a positive handle');
  const mp = forge.massProps(r.shape);
  const expVol = DX * DY * DZ;
  console.log(`[chunk3] io.import vol=${mp.volume.toFixed(1)} (expected ${expVol})`);
  assert.ok(Math.abs(mp.volume - expVol) < 1e-2, `imported volume ${mp.volume} != ${expVol}`);

  // Explicit-format STL path too (shell area sanity).
  const stlPath = '/tmp/forge-chunk3-import.stl';
  forge.io.exportStl(box, stlPath, 0.05, 0.3, false);
  const rs = ok(await call('io.import', { filepath: stlPath, format: 'stl' }), 'io.import (stl, explicit)');
  console.log(`[chunk3] io.import     format=${rs.format} shape=${rs.shape}`);
  assert.strictEqual(rs.format, 'stl');
  assert.ok(rs.shape > 0, 'stl import must return a handle');
}

// ============================================================ heal.check-validity
{
  const r = ok(await call('heal.check-validity', { shape: box }), 'heal.check-validity');
  console.log(`[chunk3] heal.check-validity closed=${r.isClosed} manifold=${r.isManifold} oriented=${r.isOriented}`);
  assert.strictEqual(r.isClosed, true, 'box must be closed');
  assert.strictEqual(r.isManifold, true, 'box must be manifold');
  assert.strictEqual(r.isOriented, true, 'box must be oriented');
}

console.log('[chunk3] ALL PASS');
