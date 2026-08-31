#include "update/Updater.hpp"

#include <fcntl.h>
#include <spawn.h>
#include <sys/stat.h>
#include <sys/stdio.h>  // renamex_np, RENAME_SWAP
#include <sys/wait.h>
#include <unistd.h>

#include <atomic>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>

#include "update/Sha256.hpp"

extern char** environ;

namespace fs = std::filesystem;

namespace forge::update {
namespace {

// Runs `argv[0]` with no shell. Returns true when the process exited 0.
// stdout and stderr go to a temp file whose tail is folded into `err`, because
// "ditto failed" without ditto's own message is a bug report nobody can action.
bool runProcess(const std::vector<std::string>& argv, std::string& err) {
  if (argv.empty()) {
    err = "empty argv";
    return false;
  }
  std::error_code ec;
  // A per-call name. The obvious shortcut -- the address of a local -- is the
  // SAME on every sequential call at the same stack depth, so two overlapping
  // calls would share a log and each would read the other's output as its own
  // error message. The app will run this off a background thread; make it
  // correct now rather than after that turns into a confusing bug report.
  static std::atomic<unsigned long long> call_seq{0};
  const fs::path log =
      fs::temp_directory_path(ec) /
      ("forge-update-" + std::to_string(::getpid()) + "-" +
       std::to_string(call_seq.fetch_add(1, std::memory_order_relaxed)) + ".log");

  posix_spawn_file_actions_t actions;
  if (posix_spawn_file_actions_init(&actions) != 0) {
    err = "posix_spawn_file_actions_init failed";
    return false;
  }
  posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO, log.c_str(),
                                   O_WRONLY | O_CREAT | O_TRUNC, 0600);
  posix_spawn_file_actions_adddup2(&actions, STDOUT_FILENO, STDERR_FILENO);

  std::vector<char*> cargv;
  cargv.reserve(argv.size() + 1);
  for (const std::string& a : argv) cargv.push_back(const_cast<char*>(a.c_str()));
  cargv.push_back(nullptr);

  ::pid_t pid = 0;
  const int rc = posix_spawn(&pid, argv[0].c_str(), &actions, nullptr, cargv.data(), environ);
  posix_spawn_file_actions_destroy(&actions);
  if (rc != 0) {
    err = argv[0] + ": posix_spawn failed: " + std::strerror(rc);
    fs::remove(log, ec);
    return false;
  }

  int status = 0;
  while (::waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) {
      err = argv[0] + ": waitpid failed: " + std::strerror(errno);
      fs::remove(log, ec);
      return false;
    }
  }

  std::string tail;
  {
    std::ifstream in(log);
    std::ostringstream ss;
    ss << in.rdbuf();
    tail = ss.str();
    if (tail.size() > 512) tail = tail.substr(tail.size() - 512);
  }
  fs::remove(log, ec);

  if (WIFEXITED(status) && WEXITSTATUS(status) == 0) return true;
  const int code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
  err = argv[0] + " exited " + std::to_string(code);
  if (!tail.empty()) err += ": " + tail;
  return false;
}

// "/Applications/Forge.app/" -> "/Applications/Forge.app". Never reduces a path
// to nothing: "/" stays "/".
std::string stripTrailingSlashes(const std::string& p) {
  std::size_t end = p.size();
  while (end > 1 && p[end - 1] == '/') --end;
  return p.substr(0, end);
}

std::string readWholeFile(const std::string& path, std::size_t cap) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return std::string();
  std::string out;
  out.resize(cap);
  in.read(out.data(), static_cast<std::streamsize>(cap));
  out.resize(static_cast<std::size_t>(in.gcount()));
  return out;
}

}  // namespace

std::vector<std::string> defaultAllowedHosts() {
  // github.com serves the release-asset redirect; objects.githubusercontent.com
  // (and its sibling release-assets.githubusercontent.com) serve the bytes.
  return {"github.com", "githubusercontent.com"};
}

