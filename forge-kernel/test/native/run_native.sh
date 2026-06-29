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
run_test() {  # $1=name $2=test
  local name="$1"; local test="$2"; local safe="${name//\//_}"
  # shellcheck disable=SC2086
  if $CXX $FLAGS -I "$INC" "$test" "${OBJS[@]}" -o "/tmp/forge_native_$safe" 2>"/tmp/forge_native_$safe.err"; then
    if "/tmp/forge_native_$safe" >"/tmp/forge_native_$safe.out" 2>&1; then
      echo "[native:$name] PASS — $(grep -iE 'passed|RESULT|PASS' "/tmp/forge_native_$safe.out" | tail -1)"
    else
      echo "[native:$name] TEST FAIL — full output:"; cat "/tmp/forge_native_$safe.out"; echo "test:$name" >> "$FAILMARK"
    fi
  else
    echo "[native:$name] BUILD/LINK FAIL"; tail -15 "/tmp/forge_native_$safe.err"; echo "test:$name" >> "$FAILMARK"
  fi
}

# collect the full test list (predicates + every test/native/<class>/*.cpp)
TESTS=("predicates|forge-kernel/test/native/predicates_test.cpp")
for d in brep mesh geom implicit voxel gdt csg tolstack vvuq materials am composites surfit cam linalg fea; do
  for test in forge-kernel/test/native/$d/*.cpp; do
    [ -e "$test" ] || continue
    TESTS+=("$d/$(basename "$test" .cpp)|$test")
  done
done
count=${#TESTS[@]}
for entry in "${TESTS[@]}"; do
  cap_launch run_test "${entry%%|*}" "${entry#*|}"
done
cap_drain

if [ -s "$FAILMARK" ]; then echo "[native] FAILURES PRESENT ($count gates run):"; cat "$FAILMARK"; exit 1; fi
echo "[native] ALL $count NATIVE GATES PASS (forge::native — pure C++, no deps, no WASM)"
