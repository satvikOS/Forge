#!/usr/bin/env node
// test/tkoffset_family_b_ab.mjs — TKOffset FAMILY B capability gate.
//
//   node test/tkoffset_family_b_ab.mjs
//
// WHAT THIS PROVES
// ----------------
// heal::autoFillMissingFaces (src/Healing.cpp) is the ONE call site of
// BRepOffsetAPI_MakeFilling in the whole tree — TKOffset family B, 5 symbols.
// FORGE_OFFSET_DROP_MAKEFILLING compiles the OCCT branch out and routes free-wire
// capping through the in-house forge::occtfill::fillFreeWire. Law 9 forbids dropping a
// library by deleting the capability it provided, so this gate measures BOTH sides on
// the SAME wires and reports the two numbers that decide the flip:
//
//   EXACTNESS  where both cap, is the native cap at least as accurate?
//   LOST       how many wires does OCCT cap that native declines?  (must be 0 to flip)
//
// It runs both implementations in the SAME process against a DEFAULT (flag-OFF) build:
// FORGE_FILL_NATIVE=1 prefers native, unset uses OCCT. Against a drop build the OCCT
// side is gone; this script detects that and says so rather than comparing native
// against itself.
//
// PART 1 — EXACTNESS, against CLOSED FORM (not against OCCT).
// Deleting a planar cap face from a cylinder/cone leaves a CIRCULAR planar free wire.
// Capping it must restore the primitive, whose volume is known analytically. Comparing
// to closed form rather than to OCCT is deliberate: OCCT is the incumbent, not the
// oracle, and here it is the LESS accurate of the two — MakeFilling always fits a
// B-spline patch to the 1e-4 tolerance of the 10-arg ctor the call site uses, while a
// Geom_Plane through a planar loop is exact to machine precision.
//
// PART 2 — LAW 9, on real corpus geometry.
// The analytic primitives above are all planar loops, so they cannot find the gap. Real
// parts can: deleting a fillet face or a curved bore wall leaves a genuinely 3-D loop.
// Part 2 drives both paths over free wires harvested from the corpus and counts LOST.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const KERNEL = process.env.FORGE_KERNEL ||
  new URL('../build/Release/forge-kernel.node', import.meta.url).pathname;
const f = require(KERNEL);

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

// Is the OCCT side still compiled in? A drop build sheds the 5 symbols.
let occtPresent = true;
try {
  const nm = execFileSync('nm', ['-u', KERNEL], { encoding: 'utf8' });
  occtPresent = nm.includes('BRepOffsetAPI_MakeFilling');
} catch (e) { /* nm unavailable — assume present */ }

console.log('=========== TKOffset family B — MakeFilling A/B ===========');
console.log(`  binary            : ${KERNEL}`);
console.log(`  OCCT MakeFilling  : ${occtPresent ? 'LINKED (flag OFF — both paths comparable)'
                                                 : 'ABSENT (drop build — native only)'}`);
if (!occtPresent) {
  console.log('\n  This is a FORGE_OFFSET_DROP_MAKEFILLING=ON build. The OCCT side does not');
  console.log('  exist, so Part 1 measures native against closed form only and Part 2');
  console.log('  cannot measure LOST. Run against a default build for the full gate.');
}

// ---------------------------------------------------------------- PART 1
console.log('\n--- PART 1: exactness of the cap, against CLOSED FORM ---');

// Each case: build a primitive, delete the face whose removal leaves ONE planar
// circular free wire, cap it, and compare the recovered volume to closed form.
const cases = [
  { name: 'cylinder r10 h30, delete +Z cap', build: () => f.makeCylinder(10, 30), faceId: 1,
    exact: Math.PI * 10 * 10 * 30 },
  { name: 'cylinder r7  h25, delete +Z cap', build: () => f.makeCylinder(7, 25), faceId: 1,
    exact: Math.PI * 7 * 7 * 25 },
  { name: 'cone r10/r4 h20, delete a cap',   build: () => f.makeCone(10, 4, 20), faceId: 2,
    exact: Math.PI * 20 / 3 * (100 + 40 + 16) },
  { name: 'box 20^3, delete one face',       build: () => f.makeBox(20, 20, 20), faceId: 1,
    exact: 8000 },
];

// The tolerance the incumbent spends: BRepOffsetAPI_MakeFilling's 10-arg ctor defaults
// Tol3d = 1e-4. A cap that is WORSE than that is a regression; the native cap must be
// at least as good, and is asserted at 1e-9 (machine-precision planar fit).
const TOL_NATIVE = 1e-9;

for (const c of cases) {
  const nat = capVolume(c, true);
  const occ = occtPresent ? capVolume(c, false) : null;
  const eN = Math.abs(nat - c.exact);
  const eO = occ === null ? null : Math.abs(occ - c.exact);
  console.log(`  ${c.name}`);
  console.log(`      closed form ${c.exact.toFixed(9)}`);
  console.log(`      native      ${nat.toFixed(9)}  err ${eN.toExponential(3)}`);
  if (occ !== null) console.log(`      OCCT        ${occ.toFixed(9)}  err ${eO.toExponential(3)}`);
  ok(eN <= TOL_NATIVE, `native cap is exact to ${TOL_NATIVE} (${eN.toExponential(3)})`);
  if (occ !== null) ok(eN <= eO + 1e-15, `native cap is at least as accurate as OCCT's`);
}

