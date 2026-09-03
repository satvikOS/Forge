#!/bin/bash
# Is the shipped updater able to SEE the latest release?
#
# The app fetches its appcast from
#   https://github.com/satvikOS/Forge/releases/latest/download/appcast.json
# and GitHub resolves `latest` to the newest release that is NEITHER A DRAFT NOR A
# PRERELEASE. Both of those states are easy to reach by accident -- the release
# workflow creates every release as a draft, and an `alpha` version invites the
# prerelease flag -- and BOTH make that URL a 404.
#
# The failure is silent in the worst way: nothing errors, no release is malformed,
# the app simply never finds an update and every shipped copy is frozen for ever.
# Nothing else in this repository would notice, because every other check passes on
# a draft release exactly as it does on a published one.
#
# So this asks the ONE question the other checks cannot: given what is published
# right now, would an installed Forge find it?
#
#   ./release_visibility_check.sh              # is the newest release reachable?
#   ./release_visibility_check.sh --expect-version 0.1.0-alpha.6
#   ./release_visibility_check.sh --allow-unreleased   # for CI; see below
#
# Read-only. Uses the authenticated `gh` API and publishes nothing.
#
# ── --allow-unreleased, AND WHY IT IS NOT A WEAKENING ────────────────────────
# Run bare, this script FAILS when nothing is published. That is the right
# answer for a human asking "can my users update?", and it is the default.
#
# It is the wrong answer for a per-PR job, for one reason: BEFORE THE FIRST
# RELEASE, "nothing is published" is not a defect, it is the state the project
# is deliberately in -- no tag has been pushed, and pushing one is the owner's
# decision. A check that is red for a condition no pull request can change is a
# check people learn to ignore, and this repository already has that rule
# written down (desktop-release.yml, on Gatekeeper: "a check that cannot pass
# without a credential is a permanently red gate, which is the same as no gate
# at all").
#
# So --allow-unreleased tolerates EXACTLY ONE condition: zero published
# releases. Every other assertion stays hard, including the ones that matter
# most -- the moment a release IS published, it must carry an appcast.json and a
# zip or this goes red. It also still FAILS on an unreachable API, because "I
# could not ask" must never be reported as "the answer was fine".
#
# The flag is spelled at the CALL SITE, never defaulted on, so the tolerance is
# visible in the workflow rather than buried here.
set -uo pipefail

REPO="${FORGE_REPO:-satvikOS/Forge}"
EXPECT=""
ALLOW_UNRELEASED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --expect-version) shift; EXPECT="${1:-}" ;;
    --repo) shift; REPO="${1:-}" ;;
    --allow-unreleased) ALLOW_UNRELEASED=1 ;;
    *) echo "[release-visibility] unknown argument: $1"; exit 2 ;;
  esac
  shift
done

BAD=0
say()  { echo "[release-visibility] $*"; }
fail() { echo "  FAIL  $*"; BAD=$((BAD+1)); }
ok()   { echo "  ok    $*"; }

say "repo $REPO"

# ── every release, including the invisible ones ──────────────────────────────
ALL="$(gh api "repos/$REPO/releases" 2>/dev/null)" || ALL=""
if [ -z "$ALL" ]; then
  fail "cannot list releases (gh not authenticated, or no network)"
  say "$BAD problem(s)"; exit 1
fi

TOTAL="$(echo "$ALL" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')"
say "$TOTAL release(s) exist"
echo "$ALL" | python3 -c '
import sys,json
for r in json.load(sys.stdin):
    flags=[]
    if r["draft"]: flags.append("DRAFT")
    if r["prerelease"]: flags.append("PRERELEASE")
    state=",".join(flags) or "published"
    names=[a["name"] for a in r["assets"]]
    tag = r["tag_name"]
    line = "        %-24s %-20s assets=%d" % (tag, state, len(names))
    if names:
        line += "  " + " ".join(names)
    print(line)
'

# ── the question that matters ────────────────────────────────────────────────
LATEST="$(gh api "repos/$REPO/releases/latest" 2>/dev/null)" || LATEST=""
if [ -z "$LATEST" ]; then
  # The tolerated case, and ONLY this one: nothing has ever been published, so
  # there is no installed copy for a 404 to strand. Note the asymmetry -- if a
  # release IS published, every check below stays hard.
  if [ "$ALLOW_UNRELEASED" -eq 1 ] && [ "$BAD" -eq 0 ]; then
    say "PENDING — no PUBLISHED release exists yet, so there is nothing for an"
    echo "        installed copy to find. This is the pre-first-release state and"
    echo "        --allow-unreleased tolerates it. It is NOT a pass: the update"
    echo "        path is unexercised against the live API until a tag is pushed"
    echo "        and the resulting DRAFT release is published by a human."
    echo "        The $TOTAL release(s) listed above are drafts and/or prereleases;"
    echo "        GitHub's 'latest' skips both."
    exit 0
  fi
  fail "GET /releases/latest returned nothing — the updater's URL is a 404"
  echo "        Every release above is a draft or a prerelease. GitHub's 'latest'"
  echo "        skips both, so releases/latest/download/appcast.json does not"
  echo "        resolve and NO installed copy of Forge can ever see an update."
  echo "        Fix: publish a release that is NOT marked prerelease."
  say "$BAD problem(s)"; exit 1
fi

TAG="$(echo "$LATEST" | python3 -c 'import sys,json;print(json.load(sys.stdin)["tag_name"])')"
ok "GET /releases/latest resolves to $TAG"

HAS_APPCAST="$(echo "$LATEST" | python3 -c '
import sys,json
print("yes" if any(a["name"]=="appcast.json" for a in json.load(sys.stdin)["assets"]) else "no")')"
[ "$HAS_APPCAST" = "yes" ] \
  && ok "appcast.json is attached to $TAG" \
  || fail "$TAG has no appcast.json — the URL resolves to a release with nothing to read"

HAS_ZIP="$(echo "$LATEST" | python3 -c '
import sys,json
print("yes" if any(a["name"].endswith(".zip") for a in json.load(sys.stdin)["assets"]) else "no")')"
[ "$HAS_ZIP" = "yes" ] \
  && ok "a .zip is attached to $TAG" \
  || fail "$TAG has no .zip — an appcast pointing at nothing downloadable"

if [ -n "$EXPECT" ]; then
  case "$TAG" in
    *"$EXPECT"*) ok "latest carries the expected version $EXPECT" ;;
    *) fail "latest is $TAG, expected it to carry $EXPECT" ;;
  esac
fi

if [ "$BAD" -ne 0 ]; then say "$BAD problem(s) — an installed Forge would NOT update"; exit 1; fi
say "OK — an installed Forge would find $TAG"