// ─────────────────────────────────────────────────────────────────── decide()
Policy policyFor(const std::string& running_version) {
  Policy p;
  const Version v = parseVersion(running_version);
  if (v.valid && v.isPrerelease()) {
    p.channel = "prerelease";
    p.allow_prerelease = true;
  }
  return p;
}

Plan decide(const std::string& current_version_text, const Manifest& m, const Policy& p) {
  Plan plan;
  plan.current = parseVersion(current_version_text);
  plan.offered = parseVersion(m.version);

  std::string err;
  if (!validateManifest(m, err)) {
    plan.decision = Decision::Rejected;
    plan.reason = "manifest rejected: " + err;
    return plan;
  }
  if (!plan.offered.valid) {
    plan.decision = Decision::Rejected;
    plan.reason = "manifest version '" + m.version + "' is not a semantic version";
    return plan;
  }
  if (!p.arch.empty() && m.arch != p.arch) {
    plan.decision = Decision::Rejected;
    plan.reason = "manifest is for arch '" + m.arch + "', this build is '" + p.arch + "'";
    return plan;
  }
  if (!p.channel.empty() && m.channel != p.channel) {
    plan.decision = Decision::Rejected;
    plan.reason = "manifest is on channel '" + m.channel + "', this build follows '" + p.channel + "'";
    return plan;
  }
  if (plan.offered.isPrerelease() && !p.allow_prerelease) {
    plan.decision = Decision::Rejected;
    plan.reason = "offered version " + m.version + " is a prerelease and this build follows releases";
    return plan;
  }
  if (!isAllowedDownloadUrl(m.url, p.allowed_hosts)) {
    plan.decision = Decision::Rejected;
    plan.reason = "payload url is not https on an allowed host: " + m.url;
    return plan;
  }
  if (!isPayloadUrlPinned(m.url)) {
    plan.decision = Decision::Rejected;
    plan.reason = "payload url is not pinned to one release: " + m.url;
    return plan;
  }
  if (m.size > p.max_payload_bytes) {
    plan.decision = Decision::Rejected;
    plan.reason = "declared payload size " + std::to_string(m.size) + " exceeds the cap " +
                  std::to_string(p.max_payload_bytes);
    return plan;
  }

  const int order = compareVersions(plan.offered, plan.current);
  if (order > 0) {
    plan.decision = Decision::UpdateAvailable;
    plan.reason = "update " + plan.current.text + " -> " + plan.offered.text;
    return plan;
  }
  if (order == 0) {
    plan.decision = Decision::UpToDate;
    plan.reason = "already on " + plan.current.text;
    return plan;
  }
  if (p.allow_downgrade) {
    plan.decision = Decision::UpdateAvailable;
    plan.reason = "DOWNGRADE " + plan.current.text + " -> " + plan.offered.text +
                  " (allow_downgrade is on)";
    return plan;
  }
  plan.decision = Decision::Rejected;
  plan.reason = "manifest offers " + plan.offered.text + ", which is older than the running " +
                plan.current.text + "; refusing to move backwards";
  return plan;
}

// ──────────────────────────────────────────────────────────────────── fetching
std::vector<std::string> curlArgv(const std::string& url, const std::string& out_path,
                                  std::uint64_t max_bytes, int timeout_seconds) {
  return {
      "/usr/bin/curl",
      "--fail",                                   // an HTTP error is a failure, not a body
      "--silent",
      "--show-error",
      "--location",                               // follow GitHub's redirect to the CDN
      "--proto", "=https",                        // the first request must be TLS
      "--proto-redir", "=https",                  // and no redirect may leave TLS
      "--max-redirs", "5",
      "--connect-timeout", "20",
      "--max-time", std::to_string(timeout_seconds),
      "--max-filesize", std::to_string(max_bytes),
      "--output", out_path,
      "--",                                       // a URL beginning '-' is a URL, not a flag
      url,
  };
}

