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
# planegcs itself is compiled from source here (5 TUs) against the IN-HOUSE
# Eigen shim -- 3rdParty/planegcs_eigen_shim, backed by forge::native::linalg.
# There is no real Eigen anywhere in this link.
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
if [ -z "${BOOST_INC:-}" ]; then
  for _b in /opt/homebrew/opt/boost/include /opt/homebrew/include \
            /usr/local/opt/boost/include /usr/include ; do
    [ -d "$_b/boost/graph" ] && { BOOST_INC="$_b"; break; }
  done
fi
if [ -z "${BOOST_INC:-}" ]; then
  echo "Boost headers not found (planegcs needs boost::graph). Set BOOST_INC=..." >&2; exit 2
fi

CXX="${CXX:-clang++}"
FLAGS=(-std=c++20 -O1 -g -Wall
       -I"$KERNEL/include" -I"$OCCT_INC" -I"$BOOST_INC"
       -I"$KERNEL/3rdParty/planegcs" -I"$KERNEL/3rdParty/planegcs_eigen_shim")

# The vendored solver is third-party source: compile it warning-quiet, but keep
# -Wall on everything Forge actually owns.
VENDOR_FLAGS=(-std=c++20 -O1 -g -w
       -I"$KERNEL/include" -I"$OCCT_INC" -I"$BOOST_INC"
       -I"$KERNEL/3rdParty/planegcs" -I"$KERNEL/3rdParty/planegcs_eigen_shim")

compile_one() {  # $1=src $2=obj $3=vendor?
  if [ -f "$2" ] && [ "$2" -nt "$1" ]; then echo "  [cached] $(basename "$1")"; return 0; fi
  echo "  [cc] $(basename "$1")"
  if [ "${3:-}" = vendor ]; then "$CXX" "${VENDOR_FLAGS[@]}" -c "$1" -o "$2"
  else                          "$CXX" "${FLAGS[@]}"        -c "$1" -o "$2"; fi
}

echo "[1/4] vendored planegcs (5 TUs, in-house Eigen shim, NO real Eigen)"
PG_OBJS=()
for f in Constraints GCS Geo SubSystem qp_eq; do
  compile_one "$KERNEL/3rdParty/planegcs/$f.cpp" "$OUT/$f.o" vendor || exit 2
  PG_OBJS+=("$OUT/$f.o")
done

echo "[2/4] forge::native::linalg (what the Eigen shim is backed by)"
compile_one "$KERNEL/src/native/linalg/LinAlg.cpp" "$OUT/LinAlg.o" || exit 2

echo "[3/4] forge::Sketcher facade + forge::ft compiler + graph audit"
compile_one "$KERNEL/src/Sketcher.cpp"               "$OUT/Sketcher.o" || exit 2
compile_one "$KERNEL/src/ft/FeatureTreeCompiler.cpp" "$OUT/FeatureTreeCompiler.o" || exit 2
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

"$CXX" -std=c++20 "$OUT/sketch_solve_test.o" "$OUT/FeatureTreeCompiler.o" "$OUT/Sketcher.o" "$OUT/GraphAudit.o" \
    "${PG_OBJS[@]}" "$OUT/LinAlg.o" -o "$OUT/sketch_solve" "${LIBS[@]}" "${UNDEF[@]}" || exit 2

echo
"$OUT/sketch_solve"
rc=$?
echo
echo "exit=$rc"
exit $rc
