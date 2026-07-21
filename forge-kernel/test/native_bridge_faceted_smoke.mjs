// forge-kernel/test/native_bridge_faceted_smoke.mjs
//
// NATIVE -> OCCT BRIDGE, FACETED FALLBACK INTEGRATION CORRECTNESS.
//
// The lazy native->OCCT bridge (ShapeRegistry::get -> occtFromNativeSolid) rebuilds
// a native analytic solid as the MINIMAL analytic OCCT B-rep (PLANE/CYLINDER/CONE/
// SPHERE/TORUS as exact faces). Anything it declines (genuine NURBS, mixed / booleaned
// bodies) falls to occtFacetedFromNativeSolid -> buildOcctSolidFromPolyhedron, which
// welds the native tessellation's triangle soup into a watertight OCCT solid.
//
// THE BUG THIS GUARDS (regression of the mold-cone malformation b8251e83): a planar
// TopoDS_Face is useless to BRepGProp / the OCCT booleans unless every boundary edge
// carries a PCURVE on THAT face's surface. BRepBuilderAPI_MakeFace(pln,wire) did NOT
// re-stamp a pcurve on the SECOND face of a SHARED edge, so BRepTools::UVBounds fell
// back to the plane's infinite natural bounds and BRepGProp integrated garbage that
// CANCELLED across faces. Forcing a KNOWN body through the faceted path (env
// FORGE_BRIDGE_FACETED=1, which skips analytic reconstruction) measured, on the
// pre-fix build via THIS same bridge trigger (forge.unifyFaces):
//
//   cylinder(r=10,h=20): OCCT-integrated  54.62 vs true 6283.19   (-99.13%)  MALFORMED
//   frustum (10,5,h=20): OCCT-integrated 1728.50 vs true 3665.19   (-52.84%)  MALFORMED
//   cone    (10,0,h=20): OCCT-integrated 2074.01 vs true 2094.40   (-0.97%)   (happened to be ok)
//
// The triangle soup itself was ALWAYS correct (its own signed volume matched truth to
// 0.04%) — the malformation was purely OCCT-side (missing pcurves). buildOcctSolid-
// FromPolyhedron now builds each face directly on a Geom_Plane and EXPLICITLY stamps a
// co-parameterised Geom2d_Line pcurve per edge (BRep_Builder::UpdateEdge + Range),
// runs BRepLib::SameParameter, and VOLUME-SELF-CHECKS the OCCT mass against the native
// polyhedron's own signed volume — THROWING rather than emit a mis-integrating solid.
//
// After the fix the faceted OCCT volume equals the native inscribed polyhedron EXACTLY
// and is ~0.04% below the smooth truth (the 64-gon inscribed-polygon approximation —
// expected and correct, NOT the -99% garbage).
//
// This gate asserts, driving forge.unifyFaces (a documented bridge trigger — see
// test/directedit.mjs / native_bridge_curved_smoke.mjs):
//   (A) DEFAULT (analytic) path is untouched: cylinder/cone/frustum reconstruct to the
//       EXACT smooth volume with an analytic face inventory (cylinder/cone faces).
//   (B) FORCED-FACETED path integrates CORRECTLY: the bridge ran (occt-backed handle),
//       the faceted path was actually taken (inventory is ALL planes — no analytic
//       curved face), and the OCCT volume is the inscribed-poly value (<=0.2% low,
//       and emphatically NOT the -99%/-53% malformation) — i.e. no throw + right mass.
//
// Resolves the addon like native_vs_occt_core.mjs (default build/Release, FORGE_KERNEL
// override) so it runs from the repo root.
//
// Run: node forge-kernel/test/native_bridge_faceted_smoke.mjs
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
catch (e) { console.error('[bridge-faceted] FAILED to load', KERNEL, '\n', e); process.exit(1); }

if (typeof forge.setNativeBrep !== 'function') {
  console.error('[bridge-faceted] addon lacks setNativeBrep — build with -DFORGE_NATIVE_BREP=ON');
  process.exit(1);
}

const PI = Math.PI;
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  [FAIL] ' + msg); } };
const hist = (inv) => { const h = {}; for (const f of inv) h[f.kind] = (h[f.kind] || 0) + 1; return h; };

// The native analytic B-rep is the live backend — the only path that mints a
// NativeSolid and therefore exercises occtFromNativeSolid.
forge.setNativeBrep(true);

// Each case: a native analytic body whose FULL smooth volume is closed-form, plus the
// analytic OCCT face kind the DEFAULT bridge reconstructs it into.
const CASES = [
  {
    label: 'cylinder(r=10,h=20)',
    build: () => forge.makeCylinder(10, 20),
    volume: PI * 10 * 10 * 20,                       // 6283.1853
    analyticKind: 'cylinder',
    malformed: 54.62,                                // pre-fix faceted garbage
  },
  {
    label: 'cone(r1=10,r2=0,h=20)',
    build: () => forge.makeCone(10, 0, 20),
    volume: (1 / 3) * PI * 10 * 10 * 20,             // 2094.3951
    analyticKind: 'cone',
    malformed: null,                                 // pre-fix happened to be ~ok
  },
  {
    label: 'frustum(r1=10,r2=5,h=20)',
    build: () => forge.makeCone(10, 5, 20),
    volume: (1 / 3) * PI * 20 * (100 + 50 + 25),     // 3665.1914
    analyticKind: 'cone',
    malformed: 1728.50,                              // pre-fix faceted garbage
  },
];