bool CurlFetcher::get(const std::string& url, const std::string& out_path, std::string& err) {
  const std::vector<std::string> argv = curlArgv(url, out_path, max_bytes, timeout_seconds);
  if (!runProcess(argv, err)) {
    std::error_code ec;
    fs::remove(out_path, ec);  // never leave a partial file where a payload is expected
    err = "download failed: " + err;
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────── verifying
bool verifyPayload(const std::string& zip_path, const Manifest& m, std::string& err) {
  err.clear();
  std::error_code ec;
  const std::uintmax_t actual = fs::file_size(zip_path, ec);
  if (ec) {
    err = "cannot size " + zip_path + ": " + ec.message();
    return false;
  }
  if (static_cast<std::uint64_t>(actual) != m.size) {
    err = "size mismatch: manifest says " + std::to_string(m.size) + ", file is " +
          std::to_string(static_cast<std::uint64_t>(actual));
    return false;
  }
  std::string hash_err;
  const std::string digest = sha256File(zip_path, hash_err);
  if (digest.empty()) {
    err = "cannot hash " + zip_path + ": " + hash_err;
    return false;
  }
  if (!hexDigestEquals(digest, m.sha256)) {
    err = "sha256 MISMATCH: manifest " + m.sha256 + ", downloaded " + digest;
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────── staging
bool stageBundle(const std::string& zip_path, const std::string& staging_dir,
                 std::string& out_app_path, std::string& err) {
  out_app_path.clear();
  err.clear();
  std::error_code ec;
  if (!fs::is_directory(staging_dir, ec)) {
    err = "staging directory does not exist: " + staging_dir;
    return false;
  }
  // ditto, not unzip: a .app is made of symlinks and extended attributes that
  // only ditto round-trips, and a bundle unpacked with unzip can fail codesign
  // for reasons that have nothing to do with its contents.
  if (!runProcess({"/usr/bin/ditto", "-x", "-k", zip_path, staging_dir}, err)) {
    err = "ditto could not unpack the payload: " + err;
    return false;
  }

  std::string found;
  for (const fs::directory_entry& e : fs::directory_iterator(staging_dir, ec)) {
    if (e.path().extension() == ".app" && fs::is_directory(e.path(), ec)) {
      if (!found.empty()) {
        err = "payload contains more than one .app at the top level";
        return false;
      }
      found = e.path().string();
    }
  }
  if (found.empty()) {
    err = "payload contains no .app at the top level of " + staging_dir;
    return false;
  }

  // Belt and braces. curl does not set com.apple.quarantine and ditto only
  // propagates one that was already on the archive, so this should be a no-op --
  // but a quarantined bundle is exactly the failure this whole design exists to
  // avoid, and clearing it costs one process. A non-zero exit here means there
  // was no attribute to remove, which is the expected case, so it is NOT fatal.
  std::string ignored;
  runProcess({"/usr/bin/xattr", "-dr", "com.apple.quarantine", found}, ignored);

  out_app_path = found;
  return true;
}

std::string bundleShortVersion(const std::string& app_path) {
  const std::string plist = readWholeFile(app_path + "/Contents/Info.plist", 256u * 1024u);
  if (plist.empty()) return std::string();
  const std::string key = "<key>CFBundleShortVersionString</key>";
  const std::size_t k = plist.find(key);
  if (k == std::string::npos) return std::string();
  const std::size_t open = plist.find("<string>", k + key.size());
  if (open == std::string::npos) return std::string();
  const std::size_t start = open + std::strlen("<string>");
  const std::size_t close = plist.find("</string>", start);
  if (close == std::string::npos) return std::string();
  return plist.substr(start, close - start);
}

bool validateStagedBundle(const std::string& raw_app_path, const std::string& expected_version,
                          bool require_valid_signature, std::string& err) {
  err.clear();
  // Shell tab-completion on a directory appends a '/', so `--app
  // /Applications/Forge.app/` is what a person actually types most of the time.
  // With the slash, path::extension() is empty and this function would refuse a
  // perfectly good bundle with "not an .app bundle" -- a confusing message about
  // a path that is plainly correct. Strip it once, here, rather than making
  // every caller remember.
  const std::string app_path = stripTrailingSlashes(raw_app_path);
  std::error_code ec;
  if (!fs::is_directory(app_path, ec)) {
    err = "not a directory: " + app_path;
    return false;
  }
  if (fs::path(app_path).extension() != ".app") {
    err = "not an .app bundle: " + app_path;
    return false;
  }
  const std::string exe = app_path + "/Contents/MacOS/forge_desktop";
  if (!fs::is_regular_file(exe, ec)) {
    err = "no executable at " + exe;
    return false;
  }
  if (::access(exe.c_str(), X_OK) != 0) {
    err = "executable is not executable: " + exe;
    return false;
  }
  const std::string got = bundleShortVersion(app_path);
  if (got.empty()) {
    err = "cannot read CFBundleShortVersionString from " + app_path + "/Contents/Info.plist";
    return false;
  }
  if (!expected_version.empty() && got != expected_version) {
    // The manifest said one version and the bundle claims another. Whatever the
    // cause -- a mis-tagged release or a substituted payload -- installing it
    // would leave the updater unable to reason about what is installed.
    err = "bundle declares version '" + got + "' but the manifest offered '" + expected_version + "'";
    return false;
  }
  if (require_valid_signature) {
    // codesign --verify, NOT spctl. The signature is ad-hoc and VALID; spctl
    // assesses Developer ID policy, which ad-hoc can never satisfy, so asserting
    // on spctl would be a permanently red gate. See the header of
    // .github/workflows/desktop-release.yml.
    std::string cs_err;
    if (!runProcess({"/usr/bin/codesign", "--verify", "--deep", "--strict", app_path}, cs_err)) {
      err = "the staged bundle's signature is not intact: " + cs_err;
      return false;
    }
  }
  return true;
}

std::string enclosingAppBundle(const std::string& executable_path) {
  fs::path p(stripTrailingSlashes(executable_path));
  // .../Foo.app/Contents/MacOS/exe
  if (p.filename().empty()) return std::string();
  const fs::path macos = p.parent_path();
  if (macos.filename() != "MacOS") return std::string();
  const fs::path contents = macos.parent_path();
  if (contents.filename() != "Contents") return std::string();
  const fs::path app = contents.parent_path();
  if (app.extension() != ".app") return std::string();
  return app.string();
}

// ─────────────────────────────────────────────────────────────── atomic swap
bool atomicSwap(const std::string& staged_app_path, const std::string& live_app_path,
                std::string& err) {
  err.clear();
  std::error_code ec;
  if (!fs::exists(staged_app_path, ec)) {
    err = "staged bundle does not exist: " + staged_app_path;
    return false;
  }
  if (!fs::exists(live_app_path, ec)) {
    err = "live bundle does not exist: " + live_app_path;
    return false;
  }

  // ONE syscall, no window. After it returns, live_app_path IS the new bundle
  // and staged_app_path is the displaced one.
  if (::renamex_np(staged_app_path.c_str(), live_app_path.c_str(), RENAME_SWAP) == 0) {
    return true;
  }
  const int swap_errno = errno;
  if (swap_errno != ENOTSUP && swap_errno != EINVAL) {
    err = "RENAME_SWAP failed: " + std::string(std::strerror(swap_errno));
    return false;
  }

  // Fallback for a filesystem without RENAME_SWAP. Still never leaves the live
  // path empty: the old bundle is moved ASIDE first and moved BACK if the second
  // rename fails, so every failure path ends with a working app at live_app_path.
  const std::string aside = live_app_path + ".forge-previous";
  fs::remove_all(aside, ec);
  if (::rename(live_app_path.c_str(), aside.c_str()) != 0) {
    err = "cannot move the installed app aside: " + std::string(std::strerror(errno));
    return false;
  }
  if (::rename(staged_app_path.c_str(), live_app_path.c_str()) != 0) {
    const int e2 = errno;
    if (::rename(aside.c_str(), live_app_path.c_str()) != 0) {
      err = "install failed AND rollback failed; the previous app is at " + aside + " (" +
            std::strerror(e2) + ")";
      return false;
    }
    err = "install failed and was rolled back: " + std::string(std::strerror(e2));
    return false;
  }
  // Report the displaced bundle where the caller expects it.
  fs::remove_all(staged_app_path, ec);
  fs::rename(aside, staged_app_path, ec);
  return true;
}

// ──────────────────────────────────────────────────────────────── applyUpdate
ApplyResult applyUpdate(const Plan& plan, const Manifest& m, const std::string& raw_live_app_path,
                        Fetcher& fetcher, const Policy& p) {
  ApplyResult r;
  if (plan.decision != Decision::UpdateAvailable) {
    r.reason = "applyUpdate called with a plan that is not UpdateAvailable: " + plan.reason;
    return r;
  }
  const std::string live_app_path = stripTrailingSlashes(raw_live_app_path);
  std::error_code ec;
  if (!fs::is_directory(live_app_path, ec)) {
    r.reason = "not an installed bundle: '" + live_app_path +
               "'. A developer build run from a build directory cannot self-update.";
    return r;
  }

  // The staging directory is a SIBLING of the installed app so the final rename
  // stays on one volume; a staging dir in /tmp would make the swap a cross-device
  // copy, which is neither atomic nor cheap.
  const fs::path parent = fs::path(live_app_path).parent_path();
  if (::access(parent.c_str(), W_OK) != 0) {
    r.reason = "cannot write next to the installed app (" + parent.string() +
               "): update needs write access to the directory containing Forge.app";
    return r;
  }
  const fs::path staging = parent / (".forge-update-" + std::to_string(::getpid()));
  fs::remove_all(staging, ec);
  if (!fs::create_directory(staging, ec)) {
    r.reason = "cannot create staging directory " + staging.string() + ": " + ec.message();
    return r;
  }
  struct Cleanup {
    fs::path dir;
    ~Cleanup() {
      std::error_code e;
      fs::remove_all(dir, e);
    }
  } cleanup{staging};

  const std::string zip = (staging / "payload.zip").string();
  std::string err;

  // Re-check admissibility HERE as well as in decide(). Two checks of the same
  // property look redundant until someone calls applyUpdate() with a manifest
  // that never went through decide(); this makes that mistake safe.
  if (!isAllowedDownloadUrl(m.url, p.allowed_hosts) || !isPayloadUrlPinned(m.url)) {
    r.reason = "refusing to fetch an inadmissible url: " + m.url;
    return r;
  }
  if (!fetcher.get(m.url, zip, err)) {
    r.reason = err;
    return r;
  }

  // BEFORE unpacking. An archive is parsed by ditto, so verifying first keeps
  // unverified bytes away from a decompressor as well as away from the disk.
  if (!verifyPayload(zip, m, err)) {
    r.reason = err;
    return r;
  }

  std::string staged_app;
  if (!stageBundle(zip, staging.string(), staged_app, err)) {
    r.reason = err;
    return r;
  }
  if (!validateStagedBundle(staged_app, m.version, /*require_valid_signature=*/true, err)) {
    r.reason = err;
    return r;
  }
  if (!atomicSwap(staged_app, live_app_path, err)) {
    r.reason = err;
    return r;
  }

  r.ok = true;
  r.installed_version = m.version;
  r.displaced_bundle_path = staged_app;  // inside `staging`; Cleanup removes it
  r.reason = "installed " + m.version + " over " + plan.current.text;
  return r;
}

std::vector<std::string> relaunchArgv(const std::string& app_path) {
  // `open -n` launches a NEW instance. The caller spawns this and then quits, so
  // the replacement starts from the swapped-in bundle rather than the image of
  // the process that is exiting.
  return {"/usr/bin/open", "-n", app_path};
}

}  // namespace forge::update
