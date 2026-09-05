// test/occt_pipe_sweep_ab.mjs — TKOffset family E A/B: OCCT BRepOffsetAPI_MakePipe
// vs the in-house analytic forge::occtPipePolyline.
//
// Needs BOTH implementations to compare, so it loads two binaries:
//   OCCT   build/Release/forge-kernel.node                 (FORGE_OFFSET_DROP_MAKEPIPE=OFF, the default)
//   NATIVE build-makepipe/forge-kernel.node                (FORGE_OFFSET_DROP_MAKEPIPE=ON)
// Override with FORGE_KERNEL_OCCT / FORGE_KERNEL_NATIVE.
//
// WHAT IT PROVES. MakePipe silently returns a solid that does not exist past the first
// bend of a C0 (polyline) spine while BRepCheck reports valid:true. The four independent
// witnesses per case are:
//   VOL   volume vs the closed form (exact for straight and for a 90-degree equal-radius
//         elbow: pi*r^2*L - 4r^3/3, the quarter-Steinmetz corner overlap)
//   INER  principal inertia must all be POSITIVE (a real solid cannot have Ixx < 0)
//   IN    a unit probe box on the centreline deep inside the LAST leg must intersect
//         the solid (boolean point-membership — the decisive witness)
//   ANLY  every face canonical analytic (plane/cylinder/cone/sphere/torus) — MakePipe
//         emits kind "other" for the corrupt legs, which BRepMesh then cannot mesh
//         ("no BRepMesh — unresolvable trim"). "other" here is a non-canonical swept
//         surface, NOT a B-spline (faceInventory reports those as "bspline").
//
// Exit non-zero only if the NATIVE side fails. The OCCT column is reported, not asserted:
// it is the baseline being replaced, and it is expected to fail.

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const OCCT_PATH   = process.env.FORGE_KERNEL_OCCT   || path.join(ROOT, 'build/Release/forge-kernel.node');
const NATIVE_PATH = process.env.FORGE_KERNEL_NATIVE || path.join(ROOT, 'build-makepipe/forge-kernel.node');

for (const [lbl, p] of [['OCCT', OCCT_PATH], ['NATIVE', NATIVE_PATH]]) {
  if (!existsSync(p)) {
    console.error(`[pipe-ab] MISSING ${lbl} binary: ${p}`);
    console.error(`[pipe-ab] build it with:  cmake -S . -B build-makepipe -DFORGE_OFFSET_DROP_MAKEPIPE=ON \\
      -DCMAKE_JS_INC=$HOME/.cmake-js/node-arm64/v26.0.0/include/node -DNODE_RUNTIME=node -DNODE_RUNTIMEVERSION=26.0.0`);
    process.exit(2);
  }
}

const K = { OCCT: require(OCCT_PATH), NATIVE: require(NATIVE_PATH) };

const ANALYTIC = new Set(['plane', 'cylinder', 'cone', 'sphere', 'torus']);
const PI = Math.PI;

// ---------------------------------------------------------------- measurement
function measure(f, build) {
  const out = { ok: false };
  try {
    const h = build(f);
    const mp = f.massProps(h);
    out.vol = mp.volume;
    out.inertia = [mp.inertiaCom[0], mp.inertiaCom[4], mp.inertiaCom[8]];
    out.posInertia = out.inertia.every((x) => x > 0);
    const fi = f.faceInventory(h);
    out.kinds = {};
    for (const fc of fi) out.kinds[fc.kind] = (out.kinds[fc.kind] || 0) + 1;
    out.analytic = fi.every((fc) => ANALYTIC.has(fc.kind));
    out.handle = h;
    out.f = f;
    out.ok = true;
  } catch (e) {
    out.err = String(e.message || e).slice(0, 110);
  }
  return out;
}

// Boolean point-membership: does a `s`-sided box centred at p meet the solid?
function inside(m, p, s = 1.0) {
  if (!m.ok) return false;
  try {
    const f = m.f;
    const b = f.translate(f.makeBox(s, s, s), p[0] - s / 2, p[1] - s / 2, p[2] - s / 2);
    return Math.abs(f.massProps(f.common(m.handle, b)).volume) > 1e-9;
  } catch { return false; }
}

// ---------------------------------------------------------------- cases
const R = 2;
const A = PI * R * R;
const STEIN90 = (4 * R * R * R) / 3;   // quarter-Steinmetz overlap of two perpendicular legs