// ---------------------------------------------------------------------------
// (A) DEFAULT PATH — analytic reconstruction, must be untouched by the fix.
// ---------------------------------------------------------------------------
console.log('\n=== (A) DEFAULT bridge: analytic reconstruction (exact) ===');
delete process.env.FORGE_BRIDGE_FACETED;
for (const c of CASES) {
  const bridged = forge.unifyFaces(c.build());
  // unifyFaces now merges a plain CYLINDER natively (co-cylindrical native unify,
  // UnifyFaces.cpp) → a NativeSolid; a CONE/FRUSTUM is still ineligible so it bridges
  // to OCCT via ShapeUpgrade. Either way the analytic native->OCCT reconstruction is
  // exercised LAZILY by the faceInventory/massProps calls below (ShapeRegistry::get),
  // so accept both handle kinds and let those queries verify the reconstruction.
  ok(forge.kindOf(bridged) === 'occt' || forge.kindOf(bridged) === 'nativeSolid',
     `${c.label}: unifyFaces handle is an analytic solid (occt bridge or native merge) (got ${forge.kindOf(bridged)})`);
  const inv = forge.faceInventory(bridged);
  const h = hist(inv);
  ok((h[c.analyticKind] || 0) >= 1,
     `${c.label}: analytic path taken — inventory carries a '${c.analyticKind}' face ${JSON.stringify(h)}`);
  const v = forge.massProps(bridged).volume;
  ok(Math.abs(v - c.volume) <= 1e-6 * c.volume,
     `${c.label}: analytic OCCT volume ${v.toFixed(4)} == exact ${c.volume.toFixed(4)} (rel<=1e-6)`);
  console.log(`  ${c.label}: analytic vol=${v.toFixed(4)} true=${c.volume.toFixed(4)} inv=${JSON.stringify(h)}`);
}

// ---------------------------------------------------------------------------
// (B) FORCED-FACETED PATH — the integration correctness this gate is about.
// FORGE_BRIDGE_FACETED=1 makes occtFromNativeSolid skip ALL analytic reconstruction
// and route straight to occtFacetedFromNativeSolid -> buildOcctSolidFromPolyhedron.
// (bridgeForceFaceted() reads getenv on every call, so an in-process toggle works.)
// ---------------------------------------------------------------------------
console.log('\n=== (B) FORCED-FACETED bridge: watertight polyhedron integration ===');
process.env.FORGE_BRIDGE_FACETED = '1';
for (const c of CASES) {
  let kind = '?', v = NaN, inv = [], threw = null;
  try {
    const bridged = forge.unifyFaces(c.build());
    kind = forge.kindOf(bridged);
    v = forge.massProps(bridged).volume;
    inv = forge.faceInventory(bridged);
  } catch (e) { threw = String((e && e.message) || e); }

  // No throw — the volume self-check must PASS on a genuine watertight body. This is
  // the CORE guard: the forced-faceted bridge tessellates the body and rebuilds a
  // watertight OCCT polyhedron, self-checking its volume (throwing on the mold-cone
  // malformation). A merged-cylinder native handle (co-cylindrical native unify)
  // exercises this via the faceInventory bridge below — its full-2π lateral now
  // tessellates watertight (SolidTessellate full-period surface-sampling), so it must
  // NOT throw either.
  ok(threw === null, `${c.label}: forced-faceted bridge did not throw (${threw})`);
  // The cylinder now unifies to a NativeSolid (native merge); the cone/frustum still
  // bridge to an OCCT handle. Both drive the forced-faceted bridge via faceInventory.
  ok(kind === 'occt' || kind === 'nativeSolid',
     `${c.label}: forced-faceted handle is an analytic solid (occt bridge or native merge) (got ${kind})`);

  // The faceted path was ACTUALLY taken: inventory is all planes, no analytic curved
  // face survives. (unifyFaces may merge the coplanar cap fans, so face count varies.)
  const h = hist(inv);
  const curved = (h.cylinder || 0) + (h.cone || 0) + (h.sphere || 0) + (h.torus || 0);
  ok(curved === 0 && (h.plane || 0) >= 1,
     `${c.label}: faceted path taken — inventory is ALL planes, no analytic face ${JSON.stringify(h)}`);

  // INTEGRATION CORRECTNESS: the faceted OCCT volume is the inscribed-polygon value —
  // slightly LOW of the smooth truth (64-gon ~ -0.04%), and emphatically NOT the
  // pre-fix malformation. Assert within 0.2% below truth AND >= 90% of truth (the
  // -99%/-53% garbage is nowhere near).
  const rel = (v - c.volume) / c.volume;
  ok(Number.isFinite(v) && v >= 0.9 * c.volume,
     `${c.label}: faceted volume ${Number.isFinite(v) ? v.toFixed(4) : 'NaN'} is NOT malformed ` +
     `(>= 90% of ${c.volume.toFixed(4)}; pre-fix was ${c.malformed ?? 'n/a'})`);
  ok(rel <= 1e-4 && rel >= -2e-3,
     `${c.label}: faceted volume ${v.toFixed(4)} is the inscribed-poly value ` +
     `(rel ${(rel * 100).toFixed(4)}% in [-0.2%, +0.01%])`);

  console.log(`  ${c.label}: faceted vol=${Number.isFinite(v) ? v.toFixed(4) : 'NaN'} ` +
              `true=${c.volume.toFixed(4)} rel=${(rel * 100).toFixed(4)}% inv=${JSON.stringify(h)}`);
}
delete process.env.FORGE_BRIDGE_FACETED;

console.log(`\n[bridge-faceted] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
