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
# CONFIGURE_DEPENDS: without it this glob is evaluated ONCE, at configure time, and
# a NEW forge::ui source added later is silently absent from the link -- the build
# fails with undefined symbols in a file nobody touched, or worse, links against a
# stale object and the gate reports a pass it did not earn. Cost is one re-glob per
# build; the alternative is a class of failure that looks like someone else's bug.
file(GLOB FORGE_UI_SOURCES CONFIGURE_DEPENDS "${FORGE_UI_DIR}/src/*.cpp")
add_library(forge_ui STATIC ${FORGE_UI_SOURCES})
target_include_directories(forge_ui PUBLIC "${FORGE_UI_DIR}/include")
# SR-3: -Wall -Wextra -Werror on FIRST-PARTY code. forge::ui is first-party.
target_compile_options(forge_ui PRIVATE -Wall -Wextra -Werror)

# --------------------------------------- the op-constraint table is GENERATED
# ui/include/forge/ui/ArchieOpVocabulary.hpp is written from
# implementation/sacrosanct/archie_op_vocabulary.json by gen_op_constraint_table.py.
# It is COMMITTED (ui/test/run_ui.sh compiles ui/src directly and never runs CMake),
# so the only thing that keeps the two equal is a check somebody runs. Running it as
# a build dependency of forge_ui makes drift a BUILD FAILURE rather than a stale
# allow-list nobody notices -- the constraint cannot silently widen.
#
# The gate of record is ui/test/run_op_constraint_gate.sh, which also PROVES this
# check can fail. If python3 is absent the build says so by name rather than
# skipping quietly: an unrunnable check that prints nothing is indistinguishable
# from a green one.
find_package(Python3 COMPONENTS Interpreter QUIET)
if(Python3_Interpreter_FOUND)
    add_custom_target(forge_ui_op_table_check ALL
        COMMAND "${Python3_EXECUTABLE}"
                "${FORGE_ROOT}/implementation/sacrosanct/tools/gen_op_constraint_table.py"
                --check
        COMMENT "op-constraint table: ArchieOpVocabulary.hpp == archie_op_vocabulary.json"
        VERBATIM)
    add_dependencies(forge_ui forge_ui_op_table_check)
else()
    message(WARNING
        "python3 not found: the op-constraint table check is NOT running. "
        "ui/include/forge/ui/ArchieOpVocabulary.hpp may have drifted from "
        "implementation/sacrosanct/archie_op_vocabulary.json. Run "
        "ui/test/run_op_constraint_gate.sh manually.")
endif()

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
# KernelScene.cpp and FileExchangeHost.cpp are the ONLY translation units that
# see OCCT headers. FileExchangeHost is the second one and it is deliberate: file
# exchange reads and writes files, holds no geometry and has no scene, and
# folding it into KernelScene would have made the viewport own the file system.
# The property that matters is unchanged -- the ImGui frame builder still reaches
# no OCCT header, and every headless gate still links what it needs and no more.
add_library(forge_desktop_core STATIC
    "${CMAKE_CURRENT_SOURCE_DIR}/src/KernelScene.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/FileExchangeHost.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/PartFile.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/Camera.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/StudyHost.cpp"
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
    "${CMAKE_CURRENT_SOURCE_DIR}/src/UpdateService.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/ViewportRenderer.cpp"
    ${SHADER_HEADERS})
target_include_directories(forge_desktop PRIVATE "${SDL2_INC}" "${SHADER_GEN_DIR}")
target_compile_options(forge_desktop PRIVATE -Wall -Wextra -Werror)
# forge_updater is linked into the APP, not into forge_desktop_core. The core is what
# every headless gate drives, and a frame builder that could reach the network would
# make each gate run depend on GitHub being up. The app owns the socket; the frame
# renders the result. Until this line existed the shipped bundle contained ZERO
# updater symbols -- the library, the CLI and its 130-check gate were all real, and
# none of them was in the thing users install.
target_link_libraries(forge_desktop PRIVATE forge_desktop_core forge_updater
                      "${SDL2_LIB}" "${VK_LOADER_LIB}")
set_target_properties(forge_desktop PROPERTIES
    BUILD_RPATH "${FORGE_KERNEL_BUILD_DIR};${OCCT_PREFIX}/lib")

