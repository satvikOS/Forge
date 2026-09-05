#!/usr/bin/env node
// test/ft/ft_poly_bulge.mjs — gate for POLY's per-vertex DXF bulge (arc segments).
//
// POLY([x y b; ...]) where b = tan(sweep/4) of the segment LEAVING that vertex.
// b == 0 (or a 2-column list) is the old straight-sided behaviour.
//
// Every assertion here is ANALYTIC — the expected volume/bbox is a closed form,
// not a golden blob — so a wrong centre, a wrong sign, or a silently-chorded arc
// all fail loudly.
//
//   node test/ft/ft_poly_bulge.mjs

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const KERNEL = process.env.FORGE_KERNEL ||
  '/Users/account_clawteam1/archdisc-Mech/forge-kernel/build/Release/forge-kernel.node';
const f = require(KERNEL);

let fails = 0;
const near = (a, b, tol, what) => {
  const ok = Math.abs(a - b) <= tol;
  if (!ok) { console.error(`  FAIL ${what}: got ${a}, want ${b} (tol ${tol})`); fails++; }
  else console.log(`  ok   ${what}: ${a.toFixed(6)}`);
  return ok;
};
const build = (ir) => {
  try { return f.ft.compile(ir); }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
};

const Q = Math.tan(Math.PI / 8);   // tan(90deg/4) — a quarter-circle bulge

// --- 1. four quarter-arcs = an exact circle ---------------------------------
// A disc of r=10 extruded 5 has volume pi*r^2*h and bbox 20x20x5. If the bulge
// were dropped this is an inscribed SQUARE: volume 1000 (36% low), bbox 20x20
// only by luck of the diagonal — so volume is the discriminating check.
console.log('1. circle from four quarter-arc POLY segments');
{
  const r = 10, h = 5;
  const ir = `%1 = POLY([${r} 0 ${Q}; 0 ${r} ${Q}; ${-r} 0 ${Q}; 0 ${-r} ${Q}])
%2 = EXTRUDE(%1, ${h})
RESULT(%2)`;
  const res = build(ir);
  if (!res.ok) { console.error('  FAIL compile: ' + res.error); fails++; }
  else {
    near(res.volume, Math.PI * r * r * h, Math.PI * r * r * h * 2e-3, 'volume == pi r^2 h');
    near(res.bbox.max[0] - res.bbox.min[0], 2 * r, 1e-3, 'bbox X == 2r');
    near(res.bbox.max[1] - res.bbox.min[1], 2 * r, 1e-3, 'bbox Y == 2r');
  }
}

// --- 2. bulge SIGN selects which side the arc bows --------------------------
// Same two vertices, opposite bulge: one is the upper half-disc, the other the
// lower. Both have area pi r^2 / 2, but their bounding boxes are mirror images —
// a sign error swaps them and is caught by the bbox, not the volume.
console.log('2. bulge sign controls the bow direction (half-discs)');
{
  const r = 10, h = 2, halfVol = Math.PI * r * r * h / 2;
  const up = build(`%1 = POLY([${r} 0 ${Q}; 0 ${r} ${Q}; ${-r} 0 0])
%2 = EXTRUDE(%1, ${h})
RESULT(%2)`);
  if (!up.ok) { console.error('  FAIL upper compile: ' + up.error); fails++; }
  else {
    near(up.volume, halfVol, halfVol * 3e-3, 'upper half-disc volume');
    near(up.bbox.min[1], 0, 1e-3, 'upper half-disc sits on y=0');
    near(up.bbox.max[1], r, 1e-3, 'upper half-disc top y=r');
  }
  const dn = build(`%1 = POLY([${-r} 0 ${Q}; 0 ${-r} ${Q}; ${r} 0 0])
%2 = EXTRUDE(%1, ${h})
RESULT(%2)`);
  if (!dn.ok) { console.error('  FAIL lower compile: ' + dn.error); fails++; }
  else {
    near(dn.volume, halfVol, halfVol * 3e-3, 'lower half-disc volume');
    near(dn.bbox.max[1], 0, 1e-3, 'lower half-disc hangs below y=0');
    near(dn.bbox.min[1], -r, 1e-3, 'lower half-disc bottom y=-r');
  }
}

