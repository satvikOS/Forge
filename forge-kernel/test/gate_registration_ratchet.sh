#!/usr/bin/env bash
# gate_registration_ratchet.sh — is every forge-kernel GATE actually wired in?
#
# WHY THIS EXISTS. forge-desktop already has this check
# (.github/workflows/gate-registration.yml, "every forge-desktop gate is executed,
# not merely built"). The kernel had none, and the cost was concrete: answering
# "did my gate run?" for PR #210 required hand-tracing job logs, because a green
# check tally proves jobs passed and says NOTHING about whether a given gate was
# among them.
#
# ── THE ASYMMETRY IT CLOSES ──────────────────────────────────────────────────
# REMOVING a wired gate is already caught: its job stops running and something
# goes red. ADDING a gate and forgetting to wire it is caught by NOTHING — it
# compiles, it is committed, every check stays green, and it never executes once.
# ui/test is immune because run_ui.sh globs (TESTS=(ui/test/*_test.cpp)); a glob
# is reachable BY CONSTRUCTION, a hardcoded list only by discipline.
#
# ── WHY A RATCHET AND NOT A HARD FAIL ────────────────────────────────────────
# MEASURED before this was written: of 59 run_*/build_* scripts in
# forge-kernel/test, THIRTY are unreachable from CI. Failing on all of them would
# be noise, not a gate. But most are investigations — *_census, *_probe, *_diag —
# written to answer one question, and an investigation that answered its question
# need not run for ever. The class that matters is the one whose own NAME claims
# it guards something: *_gate. Of 13 such scripts, NINE did not run when this was
# written; the ALLOW list below is the live count and this sentence is history.
#
# So this pins whatever is in ALLOW. The count may FALL (wire one up) but never
# RISE. One more unwired gate turns this red on the PR that introduces it — which
# is precisely the case nothing in this repository caught before. THE COUNT IS NOT
# TYPED ANYWHERE: PINNED is derived from ALLOW, because a number written beside a
# list is only true on the day it is written.
#
# ★ IT HAS ALREADY FALLEN ONCE, which is the point: build_thicken_orientation_gate
#   was wired into .github/workflows/kernel-tests.yml (the OCCT kernel smoke job,
#   beside the native gate guard, reusing build-verify) and removed from this list
#   in the same change. Nine became eight.
#
# ★ IT IS RED IN BOTH DIRECTIONS. If an allowlisted gate becomes reachable, that
#   is PROGRESS and this still goes red, telling you to remove it from the list.
#   A ratchet that cannot notice improvement stops being evidence.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

# The known-unregistered gates, each with the reason it is not wired.
# REMOVE an entry when you wire the gate up. Do NOT add one without a reason.
#
# ★ run_pcurve_fit_gate LEFT THIS LIST on 2026-09-03 and the ratchet is what said
#   so — it went RED ON THE IMPROVEMENT, which is the half of a ratchet nobody
#   writes and this one has. It is now run by kernel-tests.yml beside
#   run_ab_all.sh, and it in turn runs test/pcurve_geometry_gate.cpp, which no
#   script, no CMake target and no workflow named AT ALL. The count is lowered in
#   the same commit that wires it, which is this file's own rule.
ALLOW="\
run_ft_edge_selector_gate
run_pipe_drop_gate
run_pipeshell_guided_gate
run_thicksolid_nesting_gate
run_thrusections_quadrature_gate
run_thrusections_xlate_label_gate
build_aabb_bridge_gate
build_hlr_import_gate
build_import_surfaces_gate
build_kernel_correctness_gate"

