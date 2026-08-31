#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_cam_inwardoffset_coverage_ab.sh — the COVERAGE clause of
# FORGE_OFFSET_DROP_MAKEOFFSET's flip gate, measured on the SHIPPED function.
#
# CMakeLists.txt:527 states the evidence the option needs: "re-run the 382-part
# sweep ... with the option ON and show native defers <= the OCCT baseline rate".
# The corpus that sweep used (data/forge/complex_all.jsonl) is not in the tree,
# and cam::inwardOffset is only reachable through the JS binding, so this builds
# TWO BINARIES of test/cam_inwardoffset_coverage_ab.cpp — one WITHOUT the drop
# macro (OCCT BRepOffsetAPI_MakeOffset, the baseline) and one WITH it (native
# PolygonOffset2D only) — and runs both over the same 600 STEP parts.
#
# ★ THE ARMS ARE PROVED TO DIFFER, twice, before any number is believed: `cmp`
#   on the two binaries, and `nm -u | grep BRepOffsetAPI_MakeOffset`, which must
#   report 4 symbols for the stock arm and 0 for the drop arm. A flag that CMake
#   or the compiler silently ignored would otherwise produce two identical arms
#   and a meaningless "no difference".
#
# usage: test/run_cam_inwardoffset_coverage_ab.sh [OUTDIR]
#   env: CORPUS=<dir> OCCT_ROOT=<prefix>
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

OUTDIR="${1:-$KERNEL/.build-cam-offset-ab}"
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  OCCT=/usr/local/opt/opencascade
fi
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  echo "FATAL: OCCT not found (set OCCT_ROOT)" >&2; exit 2
fi
[ -d "$CORPUS" ] || { echo "FATAL: corpus not found: $CORPUS" >&2; exit 2; }
mkdir -p "$OUTDIR" || exit 2

CXX="${CXX:-clang++}"
INC="-I $KERNEL/include -I $OCCT/include/opencascade"
LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
      -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
      -lTKDESTEP -lTKXSBase"
# Each support TU is here because the LINKER named it, never because it looked
# likely: ShapeRegistry and NativeOcctBridge are reached from the OTHER cam
# entry points that Cam.cpp defines and this harness never calls.
SUPPORT="src/ShapeRegistry.cpp src/NativeOcctBridge.cpp"
LIBNAT="$KERNEL/.build-corpus-ab/libforge_native_ab.a"
if [ ! -f "$LIBNAT" ]; then
  echo "[cam-offset-ab] building the native archive via test/build_corpus_ab_coverage.sh" >&2
  bash "$KERNEL/test/build_corpus_ab_coverage.sh" >/dev/null 2>&1
fi
[ -f "$LIBNAT" ] || { echo "FATAL: no $LIBNAT — a gate that cannot build cannot fail" >&2; exit 1; }

build_arm() {   # $1 = stock|drop
  local arm="$1" extra="" obj="$OUTDIR/obj-$1" objs=""
  [ "$arm" = "drop" ] && extra="-DFORGE_OFFSET_DROP_MAKEOFFSET=1"
  mkdir -p "$obj"
  local flags="-std=c++20 -O2 -DFORGE_NATIVE_BREP $extra"
  local src o
  for src in $SUPPORT; do
    o="$obj/$(echo "$src" | tr '/.' '__').o"
    # shellcheck disable=SC2086
    $CXX $flags $INC -c "$KERNEL/$src" -o "$o" 2> "$o.err" || {
      echo "COMPILE FAILED ($arm): $src" >&2; tail -20 "$o.err" >&2; return 1; }
    objs="$objs $o"
  done
  # shellcheck disable=SC2086
  $CXX $flags $INC -c "$KERNEL/test/cam_inwardoffset_coverage_ab.cpp" -o "$obj/main.o" \
      2> "$obj/main.err" || {
    echo "COMPILE FAILED ($arm): harness" >&2; tail -20 "$obj/main.err" >&2; return 1; }
  # shellcheck disable=SC2086
  $CXX $flags $INC "$obj/main.o" $objs "$LIBNAT" \
      -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" $LIBS -o "$OUTDIR/cam_offset_$arm" \
      2> "$obj/link.err" || {
    echo "LINK FAILED ($arm)" >&2; tail -30 "$obj/link.err" >&2; return 1; }
}

build_arm stock || exit 1
build_arm drop  || exit 1

# ── PROVE THE ARMS DIFFER (a null A/B usually means one binary compared to itself)
if cmp -s "$OUTDIR/cam_offset_stock" "$OUTDIR/cam_offset_drop"; then
  echo "FATAL: the two arms are BYTE-IDENTICAL — the drop macro did nothing." >&2
  exit 3
fi
NS="$(nm -u "$OUTDIR/cam_offset_stock" 2>/dev/null | grep -c BRepOffsetAPI_MakeOffset)"
ND="$(nm -u "$OUTDIR/cam_offset_drop"  2>/dev/null | grep -c BRepOffsetAPI_MakeOffset)"
echo "[cam-offset-ab] BRepOffsetAPI_MakeOffset undefined symbols: stock=$NS drop=$ND"
if [ "$NS" != "4" ] || [ "$ND" != "0" ]; then
  echo "FATAL: expected stock=4 drop=0. The drop macro is not doing what it claims." >&2
  exit 3
fi

LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort > "$OUTDIR/corpus.list"
N="$(wc -l < "$OUTDIR/corpus.list" | tr -d ' ')"
echo "[cam-offset-ab] $N parts"
for arm in stock drop; do
  # shellcheck disable=SC2046
  "$OUTDIR/cam_offset_$arm" $(cat "$OUTDIR/corpus.list") > "$OUTDIR/$arm.txt" 2>"$OUTDIR/$arm.err"
  echo "[cam-offset-ab] $arm: $(tail -1 "$OUTDIR/$arm.txt")"
done

# ── the PAIRED table (a rate without its discordant pairs is not a result) ────
awk 'FNR==NR { if ($2=="OK"||$2=="DEFER") a[$1]=$2; next }
     ($2=="OK"||$2=="DEFER") {
       b[$1]=$2
       if (a[$1]=="OK" && $2=="OK") both++
       else if (a[$1]=="OK") occtonly = occtonly " " $1
       else if ($2=="OK")    natonly  = natonly  " " $1
       else neither++
       if (a[$1]=="OK") ao++
       if ($2=="OK") bo++
       n++
     }
     END {
       no=split(natonly,x," "); oo=split(occtonly,y," ")
       printf "\nparts %d\n", n
       printf "  OCCT baseline (stock) ok %d = %.1f%%\n", ao, 100*ao/n
       printf "  native (drop)         ok %d = %.1f%%\n", bo, 100*bo/n
       printf "  both %d   native-only %d   OCCT-only (the deletion bucket) %d   neither %d\n", both, no, oo, neither+0
       if (oo) printf "  OCCT-only parts:%s\n", occtonly
       if (no) printf "  native-only parts:%s\n", natonly
       printf "  rate clause: %s\n", (bo>=ao ? "PASS (native >= baseline)" : "FAIL")
       printf "  Law 9 clause: %s\n", (oo==0 ? "PASS (deletion bucket empty)" : "FAIL (capability would be deleted on those parts)")
     }' "$OUTDIR/stock.txt" "$OUTDIR/drop.txt" | tee "$OUTDIR/summary.txt"
exit 0
