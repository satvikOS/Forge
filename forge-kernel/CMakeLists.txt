# ============================================================================
# BUILD NOTE (2026-07-20) — K5.1: TKG2d DROPPED (otool 15 -> 14); FIRST real toolkit drop.
# HISTORY: the display mesher src/OcctNativeMesh.cpp recovers each boundary vertex's
# (u,v). A K6 WIP did it by PROJECTING the shared 3-D point onto the face surface
# (GeomAPI_ProjectPointOnSurf); that passed kernel A/B (34/34) on native primitives BUT
# DEFERRED on imported-STEP full-wrap PERIODIC faces (sphere/torus, u:[0,2π]) — projection
# cannot disambiguate the periodic seam branch, so the UV trim loop self-intersected and
# the native CDT failed → empty mesh → OS STEP-import degenerate (e.g. cadgenbench 112
# face 35). An interim FIX read the stored p-curve (BRep_Tool::CurveOnSurface +
# Geom2d_Curve::Value — TKG2d) which kept otool at 15. NOW (K5.1) that single
# Geom2d_Curve::Value call site — the .node's ONLY exclusive TKG2d symbol — is replaced by
# BRep_Tool::UVPoints (TKBRep): for a SEAM edge it reads the two stored 2-D ENDPOINTS
# orientation-correctly (fwd/rev seam uses → OPPOSITE boundaries) and LINEARLY interpolates
# them (a seam p-curve is a straight ISO-LINE, so this reproduces Value() EXACTLY); non-seam
# edges use native projection. No new exclusive Geom2d symbol. TKG2d is removed from
# OCCT_LIBS below; it still loads transitively (TKBRep DT_NEEDs it) but the .node no longer
# names it → otool 14 and strict-link-safe. VERIFIED 2026-07-20: occt_drop_gate.sh TKG2d =
# DROP-SAFE (0 exclusive); nm -u | Geom2d_Curve5Value EMPTY; otool 14; kernel A/B 34/34;
# Archie-OS suite 13/13; foreign_step_ab 49/81; part-112 sphere-patch mesh watertight (2860
# tris, byte-identical to the p-curve path). Kernel-internal gates are NECESSARY BUT NOT
# SUFFICIENT; downstream Archie-OS 13/13 is the true drop gate, and Linux run_native CI
# (strict-link) is the ultimate one — push to confirm. GOLD15 backup at
# scratchpad/rebuildclean_2026-07-20/forge-kernel.node.K1_49match.
# ============================================================================
cmake_minimum_required(VERSION 3.20)
project(forge_kernel CXX)

set(CMAKE_CXX_STANDARD 20)  # planegcs uses <std::numbers> + <std::ranges>
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ---------------------------------------------------------------- dependency plane
# Sacrosanct 3.1 s10.6 / s21.2. Loads third_party/manifest/deps.lock.json, installs the
# FORGE_NETWORK=OFF offline guards, and gives forge_deps_require() — which resolves a
# prefix through the activated local plane FIRST and only falls back to the machine-global
# Homebrew prefix with a loud warning (or a hard error under -DFORGE_DEPS_STRICT=ON).
# See forge-kernel/cmake/ForgeDeps.cmake for what this replaced.
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_LIST_DIR}/cmake")
include(ForgeDeps)
forge_deps_init()

# ---------------------------------------------------------------- in-house B-rep
# IN-HOUSE KERNEL: native forge::native::brep analytic-core (primitives−ellipsoid,
# booleans, transforms, massProps, tessellate) + the native↔OCCT bridge.
# WAVE-1 FLIP (2026-06-23): ON by default — analytic-core native is the PRODUCTION
# path (A/B-verified native_vs_occt 33/33 + full kernel suite green). The runtime
# gate forgeNativeBrepEnabled() also defaults ON; FORGE_NATIVE_BREP=0/off rolls
# back to the OCCT baseline. Mesh-bridge FEATURES + native STEP stay OFF behind
# forgeNativeFeaturesEnabled()/forgeNativeStepEnabled() (Wave 2/3). OCCT remains
# compiled as the fallback + A/B oracle until the migration completes (Phase D).
option(FORGE_NATIVE_BREP "build/expose the in-house OCCT-free B-rep primitive path" ON)

# ---------------------------------------------------------------- node addon (Track Z1)
# ZERO-JS SPLIT (2026-08-28): the N-API addon `forge-kernel.node` is now an OPTIONAL
# ADD-ON TARGET, not the core. With FORGE_BUILD_NODE_ADDON=OFF the whole node layer
# -- the node-addon-api header probe, src/binding*.cpp, NAPI_* definitions and the
# CMAKE_JS_* glue -- is skipped, so the pure-C++ geometry kernel CONFIGURES AND
# BUILDS WITH node-addon-api ABSENT (previously an unconditional FATAL_ERROR made
# `npm install` a hard prerequisite of compiling any C++ at all). ON by DEFAULT so
# the cmake-js / CI build is UNCHANGED. Turning it OFF implies the node-free core
# library, so it forces FORGE_BUILD_DESKTOP_FOUNDATION=ON below.
option(FORGE_BUILD_NODE_ADDON
       "Build the N-API addon forge-kernel.node (OFF = pure-C++ core only, no Node needed)" ON)
if(NOT FORGE_BUILD_NODE_ADDON)
    # Nothing would be built at all otherwise: the node-free core IS the product here.
    set(FORGE_BUILD_DESKTOP_FOUNDATION ON CACHE BOOL
        "forced ON: FORGE_BUILD_NODE_ADDON=OFF builds the node-free core" FORCE)
endif()

# ---------------------------------------------------------------- desktop foundation (Pillar #10, Phase 1)
# When ON, also build a NODE-FREE core library `forge_kernel_core` (== forge_kernel
# MINUS the 4 N-API binding translation units, src/binding*.cpp) plus a standalone
# C++ probe (forge-desktop/foundation_probe.cpp) that drives the kernel headlessly
# with ZERO Node. This is the pure-C++ desktop migration foundation and is OFF by
# DEFAULT so the CI build is UNCHANGED — the forge-kernel.node target and every
# gate stay byte-untouched. The additive block lives at the very end of this file.
option(FORGE_BUILD_DESKTOP_FOUNDATION
       "Also build the node-free forge_kernel_core lib + the standalone C++ foundation probe" OFF)

# ---------------------------------------------------------------- desktop renderer (Pillar #10, Phase 1)
# When ON, also build a standalone HEADLESS Vulkan/MoltenVK offscreen renderer probe
# (forge-desktop/renderer_probe.cpp) that proves the desktop app's GPU backend runs
# with NO window/swapchain on this Mac, and renders a real kernel mesh to a PNG. It
# needs the Vulkan SDK (brew: molten-vk vulkan-headers vulkan-loader glslang) and links
# the node-free forge_kernel_core, so it REQUIRES FORGE_BUILD_DESKTOP_FOUNDATION=ON too.
# OFF by DEFAULT so the CI build is UNCHANGED (CI never sets it). Block lives at EOF.
option(FORGE_BUILD_DESKTOP_RENDERER
       "Also build the standalone headless Vulkan/MoltenVK offscreen renderer probe" OFF)

# ---------------------------------------------------------------- desktop UI (Pillar #10, Phase 1)
# When ON, also build a standalone HEADLESS Dear ImGui UI probe
# (forge-desktop/ui_probe.cpp) that renders a representative Forge IDE (menu bar,
# model-tree / properties / viewport panels, status bar) to an offscreen 1280x800
# framebuffer -> PNG with NO window/swapchain/GLFW, and composites the 3D kernel
# box into the viewport panel via ImGui::Image. It vendors Dear ImGui + the Vulkan
# backend (forge-desktop/third_party/imgui), needs the same Vulkan SDK as the
# renderer, and links the node-free forge_kernel_core, so it REQUIRES
# FORGE_BUILD_DESKTOP_FOUNDATION=ON too. OFF by DEFAULT so the CI build is
# UNCHANGED (CI never sets it). Block lives at EOF.
option(FORGE_BUILD_DESKTOP_UI
       "Also build the standalone headless Dear ImGui Forge-UI offscreen probe" OFF)

# ---------------------------------------------------------------- N-API
# Entirely skipped when FORGE_BUILD_NODE_ADDON=OFF (Track Z1) -- that is what makes
# the core kernel compile on a machine with no node_modules and no Node at all.
if(FORGE_BUILD_NODE_ADDON)
# cmake-js injects CMAKE_JS_INC + CMAKE_JS_SRC + CMAKE_JS_LIB. When
# building directly with cmake (no cmake-js) we fall back to node_modules
# for headers and skip the .lib step (Darwin uses flat namespace + bundle
# loader linkage; cmake-js sets that up automatically).
if(NOT DEFINED CMAKE_JS_INC)
    execute_process(COMMAND node -e "console.log(process.execPath)"
                    OUTPUT_VARIABLE NODE_EXE OUTPUT_STRIP_TRAILING_WHITESPACE)
    execute_process(COMMAND node -e "console.log(path.dirname(process.execPath))"
                    OUTPUT_VARIABLE NODE_DIR OUTPUT_STRIP_TRAILING_WHITESPACE)
endif()

# Node-API C++ wrapper (header-only). Prefer the sibling `node_modules`,
# else fall back to either the FORGE_NODE_MODULES CMake/-D variable or
# the env var of the same name (lets worktree builds reuse the real
# repo's node_modules without needing a symlink).
set(NODE_ADDON_API_DIR "${CMAKE_SOURCE_DIR}/../node_modules/node-addon-api")
if(NOT EXISTS "${NODE_ADDON_API_DIR}/napi.h")
    if(DEFINED FORGE_NODE_MODULES AND EXISTS "${FORGE_NODE_MODULES}/node-addon-api/napi.h")
        set(NODE_ADDON_API_DIR "${FORGE_NODE_MODULES}/node-addon-api")
    elseif(DEFINED ENV{FORGE_NODE_MODULES} AND EXISTS "$ENV{FORGE_NODE_MODULES}/node-addon-api/napi.h")
        set(NODE_ADDON_API_DIR "$ENV{FORGE_NODE_MODULES}/node-addon-api")
    endif()
endif()
if(NOT EXISTS "${NODE_ADDON_API_DIR}/napi.h")
    # Last chance: the dependency plane. node-addon-api is pinned in the lock too, so a
    # seeded local prefix can supply it without an npm install in this worktree.
    forge_deps_require(node-addon-api PREFIX_VAR _napi_prefix OPTIONAL)
    if(_napi_prefix AND EXISTS "${_napi_prefix}/napi.h")
        set(NODE_ADDON_API_DIR "${_napi_prefix}")
    endif()
endif()
if(NOT EXISTS "${NODE_ADDON_API_DIR}/napi.h")
    message(FATAL_ERROR "node-addon-api not found at ${NODE_ADDON_API_DIR}. Run `npm install` at repo root, set FORGE_NODE_MODULES, or seed the local plane (tools/deps/seed).")
endif()
endif()  # FORGE_BUILD_NODE_ADDON (N-API discovery)

# ---------------------------------------------------------------- OCCT
# Resolved through the dependency plane (Sacrosanct 3.1 s10.6), NOT from a hardcoded
# machine-global prefix. Order: .forge-local/prefixes/<triplet>/<build>/opencascade ->
# -DFORGE_DEPS_PREFIX_OPENCASCADE= / env -> $FORGE_DEPS_ROOT -> the lock's
# system_prefix_template ({brew_prefix}/opt/opencascade), which WARNS (or fails under
# -DFORGE_DEPS_STRICT=ON) because it is not reproducible on a clean machine.
#
# Was, until the dependency-plane track:
#     set(OCCT_ROOT "/opt/homebrew/opt/opencascade")   # + a /usr/local fallback
#
# -DOCCT_ROOT= and $OCCT_ROOT are still honoured, ahead of the plane, so existing CI
# invocations and the in-flight kernel work keep building unchanged.
if(DEFINED ENV{OCCT_ROOT} AND NOT DEFINED OCCT_ROOT)
    set(OCCT_ROOT "$ENV{OCCT_ROOT}")
endif()
if(NOT DEFINED OCCT_ROOT)
    forge_deps_require(opencascade
        PREFIX_VAR  OCCT_ROOT
        VERSION_VAR OCCT_LOCKED_VERSION
        SOURCE_VAR  OCCT_PREFIX_SOURCE)
else()
    message(STATUS "Forge kernel: OCCT_ROOT overridden explicitly -> ${OCCT_ROOT} "
                   "(dependency plane bypassed)")
endif()
if(NOT EXISTS "${OCCT_ROOT}/include/opencascade/Standard_Version.hxx")
    message(FATAL_ERROR "OCCT not found at ${OCCT_ROOT}. Seed the local plane with "
                        "tools/deps/seed, or set -DFORGE_DEPS_PREFIX_OPENCASCADE=...")
endif()

set(OCCT_INC "${OCCT_ROOT}/include/opencascade")
set(OCCT_LIB "${OCCT_ROOT}/lib")

# ---------------------------------------------------------------- OCCT version pin (C0 ratchet)
# Forge's kernel binds OCCT 7.9's reorganised Data-Exchange toolkit names
# (TKDESTEP / TKDEIGES / TKDESTL / TKDEVRML). A different major.minor (e.g. 8.0)
# renames those and silently breaks the link, so we pin major.minor and fail
# loud + legible instead. The brew patch version floats, so only major.minor is
# enforced. Override with -DEXPECTED_OCCT_VERSION=X.Y after verifying the TKDE*
# toolkit names still link under the new version.
if(NOT DEFINED EXPECTED_OCCT_VERSION)
    set(EXPECTED_OCCT_VERSION "7.9")
endif()
file(STRINGS "${OCCT_INC}/Standard_Version.hxx" _occ_ver_line
     REGEX "#define[ \t]+OCC_VERSION_COMPLETE[ \t]+\"[0-9.]+\"")
string(REGEX MATCH "[0-9]+\\.[0-9]+\\.[0-9]+" OCCT_VERSION_FOUND "${_occ_ver_line}")
string(REGEX MATCH "^[0-9]+\\.[0-9]+" OCCT_VERSION_MAJORMINOR "${OCCT_VERSION_FOUND}")
message(STATUS "Forge kernel: OCCT ${OCCT_VERSION_FOUND} at ${OCCT_ROOT} (pinned to ${EXPECTED_OCCT_VERSION}.x)")
if(NOT OCCT_VERSION_MAJORMINOR STREQUAL EXPECTED_OCCT_VERSION)
    message(FATAL_ERROR
        "OCCT version mismatch: found ${OCCT_VERSION_FOUND} (major.minor ${OCCT_VERSION_MAJORMINOR}) but "
        "Forge's kernel is pinned to OCCT ${EXPECTED_OCCT_VERSION}.x — the Data-Exchange toolkit names "
        "(TKDESTEP/TKDEIGES/...) differ across minor versions. Install OCCT ${EXPECTED_OCCT_VERSION}, or pass "
        "-DEXPECTED_OCCT_VERSION=${OCCT_VERSION_MAJORMINOR} once you have verified the TKDE* toolkits link.")
endif()

# ---------------------------------------------------------------- Eigen: REMOVED
# Eigen is no longer a dependency. The kernel's own solvers use the in-house
# forge::native::linalg; the vendored PlaneGCS sketch solver compiles against the
# drop-in <Eigen/...> shim (3rdParty/planegcs_eigen_shim), itself backed by
# forge::native::linalg. No real Eigen package is required — zero find_package.

