#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_simulation_tests.sh — build + run the simulation animation-producer gates.
#
# Compiles simulation/src plus the THREE forge-kernel translation units the
# animation producer needs, then builds and runs every gate under
# simulation/test/. Exit 0 iff every source compiles and every gate passes.
#
# WHY ONLY THREE KERNEL TUs
# -------------------------
#   forge-kernel/src/MultibodyDynamics.cpp  the index-3 HHT-alpha DAE integrator
#   forge-kernel/src/AssemblySolver.cpp     rodrigues() / makeTransform() only
#   forge-kernel/src/native/linalg/LinAlg.cpp   dense LU/LDLT behind the KKT solve
#
# AssemblySolver.cpp is compiled with -ffunction-sections -fdata-sections and
# linked under the platform's garbage-collecting link flag. AssemblySolver::solve
# pulls in ComponentRegistry -> ShapeRegistry -> BVH -> OCCT, none of which the
# animation producer touches; collecting the unreferenced sections keeps this
# suite to a targeted three-TU build instead of a full kernel link. If the link
# ever fails with undefined ComponentRegistry/OCCT symbols, that is the signal
# that something in the animation path started reaching into the assembly
# solver -- fix the reach, do not add OCCT to this suite.
#
# OCCT headers ARE still needed at COMPILE time (MultibodyDynamics.hpp includes
# AssemblySolver.hpp -> ComponentRegistry.hpp -> ShapeRegistry.hpp, which
# includes TopoDS_Shape.hxx). No OCCT library is linked.
#
# Override: CXX=g++ ; OCCT_INCLUDE=/path/to/opencascade ; TEST_TIMEOUT=600
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CXX="${CXX:-clang++}"
FLAGS="-std=c++20 -O2 -Wall -Wextra"
TEST_TIMEOUT="${TEST_TIMEOUT:-600}"
ONLY="${ONLY:-}"

# ── locate the OCCT include directory (headers only; nothing is linked) ──────
if [ -z "${OCCT_INCLUDE:-}" ]; then
  for cand in \
      /opt/homebrew/opt/opencascade/include/opencascade \
      /usr/local/opt/opencascade/include/opencascade \
      /usr/include/opencascade \
      /usr/local/include/opencascade ; do
    [ -f "$cand/TopoDS_Shape.hxx" ] && OCCT_INCLUDE="$cand" && break
  done
fi
if [ -z "${OCCT_INCLUDE:-}" ]; then
  # Homebrew keeps versioned cellars; take the newest that has the header.
  OCCT_INCLUDE="$(ls -d /opt/homebrew/Cellar/opencascade/*/include/opencascade 2>/dev/null | tail -1 || true)"
fi
if [ -z "${OCCT_INCLUDE:-}" ] || [ ! -f "$OCCT_INCLUDE/TopoDS_Shape.hxx" ]; then
  echo "[sim] FATAL: could not find OCCT headers (TopoDS_Shape.hxx)."
  echo "[sim] Set OCCT_INCLUDE=/path/to/include/opencascade and re-run."
  exit 1
fi
echo "[sim] OCCT headers: $OCCT_INCLUDE"

INC=(-I simulation/include -I simulation/test -I forge-kernel/include -I "$OCCT_INCLUDE")

# ── platform link flag that garbage-collects unreferenced sections ──────────
case "$(uname -s)" in
  Darwin) GCFLAG="-Wl,-dead_strip" ;;
  *)      GCFLAG="-Wl,--gc-sections" ;;
esac

# ── missing-include preflight (libstdc++/CI vs Apple-clang/libc++) ──────────
if ! bash forge-kernel/test/native/check_includes.sh \
        simulation/src/*.cpp simulation/test/*.cpp >/tmp/forge_sim_incl.log 2>&1; then
  cat /tmp/forge_sim_incl.log
  echo "[sim] missing-include preflight FAILED"
  exit 1
fi
cat /tmp/forge_sim_incl.log

OBJDIR="$(mktemp -d /tmp/forge_sim_obj.XXXXXX)"
trap 'rm -rf "$OBJDIR"' EXIT
FAILED=0

# ── 1. compile each translation unit exactly once ──────────────────────────
OBJS=()
compile() {  # $1 = source, $2 = extra flags
  local src="$1"; shift
  local obj="$OBJDIR/$(echo "$src" | tr '/.' '__').o"
  # shellcheck disable=SC2086
  if ! $CXX $FLAGS "$@" "${INC[@]}" -c "$src" -o "$obj" 2>"$obj.err"; then
    echo "[sim:SRC] BUILD FAIL — $src"; cat "$obj.err"; FAILED=1; return 1
  fi
  OBJS+=("$obj")
}

for src in simulation/src/AnimationFrame.cpp \
           simulation/src/RealtimeLoop.cpp \
           simulation/src/MechanismCase.cpp \
           forge-kernel/src/MultibodyDynamics.cpp \
           forge-kernel/src/native/linalg/LinAlg.cpp ; do
  compile "$src" || true
done
# AssemblySolver: sectioned so the unreferenced OCCT-facing half can be collected.
compile forge-kernel/src/AssemblySolver.cpp -ffunction-sections -fdata-sections || true

if [ "$FAILED" -ne 0 ]; then echo "[sim] SOURCE COMPILE FAILURES — aborting"; exit 1; fi
echo "[sim] compiled ${#OBJS[@]} translation units (-Wall -Wextra clean)"

# ── 2. portable per-test timeout (coreutils `timeout` is absent on macOS) ───
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

# ── 3. build + run every gate ───────────────────────────────────────────────
RAN=0
TOTAL=0
for test in simulation/test/*_test.cpp; do
  [ -e "$test" ] || continue
  TOTAL=$((TOTAL+1))
  name="$(basename "$test" .cpp)"
  if [ -n "$ONLY" ] && [[ "$name" != *"$ONLY"* ]]; then continue; fi
  RAN=$((RAN+1))
  bin="$OBJDIR/$name"
  # shellcheck disable=SC2086
  if ! $CXX $FLAGS "${INC[@]}" "$test" "${OBJS[@]}" $GCFLAG -o "$bin" 2>"$bin.err"; then
    echo "[sim:$name] BUILD/LINK FAIL"; cat "$bin.err"; FAILED=1; continue
  fi
  rc=0
  run_with_timeout "$TEST_TIMEOUT" "$bin" || rc=$?
  if [ "$rc" -eq 124 ]; then
    echo "[sim:$name] TIMEOUT after ${TEST_TIMEOUT}s"; FAILED=1
  elif [ "$rc" -ne 0 ]; then
    echo "[sim:$name] GATE FAILED (exit $rc)"; FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then echo "[sim] FAILURES PRESENT ($RAN of $TOTAL gates run)"; exit 1; fi
if [ -n "$ONLY" ]; then
  echo "[sim] FILTERED RUN (ONLY=$ONLY): $RAN of $TOTAL gates ran and passed — NOT a full gate"
  exit 0
fi
if [ "$RAN" -ne "$TOTAL" ]; then echo "[sim] INTERNAL ERROR: ran $RAN of $TOTAL gates"; exit 1; fi
echo "[sim] ALL $TOTAL SIMULATION GATES PASS"
