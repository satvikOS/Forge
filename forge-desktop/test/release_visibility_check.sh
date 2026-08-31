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
#
# Read-only. Uses the authenticated `gh` API and publishes nothing.
set -uo pipefail

REPO="${FORGE_REPO:-satvikOS/Forge}"
EXPECT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --expect-version) shift; EXPECT="${1:-}" ;;
    --repo) shift; REPO="${1:-}" ;;
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
