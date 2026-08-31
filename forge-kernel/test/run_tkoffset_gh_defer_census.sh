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
# Resolve a caller-supplied OUTFILE against the CALLER's cwd, BEFORE the cd
# below. Without this a relative path silently lands under forge-kernel/ instead
# of where the caller meant, and every later awk reads a file that is not there.
CALLER_PWD="$PWD"
OUT_ARG="${1:-}"
if [ -n "$OUT_ARG" ]; then
  case "$OUT_ARG" in
    /*) : ;;
    *)  OUT_ARG="$CALLER_PWD/$OUT_ARG" ;;
  esac
fi
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
OUTFILE="${OUT_ARG:-$OUTDIR/tkoffset_gh_defer_census.tsv}"
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

# A diagnostic run must never be mistaken for the baseline, so say so loudly and
# in the output file's own name rather than only here.
if [ "${FORGE_GH_CENSUS_SKIP_S2_PLANAR:-0}" = "1" ]; then
  echo "[gh-census] ★ DIAGNOSTIC MODE: the S2 planar-wire rule is SUPPRESSED IN THE"
  echo "[gh-census]   LADDER (not in the engine). The rungs below are WHAT WOULD BIND"
  echo "[gh-census]   NEXT if that rule were lifted — they are NOT this family's"
  echo "[gh-census]   first-binding-rung table and must not be quoted as one."
fi

# Rows are SORTED before they land. With xargs -P the completion order is a race,
# so an unsorted file differs run to run in row order while being identical in
# content — which makes a committed artefact impossible to diff and invites
# someone to conclude the census is non-deterministic when it is not.
if ! "$BIN" --header > "$OUTFILE"; then
  echo "[gh-census] FATAL: cannot write $OUTFILE"
  exit 2
fi
xargs -P "$JOBS" -n 1 "$BIN" < "$LIST" 2> "$OUTDIR/run.err" | LC_ALL=C sort >> "$OUTFILE"

if [ ! -s "$OUTFILE" ]; then
  echo "[gh-census] FATAL: $OUTFILE is empty or missing after the run"
  exit 2
fi
ROWS="$(( $(wc -l < "$OUTFILE" | tr -d ' ') - 1 ))"
echo "[gh-census] parts $N   rows $ROWS   -> $OUTFILE"
# A run that produced NO rows must never reach the PASS line. This is not
# hypothetical: with a relative OUTFILE resolving under forge-kernel/ instead of
# the caller's cwd, every awk below read a missing file, the row count came out
# as -1, and the script still printed PASS. A gate that cannot see its own
# output cannot fail.
if [ "$ROWS" -lt 1 ]; then
  echo "[gh-census] FATAL: 0 rows — the run produced nothing to summarise"
  exit 2
fi

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
