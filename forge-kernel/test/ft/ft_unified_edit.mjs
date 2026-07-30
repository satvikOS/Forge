// ft_unified_edit.mjs — the ONE-ENTRY gate.
//
// SACROSANCT Law 2: Archie emits exactly ONE structure — the Unified Feature-Tree
// IR — for BOTH generation and editing, and the kernel executes it as-is. This
// suite proves that `forge.ft.compile` is that single entry: the same parser, the
// same walker and the same measurement serve a construction tree AND an edit tree
// that opens with `%0 = INPUT()`.
//
// Every case asserts the EXACT geometric consequence of the edit (volume, face
// count, bore radius), because a plausible-looking edit that did nothing is the
// failure mode this gate exists to catch.
//
//   FORGE_KERNEL=build/Release node test/ft/ft_unified_edit.mjs

import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const require = createRequire(import.meta.url)
const env = process.env.FORGE_KERNEL
const forge = require(
  env
    ? (env.endsWith('.node') ? path.resolve(env) : path.resolve(process.cwd(), env, 'forge-kernel.node'))
    : path.resolve(import.meta.dirname, '..', '..', 'build', 'Release', 'forge-kernel.node'),
)

const PI = Math.PI
const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} != ${b} (tol ${tol})`)

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  PASS  ${name}`) }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft_unified_'))
const stepPath = (n) => path.join(tmp, `${n}.step`)

// ---------------------------------------------------------------------------
// 1. GENERATION through the one entry (the half that already worked — guard it)
// ---------------------------------------------------------------------------
test('gen: construction tree compiles + measures through ft.compile', () => {
  const ir = `
%1 = BOX(60, 40, 10, 0, 0, 0)
%2 = HOLE(%1, 8, -20, 0, 0)
%3 = HOLE(%2, 8, 20, 0, 0)
RESULT(%3)
`
  const r = forge.ft.compile(ir)
  assert.ok(r.ok, `gen compile failed: ${r.error}`)
  assert.ok(r.valid, 'gen result must be a valid solid')
  near(r.volume, 60 * 40 * 10 - 2 * PI * 16 * 10, 1e-6, 'gen volume')
})

test('gen: a through HOLE goes THROUGH, whatever the part proportions', () => {
  // Regression: the through-cutter was centred on the op's own z and only
  // reached (bbox diagonal)/2 beyond it, so a part taller than that got a BLIND
  // hole and no error. CYL(9.633, 104.1) + HOLE(17.045) cut 54.8 of 104.1 mm —
  // a 2.7x volume error, silently, in the most-used op in the corpus.
  for (const [R, T, dia] of [[9.633, 104.1, 17.045], [137.812, 393.75, 196.875], [30, 10, 24]]) {
    const r = forge.ft.compile(`%1 = CYL(${R}, ${T}, 0, 0, 0)\n%2 = HOLE(%1, ${dia}, 0, 0, 0)\nRESULT(%2)`)
    assert.ok(r.ok, `tube ${R}x${T} failed: ${r.error}`)
    near(r.volume, PI * (R * R - (dia / 2) ** 2) * T, 1e-3 * R * R * T,
         `through-hole volume for CYL(${R}, ${T})`)
  }
})

test('gen: a through CBORE pilot also goes through a tall boss', () => {
  const R = 12, T = 90
  const r = forge.ft.compile(
    `%1 = CYL(${R}, ${T}, 0, 0, 0)\n%2 = CBORE(%1, 10, 16, 6, 0, 0, ${T})\nRESULT(%2)`)
  assert.ok(r.ok, `cbore failed: ${r.error}`)
  const expect = PI * R * R * T - PI * 25 * T - PI * (64 - 25) * 6
  near(r.volume, expect, 1e-3 * expect, 'cbore volume (through pilot + recess)')
})

// ---------------------------------------------------------------------------
// 2. EDIT through the SAME entry: INPUT() binds a STEP, edit ops modify it
// ---------------------------------------------------------------------------

// Base part written once and re-read as the "naked STEP" an edit task receives:
// a 62.16 x 62.16 x 5.61 plate, one central O14.34 bore, four O4.02 bores on a
// 21.75 mm bolt circle — the shape family the CADGenBench edit fixtures use.
const BASE_IR = `
%1 = BOX(62.16, 62.16, 5.61, 0, 0, 0)
%2 = HOLE(%1, 14.34, 0, 0, 0)
%3 = HOLE(%2, 4.02, -21.75, 0, 0)
%4 = HOLE(%3, 4.02, 21.75, 0, 0)
%5 = HOLE(%4, 4.02, 0, -21.75, 0)
%6 = HOLE(%5, 4.02, 0, 21.75, 0)
RESULT(%6)
`
const BASE_STEP = stepPath('base')
const PLATE = 62.16 * 62.16 * 5.61
const BORE = (d) => PI * (d / 2) ** 2 * 5.61