# OCCT 7.9 reorganises the Data Exchange toolkits: TKSTEP / TKSTEPBase /
# TKSTEPAttr / TKSTEP209 / TKSTEP214 are merged into TKDESTEP, TKSTL → TKDESTL,
# TKVRML → TKDEVRML, TKIGES → TKDEIGES, plus new TKDEGLTF / TKDEOBJ / TKDEPLY.
# The common base is TKDE. ModelingData / ModelingAlgorithms toolkit names
# (TKMath, TKBRep, TKG3d, TKG2d, TKGeomBase, TKGeomAlgo, TKTopAlgo, TKPrim,
# TKShHealing, TKBO, TKBool, TKFillet, TKOffset, TKHLR, TKMesh) are stable.
set(OCCT_LIBS
    TKernel TKMath
    TKG3d
    TKBRep TKTopAlgo TKShHealing
    TKOffset
)
# ═════════════════════════════════════════════════════════════════════════════════
# ★★★ THE FLIP GATE FOR EVERY DEFAULT-OFF DROP OPTION BELOW IS NOW MEASURED.
#
# Each option below quotes the same condition — "native success rate >= the measured
# OCCT baseline" (reports/TKOFFSET_DECOMPOSITION.md §5 step 6). That is a COVERAGE
# measurement, and until 2026-08-29 no harness in this tree made it. It now exists:
#
#     forge-kernel/test/corpus_ab_coverage.cpp     the paired A/B, 10 families
#     forge-kernel/test/run_corpus_ab_coverage.sh  the driver
#     forge-kernel/reports/CORPUS_AB_COVERAGE.md   method, limits, and how to run it
#     forge-kernel/reports/corpus_ab/              the committed baseline + raw rows
#
# MEASURED at f71ed98b over ALL 600 gold reference solids, 6000 paired trials, 0
# part-level failures. Both arms get the SAME derived input; the OCCT arm is the exact
# call Features.cpp / Cam.cpp / Healing.cpp makes today, quoted with its file:line.
#
#   option                            native%   OCCT%   parts DELETED   McNemar p
#   FORGE_FILLET_DROP_NATIVE            32.8      76.8      315/600       1.4e-47
#   FORGE_OFFSET_DROP_MAKEOFFSET        94.5      99.0       27/600       1.5e-8
#   FORGE_THICKSOLID_DROP_NATIVE         0.0      22.2      133/600       2.4e-38   [1]
#   FORGE_OFFSETSHAPE_DROP_NATIVE        1.2       6.3       38/600       3.1e-6
#   FORGE_THRUSECTIONS_DROP_NATIVE       0.0      94.5      567/600      4.1e-171
#   FORGE_PIPE_DROP_NATIVE               0.3     100.0      598/600      1.9e-180
#   FORGE_PIPESHELL_DROP_NATIVE         51.5     100.0      291/600       5.0e-88
#   FORGE_FILLING_DROP_NATIVE           67.8      67.8        0/600       1.0000  ← PASS
#   FORGE_THICKEN_DROP_NATIVE           67.8     100.0      193/600       1.6e-58
#   FORGE_DRAFT_DROP_NATIVE              0.0      88.0      497/565       4.9e-150
#
# "parts DELETED" = OCCT built a result the call site would have accepted and the native
# engine DECLINED, on the same input. With the option ON, each of those becomes a THROWN
# ERROR. Nine of ten options fail with p < 1e-5 — these are not underpowered ties, the
# intervals are in reports/corpus_ab/summary.md and none of the nine straddles zero.
#
# ★ [1] THICKSOLID's 1.2% WAS SEVEN INVALID SOLIDS AND IS NOW AN HONEST 0.0%. The seven
#   parts the native thick-solid "built" on this corpus were every one of them
#   BRepCheck_Analyzer-INVALID (IntersectingWires) — the corpus A/B already recorded
#   "valid results: native 0, OCCT 0" for this family and the number was read as
#   coverage anyway. CAUSE, measured on ho1041: the wall offset exceeded the local
#   feature size, so the offset of a hole crossed the offset of the rim it sits inside
#   (outer R 24.0192 against holes of r 4.6848 centred 23.808, reaching 28.493). The
#   engine's two self-checks are both AREA/VOLUME identities in the radii and are blind
#   to containment — the face's area matched its closed form to 2e-7 relative while its
#   wires crossed. Fixed by a distance guard (circlesNest in
#   src/native/brep/NativeThickSolid.cpp), gated two-sidedly by
#   test/run_thicksolid_nesting_gate.sh, which is proved to FAIL against the pre-fix
#   engine. The seven became honest defers, so the deletion bucket is 133/600, not 126.
#   This LOWERS a native rate: it is a correction, not a regression — the capability it
#   removes never existed, and reports/TKOFFSET_GH_DEFER_CENSUS.md has the per-part
#   evidence for both G and H.
#
# ★ THE TABLE ABOVE IS THE f71ed98b BASELINE AND ONE ROW OF IT HAS SINCE MOVED. The
#   THRUSECTIONS 0.0% was not a coverage fact about the corpus, it was a DEFECT in the
#   native engine: it paired the two section rings by raw wire-explorer index and so
#   omitted the reorient/re-origin step BRepOffsetAPI_ThruSections performs (via
#   BRepFill_CompatibleWires) before ITS index pairing. Fixed in
#   src/native/brep/NativeLoftPipe.cpp::canonicalRing. RE-MEASURED over the same 600
#   parts, stride 1, 0 part-level errors, at the commit that carries the fix:
#     FORGE_THRUSECTIONS_DROP_NATIVE     51.5      94.5      258/600       4.3e-78
#   and inside the 309 parts where BOTH arms build, ALL 309 agree with OCCT on the FULL
#   observable vector (volume + centre of mass + bounding box + face/edge/vertex/shell
#   counts + validity) with ZERO disagreements — so the added coverage is exact, not
#   merely present. The option STILL FAILS its flip gate.
#
# ★★ AND THAT ROW HAS MOVED AGAIN, because the sentence that used to end the paragraph
#   above was WRONG and is kept here struck through rather than deleted: it read "the
#   surviving 258-part gap is sections carrying CIRCLE or B-SPLINE edges, which a ruled
#   loft of polygon rings does not cover and which is a different engine, not a fix."
#   It was a fix. The engine was INSTRUMENTED (FK_DEFER on every thruSections return,
#   test/run_thrusections_engine_census.sh) and its own labels said the whole remainder
#   was ONE cause — prof_edge_not_line, 291 of 291 deferrals — because a section was
#   represented as a ring of VERTICES and so had to be all-line-edged. Faceting those
#   arcs would have been the wrong solid; the fix is an IDENTITY instead: when section B
#   is section A translated by T, the ruled loft between them IS the linear extrusion of
#   A along T, exactly, for any edge geometry. 189 of the 258 deleted parts (73.3%) are
#   exact translates. RE-MEASURED over the same 600 parts, stride 1, 0 part-level errors:
#     FORGE_THRUSECTIONS_DROP_NATIVE     83.0      94.5       69/600       3.4e-21
#   All 498 shared successes agree with OCCT on the FULL observable vector, 0 disagree,
#   and all 498 native results are BRepCheck_Analyzer VALID. The 309 parts the engine
#   already covered are byte-identical to the previous run (the new path is reached only
#   on the polygonal path's defer), and the untouched control families measured in the
#   same two runs did not move: PIPESHELL 51.5% and THICKEN 67.8%, 0 bucket changes and
#   0 native-payload changes per part. The option STILL FAILS its flip gate: the
#   surviving 69 parts are pairs that are NOT translates (81 of the 102 remaining
#   deferrals are an edge-count mismatch between the two sections, 21 are a genuine
#   non-translate), and a non-translated pair of curved sections needs ruled surfaces
#   between the curves, which is a different engine.
#
# ★ FORGE_FILLING_DROP_NATIVE IS THE ONE OPTION THIS MEASUREMENT CLEARS, and it clears
#   it perfectly: 407 parts where both built, 193 where neither did, ZERO discordant
#   pairs in 600 trials, and all 407 shared successes agree on the FULL observable
#   vector (volume, area, centroid, all six bbox bounds, every sub-shape count). Not
#   "not significantly worse" — the same call on every single part. That is a coverage
#   result only; it does not by itself authorise the flip, which still needs the
#   Law-10 gate chain green under the option.
#
# ★ THE TWO REMAINING OPTIONS ARE OUT OF THIS GATE'S SCOPE, deliberately.
#   FORGE_SHHEAL_DROP_NATIVE and FORGE_GEOM_DROP_NATIVE both DEFAULT ON already and
#   replace low-level routines called from inside other ops, so there is no "native
#   declined where OCCT would have built it" event to count. Stated, not skipped.
#
# ★ FAMILY J's 0.0% IS DIAGNOSED, and the diagnosis changes what would have to be built.
#   test/draft_defer_probe.cpp re-runs the A/B's OWN DRAFT derivation over the same 600
#   parts and reads occtdraft::draftLastDeferReason(), so the guard is the engine's, not a
#   replica of it. It reproduces the row exactly: 35 not applicable, 565 DEFER, 0 native OK,
#   0 disagreements with the committed A/B on either applicability or the native verdict.
#   Results: reports/corpus_ab/draft_defer_probe.jsonl.gz.
#
#   NOT a wiring defect. The probe's POSITIVE CONTROL drafts a 10mm cube's side wall
#   through the same binary and gets 973.796 mm^3 — exactly 1000 - (1/2)(10)(10)(10 tan3
#   deg) — with an empty defer reason. The engine is reached and it is correct.
#
#   The two guards that fire are WHOLE-SHAPE preconditions of the plane-arrangement
#   formulation, not properties of the face being drafted:
#       375  a face of the solid carries more than one wire (a hole)
#       190  a face of the solid is not a plane
#   That 375/190 split is only the order faces happen to be visited in. Counted
#   order-independently, ALL 565 parts violate BOTH: 565 have a non-planar face, 565 have a
#   multi-wire face, and the parts violating exactly one are 0 and 0. So NO relaxation of
#   either guard moves this number by a single part. 37.0% of the corpus's 72,201 faces are
#   non-planar (per-part median 58.6%); zero parts are polyhedra.
#
#   AND THE BOUNDED ALTERNATIVE IS MEASURED AND STILL FAILS. The only construction that
#   could move the number is a different engine: rebuild only the faces incident to the
#   drafted wall's own vertices and carry every other face over verbatim. Its ceiling is
#   the parts whose local neighbourhood is all-planar — 424/565 = 75.0%, against the OCCT
#   baseline of 497/565 = 88.0% this gate must MEET. Those 424 are a strict SUBSET of
#   OCCT's 497: 73 parts stay in the deletion bucket and there are 0 native-only wins. The
#   same 424 are also exactly the parts whose every MOVED edge is a line, and a subset of
#   the 490 whose drafted wall is single-wire — one predicate, three ways. 75.0% is an
#   upper bound (it assumes every local rebuild then sews and validates), so the real
#   engine would land below it, and it fails the gate before any of that.
#
#   ROADMAP CONSEQUENCE: family J is not one predicate away from shipping. Reaching 88%
#   needs draft on CURVED faces (a drafted cylinder becomes a cone and its neighbours'
#   trims change type), which is a different engine from the one in NativeDraft.cpp.
#
# ★ RE-MEASURE AFTER TOUCHING ANY ENGINE. The build stamps the SHA it compiled from and
#   the driver REFUSES to run against a different HEAD (exit 3) — the first run of this
#   harness was compiled from one commit and measured against another, three engines
#   differed, and it was thrown away. Do not quote a number without its manifest.
# ═════════════════════════════════════════════════════════════════════════════════
# ── TKFillet DROP (authored 2026-07-25; DEFAULT OFF — NOT gate-passing yet) ────────
# FORGE_FILLET_DROP_NATIVE routes forge::part::{filletEdges,chamferEdges,variableFilletEdge}
# + forge::varfillet::fillet through the TKFillet-free native occtfillet::make{Fillet,Chamfer,
# VariableFillet} (src/native/brep/NativeFilletChamfer.cpp + NativeVariableFillet.cpp) and
# COMPILES OUT the OCCT BRepFilletAPI fallback (each call site: native-or-throw under the
# macro, OCCT baseline under #else). ON removes TKFillet from the link list; OFF keeps it so
# the OCCT A/B baseline still links.
#   ★ THIS NOTE WAS STALE AND IS NOW MEASURED (2026-08-29). It used to read: "the native
#   routines cover ONLY a convex STRAIGHT edge between two AS-YET-UNFILLETED PLANAR faces
#   (single / non-adjacent) … occtfillet DEFERS the moment a shared face carries a prior
#   fillet/chamfer arc … Flip ON only after a general MULTI-EDGE / curved native fillet
#   (corner ball-blend + arced-face retrim) lands." TWO of those three blockers have since
#   landed and the note was never corrected, which mis-scoped the work queued against it:
#     * arced-face retrim  — landed (RingSeg carries arcs through planarFaceFromSegs);
#     * corner ball-blend  — landed (blendBatch + sphericalCorner, exact octant);
#     * CONCAVE (reflex) edges — landed 2026-08-29 (this is the L-bracket / pocket / rib
#       inside corner; the cylinder axis moves to +nA and the blend ADDS material).
#   MEASURED against live OCCT on this machine, native == OCCT to 1e-9 on volume, centre of
#   mass, all six bbox bounds, face/edge/vertex/shell counts, Euler characteristic and
#   BRepCheck validity, for all three cases this note named as blockers:
#       fillet ALL 12 box edges  R=3  -> 5572.619358586   F=26 E=56  valid
#       fillet 4 VERTICAL edges  R=3  -> 5922.743338823   F=10 E=24  valid
#       chamfer ALL 12 box edges d=2  -> 5562.666666667   F=26 E=48  valid
#   plus L- and T-prisms with reflex corners and a non-90-degree reflex chevron:
#       forge-kernel/test/run_ab_native_fillet_concave.sh  (66/66 assertions)
#   And the drop configuration BUILDS AND LINKS: `cmake -DFORGE_FILLET_DROP_NATIVE=ON`
#   produced libforge_kernel_core.dylib with ZERO TKFillet link records AND — the check
#   that matters for the Linux strict-link CI, since macOS can load a dylib with
#   undefined symbols — ZERO imported TKFillet SYMBOLS, against 11 in the default build
#   (nm -u INTERSECT nm -gU libTKFillet; 11 is exactly the TKFillet symbol count in
#   reports/OCCT_DROP_ORDER.md 1.2, and the non-zero default is the control that keeps
#   the zero meaningful). Both numbers are re-measured on every run of
#   forge-kernel/test/run_callsite_concave_fillet.sh, which FAILS if the control
#   collapses to zero. NOTE the scope: this is libforge_kernel_core, NOT the shipped
#   .node — scripts/occt_drop_gate.sh runs the same intersection against the addon and
#   still must, and Linux CI remains the ultimate gate. And
#   forge-kernel/test/callsite_concave_fillet_test.cpp passes 6/6 through the real
#   forge::part::filletEdges / chamferEdges in that binary (4/6 with the pre-2026-08-29
#   engine, which is the before/after).
#
#   ★ STILL DEFAULT OFF, and here is exactly what is left — do NOT flip on the above.
#     (a) CURVED adjacent faces. The cylinder-top-rim blend is a TORUS and is not authored;
#         OCCT rounds it, the engine declines it. Any part with a rounded boss or a hole rim
#         would start THROWING.
#     (b) A vertex where a concave blend meets another blend, and any vertex with exactly
#         TWO blended edges (the two-edge corner surface). OCCT serves both.
#     (c) The variable-radius law fillet's remaining gaps (NativeVariableFillet).
#     (d) No corpus A/B has been run. Three shapes are not a corpus; the flip gate is
#         "native success rate >= the measured OCCT baseline over the corpus", the same
#         gate families D/F/G/H are held to.
#
#   ★ AND IT IS WORTH ZERO CLOSURE ON ITS OWN. Measured: the drop takes the DIRECT link
#     records 11 -> 10, but libTKOffset itself DT_NEEDs TKFillet, so TKFillet still LOADS
#     and OCCT_CLOSURE does not move. Per reports/OCCT_DROP_ORDER.md the pair
#     {TKFillet, TKOffset} is the unit that pays (-3 closure for 53 symbols); TKFillet alone
#     is -0. Score it as distance travelled toward that pair, never as a drop.
option(FORGE_FILLET_DROP_NATIVE
       "route fillet/chamfer native & DROP TKFillet (still needs curved-face blends + a corpus A/B)"
       OFF)
if(FORGE_NATIVE_BREP AND FORGE_FILLET_DROP_NATIVE)
    add_compile_definitions(FORGE_FILLET_DROP_NATIVE=1)
    message(STATUS "FORGE_FILLET_DROP_NATIVE=ON — TKFillet dropped; BRepFilletAPI fallback compiled out")
else()
    list(APPEND OCCT_LIBS TKFillet)   # OCCT BRepFilletAPI baseline still linked (default)
endif()
# ── ★ MEASURED 2026-07-30: the direct-link count UNDERSTATES the closure ────────
# Dropping TKFillet does not take the count 8 -> 7. It takes it 8 -> 9, because two
# libraries were reaching the link ONLY THROUGH TKFillet and become visible the
# moment it goes:
#   TKBO   BRepAlgoAPI_{Fuse,Cut,Common,Section,Splitter,Defeaturing},
#          BRepOffsetAPI_MakeFilling  — i.e. the boolean and defeature paths
#   TKG2d  Geom2d_Line — the native->OCCT bridge, the NURBS trimmer, occtconv::to2d
# Without naming them the drop build fails to link with "symbol(s) not found".
# So `otool -L | grep opencascade` counts DIRECT LINK RECORDS, not the dependency
# CLOSURE, and a count that falls because one library hides behind another is not
# progress. These are appended only in the drop branch, where they are genuinely
# required — inflating the default list would corrupt the historical series instead
# of correcting it. The closure is tracked separately; see
# reports/OCCT_ZERO_NEXT_STEP_2026-07-30.md §1b.
if(FORGE_NATIVE_BREP AND FORGE_FILLET_DROP_NATIVE)
    list(APPEND OCCT_LIBS TKBO TKG2d)
endif()
# TKOffset family E: the native CIRCLE-profile pipe builds its mitre-trimmed
# cylinder chain with BRepPrimAPI_MakeCylinder / BRepPrimAPI_MakeHalfSpace, so any
# build that COMPILES src/native/brep/NativeLoftPipe.cpp calls TKPrim.
#
# ★ THE CONDITION IS FORGE_NATIVE_BREP, NOT FORGE_PIPE_DROP_NATIVE. Getting this
#   wrong was caught by measurement, not by review: gating it on the drop option
#   left the DEFAULT build (every drop OFF) at OCCT_PHANTOM 3 instead of 2, because
#   the engine is compiled in whenever the native B-rep layer is on — the drop
#   option only decides whether the OCCT FALLBACK is also compiled, not whether the
#   native engine exists. A phantom is a library the binary CALLS with no link
#   record, masked on macOS by `-undefined dynamic_lookup`; on the Linux strict-link
#   CI it does not link at all.
#
#   MEASURED 2026-08-28: naming TKPrim moves OCCT_DIRECT 8 -> 9 and leaves
#   OCCT_CLOSURE at 14, because TKPrim already loads via TKBO/TKBool/TKFillet/
#   TKOffset. DIRECT is the explicitly gameable number; refusing to hide a real call
#   behind dynamic_lookup is worth more than the cosmetic 8.
if(FORGE_NATIVE_BREP)
    list(APPEND OCCT_LIBS TKPrim)
endif()
# ── TKShHealing PARTIAL DROP — P1 (landed 2026-07-31; DEFAULT ON) ─────────────────
# FORGE_SHHEAL_DROP_NATIVE routes the NON-STEP-PATH TKShHealing call sites in
# src/Healing.cpp onto the in-house forge::occtheal peers
# (src/native/brep/NativeShapeHeal.cpp) and COMPILES OUT the OCCT fallback at each
# (native-under-the-macro / OCCT-baseline-under-#else, the FORGE_FILLET_DROP_NATIVE
# pattern). Three OCCT classes leave the binary entirely — 8 of the 20 TKShHealing
# symbols:
#   ShapeFix_Solid            (4) Healing.cpp:446 (ctor+Perform+Solid), :531 (SolidFromShell)
#                                 -> occtheal::orientSolidOutward / occtheal::solidFromShell
#   ShapeAnalysis_Shell       (3) Healing.cpp:525-527 (LoadShells+CheckOrientedShells; the
#                                 OCCT call DISCARDED its result)
#                                 -> occtheal::shellOrientationConsistent (strictly richer)
#   ShapeAnalysis_FreeBounds  (1) Healing.cpp:407 (ctor + GetClosedWires)
#                                 -> occtheal::freeBounds
# Law 9: no capability is deleted — each peer does the same work, proven by the SAME
# tests run against both builds. Measured 2026-07-31, OCCT baseline vs this build:
#   test/healing_smoke.js .................... ALL PASS both, output byte-identical
#   test/native_vs_occt_core.mjs ............. 34/34 both
#   test/native_unify_smoke.mjs .............. all cases both
#   test/ft/ft_unified_edit.mjs 20/20 · test/directedit.mjs 9/9 · test/ft/ft_smoke.mjs ALL PASS
#   13-scenario heal A/B (delete-cap/side/two-opposite/cyl-cap, autofill on closed
#   box+cylinder, harmonize box/cyl/torus/sewn/rebuilt, simplify, autorepair, sew),
#   comparing volume/area/COM/faces/edges/closed/manifold/oriented/chi/genus —
#   byte-identical (torus chi=0 genus=1, so the topology check is not a rubber stamp).
# Object-level proof: Healing.cpp.o imports the 8 OCCT symbols with the option OFF and
# ZERO with it ON, referencing forge::occtheal::{freeBounds, orientSolidOutward,
# solidFromShell, shellOrientationConsistent} instead.
#
# ★ WHAT THIS IS AND IS NOT WORTH — read before scoring it.
#   TKShHealing is NOT removed from OCCT_LIBS here. 12 symbols remain and all of them
#   are blocked on the STEP READER: ShapeFix_Shape x6 (StepReadOcct.cpp:1581, the
#   post-transfer heal — needs pcurve synthesis + ShapeFix_Wire::FixShifted seam
#   reconcile), ShapeAnalysis_Surface x2 (:1239/:1292-3), ShapeAnalysis_Curve x1 (:969),
#   ShapeUpgrade_UnifySameDomain x3 (Healing.cpp:387, DirectEdit.cpp:136 — needs a
#   general OCCT-shape unify; UnifyFaces.cpp covers NativeSolid handles only).
#   ★★ AND EVEN A COMPLETE TKShHealing DROP IS WORTH **ZERO CLOSURE**. Measured
#   2026-07-31: libTKFillet, libTKOffset, libTKBO and libTKBool each DT_NEED
#   libTKShHealing, and all four stay in the process. OCCT_CLOSURE is 14 before this
#   change and 14 after a hypothetical full drop; only OCCT_DIRECT would move 8 -> 7.
#   Per reports/OCCT_CLOSURE_TRUTH.md §4.3 the only unilateral closure win in the build
#   is TKOffset (14 -> 13). This P1 is symbol-surface reduction that makes the eventual
#   TKShHealing drop cheaper — it is NOT a drop and must not be scored as one.
option(FORGE_SHHEAL_DROP_NATIVE
       "route the NON-STEP healing call sites native & compile out the OCCT ShapeFix_Solid/ShapeAnalysis_Shell/ShapeAnalysis_FreeBounds fallback"
       ON)
if(FORGE_NATIVE_BREP AND FORGE_SHHEAL_DROP_NATIVE)
    add_compile_definitions(FORGE_SHHEAL_DROP_NATIVE=1)
    message(STATUS "FORGE_SHHEAL_DROP_NATIVE=ON — ShapeFix_Solid/ShapeAnalysis_Shell/"
                   "ShapeAnalysis_FreeBounds fallbacks compiled out (TKShHealing 20 -> 12 symbols; "
                   "OCCT_CLOSURE UNCHANGED at 14 — see reports/OCCT_CLOSURE_TRUTH.md)")
endif()
# ── TKOffset FAMILY A DROP — BRepOffsetAPI_MakeOffset (landed 2026-07-31) ─────────
# FORGE_OFFSET_DROP_MAKEOFFSET compiles out the OCCT BRepOffsetAPI_MakeOffset branch in
# forge::cam::inwardOffset (src/Cam.cpp, the ONE call site of this class in the whole
# tree) and routes it unconditionally through the in-house
# forge::native::geom::PolygonOffset2D (src/native/geom/PolygonOffset2D.cpp).
# 4 of TKOffset's 42 symbols leave the binary — the complete family:
#   BRepOffsetAPI_MakeOffset::BRepOffsetAPI_MakeOffset(TopoDS_Wire const&, GeomAbs_JoinType, bool)
#   BRepOffsetAPI_MakeOffset::Init(GeomAbs_JoinType, bool)
#   BRepOffsetAPI_MakeOffset::Perform(double, double)
#   vtable for BRepOffsetAPI_MakeOffset
#
# WHY THE CAPABILITY SURVIVES (Law 9). The wire this offsets is never consumed as
# exact geometry: both callers (Cam.cpp profile() and pocket()) immediately discretise
# it with sampleWireXY at kSampleDeflection = 0.05 mm and use only that polyline. The
# native path discretises the INPUT at kSampleDeflection/16 = 3.125e-3 mm, so the
# error it adds is bounded at 1/16 of the tolerance the caller already spends.
# Measured, not asserted — test/cam_native_offset_ab.mjs compares the two paths' final
# 0.05 mm traces on straight, arc, circle, slot and mixed profiles.
#
# ★ WHAT THIS IS WORTH — do not mis-score it. TKOffset is NOT removed from OCCT_LIBS:
#   38 symbols across the other 8 families (ThruSections, MakePipe, MakePipeShell,
#   MakeThickSolid, MakeOffsetShape, DraftAngle, MakeFilling, BRepOffset_MakeOffset)
#   still reference it. OCCT_DIRECT stays 8 and OCCT_CLOSURE stays 14 — MEASURED, both
#   builds, scripts/occt_closure_count.sh. This is blocking-set reduction (42 -> 38)
#   that makes the eventual TKOffset drop — the only unilateral closure win in the
#   build, 14 -> 13 — cheaper. It is NOT a drop.
#
# ★★ DEFAULT **OFF**, AND THE MEASUREMENT THAT DECIDED IT (2026-07-31).
#   The curved-input gap IS closed and the native answer is BETTER where both work:
#   on circle R40 / R12 profiles the native trace is 14.3x / 42.6x CLOSER to the
#   closed-form offset area than the trace OCCT actually delivers (OCCT returns an
#   exact arc, but the consumer then samples it into a 65-gon at 0.05 mm, sagitta
#   0.043 mm). Straight-edge profiles are bit-identical. test/cam_native_offset_ab.mjs.
#
#   BUT the OCCT branch still cannot be compiled out, because PolygonOffset2D DEFERS
#   on real geometry where OCCT succeeds. Measured over the first 382 kernel-verified
#   trees of data/forge/complex_all.jsonl, running cam.profile with a D6 tool and
#   detecting "the offset did not happen" as area(D6) == area(unoffset outline):
#       OCCT   defers  56/382 = 14.7%   (bearing_housing 21, sheet_chassis 31, ribbed_bracket 4)
#       native defers  73/382 = 19.1%   (bearing_housing 21, sheet_chassis 31, ribbed_bracket 21)
#       -> 17 parts (4.5%) where NATIVE defers and OCCT SUCCEEDS; 0 the other way.
#   All 17 are `ribbed_bracket` — an RRECT plate with a fused upstand + gusset and a
#   final FILLET over every edge, so its top-face outer wire is a non-convex mix of
#   fillet-tangent B-splines and torus-derived edges. (PolygonOffset2D is NOT at fault
#   for dense sampling per se: fed a clean rounded rectangle it is stable from 0.05 mm
#   down to 0.00078 mm deflection, 36 -> 236 pts, every case ok=1.)
#
#   Why that forbids the flip (Law 9): cam::profile's documented fallback when
#   inwardOffset returns empty is to re-use the UNOFFSET wire (Cam.cpp:427/529). With
#   the OCCT branch compiled out there is no second chance, so those 17 parts would
#   silently emit a toolpath that is NOT stood off by the tool radius — the cutter
#   would gouge the part by 3 mm, with ok:true. Dropping a library by deleting the
#   capability it provided is exactly what Law 9 forbids.
#
#   TO FLIP THIS ON, the required evidence is: re-run the 382-part sweep above with
#   the option ON and show native defers <= the OCCT baseline rate (i.e. the 17
#   ribbed_bracket wires offset natively), then test/cam_native_offset_ab.mjs ALL PASS
#   + the five cam smokes byte-identical + the four mandated gates green.
option(FORGE_OFFSET_DROP_MAKEOFFSET
       "route cam::inwardOffset through native PolygonOffset2D & compile out the OCCT BRepOffsetAPI_MakeOffset fallback (TKOffset family A; needs PolygonOffset2D to stop deferring on filleted/fused outlines first)"
       OFF)
