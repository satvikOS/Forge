#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_golden_corpus_measure.sh — build the golden-corpus per-model measure TU
# (test/golden_corpus_measure.cpp). Mirrors build_occt_import_test.sh's native-
# object + OCCT-link assembly, but:
#   * builds a REUSABLE binary the .mjs driver invokes once per model (not a
#     self-contained pass/fail gate),
#   * additionally links the OCCT STEP reader toolkits (TKDESTEP + TKXSBase),
#     since the carrier between FREEZE and VERIFY is a frozen STEP file.
#
# It compiles every src/native/**.cpp (OCCT-free) once, plus src/OcctImport.cpp
# WITH OCCT, then links the measure TU against the whole set + OCCT.
#
# Output: the binary path is printed on stdout as  BIN=<path>  (the .mjs reads it),
# or the script exits non-zero on a build failure. Set OUT=<path> to choose where
# the binary lands (default: a tmp file kept for the caller; the .mjs passes a
# stable path under the system tmpdir so repeated VERIFY runs reuse it).
#
# Exit 0 iff the binary built.
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
    echo "FATAL: OCCT not found (brew install opencascade or set OCCT_ROOT)" >&2; exit 2
  fi
fi
OCCT_INC="$OCCT/include/opencascade"
OCCT_LIB="$OCCT/lib"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"
JOBS="${JOBS:-$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"
OUT="${OUT:-$(mktemp -u "${TMPDIR:-/tmp}/forge_golden_measure.XXXXXX")}"
OBJDIR="$(mktemp -d "${TMPDIR:-/tmp}/forge_golden_obj.XXXXXX")"
trap 'rm -rf "$OBJDIR"' EXIT
FAIL="$OBJDIR/fail"; : > "$FAIL"

CAP=()
cap() { "$@" & CAP+=("$!"); if [ "${#CAP[@]}" -ge "$JOBS" ]; then wait "${CAP[0]}" 2>/dev/null||true; CAP=("${CAP[@]:1}"); fi; }
drain() { local p; for p in "${CAP[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null||true; done; CAP=(); }

# 1. compile every native source (OCCT-free) to a .o
OBJS=()
compile() { if ! $CXX $FLAGS -I "$INC" -c "$1" -o "$2" 2>"$2.err"; then echo "SRC FAIL: $1" >&2; tail -12 "$2.err" >&2; echo x>>"$FAIL"; fi; }
for src in src/native/*.cpp src/native/*/*.cpp; do
  [ -e "$src" ] || continue
  obj="$OBJDIR/$(echo "$src" | tr '/.' '__').o"; OBJS+=("$obj"); cap compile "$src" "$obj"
done
drain
[ -s "$FAIL" ] && { echo "[golden-measure] native source compile failed" >&2; exit 1; }

# 2. compile the importer WITH OCCT headers
IMP="$OBJDIR/OcctImport.o"
if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" -c src/OcctImport.cpp -o "$IMP" 2>"$IMP.err"; then
  echo "[golden-measure] OcctImport.cpp compile failed:" >&2; tail -30 "$IMP.err" >&2; exit 1
fi
OBJS+=("$IMP")

# 3. link the measure TU. Same OCCT set as build_occt_import_test.sh PLUS the STEP
#    reader (TKDESTEP = STEPControl_Reader + the AP203/214/242 transfer; TKXSBase =
#    the XSControl session it sits on). GProp lives in TKTopAlgo on 7.9.
OCCT_LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
           -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
           -lTKDESTEP -lTKXSBase"
# shellcheck disable=SC2086
if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" test/golden_corpus_measure.cpp "${OBJS[@]}" \
     -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" $OCCT_LIBS -o "$OUT" 2>"$OBJDIR/link.err"; then
  echo "[golden-measure] TEST LINK FAILED:" >&2; tail -40 "$OBJDIR/link.err" >&2; exit 1
fi

echo "BIN=$OUT"
exit 0
