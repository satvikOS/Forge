#!/usr/bin/env bash
# Prove the updater REFUSES an appcast it cannot attribute to Forge's release key.
#
# Both directions for every rule. A verifier that always refuses passes "rejects a
# tampered manifest"; one that always accepts passes "accepts a genuine one". Only
# one that discriminates passes both — and the whole defect being closed here is a
# check that accepted everything.
#
# Uses a REAL generated keypair and REAL openssl signatures, and compiles the
# verifier with the public half baked in exactly as a shipped build would. Nothing
# is stubbed; the acceptance asked for a tampered payload refused, not a code read.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/../src/update"
PASS=0; FAIL=0
chk() { if [ "$2" = "$3" ]; then printf '  PASS  %-52s -> %s\n' "$1" "$3"; PASS=$((PASS+1));
        else printf '  FAIL  %-52s -> got %s want %s\n' "$1" "$3" "$2"; FAIL=$((FAIL+1)); fi }

D="$(mktemp -d)"; trap 'rm -rf "$D"' EXIT
OSSL=/usr/bin/openssl

# ── a real release key, and a real attacker key ──────────────────────────────
"$OSSL" ecparam -name prime256v1 -genkey -noout -out "$D/release.pem" 2>/dev/null
"$OSSL" ec -in "$D/release.pem" -pubout -out "$D/release.pub.pem" 2>/dev/null
"$OSSL" ecparam -name prime256v1 -genkey -noout -out "$D/attacker.pem" 2>/dev/null
PUB_B64="$("$OSSL" ec -in "$D/release.pem" -pubout -outform DER 2>/dev/null | base64 | tr -d '\n')"
[ -n "$PUB_B64" ] || { echo "  cannot generate a key; openssl missing?"; exit 3; }

cat > "$D/appcast.json" <<'JSON'
{"version":"0.1.1","sha256":"aa11","size":123,"url":"https://github.com/satvikOS/Forge/releases/download/v0.1.1/Forge.zip"}
JSON
cp "$D/appcast.json" "$D/tampered.json"
# the attack: repoint the payload without touching anything else
sed -i '' 's#satvikOS/Forge#evil/Forge#' "$D/tampered.json"

"$OSSL" dgst -sha256 -sign "$D/release.pem"  -out "$D/good.sig"    "$D/appcast.json" 2>/dev/null
"$OSSL" dgst -sha256 -sign "$D/attacker.pem" -out "$D/attacker.sig" "$D/appcast.json" 2>/dev/null

# ── a driver that calls the real verifier ────────────────────────────────────
cat > "$D/driver.cpp" <<'CPP'
#include "ManifestSignature.hpp"
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
static std::string slurp(const char* p) {
  std::ifstream f(p, std::ios::binary); std::ostringstream ss; ss << f.rdbuf(); return ss.str();
}
int main(int argc, char** argv) {
  if (argc < 3) return 2;
  std::string err;
  const bool ok = forge::update::verifyManifestSignature(slurp(argv[1]), slurp(argv[2]), err);
  std::fprintf(stderr, "%s\n", err.c_str());
  return ok ? 0 : 1;
}
CPP

build() {  # build <outfile> [extra flags...]
  local out="$1"; shift
  clang++ -std=c++20 -I"$SRC" "$@" "$D/driver.cpp" "$SRC/ManifestSignature.cpp" -o "$out" 2>"$D/build.log"
}

build "$D/verify_keyed" -DFORGE_UPDATE_PUBKEY_B64="\"$PUB_B64\"" \
  || { echo "  build failed:"; sed 's/^/    /' "$D/build.log" | head -5; exit 3; }
build "$D/verify_nokey" \
  || { echo "  keyless build failed"; exit 3; }

echo "== a genuine, correctly signed appcast is ACCEPTED =="
"$D/verify_keyed" "$D/appcast.json" "$D/good.sig" >/dev/null 2>&1; chk "genuine manifest + release-key signature" 0 "$?"

echo ""
echo "== and everything else is REFUSED =="
"$D/verify_keyed" "$D/tampered.json" "$D/good.sig" >/dev/null 2>&1
chk "payload URL repointed to an attacker host" 1 "$?"
"$D/verify_keyed" "$D/appcast.json" "$D/attacker.sig" >/dev/null 2>&1
chk "signed by a DIFFERENT key (release-write attacker)" 1 "$?"
: > "$D/empty.sig"
"$D/verify_keyed" "$D/appcast.json" "$D/empty.sig" >/dev/null 2>&1
chk "no signature published at all" 1 "$?"
printf 'garbage-not-a-signature' > "$D/junk.sig"
"$D/verify_keyed" "$D/appcast.json" "$D/junk.sig" >/dev/null 2>&1
chk "signature file is not a signature" 1 "$?"
: > "$D/empty.json"
"$D/verify_keyed" "$D/empty.json" "$D/good.sig" >/dev/null 2>&1
chk "empty manifest" 1 "$?"

echo ""
echo "== a build with NO key compiled in must refuse, not wave it through =="
"$D/verify_nokey" "$D/appcast.json" "$D/good.sig" >/dev/null 2>&1
chk "keyless build, otherwise-valid signature" 1 "$?"
# NOTE: capture, then grep. `set -o pipefail` makes a pipeline report the last
# NON-ZERO status, and the verifier exits 1 BY DESIGN here -- so `cmd | grep -q`
# followed by $? reports the verifier's refusal, not whether grep matched, and the
# check fails while the code is correct. Measured: this cost three false failures.
OUT="$("$D/verify_nokey" "$D/appcast.json" "$D/good.sig" 2>&1 >/dev/null)"
case "$OUT" in *"no update-signing key"*) r=0 ;; *) r=1 ;; esac
chk "and it SAYS the key is missing" 0 "$r"

echo ""
echo "== the refusal names what happened, so a user is not left guessing =="
OUT="$("$D/verify_keyed" "$D/tampered.json" "$D/good.sig" 2>&1 >/dev/null)"
case "$OUT" in *"does not match"*) r=0 ;; *) r=1 ;; esac
chk "mismatch is described" 0 "$r"
case "$OUT" in *"Nothing was downloaded or changed"*) r=0 ;; *) r=1 ;; esac
chk "and says nothing was installed" 0 "$r"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
