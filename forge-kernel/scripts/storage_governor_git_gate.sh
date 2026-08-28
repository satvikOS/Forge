#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# storage_governor_git_gate.sh — INTEGRATION gate for the native storage
# governor's git evidence path (Sacrosanct s21.3).
#
# The pure-C++ gate (test/native/storage/storage_governor_test.cpp, run by
# run_native.sh) proves classify()'s safety properties with no dependencies.
# This gate proves the OTHER half: that Scanner + RealGitProbe read a REAL git
# repository correctly — in particular the s21.3 trap, where a merged worktree
# is kept for ever because its unpushed-check compares against a ref that
# merging just deleted.
#
# It builds a throwaway repository in a mkdtemp directory containing, on
# purpose, one of each situation:
#
#   merged   checkout GONE, branch DELETED by the merge, commits ARE on the
#            pushed ref            -> containment proven WITHOUT the branch
#                                     -> PROVABLY_DISPOSABLE
#   unique   checkout GONE, branch alive, one commit on no pushed ref
#                                     -> MUST_PIN
#   orphan   checkout GONE, branch DELETED, commits NOT on the pushed ref
#                                     -> NEEDS_PROOF, naming the lost ref
#   live     checkout PRESENT and dirty -> MUST_PIN (HOT session artifact)
#
# This script contains NO deletion logic for anything the governor manages. The
# only rm it performs is of its own mkdtemp fixture, and of that fixture's own
# worktree checkouts, which is how the phantom records under test are created.
#
# Exit 0 iff all six expectations hold.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CXX="${CXX:-clang++}"

BINDIR="$(mktemp -d /tmp/forge_sg_bin.XXXXXX)"
BIN="$BINDIR/storage_govern"
echo "[git-gate] building storage_govern"
if ! $CXX -std=c++20 -O2 -I "$ROOT/forge-kernel/include" \
      "$ROOT/forge-kernel/src/native/storage/StorageGovernor.cpp" \
      "$ROOT/forge-kernel/tools/storage_govern_main.cpp" -o "$BIN"; then
  echo "[git-gate] BUILD FAILED"; exit 1
fi

FIX="$(mktemp -d /tmp/forge_sg_fixture.XXXXXX)"
cleanup() { rm -rf "$FIX" "$BINDIR"; }
trap cleanup EXIT

export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=gate GIT_AUTHOR_EMAIL=gate@local
export GIT_COMMITTER_NAME=gate GIT_COMMITTER_EMAIL=gate@local

WS="$FIX/work"
G() { git -C "$WS" "$@"; }          # every git call below targets the FIXTURE

git init --quiet --bare "$FIX/origin.git"
git init --quiet -b main "$WS"
G remote add origin "$FIX/origin.git"
echo one > "$WS/a.txt"; G add a.txt; G commit --quiet -m base
G push --quiet origin main

# git names the .git/worktrees record after the CHECKOUT DIRECTORY, and the
# governor derives the branch as refs/heads/worktree-<record>. Mirror the repo's
# real convention exactly: checkout dir <name> -> record <name> -> branch
# refs/heads/worktree-<name>.
mkwt() { G worktree add --quiet -b "worktree-$1" "$FIX/$1" main; }

# Low-level ref deletion: `git branch -D` refuses while a worktree record still
# claims the branch, and that refusal is exactly what would make this fixture
# quietly fail to set the trap.
delref() { G update-ref -d "refs/heads/worktree-$1"; }
assert_gone() {
  if G rev-parse --verify --quiet "refs/heads/worktree-$1" >/dev/null; then
    echo "[git-gate] FIXTURE BROKEN: refs/heads/worktree-$1 survives; the trap is not set"
    exit 1
  fi
}

# ── merged: work landed on main and was pushed; the branch was then deleted ──
mkwt merged
echo m > "$FIX/merged/m.txt"
git -C "$FIX/merged" add m.txt
git -C "$FIX/merged" commit --quiet -m merged-work
MERGED_SHA="$(git -C "$FIX/merged" rev-parse HEAD)"
G merge --quiet --no-edit worktree-merged
G push --quiet origin main
rm -rf "$FIX/merged"                       # the checkout vanishes -> phantom record
delref merged; assert_gone merged          # THE TRAP: the comparison ref is deleted

# ── unique: one commit reachable from no pushed ref; branch still alive ──────
mkwt unique
echo u > "$FIX/unique/u.txt"
git -C "$FIX/unique" add u.txt
git -C "$FIX/unique" commit --quiet -m unique-work
rm -rf "$FIX/unique"

# ── orphan: commit NOT on the pushed ref AND the branch is gone ──────────────
mkwt orphan
echo o > "$FIX/orphan/o.txt"
git -C "$FIX/orphan" add o.txt
git -C "$FIX/orphan" commit --quiet -m orphan-work
rm -rf "$FIX/orphan"
delref orphan; assert_gone orphan

# ── live: a real, dirty checkout ────────────────────────────────────────────
mkwt live
echo dirty > "$FIX/live/scratch.txt"

G fetch --quiet origin
mkdir -p "$FIX/fakehome"

echo "[git-gate] fixture built (merged sha $MERGED_SHA):"
ls "$WS/.git/worktrees" | sed 's/^/    record: /'

JSON="$FIX/plan.json"
"$BIN" --workspace "$WS" --home "$FIX/fakehome" \
       --pushed-ref refs/remotes/origin/main \
       --json "$JSON" > "$FIX/plan.txt" 2>&1 || { cat "$FIX/plan.txt"; exit 1; }

fail=0
expect() {  # $1 = record name  $2 = expected disposition  $3 = substring the reason must contain
  local row got why
  row="$(python3 - "$JSON" "$1" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
for e in d["entries"]:
    if e["path"].rstrip("/").endswith("/worktrees/"+sys.argv[2]):
        print(e["disposition"]+"\t"+e["reason"]); break
else:
    print("MISSING\t<no row for this record>")
PY
)"
  got="${row%%$'\t'*}"; why="${row#*$'\t'}"
  if [ "$got" != "$2" ]; then
    echo "[git-gate] FAIL $1: expected $2, got $got"; echo "           reason: $why"; fail=1
  elif ! printf '%s' "$why" | grep -qF -- "$3"; then
    echo "[git-gate] FAIL $1: reason did not mention '$3'"; echo "           reason: $why"; fail=1
  else
    echo "[git-gate] PASS $1 -> $got"
    echo "           $why"
  fi
}

expect merged PROVABLY_DISPOSABLE "reproducible"
expect unique MUST_PIN            "no pushed ref"
expect orphan NEEDS_PROOF         "no longer exists"
expect live   MUST_PIN            "SESSION_ARTIFACT"

# The trap's fallback must be VISIBLE in the plan, not merely implied.
if grep -qF "is GONE, but the record's recorded HEAD" "$FIX/plan.txt"; then
  echo "[git-gate] PASS the deleted-ref fallback is reported in the plan text"
else
  echo "[git-gate] FAIL the deleted-ref fallback was never exercised"; fail=1
fi

# And the tool must have deleted nothing at all.
if grep -qF '"deletes_performed": 0' "$JSON"; then
  echo "[git-gate] PASS the plan records zero deletions"
else
  echo "[git-gate] FAIL the plan does not assert zero deletions"; fail=1
fi

if [ "$fail" -ne 0 ]; then echo "[git-gate] RESULT: FAIL"; exit 1; fi
echo "[git-gate] RESULT: PASS — 6/6 real-git expectations hold"
