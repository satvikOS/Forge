#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_pipeshell_defer_census.sh — one row per corpus part naming the EXACT curve
# types on the profile the PIPESHELL A/B hands the native engine.
#
# WHY. The corpus A/B measured native PIPESHELL at 309/600 with all 291 declines
# carrying ONE FK_DEFER label, `prof_edge_not_line`. That label is a fact about
# the engine's precondition, not about the corpus: it says the profile has a
# non-line edge and says nothing about WHICH kind. "Lines and circular arcs" and
# "B-spline blobs" are opposite engineering answers — the first is a bounded
# transport, the second is not — and they were indistinguishable from the A/B
# alone. This census is what tells them apart.
#
# The census binary runs its own two-direction self-test FIRST and this script
# treats a self-test failure as fatal, so no corpus row can exist behind a
# classifier that was never shown to discriminate.
#
# usage:  test/run_pipeshell_defer_census.sh [OUTFILE]
#   env:  CORPUS=<dir>  OCCT_ROOT=<dir>
# Exit 0 iff the self-test passed and every part produced a row.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
OUT="${1:-$KERNEL/.build-corpus-ab/pipeshell_defer_census.tsv}"
OBJDIR="$KERNEL/.build-corpus-ab"
BIN="$OBJDIR/pipeshell_defer_census"
LIB="$OBJDIR/libforge_native_ab.a"

if [ ! -d "$CORPUS" ]; then echo "FATAL: corpus dir not found: $CORPUS" >&2; exit 2; fi

# The engine archive is built by build_corpus_ab_coverage.sh; reuse it rather
# than compiling 154 translation units a second time.
if [ ! -f "$LIB" ]; then
  echo "[ps-census] building the native archive via build_corpus_ab_coverage.sh" >&2
  bash "$KERNEL/test/build_corpus_ab_coverage.sh" >&2 || exit 1
fi
[ -f "$LIB" ] || { echo "FATAL: no $LIB" >&2; exit 1; }

CXX="${CXX:-clang++}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || OCCT="/usr/local/opt/opencascade"
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || {
  echo "FATAL: OCCT not found" >&2; exit 2; }

if ! $CXX -std=c++20 -O2 -DFORGE_NATIVE_BREP -I include -I "$OCCT/include/opencascade" \
     test/pipeshell_defer_census.cpp "$LIB" \
     -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" \
     -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
     -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
     -lTKDESTEP -lTKXSBase -o "$BIN" 2> "$OBJDIR/ps_census_build.err"; then
  echo "[ps-census] BUILD FAILED:" >&2; tail -40 "$OBJDIR/ps_census_build.err" >&2; exit 1
fi

echo "[ps-census] self-test (a classifier that cannot discriminate proves nothing):" >&2
if ! "$BIN" --selftest >&2; then
  echo "[ps-census] SELF-TEST FAILED — no corpus row will be written" >&2; exit 1
fi

: > "$OUT"
printf 'part\tclass\tn_edge\tn_line\tn_circle\tn_ellipse\tn_bspline\tn_bezier\tn_other\tplanar_face_ok\tengine\treason\n' >> "$OUT"
n=0
LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort > "$OBJDIR/ps_census.list"
while IFS= read -r step; do
  n=$((n + 1))
  name="$(basename "$step" .step)"
  # stderr goes to a LOG, never to /dev/null: the engine's FORGE_GEN_ORACLE_REPORT
  # channel prints the closed-form volume ratio there, and that is how the
  # oracle's tolerance was derived rather than chosen.
  "$BIN" "$step" --name="$name" >> "$OUT" 2>> "$OUT.stderr" || \
    printf '%s\tPROC_FAIL\n' "$name" >> "$OUT"
done < "$OBJDIR/ps_census.list"
echo "[ps-census] $n parts -> $OUT" >&2

awk -F'\t' 'NR>1 {c[$2]++; if ($11=="SOLID") s[$2]++} END {
  printf "\n  class            parts   engine SOLID\n";
  for (k in c) printf "  %-14s %6d %13d\n", k, c[k], s[k]+0;
}' "$OUT" | sort -k2 -rn
exit 0
