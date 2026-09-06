// forge-desktop/test/release_rehearsal.cpp
//
// THE RELEASE REHEARSAL DRIVER. Answers the one question the offline gate
// deliberately cannot: when a release actually appears, does an ALREADY-INSTALLED
// older copy of Forge detect it, download it, verify it, and replace itself?
//
// ── WHY THIS EXISTS ALONGSIDE update_gate.cpp ────────────────────────────────
// update_gate.cpp drives the same library with a FakeFetcher that copies a local
// file, and asserts on values. That is the right shape for a unit gate and it is
// why it runs in seconds with no socket. But it means the gate has never once
// proved that:
//
//   * /usr/bin/curl, spawned with the ARGUMENT VECTOR this code actually builds,
//     retrieves the bytes at all -- curlArgv() is covered by a string comparison,
//     not by a transfer;
//   * a real HTTPS round trip, a real redirect policy and a real --max-filesize
//     produce a file the digest check then accepts;
//   * `ditto -x -k` unpacks a zip produced by `ditto -c -k --keepParent` into a
//     bundle whose ad-hoc signature still satisfies `codesign --verify --deep
//     --strict` AFTER a network round trip;
//   * renamex_np(RENAME_SWAP) swaps a live bundle on this filesystem.
//
// Every one of those is a step that can only fail for real. This driver runs the
// REAL library against a REAL local HTTPS server serving a FAKE release, so the
// answer is measured rather than assumed.
//
// ── THE ONE SUBSTITUTION, STATED PLAINLY ─────────────────────────────────────
// Policy::allowed_hosts is overridden to the loopback host. NOTHING ELSE is
// relaxed: the scheme must still be https, the payload URL must still be pinned
// to one release, the digest must still match, the staged bundle must still
// carry a valid signature and the right version, and the version must still move
// forward.
//
// That substitution is not taken on trust. checkAllowListIsLive() below runs
// decide() over the SAME manifest with the DEFAULT policy and REQUIRES it to be
// rejected. If the host allow-list were ever weakened to the point where
// loopback passed by default, this driver goes red -- so the rehearsal cannot
// quietly become a rehearsal of a broken allow-list.
//
// ── EXIT CONVENTION ──────────────────────────────────────────────────────────
// Same as its siblings: 0 means every check passed, non-zero means at least one
// failed. The shell script that owns the fake release mutates the SERVED
// ARTEFACTS and requires this driver to go red for each -- so the negative
// controls are corruptions of a release, not of the code under test.
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

int g_checks = 0;
int g_failures = 0;

void ok(const std::string& what, const std::string& detail = std::string()) {
  ++g_checks;
  std::printf("  ok    %-58s %s\n", what.c_str(), detail.c_str());
}

void fail(const std::string& what, const std::string& detail) {
  ++g_checks;
  ++g_failures;
  std::printf("  FAIL  %-58s %s\n", what.c_str(), detail.c_str());
}

void require(bool cond, const std::string& what, const std::string& detail) {
  if (cond) ok(what, detail);
  else fail(what, detail);
}

std::string readFile(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return std::string();
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

}  // namespace

