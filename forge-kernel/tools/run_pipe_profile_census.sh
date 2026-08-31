#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_pipe_profile_census.sh — build and run tools/pipe_profile_census.cpp over a
# corpus of STEP parts, and print the two things it exists to answer:
#
#   1. WHAT SHAPE is the profile face family E is handed, per part;
#   2. does the ARC-CHAIN DECOMPOSITION reproduce OCCT's own area and centroid
#      for that face — the check that the ADD/SUB bulge decision is right on
#      every arc of every ring, made WITHOUT building a single solid.
#
# CORPUS defaults to the same 600 reference solids test/run_corpus_ab_coverage.sh
# uses. Override with CORPUS=<dir>.
#
# usage: tools/run_pipe_profile_census.sh [OUTFILE]
# Exit 0 iff every part produced a row.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
OUT="${1:-$KERNEL/.build-corpus-ab/pipe_profile_census.jsonl}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT="/usr/local/opt/opencascade"
  else
    echo "FATAL: OCCT not found (set OCCT_ROOT=)" >&2; exit 2
  fi
fi
if [ ! -d "$CORPUS" ]; then echo "FATAL: corpus not found: $CORPUS" >&2; exit 2; fi

mkdir -p "$(dirname "$OUT")" || exit 2
BIN="$(dirname "$OUT")/pipe_profile_census"
echo "[census] building $BIN"
if ! clang++ -std=c++20 -O2 -Wall -Wextra -Werror \
      -I "$OCCT/include/opencascade" tools/pipe_profile_census.cpp \
      -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" \
      -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
      -lTKGeomAlgo -lTKDESTEP -lTKXSBase -o "$BIN" 2>"$OUT.build.err"; then
  echo "[census] BUILD FAILED"; sed -n '1,40p' "$OUT.build.err"; exit 1
fi

FILES="$OUT.files"
ls "$CORPUS"/*.step 2>/dev/null | LC_ALL=C sort > "$FILES"
N=$(grep -c . "$FILES" || true)
if [ "${N:-0}" -eq 0 ]; then echo "FATAL: no .step in $CORPUS" >&2; exit 2; fi
echo "[census] $N parts from $CORPUS"
xargs "$BIN" < "$FILES" > "$OUT" || true
ROWS=$(grep -c . "$OUT" || true)
echo "[census] $ROWS rows -> $OUT"

python3 - "$OUT" <<'PY'
import json, sys, collections
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
arc = [r for r in rows if r.get("arcchain") == 1]
bad = [r for r in rows if r.get("arcchain") == 0]
err = [r for r in rows if "err" in r]
print("  parts                       %d" % len(rows))
print("  every ring a LINE/ARC chain %d" % len(arc))
print("  NOT an arc chain            %d  %s" % (len(bad), dict(collections.Counter(r["why"] for r in bad))))
if err: print("  read errors                 %d" % len(err))
if arc:
    ra = max(r["rel_area"] for r in arc)
    dc = max(r["d_centroid"] for r in arc)
    over = sum(1 for r in arc if r["rel_area"] > 1e-9)
    print("  CLOSED FORM vs OCCT: worst relative AREA %.3e, worst CENTROID %.3e mm" % (ra, dc))
    print("  parts disagreeing by more than 1e-9 relative: %d" % over)
PY
[ "${ROWS:-0}" -eq "${N:-1}" ] || { echo "[census] FAIL: $ROWS rows for $N parts"; exit 1; }
exit 0
