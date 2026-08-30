#!/usr/bin/env bash
# forge-desktop/emit_appcast.sh
#
# Writes the appcast — the small JSON document a RUNNING copy of Forge reads to
# discover, and then verify, the next release.
#
# This is a separate script, and not eight lines inside package_macos.sh, for one
# reason: it is one half of a contract whose other half is C++
# (forge-desktop/src/update/Manifest.cpp). A producer and a consumer that must
# agree byte-for-byte and are never exercised together will drift. Because the
# writer lives here, test/appcast_selftest.sh can run THIS script and feed its
# output to the REAL parser, so "the packaging script emits something the app
# accepts" is a measured claim.
#
#   emit_appcast.sh --version 0.1.1 --zip dist/Forge-macos-arm64-0.1.1.zip \
#                   --min-macos 15.0 --out dist/appcast.json [--repo owner/name]
#
# ── HOW THE APP FINDS THIS FILE ──────────────────────────────────────────────
# The app fetches ONE fixed URL:
#     https://github.com/<repo>/releases/latest/download/appcast.json
# GitHub resolves `releases/latest/download/<asset>` to that asset on the newest
# release that is neither a DRAFT nor a PRERELEASE. Three consequences:
#   * nothing per-release has to be baked into the app;
#   * it is not api.github.com, so it does not carry the 60-requests-an-hour
#     unauthenticated rate limit that shipped updaters hit from behind a NAT;
#   * a DRAFT release is invisible to every installed copy. The release workflow
#     creates releases as drafts, so the human "press Publish" step is already
#     the gate on auto-update. Nothing may be added that bypasses it.
#
# ── WHY `url` NAMES ONE RELEASE ──────────────────────────────────────────────
# The manifest and the payload are two separate HTTP requests, and `sha256`
# describes the bytes of ONE build. A `releases/latest/download/...` payload URL
# would mean a release published between those two requests makes a correct
# client download a correct file and reject it as corrupt — indistinguishable
# from an attack. isPayloadUrlPinned() in the app refuses a floating URL outright,
# so getting this wrong is a refusal rather than a silent hazard.
set -uo pipefail

die() { echo "[appcast] FATAL: $*" >&2; exit 1; }

VERSION=""
ZIP=""
OUT=""
MIN_MACOS=""
REPO="${FORGE_REPO:-satvikOS/Forge}"

while [ $# -gt 0 ]; do
  case "$1" in
    --version)    shift; [ $# -gt 0 ] || die "--version needs a value";    VERSION="$1" ;;
    --zip)        shift; [ $# -gt 0 ] || die "--zip needs a value";        ZIP="$1" ;;
    --out)        shift; [ $# -gt 0 ] || die "--out needs a value";        OUT="$1" ;;
    --min-macos)  shift; [ $# -gt 0 ] || die "--min-macos needs a value";  MIN_MACOS="$1" ;;
    --repo)       shift; [ $# -gt 0 ] || die "--repo needs a value";       REPO="$1" ;;
    -h|--help)    sed -n '2,40p' "$0"; exit 0 ;;
    *)            die "unknown argument: $1" ;;
  esac
  shift
done

[ -n "$VERSION" ]   || die "--version is required"
[ -n "$ZIP" ]       || die "--zip is required"
[ -n "$OUT" ]       || die "--out is required"
[ -n "$MIN_MACOS" ] || die "--min-macos is required (pass the MEASURED floor, never a guess)"
[ -f "$ZIP" ]       || die "no such payload: $ZIP"

# A leading 'v' is a TAG convention; the version inside the manifest must match
# CFBundleShortVersionString, which has none.
VERSION="${VERSION#v}"

# The digest and the size are READ FROM THE FILE, never passed in. A caller that
# could supply them could describe a payload it had not measured, which is the
# one thing this document exists to prevent.
SHA="$(shasum -a 256 "$ZIP" | awk '{print $1}')" || die "shasum failed on $ZIP"
BYTES="$(stat -f %z "$ZIP" 2>/dev/null || stat -c %s "$ZIP")" || die "cannot size $ZIP"
[ "${#SHA}" -eq 64 ] || die "shasum did not return a 64-character digest: '$SHA'"
[ "$BYTES" -gt 0 ]   || die "payload is empty: $ZIP"

# A version carrying a prerelease suffix (0.2.0-rc.1, or the 0.0.0-dev+sha stamp
# CI puts on a dispatch build) goes out on its own channel. A stable client
# refuses a foreign channel AND refuses a prerelease version, so this is a second
# independent guard rather than the only one.
case "$VERSION" in
  *-*) CHANNEL="prerelease" ;;
  *)   CHANNEL="stable" ;;
esac

mkdir -p "$(dirname "$OUT")" || die "cannot create $(dirname "$OUT")"
cat > "$OUT" <<APPCAST_JSON
{
  "schema": "forge-appcast/1",
  "channel": "$CHANNEL",
  "version": "$VERSION",
  "arch": "arm64",
  "min_macos": "$MIN_MACOS",
  "url": "https://github.com/$REPO/releases/download/v$VERSION/Forge-macos-arm64-$VERSION.zip",
  "size": $BYTES,
  "sha256": "$SHA",
  "notes_url": "https://github.com/$REPO/releases/tag/v$VERSION",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
APPCAST_JSON
[ -s "$OUT" ] || die "wrote an empty appcast to $OUT"

# Valid JSON is necessary but nowhere near sufficient — the app's own parser is
# stricter than json.load. test/appcast_selftest.sh runs that parser over this
# file; this check only catches a shell-quoting accident early.
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$OUT" \
  || die "the appcast just written is not valid JSON: $OUT"

echo "[appcast] $OUT  version=$VERSION channel=$CHANNEL size=$BYTES sha256=$SHA"
