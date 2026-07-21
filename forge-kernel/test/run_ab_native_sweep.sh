#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ab_native_sweep.sh — LIVE-OCCT A/B for the analytic swept solids.
#
# Compiles test/ab_native_sweep_occt.cpp (which calls BOTH the in-house analytic
# SolidFactory::buildPrismFromProfile / buildRevolveProfile AND OCCT's
# BRepPrimAPI_MakePrism / MakeRevol + BRepGProp) against OCCT and the pure-C++
# native kernel sources, then runs it. Exit 0 iff native volume == OCCT volume
# (1e-9) on every prism/revolve case (and native face count == OCCT for prisms).
#
# This is OUTSIDE test/native/<class>/ on purpose: the OCCT-free run_native.sh
# must never try to compile an OCCT-including translation unit. OCCT root is the
# brew default; override with OCCT_ROOT=... (matches forge-kernel/CMakeLists.txt).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT_ROOT="/usr/local/opt/opencascade"
  else
    echo "[ab-sweep] OCCT not found at $OCCT_ROOT — install with 'brew install opencascade' or set OCCT_ROOT="; exit 1
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"

CXX="${CXX:-clang++}"
INC="forge-kernel/include"
OUT="$(mktemp -d /tmp/forge_ab_sweep.XXXXXX)"
trap 'rm -rf "$OUT"' EXIT

# The A/B TU needs the analytic B-rep + mass props; compile the whole native src
# set (pure C++20, OCCT-free) alongside it so every native symbol resolves — same
# discipline as run_native.sh, just with OCCT added for the OCCT half of the A/B.
SRCS=(forge-kernel/src/native/*.cpp forge-kernel/src/native/*/*.cpp)

# OCCT toolkits used by the A/B: primitives (TKPrim), face/wire builders + explorer
# (TKBRep/TKTopAlgo), volume props (TKGeomAlgo/GProp), geometry (TKMath/TKG3d/...).
OCCT_LIBS=(-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo
           -lTKBRep -lTKTopAlgo -lTKShHealing -lTKPrim)

echo "[ab-sweep] OCCT $OCCT_ROOT"
if ! "$CXX" -std=c++20 -O1 -I "$INC" -I "$OCCT_INC" \
      forge-kernel/test/ab_native_sweep_occt.cpp "${SRCS[@]}" \
      -L "$OCCT_LIB" "${OCCT_LIBS[@]}" -o "$OUT/ab_sweep" 2>"$OUT/build.err"; then
  echo "[ab-sweep] BUILD/LINK FAIL"; tail -30 "$OUT/build.err"; exit 1
fi

DYLD_LIBRARY_PATH="$OCCT_LIB" "$OUT/ab_sweep"
rc=$?
[ "$rc" -eq 0 ] && echo "[ab-sweep] PASS" || echo "[ab-sweep] FAIL (exit $rc)"
exit "$rc"