reachable() {   # reachable <basename>
  local b="$1"
  # ★ EXCLUDE gate-registration.yml. It is the CHECKER, not a consumer -- no gate
  #   is ever RUN from it -- and its own mutation-proof step necessarily NAMES
  #   gates (it creates run_phantom_ci_gate and mentions run_pipe_drop_gate). Left
  #   in, the search finds those names THERE, calls them reachable, and every
  #   proof case silently no-ops. That is exactly what happened: all three cases
  #   reported failure in CI while passing locally, because locally the mutations
  #   came from the shell and not from a file the search reads.
  # ★ A COMMENT IS NOT AN INVOCATION. This matched the basename as a SUBSTRING
  #   ANYWHERE, so `# TODO: wire probe_todo_gate into CI one day` -- a line whose
  #   plain meaning is "this gate is NOT wired" -- turned the ratchet GREEN for
  #   that gate. MEASURED: phantom gate with no mention = RED; add only that
  #   comment = GREEN. The sentence stating the problem silenced the check.
  #   Comments are stripped before searching. `#` inside a quoted string would be
  #   stripped too, which can only make a gate look LESS reachable -- the safe
  #   direction for a ratchet, because it errs toward flagging work, never toward
  #   hiding it.
  uncommented_has() {   # uncommented_has <dir-or-file...> ; uses $b
    local f
    for f in "$@"; do
      [ -e "$f" ] || continue
      # NOT `sed ... | grep -q`. `grep -q` exits at the FIRST match, `sed` is still
      # writing, takes SIGPIPE and exits 141 -- and `set -o pipefail` above makes
      # THAT the pipeline's status, so a SUCCESSFUL MATCH reads as a failure. It
      # only bites on a file long enough that sed has not finished, which is why it
      # missed kernel-tests.yml (1400+ lines) while the same pipeline matched fine
      # on a short one. Reading from a process substitution takes grep's own status.
      grep -q -- "$b" <(sed 's/#.*$//' "$f" 2>/dev/null) && return 0
    done
    return 1
  }
  local wf
  for wf in .github/workflows/*.yml .github/workflows/*.yaml; do
    [ -e "$wf" ] || continue
    case "$wf" in */gate-registration.yml) continue ;; esac
    uncommented_has "$wf" && return 0
  done
  # invoked by any OTHER script or workflow in the tree
  # ★ EXCLUDE THIS SCRIPT. Its own ALLOW list names every pinned gate, so without
  #   this the search finds each name HERE and calls it reachable -- measured
  #   collapses to 0 and the ratchet reports a permanent phantom "improvement".
  #   Caught by running it: the first version printed measured=0 against pinned=9.
  local cand
  while IFS= read -r cand; do
    uncommented_has "$cand" && return 0
  done < <(grep -rl "$b" --include="*.sh" --include="*.yml" . 2>/dev/null \
    | grep -v "/$b\.sh$" \
    | grep -v "/gate_registration_ratchet\.sh$" \
    | grep -v "/gate-registration\.yml$")
  # run_ab_all.sh CONSTRUCTS run_ab_native_<t>.sh from its HARNESSES list, so a
  # name never appears literally. This is the only dynamic construction in the
  # tree — verified by grepping for any other interpolated gate name.
  case "$b" in run_ab_native_*)
    local t=${b#run_ab_native_}
    grep -qE "HARNESSES=.*\b$t\b" forge-kernel/test/run_ab_all.sh 2>/dev/null && return 0 ;;
  esac
  return 1
}

UNREG=""
# ★ ENUMERATE ON THE NAME THIS CHECK IS ABOUT, NOT ON A PREFIX.
#   This globbed run_*.sh and build_*.sh and THEN filtered to the *_gate suffix, so
#   a gate carrying neither prefix was never even considered. SIX were invisible --
#   forge_verify_batch_gate, forge_verify_instrument_gate, occt_lib_resolution_gate,
#   selector_kind_gate, sketch_plane_gate, occt_ledger_gate_fires -- and the ratchet
#   printed "measured=10 pinned=10 GREEN" over them. Five turned out to be wired;
#   ONE, occt_lib_resolution_gate, was genuinely unregistered and had been hidden by
#   the glob for as long as it existed.
#   A check whose enumeration cannot see a thing cannot report on it. A gate that
#   passes because it never looked is not evidence.
for f in forge-kernel/test/*_gate.sh; do
  [ -e "$f" ] || continue
  b=$(basename "$f" .sh)
  reachable "$b" || UNREG="$UNREG$b\n"
done
MEASURED=$(printf "%b" "$UNREG" | grep -c . || true)
PINNED=$(printf '%s\n' "$ALLOW" | grep -c . || true)

echo "[gate-registration] gates named *_gate that CI does not execute:"
printf "%b" "$UNREG" | sed 's/^/    /'
echo "[gate-registration] measured=$MEASURED  pinned=$PINNED"

NEW=$(printf "%b" "$UNREG" | grep -vxF "$ALLOW" || true)
GONE=$(printf '%s\n' "$ALLOW" | grep -vxF "$(printf "%b" "$UNREG")" || true)

rc=0
if [ -n "$NEW" ]; then
  echo "[gate-registration] RED — a NEW gate is not wired into CI:"
  printf '%s\n' "$NEW" | sed 's/^/    /'
  echo "[gate-registration] It will compile, commit, and stay green while never running once."
  echo "[gate-registration] Wire it into .github/workflows/, or add it to ALLOW with a reason."
  rc=1
fi
if [ -n "$GONE" ]; then
  echo "[gate-registration] RED ON AN IMPROVEMENT — these are now reachable:"
  printf '%s\n' "$GONE" | sed 's/^/    /'
  echo "[gate-registration] Remove them from ALLOW. A ratchet that cannot notice"
  echo "[gate-registration] progress is not evidence."
  rc=1
fi
[ $rc -eq 0 ] && echo "[gate-registration] GREEN — no unwired gate beyond the $PINNED pinned."
exit $rc
