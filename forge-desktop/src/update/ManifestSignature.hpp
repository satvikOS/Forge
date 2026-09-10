#pragma once
#include <string>

// Verify that an appcast was signed by whoever holds Forge's release key.
//
// WHY THE sha256 IN THE MANIFEST IS NOT ENOUGH
// --------------------------------------------
// Sha256.hpp says it in its own words: "This is a digest, NOT a signature."
// The manifest is fetched from
//     https://github.com/<owner>/<repo>/releases/latest/download/appcast.json
// and the payload URL is a field INSIDE that manifest. Both come from the same
// release. Anyone who can write that release writes the payload AND the sha256
// that describes it, so the digest proves the bytes were not corrupted in
// transit and proves nothing at all about who produced them. The only other
// check on the path is `codesign --verify` against an AD-HOC signature, which
// any machine can produce.
//
// So a token with `contents: write` was code execution on every user.
//
// THE TRUST ANCHOR IS NOT FETCHED
// -------------------------------
// The public key is compiled into the shipped binary (FORGE_UPDATE_PUBKEY_B64).
// The signature travels with the release, which is fine: forging it needs the
// PRIVATE key, which never leaves the signer. A key fetched alongside the
// payload would restore exactly the hole this closes.
//
// ECDSA P-256, verified by shelling to /usr/bin/openssl -- the same style the
// updater already uses for codesign and ditto. Measured 2026-09-10: macOS ships
// LibreSSL 3.3.6, which CANNOT do Ed25519 keygen but does ECDSA P-256 sign and
// verify correctly, including rejecting a tampered manifest and one signed by a
// different key. Ed25519 would have needed a bundled crypto library or Homebrew
// on the user's machine.
//
// FAILS CLOSED. No key compiled in, no signature file, an unreadable signature,
// or openssl missing all return false. An update that cannot be proven authentic
// is not installed.
namespace forge::update {

// True only if `manifest_json` was signed by the key whose public half is baked
// into this binary. `err` is set on every false.
bool verifyManifestSignature(const std::string& manifest_json,
                             const std::string& signature_der,
                             std::string& err);

// The public key this binary trusts, base64 DER, or "" when none was compiled
// in. Exposed so the CLI can say WHICH key it is refusing against.
std::string trustedPublicKeyB64();

// True when this build has a key at all. A build without one can still check for
// updates; it must not install them.
bool signingConfigured();

}  // namespace forge::update