# ------------------------------------------------------- the isolated worker
# ★ THE PROCESS THE APPLICATION IS ALLOWED TO LOSE.
#
# forge-kernel/reports/OCCT_NULL_PCURVE_SEGV.md measured a null Geom2d_Curve
# dereferenced INSIDE OCCT on three paths -- on Archie's emitted geometry AND on
# the gold reference STEP files -- and every cheaper remedy is ruled out there by
# measurement: the crashing shape had nullPcurves=0 (the null is born inside
# OCCT's own merge, so there is nothing on the input to repair), KeepShapes was
# implemented and still SIGSEGV'd all six cases, and the accessor a guard would
# call is itself a faulting frame. A SIGSEGV is also not an exception, so
# KernelScene's catch(...) cannot see one.
#
# This binary is therefore not a check. It is somewhere to put the fault. It
# reads one IR program on stdin, compiles and tessellates it, and writes the
# vertex stream back; when OCCT faults, THIS process dies and the application
# keeps the user's document, undo stack, dock layout and last good body.
#
# NOT sanitized, deliberately, and it is the one first-party binary here that is
# not. AddressSanitizer converts a fatal signal into its own report and a normal
# EXIT, which is exactly the observable the isolation gate needs to survive
# intact: a worker that exits 3 instead of dying on SIGSEGV would make the gate
# assert on a signal it can no longer see. The parent in that gate IS sanitized.
add_executable(forge_kernel_worker
    "${CMAKE_CURRENT_SOURCE_DIR}/src/kernel_worker_main.cpp")
target_compile_options(forge_kernel_worker PRIVATE -Wall -Wextra -Werror)
target_link_libraries(forge_kernel_worker PRIVATE forge_desktop_core)
set_target_properties(forge_kernel_worker PROPERTIES
    BUILD_RPATH "${FORGE_KERNEL_BUILD_DIR};${OCCT_PREFIX}/lib")
# The app looks for the worker BESIDE ITSELF. Making the dependency explicit is
# what stops `cmake --build --target forge_desktop` producing an application whose
# isolation silently does not exist.
add_dependencies(forge_desktop forge_kernel_worker)

# ---------------------------------------------------------------- the gate
# No SDL, no Vulkan, no window: a real ImGui context with a NULL renderer backend
# is all a frame needs, which is the whole reason ForgeFrame never touches the GPU.
add_executable(forge_desktop_frame_gate
    "${CMAKE_CURRENT_SOURCE_DIR}/test/frame_gate.cpp")
target_compile_options(forge_desktop_frame_gate PRIVATE -Wall -Wextra -Werror)
target_link_libraries(forge_desktop_frame_gate PRIVATE forge_desktop_core)
set_target_properties(forge_desktop_frame_gate PROPERTIES
    BUILD_RPATH "${FORGE_KERNEL_BUILD_DIR};${OCCT_PREFIX}/lib")

# The Archie CoPilot gate. Same headless shape as the frame gate, and it links
# the kernel core too: it follows the CoPilot's edits all the way through
# forge::ft::compile, because "the panel dispatched something" is not the claim --
# "what it dispatched builds the solid it said it would, and what the
# op-constraint gate refused never reached the kernel at all" is.
add_executable(forge_desktop_copilot_gate
    "${CMAKE_CURRENT_SOURCE_DIR}/test/copilot_gate.cpp")
