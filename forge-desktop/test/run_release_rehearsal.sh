#!/usr/bin/env bash
# forge-desktop/test/run_release_rehearsal.sh
#
# THE RELEASE REHEARSAL. Publishes a FAKE release to a LOCAL https server and
# makes a REAL, ALREADY-INSTALLED older Forge.app update itself to it.
#
# This exists because every other check in this tree stops one step short of the
# thing that actually has to work. release_dryrun.sh proves a zip and an appcast
# were BUILT. release_contract_gate.sh proves the workflow would UPLOAD them.
# release_visibility_check.sh proves a published release would be VISIBLE.
# update_gate.cpp proves the update LOGIC is right with a fetcher that copies a
# local file. Nothing anywhere proved that an installed copy, handed a real
# release over a real HTTPS transfer, ends up running the new version.
#
# That gap matters more here than it usually would, because the repository has
# never published anything: `git ls-remote --tags origin` returns nothing and
# `releases/latest` is a 404. The first time the real path runs end to end will
# be against real users unless it is rehearsed first. This is that rehearsal.
#
#   ./forge-desktop/test/run_release_rehearsal.sh
#   ./forge-desktop/test/run_release_rehearsal.sh --mutations   (also prove it can fail)
#   ./forge-desktop/test/run_release_rehearsal.sh --keep        (leave the sandbox for inspection)
#
# ── WHAT IS REAL HERE AND WHAT IS NOT ────────────────────────────────────────
# REAL: the update library (compiled from src/update/*.cpp, the same sources the
# shipped app links); /usr/bin/curl driven by the argument vector curlArgv()
# actually builds; a TLS handshake; the sha256 check; `ditto -x -k`; `codesign
# --verify --deep --strict`; renamex_np(RENAME_SWAP) on this filesystem; the
# appcast, written by the REAL emit_appcast.sh from the REAL zip's own bytes.
#
# NOT REAL, and there are exactly three of them:
#   1. THE HOST. github.com is replaced by 127.0.0.1 -- in the manifest URL (one
#      sed over the emitted file, host only) and in Policy::allowed_hosts (one
#      field). The driver re-runs the same decision under the SHIPPING policy and
#      requires a REFUSAL, so this substitution cannot hide a broken allow-list.
#   2. THE TLS ANCHOR. A self-signed cert for IP:127.0.0.1, handed to curl via
#      CURL_CA_BUNDLE. The transfer is still https and still certificate-verified;
#      only the anchor differs.
#   3. THE PAYLOAD. Forge.app here is a real, real-signed, correctly structured
#      bundle of small stub executables rather than a 40-minute OCCT build. Every
#      check the updater performs -- .app layout, Contents/MacOS/forge_desktop
#      present and executable, CFBundleShortVersionString, ad-hoc signature
#      validity -- operates on genuine bytes. What is NOT rehearsed is whether
#      the real app's own dylib closure survives the swap; package_macos.sh's
#      relocation test covers that separately.
#
# NOTHING here touches github.com. The one fixed URL the shipped app uses is
# never fetched; if this script ever starts contacting a non-loopback host,
# that is a defect in this script.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP="$(dirname "$HERE")"
ROOT="$(dirname "$DESKTOP")"

MUTATIONS=0
KEEP=0
for a in "$@"; do
  case "$a" in
    --mutations) MUTATIONS=1 ;;
    --keep)      KEEP=1 ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/forge-release-rehearsal.XXXXXX")" || exit 2
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; fi
  if [ "$KEEP" -eq 1 ]; then
    echo "sandbox kept at $SANDBOX"
  else
    rm -rf "$SANDBOX"
  fi
}
trap cleanup EXIT

say()  { printf '\n\033[1m── %s\033[0m\n' "$*"; }
die()  { echo "[rehearsal] FATAL: $*" >&2; exit 2; }

OLD_VERSION="0.1.0"
NEW_VERSION="0.1.1"
REPO="satvikOS/Forge"
SERVE="$SANDBOX/serve"
APPS="$SANDBOX/Applications"
BUILD="$SANDBOX/build"
mkdir -p "$SERVE" "$APPS" "$BUILD" || die "cannot create the sandbox"

# ─────────────────────────────────────────────────────────── 1. the real code
say "1. compile the update path (the same sources the shipped app links)"
UPDATE_SRC=(
  "$DESKTOP/src/update/Version.cpp"
  "$DESKTOP/src/update/Sha256.cpp"
  "$DESKTOP/src/update/Manifest.cpp"
  "$DESKTOP/src/update/Updater.cpp"
)
for f in "${UPDATE_SRC[@]}"; do [ -f "$f" ] || die "missing update source $f"; done

