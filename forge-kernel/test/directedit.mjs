// DirectEdit — face inventory, defeaturing, push/pull, bore resize.
//
// Each case asserts the EXACT geometric consequence, because that is the only
// thing that distinguishes a correct direct edit from a plausible one. Volume
// is checked analytically (these are analytic primitives, so BRep volume is
// exact here; on bspline-heavy solids it is not, and callers must use a mesh).
//
//   FORGE_KERNEL=build/Release node test/directedit.mjs

import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import path from 'node:path'

const require = createRequire(import.meta.url)
// Accept EITHER a directory or the .node file itself. Every other suite in this repo passes the
// file path (see native_vs_occt_core.mjs); this test originally demanded a directory, which made
// `FORGE_KERNEL=/abs/forge-kernel.node` fail with MODULE_NOT_FOUND on a perfectly good kernel.
const env = process.env.FORGE_KERNEL ?? 'build/Release'
const forge = require(
  env.endsWith('.node') ? path.resolve(env) : path.resolve(process.cwd(), env, 'forge-kernel.node'),
)

const PI = Math.PI
const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} != ${b} (tol ${tol})`)

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  PASS  ${name}`) }

// On the native B-rep path the native->OCCT bridge emits an analytic cylinder as
// 128 angular strips. Face-level editing is meaningless until they are merged.
// unifyFaces() is the documented prerequisite; on STEP imports it is a no-op.
const canon = (h) => forge.unifyFaces(h)

// makeBox is corner-origin; makeCylinder is axis-origin. A pin must be moved to
// the box centre or the boolean only removes the quarter that overlaps.
const pinAt = (r, h, x, y) => forge.translate(forge.makeCylinder(r, h), x, y, 0)

// ---------------------------------------------------------------------------
test('faceInventory: box has 6 planar faces with outward normals', () => {
  const box = forge.makeBox(20, 30, 40)
  const faces = forge.faceInventory(box)
  assert.equal(faces.length, 6)
  assert.ok(faces.every(f => f.kind === 'plane'))
  near(faces.reduce((s, f) => s + f.area, 0), 2 * (20 * 30 + 30 * 40 + 20 * 40), 1e-6, 'total area')
  // exactly one face points +Z, and it sits at z = 40
  const up = faces.filter(f => f.direction[2] > 0.999)
  assert.equal(up.length, 1)
  near(up[0].centroid[2], 40, 1e-9, '+Z face height')
  near(up[0].area, 20 * 30, 1e-9, '+Z face area')
})

test('native->OCCT bridge shatters an analytic cylinder; unifyFaces repairs it', () => {
  const raw = forge.makeCylinder(7, 25)
  const before = forge.faceInventory(raw)
  const after = forge.faceInventory(canon(raw))
  // Volume is exact either way -- only face IDENTITY is lost.
  near(forge.massProps(raw).volume, PI * 49 * 25, 1e-9, 'raw volume is exact')
  assert.ok(before.length >= after.length, 'unify never increases face count')
  assert.equal(after.filter(f => f.kind === 'cylinder').length, 1, 'one lateral face after unify')
  assert.equal(after.length, 3, 'cylinder = 1 lateral + 2 caps')
})

test('faceInventory: cylinder reports radius, axis, and convexity', () => {
  const cyl = canon(forge.makeCylinder(7, 25))
  const lateral = forge.faceInventory(cyl).filter(f => f.kind === 'cylinder')
  assert.equal(lateral.length, 1)
  near(lateral[0].radius, 7, 1e-9, 'radius')
  near(Math.abs(lateral[0].direction[2]), 1, 1e-9, 'axis is Z')
  assert.equal(lateral[0].concave, false, 'a shaft is convex')
})

