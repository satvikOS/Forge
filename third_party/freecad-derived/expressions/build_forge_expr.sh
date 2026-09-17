#!/usr/bin/env bash
# SPDX-License-Identifier: LGPL-2.1-or-later
#
# build_forge_expr.sh — build libforge_expr as a SHARED library, without CMake.
#
#   bash third_party/freecad-derived/expressions/build_forge_expr.sh <out-dir>
#
# Writes <out-dir>/libforge_expr.dylib (macOS) or <out-dir>/libforge_expr.so
# (Linux) and prints its path on the last line. The CMake build
# (CMakeLists.txt beside this file) is the one the application uses; this script
# exists because Forge's headless gates compile their sources directly, and a gate
# that wants the real library must be able to build the real library.
#
# The two builds use the SAME source list and the SAME flags; lgpl_dynamic_link_gate
# checks this file and CMakeLists.txt name the same sources.
#
# Why a SHARED library, always: this code is LGPL-2.1-or-later. Forge links it
# dynamically so that a recipient can replace it with a modified build and relink
# nothing (LGPL-2.1 section 6(b)). There is deliberately no static option.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 2
OUT="${1:-}"
[ -n "$OUT" ] || { echo "usage: $0 <out-dir>" >&2; exit 2; }
mkdir -p "$OUT" || exit 2
OUT="$(cd "$OUT" && pwd)"

CXX="${CXX:-clang++}"
JOBS="${JOBS:-2}"
SOURCES=(
  src/Unit.cpp
  src/Quantity.cpp
  src/Expression.cpp
  src/Evaluator.cpp
)
FLAGS=(-std=c++20 -O2 -fPIC -fvisibility=hidden -fvisibility-inlines-hidden
       -DFORGE_EXPR_BUILDING -I"$HERE/include" -I"$HERE/src" -Wall -Wextra)

OBJDIR="$OUT/forge_expr_obj"
mkdir -p "$OBJDIR" || exit 2
FAIL="$OBJDIR/failed"
: > "$FAIL"

compile_one() {
  local src="$1" obj="$OBJDIR/$(basename "$1" .cpp).o"
  if ! "$CXX" "${FLAGS[@]}" -c "$HERE/$src" -o "$obj" 2> "$obj.err"; then
    echo "[forge_expr] COMPILE FAILED: $src" >&2
    tail -30 "$obj.err" >&2
    echo "$src" >> "$FAIL"
  fi
}

pids=()
for s in "${SOURCES[@]}"; do
  compile_one "$s" &
  pids+=("$!")
  if [ "${#pids[@]}" -ge "$JOBS" ]; then
    wait "${pids[0]}"
    pids=("${pids[@]:1}")
  fi
done
for p in "${pids[@]}"; do wait "$p"; done
[ -s "$FAIL" ] && exit 1

OBJS=()
for s in "${SOURCES[@]}"; do OBJS+=("$OBJDIR/$(basename "$s" .cpp).o"); done

if [ "$(uname -s)" = "Darwin" ]; then
  LIB="$OUT/libforge_expr.dylib"
  "$CXX" -dynamiclib -std=c++20 -install_name "@rpath/libforge_expr.dylib" \
    -compatibility_version 1.0.0 -current_version 1.0.0 \
    "${OBJS[@]}" -o "$LIB" || { echo "[forge_expr] LINK FAILED" >&2; exit 1; }
else
  LIB="$OUT/libforge_expr.so"
  "$CXX" -shared -std=c++20 -Wl,-soname,libforge_expr.so \
    "${OBJS[@]}" -o "$LIB" || { echo "[forge_expr] LINK FAILED" >&2; exit 1; }
fi
echo "$LIB"
