#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ui.sh — build + run the headless Forge UI gates (forge::ui).
#
# The UI layer is Dear ImGui (DECISION D-001), but NOTHING under ui/ includes an
# ImGui header: the command registry, the typed selection service, the keymap,
# the dock model and the feature-tree model are pure C++20 with no windowing, no
# GPU and no global mutable state. That is why this whole suite runs HEADLESS in
# CI — no display, no swapchain, no MoltenVK.
#
# Same shape as forge-kernel/test/native/run_native.sh: every source compiles to
# a .o ONCE, then each test links against the whole object set (so a duplicate
# symbol across modules surfaces at link time), both phases parallel under a
# portable bash-3.2 job cap, with a portable per-test timeout so a HANG FAILS.
#
# Exit 0 iff: every header is self-contained, the missing-include preflights
# pass, every source and test compiles warning-clean, and every test exits 0.
# Override with CXX=g++ / JOBS=N / TEST_TIMEOUT=secs / ONLY=<substring>.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

CXX="${CXX:-clang++}"
INC="-I ui/include -I ui/test"
# -Werror is deliberate: SR-3 requires -Wall -Wextra, and a warning nobody is
# forced to read is not a standard, it is a suggestion.
FLAGS="-std=c++20 -O2 -Wall -Wextra -Werror"
# feature_ir_test.cpp reads forge-kernel/include/forge/ft/FeatureTree.hpp AS DATA
# to re-derive the IR op table it checks forge::ui against. Passed as its own
# quoted argument so a repo path containing a space cannot word-split $FLAGS.
ROOTDEF="-DFORGE_UI_REPO_ROOT=\"$ROOT\""
JOBS="${JOBS:-$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"
TEST_TIMEOUT="${TEST_TIMEOUT:-120}"
ONLY="${ONLY:-}"
OBJDIR="$(mktemp -d /tmp/forge_ui_obj.XXXXXX)"
trap 'rm -rf "$OBJDIR"' EXIT
FAILMARK="$OBJDIR/failmark"
: > "$FAILMARK"