c++ -std=c++20 -O1 -g -Wall -Wextra -Werror -I "$DESKTOP/src" \
    -o "$BUILD/release_rehearsal" "${UPDATE_SRC[@]}" "$HERE/release_rehearsal.cpp" \
  || die "the rehearsal driver did not compile -- a rehearsal that cannot build proves nothing"
echo "  built $BUILD/release_rehearsal"

# The REAL shipped updater binary. It goes INSIDE both bundles, exactly as
# package_macos.sh stages it, so the swapped-in app is one that could update
# itself again -- which is the property that makes a release CHAIN rather than a
# single hop.
c++ -std=c++20 -O1 -g -Wall -Wextra -Werror -I "$DESKTOP/src" \
    -o "$BUILD/forge_update" "${UPDATE_SRC[@]}" "$DESKTOP/src/update/main_update_cli.cpp" \
  || die "forge_update did not compile"
echo "  built $BUILD/forge_update (the binary package_macos.sh stages in the bundle)"

# Stand-ins for the two executables the updater only ever checks for existence
# and executability. Real Mach-O, really signed -- not empty files, which would
# make the signature and X_OK checks meaningless.
cat > "$BUILD/stub.c" <<'STUB_C_EOF'
#include <stdio.h>
int main(int argc, char** argv) {
  (void)argc; (void)argv;
  printf("forge stub %s\n", FORGE_STUB_VERSION);
  return 0;
}
STUB_C_EOF

# ────────────────────────────────────────────────────── 2. build a real bundle
# Mirrors package_macos.sh's bundle layout and its signing order: every nested
# executable first, then the bundle, then verify. Getting that order wrong
# produces a bundle that codesign rejects, which is one of the failures this
# whole rehearsal is meant to be able to see.
make_bundle() {
  local version="$1" dest="$2"
  rm -rf "$dest"
  mkdir -p "$dest/Contents/MacOS" "$dest/Contents/Resources" || return 1
  cc -O1 -DFORGE_STUB_VERSION="\"$version\"" -o "$dest/Contents/MacOS/forge_desktop" \
     "$BUILD/stub.c" || return 1
  cc -O1 -DFORGE_STUB_VERSION="\"$version\"" -o "$dest/Contents/MacOS/forge_kernel_worker" \
     "$BUILD/stub.c" || return 1
  cp "$BUILD/forge_update" "$dest/Contents/MacOS/forge_update" || return 1
  chmod +x "$dest/Contents/MacOS/"* || return 1
  cat > "$dest/Contents/Info.plist" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>forge_desktop</string>
  <key>CFBundleIdentifier</key><string>com.satvikos.forge</string>
  <key>CFBundleName</key><string>Forge</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
</dict>
</plist>
PLIST_EOF
  local d
  for d in "$dest/Contents/MacOS/forge_desktop" \
           "$dest/Contents/MacOS/forge_kernel_worker" \
           "$dest/Contents/MacOS/forge_update"; do
    codesign --force --sign - --timestamp=none "$d" >/dev/null 2>&1 || return 1
  done
  codesign --force --sign - --timestamp=none "$dest" >/dev/null 2>&1 || return 1
  codesign --verify --deep --strict "$dest" >/dev/null 2>&1 || return 1
  return 0
}

say "2. build the two bundles: the copy a user already has, and the release"
make_bundle "$OLD_VERSION" "$BUILD/old/Forge.app" || die "could not build the installed bundle"
echo "  installed copy   Forge.app $OLD_VERSION (ad-hoc signed, codesign --verify OK)"
make_bundle "$NEW_VERSION" "$BUILD/new/Forge.app" || die "could not build the release bundle"
echo "  the release      Forge.app $NEW_VERSION (ad-hoc signed, codesign --verify OK)"

# ditto, matching package_macos.sh. A zip made any other way is not the archive
# the real release carries and would not exercise the same unpack path.
ZIP_NAME="Forge-macos-arm64-${NEW_VERSION}.zip"
ditto -c -k --keepParent "$BUILD/new/Forge.app" "$BUILD/$ZIP_NAME" \
  || die "ditto could not archive the release bundle"
echo "  packaged         $ZIP_NAME ($(stat -f %z "$BUILD/$ZIP_NAME") bytes)"

# ───────────────────────────────────────────────── 3. a local https "GitHub"
say "3. serve that release from a local https server (never github.com)"
mkdir -p "$SANDBOX/tls" || die "cannot create the tls dir"
openssl req -x509 -newkey rsa:2048 -keyout "$SANDBOX/tls/key.pem" -out "$SANDBOX/tls/cert.pem" \
  -days 1 -nodes -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" >/dev/null 2>&1 \
  || die "could not make a loopback certificate"

cat > "$SANDBOX/server.py" <<'SERVER_PY_EOF'
import functools, http.server, ssl, sys, threading
root, cert, key, portfile = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

handler = functools.partial(Quiet, directory=root)
httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(certfile=cert, keyfile=key)
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
with open(portfile, "w") as f:
    f.write(str(httpd.server_address[1]))
