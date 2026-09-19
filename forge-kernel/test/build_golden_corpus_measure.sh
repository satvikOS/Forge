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
# ── THE NATIVE PASS MUST NOT DEFINE FORGE_NATIVE_BREP (T-154) ────────────────
# The native sweep is compiled OCCT-free, "like run_native.sh", and run_native.sh
# uses exactly `-std=c++20 -O2`. With -DFORGE_NATIVE_BREP the OCCT-bridge half of
# src/native (18 of 156 sources) switches on and the pass cannot compile at all —
# and with the guard ON it cannot LINK either, because that code calls the bridge
# layer this script does not compile. Full derivation in build_occt_import_test.sh.
# The OCCT passes below keep the define (src/OcctImport.cpp is inside it).
# Step 1b is the positive control that keeps this pass from being green over an
# EMPTY translation unit.
NATIVE_FLAGS="-std=c++20 -O2"
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
compile() { if ! $CXX $NATIVE_FLAGS -I "$INC" -c "$1" -o "$2" 2>"$2.err"; then echo "SRC FAIL: $1" >&2; tail -12 "$2.err" >&2; echo x>>"$FAIL"; fi; }
for src in src/native/*.cpp src/native/*/*.cpp; do
  [ -e "$src" ] || continue
  obj="$OBJDIR/$(echo "$src" | tr '/.' '__').o"; OBJS+=("$obj"); cap compile "$src" "$obj"
done
drain
[ -s "$FAIL" ] && { echo "[golden-measure] native source compile failed" >&2; exit 1; }

# ── 1b. POSITIVE CONTROL: the pass above compiled REAL CODE ──────────────────
# Step 1 compiles the native tree with FORGE_NATIVE_BREP OFF, so everything
# inside that guard preprocesses to NOTHING — and a compiler returns 0 on an
# empty file. Without this check, step 1 could be GREEN WHILE COMPILING NOTHING.
# That is not hypothetical: it is the exact trap that produced two invalid
# "it compiles" measurements on the native pcurve fit, both written up in
# src/native/geom/README.NativePCurveFit.rescue.md. So count what the pass
# actually produced, and name a symbol that has to be in it.
#
# ★ forge::pcurvefit::cylinderPCurve is the anchor BECAUSE IT USED TO BE ABSENT.
#   Before T-154 the native pcurve fit was OCCT-typed and guarded, so an
#   OCCT-free compile of it emitted ZERO symbols. It is now OCCT-free and
#   unguarded, so this pass emits it. A future 0 means either the sweep stopped
#   compiling real code or the pcurve fit went back behind the guard.
#
# MEASURED on this tree, 2026-09-18, by this script at its own -O2: 156 sources
# -> 156 objects, 3004 forge:: symbols, cylinderPCurve = 1. (The same sweep at -O1
# reports 3060 — the symbol count is optimisation-dependent, which is exactly why
# the floor is 1000 and not the measurement.) The floors sit far below both, so
# ordinary churn cannot trip them; only a pass that compiled nothing can.
NSRC=${#OBJS[@]}
NOBJ=$(ls "$OBJDIR"/*.o 2>/dev/null | wc -l | tr -d ' ')
nm -g "$OBJDIR"/*.o 2>/dev/null | c++filt > "$OBJDIR/syms.txt" 2>/dev/null || true
NSYM=$(grep -c 'forge::' "$OBJDIR/syms.txt" 2>/dev/null || true)
NPCF=$(grep -c 'forge::pcurvefit::cylinderPCurve' "$OBJDIR/syms.txt" 2>/dev/null || true)
echo "[golden-measure] native OCCT-free pass: ${NOBJ:-0}/${NSRC:-0} objects, ${NSYM:-0} forge:: symbols, cylinderPCurve=${NPCF:-0}" >&2
if [ "${NOBJ:-0}" -ne "${NSRC:-0}" ] || [ "${NSYM:-0}" -lt 1000 ] || [ "${NPCF:-0}" -lt 1 ]; then
  echo "[golden-measure] POSITIVE CONTROL FAILED — the OCCT-free pass did not compile real code" >&2
  exit 1
fi

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
