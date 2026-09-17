# SPDX-License-Identifier: LGPL-2.1-or-later
#
# libforge_expr — FreeCAD's expression language and unit system, adapted for Forge.
#
# ALWAYS A SHARED LIBRARY. This code is LGPL-2.1-or-later. Forge links it
# dynamically and ships it as Forge.app/Contents/Frameworks/libforge_expr.dylib so
# that a recipient can replace it with a modified build without relinking Forge
# (LGPL-2.1 section 6(b)). There is no static variant and there must never be one:
# tools/gates/freecad_derived_lgpl_gate.sh fails the build tree if any
# third_party/freecad-derived library is declared anything but SHARED, or if any
# of its sources is compiled into another target.
#
# The source list and flags are mirrored by build_forge_expr.sh (for the headless
# gates, which do not run CMake); the LGPL gate checks the two lists agree.

cmake_minimum_required(VERSION 3.20)

set(FORGE_EXPR_SOURCES
    src/Unit.cpp
    src/Quantity.cpp
    src/Expression.cpp
    src/Evaluator.cpp
)

add_library(forge_expr SHARED ${FORGE_EXPR_SOURCES})
target_compile_features(forge_expr PUBLIC cxx_std_20)
target_include_directories(forge_expr
    PUBLIC  "${CMAKE_CURRENT_SOURCE_DIR}/include"
    PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_compile_definitions(forge_expr PRIVATE FORGE_EXPR_BUILDING)
set_target_properties(forge_expr PROPERTIES
    OUTPUT_NAME forge_expr
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON
    # No VERSION/SOVERSION: the file is libforge_expr.dylib and its install name
    # is @rpath/libforge_expr.dylib -- the same name build_forge_expr.sh produces,
    # so the bundle, the gates and a user's replacement build all agree on it.
    # @rpath is resolved from the executable's rpath, which the packager points at
    # Contents/Frameworks.
    INSTALL_NAME_DIR "@rpath"
    BUILD_WITH_INSTALL_NAME_DIR ON
    MACOSX_RPATH ON)
target_compile_options(forge_expr PRIVATE -Wall -Wextra)
