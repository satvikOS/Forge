#!/usr/bin/env bash
# forge-kernel/test/run_t153_assert_validation_gate.sh
#
# T-153 GATE — assert() is not input validation.
#
# Thirty runtime assert() calls sat under forge-kernel/src/native/brep/. The
# product ships with -DNDEBUG (forge-kernel/build/CMakeCache.txt:
# CMAKE_CXX_FLAGS_RELEASE = "-O3 -DNDEBUG"), where every one of them compiles to
# nothing. test/native/run_native.sh builds with "-std=c++20 -O2" and NO
# -DNDEBUG, so the native suite exercises the asserts, not the shipped code.
# This script closes that gap, in three parts:
#
#   1. STOCK, NDEBUG       — the assertions must be GREEN in the configuration
#                            the product actually ships.
#   2. STOCK, asserts live — the same assertions must ALSO be green with
#                            assert() enabled, proving the new checks fire
#                            BEFORE the asserts rather than racing them.
#   3. MUTATION BATTERY    — six engine mutations, each deleting ONE of the new
#                            validations. Every one must turn the harness RED,
#                            and red ON ITS OWN ASSERTION. A gate never seen red
#                            is a decoration.
#
# DISCIPLINE (SR-3, as in test/run_cone_loft_mutation_gate.sh):
#   * Mutations are applied to a COPY in a temp dir. The working tree is never
#     written to, so an interrupted run cannot leave a mutant behind.
#   * Every anchor must occur EXACTLY ONCE or the mutation aborts (exit 2) —
#     a mutation that silently matched nothing would look like a live control.
#   * A mutant that does not COMPILE proves nothing and is reported as a defect
#     in the mutation, not as a kill.
#   * A mutant that turns the harness red somewhere OTHER than its own
#     assertion is an accidental kill and is reported as a defect.
#   * The harness reads no source file and carries no list of expected
#     failures; it exercises behaviour only.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INC="$ROOT/forge-kernel/include"
TEST="$ROOT/forge-kernel/test/native/brep/assert_input_validation_test.cpp"
CXX="${CXX:-clang++}"
FLAGS="-std=c++20 -O2"
# Parallelism: forge-nproc is the sanctioned source on the dev box (Guardian
# lowers it under pressure); on a CI runner it does not exist, so fall back the
# same way run_native.sh:49 does rather than to forge-nproc's 2-job fail-safe.
J="${JOBS:-$( (command -v forge-nproc >/dev/null && forge-nproc) || (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/t153_gate.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT INT TERM
OBJ="$WORK/obj"; mkdir -p "$OBJ"

echo "=== T-153 gate: assert() is not input validation ==="
echo "root=$ROOT  jobs=$J  work=$WORK"
[ -f "$TEST" ] || { echo "FATAL: harness missing: $TEST"; exit 2; }

# ---------------------------------------------------------------------------
# Build the native object set once, under -DNDEBUG (the shipped configuration).
# ---------------------------------------------------------------------------
objname() { echo "$OBJ/$(echo "$1" | tr '/.' '__').o"; }

build_objects() {  # $1 = extra flags
  local extra="$1" pids=() src o rc=0
  cd "$ROOT" || return 2
  rm -f "$OBJ"/*.o "$OBJ/.failed"
  for src in forge-kernel/src/native/*.cpp forge-kernel/src/native/*/*.cpp; do
    [ -e "$src" ] || continue
    o="$(objname "$src")"
    ( $CXX $FLAGS $extra -I "$INC" -c "$src" -o "$o" 2>"$o.err" \
        || { echo "OBJ BUILD FAIL: $src"; tail -5 "$o.err"; touch "$OBJ/.failed"; } ) &
    pids+=("$!")
    if [ "${#pids[@]}" -ge "$J" ]; then wait "${pids[0]}" 2>/dev/null; pids=("${pids[@]:1}"); fi
  done
  for p in "${pids[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null; done
  [ -f "$OBJ/.failed" ] && rc=2
  return $rc
}

