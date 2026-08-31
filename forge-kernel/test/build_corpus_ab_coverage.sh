#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_corpus_ab_coverage.sh — build test/corpus_ab_coverage.cpp, the COVERAGE
# A/B that answers the flip gate every drop option names ("native success rate
# >= the measured OCCT baseline").
#
# Assembly copied from build_golden_corpus_measure.sh, with ONE deliberate
# difference: the native sources are compiled WITH the OCCT include path. That
# script keeps them OCCT-free for drop hygiene; this binary deliberately links
# BOTH engines in one process (that is the whole point of an A/B), and several
# of the engines under test — NativeThickSolid, NativeLoftPipe, NativeDraft,
# NativeFilling, NativeThickenShell, NativeFilletChamfer — are OCCT-TOPODS-TYPED
# by design and cannot compile without those headers.
#
# ★ THIS BINARY IS NOT A DROP BUILD AND MUST NEVER BE READ AS ONE. It is built
#   with NO FORGE_*_DROP_* macro defined, precisely so that BOTH branches exist
#   and both can be called. It proves nothing about the closure or the symbol
#   census; scripts/occt_closure_count.sh and tools/occt_symbol_census.sh are
#   what measure those.
#
# OBJECT CACHE. Objects land in a persistent directory (OBJDIR, default
# .build-corpus-ab under forge-kernel/) and are recompiled when older than their
# source. Every recompiled file is PRINTED as "  CXX <src>"; a run that prints no
# CXX lines and still says "built" reused the cache, and the count is stated at
# the end. This repo has been bitten by a build that printed "Built target"
# while skipping every compile, so the reuse is reported rather than assumed.
# FORCE=1 wipes the cache first.
#
# Output: the binary path on stdout as  BIN=<path>.
# Exit 0 iff the binary built.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CXX="${CXX:-clang++}"
INC="include"
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
JOBS="${JOBS:-4}"
OBJDIR="${OBJDIR:-$KERNEL/.build-corpus-ab}"
OUT="${OUT:-$OBJDIR/corpus_ab_coverage}"
[ "${FORCE:-0}" = "1" ] && rm -rf "$OBJDIR"
mkdir -p "$OBJDIR/obj" || exit 2

FAIL="$OBJDIR/fail"; : > "$FAIL"
BUILT="$OBJDIR/built"; : > "$BUILT"

CAP=()
cap() {
  "$@" &
  CAP+=("$!")
  if [ "${#CAP[@]}" -ge "$JOBS" ]; then wait "${CAP[0]}" 2>/dev/null || true; CAP=("${CAP[@]:1}"); fi
}
drain() { local p; for p in "${CAP[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null || true; done; CAP=(); }

compile() {  # $1 = src, $2 = obj
  if [ -f "$2" ] && [ "$2" -nt "$1" ]; then return 0; fi
  echo "  CXX $1"
  echo x >> "$BUILT"
  if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" -c "$1" -o "$2" 2> "$2.err"; then
    echo "SRC FAIL: $1" >&2
    tail -20 "$2.err" >&2
    echo x >> "$FAIL"
    rm -f "$2"
  fi
}

# 1. every native source (they are the engines under test and their support), PLUS
#    src/OcctPrimBuilder.cpp -- which is NOT under src/native/ and so is not caught by
#    the glob, but which supplies forge::occtPrism and forge::occtCylinderSolid. Since
#    the TKPrim-free swap (PR #64) NativeThickenShell.cpp and NativeLoftPipe.cpp both
#    call into it, so without it this harness dies at LINK with
#    "Undefined symbols: forge::occtPrism" and measures nothing at all.
#    This is the FOURTH standalone harness to need it: run_ab_native_thicken.sh,
#    run_ab_native_loftpipe.sh and build_fuse_mesh_operand_test.sh had the same gap on
#    the same day. Any harness that compiles src/native/brep/** standalone needs it.
#    It goes in the ARCHIVE like everything else, so the linker still pulls it only if
#    something actually references it.
OBJS=()
for src in src/native/*.cpp src/native/*/*.cpp src/OcctPrimBuilder.cpp; do
  [ -e "$src" ] || continue
  obj="$OBJDIR/obj/$(echo "$src" | tr '/.' '__').o"
  OBJS+=("$obj")
  cap compile "$src" "$obj"
done
drain
if [ -s "$FAIL" ]; then
  echo "[corpus-ab] native source compile failed ($(wc -l < "$FAIL" | tr -d ' ') file(s))" >&2
  exit 1
fi

# 2. ARCHIVE, not a flat object list. `ar` + the linker's archive rule pulls in
#    only the members that resolve an undefined symbol, so the harness gets the
#    engines it calls and their transitive support and NOTHING ELSE. The flat
#    list this script first used failed to link on symbols reached only from
#    src/native/brep/{NativeShapeHealBridge,StepWriteOcct}.cpp — two files this
#    harness never calls — which would have meant compiling a growing tail of
#    src/*.cpp to satisfy code that is not under test. The archive is the honest
#    fix: it makes "what this A/B actually depends on" the linker's answer
#    rather than a hand-maintained list that drifts.
LIB="$OBJDIR/libforge_native_ab.a"
rm -f "$LIB"
if ! ar -crs "$LIB" "${OBJS[@]}" 2> "$OBJDIR/ar.err"; then
  echo "[corpus-ab] ar FAILED:" >&2
  tail -20 "$OBJDIR/ar.err" >&2
  exit 1
fi

# 3. the harness TU
TU="$OBJDIR/obj/corpus_ab_coverage.o"
compile test/corpus_ab_coverage.cpp "$TU"
if [ -s "$FAIL" ]; then
  echo "[corpus-ab] harness TU compile failed" >&2
  exit 1
fi

# 4. link. The A/B baseline arms need every TKOffset/TKFillet class the call
#    sites use, plus the STEP reader (TKDESTEP = STEPControl_Reader and the
#    AP203/214/242 transfer; TKXSBase = the XSControl session under it).
OCCT_LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
           -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
           -lTKDESTEP -lTKXSBase"
# shellcheck disable=SC2086
if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" "$TU" "$LIB" \
     -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" $OCCT_LIBS -o "$OUT" 2> "$OBJDIR/link.err"; then
  echo "[corpus-ab] LINK FAILED:" >&2
  tail -40 "$OBJDIR/link.err" >&2
  exit 1
fi

# A GATE THAT CANNOT BUILD CANNOT FAIL — so prove the binary actually runs and
# that its crash/hang containment fires, here, before any corpus number exists.
if ! "$OUT" --selftest > "$OBJDIR/selftest.log" 2>&1; then
  echo "[corpus-ab] CONTAINMENT SELF-TEST FAILED:" >&2
  cat "$OBJDIR/selftest.log" >&2
  exit 1
fi

NCOMPILED="$(wc -l < "$BUILT" | tr -d ' ')"
echo "[corpus-ab] compiled $NCOMPILED translation unit(s), reused $(( ${#OBJS[@]} - NCOMPILED )); containment self-test PASS" >&2
echo "BIN=$OUT"
exit 0
