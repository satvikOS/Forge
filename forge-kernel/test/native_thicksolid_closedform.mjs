// test/native_thicksolid_closedform.mjs
//
// CLOSED-FORM gate for the TKOffset family-G native thick-solid
// (src/native/brep/NativeThickSolid.cpp, reached through
// forge.part.shellNativeThick — an entry point that has NO OCCT fallback, so a
// pass here has necessarily measured native geometry).
//
// ===========================================================================
// WHY A CLOSED FORM AND NOT AN OCCT A/B
// ===========================================================================
// An A/B against BRepOffsetAPI_MakeThickSolid assumes OCCT is right. For SHELL
// it demonstrably is not: reports/TKOFFSET_DECOMPOSITION.md §4.2 measured OCCT
// returning the CAVITY instead of the WALL on a closed hollow box, with
// IsDone() == true, and the kernel's own native_vs_occt_features_gap1.mjs
// already refuses to use OCCT as the shell oracle. Case 2 below reproduces that
// silent lie on a cylinder — OCCT answers 1664*pi where the wall is 1336*pi —
// so an A/B would have RATIFIED a 24.6% error. Every reference below is derived
// from the geometry itself and depends on no kernel at all.
//
// ===========================================================================
// THE DERIVATIONS
// ===========================================================================
// Shell convention: retained faces move INWARD by t along their own outward
// normal, so the OUTER boundary is preserved and the cavity is inset by t; a
// removed face is a mouth, and the cavity is PINNED to that face's original
// plane (the wall ends flush with the opening, leaving a lip of width t).
//
// (1) CYLINDER, TOP REMOVED.  R = 10, H = 30, t = 2.
//     The lateral cylinder offsets coaxially 10 -> 8. The base plane z = 0
//     offsets to z = 2. The top plane z = 30 is the mouth, so the cavity is
//     pinned there and runs z in [2, 30], height 28:
//         V = pi*(10^2*30 - 8^2*28) = pi*(3000 - 1792) = 1208*pi
//
// (2) CYLINDER, CLOSED HOLLOW.  R = 10, H = 30, t = 2.
//     No mouth, so BOTH end planes move inward: cavity is z in [2, 28],
//     height 26:
//         V = pi*(10^2*30 - 8^2*26) = pi*(3000 - 1664) = 1336*pi
//     OCCT returns 1664*pi here (the cavity) while reporting success.
//
// (3) CONE FRUSTUM, TOP REMOVED.  R = 10 at z = 0, R = 2 at z = 8, t = 1.
//     In the meridian half-plane the lateral face is the line rho + z = 10
//     (rho falls 10 -> 2 while z rises 0 -> 8, so the slope is -1 and the
//     semi-angle is 45 degrees). Written with a UNIT normal that line is
//         (1,1)/sqrt(2) . (rho,z) = 10/sqrt(2),
//     so offsetting it inward by t = 1 subtracts 1 from the right-hand side:
//         rho + z = 10 - sqrt(2).
//     The base plane z = 0 offsets to z = 1; the top plane z = 8 is the mouth
//     and pins the cavity there. The cavity is therefore a frustum of height 7
//     with radii
//         r1 = (10 - sqrt2) - 1 = 9 - sqrt2 ,  r2 = (10 - sqrt2) - 8 = 2 - sqrt2
//     Using V_frustum = (pi*h/3)(r1^2 + r1*r2 + r2^2):
//         outer  = (pi*8/3)(100 + 20 + 4)          = 992*pi/3
//         cavity = (pi*7/3)(r1^2 + r1 r2 + r2^2)
//                  r1^2 = 83 - 18*sqrt2
//                  r1r2 = 20 - 11*sqrt2
//                  r2^2 =  6 -  4*sqrt2   =>  sum = 109 - 33*sqrt2
//         V = (pi/3)[992 - 7(109 - 33 sqrt2)] = (pi/3)(229 + 231*sqrt2)
//     NOTE the radial wall width at the rim is t*sqrt(2), not t — the wall is
//     uniform PERPENDICULAR to the cone, which is the whole point of the
//     offset. A naive "shrink every radius by t" would give a different number,
//     so this case is what separates a real surface offset from a fake one.
//
// (4) SPHERE, CLOSED HOLLOW.  R = 10, t = 2.
//     The offset of a sphere is a concentric sphere, R -> R - t = 8:
//         V = (4/3)*pi*(10^3 - 8^3) = (4/3)*pi*488 = 1952*pi/3
//
// (5) TORUS, CLOSED HOLLOW.  major R = 20, minor r = 5, t = 1.
//     The offset of a torus is a coaxial torus with the SAME major radius and
//     minor r -> r - t = 4. With V_torus = 2*pi^2*R*r^2:
//         V = 2*pi^2*20*(5^2 - 4^2) = 2*pi^2*20*9 = 360*pi^2
//
// (6) TUBE (cylinder with a coaxial through bore), CLOSED HOLLOW.
//     R_out = 10, R_bore = 4, H = 30, t = 1. The bore's outward normal points
//     AT the axis, so its inward offset GROWS it, 4 -> 5, while the outer skin
//     shrinks 10 -> 9. Both end faces are annuli (two wires each), which is the
//     multi-wire planar path. Cavity: annulus r in [5,9], z in [1,29]:
//         V = pi*[(10^2 - 4^2)*30 - (9^2 - 5^2)*28] = pi*(2520 - 1568) = 952*pi
//
// ===========================================================================
// The gate also asserts, per case, the EXACT SURFACE TYPE and radius of every
// cavity face. A tessellated/faceted cavity would show up as planes, and would
// also miss the volume by O(deflection^2) — both are hard failures here.
// ===========================================================================
//
// The primitives must be OCCT-backed for this entry point to be meaningful
// (native-backed handles never reach a TopoDS_Shape), so the harness re-execs
// itself with FORGE_NATIVE_BREP=0 if it is not already set.

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (process.env.FORGE_NATIVE_BREP !== '0') {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
    env: { ...process.env, FORGE_NATIVE_BREP: '0' },
  });
  process.exit(r.status === null ? 1 : r.status);
}

