// native_thicken_closedform.mjs — TKOffset family I gate.
//
// Drives forge::occtoffset::thickenShell (src/native/brep/NativeThickenShell.cpp)
// through forge.part.thickenSurfaceNative, which has NO OCCT FALLBACK. A shape
// the native engine declines THROWS, so a case that passes has necessarily
// measured NATIVE geometry — it cannot have been served a silently-substituted
// BRepOffset_MakeOffset answer.
//
// EVERY expectation is a CLOSED FORM, derived here:
//
//   prismatic slab of base area A swept by wall thickness t
//       volume  = A * t
//       area    = 2 * A + perimeter * t
//       centre  = base centroid, offset t/2 along the sweep direction
//
// Not one number in this file was captured from a previous kernel run or from
// OCCT. Where OCCT is mentioned at all (case X1) it is a CROSS-CHECK reported
// alongside the closed form, never the acceptance criterion.
//
// usage: node test/native_thicken_closedform.mjs [path/to/forge-kernel.node]

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const KERNEL = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

let pass = 0, fail = 0;
const ok  = (n, msg) => { pass++; console.log(`[PASS] ${n.padEnd(46)} ${msg}`); };
const bad = (n, msg) => { fail++; console.log(`[FAIL] ${n.padEnd(46)} ${msg}`); };

function rel(got, want) {
  return Math.abs(got - want) / Math.max(1, Math.abs(want));
}

// A flat rectangular patch on z = 0, corners (x0,y0)-(x1,y1). buildPatch emits a
// Geom_BSplineSurface even for a 2x2 grid — that is the point: the engine has to
// recognise flatness GEOMETRICALLY, not by surface type.
function flatPatch(x0, y0, x1, y1, z = 0) {
  const xyz = new Float64Array([
    x0, y0, z,   x1, y0, z,
    x0, y1, z,   x1, y1, z,
  ]);
  return forge.surfacing.buildPatch({ uCount: 2, vCount: 2, xyz }, 1, 1);
}

// ---------------------------------------------------------------- slab cases
// name, base area A, perimeter P, thickness t, side, expected CoM
function slabCase(name, handle, A, P, t, side, com) {
  let h;
  try {
    h = forge.part.thickenSurfaceNative(handle, t, side);
  } catch (e) {
    bad(name, `native DECLINED: ${String(e.message || e).slice(0, 190)}`);
    return null;
  }
  const mp = forge.massProps(h);
  const V = Math.abs(mp.volume);
  const wantV = A * t;
  const wantArea = 2 * A + P * t;
  const rv = rel(V, wantV);
  const ra = rel(mp.area, wantArea);
  const rc = Math.max(
    Math.abs(mp.centerOfMass[0] - com[0]),
    Math.abs(mp.centerOfMass[1] - com[1]),
    Math.abs(mp.centerOfMass[2] - com[2]));
  if (rv < 1e-9 && ra < 1e-9 && rc < 1e-6) {
    ok(name, `V ${V.toFixed(6)} vs A*t ${wantV.toFixed(6)}  relV ${rv.toExponential(1)} relA ${ra.toExponential(1)} dCoM ${rc.toExponential(1)}`);
  } else {
    bad(name, `V ${V} (want ${wantV}, rel ${rv.toExponential(2)}) area ${mp.area} (want ${wantArea}, rel ${ra.toExponential(2)}) CoM ${JSON.stringify(mp.centerOfMass)} (want ${JSON.stringify(com)})`);
  }
  return h;
}

// `accept` defaults to the engine's own defer marker. A case whose input is
// rejected by an ARGUMENT guard before the engine is reached passes its own
// marker instead, so the test still proves WHICH guard fired.
function refusalCase(name, fn, what, accept = 'DECLINED') {
  try {
    fn();
    bad(name, `accepted ${what} — the engine must DEFER, not guess`);
  } catch (e) {
    const m = String(e.message || e);
    if (m.includes(accept)) ok(name, `refused ${what}`);
    else bad(name, `threw the WRONG error for ${what}: ${m.slice(0, 160)}`);
  }
}

console.log(`kernel = ${KERNEL}\n`);

// ---- 1. the shipped smoke geometry, asserted natively ----------------------
// 100 x 60 patch, t = 5, +side.  A = 6000, P = 320.
slabCase('single flat patch, +side',
  flatPatch(0, 0, 100, 60), 6000, 320, 5, +1, [50, 30, 2.5]);

// ---- 2. sign of `side` is the sweep direction ------------------------------
slabCase('single flat patch, -side',
  flatPatch(0, 0, 100, 60), 6000, 320, 5, -1, [50, 30, -2.5]);

// ---- 3. non-round numbers: no lucky cancellation ---------------------------
// 37.5 x 12.25, t = 0.8.  A = 459.375, P = 99.5.
slabCase('non-integer rectangle 37.5 x 12.25 x 0.8',
  flatPatch(0, 0, 37.5, 12.25), 459.375, 99.5, 0.8, +1, [18.75, 6.125, 0.4]);

// ---- 4. KNIT: an interior seam is NOT a boundary ---------------------------
// Two patches sharing x = 100 thicken as ONE 200 x 60 slab. If the seam were
// treated as a free edge the engine would build two slabs (or defer), so this
// case is the free-edge classifier's real test, not a duplicate of case 1.
{
  const a = flatPatch(0, 0, 100, 60);
  const b = flatPatch(100, 0, 200, 60);
  const shell = forge.surfacing.sew([a, b], 1e-3);
  slabCase('knit 2 patches -> one 200 x 60 slab',
    shell, 12000, 520, 4, +1, [100, 30, 2]);
}

