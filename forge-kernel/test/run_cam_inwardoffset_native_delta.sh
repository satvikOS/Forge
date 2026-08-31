#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_cam_inwardoffset_native_delta.sh — did a change to PolygonOffset2D move
# anything OTHER than the rows it was meant to move?
#
# A pass/fail row diff is not enough: a part can stay OK while the CONTOUR it
# returns silently changes. This builds test/cam_inwardoffset_geom_probe.cpp
# TWICE — once with the WORKING TREE's PolygonOffset2D.cpp and once with the
# revision named by BASE_REV (default HEAD~1) — runs both over the same 600
# parts in NATIVE_ONLY mode (no OCCT in the loop), and diffs the full observable
# vector per part: ok, wire count, closed count, total length, centroid, bbox,
# all to 12 decimals.
#
# ★ THE ARMS ARE PROVED TO DIFFER before any number is believed: the two
#   PolygonOffset2D objects must not be byte-identical, and the two binaries
#   must not be byte-identical. A `cp` that silently reused a stale object, or a
#   BASE_REV that does not actually differ, would otherwise report a clean "0
#   rows changed" that means nothing.
#
# usage: test/run_cam_inwardoffset_native_delta.sh [OUTDIR]
#   env: BASE_REV=<git rev>  CORPUS=<dir>  OCCT_ROOT=<prefix>
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

OUTDIR="${1:-$KERNEL/.build-cam-offset-ab/nativedelta}"
BASE_REV="${BASE_REV:-HEAD~1}"
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || OCCT=/usr/local/opt/opencascade
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || { echo "FATAL: OCCT not found" >&2; exit 2; }
[ -d "$CORPUS" ] || { echo "FATAL: corpus not found: $CORPUS" >&2; exit 2; }
mkdir -p "$OUTDIR" || exit 2

REL="src/native/geom/PolygonOffset2D.cpp"
git -C "$KERNEL" show "$BASE_REV:forge-kernel/$REL" > "$OUTDIR/PolygonOffset2D.base.cpp" || {
  echo "FATAL: cannot read $BASE_REV:forge-kernel/$REL" >&2; exit 2; }

CXX="${CXX:-clang++}"
INC="-I $KERNEL/include -I $OCCT/include/opencascade"
LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
      -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
      -lTKDESTEP -lTKXSBase"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"

LIBNAT="$KERNEL/.build-corpus-ab/libforge_native_ab.a"
[ -f "$LIBNAT" ] || bash "$KERNEL/test/build_corpus_ab_coverage.sh" >/dev/null 2>&1
[ -f "$LIBNAT" ] || { echo "FATAL: no $LIBNAT" >&2; exit 1; }

# The explicitly-linked PolygonOffset2D object DEFINES those symbols, so the
# archive member carrying the other revision is never pulled in.
# shellcheck disable=SC2086
$CXX $FLAGS $INC -c "$KERNEL/$REL"                    -o "$OUTDIR/po2d.head.o" || exit 1
# shellcheck disable=SC2086
$CXX $FLAGS $INC -c "$OUTDIR/PolygonOffset2D.base.cpp" -o "$OUTDIR/po2d.base.o" || exit 1
if cmp -s "$OUTDIR/po2d.head.o" "$OUTDIR/po2d.base.o"; then
  echo "FATAL: the two PolygonOffset2D objects are BYTE-IDENTICAL — $BASE_REV does not differ." >&2
  exit 3
fi
# shellcheck disable=SC2086
$CXX $FLAGS $INC -c "$KERNEL/src/ShapeRegistry.cpp"    -o "$OUTDIR/nd_shapereg.o" || exit 1
# shellcheck disable=SC2086
$CXX $FLAGS $INC -c "$KERNEL/src/NativeOcctBridge.cpp" -o "$OUTDIR/nd_bridge.o"   || exit 1
# shellcheck disable=SC2086
$CXX $FLAGS $INC -c "$KERNEL/test/cam_inwardoffset_geom_probe.cpp" -o "$OUTDIR/nd_main.o" || exit 1
for arm in head base; do
  # shellcheck disable=SC2086
  $CXX $FLAGS $INC "$OUTDIR/nd_main.o" "$OUTDIR/po2d.$arm.o" "$OUTDIR/nd_shapereg.o" \
       "$OUTDIR/nd_bridge.o" "$LIBNAT" \
       -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" $LIBS -o "$OUTDIR/probe_$arm" || exit 1
done
if cmp -s "$OUTDIR/probe_head" "$OUTDIR/probe_base"; then
  echo "FATAL: the two probe binaries are BYTE-IDENTICAL." >&2; exit 3
fi
echo "[native-delta] arms proved to differ (objects and binaries)"

LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort > "$OUTDIR/corpus.list"
echo "[native-delta] $(wc -l < "$OUTDIR/corpus.list" | tr -d ' ') parts, BASE_REV=$BASE_REV"
for arm in base head; do
  # shellcheck disable=SC2046
  NATIVE_ONLY=1 "$OUTDIR/probe_$arm" $(cat "$OUTDIR/corpus.list") \
      > "$OUTDIR/$arm.txt" 2> "$OUTDIR/$arm.err"
  echo "[native-delta] $arm: $(grep -c 'ok=1' "$OUTDIR/$arm.txt") of $(grep -c . "$OUTDIR/$arm.txt") rows ok"
done

echo
echo "rows differing in the FULL observable vector:"
diff "$OUTDIR/base.txt" "$OUTDIR/head.txt" | grep -c '^<' || true
diff "$OUTDIR/base.txt" "$OUTDIR/head.txt" | sed -n '1,60p'
