#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_thermal_convection_gate.sh — T-393.
#
# Builds and runs test/thermal_convection_gate.cpp against the CONVECTION (Robin)
# term of fea::solveThermal and fea::solveTransientThermal, checked against
# closed forms (see the gate's header for the six cases).
#
# The code under test is forge-kernel/src/FeaExtras.cpp, compiled HERE and
# linked AHEAD of libforge_kernel_core.dylib: the executable's own definitions
# of solveThermal / solveTransientThermal are the ones its calls bind to, so a
# mutant of that one file is tested without rebuilding the kernel. Everything
# else (linear algebra, the rest of forge::fea) comes from the dylib.
#
# ── THEN IT PROVES THE GATE CAN FAIL ────────────────────────────────────────
# Each mutant below edits a temporary COPY of FeaExtras.cpp (never the tree) and
# must turn the gate RED. A mutant whose pattern is not found, or that does not
# compile, is a FAILURE OF THIS SCRIPT, not a kill.
#
#   M1  each corner gets HALF a brick face's area instead of a quarter
#   M2  the steady path forgets the h T_inf load (the fluid's temperature)
#   M3  the transient path forgets the h T_inf load
#   M4  a brick face counts as on the side when ANY corner is, not all four
#   M5  the side's bit is the OPPOSITE side's (faceId ^ 1)
#   M6  only the first three brick-face directions are searched (the +x, -x,
#       -y faces): the +-z faces the fin convects through are never found
#
# Usage: BUILD=<kernel build dir with libforge_kernel_core.dylib> \
#          bash forge-kernel/test/run_thermal_convection_gate.sh [--no-mutations]
#        BASE_REF=<git ref> additionally builds the gate against THAT ref's
#        FeaExtras.cpp and requires it RED (the failing-first arm; skipped when
#        the ref is absent, e.g. on a shallow CI clone).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2
K="$ROOT/forge-kernel"
BUILD="${BUILD:-$K/build-app}"
case "$BUILD" in /*) ;; *) BUILD="$ROOT/$BUILD" ;; esac
CXX="${CXX:-clang++}"
DO_MUT=1
[ "${1:-}" = "--no-mutations" ] && DO_MUT=0

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
[ -d "$OCCT_ROOT/lib" ] || OCCT_ROOT="/usr/local/opt/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"

DYLIB="$BUILD/libforge_kernel_core.dylib"
if [ ! -e "$DYLIB" ]; then
  echo "[convection] FATAL: $DYLIB missing -- cmake --build $BUILD --target forge_kernel_core" >&2
  exit 2
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/forge_convection.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
# The gate is first-party test code: -Wall -Wextra -Werror. FeaExtras.cpp is
# compiled the way the kernel library compiles it (warnings on, NOT -Werror):
# it includes TransientThermal.hpp, whose unused private field dt_ is a
# -Wunused-private-field the kernel build does not promote, and that header is
# not this gate's to change.
FLAGS=(-std=c++20 -O2 -Wall -Wextra -Werror -I "$K/include")
SRCFLAGS=(-std=c++20 -O2 -Wall -I "$K/include")

if ! "$CXX" "${FLAGS[@]}" -c "$K/test/thermal_convection_gate.cpp" -o "$WORK/gate.o" \
     2> "$WORK/gate.err"; then
  echo "[convection] the gate does not COMPILE:"; tail -30 "$WORK/gate.err"; exit 1
fi

# build <FeaExtras.cpp variant> <binary> -> 0 built, 1 not
build() {
  "$CXX" "${SRCFLAGS[@]}" -c "$1" -o "$2.o" 2> "$2.err" || return 1
  "$CXX" "$WORK/gate.o" "$2.o" -o "$2" "$DYLIB" -Wl,-rpath,"$BUILD" \
      -Wl,-rpath,"$OCCT_LIB" 2>> "$2.err" || return 1
  return 0
}

echo "[convection] kernel $DYLIB"
if ! build "$K/src/FeaExtras.cpp" "$WORK/clean"; then
  echo "[convection] BUILD/LINK FAIL:"; tail -30 "$WORK/clean.err"; exit 1
fi
if ! "$WORK/clean"; then
  echo "[convection] RED -- the gate fails on the tree"; exit 1
fi

if [ -n "${BASE_REF:-}" ]; then
  if git -C "$ROOT" show "$BASE_REF:forge-kernel/src/FeaExtras.cpp" > "$WORK/base.cpp" 2>/dev/null; then
    if ! build "$WORK/base.cpp" "$WORK/base"; then
      echo "[convection] the $BASE_REF FeaExtras.cpp does not build against this tree's headers"; exit 1
    fi
    if "$WORK/base" > "$WORK/base.out" 2>&1; then
      echo "[convection] FAILING-FIRST ARM GREEN: $BASE_REF already passes -- the gate sees nothing"; exit 1
    fi
    echo "[convection] failing-first: $BASE_REF FeaExtras.cpp is RED ($(grep -c '  FAIL' "$WORK/base.out") checks failed)"
    grep '  FAIL' "$WORK/base.out" | head -6
  else
    echo "[convection] BASE_REF=$BASE_REF not available here -- failing-first arm skipped"
  fi
fi

[ "$DO_MUT" -eq 1 ] || { echo "[convection] GREEN (mutations skipped)"; exit 0; }

# mutant <n> <perl substitution, applied ONCE to a copy> <description>
BAD=0
mutant() {
  local n="$1" expr="$2" what="$3"
  local src="$WORK/m$n.cpp"
  cp "$K/src/FeaExtras.cpp" "$src"
  perl -0pi -e "$expr" "$src"
  if cmp -s "$K/src/FeaExtras.cpp" "$src"; then
    echo "[convection] M$n DID NOT APPLY -- the mutant's pattern is gone ($what)"; BAD=1; return
  fi
  if ! build "$src" "$WORK/m$n"; then
    echo "[convection] M$n NOBUILD -- not a kill ($what)"; tail -5 "$WORK/m$n.err"; BAD=1; return
  fi
  if "$WORK/m$n" > "$WORK/m$n.out" 2>&1; then
    echo "[convection] M$n STAYED GREEN -- $what"; BAD=1
  else
    echo "[convection] M$n: RED ($(grep -c '  FAIL' "$WORK/m$n.out") checks failed) <- $what"
  fi
}
mutant 1 's/area\[q\[c\]\] \+= 0\.25 \* a;/area[q[c]] += 0.5 * a;/' \
  "each corner gets half a brick face's area"
mutant 2 's/f\[i\] \+= c\.h \* c\.Tinf \* nodeArea\[i\];/f[i] += 0.0 * c.Tinf * nodeArea[i];/' \
  "the steady path forgets h T_inf"
mutant 3 's/F0\[i\] \+= c\.h \* c\.Tinf \* nodeArea\[i\];/F0[i] += 0.0 * c.Tinf * nodeArea[i];/' \
  "the transient path forgets h T_inf"
mutant 4 's/bool onSide = true;/bool onSide = false;/; s/\(mesh\.nodeToFace\[q\[c\]\] & bit\) == 0u\) onSide = false;/(mesh.nodeToFace[q[c]] \& bit) != 0u) onSide = true;/' \
  "a face counts when ANY corner is on the side"
mutant 5 's/const std::uint32_t bit = 1u << faceId;/const std::uint32_t bit = 1u << (faceId ^ 1u);/' \
  "the opposite side's bit"
mutant 6 's/for \(int f = 0; f < 6; \+\+f\) \{\n            std::uint32_t q\[4\];/for (int f = 0; f < 3; ++f) {\n            std::uint32_t q[4];/' \
  "only three of the six brick-face directions are searched"

if [ "$BAD" -ne 0 ]; then echo "[convection] RED -- a mutant was not killed"; exit 1; fi
echo "[convection] GREEN -- gate passes and all 6 mutants proved red"
