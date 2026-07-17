// Native analytic face-inventory gate (KERNEL_PARITY_PLAN G1 — analytic-face
// identity WITHOUT OCCT). Asserts forge.nativeFaceInventory (which groups the
// native Solid's strip faces by shared Surface) reports the SAME canonical
// analytic faces as OCCT's faceInventory — count AND kind histogram — for every
// canonical primitive. This is the native replacement for the OCCT face query;
// it needs no TopoDS bridge and changes no topology.
//
// Run: FORGE_KERNEL=/abs/build/Release/forge-kernel.node node test/native_analytic_face_inventory.mjs
import { createRequire } from 'module';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const KERNEL = process.env.FORGE_KERNEL ||
  path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const k = require(KERNEL);

const hist = (inv) => {
  const h = {};
  for (const f of inv) h[f.kind] = (h[f.kind] || 0) + 1;
  return h;
};
const eqHist = (a, b) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((x) => a[x] === b[x]);
};

// {label, build, wantN, wantKinds}
const CASES = [
  { label: 'cylinder(10,20)', build: () => k.makeCylinder(10, 20), n: 3, kinds: { cylinder: 1, plane: 2 } },
  { label: 'cone(10,5,20)',   build: () => k.makeCone(10, 5, 20),  n: 3, kinds: { cone: 1, plane: 2 } },
  { label: 'sphere(10)',      build: () => k.makeSphere(10),       n: 1, kinds: { sphere: 1 } },
  { label: 'torus(20,5)',     build: () => k.makeTorus(20, 5),     n: 1, kinds: { torus: 1 } },
  { label: 'box(10,10,10)',   build: () => k.makeBox(10, 10, 10),  n: 6, kinds: { plane: 6 } },
];

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  [FAIL] ' + m); } };

// OCCT reference (the oracle) — must already be canonical.
k.setNativeBrep(false);
const occtRef = CASES.map((c) => { const inv = k.faceInventory(c.build()); return { n: inv.length, kinds: hist(inv) }; });

// Native — the thing under test.
k.setNativeBrep(true);
for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i];
  const nat = k.nativeFaceInventory(c.build());
  const nh = hist(nat);
  ok(occtRef[i].n === c.n && eqHist(occtRef[i].kinds, c.kinds),
     `${c.label}: OCCT oracle canonical (got ${occtRef[i].n} ${JSON.stringify(occtRef[i].kinds)})`);
  ok(nat.length === c.n && eqHist(nh, c.kinds),
     `${c.label}: native faceInventory canonical (got ${nat.length} ${JSON.stringify(nh)}, want ${c.n} ${JSON.stringify(c.kinds)})`);
  ok(nat.length === occtRef[i].n && eqHist(nh, occtRef[i].kinds),
     `${c.label}: native == OCCT face identity`);
  // Every logical face must actually merge >=1 strip and carry the surface geometry.
  const strips = nat.reduce((s, f) => s + (f.stripFaceCount || 0), 0);
  ok(strips >= nat.length, `${c.label}: strip faces merged (${strips} strips -> ${nat.length} faces)`);

  // Total surface area must match OCCT (exact for planar, chordal <=0.5% for curved).
  k.setNativeBrep(false);
  const occtArea = k.faceInventory(c.build()).reduce((s, f) => s + (f.area || 0), 0);
  k.setNativeBrep(true);
  const natArea = nat.reduce((s, f) => s + (f.area || 0), 0);
  const tol = c.kinds.plane === c.n ? 1e-6 : 5e-3;  // planar exact, curved chordal
  ok(Math.abs(natArea - occtArea) <= tol * Math.max(occtArea, 1),
     `${c.label}: native area ${natArea.toFixed(3)} ~= OCCT ${occtArea.toFixed(3)} (rel<=${tol})`);
  // Every face carries a finite centroid.
  ok(nat.every((f) => Array.isArray(f.centroid) && f.centroid.every(Number.isFinite)),
     `${c.label}: every face has a finite centroid`);
}

console.log(`[native-face-inv] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
