// G1 ANALYTIC-FACE SURVIVAL regression gate (KERNEL_PARITY_PLAN G1).
//
// Asserts that a native analytic primitive presents the CANONICAL minimal analytic
// B-rep — ONE face per smooth surface — exactly as OCCT does, instead of the
// nSeg=128 angular-strip shatter. This is the prerequisite for direct.* synchronous
// editing and persistent topological naming (G5): a face-level op needs a
// well-defined analytic target, not 128 strips. Fixed 2026-07-17 by coalescing
// co-domain faces at the native→OCCT lazy bridge (occtFromNativeSolid).
//
// Run: node test/native_vs_occt_g1_analytic_face.mjs   (exit 0 = PASS)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const k = require('../build/Release/forge-kernel.node');

if (typeof k.setNativeBrep !== 'function') {
  console.error('[g1] addon lacks setNativeBrep — build with -DFORGE_NATIVE_BREP=ON');
  process.exit(1);
}

const census = (h) => {
  const kinds = {};
  for (const f of k.faceInventory(h)) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
  return { n: k.faceInventory(h).length, kinds };
};
const kindsEqual = (a, b) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k2) => a[k2] === b[k2]);
};

// {label, build, wantFaces, wantKinds} — the canonical minimal analytic B-rep.
const PRIMS = [
  { label: 'cylinder(10,20)', build: (f) => f.makeCylinder(10, 20), n: 3, kinds: { cylinder: 1, plane: 2 } },
  { label: 'cone(10,5,20)',   build: (f) => f.makeCone(10, 5, 20),  n: 3, kinds: { cone: 1, plane: 2 } },
  { label: 'torus(20,5)',     build: (f) => f.makeTorus(20, 5),     n: 1, kinds: { torus: 1 } },
  { label: 'box(10,10,10)',   build: (f) => f.makeBox(10, 10, 10),  n: 6, kinds: { plane: 6 } },
  { label: 'sphere(10)',      build: (f) => f.makeSphere(10),       n: 1, kinds: { sphere: 1 } },
];

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  [FAIL] ' + msg); } };

for (const p of PRIMS) {
  // OCCT reference (must already be canonical) and NATIVE (the thing under test).
  k.setNativeBrep(false); const occt = census(p.build(k));
  k.setNativeBrep(true);  const nat  = census(p.build(k));
  ok(occt.n === p.n && kindsEqual(occt.kinds, p.kinds),
     `${p.label}: OCCT reference is canonical (got ${occt.n} ${JSON.stringify(occt.kinds)}, want ${p.n} ${JSON.stringify(p.kinds)})`);
  ok(nat.n === p.n && kindsEqual(nat.kinds, p.kinds),
     `${p.label}: NATIVE presents canonical analytic B-rep (got ${nat.n} ${JSON.stringify(nat.kinds)}, want ${p.n} ${JSON.stringify(p.kinds)} — 128-strip shatter?)`);
  ok(nat.n === occt.n && kindsEqual(nat.kinds, occt.kinds),
     `${p.label}: NATIVE == OCCT face census`);
}

// direct.faceCount agrees with the canonical inventory (direct-edit targeting).
k.setNativeBrep(true);
{
  const h = k.makeCylinder(10, 20);
  ok(k.direct.faceCount(h) === 3, `direct.faceCount(cylinder) == 3 (was 130 pre-G1)`);
}

// PAYOFF: a direct-edit op resolves to the analytic target and is volume-exact.
{
  const h = k.makeCylinder(10, 20);
  const top = k.faceInventory(h).filter((f) => f.kind === 'plane')
                .reduce((a, b) => (b.centroid[2] > a.centroid[2] ? b : a));
  const h2 = k.direct.pushPullFace(h, top.index, 5.0);
  const v = k.massProps(h2).volume, exp = Math.PI * 100 * 25;
  ok(Math.abs(v - exp) / exp < 1e-6, `pushPullFace(top,+5) volume ${v.toFixed(3)} == π·100·25 ${exp.toFixed(3)}`);
}

// STEP export→import preserves the canonical analytic faces (no re-shatter).
{
  const h = k.makeCylinder(10, 20);
  const p = require('os').tmpdir() + '/forge_g1_gate.step';
  k.io.exportStep(h, p);
  const c = census(k.io.importStep(p));
  ok(c.n === 3 && kindsEqual(c.kinds, { cylinder: 1, plane: 2 }),
     `STEP export→import native cylinder == 3 analytic faces (got ${c.n} ${JSON.stringify(c.kinds)})`);
}

console.log(`[g1] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
