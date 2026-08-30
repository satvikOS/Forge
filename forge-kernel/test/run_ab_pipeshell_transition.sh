#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ab_pipeshell_transition.sh — build + run the family-F transition-mode A/B.
#
# Answers one question with evidence: the 600-part corpus A/B found native
# PIPESHELL disagreeing with OCCT on 309 of 309 shared successes, at a volume
# ratio of 1.071796769 = 1/cos^2(15 deg). This harness shows that ratio is the
# spine's 30-degree TURN ANGLE and not a wall-thickness sign (there is no wall),
# that native implements the MITRE and OCCT's DEFAULT transition implements a
# TRANSLATION, and that OCCT reproduces the native solid exactly once asked for
# BRepBuilderAPI_RightCorner.
#
# Same three-TU assembly as run_ab_native_loftpipe.sh, plus TKBO/TKBool because
# the section-area oracle here is a half-space boolean.
# OCCT root is the brew default; override with OCCT_ROOT=.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT_ROOT="/usr/local/opt/opencascade"
  else
    echo "[ab-ps-transition] OCCT not found at $OCCT_ROOT — 'brew install opencascade' or set OCCT_ROOT="
    exit 1
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"
CXX="${CXX:-clang++}"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/forge_ab_ps_transition.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

# OcctPrimBuilder.cpp is linked because NativeLoftPipe.cpp calls forge::occtPrism
# and forge::occtCylinderSolid. Without it this harness dies at link and its
# assertions never run at all — a gate that cannot build cannot fail.
OCCT_LIBS=(-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo
           -lTKBRep -lTKTopAlgo -lTKShHealing -lTKPrim -lTKOffset -lTKBO -lTKBool)

echo "[ab-ps-transition] OCCT $OCCT_ROOT"
if ! "$CXX" -std=c++20 -O1 -Wall -Wextra -DFORGE_NATIVE_BREP=1 \
      -I forge-kernel/include -I "$OCCT_INC" \
      forge-kernel/test/ab_pipeshell_transition_occt.cpp \
      forge-kernel/src/native/brep/NativeLoftPipe.cpp \
      forge-kernel/src/native/brep/NativeShapeHeal.cpp \
      forge-kernel/src/OcctPrimBuilder.cpp \
      -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" "${OCCT_LIBS[@]}" \
      -o "$OUT/ab_ps_transition" 2>"$OUT/build.err"; then
  echo "[ab-ps-transition] BUILD/LINK FAIL"; sed -n '1,80p' "$OUT/build.err"; exit 1
fi

"$OUT/ab_ps_transition"
rc=$?
if [ "$rc" = "0" ]; then echo "[ab-ps-transition] PASS"; else echo "[ab-ps-transition] FAIL (exit $rc)"; fi
exit "$rc"