httpd.serve_forever()
SERVER_PY_EOF

PORTFILE="$SANDBOX/port"
python3 "$SANDBOX/server.py" "$SERVE" "$SANDBOX/tls/cert.pem" "$SANDBOX/tls/key.pem" "$PORTFILE" &
SERVER_PID=$!
for _ in $(seq 1 100); do [ -s "$PORTFILE" ] && break; sleep 0.1; done
[ -s "$PORTFILE" ] || die "the local https server never reported a port"
PORT="$(cat "$PORTFILE")"
BASE="https://127.0.0.1:${PORT}"
export CURL_CA_BUNDLE="$SANDBOX/tls/cert.pem"
echo "  serving $SERVE on $BASE (self-signed, CURL_CA_BUNDLE pinned to it)"

# The directory layout GitHub itself serves, so the URL SHAPES the updater
# checks -- 'releases/latest/download' for the manifest, 'releases/download/<tag>'
# for the pinned payload -- are the real ones and not an approximation.
LATEST_DIR="$SERVE/$REPO/releases/latest/download"
PINNED_DIR="$SERVE/$REPO/releases/download/v${NEW_VERSION}"
APPCAST_URL="$BASE/$REPO/releases/latest/download/appcast.json"

# ───────────────────────────────────────────────────────── 4. publish (fake)
# The appcast is written by the REAL emit_appcast.sh, from the REAL zip, so its
# size and sha256 are measured rather than asserted. Only the HOST is rewritten.
publish() {
  local version="$1" zip_src="$2"
  rm -rf "$SERVE/$REPO"
  mkdir -p "$LATEST_DIR" "$SERVE/$REPO/releases/download/v${version}" || return 1
  cp "$zip_src" "$SERVE/$REPO/releases/download/v${version}/Forge-macos-arm64-${version}.zip" \
    || return 1
  bash "$DESKTOP/emit_appcast.sh" --version "$version" --zip "$zip_src" \
       --min-macos "15.0" --out "$SANDBOX/appcast.json" --repo "$REPO" >/dev/null || return 1
  # HOST ONLY. Every other byte -- schema, channel, version, arch, size, sha256,
  # the /releases/download/<tag>/ path shape -- is what the real emitter wrote.
  sed "s|https://github\.com/|${BASE}/|g" "$SANDBOX/appcast.json" > "$LATEST_DIR/appcast.json" \
    || return 1
  return 0
}

install_fresh_old_copy() {
  rm -rf "$APPS/Forge.app"
  cp -R "$BUILD/old/Forge.app" "$APPS/Forge.app" || return 1
  # cp -R re-writes the bytes, which invalidates the signature it copied.
  codesign --force --sign - --timestamp=none "$APPS/Forge.app" >/dev/null 2>&1 || return 1
  return 0
}

run_driver() {
  local expect="$1"
  "$BUILD/release_rehearsal" \
    --appcast-url "$APPCAST_URL" \
    --app "$APPS/Forge.app" \
    --running "$OLD_VERSION" \
    --allow-host "127.0.0.1" \
    --expect "$expect"
}

fail=0

say "4. THE REHEARSAL: an installed ${OLD_VERSION} meets a published ${NEW_VERSION}"
publish "$NEW_VERSION" "$BUILD/$ZIP_NAME" || die "could not publish the fake release"
install_fresh_old_copy || die "could not install the old copy"
echo "  BEFORE: $APPS/Forge.app reports $(defaults read "$APPS/Forge.app/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null)"
run_driver install
rc=$?
echo "  AFTER:  $APPS/Forge.app reports $(defaults read "$APPS/Forge.app/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null)"
if [ "$rc" -ne 0 ]; then
  echo "REHEARSAL RED (exit $rc)"
  fail=1
else
  echo "rehearsal green"
  # The swapped-in bundle has to be a REAL, WORKING app, not merely a directory
  # that passed a version check: run its executable and verify its signature.
  if ! codesign --verify --deep --strict "$APPS/Forge.app" >/dev/null 2>&1; then
    echo "  FAIL  the swapped-in bundle does not pass codesign --verify"
    fail=1
  else
    echo "  ok    the swapped-in bundle passes codesign --verify --deep --strict"
  fi
  if out="$("$APPS/Forge.app/Contents/MacOS/forge_desktop" 2>&1)" \
     && [ "$out" = "forge stub ${NEW_VERSION}" ]; then
    echo "  ok    the swapped-in executable RUNS and is the new build ($out)"
  else
    echo "  FAIL  the swapped-in executable did not run as the new build: $out"
    fail=1
  fi
  # The chain property: the app that just installed itself can install the next one.
  if "$APPS/Forge.app/Contents/MacOS/forge_update" --help >/dev/null 2>&1; then
    echo "  ok    the swapped-in bundle's own forge_update runs (the chain continues)"
  else
    echo "  FAIL  the swapped-in bundle's forge_update does not run; the next release" \
         "could be detected but never installed"
    fail=1
  fi
