#!/usr/bin/env bash
# ============================================================================
# reap_worktrees_test.sh — proves reap_worktrees.sh CLASSIFIES correctly.
#
# A cleanup gate that only ever prints "KEEP" is as worthless as one that only
# ever prints "REMOVE": the first reclaims nothing, the second is a data-loss
# engine. So this suite asserts BOTH directions. Case 0 is the positive
# control — a genuinely finished worktree MUST be planned for removal — which
# is what stops the suite from passing by refusing everything.
#
# Every case builds a real throwaway repo, runs the real script, and asserts a
# specific string is present or absent in the plan it printed.
#
# Cases 1-4 each reproduce a defect that shipped:
#   1  path with a space parsed as a PHANTOM ("no data on disk to lose")
#   2  gitignored payload removed under "tracked+untracked clean"
#   3  lock with no parseable pid pruned as "dead pid unknown"
#   4  run from a linked worktree: registered root pointed into that worktree
#   5  --apply actually removes, and the commits survive on the branch
# ============================================================================
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# REAP_SCRIPT lets the gate be pointed at an older copy of the script, so that "this suite is
# RED before the fix and GREEN after" is something anyone can re-run rather than take on trust.
SCRIPT="${REAP_SCRIPT:-$REPO/tools/storage/reap_worktrees.sh}"
[ -f "$SCRIPT" ] || { echo "missing $SCRIPT"; exit 1; }

# Resolve the sandbox to its PHYSICAL path. On macOS $TMPDIR both ends in a slash and is a
# symlink into /private/var, and the script under test reports `pwd -P` paths — so an
# unresolved expectation here would fail every case for a reason that has nothing to do with
# the script's behaviour.
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/reapgate.XXXXXX")"
SANDBOX="$(cd "$SANDBOX" && pwd -P)"
cleanup() { [ -n "${SANDBOX:-}" ] && [ -d "$SANDBOX" ] && rm -rf "$SANDBOX"; }
trap cleanup EXIT

PASS=0
FAIL=0

# new_repo <name> -> echoes the path of a fresh main checkout with a witness ref
new_repo() {
  local d="$SANDBOX/$1"
  mkdir -p "$d"
  git init -q "$d"
  git -C "$d" config user.email gate@test
  git -C "$d" config user.name gate
  printf 'build/\n*.log\n' > "$d/.gitignore"
  echo base > "$d/a.txt"
  git -C "$d" add a.txt .gitignore
  git -C "$d" commit -qm base
  # a SECOND ref, so a finished worktree has the witness the script demands
  git -C "$d" branch keep-ref
  mkdir -p "$d/.claude/worktrees"
  printf '%s' "$d"
}

# assert_has <case> <plan-file> <needle>
assert_has() {
  if grep -qF -- "$3" "$2"; then
    echo "  PASS  $1: plan contains '$3'"; PASS=$((PASS+1))
  else
    echo "  FAIL  $1: plan does NOT contain '$3'"; sed 's/^/        | /' "$2"; FAIL=$((FAIL+1))
  fi
}

# assert_lacks <case> <plan-file> <needle>
assert_lacks() {
  if grep -qF -- "$3" "$2"; then
    echo "  FAIL  $1: plan wrongly contains '$3'"; sed 's/^/        | /' "$2"; FAIL=$((FAIL+1))
  else
    echo "  PASS  $1: plan does not contain '$3'"; PASS=$((PASS+1))
  fi
}

# assert_eq <case> <label> <actual> <expected>
assert_eq() {
  if [ "$3" = "$4" ]; then
    echo "  PASS  $1: $2 = '$4'"; PASS=$((PASS+1))
  else
    echo "  FAIL  $1: $2 = '$3', expected '$4'"; FAIL=$((FAIL+1))
  fi
}

run_plan() {  # run_plan <repo-dir> <cwd> [args...] -> writes plan to $PLAN
  local repo="$1" where="$2"; shift 2
  PLAN="$SANDBOX/plan.$$.txt"
  ( cd "$where" && bash "$SCRIPT" "$@" ) > "$PLAN" 2>&1
}

echo "=== case 0: POSITIVE CONTROL — a finished worktree must be planned REMOVE ==="
R="$(new_repo c0)"
git -C "$R" worktree add -q "$R/.claude/worktrees/done" -b donebr
run_plan "$R" "$R"
assert_has  "case0" "$PLAN" "REMOVE  $R/.claude/worktrees/done"
assert_has  "case0" "$PLAN" "class: FINISHED"

