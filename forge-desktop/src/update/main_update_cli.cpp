// forge-desktop/src/update/main_update_cli.cpp
//
// `forge_update` — the auto-update path as a command you can run.
//
// WHY A COMMAND AND NOT ONLY A MENU ITEM. Everything below is the same library
// the app links; nothing here is a parallel implementation. Having it addressable
// from a shell means the update path can be exercised against the REAL GitHub
// release — the one thing the headless gate deliberately cannot do — without
// building the 40-minute OCCT-linked application, and without a human clicking
// through a UI to find out whether a release is discoverable.
//
//   forge_update check
//       Fetch the appcast, print the verdict, INSTALL NOTHING. Exit 0 if an
//       update is available, 10 if already current, 1 if refused.
//
//   forge_update check --appcast <file>
//       The same, from a local file. No network at all.
//
//   forge_update apply [--app /Applications/Forge.app]
//       The whole path: fetch, verify sha256, stage, validate, atomic swap.
//       Refuses unless --app names a real bundle. Prints what it did.
//
//   forge_update apply --relaunch
//       ...and then `open -n` the replaced bundle.
//
// Common flags: --url <appcast url>, --running <version>, --allow-prerelease,
//               --insecure-allow-downgrade (refused unless also --i-mean-it).
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "update/Manifest.hpp"
#include "update/Updater.hpp"
#include "update/Version.hpp"

namespace fs = std::filesystem;
using namespace forge::update;

namespace {

void usage() {
  std::printf(
      "forge_update — Forge's self-updater\n"
      "\n"
      "  forge_update check [--url U] [--appcast FILE] [--running V] [--allow-prerelease]\n"
      "  forge_update apply --app /Applications/Forge.app [--relaunch] [--url U]\n"
      "\n"
      "check exits 0 when an update is available, 10 when already current, 1 when refused.\n");
}

std::string readFile(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return std::string();
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

// The running version comes from the bundle's own Info.plist so the binary and
// the plist cannot disagree. Outside a bundle there is no version to speak of,
// and 0.0.0-dev is the same stamp CI puts on a dispatch build.
std::string detectRunningVersion(const std::string& app_path) {
  if (!app_path.empty()) {
    const std::string v = bundleShortVersion(app_path);
    if (!v.empty()) return v;
  }
  return "0.0.0-dev";
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    usage();
    return 2;
  }
  const std::string cmd = argv[1];
  std::string url = kDefaultAppcastUrl;
  std::string appcast_file;
  std::string app_path;
  std::string running;
  bool relaunch = false;
  bool allow_prerelease = false;
  bool allow_downgrade = false;
  bool i_mean_it = false;

  for (int i = 2; i < argc; ++i) {
    const std::string a = argv[i];
    if (a == "--url" && i + 1 < argc) url = argv[++i];
    else if (a == "--appcast" && i + 1 < argc) appcast_file = argv[++i];
    else if (a == "--app" && i + 1 < argc) app_path = argv[++i];
    else if (a == "--running" && i + 1 < argc) running = argv[++i];
    else if (a == "--relaunch") relaunch = true;
    else if (a == "--allow-prerelease") allow_prerelease = true;
    else if (a == "--insecure-allow-downgrade") allow_downgrade = true;
    else if (a == "--i-mean-it") i_mean_it = true;
    else if (a == "-h" || a == "--help") { usage(); return 0; }
    else { std::printf("unknown argument: %s\n", a.c_str()); return 2; }
  }

  if (app_path.empty()) {
    // Default to the bundle this very executable is inside, if any.
    std::error_code ec;
    const fs::path self = fs::canonical(argv[0], ec);
    if (!ec) app_path = enclosingAppBundle(self.string());
  }
  if (running.empty()) running = detectRunningVersion(app_path);

  Policy policy;
  policy.allow_prerelease = allow_prerelease;
  if (allow_prerelease) policy.channel = "";  // follow whichever channel is published
  if (allow_downgrade) {
    if (!i_mean_it) {
      std::printf(
          "REFUSED: --insecure-allow-downgrade turns off the guard that stops a replayed\n"
          "old manifest rolling you back onto published bugs. Add --i-mean-it if that is\n"
          "genuinely what you want.\n");
      return 2;
    }
    policy.allow_downgrade = true;
  }

  // ── obtain the manifest ────────────────────────────────────────────────────
  std::string body;
  if (!appcast_file.empty()) {
    body = readFile(appcast_file);
    if (body.empty()) {
      std::printf("cannot read %s\n", appcast_file.c_str());
      return 1;
    }
  } else {
    if (!isAllowedDownloadUrl(url, policy.allowed_hosts)) {
      std::printf("REFUSED: the appcast url is not https on an allowed host: %s\n", url.c_str());
      return 1;
    }
    CurlFetcher fetcher;
    fetcher.max_bytes = kMaxManifestBytes;
    fetcher.timeout_seconds = 30;
    std::error_code ec;
    const fs::path tmp = fs::temp_directory_path(ec) / "forge-appcast.json";
    std::string err;
    if (!fetcher.get(url, tmp.string(), err)) {
      std::printf("could not fetch the appcast: %s\n", err.c_str());
      return 1;
    }
    body = readFile(tmp.string());
    fs::remove(tmp, ec);
  }

  std::string err;
  const Manifest m = parseManifest(body, err);
  if (!m.valid) {
    std::printf("the appcast did not parse: %s\n", err.c_str());
    return 1;
  }
  const Plan plan = decide(running, m, policy);

  std::printf("running   %s\n", running.c_str());
  std::printf("offered   %s  (channel %s, %llu bytes)\n", m.version.c_str(), m.channel.c_str(),
              static_cast<unsigned long long>(m.size));
  std::printf("payload   %s\n", m.url.c_str());
  std::printf("sha256    %s\n", m.sha256.c_str());
  std::printf("verdict   %s\n", plan.reason.c_str());

  if (cmd == "check") {
    if (plan.decision == Decision::UpdateAvailable) return 0;
    if (plan.decision == Decision::UpToDate) return 10;
    return 1;
  }
  if (cmd != "apply") {
    usage();
    return 2;
  }

  if (plan.decision != Decision::UpdateAvailable) {
    std::printf("nothing to apply\n");
    return plan.decision == Decision::UpToDate ? 10 : 1;
  }
  if (app_path.empty()) {
    std::printf(
        "REFUSED: no installed bundle to update. Pass --app /Applications/Forge.app.\n"
        "A build run out of a build directory is not a bundle and cannot self-update.\n");
    return 1;
  }
  std::printf("installing into %s\n", app_path.c_str());

  CurlFetcher fetcher;
  fetcher.max_bytes = policy.max_payload_bytes;
  const ApplyResult r = applyUpdate(plan, m, app_path, fetcher, policy);
  std::printf("%s\n", r.reason.c_str());
  if (!r.ok) return 1;

  if (relaunch) {
    const std::vector<std::string> re = relaunchArgv(app_path);
    std::string command;
    for (const std::string& a : re) command += "'" + a + "' ";
    std::printf("relaunching: %s\n", command.c_str());
    // The caller is exiting anyway; the replacement starts from the new bundle.
    if (std::system(command.c_str()) != 0) {
      std::printf("relaunch failed; start Forge yourself\n");
      return 1;
    }
  }
  return 0;
}
