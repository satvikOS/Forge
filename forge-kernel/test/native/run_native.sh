#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_native.sh — build + run the in-house pure-C++ native-kernel gates
# (forge::native::{predicates,brep,mesh,geom,implicit,voxel}).
#
# These are the validated increments of the in-house unified kernel
# (KERNEL_INHOUSE_ROADMAP.md): NO external dependencies, NO OCCT, NO WASM —
# just a C++20 compiler + the standard library. Each test under
# test/native/<class>/ is built as its OWN executable. Every test is linked
# against the WHOLE native source set (src/native/**.cpp) so cross-class
# increments (e.g. voxel->mesh reusing the half-edge mesh) resolve cleanly;
# the sources are header-guarded, single-definition, distinct-namespace files,
# so linking them all carries no ODR risk.
#
# Exit 0 iff every test builds and passes. Override compiler with CXX=g++.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

CXX="${CXX:-clang++}"
INC="forge-kernel/include"
FLAGS="-std=c++20 -O2"
# All native sources: Predicates.cpp (flat) + every src/native/<class>/*.cpp.
ALL_SRC_FLAT="forge-kernel/src/native/*.cpp"
ALL_SRC_CLASS="forge-kernel/src/native/*/*.cpp"
fail=0
count=0

run_test() {
  local name="$1"; local test="$2"
  local safe="${name//\//_}"
  count=$((count+1))
  # shellcheck disable=SC2086
  if $CXX $FLAGS -I "$INC" "$test" $ALL_SRC_FLAT $ALL_SRC_CLASS -o "/tmp/forge_native_$safe" 2>"/tmp/forge_native_$safe.err"; then
    if "/tmp/forge_native_$safe" >"/tmp/forge_native_$safe.out" 2>&1; then
      echo "[native:$name] PASS — $(grep -iE 'passed|RESULT|PASS' "/tmp/forge_native_$safe.out" | tail -1)"
    else
      echo "[native:$name] TEST FAIL"; tail -6 "/tmp/forge_native_$safe.out"; fail=1
    fi
  else
    echo "[native:$name] BUILD FAIL"; tail -12 "/tmp/forge_native_$safe.err"; fail=1
  fi
}

run_test predicates forge-kernel/test/native/predicates_test.cpp
for d in brep mesh geom implicit voxel; do
  for test in forge-kernel/test/native/$d/*.cpp; do
    [ -e "$test" ] || continue
    run_test "$d/$(basename "$test" .cpp)" "$test"
  done
done

if [ "$fail" -ne 0 ]; then echo "[native] FAILURES PRESENT ($count gates run)"; exit 1; fi
echo "[native] ALL $count NATIVE GATES PASS (forge::native — pure C++, no deps, no WASM)"
