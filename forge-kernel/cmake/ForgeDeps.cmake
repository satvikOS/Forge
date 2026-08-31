# ============================================================================
# ForgeDeps.cmake — the local, pinned, offline dependency plane (Sacrosanct 3.1
# s10.6 "Fully local kernel and solver dependency plane" / s21.2 "Local build,
# activation, and fast execution contract").
#
# WHAT THIS REPLACES
# ------------------
# Before this file, forge-kernel/CMakeLists.txt resolved OCCT and Boost like this:
#
#     set(OCCT_ROOT "/opt/homebrew/opt/opencascade")
#     set(BOOST_INC "/opt/homebrew/opt/boost/include")
#
# A machine-global Homebrew prefix, hardcoded, silent, and unversioned beyond a
# major.minor check. That single fact made the build non-reproducible on a clean
# machine and invalidated every determinism claim downstream of it.
#
# ForgeDeps replaces it with an explicit resolution ORDER whose last step is the
# Homebrew prefix and whose last step is LOUD:
#
#   1. -DFORGE_DEPS_PREFIX_<NAME>= / $FORGE_DEPS_PREFIX_<NAME>   explicit override
#   2. .forge-local/prefixes/<triplet>/<build-hash>/<name>   activated immutable prefix
#   3. $FORGE_DEPS_ROOT/<name>                                mirror root
#   4. the lock's installed.system_prefix_template            LAST RESORT, warns
#
# The lock (third_party/manifest/deps.lock.json) is authoritative for the version
# and for the prefix template; nothing here hardcodes a machine path.
#
# OFFLINE
# -------
# FORGE_NETWORK defaults to OFF (OFFLINE_BUILD). With it OFF, configure MUST NOT
# be able to reach the network. Three layers, and the residual hole is named:
#
#   a. ExternalProject_Add / FetchContent_* are redefined to FATAL_ERROR.
#      ExternalProject.cmake carries include_guard(GLOBAL), so pre-including it
#      here makes the override permanent. FetchContent.cmake has NO include guard,
#      so a later include(FetchContent) WOULD restore the real macros — which is
#      why (b) exists.
#   b. FETCHCONTENT_FULLY_DISCONNECTED / FETCHCONTENT_UPDATES_DISCONNECTED are
#      FORCEd into the cache, so even the restored FetchContent refuses to fetch.
#   c. forge_deps_lint_network() scans every CMakeLists.txt and *.cmake in the
#      project for a configure-time fetch primitive and FAILS the configure.
#      This is the layer that catches file(DOWNLOAD), which cannot be overridden.
#
# HONEST LIMIT: none of this sandboxes a child process. A custom command that
# shells out to curl at BUILD time is caught by (c) only if it is spelled in
# CMake. Full network denial belongs in the CI sandbox, not in CMake.
#
# THAT SANDBOX NOW EXISTS, and it is what s21.2 actually asks CI to demonstrate:
# tools/deps/tests/offline_build_test.sh. It denies the network for real and then
# configures AND builds through the denial, in two layers because one is provably
# not enough:
#   - CONFIGURE is denied with the dyld interposer retrieval/test/net_denied_interpose.c
#     (DYLD_INSERT_LIBRARIES). cmake is an unrestricted binary, so the interposer loads
#     into it and kills the one primitive layer (c) can only lint for rather than
#     intercept: file(DOWNLOAD). MEASURED: with (c) neutered and a real file(DOWNLOAD)
#     added to CMakeLists.txt, the configure died rc=134 (SIGABRT) instead of fetching.
#   - BUILD is denied with sandbox-exec '(deny network*)'. This is NOT belt-and-braces.
#     MEASURED on this workstation: macOS SIP strips DYLD_* when exec'ing a protected
#     binary and the removal is inherited, so under DYLD alone a probe run via /bin/sh
#     reaches the network (rc=0, not 134). Since the Unix Makefiles generator runs every
#     recipe through /bin/sh and make is /usr/bin/make, DYLD covers NONE of the compile
#     or link steps. The sandbox is kernel-enforced on the whole process tree and does.
# ============================================================================

