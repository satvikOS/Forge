#!/usr/bin/env bash
# ============================================================================
# offline_guard_test.sh — proves the FORGE_NETWORK=OFF guards in
# forge-kernel/cmake/ForgeDeps.cmake actually FIRE.
#
# A gate that cannot fail is not a passing gate, so every case below asserts a
# specific outcome and the script fails if a "must fail" case succeeds.
#
# Fixtures are generated into a temp dir OUTSIDE the repo, not committed. Two
# reasons, both learned by this test failing:
#   - a committed fixture containing FetchContent_Declare would be found by the
#     repo-wide lint it exists to test;
#   - the first version put fixtures under .forge-local/, which the lint's own
#     skip list excludes — so the file(DOWNLOAD) case configured cleanly and the
#     test reported a pass the guard had not earned.
# ============================================================================
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/forge-offline-guard.XXXXXX")"
LOCK="$REPO/third_party/manifest/deps.lock.json"
PASS=0
FAIL=0
trap 'rm -rf "$TMP"' EXIT

# $1 = case name, $2 = expect (fail|pass), $3 = substring the output must contain
run_case() {
  local name="$1" expect="$2" needle="$3"
  local src="$TMP/$name" out rc
  out="$(cd "$src" && cmake -S "$src" -B "$src/build" -G "Unix Makefiles" \
          -DFORGE_DEPS_LOCK="$LOCK" 2>&1)"
  rc=$?
  local verdict
  if [ "$expect" = "fail" ]; then
    if [ $rc -ne 0 ] && printf '%s' "$out" | grep -qF "$needle"; then
      verdict="PASS"
    else
      verdict="FAIL"
    fi
  else
    if [ $rc -eq 0 ] && printf '%s' "$out" | grep -qF "$needle"; then
      verdict="PASS"
    else
      verdict="FAIL"
    fi
  fi
  if [ "$verdict" = "PASS" ]; then
    PASS=$((PASS + 1))
    echo "  PASS  $name (expected configure to $expect, rc=$rc, matched: $needle)"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL  $name (expected configure to $expect, got rc=$rc)"
    echo "------- output -------"
    printf '%s\n' "$out" | tail -25
    echo "----------------------"
  fi
}

mk() {  # mk <name> <body-after-forge_deps_init>
  local name="$1"; shift
  mkdir -p "$TMP/$name"
  {
    echo 'cmake_minimum_required(VERSION 3.20)'
    echo 'project(forge_offline_guard_probe NONE)'
    echo "list(APPEND CMAKE_MODULE_PATH \"$REPO/forge-kernel/cmake\")"
    echo 'include(ForgeDeps)'
    echo 'forge_deps_init()'
    printf '%s\n' "$@"
  } > "$TMP/$name/CMakeLists.txt"
}

echo "offline_guard_test: repo=$REPO"
echo

# 1. Baseline: a clean project with the guards installed must CONFIGURE.
#    Without this case the suite could pass by failing everything.
mk clean 'message(STATUS "clean project configured")'
run_case clean pass "network lint OK"

# 2. The LINT layer must catch FetchContent_Declare by text, before it executes.
mk lint_fetchcontent \
   'FetchContent_Declare(anything GIT_REPOSITORY https://example.invalid/x.git)'
run_case lint_fetchcontent fail "configure-time network primitive"

# 3. The MACRO-OVERRIDE layer must refuse FetchContent_Declare even when the lint
#    is told to allow the line. Without the marker this case would be caught by the
#    lint (case 2) and the override would never be exercised.
mk macro_fetchcontent \
   'FetchContent_Declare(anything GIT_REPOSITORY https://example.invalid/x.git) # FORGE_NETWORK_LINT_ALLOW'
run_case macro_fetchcontent fail "FORGE_NETWORK=OFF: FetchContent_Declare"

# 4. Same for ExternalProject_Add. ExternalProject.cmake carries
#    include_guard(GLOBAL), so the override installed by forge_deps_init() survives
#    the later include(ExternalProject) on the line above the call.
mk macro_externalproject \
   'include(ExternalProject)' \
   'ExternalProject_Add(anything URL https://example.invalid/x.tgz) # FORGE_NETWORK_LINT_ALLOW'
run_case macro_externalproject fail "FORGE_NETWORK=OFF: ExternalProject_Add"

# 5. file(DOWNLOAD ...) cannot be overridden in CMake, so the repo-wide LINT is
#    the layer that must catch it. The lint runs inside forge_deps_init(), before
#    the offending line would execute — so this proves the lint, not the command.
mkdir -p "$TMP/filedownload"
{
  echo 'cmake_minimum_required(VERSION 3.20)'
  echo 'project(forge_offline_guard_probe NONE)'
  echo "list(APPEND CMAKE_MODULE_PATH \"$REPO/forge-kernel/cmake\")"
  echo 'include(ForgeDeps)'
  echo 'file(DOWNLOAD https://example.invalid/x "${CMAKE_BINARY_DIR}/x")'
  echo 'forge_deps_init()'
} > "$TMP/filedownload/CMakeLists.txt"
run_case filedownload fail "configure-time network primitive"

# 6. FETCHCONTENT_FULLY_DISCONNECTED must be FORCEd into the cache, so that even a
#    later include(FetchContent) — which restores the real macros, because
#    FetchContent.cmake has no include guard — still cannot fetch.
mk disconnected 'if(NOT FETCHCONTENT_FULLY_DISCONNECTED)' \
                '  message(FATAL_ERROR "FETCHCONTENT_FULLY_DISCONNECTED was not forced")' \
                'endif()' \
                'message(STATUS "fetchcontent disconnected asserted")'
run_case disconnected pass "fetchcontent disconnected asserted"

# 7. FORGE_NETWORK=ON must NOT install the guards (the ONLINE_SEED escape hatch has
#    to actually be open, or seeding could never happen).
mkdir -p "$TMP/online"
{
  echo 'cmake_minimum_required(VERSION 3.20)'
  echo 'project(forge_offline_guard_probe NONE)'
  echo 'set(FORGE_NETWORK ON CACHE STRING "" FORCE)'
  echo "list(APPEND CMAKE_MODULE_PATH \"$REPO/forge-kernel/cmake\")"
  echo 'include(ForgeDeps)'
  echo 'forge_deps_init()'
  echo 'if(COMMAND FetchContent_Declare)'
  echo '  message(STATUS "online: FetchContent_Declare present (not guarded)")'
  echo 'endif()'
} > "$TMP/online/CMakeLists.txt"
run_case online pass "ONLINE_SEED"

echo
echo "offline_guard_test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