echo "=== case 1: a LIVE worktree whose path contains a space ==="
R="$(new_repo c1)"
git -C "$R" worktree add -q "$R/.claude/worktrees/my agent" -b spacebr
run_plan "$R" "$R"
# The whole path must survive parsing...
assert_has   "case1" "$PLAN" "$R/.claude/worktrees/my agent"
# ...and a directory that is on disk must never be called a phantom.
assert_lacks "case1" "$PLAN" "PHANTOM"
assert_lacks "case1" "$PLAN" "no data on disk to lose"

echo "=== case 2: clean tracked tree holding GITIGNORED data ==="
R="$(new_repo c2)"
git -C "$R" worktree add -q "$R/.claude/worktrees/ign" -b ignbr
mkdir -p "$R/.claude/worktrees/ign/build"
head -c 65536 /dev/zero > "$R/.claude/worktrees/ign/build/artifact.bin"
echo payload > "$R/.claude/worktrees/ign/run.log"
run_plan "$R" "$R"
assert_has   "case2" "$PLAN" "KEEP    $R/.claude/worktrees/ign"
assert_has   "case2" "$PLAN" "ignored path(s) hold data git will not"
assert_lacks "case2" "$PLAN" "REMOVE  $R/.claude/worktrees/ign"
# and the receipt must not claim a cleanliness the check never established
assert_lacks "case2" "$PLAN" "proof: tracked+untracked clean"

echo "=== case 2b: an ACTIVE agent with a LARGE run dir is kept AS ACTIVE, not as a failed probe ==="
# REGRESSION GUARD for a real defect these 37 cases could not see. The liveness probe read
# `find ... | head -1` and then $?, which is the PIPELINE's status: head exits after one line, and
# once the listing exceeds the 64KB pipe buffer find dies of SIGPIPE and the substitution yields
# 141. MEASURED: 900 long-named entries give rc=141 through head and rc=0 with -print -quit. The
# worktree was still KEPT (the guard fails closed), so nothing was lost -- but for the WRONG
# REASON and permanently, and a reason nobody could act on. Every prior fixture had a small run
# dir, so the bug was invisible. This case makes the dir big enough to trigger it.
R="$(new_repo c2b)"
git -C "$R" worktree add -q "$R/.claude/worktrees/wf_deadbeef-111-1" -b wfbigbr
PROJ="$SANDBOX/projects_big"
mkdir -p "$PROJ/wf_deadbeef-111"
_pad="$(printf '%0.sx' $(seq 1 180))"
i=1; while [ "$i" -le 900 ]; do : > "$PROJ/wf_deadbeef-111/${_pad}_$i"; i=$((i + 1)); done
PLAN="$SANDBOX/plan.c2b.txt"
( cd "$R" && CLAUDE_PROJECTS_DIR="$PROJ" bash "$SCRIPT" ) > "$PLAN" 2>&1
assert_has   "case2b" "$PLAN" "KEEP    $R/.claude/worktrees/wf_deadbeef-111-1"
assert_has   "case2b" "$PLAN" "ACTIVE-AGENT"
# THE POINT: the reason must be liveness, never a probe that could not run.
assert_lacks "case2b" "$PLAN" "activity probe FAILED"

echo "=== case 3: phantom record whose lock reason has NO parseable pid ==="
R="$(new_repo c3)"
git -C "$R" worktree add -q "$R/.claude/worktrees/weird" -b weirdbr
git -C "$R" worktree lock --reason "claude agent nameless" "$R/.claude/worktrees/weird"
rm -rf "$R/.claude/worktrees/weird"
run_plan "$R" "$R"
assert_has   "case3" "$PLAN" "KEEP    $R/.claude/worktrees/weird"
assert_has   "case3" "$PLAN" "NO parseable '(pid N)'"
assert_lacks "case3" "$PLAN" "PRUNE   $R/.claude/worktrees/weird"
assert_lacks "case3" "$PLAN" "dead pid unknown"

echo "=== case 3b: phantom whose lock pid IS dead must still be pruned ==="
R="$(new_repo c3b)"
git -C "$R" worktree add -q "$R/.claude/worktrees/dead" -b deadbr
git -C "$R" worktree lock --reason "claude agent gone (pid 999999)" "$R/.claude/worktrees/dead"
rm -rf "$R/.claude/worktrees/dead"
if ps -p 999999 >/dev/null 2>&1; then
  echo "  SKIP  case3b: pid 999999 unexpectedly exists on this host"
