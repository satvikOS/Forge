#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_parameters_gate.sh — parameters and expressions, against the REAL library.
#
# Builds libforge_expr (third_party/freecad-derived/expressions, LGPL-2.1) as a
# SHARED library, then:
#
#   1. runs the library's own test (FreeCAD's tokenizer, unit and evaluation cases
#      plus the refusals Forge added), linked against the dylib;
#   2. compiles forge::ui (ui/src/*.cpp, globbed) + Forge's adapter
#      (forge-desktop/src/ExpressionHost.cpp) + parameters_gate.cpp, links the
#      library DYNAMICALLY, and runs it: one parameter drives three features in one
#      undo step; mm + kg is refused; a -> b -> a is refused naming both; Archie's
#      plan path; a build with no library disables the commands;
#   3. proves the link is dynamic ON THE BINARY IT RAN: the executable's load
#      commands name libforge_expr (otool -L on macOS, readelf -d on Linux), and
#      it DEFINES no forge::expr symbol -- the library's code is not in it.
#
# --mutations then proves the gate can fail. Each mutation is applied to a COPY of
# the tree, never the checkout:
#   M1  Quantity::operator+ stops checking units      -> section B must go red
#   M2  the cycle search never reports a back edge     -> section C must go red
#   M3  ParameterEdit skips every statement rewrite    -> section A must go red
#   M4  the library is linked STATICALLY (its objects) -> the dynamic-link check must go red
#
# Needs a C++20 compiler and nothing else: no OCCT, no SDK, no network.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || { echo "[params] cannot resolve repo root"; exit 2; }
[ -n "$ROOT" ] || { echo "[params] empty repo root"; exit 2; }
CXX="${CXX:-clang++}"
JOBS="${JOBS:-$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 2 )}"
MUTATIONS=0
[ "${1:-}" = "--mutations" ] && MUTATIONS=1

