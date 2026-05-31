cmake_minimum_required(VERSION 3.20)
project(forge_kernel CXX)

set(CMAKE_CXX_STANDARD 17)
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

# Node-API C++ wrapper (header-only).
set(NODE_ADDON_API_DIR "${CMAKE_SOURCE_DIR}/../node_modules/node-addon-api")
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

# -------------------------------------------------------------- target
add_library(forge_kernel SHARED
    ${CMAKE_JS_SRC}
    src/binding.cpp
    src/ShapeRegistry.cpp
    src/Primitives.cpp
    src/Booleans.cpp
    src/Tessellate.cpp
    src/MassProps.cpp
    src/Transform.cpp
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