SRCS=(ui/src/*.cpp)
HDRS=(ui/include/forge/ui/*.hpp)
TESTS=(ui/test/*_test.cpp)

# portable job cap (bash 3.2+, macOS default shell)
CAP_PIDS=()
cap_launch() {
  "$@" &
  CAP_PIDS+=("$!")
  if [ "${#CAP_PIDS[@]}" -ge "$JOBS" ]; then
    wait "${CAP_PIDS[0]}" 2>/dev/null || true
    CAP_PIDS=("${CAP_PIDS[@]:1}")
  fi
}
cap_drain() { local p; for p in "${CAP_PIDS[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null || true; done; CAP_PIDS=(); }

echo "[ui] CXX=$CXX JOBS=$JOBS  ${#SRCS[@]} sources, ${#HDRS[@]} headers, ${#TESTS[@]} tests"

# ── 0a. missing-include preflight ────────────────────────────────────────────
# The kernel's checker first (its pairs are the libstdc++-vs-libc++ traps that
# have actually broken CI here), then the UI superset.
if ! bash forge-kernel/test/native/check_includes.sh "${SRCS[@]}" "${HDRS[@]}" "${TESTS[@]}" \
     >"$OBJDIR/incl.log" 2>&1; then
  cat "$OBJDIR/incl.log"; echo "[ui] kernel missing-include preflight FAILED"; exit 1
fi
sed -n '$p' "$OBJDIR/incl.log"
if ! bash ui/test/check_includes_ui.sh; then
  echo "[ui] UI missing-include preflight FAILED"; exit 1
fi

# ── 0b. every header must compile STANDALONE ─────────────────────────────────
# This is the include-what-you-use gate with teeth: a header that only compiles
# because some .cpp included <string> before it fails here.
check_header() {
  local h="$1"; local safe; safe="$(echo "$h" | tr '/.' '__')"
  # shellcheck disable=SC2086
  if ! $CXX $FLAGS "$ROOTDEF" $INC -fsyntax-only -x c++ "$h" 2>"$OBJDIR/$safe.hdr.err"; then
    echo "[ui:HEADER] NOT SELF-CONTAINED — $h"; tail -20 "$OBJDIR/$safe.hdr.err"
    echo "hdr:$h" >> "$FAILMARK"
  fi
}
for h in "${HDRS[@]}" ui/test/ui_test_util.hpp; do cap_launch check_header "$h"; done
cap_drain
if [ -s "$FAILMARK" ]; then echo "[ui] HEADER SELF-CONTAINMENT FAILURES — aborting"; exit 1; fi
echo "[ui] ${#HDRS[@]} headers + 1 test header are self-contained"

# ── 1. compile every source once ─────────────────────────────────────────────
compile_src() {
  # shellcheck disable=SC2086
  if ! $CXX $FLAGS "$ROOTDEF" $INC -c "$1" -o "$2" 2>"$2.err"; then
    echo "[ui:SRC] BUILD FAIL — $1"; tail -25 "$2.err"; echo "src:$1" >> "$FAILMARK"
  fi
}
OBJS=()
for src in "${SRCS[@]}"; do
  obj="$OBJDIR/$(echo "$src" | tr '/.' '__').o"
  OBJS+=("$obj")
  cap_launch compile_src "$src" "$obj"
done
cap_drain
if [ -s "$FAILMARK" ]; then echo "[ui] SOURCE COMPILE FAILURES — aborting"; exit 1; fi
echo "[ui] compiled ${#OBJS[@]} source objects"

# ── 2. build + run each test against the whole object set ────────────────────
# timeout(1) is coreutils and absent on macOS: run the child in the background,
# arm a killer, reap whichever finishes first. Returns 124 on timeout.
run_with_timeout() {
  local secs="$1"; shift
  "$@" & local pid=$!
  ( sleep "$secs"; kill -9 "$pid" 2>/dev/null ) & local wd=$!
  local rc=0
  wait "$pid" 2>/dev/null || rc=$?
  if kill -0 "$wd" 2>/dev/null; then kill -9 "$wd" 2>/dev/null; wait "$wd" 2>/dev/null || true
  else rc=124; fi
  return $rc
}

run_test() {
  local test="$1"; local name; name="$(basename "$test" .cpp)"
  local bin="$OBJDIR/$name"
  # shellcheck disable=SC2086
  if $CXX $FLAGS "$ROOTDEF" $INC "$test" "${OBJS[@]}" -o "$bin" 2>"$bin.err"; then
    local rc=0
    run_with_timeout "$TEST_TIMEOUT" "$bin" >"$bin.out" 2>&1 || rc=$?
    if [ "$rc" -eq 0 ]; then
      cat "$bin.out"
    elif [ "$rc" -eq 124 ]; then
      echo "[ui:$name] TEST TIMEOUT — exceeded ${TEST_TIMEOUT}s, killed. Last output:"
      tail -20 "$bin.out"; echo "timeout:$name" >> "$FAILMARK"
    else
      echo "[ui:$name] TEST FAIL (exit $rc) — full output:"; cat "$bin.out"
      echo "test:$name" >> "$FAILMARK"
    fi
  else
    echo "[ui:$name] BUILD/LINK FAIL"; tail -25 "$bin.err"; echo "test:$name" >> "$FAILMARK"
  fi
}

count=${#TESTS[@]}
ran=0
for test in "${TESTS[@]}"; do
  name="$(basename "$test" .cpp)"
  if [ -n "$ONLY" ] && [[ "$name" != *"$ONLY"* ]]; then continue; fi
  ran=$((ran+1))
  cap_launch run_test "$test"
done
cap_drain

if [ -s "$FAILMARK" ]; then
  echo "[ui] FAILURES PRESENT ($ran of $count gates run):"; cat "$FAILMARK"; exit 1
fi
if [ -n "$ONLY" ]; then
  echo "[ui] FILTERED RUN (ONLY=$ONLY): $ran of $count gates ran and passed — NOT a full gate"
  exit 0
fi
if [ "$ran" -ne "$count" ]; then echo "[ui] INTERNAL ERROR: ran $ran of $count gates"; exit 1; fi
echo "[ui] ALL $count UI GATES PASS (forge::ui — headless, no ImGui, no GPU, no display)"