if(FORGE_NATIVE_BREP AND FORGE_OFFSET_DROP_MAKEOFFSET)
    add_compile_definitions(FORGE_OFFSET_DROP_MAKEOFFSET=1)
    message(WARNING "FORGE_OFFSET_DROP_MAKEOFFSET=ON — BRepOffsetAPI_MakeOffset fallback compiled out "
                    "(TKOffset 42 -> 38 symbols; TKOffset STILL LINKED, OCCT_CLOSURE UNCHANGED at 14). "
                    "MEASURED 2026-07-31: this loses the offset on 17/382 corpus parts (4.5%, all "
                    "ribbed_bracket) where OCCT succeeds — those toolpaths silently revert to the "
                    "UNOFFSET wire. Do not ship this ON until PolygonOffset2D handles filleted/fused "
                    "outlines; see the block above.")
endif()
# ── TKOffset FAMILIES G + H — MakeThickSolid / MakeOffsetShape (authored 2026-08-28) ──
# These two options compile out the two TKOffset classes that share a vtable, and are
# documented together because that vtable is why they must be scored together.
#
#   FORGE_THICKSOLID_DROP_NATIVE  -> forge::part::shell routes UNCONDITIONALLY through
#     forge::occtoffset::makeThickSolid and the BRepOffsetAPI_MakeThickSolid fallback is
#     compiled out.  Removes 3 symbols:
#       BRepOffsetAPI_MakeThickSolid::{MakeThickSolidByJoin, Build, ctor}
#
#   FORGE_OFFSETSHAPE_DROP_NATIVE -> forge::part::offsetSolid routes through
#     forge::occtoffset::offsetSolidShape and the BRepOffsetAPI_MakeOffsetShape fallback
#     is compiled out.  Removes 2 symbols:
#       BRepOffsetAPI_MakeOffsetShape::{PerformByJoin, ctor}
#
#   The 6th symbol, `vtable for BRepOffsetAPI_MakeOffsetShape`, is SHARED: MakeThickSolid
#   derives from MakeOffsetShape and has no vtable of its own, so it leaves the binary
#   ONLY when BOTH options are ON. Either option alone removes 3 or 2; together they
#   remove 6. (reports/TKOFFSET_DECOMPOSITION.md §1 measured this with two minimal TUs.)
#
# ★ WHAT THIS IS WORTH — do not mis-score it. TKOffset is NOT removed from OCCT_LIBS:
#   families B/C/D/E/F/I (MakeFilling, DraftAngle, ThruSections, MakePipe, MakePipeShell,
#   BRepOffset_MakeOffset) still reference 32 of the 38 remaining symbols. OCCT_DIRECT
#   stays 8 and OCCT_CLOSURE stays 14 — MEASURED both ways, scripts/occt_closure_count.sh.
#   This is BLOCKING-SET REDUCTION (38 -> 32) on the one toolkit whose eventual drop is
#   the only unilateral closure win in the build (14 -> 13, reports/OCCT_CLOSURE_TRUTH.md
#   §4.1). It is NOT a drop and must not be scored as one.
#
# ★★ BOTH DEFAULT **OFF**, and off means byte-for-byte the previous behaviour.
#   The native engines are ALWAYS BUILT and, for family H, always TRIED first — a null
#   return is an honest defer that falls through to the untouched OCCT path, so the
#   default build can only gain coverage, never lose it. What the options change is the
#   FALLBACK: with them ON a defer becomes a thrown error. Both engines decline NURBS
#   faces, planar faces carrying a hole, and corners with no exact sharp-join meet, and
#   Law 9 forbids deleting the capability OCCT provides there. The flip gate for G is the
#   corpus A/B in reports/TKOFFSET_DECOMPOSITION.md §5 step 6 ("native success rate >= the
#   measured OCCT baseline"); for H it is the same measurement over the corpus parts that
#   actually call offsetSolid.
#
#   ★★ THAT GATE NOW EXISTS AND BOTH FAMILIES FAIL IT. test/corpus_ab_coverage.cpp,
#   run over all 600 gold reference solids at f71ed98b (reports/CORPUS_AB_COVERAGE.md,
#   raw rows in reports/corpus_ab/):
#       G THICKSOLID   native  1.2% vs OCCT 22.2%   126/600 parts deleted, p=2.4e-38
#       H OFFSETSHAPE  native  1.2% vs OCCT  6.3%    38/600 parts deleted, p=3.1e-6
#   "parts deleted" = OCCT built a result the call site would have accepted and the
#   native engine declined, ON THE SAME INPUT. Under the option that decline becomes a
#   thrown error. Note H's OCCT baseline is only 6.3% and its OCCT arm CRASHED on 66 of
#   600 parts, so the incumbent is weak there too -- H is also the one family where the
#   native engine answers a set OCCT does not (7 native-only against 0 shared).
#
# ★★★ FAMILY G's SIGN BLOCKER IS CLOSED — FIXED AND RE-MEASURED 2026-08-28.
#   The blocker recorded here was REAL: `part.shell` and
#   `forge::occtoffset::makeThickSolid` did not compute the same operation for a
#   positive thickness. OCCT's MakeThickSolidByJoin with offset > 0 grows the wall
#   OUTWARD with the default rounded (GeomAbs_Arc) join; the native engine INSETS the
#   cavity and keeps the outer boundary (NativeThickSolid.hpp: "t>0 offsets the
#   retained faces INWARD"). shell() passed the caller's RAW sign to OCCT and |sign|
#   to both native routes, so one call ran two different ops. On the smoke's own
#   10x10x10 box, shell(remove face 0, |t| = 1) measured
#       OCCT  +1  V = 564.92625 = 500 + 20*pi + 2*pi/3   (OUTWARD, rounded joins;
#                 = box(+)ball(1) 1000+600+30*pi+4*pi/3, minus the cap above the open
#                   face 100+10*pi+2*pi/3, minus the 1000 that became the void),
#                 and the bbox GREW from 10x10x10 to 12x12x11
#       native +1 V = 424.00000 = 1000 - 8*8*9           (the EXACT inward wall)
#   — 33% apart, and answers to different questions.
#
#   THE FIX (src/Features.cpp): shell() and shellMultiThickness() now derive ONE
#   magnitude (`wall` / `baseWall` = |thickness|) and hand each route its own spelling
#   of INWARD — native +wall, OCCT -wall. Inward is the contract every consumer already
#   assumed: ft/FeatureTreeCompiler.cpp opShell passes -|wall| explicitly, the UI/AI
#   bridges document "hollow out a solid", and an outward wall would move the part's
#   outer dimensions, which a shell must never do. The sign of the argument is now
#   IGNORED, so both spellings mean the same hollow (Features.hpp SIGN CONTRACT).
#
#   RE-MEASURED after the fix, all 6 faces of the box, BOTH routes:
#       V = 424.00000 (=1000-8*8*9), A = 888.00000 (=500+352+36), bbox = the ORIGINAL
#       10x10x10, chi = 2, genus = 0; max cross-route disagreement 1.3e-16 relative on
#       volume, 4.4e-15 on the centroid, EXACTLY 0 on the bbox.
#       shellMultiThickness now returns 632.50000 (=1000-7.5*7*7) instead of 1023.049.
#   test/part_features_smoke.js no longer asserts `volume > 0` on either entry point:
#   it asserts both routes against those closed forms AND against each other on volume,
#   topology (chi/genus of the welded tessellation) and position (centroid + bbox), and
#   carries negative controls — equal-volume shapes differing only in extent, only in
#   position, and only in genus — that the comparator must reject. Proven able to fail:
#   restoring the +wall sign makes it red with "shell f0 occt volume vs 1000-8*8*9: got
#   564.926248"; a 1.05x native-side mutation makes it red with 441.430500.
#
#   WHAT THIS DOES *NOT* CLEAR: FORGE_THICKSOLID_DROP_NATIVE stays OFF. The two routes
#   now agree wherever both answer, but the flip gate is still the corpus A/B of
#   reports/TKOFFSET_DECOMPOSITION.md §5 step 6 ("native success rate >= the measured
#   OCCT baseline"), which is a COVERAGE measurement. ★ IT IS NO LONGER OUTSTANDING:
#   it is test/corpus_ab_coverage.cpp and family G MEASURES 1.2% native against a 22.2%
#   OCCT baseline over all 600 gold reference solids, 126 parts deleted (p=2.4e-38).
#   See reports/CORPUS_AB_COVERAGE.md. The reason recorded below is exactly what the
#   corpus shows at scale — the
#   native engine honestly DECLINES cases OCCT answers (e.g. the closed-hollow box:
#   shellNativeThick throws where the OCCT route returns, wrongly, the 512 cavity). Family H has no such problem: its A/B matches
#   OCCT exactly on volume, position and topology across all nine cases.
#
#   EQUIVALENCE EVIDENCE FOR H (test/run_ab_native_offsetshape.sh, 206/206 assertions,
#   2026-08-28): box grow+shrink, right-triangular prism, NON-CONVEX L-prism grow+shrink,
#   capped cylinder grow+shrink, sphere, torus, cone frustum — each asserting native ==
#   OCCT on VOLUME and on CENTRE OF MASS and on all six BOUNDING-BOX bounds and on
#   face/edge/vertex/shell counts and shell closure and BRepCheck_Analyzer validity, plus
#   native == an INDEPENDENT CLOSED FORM wherever one exists (OCCT is not a trustworthy
#   oracle for this family — §4.2 measured MakeThickSolid returning the cavity with
#   IsDone()==true). The same script asserts the ENGINE OBJECT FILE imports ZERO TKOffset
#   symbols, and carries a NEGATIVE CONTROL: two solids whose volumes agree to 1e-16 and
#   whose geometry does not, which the same comparator must REJECT — a volume match
#   proves nothing on its own.
option(FORGE_THICKSOLID_DROP_NATIVE
       "route part::shell through the native thick-solid & compile out the OCCT BRepOffsetAPI_MakeThickSolid fallback (TKOffset family G)"
       OFF)
option(FORGE_OFFSETSHAPE_DROP_NATIVE
       "route part::offsetSolid through the native whole-solid offset & compile out the OCCT BRepOffsetAPI_MakeOffsetShape fallback (TKOffset family H)"
       OFF)
if(FORGE_NATIVE_BREP AND FORGE_THICKSOLID_DROP_NATIVE)
    add_compile_definitions(FORGE_THICKSOLID_DROP_NATIVE=1)
    message(WARNING "FORGE_THICKSOLID_DROP_NATIVE=ON — BRepOffsetAPI_MakeThickSolid fallback compiled out "
                    "(TKOffset family G, 3 symbols). TKOffset STILL LINKED and OCCT_CLOSURE UNCHANGED at 14. "
                    "A shape the native thick-solid declines now THROWS instead of falling back to OCCT.")
endif()
if(FORGE_NATIVE_BREP AND FORGE_OFFSETSHAPE_DROP_NATIVE)
    add_compile_definitions(FORGE_OFFSETSHAPE_DROP_NATIVE=1)
    message(WARNING "FORGE_OFFSETSHAPE_DROP_NATIVE=ON — BRepOffsetAPI_MakeOffsetShape fallback compiled out "
                    "(TKOffset family H, 2 symbols; +1 shared vtable when family G is dropped too). "
                    "TKOffset STILL LINKED and OCCT_CLOSURE UNCHANGED at 14. A shape the native offset "
                    "declines now THROWS instead of falling back to OCCT.")
endif()

# ── TKOffset FAMILIES D + F — ThruSections / MakePipeShell (authored 2026-08-28) ──
# The two options below compile out the last two BRepOffsetAPI_ classes that have a
# native OCCT-typed replacement, src/native/brep/NativeLoftPipe.cpp:
#
#   FORGE_THRUSECTIONS_DROP_NATIVE -> forge::part::loft, forge::part::loftWithGuides
#       (no-guides branch), forge::airfoil::loftWing, forge::makePyramid and
#       forge::loftguide::loft route UNCONDITIONALLY through
#       forge::occtloft::thruSections and the OCCT BRepOffsetAPI_ThruSections
#       fallback is COMPILED OUT.  Family D = 6 symbols
#       (ctor(bool,bool,double), AddWire, AddVertex, CheckCompatibility, Build,
#        vtable) — all 5 call sites must be guarded or none of them leave.
#
#   FORGE_PIPESHELL_DROP_NATIVE    -> forge::part::sweep (guided branch),
#       forge::part::sweepWithGuides and forge::classa::sweepWithGuides route
#       through forge::occtloft::pipeShell and the OCCT
#       BRepOffsetAPI_MakePipeShell fallback is COMPILED OUT.  Family F = 7
#       symbols (ctor(Wire), Add(Shape,bool,bool), SetMode(bool),
#       SetMode(Wire,bool,BRepFill_TypeOfContact), MakeSolid, Build, vtable).
#
# Unlike families G/H these two share NO symbol with each other or with any other
# family (reports/TKOFFSET_DECOMPOSITION.md §1 measured that with minimal TUs), so
# D alone removes exactly 6 and F alone exactly 7.
#
# ★ WHAT THIS IS WORTH — do not mis-score it. TKOffset is NOT removed from
#   OCCT_LIBS here and OCCT_CLOSURE does NOT move. MEASURED 2026-08-28 on the
#   committed tree, with the per-TU symbol census (tools/occt_symbol_census.sh
#   validated against the built .node):
#       baseline                     38 TKOffset symbols
#       + D + F dropped              25   (-13)
#       + G + H dropped as well      19   (-6 more)
#   The remaining 19 belong to families B (MakeFilling, 5), C (DraftAngle, 6),
#   E (MakePipe, 3) and I (BRepOffset_MakeOffset, 5). ALL 38 must be gone before
#   the link record moves at all, so these options are worth ZERO closure on
#   their own — they shorten the remaining distance, they do not travel it.
#
# ★ BOTH DEFAULT OFF, and the reason is coverage, not compilation. The native
#   engine is EXACT on what it accepts (242/242 A/B assertions against live OCCT
#   on volume + centre of mass + bounding box + face/edge/vertex/shell counts +
#   validity, plus independent closed forms, plus a negative control and five
#   defer controls — forge-kernel/test/run_ab_native_loftpipe.sh) but its scope is
#   POLYGONAL sections and POLYLINE spines with PLANAR lateral quads. A smoothed
#   multi-station wing skin, a spline section and every GUIDED sweep are honest
#   defers, and with the fallback compiled out a defer becomes a THROWN ERROR
#   rather than an OCCT answer. The flip gate is a corpus A/B — "native success
#   rate >= the measured OCCT baseline" — exactly as for families G/H.
#
#   ★★ THAT CORPUS A/B NOW EXISTS AND BOTH FAMILIES FAIL IT, D by the widest
#   margin of any family measured. test/corpus_ab_coverage.cpp over all 600 gold
#   reference solids at f71ed98b (reports/CORPUS_AB_COVERAGE.md):
#       D THRUSECTIONS  native 0.0% vs OCCT 94.5%   567/600 parts deleted, p=4.1e-171
#       F PIPESHELL     native 51.5% vs OCCT 100%   291/600 parts deleted, p=5.0e-88
#   ★★ THE READING OF THE D ROW RECORDED HERE WAS WRONG AND IS RETRACTED. It said
#   "D returned a defer on all 600 -- the corpus has essentially no polygonal sections,
#   which is the scope this engine states." MEASURED per-part defer census over the same
#   600: 309 of them present TWO 4-VERTEX ALL-LINE-EDGE polygon sections, i.e. the corpus
#   is 51.5% polygonal, not "essentially no polygonal sections". Those 309 were declined
#   for a reason inside this engine (raw wire-explorer index pairing, no reorient/
#   re-origin), and on every one of the 309 a correspondence exists under which all four
#   lateral quads are planar. With NativeLoftPipe.cpp::canonicalRing supplying the missing
#   step, D RE-MEASURES 51.5% vs OCCT 94.5%, 258/600 deleted, p=4.3e-78, with all 309
#   both-build parts agreeing with OCCT on the full observable vector. The gate is still
#   FAILED, but by 258 CURVED-section parts (circle 232, B-spline 106) rather than by 567.
#   THE LESSON, and it is the reason this paragraph is kept rather than replaced: a 0/600
#   was read as a statement about the CORPUS when it was a statement about the ENGINE. A
#   family that scores exactly zero deserves a per-part cause census before its number is
#   quoted as a capability bound.
#   F is the best-covered of the sweep family and
#   the only one within sight of the gate. Family E (PIPE, below) measures native 0.3%
#   against OCCT 100%, 598/600 deleted.
#   ALSO MEASURED, and not a coverage fact: on ALL 309 parts where F and OCCT both
#   build, the two solids DISAGREE on volume and extent (not merely on orientation).
#   The mitre-transport difference this header records is not an edge case; it is
#   every part.
#
# ★ ONE MEASURED CAPABILITY ADD, recorded here because it repeats the §4.2
#   pattern: on a BENT spine OCCT's own MakePipeShell answer is INVALID.
#   Measured, profile = the 10x10 square centred in z=0, spine
#   (0,0,0)->(0,0,30)->(20,0,30): OCCT returns volume 2400 with
#   BRepCheck_Analyzer == false, where a rigid mitred sweep of a 100 mm^2 section
#   along a 50 mm spine encloses exactly 5000. The native engine returns 5000 and
#   a VALID closed solid. OCCT is therefore not used as an oracle for that case;
#   the A/B proves it against the closed form and asserts OCCT's invalidity so
#   the claim is on the record.
option(FORGE_THRUSECTIONS_DROP_NATIVE
       "route the five loft call sites through the native ruled loft & compile out the OCCT BRepOffsetAPI_ThruSections fallback (TKOffset family D, 6 symbols)"
       OFF)
option(FORGE_PIPESHELL_DROP_NATIVE
       "route the three pipe-shell call sites through the native pipe-shell & compile out the OCCT BRepOffsetAPI_MakePipeShell fallback (TKOffset family F, 7 symbols)"
       OFF)
if(FORGE_NATIVE_BREP AND FORGE_THRUSECTIONS_DROP_NATIVE)
    add_compile_definitions(FORGE_THRUSECTIONS_DROP_NATIVE=1)
    message(WARNING "FORGE_THRUSECTIONS_DROP_NATIVE=ON — BRepOffsetAPI_ThruSections fallback compiled out "
                    "(TKOffset family D, 6 symbols: 38 -> 32). TKOffset STILL LINKED and OCCT_CLOSURE "
                    "UNCHANGED at 14. A loft the native engine declines now THROWS instead of falling "
                    "back to OCCT.")
endif()
if(FORGE_NATIVE_BREP AND FORGE_PIPESHELL_DROP_NATIVE)
    add_compile_definitions(FORGE_PIPESHELL_DROP_NATIVE=1)
    message(WARNING "FORGE_PIPESHELL_DROP_NATIVE=ON — BRepOffsetAPI_MakePipeShell fallback compiled out "
                    "(TKOffset family F, 7 symbols: 38 -> 31). TKOffset STILL LINKED and OCCT_CLOSURE "
                    "UNCHANGED at 14. EVERY GUIDED sweep now THROWS — the native engine has no guided "
                    "pipe-shell and never pretends to.")
endif()

