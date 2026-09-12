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
#   3. the exact final verdict line is present, naming EXPECTED_MUTATIONS --
#      or, when a gate SKIPPED for want of a GPU, the skipped form of that line,
#      whose RUN + NOT RUN must still add up to EXPECTED_MUTATIONS exactly. See
#      THE SKIPPED VERDICT below for why that case is green and loud rather than
#      red, and why it cannot be used to hide a shrinking mutation count.
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
# ★ 2026-09-03: + file_dialog 3 = 51. Counted the same way, on this tree:
#     document 8 + file_exchange 5 + file_dialog 3 + frame 12 + copilot 8
#     + update 7 + click 8 = 51
#
# ★ The merge of run_desktop.sh was the real hazard here, not this number. HEAD kept
#   frame_gate at 1..9 while adding the file-exchange line; the base had frame_gate
#   at 1..12. Taking either side WHOLE would have silently dropped real mutations —
#   either the five file-exchange ones or the three frame ones — and the suite would
#   have gone green while testing less than it did before the merge.
#
# ★ 2026-09-12: 109 -> 112, + frame_capture 3. The new gate covers the crop that
#   decides WHAT Archie is shown (PngWriter had no gate at all before it). Counted
#   the same way, from run_desktop.sh's own run_gate arguments on this tree.
#
#   This number going stale is exactly what it is for, and it caught me: T-090
#   added the gate, run_desktop.sh reported 112, and CI went red here because this
#   said 109. run_desktop.sh passing locally is NOT the desktop CI -- the syntax
#   gate and this counter are separate steps that a local suite run never executes.
#
# * 2026-09-12: 112 -> 113, + transaction 1. Only ONE, deliberately: this gate's
#   subject is ForgeFrame, which a --mutate flag inside the gate BINARY cannot
#   reach. Its real red-then-green is against the code. Mutation 4 asks for a radius
#   the kernel ACCEPTS, so there is no failure to roll back and the gate must refuse
#   to pass vacuously.
# * 2026-09-12: 113 -> 117, + file_exchange 1 + cam_panels 3. The MANUFACTURING
#   EGRESS. The CAM post was real and gate-proven and the only way its program
#   could leave the application was a Copy button; STL was offered in neither
#   direction. cam_panels 8/9/10 cover the exported file being canned, being the
#   program the panel FIRST had, and a save inventing a folder that is not there.
#   file_exchange 6 puts STL export back through forge::io::exportStl -- which
#   refuses every body this app can compile -- so the fix cannot be reverted
#   without a red check. DERIVED on this tree, not incremented on faith:
#     awk '/^run_gate /{total+=NF-2} END{print total}' forge-desktop/test/run_desktop.sh
#   prints 117.
#
# * 2026-09-12: 113 -> 115, + frame 23 and 24, the negative controls for the
#   PARAMETER SHEET. 23 draws the sheet and types nothing, which reproduces the
#   shipped behaviour exactly (every Box 40x30x20); 24 takes the pre-sheet route
#   and builds the part before the user has seen a value. DERIVED on this tree,
#   not incremented on faith:
#     awk '/^run_gate /{total+=NF-2} END{print total}' forge-desktop/test/run_desktop.sh
#   prints 115.
#
# Both landed the same day; the constant below is the DERIVED total of the merged
# run_desktop.sh, not either branch's figure (117 and 115 each counted only its own
# additions against the shared 113 base).
# * 2026-09-12: 113 -> 120, + render 7. The RENDER gate joined run_desktop.sh:
#   the first gate in this project that executes ViewportRenderer and asserts on
#   the PIXELS it produced. DERIVED on this tree, not incremented on faith --
#   awk '/^run_gate /{total+=NF-2} END{print total}' forge-desktop/test/run_desktop.sh
#   prints 120.
#
#   The seventh is mutation 7, added after the first six were run and found NOT
#   to falsify the gate's two ink-continuity checks. It sinks the edges 0.15 mm
#   behind the surface -- far enough to stitch, not far enough to hide -- which is
#   the only injected input that makes a visible edge come out DASHED. Six
#   mutations that all leave a check green are six mutations that do not test it.
#
# * 2026-09-12: 113 -> 128, + import_reopen 15. The IMPORT/SAVE/REOPEN gate joined
#   run_desktop.sh, so this number moves in the SAME commit. DERIVED on this tree,
#   not incremented on faith:
#     awk '/^run_gate /{total+=NF-2} END{print total}' forge-desktop/test/run_desktop.sh
#   prints 128.
#
#   ★ THIS NOTE WAS ITSELF WRONG ON ITS FIRST WRITING and is worth keeping as the
#     example: it said "113 -> 118, + import_reopen 5" beside a constant of 122.
#     Every figure in it was wrong -- the parent's own awk printed 113 and not
#     118, the gate carried nine --mutate cases and not five, and the number it
#     claimed the awk printed was one the awk had never printed. The constant was
#     right and its own explanation was not, which is the failure this constant
#     cannot catch: CI compares the NUMBER, and prose beside a number is checked
#     by nothing but a reader.
# ── MERGE NOTE 2026-09-12: both sides of this merge derived 128 and the merged
# tree derives 143. The two branches added disjoint gates to a shared base of
# 113 -- render 7 + the egress/sheet work on one side, import_reopen 15 on the
# other -- and each arrived at 128 by a DIFFERENT route. Because the two numbers
# agreed, git auto-merged the constant and no conflict was raised on the one
# line that decides the build. DERIVED on the merged tree, not carried over:
#   awk '/^run_gate /{t+=NF-2} END{print t}' forge-desktop/test/run_desktop.sh
# prints 143.
#
# * 2026-09-12: 113 -> 118, + camera_stability 5. The camera gate: every rebuild
#   re-framed the camera because main.cpp's loop read geometryDirty -- the
#   "re-upload the vertex buffer" flag -- as "re-frame the camera" too, so
#   iterating a dimension cost a re-orbit and a re-zoom per Apply, and a rebuild
#   the kernel REFUSED reset it as well. Two mutations put that host rule back
#   (every rebuild, then the failed rebuild only) and three break the OTHER half,
#   which a "never move the camera" patch would have broken silently: Fit, the
#   re-frame a document open genuinely wants, and the one an Import STEP needs
#   across the EMPTY document documentReset() leaves behind. Counted from
#   run_desktop.sh's own run_gate arguments on this tree:
#     awk '/^run_gate /{total+=NF-2} END{print total}' forge-desktop/test/run_desktop.sh
#
# * 2026-09-12: 118 -> 119, + camera_stability 1. The repair to that same gate.
#   Its stability checks were all made in the PRISTINE STARTUP STATE, where no
#   framing request is outstanding -- so deleting the one line that consumes the
#   request left the gate at 33 checks / 0 failures and exit 0 while breaking
#   every rebuild after an open. The checks are now made on the far side of a
#   document event too, and the sixth mutation is the one they needed: re-derive
#   an already-open document without saying a document event happened, so nothing
#   asks for the framing an open owes the user.#
# ── MERGE NOTE 2026-09-12 (the second of the day, and it is the SAME defect
#    shape): the parents pinned 143 and 119 and the merged tree derives 149.
#    Both numbers were correct FOR THEIR OWN PARENT -- 143 counted render 7 and
#    import_reopen 15 against the shared base, 119 counted camera_stability 6
#    against a base without either. Neither was taken. What makes this one worth
#    a note is that BOTH assignments survived the textual merge, one at the top
#    of the conflict and one at the bottom, and in bash the LAST one wins: the
#    file would have silently pinned 119 with 149 mutations running. This file
#    has now recorded that same trap three times. DERIVED on the merged tree:
#      awk '/^run_gate /{t+=NF-2} END{print t}' forge-desktop/test/run_desktop.sh
#    prints 149.
#
# * 2026-09-12: 149 -> 150, + camera_stability 7. A REVIEWER'S FINDING TURNED
#   INTO A MUTATION rather than into a sentence in a commit message. The finding
#   was that the same camera defect, routed through `view.fit` instead of
#   through Camera directly, moves the camera without touching cameraRefits_ --
#   the counter every document-reframe check in that gate reads. Measured on
#   this tree it is RED (4 failures, at the reviewer's own coordinates), so the
#   gate does catch it; the mutation is what keeps that from silently ceasing to
#   be true. DERIVED on this tree, not incremented on faith:
#     awk '/^run_gate /{t+=NF-2} END{print t}' forge-desktop/test/run_desktop.sh
#   prints 150.
#
# * 2026-09-12: 113 -> 120, + quit_guard 7. The QUIT gate: a dirty document
#   driven through the real requestQuit() path, with the work asserted to
#   survive both as an unsaved-changes prompt and as a forge::ui::RecoveryService
#   autosave a second session reads back. DERIVED on this tree, not incremented
#   on faith:
#     awk '/^run_gate /{total+=NF-2} END{print total}' forge-desktop/test/run_desktop.sh
#   prints 120.
#
# * 2026-09-12: 120 -> 127, + quit_guard 7 (7 -> 14). The adversarial review of
#   the quit guard found that the fix DESTROYED DATA the original bug only
#   failed to save -- the autosave carried neither the drawing nor the material,
#   and the recovery seam then pointed the document at the user's own file and
#   marked it dirty, so a bare Ctrl+S wrote those losses into it. Six more
#   injected defects cover that seam, the question that outlived its own
#   condition, Save As with an empty name, and Save and Close on a document that
#   has never been saved, and the cadence asked to keep a drawing-only edit.
#   DERIVED on this tree, not incremented on faith:
#     awk '/^run_gate /{total+=NF-2} END{print total}' forge-desktop/test/run_desktop.sh
#   prints 127.#
# ── MERGE NOTE 2026-09-12 (the THIRD of the day, same trap, both parents armed
#    it again): 150 and 127, and the merged tree derives 164. Both were right for
#    their own parent -- 150 counted render 7, import_reopen 15 and
#    camera_stability 7 against the shared base; 127 counted quit_guard 14 and
#    file_dialog 4 against a base with none of those. Neither was taken. BOTH
#    assignments survived the textual merge again, one at the top of the conflict
#    and one at the bottom, and in bash the LAST one wins -- so the file would
#    have pinned 127 while 164 mutations ran, and the gate would have failed for
#    arithmetic rather than for a defect. DERIVED on the merged tree:
#      awk '/^run_gate /{t+=NF-2} END{print t}' forge-desktop/test/run_desktop.sh
#    prints 164.
EXPECTED_MUTATIONS=164
# ── 2026-09-06: 102 -> 109. The TRUST-PANELS gate (Interference, Verification,
# Continuity, Draft, Zebra) joined run_desktop.sh with seven mutations, so this
# number moves in the SAME commit -- which is exactly what this constant exists
# to force. DERIVED on this tree, not incremented on faith:
#   awk '/^run_gate /{total+=NF-2} END{print total}' forge-desktop/test/run_desktop.sh
# prints 109.
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

