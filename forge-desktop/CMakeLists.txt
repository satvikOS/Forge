# ============================================================================
# forge-desktop — THE FORGE DESKTOP APPLICATION (Sacrosanct s19.2, D-001/D-006)
#
# Four targets:
#   forge_desktop             the real app: SDL2 window + Vulkan-on-MoltenVK
#                             swapchain + Dear ImGui + the forge::ui service
#                             layer + a 3D viewport over a real kernel body
#                             compiled from the live document's feature-IR.
#   forge_desktop_frame_gate  HEADLESS: builds one real ImGui frame with no
#                             window, no swapchain and no GPU, and asserts on the
#                             draw data and on the service wiring.
#   forge_desktop_document_gate
#                             HEADLESS: the user-launchable slice. The ONE
#                             registry -> PartDocument -> forge::ft -> the
#                             viewport vertices -> a .fpart on disk -> back.
#   forge_desktop_ir_pipeline_gate
#                             HEADLESS: a UI-authored IR program parses, compiles
#                             and measures as a real solid.
#   forge_desktop_click_gate  HEADLESS and INTERACTIVE: drives the real ImGui
#                             input queue to click every dock tab and drag every
#                             splitter in every workspace, steps a further frame
#                             after each gesture, and asserts the app is still
#                             alive and the dock tree still consistent. Built
#                             with -fsanitize=address, because the defect it
#                             exists for is a use-after-free.
#
# This is a SEPARATE CMake project from forge-kernel/CMakeLists.txt on purpose.
# The kernel's build has its own option matrix, its own OCCT-drop gates and a CI
# job that must stay byte-identical; an application that links it is a consumer,
# not another option flag on it. It finds the node-free `forge_kernel_core`
# library that the kernel build produces.
#
#   cmake -S forge-kernel -B forge-kernel/build-app \
#         -DCMAKE_BUILD_TYPE=Release -DFORGE_BUILD_NODE_ADDON=OFF \
#         -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
#   cmake --build forge-kernel/build-app -j8 --target forge_kernel_core
#   cmake -S forge-desktop -B forge-desktop/build -DCMAKE_BUILD_TYPE=Release
#   cmake --build forge-desktop/build -j8
# ============================================================================
cmake_minimum_required(VERSION 3.20)
project(forge_desktop_app CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

set(FORGE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/..")
set(FORGE_UI_DIR "${FORGE_ROOT}/ui")
set(FORGE_KERNEL_DIR "${FORGE_ROOT}/forge-kernel")
set(IMGUI_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/imgui")

# ---------------------------------------------------------------- kernel core
# Where the node-free kernel library was built. Override with
# -DFORGE_KERNEL_BUILD_DIR=<dir> to point at a different kernel build.
set(FORGE_KERNEL_BUILD_DIR "${FORGE_KERNEL_DIR}/build-app"
    CACHE PATH "directory holding libforge_kernel_core")
find_library(FORGE_KERNEL_CORE_LIB
    NAMES forge_kernel_core
    HINTS "${FORGE_KERNEL_BUILD_DIR}"
    NO_DEFAULT_PATH)
if(NOT FORGE_KERNEL_CORE_LIB)
    message(FATAL_ERROR
        "libforge_kernel_core not found in ${FORGE_KERNEL_BUILD_DIR}.\n"
        "Build it first:\n"
        "  cmake -S ${FORGE_KERNEL_DIR} -B ${FORGE_KERNEL_BUILD_DIR} "
        "-DCMAKE_BUILD_TYPE=Release -DFORGE_BUILD_NODE_ADDON=OFF "
        "-DFORGE_BUILD_DESKTOP_FOUNDATION=ON\n"
        "  cmake --build ${FORGE_KERNEL_BUILD_DIR} -j8 --target forge_kernel_core")
endif()
message(STATUS "forge-desktop: kernel core = ${FORGE_KERNEL_CORE_LIB}")

# ---------------------------------------------------------------- deps (brew)
find_program(BREW_EXE brew HINTS /opt/homebrew/bin /usr/local/bin REQUIRED)
# `brew --prefix <formula>` resolves the formula NAME, which Homebrew may have
# renamed: `brew --prefix sdl2` prints .../opt/sdl2-compat on this machine while
# the installed keg is linked at .../opt/sdl2. So the answer is VERIFIED to exist
# and the literal opt link is used as the fallback -- otherwise the build fails
# pointing at a directory that was never installed.
function(brew_prefix name out)
    execute_process(COMMAND ${BREW_EXE} --prefix ${name}
        OUTPUT_VARIABLE _p OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET RESULT_VARIABLE _rc)
    if(_rc EQUAL 0 AND EXISTS "${_p}")
        set(${out} "${_p}" PARENT_SCOPE)
        return()
    endif()
    execute_process(COMMAND ${BREW_EXE} --prefix
        OUTPUT_VARIABLE _root OUTPUT_STRIP_TRAILING_WHITESPACE)
    if(EXISTS "${_root}/opt/${name}")
        message(STATUS "forge-desktop: brew --prefix ${name} gave '${_p}'; "
                       "using the installed keg link ${_root}/opt/${name}")
        set(${out} "${_root}/opt/${name}" PARENT_SCOPE)
        return()
    endif()
    message(FATAL_ERROR "dependency '${name}' not found (brew install ${name})")
endfunction()

brew_prefix(vulkan-headers VK_HEADERS_PREFIX)
brew_prefix(vulkan-loader  VK_LOADER_PREFIX)
brew_prefix(glslang        GLSLANG_PREFIX)
brew_prefix(molten-vk      MOLTENVK_PREFIX)
brew_prefix(sdl2           SDL2_PREFIX)
brew_prefix(opencascade    OCCT_PREFIX)

set(VK_INC "${VK_HEADERS_PREFIX}/include")
set(VK_LOADER_LIB "${VK_LOADER_PREFIX}/lib/libvulkan.dylib")
set(GLSLANG_VALIDATOR "${GLSLANG_PREFIX}/bin/glslangValidator")
set(SDL2_INC "${SDL2_PREFIX}/include/SDL2")
set(SDL2_LIB "${SDL2_PREFIX}/lib/libSDL2.dylib")
set(MOLTENVK_ICD "${MOLTENVK_PREFIX}/etc/vulkan/icd.d/MoltenVK_icd.json")

foreach(_f "${VK_INC}/vulkan/vulkan.h" "${VK_LOADER_LIB}" "${GLSLANG_VALIDATOR}"
           "${SDL2_INC}/SDL.h" "${SDL2_LIB}")
    if(NOT EXISTS "${_f}")
        message(FATAL_ERROR "required dependency file missing: ${_f}")
    endif()
endforeach()
message(STATUS "forge-desktop: SDL2=${SDL2_PREFIX}  Vulkan=${VK_HEADERS_PREFIX}")
message(STATUS "forge-desktop: MoltenVK ICD = ${MOLTENVK_ICD}")

# ---------------------------------------------------------------- shaders
set(SHADER_GEN_DIR "${CMAKE_BINARY_DIR}/shaders")
file(MAKE_DIRECTORY "${SHADER_GEN_DIR}")
set(SHADER_HEADERS "")
# stage;C-identifier pairs -- the identifier is spelled out rather than built from
# the stage, because "viewportSolid${_stage}Spv" produces viewportSolidvertSpv and
# the mismatch only surfaces at compile time in another file.
foreach(_pair "vert;viewportSolidVertSpv" "frag;viewportSolidFragSpv")
    list(GET _pair 0 _stage)
    list(GET _pair 1 _sym)
    add_custom_command(
        OUTPUT "${SHADER_GEN_DIR}/viewport_solid_${_stage}.spv.h"
        COMMAND ${GLSLANG_VALIDATOR} -V --target-env vulkan1.2
                "${CMAKE_CURRENT_SOURCE_DIR}/shaders/viewport_solid.${_stage}"
                --vn ${_sym}
                -o "${SHADER_GEN_DIR}/viewport_solid_${_stage}.spv.h"
        DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/shaders/viewport_solid.${_stage}"
        COMMENT "glslang: viewport_solid.${_stage} -> ${_sym}" VERBATIM)
    list(APPEND SHADER_HEADERS "${SHADER_GEN_DIR}/viewport_solid_${_stage}.spv.h")
endforeach()

# ---------------------------------------------------------------- forge::ui
# Compiled from source rather than linked from a prebuilt library: ui/ has no
# CMakeLists of its own (its gate compiles the sources directly), and adding one
# would change what `ui/test/run_ui.sh` builds.
file(GLOB FORGE_UI_SOURCES "${FORGE_UI_DIR}/src/*.cpp")
add_library(forge_ui STATIC ${FORGE_UI_SOURCES})
target_include_directories(forge_ui PUBLIC "${FORGE_UI_DIR}/include")
# SR-3: -Wall -Wextra -Werror on FIRST-PARTY code. forge::ui is first-party.
target_compile_options(forge_ui PRIVATE -Wall -Wextra -Werror)

# ---------------------------------------------------------------- Dear ImGui
# Vendored, third-party: warnings are NOT errors here, and -Werror is not applied
# to code this project does not own.
add_library(forge_imgui STATIC
    "${IMGUI_DIR}/imgui.cpp"
    "${IMGUI_DIR}/imgui_draw.cpp"
    "${IMGUI_DIR}/imgui_tables.cpp"
    "${IMGUI_DIR}/imgui_widgets.cpp"
    "${IMGUI_DIR}/imgui_impl_vulkan.cpp")
target_include_directories(forge_imgui PUBLIC "${IMGUI_DIR}" "${VK_INC}")
target_link_libraries(forge_imgui PUBLIC "${VK_LOADER_LIB}")

# ---------------------------------------------------------------- app sources
# KernelScene.cpp is the ONLY translation unit that sees OCCT headers.
add_library(forge_desktop_core STATIC
    "${CMAKE_CURRENT_SOURCE_DIR}/src/KernelScene.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/PartFile.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/Camera.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/ForgeFrame.cpp")
target_include_directories(forge_desktop_core PUBLIC
    "${CMAKE_CURRENT_SOURCE_DIR}/src"
    "${FORGE_KERNEL_DIR}/include"
    "${OCCT_PREFIX}/include/opencascade")
target_compile_definitions(forge_desktop_core PRIVATE FORGE_NATIVE_BREP=1)
target_compile_options(forge_desktop_core PRIVATE -Wall -Wextra -Werror)
target_link_libraries(forge_desktop_core PUBLIC forge_ui forge_imgui "${FORGE_KERNEL_CORE_LIB}")

# ---------------------------------------------------------------- the app
add_executable(forge_desktop
    "${CMAKE_CURRENT_SOURCE_DIR}/src/main.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/PlatformSDL2.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/ViewportRenderer.cpp"
    ${SHADER_HEADERS})
target_include_directories(forge_desktop PRIVATE "${SDL2_INC}" "${SHADER_GEN_DIR}")
target_compile_options(forge_desktop PRIVATE -Wall -Wextra -Werror)
target_link_libraries(forge_desktop PRIVATE forge_desktop_core "${SDL2_LIB}" "${VK_LOADER_LIB}")
set_target_properties(forge_desktop PROPERTIES
    BUILD_RPATH "${FORGE_KERNEL_BUILD_DIR};${OCCT_PREFIX}/lib")

# ---------------------------------------------------------------- the gate
# No SDL, no Vulkan, no window: a real ImGui context with a NULL renderer backend
# is all a frame needs, which is the whole reason ForgeFrame never touches the GPU.
add_executable(forge_desktop_frame_gate
    "${CMAKE_CURRENT_SOURCE_DIR}/test/frame_gate.cpp")
target_compile_options(forge_desktop_frame_gate PRIVATE -Wall -Wextra -Werror)
target_link_libraries(forge_desktop_frame_gate PRIVATE forge_desktop_core)
set_target_properties(forge_desktop_frame_gate PROPERTIES
    BUILD_RPATH "${FORGE_KERNEL_BUILD_DIR};${OCCT_PREFIX}/lib")

# ---------------------------------------------------------------- the gates
# ir_pipeline_gate.cpp EXISTED for a while and was built only by a standalone
# script (test/run_ir_pipeline.sh) -- so the one edge that authorises deleting
# the JavaScript was a gate nobody's build ran. It is a target now.
add_executable(forge_desktop_ir_pipeline_gate
    "${CMAKE_CURRENT_SOURCE_DIR}/test/ir_pipeline_gate.cpp")
target_compile_options(forge_desktop_ir_pipeline_gate PRIVATE -Wall -Wextra -Werror)
target_link_libraries(forge_desktop_ir_pipeline_gate PRIVATE forge_desktop_core)
set_target_properties(forge_desktop_ir_pipeline_gate PROPERTIES
    BUILD_RPATH "${FORGE_KERNEL_BUILD_DIR};${OCCT_PREFIX}/lib")

# The DOCUMENT gate: the user-launchable slice, headless. It drives the real
# registry, rebuilds the real kernel geometry from the document, and round-trips
# the document through a real .fpart file on disk.
add_executable(forge_desktop_document_gate
    "${CMAKE_CURRENT_SOURCE_DIR}/test/document_gate.cpp")
target_compile_options(forge_desktop_document_gate PRIVATE -Wall -Wextra -Werror)
target_link_libraries(forge_desktop_document_gate PRIVATE forge_desktop_core)
set_target_properties(forge_desktop_document_gate PROPERTIES
    BUILD_RPATH "${FORGE_KERNEL_BUILD_DIR};${OCCT_PREFIX}/lib")

# ============================================================================
# The CLICK gate, and the ADDRESS-SANITIZED build it needs.
#
# The other three gates render frames and assert on the values that come out.
# None of them clicks anything, and the defect this one exists for was a
# use-after-free that only a click could reach: a tab button re-seated
# shell_.layout() from INSIDE the dock walk, freeing the DockNode the recursion
# held, and the next read faulted at 0x17. Reading freed memory is not reliably a
# crash, so the gate is given a second instrument the others do not need: the
# whole first-party stack is recompiled under -fsanitize=address for this
# executable only, which turns "it happened to survive" into a report.
#
# The three existing gates are untouched -- same sources, same flags, same
# binaries. What is added is a PARALLEL set of libraries, so nothing here can
# make an existing gate slower, weaker or different.
#
# COST: three extra static libraries (forge::ui, Dear ImGui, the app core) plus
# one executable. Measured on this machine, `cmake --build -j10` goes from 6.7 s
# to about 20 s -- the sanitized objects are the same count as the unsanitized
# ones, compiled once. That is the whole price of the second instrument.
# ============================================================================
set(FORGE_ASAN_FLAGS -fsanitize=address -fno-omit-frame-pointer -g)

add_library(forge_ui_asan STATIC ${FORGE_UI_SOURCES})
target_include_directories(forge_ui_asan PUBLIC "${FORGE_UI_DIR}/include")
target_compile_options(forge_ui_asan PRIVATE -Wall -Wextra -Werror ${FORGE_ASAN_FLAGS})

add_library(forge_imgui_asan STATIC
    "${IMGUI_DIR}/imgui.cpp"
    "${IMGUI_DIR}/imgui_draw.cpp"
    "${IMGUI_DIR}/imgui_tables.cpp"
    "${IMGUI_DIR}/imgui_widgets.cpp"
    "${IMGUI_DIR}/imgui_impl_vulkan.cpp")
target_include_directories(forge_imgui_asan PUBLIC "${IMGUI_DIR}" "${VK_INC}")
# Third-party: warnings are not errors here, but the sanitizer still applies --
# ImGui owns the widget state the click machinery walks.
target_compile_options(forge_imgui_asan PRIVATE ${FORGE_ASAN_FLAGS})
target_link_libraries(forge_imgui_asan PUBLIC "${VK_LOADER_LIB}")

add_library(forge_desktop_core_asan STATIC
    "${CMAKE_CURRENT_SOURCE_DIR}/src/KernelScene.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/PartFile.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/Camera.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/ForgeFrame.cpp")
target_include_directories(forge_desktop_core_asan PUBLIC
    "${CMAKE_CURRENT_SOURCE_DIR}/src"
    "${FORGE_KERNEL_DIR}/include"
    "${OCCT_PREFIX}/include/opencascade")
target_compile_definitions(forge_desktop_core_asan PRIVATE FORGE_NATIVE_BREP=1)
target_compile_options(forge_desktop_core_asan PRIVATE -Wall -Wextra -Werror ${FORGE_ASAN_FLAGS})
target_link_libraries(forge_desktop_core_asan
    PUBLIC forge_ui_asan forge_imgui_asan "${FORGE_KERNEL_CORE_LIB}")

add_executable(forge_desktop_click_gate
    "${CMAKE_CURRENT_SOURCE_DIR}/test/click_gate.cpp")
target_compile_options(forge_desktop_click_gate PRIVATE -Wall -Wextra -Werror ${FORGE_ASAN_FLAGS})
target_link_options(forge_desktop_click_gate PRIVATE -fsanitize=address)
target_link_libraries(forge_desktop_click_gate PRIVATE forge_desktop_core_asan)
set_target_properties(forge_desktop_click_gate PROPERTIES
    BUILD_RPATH "${FORGE_KERNEL_BUILD_DIR};${OCCT_PREFIX}/lib")

enable_testing()
add_test(NAME forge_desktop_frame_gate COMMAND forge_desktop_frame_gate)
add_test(NAME forge_desktop_ir_pipeline_gate COMMAND forge_desktop_ir_pipeline_gate)
add_test(NAME forge_desktop_document_gate COMMAND forge_desktop_document_gate)
add_test(NAME forge_desktop_click_gate COMMAND forge_desktop_click_gate)

# A run helper that sets VK_ICD_FILENAMES, so "how do I run it" has one answer.
configure_file("${CMAKE_CURRENT_SOURCE_DIR}/run_forge.sh.in"
               "${CMAKE_BINARY_DIR}/run_forge.sh" @ONLY
               FILE_PERMISSIONS OWNER_READ OWNER_WRITE OWNER_EXECUTE GROUP_READ GROUP_EXECUTE)
message(STATUS "forge-desktop: run with ${CMAKE_BINARY_DIR}/run_forge.sh")