# ── TKOffset FAMILY E — BRepOffsetAPI_MakePipe (authored 2026-08-28) ──────────────
# Routes the THREE MakePipe call sites in src/Features.cpp —
#   forge::part::sweep (unguided branch, :674), pipeFromPolyline (:761),
#   sweepPolyline (:856)
# — through forge::occtloft::pipe (src/native/brep/NativeLoftPipe.cpp) and compiles
# out the OCCT baseline, removing the complete family:
#   BRepOffsetAPI_MakePipe::BRepOffsetAPI_MakePipe(TopoDS_Wire const&, TopoDS_Shape const&)
#   BRepOffsetAPI_MakePipe::Build(Message_ProgressRange const&)
#   vtable for BRepOffsetAPI_MakePipe                                   (3 symbols)
#
# METHOD, NAMED: the polygon path is the double-reflection rotation-minimizing frame
# of Wang, Juttler, Zheng & Liu, "Computation of Rotation Minimizing Frames",
# ACM TOG 27(1), 2008, specialised to a polyline spine — where the two reflections
# compose to a single reflection in the leg-bisecting (MITRE) plane. A Frenet frame
# is deliberately NOT used: its normal is undefined on a straight leg and flips
# through an inflection. The circle path is a chain of mitre-trimmed right circular
# cylinders, every surface analytic — no tessellation, no polygonal approximation.
#
# ★ WHAT THIS IS WORTH — do not mis-score it. TKOffset is NOT removed from OCCT_LIBS
#   by this option and OCCT_CLOSURE does NOT move. MEASURED 2026-08-28 on real
#   linked binaries built in this worktree:
#       baseline (every drop OFF)                          42 TKOffset symbols
#       + families A, G, H, D, F (the options that existed) 19 symbols, CLOSURE 14
#       + family E (this option)                           16 symbols, CLOSURE 14
#   TKOffset's link record moves only when ALL 42 are gone. What still holds it in
#   after family E is three classes with no native engine:
#       BRepOffset_MakeOffset      5   src/Features.cpp    thickenSurface
#       BRepOffsetAPI_DraftAngle   6   src/Features.cpp    draftFaces
#       BRepOffsetAPI_MakeFilling  5   src/Healing.cpp     autoFillMissingFaces
#
# PROOF: forge-kernel/test/run_ab_native_loftpipe.sh, 493/493 assertions (314 when this
#   paragraph was written, 431 after the ring-correspondence fix, 493 after the
#   translated-section path added ts-xlate-cylinder / -cyl-open / -obround and the
#   unequal-circles defer control) — volume AND
#   centre of mass AND all six bbox bounds AND face/edge/vertex/shell counts AND
#   BRepCheck_Analyzer validity AND the Euler-Poincare characteristic, against LIVE
#   OCCT on straight spines and against the closed form V = area * spine-length on
#   bent ones. OCCT MakePipe is a VALID ORACLE ONLY ON A SINGLE-SEGMENT SPINE: on
#   every bent polyline spine it was measured to return only the FIRST leg's volume
#   (2500 vs 5500; 1256.637 vs 2764.602) and is often BRepCheck-INVALID, so the A/B
#   asserts that error rather than treating it as truth. The gate is proved able to
#   FAIL by two mutations of the engine, one of which is volume-preserving and is
#   caught only by centre of mass and bbox.
option(FORGE_PIPE_DROP_NATIVE
       "route the three MakePipe call sites through the native pipe & compile out the OCCT BRepOffsetAPI_MakePipe fallback (TKOffset family E, 3 symbols)"
       OFF)

# ── TKOffset FAMILY C — BRepOffsetAPI_MakeFilling (authored 2026-08-28) ───────────
# Routes the free-wire cap in forge::heal::autoFillMissingFaces (src/Healing.cpp)
# through forge::occtfill::fillC0Boundary (src/native/brep/NativeFilling.cpp) and
# compiles out the OCCT baseline, removing the complete family:
#   BRepOffsetAPI_MakeFilling::BRepOffsetAPI_MakeFilling(int,int,int,bool,double,
#                                                        double,double,double,int,int)
#   BRepOffsetAPI_MakeFilling::Add(TopoDS_Edge const&, GeomAbs_Shape, bool)
#   BRepOffsetAPI_MakeFilling::Build(Message_ProgressRange const&)
#   BRepOffsetAPI_MakeFilling::IsDone() const
#   vtable for BRepOffsetAPI_MakeFilling                                (5 symbols)
#
# WHY THIS IS EXACTLY SOLVABLE. The call site adds every boundary edge with
# GeomAbs_C0 and adds NOTHING else — no tangency, no interior constraint. For a
# PLANAR boundary the patch meeting that specification is the plane region the wire
# encloses, representable exactly as a Geom_Plane face trimmed by the wire itself.
#
# ★ THE NATIVE ANSWER IS STRICTLY MORE ACCURATE THAN OCCT'S, measured 2026-08-28:
#   OCCT returns a B-SPLINE approximation. On a circle of radius 5 its area is
#   78.5398651991 against the exact pi r^2 = 78.5398163397 — wrong in the 7th
#   significant figure (6.2e-7 relative) — and its face bounding box OVERSHOOTS the
#   trimmed region because the supporting surface extends past the trim. The native
#   cap's area is exact to 1e-12 and its bbox equals its boundary's exactly.
#   The A/B therefore uses OCCT as the oracle only on POLYGONAL boundaries, where
#   the two agree to 1e-9, and the CLOSED FORM on curved ones, asserting OCCT's
#   error rather than inheriting it.
#
# ★ A DEFER HERE IS SAFE, unlike families D/E/F. autoFillMissingFaces already wraps
#   its filling attempt in try/catch and SKIPS any wire it cannot fill, leaving it a
#   residual open edge in AutoFillReport. So under this drop a non-planar wire takes
#   exactly the path a failed OCCT filling already takes today — the drop cannot turn
#   a fillable hole into a thrown error. No call site loses a capability it had.
#
# ★ WHAT THIS IS WORTH — do not mis-score it. TKOffset is NOT removed from OCCT_LIBS
#   and OCCT_CLOSURE does NOT move. MEASURED on real linked binaries:
#       + A, G, H, D, F                 19 TKOffset symbols, CLOSURE 14
#       + E                             16 symbols,          CLOSURE 14
#       + C (this option)               11 symbols,          CLOSURE 14
#   What still holds TKOffset in after C is 11 symbols in two classes with no native
#   engine: BRepOffset_MakeOffset (5, thickenSurface) and BRepOffsetAPI_DraftAngle
#   (6, draftFaces).
#
# PROOF: forge-kernel/test/run_ab_native_filling.sh, 80/80 assertions — area AND
#   centre of mass AND bbox AND face/edge/vertex counts AND validity AND the SURFACE
#   TYPE, plus a whole-solid end-to-end (cap a box missing its top face, sew, promote
#   to a solid: volume 1000 exactly, com (5,5,5), 6/12/8, Euler 2, valid), plus a
#   NEGATIVE CONTROL rejecting two faces of equal area, plus four defer controls.
#   The gate is proved able to FAIL by mutation: endpoint-only curve sampling, a
#   widened planarity tolerance, and a disabled positive-area guard each turn it red.
#   The tolerance mutation initially did NOT — BRepBuilderAPI_MakeFace's own
#   planarity check (threshold measured between 1e-6 and 1e-5) was masking it — so a
#   TOLERANCE CONTROL was added that asserts MakeFace accepts a boundary 1e-7 off
#   plane while the engine at tol=1e-9 declines it. That control is what makes the
#   engine's own residual test provably load-bearing.
option(FORGE_FILLING_DROP_NATIVE
       "route the free-wire cap in autoFillMissingFaces through the native planar fill & compile out the OCCT BRepOffsetAPI_MakeFilling fallback (TKOffset family C, 5 symbols)"
       OFF)

# ─────────────────────────────────────────────────────────────────────────────────
# ── TKOffset FAMILIES I + J — the last two, and the toolkit's link record ────────
# ─────────────────────────────────────────────────────────────────────────────────
# These are the two families the "WHAT IS LEFT" banner used to describe as open.
# With every option in this file ON they take TKOffset 11 -> 0 symbols, which is
# what finally lets the toolkit leave OCCT_LIBS.
#
# ── family I: BRepOffset_MakeOffset, 5 symbols, src/Features.cpp thickenSurface ──
#   Skin an OPEN shell to a solid of wall thickness t. Engine:
#   src/native/brep/NativeThickenShell.cpp (forge::occtthicken::thickenShell).
#
#   METHOD, NAMED: offsetting with the ARC join is the Minkowski sum of the shell
#   with a ball of radius |t| restricted to one side — Rossignac & Requicha,
#   "Offsetting operations in solid modelling", CAGD 3(2):129-148, 1986. For a
#   polyhedral input that decomposes EXACTLY into the union of per-face prisms,
#   plus a cylindrical wedge of radius |t| along every CONVEX edge, plus a
#   spherical wedge at every CONVEX vertex. At a CONCAVE edge the prisms already
#   overlap and the union alone is exact.
#
#   ★ THE DECOMPOSITION WAS MEASURED, NOT ASSUMED. Live OCCT at |t| = 2:
#       shell                          OCCT volume    fuse-of-prisms
#       single planar face 20x10          400            400   MATCH
#       L shell, t=+2 (concave corner)    560            560   MATCH
#       L shell, t=-2 (convex corner)     631.4159265    600   MISMATCH
#       U shell, t=+2 (two convex)        862.8318531    800   MISMATCH
#     631.4159265 - 600 = 10*pi and 862.8318531 - 800 = 20*pi — quarter-cylinders
#     of radius 2 and length 10, one per convex edge. The MATCH rows are exactly
#     the cases with no convex edge.
#
#   ★ OCCT IS A VALID ORACLE HERE, unlike MakePipe / MakePipeShell / MakeThickSolid
#     (see the family D/E/F/G banners): every probe returned a BRepCheck-VALID
#     solid. So this family is proved by direct A/B, not against a closed form
#     alone — though the closed form is asserted too.
#
#   PROOF: forge-kernel/test/run_ab_native_thicken.sh, 202/202 assertions — volume
#     AND centre of mass AND all six bbox bounds AND face/edge/vertex/shell counts
#     AND the surface-type inventory AND BRepCheck validity AND the Euler
#     characteristic, on the flat / L / U shells at BOTH offset signs and at two
#     thicknesses, against live OCCT and against the closed forms above; plus an
#     equal-volume NEGATIVE CONTROL (rejected on 12 observables) and four defer
#     controls whose exact defer REASON string is asserted.
#     ★ TOPOLOGY IS COMPARED AFTER CANONICALISING BOTH SIDES. Face count is a
#       property of the representation, not the geometry: OCCT keeps its
#       per-original-face rim quads (10 faces concave / 13 convex on the L) while
#       the native fuse is already merged (8 / 9). The same
#       ShapeUpgrade_UnifySameDomain over both gives 8/18/12 and 9/21/14 —
#       identical, same plane/cylinder inventory. The raw counts are printed too,
#       so the difference is reported rather than hidden.
#
# ── family J: BRepOffsetAPI_DraftAngle, 6 symbols, src/Features.cpp draftFaces ───
#   Tilt selected faces about their intersection line with a neutral plane.
#   Engine: src/native/brep/NativeDraft.cpp (forge::occtdraft::draftFaces).
#
#   METHOD, NAMED: the half-space arrangement edit of a polyhedron — a planar-faced
#   solid is determined by its face planes plus its incidence, and each vertex is
#   the meet of its incident planes (Preparata & Shamos, Computational Geometry,
#   ch. 7, plane/vertex duality). Draft replaces the plane of each selected face by
#   that plane ROTATED about its neutral-plane intersection line and re-derives
#   every vertex. No face is added, deleted or re-typed. The corner solve is
#   NativeThickSolid.cpp's intersectPlanes, reused verbatim — exactly the reuse the
#   old banner pointed at.
#
#   ★ THE SIGN WAS MEASURED. The first A/B run used theta = -angle and every case
#     came back MIRRORED (cube 5 deg: 1185.18 grown against OCCT's 835.23 shrunk).
#     BRepOffsetAPI_DraftAngle's convention is theta = +angle.
#
#   PROOF: forge-kernel/test/run_ab_native_draft.sh, 114/114 assertions — the same
#     observable set as family I, over five cases: the canonical cube's four side
#     walls (also checked against the frustum closed form
#     V = (L^3 - (L-2 t L)^3)/(6 t), derived not borrowed), a single asymmetric
#     wall, two opposite walls about a MID-HEIGHT neutral plane (volume-preserving
#     — the case that makes centre of mass and bbox load-bearing), a NEGATIVE
#     angle, and a non-axis-aligned pull direction; plus an equal-volume negative
#     control and six defer controls.
#
# ── the gates are PROVED ABLE TO FAIL ────────────────────────────────────────────
#   forge-kernel/test/run_ab_tkoffset_mutations.sh, 12/12: eight mutations of the
#   ENGINES (never the tests), each required to turn its A/B red, then restored and
#   required green again. Two are deliberately VOLUME-PRESERVING — the draft sign
#   flip on the mid-height pivot case, and the flat prism's direction flip — and
#   are caught only by centre of mass and bounding box. One mutation (widening the
#   draft's exactness guard) is required to stay GREEN, proving the guard rejects
#   nothing the supported cases need. A mutant that fails to COMPILE is reported as
#   NOBUILD and never counted as a kill; two mutants in the first draft did exactly
#   that (an unused variable under -Werror) and were rewritten.
option(FORGE_THICKEN_DROP_NATIVE
       "route part::thickenSurface through the native shell thicken & compile out the OCCT BRepOffset_MakeOffset fallback (TKOffset family I, 5 symbols)"
       OFF)
option(FORGE_DRAFT_DROP_NATIVE
       "route part::draftFaces through the native TopoDS draft & compile out the OCCT BRepOffsetAPI_DraftAngle fallback (TKOffset family J, 6 symbols)"
       OFF)
if(FORGE_NATIVE_BREP AND FORGE_THICKEN_DROP_NATIVE)
    add_compile_definitions(FORGE_THICKEN_DROP_NATIVE=1)
    message(WARNING "FORGE_THICKEN_DROP_NATIVE=ON — BRepOffset_MakeOffset fallback compiled out "
                    "(TKOffset family I, 5 symbols). A shell the native thicken declines — a "
                    "curved face, a curved fold, a non-manifold edge, or a convex fold ending at "
                    "a 3-or-more-plate corner — now THROWS, quoting the engine's own defer "
                    "reason, instead of falling back to OCCT.")
endif()
if(FORGE_NATIVE_BREP AND FORGE_DRAFT_DROP_NATIVE)
    add_compile_definitions(FORGE_DRAFT_DROP_NATIVE=1)
    message(WARNING "FORGE_DRAFT_DROP_NATIVE=ON — BRepOffsetAPI_DraftAngle fallback compiled out "
                    "(TKOffset family J, 6 symbols). A solid the native draft declines — a "
                    "non-planar face, a face with a hole, or a selected face parallel to the "
                    "neutral plane — now THROWS instead of falling back to OCCT. NOTE the native "
                    "MESH-BRIDGE draft for NativeSolid handles earlier in draftFaces is "
                    "untouched; this is the OCCT-backed-handle path only.")
endif()

# ─────────────────────────────────────────────────────────────────────────────────
# ── ★ THE TKOffset LINK RECORD ──────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────────
# TKOffset leaves OCCT_LIBS only when EVERY family that calls it is compiled out.
# Dropping it earlier would not remove the dependency — on macOS the .node links
# `-undefined dynamic_lookup`, so a still-referenced toolkit simply becomes a
# PHANTOM: it keeps loading, OCCT_CLOSURE is unchanged, and only the cosmetic
# OCCT_DIRECT count falls. That is the precise failure mode
# forge-kernel/scripts/occt_closure_count.sh exists to expose, and this block
# refuses to cause it.
#
# The condition is therefore ALL of the families, enumerated so a future family
# cannot be forgotten: adding one to this list is what keeps the drop honest.
set(_FORGE_TKOFFSET_FAMILIES
    FORGE_OFFSET_DROP_MAKEOFFSET    # A  BRepOffsetAPI_MakeOffset      Cam.cpp
    FORGE_FILLING_DROP_NATIVE       # C  BRepOffsetAPI_MakeFilling     Healing.cpp
    FORGE_THRUSECTIONS_DROP_NATIVE  # D  BRepOffsetAPI_ThruSections    5 call sites
    FORGE_PIPE_DROP_NATIVE          # E  BRepOffsetAPI_MakePipe        Features.cpp
    FORGE_PIPESHELL_DROP_NATIVE     # F  BRepOffsetAPI_MakePipeShell   3 call sites
    FORGE_THICKSOLID_DROP_NATIVE    # G  BRepOffsetAPI_MakeThickSolid  Features.cpp
    FORGE_OFFSETSHAPE_DROP_NATIVE   # H  BRepOffsetAPI_MakeOffsetShape Features.cpp
    FORGE_THICKEN_DROP_NATIVE       # I  BRepOffset_MakeOffset         Features.cpp
    FORGE_DRAFT_DROP_NATIVE         # J  BRepOffsetAPI_DraftAngle      Features.cpp
)
set(_forge_tkoffset_open "")
foreach(_fam IN LISTS _FORGE_TKOFFSET_FAMILIES)
    if(NOT ${_fam})
        list(APPEND _forge_tkoffset_open ${_fam})
    endif()
endforeach()
if(FORGE_NATIVE_BREP AND NOT _forge_tkoffset_open)
    list(REMOVE_ITEM OCCT_LIBS TKOffset)
    message(WARNING
        "★ TKOffset REMOVED FROM OCCT_LIBS — every family A,C,D,E,F,G,H,I,J is compiled out. "
        "This is the first OCCT toolkit whose LINK RECORD the programme has been able to "
        "remove on the strength of native replacements rather than by hiding it behind "
        "another library. Verify with: bash forge-kernel/scripts/occt_closure_count.sh "
        "<binary> — OCCT_CLOSURE must FALL, and OCCT_PHANTOM must NOT rise (a phantom would "
        "mean a TU still calls TKOffset and dynamic_lookup is masking it).")
else()
    message(STATUS "TKOffset KEPT on the link line — still called by: ${_forge_tkoffset_open}")
endif()
if(FORGE_NATIVE_BREP AND FORGE_FILLING_DROP_NATIVE)
    add_compile_definitions(FORGE_FILLING_DROP_NATIVE=1)
    message(WARNING "FORGE_FILLING_DROP_NATIVE=ON — BRepOffsetAPI_MakeFilling fallback compiled out "
                    "(TKOffset family C, 5 symbols: 16 -> 11). TKOffset STILL LINKED and "
                    "OCCT_CLOSURE UNCHANGED at 14. A NON-PLANAR free wire is now SKIPPED rather "
                    "than capped — the same path a failed OCCT filling already takes, reported "
                    "honestly in AutoFillReport.openEdgesAfter.")
endif()
if(FORGE_NATIVE_BREP AND FORGE_PIPE_DROP_NATIVE)
    add_compile_definitions(FORGE_PIPE_DROP_NATIVE=1)
    message(WARNING "FORGE_PIPE_DROP_NATIVE=ON — BRepOffsetAPI_MakePipe fallback compiled out "
                    "(TKOffset family E, 3 symbols: 19 -> 16). TKOffset STILL LINKED and "
                    "OCCT_CLOSURE UNCHANGED at 14. A sweep the native pipe declines — a curved "
                    "spine, a non-perpendicular profile plane, a profile that is neither a polygon "
                    "nor a circle — now THROWS instead of falling back to OCCT.")
endif()
# OCCT-zero progress (2026-07-25, R1+R2 → TKGeomBase): DROPPED TKGeomBase. 10 -> 9 OCCT dylibs.
#   (TKGeomBase still loads transitively — TKBRep/TKG3d/TKGeomAlgo DT_NEED it — but the .node
#   no longer LINKS it directly.)
#   TKGeomBase's 4 remaining EXCLUSIVE symbols (GeomConvert::Curve/SurfaceToBSplineCurve/Surface +
#   the Extrema_GenExtPS / Extrema_PCFOfEPCOfExtPC2d pulled transitively through
#   GeomAPI_ProjectPointOnSurf / Geom2dAPI_ProjectPointOnCurve) are now served by the in-house
#   R1 (forge::occtproj point→surface / point→curve-2d Gauss-Newton, NativeProjection.cpp) and
#   R2 (forge::occtconv analytic→NURBS + points→NURBS lsq fit, NativeNurbsConvert.cpp) routines.
#   Every call site is switched behind FORGE_NATIVE_PROJECTION / FORGE_NATIVE_NURBS_CONVERT
#   (default-ON below) with the OCCT symbol kept compiled under the #else fallback for revert.
#   Verified keep-if-green: otool libTK 10->9, libTKGeomBase gone; nm -u | grep
#   GeomConvert|Extrema_GenExtPS|Extrema_PCFOfEPCOfExtPC2d == 0; occt_drop_gate TKGeomBase
#   EXCLUSIVE=0. NB: TKGeomAlgo is KEPT (still linked) — GeomAPI_ProjectPointOnSurf lives there;
#   we only removed OUR object files' references to the Extrema symbols it inlines.
#
# R1/R2 native geometry routines are the DEFAULT (drop-enabling) path, coupled to the
# FORGE_NATIVE_BREP master switch. Both NativeProjection.cpp AND NativeNurbsConvert.cpp are
# OCCT-boundary native files wrapped in `#ifdef FORGE_NATIVE_BREP` (so the OCCT-free
# run_native.sh harness skips them). Defining the call-site gates only when FORGE_NATIVE_BREP
# is ON guarantees `#ifdef FORGE_NATIVE_PROJECTION` at a call site implies forge::occtproj:: is
# actually compiled — no undefined-symbol landmine for a -DFORGE_NATIVE_BREP=OFF build.
# A/B toggle (default ON = the drop). -DFORGE_GEOM_DROP_NATIVE=OFF rebuilds the OCCT
# GeomConvert/GeomAPI_Project* fallback for an apples-to-apples baseline on the STEP
# round-trip battery (proves the native routines match OCCT before removing TKGeomBase).
option(FORGE_GEOM_DROP_NATIVE "use R1/R2/R3 native geom routines; OFF=OCCT A/B baseline" ON)
if(FORGE_NATIVE_BREP AND FORGE_GEOM_DROP_NATIVE)
    # R1/R2/R3 (TKGeomBase drop + TKGeomAlgo drop, both landed): GeomAPI::To2d/To3d,
    # GeomAPI_PointsToBSpline, GeomFill_NSections (occtconv/occtfill) and Law_Linear/Law_S
    # (occtlaw/NativeLaw.cpp) are routed native and VERIFIED equivalent to OCCT (STEP
    # round-trip A/B within tessellation tol; varfillet Law exact; trapezoidalWing loft).
    # Each call site keeps the OCCT symbol under #else for a -DFORGE_GEOM_DROP_NATIVE=OFF A/B.
    #
    # OCCT-zero progress (2026-07-25, R2 → TKGeomAlgo): DROPPED TKGeomAlgo. 9 -> 8 OCCT dylibs.
    #   The last 6 exclusive TKGeomAlgo symbols were GeomAPI_PointsToBSpline (ctor + Curve())
    #   and GeomFill_NSections (ctor + ComputeSurface + BSplineSurface + vtable), at
    #   src/Airfoil.cpp (profileToFace / stationToWorldWire), src/Features.cpp (loftWithGuides).
    #   PointsToBSpline is now forge::occtconv::pointsToBSpline — a BOUNDED, overshoot-guarded
    #   least-squares fit: the earlier native fit was correct AS A CURVE but its ill-conditioned
    #   n≈r normal-equation control net spiked poles >7e4 mm off a 200 mm airfoil, and
    #   BRepOffsetAPI_ThruSections (which interpolates POLES across stations) ballooned the
    #   trapezoidalWing loft 3.2x (5.11e6 vs OCCT 1.59e6). The sane-net guard rejects spiking
    #   fits and keeps the largest bounded net → loft = 1.588e6 (0.06% of OCCT 1.588912e6).
    #   GeomFill_NSections is now forge::occtfill::sectionFillSurface (P&T ch.10.3 skinned
    #   surface, src/native/brep/NativeSectionFill.cpp). Verified keep-if-green: occt_drop_gate
    #   TKGeomAlgo EXCLUSIVE=0; nm -u | grep PointsToBSpline|GeomFill_NSections == 0; airfoil
    #   trapezoidalWing 1.588e6; core 34/34; directedit 9/9; part_features / mold / weldments PASS.
    #   Linux run_native.sh CI (ubuntu strict-link) is the ultimate gate.
    add_compile_definitions(FORGE_NATIVE_PROJECTION=1 FORGE_NATIVE_NURBS_CONVERT=1
                            FORGE_NATIVE_LAW=1)
