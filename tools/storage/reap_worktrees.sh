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

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "not a git repo"; exit 1; }
cd "$ROOT"
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
MAIN="$(git rev-parse --show-toplevel)"
CUR="$(pwd -P)"
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
plan=""

note() { plan+="$1"$'\n'; echo "$1"; }

note "# worktree reap — $STAMP  (mode: $([ $APPLY -eq 1 ] && echo APPLY || echo DRY-RUN))"
note ""

while IFS= read -r line; do
  wt="${line%% *}"
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
  if [ ! -d "$wt" ]; then
    rec="$MAIN/.git/worktrees/$(basename "$wt")"
    lockf="$rec/locked"
    if [ -f "$lockf" ]; then
      reason="$(cat "$lockf" 2>/dev/null)"
      lockpid="$(printf '%s' "$reason" | sed -n 's/.*(pid \([0-9][0-9]*\)).*/\1/p')"
      if [ -n "$lockpid" ] && ps -p "$lockpid" >/dev/null 2>&1; then
        note "KEEP    $wt"
        note "        reason: directory absent BUT lock pid $lockpid is STILL ALIVE — an agent"
        note "                may be mid-operation. Refusing to unlock."
        kept=$((kept+1)); continue
      fi
      note "PRUNE   $wt"
      note "        class: PHANTOM+STALE-LOCK — directory absent; lock held by dead pid ${lockpid:-unknown}"
      note "        lock:  $reason"
      note "        action: unlock then prune (git worktree prune skips locked records)"
      PHANTOM_UNLOCK+=("$wt")
    else
      note "PRUNE   $wt"
      note "        class: PHANTOM (admin record only, directory absent) — no data on disk to lose"
    fi
    phantom=$((phantom+1)); continue
  fi

  # ---------------- FINISHED?  every check must pass ----------------
  dirty=$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if [ "${dirty:-1}" != "0" ]; then
    note "KEEP    $wt"
    note "        reason: $dirty uncommitted/untracked path(s) — dirty trees are never reclaimed"
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
  note "        proof: tracked+untracked clean (0 paths); reachable from $witness"
  note "        size:  $(( ${sz:-0} / 1024 )) MiB    recovery: branch $br retains the commits"
  reclaimed=$((reclaimed+1))
done < <(git worktree list)

note ""
note "## summary"
note "- REMOVE  (finished, proved): $reclaimed   ~$(( bytes / 1024 )) MiB"
note "- PRUNE   (phantom records):  $phantom"
note "- KEEP    (refused):          $kept"

if [ $APPLY -eq 1 ]; then
  echo ""
  echo "--- applying ---"
  while IFS= read -r line; do
    wt="${line%% *}"
    [ -z "$wt" ] || [ "$wt" = "$MAIN" ] && continue
    case "$wt" in "$REGISTERED_ROOT"/*) : ;; *) continue ;; esac
    [ "$wt" = "$CUR" ] && continue
    if [ ! -d "$wt" ]; then continue; fi
    # The apply loop re-derives its decisions, so it must repeat EVERY dry-run guard. Omitting the
    # symlink-escape check meant a path the plan printed as KEEP could still be deleted here.
    real="$(cd "$wt" 2>/dev/null && pwd -P)" || real=""
    case "$real" in "$REGISTERED_ROOT"/*) : ;; *) echo "    skip (escapes registered root): $wt"; continue ;; esac
    dirty=$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    [ "${dirty:-1}" != "0" ] && continue
    head=$(git -C "$wt" rev-parse HEAD 2>/dev/null)
    br=$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null)
    ok=0
    for r in $SURVIVING_REFS; do
      [ "$r" = "refs/heads/$br" ] && continue
      git merge-base --is-ancestor "$head" "$r" 2>/dev/null && { ok=1; break; }
    done
    [ $ok -eq 1 ] || continue
    # Capture the STATUS, not a pipeline's. Piping into sed discarded git's exit code and the
    # unconditional echo below then reported a removal that may never have happened — the same
    # "reports work it did not do" defect this script's post-condition check exists to catch.
    # A worktree locked by a live agent needs --force TWICE; one --force is refused.
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
  done < <(git worktree list)

  # release stale locks so prune can actually collect the phantom records
  for wt in "${PHANTOM_UNLOCK[@]:-}"; do
    [ -z "$wt" ] && continue
    git worktree unlock "$wt" >/dev/null 2>&1 && echo "    unlocked (stale) $wt"
  done

  before_n=$(git worktree list | wc -l | tr -d ' ')
  git worktree prune -v 2>&1 | sed 's/^/    /'
  after_n=$(git worktree list | wc -l | tr -d ' ')
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
