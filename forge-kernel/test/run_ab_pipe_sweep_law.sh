#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ab_pipe_sweep_law.sh — build + run the family E/F SWEEP-LAW probe.
#
# Answers, with evidence rather than assertion, the three questions
# reports/TKOFFSET_EF_PARITY_AND_THE_WRONG_GATE.md left open about the constant
# 2/(1+cos 30 deg) = 1.071797 that separates the native and OCCT arms of
# FORGE_PIPE_DROP_NATIVE and FORGE_PIPESHELL_DROP_NATIVE on 599 of 599 parts:
#
#   Q1  can family E's OCCT arm (BRepOffsetAPI_MakePipe) be CONFIGURED to the
#       mitre, the way family F's can with SetTransitionMode(RightCorner)?
#   Q2  why is family F's ratio a SPREAD where family E's is a constant?
#   Q3  does the mitre closed form really require the section centroid on the
#       spine start, as NativeLoftPipe.cpp's banner states?
#
# and decides WHICH ARM IS CORRECT for a swept solid by measuring the defining
# property of a sweep — the cross-section perpendicular to the spine — rather
# than by appeal to either engine.
#
# Same three-TU assembly as run_ab_pipeshell_transition.sh, plus TKPrim/TKBO for
# the section probe's half-space clip.  OCCT root is the brew default; override
# with OCCT_ROOT=.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT_ROOT="/usr/local/opt/opencascade"
  else
    echo "[ab-pipe-law] OCCT not found at $OCCT_ROOT — 'brew install opencascade' or set OCCT_ROOT="
    exit 1
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"
CXX="${CXX:-clang++}"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/forge_ab_pipe_law.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

# OcctPrimBuilder.cpp is linked because NativeLoftPipe.cpp calls forge::occtPrism
# and forge::occtCylinderSolid.  Without it this harness dies at link and its
# assertions never run at all — a gate that cannot build cannot fail.
OCCT_LIBS=(-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo
           -lTKBRep -lTKTopAlgo -lTKShHealing -lTKPrim -lTKOffset -lTKBO -lTKBool)

echo "[ab-pipe-law] OCCT $OCCT_ROOT"
if ! "$CXX" -std=c++20 -O1 -Wall -Wextra -DFORGE_NATIVE_BREP=1 \
      -I forge-kernel/include -I "$OCCT_INC" \
      forge-kernel/test/ab_pipe_sweep_law.cpp \
      forge-kernel/src/native/brep/NativeLoftPipe.cpp \
      forge-kernel/src/native/brep/NativeShapeHeal.cpp \
      forge-kernel/src/OcctPrimBuilder.cpp \
      -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" "${OCCT_LIBS[@]}" \
      -o "$OUT/ab_pipe_law" 2>"$OUT/build.err"; then
  echo "[ab-pipe-law] BUILD/LINK FAIL"; sed -n '1,80p' "$OUT/build.err"; exit 1
fi

"$OUT/ab_pipe_law"
rc=$?
if [ "$rc" = "0" ]; then echo "[ab-pipe-law] PASS"; else echo "[ab-pipe-law] FAIL (exit $rc)"; fi
exit "$rc"