endif()
# OCCT-zero progress (2026-07-21, K-PRIM): dropped TKPrim. 11 -> 10 OCCT dylibs.
#   The canonical primitive SOLIDS (box/cylinder/cone/sphere/torus/wedge) were already
#   TKPrim-free (OcctPrimBuilder analytic Geom_ + BRepBuilderAPI, commit 20849c16). This
#   drop retires the LAST TKPrim consumers — the linear/rotational SWEEPS of arbitrary
#   OCCT sketch faces (BRepPrimAPI_MakePrism / _MakeRevol) across extrude / revolve / rib
#   (Features.cpp), push/pull (DirectEdit.cpp, DirectModeling.cpp), the polygon prism
#   (Primitives.cpp), the parting-slab (Mold.cpp) and the base flange (SheetMetal.cpp).
#   Every site now calls forge::occtPrism / occtRevol (src/OcctPrimBuilder.cpp): each
#   profile boundary edge is swept into a Geom_SurfaceOfLinearExtrusion / _SurfaceOfRevolution
#   (TKG3d) lateral face trimmed to the edge param x sweep param, closed with cap / end-wall
#   faces and sewn watertight (TKBRep) + BRepLib::OrientClosedSolid — the SAME analytic B-rep
#   BRepSweep builds, minus the TKPrim wrapper (closed-form area*|v.n| / Pappus volume
#   self-check throws on a wrong sweep). VERIFIED keep-if-green: otool opencascade 11->10,
#   libTKPrim gone from otool -L, nm -u | grep BRepPrimAPI == 0, occt_drop_gate.sh TKPrim
#   EXCLUSIVE=0; native_vs_occt_core 34/34 (prism 8F/18E brepExact + extrude/revolve A/B vs
#   the independent native sweep — the post-drop oracle, BRepPrimAPI being unavailable);
#   Models-OS 13/13; part_features / mold_split / sheet_metal / weldments smokes PASS.
#   Linux run_native.sh CI (ubuntu strict-link) is the ultimate gate.
# OCCT-zero progress (2026-07-21, K-STEP): dropped TKDESTEP + TKXSBase. 13 -> 11 OCCT dylibs.
#   STEP READ was the sole consumer of the Data-Exchange toolkits (STEPControl_Reader /
#   XSControl_Reader / Interface_Static, all in src/IoExchange.cpp::importStep). It now runs
#   the in-house TKDESTEP-free transfer forge::native::brep::foreignStepToOcct
#   (src/native/brep/StepReadOcct.cpp): parse ISO-10303-21 with the shared StepPart21 lexer,
#   then build the OCCT B-rep DIRECTLY with the modeling toolkits (TKBRep/TKG3d/TKGeomBase/
#   TKTopAlgo) — ONE shared TopoDS_Edge per EDGE_CURVE (exact LINE/CIRCLE/ELLIPSE 3D curve)
#   on each analytic Geom surface (PLANE/CYLINDRICAL/CONICAL/SPHERICAL/TOROIDAL), healed to a
#   valid solid via ShapeFix (pcurves + orientation). STEP WRITE was already OCCT-free
#   (StepAnalytic/StepFaceted). VERIFIED keep-if-green: otool opencascade 13->11, TKDESTEP/
#   TKXSBase gone, nm -u STEPControl==0; native reader on part 135 -> 38F/81E/valid, exact
#   volume; Models-OS 13/13 (test_compile score 0.459305 reproduced); native_vs_occt_core
#   34/34; forge:kernel:test smoke all green.
# OCCT-zero progress (2026-07-20): dropped TKHLR. 14 -> 13 OCCT dylibs.
#   The engineering-drawing hidden-line-removal path (src/Drawings.cpp) was the sole
#   consumer of OCCT's HLR (HLRBRep_Algo / HLRBRep_HLRToShape / HLRAlgo_Projector).
#   Every orthographic HLR call site now runs the NATIVE analytic HLR
#   (forge::native::brep::hiddenLineRemoval) via emitNativeHlr(); perspective HLR was
#   already native (projectShapePerspective -> hlrPerspective). NativeSolid handles
#   project their analytic solid DIRECTLY (projectViewNative / tryNativeProjectShape),
#   avoiding the lossy native->OCCT round-trip. VERIFIED: occt_drop_gate.sh TKHLR = 0
#   exclusive symbols; nm -u | grep -iE 'HLRBRep|HLRAlgo' EMPTY; core 34/34, Models-OS
#   13/13, drawings smoke PASS, foreign reader 49/81 all unchanged.
# OCCT-zero progress (2026-07-06): dropped 3 dead-linked dylibs TKDEIGES/TKDESTL/TKDEVRML —
# IGES read is native (IgesRead.cpp), STL is native both ways (MeshExchange), no VRML path exists.
# Verified zero #include of IGESControl/StlAPI/VrmlAPI in src/. 22 -> 19 OCCT dylibs.
#
# OCCT-zero progress (2026-07-18): dropped dead-linked TKBool. 17 -> 16 OCCT dylibs.
#   MEASURED: `nm -m build/Release/forge-kernel.node | grep -c 'from libTKBool'` = 0, and
#   the intersection {TKBool exports} ∩ {.node undefined symbols} = 0 — the .node imports
#   NO symbol from TKBool. The boolean API the kernel actually uses (BRepAlgoAPI_Fuse/Cut/
#   Common, BOPAlgo_*) lives in TKBO, which stays loaded transitively via TKOffset/TKFillet/
#   TKDESTEP (all still directly linked), so runtime resolution is unaffected. TKBool was a
#   historical mislink (the boolean toolkit is TKBO, not TKBool). Verified keep-if-green:
#   otool 17->16, native_vs_occt_core.mjs 34/34 (incl. OCCT-path booleans), coherence
#   discrimination PASS (clean 1.0000 vs incoherent 0.0443, baseline-identical).
#
# OCCT-zero progress (2026-07-19, K5): dropped TKMesh. 16 -> 15 OCCT dylibs.
#   The DISPLAY tessellator (src/Tessellate.cpp) and the FEA tet surface seed
#   (src/FeaTet.cpp) — the last two BRepMesh_IncrementalMesh call sites — now run
#   through the native in-house triangulator forge::occtmesh
#   (tessellateShapeForViewport / triangulateShapeInPlace; src/OcctNativeMesh.cpp),
#   which READS OCCT surfaces/pcurves (TKBRep/TKG3d/TKG2d/TKTopAlgo) but does its
#   own constrained-Delaunay faceting — NO BRepMesh / TKMesh symbol remains in src/.
#   The stale "frame-phantom" blocker (K5_TKMESH_BLOCKER.md, 2026-07-09) was already
#   cured by the (TShape+Location) edge-cache key: an occtmesh-vs-BRepMesh A/B over
#   13 shapes (primitives, located-operand booleans incl. common box∩sphere, cut,
#   fuse, extrude, revolve90, torus) MEASURED watertight + genus-identical, so no
#   frame baking was needed. Verified keep-if-green: otool 16->15,
#   native_vs_occt_core.mjs 34/34, coherence PASS (1.0000 vs 0.0443), run_native
#   137/137, fea_smoke + fea_nafems + drawings_smoke PASS, ZERO native-mesh deferrals.
#
# OCCT-zero progress (2026-07-20, K5.1): dropped TKG2d — the FIRST real toolkit drop.
#   15 -> 14 OCCT dylibs. The .node's SOLE exclusive TKG2d symbol was
#   Geom2d_Curve::Value(double) const, from ONE call site: the display mesher's
#   periodic-face p-curve read (src/OcctNativeMesh.cpp) that recovers seam-edge (u,v)
#   on full-wrap periodic faces (sphere/cylinder/cone/torus) — the branch a 3-D-point
#   projection cannot disambiguate. That read is now BRep_Tool::UVPoints (TKBRep, NOT
#   TKG2d): it returns the edge's two stored 2-D ENDPOINTS orientation-correctly (the
#   two seam uses land on OPPOSITE boundaries, as CurveOnSurface did), and since a seam
#   p-curve is a straight ISO-LINE, LINEARLY interpolating those endpoints reproduces the
#   old Value() sampling EXACTLY. Non-seam edges use unambiguous native projection. No new
#   exclusive Geom2d symbol is introduced. TKBRep itself DT_NEEDs TKG2d, so TKG2d still
#   loads transitively at runtime — the .node's OWN link line just no longer names it.
#   Verified keep-if-green: `scripts/occt_drop_gate.sh TKG2d` = 0 exclusive / DROP-SAFE;
#   `nm -u forge-kernel.node | grep Geom2d_Curve5Value` EMPTY; otool 15->14;
#   native_vs_occt_core.mjs 34/34; Models-OS 13/13; foreign_step_ab 49/81 (part 112
#   sphere-patch mesh watertight, 2860 tris — byte-identical to the p-curve path).
#   NB (Linux ultimate gate): the .node no longer references any TKG2d symbol directly,
#   so strict-link is satisfied by TKBRep's transitive TKG2d — push for run_native CI.

# ---------------------------------------------------------------- Boost
# planegcs uses boost::graph (connected_components) + boost::math::constants.
# Header-only on brew. We need *_INC only — no link libs.
#
# Was, until the dependency-plane track:
#     set(BOOST_INC "/opt/homebrew/opt/boost/include")
# Now resolved through the lock, same order and same loud last resort as OCCT above.
forge_deps_require(boost
    PREFIX_VAR  BOOST_ROOT_RESOLVED
    VERSION_VAR BOOST_LOCKED_VERSION)
set(BOOST_INC "${BOOST_ROOT_RESOLVED}/include")
if(NOT EXISTS "${BOOST_INC}/boost/graph/adjacency_list.hpp")
    message(FATAL_ERROR "Boost not found at ${BOOST_INC}. Seed the local plane with "
                        "tools/deps/seed, or set -DFORGE_DEPS_PREFIX_BOOST=...")
endif()

# ---------------------------------------------------------- planegcs (vendored)
# See forge-kernel/3rdParty/planegcs/UPSTREAM.md for source + edits.
set(PLANEGCS_DIR "${CMAKE_SOURCE_DIR}/3rdParty/planegcs")
set(PLANEGCS_SRC
    "${PLANEGCS_DIR}/Constraints.cpp"
    "${PLANEGCS_DIR}/GCS.cpp"
    "${PLANEGCS_DIR}/Geo.cpp"
    "${PLANEGCS_DIR}/SubSystem.cpp"
    "${PLANEGCS_DIR}/qp_eq.cpp"
)

