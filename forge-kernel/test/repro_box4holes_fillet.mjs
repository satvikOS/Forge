// HANG REPRO driver: box 80x80x20 + 4x Ø10 through-holes + finish{fillet:2}.
// Pre-fix this spins ChFi3d_Builder unbounded (>120s SIGTERM). Post-fix the OCCT
// fillet watchdog throws cleanly at 20s, so buildexport COMPLETES, NOT hangs.
import { runJobInChild } from './cadscore_harness.mjs';

const calls = [
  { name: 'part.begin', arguments: { primitive: 'box', dx: 80, dy: 80, dz: 20 } },
  { name: 'part.holes', arguments: { locations: [[20, 20], [60, 20], [60, 60], [20, 60]], diameter: 10 } },
  { name: 'part.finish', arguments: { fillet: 2 } },
];

const t0 = Date.now();
const res = runJobInChild({ op: 'buildexport', calls, outPath: '/tmp/repro_box4holes.step' });
const dt = (Date.now() - t0) / 1000;
console.log('ELAPSED_S=' + dt.toFixed(1));
console.log('RESULT=' + JSON.stringify(res));
process.exit(0);
