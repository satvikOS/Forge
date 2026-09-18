#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_multi_solid_import_gate.sh — build and run the T-152 multi-solid import gate.
#
# Compiles test/multi_solid_import_gate.cpp against the SHIPPED kernel library
# (build-app/libforge_kernel_core.dylib) plus OCCT and runs it.
#
# The fixtures are built IN CODE from OCCT primitives, so this needs NO corpus and
# runs anywhere OCCT is present. If the 600-part gold corpus happens to be on the
# box, the real multi-solid parts named in T-152 are measured too — ho1 (2 solids),
# ho1005 (3 solids) and the single-solid control ho1191.
#
#   usage: test/run_multi_solid_import_gate.sh [PROBES]
#   env:   CORPUS=<dir>   (default: the gold corpus; skipped when absent)
#          NO_CORPUS=1    (never touch the corpus, even if it is present)
#          BUILD=<dir>    (default forge-kernel/build-app)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KERNEL="$ROOT/forge-kernel"
BUILD="${BUILD:-$KERNEL/build-app}"
cd "$ROOT"
# An rpath must be absolute, so a relative BUILD= (which CI passes) is resolved here.
case "$BUILD" in /*) ;; *) BUILD="$ROOT/$BUILD" ;; esac

PROBES="${1:-150}"
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT_ROOT="/usr/local/opt/opencascade"
  else
    echo "[ms-gate] FATAL: OCCT not found at $OCCT_ROOT — set OCCT_ROOT=" >&2; exit 2
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"

DYLIB="$BUILD/libforge_kernel_core.dylib"
if [ ! -e "$DYLIB" ]; then
  echo "[ms-gate] FATAL: $DYLIB missing — cmake --build $BUILD --target forge_kernel_core" >&2
  exit 2
fi

OUTDIR="${OUTDIR:-$KERNEL/.build-multi-solid-import}"
mkdir -p "$OUTDIR"
BIN="$OUTDIR/multi_solid_import_gate"
CXX="${CXX:-clang++}"

echo "[ms-gate] OCCT   $OCCT_ROOT"
echo "[ms-gate] kernel $DYLIB"

OCCT_LIBS=(-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo
           -lTKBRep -lTKTopAlgo -lTKPrim -lTKShHealing -lTKBO -lTKBool
           -lTKDESTEP -lTKXSBase)

if ! "$CXX" -std=gnu++20 -O2 -Wall -Wextra -Wno-deprecated-declarations \
      -DFORGE_NATIVE_BREP=1 \
      -I "$KERNEL/include" -I "$OCCT_INC" \
      "$KERNEL/test/multi_solid_import_gate.cpp" \
      -o "$BIN" \
      "$DYLIB" -Wl,-rpath,"$BUILD" \
      -L "$OCCT_LIB" "${OCCT_LIBS[@]}" -Wl,-rpath,"$OCCT_LIB" \
      2>"$OUTDIR/build.err"; then
  echo "[ms-gate] BUILD/LINK FAIL"; sed -n '1,120p' "$OUTDIR/build.err"; exit 1
fi
echo "[ms-gate] built  $BIN"

PARTS=()
if [ "${NO_CORPUS:-0}" != "1" ] && [ -d "$CORPUS" ]; then
  for p in ho1 ho1005 ho1191; do
    [ -e "$CORPUS/$p.step" ] && PARTS+=("$CORPUS/$p.step")
  done
  echo "[ms-gate] corpus ${#PARTS[@]} named part(s) from $CORPUS"
else
  echo "[ms-gate] corpus absent or disabled — built-in fixtures only (this is the CI path)"
fi

"$BIN" --probes "$PROBES" "${PARTS[@]+"${PARTS[@]}"}"
rc=$?
echo "[ms-gate] exit $rc"
exit $rc
