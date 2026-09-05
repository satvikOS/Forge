// test/native_draft_ab.mjs — TKOffset family C gate.
//
// Drives forge::occtdraft::draftFaces (src/native/brep/NativeDraftAngle.cpp), the
// TKOffset-free replacement for BRepOffsetAPI_DraftAngle, against CLOSED-FORM
// volumes that are DERIVED here, not borrowed from OCCT. That matters: the corpus
// sweep in reports/TKOFFSET_DECOMPOSITION.md (family C) measured OCCT's own
// DraftAngle returning a wrong volume — by up to 9.8e-3 relative — on 11 corpus
// parts, so OCCT is not a sound oracle for this operation, exactly as §4.2 found
// for ThickSolid.
//
// Both engines run in ONE process on the SAME shape and the SAME face: writes to
// process.env reach getenv(), which is how FORGE_DRAFT_NATIVE is toggled per call.
// Against a build with FORGE_OFFSET_DROP_DRAFT=ON the OCCT side is compiled out and
// its cases are reported as "n/a (dropped)" rather than failing.
//
//   node test/native_draft_ab.mjs

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const f = require(process.env.FORGE_KERNEL || new URL('../build/Release/forge-kernel.node', import.meta.url).pathname);

// Every fixture is built with the native B-rep backend OFF. With it ON, the
// primitives and booleans come back through the native->TopoDS bridge, which splits
// caps into triangles and returns flank planes tilted by ~1e-6 rad; the fixture then
// sets the tolerance instead of the draft. Faces are selected GEOMETRICALLY below
// (never by a hard-coded index), so this file does not depend on either backend's
// face ordering.
f.setNativeBrep(false);

const D = (a) => a * Math.PI / 180;
const NP = (o, n) => ({ origin: o, normal: n });
const V = (h) => f.massProps(h).volume;
const TOL = 1e-9;                       // both paths are analytic; this is not slack

// --- geometric face selection (backend- and ordering-independent) ------------
const faces = (h, pred) => f.faceInventory(h).map((x, i) => [x, i]).filter(([x]) => pred(x)).map(([, i]) => i);
const one = (h, pred, what) => { const r = faces(h, pred); if (!r.length) throw new Error('no ' + what); return r[0]; };
const PLUS_X = (x) => x.kind === 'plane' && x.direction[0] > 0.9;
const TOP_CAP = (x) => x.kind === 'plane' && x.direction[2] > 0.9;
const SIDE_WALL = (x) => x.kind === 'plane' && Math.abs(x.direction[2]) < 0.5;
const CYL = (x) => x.kind === 'cylinder';
const SPHERE = (x) => x.kind === 'sphere';

let pass = 0, fail = 0;
const say = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); ok ? pass++ : fail++; };

// Frustum of a square pyramid, and of a cone — the two closed forms used below.
const sqFrustum = (h, a, b) => h / 3 * (a * a + b * b + a * b);
const coneFrustum = (h, r0, r1) => Math.PI * h / 3 * (r0 * r0 + r1 * r1 + r0 * r1);

function check(name, build, ref) {
  let v;
  try { v = V(build()); }
  catch (e) { say(false, `${name} — threw: ${(e.message || '').replace(/\s+/g, ' ').slice(0, 90)}`); return; }
  const rel = Math.abs(v - ref) / Math.abs(ref);
  say(rel < TOL, `${name} — V=${v.toFixed(9)} ref=${ref.toFixed(9)} rel=${rel.toExponential(2)}`);
}
function refuses(name, build) {
  try { build(); say(false, `${name} — expected an honest refusal, got a shape`); }
  catch (e) { say(true, `${name} — refused: ${(e.message || '').replace(/\s+/g, ' ').slice(0, 70)}`); }
}