include_guard(GLOBAL)

# Captured at PARSE time. forge_deps_init() is a macro, so inside it
# CMAKE_CURRENT_LIST_DIR is the *caller's* directory (forge-kernel/), not this
# module's — computing the repo root from there lands one level too high.
set(_FORGE_DEPS_MODULE_DIR "${CMAKE_CURRENT_LIST_DIR}")
set(_FORGE_DEPS_MODULE_FILE "${CMAKE_CURRENT_LIST_FILE}")

# ---------------------------------------------------------------- options
set(FORGE_NETWORK "OFF" CACHE STRING
    "ON = ONLINE_SEED (configure may fetch pinned artifacts). OFF = OFFLINE_BUILD \
(default): every configure-time fetch is a hard error.")
set_property(CACHE FORGE_NETWORK PROPERTY STRINGS ON OFF)

set(FORGE_DEPS_LOCK "${CMAKE_CURRENT_LIST_DIR}/../../third_party/manifest/deps.lock.json"
    CACHE FILEPATH "Path to the checked-in dependency lock.")

option(FORGE_DEPS_STRICT
       "Fail the configure (instead of warning) when a dependency resolves to the \
machine-global system prefix." OFF)

# ---------------------------------------------------------------- lock loading
function(_forge_deps_read_lock)
    if(NOT EXISTS "${FORGE_DEPS_LOCK}")
        message(FATAL_ERROR
            "ForgeDeps: dependency lock not found at ${FORGE_DEPS_LOCK}. The lock is the "
            "reproducibility control plane (Sacrosanct 3.1 s21.2); the build does not "
            "proceed without it.")
    endif()
    file(READ "${FORGE_DEPS_LOCK}" _json)
    set(FORGE_DEPS_LOCK_JSON "${_json}" PARENT_SCOPE)
    string(JSON _triplet ERROR_VARIABLE _e GET "${_json}" triplet)
    if(_e)
        message(FATAL_ERROR "ForgeDeps: malformed lock — no 'triplet': ${_e}")
    endif()
    set(FORGE_DEPS_TRIPLET "${_triplet}" PARENT_SCOPE)
    string(JSON _n LENGTH "${_json}" dependencies)
    set(FORGE_DEPS_COUNT "${_n}" PARENT_SCOPE)
endfunction()

# Pull one dependency object out of the lock by name.
function(_forge_deps_entry name out_var)
    string(JSON _n LENGTH "${FORGE_DEPS_LOCK_JSON}" dependencies)
    math(EXPR _last "${_n} - 1")
    foreach(i RANGE ${_last})
        string(JSON _d GET "${FORGE_DEPS_LOCK_JSON}" dependencies ${i})
        string(JSON _name GET "${_d}" name)
        if(_name STREQUAL name)
            set(${out_var} "${_d}" PARENT_SCOPE)
            return()
        endif()
    endforeach()
    set(${out_var} "" PARENT_SCOPE)
endfunction()

function(_forge_deps_get json out_var)
    string(JSON _v ERROR_VARIABLE _e GET "${json}" ${ARGN})
    if(_e)
        set(${out_var} "" PARENT_SCOPE)
    else()
        set(${out_var} "${_v}" PARENT_SCOPE)
    endif()
endfunction()

