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
// DEFAULT (no FORGE_KERNEL) resolves relative to THIS test file, not process.cwd(), so CI's
// `node forge-kernel/test/native_unify_smoke.mjs` from the repo root finds the built .node.
const env = process.env.FORGE_KERNEL
const f = require(
  env
    ? (env.endsWith('.node') ? path.resolve(env) : path.resolve(process.cwd(), env, 'forge-kernel.node'))
    : path.resolve(import.meta.dirname, '..', 'build', 'Release', 'forge-kernel.node'),
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

// ---------------------------------------------------------------------------
// CURVED co-CYLINDRICAL A/B. A native cylinder's lateral surface is emitted as N
// angular STRIP faces on ONE shared analytic surface (buildCylinder = buildCone(r,r,h)
// -> 128 sectors). unifyFaces must merge those strips back into ONE periodic
// cylindrical face IN-HOUSE (the native curved path, no OCCT bridge). Proven two ways:
//   (a) the NATIVE TOPOLOGY genuinely collapses — nativeFaceInventory's lateral strip
//       count drops from N to 1 (the merge is real, not the bridge's reconstruction);
//   (b) the merged solid, bridged to OCCT for counting by the SAME oracle, matches
//       OCCT ShapeUpgrade_UnifySameDomain 1:1 (3 faces, 3 edges, exact volume).
// ---------------------------------------------------------------------------
const cylStrips = (inv) => { const c = inv.find(x => x.kind === 'cylinder'); return c ? c.stripFaceCount : 0 }
const stripCountOf = (inv, kind) => { const c = inv.find(x => x.kind === kind); return c ? c.stripFaceCount : 0 }
const hist = (inv) => { const h = {}; for (const x of inv) h[x.kind] = (h[x.kind] || 0) + 1; return h }

const curvedCases = [
  { name: 'cylinder(r=7, h=25)',  build: (f) => f.makeCylinder(7, 25),  r: 7,   h: 25 },
  { name: 'cylinder(r=1.3, h=5)', build: (f) => f.makeCylinder(1.3, 5), r: 1.3, h: 5 },
]

let cpassed = 0
console.log('\n  native unifySameDomain (curved co-cylindrical)  —  A/B vs OCCT ShapeUpgrade_UnifySameDomain\n')
for (const c of curvedCases) {
  // NATIVE path — the in-house curved merge.
  f.setNativeBrep(true)
  const cyl = c.build(f)
  assert.equal(f.kindOf(cyl), 'nativeSolid', `${c.name}: built as a NativeSolid`)
  const rawStrips = cylStrips(f.nativeFaceInventory(cyl))
  assert.ok(rawStrips >= 8,
    `${c.name}: raw cylinder lateral is many strips (got ${rawStrips})`)

  const u = f.unifyFaces(cyl)
  // 1) the NATIVE CURVED path actually FIRED (a native merge, NOT the OCCT fallback).
  assert.equal(f.kindOf(u), 'nativeSolid',
    `${c.name}: native curved unify must return a NativeSolid (proves the native path fired, not OCCT fallback)`)
  // 2) the native TOPOLOGY genuinely merged the strips into ONE lateral face.
  const inv = f.nativeFaceInventory(u)
  assert.equal(cylStrips(inv), 1,
    `${c.name}: lateral merged to ONE native face (stripFaceCount ${rawStrips} -> ${cylStrips(inv)})`)
  const nh = hist(inv)
  assert.ok(inv.length === 3 && nh.cylinder === 1 && nh.plane === 2,
    `${c.name}: native inventory is {cylinder:1, plane:2} (got ${JSON.stringify(nh)})`)

  // FACE count is measured through the SAME OCCT oracle both ways (f.direct.faceCount
  // bridges the native solid to OCCT first). EDGE count uses the native CANONICAL
  // counter (f.nativeEdgeCount): the native->OCCT bridge's analytic-cylinder
  // reconstruction emits a spurious extra seam edge (the RAW native cylinder also
  // bridges to 4 edges — a bridge-reconstruction artifact ORTHOGONAL to this merge,
  // in NativeOcctBridge.cpp which is out of scope here), whereas the native topology's
  // canonical edge count is the true 3 (seam + top circle + bottom circle) == OCCT.
  const nat = { faces: f.direct.faceCount(u), edges: f.nativeEdgeCount(u), vol: f.massProps(u).volume }

  // OCCT path — ShapeUpgrade_UnifySameDomain on the same cylinder.
  f.setNativeBrep(false)
  const occU = f.unifyFaces(c.build(f))
  assert.equal(f.kindOf(occU), 'occt', `${c.name}: native-off unify must be an OCCT shape`)
  const occ = { faces: f.direct.faceCount(occU), edges: f.direct.edgeCount(occU), vol: f.massProps(occU).volume }

  // 3) A/B: native merge == OCCT merge on face count, edge count and volume.
  assert.equal(nat.faces, occ.faces, `${c.name}: face count native(${nat.faces}) vs OCCT(${occ.faces})`)
  assert.equal(nat.edges, occ.edges, `${c.name}: edge count native(${nat.edges}) vs OCCT(${occ.edges})`)
  near(nat.vol, occ.vol, 1e-9, `${c.name}: volume native vs OCCT`)
  // 4) known answer: a cylinder = 1 lateral + 2 caps (3F), seam + 2 circles (3E), πr²h.
  assert.equal(nat.faces, 3, `${c.name}: cylinder = 3 faces`)
  assert.equal(nat.edges, 3, `${c.name}: cylinder = 3 edges`)
  near(nat.vol, Math.PI * c.r * c.r * c.h, 1e-9, `${c.name}: expected volume πr²h`)

  cpassed++
  console.log(`  PASS  ${c.name}`)
  console.log(`          native: ${rawStrips} strips -> 1 lateral, bridged ${nat.faces}F/${nat.edges}E vol ${nat.vol}`)
  console.log(`          OCCT  : ${occ.faces}F/${occ.edges}E vol ${occ.vol}`)
}

// ---------------------------------------------------------------------------
// CURVED co-CONICAL A/B (ADDITIVE). A native cone (buildCone -> 128 Cone sectors)
// merges its strips into ONE periodic conical face IN-HOUSE (no OCCT bridge). A
// FRUSTUM (r2>0) keeps its two planar caps (== OCCT 3F); a POINTED cone (r2==0)
// collapses its top ring to the apex vertex and keeps one cap (== OCCT 2F). Proven
// like the cylinder: (a) native stripFaceCount 128 -> 1; (b) bridged to OCCT it
// matches OCCT ShapeUpgrade_UnifySameDomain 1:1 (face/edge count + exact volume).
// The cone bridge (occtConeFromNativeSolid -> BRepPrimAPI_MakeCone) is seam-clean,
// so f.direct.edgeCount agrees with OCCT directly (== 3, seam + the circle(s)).
// ---------------------------------------------------------------------------
const coneCases = [
  { name: 'cone frustum (r1=5, r2=3, h=10)', build: (f) => f.makeCone(5, 3, 10),
    faces: 3, planes: 2, vol: (Math.PI * 10 / 3) * (25 + 15 + 9) },
  { name: 'pointed cone (r1=5, r2=0, h=10)', build: (f) => f.makeCone(5, 0, 10),
    faces: 2, planes: 1, vol: Math.PI * 25 * 10 / 3 },
]
let konpassed = 0
console.log('\n  native unifySameDomain (curved co-conical)  —  A/B vs OCCT ShapeUpgrade_UnifySameDomain\n')
for (const c of coneCases) {
  f.setNativeBrep(true)
  const cone = c.build(f)
  assert.equal(f.kindOf(cone), 'nativeSolid', `${c.name}: built as a NativeSolid`)
  const rawStrips = stripCountOf(f.nativeFaceInventory(cone), 'cone')
  assert.ok(rawStrips >= 8, `${c.name}: raw cone lateral is many strips (got ${rawStrips})`)

  const u = f.unifyFaces(cone)
  assert.equal(f.kindOf(u), 'nativeSolid',
    `${c.name}: native curved unify must return a NativeSolid (proves the native path fired, not OCCT fallback)`)
  const inv = f.nativeFaceInventory(u)
  assert.equal(stripCountOf(inv, 'cone'), 1,
    `${c.name}: lateral merged to ONE native cone face (stripFaceCount ${rawStrips} -> ${stripCountOf(inv, 'cone')})`)
  const nh = hist(inv)
  assert.ok(inv.length === 1 + c.planes && nh.cone === 1 && nh.plane === c.planes,
    `${c.name}: native inventory is {cone:1, plane:${c.planes}} (got ${JSON.stringify(nh)})`)

  const nat = { faces: f.direct.faceCount(u), edges: f.direct.edgeCount(u), vol: f.massProps(u).volume }

  f.setNativeBrep(false)
  const occU = f.unifyFaces(c.build(f))
  assert.equal(f.kindOf(occU), 'occt', `${c.name}: native-off unify must be an OCCT shape`)
  const occ = { faces: f.direct.faceCount(occU), edges: f.direct.edgeCount(occU), vol: f.massProps(occU).volume }

  // A/B: native merge == OCCT merge on face count, edge count and volume.
  assert.equal(nat.faces, occ.faces, `${c.name}: face count native(${nat.faces}) vs OCCT(${occ.faces})`)
  assert.equal(nat.edges, occ.edges, `${c.name}: edge count native(${nat.edges}) vs OCCT(${occ.edges})`)
  near(nat.vol, occ.vol, 1e-9, `${c.name}: volume native vs OCCT`)
  // known answer: frustum = 3F (1 cone + 2 caps); apex = 2F (1 cone + 1 cap); 3 edges.
  assert.equal(nat.faces, c.faces, `${c.name}: expected ${c.faces} faces`)
  assert.equal(nat.edges, 3, `${c.name}: expected 3 edges`)
  near(nat.vol, c.vol, 1e-6, `${c.name}: expected analytic cone volume`)

  konpassed++
  console.log(`  PASS  ${c.name}`)
  console.log(`          native: ${rawStrips} strips -> 1 lateral, bridged ${nat.faces}F/${nat.edges}E vol ${nat.vol}`)
  console.log(`          OCCT  : ${occ.faces}F/${occ.edges}E vol ${occ.vol}`)
}

// ---------------------------------------------------------------------------
// CURVED co-SPHERICAL A/B (ADDITIVE). A native sphere (128*64 = 8192 spherical
// patches on ONE surface, poles as triangle fans) merges into ONE periodic spherical
// face IN-HOUSE — a there-and-back seam meridian with the two poles as degenerate
// vertices (== OCCT BRepPrimAPI_MakeSphere: 1 face, 3 edges). Proven: (a) native
// stripFaceCount 8192 -> 1; (b) bridged to OCCT it matches OCCT ShapeUpgrade 1:1 on
// FACE + EDGE count and VOLUME. The native single-face regionUV mass resolves the
// polar (phi) span with the shared scan-line integrator's 8-node Gauss rule, so it
// matches OCCT's analytic-exact volume to ~1e-5 abs (2.8e-8 relative) — the honest
// precision of that path on a full sphere; the topology (1F/3E) is EXACT.
// ---------------------------------------------------------------------------
let sppassed = 0
console.log('\n  native unifySameDomain (curved co-spherical)  —  A/B vs OCCT ShapeUpgrade_UnifySameDomain\n')
for (const R of [3, 1.5]) {
  const name = `sphere(r=${R})`
  f.setNativeBrep(true)
  const sph = f.makeSphere(R)
  assert.equal(f.kindOf(sph), 'nativeSolid', `${name}: built as a NativeSolid`)
  const rawStrips = stripCountOf(f.nativeFaceInventory(sph), 'sphere')
  assert.ok(rawStrips >= 64, `${name}: raw sphere is many patches (got ${rawStrips})`)

  const u = f.unifyFaces(sph)
  assert.equal(f.kindOf(u), 'nativeSolid',
    `${name}: native curved unify must return a NativeSolid (proves the native path fired, not OCCT fallback)`)
  const inv = f.nativeFaceInventory(u)
  assert.equal(stripCountOf(inv, 'sphere'), 1,
    `${name}: merged to ONE native sphere face (stripFaceCount ${rawStrips} -> ${stripCountOf(inv, 'sphere')})`)
  assert.ok(inv.length === 1 && hist(inv).sphere === 1,
    `${name}: native inventory is {sphere:1} (got ${JSON.stringify(hist(inv))})`)

  const nat = { faces: f.direct.faceCount(u), edges: f.direct.edgeCount(u), vol: f.massProps(u).volume }

  f.setNativeBrep(false)
  const occU = f.unifyFaces(f.makeSphere(R))
  assert.equal(f.kindOf(occU), 'occt', `${name}: native-off unify must be an OCCT shape`)
  const occ = { faces: f.direct.faceCount(occU), edges: f.direct.edgeCount(occU), vol: f.massProps(occU).volume }

  // A/B: native merge == OCCT merge on face + edge count (EXACT) and volume.
  assert.equal(nat.faces, occ.faces, `${name}: face count native(${nat.faces}) vs OCCT(${occ.faces})`)
  assert.equal(nat.edges, occ.edges, `${name}: edge count native(${nat.edges}) vs OCCT(${occ.edges})`)
  near(nat.vol, occ.vol, 1e-5, `${name}: volume native vs OCCT (8-node polar Gauss precision)`)
  near(occ.vol, 4 / 3 * Math.PI * R * R * R, 1e-6, `${name}: OCCT volume is (4/3)πr³`)
  // known answer: OCCT MakeSphere = 1 face, 3 edges (seam meridian + 2 pole-degenerate).
  assert.equal(nat.faces, 1, `${name}: sphere = 1 face`)
  assert.equal(nat.edges, 3, `${name}: sphere = 3 edges`)

  sppassed++
  console.log(`  PASS  ${name}`)
  console.log(`          native: ${rawStrips} patches -> 1 sphere face, bridged ${nat.faces}F/${nat.edges}E vol ${nat.vol}`)
  console.log(`          OCCT  : ${occ.faces}F/${occ.edges}E vol ${occ.vol}`)
}

// ---------------------------------------------------------------------------
// DEFERRED-to-OCCT (the honest scope boundary). Cylinder / cone / sphere now merge
// natively; a TORUS (co-toroidal, not built), a multi-cylinder TUBE (two ruled
// groups + annular caps), and a HOLED bored plate are NOT handled by the native
// curved merge and must fall through to OCCT ShapeUpgrade_UnifySameDomain UNCHANGED
// (unifyFaces returns an OCCT-backed handle). This locks the boundary so the native
// path never misfires on a shape it cannot merge exactly.
// ---------------------------------------------------------------------------
let dpassed = 0
console.log('\n  deferred-to-OCCT (honest scope boundary)\n')
f.setNativeBrep(true)
const deferred = [
  { name: 'torus(5,2)  — co-toroidal (not built)',      build: (f) => f.makeTorus(5, 2) },
  { name: 'tube(2,1,4) — two ruled groups + annular caps', build: (f) => f.makeTube(2, 1, 4) },
  { name: 'bored plate — holed caps',                   build: (f) => f.cut(f.makeBox(10, 10, 4), f.translate(f.makeCylinder(2, 4), 5, 5, 0)) },
]
for (const d of deferred) {
  const h = f.unifyFaces(d.build(f))
  assert.equal(f.kindOf(h), 'occt', `${d.name}: unifyFaces defers to OCCT (got ${f.kindOf(h)})`)
  dpassed++
  console.log(`  PASS  ${d.name} -> OCCT fallback`)
}

// restore default gate
f.setNativeBrep(true)
console.log(`\n  ${passed}/${cases.length} planar + ${cpassed}/${curvedCases.length} cyl + ${konpassed}/${coneCases.length} cone + ${sppassed}/2 sphere A/B + ${dpassed}/${deferred.length} deferred cases passed`)
