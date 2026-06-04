cmake_minimum_required(VERSION 3.20)
project(forge_kernel CXX)

set(CMAKE_CXX_STANDARD 20)  # planegcs uses <std::numbers> + <std::ranges>
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

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
# brew-installed OCCT 7.9.3 on Apple Silicon.
set(OCCT_ROOT "/opt/homebrew/opt/opencascade")
if(NOT EXISTS "${OCCT_ROOT}/include/opencascade/Standard_Version.hxx")
    message(FATAL_ERROR "OCCT not found at ${OCCT_ROOT}. Install with `brew install opencascade`.")
endif()

set(OCCT_INC "${OCCT_ROOT}/include/opencascade")
set(OCCT_LIB "${OCCT_ROOT}/lib")

# ---------------------------------------------------------------- Eigen
# Header-only template library; brew-installed.
set(EIGEN_INC "/opt/homebrew/opt/eigen/include/eigen3")
if(NOT EXISTS "${EIGEN_INC}/Eigen/Dense")
    message(FATAL_ERROR "Eigen not found at ${EIGEN_INC}. Install with `brew install eigen`.")
endif()

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

# ---------------------------------------------------------------- Eigen
# Header-only; planegcs and the wider Forge kernel both rely on it.
set(EIGEN_INC "/opt/homebrew/opt/eigen/include/eigen3")
if(NOT EXISTS "${EIGEN_INC}/Eigen/Sparse")
    message(FATAL_ERROR "Eigen not found at ${EIGEN_INC}. Install with `brew install eigen`.")
endif()

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
    src/Drawings.cpp
    src/Sketcher.cpp
    src/Fea.cpp
    src/FeaExtras.cpp
    src/FeaContact.cpp
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
    "${EIGEN_INC}"
    "${BOOST_INC}"
    "${PLANEGCS_DIR}"
    "${CMAKE_SOURCE_DIR}/include"
)

target_compile_definitions(forge_kernel PRIVATE
    NAPI_VERSION=8
    NAPI_CPP_EXCEPTIONS
)

target_link_directories(forge_kernel PRIVATE "${OCCT_LIB}")
target_link_libraries(forge_kernel PRIVATE ${OCCT_LIBS} ${CMAKE_JS_LIB})

# Darwin: bundle loader linkage if not using cmake-js.
if(APPLE AND NOT DEFINED CMAKE_JS_LIB)
    set_target_properties(forge_kernel PROPERTIES
        LINK_FLAGS "-undefined dynamic_lookup -Wl,-rpath,${OCCT_LIB}"
    )
endif()
