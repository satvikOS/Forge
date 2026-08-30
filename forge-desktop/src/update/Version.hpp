// forge-desktop/src/update/Version.hpp
//
// SEMANTIC VERSION PARSING AND ORDERING for the auto-updater.
//
// This is the piece the whole update path turns on, and it is the piece that is
// most often written as `a < b` on two std::strings. That naive form is WRONG in
// a way that only shows up after ten releases: lexicographically "0.10.0" sorts
// BELOW "0.9.0", so an updater built on string comparison silently stops
// offering updates at the first double-digit minor. `test/update_gate.cpp
// --mutate 1` is exactly that defect, and it makes the gate go red.
//
// Ordering follows Semantic Versioning 2.0.0 clause 11, restricted to what this
// project actually emits:
//   * major.minor.patch compare NUMERICALLY;
//   * build metadata (`+7ab19c3`) is IGNORED for ordering, per clause 10;
//   * a prerelease (`0.1.0-rc.1`) is LOWER than its release (`0.1.0`), which is
//     what stops a shipped 0.1.0 from being "updated" backwards onto its own
//     release candidate;
//   * two prereleases compare identifier by identifier: numeric identifiers
//     numerically and BELOW alphanumeric ones, and a longer identifier list wins
//     when every shared identifier is equal.
//
// A leading 'v' is accepted because a git TAG is `v0.1.0` while
// CFBundleShortVersionString is `0.1.0`; both name the same version and the
// updater sees both.
#pragma once

#include <string>
#include <vector>

namespace forge::update {

struct Version {
  bool valid = false;
  int major = 0;
  int minor = 0;
  int patch = 0;
  // Dot-separated prerelease identifiers, already split. Empty == a release.
  std::vector<std::string> prerelease;
  // Build metadata, kept for display only. NEVER consulted for ordering.
  std::string build;
  // The text this was parsed from, minus any leading 'v'.
  std::string text;

  bool isPrerelease() const { return !prerelease.empty(); }
};

// Parses "1.2.3", "v1.2.3", "1.2.3-rc.1", "0.0.0-dev+7ab19c3".
// Returns a Version with valid == false on anything else; the caller must check.
Version parseVersion(const std::string& s);

// -1 if a orders before b, 0 if they order equal, +1 if a orders after b.
// Two invalid versions are equal; an invalid version orders BELOW a valid one,
// so an unparseable running version is treated as "older than anything", which
// fails toward offering the update rather than toward never updating again.
int compareVersions(const Version& a, const Version& b);

}  // namespace forge::update
