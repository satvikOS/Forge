// forge-desktop/test/appcast_check.cpp
//
// Reads an appcast.json written by forge-desktop/emit_appcast.sh and runs the
// REAL app-side pipeline over it: parseManifest -> validateManifest -> decide(),
// under the SHIPPING policy. Prints what it found and exits non-zero if the
// document the packaging script produced is one the app would refuse.
//
// This is the half of the producer/consumer contract that lives in C++. Without
// it, "the release pipeline emits an appcast" and "the app can read an appcast"
// are two claims that have never met.
//
// ★ THE POLICY MUST COME FROM policyFor(), NOT BE BUILT HERE. This file used to
// construct a Policy by hand -- default-constructed, so channel "stable" -- while
// its own header claimed it ran "the shipping Policy". The running app does not
// do that: UpdateService.cpp:86 calls
//     decide(running, m, policyFor(running))
// and policyFor decides the channel FROM THE RUNNING VERSION. So every verdict
// this checker printed for a prerelease `--running` was a verdict about a policy
// no shipped build has, and the selftest that drives it could not see a defect in
// the real rule. It did not see one: an installed alpha was refused the first
// stable release, and this instrument reported the case as fine.
//
// A gate whose subject is not the shipped code cannot fail for the shipped code.
// --allow-prerelease stays, as the explicit opt-in override a user setting would
// make, and it is now the ONLY way to depart from what the app would do.
//
// Usage:
//   appcast_check <appcast.json> --running <version> --expect <verdict>
//     verdict: update | uptodate | reject
//     --allow-prerelease  override the shipping policy and opt in to prereleases
//     --print-url         also print `payload_url=<url>`, the URL the app would
//                         fetch, taken from the PARSED manifest rather than from
//                         the JSON on disk. release_contract_gate.sh compares
//                         that string with the URL the release workflow will
//                         actually publish under, which is the only way the
//                         bash producer, the YAML release path and the C++
//                         consumer are ever checked against each other at once.
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>

#include "update/Manifest.hpp"
#include "update/Updater.hpp"

using namespace forge::update;

int main(int argc, char** argv) {
  std::string path;
  std::string running = "0.0.0";
  std::string expect;
  bool allow_prerelease = false;
  bool print_url = false;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--running") == 0 && i + 1 < argc) {
      running = argv[++i];
    } else if (std::strcmp(argv[i], "--expect") == 0 && i + 1 < argc) {
      expect = argv[++i];
    } else if (std::strcmp(argv[i], "--allow-prerelease") == 0) {
      allow_prerelease = true;
    } else if (std::strcmp(argv[i], "--print-url") == 0) {
      print_url = true;
    } else if (path.empty()) {
      path = argv[i];
    }
  }
  if (path.empty() || expect.empty()) {
    std::printf("usage: appcast_check <appcast.json> --running <v> --expect update|uptodate|reject\n");
    return 2;
  }

  std::ifstream in(path, std::ios::binary);
  if (!in) {
    std::printf("FAIL cannot read %s\n", path.c_str());
    return 1;
  }
  std::ostringstream ss;
  ss << in.rdbuf();

  std::string err;
  const Manifest m = parseManifest(ss.str(), err);
  if (!m.valid) {
    std::printf("FAIL the app's parser REFUSED the appcast the packaging script wrote: %s\n",
                err.c_str());
    return 1;
  }
  // What the app itself would use for THIS running version.
  Policy p = policyFor(running);
  if (allow_prerelease) {
    p.allow_prerelease = true;
    p.channel.clear();  // opting in also stops pinning to a channel
  }
  const Plan plan = decide(running, m, p);

  // Printed BEFORE the verdict line and on its own, machine-readable line: the
  // caller that wants this wants the URL even when the verdict is not `update`.
  if (print_url) std::printf("payload_url=%s\n", m.url.c_str());

  const char* got = plan.decision == Decision::UpdateAvailable ? "update"
                    : plan.decision == Decision::UpToDate      ? "uptodate"
                                                               : "reject";
  std::printf("  running=%-12s offered=%-12s channel=%-10s -> %-8s  (%s)\n", running.c_str(),
              m.version.c_str(), m.channel.c_str(), got, plan.reason.c_str());
  if (expect != got) {
    std::printf("FAIL expected '%s', got '%s'\n", expect.c_str(), got);
    return 1;
  }
  return 0;
}
