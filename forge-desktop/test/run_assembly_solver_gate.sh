#!/usr/bin/env bash
# run_assembly_solver_gate.sh -- the assembly acceptance gate, against the SHIPPED
# solver library.
#
# WHAT IT DOES, IN ORDER, AND EVERY STEP IS RED IF IT CANNOT RUN
#   1. builds libforge_asmsolver from third_party/freecad-derived/assembly-solver
#      with its own CMakeLists -- the build a recipient of the LGPL source runs --
#      and runs the library's self-test;
#   2. proves the library is a SHARED object and that it is linked DYNAMICALLY:
#      the gate binary carries a load command naming it and DEFINES none of the
#      solver's own symbols (MbD::*). A statically-copied solver would pass every
#      behavioural check and break the licence, so behaviour alone is not enough;
#   3. compiles forge::ui, Forge's adapter (forge-desktop/src/AssemblySolverHost.cpp)
#      and forge-desktop/test/assembly_solver_gate.cpp, and runs it: GREEN required;
#   4. rebuilds the gate once per mutation (FORGE_ASM_GATE_MUTATION = 1..3) and
#      requires EVERY mutant to go RED. A gate that cannot fail is decoration.
#
# No OCCT, no SDL, no Vulkan, no ImGui: this runs on the plain ubuntu runner and on
# a Mac alike. Parallelism comes from forge-nproc when it exists.
#
# Exit codes: 0 GREEN, 1 RED (a check failed or a mutant survived), 3 RED (could
# not build -- a check that could not run is not a check that passed).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || {
  echo "[assembly-gate] cannot resolve the repo root"; exit 3; }
[ -n "$ROOT" ] || { echo "[assembly-gate] repo root resolved to the empty string"; exit 3; }
cd "$ROOT" || { echo "[assembly-gate] cannot enter $ROOT"; exit 3; }

CXX="${CXX:-clang++}"
if command -v forge-nproc >/dev/null 2>&1; then
  JOBS="${JOBS:-$(forge-nproc)}"
else
  JOBS="${JOBS:-$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 2 )}"
fi
MUTATIONS=3

WORK="$(mktemp -d "${TMPDIR:-/tmp}/assembly_gate.XXXXXX")" || { echo "[assembly-gate] mktemp failed"; exit 3; }
cleanup() {
  rm -rf "$WORK"
  [ -d "$WORK" ] && echo "[assembly-gate] WARNING: kept $WORK -- rm -rf did not remove it"
}
trap cleanup EXIT

# ── 1. the library, built the way a recipient builds it ──────────────────────
ASM="$WORK/asmsolver"
if ! cmake -S third_party/freecad-derived/assembly-solver -B "$ASM" -DCMAKE_BUILD_TYPE=Release \
       -DCMAKE_CXX_COMPILER="$CXX" >"$WORK/asm_cfg.log" 2>&1; then
  tail -30 "$WORK/asm_cfg.log"; echo "[assembly-gate] the solver library did not CONFIGURE. RED."; exit 3
fi
if ! cmake --build "$ASM" -j "$JOBS" >"$WORK/asm_build.log" 2>&1; then
  grep -E "error" "$WORK/asm_build.log" | head -20; tail -10 "$WORK/asm_build.log"
  echo "[assembly-gate] the solver library did not BUILD. RED."; exit 3
fi
LIBFILE=""
for cand in "$ASM/libforge_asmsolver.dylib" "$ASM/libforge_asmsolver.so"; do
  [ -f "$cand" ] && { LIBFILE="$cand"; break; }
done
[ -n "$LIBFILE" ] || { echo "[assembly-gate] no SHARED libforge_asmsolver was produced in $ASM. RED."; exit 3; }
echo "[assembly-gate] library: $LIBFILE"
if ! "$ASM/asmsolver_selftest" >"$WORK/selftest.log" 2>&1; then
  cat "$WORK/selftest.log"; echo "[assembly-gate] the library's own self-test FAILED. RED."; exit 1
fi
tail -1 "$WORK/selftest.log"

# ── 3a. forge::ui + the adapter, compiled once ─────────────────────────────────
FLAGS=(-std=c++20 -O1 -Wall -Wextra -Werror -I ui/include -I ui/test -I forge-desktop/src
       -I third_party/freecad-derived/assembly-solver/include)