# -------------------------------------------------------------- target
# Track Z1: the source list is a VARIABLE so the node-free core target can reuse it
# WITHOUT the forge_kernel addon target having to exist. Contents byte-unchanged.
set(FORGE_KERNEL_SOURCES
    ${CMAKE_JS_SRC}
    src/binding.cpp
    src/ShapeRegistry.cpp
    src/OcctPrimBuilder.cpp       # TKPrim-free analytic OCCT primitive solids (Geom_ + BRepBuilderAPI)
    src/NativeOcctBridge.cpp
    src/OcctImport.cpp
    src/Primitives.cpp
    src/Booleans.cpp
    src/TopologySignature.cpp
    src/VoxelIoU.cpp
    src/DirectEdit.cpp
    src/OcctNativeMesh.cpp        # K5 — native meshing (replaces BRepMesh/TKMesh at boolean+HLR sites)
    src/LineageRegistry.cpp
    src/Tessellate.cpp
    src/MassProps.cpp
    src/Transform.cpp
    src/ComponentRegistry.cpp
    src/BVH.cpp
    src/LOD.cpp
    src/AssemblySolver.cpp
    src/AssemblyHierarchy.cpp
    src/InterferenceDetection.cpp
    src/MotionStudy.cpp
    src/MultibodyDynamics.cpp
    src/Drawings.cpp
    src/Sketcher.cpp
    src/Fea.cpp
    src/FeaExtras.cpp
    src/FeaContact.cpp
    src/FeaTet.cpp
    src/Emag.cpp
    src/Cfd.cpp
    src/CfdCompressible.cpp
    src/Cam.cpp
    src/CamAdvanced.cpp
    src/GcodePost.cpp
    src/IoExchange.cpp
    src/DirectModeling.cpp
    src/Healing.cpp
    src/Features.cpp
    src/SheetMetal.cpp
    src/Weldments.cpp
    src/Nurbs.cpp
    src/Airfoil.cpp
    src/SlopeStability.cpp
    src/Casting.cpp
    src/MoldFlow.cpp
    src/Mold.cpp
    src/Acoustics.cpp
    src/WeldingFea.cpp
    src/GltfExport.cpp
    src/CostEstimation.cpp
    src/CarbonLca.cpp
    src/SunPath.cpp
    src/Tolerance.cpp
    src/Ductwork.cpp
    src/Variants.cpp
    src/Psychrometric.cpp
    src/Circuit.cpp
    src/Terrain.cpp
    src/NurbsFit.cpp
    src/MeshRepair.cpp
    src/SheetMetalFlatPattern.cpp
    src/PointCloud.cpp
    src/PathTrace.cpp
    src/StdParts.cpp
    src/FrameTruss.cpp
    src/PipeRoute.cpp
    src/Dxf.cpp
    src/SketchDof.cpp
    src/Animation.cpp
    src/ThermalNetwork.cpp
    src/Fatigue.cpp
    src/BoltJoint.cpp
    src/Buckling.cpp
    src/BeamDeflection.cpp
    src/Spring.cpp
    src/HeatExchanger.cpp
    src/Mohr.cpp
    src/PolygonSection.cpp
    src/GearPair.cpp
    src/HydraulicCylinder.cpp
    src/WindLoad.cpp
    src/SnowLoad.cpp
    src/Bearing.cpp
    src/VBelt.cpp
    src/PressureVessel.cpp
    src/PumpHead.cpp
    src/Refrigeration.cpp
    src/FanBlower.cpp
    src/SteelColumn.cpp
    src/SeismicLoad.cpp
    src/Shaft.cpp
    src/BoltedConnection.cpp
    src/FilletWeld.cpp
    src/RcBeam.cpp
    src/BearingCapacity.cpp
    src/RetainingWall.cpp
    src/PileCapacity.cpp
    src/OpenChannel.cpp
    src/WeirOrifice.cpp
    src/ThreePhase.cpp
    src/Transformer.cpp
    src/InductionMotor.cpp
    src/SymComponents.cpp
    src/TransmissionLine.cpp
    src/SyncMachine.cpp
    src/PowerFlow.cpp
    src/ShortCircuit.cpp
    src/CableSizing.cpp
    src/Lighting.cpp
    src/Battery.cpp
    src/SolarPv.cpp
    src/Hydrology.cpp
    src/RcColumn.cpp
    src/Machining.cpp
    src/Combustion.cpp
    src/VibIsolation.cpp
    src/FinEfficiency.cpp
    src/BoilerEfficiency.cpp
    src/SoundTL.cpp
    src/PIDTuning.cpp
    src/TunedMassDamper.cpp
    src/OrificePlate.cpp
    src/RcPunching.cpp
    src/AnchorBolt.cpp
    src/PowerScrew.cpp
    src/SteelBeamLtb.cpp
    src/AnchorShear.cpp
    src/WoodBeam.cpp
    src/PumpNpsh.cpp
    src/WoodColumn.cpp
    src/SiloPressure.cpp
    src/OttoCycle.cpp
    src/DieselCycle.cpp
    src/BraytonCycle.cpp
    src/DcMotor.cpp
    src/WireRopeSling.cpp
    src/DiscBrake.cpp
    src/ReciprocatingCompressor.cpp
    src/ChainDrive.cpp
    src/StoppingSightDistance.cpp
    src/AashtoPavement.cpp
    src/CapstanFriction.cpp
    src/Prismoidal.cpp
    src/PitotTube.cpp
    src/CircularPipeFlow.cpp
    src/WormGear.cpp
    src/BevelGear.cpp
    src/WoodShearWall.cpp
    src/CraneHook.cpp
    src/AirFilter.cpp
    src/FinArray.cpp
    src/HeadedStud.cpp
    src/Consolidation.cpp
    src/VehicleBraking.cpp
    src/Catenary.cpp
    src/DrumBrake.cpp
    src/WireRope.cpp
    src/WebShear.cpp
    src/HazenWilliams.cpp
    src/VoltageDrop.cpp
    src/HertzPoint.cpp
    src/CoolingLoad.cpp
    src/RCShear.cpp
    src/CoolingTower.cpp
    src/MononobeOkabe.cpp
    src/BlockShear.cpp
    src/SectionClass.cpp
    src/ConcreteMix.cpp
    src/SteamPipe.cpp
    src/AirPipe.cpp
    src/WindTurbine.cpp
    src/ConcreteCreep.cpp
    src/DetentionBasin.cpp
    src/BasePlate.cpp
    src/HydraulicJump.cpp
    src/BuriedPipe.cpp
    src/SubstationGround.cpp
    src/PileGroup.cpp
    src/BasementUplift.cpp
    src/RebarDevelopment.cpp
    src/ChilledWaterPump.cpp
    src/DieselGenset.cpp
    src/ReverseOsmosis.cpp
    src/EnvelopeUValue.cpp
    src/Ventilation.cpp
    src/FirePump.cpp
    src/SepticTank.cpp
    src/Cyclone.cpp
    src/StackEffect.cpp
    src/MasonryWall.cpp
    src/AsphaltMix.cpp
    src/CathodicProtection.cpp
    src/HeatTrace.cpp
    src/LightningProtection.cpp
    src/StaticMargin.cpp
    src/RefrigerantPipe.cpp
    src/BusBarForce.cpp
    src/DuctLeakage.cpp
    src/DustExplosionVent.cpp
    src/ChillerIPLV.cpp
    src/SnowDrift.cpp
    src/SlabOneWay.cpp
    src/CraneRunway.cpp
    src/CMUCompression.cpp
    src/ReliefValve.cpp
    src/ExpansionTank.cpp
    src/PlateBucklingLocal.cpp
    src/Ashrae62Residential.cpp
    src/WeldElectrode.cpp
    src/ConcreteCover.cpp
    src/MSEWall.cpp
    src/HunterFlow.cpp
    src/SolarCollector.cpp
    src/ChimneyDraft.cpp
    src/MohrCoulomb.cpp
    src/StairDesign.cpp
    src/SnowOnPV.cpp
    src/NRCAcoustic.cpp
    src/AdiabaticCompressor.cpp
    src/MullionDeflection.cpp
    src/SprinklerK.cpp
    src/SoundPropagation.cpp
    src/StandardAtmosphere.cpp
    src/Lighting901LPD.cpp
    src/GeothermalLoop.cpp
    src/TensionMember.cpp
    src/BoltedTimber.cpp
    src/ConveyorPower.cpp
    src/DriftIndex.cpp
    src/SlopeInfinite.cpp
    src/EnginePerformance.cpp
    src/DaylightFactor.cpp
    src/MassHaul.cpp
    src/RailBeam.cpp
    src/BeamReactions.cpp
    src/TankAnchor.cpp
    src/HeatPump.cpp
    src/BaseShear.cpp
    src/PVShade.cpp
    src/PadEye.cpp
    src/HorizontalSight.cpp
    src/WeldGroup.cpp
    src/BoltPreload.cpp
    src/PrestressLosses.cpp
    src/BoltedFlange.cpp
    src/SpillwayOgee.cpp
    src/GroundGrid.cpp
    src/ResponseSpectrum.cpp
    src/BuoyantStability.cpp
    src/VerticalCurve.cpp
    src/Clarifier.cpp
    src/PVBattery.cpp
    src/DuctSilencer.cpp
    src/ThrustBlock.cpp
    src/Corbel.cpp
    src/WindTowerFoundation.cpp
    src/AirReceiver.cpp
    src/ButterworthFilter.cpp
    src/PedestrianBridge.cpp
    src/PipeNetwork.cpp
    src/TorsionalVibration.cpp
    src/PierScour.cpp
    src/Economizer.cpp
    src/FiberLink.cpp
    src/BiaxialFooting.cpp
    src/AluminumExtrusion.cpp
    src/MorisonForce.cpp
    src/FourierHeat.cpp
    src/SimulatedAnnealing.cpp
    src/CompositeSlab.cpp
    src/Reverberation.cpp
    src/AdiabaticFlame.cpp
    src/MSEPullout.cpp
    src/BayesUpdate.cpp
    src/RunoffCN.cpp
    src/Waveguide.cpp
    src/SluiceGate.cpp
    src/Knock.cpp
    src/ProjectNPV.cpp
    src/CMUShearWall.cpp
    src/SlipCritical.cpp
    src/ChilledBeam.cpp
    src/WeldHeatInput.cpp
    src/MarkovChain.cpp
    src/SoldierPile.cpp
    src/HSSRoundBending.cpp
    src/PlateHX.cpp
    src/FOSMReliability.cpp
    src/BridgeFlutter.cpp
    src/ClassASurfacing.cpp
    src/SheetMetalExtended.cpp
    src/BooleanTol.cpp
    src/ShapeCheck.cpp
    src/ShapeFix.cpp
    src/Sewing.cpp
    src/VarFillet.cpp
    src/LoftGuide.cpp
    src/MateLibrary.cpp
    src/CamExtended.cpp
    # ---------------------------------------------------------------- forge::native
    # In-house, pure-C++20 unified-kernel modules (KERNEL_INHOUSE_ROADMAP Stage 0
    # wiring). NO OCCT / WASM / external deps — stdlib only — so they need no new
    # link libs. Previously compiled ONLY by test/native/run_native.sh; now built
    # INTO forge-kernel.node so the validated ops are callable in-platform.
    src/native/Predicates.cpp
    src/native/ExactReal.cpp            # K2 — in-house EPECK lazy-exact rational (big-int num/den + double interval filter)
    src/native/ExactPredicates3D.cpp    # K2 — exact orient3D/inSphere + exact edge-plane / seg-seg intersection CONSTRUCTIONS
    src/native/geom/Geom.cpp
    src/native/geom/NativeProjection.cpp   # R1 — native point->surface + point->curve-2d projection (Gauss-Newton; drops TKGeomAlgo GeomAPI_Project* + TKGeomBase Extrema)
    src/native/geom/NativeNurbsConvert.cpp # R2 — native analytic->NURBS + points->NURBS lsq fit (drops TKGeomBase GeomConvert + TKGeomAlgo PointsToBSpline)
    src/native/geom/NativeLaw.cpp          # R3 — native 1-D evolution laws (Law_Linear/Law_S) for VarFillet — pure std, unguarded (drops TKGeomAlgo Law_*)
    src/native/geom/Delaunay.cpp
    src/native/gdt/Gdt.cpp
    src/native/mesh/HalfEdgeMesh.cpp
    src/native/mesh/TriTriIntersect.cpp
    src/native/mesh/MeshBoolean.cpp
    src/native/mesh/MeshBooleanNative.cpp
    src/native/mesh/MeshBooleanExact.cpp   # K2 — robust exact-construction boolean (canonical exact-point weld) for the degenerate sliver/coplanar class
    src/native/implicit/SdfTree.cpp
    src/native/implicit/IsoMesher.cpp
    src/native/implicit/DualContour.cpp
    src/native/voxel/VoxelGrid.cpp
    src/native/voxel/VoxelMesh.cpp
    src/native/voxel/Tpms.cpp
    src/native/brep/Nurbs.cpp
    src/native/brep/NurbsCalculus.cpp
    src/native/brep/NurbsSurface.cpp   # surfit dep: brep::evaluateWithDerivatives
    src/native/brep/SurfaceFill.cpp     # class-A surface fill — G1 bicubic Coons/Gordon patch (4-sided, exact boundary + cross-tangent interpolation)
    src/native/brep/GregoryFill.cpp     # class-A n-sided G1 Gregory hole-fill (3/5/6-sided, Boolean-sum Coons sub-patches, watertight + G1)
    src/native/brep/Topology.cpp
    src/native/brep/Curve.cpp           # K0 — tagged Curve/PCurve geometry + tolerance attrs (Wave-1)
    src/native/brep/NurbsAlgebra.cpp    # K1.1 — NURBS algebra: elevate/knot-ops/curvature/iso/projection (Wave-1)
    src/native/brep/TrimmedFace.cpp     # K1.2 — trimmed-NURBS B-rep face: point-in-trim + trim-respecting tessellation + trimmed mass-props (Wave-1 keystone)
    src/native/brep/Sew.cpp             # K1.4 — sew/heal faces into a connected shell (weld verts, merge coedge pairs, free-edge/Euler diagnose)
    src/native/brep/Check.cpp           # K5 — native B-rep validator (BRepCheck-class): 21 topology/geometry/orientation predicates naming offending entities
    src/native/brep/Heal.cpp            # heal — ShapeFix-class: gap-fill, small-edge collapse, sliver-face removal, duplicate/degenerate cleanup (honest unfixed report)
    src/native/brep/CadScoreGates.cpp   # CADGenBench pre-submit gates: in-kernel Betti b0/b1/b2 + watertight/manifold validity + interface keep-in/keep-out IoU (RL-reward terms)
    src/native/brep/DraftAnalytic.cpp   # analytic face draft about a neutral plane (planar side faces -> frustum), OCCT BRepOffsetAPI_DraftAngle analogue
    src/native/brep/LoftSweep.cpp       # analytic loft through N planar sections + translational sweep along a path -> closed B-rep solid (ThruSections/MakePipe analogue)
    src/native/brep/NativeSectionFill.cpp # R2 — native N-section B-spline skin (P&T ch.10.3 skinned surface) — drops TKGeomAlgo GeomFill_NSections (loftWithGuides)
    src/native/brep/HelicalSweep.cpp    # helical sweep: circular profile along a constant-pitch helix -> coil/spring/thread (RMF-transported, MakePipe analogue)
    src/native/brep/IgesRead.cpp        # foreign IGES (ASCII) read: 144 trimmed-surface / 186 manifold-solid-brep / 128 NURBS -> native TrimmedFace -> sew -> shell/solid
    src/native/brep/StepReadOcct.cpp    # TKDESTEP-free foreign STEP -> OCCT B-rep transfer (one shared edge per EDGE_CURVE on analytic surfaces) — importStep after the TKDESTEP drop
    src/native/brep/StepWriteOcct.cpp   # ANALYTIC STEP write for OCCT-backed handles (real surfaces + B-spline records + pcurves; per-face facet fallback) — reader/writer roundtrip closure with StepReadOcct
    src/native/brep/MeshExchange.cpp    # OCCT-zero B2 — native ASCII mesh I/O (STL/OBJ/OFF/PLY); exact std::to_chars/from_chars coord round-trip. Wired into src/IoExchange.cpp importStl/exportStl (replaces StlAPI + BRepMesh).
    src/native/brep/Hlr.cpp             # hidden-line removal for drawings: orthographic project + z-buffer occlusion split of B-rep edges into visible/hidden spans
    src/native/brep/Section.cpp         # planar section / cut views: plane-solid SSI section wires + filled cross-section area + centroid (section properties)
    src/native/brep/Query.cpp           # geometric queries: min-distance/clearance between solids + point-in-solid classification (BRepExtrema/SolidClassifier)
    src/native/brep/Gear.cpp            # involute spur gear: exact-involute tooth flank + circular pattern + bore -> gear solid
    # IN-HOUSE KERNEL STEP 1 — OCCT-free primitive B-rep solids + exact
    # mass-properties + watertight tessellation (pure C++20 stdlib, no new link
    # libs). Always compiled into the addon; the JS surface is gated behind
    # FORGE_NATIVE_BREP in binding.cpp so the live OCCT path stays the default.
    src/native/brep/Surface.cpp
    src/native/brep/Primitives.cpp
    src/native/brep/MassProps.cpp
    # OCCT_ZERO_ROADMAP W2.1 — native EXACT analytic AABB (replaces ComponentRegistry's
    # sole OCCT call, BRepBndLib+Bnd_Box, on native-backed handles). Deps: Topology +
    # Surface (already linked above). Live route in src/ComponentRegistry.cpp is gated
    # behind FORGE_NATIVE_BREP + the runtime flag; OCCT stays the default + fallback.
    src/native/brep/Aabb.cpp
    src/native/brep/SolidTessellate.cpp
    # IN-HOUSE KERNEL STEP 2 — OCCT-free native B-rep BOOLEAN (fuse/cut/common) +
    # analytic surface-surface intersection (pure C++20 stdlib, no new link libs).
    # Always compiled; the JS surface (nativeBoolean) is gated behind
    # FORGE_NATIVE_BREP in binding.cpp so the live OCCT boolean stays the default.
    # Boolean.cpp imprints cut curves by triangulating each face in its (u,v)
    # domain via geom::constrainedDelaunay2D, so that source MUST be linked in too
    # (otherwise, with macOS -undefined dynamic_lookup, the call resolves to a null
    # pointer at runtime and crashes — it was previously only pulled by run_native).
    src/native/geom/ConstrainedDelaunay2D.cpp
    src/native/brep/SurfaceIntersect.cpp
    src/native/brep/NurbsSurfaceIntersect.cpp   # K1.3 — NURBS-aware SSI: subdivision-localize + marching intersector + pcurves (removes the NURBS-face deferral)
    src/native/brep/Boolean.cpp
    src/native/brep/Pattern.cpp         # analytic feature pattern: linear/circular/mirror array of a tool solid, boolean-merged into one B-rep
    src/native/brep/UnifyFaces.cpp      # native unify-same-domain (coplanar planar face merge) — in-house ShapeUpgrade_UnifySameDomain replacement (TKShHealing-drop blocker #1); wired as the native path in DirectEdit unifyFaces, OCCT fallback for curved/holed
    src/native/brep/NativeShapeHeal.cpp      # R4 — TKShHealing-free heal subset (valueOfUV / projectPointOnCurve / freeBounds / solidFromShell / finalizeShape LIGHT-heal) on surviving foundation toolkits; native hot-path behind FORGE_NATIVE_BREP, OCCT ShapeFix/ShapeAnalysis fallback kept
    src/native/brep/NativeShapeHealBridge.cpp # R4-bridge — RICH ShapeFix_Shape replacement: OCCT shape -> importOcctSolid -> healBRep -> occtFromNativeSolid (TopoDS in/out); whole-file FORGE_NATIVE_BREP, defers (returns input) on open/curved-changed shapes so OCCT fallback stays
    # IN-HOUSE KERNEL STEP 3a — the live-op ROUTING LAYER (runtime gate +
    # transformSolid placement fix + native viewport-tessellate + mesh massprops)
    # and the MESH-BRIDGE feature ops (native fillet/chamfer). Always compiled;
    # the live ops (src/Primitives|Booleans|Transform|MassProps|Tessellate|
    # Features.cpp) only call into these under FORGE_NATIVE_BREP + the runtime gate.
    # Fillet/Chamfer pull FeatureEdges + Delaunay3D (their #include deps) which were
    # previously only built by run_native.sh — they MUST link into the addon now.
    src/native/brep/NativeRoute.cpp
    src/native/mesh/FeatureEdges.cpp
    src/native/geom/Delaunay3D.cpp
    src/native/brep/Fillet.cpp
    src/native/brep/FilletAnalytic.cpp  # analytic rolling-ball constant-radius fillet on a convex straight edge between two planar faces (true cylinder blend surface); + concave (reflex) edges + edge-chains (shared-vertex corners honestly reported)
    src/native/brep/ChamferAnalytic.cpp # analytic symmetric flat-bevel chamfer on a convex straight edge between two planar faces (true plane bevel face)
    src/native/brep/NativeFilletChamfer.cpp  # R3 — TKFillet-free const-radius fillet / flat-bevel chamfer on an ARBITRARY OCCT TopoDS_Shape (local-neighbourhood retrim + sew); native hot-path behind FORGE_NATIVE_BREP, OCCT BRepFilletAPI fallback kept (prismatic convex planar edges only, else honest defer)
    src/native/brep/NativeVariableFillet.cpp # R3-V — TKFillet-free VARIABLE-radius (linear-law) rolling-ball fillet on prismatic convex planar edges (exact rational Geom_BSplineSurface blend); native hot-path behind FORGE_NATIVE_BREP, OCCT fallback kept (non-linear law / curved / concave defer)
    src/native/brep/Shell.cpp           # offset/shell: hollow a solid to a uniform wall (analytic face offset + SSI re-trim + sew), open or closed
    # TKOffset family G/H — TKOffset-free HOLLOW on an OCCT TopoDS_Shape (the
    # BRepOffsetAPI_MakeThickSolid replacement for OCCT-backed handles, where
    # Shell.cpp's native-B-rep engine cannot reach). PLANAR prismatic + EXACT
    # QUADRIC (cylinder/cone/sphere/torus) offset with closed-form meridian
    # re-trim; every cavity face keeps its analytic surface type — nothing is
    # tessellated. Honest defer (null shape) outside that class, so the OCCT
    # fallback in src/Features.cpp stays live.
    # NOTE — this file was authored but NEVER LISTED here, so it had never been
    # compiled. With an explicit source list plus `-undefined dynamic_lookup`,
    # an unlisted TU does NOT raise a link error: the call resolves to a null
    # pointer and the addon SIGSEGVs at run time. Keep it listed.
    src/native/brep/NativeThickSolid.cpp
    # TKOffset family D/F — TKOffset-free RULED LOFT and PIPE-SHELL on OCCT
    # TopoDS wires (the BRepOffsetAPI_ThruSections / BRepOffsetAPI_MakePipeShell
    # replacement for OCCT-backed handles, where LoftSweep.cpp's native-B-rep
    # loft cannot reach because there is no OCCT-wire -> native-LoftSection
    # importer). Polygonal sections, polyline spines, exact planar lateral
    # faces; honest defer (null shape) outside that class, so the OCCT fallbacks
    # in Features.cpp / Airfoil.cpp / Primitives.cpp / LoftGuide.cpp /
    # ClassASurfacing.cpp stay live by default.
    src/native/brep/NativeLoftPipe.cpp
    src/native/brep/NativeFilling.cpp
    # TKOffset family I — TKOffset-free THICKEN of an OPEN shell into a solid
    # (the BRepOffset_MakeOffset Skin + makeThickSolid + GeomAbs_Arc replacement
    # for forge::part::thickenSurface). Rossignac-Requicha offset decomposition:
    # per-face prism + a cylindrical wedge on every CONVEX fold. Honest defer
    # (null shape) outside that class, so the OCCT fallback stays live by default.
    src/native/brep/NativeThickenShell.cpp
    # TKOffset family J — TKOffset-free DRAFT of selected faces of an OCCT solid
    # (the BRepOffsetAPI_DraftAngle replacement). Rotates each selected face plane
    # about its neutral-plane intersection line and re-meets every vertex, reusing
    # NativeThickSolid's corner solve. Honest defer outside planar-faced solids.
    src/native/brep/NativeDraft.cpp
    src/native/brep/OffsetShape.cpp     # offset-shape: grow/shrink a solid by offsetting all faces +/-t (MakeOffsetShape, intersection join)
    src/native/brep/Chamfer.cpp
    src/native/brep/Draft.cpp          # mesh-bridge taper (part.draftFaces native route)
    # IN-HOUSE KERNEL STEP 3b — route the SKETCH-BASED feature ops (extrude /
    # revolve / sweep / loft) through the in-house native sweep/revolve/loft
    # (all emit a watertight HalfEdgeMesh -> NativeMesh handle). Always compiled;
    # the live ops in src/Features.cpp only call into these under FORGE_NATIVE_BREP
    # + the runtime gate. These were previously built ONLY by run_native.sh; without
    # listing them here the routing in Features.cpp would not link into the addon
    # (same lesson as Fillet/Chamfer above). Their only deps — Predicates / Geom /
    # HalfEdgeMesh — are already linked.
    src/native/brep/Sweep.cpp
    src/native/brep/Loft.cpp
    src/native/csg/Revolve.cpp
    # IN-HOUSE KERNEL STEP 3c — native STEP data-exchange codecs (OCCT-free):
    #   StepFaceted  — tessellated MANIFOLD_SOLID_BREP (PLANE triangles), for the
    #                  NativeMesh handles (fillet/chamfer/sweep/loft results).
    #   StepAnalytic — analytic ADVANCED_BREP_SHAPE_REPRESENTATION with real
    #                  CYLINDRICAL/CONICAL/SPHERICAL/TOROIDAL/PLANE surfaces +
    #                  LINE/CIRCLE edges, for the NativeSolid handles.
    # Both were previously built ONLY by run_native.sh; listing them here links the
    # codecs into the addon so src/IoExchange.cpp's gated STEP route resolves.
    # Their only deps (Predicates/Geom/HalfEdgeMesh/Topology/Surface) already link.
    src/native/brep/StepFaceted.cpp
    src/native/brep/StepAnalytic.cpp
    src/native/brep/IgesWrite.cpp       # native IGES write: 186 manifold-solid-brep + 108 plane + 128 NURBS (round-trip sibling of IgesRead)
    src/native/brep/StepRead.cpp        # K6 — foreign STEP AP203/214 read: EXPRESS instance graph -> analytic+B-spline ADVANCED_FACE -> TrimmedFace -> sew -> native shell/solid
    src/native/brep/StepWatertight.cpp  # K6 — watertight welded boundary-fan soup + GWN watertightness self-test + GWN face reorientation of the foreign import
    # Task #46 — bind the remaining forge::native engines into the addon so
    # Archie can call them via CUA. Pure C++20 stdlib (no new link libs).
    # geom/AABBTree + voxel/VoxelBoolean are cam's #include dependencies; list
    # Materials.cpp ONCE (am + composites both #include it, single .o links all).
    src/native/geom/AABBTree.cpp
    src/native/voxel/VoxelBoolean.cpp
    src/native/voxel/VoxelFieldOps.cpp      # PicoGK — voxel-field ops: SDF offset/grow-shrink + shell/hollow + smooth-union(metaball fillet) + mesh<->SDF
    src/native/tolstack/Tolstack.cpp
    src/native/vvuq/Vvuq.cpp
    src/native/materials/Materials.cpp
    src/native/am/Am.cpp
    src/native/composites/Composites.cpp
    src/native/surfit/Surfit.cpp
    src/native/cam/Cam.cpp
    src/native/linalg/LinAlg.cpp        # in-house Eigen-free linear algebra (numerics track)
    # Phase A1 (predicates-geom.md) — bridge the DARK geom engines to JS.
    src/binding_geom.cpp
    src/native/geom/Voronoi3D.cpp
    src/native/geom/AlphaShape3D.cpp
    src/native/geom/PolygonBoolean2D.cpp
    src/native/geom/PolygonOffset2D.cpp
    src/native/geom/ConvexDecomposition.cpp
    src/native/geom/ConvexHull3D.cpp        # exact 3D convex hull (Quickhull, exact orient3D — robust face orientation, no degenerate flips)
    src/native/geom/MinkowskiSum3D.cpp
    src/native/mesh/SelfIntersect.cpp
    # Wave-0 — implicit/voxel/F-rep field-design stack (implicit-frep.md + voxel-lattice.md Phase A)
    src/binding_field.cpp
    src/native/implicit/SdfLibrary.cpp
    src/native/implicit/SdfOps.cpp
    src/native/implicit/FRepTree.cpp
    src/native/implicit/IntervalMesh.cpp    # libfive — interval-arithmetic guaranteed meshing: interval-pruned octree + topology-aware dual contour (no missed thin features)
    src/native/implicit/AdaptiveIntervalMesh.cpp    # libfive — adaptive octree-refined interval mesher (2:1-balanced + minimal-edge dual contour; ~4x fewer tris at equal Hausdorff, watertight 2-manifold across level transitions)
    src/native/implicit/MeshToFRep.cpp
    src/native/implicit/MeshToSDF.cpp    # mesh->signed-distance field (VoxelFieldOps::fromMesh); was omitted from the source list => MeshToSDF::build was an undefined symbol masked by -undefined dynamic_lookup
    src/native/voxel/Lattice.cpp
    src/native/voxel/Morphology.cpp
    src/native/viz/FieldViz.cpp         # #65 — CAE field-visualization: warp-by-vector + viridis colormap + isosurface (reuses implicit::IsoMesher) + RK4 streamline
    # Wave-0 — PlaneGCS constraint diagnostics (sketcher-constraints.md Phase A)
    src/binding_sketchdiag.cpp
    # Declarative feature-tree IR — the emission target Archie is trained to
    # produce (a compact typed op-list), + the C++ compiler that walks it into
    # native forge-kernel calls -> real 3D CAD -> STEP. Replaces scope-plan-JSON.
    src/ft/FeatureTreeCompiler.cpp   # parser (text->FeatureTree) + compiler (->native kernel)
    src/ft/GraphAudit.cpp            # s0.4 graph-quality gate: zero unresolved refs,
                                     # zero duplicate ids, zero unexplained orphans.
                                     # compile() refuses a graph it does not call clean,
                                     # so this MUST be in the link: it is not optional.
    src/ft/ChunkChain.cpp            # s0.11 chunked emission + SHA-256 hash/count chain
                                     # (Appendix B CHUNK-CORRUPTION detection)
    src/native/util/Sha256.cpp       # FIPS 180-4 SHA-256, the ONE implementation
                                     # forge::ft::sha256Hex delegates to. It was never
                                     # in this list: the .node links with Darwin
                                     # `-undefined dynamic_lookup`, which SWALLOWED the
                                     # missing forge::native::util::sha256Hex, and the
                                     # node-free forge_kernel_core (which deliberately
                                     # has no dynamic_lookup) failed to link with 7
                                     # undefined references from ChunkChain.cpp.
    src/ft/binding_ft.cpp            # N-API surface forge.ft.compile(irText[, outStep])
    # KEYSTONE K7 — Parasolid-style opaque-handle C-API black box wrapping the
    # native brep/mesh/csg kernel (include/forge/capi/forge_capi.h). Strict
    # extern "C"; no C++ types cross the boundary. Verify batch also compiles
    # test/capi/forge_capi_smoke.cpp against it. Deps (brep Primitives/Boolean/
    # Fillet/Shell/Sweep/MassProps/Aabb/SolidTessellate/StepAnalytic/StepFaceted +
    # csg/Revolve + mesh/HalfEdgeMesh) are already listed above.
    src/native/capi/forge_capi.cpp
    ${PLANEGCS_SRC}
)