# ---------------------------------------------------------------- resolution
# forge_deps_require(<name>
#     PREFIX_VAR   <var>   # receives the resolved prefix
#     VERSION_VAR  <var>   # receives the version recorded in the lock
#     [SOURCE_VAR  <var>]  # receives which rule in the order matched
#     [OPTIONAL]           # do not fail when unresolved
# )
function(forge_deps_require name)
    cmake_parse_arguments(A "OPTIONAL" "PREFIX_VAR;VERSION_VAR;SOURCE_VAR" "" ${ARGN})

    _forge_deps_entry("${name}" _dep)
    if(_dep STREQUAL "")
        message(FATAL_ERROR
            "ForgeDeps: '${name}' is not declared in ${FORGE_DEPS_LOCK}. Every dependency "
            "the build consumes must be in the lock — add it, do not work around it.")
    endif()
    _forge_deps_get("${_dep}" _version version)
    _forge_deps_get("${_dep}" _marker layout presence_marker)

    string(TOUPPER "${name}" _upper)
    string(REPLACE "-" "_" _upper "${_upper}")
    set(_envkey "FORGE_DEPS_PREFIX_${_upper}")

    set(_prefix "")
    set(_src "unresolved")

    # 1. explicit per-dependency override (CMake var wins over env var). FIRST,
    #    deliberately: an operator naming a prefix is an explicit instruction and must
    #    beat anything discovered. Ranked below the activated prefix, an activated
    #    prefix silently swallows every override.
    if(DEFINED ${_envkey})
        set(_prefix "${${_envkey}}")
        set(_src "cmake:-D${_envkey}")
    elseif(DEFINED ENV{${_envkey}})
        set(_prefix "$ENV{${_envkey}}")
        set(_src "env:${_envkey}")
    endif()

    # 2. activated immutable prefix in the workstation execution plane
    set(_actroot "${FORGE_REPO_ROOT}/.forge-local/prefixes/${FORGE_DEPS_TRIPLET}")
    if(_prefix STREQUAL "" AND IS_DIRECTORY "${_actroot}")
        file(GLOB _builds LIST_DIRECTORIES true "${_actroot}/*")
        list(SORT _builds)
        foreach(_b IN LISTS _builds)
            if(EXISTS "${_b}/${name}/${_marker}")
                set(_prefix "${_b}/${name}")
                get_filename_component(_bn "${_b}" NAME)
                set(_src "forge-local-prefix(${_bn})")
                break()
            endif()
        endforeach()
    endif()

    # 3. a mirror root holding every activated dependency
    if(_prefix STREQUAL "" AND DEFINED ENV{FORGE_DEPS_ROOT}
       AND EXISTS "$ENV{FORGE_DEPS_ROOT}/${name}/${_marker}")
        set(_prefix "$ENV{FORGE_DEPS_ROOT}/${name}")
        set(_src "env:FORGE_DEPS_ROOT")
    endif()

    # 4. LAST RESORT — the system prefix template named by the lock.
    if(_prefix STREQUAL "")
        _forge_deps_get("${_dep}" _tmpl installed system_prefix_template)
        if(NOT _tmpl STREQUAL "")
            set(_cand "${_tmpl}")
            if(_tmpl MATCHES "\\{repo\\}")
                string(REPLACE "{repo}" "${FORGE_REPO_ROOT}" _cand "${_tmpl}")
            elseif(_tmpl MATCHES "\\{brew_prefix\\}")
                if(NOT DEFINED FORGE_DEPS_BREW_PREFIX)
                    find_program(FORGE_DEPS_BREW_EXE brew
                                 HINTS /opt/homebrew/bin /usr/local/bin)
                    if(FORGE_DEPS_BREW_EXE)
                        execute_process(COMMAND ${FORGE_DEPS_BREW_EXE} --prefix
                                        OUTPUT_VARIABLE _bp
                                        OUTPUT_STRIP_TRAILING_WHITESPACE)
                        set(FORGE_DEPS_BREW_PREFIX "${_bp}" CACHE INTERNAL "")
                    endif()
                endif()
                if(FORGE_DEPS_BREW_PREFIX)
                    string(REPLACE "{brew_prefix}" "${FORGE_DEPS_BREW_PREFIX}"
                           _cand "${_tmpl}")
                else()
                    set(_cand "")
                endif()
            endif()
            if(NOT _cand STREQUAL "" AND EXISTS "${_cand}/${_marker}")
                set(_prefix "${_cand}")
                set(_src "system-fallback")
            endif()
        endif()
    endif()

    if(_prefix STREQUAL "")
        if(A_OPTIONAL)
            set(${A_PREFIX_VAR} "" PARENT_SCOPE)
            if(A_SOURCE_VAR)
                set(${A_SOURCE_VAR} "unresolved" PARENT_SCOPE)
            endif()
            return()
        endif()
        message(FATAL_ERROR
            "ForgeDeps: could not resolve '${name}' ${_version}.\n"
            "  tried  1. -D${_envkey}= or $ENV{${_envkey}}\n"
            "         2. ${_actroot}/*/${name}/${_marker}\n"
            "         3. \$FORGE_DEPS_ROOT/${name}\n"
            "         4. the lock's installed.system_prefix_template\n"
            "  Seed the local mirror with tools/deps/seed, or pass -D${_envkey}=<prefix>.")
    endif()

    if(_src STREQUAL "system-fallback")
        set(_msg
            "ForgeDeps: '${name}' ${_version} resolved from the MACHINE-GLOBAL system "
            "prefix\n    ${_prefix}\n"
            "  This build is NOT reproducible on a clean machine — the prefix is not "
            "part of the pinned local dependency plane (Sacrosanct 3.1 s10.6).\n"
            "  Fix: seed and activate the local mirror (tools/deps/seed), or pass "
            "-D${_envkey}=<prefix>.")
        if(FORGE_DEPS_STRICT)
            message(FATAL_ERROR ${_msg})
        else()
            message(WARNING ${_msg})
        endif()
    endif()

    message(STATUS "ForgeDeps: ${name} ${_version} <- ${_prefix}  [${_src}]")
    set(${A_PREFIX_VAR} "${_prefix}" PARENT_SCOPE)
    if(A_VERSION_VAR)
        set(${A_VERSION_VAR} "${_version}" PARENT_SCOPE)
    endif()
    if(A_SOURCE_VAR)
        set(${A_SOURCE_VAR} "${_src}" PARENT_SCOPE)
    endif()
