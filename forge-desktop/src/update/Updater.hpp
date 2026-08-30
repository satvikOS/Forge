// forge-desktop/src/update/Updater.hpp
//
// THE AUTO-UPDATE PATH. The update is downloaded and installed BY THE RUNNING
// APP. That is not a convenience -- it is the entire reason this file exists.
//
// ── WHY THE RUNNING APP MUST DO THE DOWNLOAD ─────────────────────────────────
// Forge ships ad-hoc signed. There is no Developer ID certificate and none is
// being bought, so `spctl -a -t exec` will say "rejected" for ever; that is a
// signature POLICY verdict, not a defect, and the ad-hoc signature itself is
// valid (`codesign -v --deep --strict` exits 0, so the app runs normally once
// admitted).
//
// What actually bothers a user is the FIRST-LAUNCH dialog, and that dialog is
// driven by the `com.apple.quarantine` extended attribute, which is applied by
// the program that did the downloading -- a browser sets it, and `/usr/bin/curl`
// does not. MEASURED on this machine against a loopback HTTP server (no external
// network): a file fetched with curl carries NO com.apple.quarantine.
//
// So:
//   * hand the user a browser download of every new version -> the file is
//     quarantined again -> the scary dialog again, EVERY version;
//   * have the already-running app fetch and swap the bundle -> nothing
//     quarantines it -> the user approves ONCE, at first install, for ever.
//
// An updater that opens a browser or a Downloads folder therefore defeats the
// whole distribution decision. Do not build one. `stageBundle()` additionally
// strips any quarantine attribute that did somehow reach the staged bundle,
// belt-and-braces, before it can be swapped in.
//
// ── TRUST MODEL, STATED PLAINLY ──────────────────────────────────────────────
// Auto-update is a remote code execution channel by construction: it downloads
// code and runs it as the user. What defends it here:
//
//   1. TLS to github.com, https ONLY, redirects pinned to https, host allow-list
//      checked BEFORE anything is spawned. This is what authenticates the
//      MANIFEST. It is the trust anchor, and it is only as strong as the GitHub
//      account and GitHub itself.
//   2. sha256 of the payload, from the manifest, verified BEFORE the archive is
//      unpacked and long before anything is swapped in. This is what closes the
//      gap between the two requests: a payload URL swapped, a CDN cache
//      poisoned, or a truncated transfer are all caught here.
//   3. Monotonic version: a manifest may only move the app FORWARD. Without
//      this, replaying an old, correctly-signed manifest is a downgrade attack
//      onto a version whose bugs are already public.
//   4. The staged bundle is validated -- right version, real executable, VALID
//      ad-hoc signature -- before the swap, so a truncated or doctored archive
//      cannot replace a working app with a broken one.
//
// NOT defended: a compromised GitHub account or a maintainer publishing a bad
// release. Closing that needs an Ed25519 (or minisign) signature over the
// manifest with the public key compiled into the app, so that the release
// pipeline's credentials and the signing key are separately held. The schema has
// room for it and this build does NOT implement it. That is owed work, and it is
// written down here rather than implied by silence.
//
// ── STRUCTURE, AND WHY IT IS TESTABLE OFFLINE ────────────────────────────────
// Exactly ONE function in this file touches the network: Fetcher::get. Every
// decision -- version ordering, policy, URL admissibility, digest verification,
// bundle validation, the atomic swap -- is a pure function or a filesystem
// operation, so test/update_gate.cpp drives the whole path with a fake Fetcher
// that copies a local file, and asserts on VALUES. No test in this tree opens a
// socket.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "update/Manifest.hpp"
#include "update/Version.hpp"

