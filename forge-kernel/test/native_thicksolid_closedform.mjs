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
// WHAT THE ORACLE ASSERTS, AND WHY IT IS NOT JUST VOLUME
// ===========================================================================
// Volume plus a surface-type census is NOT a shape oracle. MEASURED here on
// case 1 (see the NEGATIVE CONTROLS at the bottom of this file): the correct
// shell and an UPSIDE-DOWN shell of the same cylinder — cavity pinned to
// z in [0,28] instead of [2,30], i.e. the wall built at the wrong end — agree
// on EVERY one of
//     volume            3795.043925536  (identical to the last printed digit)
//     surface area      3920.707631680
//     face count        5      edge count   6
//     wire count        6      vertex count 4      shell count 1
//     surface signature cylinder:10 plane plane *cylinder:8 *plane
//     validity          closed, manifold, oriented, no self-intersection
// and differ ONLY in POSITION: centre of mass z = 13.516556 against 16.483444,
// and the (area, height) pairing of the two end faces — the 100*pi disk sits at
// z=0 and the 36*pi lip at z=30 in the right answer, and the other way round in
// the wrong one. A gate that stops at volume and surface types RATIFIES that
// shape. So this one asserts, per case:
//
//   * VOLUME        closed-form, rel tol 1e-12 (as before);
//   * AREA          closed-form total surface area — an independent integral
//                   that a wrong wall thickness moves even when volume does not;
//   * CENTROID      closed-form centre of mass, all three components — the term
//                   that separates a shell from its own mirror image;
//   * TOPOLOGY      the COMPLETE sub-shape census (solids, shells, faces, wires,
//                   edges, vertices) via forge.direct.topoCounts. The SHELL term
//                   is the one a sew gets wrong: a closed hollow is 1 solid /
//                   2 shells (outer + reversed inner), an open one is 1 solid /
//                   1 shell because the lip joins them;
//   * PER-FACE      every face's surface type AND radius (as before) AND its
//                   exact area, its axial centroid, and its outward-normal /
//                   axis z-component — so each face is pinned to a PLACE, not
//                   just counted. This is what rejects the mirror;
//   * VALIDITY      forge.heal.checkValidity (closed, manifold, oriented, no
//                   self-intersection, no non-manifold edge, no bad face or
//                   edge) and forge.shapecheck.analyse (BRepCheck clean).
//
// A tessellated/faceted cavity would show up as planes, would miss the volume
// by O(deflection^2), and would blow the face/edge/vertex census apart — all
// three are hard failures here.
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
// beyond a few ULP of accumulated rounding is a real geometric error. MEASURED
// worst deviation across every reference below (volume, area, all three
// centroid components, every face area and height): 5.9e-16, four orders inside
// this bound.
const TOL = 1e-12;

// |got - want| <= TOL * max(1, |want|). The max(1, .) floor is what lets the
// SAME predicate check a centroid component whose reference is exactly 0
// without silently accepting anything; for every |want| > 1 it is identical to
// a plain relative tolerance.
function nearly(got, want) {
  return Number.isFinite(got) && Math.abs(got - want) <= TOL * Math.max(1, Math.abs(want));
}

// A frustum of revolution: base radius R1 at z0, top radius R2 at z0 + h.
//   V              = (pi*h/3)(R1^2 + R1*R2 + R2^2)
//   zbar           = z0 + (h/4)(R1^2 + 2*R1*R2 + 3*R2^2)/(R1^2 + R1*R2 + R2^2)
//   lateral area   = pi*(R1 + R2)*slant,  slant = hypot(R2 - R1, h)
//   lateral zbar   = z0 + h*(R1 + 2*R2)/(3*(R1 + R2))
// Standard solid-of-revolution results, used only for case 3, where the cavity
// is the frustum bounded by the OFFSET line rho + z = 10 - sqrt(2) derived
// above. Written as formulas, not as numbers copied out of a run.
function frustum(R1, R2, h, z0) {
  const s2 = R1 * R1 + R1 * R2 + R2 * R2;
  const V = (PI * h / 3) * s2;
  const zbar = z0 + (h / 4) * (R1 * R1 + 2 * R1 * R2 + 3 * R2 * R2) / s2;
  const slant = Math.hypot(R2 - R1, h);
  return {
    V,
    Mz: V * zbar,
    lateralArea: PI * (R1 + R2) * slant,
    lateralCz: z0 + h * (R1 + 2 * R2) / (3 * (R1 + R2)),
  };
}

