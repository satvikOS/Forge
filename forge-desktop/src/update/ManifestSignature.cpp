#include "ManifestSignature.hpp"

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <random>
#include <string>

namespace fs = std::filesystem;

namespace forge::update {
namespace {

// Baked in at build time: -DFORGE_UPDATE_PUBKEY_B64="<base64 DER SubjectPublicKeyInfo>".
// Absent by default, so a build that was never given a key REFUSES to install
// rather than silently accepting anything.
#ifdef FORGE_UPDATE_PUBKEY_B64
constexpr const char* kPubKeyB64 = FORGE_UPDATE_PUBKEY_B64;
#else
constexpr const char* kPubKeyB64 = "";
#endif

std::string shq(const std::string& s) {
  std::string o = "'";
  for (char c : s) { if (c == '\'') o += "'\\''"; else o += c; }
  return o + "'";
}

int runQuiet(const std::string& cmd) {
  return std::system((cmd + " >/dev/null 2>&1").c_str());
}

bool writeFile(const fs::path& p, const std::string& bytes) {
  std::ofstream f(p, std::ios::binary);
  if (!f) return false;
  f.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
  return static_cast<bool>(f);
}

// A private scratch dir. The manifest and signature are written to disk because
// openssl verifies files; they are removed on every path out.
fs::path scratchDir() {
  std::random_device rd;
  auto v = static_cast<unsigned long long>(rd()) ^ (static_cast<unsigned long long>(rd()) << 32);
  fs::path p = fs::temp_directory_path() / ("forge_upd_sig_" + std::to_string(v));
  std::error_code ec;
  fs::create_directories(p, ec);
  return ec ? fs::path{} : p;
}

}  // namespace

std::string trustedPublicKeyB64() { return kPubKeyB64; }

bool signingConfigured() { return kPubKeyB64[0] != '\0'; }

bool verifyManifestSignature(const std::string& manifest_json,
                             const std::string& signature_der,
                             std::string& err) {
  err.clear();

  // FAIL CLOSED, in the order a reader would ask the questions.
  if (!signingConfigured()) {
    err = "this build has no update-signing key compiled in, so it cannot prove "
          "an update is authentic; refusing to install";
    return false;
  }
  if (manifest_json.empty()) {
    err = "empty manifest; nothing to verify";
    return false;
  }
  if (signature_der.empty()) {
    err = "the release carries no signature for its appcast; refusing to install "
          "an update that cannot be proven to come from the Forge release key";
    return false;
  }

  const fs::path dir = scratchDir();
  if (dir.empty()) { err = "cannot create a scratch directory to verify in"; return false; }
  struct Cleanup {
    fs::path d;
    ~Cleanup() { std::error_code ec; fs::remove_all(d, ec); }
  } cleanup{dir};

  const fs::path mpath = dir / "appcast.json";
  const fs::path spath = dir / "appcast.sig";
  const fs::path kpath = dir / "pub.pem";
  if (!writeFile(mpath, manifest_json) || !writeFile(spath, signature_der)) {
    err = "cannot stage the manifest for verification";
    return false;
  }

  // Reconstitute the compiled-in key as PEM. Written here, never fetched.
  {
    std::string pem = "-----BEGIN PUBLIC KEY-----\n";
    const std::string b64 = kPubKeyB64;
    for (std::size_t i = 0; i < b64.size(); i += 64) pem += b64.substr(i, 64) + "\n";
    pem += "-----END PUBLIC KEY-----\n";
    if (!writeFile(kpath, pem)) { err = "cannot stage the trusted public key"; return false; }
  }

  // /usr/bin/openssl, the system one, present on every macOS. Measured: LibreSSL
  // 3.3.6 verifies ECDSA P-256 and correctly rejects both a tampered manifest
  // and one signed by a different key.
  const int rc = runQuiet("/usr/bin/openssl dgst -sha256 -verify " + shq(kpath.string()) +
                          " -signature " + shq(spath.string()) + " " + shq(mpath.string()));
  if (rc != 0) {
    err = "the appcast's signature does not match Forge's release key; refusing "
          "to install. Nothing was downloaded or changed.";
    return false;
  }
  return true;
}

}  // namespace forge::update