const cases = [
  { name: 'pipe 1 seg straight L=10',
    build: (f) => f.part.pipeFromPolyline([0, 0, 0, 10, 0, 0], R),
    exact: A * 10, probe: [5, 0, 0] },

  { name: 'pipe collinear 3 pts L=20',
    build: (f) => f.part.pipeFromPolyline([0, 0, 0, 10, 0, 0, 20, 0, 0], R),
    exact: A * 20, probe: [15, 0, 0] },

  { name: 'pipe 90deg elbow 10+10',
    build: (f) => f.part.pipeFromPolyline([0, 0, 0, 10, 0, 0, 10, 10, 0], R),
    exact: A * 20 - STEIN90, probe: [10, 8, 0] },

  { name: 'pipe 90deg elbow 10+40',
    build: (f) => f.part.pipeFromPolyline([0, 0, 0, 10, 0, 0, 10, 40, 0], R),
    exact: A * 50 - STEIN90, probe: [10, 35, 0] },

  { name: 'pipe 3 seg 3D (10+10+10)',
    build: (f) => f.part.pipeFromPolyline([0, 0, 0, 10, 0, 0, 10, 10, 0, 10, 10, 10], R),
    exact: A * 30 - 2 * STEIN90, probe: [10, 10, 8] },

  { name: 'pipe 45deg bend',
    build: (f) => f.part.pipeFromPolyline([0, 0, 0, 10, 0, 0, 20, 10, 0], R),
    exact: null, probe: [18, 8, 0] },   // no simple closed form; membership + inertia only

  { name: 'duct rect profile, L path',
    build: (f) => f.part.sweepPolyline([10, 6, -10, 6, -10, -6, 10, -6],
                                       [0, 0, 0, 0, 0, 50, 40, 0, 80]),
    exact: null, probe: [35, 0, 80] },
];

// ---------------------------------------------------------------- run
console.log('[pipe-ab] OCCT   =', OCCT_PATH);
console.log('[pipe-ab] NATIVE =', NATIVE_PATH);
console.log('');
console.log('  case                             build    volume     ratio  INER   IN   ANLY  faces');
console.log('  ' + '-'.repeat(94));

let nativeFail = 0;
const rows = [];

for (const c of cases) {
  const r = {};
  for (const lbl of ['OCCT', 'NATIVE']) {
    const m = measure(K[lbl], c.build);
    m.in = inside(m, c.probe);
    r[lbl] = m;
    const ratio = m.ok && c.exact ? m.vol / c.exact : null;
    console.log(
      '  ' + (lbl === 'OCCT' ? c.name : '').padEnd(32) +
      lbl.padEnd(9) +
      (m.ok ? m.vol.toFixed(3).padStart(9) : '    THROW') +
      (ratio === null ? '      —  ' : ratio.toFixed(4).padStart(9) + ' ') +
      (m.ok ? (m.posInertia ? '  ok ' : ' NEG ') : '  -  ') +
      (m.in ? '  ok ' : ' MISS') +
      (m.ok ? (m.analytic ? '  ok  ' : ' SPLN ') : '  -   ') +
      (m.ok ? JSON.stringify(m.kinds) : m.err));
  }
  rows.push({ c, r });

  // ---- assertions: NATIVE only ----
  const n = r.NATIVE;
  const fails = [];
  if (!n.ok) fails.push(`threw: ${n.err}`);
  else {
    if (c.exact !== null && Math.abs(n.vol - c.exact) / c.exact > 1e-6)
      fails.push(`volume ${n.vol.toFixed(4)} != closed form ${c.exact.toFixed(4)}`);
    if (!n.posInertia) fails.push(`negative principal inertia ${n.inertia.map((x) => x.toFixed(1))}`);
    if (!n.in) fails.push(`probe point ${JSON.stringify(c.probe)} is NOT inside the solid`);
    if (!n.analytic) fails.push(`non-analytic face(s) present: ${JSON.stringify(n.kinds)}`);
  }
  if (fails.length) { nativeFail++; for (const m of fails) console.log(`      NATIVE FAIL: ${m}`); }
  console.log('');
}

// ---------------------------------------------------------------- summary
let occtBad = 0;
for (const { r } of rows) {
  const m = r.OCCT;
  if (!m.ok || !m.posInertia || !m.in || !m.analytic) occtBad++;
}
console.log('  ' + '-'.repeat(94));
console.log(`  OCCT   MakePipe : ${occtBad}/${rows.length} cases corrupt (wrong volume / negative inertia / hollow leg / non-canonical face)`);
console.log(`  NATIVE occtPipePolyline : ${nativeFail}/${rows.length} cases failing`);
console.log('');
console.log('  NOTE: OCCT_CLOSURE is 14 in BOTH builds. Family E removes 3 of TKOffset\'s 38');
console.log('        symbols (38 -> 35). It is blocking-set reduction, NOT a drop.');

if (nativeFail) { console.log('\n===== FAIL ====='); process.exit(1); }
console.log('\n===== ALL PASS =====');