else
  run_plan "$R" "$R"
  assert_has "case3b" "$PLAN" "PRUNE   $R/.claude/worktrees/dead"
  assert_has "case3b" "$PLAN" "lock pid 999999 confirmed dead"
fi

echo "=== case 3c: phantom whose lock file is EMPTY (no --reason) is still LOCKED ==="
# `git worktree lock` without --reason writes a ZERO-BYTE file. Nothing in it can be parsed,
# so the holder is unknown — which is an UNCERTAIN lock, never an absent one.
R="$(new_repo c3c)"
git -C "$R" worktree add -q "$R/.claude/worktrees/bare" -b barebr
git -C "$R" worktree lock "$R/.claude/worktrees/bare"
rm -rf "$R/.claude/worktrees/bare"
run_plan "$R" "$R"
assert_has   "case3c" "$PLAN" "KEEP    $R/.claude/worktrees/bare"
assert_lacks "case3c" "$PLAN" "PRUNE   $R/.claude/worktrees/bare"

echo "=== case 6: a LIVE worktree that is git-LOCKED is never REMOVE, however clean ==="
# The lock was consulted only for phantoms: a worktree still on disk was judged purely on
# cleanliness and removed, and the apply loop double-forced past the lock. The native governor
# pins every locked record; the two tools must not disagree about what "locked" means.
R="$(new_repo c6)"
git -C "$R" worktree add -q "$R/.claude/worktrees/heldA" -b heldabr
git -C "$R" worktree lock --reason "claude agent alive (pid $$)" "$R/.claude/worktrees/heldA"
run_plan "$R" "$R"
assert_has   "case6" "$PLAN" "KEEP    $R/.claude/worktrees/heldA"
assert_has   "case6" "$PLAN" "reason: git-LOCKED"
assert_lacks "case6" "$PLAN" "REMOVE  $R/.claude/worktrees/heldA"

echo "=== case 6b: a LIVE worktree with an EMPTY lock file is equally protected ==="
R="$(new_repo c6b)"
git -C "$R" worktree add -q "$R/.claude/worktrees/heldB" -b heldbbr
git -C "$R" worktree lock "$R/.claude/worktrees/heldB"
run_plan "$R" "$R"
assert_has   "case6b" "$PLAN" "KEEP    $R/.claude/worktrees/heldB"
assert_has   "case6b" "$PLAN" "no reason recorded"
assert_lacks "case6b" "$PLAN" "REMOVE  $R/.claude/worktrees/heldB"

echo "=== case 6c: --apply does not delete a locked worktree, and says so ==="
R="$(new_repo c6c)"
git -C "$R" worktree add -q "$R/.claude/worktrees/heldC" -b heldcbr
git -C "$R" worktree lock "$R/.claude/worktrees/heldC"
run_plan "$R" "$R" --apply
if [ -d "$R/.claude/worktrees/heldC" ]; then ondisk=YES; else ondisk=NO; fi
assert_eq    "case6c" "locked worktree still on disk after --apply" "$ondisk" "YES"
assert_lacks "case6c" "$PLAN" "removed $R/.claude/worktrees/heldC"

echo "=== case 4: invoked from INSIDE a linked worktree ==="
R="$(new_repo c4)"
git -C "$R" worktree add -q "$R/.claude/worktrees/here" -b herebr
git -C "$R" worktree add -q "$R/.claude/worktrees/other" -b otherbr
run_plan "$R" "$R/.claude/worktrees/here"
# The registered root must be the MAIN checkout's, so nothing is misfiled as outside it,
assert_lacks "case4" "$PLAN" "outside registered root"
# the worktree we stand in must be refused BY NAME (not silently mistaken for MAIN),
assert_has   "case4" "$PLAN" "KEEP    $R/.claude/worktrees/here"
assert_has   "case4" "$PLAN" "reason: current worktree"
# and the sibling must be judged on its merits rather than skipped.
assert_has   "case4" "$PLAN" "$R/.claude/worktrees/other"
# the receipt belongs in the MAIN checkout, never in the ephemeral worktree
assert_has   "case4" "$PLAN" "receipt: $R/implementation/sacrosanct/storage-receipts/"
assert_lacks "case4" "$PLAN" "receipt: $R/.claude/worktrees/here/"

