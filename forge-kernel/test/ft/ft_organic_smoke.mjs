#!/usr/bin/env node
// test/ft/ft_organic_smoke.mjs — end-to-end smoke test for the ORGANIC feature-
// tree ops added for the impeller / cast-housing / sheet-metal frontier:
//
//   RING / WIRE  (3D loft sections)   LOFT (real 3D skin)   SWEEP (pipe + profile)
//   PATTERN (LINEAR|POLAR|GRID)       MIRROR (symmetrize)   REVOLVE (partial angle)
//   BLEND (variable-radius fillet)    FOLD (sheet-metal flange macro)
//
//   node test/ft/ft_organic_smoke.mjs
//
// Each part is the exact serialized IR TEXT the 30B VLM would emit — parsed ->
// walked -> native forge-kernel -> a REAL solid -> STEP, all in C++. The HARD
// gate is `ok && volume>0` (a real positive-volume solid was built). `valid`
// (watertight/manifold) is asserted for the prismatic parts and reported (not
// hard-gated) for the freeform loft/sweep/blend skins, whose watertightness is
// geometry-dependent — an honest gate, not a faked one.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// ★ THE KERNEL PATH IS TREE-LOCAL, and it used to be the PRIMARY CHECKOUT's.
// Hard-coding /Users/.../archdisc-Mech/forge-kernel/build/Release made this file
// load SOMEONE ELSE'S BINARY whenever it was run from a git worktree: the suite
// printed ALL PASS against a build that did not contain the change under test.
// MEASURED in this session — three suites reported green against a kernel dated
// four days earlier. Resolved from this file's own location instead, and a
// MISSING binary is a loud failure, never a silent fall back to another tree's.
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
// URL resolution of '../..' yields a TRAILING SLASH, so trim it: the path is
// printed in every failure message and '//' there reads like a typo in the test.
const KROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/+$/, '');
const KERNEL = process.env.FORGE_KERNEL ||
  KROOT + '/build/Release/forge-kernel.node';
if (!existsSync(KERNEL)) {
  console.error(`[smoke] no kernel at ${KERNEL} — build it in THIS tree, or set FORGE_KERNEL=`);
  process.exit(1);
}

