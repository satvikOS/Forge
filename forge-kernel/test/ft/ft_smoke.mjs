#!/usr/bin/env node
// test/ft/ft_smoke.mjs — end-to-end smoke test for the declarative feature-tree
// IR compiler (forge.ft.compile). Hands the compiler the exact IR TEXT the 30B
// VLM would emit, and confirms it parses -> walks -> native forge-kernel -> a
// REAL watertight solid -> STEP, all in C++.
//
//   node test/ft/ft_smoke.mjs
//
// Two hand-authored parts, in the serialized IR grammar:
//   A) plate + rounded corners + central boss + 4 corner bolt holes + central
//      bore + a vertical-edge fillet  (exercises extrude/boolean/hole/fillet)
//   B) the p122 U-shaped fork / yoke bracket, faithfully reduced (organic:
//      rounded-rect U-plate, deep boss hub, Ø74.8 U-notch cut, two arm eye
//      collars, three through bores)  (exercises organic multi-feature build)

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
  console.error('[ft_smoke] addon lacks forge.ft.compile — wrong/old kernel'); process.exit(1);
}

const OUT = KROOT + '/scratchpad';
mkdirSync(OUT, { recursive: true });

// --------------------------------------------------------------- Part A
const plateIR = `
# --- plate + boss + 4 bolt holes + central bore + fillet ---
%1  = RECT(120, 80)               # 120 x 80 plate footprint (sharp corners)
%2  = EXTRUDE(%1, 10)             # -> 10 mm plate
%3  = CYL(15, 12, 0, 0, 10)       # central boss Ø30 x 12 on the top face
%4  = FUSE(%2, %3)
%5  = HOLE(%4, 8,  48,  28, 0)    # 4 corner bolt holes Ø8 THRU
%6  = HOLE(%5, 8, -48,  28, 0)
%7  = HOLE(%6, 8,  48, -28, 0)
%8  = HOLE(%7, 8, -48, -28, 0)
%9  = HOLE(%8, 16,  0,   0, 0)    # central bore Ø16 THRU the boss
%10 = FILLET(%9, 3, VERTICAL)     # blend the plate's vertical corner edges
RESULT(%10)
`;

// --------------------------------------------------------------- Part B (p122)
const yokeIR = `
# --- p122 U-shaped fork / yoke bracket (faithful reduction) ---
%1  = RRECT(93.3, 139.2, 10, 53.35, 69.6)   # U-plate footprint, corner r10
%2  = EXTRUDE(%1, 10)
%3  = TRANSLATE(%2, 0, 0, -5)               # centre the 10 mm web on z=0
%4  = CYL(12.5, 25, 12.5, 15.3, -12.5)      # boss hub Ø25 x 25 deep, on z axis
%5  = FUSE(%3, %4)
%6  = CYL(37.4, 60, 54.7, 59.5, -30)        # Ø74.8 inner U curve (tall cutter)
%7  = BOX(64.2, 120, 60, 54.7, 119.5, -30)  # prong-gap slot up to the top
%8  = FUSE(%6, %7)
%9  = CUT(%5, %8)                            # carve the open U
%10 = CYL(12.5, 6, 14.9, 126, -3)           # left arm eye collar Ø25 x 6
%11 = FUSE(%9, %10)
%12 = CYL(12.5, 6, 87.5, 126, -3)           # right arm eye collar
%13 = FUSE(%11, %12)
%14 = HOLE(%13, 15, 12.5, 15.3, 0)          # boss bore Ø15 THRU
%15 = HOLE(%14, 18, 14.9, 126, 0)           # left eye Ø18 THRU
%16 = HOLE(%15, 18, 87.5, 126, 0)           # right eye Ø18 THRU
RESULT(%16)
`;

let failures = 0;
function run(name, ir, outStep) {
  console.log(`\n===== ${name} =====`);
  const m = f.ft.compile(ir, outStep);
  if (!m.ok) {
    console.error(`  FAILED at op %${m.failedOpId}: ${m.error}`);
    failures++;
    return;
  }
  const bb = m.bbox;
  const dims = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]]
    .map((v) => v.toFixed(2)).join(' x ');
  console.log(`  ok        : ${m.ok}`);
  console.log(`  valid     : ${m.valid}    (watertight/manifold/oriented, no self-intersect)`);
  console.log(`  faceCount : ${m.faceCount}`);
  console.log(`  edgeCount : ${m.edgeCount}`);
  console.log(`  volume    : ${m.volume.toFixed(1)} mm^3`);
  console.log(`  bbox dims : ${dims} mm`);
  console.log(`  STEP      : ${m.exported ? outStep : '(not written)'}`);
  if (!m.valid || !(m.volume > 0)) {
    console.error('  ASSERT FAILED: expected a valid solid with positive volume');
    failures++;
  }
}

run('Part A — plate + boss + holes + fillet', plateIR, `${OUT}/ft_plate.step`);
run('Part B — p122 yoke bracket',             yokeIR,  `${OUT}/ft_yoke.step`);

console.log(`\n===== ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'} =====`);
process.exit(failures === 0 ? 0 : 1);
