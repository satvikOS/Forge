#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_thrusections_engine_census.sh — rank the causes of the THRUSECTIONS
# deletion bucket, using the label the ENGINE itself recorded.
#
# WHAT CHANGED SINCE test/run_thrusections_defer_census.sh. That census used a
# REPLICA of the engine's predicates written in the test, which was the right
# instrument for "is there a fix at all" (it found the ring-correspondence
# defect: 0.0% -> 51.5% native on 600 parts). It is the wrong instrument for
# ranking the REMAINDER, because a replica reports only the causes its author
# encoded and drifts from the engine the moment either side is edited. This
# runner drives test/thrusections_engine_census.cpp, which reads
# forge::occtloft::lastDeferReason() — the label written by the FK_DEFER at the
# exact line the engine returned from.
#
# ★ CONTROLS FIRST, AND FATAL. The self-test requires the engine to be seen
#   BUILDING (a frustum, to the prismatoid closed form) and DECLINING with three
#   DISTINCT labels (quad_nonplanar, prof_edge_not_line,
#   loft_vertex_count_mismatch). A reason channel that has never been seen to
#   take two values cannot rank anything, and a histogram from an inert channel
#   would look exactly like a real one.
#
# usage:  test/run_thrusections_engine_census.sh [OUTFILE]
#   env:  CORPUS=<dir>  OCCT_ROOT=<dir>
# Exit 0 iff the controls passed and every part produced a row.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
OUT="${1:-$KERNEL/.build-corpus-ab/thrusections_engine_census.tsv}"
OBJDIR="$KERNEL/.build-corpus-ab"
BIN="$OBJDIR/thrusections_engine_census"
LIB="$OBJDIR/libforge_native_ab.a"

if [ ! -d "$CORPUS" ]; then echo "FATAL: corpus dir not found: $CORPUS" >&2; exit 2; fi
mkdir -p "$OBJDIR" || exit 2

# The engine archive is built by build_corpus_ab_coverage.sh. Rebuild it
# UNCONDITIONALLY unless SKIP_BUILD=1: this census reads a thread-local written
# inside NativeLoftPipe.cpp, so a stale archive would report the labels of a
# different engine — the precise failure mode this repo has already paid for
# twice (a byte-identical A/B, and a run measured against a moved tree).
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "[engine-census] refreshing the native archive via build_corpus_ab_coverage.sh" >&2
  bash "$KERNEL/test/build_corpus_ab_coverage.sh" >/dev/null 2>&1 || {
    echo "FATAL: archive build failed" >&2; exit 1; }
fi
[ -f "$LIB" ] || { echo "FATAL: no $LIB — a gate that cannot build cannot fail" >&2; exit 1; }

OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT="/usr/local/opt/opencascade"
  else
    echo "FATAL: OCCT not found (brew install opencascade or set OCCT_ROOT)" >&2; exit 2
  fi
fi

echo "[engine-census] compiling test/thrusections_engine_census.cpp" >&2
if ! clang++ -std=c++20 -O2 -DFORGE_NATIVE_BREP \
      -I "$KERNEL/include" -I "$OCCT/include/opencascade" \
      "$KERNEL/test/thrusections_engine_census.cpp" "$LIB" \
      -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" \
      -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
      -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
      -lTKDESTEP -lTKXSBase -o "$BIN" 2> "$OBJDIR/engine_census_build.err"; then
  echo "[engine-census] BUILD FAILED:" >&2; tail -40 "$OBJDIR/engine_census_build.err" >&2; exit 1
fi

echo "[engine-census] controls:" >&2
if ! "$BIN" --selftest >&2; then
  echo "[engine-census] CONTROLS FAILED — the reason channel is inert, refusing to emit rows" >&2
  exit 1
fi

LIST="$OBJDIR/engine_census_corpus.list"
LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort > "$LIST"
TOTAL="$(wc -l < "$LIST" | tr -d ' ')"
if [ "$TOTAL" -eq 0 ]; then echo "FATAL: no .step files in $CORPUS" >&2; exit 2; fi

TMP="$OUT.rows"
printf 'part\tengine\treason\tnEdge1\tnEdge2\tnLine1\tnLine2\tnWire1\tnWire2\tcode1\tcode2\tparallel\ttranslate\n' > "$OUT"
xargs -n 20 "$BIN" < "$LIST" > "$TMP" 2> "$OBJDIR/engine_census_run.err"
cat "$TMP" >> "$OUT"
ROWS="$(wc -l < "$TMP" | tr -d ' ')"
rm -f "$TMP"

echo >&2
echo "[engine-census] $ROWS rows for $TOTAL parts -> $OUT" >&2
echo "[engine-census] engine outcome:" >&2
awk -F'\t' 'NR>1{c[$2]++} END{for(k in c) printf "  %-38s %d\n", k, c[k]}' "$OUT" | sort -k2 -rn >&2
echo "[engine-census] defer-cause census (engine's own label):" >&2
awk -F'\t' 'NR>1 && $2!="SHAPE"{c[$3]++} END{for(k in c) printf "  %-38s %d\n", k, c[k]}' "$OUT" | sort -k2 -rn >&2

echo "[engine-census] deferrals by curve-type signature (top 12):" >&2
awk -F'\t' 'NR>1 && $2!="SHAPE"{c[$10" vs "$11]++} END{for(k in c) printf "  %-30s %d\n", k, c[k]}' "$OUT" \
  | sort -k2 -rn | head -12 >&2
echo "[engine-census] deferrals that are a rigid TRANSLATE of one another:" >&2
awk -F'\t' 'NR>1 && $2!="SHAPE"{ if ($13!="-") t++; else f++ } END{printf "  translate %d   not-translate %d\n", t+0, f+0}' "$OUT" >&2

if [ "$ROWS" != "$TOTAL" ]; then
  echo "[engine-census] INCOMPLETE: $ROWS rows for $TOTAL parts" >&2
  exit 1
fi
echo "[engine-census] PASS (controls green, every part classified)" >&2
exit 0