# ── THE SKIPPED VERDICT ──────────────────────────────────────────────────────
# ONE gate in run_desktop.sh can fail for a reason that is not about this
# project's code: forge_desktop_render_gate is the only gate that calls
# vkCreateInstance, and a runner with no Vulkan ICD has no instrument rather than
# a broken renderer. Failing the whole job for an absent instrument would turn CI
# red for everyone on a machine that is merely unequipped -- a worse outcome than
# the defect the gate was written to catch.
#
# So run_desktop.sh prints a DIFFERENT verdict line when a gate skipped, and this
# is where that line is judged. It is accepted, and it is NOT accepted quietly:
#
#   * the ratchet still holds. RUN + NOT RUN must equal EXPECTED_MUTATIONS
#     exactly, so mutation coverage cannot shrink behind a skip -- which is the
#     hole a skip would otherwise open in the one number nothing else guards.
#   * it is a ::warning:: in the GitHub log and a loud line locally, naming the
#     gate, so "the viewport was never rendered on this run" is visible instead
#     of hiding inside the word PASS.
#   * FORGE_REQUIRE_GPU=1 makes the skip a hard failure in the gate binary
#     itself. Set it on a runner that is SUPPOSED to have a device and the day
#     its ICD stops being installed is a red build, not a silent hole.
#
# The deliberate choice, written down so the next reader does not have to guess:
# CI does NOT set FORGE_REQUIRE_GPU, because this repository cannot prove that
# every runner image will ship a working MoltenVK ICD forever, and a gate that
# breaks the build for everyone the day an image changes is not a gate anybody
# keeps. The warning is the instrument on the skip.
SKIP_RE='^\[desktop\] FORGE DESKTOP GATES PASS WITH ([0-9]+) GATE\(S\) SKIPPED \((.+)\): ([0-9]+) mutations proved red-then-green, ([0-9]+) NOT RUN$'
if grep -qxF -- "$VERDICT" "$LOG"; then
  echo "[ci-desktop] GREEN — verdict confirmed: $VERDICT"
  exit 0