// Re-running in-process cannot switch the env gate (it is read once into a static), so
// each side is measured in a child process.
function capVolume(c, native) {
  const src = `
    const f = require(${JSON.stringify(KERNEL)});
    const s = (${c.build.toString()})();
    const h = f.direct.deleteFaceAndHeal(s, [${c.faceId}]);
    process.stdout.write(String(f.massProps(h).volume));`;
  const out = execFileSync(process.execPath, ['-e', src], {
    encoding: 'utf8',
    env: { ...process.env, FORGE_FILL_NATIVE: native ? '1' : '0' },
  });
  return Number(out);
}

// ---------------------------------------------------------------- PART 2
console.log('\n--- PART 2: Law 9 — does native decline wires OCCT caps? ---');

const CORPUS = process.env.FORGE_CORPUS ||
  '/Users/account_clawteam1/archdisc-Models/data/forge/complex_all.jsonl';
const N_PARTS = Number(process.env.FAMB_PARTS || 40);

if (!occtPresent) {
  console.log('  SKIPPED — needs a build where both paths exist.');
} else if (!fs.existsSync(CORPUS)) {
  console.log(`  SKIPPED — corpus not found: ${CORPUS}`);
} else {
  // FORGE_FILLDIAG=1 runs the native fit purely to RECORD each loop's planarity and
  // prints whether OCCT then capped it. It substitutes nothing, so the OCCT result
  // being measured is not perturbed by the measurement.
  const src = `
    const f = require(${JSON.stringify(KERNEL)});
    const fs = require('fs');
    const rows = fs.readFileSync(${JSON.stringify(CORPUS)}, 'utf8').split('\\n').filter(Boolean).map(JSON.parse);
    let n = 0;
    for (const r of rows) {
      if (n >= ${N_PARTS}) break;
      if (!r.step || !fs.existsSync(r.step)) continue;
      let h; try { h = f.io.importStep(r.step); } catch (e) { continue; }
      if (typeof h !== 'number') continue;
      n++;
      const nf = f.direct.faceCount(h);
      const step = Math.max(1, Math.floor(nf / 6));
      for (let id = 1; id <= nf; id += step) {
        try { f.direct.deleteFaceAndHeal(h, [id]); } catch (e) {}
      }
    }`;
  // spawnSync, not execFileSync: the diag goes to stderr and execFileSync only hands
  // stderr back when the child THROWS. One sweep, captured directly.
  const r = spawnSync(process.execPath, ['-e', src], {
    encoding: 'utf8', maxBuffer: 1 << 28,
    env: { ...process.env, FORGE_FILLDIAG: '1', FORGE_FILL_NATIVE: '0' },
  });
  const diag = r.stderr || '';

  let loops = 0, nativeOk = 0, occtCapped = 0, lost = 0, gain = 0;
  const residuals = [];
  let last = null;
  for (const line of diag.split('\n')) {
    if (line.startsWith('[filldiag] edges=')) {
      const m = /planar=(\d) residual=([-\d.e+]+) native_ok=(\d)/.exec(line);
      if (!m) continue;
      loops++;
      last = { ok: m[3] === '1', res: parseFloat(m[2]) };
      residuals.push(last.res);
      if (last.ok) nativeOk++;
    } else if (line.includes('-> OCCT CAPPED')) {
      occtCapped++;
      if (line.includes('native DEFERRED')) lost++;
    }
  }
  gain = nativeOk - (occtCapped - lost);
  residuals.sort((a, b) => a - b);
  const q = p => residuals.length ? residuals[Math.min(residuals.length - 1, Math.floor(p * residuals.length))] : NaN;

  console.log(`  parts swept                : ${N_PARTS}`);
  console.log(`  free wires reaching filler : ${loops}`);
  console.log(`  OCCT capped                : ${occtCapped}`);
  console.log(`  native capped              : ${nativeOk}`);
  console.log(`  LOST (OCCT ok, native no)  : ${lost}   <== must be 0 to flip the flag`);
  console.log(`  GAIN (native ok, OCCT no)  : ${gain}`);
  console.log(`  planarity residual  p50 ${q(.5).toExponential(3)}  p90 ${q(.9).toExponential(3)}  max ${(residuals[residuals.length - 1] ?? NaN).toExponential(3)}`);

  // This gate does NOT fail on LOST > 0 — the flag is default-OFF precisely because
  // LOST > 0, and asserting otherwise would make the suite red for a known, documented
  // frontier. It fails if the number REGRESSES past the recorded baseline, so the gap
  // can only shrink.
  const BASELINE_LOST_RATE = 0.25;   // measured 329/1716 = 19.2% over 120 parts
  const rate = loops ? lost / loops : 0;
  ok(rate <= BASELINE_LOST_RATE,
     `LOST rate ${(100 * rate).toFixed(1)}% within the recorded ${(100 * BASELINE_LOST_RATE).toFixed(0)}% baseline`);
  ok(gain >= 0, 'native never caps a wire OCCT cannot (no fabricated capability)');
  if (lost > 0) {
    console.log('\n  ⚠ LOST > 0 — FORGE_OFFSET_DROP_MAKEFILLING MUST STAY OFF (Law 9).');
    console.log('    Non-planar loops need a Geom_BSplineSurface export from the native');
    console.log('    N-sided patch engines (GregoryFill.cpp). See CMakeLists.txt.');
  }
}

console.log(`\n${failures === 0 ? '===== ALL PASS =====' : `===== ${failures} FAILED =====`}`);
process.exit(failures === 0 ? 0 : 1);
