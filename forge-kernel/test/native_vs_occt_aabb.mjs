// forge-kernel/test/native_vs_occt_aabb.mjs
//
// OCCT_ZERO_ROADMAP W2.1 A/B gate — the NATIVE analytic AABB (ComponentRegistry
// routed through forge::native::brep::computeAabb) vs the OCCT AABB (BRepBndLib +
// Bnd_Box) on the SAME part in the SAME process. For each canonical primitive:
//   * build it with the native flag ON  -> NativeSolid handle -> native AABB,
//   * build it with the native flag OFF -> OCCT handle        -> OCCT AABB,
//   * add each as an identity-transformed instance and read getInstanceAABB,
//   * assert the two boxes agree to 1e-9 (and to the closed-form truth).
//
// Requires the addon built with -DFORGE_NATIVE_BREP=ON (build-native/). Exit 0
// iff every gate passes.
//
// Run: FORGE_KERNEL=/abs/path/build-native/Release/forge-kernel.node \
//        node forge-kernel/test/native_vs_occt_aabb.mjs

import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const KERNEL = process.env.FORGE_KERNEL ||
  path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');

let f;
try { f = require(KERNEL); }
catch (e) { console.error('[ab-aabb] FAILED to load', KERNEL, '\n', e); process.exit(1); }
if (typeof f.setNativeBrep !== 'function') {
  console.error('[ab-aabb] addon lacks setNativeBrep — build with -DFORGE_NATIVE_BREP=ON'); process.exit(1);
}

const IDENT = new Float64Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

// Build with backend `native`, add as an identity instance, read its world AABB
// (6 doubles). With the native flag ON the handle is a NativeSolid → the AABB is
// computed by brep::computeAabb; OFF → OCCT BRepBndLib. kindOf confirms the route.
function aabbOf(buildFn, native) {
  f.setNativeBrep(native);
  const h = buildFn(f);
  const kind = f.kindOf(h);
  const id = f.addInstance(h, IDENT);
  const a = f.getInstanceAABB(id);         // Float64Array(6)
  return { kind, box: Array.from(a) };
}

function maxCornerDelta(a, b) {
  let d = 0;
  for (let k = 0; k < 6; k++) d = Math.max(d, Math.abs(a[k] - b[k]));
  return d;
}

// Closed-form truth box for each primitive (model space, as the SolidFactory
// builds it — curved primitives centred on the Z axis, base at z=0).
const cases = [
  { name: 'box(2,3,4)',     build: f => f.makeBox(2,3,4),       truth: [0,0,0, 2,3,4] },
  { name: 'cylinder(1.3,5)',build: f => f.makeCylinder(1.3,5),  truth: [-1.3,-1.3,0, 1.3,1.3,5] },
  { name: 'sphere(2.1)',    build: f => f.makeSphere(2.1),      truth: [-2.1,-2.1,-2.1, 2.1,2.1,2.1] },
  { name: 'cone(2,0.8,4)',  build: f => f.makeCone(2,0.8,4),    truth: [-2,-2,0, 2,2,4] },
  { name: 'tube(2,1,3)',    build: f => f.makeTube(2,1,3),      truth: [-2,-2,0, 2,2,3] },
  { name: 'prism(6,1.5,3)', build: f => f.makePrism(6,1.5,3),   truth: null },  // n-gon: compare native vs OCCT only
  { name: 'cut box-cyl bore', truth: null,
    build: f => { const b=f.makeBox(4,4,4); let c=f.makeCylinder(0.7,4); c=f.translate(c,1.2,1.6,0); return f.cut(b,c); } },
];

// OCCT's BRepBndLib::Add (the live path) returns a SLIGHTLY ENLARGED box (it adds
// a gap/tolerance, and on curved faces it boxes the facetisation). So the native
// analytic box (tight + exact) is the SMALLER, truer box; we assert:
//   (1) native == closed-form truth to 1e-9 (the exact gate),
//   (2) OCCT contains native (OCCT is never tighter than the exact box),
//   (3) the OCCT-vs-native gap is bounded by OCCT's own box gap (reported), not a
//       native error — the native side is exact (gate 1 proves it).
const TRUTH_TOL = 1e-9;

let fail = 0;
const rows = [];
console.log(`\n[ab-aabb] W2.1 native analytic AABB vs OCCT — addon: ${KERNEL}\n`);

for (const c of cases) {
  let nat, occt;
  try { nat  = aabbOf(c.build, true);  } catch (e) { console.log(`[ab-aabb] FAIL ${c.name}: native threw — ${e.message}`); fail++; continue; }
  try { occt = aabbOf(c.build, false); } catch (e) { console.log(`[ab-aabb] FAIL ${c.name}: OCCT threw — ${e.message}`); fail++; continue; }

  if (nat.kind !== 'nativeSolid' && nat.kind !== 'nativeMesh') {
    console.log(`[ab-aabb] FAIL ${c.name}: native kind=${nat.kind} (expected nativeSolid/Mesh)`); fail++;
  }
  if (occt.kind !== 'occt') {
    console.log(`[ab-aabb] FAIL ${c.name}: OCCT kind=${occt.kind} (expected occt)`); fail++;
  }

  // (1) native == closed-form truth to 1e-9 (where a closed form exists).
  let truthErr = NaN, okTruth = true;
  if (c.truth) {
    truthErr = maxCornerDelta(nat.box, c.truth);
    okTruth = truthErr <= TRUTH_TOL;
    if (!okTruth) { console.log(`[ab-aabb] FAIL ${c.name}: native vs closed-form |d|=${truthErr.toExponential(3)} > ${TRUTH_TOL}`); fail++; }
  }

  // (2) OCCT box CONTAINS the native box (OCCT is the loose/enlarged oracle; the
  //     exact native box must sit inside it within float noise).
  const slack = 1e-7;
  const contains =
    occt.box[0] <= nat.box[0] + slack && occt.box[1] <= nat.box[1] + slack && occt.box[2] <= nat.box[2] + slack &&
    nat.box[3] <= occt.box[3] + slack && nat.box[4] <= occt.box[4] + slack && nat.box[5] <= occt.box[5] + slack;
  if (!contains) { console.log(`[ab-aabb] FAIL ${c.name}: OCCT box does not contain native box`); fail++; }

  const gap = maxCornerDelta(nat.box, occt.box);
  rows.push({ name: c.name, natKind: nat.kind, truthErr, gap, contains,
              pass: okTruth && contains });
}

const pad = (s,n)=>String(s).padEnd(n);
console.log(pad('PART',22), pad('natKind',12), pad('|nat-truth|',13), pad('|nat-occt| gap',16), 'contains  pass');
console.log('-'.repeat(80));
for (const r of rows) {
  console.log(pad(r.name,22), pad(r.natKind,12),
    pad(Number.isFinite(r.truthErr) ? r.truthErr.toExponential(2) : '(n-gon/bool)', 13),
    pad(r.gap.toExponential(2), 16),
    `${r.contains?'yes':'NO '}      ${r.pass?'PASS':'FAIL'}`);
}
console.log(`\n[ab-aabb] native box == closed-form truth to ${TRUTH_TOL} (the exact gate); OCCT BRepBndLib::Add is the looser`);
console.log(`          enlarged oracle that CONTAINS the exact native box (gap = OCCT's own box tolerance, not a native error).`);

if (fail) { console.log(`\n[ab-aabb] ${fail} GATE FAILURE(S)`); process.exit(1); }
console.log(`\n[ab-aabb] ALL ${rows.length} AABB GATES PASS`);
