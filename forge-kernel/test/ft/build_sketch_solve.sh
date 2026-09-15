#!/usr/bin/env bash
# Build + run the 2D sketch + constraint gate (forge-kernel/test/ft/sketch_solve_test.cpp).
#
# WHY THIS IS NOT A cmake-js TARGET, and why the link looks the way it does:
# the sketch family's numerics are the VENDORED planegcs engine plus the
# forge::Sketcher facade, and neither needs OCCT. The one OCCT dependency in the
# path is Sketcher.cpp's extractWires(), which this gate never calls -- it uses
# the OCCT-free extractProfileRings() bridge instead. FeatureTreeCompiler.cpp
# likewise pulls the whole OCCT-backed kernel for the ops this gate does not
# exercise (EXTRUDE, the booleans, the features).
#
# So both are compiled normally (their headers are header-only for these TUs)
# and the executable is linked with the kernel's geometry symbols left
# UNRESOLVED. The gate never calls them, so they are never referenced at run
# time. This is the same shape as build_s0_acceptance.sh, for the same reason,
# and it keeps the gate runnable without a full OCCT kernel build.
#
# The solver itself is NOT compiled into this gate. It is libforge_gcs -- FreeCAD's
# planegcs, modified for Forge, under third_party/freecad-derived/sketch-solver
# (LGPL-2.1-or-later) -- built as a SHARED library by that component's own script
# and LINKED here, the same dynamic boundary the application ships. Sketcher.cpp
# reaches it only through forge_gcs/forge_gcs.h.
#
# Exit code is the test's.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KERNEL="$(cd "$HERE/../.." && pwd)"
OUT="${OUT:-$KERNEL/test/ft/.sketchbuild}"
mkdir -p "$OUT"

# Same prefix search as build_s0_acceptance.sh: hardcoding one path made that
# suite unrunnable on the platform CI actually runs on.
if [ -z "${OCCT_INC:-}" ]; then
  for _c in /opt/homebrew/include/opencascade \
            /opt/homebrew/opt/opencascade/include/opencascade \
            /usr/local/opt/opencascade/include/opencascade \
            /usr/include/opencascade \
            /usr/local/include/opencascade ; do
    [ -d "$_c" ] && { OCCT_INC="$_c"; break; }
  done
fi
if [ -z "${OCCT_INC:-}" ] || [ ! -d "${OCCT_INC:-}" ]; then
  echo "OCCT headers not found. Set OCCT_INC=/path/to/include/opencascade" >&2; exit 2
fi
GCS_DIR="$(cd "$KERNEL/../third_party/freecad-derived/sketch-solver" && pwd)"

CXX="${CXX:-clang++}"
FLAGS=(-std=c++20 -O1 -g -Wall
       -I"$KERNEL/include" -I"$OCCT_INC" -I"$GCS_DIR/include")

# The newest header these TUs consume. The cache below used to compare an object
# against its .cpp ALONE, so editing Sketcher.hpp -- which is where this family's
# constraint-kind enum lives -- left a STALE object in place and the gate went on
# measuring the PREVIOUS build. That is "a gate that cannot build cannot fail"
# with an extra step: it does build, it just builds something else, and it
# reports PASS. Depfiles would be exact; this is the conservative version (any
# header edit invalidates every object), which is the right trade for 8 TUs.
NEWEST_HDR=""
_newest=0
while IFS= read -r _h; do
  _m="$(stat -f '%m' "$_h" 2>/dev/null || stat -c '%Y' "$_h" 2>/dev/null || echo 0)"
  if [ "${_m:-0}" -gt "$_newest" ]; then _newest="$_m"; NEWEST_HDR="$_h"; fi
done <<EOF
$(find "$KERNEL/include" "$GCS_DIR/include" \
       \( -name '*.h' -o -name '*.hpp' \) 2>/dev/null)
EOF