const require = createRequire(import.meta.url);
const KERNEL = path.join(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const f = require(KERNEL);

const PI = Math.PI;
const S2 = Math.SQRT2;

// Relative tolerance. These are exact analytic constructions, so anything
// beyond a few ULP of accumulated rounding is a real geometric error.
const TOL = 1e-12;

// ---------------------------------------------------------------- the cases
// `surfaces` lists EVERY face of the expected result as
// `kind[:radius[/minorRadius]]`, with '*' marking a cavity (concave) face.
const cases = [
  {
    name: 'cylinder R10 H30, t=2, top removed',
    build: () => f.makeCylinder(10, 30),
    remove: [2],
    t: 2.0,
    ref: 1208 * PI,
    refText: '1208*pi = pi*(10^2*30 - 8^2*28)',
    surfaces: ['cylinder:10', 'plane', 'plane', '*cylinder:8', '*plane'],
  },
  {
    name: 'cylinder R10 H30, t=2, CLOSED hollow',
    build: () => f.makeCylinder(10, 30),
    remove: [],
    t: 2.0,
    ref: 1336 * PI,
    refText: '1336*pi = pi*(10^2*30 - 8^2*26)',
    surfaces: ['cylinder:10', 'plane', 'plane', '*cylinder:8', '*plane', '*plane'],
    // OCCT's BRepOffsetAPI_MakeThickSolid answers the CAVITY here, IsDone()==true.
    occtSilentlyWrong: 1664 * PI,
  },
  {
    name: 'cone frustum R10->R2 H8, t=1, top removed',
    build: () => f.makeCone(10, 2, 8),
    remove: [2],
    t: 1.0,
    ref: (PI / 3) * (229 + 231 * S2),
    refText: '(pi/3)(229 + 231*sqrt2)',
    // the offset cone's reference radius is exactly 10 - sqrt(2)
    surfaces: ['cone:10', 'plane', 'plane', `*cone:${10 - S2}`, '*plane'],
  },
  {
    name: 'sphere R10, t=2, CLOSED hollow',
    build: () => f.makeSphere(10),
    remove: [],
    t: 2.0,
    ref: (4 / 3) * PI * 488,
    refText: '(4/3)*pi*(10^3 - 8^3)',
    surfaces: ['sphere:10', '*sphere:8'],
  },
  {
    name: 'torus R20 r5, t=1, CLOSED hollow',
    build: () => f.makeTorus(20, 5),
    remove: [],
    t: 1.0,
    ref: 360 * PI * PI,
    refText: '360*pi^2 = 2*pi^2*20*(5^2 - 4^2)',
    surfaces: ['torus:20/5', '*torus:20/4'],
  },
  {
    name: 'tube R10/bore4 H30, t=1, CLOSED hollow (multi-wire planar)',
    build: () => f.cut(f.makeCylinder(10, 30), f.makeCylinder(4, 30)),
    remove: [],
    t: 1.0,
    ref: 952 * PI,
    refText: '952*pi = pi*[(10^2-4^2)*30 - (9^2-5^2)*28]',
    surfaces: ['cylinder:10', 'plane', 'plane', '*cylinder:4', '*cylinder:9',
               '*plane', '*plane', 'cylinder:5'],
  },
];

// Shapes the engine MUST decline rather than answer wrongly (Law: no stubs — a
// plausible wrong shell is worse than an honest refusal).
const deferCases = [
  { name: 'box + cylindrical boss (mixed polygonal/quadric trim)',
    build: () => f.fuse(f.makeBox(20, 20, 5), f.makeCylinder(4, 10)), remove: [], t: 1.0 },
  { name: 'half cylinder (partial revolution in u)',
    build: () => f.common(f.makeCylinder(10, 30), f.makeBox(10, 20, 30, 0, -10, 0)),
    remove: [], t: 1.0 },
  { name: 'wall thicker than the radius (offset collapses)',
    build: () => f.makeCylinder(10, 30), remove: [2], t: 12.0 },
];

// ------------------------------------------------------------------ helpers
function surfaceSignature(h) {
  return f.faceInventory(h).map((x) => {
    let s = x.concave ? '*' : '';
    s += x.kind;
    if (x.kind === 'cylinder' || x.kind === 'cone' || x.kind === 'sphere') {
      s += ':' + x.radius;
    } else if (x.kind === 'torus') {
      s += ':' + x.radius + '/' + x.minorRadius;
    }
    return s;
  });
}

function sigMatches(got, want) {
  if (got.length !== want.length) return false;
  const norm = (s) => s.replace(/:([-\d.e+]+)/g, (_, n) => ':' + Number(n).toFixed(9))
                       .replace(/\/([-\d.e+]+)/g, (_, n) => '/' + Number(n).toFixed(9));
  const a = got.map(norm).slice().sort();
  const b = want.map(norm).slice().sort();
  return a.every((x, i) => x === b[i]);
}

// --------------------------------------------------------------------- run
let pass = 0, fail = 0;
console.log('\n[thicksolid] TKOffset family G — NATIVE thick-solid vs CLOSED FORM');
console.log(`[thicksolid] addon: ${KERNEL}`);
console.log(`[thicksolid] oracle: derived geometry (NOT OCCT) — rel tol ${TOL}\n`);

for (const c of cases) {
  let vol = NaN, sig = [], err = null;
  try {
    const h = f.part.shellNativeThick(c.build(), c.remove, c.t);
    vol = f.massProps(h).volume;
    sig = surfaceSignature(h);
  } catch (e) {
    err = e.message;
  }

  const rel = Math.abs(vol - c.ref) / Math.abs(c.ref);
  const volOk = Number.isFinite(vol) && rel <= TOL;
  const sigOk = sigMatches(sig, c.surfaces);
  const ok = !err && volOk && sigOk;

  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  console.log(`        ref ${c.refText} = ${c.ref.toFixed(9)}`);
  if (err) {
    console.log(`        THREW: ${err}`);
  } else {
    console.log(`        got                          = ${vol.toFixed(9)}   rel=${rel.toExponential(2)}`);
    console.log(`        surfaces ${sigOk ? 'exact' : 'MISMATCH'}: ${sig.join(' ')}`);
    if (!sigOk) console.log(`        expected              : ${c.surfaces.join(' ')}`);
    if (c.occtSilentlyWrong !== undefined) {
      console.log(`        (OCCT MakeThickSolid answers ${c.occtSilentlyWrong.toFixed(6)} here — ` +
                  `${(100 * Math.abs(c.occtSilentlyWrong - c.ref) / c.ref).toFixed(1)}% off, IsDone()==true)`);
    }
  }
  ok ? pass++ : fail++;
}

console.log('\n[thicksolid] HONEST DEFER — must refuse, never answer wrongly');
for (const d of deferCases) {
  let declined = false, vol = NaN;
  try {
    const h = f.part.shellNativeThick(d.build(), d.remove, d.t);
    vol = f.massProps(h).volume;
  } catch (e) {
    declined = /DECLINED/.test(e.message);
    if (!declined) vol = NaN;
  }
  console.log(`  ${declined ? 'PASS' : 'FAIL'}  declines: ${d.name}` +
              (declined ? '' : `  -> returned ${vol}`));
  declined ? pass++ : fail++;
}

console.log(`\n[thicksolid] ${pass} passed, ${fail} failed`);
if (fail === 0) console.log('[thicksolid] ===== ALL PASS =====\n');
process.exit(fail === 0 ? 0 : 1);
