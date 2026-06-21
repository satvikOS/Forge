// forge-kernel native_binding_smoke.js
//
// Smoke test for the in-house forge::native ops wired into forge-kernel.node
// (KERNEL_INHOUSE_ROADMAP Stage 0 wiring). These are PURE C++20 stdlib
// modules (NO OCCT / WASM / external deps) compiled INTO the .node and exposed
// under `forge.native`. We require() the freshly built .node and exercise the
// new ops, asserting REAL results — and, critically, asserting the mesh boolean
// returns its HONEST {ok, reason}: ok=true with a sane volume on an enclosed
// sphere-in-cube, and ok=false (never a fake) on a clean 45° coplanar cube.
//
// Run:  node forge-kernel/test/native_binding_smoke.js   (exit 0 on success)

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');

let forge;
try {
  forge = require(KERNEL);
} catch (e) {
  console.error('[native-smoke] FAILED to load kernel at', KERNEL);
  console.error(e);
  process.exit(1);
}

assert.ok(forge.native && typeof forge.native === 'object',
  'forge.native namespace must exist on the rebuilt .node');
const N = forge.native;

const EXPECTED = [
  'orient2d', 'orient3d', 'incircle',
  'convexHull2D', 'convexHull3D',
  'sdfSphereVolume', 'gdtTruePosition', 'gdtFlatness', 'meshBoolean',
];
for (const op of EXPECTED) {
  assert.strictEqual(typeof N[op], 'function',
    `forge.native.${op} must be a function`);
}
console.log('[native-smoke] forge.native exposes:', Object.keys(N).join(', '));

// ───────────────────────────────── robust predicates ────────────────────────
// orient3d on a KNOWN tetra. With a,b,c = (0,0,0),(1,0,0),(0,1,0) seen CCW from
// above, d=(0,0,1) lies ABOVE that plane => NEGATIVE (per the header's sign
// convention). Swapping b<->c flips the sign to POSITIVE. The exact predicate
// returns -1 / 0 / +1.
{
  const s1 = N.orient3d(0,0,0, 1,0,0, 0,1,0, 0,0,1);
  const s2 = N.orient3d(0,0,0, 0,1,0, 1,0,0, 0,0,1);
  assert.strictEqual(s1, -1, 'orient3d(known tetra) must be -1');
  assert.strictEqual(s2,  1, 'orient3d(swapped tetra) must be +1');
  // Coplanar quadruple => exactly ZERO.
  assert.strictEqual(N.orient3d(0,0,0, 1,0,0, 0,1,0, 1,1,0), 0,
    'orient3d(coplanar) must be 0');
  console.log('[native-smoke] orient3d sign of a known tetra: OK (-1 / +1 / 0)');
}
{
  assert.strictEqual(N.orient2d(0,0, 1,0, 0,1),  1, 'orient2d CCW must be +1');
  assert.strictEqual(N.orient2d(0,0, 0,1, 1,0), -1, 'orient2d CW must be -1');
  assert.strictEqual(N.orient2d(0,0, 1,1, 2,2),  0, 'orient2d collinear must be 0');
  // d=(0.1,0.1) is inside the circumcircle of the CCW triangle (0,0),(1,0),(0,1).
  assert.strictEqual(N.incircle(0,0, 1,0, 0,1, 0.1,0.1), 1,
    'incircle inside must be +1');
  console.log('[native-smoke] orient2d / incircle exact signs: OK');
}

// ──────────────────────────── computational geometry ────────────────────────
// 2D convex hull of a unit square + an INTERIOR point => exactly 4 hull verts
// (the interior point is dropped by the exact predicate, not a tolerance).
{
  const hull = N.convexHull2D([0,0, 1,0, 1,1, 0,1, 0.5,0.5]);
  assert.strictEqual(hull.length / 2, 4,
    `convexHull2D(square+interior) must have 4 vertices, got ${hull.length/2}`);
  console.log('[native-smoke] convexHull2D vertex count: 4 (interior point dropped) OK');
}
// 3D convex hull of a tetra (4 corners) + an interior point => ok, 4 faces.
{
  const r = N.convexHull3D([0,0,0, 1,0,0, 0,1,0, 0,0,1, 0.25,0.25,0.25]);
  assert.strictEqual(r.ok, true, 'convexHull3D(tetra) must succeed');
  assert.strictEqual(r.faceCount, 4,
    `convexHull3D(tetra) must have 4 faces, got ${r.faceCount}`);
  assert.strictEqual(r.faces.length, 12, 'convexHull3D faces array = 3*faceCount');
  console.log('[native-smoke] convexHull3D tetra: ok=true, 4 faces OK');
}