for (const mode of ['native', 'occt']) {
  if (mode === 'native') process.env.FORGE_DRAFT_NATIVE = 'strict';
  else delete process.env.FORGE_DRAFT_NATIVE;

  // Is the OCCT baseline even present? Under FORGE_OFFSET_DROP_DRAFT it is not.
  if (mode === 'occt') {
    let dropped = false;
    try { f.part.draftFaces(f.makeSphere(10), NP([0, 0, 0], [0, 0, 1]), [0], D(3)); }
    catch (e) { dropped = /TKOffset-free/.test(e.message || ''); }
    if (dropped) {
      console.log('\n[draft] OCCT baseline: n/a — built with FORGE_OFFSET_DROP_DRAFT=ON');
      continue;
    }
  }
  console.log(`\n[draft] ===== ${mode.toUpperCase()} =====`);

  const box = () => f.makeBox(10, 10, 10);
  const drf = (h, sel, np, deg) => f.part.draftFaces(h, np, sel(h), D(deg));
  const wallX = (h) => [one(h, PLUS_X, '+X wall')];
  const allWalls = (h) => faces(h, SIDE_WALL);
  const topCap = (h) => [one(h, TOP_CAP, 'top cap')];
  const theCyl = (h) => [one(h, CYL, 'cylindrical face')];
  const t3 = Math.tan(D(3)), t5 = Math.tan(D(5));

  // ---- planar walls, both signs, three neutral-plane placements --------------
  check('box: one wall @+3deg (removes a wedge)',
    () => drf(box(), wallX, NP([0, 0, 0], [0, 0, 1]), 3), 1000 - 500 * t3);
  check('box: one wall @-3deg (ADDS a wedge)',
    () => drf(box(), wallX, NP([0, 0, 0], [0, 0, 1]), -3), 1000 + 500 * t3);
  check('box: all four walls @+5deg = square frustum',
    () => drf(box(), allWalls, NP([0, 0, 0], [0, 0, 1]), 5),
    sqFrustum(10, 10, 10 - 20 * t5));
  // Neutral plane at MID height: the walls lean IN above it and flare OUT below,
  // simultaneously. This is the case whose four shared corner columns belong to no
  // single wall's prism — it is the reason cornerBody() exists.
  check('box: four walls @+5deg, neutral at MID height',
    () => drf(box(), allWalls, NP([0, 0, 5], [0, 0, 1]), 5),
    1000 + (1000 / 3) * t5 * t5);
  check('box: four walls @+5deg, neutral at the TOP (pure flare)',
    () => drf(box(), allWalls, NP([0, 0, 10], [0, 0, 1]), 5),
    sqFrustum(10, 10 + 20 * t5, 10));

  // ---- curved walls: a drafted CYLINDER is a true CONE ------------------------
  check('cylinder r10 h30: lateral wall @+3deg -> cone',
    () => drf(f.makeCylinder(10, 30), theCyl, NP([0, 0, 0], [0, 0, 1]), 3),
    coneFrustum(30, 10, 10 - 30 * t3));
  check('cylinder r10 h30: lateral wall @-3deg -> flaring cone',
    () => drf(f.makeCylinder(10, 30), theCyl, NP([0, 0, 0], [0, 0, 1]), -3),
    coneFrustum(30, 10, 10 + 30 * t3));

  // A BORE drafts the other way — the sense follows the face's own outward normal.
  const holed = () => f.cut(f.makeBox(40, 40, 20), f.translate(f.makeCylinder(6, 20), 15, 15, 0));
  check('block + O12 through bore: draft the BORE @+3deg (it opens out)',
    () => drf(holed(), theCyl, NP([0, 0, 0], [0, 0, 1]), 3),
    32000 - coneFrustum(20, 6, 6 + 20 * t3));
  check('block + O12 through bore: draft ONE OUTER WALL (bore untouched)',
    () => drf(holed(), (h) => [one(h, SIDE_WALL, 'outer wall')], NP([0, 0, 0], [0, 0, 1]), 3),
    32000 - Math.PI * 36 * 20 - 40 * 200 * t3);

  // ---- LOCALISATION: an L-bracket's inner flank does NOT support the solid. A
  // global drafted half-space would mill away the far leg; the engine must confine
  // the change to the selected face's own footprint.
  //
  // The reference uses the fixture's MEASURED base volume, so the assertion is on the
  // draft DELTA — the quantity actually under test — in closed form.
  const Lb = () => f.unifyFaces(f.cut(f.makeBox(20, 20, 10), f.translate(f.makeBox(10, 10, 10), 10, 10, 0)));
  const flank = (h, cx) => {
    const i = f.faceInventory(h).findIndex((x) => x.kind === 'plane' && x.direction[0] > 0.9 && Math.abs(x.centroid[0] - cx) < 1e-3);
    if (i < 0) throw new Error('flank not found'); return i;
  };
  const Lbase = V(Lb());
  for (const [cx, label] of [[10, 'INNER flank x=10 (NON-supporting plane)'],
                             [20, 'OUTER flank x=20 (supporting plane)']]) {
    check(`L-bracket: ${label} @+3deg`,
      () => { const b = Lb(); return f.part.draftFaces(b, NP([0, 0, 0], [0, 0, 1]), [flank(b, cx)], D(3)); },
      Lbase - 500 * t3);
  }

  // ---- honest refusals: the same inputs OCCT declines -------------------------
  refuses('box: top cap (normal parallel to the pull direction)',
    () => drf(box(), topCap, NP([0, 0, 0], [0, 0, 1]), 3));
  if (mode === 'native') {
    refuses('sphere wall (no linear draft exists)',
      () => drf(f.makeSphere(10), (h) => [one(h, SPHERE, 'spherical face')], NP([0, 0, 0], [0, 0, 1]), 3));
  }
}

console.log(`\n[draft] ${pass} passed, ${fail} failed`);
if (fail) { console.log('[draft] ===== FAIL ====='); process.exit(1); }
console.log('[draft] ===== ALL PASS =====');
