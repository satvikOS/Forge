#!/usr/bin/env bash
# actions_pinned_gate.sh — every GitHub Action this repository runs is pinned to
# an immutable commit, and no checkout leaves a credentialed remote behind.
#
# WHY. A `uses: actions/checkout@v4` resolves through a MUTABLE tag: whoever can
# move that tag chooses the code that runs in CI, with the repository checked out
# and, by default, a credential in `.git/config` that every child process can
# read -- including a 40-minute CMake build of third-party code. CWE-829,
# Inclusion of Functionality from Untrusted Control Sphere.
#
# WHAT IS CHECKED, and each clause is here because its absence was a real state
# of this repository rather than a hypothetical:
#
#   1. every `uses: actions/...` names a 40-hex commit, never a tag;
#   2. each pinned line carries a `# <version>` comment, because a bare SHA is
#      unreviewable -- nobody can tell v4 from v3 by looking;
#   3. every actions/checkout declares `persist-credentials: false`.
#
# CLAUSE 3 IS SAFE HERE AND THAT WAS MEASURED, NOT ASSUMED. Before it was
# applied, every workflow was swept for an operation that needs a credentialed
# remote -- `git push`, `git fetch`, `git ls-remote`, a submodule update -- and
# there are NONE. The release job's writes go through `gh`, which authenticates
# from GH_TOKEN in the environment and not from the git remote, and its one git
# command (`rev-list --count`) reads the local clone. If a job ever does need to
# push, it should say so in a comment and this gate should grow an allowlist
# rather than be deleted.
#
# Hermetic: bash + grep, no build, runs in well under a second.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

DIR="${ACTIONS_WORKFLOW_DIR:-.github/workflows}"
[ -d "$DIR" ] || { echo "[actions-pinned] FATAL: no $DIR" >&2; exit 2; }

shopt -s nullglob
FILES=("$DIR"/*.yml "$DIR"/*.yaml)
[ "${#FILES[@]}" -gt 0 ] || { echo "[actions-pinned] FATAL: no workflows in $DIR" >&2; exit 2; }

fail=0
checks=0
note() { echo "  FAIL  $1"; fail=$((fail + 1)); }

for f in "${FILES[@]}"; do
  # ---- 1 + 2: every action reference is a commit, and says which version -----
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    n="${line%%:*}"
    body="${line#*:}"
    ref="$(printf '%s' "$body" | sed -n 's/.*uses:[[:space:]]*\([^[:space:]]*\).*/\1/p')"
    checks=$((checks + 1))
    case "$ref" in
      *@*) ;;
      *) note "$f:$n uses '$ref' with no version at all"; continue ;;
    esac
    sha="${ref##*@}"
    if ! printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$'; then
      note "$f:$n '$ref' is a MUTABLE reference; pin it to a 40-hex commit"
      continue
    fi
    if ! printf '%s' "$body" | grep -Eq '#[[:space:]]*v?[0-9]'; then
      note "$f:$n '$ref' is pinned but carries no '# <version>' comment, so nobody can review what it pins"
    fi
  done < <(grep -nE '^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]*[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@' "$f")

  # ---- 3: every checkout drops its credential -------------------------------
  # The step's keys sit at the column `uses` itself occupies, so the block is
  # everything indented at least that far after the line.
  #
  # ★A COMMENT IS NOT A SETTING, and the first version of this gate could not
  # tell the difference. It grepped the block for `persist-credentials: false`,
  # so a step carrying a LIVE `persist-credentials: true` next to an indented
  # `# persist-credentials: false` passed while GitHub kept the token in
  # .git/config. This repository already knew that shape: one of the nine red
  # paths in gate_registration_selftest.sh is "an ad-hoc runner named only in a
  # YAML comment". So the block is filtered to LIVE lines, at least one must set
  # it, and none may set it true. Found in review.
  while IFS= read -r line; do
    n="${line%%:*}"
    col="$(awk -v ln="$n" 'NR==ln{match($0,/uses:/); print RSTART-1}' "$f")"
    checks=$((checks + 1))
    block="$(awk -v ln="$n" -v col="$col" '
          NR <= ln { next }
          { if ($0 ~ /^[[:space:]]*$/) next
            ind = match($0 "x", /[^ ]/) - 1
            if (ind < col) exit
            if (ind == col && $0 ~ /^[[:space:]]*-[[:space:]]/) exit
            if ($0 ~ /^[[:space:]]*#/) next          # a comment is not a setting
            print }
        ' "$f")"
    # Count ANY live setting and the subset that says false; a "not false"
    # pattern is not worth writing -- `[[:space:]]*[^f]` matched the SPACE in
    # `persist-credentials: false` and reddened all 18 correct checkouts on the
    # first attempt. Subtraction cannot misread its own negation.
    live_any="$(printf '%s\n' "$block" | grep -cE '^[[:space:]]*persist-credentials:')"
    live_false="$(printf '%s\n' "$block" | grep -cE '^[[:space:]]*persist-credentials:[[:space:]]+false[[:space:]]*(#.*)?$')"
    if [ "${live_any:-0}" -gt "${live_false:-0}" ]; then
      note "$f:$n actions/checkout sets persist-credentials to something other than false"
    elif [ "${live_false:-0}" -eq 0 ]; then
      note "$f:$n actions/checkout does not declare 'persist-credentials: false' (a commented one does not count)"
    fi
  done < <(grep -nE '^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]*actions/checkout@' "$f")
done

echo "[actions-pinned] ${#FILES[@]} workflow(s), $checks checks, $fail failures"
if [ "$fail" -ne 0 ]; then
  echo "[actions-pinned] RED"
  exit 1
fi
echo "[actions-pinned] GREEN — every action is pinned to a commit and every checkout drops its credential"