test('defeature: a through-hole is removed and the wound heals', () => {
  const box = forge.makeBox(40, 40, 10)
  const pin = pinAt(5, 10, 20, 20)               // centred in the 40x40 box
  const holed = canon(forge.cut(box, pin))
  const before = forge.faceInventory(holed)
  const bore = before.filter(f => f.kind === 'cylinder' && f.concave)
  assert.ok(bore.length >= 1, 'the cut leaves a concave cylindrical bore')
  near(forge.massProps(holed).volume, 40 * 40 * 10 - PI * 25 * 10, 1e-6, 'holed volume')

  const filled = canon(forge.defeature(holed, bore.map(f => f.index)))
  near(forge.massProps(filled).volume, 40 * 40 * 10, 1e-6, 'hole filled back to solid box')
  assert.equal(forge.faceInventory(filled).length, 6, 'back to a plain box')
})

test('pushPullFace: +Z face moves exactly, volume grows by area*distance', () => {
  const box = forge.makeBox(20, 30, 40)
  const up = forge.faceInventory(box).find(f => f.direction[2] > 0.999)
  const grown = canon(forge.pushPullFace(box, up.index, 0, 0, 1, 10))
  near(forge.massProps(grown).volume, 20 * 30 * 50, 1e-6, 'volume after +10mm')
  const top = forge.faceInventory(grown).find(f => f.direction[2] > 0.999)
  near(top.centroid[2], 50, 1e-6, 'new top at z=50')
})

test('pushPullFace: negative distance removes material', () => {
  const box = forge.makeBox(20, 30, 40)
  const up = forge.faceInventory(box).find(f => f.direction[2] > 0.999)
  const cutb = forge.pushPullFace(box, up.index, 0, 0, 1, -10)
  near(forge.massProps(cutb).volume, 20 * 30 * 30, 1e-6, 'volume after -10mm')
})

test('resizeBore: widen a through-bore to an exact radius', () => {
  const box = forge.makeBox(40, 40, 10)
  const holed = canon(forge.cut(box, pinAt(5, 10, 20, 20)))
  const bore = forge.faceInventory(holed).find(f => f.kind === 'cylinder' && f.concave)
  near(bore.radius, 5, 1e-9, 'bore starts at r=5')

  const wide = canon(forge.resizeBore(holed, bore.index, 8))
  near(forge.massProps(wide).volume, 40 * 40 * 10 - PI * 64 * 10, 1e-6, 'volume after widening to r=8')
  const after = forge.faceInventory(wide).find(f => f.kind === 'cylinder' && f.concave)
  near(after.radius, 8, 1e-9, 'bore is now r=8')
})

test('resizeBore: shrink a through-bore to an exact radius', () => {
  const box = forge.makeBox(40, 40, 10)
  const holed = canon(forge.cut(box, pinAt(8, 10, 20, 20)))
  const bore = forge.faceInventory(holed).find(f => f.kind === 'cylinder' && f.concave)
  const small = canon(forge.resizeBore(holed, bore.index, 5))
  near(forge.massProps(small).volume, 40 * 40 * 10 - PI * 25 * 10, 1e-6, 'volume after shrinking to r=5')
  const after = forge.faceInventory(small).find(f => f.kind === 'cylinder' && f.concave)
  near(after.radius, 5, 1e-9, 'bore is now r=5')
})

test('errors surface, they are not swallowed', () => {
  const box = forge.makeBox(10, 10, 10)
  assert.throws(() => forge.pushPullFace(box, 9999, 0, 0, 1, 1), /out of range/)
  const cyl = canon(forge.makeCylinder(3, 3))
  const lat = forge.faceInventory(cyl).find(f => f.kind === 'cylinder')
  assert.throws(() => forge.pushPullFace(cyl, lat.index, 0, 0, 1, 1), /not planar/)
  const up = forge.faceInventory(box).find(f => f.direction[2] > 0.999)
  assert.throws(() => forge.resizeBore(box, up.index, 2), /not cylindrical/)
  assert.throws(() => forge.defeature(box, []), /no faces/)
})

console.log(`\n  ${passed}/9 DirectEdit tests passed`)
