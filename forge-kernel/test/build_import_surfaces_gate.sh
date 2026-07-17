#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_import_surfaces_gate.sh — build + run the importOcctSolid ANALYTIC-SURFACE
# ATTACHMENT A/B gate (test/native_vs_occt_import_surfaces.cpp). Proves the OCCT->
# native importer attaches a native analytic brep::Surface (Plane/Cylinder/Cone/
# Sphere/Torus) to every imported quadric face so analyticFaceInventory reports the
# SAME canonical faces as OCCT, with radius/axis/origin A/B to ~1e-9 (the K4/TKHLR
# curved-drop keystone: a re-imported cylinder is a cylinder, not a facet bag).
#
# LINKS OCCT (the bridge oracle) => NOT part of test/native/run_native.sh (pure
# native). Sibling driver of build_occt_import_test.sh; compiles every
# src/native/**.cpp once (OCCT-free), plus src/OcctImport.cpp WITH OCCT, then links
# the gate against the whole set + OCCT.
#
# Exit 0 iff the A/B gate prints "0 failed".
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL"

CXX="${CXX:-clang++}"
INC="include"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT="/usr/local/opt/opencascade"
  else
    echo "FATAL: OCCT not found (brew install opencascade or set OCCT_ROOT)"; exit 2
  fi
fi
OCCT_INC="$OCCT/include/opencascade"
OCCT_LIB="$OCCT/lib"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"
JOBS="${JOBS:-$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"
OBJDIR="$(mktemp -d /tmp/forge_import_surfaces.XXXXXX)"
trap 'rm -rf "$OBJDIR"' EXIT
FAIL="$OBJDIR/fail"; : > "$FAIL"

CAP=()
cap() { "$@" & CAP+=("$!"); if [ "${#CAP[@]}" -ge "$JOBS" ]; then wait "${CAP[0]}" 2>/dev/null||true; CAP=("${CAP[@]:1}"); fi; }
drain() { local p; for p in "${CAP[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null||true; done; CAP=(); }

# 1. compile every native source (OCCT-free) to a .o
OBJS=()
compile() { if ! $CXX $FLAGS -I "$INC" -c "$1" -o "$2" 2>"$2.err"; then echo "SRC FAIL: $1"; tail -12 "$2.err"; echo x>>"$FAIL"; fi; }
for src in src/native/*.cpp src/native/*/*.cpp; do
  [ -e "$src" ] || continue
  obj="$OBJDIR/$(echo "$src" | tr '/.' '__').o"; OBJS+=("$obj"); cap compile "$src" "$obj"
done
drain
[ -s "$FAIL" ] && { echo "[import-surfaces] native source compile failed"; exit 1; }

# 2. compile the importer WITH OCCT headers
IMP="$OBJDIR/OcctImport.o"
if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" -c src/OcctImport.cpp -o "$IMP" 2>"$IMP.err"; then
  echo "[import-surfaces] OcctImport.cpp compile failed:"; tail -30 "$IMP.err"; exit 1
fi
OBJS+=("$IMP")

# 3. link + run the A/B test (OCCT libs; TKBO/TKBool for the boolean-cut bore fixture).
OCCT_LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing"
BIN="$OBJDIR/native_vs_occt_import_surfaces"
# shellcheck disable=SC2086
if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" test/native_vs_occt_import_surfaces.cpp "${OBJS[@]}" \
     -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" $OCCT_LIBS -o "$BIN" 2>"$BIN.err"; then
  echo "[import-surfaces] TEST LINK FAILED:"; tail -40 "$BIN.err"; exit 1
fi
"$BIN"; RC=$?
exit $RC
