#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_native.sh — build + run the in-house pure-C++ native-kernel gates
# (forge::native::{predicates,brep,mesh,geom,implicit,voxel}).
#
# These are the first validated increments of the in-house unified kernel
# (KERNEL_INHOUSE_ROADMAP.md): NO external dependencies, NO OCCT, NO WASM —
# just a C++20 compiler + the standard library. Each module is a self-contained
# standalone test that asserts against analytic / structural truth.
#
# Exit 0 iff every module builds and every gate passes.
# Override the compiler with CXX=g++ (default clang++).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

CXX="${CXX:-clang++}"
INC="forge-kernel/include"
PRED="forge-kernel/src/native/Predicates.cpp"
FLAGS="-std=c++20 -O2"
fail=0

run() {
  local name="$1"; shift
  if $CXX $FLAGS -I "$INC" "$@" -o "/tmp/forge_native_$name" 2>"/tmp/forge_native_$name.err"; then
    if "/tmp/forge_native_$name" >"/tmp/forge_native_$name.out" 2>&1; then
      echo "[native:$name] PASS — $(grep -iE 'passed|RESULT|PASS' "/tmp/forge_native_$name.out" | tail -1)"
    else
      echo "[native:$name] TEST FAIL"; tail -6 "/tmp/forge_native_$name.out"; fail=1
    fi
  else
    echo "[native:$name] BUILD FAIL"; tail -10 "/tmp/forge_native_$name.err"; fail=1
  fi
}

run predicates "$PRED" forge-kernel/test/native/predicates_test.cpp
for d in brep mesh geom implicit voxel; do
  # shellcheck disable=SC2086
  run "$d" forge-kernel/src/native/$d/*.cpp "$PRED" forge-kernel/test/native/$d/*.cpp
done

if [ "$fail" -ne 0 ]; then echo "[native] FAILURES PRESENT"; exit 1; fi
echo "[native] ALL NATIVE GATES PASS (forge::native — pure C++, no deps, no WASM)"
