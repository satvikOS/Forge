// ft_bore_count.mjs — the gate on what forge_verify calls a HOLE.
//
// `bores` is not a diagnostic. scripts/archie_loop.py::gate enforces the hole
// count on every task that declares one, and scripts/make_holdout_tasks.py
// derives each task's ground-truth `holes` from this same measurement. So a
// miscount lands on BOTH sides of the gate at once and partially cancels — the
// gate then neither measures hole count nor cleanly fails, and every pass rate
// on filleted parts inherits it.
//
// It miscounted. `bores` reported one hole per concave cylindrical face, and a
// fillet is a concave cylindrical face: BOX(60,60,20) + one O5 hole + FILLET(3)
// reported SEVEN holes where there is one. The plausible fix — reject faces
// whose angular sweep is under 2*pi, derived from area/(radius*axialExtent) —
// is DISPROVED by measurement: a genuine bore and a fillet face BOTH report
// 1.5708, because `area` is not the full swept area that formula assumes. It
// counted ZERO bores on a plain hole and was reverted.
//
// What forge_verify now measures is the SOLID around the face, not the face: at
// some station along the axis, is the axis in air with material closed right
// round it just past the wall? That is what a hole is, and it is the only one of
// these rules that survives all seven cases below.
//
// Under-counting is WORSE than the over-count it replaces, because the gate
// would then pass parts with holes missing entirely. Cases 1, 2, 5 and 6 are
// there to catch exactly that, and this file must fail loudly rather than let a
// hole be dropped quietly.
//
//   node test/ft/ft_bore_count.mjs
//   FORGE_VERIFY=build/forge_verify node test/ft/ft_bore_count.mjs

import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const BIN = process.env.FORGE_VERIFY
  ? path.resolve(process.env.FORGE_VERIFY)
  : path.join(ROOT, 'build', 'forge_verify')