// ---- 5. RE-ENTRANT boundary: an L, i.e. a concave corner -------------------
// A = [0,60]x[0,60] + [60,120]x[0,60] + [0,60]x[60,120]
//   = 3 * 3600 = 10800 ;  perimeter 120+60+60+60+60+120 = 480
// centroid: (7200*(60,30) + 3600*(30,90)) / 10800 = (50, 50)
{
  const a = flatPatch(0, 0, 60, 60);
  const b = flatPatch(60, 0, 120, 60);
  const c = flatPatch(0, 60, 60, 120);
  const shell = forge.surfacing.sew([a, b, c], 1e-3);
  slabCase('knit 3 patches -> L-shaped slab (concave corner)',
    shell, 10800, 480, 2, +1, [50, 50, 1]);
}

// ---- 6. SCALE: the same construction 50x larger ----------------------------
// 5000 x 3000, t = 12.  A = 1.5e7, P = 16000.  Volume 1.8e8 mm^3.
slabCase('5000 x 3000 x 12 (scale invariance)',
  flatPatch(0, 0, 5000, 3000), 15e6, 16000, 12, +1, [2500, 1500, 6]);

// ---- 7. SCALE the other way: a 2 x 1.5 mm shim -----------------------------
slabCase('2 x 1.5 x 0.25 shim (small scale)',
  flatPatch(0, 0, 2, 1.5), 3, 7, 0.25, +1, [1, 0.75, 0.125]);

// ---- 8. OFF-ORIGIN + non-zero z: no hidden origin assumption ---------------
slabCase('off-origin patch at z = -17.5',
  flatPatch(-40, 12, 20, 33, -17.5), 60 * 21, 2 * (60 + 21), 3, +1,
  [-10, 22.5, -16]);

// =========================== REFUSALS =======================================
// A defer must be a THROW on this entry point. An engine that quietly returns
// something for input it cannot handle is the failure mode this whole gate
// exists to catch.

refusalCase('refuses a NON-COPLANAR (bent) shell', () => {
  // two patches meeting at x = 100 at a right angle
  const a = flatPatch(0, 0, 100, 60);
  const vertical = new Float64Array([
    100, 0, 0,   100, 0, 50,
    100, 60, 0,  100, 60, 50,
  ]);
  const b = forge.surfacing.buildPatch({ uCount: 2, vCount: 2, xyz: vertical }, 1, 1);
  const shell = forge.surfacing.sew([a, b], 1e-3);
  forge.part.thickenSurfaceNative(shell, 3, +1);
}, 'a 90-degree bent shell');

refusalCase('refuses a CURVED patch', () => {
  // 3x3 grid with the centre control point lifted -> genuinely non-planar
  const xyz = new Float64Array([
    0, 0, 0,    50, 0, 0,    100, 0, 0,
    0, 30, 0,   50, 30, 25,  100, 30, 0,
    0, 60, 0,   50, 60, 0,   100, 60, 0,
  ]);
  const p = forge.surfacing.buildPatch({ uCount: 3, vCount: 3, xyz }, 2, 2);
  forge.part.thickenSurfaceNative(p, 4, +1);
}, 'a bulged NURBS patch');

refusalCase('refuses a CLOSED SOLID', () => {
  const box = forge.makeBox(20, 30, 40);
  forge.part.thickenSurfaceNative(box, 2, +1);
}, 'a closed solid (that op is `shell`)');

// A thickness below Precision::Confusion never reaches the engine — the shared
// argument guard rejects it. Asserted separately so the two are not confused.
refusalCase('refuses a zero thickness (argument guard)', () => {
  forge.part.thickenSurfaceNative(flatPatch(0, 0, 100, 60), 1e-12, +1);
}, 'a zero thickness', 'must be non-zero');

// This one DOES reach the engine: 1e-6 passes the argument guard but is below
// the engine's own geometric tolerance (1e-4), so the engine must defer rather
// than build a slab thinner than the tolerance it sews with.
refusalCase('refuses a sub-tolerance sweep (engine guard)', () => {
  forge.part.thickenSurfaceNative(flatPatch(0, 0, 100, 60), 1e-6, +1);
}, 'a sweep below the sew tolerance');

// =========================== CROSS-CHECK ====================================
// NOT an acceptance criterion — the closed form above already decided every
// case. This only records whether OCCT agrees, so a future divergence is
// visible rather than silent.
{
  const p1 = flatPatch(0, 0, 100, 60);
  const p2 = flatPatch(0, 0, 100, 60);
  let occtV = NaN, natV = NaN;
  try { occtV = Math.abs(forge.massProps(forge.part.thickenSurface(p1, 5, +1)).volume); } catch (e) { /* record only */ }
  try { natV  = Math.abs(forge.massProps(forge.part.thickenSurfaceNative(p2, 5, +1)).volume); } catch (e) { /* record only */ }
  console.log(`\n[xcheck] OCCT thickenSurface volume = ${occtV}   native = ${natV}   closed form = 30000`);
}

console.log(`\n[thicken-native] ${pass} passed, ${fail} failed`);
if (fail === 0) console.log('===== ALL PASS =====');
process.exit(fail === 0 ? 0 : 1);
