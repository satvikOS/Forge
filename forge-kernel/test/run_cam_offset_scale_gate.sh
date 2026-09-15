#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_cam_offset_scale_gate.sh — build and run test/cam_offset_scale_gate.cpp, the
# scale sweep (1e-3 mm .. 1e3 mm) of the CAM inward offset's standoff contract,
# against the SHIPPED src/Cam.cpp; with --mutations, prove it goes RED when each
# repair is put back.
#
# WHAT IT LINKS, AND WHY THAT IS THE PRODUCTION PATH. The gate calls the PUBLIC
# forge::cam::profile / forge::cam::pocket, so it needs src/Cam.cpp compiled as a
# separate object exactly as the library compiles it, plus the four TUs that object
# actually reaches: ShapeRegistry.cpp (the handle table), and the native offset
# engine (PolygonOffset2D.cpp, Geom.cpp, Predicates.cpp). It does NOT need
# libforge_kernel_core, the corpus A/B archive, a corpus, or TKOffset: nothing here
# depends on this workstation's build trees. FORGE_NATIVE_BREP is deliberately NOT
# defined — src/Cam.cpp has no FORGE_NATIVE_BREP branch, and without it
# ShapeRegistry.cpp does not pull the native->OCCT bridge and half the kernel in.
#
# ★ HERMETIC. Needs a C++20 compiler and OCCT headers/libs (the kernel job installs
#   opencascade with brew). Builds in a fresh mktemp directory, writes nothing into
#   the tree.
#
# ★ THE MUTATIONS ARE ASSERTED TO APPLY. Each one copies src/Cam.cpp, rewrites one
#   repair back to the defect it fixed, and FAILS THE RUN if the copy is
#   byte-identical to the original (a mutation that changed nothing would "prove" the
#   gate can fail by exercising the unmutated code). Each must then turn the gate RED
#   with the specific [FAIL] tag its defect produces — red for the wrong reason is not
#   evidence either.
#
# usage: forge-kernel/test/run_cam_offset_scale_gate.sh [--mutations] [--verbose]
#   env: OCCT_ROOT=<prefix>  CXX=<compiler>  CAM_SRC=<alternate Cam.cpp to test>
#        OUT=<build dir, default: mktemp>
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

MUTATE=0
VERBOSE=""
for a in "$@"; do
  case "$a" in
    --mutations) MUTATE=1 ;;
    --verbose)   VERBOSE="--verbose" ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KERNEL="$ROOT/forge-kernel"
CAM_SRC="${CAM_SRC:-$KERNEL/src/Cam.cpp}"
[ -f "$CAM_SRC" ] || { echo "FATAL: no $CAM_SRC" >&2; exit 2; }

OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || OCCT=/usr/local/opt/opencascade
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || OCCT=/usr
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  echo "FATAL: OCCT not found (set OCCT_ROOT)" >&2; exit 2
fi

OUT="${OUT:-$(mktemp -d "${TMPDIR:-/tmp}/cam_offset_scale_gate.XXXXXX")}"
mkdir -p "$OUT/obj" || exit 2
CXX="${CXX:-clang++}"
FLAGS="-std=c++20 -O2 -Wall -Wextra -Werror -Wno-deprecated-declarations"
INC="-I $KERNEL/include -isystem $OCCT/include/opencascade"   # -isystem: -Werror is for OUR code, not for OCCT headers a newer CI compiler may warn in
LIBS="-L $OCCT/lib -Wl,-rpath,$OCCT/lib -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase \
      -lTKBRep -lTKGeomAlgo -lTKTopAlgo"

compile() {   # compile <src> <obj>; exit status of the COMPILER, not of a pipeline
  $CXX $FLAGS $INC -c "$1" -o "$2" 2> "$2.err"
  local rc=$?
  if [ "$rc" != "0" ]; then
    echo "COMPILE FAILED ($rc): $1" >&2
    tail -30 "$2.err" >&2
    return 1
  fi
  [ -s "$2" ] || { echo "COMPILE produced no object: $1" >&2; return 1; }
  return 0
}

# ── support objects (never mutated) ─────────────────────────────────────────
SUPPORT="src/ShapeRegistry.cpp src/native/geom/PolygonOffset2D.cpp src/native/geom/Geom.cpp src/native/Predicates.cpp"
SUP_OBJS=""
for src in $SUPPORT; do
  o="$OUT/obj/$(echo "$src" | tr '/.' '__').o"
  compile "$KERNEL/$src" "$o" || exit 1
  SUP_OBJS="$SUP_OBJS $o"
done
compile "$KERNEL/test/cam_offset_scale_gate.cpp" "$OUT/obj/gate_main.o" || exit 1

build_gate() {   # build_gate <Cam.cpp> <bin>
  local cam="$1" bin="$2"
  rm -f "$bin" "$bin.cam.o"
  compile "$cam" "$bin.cam.o" || return 1
  $CXX "$OUT/obj/gate_main.o" "$bin.cam.o" $SUP_OBJS $LIBS -o "$bin" 2> "$bin.link.err"
  local rc=$?
  if [ "$rc" != "0" ]; then
    echo "LINK FAILED ($rc)" >&2; tail -30 "$bin.link.err" >&2; return 1
  fi
  # A link that "succeeded" but left no fresh binary must not be believed.
  [ -x "$bin" ] || { echo "LINK produced no binary: $bin" >&2; return 1; }
  return 0
}

echo "[cam-offset-scale] building against $CAM_SRC"
build_gate "$CAM_SRC" "$OUT/gate" || exit 1