// ───────────────────────────────── implicit / SDF ───────────────────────────
// Marching-cubes meshed volume of a unit-radius sphere SDF converges to
// 4/3·π·r³ ≈ 4.18879. A marching-cubes mesh slightly under-fills, so we accept
// within 3% — REAL convergence, never an exact-surface claim.
{
  const v = N.sdfSphereVolume(1.0, 48);
  const truth = (4 / 3) * Math.PI;
  assert.ok(Math.abs(v - truth) / truth < 0.03,
    `sdfSphereVolume r=1 (${v}) must be within 3% of ${truth.toFixed(5)}`);
  console.log(`[native-smoke] sdfSphereVolume r=1: ${v.toFixed(5)} ~ ${truth.toFixed(5)} OK`);
}

// ─────────────────────────────── GD&T (Y14.5 math) ──────────────────────────
// True position: nominal feature exactly on basic location => deviation 0,
// PASS inside the Ø0.2 zone. A 0.5 mm offset => deviation 1.0 (diametral), FAIL.
{
  const ok   = N.gdtTruePosition(0.0, 0.0, 0.0, 0.0, 10, 10, 0.2, 'RFS', 'HOLE');
  assert.strictEqual(ok.pass, true, 'gdtTruePosition nominal must PASS');
  assert.ok(Math.abs(ok.deviation) < 1e-9, 'nominal deviation must be ~0');

  const bad  = N.gdtTruePosition(0.5, 0.0, 0.0, 0.0, 10, 10, 0.2, 'RFS', 'HOLE');
  assert.strictEqual(bad.pass, false, 'gdtTruePosition out-of-tol must FAIL');
  assert.ok(bad.deviation > bad.allowedZoneDia,
    'out-of-tol deviation must exceed the allowed zone');
  console.log('[native-smoke] gdtTruePosition: PASS on nominal, FAIL out-of-tol OK');
}
// Flatness: a near-planar point set with a 0.0005 peak-to-valley band passes
// at tol=0.01 and fails at tol=0.0001.
{
  const pts = [0,0,0, 1,0,0, 0,1,0, 1,1,0.0005];
  const pass = N.gdtFlatness(pts, 0.01);
  assert.strictEqual(pass.ok, true, 'gdtFlatness must evaluate (ok)');
  assert.strictEqual(pass.pass, true, 'gdtFlatness within tol must PASS');
  const fail = N.gdtFlatness(pts, 0.0001);
  assert.strictEqual(fail.pass, false, 'gdtFlatness below tol must FAIL');
  console.log('[native-smoke] gdtFlatness: PASS at 0.01, FAIL at 0.0001 OK');
}

// ─────────────────────── robust general mesh boolean (Variant A) ────────────
function box(ox, oy, oz, sx, sy, sz) {
  const pos = [ox,oy,oz, ox+sx,oy,oz, ox+sx,oy+sy,oz, ox,oy+sy,oz,
               ox,oy,oz+sz, ox+sx,oy,oz+sz, ox+sx,oy+sy,oz+sz, ox,oy+sy,oz+sz];
  const idx = [0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4,
               1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7];
  return { pos, idx };
}
const cube = (ox, oy, oz, s) => box(ox, oy, oz, s, s, s);
function sphere(cx, cy, cz, r, nlat, nlon) {
  const pos = [], idx = [];
  const V = (x, y, z) => { const k = pos.length / 3; pos.push(x, y, z); return k; };
  const top = V(cx, cy, cz + r), bot = V(cx, cy, cz - r);
  const ring = [];
  for (let i = 1; i < nlat; i++) {
    const th = Math.PI * i / nlat; const row = [];
    for (let j = 0; j < nlon; j++) {
      const ph = 2 * Math.PI * j / nlon;
      row.push(V(cx + r*Math.sin(th)*Math.cos(ph),
                 cy + r*Math.sin(th)*Math.sin(ph),
                 cz + r*Math.cos(th)));
    }
    ring.push(row);
  }
  for (let j = 0; j < nlon; j++) idx.push(top, ring[0][j], ring[0][(j+1)%nlon]);
  for (let i = 0; i < nlat - 2; i++) for (let j = 0; j < nlon; j++) {
    const a = ring[i][j], b = ring[i][(j+1)%nlon],
          c = ring[i+1][(j+1)%nlon], d = ring[i+1][j];
    idx.push(a, d, b); idx.push(b, d, c);
  }
  const last = nlat - 2;
  for (let j = 0; j < nlon; j++) idx.push(bot, ring[last][(j+1)%nlon], ring[last][j]);
  return { pos, idx };
}

