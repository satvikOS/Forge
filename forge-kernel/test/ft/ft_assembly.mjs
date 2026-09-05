// ft_assembly.mjs — the gate on MULTI-BODY / ASSEMBLY in the Unified IR.
//
// WHAT THIS PROTECTS
// ------------------
// The IR gained exactly two ops (COMPONENT, ASSEMBLY) and one keyword (LOOSE)
// so that a multi-component product can be STATED at all. Before them RESULT
// took one solid and there was no op that produced more than one, so the whole
// class — which is most of real mechanical CAD — was inexpressible.
//
// The failure mode this file exists to catch is not a crash. It is the QUIET
// one: an assembly whose components got fused into a single blob. That blob has
// the SAME volume, the SAME bounding box and very nearly the same face count as
// the correct answer, so every scalar the harness normally reports agrees with
// it. Only the body count disagrees — 44 becomes 1 — which is why `bodies` is
// asserted on every case here and why the ops refuse the booleans that would
// cause it.
//
// The second quiet failure is interpenetration. Assembled parts TOUCH by
// design, so a bounding-box overlap test would report interference for every
// correct joint and is worse than useless; the real boolean intersection is the
// only honest measure, and cases 7-8 pin both directions of it.
//
//   node test/ft/ft_assembly.mjs
//   FORGE_VERIFY=build/forge_verify node test/ft/ft_assembly.mjs

import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const BIN = process.env.FORGE_VERIFY
  ? path.resolve(process.env.FORGE_VERIFY)
  : path.join(ROOT, 'build', 'forge_verify')

