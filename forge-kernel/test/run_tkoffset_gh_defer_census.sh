#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_tkoffset_gh_defer_census.sh — build + drive test/tkoffset_gh_defer_census.cpp
# over a corpus, producing the per-part FIRST BINDING DEFER for TKOffset
# families G (THICKSOLID) and H (OFFSETSHAPE).
#
# THE QUESTION THIS ANSWERS. reports/CORPUS_AB_COVERAGE.md measures that both
# families build on 1.2% of the 600-part corpus. A success RATE cannot say
# whether that is "the corpus has nothing these engines cover" or "the engines
# decline the corpus's most common input for a reason inside them" — §3.2 of
# that document records THRUSECTIONS being read the first way and measured, by a
# per-part census, to be the second, moving the row 51.5 points. It names PIPE
# and DRAFT as still un-censused. G and H were in the same position; this closes
# them.
#
# METHOD. The census TU #includes src/native/brep/NativeThickSolid.cpp, so the
# ladder is walked with the ENGINE'S OWN helpers rather than a re-derivation that
# could drift, and every part also RUNS the real public entry points. The
# invariant "the ladder said DEFER => the engine returned a null shape" is
# checked on every row and reported in the `control` column; a run with any
# CONTROL_VIOLATION is a harness result, not an engine result.
#
# The input derivation is copied from test/corpus_ab_coverage.cpp §2.3 so the
# census is over exactly the operations the coverage baseline measured.
#
# ONE PROCESS PER PART, deliberately: a SIGSEGV inside an engine then costs that
# row and not the run. The row count is printed and compared to the part count.
#
# usage: test/run_tkoffset_gh_defer_census.sh [OUTFILE]
#   env: CORPUS=<dir>  JOBS=<n>
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT_ROOT="/usr/local/opt/opencascade"
  else
    echo "[gh-census] OCCT not found at $OCCT_ROOT — 'brew install opencascade' or set OCCT_ROOT="
    exit 1
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"

CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
JOBS="${JOBS:-8}"
OUTDIR="$KERNEL/.build-gh-census"
mkdir -p "$OUTDIR" || exit 2
OUTFILE="${1:-$OUTDIR/tkoffset_gh_defer_census.tsv}"
BIN="$OUTDIR/tkoffset_gh_defer_census"

CXX="${CXX:-clang++}"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"

# NativeThickSolid.cpp is #included by the census TU and must NOT also be linked.
# NativeShapeHeal.cpp supplies occtheal::solidFromShell, which the engine calls.
# shellcheck disable=SC2086
if ! $CXX $FLAGS -I include -I "$OCCT_INC" \
     test/tkoffset_gh_defer_census.cpp \
     src/native/brep/NativeShapeHeal.cpp \
     -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" \
     -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
     -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKDESTEP -lTKXSBase \
     -o "$BIN" 2> "$OUTDIR/build.err"; then
  echo "[gh-census] BUILD FAILED:"
  tail -40 "$OUTDIR/build.err"
  exit 1
fi

if [ ! -d "$CORPUS" ]; then
  echo "[gh-census] corpus not found: $CORPUS  (set CORPUS=<dir>)"
  exit 1
fi

LIST="$OUTDIR/corpus.list"
LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort > "$LIST"
N="$(wc -l < "$LIST" | tr -d ' ')"
echo "[gh-census] corpus $CORPUS — $N parts, $JOBS jobs"

"$BIN" --header > "$OUTFILE"
xargs -P "$JOBS" -n 1 "$BIN" < "$LIST" >> "$OUTFILE" 2> "$OUTDIR/run.err"

ROWS="$(( $(wc -l < "$OUTFILE" | tr -d ' ') - 1 ))"
echo "[gh-census] parts $N   rows $ROWS   -> $OUTFILE"

# A row lost to a crashed engine is a hole in the denominator, so say so rather
# than quietly reporting a rate over a smaller set than the corpus.
if [ "$ROWS" != "$N" ]; then
  echo "[gh-census] WARNING: $(( N - ROWS )) part(s) produced no row (engine crash?) — the"
  echo "            rates below are over $ROWS parts, not $N"
fi

VIOL="$(awk -F'\t' 'NR>1 && $16 != "ok"' "$OUTFILE" | wc -l | tr -d ' ')"
echo "[gh-census] control violations (ladder said DEFER but the engine built): $VIOL"

echo
echo "first binding rung — THICKSOLID:"
awk -F'\t' 'NR>1 {c[$12]++} END {for (k in c) printf "  %-42s %5d\n", k, c[k]}' "$OUTFILE" | sort -k2 -rn
echo "first binding rung — OFFSETSHAPE:"
awk -F'\t' 'NR>1 {c[$13]++} END {for (k in c) printf "  %-42s %5d\n", k, c[k]}' "$OUTFILE" | sort -k2 -rn
echo
echo "native builds: THICKSOLID $(awk -F'\t' 'NR>1 && $14==1' "$OUTFILE" | wc -l | tr -d ' ')" \
     " OFFSETSHAPE $(awk -F'\t' 'NR>1 && $15==1' "$OUTFILE" | wc -l | tr -d ' ')" \
     " of $ROWS"

[ "$VIOL" = "0" ] || { echo "[gh-census] FAIL: the census disagrees with the engine"; exit 1; }
echo "[gh-census] PASS"