int main(int argc, char** argv) {
  std::string appcast_url;
  std::string app_path;
  std::string running;
  std::string allow_host;
  // What the caller expects this run to do. "install" means the whole path must
  // succeed; "refuse" means it must NOT install AND must leave the installed app
  // exactly as it was. The mutations use "refuse".
  std::string expect = "install";

  for (int i = 1; i < argc; ++i) {
    const std::string a = argv[i];
    if (a == "--appcast-url" && i + 1 < argc) appcast_url = argv[++i];
    else if (a == "--app" && i + 1 < argc) app_path = argv[++i];
    else if (a == "--running" && i + 1 < argc) running = argv[++i];
    else if (a == "--allow-host" && i + 1 < argc) allow_host = argv[++i];
    else if (a == "--expect" && i + 1 < argc) expect = argv[++i];
    else { std::printf("unknown argument: %s\n", a.c_str()); return 2; }
  }
  if (appcast_url.empty() || app_path.empty() || running.empty() || allow_host.empty()) {
    std::printf("usage: release_rehearsal --appcast-url U --app BUNDLE --running V --allow-host H"
                " [--expect install|refuse]\n");
    return 2;
  }
  if (expect != "install" && expect != "refuse") {
    std::printf("--expect must be 'install' or 'refuse'\n");
    return 2;
  }

  std::printf("forge-desktop RELEASE REHEARSAL  (expect: %s)\n", expect.c_str());
  std::printf("  installed bundle   %s\n", app_path.c_str());
  std::printf("  running version    %s\n", running.c_str());
  std::printf("  appcast            %s\n", appcast_url.c_str());

  // ── what is installed RIGHT NOW, read the way the app reads it ─────────────
  const std::string before = bundleShortVersion(app_path);
  require(before == running, "the installed bundle really is the running version",
          "Info.plist says '" + before + "'");
  if (before != running) {
    std::printf("\n%d checks, %d failures\n", g_checks, g_failures);
    return 1;
  }

  // ── the check half: fetch the appcast over a REAL https transfer ───────────
  Policy policy = policyFor(running);
  policy.allowed_hosts = {allow_host};

  CurlFetcher manifest_fetcher;
  manifest_fetcher.max_bytes = kMaxManifestBytes;
  manifest_fetcher.timeout_seconds = 30;

  std::error_code ec;
  const fs::path tmp = fs::temp_directory_path(ec) / "forge-rehearsal-appcast.json";
  std::string err;
  const bool fetched = manifest_fetcher.get(appcast_url, tmp.string(), err);
  require(fetched, "the appcast is retrievable over https by the REAL curl argv",
          fetched ? std::string("fetched") : err);
  if (!fetched) {
    std::printf("\n%d checks, %d failures\n", g_checks, g_failures);
    return 1;
  }

  const std::string body = readFile(tmp.string());
  fs::remove(tmp, ec);
  const Manifest m = parseManifest(body, err);
  require(m.valid, "the served appcast parses with the app's OWN parser",
          m.valid ? ("version " + m.version + ", channel " + m.channel) : err);
  if (!m.valid) {
    std::printf("\n%d checks, %d failures\n", g_checks, g_failures);
    return 1;
  }

  // ── the allow-list is LIVE, not a formality ───────────────────────────────
  // The whole rehearsal rests on ONE relaxation. Prove that relaxation is the
  // only thing letting the loopback host through, by re-running the same
  // decision with the SHIPPING policy and requiring a refusal.
  {
    Policy shipping = policyFor(running);  // default allowed_hosts: github.com only
    const Plan p = decide(running, m, shipping);
    require(p.decision == Decision::Rejected,
            "the SHIPPING host allow-list still refuses this loopback release",
            p.reason);
  }

  const Plan plan = decide(running, m, policy);
  std::printf("  verdict            %s\n", plan.reason.c_str());

  if (expect == "install") {
    require(plan.decision == Decision::UpdateAvailable,
            "an installed older copy DETECTS the published release", plan.reason);
  }

  // ── the apply half: download, verify, stage, validate, swap ───────────────
  bool installed = false;
  std::string apply_reason;
  if (plan.decision == Decision::UpdateAvailable) {
    CurlFetcher payload_fetcher;
    payload_fetcher.max_bytes = policy.max_payload_bytes;
    payload_fetcher.timeout_seconds = 120;
    const ApplyResult r = applyUpdate(plan, m, app_path, payload_fetcher, policy);
    installed = r.ok;
    apply_reason = r.reason;
    std::printf("  apply              %s\n", r.reason.c_str());
  } else {
    apply_reason = plan.reason;
  }

  const std::string after = bundleShortVersion(app_path);

  if (expect == "install") {
    require(installed, "the update INSTALLED", apply_reason);
    require(after == m.version,
            "the installed bundle now reports the NEW version",
            "before " + before + " -> after " + after);
    // A bundle that installed but cannot pass its own signature check is a
    // bricked app, and the user would find out at launch, not here.
    require(fs::is_regular_file(app_path + "/Contents/MacOS/forge_desktop", ec),
            "the swapped-in bundle still has its executable", app_path);
    require(fs::is_regular_file(app_path + "/Contents/MacOS/forge_update", ec),
            "the swapped-in bundle can update itself AGAIN (forge_update present)",
            "Contents/MacOS/forge_update");
    const std::vector<std::string> re = relaunchArgv(app_path);
    require(re.size() == 3 && re[0] == "/usr/bin/open" && re[1] == "-n" && re[2] == app_path,
            "the relaunch command names the bundle that was just swapped in",
            re.empty() ? std::string() : re[0] + " " + re[1] + " " + re[2]);
  } else {
    require(!installed, "the corrupted release was REFUSED", apply_reason);
    // The property that matters more than the refusal itself.
    require(after == before,
            "the INSTALLED APP IS UNTOUCHED after the refusal",
            "before " + before + " -> after " + after);
    require(fs::is_regular_file(app_path + "/Contents/MacOS/forge_desktop", ec),
            "the installed app still has its executable and would still launch",
            app_path);
  }

  // No staging litter may survive next to the installed app: a half-unpacked
  // bundle left in /Applications is a second Forge as far as Spotlight and the
  // user are concerned.
  int leftovers = 0;
  const fs::path parent = fs::path(app_path).parent_path();
  for (const fs::directory_entry& e : fs::directory_iterator(parent, ec)) {
    const std::string name = e.path().filename().string();
    if (name.rfind(".forge-update-", 0) == 0) ++leftovers;
    if (name.find(".forge-previous") != std::string::npos) ++leftovers;
  }
  require(leftovers == 0, "no staging directory was left beside the installed app",
          std::to_string(leftovers) + " leftover(s) in " + parent.string());

  std::printf("\n%d checks, %d failures\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
