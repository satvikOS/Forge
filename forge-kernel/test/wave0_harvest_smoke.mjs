// Wave-0 dark-engine harvest smoke — confirms the integrated build exposes the
// geom / implicit-voxel-frep / sketch-diagnose verbs and they return sane results.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const f = require('../build/Release/forge-kernel.node');
let fail = 0;
const ok = (c, m) => { console.log(`${c ? '  OK ' : ' FAIL'} ${m}`); if (!c) fail++; };

// ── geom (11 dark predicates/engines) ──
const g = f.geom || {};
ok(g && typeof g.delaunay2D === 'function', `forge.geom present (${Object.keys(g).length} verbs)`);
if (g.delaunay2D) {
  const d = g.delaunay2D([0, 0, 1, 0, 1, 1, 0, 1]); // unit square
  ok(d && (d.triangles ? d.triangles.length / 3 : d.triangleCount) === 2, `delaunay2D unit square -> 2 tris`);
}
if (g.minkowskiSum3D) {
  // unit cube ⊕ unit cube = 2×2×2 cube, volume 8
  const cube = [0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1];
  const m = g.minkowskiSum3D(cube, cube, true, true);
  ok(m && m.ok && Math.abs(m.volume - 8) < 1e-3, `minkowskiSum3D cube⊕cube vol=${m && m.volume?.toFixed(3)} (expect 8)`);
}

// ── implicit / voxel / F-rep field stack (~40 verbs) ──
const im = f.implicit || {};
ok(im && typeof im.sphere === 'function', `forge.implicit present (${Object.keys(im).length} verbs)`);
ok(f.tpms && typeof f.tpms.gyroid === 'function', `forge.tpms present`);
ok(f.lattice && typeof f.lattice.volume === 'function', `forge.lattice present`);
if (im.sphere && im.mesh) {
  const s = im.sphere(0, 0, 0, 3);
  const mesh = im.mesh(s, -5, -5, -5, 5, 5, 5, 40);
  ok(mesh && mesh.ok && mesh.triangleCount > 100, `implicit sphere→mesh tris=${mesh && mesh.triangleCount}`);
  // analytic sphere volume 4/3·π·27 = 113.1; marching at res 40 should be within a few %
  ok(mesh && Math.abs(mesh.volume - 113.097) / 113.097 < 0.05, `implicit sphere vol=${mesh && mesh.volume?.toFixed(2)} (expect ~113.1)`);
}

// ── sketch constraint diagnostics ──
const sd = (f.sketch && f.sketch.diagnose) || {};
ok(typeof sd.diagnose === 'function' || typeof sd.audit === 'function', `forge.sketch.diagnose present (${Object.keys(sd).length} verbs)`);

console.log(fail ? `\n[wave0-smoke] ${fail} FAILED` : `\n[wave0-smoke] ALL PASS`);
process.exit(fail ? 1 : 0);
