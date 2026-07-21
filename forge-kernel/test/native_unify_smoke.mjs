// native_unify_smoke — A/B the in-house native unifySameDomain (coplanar planar
// face merge, src/native/brep/UnifyFaces.cpp) against OCCT ShapeUpgrade_UnifySameDomain.
//
// The native analytic boolean shatters each seam-crossing cap into coplanar
// triangle/quad strips (a fuse of two abutting boxes bridges to ~20 planar
// faces). unifyFaces() must merge every coplanar-adjacent set back into one
// face, drop the shared edges, and collapse the collinear seam vertices — so a
// fused pair of unit boxes becomes a plain 6-face box again.
//
// A/B: build the SAME solid twice — once with the native B-rep path ON (so
// unifyFaces takes the in-house native merge) and once OFF (so it takes OCCT's
// ShapeUpgrade_UnifySameDomain) — and assert identical FACE count, EDGE count
// and VOLUME. faceCount/edgeCount bridge a native solid to OCCT first, so both
// measurements are counted by the SAME OCCT oracle (apples to apples).
//
//   FORGE_KERNEL=build/Release/forge-kernel.node node test/native_unify_smoke.mjs

import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import path from 'node:path'

const require = createRequire(import.meta.url)
const env = process.env.FORGE_KERNEL ?? 'build/Release'
const f = require(
  env.endsWith('.node') ? path.resolve(env) : path.resolve(process.cwd(), env, 'forge-kernel.node'),
)

const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} != ${b} (tol ${tol})`)

// Build `buildFn`, run unifyFaces, and report the bridged OCCT counts + volume.
function run(buildFn, native) {
  f.setNativeBrep(native)
  const h = buildFn(f)
  const rawKind = f.kindOf(h)
  const rawFaces = f.direct.faceCount(h)
  const u = f.unifyFaces(h)
  return {
    rawKind,
    rawFaces,
    kind: f.kindOf(u),
    faces: f.direct.faceCount(u),
    edges: f.direct.edgeCount(u),
    vol: f.massProps(u).volume,
  }
}

const box = (f) => f.makeBox(1, 1, 1)
const at = (f, h, x, y, z) => f.translate(h, x, y, z)

const cases = [
  {
    name: 'two unit boxes fused -> plain 6-face box',
    build: (f) => f.fuse(box(f), at(f, box(f), 1, 0, 0)),
    faces: 6, edges: 12, vol: 2,
  },
  {
    name: 'three unit boxes in a row -> plain 6-face box',
    build: (f) => f.fuse(f.fuse(box(f), at(f, box(f), 1, 0, 0)), at(f, box(f), 2, 0, 0)),
    faces: 6, edges: 12, vol: 3,
  },
  {
    name: 'L-shaped union (non-convex coplanar merge)',
    build: (f) => f.fuse(f.makeBox(2, 1, 1), at(f, box(f), 0, 1, 0)),
    vol: 3, // top/bottom are L-hexagons; face/edge count taken from the OCCT A/B
  },
]

let passed = 0
console.log('  native unifySameDomain (coplanar planar)  —  A/B vs OCCT ShapeUpgrade_UnifySameDomain\n')
for (const c of cases) {
  const nat = run(c.build, true)
  const occ = run(c.build, false)

  // 1) the native path actually FIRED (result is a native solid, not an OCCT fallback).
  assert.equal(nat.rawKind, 'nativeSolid', `${c.name}: raw solid should be native`)
  assert.equal(nat.kind, 'nativeSolid', `${c.name}: native unify must return a NativeSolid (proves the native path fired, not OCCT fallback)`)
  assert.equal(occ.kind, 'occt', `${c.name}: native-off unify must be an OCCT shape`)

  // 2) unify actually merged something (raw was shattered into many coplanar strips).
  assert.ok(nat.faces < nat.rawFaces, `${c.name}: unify must reduce face count (${nat.rawFaces} -> ${nat.faces})`)

  // 3) A/B: native merge == OCCT merge on face count, edge count and volume.
  assert.equal(nat.faces, occ.faces, `${c.name}: face count native(${nat.faces}) vs OCCT(${occ.faces})`)
  assert.equal(nat.edges, occ.edges, `${c.name}: edge count native(${nat.edges}) vs OCCT(${occ.edges})`)
  near(nat.vol, occ.vol, 1e-9, `${c.name}: volume native vs OCCT`)

  // 4) known-answer where applicable.
  if (c.faces !== undefined) assert.equal(nat.faces, c.faces, `${c.name}: expected ${c.faces} faces`)
  if (c.edges !== undefined) assert.equal(nat.edges, c.edges, `${c.name}: expected ${c.edges} edges`)
  near(nat.vol, c.vol, 1e-9, `${c.name}: expected volume`)

  passed++
  console.log(`  PASS  ${c.name}`)
  console.log(`          native: ${nat.rawFaces} -> ${nat.faces} faces, ${nat.edges} edges, vol ${nat.vol}`)
  console.log(`          OCCT  : ${occ.rawFaces} -> ${occ.faces} faces, ${occ.edges} edges, vol ${occ.vol}`)
}

// restore default gate
f.setNativeBrep(true)
console.log(`\n  ${passed}/${cases.length} native-unify A/B cases passed`)
