// forge-desktop/test/appcast_check.cpp
//
// Reads an appcast.json written by forge-desktop/emit_appcast.sh and runs the
// REAL app-side pipeline over it: parseManifest -> validateManifest -> decide(),
// with the shipping Policy. Prints what it found and exits non-zero if the
// document the packaging script produced is one the app would refuse.
//
// This is the half of the producer/consumer contract that lives in C++. Without
// it, "the release pipeline emits an appcast" and "the app can read an appcast"
// are two claims that have never met.
//
// Usage:
//   appcast_check <appcast.json> --running <version> --expect <verdict>
//     verdict: update | uptodate | reject
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
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--running") == 0 && i + 1 < argc) {
      running = argv[++i];
    } else if (std::strcmp(argv[i], "--expect") == 0 && i + 1 < argc) {
      expect = argv[++i];
    } else if (std::strcmp(argv[i], "--allow-prerelease") == 0) {
      allow_prerelease = true;
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
  Policy p;
  p.allow_prerelease = allow_prerelease;
  if (allow_prerelease) p.channel = m.channel;  // opting in also follows that channel
  const Plan plan = decide(running, m, p);

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
