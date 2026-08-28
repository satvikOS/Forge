#!/usr/bin/env bash
# reap_worktrees.sh — reclaim finished agent worktrees, with proof.
#
# Sacrosanct §21.3: deletion authority is restricted to registered roots, and NOTHING dirty,
# unique, active, or uncertain is ever removed. Disk pressure never converts uncertainty into
# deletion authority. This script therefore REFUSES far more than it removes, and every refusal
# prints WHY — a cleanup that cannot say why it kept something is not trustworthy.
#
# Two classes are handled:
#   PHANTOM — registered in .git/worktrees but the directory is gone. Only an admin record remains.
#             Safe to prune; nothing on disk is lost.
#   FINISHED — directory exists, tracked tree clean, no unique untracked/ignored data, and every
#             commit is reachable from a surviving ref. Removed through git, never rm -rf.
#
# Usage:  reap_worktrees.sh            # DRY RUN (default — prints the plan, changes nothing)
#         reap_worktrees.sh --apply    # execute the plan
set -uo pipefail

# --- locate the TRUE main checkout -------------------------------------------------------------
# `git rev-parse --show-toplevel` returns the toplevel of whatever worktree you are standing in.
# Run from a linked worktree it returned THAT worktree, so REGISTERED_ROOT became
# "<linked-wt>/.claude/worktrees" — a directory that does not exist — every real worktree was
# refused as "outside registered root", the linked worktree was mistaken for MAIN and skipped
# without a word, and the receipt was written inside the ephemeral tree.
# --git-common-dir is shared by every worktree of a repo and always points at the main .git.
COMMON="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
  || { echo "not a git repo"; exit 1; }
[ -n "$COMMON" ] || { echo "not a git repo"; exit 1; }
MAIN="$(cd "$(dirname "$COMMON")" 2>/dev/null && pwd -P)" || MAIN=""
if [ -z "$MAIN" ] || [ "$(git -C "$MAIN" rev-parse --show-toplevel 2>/dev/null)" != "$MAIN" ]; then
  echo "cannot locate the main checkout from git-common-dir '$COMMON' — refusing to act"; exit 1
fi

# CUR must be read BEFORE cd, and must be the toplevel of the worktree we are standing IN — that
# is the one thing we must never remove out from under ourselves.
CUR="$(git rev-parse --show-toplevel 2>/dev/null)"; CUR="${CUR:-$(pwd -P)}"
cd "$MAIN" || { echo "cannot enter main checkout $MAIN"; exit 1; }

APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
REGISTERED_ROOT="$MAIN/.claude/worktrees"
RECEIPTS="$MAIN/implementation/sacrosanct/storage-receipts"
mkdir -p "$RECEIPTS"
STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
RECEIPT="$RECEIPTS/reap-$STAMP.md"

# Refs a worktree's commits may be reachable from and still be safe to drop.
SURVIVING_REFS=$(git for-each-ref --format='%(refname)' refs/heads refs/remotes 2>/dev/null)

reclaimed=0; kept=0; phantom=0; bytes=0
removed_ok=0; removed_fail=0
PHANTOM_UNLOCK=()
REMOVE_LIST=()
plan=""

note() { plan+="$1"$'\n'; echo "$1"; }

note "# worktree reap — $STAMP  (mode: $([ $APPLY -eq 1 ] && echo APPLY || echo DRY-RUN))"
note ""

# --- read the worktree table SAFELY ------------------------------------------------------------
# The human `git worktree list` format is columns separated by runs of spaces, so `${line%% *}`
# truncated any path containing a space: ".../worktrees/my agent" parsed as ".../worktrees/my",
# which is not on disk, so a LIVE worktree was classified PHANTOM and the receipt asserted
# "no data on disk to lose" about a directory full of it. --porcelain -z is NUL-delimited and
# carries the lock reason as its own record, so neither spaces nor newlines can split a field.
WT_PATHS=(); WT_LOCKED=(); WT_REASON=()
_p=""; _l=0; _r=""
_flush() {
  if [ -n "$_p" ]; then WT_PATHS+=("$_p"); WT_LOCKED+=("$_l"); WT_REASON+=("$_r"); fi
  _p=""; _l=0; _r=""
}
while IFS= read -r -d '' entry; do
  case "$entry" in
    "worktree "*) _flush; _p="${entry#worktree }" ;;
    "locked")     _l=1; _r="" ;;
    "locked "*)   _l=1; _r="${entry#locked }" ;;
  esac