# ---- the N-API addon target: OPTIONAL add-on, everything below is gated ----
if(FORGE_BUILD_NODE_ADDON)

add_library(forge_kernel SHARED ${FORGE_KERNEL_SOURCES})

set_target_properties(forge_kernel PROPERTIES
    PREFIX ""
    SUFFIX ".node"
    OUTPUT_NAME "forge-kernel"
)

target_include_directories(forge_kernel PRIVATE
    ${CMAKE_JS_INC}
    "${NODE_ADDON_API_DIR}"
    "${OCCT_INC}"
    # In-house drop-in <Eigen/...> shim backed by forge::native::linalg — NO real
    # Eigen. The kernel's own solvers are Eigen-free; the only <Eigen/...> includes
    # left are in the vendored PlaneGCS sketch solver, which this shim satisfies
    # byte-identically. Must precede any system include that could carry eigen3.
    "${CMAKE_SOURCE_DIR}/3rdParty/planegcs_eigen_shim"
    "${BOOST_INC}"
    "${PLANEGCS_DIR}"
    "${CMAKE_SOURCE_DIR}/include"
)

target_compile_definitions(forge_kernel PRIVATE
    NAPI_VERSION=8
    NAPI_CPP_EXCEPTIONS
)

# IN-HOUSE KERNEL STEP 1 — expose the parallel native B-rep JS surface only when
# explicitly enabled (-DFORGE_NATIVE_BREP=ON). The OCCT bindings are unconditional.
if(FORGE_NATIVE_BREP)
    target_compile_definitions(forge_kernel PRIVATE FORGE_NATIVE_BREP=1)
endif()

target_link_directories(forge_kernel PRIVATE "${OCCT_LIB}")
target_link_libraries(forge_kernel PRIVATE ${OCCT_LIBS} ${CMAKE_JS_LIB})

# Darwin: bundle loader linkage if not using cmake-js.
if(APPLE AND NOT DEFINED CMAKE_JS_LIB)
    set_target_properties(forge_kernel PROPERTIES
        LINK_FLAGS "-undefined dynamic_lookup -Wl,-rpath,${OCCT_LIB}"
    )
endif()

endif()  # FORGE_BUILD_NODE_ADDON (addon target forge-kernel.node)

# ============================================================================
# DESKTOP FOUNDATION (Pillar #10, Phase 1) — additive, option-gated, OFF by default.
#
# forge_kernel_core : the SAME source set as forge_kernel MINUS the 4 N-API binding
#                     translation units (src/binding*.cpp — the only files that
#                     #include <napi.h> / node-addon-api) and MINUS any cmake-js
#                     injected node glue. Links the identical OCCT_LIBS. It NEVER
#                     references N-API, so it is a normal SHARED lib (NO
#                     `-undefined dynamic_lookup`): the link FAILS LOUD if any
#                     non-binding source unexpectedly needed a node symbol.
#
# forge_foundation_probe : a standalone C++ program that links forge_kernel_core and
#                     drives the kernel headlessly through its public C++ API with
#                     ZERO Node. Proves the C++ -> kernel bridge builds + runs.
#
# The source list is READ FROM the forge_kernel target (get_target_property SOURCES)
# so the existing add_library(forge_kernel ...) block is byte-untouched — this block
# only FILTERS that list; it never re-declares it.
# ============================================================================
if(FORGE_BUILD_DESKTOP_FOUNDATION)
    # Track Z1: read the shared source VARIABLE, not the addon target -- with
    # FORGE_BUILD_NODE_ADDON=OFF the forge_kernel target does not exist at all.
    set(_fk_all_sources ${FORGE_KERNEL_SOURCES})

    # Exclude the N-API binding TUs (src/binding.cpp / binding_field.cpp /
    # binding_geom.cpp / binding_sketchdiag.cpp) and any cmake-js node glue that
    # CMAKE_JS_SRC may have injected. Everything else is node-free geometry code.
    set(_core_sources "")
    foreach(_s IN LISTS _fk_all_sources)
        if(_s MATCHES "(^|/)binding[^/]*\\.cpp$")
            continue()  # the N-API layer — the ONLY files that include <napi.h>
        endif()
        if(_s MATCHES "win_delay_load|cmake_js|node_api")
            continue()  # cmake-js / node runtime glue (empty on this macOS build)
        endif()
        list(APPEND _core_sources "${_s}")
    endforeach()

    add_library(forge_kernel_core SHARED ${_core_sources})
    set_target_properties(forge_kernel_core PROPERTIES OUTPUT_NAME "forge_kernel_core")

    # Same includes as forge_kernel EXCEPT the node headers (CMAKE_JS_INC /
    # node-addon-api) — the core must not need them, and omitting them is part of
    # the proof that the geometry code is node-free.
    target_include_directories(forge_kernel_core PRIVATE
        "${OCCT_INC}"
        "${CMAKE_SOURCE_DIR}/3rdParty/planegcs_eigen_shim"
        "${BOOST_INC}"
        "${PLANEGCS_DIR}"
        "${CMAKE_SOURCE_DIR}/include"
    )

    # Match the default build's native-B-rep compile gate so makeBox/etc. route
    # identically and ShapeRegistry's Entry layout is the same. (No NAPI_* defs.)
    if(FORGE_NATIVE_BREP)
        target_compile_definitions(forge_kernel_core PRIVATE FORGE_NATIVE_BREP=1)
    endif()

    target_link_directories(forge_kernel_core PRIVATE "${OCCT_LIB}")
    # Track Z1 (2026-08-28) — MEASURED link fix. forge_kernel (the .node) links with
    # `-undefined dynamic_lookup` on Darwin, which SILENTLY TOLERATES OCCT symbols
    # that are never named on its link line and only arrive transitively (see the
    # OCCT_LIBS note above, §"the direct-link count UNDERSTATES the closure": TKBO
    # supplies BRepAlgoAPI_{Fuse,Cut,Common,Section,Splitter,Defeaturing} and TKG2d
    # supplies Geom2d_*, both reaching the .node only through TKFillet). This target
    # deliberately has NO dynamic_lookup, so it fails loud — and it did: 414/414 TUs
    # compiled, then ld reported 40 undefined OCCT symbols (Geom2d_* from
    # NativeNurbsConvert.cpp, BRepAlgoAPI_*/BOPAlgo_* from DirectEdit/Mold/Drawings/
    # Nurbs/DirectModeling/InterferenceDetection). NONE were Node symbols.
    # These two toolkits are appended to THIS TARGET ONLY. The .node's OCCT_LIBS is
    # byte-untouched, so the otool-L direct-link series and every OCCT drop gate keep
    # counting exactly what they counted before.
    target_link_libraries(forge_kernel_core PRIVATE ${OCCT_LIBS} TKBO TKG2d)

    if(APPLE)
        # Normal shared lib: rpath to the OCCT dylibs, but NO `-undefined
        # dynamic_lookup` — every symbol must resolve at link time (the proof).
        set_target_properties(forge_kernel_core PROPERTIES
            LINK_FLAGS "-Wl,-rpath,${OCCT_LIB}"
        )
    endif()

    # -------- standalone headless C++ probe (no Node, no graphics) --------
    # The public C++ headers (ShapeRegistry.hpp) transitively include OCCT headers
    # (TopoDS_Shape.hxx) and, under FORGE_NATIVE_BREP, the native B-rep headers — so
    # the probe needs OCCT_INC on its include path and must match the library's
    # FORGE_NATIVE_BREP compile gate (ShapeHandle is a uint32_t either way; matching
    # the gate keeps the header view of ShapeRegistry byte-consistent with the lib).
    # It links ONLY forge_kernel_core — no node-addon-api, no CMAKE_JS_LIB.
    add_executable(forge_foundation_probe
        "${CMAKE_SOURCE_DIR}/../forge-desktop/foundation_probe.cpp")
    target_include_directories(forge_foundation_probe PRIVATE
        "${CMAKE_SOURCE_DIR}/include"
        "${OCCT_INC}"
    )
    if(FORGE_NATIVE_BREP)
        target_compile_definitions(forge_foundation_probe PRIVATE FORGE_NATIVE_BREP=1)
    endif()
    target_link_libraries(forge_foundation_probe PRIVATE forge_kernel_core)
    if(APPLE)
        # Find libforge_kernel_core.dylib (build tree) + OCCT at run time.
        set_target_properties(forge_foundation_probe PROPERTIES
            BUILD_RPATH "${CMAKE_BINARY_DIR};${OCCT_LIB}"
        )
    endif()

    # -------- forge_verify : the VERIFIER, native (Law 3: everything C++) --------
    # Reads Unified-IR jobs as NDJSON on stdin, compiles each through the ONE entry
    # (forge::ft::compileText) and writes the kernel's own measurement — volume,
    # bbox, weld-betti genus, deduped bores — back as NDJSON. Same node-free
    # linkage as forge_foundation_probe: this replaces a node worker that had put a
    # JS runtime inside the one path that has to be trustworthy.
    add_executable(forge_verify "${CMAKE_SOURCE_DIR}/src/tools/forge_verify.cpp")
    target_include_directories(forge_verify PRIVATE
        "${CMAKE_SOURCE_DIR}/include"
        "${OCCT_INC}"
    )
    if(FORGE_NATIVE_BREP)
        target_compile_definitions(forge_verify PRIVATE FORGE_NATIVE_BREP=1)
    endif()
    target_link_libraries(forge_verify PRIVATE forge_kernel_core)
    if(APPLE)
        set_target_properties(forge_verify PROPERTIES
            BUILD_RPATH "${CMAKE_BINARY_DIR};${OCCT_LIB}"
        )
    endif()

    # -------- standalone headless C++ MESH-FEED probe --------
    # Same node-free linkage as forge_foundation_probe; drives the renderer's data
    # feed — tessellateLOD(High) -> Mesh -> exportStl — and asserts the mesh/STL
    # invariants (triangle-aligned, finite, AABB matches the solid, binary-STL layout
    # exact). Proves the kernel->mesh pipeline the Vulkan renderer will consume works
    # standalone C++ with zero Node (the renderer itself needs the Vulkan SDK, later).
    add_executable(forge_mesh_probe
        "${CMAKE_SOURCE_DIR}/../forge-desktop/mesh_probe.cpp")
    target_include_directories(forge_mesh_probe PRIVATE
        "${CMAKE_SOURCE_DIR}/include"
        "${OCCT_INC}"
    )
    if(FORGE_NATIVE_BREP)
        target_compile_definitions(forge_mesh_probe PRIVATE FORGE_NATIVE_BREP=1)
    endif()
    target_link_libraries(forge_mesh_probe PRIVATE forge_kernel_core)
    if(APPLE)
        set_target_properties(forge_mesh_probe PROPERTIES
            BUILD_RPATH "${CMAKE_BINARY_DIR};${OCCT_LIB}"
        )
    endif()

    # -------- standalone headless C++ STEP-IO probe --------
    # The file-IO backbone: exportStep -> importStep -> volume-preserved round-trip,
    # proving the desktop app's Open/Save (STEP AP242, the lossless analytic exchange)
    # works standalone C++ with zero Node. Same node-free forge_kernel_core link.
    add_executable(forge_step_probe
        "${CMAKE_SOURCE_DIR}/../forge-desktop/step_probe.cpp")
    target_include_directories(forge_step_probe PRIVATE
        "${CMAKE_SOURCE_DIR}/include"
        "${OCCT_INC}"
    )
    if(FORGE_NATIVE_BREP)
        target_compile_definitions(forge_step_probe PRIVATE FORGE_NATIVE_BREP=1)
    endif()
    target_link_libraries(forge_step_probe PRIVATE forge_kernel_core)
    if(APPLE)
        set_target_properties(forge_step_probe PROPERTIES
            BUILD_RPATH "${CMAKE_BINARY_DIR};${OCCT_LIB}"
        )
    endif()

    # -------- standalone headless C++ FEATURE+DRAFTING probe --------
    # The modeling + drafting surface: shell (a modeling feature) + projectShape (2D
    # orthographic HLR drawing), proving the desktop app's edit + draft ops run
    # standalone C++ with zero Node. Same node-free forge_kernel_core link.
    add_executable(forge_feature_probe
        "${CMAKE_SOURCE_DIR}/../forge-desktop/feature_probe.cpp")
    target_include_directories(forge_feature_probe PRIVATE
        "${CMAKE_SOURCE_DIR}/include"
        "${OCCT_INC}"
    )
    if(FORGE_NATIVE_BREP)
        target_compile_definitions(forge_feature_probe PRIVATE FORGE_NATIVE_BREP=1)
    endif()
    target_link_libraries(forge_feature_probe PRIVATE forge_kernel_core)
    if(APPLE)
        set_target_properties(forge_feature_probe PROPERTIES
            BUILD_RPATH "${CMAKE_BINARY_DIR};${OCCT_LIB}"
        )
    endif()
endif()

# ============================================================================
# DESKTOP RENDERER (Pillar #10, Phase 1) — additive, option-gated, OFF by default.
#
# forge_renderer_probe : a standalone HEADLESS Vulkan-on-Metal (MoltenVK) offscreen
#   renderer. With NO window/swapchain it creates a VkInstance + MoltenVK VkDevice,
#   clears a 256x256 offscreen image to a known colour and reads a pixel back (the
#   must-do smoke), then tessellates forge::makeBox via the node-free forge_kernel_core
#   and rasterizes it with a minimal graphics pipeline into a PNG (the stretch). The
#   two shaders (forge-desktop/shaders/renderer.{vert,frag}) are compiled to SPIR-V C
#   headers by glslangValidator at build time and #included by the probe.
#
# Requires the Vulkan SDK from Homebrew (molten-vk vulkan-headers vulkan-loader
# glslang) AND FORGE_BUILD_DESKTOP_FOUNDATION=ON (it links forge_kernel_core). OFF by
# default: CI never sets this option, so the default build stays byte-unchanged.
# ============================================================================
if(FORGE_BUILD_DESKTOP_RENDERER)
    if(NOT TARGET forge_kernel_core)
        message(FATAL_ERROR
            "FORGE_BUILD_DESKTOP_RENDERER also needs FORGE_BUILD_DESKTOP_FOUNDATION=ON "
            "(the renderer probe links the node-free forge_kernel_core lib for Step 3).")
    endif()
    if(NOT APPLE)
        message(FATAL_ERROR "FORGE_BUILD_DESKTOP_RENDERER targets MoltenVK on macOS only.")
    endif()

    # ---- Locate the Vulkan SDK via Homebrew (headers + loader + glslang) ----
    find_program(BREW_EXE brew HINTS /opt/homebrew/bin /usr/local/bin REQUIRED)
    execute_process(COMMAND ${BREW_EXE} --prefix vulkan-headers
        OUTPUT_VARIABLE VK_HEADERS_PREFIX OUTPUT_STRIP_TRAILING_WHITESPACE)
    execute_process(COMMAND ${BREW_EXE} --prefix vulkan-loader
        OUTPUT_VARIABLE VK_LOADER_PREFIX OUTPUT_STRIP_TRAILING_WHITESPACE)
    execute_process(COMMAND ${BREW_EXE} --prefix glslang
        OUTPUT_VARIABLE GLSLANG_PREFIX OUTPUT_STRIP_TRAILING_WHITESPACE)
    execute_process(COMMAND ${BREW_EXE} --prefix molten-vk
        OUTPUT_VARIABLE MOLTENVK_PREFIX OUTPUT_STRIP_TRAILING_WHITESPACE)

    set(VK_INC "${VK_HEADERS_PREFIX}/include")
    set(VK_LOADER_LIB "${VK_LOADER_PREFIX}/lib/libvulkan.dylib")
    set(GLSLANG_VALIDATOR "${GLSLANG_PREFIX}/bin/glslangValidator")
    if(NOT EXISTS "${VK_INC}/vulkan/vulkan.h")
        message(FATAL_ERROR "vulkan headers not found at ${VK_INC} (brew install vulkan-headers).")
    endif()
    if(NOT EXISTS "${VK_LOADER_LIB}")
        message(FATAL_ERROR "vulkan loader not found at ${VK_LOADER_LIB} (brew install vulkan-loader).")
    endif()
    if(NOT EXISTS "${GLSLANG_VALIDATOR}")
        message(FATAL_ERROR "glslangValidator not found at ${GLSLANG_VALIDATOR} (brew install glslang).")
    endif()
    message(STATUS "forge_renderer_probe: Vulkan headers=${VK_INC} loader=${VK_LOADER_LIB}")
    message(STATUS "forge_renderer_probe: MoltenVK ICD (set VK_ICD_FILENAMES to run) = "
                   "${MOLTENVK_PREFIX}/etc/vulkan/icd.d/MoltenVK_icd.json")

    # ---- Compile the two GLSL shaders to SPIR-V C headers at build time ----
    set(_shdir "${CMAKE_SOURCE_DIR}/../forge-desktop/shaders")
    set(_gendir "${CMAKE_BINARY_DIR}/forge_renderer_shaders")
    file(MAKE_DIRECTORY "${_gendir}")
    add_custom_command(
        OUTPUT "${_gendir}/renderer_vert.spv.h"
        COMMAND ${GLSLANG_VALIDATOR} -V --target-env vulkan1.2
                "${_shdir}/renderer.vert" --vn vertSpv -o "${_gendir}/renderer_vert.spv.h"
        DEPENDS "${_shdir}/renderer.vert"
        COMMENT "glslang: renderer.vert -> renderer_vert.spv.h" VERBATIM)
    add_custom_command(
        OUTPUT "${_gendir}/renderer_frag.spv.h"
        COMMAND ${GLSLANG_VALIDATOR} -V --target-env vulkan1.2
                "${_shdir}/renderer.frag" --vn fragSpv -o "${_gendir}/renderer_frag.spv.h"
        DEPENDS "${_shdir}/renderer.frag"
        COMMENT "glslang: renderer.frag -> renderer_frag.spv.h" VERBATIM)

    # ---- The probe: links forge_kernel_core (node-free) + the Vulkan loader ----
    add_executable(forge_renderer_probe
        "${CMAKE_SOURCE_DIR}/../forge-desktop/renderer_probe.cpp"
        "${_gendir}/renderer_vert.spv.h"
        "${_gendir}/renderer_frag.spv.h")
    target_include_directories(forge_renderer_probe PRIVATE
        "${CMAKE_SOURCE_DIR}/include"
        "${OCCT_INC}"
        "${VK_INC}"
        "${_gendir}")
    if(FORGE_NATIVE_BREP)
        target_compile_definitions(forge_renderer_probe PRIVATE FORGE_NATIVE_BREP=1)
    endif()
    target_link_libraries(forge_renderer_probe PRIVATE forge_kernel_core "${VK_LOADER_LIB}")
    # libvulkan has an ABSOLUTE install name, so no rpath is needed for it; forge_kernel_core
    # + OCCT still need the build tree + OCCT lib dir on the run path.
    set_target_properties(forge_renderer_probe PROPERTIES
        BUILD_RPATH "${CMAKE_BINARY_DIR};${OCCT_LIB}")
endif()

