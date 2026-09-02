#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ci_desktop_gate.sh — run forge-desktop's gates and JUDGE THE OUTPUT.
#
# run_desktop.sh builds the app, runs the three headless gates and proves every
# injected mutation turns its gate red. What it does NOT do is defend its own
# exit status: it runs under `set -uo pipefail` with no `set -e`, so its status
# is the status of whatever ran last, and a run that fell out of its own middle
# would exit 0 with the work half done. An exit code is not a result.
#
# So this script reads the OUTPUT and requires THREE things to hold together:
#
#   1. run_desktop.sh exited 0;
#   2. no line says a mutation STAYED GREEN — an unfalsifiable check is not a
#      check, and run_desktop.sh prints that phrase before deciding its own
#      verdict;
#   3. the exact final verdict line is present, naming EXPECTED_MUTATIONS.
#
# EXPECTED_MUTATIONS is an EXACT value and deliberately NOT an environment
# override and NOT a floor. Adding a --mutate case to run_desktop.sh means
# changing this number in the SAME commit, and REMOVING one turns this red —
# which is the whole point, because mutation coverage that shrinks silently is
# indistinguishable from mutation coverage that was never there. Same idiom as
# the NAFEMS, s0 and native-A/B ratchets in .github/workflows/kernel-tests.yml.
#
# CI runs this rather than run_desktop.sh directly so that CI and a developer's
# machine cannot drift about what "passing" means. Its own red paths are driven
# with stubs by ci_desktop_gate_selftest.sh — a guard whose failure path cannot
# produce a non-zero exit is not a guard.
#
# Exit codes
#   0  GREEN — the gates ran, passed, and their falsifiability is intact.
#   1  RED   — any of the three conditions above failed, or the script that was
#              supposed to do the work is not there. A check that could not run
#              is not a check that passed.
#
# FORGE_DESKTOP_ROOT overrides the repository root. It exists for the self-test,
# which points this script at a tree of stubs; leave it unset in real use.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

# 40 = document 8 + frame 9 + copilot 8 + update 7 + click 8. DERIVED on the
# MERGED tree by counting run_desktop.sh's own run_gate arguments, not taken
# from either parent. This number has now been contested at two separate merges
# and the SIDES SWAPPED between them, which is the whole argument for measuring
# it: at the merge that first wrote this line the incoming branch said 40 and the
# base said 39; at the app/differential-gate-v2 merge it is the other way round --
# this branch says 39 and the base says 40. Both times the difference is the same
# single mutation, click 8, the camera pull path (`g_mutation != 8` in
# click_gate.cpp), and every other gate's list is identical on both sides.
#
# Re-measured here rather than inherited: the method was calibrated by counting
# run_gate's arguments on BOTH parents, where it reproduced 39 and 40 exactly, and
# then run on the merged tree, which gives 40 -- because click_gate.cpp on the
# merged tree HAS mutation 8 (grep says so; that is the confirmation, not the
# count). Picking a side would have been red in one direction or the other. This
# is D-028's failure mode, and the method that catches it is to COUNT on the tree
# being committed rather than to inherit a number.
EXPECTED_MUTATIONS=40

ROOT="${FORGE_DESKTOP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
LOG="${FORGE_DESKTOP_GATE_LOG:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/forge_desktop_ci_gate.log}"
SCRIPT="$ROOT/forge-desktop/test/run_desktop.sh"
VERDICT="[desktop] ALL FORGE DESKTOP GATES PASS, and all ${EXPECTED_MUTATIONS} mutations proved red-then-green"

red() {
  echo "[ci-desktop] RED: $*"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::$*"; fi
  return 0
}

if ! cd "$ROOT" 2>/dev/null; then
  red "cannot enter the repository root '$ROOT'"
  exit 1
fi
if [ ! -f "$SCRIPT" ]; then
  red "$SCRIPT is missing; a gate that is not there did not pass"
  exit 1
fi

bash "$SCRIPT" 2>&1 | tee "$LOG"
# $? after a PIPELINE is the LAST command's status, which here is tee's. The
# only status that means anything is run_desktop.sh's own.
rc="${PIPESTATUS[0]}"

if [ "$rc" -ne 0 ]; then
  red "run_desktop.sh exited $rc — a forge-desktop gate, or the build behind it, failed"
  exit 1
fi

if grep -q 'STAYED GREEN' "$LOG"; then
  red "a mutation did not turn its gate red; an unfalsifiable check is not a check"
  grep 'STAYED GREEN' "$LOG"
  exit 1
fi

if ! grep -qxF -- "$VERDICT" "$LOG"; then
  red "run_desktop.sh exited 0 without printing its exact verdict line, so nothing here is proved"
  echo "[ci-desktop] expected : $VERDICT"
  echo "[ci-desktop] last line: $(tail -1 "$LOG")"
  echo "[ci-desktop] if the mutation count CHANGED on purpose, update"
  echo "[ci-desktop] EXPECTED_MUTATIONS in this file in the SAME commit. It is an"
  echo "[ci-desktop] exact value, never a floor."
  exit 1
fi

echo "[ci-desktop] GREEN — verdict confirmed: $VERDICT"