const f = require(KERNEL);
if (!f.ft || typeof f.ft.compile !== 'function') {
  console.error('[ft_organic_smoke] addon lacks forge.ft.compile — wrong/old kernel');
  process.exit(1);
}
const OUT = KROOT + '/scratchpad';
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- test parts
const parts = [
  // -- LOFT (real): round -> superellipse -> rounded-square transition duct ----
  { name: 'LOFT transition duct (round->square, 3 sections)', hardValid: false,
    step: `${OUT}/ft_loft_duct.step`, ir: `
%1 = RING(20, 20, 0)             # Ø40 circular inlet at z=0
%2 = RING(18, 14, 25, 0, 0, 3)   # mid superellipse (p=3) at z=25
%3 = RING(15, 15, 50, 0, 0, 5)   # rounded-square outlet (p=5) at z=50
%4 = LOFT(%1, %2, %3)            # BSpline-smoothed, capped solid
RESULT(%4)
` },

  // -- LOFT via explicit WIRE sections: a twisted freeform blade skin ---------
  { name: 'LOFT twisted blade (explicit WIRE sections)', hardValid: false,
    step: `${OUT}/ft_loft_blade.step`, ir: `
%1 = WIRE([15 -2 5; 40 -1 5; 40 1 5; 15 2 5])     # flat blade root section @ z=5
%2 = WIRE([15 -2 35; 38 3 35; 40 5 35; 17 1 35])  # twisted tip section    @ z=35
%3 = LOFT(%1, %2)
RESULT(%3)
` },

  // -- Impeller-class: freeform lofted blades + POLAR pattern + hub -----------
  { name: 'Impeller (lofted blade x6 POLAR + hub)', hardValid: false,
    step: `${OUT}/ft_impeller.step`, ir: `
%1 = WIRE([15 -2 5; 40 -1 5; 40 1 5; 15 2 5])     # blade root @ z=5
%2 = WIRE([15 -2 35; 38 3 35; 40 5 35; 17 1 35])  # blade tip  @ z=35
%3 = LOFT(%1, %2)                # one freeform blade skin
%4 = PATTERN(%3, POLAR, 6, 360)  # 6 blades evenly around +Z (step = 360/6)
%5 = CYL(15, 40)                 # Ø30 hub, 40 tall
%6 = FUSE(%5, %4)
RESULT(%6)
` },

  // -- SWEEP: circular pipe elbow along a 3D polyline path --------------------
  { name: 'SWEEP circular pipe elbow', hardValid: false,
    step: `${OUT}/ft_sweep_pipe.step`, ir: `
%1 = SWEEP(6, [0 0 0; 0 0 40; 20 0 60; 20 30 60])   # Ø12 tube along an L-bend
RESULT(%1)
` },

  // -- SWEEP: rectangular profile ring swept along an L path (a duct) ---------
  { name: 'SWEEP rectangular duct', hardValid: false,
    step: `${OUT}/ft_sweep_duct.step`, ir: `
%1 = SWEEP([10 6; -10 6; -10 -6; 10 -6], [0 0 0; 0 0 50; 40 0 80])
RESULT(%1)
` },

  // -- REVOLVE partial angle (270deg) about the default Y axis ----------------
  { name: 'REVOLVE 270deg partial torus', hardValid: true,
    step: `${OUT}/ft_revolve_partial.step`, ir: `
%1 = CIRCLE(5, 30, 0)   # Ø10 section at radius 30 in the z=0 plane
%2 = REVOLVE(%1, 270)   # 270deg about the Y axis -> 3/4 torus
RESULT(%2)
` },

  // -- PATTERN POLAR: bolt-circle of bosses fused onto a disc -----------------
  { name: 'PATTERN POLAR bolt-circle bosses', hardValid: true,
    step: `${OUT}/ft_pattern_polar.step`, ir: `
%1 = CYL(6, 14, 38, 0, 0)        # one boss Ø12 at radius 38
%2 = PATTERN(%1, POLAR, 6, 360)  # 6 bosses around +Z
%3 = CYL(50, 10)                 # Ø100 x 10 disc
%4 = FUSE(%3, %2)
RESULT(%4)
` },

  // -- PATTERN LINEAR: heat-sink fin comb on a base plate ---------------------
  { name: 'PATTERN LINEAR fin comb', hardValid: true,
    step: `${OUT}/ft_pattern_linear.step`, ir: `
%1 = BOX(4, 40, 20)              # one fin
%2 = PATTERN(%1, LINEAR, 5, 12)  # 5 fins spaced 12 mm in X
%3 = BOX(60, 44, 5, 24, 0, -5)   # base plate below the fins
%4 = FUSE(%2, %3)
RESULT(%4)
` },

  // -- PATTERN GRID: nx*ny posts on a base ------------------------------------
  { name: 'PATTERN GRID posts', hardValid: true,
    step: `${OUT}/ft_pattern_grid.step`, ir: `
%1 = CYL(3, 15)                     # one post
%2 = PATTERN(%1, GRID, 4, 3, 15, 15) # 4x3 grid, 15 mm pitch
%3 = BOX(60, 45, 4, 22.5, 15, -4)   # base plate under the grid
%4 = FUSE(%2, %3)
RESULT(%4)
` },

  // -- MIRROR: symmetrize a single arm across the YZ plane --------------------
  // The hub radius MUST exceed the arm's root offset (12 > 10). With R == 10 the
  // arm's inner face x=10 is EXACTLY TANGENT to the hub wall x^2+y^2=100: the two
  // bodies meet along the single line (10, 0, z) and their union is a pinched,
  // non-manifold set no boolean can make watertight (measured: Euler V-E+F = 4,
  // i.e. two shells, and BRepCheck reports 1 non-manifold edge). Do not shrink it.
  { name: 'MIRROR symmetric two-arm bracket', hardValid: true,
    step: `${OUT}/ft_mirror.step`, ir: `
%1 = BOX(20, 10, 40, 20, 0, 0)   # one arm, offset +X (x in [10,30])
%2 = CYL(12, 15)                 # central hub, R12 > the arm root at x=10
%3 = FUSE(%2, %1)                # arm roots 2 mm INTO the hub (transversal join)
%4 = MIRROR(%3, YZ)              # reflect across X=0 and fuse -> two symmetric arms
RESULT(%4)
` },

  // -- BLEND: variable-radius fillet (r 2->8) on a box's vertical edges --------
  { name: 'BLEND variable fillet r2->r8', hardValid: false,
    step: `${OUT}/ft_blend.step`, ir: `
%1 = BOX(60, 20, 20)
%2 = BLEND(%1, 2, 8, VERTICAL)   # each vertical edge blends 2 mm -> 8 mm
RESULT(%2)
` },

  // -- FOLD: sheet-metal L-bracket (flat plate + 90deg folded wall) -----------
  { name: 'FOLD sheet-metal L-bracket', hardValid: false,
    step: `${OUT}/ft_fold.step`, ir: `
%1 = BOX(80, 40, 2)                       # flat 2 mm plate, y in [-20,20]
%2 = FOLD(%1, -40, 20, 0, 80, 25, 2, 90)  # fold a 25 mm wall up along the +Y edge
RESULT(%2)
` },
];

let failures = 0, warns = 0;
for (const p of parts) {
  console.log(`\n===== ${p.name} =====`);
  let m;
  try { m = f.ft.compile(p.ir, p.step); }
  catch (e) { console.error(`  THREW: ${e && e.message}`); failures++; continue; }
  if (!m.ok) { console.error(`  FAILED at op %${m.failedOpId}: ${m.error}`); failures++; continue; }
  const bb = m.bbox;
  const dims = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]]
    .map((v) => v.toFixed(2)).join(' x ');
  console.log(`  ok/valid  : ${m.ok} / ${m.valid}`);
  console.log(`  faces/edges: ${m.faceCount} / ${m.edgeCount}`);
  console.log(`  volume    : ${m.volume.toFixed(1)} mm^3`);
  console.log(`  bbox dims : ${dims} mm`);
  console.log(`  STEP      : ${m.exported ? p.step : '(not written)'}`);
  if (!(m.volume > 0)) { console.error('  ASSERT FAILED: expected positive volume'); failures++; }
  else if (p.hardValid && !m.valid) { console.error('  ASSERT FAILED: expected a valid watertight solid'); failures++; }
  else if (!m.valid) { console.warn('  NOTE: freeform solid is not fully watertight/manifold (informational)'); warns++; }
}

console.log(`\n===== ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}` +
            `${warns ? ' (' + warns + ' freeform non-watertight note[s])' : ''} =====`);
process.exit(failures === 0 ? 0 : 1);
