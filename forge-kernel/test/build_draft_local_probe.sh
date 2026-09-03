#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_draft_local_probe.sh — build test/draft_local_probe.cpp.
#
# It compiles ONLY the engine it measures (src/native/brep/NativeDraftLocal.cpp)
# plus the probe TU, not the whole 151-file native tree that
# build_draft_defer_probe.sh assembles: NativeDraftLocal.cpp has no first-party
# dependency beyond its own header, so a wider build would cost minutes and
# measure nothing extra. That independence is itself checked — the link fails
# loud if the engine ever grows one.
#
# ★ THE SENTENCE ABOVE IS NO LONGER TRUE, AND IS KEPT SO THE CHANGE IS VISIBLE.
# The engine grew exactly the first-party dependency that paragraph promised the
# link would catch, and the link DID catch it — loudly, with three undefined
# forge::pcurvefit symbols. That is the check working, not the check failing.
# NativeDraftLocal.cpp now calls forge::pcurvefit (planeCylinderSection,
# sectionResidual, cylinderPCurve) to build and fit the pcurve for a wall edge
# lying on a cylinder, so src/native/geom/NativePCurveFit.cpp is compiled and
# linked below, exactly as run_ab_native_draft_local.sh does it. The claim this
# script can still make is the NARROWER one: the engine's dependencies are
# ENUMERATED here, and a NEW one still fails the link loud. Deleting the stale
# sentence would have hidden which promise changed.
#
# ★ NOT A DROP BUILD. No FORGE_*_DROP_* macro is defined, exactly as in the A/B.
#
# A GATE THAT CANNOT BUILD CANNOT FAIL: the build runs the probe's own
# --selftest (a positive AND a negative control) and refuses to emit a binary
# path if either fails.
#
# Output: BIN=<path> on stdout. Exit 0 iff the binary built and self-tested.
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
OBJDIR="${OBJDIR:-$KERNEL/.build-draft-local}"
OUT="${OUT:-$OBJDIR/draft_local_probe}"
[ "${FORCE:-0}" = "1" ] && rm -rf "$OBJDIR"
mkdir -p "$OBJDIR/obj" || exit 2

# shellcheck disable=SC2086
compile() {   # compile <src> <obj>
  if [ -f "$2" ] && [ "$2" -nt "$1" ]; then return 0; fi
  echo "  CXX $1" >&2
  if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" -c "$1" -o "$2" 2> "$2.err"; then
    echo "SRC FAIL: $1" >&2
    tail -30 "$2.err" >&2
    rm -f "$2"
    return 1
  fi
  return 0
}

ENGINE_OBJ="$OBJDIR/obj/NativeDraftLocal.o"
PROBE_OBJ="$OBJDIR/obj/draft_local_probe.o"
# The engine's ONE first-party dependency. Enumerated, not globbed: a glob would
# silently absorb the next new dependency and retire the loud link failure that
# is the only thing telling us the engine's surface moved.
FITTER_OBJ="$OBJDIR/obj/NativePCurveFit.o"
compile src/native/brep/NativeDraftLocal.cpp "$ENGINE_OBJ" || exit 1
compile src/native/geom/NativePCurveFit.cpp  "$FITTER_OBJ" || exit 1
compile test/draft_local_probe.cpp           "$PROBE_OBJ"  || exit 1

OCCT_LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
           -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
           -lTKDESTEP -lTKXSBase"
# shellcheck disable=SC2086
if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" "$ENGINE_OBJ" "$FITTER_OBJ" "$PROBE_OBJ" \
     -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" $OCCT_LIBS -o "$OUT" 2> "$OBJDIR/link.err"; then
  echo "[draft-local-probe] LINK FAILED:" >&2
  tail -40 "$OBJDIR/link.err" >&2
  exit 1
fi

# The controls, before any corpus number exists.
if ! "$OUT" --selftest > "$OBJDIR/selftest.log" 2>&1; then
  echo "[draft-local-probe] SELFTEST FAILED:" >&2
  cat "$OBJDIR/selftest.log" >&2
  exit 1
fi
cat "$OBJDIR/selftest.log" >&2

cat > "$OBJDIR/build_stamp.json" <<STAMPJSON
{
  "built_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "git_head": "$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)",
  "dirty_files_in_src_include_test": $(git -C "$KERNEL" status --porcelain -- "$KERNEL/src" "$KERNEL/include" "$KERNEL/test" 2>/dev/null | wc -l | tr -d ' '),
  "flags": "$FLAGS",
  "occt_root": "$OCCT",
  "binary": "$OUT"
}
STAMPJSON

echo "[draft-local-probe] built; selftest PASS" >&2
echo "BIN=$OUT"
exit 0
