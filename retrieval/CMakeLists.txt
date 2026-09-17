# ============================================================================
# retrieval — the gated SearXNG client, and the executor that is its only caller.
#
# WHY THIS FILE EXISTS, STATED PLAINLY.
#
# Before this commit retrieval/ appeared in NO CMakeLists. Measured on the built
# artifacts at 02de2e15 with `nm`, and with a positive control on the same
# invocation so the zero is a real absence rather than a broken instrument:
#
#   forge-desktop/build/forge_desktop            8,007 symbol lines, 4,534 "forge", 0 retrieval
#   forge-desktop/build/forge_kernel_worker      3,407 symbol lines, 2,615 "forge", 0 retrieval
#   forge-desktop/.build-main/forge_desktop      2,054 symbol lines,   858 "forge", 0 retrieval
#   forge-kernel/build/Release/libforge_kernel_core.dylib
#                                               16,283 symbol lines, 7,367 "forge", 0 retrieval
#
# So the question "is retrieval dead code, or a test-only target" had to be
# answered before anything was wired to it. IT WAS NOT DEAD CODE, AND IT DID NOT
# SHIP. It is a deliberately excluded, CI-maintained test-only target:
#
#   * run_retrieval_tests.sh compiles all six sources with -Werror and runs 193
#     assertions three times over — on fixtures, again with the network denied by
#     a dyld interposer that self-tests by aborting a real socket(), and once
#     against a loopback stub;
#   * .github/workflows/kernel-tests.yml job `retrieval` runs that script on
#     macos-latest, and its comments record it being MOVED to macOS precisely
#     because the network-denied phase was silently skipping on ubuntu;
#   * forge-desktop/CMakeLists.txt:342 says in as many words that only the two
#     files RemotePlanner needs are compiled and that "SearxngClient and its
#     evidence machinery stay out, so nothing about search is pulled into the app".
#
# That exclusion is CORRECT and this file does not undo it. The application does
# not search; Archie does. What was missing was a build target for the thing
# Archie actually invokes, so the gated send path existed only inside a shell
# script's mktemp directory and nothing installable contained it.
#
# TWO TARGETS:
#   forge_retrieval   the client library — the three gates, the redactor, the
#                     evidence types, the loopback transport. No third-party
#                     dependency; pure C++20 and libc.
#   forge_retrieve    the EXECUTOR. The one process permitted to hand a query to
#                     the socket, and the process Archie runs. See
#                     tools/forge_retrieve.cpp for why the client is wrapped
#                     rather than reimplemented in Python.
#
# WHAT THIS FILE DELIBERATELY DOES NOT DO: it does not add itself to
# forge-desktop's link line. Linking SearxngClient into the app would put an
# egress path inside the process that draws the viewport, for no benefit — the
# executor is a separate process on purpose. Shipping it is one
# `add_subdirectory(../retrieval retrieval)` plus an install() rule in whichever
# target owns packaging, and that file belongs to another agent this round.
#
# Standalone:   cmake -S retrieval -B build/retrieval && cmake --build build/retrieval
# Or from above: add_subdirectory(retrieval)
# ============================================================================
cmake_minimum_required(VERSION 3.20)

if(NOT DEFINED PROJECT_NAME)
    project(forge_retrieval CXX)
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── the client library ──────────────────────────────────────────────────────
# All six translation units. HttpTransport.cpp and Json.cpp are ALSO compiled
# into forge_archie by forge-desktop/CMakeLists.txt; that is deliberate
# duplication of two dependency-free files rather than a shared target, because
# making forge_archie depend on this library would drag SearxngClient into the
# app — the exact thing the comment at forge-desktop/CMakeLists.txt:342 is
# keeping out.
add_library(forge_retrieval STATIC
    "${CMAKE_CURRENT_SOURCE_DIR}/src/Json.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/Redactor.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/SearchRequest.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/EvidenceRecord.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/HttpTransport.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/SearxngClient.cpp")
target_include_directories(forge_retrieval PUBLIC
    "${CMAKE_CURRENT_SOURCE_DIR}/include")
# -Werror is not decoration here: run_retrieval_tests.sh has always built these
# sources with it, so a CMake build that was laxer would let a warning through
# that the shell gate rejects, and the two would disagree about whether the same
# code compiles.
target_compile_options(forge_retrieval PRIVATE -Wall -Wextra -Werror)

# ── the executor ────────────────────────────────────────────────────────────
add_executable(forge_retrieve "${CMAKE_CURRENT_SOURCE_DIR}/tools/forge_retrieve.cpp")
target_link_libraries(forge_retrieve PRIVATE forge_retrieval)
target_compile_options(forge_retrieve PRIVATE -Wall -Wextra -Werror)

# ── the gates ───────────────────────────────────────────────────────────────
# Registered with CTest so `ctest` runs them, but they remain shell/python
# scripts driving the REAL binary: a C++ test that linked the executor's main()
# would be testing a different artifact from the one Archie runs.
include(CTest)
if(BUILD_TESTING)
    add_executable(forge_retrieval_gate "${CMAKE_CURRENT_SOURCE_DIR}/test/retrieval_gate.cpp")
    target_link_libraries(forge_retrieval_gate PRIVATE forge_retrieval)
    target_compile_options(forge_retrieval_gate PRIVATE -Wall -Wextra -Werror)
    add_test(NAME retrieval_gate
             COMMAND forge_retrieval_gate "${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures")

    # Both of these take --mutations: they run clean, then inject defects into a
    # COPY of the source and require each to turn a NAMED check red. Registering
    # the mutating form is the point — a gate nobody has seen fail is silence.
    add_test(NAME retrieval_executor_gate
             COMMAND bash "${CMAKE_CURRENT_SOURCE_DIR}/test/run_executor_gate.sh" --mutations)
    add_test(NAME retrieval_executor_python_gate
             COMMAND "${CMAKE_CURRENT_SOURCE_DIR}/test/executor_python_gate.py" --mutations)
    # The attacks proved against 1dd9ed9b (PR #246), the fold tables against the
    # UCD, and a 20-mutation RED proof. Registered in its mutating form for the
    # same reason as the two above.
    add_test(NAME retrieval_attack_regression_gate
             COMMAND bash "${CMAKE_CURRENT_SOURCE_DIR}/test/run_attack_regression_gate.sh")
    set_tests_properties(retrieval_executor_gate retrieval_executor_python_gate
                         retrieval_attack_regression_gate
                         PROPERTIES TIMEOUT 900)
endif()