endfunction()

# ---------------------------------------------------------------- offline guards
# Layer (c): the only defence that catches file(DOWNLOAD), which CMake does not
# allow us to override. Lines carrying the FORGE_NETWORK_LINT_ALLOW marker are the
# guard definitions themselves.
function(forge_deps_lint_network)
    set(_pat
        "file\\(DOWNLOAD"
        "FetchContent_Declare\\("
        "FetchContent_MakeAvailable\\("
        "FetchContent_Populate\\("
        "ExternalProject_Add\\("
        "git clone"
        "COMMAND curl"
        "COMMAND wget")
    list(JOIN _pat "|" _re)

    set(_files "")
    foreach(_root "${CMAKE_SOURCE_DIR}" "${FORGE_REPO_ROOT}/third_party")
        if(IS_DIRECTORY "${_root}")
            file(GLOB_RECURSE _f "${_root}/CMakeLists.txt" "${_root}/*.cmake")
            list(APPEND _files ${_f})
        endif()
    endforeach()
    list(REMOVE_DUPLICATES _files)

    set(_hits "")
    set(_n 0)
    set(_skipped_self 0)
    foreach(_f IN LISTS _files)
        if(_f MATCHES "/(build|node_modules|\\.forge-local|CMakeFiles)/")
            continue()
        endif()
        # This module is the GUARD: it necessarily spells every pattern it hunts for,
        # both in the pattern table and inside the FATAL_ERROR text of each override.
        # Those are string literals, not calls, and no per-line marker can cover a
        # message() that wraps across lines. It is excluded by name, and named here so
        # the exclusion is visible rather than silent. Every other CMake file in the
        # project is still scanned, so the gate can — and does — fail.
        if(_f STREQUAL "${_FORGE_DEPS_MODULE_FILE}")
            set(_skipped_self 1)
            continue()
        endif()
        math(EXPR _n "${_n} + 1")
        file(STRINGS "${_f}" _lines REGEX "${_re}")
        foreach(_l IN LISTS _lines)
            string(STRIP "${_l}" _s)
            if(_s MATCHES "^#" OR _s MATCHES "FORGE_NETWORK_LINT_ALLOW")
                continue()
            endif()
            file(RELATIVE_PATH _rel "${FORGE_REPO_ROOT}" "${_f}")
            list(APPEND _hits "    ${_rel}: ${_s}")
        endforeach()
    endforeach()

    if(_hits)
        list(JOIN _hits "\n" _h)
        message(FATAL_ERROR
            "FORGE_NETWORK=OFF (OFFLINE_BUILD) but ${_n} scanned CMake file(s) contain a "
            "configure-time network primitive:\n${_h}\n"
            "  Every artifact must come from the pinned local plane. Add it to "
            "third_party/manifest/deps.lock.json and seed it with tools/deps/seed.")
    endif()
    message(STATUS "ForgeDeps: network lint OK — ${_n} CMake file(s) scanned, no "
                   "configure-time fetch primitive (ForgeDeps.cmake itself excluded: "
                   "${_skipped_self}).")
