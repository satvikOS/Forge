#!/usr/bin/env bash
# ============================================================================
# loopback_sleep_test.sh — proves loopback_live_check.sh's port-wait actually
# WAITS on a host without perl.
#
# The wait used `perl -e 'select undef,undef,undef,0.1' 2>/dev/null || true`.
# Where perl is absent that command fails instantly and `|| true` swallows it,
# so the 50-iteration loop advertised as a 5-second grace period completed in
# ~0.13s of pure spinning and a stub that took longer than that to bind was
# reported as "stub did not report a port" — a green transport failing red.
#
# The delay is read OUT of the real script rather than copied, so the test
# cannot pass while the script still spins.
# ============================================================================
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# LOOPBACK_CHECK lets the gate be pointed at an older copy, so "RED before, GREEN after" is
# something anyone can re-run rather than take on trust.
CHECK="${LOOPBACK_CHECK:-$HERE/loopback_live_check.sh}"
[ -f "$CHECK" ] || { echo "missing $CHECK"; exit 1; }

PASS=0
FAIL=0

echo "=== case 1: the script no longer uses perl as a sleep ==="
# Comment lines are stripped first: the fix documents the old line in a comment, and a doc
# mention must never be counted as a call site (the same rule occt_callsite_census.sh states).
PERL_SLEEP="$(grep -vE '^[[:space:]]*#' "$CHECK" | grep -cE "perl +-e +.select" | tr -d ' ')"
if [ "$PERL_SLEEP" != "0" ]; then
  echo "  FAIL  case1: $PERL_SLEEP executable 'perl -e select' delay(s) still present"; FAIL=$((FAIL+1))
else
  echo "  PASS  case1: 0 executable 'perl -e select' delays"; PASS=$((PASS+1))
fi

echo "=== case 2: the delay actually delays with perl OFF the PATH ==="
# Extract the real nap definition from the script under test.
NAPDEF="$(grep -m1 '^nap() {' "$CHECK")"
if [ -z "$NAPDEF" ]; then
  echo "  FAIL  case2: no nap() definition found in $CHECK"; FAIL=$((FAIL+1))
else
  SHIM="$(mktemp -d "${TMPDIR:-/tmp}/noperl.XXXXXX")"
  trap 'rm -rf "$SHIM"' EXIT
  # A PATH holding only what the delay itself needs — and deliberately no perl.
  for b in sleep date; do
    p="$(command -v "$b")" && ln -sf "$p" "$SHIM/$b"
  done
  ITERS=20
  ELAPSED_MS="$(PATH="$SHIM" "$BASH" -c "
    $NAPDEF
    command -v perl >/dev/null && { echo PERL_STILL_PRESENT; exit 1; }
    t0=\$(date +%s%N)
    i=0; while [ \$i -lt $ITERS ]; do nap; i=\$((i+1)); done
    t1=\$(date +%s%N)
    echo \$(( (t1 - t0) / 1000000 ))
  " 2>/dev/null)"
  # 20 x 0.1s = 2000ms nominal. Assert at least 1500ms: generous against a slow
  # or coarse-grained sleep, but two orders of magnitude above the ~50ms that a
  # spinning loop produces.
  if [ "$ELAPSED_MS" = "PERL_STILL_PRESENT" ] || [ -z "$ELAPSED_MS" ]; then
    echo "  FAIL  case2: could not build a perl-free environment (got '$ELAPSED_MS')"; FAIL=$((FAIL+1))
  elif [ "$ELAPSED_MS" -ge 1500 ]; then
    echo "  PASS  case2: $ITERS naps took ${ELAPSED_MS}ms (>= 1500ms floor)"; PASS=$((PASS+1))
  else
    echo "  FAIL  case2: $ITERS naps took only ${ELAPSED_MS}ms — the loop is spinning"; FAIL=$((FAIL+1))
  fi
fi

echo ""
echo "loopback sleep gate: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