fi

skip_line="$(grep -E "$SKIP_RE" "$LOG" | tail -1)"
if [ -n "$skip_line" ]; then
  n_gates="$(printf '%s' "$skip_line" | sed -E "s/$SKIP_RE/\1/")"
  names="$(printf '%s' "$skip_line" | sed -E "s/$SKIP_RE/\2/")"
  n_run="$(printf '%s' "$skip_line" | sed -E "s/$SKIP_RE/\3/")"
  n_skipped="$(printf '%s' "$skip_line" | sed -E "s/$SKIP_RE/\4/")"
  if [ "$((n_run + n_skipped))" -ne "$EXPECTED_MUTATIONS" ]; then
    red "a gate skipped AND the mutation count does not add up: ${n_run} run + ${n_skipped} not run = $((n_run + n_skipped)), expected ${EXPECTED_MUTATIONS}"
    echo "[ci-desktop] a skip may cost coverage; it may not HIDE a change in coverage."
    exit 1
  fi
  echo "[ci-desktop] ★★ ${n_gates} GATE(S) SKIPPED: ${names}"
  echo "[ci-desktop] ★★ ${n_skipped} of ${EXPECTED_MUTATIONS} mutations were NOT RUN on this machine."
  echo "[ci-desktop] ★★ The viewport was not rendered here. Set FORGE_REQUIRE_GPU=1 on a"
  echo "[ci-desktop] ★★ runner that is supposed to have a Vulkan device to make this RED."
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::warning::forge-desktop: ${n_gates} gate(s) SKIPPED for want of a GPU (${names}); ${n_skipped} mutations not run"
  fi
  echo "[ci-desktop] GREEN (with skips) — verdict confirmed: $skip_line"
  exit 0
fi

red "run_desktop.sh exited 0 without printing its exact verdict line, so nothing here is proved"
echo "[ci-desktop] expected : $VERDICT"
echo "[ci-desktop] last line: $(tail -1 "$LOG")"
echo "[ci-desktop] if the mutation count CHANGED on purpose, update"
echo "[ci-desktop] EXPECTED_MUTATIONS in this file in the SAME commit. It is an"
echo "[ci-desktop] exact value, never a floor."
exit 1