done < <(git worktree list --porcelain -z)
_flush

i=0
while [ $i -lt ${#WT_PATHS[@]} ]; do
  wt="${WT_PATHS[$i]}"; wt_locked="${WT_LOCKED[$i]}"; wt_reason="${WT_REASON[$i]}"
  i=$((i+1))
  [ -z "$wt" ] && continue

  # --- refuse anything outside the registered root, and the main checkout itself ---
  if [ "$wt" = "$MAIN" ]; then continue; fi
  case "$wt" in
    "$REGISTERED_ROOT"/*) : ;;
    *) note "KEEP    $wt"; note "        reason: outside registered root $REGISTERED_ROOT"; kept=$((kept+1)); continue ;;
  esac
  # --- refuse the worktree we are standing in ---
  if [ "$wt" = "$CUR" ]; then note "KEEP    $wt"; note "        reason: current worktree"; kept=$((kept+1)); continue; fi
  # --- symlink escape check: the resolved path must still sit under the registered root ---
  if [ -d "$wt" ]; then
    real="$(cd "$wt" 2>/dev/null && pwd -P)" || real=""
    case "$real" in
      "$REGISTERED_ROOT"/*) : ;;
      *) note "KEEP    $wt"; note "        reason: resolves to '$real' — escapes the registered root"; kept=$((kept+1)); continue ;;
    esac
  fi

  # ---------------- PHANTOM: record without a directory ----------------
  # `git worktree prune` REFUSES locked records by design, and Claude Code locks every agent
  # worktree to its pid ("claude agent <name> (pid N)"). When the directory is deleted without
  # unlocking, the record is immortal — which is exactly how 26 of these accumulated since May.
  # Unlocking is only safe with TWO independent proofs: the directory is gone AND the process
  # holding the lock is dead. Use `ps -p`, never pgrep -f, which would match this script itself.
  # The lock reason comes from the porcelain record, not from `.git/worktrees/$(basename $wt)`:
  # git disambiguates colliding basenames with -1/-2 suffixes, so that path is not the record.
  if [ ! -d "$wt" ]; then
    if [ "$wt_locked" = "1" ]; then
      lockpid="$(printf '%s' "$wt_reason" | sed -n 's/.*(pid \([0-9][0-9]*\)).*/\1/p')"
      if [ -z "$lockpid" ]; then
        # No pid in the reason means we have NO evidence about the holder. The old code fell
        # through to PRUNE and printed "lock held by dead pid unknown" — asserting a death it
        # never established. Uncertainty is a KEEP, and it must say so.
        note "KEEP    $wt"
        note "        reason: directory absent and the lock reason carries NO parseable '(pid N)' —"
        note "                the holder cannot be proved dead. Uncertainty is never a deletion."
        note "        lock:  ${wt_reason:-(no reason recorded)}"
        note "        clear: git worktree unlock '$wt'   # only once a human confirms it is stale"
        kept=$((kept+1)); continue
      fi
      if ps -p "$lockpid" >/dev/null 2>&1; then
        note "KEEP    $wt"
        note "        reason: directory absent BUT lock pid $lockpid is STILL ALIVE — an agent"
        note "                may be mid-operation. Refusing to unlock."
        kept=$((kept+1)); continue
      fi
      note "PRUNE   $wt"
      note "        class: PHANTOM+STALE-LOCK — directory absent; lock pid $lockpid confirmed dead (ps -p)"
      note "        lock:  $wt_reason"
      note "        action: unlock then prune (git worktree prune skips locked records)"
      PHANTOM_UNLOCK+=("$wt")
    else
      note "PRUNE   $wt"
      note "        class: PHANTOM (admin record only, directory absent) — no data on disk to lose"
    fi
    phantom=$((phantom+1)); continue
  fi

  # ---------------- ACTIVE AGENT?  refuse before anything else ----------------
  # Sacrosanct s21.3 requires proving a worktree has no active Claude session or task before
  # removal. That was specified and NOT implemented, and on 2026-08-28 this script deleted a LIVE
  # agent's isolation worktree mid-run: the agent had verified five findings and authored a fix but
  # had not yet written a file, so the dirty-tree test passed, and its branch had no commits, so the
  # witness test passed. Its remaining tool calls all failed with "the isolation worktree appears to
  # have been removed" and the authored fix was lost.
  #
  # "Not yet dirty" is not "finished". A worktree belonging to a live workflow run is UNCERTAIN,
  # and uncertainty means KEEP — the same rule already applied to unparseable locks.
  wt_base="$(basename "$wt")"
  case "$wt_base" in
    wf_*)
      run_id="${wt_base%-*}"
      recent="$(find "$HOME/.claude/projects" -type d -name "${run_id}*" -mmin -30 2>/dev/null | head -1)"
      live_claude="$(ps -Ao comm= 2>/dev/null | grep -c '[c]laude' || true)"
      if [ -n "$recent" ] || [ "${live_claude:-0}" -gt 0 ]; then
        note "KEEP    $wt"
        note "        reason: ACTIVE-AGENT worktree — run ${run_id} has transcript activity in the"
        note "                last 30 min or a claude process is live. Not-yet-dirty is not finished."
        kept=$((kept+1)); continue
      fi
      ;;
  esac

  # ---------------- FINISHED?  every check must pass ----------------
  dirty=$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if [ "${dirty:-1}" != "0" ]; then
    note "KEEP    $wt"
    note "        reason: $dirty uncommitted/untracked path(s) — dirty trees are never reclaimed"
    kept=$((kept+1)); continue
  fi

  # `git status --porcelain` does NOT list ignored files, so a worktree holding gigabytes of
  # gitignored build output reported ZERO lines and was removed under a receipt claiming
  # "tracked+untracked clean". The FINISHED contract in the header says "no unique
  # untracked/ignored data"; --ignored is what actually tests the second half of that.
  ign_list=$(git -C "$wt" status --porcelain --ignored 2>/dev/null | grep '^!! ' | sed 's/^!! //')
  ign=$(printf '%s' "$ign_list" | grep -c . | tr -d ' ')
  if [ "${ign:-1}" != "0" ]; then
    isz=$(du -sk "$wt" 2>/dev/null | awk '{print $1}')
    note "KEEP    $wt"
    note "        reason: tracked tree is clean but $ign ignored path(s) hold data git will not"
    note "                restore — removing the worktree destroys them irrecoverably."
    note "        ignored: $(printf '%s' "$ign_list" | tr '\n' ' ')"
    note "        size:  $(( ${isz:-0} / 1024 )) MiB — delete the artifacts first, then re-run"
    kept=$((kept+1)); continue
  fi

  head=$(git -C "$wt" rev-parse HEAD 2>/dev/null)
  br=$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null)

  # Is HEAD reachable from any ref OTHER than this worktree's own branch?
  # (Its own branch does not count: deleting the worktree and leaving a branch nobody merged
  #  still strands the work. We require a SECOND witness.)
  witness=""
  for r in $SURVIVING_REFS; do
    [ "$r" = "refs/heads/$br" ] && continue
    if git merge-base --is-ancestor "$head" "$r" 2>/dev/null; then witness="$r"; break; fi
  done
  if [ -z "$witness" ]; then
    note "KEEP    $wt"
    note "        reason: HEAD $head (branch $br) is not an ancestor of any OTHER ref —"
    note "                its commits would be stranded. Merge or push it first."
    kept=$((kept+1)); continue
  fi

  sz=$(du -sk "$wt" 2>/dev/null | awk '{print $1}')
  bytes=$((bytes + ${sz:-0}))
  note "REMOVE  $wt"
  note "        class: FINISHED   branch: $br   head: $head"
  note "        proof: tracked+untracked clean (0 paths); ignored data (0 paths); reachable from $witness"
  note "        size:  $(( ${sz:-0} / 1024 )) MiB    recovery: branch $br retains the commits"
  REMOVE_LIST+=("$wt")
  reclaimed=$((reclaimed+1))