fi

# ─────────────────────────────────────────────────────── 5. negative controls
# Each corrupts the RELEASE, not the code under test, and each must be refused
# WITH THE INSTALLED APP LEFT INTACT. A refusal that bricks the user's app is
# not a pass.
if [ "$MUTATIONS" -eq 1 ]; then
  say "5. negative controls: a corrupted release must be refused, app left intact"

  mutate_and_run() {
    local name="$1"; shift
    echo
    echo "── mutation: $name"
    publish "$NEW_VERSION" "$BUILD/$ZIP_NAME" || { echo "  could not publish"; fail=1; return; }
    install_fresh_old_copy || { echo "  could not install"; fail=1; return; }
    "$@" || { echo "  could not apply the mutation"; fail=1; return; }
    local out mrc
    out="$(run_driver refuse 2>&1)"; mrc=$?
    echo "$out" | sed 's/^/  /'
    if [ "$mrc" -ne 0 ]; then
      echo "  MUTATION NOT CAUGHT -- '$name' was accepted or damaged the installed app."
      fail=1
    else
      echo "  (refused, and the installed app is still $OLD_VERSION -- as it must be)"
    fi
  }

  # A byte flipped in the payload, length preserved so the size check cannot be
  # what catches it. This is the check that stands between a user and arbitrary
  # code: if only the size were verified, this would install.
  flip_a_byte() {
    local z="$SERVE/$REPO/releases/download/v${NEW_VERSION}/Forge-macos-arm64-${NEW_VERSION}.zip"
    python3 - "$z" <<'FLIP_EOF'
import sys
p = sys.argv[1]
b = bytearray(open(p, "rb").read())
i = len(b) // 2
b[i] ^= 0xFF
open(p, "wb").write(bytes(b))
FLIP_EOF
  }
  mutate_and_run "the payload is tampered with (one byte, same length)" flip_a_byte

  set_field() {  # set_field <json key> <new raw value incl. quotes>
    python3 - "$LATEST_DIR/appcast.json" "$1" "$2" <<'SETFIELD_EOF'
import json, sys
p, k, v = sys.argv[1], sys.argv[2], sys.argv[3]
m = json.load(open(p))
m[k] = json.loads(v)
json.dump(m, open(p, "w"), indent=2)
SETFIELD_EOF
  }

  mutate_and_run "the manifest declares a version the bundle does not carry" \
                 set_field version '"0.9.9"'
  mutate_and_run "the manifest offers an OLDER version than the installed one" \
                 set_field version '"0.0.9"'
  mutate_and_run "the payload size is misdeclared" \
                 set_field size '999999'
  mutate_and_run "the payload url floats to releases/latest instead of one release" \
                 set_field url "\"${BASE}/${REPO}/releases/latest/download/Forge-macos-arm64-${NEW_VERSION}.zip\""
  mutate_and_run "the payload url is plain http" \
                 set_field url "\"http://127.0.0.1:${PORT}/${REPO}/releases/download/v${NEW_VERSION}/Forge-macos-arm64-${NEW_VERSION}.zip\""
  mutate_and_run "the payload url is on a host that merely CONTAINS the allowed one" \
                 set_field url "\"https://127.0.0.1.evil.tld/${REPO}/releases/download/v${NEW_VERSION}/Forge-macos-arm64-${NEW_VERSION}.zip\""
  mutate_and_run "the manifest carries an unrecognised schema" \
                 set_field schema '"forge-appcast/99"'

  # An unsigned release. The bundle is structurally perfect and the digest
  # matches; only the signature is gone. This is the check that stops a
  # correctly-delivered but doctored bundle.
  strip_signature() {
    rm -rf "$BUILD/unsigned"
    mkdir -p "$BUILD/unsigned" || return 1
    cp -R "$BUILD/new/Forge.app" "$BUILD/unsigned/Forge.app" || return 1
    codesign --remove-signature "$BUILD/unsigned/Forge.app/Contents/MacOS/forge_desktop" \
      >/dev/null 2>&1
    codesign --remove-signature "$BUILD/unsigned/Forge.app" >/dev/null 2>&1
    rm -f "$BUILD/unsigned.zip"
    ditto -c -k --keepParent "$BUILD/unsigned/Forge.app" "$BUILD/unsigned.zip" || return 1
    publish "$NEW_VERSION" "$BUILD/unsigned.zip" || return 1
    return 0
  }
  mutate_and_run "the release bundle's signature has been stripped" strip_signature
fi

say "result"
if [ "$fail" -ne 0 ]; then
  echo "RESULT: FAILED"
  exit 1
fi
echo "RESULT: PASSED"
