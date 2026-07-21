// forge-kernel/test/native_bridge_curved_smoke.mjs
//
// NATIVE -> OCCT BRIDGE, CURVED-PRIMITIVE ANALYTIC RECONSTRUCTION (sphere + torus).
//
// The lazy native->OCCT bridge (ShapeRegistry::get -> occtFromNativeSolid) rebuilds
// a native analytic solid as the MINIMAL analytic OCCT B-rep before handing it to
// any OCCT-only op (unifyFaces / heal / mold split / the OCCT boolean fallback).
// PLANE / CYLINDER / CONE already reconstruct 1:1; this gate locks in the SPHERE and
// TORUS additions.
//
// The bug this closes: without an analytic path a native sphere/torus falls to the
// FACETED fallback (occtFacetedFromNativeSolid), which shatters the body into
// thousands of tiny plane facets. That faceted B-rep mis-integrates in OCCT — the
// identical failure that made a bridged cone read 24627 vs a true 19603 mm3 and
// collapsed the mold split. Measured on the pre-fix build via THIS same bridge
// trigger (forge.unifyFaces, a documented bridge entry used by test/directedit.mjs):
//
//   sphere(10): bridged to 16128 PLANE facets  (want 1 sphere face)
//   torus(20,5): bridged to 16384 PLANE facets (want 1 torus face),
//                OCCT-integrated volume 9849.80 vs the true 9869.60 (0.03% low)
//
// After the fix the bridge rebuilds each as ONE analytic OCCT face and the
// OCCT-integrated volume is EXACT. This gate asserts, for each primitive:
//   (1) the bridge actually ran   -> unifyFaces returns an OCCT-backed handle,
//   (2) the ANALYTIC path was taken -> its faceInventory is {sphere:1}/{torus:1},
//       NOT the hundreds/thousands of planes the faceted fallback would emit,
//   (3) the OCCT-integrated volume of the bridged solid matches the exact analytic
//       expectation to tight tol (NOT the faceted-garbage value).
//
// Resolves the addon like native_vs_occt_core.mjs (import.meta.dirname default,
// FORGE_KERNEL override) so it runs from the repo root.
//
// Run: node forge-kernel/test/native_bridge_curved_smoke.mjs
//      FORGE_KERNEL=/abs/path/forge-kernel.node node ...   (override the addon)

import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const KERNEL = process.env.FORGE_KERNEL ||
  path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');

let forge;
try { forge = require(KERNEL); }
catch (e) { console.error('[bridge-curved] FAILED to load', KERNEL, '\n', e); process.exit(1); }

if (typeof forge.setNativeBrep !== 'function') {
  console.error('[bridge-curved] addon lacks setNativeBrep — build with -DFORGE_NATIVE_BREP=ON');
  process.exit(1);
}

const PI = Math.PI;
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  [FAIL] ' + msg); } };
const hist = (inv) => { const h = {}; for (const f of inv) h[f.kind] = (h[f.kind] || 0) + 1; return h; };

// The native analytic B-rep MUST be the live backend for this gate — that is the
// only path that mints a NativeSolid and therefore exercises occtFromNativeSolid.
forge.setNativeBrep(true);

// Each case: a native curved primitive whose FULL body is a single analytic surface,
// its exact closed-form volume, and its expected single analytic OCCT face kind.
const CASES = [
  {
    label: 'sphere(r=10)',
    build: () => forge.makeSphere(10),
    volume: (4 / 3) * PI * 10 * 10 * 10,            // 4188.7902
    faceKind: 'sphere',
  },
  {
    label: 'torus(R=20, r=5)',
    build: () => forge.makeTorus(20, 5),
    volume: 2 * PI * PI * 20 * 5 * 5,               // 9869.6044
    faceKind: 'torus',
  },
];

for (const c of CASES) {
  console.log(`\n=== ${c.label} ===`);

  // The native body must itself be analytic-exact (native divergence-theorem mass).
  const nat = c.build();
  ok(forge.kindOf(nat) === 'nativeSolid',
     `${c.label}: built as a NativeSolid (got ${forge.kindOf(nat)})`);
  const natVol = forge.massProps(nat).volume;
  ok(Math.abs(natVol - c.volume) <= 1e-6 * c.volume,
     `${c.label}: native volume ${natVol.toFixed(4)} == analytic ${c.volume.toFixed(4)}`);

  // FORCE the native->OCCT bridge. forge.unifyFaces is a documented bridge trigger
  // (test/directedit.mjs `canon`): for a curved native solid it is ineligible for
  // the native planar-unify shortcut, so it falls through to ShapeRegistry::get ->
  // occtFromNativeSolid and returns an OCCT-BACKED handle. massProps/faceInventory on
  // that handle therefore report the OCCT integration of the BRIDGED solid.
  const bridged = forge.unifyFaces(c.build());
  ok(forge.kindOf(bridged) === 'occt',
     `${c.label}: unifyFaces bridged to an OCCT-backed handle (got ${forge.kindOf(bridged)})`);

  // (2) ANALYTIC PATH TAKEN: exactly ONE analytic face of the expected kind — NOT
  // the hundreds/thousands of plane facets the faceted fallback would emit.
  const inv = forge.faceInventory(bridged);
  const h = hist(inv);
  ok(inv.length === 1 && h[c.faceKind] === 1,
     `${c.label}: bridged faceInventory is {${c.faceKind}:1} — analytic path taken ` +
     `(got ${inv.length} faces ${JSON.stringify(h)})`);
  ok(!('plane' in h),
     `${c.label}: bridged solid carries NO plane facets (faceted fallback NOT taken)`);

  // (3) OCCT-INTEGRATED VOLUME of the bridged solid == exact analytic volume. This is
  // the OCCT mass path (bridged handle is OCCT-backed), NOT the native integrator and
  // NOT the faceted-garbage value. Tight tol (1e-6 rel) — the faceted torus (9849.80)
  // misses this by 0.03%, i.e. ~3e-4 rel.
  const occtVol = forge.massProps(bridged).volume;
  ok(Math.abs(occtVol - c.volume) <= 1e-6 * c.volume,
     `${c.label}: OCCT-integrated bridged volume ${occtVol.toFixed(6)} == analytic ` +
     `${c.volume.toFixed(6)} (rel<=1e-6)`);

  console.log(`  ${c.label}: bridged kind=${forge.kindOf(bridged)} faces=${inv.length} ` +
              `${JSON.stringify(h)} occtVol=${occtVol.toFixed(6)} analytic=${c.volume.toFixed(6)}`);
}

console.log(`\n[bridge-curved] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