namespace forge::update {

// ─────────────────────────────────────────────────────────────── where to look
// The one URL the app fetches. See Manifest.hpp for why it is the
// releases/latest/download path and not api.github.com.
inline const char* kDefaultAppcastUrl =
    "https://github.com/satvikOS/Forge/releases/latest/download/appcast.json";

// GitHub serves release assets from github.com and redirects to
// objects.githubusercontent.com; both are needed, and nothing else is.
std::vector<std::string> defaultAllowedHosts();

// ──────────────────────────────────────────────────────────────────── policy
struct Policy {
  // Reject a manifest whose `arch` is not this. Empty disables the check.
  std::string arch = "arm64";
  // Reject a manifest whose `channel` is not this. Empty disables the check.
  std::string channel = "stable";
  // Offer prereleases. OFF: a stable user must not be walked onto an rc.
  bool allow_prerelease = false;
  // Install a version that orders BELOW the running one. OFF, and it must stay
  // off in shipping builds: an attacker who can replay an old manifest would
  // otherwise roll the user back to a version with published bugs. The flag
  // exists so a deliberate rollback build is possible and so the gate can prove
  // the DEFAULT refuses one.
  bool allow_downgrade = false;
  // Refuse a payload larger than this before a byte is fetched. A Forge zip is
  // tens of megabytes.
  std::uint64_t max_payload_bytes = 512ull * 1024ull * 1024ull;
  std::vector<std::string> allowed_hosts = defaultAllowedHosts();
};

enum class Decision {
  UpToDate,         // the running version is at or past the manifest's
  UpdateAvailable,  // everything checked out; the payload may be fetched
  Rejected,         // the manifest is malformed, inadmissible, or a downgrade
};

struct Plan {
  Decision decision = Decision::Rejected;
  std::string reason;  // always populated, always printable
  Version current;
  Version offered;
};

// Pure. Decides whether `m` should be installed over `current_version_text`.
// Performs EVERY pre-download check: schema, required fields, arch, channel,
// prerelease policy, URL scheme/host/pinning, declared size, and version order.
// Nothing here reads a file or opens a socket.
Plan decide(const std::string& current_version_text, const Manifest& m, const Policy& p);

// ──────────────────────────────────────────────────────────────────── fetching
struct Fetcher {
  virtual ~Fetcher() = default;
  // Fetch `url` into `out_path`. Must fail rather than truncate. Implementations
  // may assume the URL has already passed isAllowedDownloadUrl().
  virtual bool get(const std::string& url, const std::string& out_path, std::string& err) = 0;
};

// The argv handed to /usr/bin/curl, exposed so the gate can assert on it without
// a network. Every element is checked in update_gate.cpp:
//   --proto =https / --proto-redir =https  a redirect can never leave TLS
//   --max-filesize                          a hostile server cannot fill the disk
//   --max-time / --connect-timeout          a hung server cannot wedge the app
//   --                                      a URL starting with '-' is a URL,
//                                           never a flag
std::vector<std::string> curlArgv(const std::string& url, const std::string& out_path,
                                  std::uint64_t max_bytes, int timeout_seconds);

// Spawns /usr/bin/curl via posix_spawn with the argv above. NO shell is
// involved, so nothing in the URL can be interpreted as a command. curl is part
// of the base macOS install, not a package -- this is why the updater adds no
// third-party dependency and why Sparkle was not vendored for a path this small.
struct CurlFetcher : Fetcher {
  std::uint64_t max_bytes = 512ull * 1024ull * 1024ull;
  int timeout_seconds = 600;
  bool get(const std::string& url, const std::string& out_path, std::string& err) override;
};

// ────────────────────────────────────────────────────────── verify / stage / swap
// sha256 and size of the file on disk against the manifest. Returns false with a
// reason on ANY mismatch, including an unreadable file.
bool verifyPayload(const std::string& zip_path, const Manifest& m, std::string& err);

// `ditto -x -k` the archive into `staging_dir` (which must already exist and
// must be on the SAME VOLUME as the app being replaced, so the final rename is a
// rename and not a copy), then strip com.apple.quarantine from the result.
// ditto, not unzip: it is the tool that preserves the symlinks and extended
// attributes a signed .app bundle is made of.
// On success `out_app_path` names the single *.app found at the top level.
bool stageBundle(const std::string& zip_path, const std::string& staging_dir,
                 std::string& out_app_path, std::string& err);

// Is this staged directory a bundle we are willing to swap in?
//   * it is a directory named *.app
//   * Contents/MacOS/forge_desktop exists and is executable
//   * Contents/Info.plist declares CFBundleShortVersionString == expected_version
//   * if require_valid_signature: `codesign --verify --deep --strict` exits 0.
//     Ad-hoc satisfies this. It is NOT spctl, which ad-hoc can never satisfy and
//     which is deliberately not consulted anywhere in this file.
bool validateStagedBundle(const std::string& app_path, const std::string& expected_version,
                          bool require_valid_signature, std::string& err);

// Reads CFBundleShortVersionString out of a bundle's Info.plist. Empty on
// failure. The app's own running version comes from here too, so the binary and
// its plist cannot drift apart -- there is no compiled-in version constant to
// forget to bump.
std::string bundleShortVersion(const std::string& app_path);

// Walks up from an executable path to the enclosing .app, i.e.
// /Applications/Forge.app/Contents/MacOS/forge_desktop -> /Applications/Forge.app
// Empty if the executable is not inside a bundle, which is the normal case for a
// developer build -- and which is why applyUpdate() refuses to run there.
std::string enclosingAppBundle(const std::string& executable_path);

// ATOMIC. renamex_np(RENAME_SWAP) exchanges two paths in one operation on APFS
// and HFS+, so there is no instant at which /Applications/Forge.app is missing
// or half-written. After it returns, `live_app_path` is the new bundle and
// `staged_app_path` is the old one, ready to be deleted or kept for rollback.
//
// The obvious alternative -- remove the old, then rename the new into place --
// has a window in which a crash, a full disk or a permissions refusal leaves the
// user with NO application at all. update_gate.cpp --mutate 7 is that
// implementation, and the gate proves it can destroy the live app.
//
// If the volume does not support RENAME_SWAP, falls back to
// old -> old.bak / new -> live, and restores old on failure. Never leaves the
// live path empty on either route.
bool atomicSwap(const std::string& staged_app_path, const std::string& live_app_path,
                std::string& err);

// ──────────────────────────────────────────────────────────── the whole path
struct ApplyResult {
  bool ok = false;
  std::string reason;
  std::string installed_version;
  // Where the displaced bundle briefly sat. It is inside the staging directory,
  // which applyUpdate removes before returning, so by the time a caller reads
  // this the path is GONE. It is reported for logging, NOT for rollback:
  // atomicSwap does leave the old bundle intact, but keeping it past the end of
  // the update would leave a full second copy of the app on disk after every
  // release, and a rollback feature needs a version store and a UI decision that
  // nobody has made. Naming this `for rollback` would be a promise this code
  // does not keep.
  std::string displaced_bundle_path;
};

// download -> verify -> stage -> validate -> atomic swap. Every step's failure
// leaves the installed app untouched. Does NOT relaunch; the caller decides
// when to quit, because the caller is the one that knows about unsaved work.
//
// ONE CONSEQUENCE OF SWAPPING UNDER A RUNNING PROCESS, stated because it is easy
// to trip over later. After the swap, this process's mapped executable is the
// OLD inode, which still exists because the process holds it -- so the running
// app keeps working even after the old bundle's last directory entry is removed.
// What it must NOT do afterwards is read anything out of its own bundle BY PATH:
// /Applications/Forge.app/Contents/... now resolves into the NEW bundle, and a
// resource, shader or dylib loaded from there would be a version the running
// code was not built against. Load bundle resources at startup, or relaunch
// promptly. This is inherent to in-place update, not a defect of this code, and
// it is the reason relaunchArgv() exists right below.
ApplyResult applyUpdate(const Plan& plan, const Manifest& m, const std::string& live_app_path,
                        Fetcher& fetcher, const Policy& p);

// argv for `open -n <app>`, used to relaunch after the swap. Exposed for the
// gate; the app spawns it on quit.
std::vector<std::string> relaunchArgv(const std::string& app_path);

}  // namespace forge::update