// --- 3. a two-vertex loop is legal once a segment bows ----------------------
// Line + semicircle = a D-shape. Straight-sided POLY needs 3 points; with a
// bulge, 2 is a real profile and must not be refused.
console.log('3. two-vertex D-shape (line + two 90deg arcs)');
{
  const r = 6, h = 3;
  const res = build(`%1 = POLY([${r} 0 ${Q}; 0 ${r} ${Q}; ${-r} 0 0])
%2 = EXTRUDE(%1, ${h})
RESULT(%2)`);
  if (!res.ok) { console.error('  FAIL compile: ' + res.error); fails++; }
  else near(res.volume, Math.PI * r * r * h / 2, Math.PI * r * r * h / 2 * 3e-3, 'D-shape volume');
  const two = build(`%1 = POLY([${r} 0 1; ${-r} 0 1])
%2 = EXTRUDE(%1, ${h})
RESULT(%2)`);
  if (!two.ok) { console.error('  FAIL 2-vertex lens compile: ' + two.error); fails++; }
  else near(two.volume, Math.PI * r * r * h, Math.PI * r * r * h * 3e-3,
            '2-vertex loop of two semicircles == full disc');
}

// --- 4. a MAJOR arc is REFUSED, loudly -------------------------------------
// Both sketch readers normalise an arc to its minor side, so |bulge| > 1 would
// build the wrong profile silently. It must be an error naming the fix.
console.log('4. |bulge| > 1 (major arc) is refused with an actionable message');
{
  const res = build(`%1 = POLY([10 0 2.5; -10 0 0; 0 -10 0])
%2 = EXTRUDE(%1, 3)
RESULT(%2)`);
  if (res.ok) { console.error('  FAIL: a major arc compiled instead of being refused'); fails++; }
  else if (!/major arc/i.test(res.error) || !/split/i.test(res.error)) {
    console.error(`  FAIL: refusal does not name the fix: ${res.error}`); fails++;
  } else console.log(`  ok   refused: ${res.error.slice(0, 110)}`);
}

// --- 5. the 2-column form is untouched -------------------------------------
console.log('5. backward compatibility: 2-column POLY is still a straight polygon');
{
  const res = build(`%1 = POLY([0 0; 10 0; 10 4; 0 4])
%2 = EXTRUDE(%1, 2)
RESULT(%2)`);
  if (!res.ok) { console.error('  FAIL compile: ' + res.error); fails++; }
  else near(res.volume, 10 * 4 * 2, 1e-6, 'plain rectangle volume unchanged');
  // an explicit all-zero bulge column must be identical
  const z = build(`%1 = POLY([0 0 0; 10 0 0; 10 4 0; 0 4 0])
%2 = EXTRUDE(%1, 2)
RESULT(%2)`);
  if (!z.ok) { console.error('  FAIL zero-bulge compile: ' + z.error); fails++; }
  else near(z.volume, 10 * 4 * 2, 1e-6, 'explicit zero-bulge column identical');
  // a 4th number is a hard error, never silently dropped
  const bad = build(`%1 = POLY([0 0 0 9; 10 0 0 9; 10 4 0 9])
%2 = EXTRUDE(%1, 2)
RESULT(%2)`);
  if (bad.ok) { console.error('  FAIL: a 4-number POLY vertex was accepted'); fails++; }
  else console.log(`  ok   4-number vertex refused: ${bad.error.slice(0, 80)}`);
}

console.log(fails === 0 ? '\n[ft_poly_bulge] ALL PASS' : `\n[ft_poly_bulge] ${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
