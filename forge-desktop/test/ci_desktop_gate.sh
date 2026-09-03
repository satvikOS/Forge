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

# from either parent. This number has now been contested at FOUR merges and the
# sides have swapped between them, which is the whole argument for measuring it on
# the tree being committed rather than inheriting it.
#
# AT THIS MERGE (origin/archdisc into work/file-exchange-step) the parents disagree
# and BOTH are right about their own half. This branch said 45 (document 8 +
# file_exchange 5 + frame 9 + copilot 8 + update 7 + click 8). The base said 43
# (document 8 + frame 12 + copilot 8 + update 7 + click 8) because #189 added frame
# mutations 10, 11 and 12. NEITHER is correct on the merged tree, which carries the
# file-exchange gate AND the three new frame mutations. Counting run_desktop.sh's
# own run_gate arguments on the MERGED tree gives:
#     document 8 + file_exchange 5 + frame 12 + copilot 8 + update 7 + click 8 = 48
# (ir_pipeline_gate and isolation_gate take no mutation arguments.)
#
# ★ The merge of run_desktop.sh was the real hazard here, not this number. HEAD kept
#   frame_gate at 1..9 while adding the file-exchange line; the base had frame_gate
#   at 1..12. Taking either side WHOLE would have silently dropped real mutations —
#   either the five file-exchange ones or the three frame ones — and the suite would
#   have gone green while testing less than it did before the merge.
EXPECTED_MUTATIONS=56
# MERGED tree by counting run_desktop.sh's own run_gate arguments, not taken
# from either parent. This number has been contested at THREE merges now and the
# sides have swapped between them, which is the whole argument for measuring it
# on the tree being committed rather than inheriting it.
#
# AT THIS MERGE (origin/archdisc into app/forge-cpp-user-ready) the parents
# DISAGREE: this branch pins 43, the base pins 40. NEITHER was taken. Counting
# run_desktop.sh's own run_gate arguments on the MERGED tree gives:
#     document 8 + frame 12 + copilot 8 + update 7 + click 8 = 43
# (ir_pipeline_gate and isolation_gate take no mutation arguments.)
#
# Both parents are right about their own half. The base's 40 is correct FOR THE
# BASE, where frame_gate still runs 1..9; this branch adds frame mutations 10, 11
# and 12 -- a worker CONFIGURED is not distinguished from one absent, the frame
# never dispatches the deferred Open Recent request, and a statement row is never
# clicked so Extrude has no Sketch to consume. 40 + 3 = 43.
#
# The confirmation, not the count: click mutation 8 -- the camera pull path,
# `g_mutation != 8` in click_gate.cpp -- is PRESENT on the merged tree, which is
# what the earlier disagreement turned on. This is D-028's failure mode, and the
# method that catches it is to COUNT on the tree being committed rather than to
# inherit a number.
# ── 2026-09-02: 40 -> 45. The file-exchange gate joined run_desktop.sh with five
# mutations, so this number moves in the SAME commit, which is exactly what this
# constant exists to force. DERIVED on this tree, not incremented on faith --
# `awk '/^run_gate /{total+=NF-2} END{print total}' forge-desktop/test/run_desktop.sh`
# prints 45, made of: ir_pipeline 0 + document 8 + file_exchange 5 + frame 9 +
# copilot 8 + update 7 + click 8 + isolation 0.
# (a stale EXPECTED_MUTATIONS from one parent was removed here at the merge —
#  in bash the LAST assignment wins, so leaving both sides' lines in place would
#  have silently restored a parent's number over the one counted on this tree.)
# `g_mutation != 8` in click_gate.cpp -- is PRESENT on the merged tree (four
# sites), which is what the earlier disagreements turned on. This is D-028's
# failure mode; the method that catches it is to COUNT on the merged tree.
# (a stale EXPECTED_MUTATIONS from one parent was removed here at the merge —
#  in bash the LAST assignment wins, so leaving both sides' lines in place would
#  have silently restored a parent's number over the one counted on this tree.)

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