target_compile_options(forge_desktop_copilot_gate PRIVATE -Wall -Wextra -Werror)
target_link_libraries(forge_desktop_copilot_gate PRIVATE forge_desktop_core)
set_target_properties(forge_desktop_copilot_gate PROPERTIES
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
# ---------------------------------------------------- the file-exchange gate
# Opens and saves REAL CAD FILES through the shipping command path and compares a
# VECTOR of observables at the seam -- volume AND area AND centre of mass AND
# bounding box AND the per-kind face census. `--mutate 1..5` breaks the write on
# purpose and the gate is then REQUIRED to go red; the mutations are registered
# below as ordinary tests because the binary inverts its own exit code in that
# mode (a caught mutation exits 0), so a mutation that stops being caught fails
# here rather than needing WILL_FAIL.
#
# test/run_file_exchange_gate.sh builds and runs the same sources with ONE c++
# invocation, so the gate is reachable from a tree that has never configured this
# project -- it needs the kernel core and nothing else, no ImGui, no SDL, no Vulkan.
add_executable(forge_desktop_file_exchange_gate
    "${CMAKE_CURRENT_SOURCE_DIR}/test/file_exchange_gate.cpp")
target_compile_options(forge_desktop_file_exchange_gate PRIVATE -Wall -Wextra -Werror)
target_link_libraries(forge_desktop_file_exchange_gate PRIVATE forge_desktop_core)
set_target_properties(forge_desktop_file_exchange_gate PROPERTIES
    BUILD_RPATH "${FORGE_KERNEL_BUILD_DIR};${OCCT_PREFIX}/lib")

# ---------------------------------------------------- the SIMULATION gate
# The Restraints and Loads panels, against a real solve of a real cantilever and
# the Euler-Bernoulli deflection for it. `--mutate 1..6` breaks the SET-UP the
# production code is fed -- the restraint moved onto the loaded side, the beam
# built a thousand times larger, the material swapped, the force turned along the
# beam, the study never run, the part never edited -- and each is registered
# below as a WILL_FAIL test, so a mutation that stops being caught is a red test
# rather than a line nobody reads.
add_executable(forge_desktop_study_gate
    "${CMAKE_CURRENT_SOURCE_DIR}/test/study_gate.cpp")
target_compile_options(forge_desktop_study_gate PRIVATE -Wall -Wextra -Werror)
target_link_libraries(forge_desktop_study_gate PRIVATE forge_desktop_core)
set_target_properties(forge_desktop_study_gate PROPERTIES
    BUILD_RPATH "${FORGE_KERNEL_BUILD_DIR};${OCCT_PREFIX}/lib")

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
    "${CMAKE_CURRENT_SOURCE_DIR}/src/FileExchangeHost.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/PartFile.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/Camera.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/StudyHost.cpp"
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
# ------------------------------------------------- the CRASH-ISOLATION gate
# Proves the application survives a kernel SIGSEGV, against the REAL worker
# binary and a REAL fatal signal. Sanitized on the PARENT side only: the child is
# forge_kernel_worker, deliberately unsanitized, because ASan turns a fatal
# signal into a normal exit and the observable this gate asserts on is the
# signal. It also asserts the ABSENCE of a quarantine -- re-submitting a program
# that just crashed must run it again -- because a safety net that starts
# refusing work is the capability gate the OCCT report warns about.
add_executable(forge_desktop_isolation_gate
    "${CMAKE_CURRENT_SOURCE_DIR}/test/isolation_gate.cpp")
target_compile_options(forge_desktop_isolation_gate PRIVATE -Wall -Wextra -Werror ${FORGE_ASAN_FLAGS})
target_link_options(forge_desktop_isolation_gate PRIVATE -fsanitize=address)
target_link_libraries(forge_desktop_isolation_gate PRIVATE forge_desktop_core_asan)
set_target_properties(forge_desktop_isolation_gate PROPERTIES
    BUILD_RPATH "${FORGE_KERNEL_BUILD_DIR};${OCCT_PREFIX}/lib")
# The gate looks for the worker beside itself, so the worker must exist before it
# runs. A gate that cannot run is not a gate that passed.
add_dependencies(forge_desktop_isolation_gate forge_kernel_worker)

# ------------------------------------------------------------------ updating
# THE AUTO-UPDATER. Deliberately its own library with NO project dependencies --
# not the kernel, not OCCT, not ImGui, not SDL, not Vulkan, and no third-party
# code at all. Two reasons, both practical:
#
#   * The update path is what makes the Gatekeeper prompt one-time (see the
#     header of src/update/Updater.hpp), so it must stay reviewable. A library
#     whose whole link closure is libc++ is a library a person can audit.
#   * It lets test/run_update_gate.sh build and run the gate with ONE c++
#     invocation, in a tree that has never built the kernel. That script is the
#     escape hatch from the FATAL_ERROR at the top of this file: configuring this
#     project at all needs libforge_kernel_core, and "you must spend 40 minutes
#     on OCCT before you can check the updater" is how a gate stops being run.
#
# Sparkle was NOT vendored. It is the right answer for a Developer-ID app that
# needs delta updates, staged rollout and EdDSA appcasts; this ships ad-hoc
# signed from GitHub Releases with a single zip per release, and the whole path
# below is ~700 lines against a framework's several tens of thousands. The one
# thing Sparkle would buy that is genuinely missing -- a signature over the
# manifest -- is written down as owed in Updater.hpp rather than implied.
add_library(forge_updater STATIC
    "${CMAKE_CURRENT_SOURCE_DIR}/src/update/Version.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/update/Sha256.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/update/Manifest.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/update/Updater.cpp")
target_include_directories(forge_updater PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_compile_options(forge_updater PRIVATE -Wall -Wextra -Werror)

# `forge_update` — the same library, addressable from a shell. This is how the
# update path gets exercised against the REAL GitHub release, which the headless
# gate deliberately cannot do (it never opens a socket). It links forge_updater
# and nothing else, so it builds in seconds and can be run on a machine that has
# never built the kernel:
#     forge_update check
#     forge_update apply --app /Applications/Forge.app --relaunch
add_executable(forge_update
    "${CMAKE_CURRENT_SOURCE_DIR}/src/update/main_update_cli.cpp")
target_compile_options(forge_update PRIVATE -Wall -Wextra -Werror)
target_link_libraries(forge_update PRIVATE forge_updater)

# The UPDATE gate: headless, offline, and it never opens a socket. It drives the
# real manifest parser, version ordering, digest, ditto staging, ad-hoc signature
# check and atomic swap against real files in a temp directory, with a Fetcher
# that copies from disk. `--mutate 1..7` proves it can fail; run_update_gate.sh
# --mutations runs every one and requires each to go red.
add_executable(forge_desktop_update_gate
    "${CMAKE_CURRENT_SOURCE_DIR}/test/update_gate.cpp")
target_compile_options(forge_desktop_update_gate PRIVATE -Wall -Wextra -Werror)
target_link_libraries(forge_desktop_update_gate PRIVATE forge_updater)

enable_testing()
add_test(NAME forge_desktop_frame_gate COMMAND forge_desktop_frame_gate)
add_test(NAME forge_desktop_copilot_gate COMMAND forge_desktop_copilot_gate)
add_test(NAME forge_desktop_ir_pipeline_gate COMMAND forge_desktop_ir_pipeline_gate)
add_test(NAME forge_desktop_document_gate COMMAND forge_desktop_document_gate)
add_test(NAME forge_desktop_file_exchange_gate COMMAND forge_desktop_file_exchange_gate)
# WILL_FAIL, the same idiom the update gate's mutations use, and for the same
# reason: the binary keeps its ordinary exit convention under --mutate (a CAUGHT
# mutation exits non-zero), so ctest is told to expect the failure rather than the
# gate being asked to invert its own status. run_desktop.sh reads every gate here
# through one helper that treats exit 0 under --mutate as "STAYED GREEN".
foreach(_fx 1 2 3 4 5)
    add_test(NAME forge_desktop_file_exchange_mutation_${_fx}
             COMMAND forge_desktop_file_exchange_gate --mutate ${_fx})
    set_tests_properties(forge_desktop_file_exchange_mutation_${_fx}
                         PROPERTIES WILL_FAIL TRUE)
endforeach()
add_test(NAME forge_desktop_study_gate COMMAND forge_desktop_study_gate)
foreach(_sm RANGE 1 6)
    add_test(NAME forge_desktop_study_mutation_${_sm}
             COMMAND forge_desktop_study_gate --mutate ${_sm})
    set_tests_properties(forge_desktop_study_mutation_${_sm} PROPERTIES WILL_FAIL TRUE)
endforeach()
add_test(NAME forge_desktop_click_gate COMMAND forge_desktop_click_gate)
add_test(NAME forge_desktop_update_gate COMMAND forge_desktop_update_gate)
# The negative controls are their own ctest entries, so a mutation that stops
# being caught is a RED TEST rather than a line nobody reads.
#
# WILL_FAIL is the whole point. update_gate keeps the same exit convention as the
# other three gates -- non-zero means checks failed -- so a mutated run is
# EXPECTED to be red, and WILL_FAIL says so declaratively. A mutation that starts
# exiting ZERO is one whose defect the gate no longer detects, and ctest reports
# that as a failure. Do not "fix" one of these by removing WILL_FAIL.
foreach(_m RANGE 1 7)
    add_test(NAME forge_desktop_update_gate_mutation_${_m}
             COMMAND forge_desktop_update_gate --mutate ${_m})
    set_tests_properties(forge_desktop_update_gate_mutation_${_m}
                         PROPERTIES WILL_FAIL TRUE)
endforeach()

# A run helper that sets VK_ICD_FILENAMES, so "how do I run it" has one answer.
configure_file("${CMAKE_CURRENT_SOURCE_DIR}/run_forge.sh.in"
               "${CMAKE_BINARY_DIR}/run_forge.sh" @ONLY
               FILE_PERMISSIONS OWNER_READ OWNER_WRITE OWNER_EXECUTE GROUP_READ GROUP_EXECUTE)
message(STATUS "forge-desktop: run with ${CMAKE_BINARY_DIR}/run_forge.sh")
