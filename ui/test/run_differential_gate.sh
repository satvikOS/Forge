#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_differential_gate.sh — the kernel-free half of the two-path differential,
# WITH ITS MUTATION PROOF.
#
# ui/test/run_ui.sh already COMPILES AND RUNS differential_gate_test (it globs
# ui/test/*_test.cpp), so the clean pass is covered there. What run_ui.sh cannot
# do is prove the gate CAN FAIL: it runs every test with no arguments and has no
# notion of a mutation. This script is that proof, and it is the only place the
# --mutate switches are exercised.
#
# A gate never proven to fail is decoration. Every mutation below injects ONE
# deliberate divergence into ONE of the two arms and must exit non-zero.
#
# Exit 0 iff the clean pass is green AND every injected divergence is caught.
# Override with CXX=g++ / MUTATIONS=n.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || {
  echo "[differential] cannot resolve the repo root from ${BASH_SOURCE[0]}"; exit 1; }
[ -n "$ROOT" ] || { echo "[differential] repo root resolved to the empty string"; exit 1; }
cd "$ROOT" || { echo "[differential] cannot enter repo root $ROOT"; exit 1; }

CXX="${CXX:-clang++}"
# EXACT pin, and it must equal difftest::kMutationCount in
# ui/test/differential_corpus.hpp. A Mutation added there without moving this
# number would be a case the sweep silently stops covering — which is how a
# mutation suite quietly becomes decoration.
MUTATIONS="${MUTATIONS:-7}"
FLAGS="-std=c++20 -O1 -Wall -Wextra -Werror"
INC="-I ui/include -I ui/test"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/forge_differential.XXXXXX")"
cleanup() {
  rm -rf "$WORK"
  [ -d "$WORK" ] && echo "[differential] WARNING: kept $WORK — rm -rf did not remove it"
}
trap cleanup EXIT

BIN="$WORK/differential_gate"
FAILURES=0
fail() { echo "[differential] FAIL — $1"; FAILURES=$((FAILURES + 1)); }

# ── 1. build ─────────────────────────────────────────────────────────────────
# shellcheck disable=SC2086
if ! $CXX $FLAGS $INC ui/src/*.cpp ui/test/differential_gate_test.cpp -o "$BIN" \
     2>"$WORK/build.err"; then
  echo "[differential] the gate did not BUILD. A gate that cannot build cannot fail."
  tail -30 "$WORK/build.err"
  exit 3
fi

# ── 2. the pin in this script must equal the pin in the header ───────────────
# Asked of the BINARY, so there is exactly one definition of "how many mutations
# exist". Two numbers for one fact is the desync this whole gate exists to
# prevent, and it has bitten this repo nine times.
DECLARED="$("$BIN" --mutation-count 2>/dev/null)"
if [ "$DECLARED" != "$MUTATIONS" ]; then
  fail "differential_corpus.hpp declares ${DECLARED:-<unreadable>} mutations and this script sweeps $MUTATIONS"
fi

# ── 3. the clean pass ────────────────────────────────────────────────────────
if ! "$BIN" >"$WORK/clean.out" 2>&1; then
  echo "[differential] the CLEAN run is RED:"
  cat "$WORK/clean.out"
  fail "clean run"
else
  grep -E '^\[differential\]' "$WORK/clean.out"
fi

# ── 4. every mutation must be caught ─────────────────────────────────────────
i=1
while [ "$i" -le "$MUTATIONS" ]; do
  if "$BIN" --mutate "$i" >"$WORK/m$i.out" 2>&1; then
    echo "[differential] mutation $i NOT CAUGHT — the gate stayed green with a"
    echo "               deliberate divergence injected. Output:"
    cat "$WORK/m$i.out"
    fail "mutation $i not caught"
  else
    name="$(sed -n '1s/.*mutation=//p' "$WORK/m$i.out")"
    verdict="$(tail -1 "$WORK/m$i.out")"
    echo "[differential] mutation $i caught: ${name:-?} — $verdict"
  fi
  i=$((i + 1))
done

if [ "$FAILURES" -ne 0 ]; then
  echo "[differential] VERDICT: RED — $FAILURES failure(s)"
  exit 1
fi
echo "[differential] VERDICT: PASS — clean run green, $MUTATIONS/$MUTATIONS injected divergences caught"
exit 0