// (1) Enclosed sphere in a cube: A's proven envelope. All three ops must be a
// genuine closed 2-manifold (ok=true) with sane volumes. The cube vol is 27;
// the mesh-sphere vol (intersection) ~ analytic 4/3·π·r³ within tessellation.
{
  const sc = 3.0, ctr = sc / 2, r = 1.0, nlat = 22, nlon = 35;
  const C = cube(0, 0, 0, sc), S = sphere(ctr, ctr, ctr, r, nlat, nlon);
  const cubeVol = sc * sc * sc;
  const sphTruth = (4 / 3) * Math.PI * r ** 3;

  const inter = N.meshBoolean(C.pos, C.idx, S.pos, S.idx, 'intersection');
  assert.strictEqual(inter.ok, true,
    `meshBoolean intersection (enclosed sphere) must be ok=true, got: ${inter.reason}`);
  assert.ok(inter.faceCount > 0 && inter.positions.length > 0 && inter.indices.length > 0,
    'intersection must return real geometry');
  // mesh-sphere undershoots the analytic sphere a few %; assert it is in a sane
  // band around the analytic truth (never the cube, never zero).
  assert.ok(inter.volume > 0.9 * sphTruth && inter.volume < 1.05 * sphTruth,
    `intersection volume ${inter.volume} must be ~ analytic sphere ${sphTruth.toFixed(4)}`);

  const uni = N.meshBoolean(C.pos, C.idx, S.pos, S.idx, 'union');
  assert.strictEqual(uni.ok, true,
    `meshBoolean union (enclosed sphere) must be ok=true, got: ${uni.reason}`);
  assert.ok(Math.abs(uni.volume - cubeVol) < 1e-4,
    `union volume ${uni.volume} must equal cube ${cubeVol} (sphere is enclosed)`);

  const diff = N.meshBoolean(C.pos, C.idx, S.pos, S.idx, 'difference');
  assert.strictEqual(diff.ok, true,
    `meshBoolean difference (enclosed sphere) must be ok=true, got: ${diff.reason}`);
  assert.ok(Math.abs(diff.volume - (cubeVol - inter.volume)) < 1e-4,
    `difference volume ${diff.volume} must equal cube - sphere`);

  console.log(`[native-smoke] meshBoolean enclosed-sphere: ok=true `
    + `(I=${inter.volume.toFixed(4)}~${sphTruth.toFixed(4)}, U=${uni.volume.toFixed(4)}, `
    + `D=${diff.volume.toFixed(4)}) OK`);
}

// (2) Exactly-45° coplanar cube (shares top/bottom faces): a measure-zero
// exact-incidence degeneracy that the SoS layer (sosOrient2d/3d — an
// Edelsbrunner–Mücke lexicographic perturbation keyed to GLOBAL vertex indices,
// proven never-zero + antisymmetric) now CLOSES deterministically. All three
// ops MUST be genuine closed 2-manifolds (ok=true) at the analytic volumes of
// two unit squares (axis-aligned ∩ 45°-rotated), extruded h=1:
//   intersection 2√2−2 ≈ 0.82842712, union 4−2√2 ≈ 1.17157288,
//   difference (A−B) 3−2√2 ≈ 0.17157288.  Still 0 fakes: ok=true only after
// buildFromSoup + validate() (MeshBooleanNative.hpp SoS section).
{
  const A = cube(-0.5, -0.5, -0.5, 1.0);
  const B = cube(-0.5, -0.5, -0.5, 1.0);
  const c = Math.cos(Math.PI / 4), s = Math.sin(Math.PI / 4);
  for (let i = 0; i + 2 < B.pos.length; i += 3) {
    const x = B.pos[i], y = B.pos[i + 1];
    B.pos[i] = c * x - s * y;
    B.pos[i + 1] = s * x + c * y;   // coplanar in z (shares top/bottom faces)
  }
  const truth = {
    intersection: 2 * Math.SQRT2 - 2,
    union:        4 - 2 * Math.SQRT2,
    difference:   3 - 2 * Math.SQRT2,
  };
  for (const op of ['union', 'intersection', 'difference']) {
    const res = N.meshBoolean(A.pos, A.idx, B.pos, B.idx, op);
    assert.strictEqual(res.ok, true,
      `meshBoolean ${op} on 45° coplanar cube must now CLOSE (ok=true) via SoS, got: ${res.reason}`);
    assert.ok(res.positions.length > 0 && res.indices.length > 0,
      `a closed ${op} must return real geometry`);
    assert.ok(Math.abs(res.volume - truth[op]) < 1e-4,
      `meshBoolean ${op} 45° volume ${res.volume} must equal analytic ${truth[op].toFixed(8)}`);
  }
  console.log('[native-smoke] meshBoolean 45° coplanar cube: ok=true via SoS at analytic volumes OK');
}

console.log('\n[native-smoke] ALL forge.native binding assertions PASS');
process.exit(0);
