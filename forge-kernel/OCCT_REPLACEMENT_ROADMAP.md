# OCCT → Pure In-House Engine (Parasolid-style) — Autonomous Roadmap

**GOAL:** turn the kernel from *depending on* OCCT into a **pure, encapsulated geometry engine like Parasolid** —
a black-box strict C-API mathematical modeler (handles/tokens, no graphics/app-framework), with the full OCCT
scope (Foundation math, Modeling Data B-Rep, Modeling Algorithms, Mesh, Data Exchange) reimplemented native,
plus CGAL + libfive + PicoGK + Manifold unified in.

**NORTH-STAR METRIC:** `otool -L forge-kernel.node | grep -c opencascade` → **0**. (Now: 19, was 22.)
CGAL/libfive/PicoGK/Manifold already 0-linkage (native). OCCT is the lone remaining dependency.

## Keystones (each a multi-cycle effort; drive autonomously, verify native vs OCCT, delete fallbacks)
- **K0 — FLIP GATE DEFAULTS + MEASURE:** forgeNativeFeaturesEnabled()/forgeNativeStepEnabled() default OFF →
  flip ON, run full suite, find what ACTUALLY breaks (native path may already cover it), delete OCCT fallbacks
  where native passes. Reveals the real remaining OCCT surface. (highest leverage first move)
- **K1 — native trimmed-NURBS STEP reader** (deepest blocker): arbitrary AP203/214/242 B_SPLINE_SURFACE import,
  native STEP write. Drops TKDESTEP/TKXSBase/TKDE. Removes the STEP fallback + NativeOcctBridge round-trip.
- **K2 — general curved/mixed/fuzzy booleans + Splitter:** tolerant curved-surface boolean, fuzzy value, the
  Mold/SheetMetal Splitter. Drops TKBO/TKBool. (native core booleans already ON; kill the OCCT fallback path)
- **K3 — general fillet/chamfer/draft/shell/offset/loft/pipe** for arbitrary (non-orthogonal, curved, imported)
  inputs — broaden the narrow analytic scope to OCCT parity. Drops TKFillet/TKOffset.
- **K4 — native perspective HLR + generalize ortho HLR/sewing/healing** beyond NativeSolid; wire perspective
  binding. Drops TKHLR/TKShHealing.
- **K5 — native meshing** (replace BRepMesh in the boolean-tessellation soup + HLR retry + glTF). Drops TKMesh.
- **K6 — migrate ~15 modules' direct gp_/Geom_/Precision usage** (Features 112 sites, Drawings 86, OcctImport
  79, DirectModeling 61, Nurbs 55, Mold 52, SheetMetal 51, ClassASurfacing 48, Airfoil 33 …) onto the
  already-built native Vec3/Matrix/NurbsCurve/NurbsSurface. Unpins the core substrate
  TKernel/TKMath/TKG2d/TKG3d/TKGeomBase/TKGeomAlgo/TKBRep/TKTopAlgo/TKPrim.
- **K7 — Parasolid-style C-API encapsulation:** wrap the native kernel behind a strict opaque-handle C-API
  (functional tokens + IDs), black-box, no graphics/app-framework leakage. The public interface Forge calls.
- **FINAL:** remove OCCT_LIBS from CMakeLists → rebuild → `otool` shows 0 OCCT dylibs. Done.

## Autonomous protocol (each cron cycle)
1. Read this roadmap + the current dylib count. 2. Pick the next open keystone. 3. Spawn parallel worktree
agents to implement + verify native vs OCCT (A/B to machine precision), delete the OCCT fallback where native
passes. 4. Cherry-pick green fixes to archdisc, rebuild, re-measure the dylib count. 5. Never fake a native
pass — a kind=occt that still shows is an honest FAIL to report. 6. Continue until 0 dylibs.

## Done so far
- 22→19 dylibs (dropped dead TKDEIGES/TKDESTL/TKDEVRML). Native verified: shell/rib/holeWizard/pattern,
  bore tessellation, mesh-boolean exact escalation, mixed-operand booleans 13/18, analytic ortho HLR (1e-15),
  native IGES-write/open-rib/torus-shell. CGAL/libfive/PicoGK/Manifold fully native (0 linkage).
