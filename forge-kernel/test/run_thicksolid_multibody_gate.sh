#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_thicksolid_multibody_gate.sh — build + run test/thicksolid_multibody_gate.cpp.
#
# Links the SAME archive test/build_corpus_ab_coverage.sh produces, so this gate
# and the 600-part coverage A/B necessarily measure the same engine objects; a
# gate built from a different tree than the number it guards has already cost
# this repo one discarded full-corpus run.
#
# The archive is rebuilt (incrementally) first, so the gate can never run against
# a stale object — and the BUILD STATUS IS READ FROM THE COMPILER, not from a
# pipeline, because a failed -Werror build leaves the old binary on disk and the
# gate would then "pass" by testing the previous engine.
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

OBJDIR="${OBJDIR:-$KERNEL/.build-corpus-ab}"
LIB="$OBJDIR/libforge_native_ab.a"
OUT="${OUT:-$OBJDIR/thicksolid_multibody_gate}"

if [ "${SKIP_ARCHIVE:-0}" != "1" ]; then
  bash "$KERNEL/test/build_corpus_ab_coverage.sh" >/dev/null || {
    echo "[multibody-gate] the shared archive failed to build" >&2; exit 1; }
fi
[ -f "$LIB" ] || { echo "FATAL: archive missing: $LIB" >&2; exit 2; }

# Remove any previous binary FIRST: if the compile then fails, the gate cannot
# silently run a stale one.
rm -f "$OUT"

if ! $CXX -std=c++20 -O2 -DFORGE_NATIVE_BREP \
     -I include -I "$OCCT/include/opencascade" \
     test/thicksolid_multibody_gate.cpp "$LIB" \
     -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" \
     -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
     -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
     -lTKDESTEP -lTKXSBase \
     -o "$OUT" 2> "$OBJDIR/multibody_gate_build.err"; then
  echo "[multibody-gate] BUILD FAILED:" >&2
  tail -40 "$OBJDIR/multibody_gate_build.err" >&2
  exit 1
fi
[ -x "$OUT" ] || { echo "[multibody-gate] no binary after a successful compile" >&2; exit 1; }

"$OUT"
rc=$?
exit $rc
