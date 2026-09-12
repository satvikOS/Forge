#!/usr/bin/env bash
# shell_gate_registration_ratchet.sh — is every SHELL gate, anywhere, wired in?
#
# ── WHY A THIRD ONE ──────────────────────────────────────────────────────────
# Two registration checks already exist and BOTH are scoped, in ways that are
# correct for them and leave a hole between them:
#
#   forge-kernel/test/gate_registration_ratchet.sh enumerates
#     `forge-kernel/test/run_*.sh` and `build_*.sh`  — one tree, two prefixes.
#   forge-desktop/test/gate_registration_check.sh enumerates
#     `*_gate.cpp` CMake targets                     — one tree, C++ only.
#
# So a *_gate.sh outside forge-kernel/test, or inside it under a name that is
# neither run_* nor build_*, is invisible to every check in the repository and
# stays green for ever. MEASURED when this was written — three such gates had
# never executed once:
#
#   tools/guardian/test/guardian_single_instance_gate.sh  33 checks, 11 mutations
#   archie/test/run_archie_gate.sh                        32 checks (T-080, T-083)
#   forge-desktop/test/update_apply_refuses_gate.sh        8 checks, SECURITY
#
# The last is the one that should sting: the shipped updater's refusal to install
# an update it cannot attribute was asserted by a gate nothing ran. The first was
# found only because a mutant daemon it leaked was still alive after 10h13m.
#
# ── SCOPE, AND WHY IT IS NOT A DUPLICATE ─────────────────────────────────────
# This DEFERS to the kernel ratchet on the territory that ratchet already owns —
# forge-kernel/test/{run_,build_}*_gate.sh — because two ratchets pinning the
# same gate means every future wiring has to be recorded twice and one of them
# will be forgotten. What is left is exactly the ground no check could see.
#
# ── RATCHET, NOT HARD FAIL ───────────────────────────────────────────────────
# ALLOW pins what was already unwired when this was written, each with a reason.
# The count may FALL, never RISE. Wire one up and this goes red until it is
# removed from ALLOW, because a ratchet that cannot notice progress is not
# evidence. THE COUNT IS DERIVED FROM ALLOW, never typed beside it.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
SELF="shell_gate_registration_ratchet.sh"

# Unwired when written. Each line is a path, and each needs a reason above it.
ALLOW="forge-desktop/test/run_file_dialog_gate.sh
forge-kernel/scripts/ft_relational_gate.sh
forge-kernel/scripts/storage_governor_git_gate.sh
forge-kernel/scripts/storage_governor_mutation_gate.sh"
#   run_file_dialog_gate.sh   — drives a native file dialog; needs a headed
#                               session, which no runner has.
#   ft_relational_gate.sh     — investigation from the relational-corpus work.
#   storage_governor_*_gate   — operate on the real working copy and the real
#                               disk; running them on a runner measures the
#                               runner, not this workstation.
#   occt_lib_resolution_gate  — REMOVED from this list: it is now wired into
#                               kernel-tests.yml, and the kernel ratchet can see
#                               it too (that ratchet used to glob run_*/build_*
#                               and now globs *_gate.sh, so a name carrying
#                               neither prefix is no longer invisible).

owned_by_kernel_ratchet() {     # the territory we deliberately do not touch
  # DELIBERATELY NARROWER than what that ratchet now covers. It used to glob
  # run_*.sh and build_*.sh; it now globs forge-kernel/test/*_gate.sh, so gates
  # such as selector_kind_gate.sh are checked by BOTH. That is double coverage,
  # not a hole, and double coverage is the safe direction -- widening this case
  # to match would REMOVE this ratchet's check on those files for no gain.
  case "$1" in
    forge-kernel/test/run_*_gate.sh|forge-kernel/test/build_*_gate.sh) return 0 ;;
    *) return 1 ;;
  esac
}

reachable() {                   # reachable <path>
  local f="$1" b
  b=$(basename "$f" .sh)
  # ★ EXCLUDE the two registration checkers and THIS script. All three NAME
  #   gates without running them — the kernel ratchet's ALLOW list, this one's,
  #   and gate-registration.yml's own mutation proof. Left in, every pinned gate
  #   finds its own name in a pin and reports itself reachable, and the whole
  #   ratchet silently collapses to measured=0. That exact collapse is recorded
  #   in the kernel ratchet's comments; it is not hypothetical.
  # ★ EXCLUDE the selftest beside this script for the same reason, and it is not
  #   theoretical either: the moment that file was written, naming
  #   occt_lib_resolution_gate in a case that only PROVES the ratchet can notice
  #   an improvement, the ratchet read the mention as a consumer and reported
  #   "RED ON AN IMPROVEMENT" against a tree in which nothing had improved.
  # ★ EXCLUDE the file itself: `grep -rl` prints the gate's own path, and a
  #   self-match makes EVERY gate look wired. Measured here: with a botched
  #   self-exclusion (a doubled ./ prefix that never matched) this reported
  #   0 unwired out of 47 while the kernel ratchet reported 10 in one subtree.
  grep -rlF "$b" --include="*.sh" --include="*.yml" \
       --exclude-dir=.git --exclude-dir=.claude \
       --exclude="$SELF" \
       --exclude="shell_gate_registration_selftest.sh" \
       --exclude="gate_registration_ratchet.sh" \
       --exclude="gate_registration_check.sh" \
       --exclude="gate-registration.yml" . 2>/dev/null \
    | sed 's#^\./##' | grep -vxF "$f" | grep -q . && return 0
  return 1
}

UNREG=""
TOTAL=0
while IFS= read -r f; do
  owned_by_kernel_ratchet "$f" && continue
  TOTAL=$((TOTAL + 1))
  reachable "$f" || UNREG="${UNREG}${f}
"
done < <(find . -name '*_gate.sh' -not -path './.git/*' -not -path './.claude/*' \
         | sed 's#^\./##' | sort)

MEASURED=$(printf '%s' "$UNREG" | grep -c . || true)
PINNED=$(printf '%s\n' "$ALLOW" | grep -c . || true)

echo "[shell-gate-registration] shell gates outside the kernel ratchet's scope: $TOTAL"
echo "[shell-gate-registration] of those, not executed by anything:"
printf '%s' "$UNREG" | sed 's/^/    /'
echo "[shell-gate-registration] measured=$MEASURED  pinned=$PINNED"

NEW=$(printf '%s' "$UNREG" | grep -vxF "$ALLOW" || true)
GONE=$(printf '%s\n' "$ALLOW" | grep -vxF "$(printf '%s' "$UNREG")" || true)

rc=0
if [ -n "$NEW" ]; then
  echo "[shell-gate-registration] RED — a shell gate is not wired into CI:"
  printf '%s\n' "$NEW" | sed 's/^/    /'
  echo "[shell-gate-registration] It will commit, stay green, and never run once."
  echo "[shell-gate-registration] Wire it into .github/workflows/, or pin it in ALLOW with a reason."
  rc=1
fi
if [ -n "$GONE" ]; then
  echo "[shell-gate-registration] RED ON AN IMPROVEMENT — these now run:"
  printf '%s\n' "$GONE" | sed 's/^/    /'
  echo "[shell-gate-registration] Remove them from ALLOW."
  rc=1
fi
[ $rc -eq 0 ] && echo "[shell-gate-registration] GREEN — no unwired shell gate beyond the $PINNED pinned."
exit $rc
