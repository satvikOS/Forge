#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_op_constraint_gate.sh — the op-constraint bridge, with its mutation proof.
#
# ui/test/run_ui.sh already COMPILES AND RUNS op_constraint_bridge_test (it globs
# ui/test/*_test.cpp), so the clean pass is covered there. What run_ui.sh cannot
# do is prove the gate CAN FAIL: it runs every test with no arguments and has no
# notion of a mutation. This script is that proof, and it is the only place the
# --mutate switches are exercised.
#
# It proves TWO things can fail, not one:
#   A. the DRIFT check — `gen_op_constraint_table.py --check`, which is what
#      keeps ui/include/forge/ui/ArchieOpVocabulary.hpp equal to
#      implementation/sacrosanct/archie_op_vocabulary.json. It is mutated by
#      perturbing the committed header and restoring it from a BACKUP FILE (not
#      from git: `git checkout --` on an unstaged tree reverts the whole edit,
#      which has cost a rewrite here before).
#   B. the GATE itself — all 8 --mutate cases must exit non-zero.
#
# Exit 0 iff every clean check passes AND every injected defect is caught.
# Override with CXX=g++ / MUTATIONS=n.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || {
  echo "[op-constraint] cannot resolve the repo root from ${BASH_SOURCE[0]}"; exit 1; }
[ -n "$ROOT" ] || { echo "[op-constraint] repo root resolved to the empty string"; exit 1; }
cd "$ROOT" || { echo "[op-constraint] cannot enter repo root $ROOT"; exit 1; }

CXX="${CXX:-clang++}"
# EXACT pin. A --mutate case added to op_constraint_bridge_test.cpp must move this
# number in the SAME change, or the sweep below silently stops covering it.
MUTATIONS="${MUTATIONS:-9}"
GEN="implementation/sacrosanct/tools/gen_op_constraint_table.py"
HDR="ui/include/forge/ui/ArchieOpVocabulary.hpp"
FLAGS="-std=c++20 -O2 -Wall -Wextra -Werror"
INC="-I ui/include -I ui/test"

WORK="$(mktemp -d /tmp/forge_op_constraint.XXXXXX)"
BACKUP="$WORK/ArchieOpVocabulary.hpp.orig"
cleanup() {
  # Restore the header FIRST and check the restore actually happened: a cleanup
  # that does not check its own post-condition cannot tell you it failed, and
  # leaving a mutated generated header behind would poison every later build.
  if [ -f "$BACKUP" ]; then
    cp "$BACKUP" "$ROOT/$HDR" || echo "[op-constraint] WARNING: could not restore $HDR"
    if ! cmp -s "$BACKUP" "$ROOT/$HDR"; then
      echo "[op-constraint] FATAL: $HDR was NOT restored — copy it back from $BACKUP"
      return
    fi
  fi
  rm -rf "$WORK"
  [ -d "$WORK" ] && echo "[op-constraint] WARNING: kept $WORK — rm -rf did not remove it"
}
trap cleanup EXIT

FAILURES=0
fail() { echo "[op-constraint] FAIL — $1"; FAILURES=$((FAILURES + 1)); }

# ── A. the drift check, clean ────────────────────────────────────────────────
if ! python3 "$GEN" --check; then
  fail "the committed $HDR does not match the vocabulary; run: python3 $GEN --write"
fi

# ── A2. …and the drift check MUTATED ─────────────────────────────────────────
# A check that cannot fail is not a check. Rename one allowed op in the generated
# header and the --check must refuse.
cp "$ROOT/$HDR" "$BACKUP" || { echo "[op-constraint] cannot back up $HDR"; exit 1; }
if ! sed 's/OpRow{"FILLET"/OpRow{"FILLETX"/' "$BACKUP" > "$ROOT/$HDR"; then
  fail "could not write the mutated header"
fi
if cmp -s "$BACKUP" "$ROOT/$HDR"; then
  fail "the header mutation changed nothing — the sed pattern no longer matches"
elif python3 "$GEN" --check >/dev/null 2>&1; then
  fail "MUTATION NOT CAUGHT — the drift check passed on a header with FILLET renamed"
else
  echo "[op-constraint] drift check: MUTATION CAUGHT (renamed allowed op refused)"
fi
cp "$BACKUP" "$ROOT/$HDR"
cmp -s "$BACKUP" "$ROOT/$HDR" || { echo "[op-constraint] FATAL: $HDR not restored"; exit 1; }
python3 "$GEN" --check >/dev/null || fail "the restored header does not match the vocabulary"

# ── B. build the gate ────────────────────────────────────────────────────────
BIN="$WORK/op_constraint_bridge_test"
# shellcheck disable=SC2086
if ! $CXX $FLAGS $INC ui/src/*.cpp ui/test/op_constraint_bridge_test.cpp -o "$BIN" \
     2>"$WORK/build.err"; then
  echo "[op-constraint] BUILD FAIL"; tail -30 "$WORK/build.err"; exit 1
fi

# ── B1. the clean run ────────────────────────────────────────────────────────
if "$BIN" >"$WORK/clean.out" 2>&1; then
  tail -3 "$WORK/clean.out"
else
  echo "[op-constraint] CLEAN RUN FAILED:"; cat "$WORK/clean.out"
  fail "the gate does not pass on unmutated sources"
fi

# ── B2. every mutation must be caught ────────────────────────────────────────
CAUGHT=0
for n in $(seq 1 "$MUTATIONS"); do
  if "$BIN" --mutate "$n" >"$WORK/mutate.$n.out" 2>&1; then
    echo "[op-constraint] MUTATION $n NOT CAUGHT — the gate exited 0 with the defect injected"
    tail -3 "$WORK/mutate.$n.out"
    FAILURES=$((FAILURES + 1))
  else
    CAUGHT=$((CAUGHT + 1))
    echo "[op-constraint] mutation $n caught: $(tail -1 "$WORK/mutate.$n.out")"
  fi
done

if [ "$CAUGHT" -ne "$MUTATIONS" ]; then
  fail "$CAUGHT of $MUTATIONS mutations caught"
fi

if [ "$FAILURES" -ne 0 ]; then
  echo "[op-constraint] VERDICT: FAIL — $FAILURES problem(s)"
  exit 1
fi
echo "[op-constraint] VERDICT: PASS — drift check green and mutation-proved, gate green, $CAUGHT/$MUTATIONS gate mutations caught"
