# SPDX-License-Identifier: LGPL-2.1-only
#
# libforge_asmsolver -- Forge's modified OndselSolver (LGPL-2.1).
#
# ── WHY THIS IS A SEPARATE SHARED LIBRARY, AND MUST STAY ONE ───────────────────
# Everything under third_party/freecad-derived/ is LGPL. Forge ships it as a
# dynamic library in Forge.app/Contents/Frameworks so that a recipient can
# rebuild this directory from its published source and drop the result into an
# installed Forge without relinking the application (LGPL-2.1 section 6). That
# property is lost the moment one of these objects is compiled into
# forge_desktop, forge_kernel_worker or libforge_kernel_core, so:
#
#   * the target below is SHARED and there is no STATIC variant of it;
#   * the host sees exactly one header, include/forge_asmsolver/AsmSolver.h,
#     which names no OndselSolver type;
#   * third_party/freecad-derived/lgpl_compliance_gate.sh fails CI if any
#     derived source appears in another target or the library is not shared.
#
# The directory builds on its own, which is how a recipient exercises that right:
#
#   cmake -S third_party/freecad-derived/assembly-solver -B build-asm -DCMAKE_BUILD_TYPE=Release
#   cmake --build build-asm
#
# No OCCT, no Qt, no Coin3D, no Python -- the C++ standard library only.
cmake_minimum_required(VERSION 3.20)
project(forge_asmsolver VERSION 1.0.0 LANGUAGES CXX)

if(NOT CMAKE_CXX_STANDARD)
    set(CMAKE_CXX_STANDARD 20)
endif()
set(CMAKE_CXX_STANDARD_REQUIRED ON)

file(GLOB FORGE_ASMSOLVER_SOURCES CONFIGURE_DEPENDS
     "${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp")

add_library(forge_asmsolver SHARED ${FORGE_ASMSOLVER_SOURCES})
target_include_directories(forge_asmsolver
    PUBLIC  "${CMAKE_CURRENT_SOURCE_DIR}/include"
    PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
set_target_properties(forge_asmsolver PROPERTIES
    POSITION_INDEPENDENT_CODE ON
    CXX_VISIBILITY_PRESET default
    # @rpath: the application finds it in Contents/Frameworks, a build tree
    # finds it beside the binaries through their BUILD_RPATH.
    INSTALL_NAME_DIR "@rpath"
    BUILD_WITH_INSTALL_NAME_DIR ON)
# Third-party code: compiled with the toolchain's default warnings and never
# -Werror. The upstream numerics are not reformatted to satisfy a house style.

# The library's own self-test, through the public header only: what a recipient
# who rebuilds this library runs to see that their build still solves.
option(FORGE_ASMSOLVER_SELFTEST "build asmsolver_selftest" ${PROJECT_IS_TOP_LEVEL})
if(FORGE_ASMSOLVER_SELFTEST)
    add_executable(asmsolver_selftest "${CMAKE_CURRENT_SOURCE_DIR}/test/asmsolver_selftest.cpp")
    target_link_libraries(asmsolver_selftest PRIVATE forge_asmsolver)
    set_target_properties(asmsolver_selftest PROPERTIES BUILD_RPATH "${CMAKE_CURRENT_BINARY_DIR}")
endif()