done

note ""
note "## summary"
note "- REMOVE  (finished, proved): $reclaimed   ~$(( bytes / 1024 )) MiB"
note "- PRUNE   (phantom records):  $phantom"
note "- KEEP    (refused):          $kept"

if [ $APPLY -eq 1 ]; then
  echo ""
  echo "--- applying ---"
  # Apply exactly the plan that was printed. The old apply loop re-derived every decision from a
  # SECOND pass over the worktree table, so any guard that differed between the two loops let a
  # path the plan printed as KEEP be deleted anyway. One decision, one list, no divergence.
  for wt in "${REMOVE_LIST[@]:-}"; do
    [ -z "$wt" ] && continue
    # A worktree locked by a live agent needs --force TWICE; one --force is refused.
    # Capture the STATUS, not a pipeline's — piping into sed discarded git's exit code and the
    # unconditional echo below then reported a removal that may never have happened.
    rm_out="$(git worktree remove --force "$wt" 2>&1)"; rm_rc=$?
    if [ $rm_rc -ne 0 ]; then
      rm_out="$(git worktree remove --force --force "$wt" 2>&1)"; rm_rc=$?
    fi
    printf '%s\n' "$rm_out" | sed 's/^/    /'
    if [ $rm_rc -eq 0 ] && [ ! -d "$wt" ]; then
      echo "    removed $wt"
      removed_ok=$((removed_ok+1))
    else
      echo "    ⚠ NOT REMOVED (rc=$rm_rc, still on disk): $wt"
      note "APPLY-FAILED $wt (rc=$rm_rc) — the plan plotted removal and git refused it"
      removed_fail=$((removed_fail+1))
    fi
  done

  # release stale locks so prune can actually collect the phantom records
  for wt in "${PHANTOM_UNLOCK[@]:-}"; do
    [ -z "$wt" ] && continue
    git worktree unlock "$wt" >/dev/null 2>&1 && echo "    unlocked (stale) $wt"
  done

  # Count records the NUL-safe way too: the human format's one-line-per-worktree assumption is
  # the same one that produced the truncation bug above.
  before_n=$(git worktree list --porcelain -z | tr '\0' '\n' | grep -c '^worktree ' | tr -d ' ')
  git worktree prune -v 2>&1 | sed 's/^/    /'
  after_n=$(git worktree list --porcelain -z | tr '\0' '\n' | grep -c '^worktree ' | tr -d ' ')
  note ""
  note "APPLIED at $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  note "worktree records: $before_n -> $after_n  (delta $((before_n - after_n)))"
  note "removals: $removed_ok succeeded, $removed_fail REFUSED BY GIT"
  if [ "$removed_fail" -gt 0 ]; then
    note "WARNING: $removed_fail planned removal(s) did not happen. The receipt above lists them as"
    note "         APPLY-FAILED. Do not read this run as having reclaimed them."
  fi
  # A cleanup that reports removal it did not perform is worse than one that removes nothing.
  if [ "$before_n" = "$after_n" ] && [ $phantom -gt 0 ]; then
    note "WARNING: $phantom records were planned for prune but the count did NOT change."
    note "         The plan was not achieved — investigate before trusting this receipt."
  fi
fi

printf '%s\n' "$plan" > "$RECEIPT"
echo ""
echo "receipt: $RECEIPT"