# ============================================================================
# DESKTOP UI (Pillar #10, Phase 1) — additive, option-gated, OFF by default.
#
# forge_ui_probe : a standalone HEADLESS Dear ImGui UI probe. It reuses the same
#   headless Vulkan/MoltenVK setup as forge_renderer_probe (VkInstance + MoltenVK
#   VkDevice + offscreen 1280x800 color image, no swapchain/window/GLFW), stands up
#   the Dear ImGui Vulkan backend against that offscreen render pass, builds ONE
#   frame of a representative Forge IDE (menu bar + model-tree / viewport /
#   properties panels + status bar), renders it offscreen, reads the pixels back
#   and writes a PNG (asserting the UI actually drew). It also composites the 3D
#   kernel box (tessellateLOD(makeBox,High) via node-free forge_kernel_core) into
#   the viewport panel through ImGui::Image.
#
# Vendors Dear ImGui + its Vulkan backend under forge-desktop/third_party/imgui
# (core TUs + imgui_impl_vulkan.{cpp,h}; NO platform backend — headless). Two GLSL
# shaders (forge-desktop/shaders/ui_viewport.{vert,frag}) are compiled to SPIR-V C
# headers by glslangValidator at build time and #included by the probe.
#
# Requires the Vulkan SDK from Homebrew (molten-vk vulkan-headers vulkan-loader
# glslang) AND FORGE_BUILD_DESKTOP_FOUNDATION=ON (it links forge_kernel_core). OFF
# by default: CI never sets this option, so the default build stays byte-unchanged.
# ============================================================================
if(FORGE_BUILD_DESKTOP_UI)
    if(NOT TARGET forge_kernel_core)
        message(FATAL_ERROR
            "FORGE_BUILD_DESKTOP_UI also needs FORGE_BUILD_DESKTOP_FOUNDATION=ON "
            "(the UI probe links the node-free forge_kernel_core lib for the 3D viewport).")
    endif()
    if(NOT APPLE)
        message(FATAL_ERROR "FORGE_BUILD_DESKTOP_UI targets MoltenVK on macOS only.")
    endif()

    # ---- Locate the Vulkan SDK via Homebrew (headers + loader + glslang) ----
    find_program(BREW_EXE brew HINTS /opt/homebrew/bin /usr/local/bin REQUIRED)
    execute_process(COMMAND ${BREW_EXE} --prefix vulkan-headers
        OUTPUT_VARIABLE UI_VK_HEADERS_PREFIX OUTPUT_STRIP_TRAILING_WHITESPACE)
    execute_process(COMMAND ${BREW_EXE} --prefix vulkan-loader
        OUTPUT_VARIABLE UI_VK_LOADER_PREFIX OUTPUT_STRIP_TRAILING_WHITESPACE)
    execute_process(COMMAND ${BREW_EXE} --prefix glslang
        OUTPUT_VARIABLE UI_GLSLANG_PREFIX OUTPUT_STRIP_TRAILING_WHITESPACE)
    execute_process(COMMAND ${BREW_EXE} --prefix molten-vk
        OUTPUT_VARIABLE UI_MOLTENVK_PREFIX OUTPUT_STRIP_TRAILING_WHITESPACE)

    set(UI_VK_INC "${UI_VK_HEADERS_PREFIX}/include")
    set(UI_VK_LOADER_LIB "${UI_VK_LOADER_PREFIX}/lib/libvulkan.dylib")
    set(UI_GLSLANG_VALIDATOR "${UI_GLSLANG_PREFIX}/bin/glslangValidator")
    if(NOT EXISTS "${UI_VK_INC}/vulkan/vulkan.h")
        message(FATAL_ERROR "vulkan headers not found at ${UI_VK_INC} (brew install vulkan-headers).")
    endif()
    if(NOT EXISTS "${UI_VK_LOADER_LIB}")
        message(FATAL_ERROR "vulkan loader not found at ${UI_VK_LOADER_LIB} (brew install vulkan-loader).")
    endif()
    if(NOT EXISTS "${UI_GLSLANG_VALIDATOR}")
        message(FATAL_ERROR "glslangValidator not found at ${UI_GLSLANG_VALIDATOR} (brew install glslang).")
    endif()
    message(STATUS "forge_ui_probe: Vulkan headers=${UI_VK_INC} loader=${UI_VK_LOADER_LIB}")
    message(STATUS "forge_ui_probe: MoltenVK ICD (set VK_ICD_FILENAMES to run) = "
                   "${UI_MOLTENVK_PREFIX}/etc/vulkan/icd.d/MoltenVK_icd.json")

    # ---- Compile the two viewport GLSL shaders to SPIR-V C headers at build time ----
    set(_ui_shdir "${CMAKE_SOURCE_DIR}/../forge-desktop/shaders")
    set(_ui_gendir "${CMAKE_BINARY_DIR}/forge_ui_shaders")
    file(MAKE_DIRECTORY "${_ui_gendir}")
    add_custom_command(
        OUTPUT "${_ui_gendir}/ui_viewport_vert.spv.h"
        COMMAND ${UI_GLSLANG_VALIDATOR} -V --target-env vulkan1.2
                "${_ui_shdir}/ui_viewport.vert" --vn uiVertSpv -o "${_ui_gendir}/ui_viewport_vert.spv.h"
        DEPENDS "${_ui_shdir}/ui_viewport.vert"
        COMMENT "glslang: ui_viewport.vert -> ui_viewport_vert.spv.h" VERBATIM)
    add_custom_command(
        OUTPUT "${_ui_gendir}/ui_viewport_frag.spv.h"
        COMMAND ${UI_GLSLANG_VALIDATOR} -V --target-env vulkan1.2
                "${_ui_shdir}/ui_viewport.frag" --vn uiFragSpv -o "${_ui_gendir}/ui_viewport_frag.spv.h"
        DEPENDS "${_ui_shdir}/ui_viewport.frag"
        COMMENT "glslang: ui_viewport.frag -> ui_viewport_frag.spv.h" VERBATIM)

    # ---- Vendored Dear ImGui (core + Vulkan backend; NO platform backend) ----
    set(_imgui_dir "${CMAKE_SOURCE_DIR}/../forge-desktop/third_party/imgui")
    set(_imgui_src
        "${_imgui_dir}/imgui.cpp"
        "${_imgui_dir}/imgui_draw.cpp"
        "${_imgui_dir}/imgui_tables.cpp"
        "${_imgui_dir}/imgui_widgets.cpp"
        "${_imgui_dir}/imgui_impl_vulkan.cpp")

    # ---- The probe: vendored ImGui + node-free forge_kernel_core + Vulkan loader ----
    add_executable(forge_ui_probe
        "${CMAKE_SOURCE_DIR}/../forge-desktop/ui_probe.cpp"
        ${_imgui_src}
        "${_ui_gendir}/ui_viewport_vert.spv.h"
        "${_ui_gendir}/ui_viewport_frag.spv.h")
    target_include_directories(forge_ui_probe PRIVATE
        "${CMAKE_SOURCE_DIR}/include"
        "${OCCT_INC}"
        "${UI_VK_INC}"
        "${_imgui_dir}"
        "${_ui_gendir}")
    if(FORGE_NATIVE_BREP)
        target_compile_definitions(forge_ui_probe PRIVATE FORGE_NATIVE_BREP=1)
    endif()
    target_link_libraries(forge_ui_probe PRIVATE forge_kernel_core "${UI_VK_LOADER_LIB}")
    set_target_properties(forge_ui_probe PROPERTIES
        BUILD_RPATH "${CMAKE_BINARY_DIR};${OCCT_LIB}")
endif()

# ============================================================================
# forge_all — the aggregate target named by the Sacrosanct 3.1 s21.2 command
# contract (`cmake --build --preset macos-arm64-release --target forge_all`).
# It gathers whatever this configuration actually enabled, so the same command
# line is valid whether or not the desktop probes are ON.
# ============================================================================
set(_forge_all_targets "")
foreach(_t forge_kernel forge_kernel_core forge_foundation_probe forge_verify forge_mesh_probe
           forge_step_probe forge_feature_probe forge_renderer_probe forge_ui_probe)
    if(TARGET ${_t})
        list(APPEND _forge_all_targets ${_t})
    endif()
endforeach()
add_custom_target(forge_all DEPENDS ${_forge_all_targets})
message(STATUS "forge_all aggregates: ${_forge_all_targets}")

# ============================================================================
# CTEST SUITE (B1) — the kernel's own C++ acceptance evidence, runnable as a suite.
#
# WHY THIS BLOCK EXISTS. Until now `grep -nE "add_test|enable_testing" ` over this
# file produced NO OUTPUT: forge-kernel had no CTest registration at all. Every gate
# below already existed and already passed — they were just invoked by hand, one
# bespoke shell command each. That made the JavaScript harness the kernel's ONLY
# citable acceptance evidence, so no JS test file could be retired without deleting
# the only proof the kernel still behaves. This block registers the EXISTING gates.
# It invents no new assertion: every test named here is a file that was already in
# forge-kernel/test/ (or an already-declared probe target) before this block.
#
# CONTRACT
#   ctest --test-dir <build> --output-on-failure
# The set that is actually registered depends on the configure:
#   * plain configure                          -> the 3 self-contained shell suites
#   * -DFORGE_BUILD_DESKTOP_FOUNDATION=ON      -> + the 4 probes, + the 2 C++ gates,
#                                                 + the forge_verify-backed guard
# Nothing is registered whose executable this configure did not build, so a green
# ctest run never means "the test was skipped" — `ctest -N` prints exactly what ran.
# ============================================================================
enable_testing()

option(FORGE_BUILD_TESTS
       "Compile the C++ gate executables under forge-kernel/test/ and register CTests" ON)

set(FORGE_TEST_DIR "${CMAKE_SOURCE_DIR}/test")

# ---------------------------------------------------------------- 1. probe targets
# forge_{foundation,mesh,step,feature}_probe are already declared above under
# FORGE_BUILD_DESKTOP_FOUNDATION. Each is a self-asserting program: it prints
# "ALL <n> CHECKS PASSED" and returns 0, or returns the failing check number /
# 255 on a throw. Registering them costs nothing and makes them a suite.
foreach(_probe forge_foundation_probe forge_mesh_probe forge_step_probe forge_feature_probe)
    if(TARGET ${_probe})
        string(REPLACE "forge_" "" _pname "${_probe}")
        add_test(NAME kernel.${_pname} COMMAND ${_probe})
        set_tests_properties(kernel.${_pname} PROPERTIES
            TIMEOUT 300
            FAIL_REGULAR_EXPRESSION "PROBE FAILED;PROBE THREW")
    endif()
endforeach()

# ---------------------------------------------------------------- 2. C++ gate targets
# These two .cpp gates already existed and already passed; they were compiled by
# hand-rolled clang++ command lines (test/build_kernel_correctness_gate.sh) that
# CMake never knew about. Declaring them as targets here changes no assertion —
# it reproduces the same flags (including the -Wall -Wextra -Werror the gate
# script calls SR-3) against the same node-free forge_kernel_core.
if(FORGE_BUILD_TESTS AND TARGET forge_kernel_core)

    # kernel_correctness_gate.cpp — G1..G4, four measured value-vs-reference
    # assertions (export-failure honesty, shellMultiThickness sign contract,
    # per-axis bore counting, one weld-betti genus definition).
    add_executable(forge_kernel_correctness_gate
        "${FORGE_TEST_DIR}/kernel_correctness_gate.cpp")
    target_include_directories(forge_kernel_correctness_gate PRIVATE
        "${CMAKE_SOURCE_DIR}/include"
        "${OCCT_INC}")
    target_compile_options(forge_kernel_correctness_gate PRIVATE -Wall -Wextra -Werror)
    if(FORGE_NATIVE_BREP)
        target_compile_definitions(forge_kernel_correctness_gate PRIVATE FORGE_NATIVE_BREP=1)
    endif()
    target_link_libraries(forge_kernel_correctness_gate PRIVATE forge_kernel_core)
    if(APPLE)
        set_target_properties(forge_kernel_correctness_gate PROPERTIES
            BUILD_RPATH "${CMAKE_BINARY_DIR};${OCCT_LIB}")
    endif()
    add_test(NAME kernel.correctness_gate COMMAND forge_kernel_correctness_gate)
    set_tests_properties(kernel.correctness_gate PROPERTIES
        TIMEOUT 300
        FAIL_REGULAR_EXPRESSION "FAIL ")

    # capi/forge_capi_smoke.cpp — the K7 opaque-handle C-API black box, end to
    # end. It #includes ONLY the C header, which is the boundary proof, so its
    # include path is deliberately just include/ (no OCCT headers).
    add_executable(forge_capi_smoke "${FORGE_TEST_DIR}/capi/forge_capi_smoke.cpp")
    target_include_directories(forge_capi_smoke PRIVATE "${CMAKE_SOURCE_DIR}/include")
    target_link_libraries(forge_capi_smoke PRIVATE forge_kernel_core)
    if(APPLE)
        set_target_properties(forge_capi_smoke PROPERTIES
            BUILD_RPATH "${CMAKE_BINARY_DIR};${OCCT_LIB}")
    endif()
    add_test(NAME kernel.capi_smoke COMMAND forge_capi_smoke)
    set_tests_properties(kernel.capi_smoke PROPERTIES
        TIMEOUT 300
        FAIL_REGULAR_EXPRESSION "FAIL check")

endif()

# ---------------------------------------------------------------- 2b. standalone A/B oracles
# forge-kernel/test/*.cpp holds a large body of STANDALONE C++20 gates that build
# the SAME case twice -- once through the in-house forge::native engine and once
# through live OCCT 7.9.3 -- and assert the two agree, usually against a closed
# form as well. Every one of them already existed and already passed; each was
# run by hand, and several carried a comment saying so ("It is NOT part of the
# native gate (run_native.sh) and does NOT touch binding.cpp / CMakeLists.txt").
# That is precisely why the JS harness was the kernel's only citable evidence:
# this evidence existed but was not a suite.
#
# HOW THE LIST BELOW WAS CHOSEN -- measured, not assumed. Every .cpp in test/ was
# compiled against forge_kernel_core + OCCT and RUN with a 180 s kill. Only the
# ones that COMPILED, RAN and EXITED 0 are listed. Deliberately EXCLUDED, with
# the measurement that excluded them:
#   native_hlr_perf, native_hlr_import_perf  -- both end in an unconditional
#       `return 0;`. They are timing instruments with no threshold: registering
#       them would add a test THAT CANNOT FAIL, which is worse than no test.
#   golden_corpus_measure  -- a CLI tool, not a test: with no argv it prints
#       "usage: --mode <occt|native> --step <file.step>" and exits 2.
#   native_vs_occt_fillet_var (rc 1)  -- a REAL measured disagreement, not a
#       harness fault: native matches the closed form to 4.6e-15 rel while OCCT
#       differs by 4.444e-05, over a 1e-6 threshold. It is an open gap.
#   native_vs_occt_iges (rc 1, 11/16)  -- case C PARTIAL, a 128-entity
#       property-flag-count divergence.
#   native_fuse_mesh_operand_test (rc 134 = SIGABRT),
#   native_occt_import_test (rc 1), native_occt_wire_activation_test (rc 1).
#
#   ab_native_thicken_occt -- WITHHELD, and it is the most interesting exclusion
#       here because THIS SUITE IS WHAT FOUND IT. The gate was measured GREEN at
#       876b179a and is RED at a70dd1da (this branch's base): 208 passed, 19
#       FAILED. Every one of the 19 is a SURFACE-TYPE count -- e.g. "case1 flat
#       20x10 t=2 planar-face count : got 2 want 6" and "other-surface-type
#       count : got 4 want 0". ZERO volume assertions fail, and the negative
#       control still rejects an equal-volume impostor on 12 observables. So the
#       thickened solid has the RIGHT VOLUME and the WRONG FACES.
#       The only change to src/native/brep/NativeThickenShell.cpp between those
#       two commits replaces BRepPrimAPI_MakePrism with the in-house
#       forge::occtPrism (the TKPrim link-line drop): the swept faces are no
#       longer classified GeomAbs_Plane. Re-register this gate the moment
#       occtPrism's output surfaces are canonized back to analytic. It is
#       withheld rather than weakened -- not one `want` was changed.
#
# Those six are NOT registered and NOT weakened. Nothing here lowers a
# threshold or widens a tolerance to go green; the red ones simply stay out
# until they are fixed, and are named in JS_RETIREMENT_LEDGER.md so they cannot
# be quietly forgotten.
#
# ON THE OCCT LINK LINE: these are TEST EXECUTABLES. The OCCT ledger
# (scripts/occt_closure_count.sh, occt_drop_gate.sh) measures a NAMED BINARY --
# forge-kernel.node by default -- so the toolkits an A/B oracle needs in order to
# BE an oracle (it must call the OCCT side) cannot move the drop counters. The
# forge_kernel / forge_kernel_core link lines are byte-untouched by this block.
if(FORGE_BUILD_TESTS AND TARGET forge_kernel_core)

    # The modeling+data-exchange toolkit set the oracles need for their OCCT
    # half. Test-target only -- see the note above.
    set(FORGE_TEST_OCCT_LIBS
        TKernel TKMath TKG2d TKG3d TKGeomBase TKGeomAlgo TKBRep TKTopAlgo TKPrim
        TKBO TKBool TKFillet TKOffset TKShHealing TKHLR TKMesh TKFeat TKXSBase
        TKDE TKDESTEP TKDESTL TKDEIGES TKXCAF TKLCAF TKCAF TKCDF TKDECascade
        TKRWMesh TKDEGLTF)

    set(FORGE_AB_GATES
        # TKOffset-family native-vs-OCCT A/B harnesses (each carries a negative
        # control that rejects an equal-volume impostor on a VECTOR of observables)
        ab_native_draft_occt
        ab_native_filling_occt
        ab_native_loftpipe_occt
        ab_native_offsetshape_occt
        ab_native_sweep_occt
        # ab_native_thicken_occt -- WITHHELD, RED AT THIS COMMIT. See the note below.
        # regression gates
        io_stl_binary_solid_header      # binary STL whose 80-byte header says "solid"
        matelib_quat_ab                 # in-house quaternion rotate vs the rotation matrix
        # native-engine vs live-OCCT oracles
        native_vs_occt_allbox
        native_vs_occt_chamfer
        native_vs_occt_chamfer_asym
        native_vs_occt_convexhull
        native_vs_occt_dataexchange_write
        native_vs_occt_draft
        native_vs_occt_exact_boolean
        native_vs_occt_fillet
        native_vs_occt_fillet_curved
        native_vs_occt_fillet_ext
        native_vs_occt_fuzzy_boolean
        native_vs_occt_gear
        native_vs_occt_gregory_nsided
        native_vs_occt_heal
        native_vs_occt_heal_ext
        native_vs_occt_helical
        native_vs_occt_hlr
        native_vs_occt_hlr_import
        native_vs_occt_hlr_persp
        native_vs_occt_import_surfaces
        native_vs_occt_interference
        native_vs_occt_loftsweep
        native_vs_occt_nurbs_ssi
        native_vs_occt_offset_shape
        native_vs_occt_pattern
        native_vs_occt_query
        native_vs_occt_section
        native_vs_occt_sew
        native_vs_occt_shell
        native_vs_occt_step_read        # NOTE: its own verdict counts PARTIAL as passing
        native_vs_occt_stl
        native_vs_occt_surfacefill
        native_vs_occt_surfacefill_g2
        native_vs_occt_trimmed_face
        native_vs_occt_validator
        native_vs_occt_validator_ext
        step_read_occt_projection_gate
    )

    foreach(_g IN LISTS FORGE_AB_GATES)
        add_executable(forge_gate_${_g} "${FORGE_TEST_DIR}/${_g}.cpp")
        target_include_directories(forge_gate_${_g} PRIVATE
            "${CMAKE_SOURCE_DIR}/include"
            "${OCCT_INC}")
        if(FORGE_NATIVE_BREP)
            target_compile_definitions(forge_gate_${_g} PRIVATE FORGE_NATIVE_BREP=1)
        endif()
        target_link_directories(forge_gate_${_g} PRIVATE "${OCCT_LIB}")
        target_link_libraries(forge_gate_${_g} PRIVATE
            forge_kernel_core ${FORGE_TEST_OCCT_LIBS})
        if(APPLE)
            set_target_properties(forge_gate_${_g} PROPERTIES
                BUILD_RPATH "${CMAKE_BINARY_DIR};${OCCT_LIB}")
        endif()
        add_test(NAME kernel.ab.${_g} COMMAND forge_gate_${_g})
        # 600 s: the slowest measured here is native_vs_occt_surfacefill_g2 at
        # 104 s, then native_vs_occt_convexhull at 57 s and trimmed_face at 21 s.
        set_tests_properties(kernel.ab.${_g} PROPERTIES TIMEOUT 600)
    endforeach()

endif()

# ---------------------------------------------------------------- 3. shell gates
# Self-contained: each builds whatever C++ it needs with a plain compiler and
# returns a real exit code. They are registered as-is — the scripts are not
# modified by this block.
find_program(FORGE_BASH bash)
if(FORGE_BASH)

    # test/native/run_native.sh — the in-house pure-C++20 native kernel suite:
    # it compiles every forge::native source once, then builds and RUNS each of
    # the 138 tests under test/native/<class>/ against the whole object set.
    # No OCCT, no Node, no CMake. This is the single largest body of existing
    # C++ acceptance evidence in the repository.
    add_test(NAME kernel.native_suite
             COMMAND "${FORGE_BASH}" "${FORGE_TEST_DIR}/native/run_native.sh")
    set_tests_properties(kernel.native_suite PROPERTIES TIMEOUT 3600)

    # test/ft/s0_ratchet.sh — SACROSANCT 3.1 Appendix B s0 acceptance
    # (s0.4 graph cardinality, s0.5 opaque macros, s0.6 pattern occurrence
    # tables, s0.11 chunk/hash chain), under the project's own conformance
    # RATCHET.
    #
    # It is the ratchet and NOT build_s0_acceptance.sh that is registered, and
    # that is not a weakening — it is the only correct reading of this gate.
    # MEASURED here: build_s0_acceptance.sh exits 1 with `TOTAL pass=42 fail=5`
    # and prints "These failures are the deliverable. Do not weaken them." The
    # suite deliberately asserts laws the implementation does not yet satisfy,
    # so its raw exit code is 1 BY DESIGN and will stay 1 until those five gaps
    # are closed. Registering the raw script would have parked a permanently red
    # test in the suite, which is how a suite gets ignored. s0_ratchet.sh runs
    # the identical, unmodified suite and compares its failure count with
    # s0_conformance_baseline.txt (S0_EXPECTED_FAILURES=5): red if conformance
    # REGRESSES, and also red if it IMPROVES without the baseline being lowered
    # in the same commit. It is strictly stronger than "exit 0", not weaker.
    add_test(NAME kernel.ft_s0_ratchet
             COMMAND "${FORGE_BASH}" "${FORGE_TEST_DIR}/ft/s0_ratchet.sh")
    set_tests_properties(kernel.ft_s0_ratchet PROPERTIES TIMEOUT 900)

    # test/unify_coaxial_guard_test.sh — the mixed-representation coaxial-bore
    # SIGSEGV guard: 3 crashers (rc=139 before the guard) and 6 must-not-move
    # cases, each asserted on a VECTOR of observables (valid, volume, face count,
    # edge count, shell count) against a closed form. It drives forge_verify, so
    # it is registered only when this configure actually built one, and it is
    # pointed at THIS build's binary instead of letting the script go build its
    # own copy in the source tree.
    if(TARGET forge_verify)
        add_test(NAME kernel.unify_coaxial_guard
                 COMMAND "${FORGE_BASH}" "${FORGE_TEST_DIR}/unify_coaxial_guard_test.sh")
        set_tests_properties(kernel.unify_coaxial_guard PROPERTIES
            TIMEOUT 900
            ENVIRONMENT "FORGE_KERNEL_BUILD_DIR=${CMAKE_BINARY_DIR}")
    endif()

endif()