OBJ="$WORK/obj"; mkdir -p "$OBJ"
FAILMARK="$WORK/failmark"; : > "$FAILMARK"
PIDS=()
compile() {  # compile <src> <obj>
  if ! "$CXX" "${FLAGS[@]}" -c "$1" -o "$2" 2>"$2.err"; then
    echo "[assembly-gate] BUILD FAIL -- $1"; tail -15 "$2.err"; echo "$1" >> "$FAILMARK"
  fi
}
SRCS=(ui/src/*.cpp forge-desktop/src/AssemblySolverHost.cpp)
OBJS=()
for src in "${SRCS[@]}"; do
  o="$OBJ/$(echo "$src" | tr '/.' '__').o"
  OBJS+=("$o")
  compile "$src" "$o" &
  PIDS+=("$!")
  if [ "${#PIDS[@]}" -ge "$JOBS" ]; then wait "${PIDS[0]}"; PIDS=("${PIDS[@]:1}"); fi
done
for p in "${PIDS[@]:-}"; do [ -n "$p" ] && wait "$p"; done
[ -s "$FAILMARK" ] && { echo "[assembly-gate] forge::ui or the adapter did not compile. RED."; exit 3; }
echo "[assembly-gate] compiled ${#OBJS[@]} objects"

build_gate() {  # build_gate <mutation> <out>
  "$CXX" "${FLAGS[@]}" -DFORGE_ASM_GATE_MUTATION="$1" forge-desktop/test/assembly_solver_gate.cpp \
    "${OBJS[@]}" -L "$ASM" -lforge_asmsolver -Wl,-rpath,"$ASM" -o "$2" 2>"$2.err"
}

# ── 3b. the gate ───────────────────────────────────────────────────────────────
GATE="$WORK/assembly_solver_gate"
if ! build_gate 0 "$GATE"; then
  tail -30 "$GATE.err"; echo "[assembly-gate] the gate did not BUILD. RED."; exit 3
fi

# ── 2. dynamic, not static ─────────────────────────────────────────────────────
LIBBASE="$(basename "$LIBFILE")"
if command -v otool >/dev/null 2>&1; then
  LINKS="$(otool -L "$GATE" | tail -n +2)"
  echo "[assembly-gate] otool -L of the gate:"; echo "$LINKS" | grep -E "forge_asmsolver" | sed 's/^/    /'
  echo "$LINKS" | grep -q "@rpath/$LIBBASE" || {
    echo "[assembly-gate] the gate does not load @rpath/$LIBBASE dynamically. RED."; exit 1; }
  otool -D "$LIBFILE" | tail -n +2 | grep -q "@rpath/$LIBBASE" || {
    echo "[assembly-gate] the library's install name is not @rpath/$LIBBASE. RED."; exit 1; }
else
  ldd "$GATE" | grep -q "$LIBBASE" || { echo "[assembly-gate] the gate does not load $LIBBASE dynamically. RED."; exit 1; }
fi
# The solver's own classes live in namespace MbD. DEFINED in the gate means copied in.
DEFINED_MBD="$(nm -C "$GATE" 2>/dev/null | awk '$2 ~ /^[TtDdBbSs]$/ {print}' | grep -c "MbD::" || true)"
if [ "${DEFINED_MBD:-0}" -ne 0 ]; then
  echo "[assembly-gate] the gate binary DEFINES $DEFINED_MBD solver symbols: the LGPL code was linked in statically. RED."
  exit 1
fi
echo "[assembly-gate] dynamic: the gate loads $LIBBASE and defines 0 MbD:: symbols"

if ! "$GATE"; then
  echo "[assembly-gate] RED -- the acceptance gate failed"; exit 1
fi

# ── 4. every mutant must go red ────────────────────────────────────────────────
CAUGHT=0
for m in $(seq 1 "$MUTATIONS"); do
  MBIN="$WORK/assembly_solver_gate_m$m"
  if ! build_gate "$m" "$MBIN"; then
    tail -20 "$MBIN.err"; echo "[assembly-gate] mutant $m did not BUILD. RED."; exit 3
  fi
  if "$MBIN" >"$WORK/m$m.log" 2>&1; then
    echo "[assembly-gate] mutant $m SURVIVED -- the gate passed with the solver broken. RED."
    tail -5 "$WORK/m$m.log"
    exit 1
  fi
  CAUGHT=$((CAUGHT + 1))
  echo "[assembly-gate] mutant $m caught: $(grep -c 'FAIL' "$WORK/m$m.log") failed checks"
done
[ "$CAUGHT" -eq "$MUTATIONS" ] || { echo "[assembly-gate] caught $CAUGHT of $MUTATIONS mutants. RED."; exit 1; }
echo "[assembly-gate] GREEN -- acceptance holds against the shipped library, linked dynamically, and all $MUTATIONS mutants were caught"
exit 0