compile_one() {  # $1=src $2=obj
  if [ -f "$2" ] && [ "$2" -nt "$1" ] &&
     { [ -z "$NEWEST_HDR" ] || [ "$2" -nt "$NEWEST_HDR" ]; }; then
    echo "  [cached] $(basename "$1")"; return 0
  fi
  echo "  [cc] $(basename "$1")"
  "$CXX" "${FLAGS[@]}" -c "$1" -o "$2"
}

echo "[1/4] libforge_gcs (the SHARED solver library, built by its own script)"
GCS_LIB="$(bash "$GCS_DIR/build_forge_gcs.sh" "$OUT/gcs" | tail -1)"
[ -f "$GCS_LIB" ] || { echo "libforge_gcs did not build" >&2; exit 2; }

echo "[2/4] (no in-tree solver objects: the kernel compiles none)"

echo "[3/4] forge::Sketcher facade + forge::ft compiler + graph audit"
compile_one "$KERNEL/src/Sketcher.cpp"               "$OUT/Sketcher.o" || exit 2
compile_one "$KERNEL/src/ft/FeatureTreeCompiler.cpp" "$OUT/FeatureTreeCompiler.o" || exit 2
# SketchInspect.cpp owns the ONE CON keyword table the compiler dispatches
# through, so it is a hard dependency of FeatureTreeCompiler.o and not an extra.
#
# WHAT ITS ABSENCE DID, MEASURED. The link below leaves the kernel's geometry
# symbols unresolved on purpose; on Darwin that is -undefined dynamic_lookup,
# which does not distinguish "a geometry symbol this gate never calls" from "a
# forge::ft symbol the compiler calls on every CON statement". So omitting this
# TU did not fail the link -- it produced a binary that SIGSEGV'd (exit 139) the
# first time a tree contained a constraint. A gate that dies before its first
# assertion reports no failures at all.
compile_one "$KERNEL/src/ft/SketchInspect.cpp"       "$OUT/SketchInspect.o" || exit 2
# compile() calls auditGraph() unconditionally (s0.4). It is pure std C++, so it
# is linked FOR REAL here rather than stubbed -- the gate's trees go through the
# same graph-quality pass every other tree does.
compile_one "$KERNEL/src/ft/GraphAudit.cpp"          "$OUT/GraphAudit.o" || exit 2

echo "[4/4] gate + link (kernel geometry symbols deliberately unresolved)"
"$CXX" "${FLAGS[@]}" -c "$HERE/sketch_solve_test.cpp" -o "$OUT/sketch_solve_test.o" || exit 2

case "$(uname -s)" in
  Darwin) UNDEF=(-Wl,-undefined,dynamic_lookup -Wl,-no_fixup_chains) ;;
  *)      UNDEF=(-Wl,--unresolved-symbols=ignore-all) ;;
esac

# OCCT's Standard_Failure and BRepLib are reached through header-inlined code in
# Sketcher.cpp's extractWires path. dynamic_lookup defers them to load time, and
# dyld still wants them THERE even though nothing calls them, so the OCCT libs
# that define them are linked. They are not otherwise used by this gate.
OCCT_LIB="${OCCT_LIB:-$(dirname "$OCCT_INC")/../lib}"
LIBS=()
if [ -d "$OCCT_LIB" ]; then
  LIBS=(-L"$OCCT_LIB" -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo -lTKGeomAlgo)
fi

"$CXX" -std=c++20 "$OUT/sketch_solve_test.o" "$OUT/FeatureTreeCompiler.o" "$OUT/Sketcher.o" \
    "$OUT/SketchInspect.o" "$OUT/GraphAudit.o" \
    -o "$OUT/sketch_solve" "${LIBS[@]}" \
    -L"$(dirname "$GCS_LIB")" -lforge_gcs -Wl,-rpath,"$(dirname "$GCS_LIB")" "${UNDEF[@]}" || exit 2

echo
"$OUT/sketch_solve"
rc=$?
echo
echo "exit=$rc"
exit $rc
