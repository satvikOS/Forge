// forge-desktop/src/update/Manifest.hpp
//
// THE APPCAST: the flat JSON document that tells a running Forge what the newest
// release is and how to verify it.
//
// ── THE URL ──────────────────────────────────────────────────────────────────
// The app fetches ONE fixed, hard-coded URL:
//
//     https://github.com/<owner>/<repo>/releases/latest/download/appcast.json
//
// GitHub resolves `releases/latest/download/<asset>` to that asset on the newest
// release that is neither a DRAFT nor a PRERELEASE. Three consequences worth
// stating, because each one is load-bearing:
//
//   1. It is a stable URL, so nothing has to be baked into the app per release.
//   2. It is NOT api.github.com. The REST API rate-limits unauthenticated
//      callers to 60 requests an hour per IP, which an updater shipped to real
//      users behind one NAT would hit; the release-download path does not carry
//      that limit.
//   3. A DRAFT release is not "latest". The release workflow creates releases as
//      drafts, so the existing "a human presses Publish" gate automatically
//      becomes the gate on auto-update too. Nothing extra had to be built for
//      that, and nothing may be built that bypasses it.
//
// ── WHY THE PAYLOAD URL IS PINNED AND THE MANIFEST URL IS NOT ────────────────
// `url` inside the manifest MUST be a version-pinned release asset
// (…/releases/download/v0.1.1/Forge-macos-arm64-0.1.1.zip), never another
// `latest/download/…` link. The manifest and the payload are two separate HTTP
// requests, and `sha256` describes the bytes of ONE build. If `url` floated to
// "whatever is latest", a release publishing between the two requests would make
// a correct client download a correct file and refuse it as corrupt -- and the
// error would be indistinguishable from an attack. Pinning removes the race.
// isPayloadUrlPinned() enforces this and is checked before anything downloads.
//
// ── SCHEMA ───────────────────────────────────────────────────────────────────
//   {
//     "schema":   "forge-appcast/1",
//     "channel":  "stable",
//     "version":  "0.1.1",
//     "arch":     "arm64",
//     "min_macos":"15.0",
//     "url":      "https://github.com/.../releases/download/v0.1.1/Forge-macos-arm64-0.1.1.zip",
//     "size":     41234567,
//     "sha256":   "<64 lowercase hex>",
//     "notes_url":"https://github.com/.../releases/tag/v0.1.1",
//     "pub_date": "2026-08-30T12:00:00Z"
//   }
//
// Flat on purpose. The parser below accepts a single JSON object of scalars and
// REJECTS nesting, which keeps a document arriving off the network from reaching
// a recursive parser at all. Unknown keys are ignored so a future field cannot
// brick an old client.
#pragma once

#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace forge::update {

struct Manifest {
  bool valid = false;
  std::string schema;
  std::string channel;
  std::string version;
  std::string arch;
  std::string min_macos;
  std::string url;
  std::uint64_t size = 0;
  std::string sha256;
  std::string notes_url;
  std::string pub_date;
  // Everything present in the document, including keys this version does not
  // know about. Kept so a diagnostic can print what actually arrived.
  std::map<std::string, std::string> raw;
};

// The one schema string this build understands. A manifest that does not carry
// it is refused rather than best-guessed.
inline const char* kManifestSchema = "forge-appcast/1";

// Hard cap on the document. An appcast is under a kilobyte; anything past this
// is either a mistake or an attempt to make the client chew on a large body.
inline constexpr std::size_t kMaxManifestBytes = 64u * 1024u;

// Parses the flat object described above. On failure returns a Manifest with
// valid == false and sets `err` to something a log can print. Never throws.
Manifest parseManifest(const std::string& json, std::string& err);

// Structural validation, separate from parsing: required fields present, sha256
// a 64-character hex string, size non-zero and under the cap, schema recognised.
// Does NOT decide whether to install -- that is decide() in Updater.hpp.
bool validateManifest(const Manifest& m, std::string& err);

// True only for https:// on an allow-listed host. `allowed_hosts` is matched on
// the exact host or on a dot-suffix ("github.com" matches "objects.github.com"),
// never on a substring -- "github.com.evil.tld" must not pass, and a substring
// test would let it.
bool isAllowedDownloadUrl(const std::string& url, const std::vector<std::string>& allowed_hosts);

// True if the URL names a specific release rather than a floating one. See the
// header note above: this is what makes the manifest's digest describable.
bool isPayloadUrlPinned(const std::string& url);

}  // namespace forge::update
