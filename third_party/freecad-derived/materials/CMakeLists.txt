# SPDX-License-Identifier: LGPL-2.1-or-later
# Copyright (c) 2026 ArchDisc. Part of the Forge build of the FreeCAD material
# library; see COPYING.LGPL, README.md and MODIFICATIONS.md beside this file.
#
# libforge_fcmaterials -- FreeCAD's material cards and model definitions, served
# read-only through the plain C interface in include/forge_fcmat/fcmat_bundle.h.
#
# ★ SHARED, and that is the licence compliance, not a packaging preference. The
#   cards are LGPL. Built as its own dynamic library, installed into
#   Forge.app/Contents/Frameworks and loaded by @rpath, the LGPL part of the
#   product is one replaceable file: anyone can change a card, rebuild this
#   directory on its own and drop the result into the bundle. Compiling these
#   files into forge_desktop, forge_kernel_worker or libforge_kernel_core would
#   end that, and tools/gates/freecad_derived_compliance_gate.sh refuses it.
#
# It builds standalone:
#   cmake -S third_party/freecad-derived/materials -B build-fcmat && cmake --build build-fcmat
# and forge-desktop/CMakeLists.txt pulls it in with add_subdirectory().
cmake_minimum_required(VERSION 3.20)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    project(forge_fcmaterials CXX)
    set(CMAKE_CXX_STANDARD 17)
    set(CMAKE_CXX_STANDARD_REQUIRED ON)
endif()

set(FCMAT_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
set(FCMAT_GEN "${CMAKE_CURRENT_BINARY_DIR}/generated")
file(MAKE_DIRECTORY "${FCMAT_GEN}")

# Every embedded file is a dependency, so editing a card rebuilds the library.
file(GLOB_RECURSE FCMAT_RESOURCES CONFIGURE_DEPENDS
     "${FCMAT_DIR}/Resources/*.FCMat" "${FCMAT_DIR}/Resources/*.yml")

add_custom_command(
    OUTPUT "${FCMAT_GEN}/fcmat_resources.inc"
    COMMAND "${CMAKE_COMMAND}" "-DCOMPONENT=${FCMAT_DIR}"
            "-DOUT=${FCMAT_GEN}/fcmat_resources.inc"
            -P "${FCMAT_DIR}/cmake/embed_resources.cmake"
    DEPENDS "${FCMAT_DIR}/component.json" "${FCMAT_DIR}/cmake/embed_resources.cmake"
            ${FCMAT_RESOURCES}
    COMMENT "libforge_fcmaterials: embedding the recorded FreeCAD material files"
    VERBATIM)

add_library(forge_fcmaterials SHARED
    "${FCMAT_DIR}/src/fcmat_bundle.cpp"
    "${FCMAT_GEN}/fcmat_resources.inc")
target_include_directories(forge_fcmaterials
    PUBLIC "${FCMAT_DIR}/include"
    PRIVATE "${FCMAT_GEN}")
set_target_properties(forge_fcmaterials PROPERTIES
    OUTPUT_NAME forge_fcmaterials
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON
    # @rpath/libforge_fcmaterials.dylib, which is what the packager's install-name
    # rewrite expects of every dylib it stages into Contents/Frameworks.
    # No VERSION/SOVERSION: one file with one name, so the bundle holds a single
    # libforge_fcmaterials.dylib and not a chain of symlinks to follow.
    MACOSX_RPATH ON)