echo "=== case 5: --apply removes a space-path worktree and preserves its commits ==="
R="$(new_repo c5)"
git -C "$R" worktree add -q "$R/.claude/worktrees/done agent" -b applybr
SHA_BEFORE="$(git -C "$R" rev-parse applybr)"
run_plan "$R" "$R" --apply
assert_has "case5" "$PLAN" "removed $R/.claude/worktrees/done agent"
if [ -d "$R/.claude/worktrees/done agent" ]; then ondisk=YES; else ondisk=NO; fi
assert_eq  "case5" "directory still on disk" "$ondisk" "NO"
assert_eq  "case5" "branch applybr still holds the commit" \
           "$(git -C "$R" rev-parse applybr 2>/dev/null)" "$SHA_BEFORE"
left="$(git -C "$R" worktree list --porcelain -z | tr '\0' '\n' | grep -c '^worktree ' | tr -d ' ')"
assert_eq  "case5" "worktree records remaining" "$left" "1"

echo "=== case 7: is_locked_now answers in BOTH directions ==="
# The apply loop re-reads the lock, because a lock may be taken between the plan and the
# removal. That re-read is only reachable in a race, so exercise the predicate directly —
# extracted verbatim from the script under test, not restated here.
R="$(new_repo c7)"
git -C "$R" worktree add -q "$R/.claude/worktrees/held me" -b heldmebr   # path with a space
git -C "$R" worktree add -q "$R/.claude/worktrees/freewt" -b freewtbr
git -C "$R" worktree lock "$R/.claude/worktrees/held me"                 # EMPTY lock
FN="$SANDBOX/is_locked_now.sh"
sed -n '/^is_locked_now() {/,/^}/p' "$SCRIPT" > "$FN"
if [ ! -s "$FN" ]; then
  echo "  FAIL  case7: is_locked_now is not defined in $SCRIPT"; FAIL=$((FAIL+1))
else
  # shellcheck disable=SC1090
  . "$FN"
  ( cd "$R" && is_locked_now "$R/.claude/worktrees/held me" ) \
    && { echo "  PASS  case7: an EMPTY lock on a spaced path reads LOCKED"; PASS=$((PASS+1)); } \
    || { echo "  FAIL  case7: an EMPTY lock on a spaced path read as unlocked"; FAIL=$((FAIL+1)); }
  ( cd "$R" && is_locked_now "$R/.claude/worktrees/freewt" ) \
    && { echo "  FAIL  case7: an unlocked worktree read as LOCKED"; FAIL=$((FAIL+1)); } \
    || { echo "  PASS  case7: an unlocked worktree reads unlocked"; PASS=$((PASS+1)); }
fi

echo "=== case 8: a FINISHED worktree that is IN USE must be refused ==="
# The near-miss this check exists for: on 2026-08-28 a worktree was tracked-clean,
# unlocked, and its HEAD sat on a remote branch -- FINISHED by every git test -- while
# another repository's 2.5-hour run was executing the forge_verify binary built inside
# it. Git cannot observe that; an open file under the tree can.
R="$(new_repo c8)"
W="$R/.claude/worktrees/inuse"
git -C "$R" worktree add -q "$W" -b inusebr

# (a) BEFORE: with nothing holding it, it must be planned REMOVE. Without this the KEEP
#     in (b) proves nothing -- a worktree refused for some OTHER reason would satisfy an
#     "is it kept?" assertion just as well.
run_plan "$R" "$R"
assert_has  "case8a" "$PLAN" "REMOVE  $W"

# (b) hold a descriptor open UNDER the worktree and re-run: the same tree must flip.
# The holder must be ONE process. `( exec 9< f; sleep 25 ) &` looks equivalent but the
# subshell forks sleep, which INHERITS fd 9 -- killing the subshell leaves the orphan
# holding the file, so the refusal in (c) never lifted and the case failed. Redirecting
# on sleep itself makes the descriptor die with the pid.
sleep 25 9< "$W/a.txt" &
HOLD=$!
sleep 1
run_plan "$R" "$R"
assert_has   "case8b" "$PLAN" "KEEP    $W"
assert_has   "case8b" "$PLAN" "IN USE"
assert_lacks "case8b" "$PLAN" "REMOVE  $W"
kill "$HOLD" 2>/dev/null; wait "$HOLD" 2>/dev/null
# and do not race the kernel: assert the descriptor is actually gone before re-running.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -z "$(lsof -nP +D "$W" 2>/dev/null | tail -n +2)" ] && break
  sleep 0.5
done

# (c) AFTER the holder exits the refusal must lift, or the check is just a permanent KEEP
#     wearing a reason.
run_plan "$R" "$R"
assert_has   "case8c" "$PLAN" "REMOVE  $W"
assert_lacks "case8c" "$PLAN" "IN USE"

echo ""
echo "reap_worktrees gate: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
