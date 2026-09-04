#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ab_native_thicksolid_bar_fixture.sh — build and run the fixture gate that pins
# what the THICKSOLID flip gate's success predicate is counting, in the shape
# test/run_ab_all.sh ratchets.
#
# WHY IT IS HERE AND NOT ONLY IN A REPORT. The measurement it guards lives in
# reports/corpus_ab/THICKSOLID_HONEST_BAR.md and was made over a 600-part corpus
# that is NOT in the repository, so nothing in CI can re-make it. This gate is
# the part of it that needs no corpus: six-face fixtures on which
# BRepOffsetAPI_MakeThickSolid returns its own argument with IsDone() true and
# BRepCheck_Analyzer VALID, which the paired coverage A/B scores as OCCT_ONLY —
# "a capability the drop deletes".
#
# A BUILD/LINK failure prints the marker run_ab_all.sh treats as RED (exit 2),
# never as "0 failures".
#
# Exit 0 iff the binary built AND every assertion held.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BIN_LINE="$(bash "$HERE/build_thicksolid_bar_fixture_gate.sh" 2>&1)"
rc=$?
BIN="${BIN_LINE##*BIN=}"
if [ "$rc" != "0" ] || [ ! -x "$BIN" ]; then
  echo "[thicksolid-bar-fixture] BUILD/LINK FAIL"
  printf '%s\n' "$BIN_LINE" | tail -30
  exit 2
fi

"$BIN"
exit $?