test('edit setup: base part builds + exports through ft.compile', () => {
  const r = forge.ft.compile(BASE_IR, BASE_STEP)
  assert.ok(r.ok, `base compile failed: ${r.error}`)
  assert.ok(r.exported, 'base STEP must be written')
  assert.ok(fs.existsSync(BASE_STEP), 'base STEP must exist on disk')
  near(r.volume, PLATE - BORE(14.34) - 4 * BORE(4.02), 1e-6, 'base volume')
})

test('edit: INPUT() + DEFEATURE removes the 3 smallest bores, volume grows exactly', () => {
  const ir = `
%0 = INPUT()
%1 = DEFEATURE(%0, "holes:smallest:3")
RESULT(%1)
`
  const out = stepPath('defeatured')
  const r = forge.ft.compile(ir, { out, input: BASE_STEP })
  assert.ok(r.ok, `edit compile failed: ${r.error}`)
  assert.ok(r.valid, 'edited body must be a valid solid')
  // three O4.02 through-bores filled: volume rises by exactly their material
  near(r.volume, PLATE - BORE(14.34) - BORE(4.02), 1e-4, 'defeatured volume')
  assert.ok(r.exported && fs.existsSync(out), 'edited STEP must be written')
})

test('edit: RESIZEBORE sets the largest bore to an exact new radius', () => {
  const ir = `
%0 = INPUT()
%1 = RESIZEBORE(%0, "bore:max", 10)
RESULT(%1)
`
  const r = forge.ft.compile(ir, { out: stepPath('resized'), input: BASE_STEP })
  assert.ok(r.ok, `resize compile failed: ${r.error}`)
  // O14.34 (r=7.17) widened to r=10
  near(r.volume, PLATE - PI * 100 * 5.61 - 4 * BORE(4.02), 1e-3, 'resized volume')
})

test('edit: PUSHFACE moves the +Z face outward by an exact distance', () => {
  const ir = `
%0 = INPUT()
%1 = PUSHFACE(%0, "+Z", 4)
RESULT(%1)
`
  const r = forge.ft.compile(ir, { out: stepPath('pushed'), input: BASE_STEP })
  assert.ok(r.ok, `pushface compile failed: ${r.error}`)
  near(r.bbox.max[2] - r.bbox.min[2], 5.61 + 4, 1e-3, 'thickness after push')
})

test('edit: selectors resolve by radius — "bore:r=4.02" picks the small bores', () => {
  const ir = `
%0 = INPUT()
%1 = DEFEATURE(%0, "bore:r=4.02")
RESULT(%1)
`
  const r = forge.ft.compile(ir, { out: stepPath('r_sel'), input: BASE_STEP })
  assert.ok(r.ok, `radius-selector compile failed: ${r.error}`)
  // all four O4.02 bores filled; the central bore survives
  near(r.volume, PLATE - BORE(14.34), 1e-4, 'radius-selected volume')
})

// ---------------------------------------------------------------------------
// 2b. POSITIONAL selection — the interface lever. With four equal-radius bolt
//     holes, WHICH ones an edit removes is the entire content of the edit, and
//     no rank-based selector can express it.
// ---------------------------------------------------------------------------
test('edit: "hole:at=x,y" removes exactly the named bores, leaving the others', () => {
  const ir = `
%0 = INPUT()
%1 = DEFEATURE(%0, "hole:at=21.75,0", "hole:at=-21.75,0")
%2 = VERIFY(%1, "holes=3")
RESULT(%2)
`
  const r = forge.ft.compile(ir, { out: stepPath('positional'), input: BASE_STEP })
  assert.ok(r.ok, `positional compile failed: ${r.error}`)
  // exactly two of the four O4.02 bores filled — central + two small survive
  near(r.volume, PLATE - BORE(14.34) - 2 * BORE(4.02), 1e-4, 'positional volume')
})

test('a position matching no bore fails loudly', () => {
  const r = forge.ft.compile(
    `%0 = INPUT()\n%1 = DEFEATURE(%0, "hole:at=99,99")\nRESULT(%1)`,
    { input: BASE_STEP })
  assert.ok(!r.ok, 'an unmatched position must fail')
  assert.match(r.error, /no bore at/, `error: ${r.error}`)
})

