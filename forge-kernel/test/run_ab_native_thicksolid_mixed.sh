#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ab_native_thicksolid_mixed.sh — build and run the MIXED thick-solid
# closed-form gate, in the shape test/run_ab_all.sh ratchets.
#
# WHY IT IS HERE AND NOT ONLY IN A REPORT. This gate guards three exact
# constructions added to src/native/brep/NativeThickSolid.cpp after the 600-part
# defer census (reports/corpus_ab/THICKSOLID_ATTRIBUTION.md): polygon planar
# wires, the coplanar face split and its cylindrical riser, and rank-deficient
# polygon corners. run_ab_all.sh exists because two harnesses once stopped
# LINKING and 541 assertions silently stopped running; a new gate that lives only
# in a build script nobody calls has exactly that failure mode from birth.
#
# A BUILD/LINK failure prints the marker run_ab_all.sh treats as RED (exit 2),
# never as "0 failures".
#
# Exit 0 iff the binary built AND every assertion held.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KERNEL="$(cd "$HERE/.." && pwd)"

BIN_LINE="$(bash "$HERE/build_thicksolid_mixed_closedform.sh" 2>&1)"
rc=$?
BIN="${BIN_LINE##*BIN=}"
if [ "$rc" != "0" ] || [ ! -x "$BIN" ]; then
  echo "[thicksolid-mixed] BUILD/LINK FAIL"
  printf '%s\n' "$BIN_LINE" | tail -30
  exit 2
fi

"$BIN"
exit $?
