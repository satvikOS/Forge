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
    TKG2d TKG3d TKGeomBase TKGeomAlgo
    TKBRep TKTopAlgo TKShHealing
    TKPrim TKBO TKBool TKFillet TKOffset
    TKHLR TKMesh
    TKDE TKDESTEP TKDEIGES TKDESTL TKDEVRML TKXSBase
)

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
    src/NativeOcctBridge.cpp
    src/Primitives.cpp
    src/Booleans.cpp
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
    src/Cfd.cpp
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
    src/native/geom/Geom.cpp
    src/native/geom/Delaunay.cpp
    src/native/gdt/Gdt.cpp
    src/native/mesh/HalfEdgeMesh.cpp
    src/native/mesh/TriTriIntersect.cpp
    src/native/mesh/MeshBoolean.cpp
    src/native/mesh/MeshBooleanNative.cpp
    src/native/implicit/SdfTree.cpp
    src/native/implicit/IsoMesher.cpp
    src/native/implicit/DualContour.cpp
    src/native/voxel/VoxelGrid.cpp
    src/native/voxel/VoxelMesh.cpp
    src/native/voxel/Tpms.cpp
    src/native/brep/Nurbs.cpp
    src/native/brep/NurbsCalculus.cpp
    src/native/brep/NurbsSurface.cpp   # surfit dep: brep::evaluateWithDerivatives
    src/native/brep/Topology.cpp
    src/native/brep/Curve.cpp           # K0 — tagged Curve/PCurve geometry + tolerance attrs (Wave-1)
    src/native/brep/NurbsAlgebra.cpp    # K1.1 — NURBS algebra: elevate/knot-ops/curvature/iso/projection (Wave-1)
    # IN-HOUSE KERNEL STEP 1 — OCCT-free primitive B-rep solids + exact
    # mass-properties + watertight tessellation (pure C++20 stdlib, no new link
    # libs). Always compiled into the addon; the JS surface is gated behind
    # FORGE_NATIVE_BREP in binding.cpp so the live OCCT path stays the default.
    src/native/brep/Surface.cpp
    src/native/brep/Primitives.cpp
    src/native/brep/MassProps.cpp
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
    src/native/brep/Boolean.cpp
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
    # Task #46 — bind the remaining forge::native engines into the addon so
    # Archie can call them via CUA. Pure C++20 stdlib (no new link libs).
    # geom/AABBTree + voxel/VoxelBoolean are cam's #include dependencies; list
    # Materials.cpp ONCE (am + composites both #include it, single .o links all).
    src/native/geom/AABBTree.cpp
    src/native/voxel/VoxelBoolean.cpp
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
    src/native/geom/MinkowskiSum3D.cpp
    src/native/mesh/SelfIntersect.cpp
    # Wave-0 — implicit/voxel/F-rep field-design stack (implicit-frep.md + voxel-lattice.md Phase A)
    src/binding_field.cpp
    src/native/implicit/SdfLibrary.cpp
    src/native/implicit/SdfOps.cpp
    src/native/implicit/FRepTree.cpp
    src/native/implicit/MeshToFRep.cpp
    src/native/voxel/Lattice.cpp
    src/native/voxel/Morphology.cpp
    # Wave-0 — PlaneGCS constraint diagnostics (sketcher-constraints.md Phase A)
    src/binding_sketchdiag.cpp
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