// Case 3's two frusta, in the derivation's own terms.
const CONE_OUTER = frustum(10, 2, 8, 0);            // the original solid
const CONE_CAVITY = frustum(9 - S2, 2 - S2, 7, 1);  // inset by t=1 NORMAL to the cone
const CONE_V = CONE_OUTER.V - CONE_CAVITY.V;
const CONE_CZ = (CONE_OUTER.Mz - CONE_CAVITY.Mz) / CONE_V;

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
    refArea: 1248 * PI,
    areaText: '1248*pi = pi*(600 + 100 + 36 + 448 + 64)',
    // outer moment pi*100*30*15 minus cavity moment pi*64*28*(2 + 28/2)
    refCom: [0, 0, (3000 * 15 - 1792 * 16) / 1208],
    comText: 'z = (3000*15 - 1792*16)/1208',
    topo: { solids: 1, shells: 1, faces: 5, wires: 6, edges: 6, vertices: 4 },
    topoText: 'ONE shell — the lip joins wall to cavity; 4 circles + 2 cylinder seams = 6 edges; ' +
              '6 wires (the lip annulus carries 2); the 2 seams contribute 4 vertices',
    faceGeom: [
      { s: 'cylinder:10', area: 600 * PI, cz: 15, nz: 1 },   // outer skin
      { s: 'plane',       area: 100 * PI, cz: 0,  nz: -1 },  // base disk R10
      { s: 'plane',       area: 36 * PI,  cz: 30, nz: 1 },   // lip annulus R8..R10
      { s: '*cylinder:8', area: 448 * PI, cz: 16, nz: 1 },   // cavity wall z in [2,30]
      { s: '*plane',      area: 64 * PI,  cz: 2,  nz: 1 },   // cavity floor disk R8
    ],
  },
  {
    name: 'cylinder R10 H30, t=2, CLOSED hollow',
    build: () => f.makeCylinder(10, 30),
    remove: [],
    t: 2.0,
    ref: 1336 * PI,
    refText: '1336*pi = pi*(10^2*30 - 8^2*26)',
    surfaces: ['cylinder:10', 'plane', 'plane', '*cylinder:8', '*plane', '*plane'],
    refArea: 1344 * PI,
    areaText: '1344*pi = pi*(600 + 100 + 100 + 416 + 64 + 64)',
    refCom: [0, 0, 15],           // both ends move inward by t, so the solid is symmetric
    comText: 'z = 15 exactly, by the mirror symmetry a mouthless shell must have',
    topo: { solids: 1, shells: 2, faces: 6, wires: 6, edges: 6, vertices: 4 },
    topoText: 'TWO shells — outer + reversed inner, with no lip to join them; ' +
              '4 circles + 2 cylinder seams = 6 edges; one wire per face; 4 seam vertices',
    faceGeom: [
      { s: 'cylinder:10', area: 600 * PI, cz: 15, nz: 1 },
      { s: 'plane',       area: 100 * PI, cz: 0,  nz: -1 },
      { s: 'plane',       area: 100 * PI, cz: 30, nz: 1 },
      { s: '*cylinder:8', area: 416 * PI, cz: 15, nz: 1 },   // cavity wall z in [2,28]
      { s: '*plane',      area: 64 * PI,  cz: 2,  nz: 1 },   // cavity floor
      { s: '*plane',      area: 64 * PI,  cz: 28, nz: -1 },  // cavity ceiling
    ],
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
    // pi*[159*sqrt2 + 153]: outer lateral 96*sqrt2, base 100, lip (4*sqrt2 - 2),
    // cavity lateral (77*sqrt2 - 28), cavity floor (83 - 18*sqrt2).
    refArea: PI * (159 * S2 + 153),
    areaText: 'pi*(159*sqrt2 + 153)',
    refCom: [0, 0, CONE_CZ],
    comText: 'z = (M_outer - M_cavity)/V from the frustum first-moment formula',
    topo: { solids: 1, shells: 1, faces: 5, wires: 6, edges: 6, vertices: 4 },
    topoText: 'same B-rep shape as case 1 — one shell through the lip, ' +
              '4 circles + 2 cone seams, 6 wires, 4 seam vertices',
    faceGeom: [
      { s: 'cone:10',            area: CONE_OUTER.lateralArea,  cz: CONE_OUTER.lateralCz,  nz: 1 },
      { s: 'plane',              area: 100 * PI,                cz: 0,                     nz: -1 },
      // lip: the mouth disk R2 with the pinned cavity rim (2 - sqrt2) punched out
      { s: 'plane',              area: PI * (4 * S2 - 2),       cz: 8,                     nz: 1 },
      { s: `*cone:${10 - S2}`,   area: CONE_CAVITY.lateralArea, cz: CONE_CAVITY.lateralCz, nz: 1 },
      // cavity floor: disk of radius (10 - sqrt2) - 1 = 9 - sqrt2 at z = 1
      { s: '*plane',             area: PI * (83 - 18 * S2),     cz: 1,                     nz: 1 },
    ],
  },
  {
    name: 'sphere R10, t=2, CLOSED hollow',
    build: () => f.makeSphere(10),
    remove: [],
    t: 2.0,
    ref: (4 / 3) * PI * 488,
    refText: '(4/3)*pi*(10^3 - 8^3)',
    surfaces: ['sphere:10', '*sphere:8'],
    refArea: 656 * PI,
    areaText: '656*pi = 4*pi*(10^2 + 8^2)',
    refCom: [0, 0, 0],
    comText: 'the origin, by the full spherical symmetry of two concentric spheres',
    topo: { solids: 1, shells: 2, faces: 2, wires: 2, edges: 6, vertices: 4 },
    topoText: 'TWO shells (no mouth); each full sphere face is 1 wire of 1 seam meridian + ' +
              '2 degenerate polar edges = 3 edges and 2 pole vertices',
    faceGeom: [
      { s: 'sphere:10', area: 400 * PI, cz: 0, nz: 0 },
      { s: '*sphere:8', area: 256 * PI, cz: 0, nz: 0 },
    ],
  },
  {
    name: 'torus R20 r5, t=1, CLOSED hollow',
    build: () => f.makeTorus(20, 5),
    remove: [],
    t: 1.0,
    ref: 360 * PI * PI,
    refText: '360*pi^2 = 2*pi^2*20*(5^2 - 4^2)',
    surfaces: ['torus:20/5', '*torus:20/4'],
    refArea: 720 * PI * PI,
    areaText: '720*pi^2 = 4*pi^2*20*(5 + 4)',
    refCom: [0, 0, 0],
    comText: 'the origin, by the coaxial symmetry of two tori sharing a major radius',
    topo: { solids: 1, shells: 2, faces: 2, wires: 2, edges: 4, vertices: 2 },
    topoText: 'TWO shells; each full torus face is 1 wire of 2 seams (u and v) meeting ' +
              'at a single vertex',
    faceGeom: [
      { s: 'torus:20/5',  area: 4 * PI * PI * 20 * 5, cz: 0, nz: 1 },
      { s: '*torus:20/4', area: 4 * PI * PI * 20 * 4, cz: 0, nz: 1 },
    ],
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
    refArea: 1904 * PI,
    areaText: '1904*pi = pi*(600 + 84 + 84 + 240 + 504 + 56 + 56 + 280)',
    refCom: [0, 0, 15],           // mouthless, so symmetric about the mid-height
    comText: 'z = 15 exactly, by the mirror symmetry a mouthless shell must have',
    topo: { solids: 1, shells: 2, faces: 8, wires: 12, edges: 12, vertices: 8 },
    topoText: 'TWO shells; 8 circles + 4 cylinder seams = 12 edges; 12 wires ' +
              '(each of the 4 annuli carries 2); 4 seams contribute 8 vertices',
    faceGeom: [
      { s: 'cylinder:10', area: 600 * PI, cz: 15, nz: 1 },   // outer skin
      { s: 'plane',       area: 84 * PI,  cz: 0,  nz: -1 },  // bottom annulus R4..R10
      { s: 'plane',       area: 84 * PI,  cz: 30, nz: 1 },   // top annulus R4..R10
      { s: '*cylinder:4', area: 240 * PI, cz: 15, nz: 1 },   // the retained bore
      { s: '*cylinder:9', area: 504 * PI, cz: 15, nz: 1 },   // cavity outer wall
      { s: '*plane',      area: 56 * PI,  cz: 1,  nz: 1 },   // cavity floor annulus R5..R9
      { s: '*plane',      area: 56 * PI,  cz: 29, nz: -1 },  // cavity ceiling annulus
      { s: 'cylinder:5',  area: 280 * PI, cz: 15, nz: 1 },   // bore wall grown 4 -> 5
    ],
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

// ---------------------------------------------------------- negative controls
// Wrong solids of the RIGHT volume, built WITHOUT the engine under test, that a
// volume+surface-type oracle accepts. See the run section at the bottom.
const negativeControls = [
  {
    name: 'UPSIDE-DOWN case-1 shell (the wall built at the wrong end)',
    of: 0,
    build: () => f.cut(f.makeCylinder(10, 30), f.makeCylinder(8, 28)),
    why: 'cavity z in [0,28] instead of [2,30]: same 1208*pi, same 1248*pi of area, ' +
         'same 5 faces / 6 edges / 6 wires / 4 vertices / 1 shell, same signature — ' +
         'the 100*pi disk and the 36*pi lip have simply swapped ends',
  },
  {
    name: 'case-1 shell TRANSLATED +5 in z (right shape, wrong place)',
    of: 0,
    build: () => f.translate(f.part.shellNativeThick(f.makeCylinder(10, 30), [2], 2.0), 0, 0, 5),
    why: 'every intrinsic measurement is identical because it IS the right shape; ' +
         'only its absolute position is wrong, which is exactly what a shell op that ' +
         'pins the cavity to the wrong plane produces',
  },
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
  const a = got.map(normSig).slice().sort();
  const b = want.map(normSig).slice().sort();
  return a.every((x, i) => x === b[i]);
}

function normSig(x) {
  return x.replace(/:([-\d.e+]+)/g, (_, n) => ':' + Number(n).toFixed(9))
          .replace(/\/([-\d.e+]+)/g, (_, n) => '/' + Number(n).toFixed(9));
}

// ------------------------------------------------------- the POSITION oracle
// Each face reduced to WHAT it is AND WHERE it is AND HOW BIG it is:
//   <signature> | A=<area> | z=<axial centroid> | n=<normal or axis z-component>
// toFixed(9) is the same normalisation sigMatches already uses; against
// references that agree to 5.9e-16 it is a ~1e-9 ABSOLUTE bound on a height and
// a ~1e-13 relative bound on an area of this size, i.e. never the thing that
// fails first.
//
// snap() collapses everything strictly inside the TOL floor to a positive zero.
// It is not a slackening — TOL is already the accepted-equal band for every
// other term — it is what stops a coordinate the geometry puts at EXACTLY zero
// from failing on its SIGN: BRepGProp returns the outer sphere's centroid as
// -1.9e-16, which toFixed(9) prints as "-0.000000000" against a reference
// "0.000000000". Two strings, one point.
const snap = (v) => (Math.abs(v) < TOL ? 0 : v);
const fmtFace = (sig, area, cz, nz) =>
  `${normSig(sig)} | A=${snap(area).toFixed(9)} | z=${snap(cz).toFixed(9)}` +
  ` | n=${snap(nz).toFixed(6)}`;

function faceGeomKeys(h) {
  return f.faceInventory(h).map((x) => {
    let sig = x.concave ? '*' : '';
    sig += x.kind;
    if (x.kind === 'cylinder' || x.kind === 'cone' || x.kind === 'sphere') sig += ':' + x.radius;
    else if (x.kind === 'torus') sig += ':' + x.radius + '/' + x.minorRadius;
    return fmtFace(sig, x.area, x.centroid[2], x.direction[2]);
  }).slice().sort();
}

function faceGeomWant(want) {
  return want.map((w) => fmtFace(w.s, w.area, w.cz, w.nz)).slice().sort();
}

const TOPO_KEYS = ['solids', 'shells', 'faces', 'wires', 'edges', 'vertices'];

// Evaluate ONE built solid against ONE case's references. Every term is a
// separate boolean so a failure names which part of the oracle rejected the
// shape — and so the negative controls below can show WHICH term is the one
// doing the work.
function evaluate(h, c) {
  const mp = f.massProps(h);
  const sig = surfaceSignature(h);
  const topo = f.direct.topoCounts(h);
  const val = f.heal.checkValidity(h);
  const chk = f.shapecheck.analyse(h);
  const gotFaces = faceGeomKeys(h);
  const wantFaces = faceGeomWant(c.faceGeom);
  const terms = {
    volume: nearly(mp.volume, c.ref),
    surfaces: sigMatches(sig, c.surfaces),
    area: nearly(mp.area, c.refArea),
    centroid: c.refCom.every((w, i) => nearly(mp.centerOfMass[i], w)),
    topology: TOPO_KEYS.every((k) => topo[k] === c.topo[k]),
    faceGeom: gotFaces.length === wantFaces.length &&
              gotFaces.every((x, i) => x === wantFaces[i]),
    validity: val.isClosed && val.isManifold && val.isOriented && !val.hasSelfIntersect &&
              !val.hasNonManifoldEdge && val.badFaces.length === 0 && val.badEdges.length === 0 &&
              chk.valid === true && chk.faultyCount === 0,
  };
  return { mp, sig, topo, val, chk, gotFaces, wantFaces, terms,
           ok: Object.values(terms).every(Boolean) };
}

const topoStr = (t) => TOPO_KEYS.map((k) => `${k}=${t[k]}`).join(' ');

// --------------------------------------------------------------------- run
let pass = 0, fail = 0;
console.log('\n[thicksolid] TKOffset family G — NATIVE thick-solid vs CLOSED FORM');
console.log(`[thicksolid] addon: ${KERNEL}`);
console.log(`[thicksolid] oracle: derived geometry (NOT OCCT) — rel tol ${TOL}\n`);

for (const c of cases) {
  let r = null, err = null;
  try {
    r = evaluate(f.part.shellNativeThick(c.build(), c.remove, c.t), c);
  } catch (e) {
    err = e.message;
  }

  const ok = !err && r.ok;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  console.log(`        ref ${c.refText} = ${c.ref.toFixed(9)}`);
  if (err) {
    console.log(`        THREW: ${err}`);
  } else {
    const rel = Math.abs(r.mp.volume - c.ref) / Math.abs(c.ref);
    console.log(`        volume   ${r.terms.volume ? 'ok  ' : 'FAIL'} = ${r.mp.volume.toFixed(9)}   rel=${rel.toExponential(2)}`);
    console.log(`        area     ${r.terms.area ? 'ok  ' : 'FAIL'} = ${r.mp.area.toFixed(9)}   ref ${c.areaText}`);
    console.log(`        centroid ${r.terms.centroid ? 'ok  ' : 'FAIL'} = [${r.mp.centerOfMass.map((v) => v.toFixed(9)).join(', ')}]   ref ${c.comText}`);
    console.log(`        topology ${r.terms.topology ? 'ok  ' : 'FAIL'} = ${topoStr(r.topo)}`);
    console.log(`                 ref ${c.topoText}`);
    if (!r.terms.topology) console.log(`                 expected ${topoStr(c.topo)}`);
    console.log(`        validity ${r.terms.validity ? 'ok  ' : 'FAIL'} = closed=${r.val.isClosed} manifold=${r.val.isManifold} oriented=${r.val.isOriented} selfIntersect=${r.val.hasSelfIntersect} nonManifoldEdge=${r.val.hasNonManifoldEdge} badFaces=${r.val.badFaces.length} badEdges=${r.val.badEdges.length} brepCheck=${r.chk.valid}/${r.chk.faultyCount}`);
    console.log(`        surfaces ${r.terms.surfaces ? 'exact' : 'MISMATCH'}: ${r.sig.join(' ')}`);
    if (!r.terms.surfaces) console.log(`        expected              : ${c.surfaces.join(' ')}`);
    console.log(`        per-face type+area+height+normal ${r.terms.faceGeom ? 'exact' : 'MISMATCH'}`);
    if (!r.terms.faceGeom) {
      for (const line of r.gotFaces) console.log(`          got  ${line}`);
      for (const line of r.wantFaces) console.log(`          want ${line}`);
    }
    if (c.occtSilentlyWrong !== undefined) {
      console.log(`        (OCCT MakeThickSolid answers ${c.occtSilentlyWrong.toFixed(6)} here — ` +
                  `${(100 * Math.abs(c.occtSilentlyWrong - c.ref) / c.ref).toFixed(1)}% off, IsDone()==true)`);
    }
  }
  ok ? pass++ : fail++;
}

// ===========================================================================
// NEGATIVE CONTROLS — the oracle must REJECT a wrong solid of the RIGHT volume
// ===========================================================================
// Each control is a real, valid, closed solid that is NOT the answer, built
// without the engine under test. Both agree with case 1 on volume, area, the
// complete topology census, the surface signature and validity — so a gate made
// only of those checks would pass them. What must reject them is POSITION: the
// centre of mass and the per-face (area, height) pairing. That claim is what is
// asserted below, so weakening the position checks turns these red.
console.log('\n[thicksolid] NEGATIVE CONTROLS — equal-volume WRONG shapes must be rejected');
for (const nc of negativeControls) {
  const c = cases[nc.of];
  let r = null, err = null;
  try {
    r = evaluate(nc.build(), c);
  } catch (e) {
    err = e.message;
  }
  // The load-bearing claim: it is POSITION that rejects this shape.
  const rejectedByPosition = !err && (!r.terms.centroid || !r.terms.faceGeom);
  const ok = rejectedByPosition && !r.ok;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  rejects: ${nc.name}`);
  console.log(`        ${nc.why}`);
  if (err) {
    console.log(`        THREW: ${err}`);
  } else {
    console.log(`        against case "${c.name}": ` +
                Object.entries(r.terms).map(([k, v]) => `${k}=${v ? 'accept' : 'REJECT'}`).join(' '));
    console.log(`        its centroid = [${r.mp.centerOfMass.map((v) => v.toFixed(9)).join(', ')}]` +
                `   the answer's = [${c.refCom.map((v) => v.toFixed(9)).join(', ')}]`);
    if (!ok) {
      for (const line of r.gotFaces) console.log(`          got  ${line}`);
      for (const line of r.wantFaces) console.log(`          want ${line}`);
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
