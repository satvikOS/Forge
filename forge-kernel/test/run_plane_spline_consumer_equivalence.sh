#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_plane_spline_consumer_equivalence.sh — build and run the consumer
# faithfulness experiment behind the SURFACE-KIND EQUIVALENCE rule.
#
# WHAT IT DECIDES. The corpus flip gate reds FILLING on 407 of 407 pairs that
# match on volume, area, centre of mass, all six bbox bounds and every
# face/edge/vertex/shell/solid count and differ ONLY in surface kind — native
# returns an exact Geom_Plane where BRepOffsetAPI_MakeFilling returns a
# Geom_BSplineSurface over the same boundary. Before a gate may treat those as
# interchangeable, somebody has to establish that they ARE, in the contexts that
# consume the face. This binary measures that: mass properties, booleans,
# offsets, STEP export and tessellation, on five boundary shapes, and it proves
# in the same run that the rule cannot be widened into "ignore surface kind" —
# every quadric is put through BRepBuilderAPI_NurbsConvert and the certificate
# must REFUSE each one.
#
# Compiled the way the other A/B harnesses are: only the sources the test
# actually calls, so it runs in CI in seconds rather than rebuilding the native
# tree. Exit 0 iff every assertion holds.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 2

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  for c in /usr/local/opt/opencascade /usr /usr/local; do
    if [ -e "$c/include/opencascade/Standard_Version.hxx" ]; then OCCT_ROOT="$c"; break; fi
  done
fi
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  echo "FATAL: OCCT not found (set OCCT_ROOT)" >&2; exit 2
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"

CXX="${CXX:-clang++}"
INC="forge-kernel/include"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/forge_psce.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

# TKOffset is linked HERE and only here, because the experiment's OCCT half
# calls BRepOffsetAPI_MakeFilling and MakeThickSolid on purpose. TKDESTEP and
# TKXSBase are the STEP consumer; TKMesh is the tessellation consumer.
OCCT_LIBS=(-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo
           -lTKBRep -lTKTopAlgo -lTKShHealing -lTKPrim -lTKOffset -lTKBO -lTKBool
           -lTKFillet -lTKDESTEP -lTKXSBase -lTKMesh)

echo "[psce] OCCT $OCCT_ROOT"
# -Wno-deprecated-declarations: OCCT 7.9's own GeomPlate/NCollection headers call
# sprintf(3). That is OCCT's code, not ours.
if ! "$CXX" -std=c++20 -O1 -Wall -Wextra -Wno-deprecated-declarations \
      -DFORGE_NATIVE_BREP=1 \
      -I "$INC" -I "$OCCT_INC" -I forge-kernel/test \
      forge-kernel/test/plane_spline_consumer_equivalence.cpp \
      forge-kernel/src/native/brep/NativeFilling.cpp \
      forge-kernel/src/OcctPrimBuilder.cpp \
      -L "$OCCT_LIB" "${OCCT_LIBS[@]}" -o "$OUT/psce" 2>"$OUT/build.err"; then
  echo "[psce] BUILD/LINK FAIL"; sed -n '1,80p' "$OUT/build.err"; exit 1
fi

# THE CERTIFICATE HEADER IS SHARED WITH THE GATE, so it is held to the same bar
# the engines are: compiled alone, -Werror, no waiver. A predicate the gate
# depends on must not be the one translation unit nobody warns about.
cat > "$OUT/cert_only.cpp" <<'CERTTU'
#include "planar_surface_certificate.hpp"
// Force instantiation so the header is not merely parsed.
bool forge_cert_probe(const TopoDS_Face& f) {
    return forge::planarcert::certify(f, 1e-6, 1e-6).planar;
}
CERTTU
if ! "$CXX" -std=c++20 -O1 -Wall -Wextra -Werror -Wno-deprecated-declarations \
      -I "$INC" -I "$OCCT_INC" -I forge-kernel/test \
      -c "$OUT/cert_only.cpp" -o "$OUT/cert_only.o" 2>"$OUT/cert.err"; then
  echo "[psce] the shared certificate header FAILS a -Werror compile:"
  sed -n '1,60p' "$OUT/cert.err"; exit 1
fi
echo "[psce] planar_surface_certificate.hpp compiles clean under -Werror"

DYLD_LIBRARY_PATH="$OCCT_LIB" LD_LIBRARY_PATH="$OCCT_LIB" "$OUT/psce" --tmp="$OUT"
rc=$?
[ "$rc" -eq 0 ] && echo "[psce] PASS" || echo "[psce] FAIL (exit $rc)"
exit "$rc"