# Link + run the harness. Returns 2 for NOBUILD, else the harness exit code.
# $1 = log path, $2... = extra objects to put FIRST (a mutated replacement).
run_harness() {
  local log="$1"; shift
  local swap="${1:-}"; local swapfor="${2:-}"
  local objs=() o
  for o in "$OBJ"/*.o; do
    if [ -n "$swapfor" ] && [ "$o" = "$swapfor" ]; then continue; fi
    objs+=("$o")
  done
  [ -n "$swap" ] && objs+=("$swap")
  if ! $CXX $FLAGS -DNDEBUG -I "$INC" "$TEST" "${objs[@]}" -o "$WORK/harness" 2>"$log.build"; then
    tail -20 "$log.build" >"$log"
    return 2
  fi
  "$WORK/harness" >"$log" 2>&1
  return $?
}

# Rewrite ONE exact occurrence of `old` to `new` in a COPY of `src`.
# Aborts the whole gate if the anchor is not present exactly once.
mutate() {  # $1=src(rel) $2=old $3=new -> prints the mutated object path
  local src="$1" old="$2" new="$3"
  local mut="$WORK/mutant.cpp"
  MUT_SRC="$ROOT/$src" MUT_OUT="$mut" MUT_OLD="$old" MUT_NEW="$new" python3 - <<'PY' || return 2
import os, sys
src = open(os.environ["MUT_SRC"]).read()
old, new = os.environ["MUT_OLD"], os.environ["MUT_NEW"]
n = src.count(old)
if n != 1:
    sys.stderr.write("ANCHOR OCCURS %d TIMES (need exactly 1):\n%s\n" % (n, old))
    sys.exit(2)
open(os.environ["MUT_OUT"], "w").write(src.replace(old, new))
PY
  $CXX $FLAGS -DNDEBUG -I "$INC" -c "$mut" -o "$WORK/mutant.o" 2>"$WORK/mutant.err" || return 3
  echo "$WORK/mutant.o"
}

bad=0

# ---------------------------------------------------------------------------
# PART 1 — stock, NDEBUG. Nothing below proves anything unless this is green.
# ---------------------------------------------------------------------------
echo
echo "--- PART 1: stock harness, -DNDEBUG (the shipped configuration) ---"
if ! build_objects "-DNDEBUG"; then
  echo "  STOCK DID NOT BUILD under -DNDEBUG - nothing below proves anything"; exit 2
fi
run_harness "$WORK/stock_ndebug.log"; rc=$?
if [ "$rc" -eq 2 ]; then echo "  STOCK HARNESS DID NOT LINK - nothing below proves anything"; cat "$WORK/stock_ndebug.log"; exit 2; fi
if [ "$rc" -ne 0 ]; then
  echo "  STOCK harness is RED under NDEBUG (exit $rc) - fix that before reading any mutant"
  grep '\[FAIL\]' "$WORK/stock_ndebug.log"
  exit 1
fi
STOCK_LOG="$WORK/stock_ndebug.keep"; cp "$WORK/stock_ndebug.log" "$STOCK_LOG"
echo "  stock (NDEBUG): $(grep -c '\[PASS\]' "$STOCK_LOG" | tr -d ' ') assertions passed, 0 failed"
tail -1 "$STOCK_LOG" | sed 's/^/  /'

# ---------------------------------------------------------------------------
# PART 2 — stock with assert() LIVE. The new checks must fire before them.
# ---------------------------------------------------------------------------
echo
echo "--- PART 2: stock harness, asserts LIVE (checks must pre-empt the asserts) ---"
if ! build_objects ""; then
  echo "  debug object build FAILED"; bad=1
else
  # Link this one WITHOUT -DNDEBUG too, so the harness itself sees live asserts.
  objs=("$OBJ"/*.o)
  if $CXX $FLAGS -I "$INC" "$TEST" "${objs[@]}" -o "$WORK/harness_dbg" 2>"$WORK/dbg.build"; then
    "$WORK/harness_dbg" >"$WORK/stock_debug.log" 2>&1; rc=$?
    if [ "$rc" -eq 0 ]; then
      echo "  stock (asserts live): $(grep -c '\[PASS\]' "$WORK/stock_debug.log" | tr -d ' ') assertions passed"
      tail -1 "$WORK/stock_debug.log" | sed 's/^/  /'
    else
      echo "  STOCK harness is RED with asserts live (exit $rc) - a new check is NOT"
      echo "  pre-empting its assert, or an assert is firing on a refusal path:"
      grep '\[FAIL\]' "$WORK/stock_debug.log" | sed 's/^/    /'
      tail -5 "$WORK/stock_debug.log" | sed 's/^/    /'
      bad=1
    fi
  else
    echo "  debug harness DID NOT LINK"; tail -10 "$WORK/dbg.build"; bad=1
  fi
fi

# Back to the shipped configuration for the mutation battery.
build_objects "-DNDEBUG" || { echo "  could not rebuild NDEBUG objects"; exit 2; }

# ---------------------------------------------------------------------------
# PART 3 — mutation battery.
# ---------------------------------------------------------------------------
echo
echo "--- PART 3: mutation battery (each mutant must turn the harness RED) ---"

kill_check() {  # $1=name $2=src(rel) $3=old $4=new $5=must-be-the-assertion-that-stops-passing
  local name="$1" src="$2" old="$3" new="$4" must="$5"
  local mo
  if ! grep -qF "[PASS] $must" "$STOCK_LOG"; then
    echo "  [$name] BAD MUTANT SPEC: stock never printed '[PASS] $must' - the target"
    echo "          assertion does not exist, so this mutant can prove nothing."
    bad=1; return
  fi
  mo="$(mutate "$src" "$old" "$new")"; local mrc=$?
  if [ "$mrc" -eq 2 ]; then
    echo "  [$name] ANCHOR NOT UNIQUE - rewrite the mutant"; cat "$WORK/mutant.err" 2>/dev/null
    bad=1; return
  fi
  if [ "$mrc" -eq 3 ]; then
    echo "  [$name] MUTANT DID NOT COMPILE - proves nothing, rewrite it"
    tail -8 "$WORK/mutant.err"; bad=1; return
  fi
  run_harness "$WORK/$name.log" "$mo" "$(objname "$src")"; local rc=$?
  if [ "$rc" -eq 2 ]; then
    echo "  [$name] NOBUILD (link) - proves nothing, rewrite the mutant"
    tail -8 "$WORK/$name.log"; bad=1; return
  fi
  if [ "$rc" -eq 0 ]; then
    echo "  [$name] PASSED the harness - THE GATE CANNOT FAIL on this validation"
    bad=1; return
  fi
  if grep -qF "[PASS] $must" "$WORK/$name.log"; then
    echo "  [$name] turned the harness RED (exit $rc) but '$must'"
    echo "          STILL PASSED - the kill is an accident somewhere else"
    grep '\[FAIL\]' "$WORK/$name.log" | head -3 | sed 's/^/          /'
    bad=1; return
  fi
  echo "  [$name] KILLED (exit $rc) - '$must' stopped passing"
}

# M1 — the canonical site: the rational denominator check in Homog::project.
kill_check M1_rational_denominator \
  "forge-kernel/src/native/brep/Nurbs.cpp" \
  '        if (!(std::fabs(w) > 0.0)) return false;' \
  '        if (false) return false;' \
  'Nurbs.cpp:33 curve with a zero rational denominator is REFUSED with a reason'

# M2 — the Bezier weights-length check (the 4.31078e-314 out-of-bounds read).
kill_check M2_bezier_weights_length \
  "forge-kernel/src/native/brep/Nurbs.cpp" \
  '    if (weights.size() != controlPoints.size())
        { r.reason = "bezierCurvePoint: weights count != control point count"; return r; }' \
  '    if (false)
        { r.reason = "bezierCurvePoint: weights count != control point count"; return r; }' \
  'Nurbs.cpp:167 short Bezier weights list is REFUSED (was 4.31078e-314)'

# M3 — the knot-multiplicity check (the unsigned p-s wrap).
kill_check M3_insertknot_multiplicity \
  "forge-kernel/src/native/brep/NurbsCalculus.cpp" \
  '    if (!(s < p)) {
        r.reason = "insertKnot: existing knot multiplicity already >= degree";
        return r;
    }' \
  '    if (false) {
        r.reason = "insertKnot: existing knot multiplicity already >= degree";
        return r;
    }' \
  'NurbsCalculus.cpp:312 insertKnot at an INTERIOR knot of multiplicity == degree is REFUSED'

# M4 — the surface rational denominator check.
kill_check M4_surface_denominator \
  "forge-kernel/src/native/brep/NurbsCalculus.cpp" \
  '    if (!(std::fabs(w0) > 0.0)) {
        r.reason = "surfaceDerivatives: degenerate rational weight (denominator == 0)";
        return r;
    }' \
  '    if (false) {
        r.reason = "surfaceDerivatives: degenerate rational weight (denominator == 0)";
        return r;
    }' \
  'NurbsCalculus.cpp:261 zero rational surface denominator is REFUSED'

# M5 — a primitive dimension check.
kill_check M5_primitive_dimensions \
  "forge-kernel/src/native/brep/Primitives.cpp" \
  '    if (!(fin(R, r) && R > 0 && r > 0 && r < R))' \
  '    if (false)' \
  'Primitives.cpp all 11 degenerate primitive requests DECLINE (return nullptr)'

# M6 — the non-manifold third-coedge pre-flight.
kill_check M6_nonmanifold_third_coedge \
  "forge-kernel/src/native/brep/Topology.cpp" \
  '        if (used >= 2) {' \
  '        if (false) {' \
  'Topology.cpp:84 a THIRD use of one edge is REFUSED (was a silent orphan coedge)'

echo
if [ "$bad" -eq 0 ]; then
  echo "[t153] PASS - stock green under NDEBUG and with asserts live, and all six"
  echo "       mutants killed, each on its own assertion."
else
  echo "[t153] FAIL - a control is inert (see above)."
fi
exit "$bad"
