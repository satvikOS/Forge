#!/usr/bin/env bash
# ============================================================================
# occt_callsite_census_test.sh — proves the census MEASURES the tree it is run
# against, and REFUSES rather than reporting zero for a tree that is not there.
#
# The census is how "OCCT call sites -> zero" is scored. Its ROOT used to
# default to an absolute path inside an ephemeral agent worktree; once that
# worktree was reaped, every grep matched nothing and the census printed
# "sites=0" for every class — a fabricated clean result on the one metric it
# exists to produce. A zero is the ANSWER this tool is looking for, which is
# exactly why a zero it did not earn is the dangerous failure.
#
# Case 1 asserts the default ROOT reproduces an independently computed count.
# Case 2 asserts a missing tree is an error, never a silent 0.
# ============================================================================
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# CENSUS_SCRIPT lets the gate be pointed at an older copy, so "RED before, GREEN after" is
# something anyone can re-run rather than take on trust.
CENSUS="${CENSUS_SCRIPT:-$REPO/tools/occt_callsite_census.sh}"
[ -f "$CENSUS" ] || { echo "missing $CENSUS"; exit 1; }

PASS=0
FAIL=0

assert_eq() {  # assert_eq <label> <actual> <expected>
  if [ "$2" = "$3" ]; then
    echo "  PASS  $1: '$3'"; PASS=$((PASS+1))
  else
    echo "  FAIL  $1: got '$2', expected '$3'"; FAIL=$((FAIL+1))
  fi
}

# Pick a class the tree definitely uses; the reference count is computed here,
# independently of the script, by the same definition its header states.
CLS=gp_Pnt
REFERENCE="$(grep -rn --include='*.cpp' --include='*.hpp' --include='*.h' --include='*.hxx' \
               -w "$CLS" "$REPO/forge-kernel/src" "$REPO/forge-kernel/include" 2>/dev/null \
             | grep -v -E ':[0-9]+: *(//|\*|/\*)' | grep -c . | tr -d ' ')"

echo "=== case 1: the DEFAULT ROOT measures this checkout ==="
if [ "$REFERENCE" = "0" ]; then
  echo "  SKIP  case1: this checkout has no $CLS references to measure against"
else
  # Run with ROOT unset — that default is the thing under test.
  OUT="$(printf '%s\n' "$CLS" | env -u ROOT bash "$CENSUS" 2>&1)"
  GOT="$(printf '%s' "$OUT" | sed -n "s/^$CLS  *sites=\([0-9][0-9]*\).*/\1/p")"
  assert_eq "case1 default-ROOT site count for $CLS" "$GOT" "$REFERENCE"
  if [ "$GOT" = "0" ]; then
    echo "  FAIL  case1: the census reported 0 for a class with $REFERENCE real call sites"
    FAIL=$((FAIL+1))
  else
    echo "  PASS  case1: the count is non-zero, so the grep reached a real tree"
    PASS=$((PASS+1))
  fi
fi

echo "=== case 2: a ROOT that does not exist is an ERROR, not a zero ==="
OUT="$(printf '%s\n' "$CLS" | ROOT=/nonexistent/forge-kernel bash "$CENSUS" 2>&1)"
RC=$?
assert_eq "case2 exit status" "$RC" "2"
if printf '%s' "$OUT" | grep -q 'sites=0'; then
  echo "  FAIL  case2: it printed 'sites=0' for a tree that is not there"; FAIL=$((FAIL+1))
else
  echo "  PASS  case2: no fabricated 'sites=0' line"; PASS=$((PASS+1))
fi
if printf '%s' "$OUT" | grep -q 'refusing to report 0 call'; then
  echo "  PASS  case2: it says why it refused"; PASS=$((PASS+1))
else
  echo "  FAIL  case2: no refusal message; got: $OUT"; FAIL=$((FAIL+1))
fi

echo ""
echo "occt_callsite_census gate: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
