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
//
// ── THE EXIT CODES, AND WHY THERE ARE FOUR ───────────────────────────────────
//     0   an update is available (check) / it was installed (apply)
//    10   already current
//     1   REFUSED — the manifest was read and the policy said no: a downgrade,
//         a foreign channel, an off-host or floating payload URL, a bad digest
//         field. Something is wrong WITH THE RELEASE.
//     2   the command line itself was wrong. Nothing was fetched.
//     3   COULD NOT CHECK — the appcast was never read: no network, a timeout,
//         a TLS failure, an unreadable file, nothing published yet. Nothing is
//         known about whether an update exists.
//
// 1 and 3 were the SAME code until 2026-09-03, and conflating them is a real
// harm rather than an untidiness: a caller that reads "non-zero, not 10" as
// "refused" tells the user the published release is bad when the truth is that
// their wifi is off. package_macos.sh is exactly such a caller. A failed check
// must never be reported as a verdict about a release, and — the other
// direction — must never be reported as a success: every path below that ends
// without a verdict exits non-zero and says so on stderr.
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

// Usage goes to the stream the caller asked for: stdout when a person typed
// --help (it is the answer to their question), stderr when we are refusing a
// command line (it is a diagnostic, and must not be mistaken for output).
void usage(std::FILE* to) {
  std::fprintf(
      to,
      "forge_update — Forge's self-updater\n"
      "\n"
      "  forge_update check [--url U] [--appcast FILE] [--running V] [--allow-prerelease]\n"
      "  forge_update apply --app /Applications/Forge.app [--relaunch] [--url U]\n"
      "  forge_update --version\n"
      "\n"
      "exit codes\n"
      "   0  an update is available (check) / installed (apply)\n"
      "  10  already current\n"
      "   1  refused: the manifest was read and the policy said no\n"
      "   2  the command line was wrong; nothing was fetched\n"
      "   3  could not check: no network, a timeout, or nothing published yet\n");
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
    usage(stderr);
    return 2;
  }
  const std::string cmd = argv[1];

  // ── the command line is settled BEFORE anything is fetched ─────────────────
  //
  // THE DEFECT THIS ORDERING FIXES, measured 2026-09-03 on the shipped binary:
  //
  //     $ forge_update --version
  //     could not fetch the appcast: download failed: /usr/bin/curl exited 56:
  //     curl: (56) The requested URL returned error: 404
  //     $ echo $?
  //     1
  //
  // `--version` was read as the SUBCOMMAND, the flag loop found nothing to
  // object to, and the program went to the network — so a typo made a request,
  // waited on a timeout, and then reported a release-shaped failure about a
  // release nobody had asked about. `forge_update status --appcast f.json` was
  // worse: it printed a complete, correct-looking verdict block and THEN the
  // usage text, so the transcript of a command that did nothing is byte-identical
  // at the top to the transcript of one that worked.
  //
  // Nothing below this block touches the network, the filesystem or a version
  // until the verb and every flag have been accepted.
  if (cmd == "-h" || cmd == "--help" || cmd == "help") {
    usage(stdout);
    return 0;
  }
  if (cmd == "--version" || cmd == "-V" || cmd == "version") {
    // There is no compiled-in version constant, deliberately: the running version
    // is read from the enclosing bundle's Info.plist so the binary and the plist
    // cannot drift. Outside a bundle there is honestly nothing to report, and
    // saying so beats inventing a number.
    std::error_code ec;
    const fs::path self = fs::canonical(argv[0], ec);
    const std::string bundle = ec ? std::string() : enclosingAppBundle(self.string());
    const std::string v = bundle.empty() ? std::string() : bundleShortVersion(bundle);
    if (v.empty()) {
      std::printf("forge_update (not inside an installed Forge.app; no version to report)\n");
    } else {
      std::printf("forge_update — Forge %s (%s)\n", v.c_str(), bundle.c_str());
    }
    return 0;
  }
  if (cmd != "check" && cmd != "apply") {
    std::fprintf(stderr, "unknown command: %s\n\n", cmd.c_str());
    usage(stderr);
    return 2;
  }

  std::string url = kDefaultAppcastUrl;
  std::string appcast_file;
  std::string app_path;
  std::string running;
  bool relaunch = false;
  bool allow_prerelease = false;
  bool allow_downgrade = false;
  bool i_mean_it = false;

  // A flag that takes a value and was given none used to fall out of this loop
  // as "unknown argument: --appcast", which sends the reader looking for a typo
  // in a flag they spelled correctly. needsValue() says what is actually wrong.
  auto needsValue = [](const std::string& flag) {
    std::fprintf(stderr, "%s needs a value\n", flag.c_str());
    return 2;
  };

  for (int i = 2; i < argc; ++i) {
    const std::string a = argv[i];
    if (a == "--url") { if (i + 1 >= argc) return needsValue(a); url = argv[++i]; }
    else if (a == "--appcast") { if (i + 1 >= argc) return needsValue(a); appcast_file = argv[++i]; }
    else if (a == "--app") { if (i + 1 >= argc) return needsValue(a); app_path = argv[++i]; }
    else if (a == "--running") { if (i + 1 >= argc) return needsValue(a); running = argv[++i]; }
    else if (a == "--relaunch") relaunch = true;
    else if (a == "--allow-prerelease") allow_prerelease = true;
    else if (a == "--insecure-allow-downgrade") allow_downgrade = true;
    else if (a == "--i-mean-it") i_mean_it = true;
    else if (a == "-h" || a == "--help") { usage(stdout); return 0; }
    else {
      std::fprintf(stderr, "unknown argument: %s\n\n", a.c_str());
      usage(stderr);
      return 2;
    }
  }

  if (app_path.empty()) {
    // Default to the bundle this very executable is inside, if any.
    std::error_code ec;
    const fs::path self = fs::canonical(argv[0], ec);
    if (!ec) app_path = enclosingAppBundle(self.string());
  }
  const bool running_was_given = !running.empty();
  if (running.empty()) running = detectRunningVersion(app_path);

  // A running version nobody can parse turns the monotonic-version guard OFF:
  // compareVersions documents that an invalid version orders BELOW everything,
  // which is the right failure direction for a bundle whose plist is unreadable
  // (keep updating) and the WRONG one for a value a person typed, because it
  // silently accepts any published release including an older one. Refuse it at
  // the boundary, where the mistake is, instead of carrying it into the policy.
  if (running_was_given && !parseVersion(running).valid) {
    std::fprintf(stderr,
                 "--running '%s' is not a version this updater can order.\n"
                 "Expected something like 0.1.0, v0.1.0 or 0.1.0-alpha.3. Without a version\n"
                 "it can order, the guard that stops a downgrade cannot run.\n",
                 running.c_str());
    return 2;
  }

  // The channel comes from WHAT THIS BUILD IS, not from a default. An alpha follows
  // the prerelease channel; a release follows stable. --allow-prerelease remains an
  // explicit override for a stable build that wants to look at prereleases anyway.
  Policy policy = policyFor(running);
  if (allow_prerelease) {
    policy.allow_prerelease = true;
    policy.channel = "";  // follow whichever channel is published
  }
  if (allow_downgrade) {
    if (!i_mean_it) {
      std::fprintf(stderr,
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
      // COULD NOT CHECK, not "refused": an unreadable or empty file says nothing
      // about the release it was supposed to describe.
      std::fprintf(stderr, "could not read the appcast file %s\n", appcast_file.c_str());
      return 3;
    }
  } else {
    if (!isAllowedDownloadUrl(url, policy.allowed_hosts)) {
      std::fprintf(stderr, "REFUSED: the appcast url is not https on an allowed host: %s\n",
                   url.c_str());
      return 1;
    }
    CurlFetcher fetcher;
    fetcher.max_bytes = kMaxManifestBytes;
    fetcher.timeout_seconds = 30;
    std::error_code ec;
    const fs::path tmp = fs::temp_directory_path(ec) / "forge-appcast.json";
    std::string err;
    if (!fetcher.get(url, tmp.string(), err)) {
      // The SENTENCE first, curl's own words second and labelled. Before this,
      // the only thing a user saw was
      //     could not fetch the appcast: download failed: /usr/bin/curl exited
      //     56: curl: (56) The requested URL returned error: 404
      // for the entirely ordinary situation of nothing having been published.
      std::fprintf(stderr, "%s\n", describeFetchFailure(err).c_str());
      std::fprintf(stderr, "detail: %s\n", err.c_str());
      std::fprintf(stderr, "no update check was completed; nothing was installed\n");
      fs::remove(tmp, ec);
      return 3;
    }
    body = readFile(tmp.string());
    fs::remove(tmp, ec);
    if (body.empty()) {
      // curl exited 0 and left nothing readable. Rare, and exactly the shape of
      // failure that must not be allowed to look like a verdict.
      std::fprintf(stderr, "the appcast downloaded as an empty document; nothing to read\n");
      return 3;
    }
  }

  std::string err;
  const Manifest m = parseManifest(body, err);
  if (!m.valid) {
    std::fprintf(stderr, "the appcast did not parse: %s\n", err.c_str());
    return 1;
  }
  const Plan plan = decide(running, m, policy);

  std::printf("running   %s\n", running.c_str());
  std::printf("offered   %s  (channel %s, %llu bytes)\n", m.version.c_str(), m.channel.c_str(),
              static_cast<unsigned long long>(m.size));
  std::printf("payload   %s\n", m.url.c_str());
  std::printf("sha256    %s\n", m.sha256.c_str());
  std::printf("verdict   %s\n", plan.reason.c_str());
  // stdout is block-buffered when it is a pipe or a file, stderr is not, so a
  // refusal written below would otherwise appear ABOVE the verdict block it
  // refers to in every captured transcript — including the ones CI archives.
  std::fflush(stdout);

  if (cmd == "check") {
    if (plan.decision == Decision::UpdateAvailable) return 0;
    if (plan.decision == Decision::UpToDate) return 10;
    // The verdict line above already says WHY. Repeat it on stderr so a caller
    // that only reads stderr — which is where a refusal belongs — still gets the
    // reason, and so no refusal can be silent.
    std::fprintf(stderr, "REFUSED: %s\n", plan.reason.c_str());
    return 1;
  }
  // cmd is one of check/apply: everything else exited 2 before a byte moved.

  if (plan.decision != Decision::UpdateAvailable) {
    std::fprintf(stderr, "nothing to apply: %s\n", plan.reason.c_str());
    return plan.decision == Decision::UpToDate ? 10 : 1;
  }
  if (app_path.empty()) {
    std::fprintf(stderr,
        "REFUSED: no installed bundle to update. Pass --app /Applications/Forge.app.\n"
        "A build run out of a build directory is not a bundle and cannot self-update.\n");
    return 1;
  }
  std::printf("installing into %s\n", app_path.c_str());
  std::fflush(stdout);

  CurlFetcher fetcher;
  fetcher.max_bytes = policy.max_payload_bytes;
  const ApplyResult r = applyUpdate(plan, m, app_path, fetcher, policy);
  if (!r.ok) {
    // Every failure inside applyUpdate leaves the installed app untouched
    // (update_gate.cpp asserts that over a tampered payload), so the second
    // sentence is a fact and not a reassurance. A download failure inside apply
    // gets the same plain-sentence treatment as one inside check.
    const bool was_a_fetch_failure = r.reason.find("download failed") != std::string::npos;
    if (was_a_fetch_failure) {
      std::fprintf(stderr, "%s\n", describeFetchFailure(r.reason).c_str());
      std::fprintf(stderr, "detail: %s\n", r.reason.c_str());
    } else {
      std::fprintf(stderr, "%s\n", r.reason.c_str());
    }
    std::fprintf(stderr, "the installed app is unchanged\n");
    return was_a_fetch_failure ? 3 : 1;
  }
  std::printf("%s\n", r.reason.c_str());

  if (relaunch) {
    const std::vector<std::string> re = relaunchArgv(app_path);
    std::string command;
    for (const std::string& a : re) command += "'" + a + "' ";
    std::printf("relaunching: %s\n", command.c_str());
    // The caller is exiting anyway; the replacement starts from the new bundle.
    if (std::system(command.c_str()) != 0) {
      // The update DID install. Saying so matters: a non-zero exit here must not
      // be read as "the update failed", because the new bundle is in place.
      std::fprintf(stderr,
                   "the update installed, but relaunching failed; start Forge yourself\n");
      return 1;
    }
  }
  return 0;
}
