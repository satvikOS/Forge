#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_brepcheck_status_probe.sh — build test/brepcheck_status_probe.cpp.
#
# It REUSES the object archive build_corpus_ab_coverage.sh produces
# (.build-corpus-ab/libforge_native_ab.a) rather than recompiling 155 native TUs
# a second time, so the probe is measuring the SAME objects the A/B measured.
# If that archive is absent this script builds it by invoking that script — it
# never silently links against something else.
#
# ★ NOT A DROP BUILD. No FORGE_*_DROP_* macro is defined here, exactly as in
#   build_corpus_ab_coverage.sh.
#
# Output: BIN=<path> on stdout. Exit 0 iff the binary built.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CXX="${CXX:-clang++}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT="/usr/local/opt/opencascade"
  else
    echo "FATAL: OCCT not found (brew install opencascade or set OCCT_ROOT)" >&2
    exit 2
  fi
fi
OCCT_INC="$OCCT/include/opencascade"
OCCT_LIB="$OCCT/lib"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"
OBJDIR="${OBJDIR:-$KERNEL/.build-corpus-ab}"
LIB="$OBJDIR/libforge_native_ab.a"
OUT="${OUT:-$OBJDIR/brepcheck_status_probe}"

if [ ! -f "$LIB" ]; then
  echo "[probe] archive missing, building it via build_corpus_ab_coverage.sh" >&2
  JOBS="${JOBS:-4}" bash "$KERNEL/test/build_corpus_ab_coverage.sh" >/dev/null || exit 1
  [ -f "$LIB" ] || { echo "[probe] archive still missing after build" >&2; exit 1; }
fi

TU="$OBJDIR/obj/brepcheck_status_probe.o"
if ! $CXX $FLAGS -I include -I "$OCCT_INC" -c test/brepcheck_status_probe.cpp -o "$TU" 2> "$OBJDIR/probe.err"; then
  echo "[probe] COMPILE FAILED:" >&2; tail -40 "$OBJDIR/probe.err" >&2; exit 1
fi

OCCT_LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
           -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
           -lTKDESTEP -lTKXSBase"
# shellcheck disable=SC2086
if ! $CXX $FLAGS -I include -I "$OCCT_INC" "$TU" "$LIB" \
     -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" $OCCT_LIBS -o "$OUT" 2> "$OBJDIR/probe.link.err"; then
  echo "[probe] LINK FAILED:" >&2; tail -40 "$OBJDIR/probe.link.err" >&2; exit 1
fi
echo "BIN=$OUT"
exit 0
