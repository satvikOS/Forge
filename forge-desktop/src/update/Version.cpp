#include "update/Version.hpp"

#include <cctype>
#include <cstdlib>

namespace forge::update {
namespace {

bool allDigits(const std::string& s) {
  if (s.empty()) return false;
  for (char c : s) {
    if (!std::isdigit(static_cast<unsigned char>(c))) return false;
  }
  return true;
}

// A numeric field is at most 9 digits so it can never overflow an int, and a
// leading zero is rejected the way semver rejects it ("01.0.0" is not a
// version). Refusing is safer than silently reinterpreting: a version the app
// cannot parse becomes "older than everything", never "newer".
bool parseNumericField(const std::string& s, int& out) {
  if (!allDigits(s)) return false;
  if (s.size() > 9) return false;
  if (s.size() > 1 && s[0] == '0') return false;
  out = std::atoi(s.c_str());
  return true;
}

bool validIdentifierChars(const std::string& s) {
  if (s.empty()) return false;
  for (char c : s) {
    const bool ok = std::isalnum(static_cast<unsigned char>(c)) || c == '-';
    if (!ok) return false;
  }
  return true;
}

std::vector<std::string> splitDots(const std::string& s) {
  std::vector<std::string> out;
  std::string cur;
  for (char c : s) {
    if (c == '.') {
      out.push_back(cur);
      cur.clear();
    } else {
      cur.push_back(c);
    }
  }
  out.push_back(cur);
  return out;
}

// Semver 2.0.0 clause 11.4.1-11.4.3 on ONE identifier.
int compareIdentifier(const std::string& a, const std::string& b) {
  const bool na = allDigits(a);
  const bool nb = allDigits(b);
  if (na && nb) {
    // Compare numerically WITHOUT converting: a prerelease identifier has no
    // documented width limit, and atoi on a 40-digit identifier is undefined.
    // Strip leading zeros, then longer-is-larger, then lexical.
    std::size_t ia = a.find_first_not_of('0');
    std::size_t ib = b.find_first_not_of('0');
    const std::string ta = (ia == std::string::npos) ? "0" : a.substr(ia);
    const std::string tb = (ib == std::string::npos) ? "0" : b.substr(ib);
    if (ta.size() != tb.size()) return ta.size() < tb.size() ? -1 : 1;
    if (ta == tb) return 0;
    return ta < tb ? -1 : 1;
  }
  if (na != nb) return na ? -1 : 1;  // numeric identifiers rank BELOW alphanumeric
  if (a == b) return 0;
  return a < b ? -1 : 1;
}

}  // namespace

Version parseVersion(const std::string& raw) {
  Version v;
  std::string s = raw;

  // Trim ASCII whitespace on both ends: this text arrives from an Info.plist and
  // from a JSON manifest, and both can carry a stray newline.
  const std::size_t b = s.find_first_not_of(" \t\r\n");
  if (b == std::string::npos) return v;
  const std::size_t e = s.find_last_not_of(" \t\r\n");
  s = s.substr(b, e - b + 1);

  if (!s.empty() && (s[0] == 'v' || s[0] == 'V')) s.erase(0, 1);
  if (s.empty()) return v;
  v.text = s;

  // Split off build metadata FIRST: semver puts '+' after any '-', and a build
  // string is allowed to contain '-'.
  std::string core = s;
  const std::size_t plus = core.find('+');
  if (plus != std::string::npos) {
    v.build = core.substr(plus + 1);
    core = core.substr(0, plus);
    if (v.build.empty()) return v;
  }

  std::string pre;
  const std::size_t dash = core.find('-');
  if (dash != std::string::npos) {
    pre = core.substr(dash + 1);
    core = core.substr(0, dash);
    if (pre.empty()) return v;
  }

  const std::vector<std::string> fields = splitDots(core);
  if (fields.size() != 3) return v;
  if (!parseNumericField(fields[0], v.major)) return v;
  if (!parseNumericField(fields[1], v.minor)) return v;
  if (!parseNumericField(fields[2], v.patch)) return v;

  if (!pre.empty()) {
    for (const std::string& id : splitDots(pre)) {
      if (!validIdentifierChars(id)) return v;
      // A numeric prerelease identifier must not have a leading zero.
      if (allDigits(id) && id.size() > 1 && id[0] == '0') return v;
      v.prerelease.push_back(id);
    }
  }
  if (!v.build.empty() && !validIdentifierChars(splitDots(v.build).front())) {
    // Only a shape check; build metadata never affects ordering.
    return v;
  }

  v.valid = true;
  return v;
}

int compareVersions(const Version& a, const Version& b) {
  if (!a.valid || !b.valid) {
    if (a.valid == b.valid) return 0;
    return a.valid ? 1 : -1;
  }
  if (a.major != b.major) return a.major < b.major ? -1 : 1;
  if (a.minor != b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch != b.patch) return a.patch < b.patch ? -1 : 1;

  // Clause 11.3: a version WITH a prerelease has lower precedence than the
  // version without one.
  const bool pa = a.isPrerelease();
  const bool pb = b.isPrerelease();
  if (pa != pb) return pa ? -1 : 1;
  if (!pa) return 0;

  const std::size_t n = a.prerelease.size() < b.prerelease.size()
                            ? a.prerelease.size()
                            : b.prerelease.size();
  for (std::size_t i = 0; i < n; ++i) {
    const int c = compareIdentifier(a.prerelease[i], b.prerelease[i]);
    if (c != 0) return c;
  }
  if (a.prerelease.size() == b.prerelease.size()) return 0;
  return a.prerelease.size() < b.prerelease.size() ? -1 : 1;
}

}  // namespace forge::update