if (!fs.existsSync(BIN)) {
  console.error(`ft_assembly: forge_verify not built at ${BIN}\n` +
                `  build it with:  cmake --build build --target forge_verify`)
  process.exit(1)
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ft_asm_'))

// ---------------------------------------------------------------------------
// `bodies` is the assertion that matters; `compileFails` marks the cases where
// a LOUD refusal is the correct answer and silence would be the defect.
// ---------------------------------------------------------------------------
const CASES = [
  { name: '1. ASSEMBLY keeps two disjoint bodies separate',
    bodies: 2,
    ir: `%1 = BOX(10, 10, 10, 0, 0, 0)
%2 = BOX(10, 10, 10, 20, 0, 0)
%3 = ASSEMBLY(%1, %2)
RESULT(%3)` },

  // The whole point: these two TOUCH. A fuse would weld them into one body and
  // report the same 2000 mm^3.
  { name: '2. ASSEMBLY does NOT weld bodies that touch',
    bodies: 2, volume: 2000,
    ir: `%1 = BOX(10, 10, 10, 0, 0, 0)
%2 = BOX(10, 10, 10, 0, 0, 10)
%3 = ASSEMBLY(%1, %2)
RESULT(%3)` },

  // ... and the contrast case, so the gate proves it is measuring the
  // difference rather than always answering "separate".
  { name: '3. FUSE of the same two bodies IS one body (same volume)',
    bodies: 1, volume: 2000,
    ir: `%1 = BOX(10, 10, 10, 0, 0, 0)
%2 = BOX(10, 10, 10, 0, 0, 10)
%3 = FUSE(%1, %2)
RESULT(%3)` },

  { name: '4. COMPONENT names a single body and never alters it',
    bodies: 1, volume: 1000, components: ['base'],
    ir: `%1 = BOX(10, 10, 10, 0, 0, 0)
%2 = COMPONENT(%1, "base")
%3 = VERIFY(%2, "volume=1000", "bodies=1")
RESULT(%3)` },

  { name: '5. PATTERN LOOSE yields N separate bodies, auto-numbered',
    bodies: 5,
    components: ['slat_01', 'slat_02', 'slat_03', 'slat_04', 'slat_05'],
    ir: `%1 = BOX(10, 10, 10, 0, 0, 0)
%2 = PATTERN(%1, LINEAR, 5, 10, 0, 0, LOOSE)
%3 = COMPONENT(%2, "slat")
%4 = VERIFY(%3, "bodies=5", "interference<=0")
RESULT(%4)` },

  // Same geometry, no LOOSE: the fused pattern must still fuse, or the keyword
  // changed nothing and existing trees would have silently changed meaning.
  { name: '6. PATTERN without LOOSE still fuses to one body',
    bodies: 1,
    ir: `%1 = BOX(10, 10, 10, 0, 0, 0)
%2 = PATTERN(%1, LINEAR, 5, 10, 0, 0)
RESULT(%2)` },

  { name: '7. interference is ZERO for parts that merely touch',
    bodies: 2,
    ir: `%1 = BOX(10, 10, 10, 0, 0, 0)
%2 = BOX(10, 10, 10, 0, 0, 10)
%3 = ASSEMBLY(%1, %2)
%4 = VERIFY(%3, "interference<=0")
RESULT(%4)` },

  // 500 mm^3 of shared space. If this passes, the check is a no-op.
  { name: '8. interference is CAUGHT when parts interpenetrate',
    compileFails: /interference/,
    ir: `%1 = BOX(10, 10, 10, 0, 0, 0)
%2 = BOX(10, 10, 10, 5, 0, 0)
%3 = ASSEMBLY(%1, %2)
%4 = VERIFY(%3, "interference<=0")
RESULT(%4)` },

  { name: '9. a sub-assembly can be placed and re-grouped',
    bodies: 4,
    ir: `%1 = BOX(10, 10, 10, 0, 0, 0)
%2 = BOX(4, 4, 6, 0, 0, 10)
%3 = ASSEMBLY(%1, %2)
%4 = TRANSLATE(%3, 0, 0, 40)
%5 = ASSEMBLY(%3, %4)
%6 = VERIFY(%5, "bodies=4")
RESULT(%6)` },

  { name: '10. a sub-assembly can be LOOSE-patterned (2-D instancing)',
    bodies: 12,
    ir: `%1 = BOX(8, 8, 8, 0, 0, 0)
%2 = PATTERN(%1, LINEAR, 3, 20, 0, 0, LOOSE)
%3 = PATTERN(%2, LINEAR, 4, 0, 0, 20, LOOSE)
%4 = VERIFY(%3, "bodies=12")
RESULT(%4)` },

  // A fused pattern of a sub-assembly would weld the sub-assembly's own
  // components together — a silent wrong answer, so it must be an error.
  { name: '11. a FUSED pattern of a sub-assembly is refused loudly',
    compileFails: /ASSEMBLY.*LOOSE/s,
    ir: `%1 = BOX(8, 8, 8, 0, 0, 0)
%2 = PATTERN(%1, LINEAR, 3, 20, 0, 0, LOOSE)
%3 = PATTERN(%2, LINEAR, 4, 0, 0, 20)
RESULT(%3)` },

  // Feature ops have no single meaning on a multi-body value. OCCT would
  // happily fillet whichever body it reached first and report success.
  { name: '12. FILLET of an assembly is refused loudly',
    compileFails: /ASSEMBLY/,
    ir: `%1 = BOX(10, 10, 10, 0, 0, 0)
%2 = BOX(10, 10, 10, 20, 0, 0)
%3 = ASSEMBLY(%1, %2)
%4 = FILLET(%3, 1)
RESULT(%4)` },

  { name: '13. CUT of an assembly is refused loudly',
    compileFails: /ASSEMBLY/,
    ir: `%1 = BOX(10, 10, 10, 0, 0, 0)
%2 = BOX(10, 10, 10, 20, 0, 0)
%3 = ASSEMBLY(%1, %2)
%4 = CYL(2, 40, 0, 0, 0)
%5 = CUT(%3, %4)
RESULT(%5)` },

  // Single-body quantities read a UNIFIED face inventory that assumes ONE body.
  // Run on a compound they answer a different question silently: coaxial bores
  // in two DIFFERENT components dedupe into one hole.
  { name: '14. a single-body VERIFY quantity is refused on an assembly',
    compileFails: /single-body quantity/,
    ir: `%1 = BOX(20, 20, 10, 0, 0, 0)
%2 = HOLE(%1, 4, 0, 0, 0)
%3 = BOX(20, 20, 10, 0, 0, 20)
%4 = HOLE(%3, 4, 0, 0, 20)
%5 = ASSEMBLY(%2, %4)
%6 = VERIFY(%5, "holes=2")
RESULT(%6)` },

  // An ordinary single-body part must be entirely unaffected: bodies=1, and
  // the face-inventory quantities keep working.
  { name: '15. an ordinary part is unchanged (bodies=1, holes still work)',
    bodies: 1,
    ir: `%1 = BOX(40, 40, 10, 0, 0, 0)
%2 = HOLE(%1, 5, -12, -12, 0)
%3 = HOLE(%2, 5, 12, 12, 0)
%4 = VERIFY(%3, "bodies=1", "holes=2")
RESULT(%4)` },

  // The axis-line hole key. These four holes share (x,y) and differ only in z,
  // drilled along Y. Keyed on (x, y, radius) they collapsed to one.
  { name: '16. holes on a common (x,y) but different z, drilled along Y, all count',
    bodies: 1,
    ir: `%1 = BOX(40, 20, 100, 0, 0, 0)
%2 = CYL(3, 30, 0, -15, 15, 0, 1, 0)
%3 = PATTERN(%2, LINEAR, 4, 0, 0, 20)
%4 = CUT(%1, %3)
%5 = VERIFY(%4, "holes=4")
RESULT(%5)` },
]

// ---------------------------------------------------------------------------
const reqs = CASES.map((c, i) => JSON.stringify({
  id: String(i), ir: c.ir,
  outStep: path.join(TMP, `case${i}.step`),
})).join('\n') + '\n'

const proc = spawnSync(BIN, [], { input: reqs, encoding: 'utf8', maxBuffer: 1 << 28 })
if (proc.error) { console.error('ft_assembly: cannot run forge_verify —', proc.error); process.exit(1) }

const got = new Map()
for (const line of proc.stdout.split('\n')) {
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

    if (c.compileFails) {
      assert.ok(!rec.ok, `${c.name}: expected a LOUD failure, but the tree compiled`)
      assert.match(rec.error, c.compileFails,
                   `${c.name}: failed for the wrong reason — ${rec.error}`)
      console.log(`  PASS  ${c.name}`)
      continue
    }

    assert.ok(rec.ok, `${c.name}: tree did not compile — ${rec.error}`)
    assert.ok(rec.valid, `${c.name}: result is not valid over EVERY body`)
    assert.equal(rec.bodies, c.bodies,
                 `${c.name}: ${rec.bodies} bodies, must be ${c.bodies}`)
    if (c.volume !== undefined) {
      assert.ok(Math.abs(rec.volume - c.volume) < 1e-6 * Math.max(1, c.volume),
                `${c.name}: volume ${rec.volume}, must be ${c.volume}`)
    }
    if (c.components) {
      assert.deepEqual(rec.components, c.components,
                       `${c.name}: component names ${JSON.stringify(rec.components)}`)
    }

    // The artefact, not the self-report: a multi-body result must reach STEP as
    // that many independent closed solids, or nothing downstream sees them.
    const step = path.join(TMP, `case${i}.step`)
    assert.ok(fs.existsSync(step), `${c.name}: no STEP was written`)
    const text = fs.readFileSync(step, 'utf8')
    const msb = (text.match(/MANIFOLD_SOLID_BREP/g) || []).length
    assert.equal(msb, c.bodies,
                 `${c.name}: STEP carries ${msb} solid bodies, must be ${c.bodies}`)

    console.log(`  PASS  ${c.name}`)
  } catch (e) {
    failed++
    console.log(`  FAIL  ${c.name}\n        ${e.message}`)
  }
}

fs.rmSync(TMP, { recursive: true, force: true })

console.log()
if (failed) {
  console.log(`${failed}/${CASES.length} FAILED`)
  process.exit(1)
}
console.log(`ALL PASS (${CASES.length} cases)`)