WORK="$(mktemp -d "${TMPDIR:-/tmp}/forge_params.XXXXXX")" || exit 2
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# run_tree <tree> <label> -> 0 when every check in <tree> passes
run_tree() {
  local tree="$1" label="$2" out="$WORK/$2"
  mkdir -p "$out"
  local lib
  if ! lib="$(CXX="$CXX" JOBS="$JOBS" bash "$tree/third_party/freecad-derived/expressions/build_forge_expr.sh" "$out/lib" | tail -1)"; then
    echo "[params:$label] libforge_expr did not build"
    return 1
  fi
  [ -f "$lib" ] || { echo "[params:$label] no library at '$lib'"; return 1; }
  local libdir; libdir="$(dirname "$lib")"

  # 1. the library's own test
  if ! "$CXX" -std=c++20 -O1 -Wall -Wextra -Werror -I "$tree/third_party/freecad-derived/expressions/include" \
       "$tree/third_party/freecad-derived/expressions/test/expr_library_test.cpp" \
       -L "$libdir" -lforge_expr -Wl,-rpath,"$libdir" -o "$out/expr_library_test" 2>"$out/libtest.err"; then
    echo "[params:$label] library test did not compile"; tail -20 "$out/libtest.err"; return 1
  fi
  if ! "$out/expr_library_test"; then
    echo "[params:$label] library test FAILED"; return 1
  fi

  # 2. forge::ui + adapter + gate, compiled once per source, linked against the dylib
  local objs=() pids=() src obj fail="$out/failed"
  : > "$fail"
  mkdir -p "$out/obj"
  local flags=(-std=c++20 -O1 -Wall -Wextra -Werror -I "$tree/ui/include" -I "$tree/ui/test"
               -I "$tree/forge-desktop/src" -I "$tree/third_party/freecad-derived/expressions/include")
  for src in "$tree"/ui/src/*.cpp "$tree/forge-desktop/src/ExpressionHost.cpp" "$tree/forge-desktop/test/parameters_gate.cpp"; do
    obj="$out/obj/$(basename "$src" .cpp).o"
    objs+=("$obj")
    ( "$CXX" "${flags[@]}" -c "$src" -o "$obj" 2>"$obj.err" || { echo "$src" >> "$fail"; tail -25 "$obj.err"; } ) &
    pids+=("$!")
    if [ "${#pids[@]}" -ge "$JOBS" ]; then wait "${pids[0]}"; pids=("${pids[@]:1}"); fi
  done
  for p in "${pids[@]}"; do wait "$p"; done
  if [ -s "$fail" ]; then echo "[params:$label] COMPILE FAILED:"; cat "$fail"; return 1; fi

  local link_mode="${PARAMS_LINK_MODE:-dynamic}"
  if [ "$link_mode" = "static" ]; then
    # M4 only: the library's OBJECT FILES linked straight into the executable.
    if ! "$CXX" -std=c++20 "${objs[@]}" "$libdir"/forge_expr_obj/*.o -o "$out/parameters_gate" 2>"$out/link.err"; then
      echo "[params:$label] LINK FAILED"; tail -20 "$out/link.err"; return 1
    fi
  else
    if ! "$CXX" -std=c++20 "${objs[@]}" -L "$libdir" -lforge_expr -Wl,-rpath,"$libdir" \
         -o "$out/parameters_gate" 2>"$out/link.err"; then
      echo "[params:$label] LINK FAILED"; tail -20 "$out/link.err"; return 1
    fi
  fi
  if ! "$out/parameters_gate"; then
    echo "[params:$label] parameters_gate FAILED"; return 1
  fi

  # 3. THE LINK IS DYNAMIC, on the binary that just ran
  local bin="$out/parameters_gate" names defined
  if [ "$(uname -s)" = "Darwin" ]; then
    names="$(otool -L "$bin" | tail -n +2 | awk '{print $1}')"
    echo "[params:$label] otool -L parameters_gate:"; echo "$names" | sed 's/^/    /'
    echo "$names" | grep -qx '@rpath/libforge_expr.dylib' || { echo "[params:$label] RED: the executable does not load @rpath/libforge_expr.dylib"; return 1; }
    # STRONG definitions only. An inline member of a library header (Value::
    # isNumber, Quantity::getValue) may legitimately be emitted into Forge's own
    # object as a WEAK coalesced symbol; that is the header, not the library.
    # Library CODE -- Quantity::operator+, the parser -- is a strong definition.
    defined="$(nm -gUm "$bin" 2>/dev/null | grep -v 'weak' | c++filt | grep -c 'forge::expr::' || true)"
  else
    names="$(readelf -d "$bin" | grep NEEDED)"
    echo "[params:$label] readelf -d NEEDED:"; echo "$names" | sed 's/^/    /'
    echo "$names" | grep -q 'libforge_expr.so' || { echo "[params:$label] RED: the executable does not load libforge_expr.so"; return 1; }
    # ' T ' only: a weak ' W ' is an inline header member, see the macOS branch.
    defined="$(nm -C --defined-only "$bin" 2>/dev/null | grep -c ' T forge::expr::' || true)"
  fi
  defined="${defined:-0}"
  if [ "$defined" != "0" ]; then
    echo "[params:$label] RED: the executable DEFINES $defined forge::expr symbol(s) -- LGPL code was linked into it"
    return 1
  fi
  echo "[params:$label] dynamic link proven: loads libforge_expr, defines 0 forge::expr symbols"
  return 0
}

echo "[params] CXX=$CXX JOBS=$JOBS"
if ! run_tree "$ROOT" clean; then
  echo "[params] RED"
  exit 1
fi
echo "[params] GREEN on the tree"

[ "$MUTATIONS" = "1" ] || exit 0

# ── mutations: each must turn the gate red ───────────────────────────────────
copy_tree() {  # copy_tree <dest> : the parts of the repo this gate compiles
  local dest="$1"
  mkdir -p "$dest/forge-desktop" "$dest/third_party/freecad-derived"
  cp -R "$ROOT/ui" "$dest/ui"
  mkdir -p "$dest/forge-desktop/src" "$dest/forge-desktop/test"
  cp "$ROOT/forge-desktop/src/ExpressionHost.hpp" "$ROOT/forge-desktop/src/ExpressionHost.cpp" "$dest/forge-desktop/src/"
  cp "$ROOT/forge-desktop/test/parameters_gate.cpp" "$dest/forge-desktop/test/"
  cp -R "$ROOT/third_party/freecad-derived/expressions" "$dest/third_party/freecad-derived/expressions"
}

# mutate <file> <python-literal old> <python-literal new>: exact, single, or refuse
mutate() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()
n = text.count(old)
if n != 1:
    sys.stderr.write("mutation anchor found %d times in %s: %r\n" % (n, path, old))
    sys.exit(3)
open(path, "w", encoding="utf-8").write(text.replace(old, new))
PY
}

RED=0
expect_red() {  # expect_red <label>
  local label="$1" tree="$WORK/tree_$1"
  if PARAMS_LINK_MODE="${PARAMS_LINK_MODE:-dynamic}" run_tree "$tree" "$label" > "$WORK/$label.log" 2>&1; then
    echo "[params] MUTATION $label SURVIVED -- the gate cannot see it"
    tail -15 "$WORK/$label.log"
    RED=1
  else
    echo "[params] mutation $label killed: $(grep -m1 -E 'FAIL|RED' "$WORK/$label.log" | head -c 160)"
  fi
}

copy_tree "$WORK/tree_M1"
mutate "$WORK/tree_M1/third_party/freecad-derived/expressions/src/Quantity.cpp" \
  '    if (myUnit != other.myUnit) {
        throw UnitsMismatchError("Quantity::operator +(): Unit mismatch in plus operation");
    }

    return Quantity(myValue + other.myValue, myUnit);' \
  '    return Quantity(myValue + other.myValue, myUnit);' || exit 2
expect_red M1

copy_tree "$WORK/tree_M2"
mutate "$WORK/tree_M2/ui/src/Parameters.cpp" \
  'if (mark[dep] == Mark::Grey) {' 'if (false && mark[dep] == Mark::Grey) {' || exit 2
expect_red M2

copy_tree "$WORK/tree_M3"
mutate "$WORK/tree_M3/ui/src/Parameters.cpp" \
  '  for (const ArgumentUpdate& u : updates_) {' '  for (const ArgumentUpdate& u : std::vector<ArgumentUpdate>{}) {' || exit 2
expect_red M3

copy_tree "$WORK/tree_M4"
PARAMS_LINK_MODE=static expect_red M4

if [ "$RED" -ne 0 ]; then
  echo "[params] RED -- a mutation survived"
  exit 1
fi
echo "[params] GREEN -- clean tree passes and all 4 mutations are killed"
