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
# modules surfaces at link time). This is O(srcs + tests), not O(srcs * tests),
# so the suite stays fast as the kernel grows (keeps CI's native job < timeout).
# The sources are header-guarded, single-definition, distinct-namespace files,
# so linking them all carries no ODR risk.
#
# Exit 0 iff every source compiles and every test builds and passes.
# Override compiler with CXX=g++.
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
OBJDIR="$(mktemp -d /tmp/forge_native_obj.XXXXXX)"
trap 'rm -rf "$OBJDIR"' EXIT
fail=0
count=0

# ── 1. compile every native source to a .o exactly once ─────────────────────
OBJS=()
for src in forge-kernel/src/native/*.cpp forge-kernel/src/native/*/*.cpp; do
  [ -e "$src" ] || continue
  obj="$OBJDIR/$(echo "$src" | tr '/.' '__').o"
  # shellcheck disable=SC2086
  if ! $CXX $FLAGS -I "$INC" -c "$src" -o "$obj" 2>"$obj.err"; then
    echo "[native:SRC] BUILD FAIL — $src"; tail -15 "$obj.err"; fail=1
  fi
  OBJS+=("$obj")
done
if [ "$fail" -ne 0 ]; then echo "[native] SOURCE COMPILE FAILURES — aborting"; exit 1; fi
echo "[native] compiled ${#OBJS[@]} source objects"

# ── 2. build + run each test against the whole object set ───────────────────
run_test() {
  local name="$1"; local test="$2"
  local safe="${name//\//_}"
  count=$((count+1))
  # shellcheck disable=SC2086
  if $CXX $FLAGS -I "$INC" "$test" "${OBJS[@]}" -o "/tmp/forge_native_$safe" 2>"/tmp/forge_native_$safe.err"; then
    if "/tmp/forge_native_$safe" >"/tmp/forge_native_$safe.out" 2>&1; then
      echo "[native:$name] PASS — $(grep -iE 'passed|RESULT|PASS' "/tmp/forge_native_$safe.out" | tail -1)"
    else
      echo "[native:$name] TEST FAIL — full output:"; cat "/tmp/forge_native_$safe.out"; fail=1
    fi
  else
    echo "[native:$name] BUILD/LINK FAIL"; tail -15 "/tmp/forge_native_$safe.err"; fail=1
  fi
}

run_test predicates forge-kernel/test/native/predicates_test.cpp
for d in brep mesh geom implicit voxel gdt csg tolstack vvuq materials am composites surfit cam linalg; do
  for test in forge-kernel/test/native/$d/*.cpp; do
    [ -e "$test" ] || continue
    run_test "$d/$(basename "$test" .cpp)" "$test"
  done
done

if [ "$fail" -ne 0 ]; then echo "[native] FAILURES PRESENT ($count gates run)"; exit 1; fi
echo "[native] ALL $count NATIVE GATES PASS (forge::native — pure C++, no deps, no WASM)"
