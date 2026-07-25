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
    message(FATAL_ERROR "node-addon-api not found at ${NODE_ADDON_API_DIR}. Run `npm install` at repo root.")
endif()

# ---------------------------------------------------------------- OCCT
# brew-installed OCCT 7.9.3 on Apple Silicon by default. Override with
# -DOCCT_ROOT=... or the OCCT_ROOT env var (e.g. CI on an Intel mac runner
# where brew lives at /usr/local, or a custom OCCT prefix).
if(DEFINED ENV{OCCT_ROOT} AND NOT DEFINED OCCT_ROOT)
    set(OCCT_ROOT "$ENV{OCCT_ROOT}")
endif()
if(NOT DEFINED OCCT_ROOT)
    set(OCCT_ROOT "/opt/homebrew/opt/opencascade")
endif()
# Fall back to the Intel-mac brew prefix if the ARM path is absent.
if(NOT EXISTS "${OCCT_ROOT}/include/opencascade/Standard_Version.hxx"
   AND EXISTS "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx")
    set(OCCT_ROOT "/usr/local/opt/opencascade")
endif()
if(NOT EXISTS "${OCCT_ROOT}/include/opencascade/Standard_Version.hxx")
    message(FATAL_ERROR "OCCT not found at ${OCCT_ROOT}. Install with `brew install opencascade` or set -DOCCT_ROOT=...")
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
    TKFillet TKOffset
)
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
set(BOOST_INC "/opt/homebrew/opt/boost/include")
if(NOT EXISTS "${BOOST_INC}/boost/graph/adjacency_list.hpp")
    message(FATAL_ERROR "Boost not found at ${BOOST_INC}. Install with `brew install boost`.")
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
add_library(forge_kernel SHARED
    ${CMAKE_JS_SRC}
    src/binding.cpp
    src/ShapeRegistry.cpp
    src/OcctPrimBuilder.cpp       # TKPrim-free analytic OCCT primitive solids (Geom_ + BRepBuilderAPI)
    src/NativeOcctBridge.cpp
    src/OcctImport.cpp
    src/Primitives.cpp
    src/Booleans.cpp
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
    src/native/brep/Shell.cpp           # offset/shell: hollow a solid to a uniform wall (analytic face offset + SSI re-trim + sew), open or closed
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
    # KEYSTONE K7 — Parasolid-style opaque-handle C-API black box wrapping the
    # native brep/mesh/csg kernel (include/forge/capi/forge_capi.h). Strict
    # extern "C"; no C++ types cross the boundary. Verify batch also compiles
    # test/capi/forge_capi_smoke.cpp against it. Deps (brep Primitives/Boolean/
    # Fillet/Shell/Sweep/MassProps/Aabb/SolidTessellate/StepAnalytic/StepFaceted +
    # csg/Revolve + mesh/HalfEdgeMesh) are already listed above.
    src/native/capi/forge_capi.cpp
    ${PLANEGCS_SRC}
)

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
    get_target_property(_fk_all_sources forge_kernel SOURCES)

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
    target_link_libraries(forge_kernel_core PRIVATE ${OCCT_LIBS})

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