- **cycle-1 (2026-07-07) verify+integrate** — K2/K6/K7 cherry-picked onto archdisc, Release build GREEN:
  - **K2 booleantol native-first** — `booleantol.{fuse,cut,common}` now route through the OCCT-free engine
    for native operand pairs. API A/B 10/10: kindOf(result)==nativeSolid (NOT occt); vol == OCCT SetFuzzyValue
    (fuse rel 2e-16, cut rel 4e-7, curved cut rel 9e-15, curved common rel 3e-4). OCCT operand still defers.
  - **K6 Mold.cpp** — ~53 gp_/Precision algebra sites → native NVec3 (0 Precision::, 0 gp_ vector math left;
    OCCT builder/query boundary intact). Draft-arithmetic A/B 4/4 (cone side angle 75.96°); mold split/flow green.
  - **K7 Parasolid-style opaque-handle C-API** — `include/forge/capi/forge_capi.h` + `src/native/capi/forge_capi.cpp`
    compile INTO the addon; standalone smoke compiles+links **OCCT-FREE** (128 native objs) and passes **39/39** A/B.
  - **dylibs 19 → 19 (unchanged, honest)** — no keystone fully severed a lib yet: K2 keeps BRepAlgoAPI fallback
    (TKBO/TKBool), K6 still feeds gp_Ax2/Pln/Trsf + BRepGProp_Face (TKernel/TKMath/TKBRep/TKTopAlgo/TKPrim).
- **cycle-2 (2026-07-07) verify+integrate** — K3/K4/K5 cherry-picked onto archdisc (K4+K5 auto-merged in
  Drawings.cpp), two bounded Release builds GREEN:
  - **K3 general fillet** — INTEGRATED + FULLY VERIFIED to machine precision. New A/B native_vs_occt_fillet_prism.mjs:
    non-orthogonal n-gon side edge (delta=60/120/135) 9/9 — native rides the general-dihedral analytic path
    (nativeSolid, not mesh/occt), vol == analytic ~1e-15 AND == OCCT BRepFilletAPI ~4e-15. Ortho fillet 8/8 intact.
  - **K4a analytic perspective HLR** — INTEGRATED + VERIFIED: native_vs_occt_hlr_persp PASS both scenes at 4 AND 64
    samples/edge (length-fraction rel<=1e-16, counts matched) — native hlrPerspective == OCCT HLRBRep_Algo, sample
    independent. Core sew 24/24 + heal PASS + healing_smoke all-pass (no regression from the Sewing.cpp broadening).
  - **K4b DEFECT fixed** — projectShapePerspective on an imported OCCT body emitted a WRONG drawing (visFrac 0.605 vs
    verified 0.759, +66% length from duplicated edges); that branch now DEFERS honestly (throws). Native persp works;
    ortho-via-import still exact. Re-enable after importOcctSolid de-dupes the shell.
  - **K5 native meshing** — INTEGRATED: `forge::occtmesh` triangulator (zero TKMesh symbol) compiles in; Booleans
    GAP-A + Drawings HLR-retry BRepMesh->occtmesh, regression-clean (core 34/34, fuzzy 8/8). HONEST sub-fail:
    BooleanTol OCCT operand still returns kind==occt (native mesh-operand route did NOT engage) — correct volume,
    no regression; the "kills the LAST K2 deferral" write-side claim did not land in the built kernel.
  - **dylibs 19 → 19 (unchanged, honest)** — grep-confirmed TKMesh/TKFillet/TKHLR/TKShHealing/TKOffset all still have
    live callers (TKMesh in Tessellate/FeaTet/IoExchange/GltfExport; TKHLR in the Drawings OCCT retry). No full sever.
- **cycle-3 (2026-07-07) verify+integrate** — K5-tkmesh-callers-swap + K6-DirectModeling cherry-picked; K6 kept, K5 reverted:
  - **K6 DirectModeling native-Vec3** — INTEGRATED + KEPT. 11 Precision::Confusion + ~17 gp_ vector-algebra sites migrated
    to native NVec3. A/B vs pre-K6 gp_ build = **byte-for-byte IDENTICAL** (arithmetic-identical). direct_smoke PASS,
    core.mjs 34/34, features_gap1 10/10, aabb 7/7, gltf OK. 4th K6 module done (Airfoil+Mold+DirectModeling). No lib drop.
  - **K5 tkmesh-callers-swap** — A/B **FAILED → REVERTED, TKMesh KEPT**. Swapping Tessellate/FeaTet BRepMesh→occtmesh made
    native_vs_occt_core.mjs regress 34/34 → 28/34: occtmesh mis-tessellates OCCT-backed reference solids (prism z-extent
    6 vs correct 3; dropped caps → |dBBox|=solid-dim; revolve χ flips −6 vs 2). Whole-shape import corpus (7 STEP) was
    non-empty, but the AABB/χ/watertight gate exposed dropped/mislocated faces — the exact regression the gate warns of.
    Reverted (git revert bf4b0492); post-revert core.mjs 34/34 GREEN. **TKMesh cannot drop until occtmesh correctly
    tessellates arbitrary OCCT TopoDS faces (honour Location transform + planar caps) and holds core.mjs 34/34.**
  - **dylibs 19 → 19 (unchanged, honest)** — TKMesh KEPT (occtmesh not yet correct on OCCT-backed solids). No sever.