test('selectors COMPOSE: position AND radius narrow together', () => {
  // A human disambiguates a hole on a drawing by saying both where it is and how
  // big it is. The position clause used to return immediately, so "the O4 bore at
  // (-25, 0)" was inexpressible — the two filters could never be combined.
  const base = `%1 = BOX(80, 80, 6, 0, 0, 0)
%2 = HOLE(%1, 12, 0, 0, 0)
%3 = HOLE(%2, 4, -25, 0, 0)
%4 = HOLE(%3, 8, 25, 0, 0)
%5 = HOLE(%4, 4, 0, 25, 0)
`
  const run = (sel) => forge.ft.compile(`${base}%6 = DEFEATURE(%5, ${sel})\nRESULT(%6)`)

  const posOnly = run('"hole:at=-25,0"')
  assert.ok(posOnly.ok, `position selector failed: ${posOnly.error}`)

  const composed = run('"hole:at=-25,0:r=2"')
  assert.ok(composed.ok, `composed selector failed: ${composed.error}`)
  near(composed.volume, posOnly.volume, 1e-6,
       'position+radius must resolve the same single bore as position alone')

  // and the composition must actually FILTER, not be decoration
  const wrong = run('"hole:at=-25,0:r=99"')
  assert.ok(!wrong.ok, 'a position that matches with a radius that does not must fail')
  assert.match(wrong.error, /no face with radius/, `error: ${wrong.error}`)

  // radius alone is broader — it takes BOTH O4 bores
  const radiusOnly = run('"bore:r=2"')
  assert.ok(radiusOnly.ok, `radius selector failed: ${radiusOnly.error}`)
  assert.ok(radiusOnly.volume > composed.volume,
            'radius-only removes two bores, so more material returns than the single-bore case')
})

// ---------------------------------------------------------------------------
// 3. VERIFY — the in-IR do-no-harm gate must PASS truth and FAIL falsehood
// ---------------------------------------------------------------------------
test('VERIFY passes true invariants and records them', () => {
  const ir = `
%0 = INPUT()
%1 = DEFEATURE(%0, "holes:smallest:3")
%2 = VERIFY(%1, "holes=2", "bbox.z=5.61")
RESULT(%2)
`
  const r = forge.ft.compile(ir, { input: BASE_STEP })
  assert.ok(r.ok, `verify compile failed: ${r.error}`)
  assert.ok(Array.isArray(r.verify) && r.verify.length === 2, 'two assertions recorded')
  assert.ok(r.verify.every(v => v.startsWith('PASS')), `all must pass: ${r.verify}`)
})

test('VERIFY fails LOUDLY on a false invariant (no silent pass)', () => {
  const ir = `
%0 = INPUT()
%1 = DEFEATURE(%0, "holes:smallest:3")
%2 = VERIFY(%1, "holes=5")
RESULT(%2)
`
  const r = forge.ft.compile(ir, { input: BASE_STEP })
  assert.ok(!r.ok, 'a false assertion MUST fail the compile')
  assert.match(r.error, /VERIFY failed/, `error must name the assertion: ${r.error}`)
})

// ---------------------------------------------------------------------------
// 4. Failure discipline — an edit that cannot be grounded must not report success
// ---------------------------------------------------------------------------
test('INPUT() without an input STEP fails loudly', () => {
  const r = forge.ft.compile(`%0 = INPUT()\nRESULT(%0)`)
  assert.ok(!r.ok, 'INPUT() with no input must fail')
  assert.match(r.error, /no input STEP/, `error must explain: ${r.error}`)
})

test('a selector matching nothing fails loudly (never a silent no-op)', () => {
  const ir = `
%0 = INPUT()
%1 = DEFEATURE(%0, "bore:r=999")
RESULT(%1)
`
  const r = forge.ft.compile(ir, { input: BASE_STEP })
  assert.ok(!r.ok, 'an unmatched selector must fail')
  assert.match(r.error, /no face with radius|matched no candidate/, `error: ${r.error}`)
})

test('PUSHFACE on a non-planar selection fails loudly', () => {
  const ir = `
%0 = INPUT()
%1 = PUSHFACE(%0, "bore:max", 2)
RESULT(%1)
`
  const r = forge.ft.compile(ir, { input: BASE_STEP })
  assert.ok(!r.ok, 'pushing a cylindrical face must fail')
  assert.match(r.error, /not planar/, `error: ${r.error}`)
})

console.log(`\n  ${passed} passed — ONE entry executes gen AND edit`)
fs.rmSync(tmp, { recursive: true, force: true })