# ── the shipped object must not have brought TKOffset back ──────────────────
TKO="$(nm -u "$OUT/gate.cam.o" 2>/dev/null | grep -c 'BRepOffset' || true)"
echo "[cam-offset-scale] BRepOffset* undefined symbols in the Cam.cpp object: $TKO"
if [ "$TKO" != "0" ]; then
  echo "[cam-offset-scale] RED — src/Cam.cpp references TKOffset again" >&2
  exit 1
fi

"$OUT/gate" $VERBOSE
GATE=$?
echo "[cam-offset-scale] tree gate exit=$GATE"
[ "$GATE" = "0" ] || exit 1
[ "$MUTATE" = "1" ] || exit 0

# ── mutations ───────────────────────────────────────────────────────────────
# Each is a perl substitution on a COPY of src/Cam.cpp. <expected tag> is the
# [FAIL] tag the reverted defect must produce.
fails=0
mutate() {   # mutate <n> <expected tag> <perl -0 program> <description>
  local n="$1" tag="$2" prog="$3" what="$4"
  local dir="$OUT/mut$n"
  mkdir -p "$dir"
  cp "$CAM_SRC" "$dir/Cam.cpp"
  perl -0pi -e "$prog" "$dir/Cam.cpp"
  if cmp -s "$CAM_SRC" "$dir/Cam.cpp"; then
    echo "::error::mutation $n ($what) DID NOT APPLY — the file is unchanged, so it proves nothing"
    fails=$((fails + 1)); return
  fi
  if ! build_gate "$dir/Cam.cpp" "$dir/gate"; then
    echo "::error::mutation $n ($what) does not BUILD — a mutant that cannot compile proves nothing"
    fails=$((fails + 1)); return
  fi
  "$dir/gate" > "$dir/run.log" 2>&1
  local rc=$?
  if [ "$rc" = "0" ]; then
    echo "::error::mutation $n ($what) STAYED GREEN — the gate cannot see that defect"
    tail -3 "$dir/run.log"
    fails=$((fails + 1)); return
  fi
  if ! grep -q "^\[FAIL\] $tag " "$dir/run.log"; then
    echo "::error::mutation $n ($what) went red but NOT with [FAIL] $tag — red for the wrong reason"
    grep '^\[FAIL\]' "$dir/run.log" | head -5
    fails=$((fails + 1)); return
  fi
  echo "  mutation $n RED as required ($what): $(grep -c '^\[FAIL\]' "$dir/run.log") failures, e.g."
  grep "^\[FAIL\] $tag " "$dir/run.log" | head -1 | cut -c1-220
}

# M1 — THE ADVERSARY'S DEFECT: the tolerance goes back to an absolute length.
mutate 1 INFEASIBLE_PROFILE_REFUSES \
  's/return std::min\(kOffsetInputDeflection, kOffsetTolRelative \* std::min\(d, featureExtent\)\);/(void)d; (void)featureExtent; return kOffsetInputDeflection;/' \
  "offset tolerance absolute again (3.125e-3 mm at every scale)"

# M2 — the absolute SLACK alone, with the relative tessellation kept.
mutate 2 INFEASIBLE_PROFILE_REFUSES \
  's/const double clearanceSlack = 2\.0 \* tol \+ floor;/const double clearanceSlack = 4.0 * kOffsetInputDeflection + 1.0e-6 * offsetMm + 1.0e-9;/' \
  "post-condition slack absolute again (0.0125 mm)"

# M3 — the CW-presenting circle loses its orientation (analytic path).
mutate 3 TRACE_ORIENTATION \
  's/if \(srcEdgeOrientation == TopAbs_REVERSED\) edge\.Reverse\(\);//' \
  "analytic circle drops the source edge orientation"

# M4 — the consumer re-samples an analytic result at an absolute 0.05 mm.
mutate 4 PROFILE_FIDELITY \
  's/return std::min\(kSampleDeflection, kOffsetTolRelative \* resultExtent\);/(void)resultExtent; return kSampleDeflection;/' \
  "trace deflection absolute again (0.05 mm)"

# M5 — pocket drops raster spans narrower than an absolute 0.01 mm.
mutate 5 POCKET_RASTERS_PRESENT \
  's/const double minSpan = std::min\(0\.01, kOffsetTolRelative \* tool\.diameter\);/const double minSpan = 0.01;/' \
  "pocket hair-thin span threshold absolute again (0.01 mm)"

# M6 — the post-condition's containment clause removed (a region outside the part
#      at full distance would pass the clearance test alone). Driven by putting the
#      winding-relative sign defect back, which offsets a CW boundary OUTWARD.
mutate 6 FEASIBLE_PROFILE_SUCCEEDS \
  's/const double signedDist = -offsetMm;/const double signedDist = (loop.signedArea2() > 0.0) ? -offsetMm : offsetMm;/' \
  "winding-relative sign put back (CW boundary offset outward)"

# M7 — M6 AND the containment clause removed. M6 is caught by src/Cam.cpp's own
#      containment check; this proves the GATE sees an outside path by itself,
#      so its green does not rest on the code under test policing itself.
mutate 7 PROFILE_INSIDE_PART \
  's/const double signedDist = -offsetMm;/const double signedDist = (loop.signedArea2() > 0.0) ? -offsetMm : offsetMm;/; s/if \(!clr\.allInside\) \{/if (false) {/' \
  "winding-relative sign put back AND the containment clause removed"

if [ "$fails" != "0" ]; then
  echo "[cam-offset-scale] RED — $fails mutation(s) did not behave"
  exit 1
fi
echo "[cam-offset-scale] GREEN on the tree, RED under all 7 mutations"
exit 0
