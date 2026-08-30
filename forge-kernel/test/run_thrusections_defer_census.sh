#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_thrusections_defer_census.sh — WHY does the native ruled loft decline a
# part? One row per corpus part, with the cause named.
#
# THE QUESTION THIS ANSWERS. The corpus A/B reports a per-family SUCCESS RATE.
# A rate of zero is ambiguous in exactly the way that matters: it is equally
# consistent with "the corpus has nothing this engine covers" and with "the
# engine has a defect on the corpus's most common input". THRUSECTIONS measured
# 0/600 and was recorded in CMakeLists.txt as the first of those. It was the
# second — 309 of the 600 carry two 4-vertex all-line-edge polygon sections, and
# the engine was pairing their vertices by raw BRepTools_WireExplorer index
# without the reorient/re-origin step BRepOffsetAPI_ThruSections performs first.
# This census is what distinguished the two readings, and it is committed so the
# distinction can be re-made rather than re-argued.
#
# ★ THE CENSUS CARRIES ITS OWN CONTROLS (--selftest, run first here and fatal).
#   A classifier that always says DEFER agreeing with an engine that always
#   returns NULL is two constants agreeing; it proves nothing. The self-test
#   therefore asserts a POSITIVE case (a prism and a frustum: classifier says the
#   quads are planar AND the engine returns a solid whose volume equals the
#   prismatoid closed form to 1e-6 relative) and a NEGATIVE case (a 45-degree
#   twisted pair: classifier says non-planar AND the engine returns null).
#
# COLUMNS (tab separated)
#   part  defer_reason  n_ring1  n_ring2  badQuads_raw  badQuads_best  angle  adj  engine
# where badQuads_best is the minimum over EVERY rotation x reflection of ring 2 —
# the ceiling on what any correspondence fix could reach — and `engine` is the
# real forge::occtloft::thruSections outcome on the same two wires.
#
# usage:  test/run_thrusections_defer_census.sh [OUTFILE]
#   env:  CORPUS=<dir>  OCCT_ROOT=<dir>
# Exit 0 iff the self-test passed and every part produced a row.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
OUT="${1:-$KERNEL/.build-corpus-ab/thrusections_defer_census.tsv}"
OBJDIR="$KERNEL/.build-corpus-ab"
BIN="$OBJDIR/thrusections_defer_census"
LIB="$OBJDIR/libforge_native_ab.a"

if [ ! -d "$CORPUS" ]; then echo "FATAL: corpus dir not found: $CORPUS" >&2; exit 2; fi

# The engine archive is built by build_corpus_ab_coverage.sh; reuse it rather
# than compiling 154 translation units a second time.
if [ ! -f "$LIB" ]; then
  echo "[census] building the native archive via build_corpus_ab_coverage.sh" >&2
  bash "$KERNEL/test/build_corpus_ab_coverage.sh" >/dev/null || { echo "FATAL: archive build failed" >&2; exit 1; }
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

echo "[census] compiling test/thrusections_defer_census.cpp" >&2
if ! clang++ -std=c++20 -O2 -DFORGE_NATIVE_BREP \
      -I "$KERNEL/include" -I "$OCCT/include/opencascade" \
      "$KERNEL/test/thrusections_defer_census.cpp" "$LIB" \
      -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" \
      -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
      -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
      -lTKDESTEP -lTKXSBase -o "$BIN" 2> "$OBJDIR/census_build.err"; then
  echo "[census] BUILD FAILED:" >&2; tail -30 "$OBJDIR/census_build.err" >&2; exit 1
fi

# ── controls first. A census whose classifier cannot be seen to say BOTH
#    answers is not evidence, so this is fatal rather than advisory.
echo "[census] controls:" >&2
if ! "$BIN" --selftest >&2; then
  echo "[census] CONTROLS FAILED — the census is inert, refusing to emit rows" >&2
  exit 1
fi

LIST="$OBJDIR/census_corpus.list"
LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort > "$LIST"
TOTAL="$(wc -l < "$LIST" | tr -d ' ')"
if [ "$TOTAL" -eq 0 ]; then echo "FATAL: no .step files in $CORPUS" >&2; exit 2; fi

TMP="$OUT.rows"
printf 'part\tdefer_reason\tn_ring1\tn_ring2\tbadQuads_raw_index\tbadQuads_best_correspondence\tnormal_angle_deg\tface_adjacency\tengine\n' > "$OUT"
xargs -n 20 "$BIN" < "$LIST" > "$TMP" 2>"$OBJDIR/census_run.err"
cat "$TMP" >> "$OUT"
ROWS="$(wc -l < "$TMP" | tr -d ' ')"
rm -f "$TMP"

echo >&2
echo "[census] $ROWS rows for $TOTAL parts -> $OUT" >&2
echo "[census] defer-cause census:" >&2
# Read the OUTPUT, never an exit code: print the table and let it be judged.
awk -F'\t' 'NR>1{c[$2]++} END{for(k in c) printf "  %-34s %d\n", k, c[k]}' "$OUT" | sort -k2 -rn >&2
echo "[census] engine outcome:" >&2
awk -F'\t' 'NR>1{c[$9]++} END{for(k in c) printf "  %-34s %d\n", k, c[k]}' "$OUT" | sort -k2 -rn >&2

if [ "$ROWS" != "$TOTAL" ]; then
  echo "[census] INCOMPLETE: $ROWS rows for $TOTAL parts" >&2
  exit 1
fi
echo "[census] PASS (controls green, every part classified)" >&2
exit 0