endfunction()

macro(_forge_deps_install_offline_guards)
    # ExternalProject.cmake has include_guard(GLOBAL): pre-include it, then our
    # redefinition below is permanent for this configure.
    include(ExternalProject)

    function(ExternalProject_Add) # FORGE_NETWORK_LINT_ALLOW (this is the guard)
        message(FATAL_ERROR
            "FORGE_NETWORK=OFF: ExternalProject_Add(${ARGV0}) is a configure/build-time "
            "fetch and is refused. Pin it in third_party/manifest/deps.lock.json and "
            "seed it with tools/deps/seed.")
    endfunction()

    function(FetchContent_Declare) # FORGE_NETWORK_LINT_ALLOW (this is the guard)
        message(FATAL_ERROR
            "FORGE_NETWORK=OFF: FetchContent_Declare(${ARGV0}) is refused. Pin it in "
            "third_party/manifest/deps.lock.json and seed it with tools/deps/seed.")
    endfunction()

    function(FetchContent_MakeAvailable) # FORGE_NETWORK_LINT_ALLOW (this is the guard)
        message(FATAL_ERROR
            "FORGE_NETWORK=OFF: FetchContent_MakeAvailable(${ARGV0}) is refused.")
    endfunction()

    function(FetchContent_Populate) # FORGE_NETWORK_LINT_ALLOW (this is the guard)
        message(FATAL_ERROR
            "FORGE_NETWORK=OFF: FetchContent_Populate(${ARGV0}) is refused.")
    endfunction()

    # Layer (b): survives a later include(FetchContent), which would restore the
    # real macros because FetchContent.cmake has no include guard.
    set(FETCHCONTENT_FULLY_DISCONNECTED ON CACHE BOOL
        "FORGE_NETWORK=OFF: FetchContent may not fetch." FORCE)
    set(FETCHCONTENT_UPDATES_DISCONNECTED ON CACHE BOOL
        "FORGE_NETWORK=OFF: FetchContent may not update." FORCE)
endmacro()

# ---------------------------------------------------------------- entry point
macro(forge_deps_init)
    get_filename_component(FORGE_REPO_ROOT "${_FORGE_DEPS_MODULE_DIR}/../.." ABSOLUTE)
    _forge_deps_read_lock()
    message(STATUS
        "ForgeDeps: lock ${FORGE_DEPS_LOCK} — triplet ${FORGE_DEPS_TRIPLET}, "
        "${FORGE_DEPS_COUNT} dependencies, FORGE_NETWORK=${FORGE_NETWORK}")
    if(NOT FORGE_DEPS_TRIPLET STREQUAL "${FORGE_TARGET_TRIPLET}"
       AND DEFINED FORGE_TARGET_TRIPLET)
        message(FATAL_ERROR
            "ForgeDeps: preset triplet '${FORGE_TARGET_TRIPLET}' does not match the "
            "lock's '${FORGE_DEPS_TRIPLET}'.")
    endif()
    if(FORGE_NETWORK STREQUAL "OFF")
        _forge_deps_install_offline_guards()
        forge_deps_lint_network()
    else()
        message(WARNING
            "FORGE_NETWORK=ON (ONLINE_SEED). Configure-time fetches are PERMITTED. This "
            "mode exists to populate the local mirror; it must never be how a release "
            "is built (Sacrosanct 3.1 s10.6).")
    endif()
endmacro()
