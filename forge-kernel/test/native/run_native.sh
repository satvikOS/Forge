#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_native.sh — build + run the in-house pure-C++ native-kernel gates
# (forge::native::{predicates,brep,mesh,geom,implicit,voxel,gdt,csg}).
#
# These are the validated increments of the in-house unified kernel
# (KERNEL_INHOUSE_ROADMAP.md): NO external dependencies, NO OCCT, NO WASM —
# just a C++20 compiler + the standard library.
#
# SCALE: every native source is compiled to a .o ONCE, then each test under
# test/native/<class>/ is compiled and linked against the WHOLE object set
# (so cross-class increments resolve, and any duplicate-symbol conflict across
# modules surfaces at link time). This is O(srcs + tests), not O(srcs * tests).
# Both phases run in PARALLEL with a portable job-cap (JOBS = CPU count) so the
# suite stays well under CI's native-job timeout as the kernel grows — on a
# multi-core CI runner this is ~Nx faster than the old sequential loop.
# The sources are header-guarded, single-definition, distinct-namespace files,
# so linking them all carries no ODR risk.
#
# Exit 0 iff every source compiles and every test builds and passes.
# Override compiler with CXX=g++ ; override parallelism with JOBS=N.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

# pre-flight: catch missing standard #includes (libstdc++/CI) that the Mac's
# Apple-clang/libc++ silently provides — a local compile would pass but CI fails.
if ! bash forge-kernel/test/native/check_includes.sh >/tmp/forge_native_incl.log 2>&1; then
  cat /tmp/forge_native_incl.log; echo "[native] missing-include preflight FAILED"; exit 1
fi

CXX="${CXX:-clang++}"
INC="forge-kernel/include"
FLAGS="-std=c++20 -O2"
JOBS="${JOBS:-$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"
TEST_TIMEOUT="${TEST_TIMEOUT:-300}"   # seconds per test. A HANG must FAIL, not eat the CI job.
ONLY="${ONLY:-}"                      # substring filter, e.g. ONLY=brep/native_boolean_test
OBJDIR="$(mktemp -d /tmp/forge_native_obj.XXXXXX)"
trap 'rm -rf "$OBJDIR"' EXIT
FAILMARK="$OBJDIR/failmark"   # append-only failure marker (atomic short writes); non-empty ⇒ a failure
: > "$FAILMARK"

# portable job-cap (bash 3.2+): cap concurrent background jobs at $JOBS by
# waiting on the oldest pid whenever the in-flight set is full.
CAP_PIDS=()
cap_launch() {  # "$@" = command to run in background
  "$@" &
  CAP_PIDS+=("$!")
  if [ "${#CAP_PIDS[@]}" -ge "$JOBS" ]; then
    wait "${CAP_PIDS[0]}" 2>/dev/null || true
    CAP_PIDS=("${CAP_PIDS[@]:1}")
  fi
}
cap_drain() { local p; for p in "${CAP_PIDS[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null || true; done; CAP_PIDS=(); }

echo "[native] parallelism JOBS=$JOBS"

# ── 1. compile every native source to a .o exactly once (PARALLEL) ───────────
compile_src() {  # $1=src $2=obj
  # shellcheck disable=SC2086
  if ! $CXX $FLAGS -I "$INC" -c "$1" -o "$2" 2>"$2.err"; then
    echo "[native:SRC] BUILD FAIL — $1"; tail -15 "$2.err"; echo "src:$1" >> "$FAILMARK"
  fi
}
OBJS=()
for src in forge-kernel/src/native/*.cpp forge-kernel/src/native/*/*.cpp; do
  [ -e "$src" ] || continue
  obj="$OBJDIR/$(echo "$src" | tr '/.' '__').o"
  OBJS+=("$obj")
  cap_launch compile_src "$src" "$obj"
done
cap_drain
if [ -s "$FAILMARK" ]; then echo "[native] SOURCE COMPILE FAILURES — aborting"; exit 1; fi
echo "[native] compiled ${#OBJS[@]} source objects"

# ── 2. build + run each test against the whole object set (PARALLEL) ─────────
# Portable per-test timeout. `timeout(1)` is coreutils and absent on macOS, so run the child in
# the background, arm a killer, and reap whichever finishes first. Returns 124 on timeout.
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

run_test() {  # $1=name $2=test
  local name="$1"; local test="$2"; local safe="${name//\//_}"
  # shellcheck disable=SC2086
  if $CXX $FLAGS -I "$INC" "$test" "${OBJS[@]}" -o "/tmp/forge_native_$safe" 2>"/tmp/forge_native_$safe.err"; then
    local rc=0
    run_with_timeout "$TEST_TIMEOUT" "/tmp/forge_native_$safe" >"/tmp/forge_native_$safe.out" 2>&1 || rc=$?
    if [ "$rc" -eq 0 ]; then
      echo "[native:$name] PASS — $(grep -iE 'passed|RESULT|PASS' "/tmp/forge_native_$safe.out" | tail -1)"
    elif [ "$rc" -eq 124 ]; then
      echo "[native:$name] TEST TIMEOUT — exceeded ${TEST_TIMEOUT}s, killed. Last output:"
      tail -20 "/tmp/forge_native_$safe.out"; echo "timeout:$name" >> "$FAILMARK"
    else
      echo "[native:$name] TEST FAIL (exit $rc) — full output:"; cat "/tmp/forge_native_$safe.out"; echo "test:$name" >> "$FAILMARK"
    fi
  else
    echo "[native:$name] BUILD/LINK FAIL"; tail -15 "/tmp/forge_native_$safe.err"; echo "test:$name" >> "$FAILMARK"
  fi
}

# collect the full test list (predicates + every test/native/<class>/*.cpp)
TESTS=("predicates|forge-kernel/test/native/predicates_test.cpp")
for d in brep mesh geom implicit voxel gdt csg tolstack vvuq materials am composites surfit cam linalg fea em viz; do
  for test in forge-kernel/test/native/$d/*.cpp; do
    [ -e "$test" ] || continue
    TESTS+=("$d/$(basename "$test" .cpp)|$test")
  done
done
count=${#TESTS[@]}
ran=0
for entry in "${TESTS[@]}"; do
  name="${entry%%|*}"
  if [ -n "$ONLY" ] && [[ "$name" != *"$ONLY"* ]]; then continue; fi
  ran=$((ran+1))
  cap_launch run_test "$name" "${entry#*|}"
done
cap_drain

if [ -s "$FAILMARK" ]; then echo "[native] FAILURES PRESENT ($ran of $count gates run):"; cat "$FAILMARK"; exit 1; fi
if [ -n "$ONLY" ]; then
  # NEVER claim gates passed that never ran. ONLY= is a debugging filter, not a green light.
  echo "[native] FILTERED RUN (ONLY=$ONLY): $ran of $count gates ran and passed — NOT a full gate"
  exit 0
fi
if [ "$ran" -ne "$count" ]; then echo "[native] INTERNAL ERROR: ran $ran of $count gates"; exit 1; fi
echo "[native] ALL $count NATIVE GATES PASS (forge::native — pure C++, no deps, no WASM)"
