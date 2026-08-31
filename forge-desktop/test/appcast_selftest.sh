#!/usr/bin/env bash
# forge-desktop/test/appcast_selftest.sh
#
# PROVES THE PRODUCER AND THE CONSUMER AGREE. The release pipeline writes
# appcast.json in bash (forge-desktop/emit_appcast.sh); the shipped app reads it
# in C++ (forge-desktop/src/update/Manifest.cpp) with a parser that is
# deliberately stricter than json.load. Those two have to agree exactly, and
# until this script existed nothing ever ran them together.
#
# It runs the REAL emitter over a fixture payload, then the REAL parser and the
# REAL decide() over what came out, and asserts the verdict for several running
# versions. No network, no kernel, no OCCT: one c++ invocation.
#
# It also drives the failure paths, so this is a gate and not a demo:
#   * a hand-broken appcast is REFUSED by the app's parser;
#   * an appcast whose payload URL floats (releases/latest/download) is REFUSED;
#   * a prerelease version goes out on the prerelease channel and a stable client
#     refuses it.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP="$(dirname "$HERE")"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/forge-appcast-selftest.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

CHECK="$WORK/appcast_check"
fail=0
note() { echo "$*"; }
bad()  { echo "  FAIL  $*"; fail=1; }

echo "compiling the appcast checker (the app's own parser)"
c++ -std=c++20 -O1 -Wall -Wextra -Werror \
    -I "$DESKTOP/src" -o "$CHECK" \
    "$DESKTOP/src/update/Version.cpp" \
    "$DESKTOP/src/update/Sha256.cpp" \
    "$DESKTOP/src/update/Manifest.cpp" \
    "$DESKTOP/src/update/Updater.cpp" \
    "$HERE/appcast_check.cpp"
if [ $? -ne 0 ]; then
  echo "COMPILE FAILED -- a gate that cannot build cannot fail." >&2
  exit 2
fi

# A stand-in payload. Its CONTENT is irrelevant here: what is under test is that
# the emitter measures the file it was given and that the app accepts the
# document describing it.
PAYLOAD="$WORK/Forge-macos-arm64-0.2.0.zip"
head -c 4096 /dev/urandom > "$PAYLOAD"

echo
note "── 1. a stable release: emitted, then read back by the app's parser ──────"
bash "$DESKTOP/emit_appcast.sh" --version 0.2.0 --repo satvikOS/Forge \
     --zip "$PAYLOAD" --min-macos 15.0 --out "$WORK/appcast.json" || bad "emitter failed"

# The digest in the document must be the digest OF THE FILE, not something the
# caller supplied. Check it against an independent tool.
WANT_SHA="$(shasum -a 256 "$PAYLOAD" | awk '{print $1}')"
GOT_SHA="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sha256"])' "$WORK/appcast.json")"
[ "$WANT_SHA" = "$GOT_SHA" ] || bad "appcast sha256 $GOT_SHA != shasum $WANT_SHA"
WANT_SZ="$(stat -f %z "$PAYLOAD")"
GOT_SZ="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["size"])' "$WORK/appcast.json")"
[ "$WANT_SZ" = "$GOT_SZ" ] || bad "appcast size $GOT_SZ != stat $WANT_SZ"

"$CHECK" "$WORK/appcast.json" --running 0.1.0  --expect update   || bad "0.1.0 was not offered 0.2.0"
"$CHECK" "$WORK/appcast.json" --running 0.2.0  --expect uptodate || bad "0.2.0 was not told it is current"
"$CHECK" "$WORK/appcast.json" --running 0.3.0  --expect reject   || bad "0.3.0 was offered a DOWNGRADE"
"$CHECK" "$WORK/appcast.json" --running 0.10.0 --expect reject   || bad "0.10.0 was offered 0.2.0 (lexical compare?)"
"$CHECK" "$WORK/appcast.json" --running 0.0.0-dev+abc1234 --expect update \
  || bad "the CI dev build was not offered a real release"

echo
note "── 2. a prerelease goes out on its own channel and a stable client refuses it"
bash "$DESKTOP/emit_appcast.sh" --version 0.3.0-rc.1 --repo satvikOS/Forge \
     --zip "$PAYLOAD" --min-macos 15.0 --out "$WORK/rc.json" >/dev/null || bad "emitter failed on an rc"
RC_CHANNEL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["channel"])' "$WORK/rc.json")"
[ "$RC_CHANNEL" = "prerelease" ] || bad "an rc was published on channel '$RC_CHANNEL'"
"$CHECK" "$WORK/rc.json" --running 0.2.0 --expect reject || bad "a stable client accepted an rc"
"$CHECK" "$WORK/rc.json" --running 0.2.0 --expect update --allow-prerelease \
  || bad "opting in to prereleases did not offer the rc"

echo
note "── 3. the failure paths ──────────────────────────────────────────────────"
# A floating payload URL. The emitter cannot produce one, so it is hand-made here
# to prove the app refuses it if a future change ever did.
python3 - "$WORK/appcast.json" "$WORK/floating.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
m["url"] = "https://github.com/satvikOS/Forge/releases/latest/download/Forge-macos-arm64.zip"
json.dump(m, open(sys.argv[2], "w"), indent=2)
PY
"$CHECK" "$WORK/floating.json" --running 0.1.0 --expect reject \
  || bad "a FLOATING payload URL was accepted"

python3 - "$WORK/appcast.json" "$WORK/offhost.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
m["url"] = "https://cdn.evil.tld/releases/download/v0.2.0/Forge-macos-arm64-0.2.0.zip"
json.dump(m, open(sys.argv[2], "w"), indent=2)
PY
"$CHECK" "$WORK/offhost.json" --running 0.1.0 --expect reject \
  || bad "an OFF-HOST payload URL was accepted"

printf '{"schema": "forge-appcast/1", "version": "9.9.9",}\n' > "$WORK/broken.json"
if "$CHECK" "$WORK/broken.json" --running 0.1.0 --expect reject >/dev/null 2>&1; then
  bad "a malformed appcast did not make the checker exit non-zero"
else
  note "  a malformed appcast is refused by the app's parser"
fi

# The emitter must refuse to describe a payload it cannot measure.
if bash "$DESKTOP/emit_appcast.sh" --version 0.2.0 --zip "$WORK/no-such.zip" \
        --min-macos 15.0 --out "$WORK/never.json" >/dev/null 2>&1; then
  bad "the emitter described a payload that does not exist"
else
  note "  the emitter refuses a payload it cannot measure"
fi
if bash "$DESKTOP/emit_appcast.sh" --version 0.2.0 --zip "$PAYLOAD" \
        --out "$WORK/never2.json" >/dev/null 2>&1; then
  bad "the emitter invented a min_macos floor instead of requiring the measured one"
else
  note "  the emitter requires the MEASURED macOS floor to be passed in"
fi

echo
if [ "$fail" -ne 0 ]; then
  echo "RESULT: FAILED"
  exit 1
fi
echo "RESULT: PASSED  (the packaging script and the app agree on the appcast)"