if (!fs.existsSync(BIN)) {
  console.error(`ft_bore_count: forge_verify not built at ${BIN}\n` +
                `  build it with:  cmake --build build --target forge_verify`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// The seven cases the discriminator has to get right AT ONCE. Any rule that
// passes a subset is not a fix — 3, 4 and 7 are the ones that were being
// counted as holes, and 1, 2, 5 and 6 are the ones a stricter rule drops.
// ---------------------------------------------------------------------------
const CASES = [
  { name: '1. plain through bore counts',
    holes: 1,
    ir: `%1 = BOX(60, 60, 20, 0, 0, 0)
%2 = HOLE(%1, 5, 0, 0, 0)
RESULT(%2)` },

  // A blind bore's axis stops inside the part, so "the axis leaves the bounding
  // box" is NOT the discriminator — it would drop this one.
  { name: '2. blind bore counts',
    holes: 1,
    ir: `%1 = BOX(60, 60, 20, 0, 0, 0)
%2 = HOLE(%1, 5, 0, 0, 20, 0, 0, -1, 10)
RESULT(%2)` },

  { name: '3. convex edge fillet does NOT count',
    holes: 0,
    ir: `%1 = BOX(60, 60, 20, 0, 0, 0)
%2 = FILLET(%1, 3, VERTICAL)
RESULT(%2)` },

  // Every edge blended, so the part carries corner cylinders, rim tori and the
  // seams between them. Of the four IDENTICAL corner blends, the kernel's
  // orientation flag calls two concave and two convex — which is why the flag
  // cannot be the test.
  { name: '3b. fillet on ALL edges does NOT count',
    holes: 0,
    ir: `%1 = BOX(60, 60, 20, 0, 0, 0)
%2 = FILLET(%1, 3)
RESULT(%2)` },

  // An L with its inner corner blended by hand: a concave cylinder whose axis
  // IS in air, exactly like a bore's. Only the ring separates them — material
  // covers about half of it.
  { name: '4. internal-corner fillet does NOT count',
    holes: 0,
    ir: `%1 = BOX(60, 60, 20, 0, 0, 0)
%2 = BOX(30, 30, 20, 15, 15, 0)
%3 = CUT(%1, %2)
%4 = BOX(5, 5, 20, 2.5, 2.5, 0)
%5 = CYL(5, 20, 5, 5, 0)
%6 = CUT(%4, %5)
%7 = FUSE(%3, %6)
RESULT(%7)` },

  // Pilot O5 and a O10 recess: two coaxial cylinders of DIFFERENT radii, and
  // ONE hole. Keying the dedup on radius as well as position reported two.
  { name: '5. counterbore counts ONCE, at the pilot diameter',
    holes: 1,
    ir: `%1 = BOX(60, 60, 20, 0, 0, 0)
%2 = CBORE(%1, 5, 10, 6, 0, 0, 20)
RESULT(%2)`,
    check: (b) => {
      assert.ok(Math.abs(b[0].r - 2.5) < 1e-6,
                `counterbore must report the PILOT radius 2.5, got ${b[0].r}`)
      assert.equal(b[0].faces, 2, 'pilot + recess is two faces on one axis')
    } },

  // A clevis: one drilling, two uprights, so the wall arrives as two faces with
  // an air gap between them. Counting faces would say two holes; the surrounding
  // material and the axis are the same for both, so it is one.
  { name: '6. bore split into two faces counts ONCE',
    holes: 1,
    ir: `%1 = BOX(40, 60, 8, 0, 0, 0)
%2 = BOX(40, 8, 30, 0, -26, 8)
%3 = BOX(40, 8, 30, 0, 26, 8)
%4 = FUSE(%1, %2)
%5 = FUSE(%4, %3)
%6 = HOLE(%5, 10, 0, 0, 25, 0, 1, 0)
RESULT(%6)`,
    check: (b) => {
      assert.equal(b[0].faces, 2, 'the wall really is split into two faces')
      assert.ok(Math.abs(b[0].span - 16) < 1e-3,
                `span must be BOTH walls (8 + 8), got ${b[0].span}`)
    } },

  { name: '7. slot end (half cylinder) does NOT count',
    holes: 0,
    ir: `%1 = BOX(60, 60, 20, 0, 0, 0)
%2 = CYL(5, 30, -10, 0, -5)
%3 = CYL(5, 30, 10, 0, -5)
%4 = BOX(20, 10, 30, 0, 0, -5)
%5 = FUSE(%2, %3)
%6 = FUSE(%5, %4)
%7 = CUT(%1, %6)
RESULT(%7)` },

  // ---- the two trees quantified in reports/BORE_COUNT_DEFECT.md -------------
  { name: 'R1. one hole then FILLET(3) is ONE hole (was 7)',
    holes: 1,
    ir: `%1 = BOX(60, 60, 20, 0, 0, 0)
%2 = HOLE(%1, 5, 0, 0, 0)
%3 = FILLET(%2, 3)
RESULT(%3)` },

  { name: 'R2. three holes then FILLET(2) is THREE holes (was 9)',
    holes: 3,
    ir: `%1 = BOX(90, 60, 20, 0, 0, 0)
%2 = HOLE(%1, 4, -25, 0, 0)
%3 = HOLE(%2, 4, 0, 0, 0)
%4 = HOLE(%3, 4, 25, 0, 0)
%5 = FILLET(%4, 2)
RESULT(%5)` },

  // ---- the under-count traps ----------------------------------------------
  // A tube has TWO cylindrical faces on one axis and one of them is the bore.
  // A rule that keys on "cylinder" alone counts two; one that keys on the axis
  // being in air counts two as well. Only the ring test separates them.
  { name: 'X1. tube: the bore counts, the outside does not',
    holes: 1,
    ir: `%1 = CYL(20, 30, 0, 0, 0)
%2 = HOLE(%1, 16, 0, 0, 0)
RESULT(%2)`,
    check: (b) => assert.ok(Math.abs(b[0].r - 8) < 1e-6,
                            `must be the O16 bore, got r=${b[0].r}`) },

  { name: 'X2. a boss is not a hole',
    holes: 0,
    ir: `%1 = BOX(60, 60, 10, 0, 0, 0)
%2 = CYL(8, 15, 0, 0, 10)
%3 = FUSE(%1, %2)
RESULT(%3)` },

  { name: 'X3. four bolt holes count as four',
    holes: 4,
    ir: `%1 = BOX(80, 80, 10, 0, 0, 0)
%2 = HOLE(%1, 6, -25, -25, 0)
%3 = HOLE(%2, 6, 25, -25, 0)
%4 = HOLE(%3, 6, -25, 25, 0)
%5 = HOLE(%4, 6, 25, 25, 0)
RESULT(%5)` },

  { name: 'X4. four bolt holes SURVIVE a corner fillet',
    holes: 4,
    ir: `%1 = BOX(80, 80, 10, 0, 0, 0)
%2 = HOLE(%1, 6, -25, -25, 0)
%3 = HOLE(%2, 6, 25, -25, 0)
%4 = HOLE(%3, 6, -25, 25, 0)
%5 = HOLE(%4, 6, 25, 25, 0)
%6 = FILLET(%5, 4, VERTICAL)
RESULT(%6)` },

  // Two bores that cut each other. At the stations where they cross, neither
  // ring is closed — so the test asks whether SOME station closes, not every
  // one. Requiring every station would delete both of these.
  { name: 'X5. cross-drilled bores both count',
    holes: 2,
    ir: `%1 = BOX(60, 60, 40, 0, 0, 0)
%2 = HOLE(%1, 10, 0, 0, 0)
%3 = HOLE(%2, 8, 0, 0, 20, 1, 0, 0)
RESULT(%3)` },
]

// ---------------------------------------------------------------------------
const stdin = CASES.map((c, i) => JSON.stringify({ id: String(i), ir: c.ir })).join('\n') + '\n'
const run = spawnSync(BIN, { input: stdin, encoding: 'utf8', cwd: ROOT, timeout: 600_000 })
if (run.error) throw run.error
if (run.status !== 0) {
  console.error(run.stderr)
  throw new Error(`forge_verify exited ${run.status}`)
}

const got = new Map()
for (const line of run.stdout.split('\n')) {
  if (!line.trim()) continue
  const rec = JSON.parse(line)
  got.set(rec.id, rec)
}

let failed = 0
for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i]
  const rec = got.get(String(i))
  try {
    assert.ok(rec, `no measurement came back for "${c.name}"`)
    assert.ok(rec.ok, `${c.name}: tree did not compile — ${rec.error}`)
    assert.ok(rec.valid, `${c.name}: result is not a valid solid`)

    // A degraded measurement is the OLD concave-cylinder count wearing the new
    // name. Every fixture here is an ordinary solid, so any fallback on one of
    // them means the guard is firing when it should not.
    assert.ok(!rec.boresDegraded,
              `${c.name}: bore measurement was declined — ${rec.boresDegraded}`)
    assert.ok(!rec.boresFellBack,
              `${c.name}: ${rec.boresFellBack} face(s) could not be measured`)

    const bores = rec.bores || []
    assert.equal(bores.length, c.holes,
                 `${c.name}: ${bores.length} holes reported, must be ${c.holes} ` +
                 `— ${JSON.stringify(bores)}`)
    if (c.check) c.check(bores)
    console.log(`  PASS  ${c.name}`)
  } catch (e) {
    failed++
    console.log(`  FAIL  ${c.name}\n        ${e.message}`)
  }
}

console.log()
if (failed) {
  console.log(`${failed}/${CASES.length} FAILED`)
  process.exit(1)
}
console.log(`ALL PASS (${CASES.length} cases)`)
