# SPDX-License-Identifier: LGPL-2.1-or-later
#
# libforge_gcs -- FreeCAD planegcs, modified for Forge (see MODIFICATIONS.md).
#
# THIS DIRECTORY BUILDS ONE SHARED LIBRARY AND NOTHING ELSE. That is the LGPL-2.1
# boundary: Forge's executables and libforge_kernel_core LINK libforge_gcs, and
# none of its objects is ever compiled into them. A user who modifies these
# sources can rebuild libforge_gcs.dylib on its own -- this file works as a
# top-level project (`cmake -S third_party/freecad-derived/sketch-solver`) as
# well as through add_subdirectory -- and place it in Forge.app/Contents/Frameworks.
#
# Dependencies: a C++20 compiler, Eigen >= 3.3 (headers) and Boost.Graph /
# Boost.Math (headers). Nothing is downloaded.
cmake_minimum_required(VERSION 3.20)
project(forge_gcs VERSION 1.0.0 LANGUAGES CXX)

set(FORGE_GCS_DIR "${CMAKE_CURRENT_SOURCE_DIR}")

# ---- Eigen (headers only) ---------------------------------------------------
# find_path, not find_package: the Forge build resolves no Eigen package, and a
# header search is all a header-only library needs. EIGEN3_INCLUDE_DIR wins when
# given.
find_path(FORGE_GCS_EIGEN_INCLUDE_DIR
    NAMES Eigen/Core
    HINTS "${EIGEN3_INCLUDE_DIR}" "$ENV{EIGEN3_INCLUDE_DIR}"
    PATHS /opt/homebrew/opt/eigen/include/eigen3
          /opt/homebrew/include/eigen3
          /usr/local/opt/eigen/include/eigen3
          /usr/local/include/eigen3
          /usr/include/eigen3
    NO_CMAKE_FIND_ROOT_PATH)
if(NOT FORGE_GCS_EIGEN_INCLUDE_DIR)
    message(FATAL_ERROR
        "libforge_gcs needs the Eigen headers (>= 3.3). Install them "
        "(macOS: brew install eigen; Debian/Ubuntu: apt install libeigen3-dev) or pass "
        "-DEIGEN3_INCLUDE_DIR=/path/containing/Eigen.")
endif()

# ---- Boost (headers only) ---------------------------------------------------
if(DEFINED BOOST_INC AND EXISTS "${BOOST_INC}/boost/graph/adjacency_list.hpp")
    set(FORGE_GCS_BOOST_INCLUDE_DIR "${BOOST_INC}")
else()
    find_path(FORGE_GCS_BOOST_INCLUDE_DIR
        NAMES boost/graph/adjacency_list.hpp
        HINTS "${BOOST_INCLUDEDIR}" "$ENV{BOOST_INCLUDEDIR}"
        PATHS /opt/homebrew/opt/boost/include
              /opt/homebrew/include
              /usr/local/opt/boost/include
              /usr/local/include
              /usr/include
        NO_CMAKE_FIND_ROOT_PATH)
endif()
if(NOT FORGE_GCS_BOOST_INCLUDE_DIR)
    message(FATAL_ERROR
        "libforge_gcs needs the Boost.Graph and Boost.Math headers. Install Boost "
        "(macOS: brew install boost; Debian/Ubuntu: apt install libboost-dev) or pass "
        "-DBOOST_INCLUDEDIR=/path/containing/boost.")
endif()

add_library(forge_gcs SHARED
    "${FORGE_GCS_DIR}/planegcs/Constraints.cpp"
    "${FORGE_GCS_DIR}/planegcs/GCS.cpp"
    "${FORGE_GCS_DIR}/planegcs/Geo.cpp"
    "${FORGE_GCS_DIR}/planegcs/SubSystem.cpp"
    "${FORGE_GCS_DIR}/planegcs/qp_eq.cpp"
    "${FORGE_GCS_DIR}/src/forge_gcs.cpp"
)
target_compile_features(forge_gcs PRIVATE cxx_std_20)
set_target_properties(forge_gcs PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON
    OUTPUT_NAME "forge_gcs"
    VERSION 1.0.0
    SOVERSION 1
    # Found at run time through the loader's rpath: beside the kernel core in a
    # build tree, in Contents/Frameworks inside Forge.app.
    INSTALL_NAME_DIR "@rpath"
    BUILD_WITH_INSTALL_NAME_DIR ON
)
target_include_directories(forge_gcs
    PUBLIC  "${FORGE_GCS_DIR}/include"
    PRIVATE "${FORGE_GCS_DIR}/compat"
            "${FORGE_GCS_DIR}/planegcs"
            "${FORGE_GCS_EIGEN_INCLUDE_DIR}"
            "${FORGE_GCS_BOOST_INCLUDE_DIR}"
)
# EIGEN_NO_DEBUG is what FreeCAD's own build sets for planegcs (GCS.cpp says so).
target_compile_definitions(forge_gcs PRIVATE EIGEN_NO_DEBUG FORGE_GCS_BUILDING=1)
# Third-party source: quiet its warnings, keep Forge's own code loud elsewhere.
target_compile_options(forge_gcs PRIVATE -w)

install(TARGETS forge_gcs
    LIBRARY DESTINATION Frameworks
    RUNTIME DESTINATION Frameworks)
install(FILES "${FORGE_GCS_DIR}/include/forge_gcs/forge_gcs.h" DESTINATION include/forge_gcs)
install(FILES "${FORGE_GCS_DIR}/COPYING.LGPL" "${FORGE_GCS_DIR}/MODIFICATIONS.md"
              "${FORGE_GCS_DIR}/NOTICE.md"
        DESTINATION share/licenses/forge_gcs)
