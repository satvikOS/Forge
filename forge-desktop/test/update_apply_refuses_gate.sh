#!/usr/bin/env bash
# The SHIPPED updater must refuse to install an update it cannot attribute.
#
# update_signature_gate.sh proves the verification PRIMITIVE. This proves the CLI
# actually calls it — the primitive protected nobody until it was wired in, and a
# unit test cannot tell the difference.
#
# Builds the real main_update_cli.cpp twice: once with a key baked in as a release
# build would, once without, and drives `apply` and `check` against real signed,
# tampered and attacker-signed manifests.
#
# check installs nothing, so a keyless build must still be able to run it. apply is
# the security boundary and must refuse.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S="$HERE/../src/update"
OSSL=/usr/bin/openssl
PASS=0; FAIL=0
chk() { if [ "$2" = "$3" ]; then printf '  PASS  %-46s -> %s\n' "$1" "$3"; PASS=$((PASS+1));
        else printf '  FAIL  %-46s -> got %s want %s\n' "$1" "$3" "$2"; FAIL=$((FAIL+1)); fi }
D="$(mktemp -d)"; trap 'rm -rf "$D"' EXIT

"$OSSL" ecparam -name prime256v1 -genkey -noout -out "$D/rel.pem" 2>/dev/null
"$OSSL" ecparam -name prime256v1 -genkey -noout -out "$D/atk.pem" 2>/dev/null
PUB="$("$OSSL" ec -in "$D/rel.pem" -pubout -outform DER 2>/dev/null | base64 | tr -d '\n')"
[ -n "$PUB" ] || { echo "  cannot generate a key"; exit 3; }

# NOTE: an explicit file list, never an unquoted variable. zsh does not word-split,
# so "$FILES" arrives as ONE argument and clang reports "no such file or directory"
# naming every path at once. Measured; it cost a build cycle here.
build() {
  local out="$1"; shift
  clang++ -std=c++20 -I"$HERE/../src" "$@" \
    "$S/main_update_cli.cpp" "$S/Updater.cpp" "$S/Manifest.cpp" \
    "$S/Sha256.cpp" "$S/Version.cpp" "$S/ManifestSignature.cpp" \
    -o "$out" 2>"$D/build.log"
}
build "$D/keyed" -DFORGE_UPDATE_PUBKEY_B64="\"$PUB\"" || { echo "  keyed build failed:"; head -8 "$D/build.log"; exit 3; }
build "$D/nokey" || { echo "  keyless build failed"; exit 3; }

cat > "$D/appcast.json" <<'JSON'
{"schema":"forge-appcast/1","version":"9.9.9","sha256":"0000000000000000000000000000000000000000000000000000000000000000","size":10,"url":"https://github.com/satvikOS/Forge/releases/download/v9.9.9/Forge-macos-arm64-9.9.9.zip","channel":"stable"}
JSON
"$OSSL" dgst -sha256 -sign "$D/rel.pem" -out "$D/appcast.json.sig" "$D/appcast.json" 2>/dev/null
# attacker-signed: repointed AND signed with their own key
cp "$D/appcast.json" "$D/evil.json"; sed -i '' 's#satvikOS/Forge#evil/Forge#' "$D/evil.json"
"$OSSL" dgst -sha256 -sign "$D/atk.pem" -out "$D/evil.json.sig" "$D/evil.json" 2>/dev/null
# tampered: repointed but carrying the GENUINE signature
cp "$D/appcast.json" "$D/tampered.json"; sed -i '' 's#satvikOS/Forge#evil/Forge#' "$D/tampered.json"
cp "$D/appcast.json.sig" "$D/tampered.json.sig"
# unsigned: no .sig beside it at all
cp "$D/appcast.json" "$D/nosig.json"; rm -f "$D/nosig.json.sig"

# Matches the SIGNATURE refusal specifically, not any refusal. The CLI has other
# reasons to refuse -- a malformed manifest is rejected for its schema before it is
# ever about authenticity -- and an early version of this gate went green on a
# fixture missing its `schema` field, proving nothing about signatures at all.
refused() {   # refused <binary> <manifest>
  local out; out="$("$1" apply --appcast "$2" --running 0.1.0 --app "$D/Fake.app" 2>&1)"
  case "$out" in
    *"REFUSED: the appcast's signature does not match"*) echo yes ;;
    *"REFUSED: the release carries no signature"*)       echo yes ;;
    *"REFUSED: this build has no update-signing key"*)   echo yes ;;
    *) echo no ;;
  esac
}
echo "== apply REFUSES anything it cannot attribute to the release key =="
chk "attacker-signed manifest"            yes "$(refused "$D/keyed" "$D/evil.json")"
chk "tampered, carrying a real signature" yes "$(refused "$D/keyed" "$D/tampered.json")"
chk "no signature published"              yes "$(refused "$D/keyed" "$D/nosig.json")"
chk "build with NO key compiled in"       yes "$(refused "$D/nokey" "$D/appcast.json")"

echo ""
echo "== and it does NOT refuse a genuine one, or the gate proves nothing =="
chk "genuine manifest + release signature" no "$(refused "$D/keyed" "$D/appcast.json")"

echo ""
echo "== check installs nothing, so it reports instead of refusing =="
OUT="$("$D/nokey" check --appcast "$D/appcast.json" --running 0.1.0 2>&1)"
case "$OUT" in *"could not be verified"*) r=yes ;; *) r=no ;; esac
chk "keyless check WARNS that it is unverified" yes "$r"
case "$OUT" in *"REFUSED: this build has no update-signing key"*) r=yes ;; *) r=no ;; esac
chk "keyless check does not refuse ON SIGNATURE" no  "$r"
OUT="$("$D/keyed" check --appcast "$D/appcast.json" --running 0.1.0 2>&1)"
case "$OUT" in *"could not be verified"*) r=yes ;; *) r=no ;; esac
chk "genuine check raises no signature complaint" no "$r"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
