// forge-desktop/test/update_gate.cpp
//
// THE HEADLESS AUTO-UPDATE GATE. It drives the REAL update path end to end — the
// same appcast parser, the same version ordering, the same digest, the same
// ditto staging, the same ad-hoc signature check and the same atomic swap the
// shipped app uses — against real files in a real temp directory, and asserts on
// VALUES.
//
// IT NEVER OPENS A SOCKET. The only networked function in the updater is
// Fetcher::get, and this gate injects a LocalFetcher that copies a file off
// disk. The URL that would have been handed to curl is asserted on directly by
// building curlArgv() and reading it, which is a stronger check than watching a
// download succeed: it proves the flags that make the download safe are present.
//
// PROVING THE GATE CAN FAIL: run with `--mutate <n>`. Each mutation replaces one
// piece of the real logic with the wrong implementation a maintainer could
// plausibly have written, and the corresponding checks go red:
//
//   1  version comparison is LEXICOGRAPHIC on the version string
//        -> "0.10.0" sorts below "0.9.0"; the updater silently stops offering
//           updates the first time a minor reaches double digits. THIS IS THE
//           NEGATIVE CONTROL FOR THE VERSION-COMPARISON LOGIC.
//   2  version comparison ignores the prerelease suffix
//        -> 0.1.0-rc.1 and 0.1.0 compare equal; a shipped release is offered its
//           own release candidate, or told it is already current when it is not.
//   3  the downgrade guard is off (allow_downgrade defaulted true)
//        -> replaying an old manifest rolls the user back onto published bugs.
//   4  payload verification checks the SIZE but not the sha256
//        -> a same-length substituted payload installs. Auto-update becomes a
//           remote code execution channel.
//   5  the payload URL is accepted whenever it is non-empty
//        -> http:// and attacker-controlled hosts pass.
//   6  the staged bundle is "validated" by existence alone
//        -> a truncated archive replaces a working app with a broken one.
//   7  the swap removes the installed app and THEN renames the new one in
//        -> any failure between those two calls leaves the user with no app.
#include <sys/stat.h>
#include <sys/xattr.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "update/Manifest.hpp"
#include "update/Sha256.hpp"
#include "update/Updater.hpp"
#include "update/Version.hpp"

namespace fs = std::filesystem;
using namespace forge::update;

namespace {

int g_checks = 0;
int g_failures = 0;
int g_mutation = 0;

void check(bool ok, const char* what, const std::string& detail) {
  ++g_checks;
  if (!ok) {
    ++g_failures;
    std::printf("  FAIL  %-58s  %s\n", what, detail.c_str());
  }
}

// ───────────────────────────────────────────────────────── mutation shims
// Each shim calls the REAL implementation unless its mutation is selected, in
// which case it calls the plausible-but-wrong one written right here. The
// production sources contain no test hooks.

// MUTATION 1: the classic. `a < b` on the version strings.
int naiveLexicalCompare(const std::string& a, const std::string& b) {
  if (a == b) return 0;
  return a < b ? -1 : 1;
}

// MUTATION 2: compare only major.minor.patch and drop everything after '-'.
int coreOnlyCompare(const std::string& a, const std::string& b) {
  Version va = parseVersion(a.substr(0, a.find('-')));
  Version vb = parseVersion(b.substr(0, b.find('-')));
  return compareVersions(va, vb);
}

int cmp(const std::string& a, const std::string& b) {
  if (g_mutation == 1) return naiveLexicalCompare(a, b);
  if (g_mutation == 2) return coreOnlyCompare(a, b);
  return compareVersions(parseVersion(a), parseVersion(b));
}

Policy policyUnderTest() {
  Policy p;
  // MUTATION 3: someone flips the default to "be helpful about rollbacks".
  if (g_mutation == 3) p.allow_downgrade = true;
  return p;
}

// MUTATION 4: verify the length, skip the digest.
bool verifyUnderTest(const std::string& zip, const Manifest& m, std::string& err) {
  if (g_mutation == 4) {
    std::error_code ec;
    const std::uintmax_t n = fs::file_size(zip, ec);
    if (ec || static_cast<std::uint64_t>(n) != m.size) {
      err = "size mismatch";
      return false;
    }
    return true;
  }
  return verifyPayload(zip, m, err);
}

// MUTATION 5: "it has a URL, ship it".
bool urlOkUnderTest(const std::string& url) {
  if (g_mutation == 5) return !url.empty();
  return isAllowedDownloadUrl(url, defaultAllowedHosts()) && isPayloadUrlPinned(url);
}

// MUTATION 6: the path exists, therefore it is an app.
bool validateUnderTest(const std::string& app, const std::string& want_version, bool want_sig,
                       std::string& err) {
  if (g_mutation == 6) {
    std::error_code ec;
    if (!fs::exists(app, ec)) {
      err = "missing";
      return false;
    }
    return true;
  }
  return validateStagedBundle(app, want_version, want_sig, err);
}

// MUTATION 7: clear the way, then move in.
bool swapUnderTest(const std::string& staged, const std::string& live, std::string& err) {
  if (g_mutation == 7) {
    std::error_code ec;
    fs::remove_all(live, ec);
    if (::rename(staged.c_str(), live.c_str()) != 0) {
      err = "rename failed after the installed app had already been removed";
      return false;
    }
    return true;
  }
  return atomicSwap(staged, live, err);
}

// ─────────────────────────────────────────────────────────────── fixtures
std::string makeTempDir() {
  std::string tmpl = (fs::temp_directory_path() / "forge-update-gate-XXXXXX").string();
  std::vector<char> buf(tmpl.begin(), tmpl.end());
  buf.push_back('\0');
  const char* made = ::mkdtemp(buf.data());
  if (made == nullptr) {
    std::printf("  FATAL mkdtemp failed\n");
    std::exit(2);
  }
  return std::string(made);
}

void writeFile(const std::string& path, const std::string& body) {
  fs::create_directories(fs::path(path).parent_path());
  std::ofstream out(path, std::ios::binary | std::ios::trunc);
  out.write(body.data(), static_cast<std::streamsize>(body.size()));
}

std::string readFile(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return std::string();
  return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

int runQuiet(const std::string& cmd) {
  const std::string full = cmd + " >/dev/null 2>&1";
  return std::system(full.c_str());
}

std::string shq(const std::string& s) { return "'" + s + "'"; }

// Builds a bundle that is structurally a real Forge.app: a real Mach-O main
// executable (a copy of this gate — never run, only signed and inspected), an
// XML Info.plist in the same shape package_macos.sh writes, and a marker file so
// a swap can be proved to have moved the CONTENTS and not just the name.
std::string makeFakeApp(const std::string& dir, const std::string& version, const std::string& marker,
                        const std::string& self_exe) {
  const std::string app = dir + "/Forge.app";
  fs::create_directories(app + "/Contents/MacOS");
  fs::create_directories(app + "/Contents/Resources");
  std::error_code ec;
  fs::copy_file(self_exe, app + "/Contents/MacOS/forge_desktop",
                fs::copy_options::overwrite_existing, ec);
  ::chmod((app + "/Contents/MacOS/forge_desktop").c_str(), 0755);
  writeFile(app + "/Contents/Info.plist",
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
            "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" "
            "\"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n"
            "<plist version=\"1.0\"><dict>\n"
            "  <key>CFBundleName</key><string>Forge</string>\n"
            "  <key>CFBundleExecutable</key><string>forge_desktop</string>\n"
            "  <key>CFBundleShortVersionString</key><string>" + version + "</string>\n"
            "  <key>CFBundleVersion</key><string>" + version + "</string>\n"
            "</dict></plist>\n");
  writeFile(app + "/Contents/Resources/marker.txt", marker);
  return app;
}

bool adhocSign(const std::string& app) {
  return runQuiet("/usr/bin/codesign --force --sign - --timestamp=none " + shq(app)) == 0;
}

bool hasQuarantine(const std::string& path) {
  const ssize_t n = ::getxattr(path.c_str(), "com.apple.quarantine", nullptr, 0, 0, XATTR_NOFOLLOW);
  return n >= 0;
}

// The offline stand-in for CurlFetcher: it copies a local file. Every other step
// of applyUpdate() is the real one.
struct LocalFetcher : Fetcher {
  std::string source;
  int calls = 0;
  bool get(const std::string& url, const std::string& out_path, std::string& err) override {
    (void)url;
    ++calls;
    std::error_code ec;
    fs::copy_file(source, out_path, fs::copy_options::overwrite_existing, ec);
    if (ec) {
      err = "LocalFetcher: " + ec.message();
      return false;
    }
    return true;
  }
};

std::string manifestJson(const std::string& version, const std::string& url, std::uint64_t size,
                         const std::string& sha) {
  return std::string("{\n") +
         "  \"schema\": \"forge-appcast/1\",\n"
         "  \"channel\": \"stable\",\n"
         "  \"version\": \"" + version + "\",\n"
         "  \"arch\": \"arm64\",\n"
         "  \"min_macos\": \"15.0\",\n"
         "  \"url\": \"" + url + "\",\n"
         "  \"size\": " + std::to_string(size) + ",\n"
         "  \"sha256\": \"" + sha + "\",\n"
         "  \"notes_url\": \"https://github.com/satvikOS/Forge/releases/tag/v" + version + "\",\n"
         "  \"pub_date\": \"2026-08-30T12:00:00Z\"\n"
         "}\n";
}

// ═════════════════════════════════════════════════════════════════ the checks

void checkSha256() {
  // FIPS 180-4 / NIST published vectors. The digest is implemented in this tree
  // precisely so this assertion is possible.
  check(sha256Hex(std::string("")) ==
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "sha256(\"\") matches the NIST vector", sha256Hex(std::string("")));
  check(sha256Hex(std::string("abc")) ==
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        "sha256(\"abc\") matches the NIST vector", sha256Hex(std::string("abc")));
  check(sha256Hex(std::string("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")) ==
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
        "sha256(56-byte vector) matches NIST",
        sha256Hex(std::string("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")));
  check(sha256Hex(std::string(1000000, 'a')) ==
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
        "sha256(one million 'a') matches NIST", "");

  // The padding path is where a hand-written SHA-256 goes wrong, and it goes
  // wrong only at the block boundary. 55/56/57 and 63/64/65 straddle both.
  // The reference here is the digest of the SAME bytes fed one at a time
  // through the streaming file path, so the two entry points must agree.
  const std::string dir = makeTempDir();
  bool all_agree = true;
  std::string first_mismatch;
  for (std::size_t n : {0u, 1u, 55u, 56u, 57u, 63u, 64u, 65u, 119u, 128u, 1000u}) {
    const std::string body(n, 'x');
    const std::string path = dir + "/len" + std::to_string(n) + ".bin";
    writeFile(path, body);
    std::string err;
    const std::string from_file = sha256File(path, err);
    const std::string from_mem = sha256Hex(body);
    if (from_file != from_mem) {
      all_agree = false;
      if (first_mismatch.empty()) {
        first_mismatch = "len " + std::to_string(n) + ": file " + from_file + " mem " + from_mem;
      }
    }
  }
  check(all_agree, "the streaming and in-memory digests agree across block boundaries",
        first_mismatch);

  std::string err;
  check(sha256File(dir + "/does-not-exist", err).empty(),
        "a missing file yields an EMPTY digest, never a valid-looking one", err);
  check(!hexDigestEquals("", ""),
        "two empty digests do NOT compare equal", "a failed hash must never match a missing field");
  check(hexDigestEquals("E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
                        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
        "digest comparison is case-insensitive", "");
  check(!hexDigestEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85",
                         "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
        "a short digest never matches", "");
  fs::remove_all(dir);
}

void checkVersionOrdering() {
  // THE NEGATIVE CONTROL. Every row below is decided by cmp(), which mutation 1
  // replaces with a string comparison and mutation 2 with a core-only one.
  struct Row {
    const char* a;
    const char* b;
    int want;
    const char* why;
  };
  const Row rows[] = {
      {"0.10.0", "0.9.0", +1, "0.10.0 is NEWER than 0.9.0 (lexically it is not)"},
      {"0.9.0", "0.10.0", -1, "0.9.0 is older than 0.10.0"},
      {"1.0.0", "0.99.99", +1, "a major bump beats any minor"},
      {"0.2.0", "0.2.0", 0, "equal versions order equal"},
      {"0.2.1", "0.2.0", +1, "patch increases"},
      {"2.0.0", "10.0.0", -1, "major compares numerically, not lexically"},
      {"1.0.10", "1.0.9", +1, "patch compares numerically, not lexically"},
      {"0.1.0", "0.1.0-rc.1", +1, "a release outranks its own release candidate"},
      {"0.1.0-rc.1", "0.1.0", -1, "a release candidate does not outrank its release"},
      {"0.1.0-rc.2", "0.1.0-rc.1", +1, "rc.2 follows rc.1"},
      {"0.1.0-rc.10", "0.1.0-rc.9", +1, "numeric prerelease identifiers compare numerically"},
      {"0.1.0-alpha", "0.1.0-alpha.1", -1, "a longer identifier list wins on a shared prefix"},
      {"0.1.0-alpha.1", "0.1.0-beta", -1, "alphanumeric identifiers compare lexically"},
      {"0.1.0-1", "0.1.0-alpha", -1, "a numeric identifier ranks below an alphanumeric one"},
      {"0.1.0", "v0.1.0", 0, "a leading 'v' is a tag convention, not a different version"},
      {"0.1.0+abc", "0.1.0+zzz", 0, "build metadata is ignored for ordering"},
      {"0.1.0", "0.0.0-dev+7ab19c3", +1, "any release beats the dev stamp CI produces"},
  };
  for (const Row& r : rows) {
    const int got = cmp(r.a, r.b);
    check(got == r.want, r.why,
          std::string(r.a) + " vs " + r.b + ": want " + std::to_string(r.want) + ", got " +
              std::to_string(got));
  }

  check(!parseVersion("not-a-version").valid, "garbage does not parse as a version", "");
  check(!parseVersion("1.2").valid, "a two-field version does not parse", "");
  check(!parseVersion("01.2.3").valid, "a leading zero does not parse", "");
  check(!parseVersion("1.2.3.4").valid, "a four-field version does not parse", "");
  check(parseVersion("  0.1.0\n").valid, "surrounding whitespace is tolerated", "");
  check(parseVersion("0.0.0-dev+7ab19c3").valid, "the CI dev stamp parses", "");
  check(compareVersions(parseVersion("garbage"), parseVersion("0.1.0")) < 0,
        "an unparseable running version orders BELOW a real one",
        "fail toward offering the update, not toward never updating");
}

void checkManifestParsing() {
  std::string err;
  const std::string good = manifestJson(
      "0.1.1",
      "https://github.com/satvikOS/Forge/releases/download/v0.1.1/Forge-macos-arm64-0.1.1.zip",
      41234567, std::string(64, 'a'));
  const Manifest m = parseManifest(good, err);
  check(m.valid, "a well-formed appcast parses", err);
  check(m.version == "0.1.1", "version is read", m.version);
  check(m.size == 41234567ull, "size is read as a number", std::to_string(m.size));
  check(m.sha256 == std::string(64, 'a'), "sha256 is read", m.sha256);
  check(m.arch == "arm64", "arch is read", m.arch);
  check(validateManifest(m, err), "a well-formed appcast validates", err);

  struct Bad {
    const char* json;
    const char* why;
  };
  const Bad bads[] = {
      {"{\"schema\":\"forge-appcast/1\",\"nested\":{\"a\":1}}",
       "a NESTED value is refused (the parser stays flat)"},
      {"{\"schema\":\"forge-appcast/1\",\"list\":[1,2]}", "an ARRAY value is refused"},
      {"{\"schema\":\"forge-appcast/1\",\"version\":\"1\",\"version\":\"2\"}",
       "a DUPLICATE key is refused rather than resolved"},
      {"{\"schema\":\"forge-appcast/1\"} trailing", "trailing bytes after the object are refused"},
      {"{}", "an empty object is refused"},
      {"{\"schema\":\"forge-appcast/1\",\"size\":\"lots\"}", "a non-numeric size is refused"},
      {"not json at all", "non-JSON is refused"},
  };
  for (const Bad& b : bads) {
    std::string e;
    const Manifest bm = parseManifest(b.json, e);
    check(!bm.valid, b.why, e.empty() ? std::string("it PARSED, and should not have") : e);
  }

  std::string big(kMaxManifestBytes + 1, ' ');
  std::string e2;
  check(!parseManifest(big, e2).valid, "an oversized appcast is refused before parsing", e2);

  // validateManifest rejects what parses but is not installable.
  const struct {
    std::string json;
    const char* why;
  } invalids[] = {
      {manifestJson("0.1.1", "https://github.com/x/y/releases/download/v0.1.1/a.zip", 10,
                    "short"),
       "a sha256 that is not 64 hex characters is refused"},
      {manifestJson("0.1.1", "https://github.com/x/y/releases/download/v0.1.1/a.zip", 0,
                    std::string(64, 'a')),
       "a zero size is refused"},
  };
  for (const auto& iv : invalids) {
    std::string e;
    const Manifest im = parseManifest(iv.json, e);
    std::string ve;
    check(!validateManifest(im, ve), iv.why, ve.empty() ? "it VALIDATED" : ve);
  }
  std::string se;
  const Manifest wrong_schema =
      parseManifest("{\"schema\":\"sparkle/2\",\"version\":\"9.9.9\"}", se);
  std::string sv;
  check(!validateManifest(wrong_schema, sv), "an unknown schema is refused, not best-guessed", sv);
}

void checkUrlAdmissibility() {
  struct Row {
    const char* url;
    bool want;
    const char* why;
  };
  const Row rows[] = {
      {"https://github.com/satvikOS/Forge/releases/download/v0.1.1/Forge-macos-arm64-0.1.1.zip",
       true, "the pinned github.com release asset is admissible"},
      {"https://objects.githubusercontent.com/releases/download/v0.1.1/x.zip", true,
       "the CDN host GitHub redirects to is admissible"},
      {"http://github.com/x/y/releases/download/v1/a.zip", false, "plain http is refused"},
      {"https://github.com.evil.tld/x/y/releases/download/v1/a.zip", false,
       "a host that merely CONTAINS github.com is refused (suffix, not substring)"},
      {"https://evil.tld/x/y/releases/download/v1/a.zip", false, "an unknown host is refused"},
      {"https://github.com@evil.tld/releases/download/v1/a.zip", false,
       "a userinfo@ URL that reads like github.com is refused"},
      {"file:///tmp/a.zip", false, "a file:// URL is refused"},
      {"ftp://github.com/a.zip", false, "a non-https scheme is refused"},
      {"", false, "an empty URL is refused"},
  };
  for (const Row& r : rows) {
    const bool got = urlOkUnderTest(r.url);
    check(got == r.want, r.why, std::string(r.url) + " -> " + (got ? "accepted" : "refused"));
  }
  check(!isPayloadUrlPinned(
            "https://github.com/satvikOS/Forge/releases/latest/download/Forge-macos-arm64.zip"),
        "a FLOATING latest/download payload URL is refused",
        "the manifest's digest describes one build, so the payload must name one build");
  check(isAllowedDownloadUrl(kDefaultAppcastUrl, defaultAllowedHosts()),
        "the appcast URL the app ships with is itself admissible", kDefaultAppcastUrl);
}

void checkCurlArgv() {
  const std::vector<std::string> argv =
      curlArgv("https://github.com/a/b/releases/download/v1/x.zip", "/tmp/out.zip", 1234, 600);
  auto has = [&](const std::string& s) {
    for (const std::string& a : argv) {
      if (a == s) return true;
    }
    return false;
  };
  auto pairAt = [&](const std::string& flag, const std::string& value) {
    for (std::size_t i = 0; i + 1 < argv.size(); ++i) {
      if (argv[i] == flag && argv[i + 1] == value) return true;
    }
    return false;
  };
  check(argv.front() == "/usr/bin/curl", "curl is invoked by ABSOLUTE path, not through PATH",
        argv.front());
  check(pairAt("--proto", "=https"), "the first request is pinned to https", "");
  check(pairAt("--proto-redir", "=https"), "no redirect may leave https", "");
  check(has("--fail"), "an HTTP error status is a failure, not a downloaded error page", "");
  check(pairAt("--max-filesize", "1234"), "the transfer is size-capped from the manifest", "");
  check(pairAt("--max-time", "600"), "the transfer is time-capped", "");
  check(has("--connect-timeout"), "the connect is time-capped, so a black-holed host cannot hang the app", "");
  check(has("--"), "the URL is passed after -- so a URL starting with '-' cannot become a flag", "");
  check(argv.back() == "https://github.com/a/b/releases/download/v1/x.zip",
        "the URL is the LAST argument", argv.back());
  // A shell would make every one of the above pointless.
  bool shelly = false;
  for (const std::string& a : argv) {
    if (a.find("sh -c") != std::string::npos || a == "/bin/sh") shelly = true;
  }
  check(!shelly, "no shell appears anywhere in the download argv", "");

  const std::vector<std::string> relaunch = relaunchArgv("/Applications/Forge.app");
  check(relaunch.size() == 3 && relaunch[0] == "/usr/bin/open" && relaunch[1] == "-n" &&
            relaunch[2] == "/Applications/Forge.app",
        "relaunch uses `open -n <app>` so the NEW bundle starts",
        relaunch.empty() ? "" : relaunch[0]);
}

void checkDecide() {
  const std::string pinned =
      "https://github.com/satvikOS/Forge/releases/download/v0.10.0/Forge-macos-arm64-0.10.0.zip";
  std::string err;

  auto planFor = [&](const std::string& running, const std::string& offered,
                     const std::string& url) {
    const Manifest m = parseManifest(manifestJson(offered, url, 1000, std::string(64, 'b')), err);
    // Route the version decision through cmp() so mutations 1 and 2 reach it.
    Plan p = decide(running, m, policyUnderTest());
    if (g_mutation == 1 || g_mutation == 2) {
      const int order = cmp(offered, running);
      if (p.decision != Decision::Rejected) {
        p.decision = order > 0 ? Decision::UpdateAvailable : Decision::UpToDate;
      }
    }
    return p;
  };

  check(planFor("0.9.0", "0.10.0", pinned).decision == Decision::UpdateAvailable,
        "0.9.0 IS offered 0.10.0",
        planFor("0.9.0", "0.10.0", pinned).reason);
  check(planFor("0.10.0", "0.10.0", pinned).decision == Decision::UpToDate,
        "0.10.0 is told it is current", planFor("0.10.0", "0.10.0", pinned).reason);

  const std::string old_url =
      "https://github.com/satvikOS/Forge/releases/download/v0.1.0/Forge-macos-arm64-0.1.0.zip";
  const Plan down = planFor("0.10.0", "0.1.0", old_url);
  check(down.decision == Decision::Rejected,
        "a manifest offering an OLDER version is refused by default",
        "downgrade guard: " + down.reason);

  const std::string rc_url =
      "https://github.com/satvikOS/Forge/releases/download/v0.11.0-rc.1/Forge-macos-arm64-0.11.0-rc.1.zip";
  const Plan rc = planFor("0.10.0", "0.11.0-rc.1", rc_url);
  check(rc.decision == Decision::Rejected, "a stable build is not walked onto a release candidate",
        rc.reason);

  Policy pre = policyUnderTest();
  pre.allow_prerelease = true;
  const Manifest rcm = parseManifest(manifestJson("0.11.0-rc.1", rc_url, 1000, std::string(64, 'b')), err);
  check(decide("0.10.0", rcm, pre).decision == Decision::UpdateAvailable,
        "opting in to prereleases DOES offer the release candidate",
        decide("0.10.0", rcm, pre).reason);

  // The pre-download refusals.
  const Manifest bad_host =
      parseManifest(manifestJson("0.10.0", "https://evil.tld/releases/download/v1/x.zip", 1000,
                                 std::string(64, 'b')),
                    err);
  check(decide("0.9.0", bad_host, policyUnderTest()).decision == Decision::Rejected,
        "an off-host payload URL is refused BEFORE anything is fetched",
        decide("0.9.0", bad_host, policyUnderTest()).reason);

  const Manifest floating = parseManifest(
      manifestJson("0.10.0", "https://github.com/satvikOS/Forge/releases/latest/download/x.zip",
                   1000, std::string(64, 'b')),
      err);
  check(decide("0.9.0", floating, policyUnderTest()).decision == Decision::Rejected,
        "a floating payload URL is refused before anything is fetched",
        decide("0.9.0", floating, policyUnderTest()).reason);

  Manifest huge = parseManifest(manifestJson("0.10.0", pinned, 1000, std::string(64, 'b')), err);
  huge.size = 900ull * 1024ull * 1024ull;
  check(decide("0.9.0", huge, policyUnderTest()).decision == Decision::Rejected,
        "an oversized declared payload is refused before anything is fetched",
        decide("0.9.0", huge, policyUnderTest()).reason);

  Manifest wrong_arch = parseManifest(manifestJson("0.10.0", pinned, 1000, std::string(64, 'b')), err);
  wrong_arch.arch = "x86_64";
  check(decide("0.9.0", wrong_arch, policyUnderTest()).decision == Decision::Rejected,
        "a manifest for another architecture is refused",
        decide("0.9.0", wrong_arch, policyUnderTest()).reason);

  check(Policy().allow_downgrade == false,
        "the SHIPPING default refuses downgrades",
        "an attacker replaying an old manifest must not roll the user back");
  check(Policy().allow_prerelease == false, "the SHIPPING default follows releases only", "");
}

void checkPayloadVerification(const std::string& dir) {
  const std::string body = "PK\x03\x04 pretend this is a Forge release zip";
  const std::string zip = dir + "/payload.zip";
  writeFile(zip, body);
  const std::string real_sha = sha256Hex(body);

  std::string err;
  Manifest m = parseManifest(
      manifestJson("0.1.1", "https://github.com/a/b/releases/download/v0.1.1/x.zip", body.size(),
                   real_sha),
      err);
  check(verifyUnderTest(zip, m, err), "a payload matching the manifest verifies", err);

  // THE ATTACK: same length, different bytes. Only the digest catches it.
  std::string tampered = body;
  tampered[10] = static_cast<char>(tampered[10] ^ 0x20);
  const std::string tampered_zip = dir + "/tampered.zip";
  writeFile(tampered_zip, tampered);
  check(tampered.size() == body.size(), "the tampered payload is the SAME LENGTH", "");
  const bool refused = !verifyUnderTest(tampered_zip, m, err);
  check(refused, "a SAME-LENGTH tampered payload is REFUSED",
        refused ? "" : "it was accepted: auto-update is a remote code execution channel");

  const std::string truncated_zip = dir + "/truncated.zip";
  writeFile(truncated_zip, body.substr(0, body.size() - 3));
  check(!verifyUnderTest(truncated_zip, m, err), "a truncated payload is refused", err);

  check(!verifyUnderTest(dir + "/not-there.zip", m, err), "a missing payload is refused", err);
}

void checkStagingAndSwap(const std::string& dir, const std::string& self_exe) {
  // ── the staged bundle ────────────────────────────────────────────────────
  const std::string src = dir + "/src";
  fs::create_directories(src);
  const std::string app = makeFakeApp(src, "0.1.1", "NEW", self_exe);
  const bool signed_ok = adhocSign(app);
  check(signed_ok, "the fixture bundle can be AD-HOC signed (the shipping signature kind)",
        signed_ok ? "" : "codesign --sign - failed; the signature checks below cannot run");

  const std::string zip = dir + "/Forge-0.1.1.zip";
  const int rc = runQuiet("/usr/bin/ditto -c -k --sequesterRsrc --keepParent " + shq(app) + " " + shq(zip));
  check(rc == 0, "the fixture bundle zips with ditto", "ditto exit " + std::to_string(rc));

  // Put a quarantine attribute on the ARCHIVE, which is exactly what a browser
  // download would do, and prove the staged bundle comes out without one.
  runQuiet("/usr/bin/xattr -w com.apple.quarantine '0083;00000000;Safari;' " + shq(zip));
  check(hasQuarantine(zip), "the fixture archive really is quarantined before staging",
        "if this fails the check below proves nothing");

  const std::string staging = dir + "/staging";
  fs::create_directories(staging);
  std::string staged_app;
  std::string err;
  check(stageBundle(zip, staging, staged_app, err), "the payload stages with ditto", err);
  check(!staged_app.empty() && fs::is_directory(staged_app), "staging yields an .app", staged_app);
  check(!hasQuarantine(staged_app),
        "the STAGED bundle carries NO com.apple.quarantine",
        "this is the property that makes the Gatekeeper prompt one-time");
  check(bundleShortVersion(staged_app) == "0.1.1", "the staged bundle's version is readable",
        bundleShortVersion(staged_app));

  check(validateUnderTest(staged_app, "0.1.1", false, err), "the staged bundle validates", err);
  // Shell tab-completion on a directory appends '/', so this is the form a
  // person actually types. Without normalisation, path::extension() is empty and
  // a perfectly good bundle is refused as "not an .app bundle".
  check(validateUnderTest(staged_app + "/", "0.1.1", false, err),
        "a bundle path with a TRAILING SLASH validates (what tab-completion types)", err);
  check(enclosingAppBundle("/Applications/Forge.app/Contents/MacOS/forge_desktop/") ==
            "/Applications/Forge.app",
        "a trailing slash on the executable path is tolerated too",
        enclosingAppBundle("/Applications/Forge.app/Contents/MacOS/forge_desktop/"));
  check(!validateUnderTest(staged_app, "9.9.9", false, err),
        "a bundle whose version disagrees with the manifest is REFUSED", err);
  if (signed_ok) {
    check(validateUnderTest(staged_app, "0.1.1", true, err),
          "the ad-hoc signature satisfies codesign --verify --deep --strict", err);
  }

  // A bundle with no executable in it: what a truncated or doctored archive
  // produces. Nothing may install it.
  const std::string broken_dir = dir + "/broken";
  fs::create_directories(broken_dir + "/Forge.app/Contents/MacOS");
  writeFile(broken_dir + "/Forge.app/Contents/Info.plist",
            "<plist><dict><key>CFBundleShortVersionString</key><string>0.1.1</string>"
            "</dict></plist>");
  check(!validateUnderTest(broken_dir + "/Forge.app", "0.1.1", false, err),
        "a bundle with NO executable is refused", err);
  const std::string unsigned_dir = dir + "/unsigned";
  fs::create_directories(unsigned_dir);
  const std::string unsigned_app = makeFakeApp(unsigned_dir, "0.1.1", "NEW", self_exe);
  check(!validateUnderTest(unsigned_app, "0.1.1", true, err),
        "an UNSIGNED bundle is refused when a valid signature is required", err);

  // ── the swap ─────────────────────────────────────────────────────────────
  const std::string live_dir = dir + "/installed";
  const std::string new_dir = dir + "/incoming";
  fs::create_directories(live_dir);
  fs::create_directories(new_dir);
  const std::string live = makeFakeApp(live_dir, "0.1.0", "OLD", self_exe);
  const std::string incoming = makeFakeApp(new_dir, "0.1.1", "NEW", self_exe);

  std::string swap_err;
  const bool swapped = swapUnderTest(incoming, live, swap_err);
  check(swapped, "the swap succeeds", swap_err);
  check(readFile(live + "/Contents/Resources/marker.txt") == "NEW",
        "after the swap the INSTALLED path holds the new bundle's contents",
        readFile(live + "/Contents/Resources/marker.txt"));
  check(bundleShortVersion(live) == "0.1.1", "the installed bundle now reports the new version",
        bundleShortVersion(live));
  check(readFile(incoming + "/Contents/Resources/marker.txt") == "OLD",
        "the displaced bundle is still there, so a rollback is possible",
        readFile(incoming + "/Contents/Resources/marker.txt"));

  // THE PROPERTY THAT MATTERS: a swap that FAILS must not destroy the installed
  // application. Mutation 7 removes the live bundle before renaming, so this is
  // where it goes red.
  const std::string live2_dir = dir + "/installed2";
  fs::create_directories(live2_dir);
  const std::string live2 = makeFakeApp(live2_dir, "0.1.0", "KEEPME", self_exe);
  std::string fail_err;
  const bool bad = swapUnderTest(live2_dir + "/nonexistent-staged.app", live2, fail_err);
  check(!bad, "a swap from a missing staged bundle reports failure", fail_err);
  check(fs::is_directory(live2) && readFile(live2 + "/Contents/Resources/marker.txt") == "KEEPME",
        "a FAILED swap leaves the installed app intact",
        fs::is_directory(live2) ? readFile(live2 + "/Contents/Resources/marker.txt")
                                : "the installed app was DESTROYED");

  // enclosingAppBundle
  check(enclosingAppBundle("/Applications/Forge.app/Contents/MacOS/forge_desktop") ==
            "/Applications/Forge.app",
        "the running executable resolves to its enclosing bundle",
        enclosingAppBundle("/Applications/Forge.app/Contents/MacOS/forge_desktop"));
  check(enclosingAppBundle("/Users/x/forge-desktop/build/forge_desktop").empty(),
        "a developer build is NOT inside a bundle and cannot self-update", "");
}

void checkEndToEnd(const std::string& dir, const std::string& self_exe) {
  // The whole path, offline: manifest -> decide -> fetch (local copy) -> verify
  // -> stage -> validate (signature required) -> atomic swap.
  const std::string src = dir + "/e2e-src";
  fs::create_directories(src);
  const std::string app = makeFakeApp(src, "0.2.0", "NEWAPP", self_exe);
  if (!adhocSign(app)) {
    check(false, "e2e: the fixture bundle can be ad-hoc signed", "codesign failed");
    return;
  }
  const std::string zip = dir + "/e2e.zip";
  runQuiet("/usr/bin/ditto -c -k --sequesterRsrc --keepParent " + shq(app) + " " + shq(zip));

  std::string herr;
  const std::string sha = sha256File(zip, herr);
  const std::uint64_t size = static_cast<std::uint64_t>(fs::file_size(zip));
  const std::string url =
      "https://github.com/satvikOS/Forge/releases/download/v0.2.0/Forge-macos-arm64-0.2.0.zip";

  std::string perr;
  const Manifest m = parseManifest(manifestJson("0.2.0", url, size, sha), perr);
  check(m.valid, "e2e: the generated appcast parses", perr);

  const std::string install_dir = dir + "/e2e-installed";
  fs::create_directories(install_dir);
  const std::string live = makeFakeApp(install_dir, "0.1.0", "OLDAPP", self_exe);

  const Plan plan = decide("0.1.0", m, policyUnderTest());
  check(plan.decision == Decision::UpdateAvailable, "e2e: 0.1.0 is offered 0.2.0", plan.reason);

  LocalFetcher fetcher;
  fetcher.source = zip;
  const ApplyResult r = applyUpdate(plan, m, live, fetcher, policyUnderTest());
  check(r.ok, "e2e: the update applies", r.reason);
  check(fetcher.calls == 1, "e2e: exactly one fetch happened",
        std::to_string(fetcher.calls) + " calls");
  check(bundleShortVersion(live) == "0.2.0", "e2e: the installed bundle is now 0.2.0",
        bundleShortVersion(live));
  check(readFile(live + "/Contents/Resources/marker.txt") == "NEWAPP",
        "e2e: the installed CONTENTS are the new build's",
        readFile(live + "/Contents/Resources/marker.txt"));
  check(!hasQuarantine(live), "e2e: the installed bundle is NOT quarantined", "");
  std::string ve;
  check(validateStagedBundle(live, "0.2.0", true, ve),
        "e2e: the installed bundle still passes codesign --verify --deep --strict", ve);

  // A tampered payload must leave the installed app exactly as it was.
  const std::string install2 = dir + "/e2e-installed2";
  fs::create_directories(install2);
  const std::string live2 = makeFakeApp(install2, "0.1.0", "UNTOUCHED", self_exe);
  std::string bad_zip_body = readFile(zip);
  bad_zip_body[bad_zip_body.size() / 2] =
      static_cast<char>(bad_zip_body[bad_zip_body.size() / 2] ^ 0x40);
  const std::string bad_zip = dir + "/e2e-bad.zip";
  writeFile(bad_zip, bad_zip_body);
  LocalFetcher bad_fetcher;
  bad_fetcher.source = bad_zip;
  const ApplyResult br = applyUpdate(plan, m, live2, bad_fetcher, policyUnderTest());
  check(!br.ok, "e2e: a tampered payload does NOT install", br.reason);
  check(readFile(live2 + "/Contents/Resources/marker.txt") == "UNTOUCHED",
        "e2e: after a refused update the installed app is UNTOUCHED",
        readFile(live2 + "/Contents/Resources/marker.txt"));
  check(bundleShortVersion(live2) == "0.1.0", "e2e: and still reports its old version",
        bundleShortVersion(live2));

  // No staging litter is left behind next to the installed app.
  int leftovers = 0;
  for (const fs::directory_entry& e : fs::directory_iterator(install2)) {
    if (e.path().filename().string().rfind(".forge-update-", 0) == 0) ++leftovers;
  }
  check(leftovers == 0, "e2e: a failed update leaves no staging directory behind",
        std::to_string(leftovers) + " left");
}

}  // namespace

int main(int argc, char** argv) {
  std::string self_exe = argv[0];
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) {
      g_mutation = std::atoi(argv[++i]);
    }
  }
  // argv[0] may be relative; the fixture copies it, so make it absolute.
  {
    std::error_code ec;
    const fs::path abs = fs::absolute(self_exe, ec);
    if (!ec) self_exe = abs.string();
  }
  if (!fs::exists(self_exe)) {
    std::printf("FATAL: cannot locate this executable (%s) to use as a bundle fixture\n",
                self_exe.c_str());
    return 2;
  }

  std::printf("forge-desktop auto-update gate%s\n",
              g_mutation != 0 ? ("  [MUTATION " + std::to_string(g_mutation) + " ACTIVE]").c_str()
                              : "");

  const std::string dir = makeTempDir();
  checkSha256();
  checkVersionOrdering();
  checkManifestParsing();
  checkUrlAdmissibility();
  checkCurlArgv();
  checkDecide();
  checkPayloadVerification(dir);
  checkStagingAndSwap(dir, self_exe);
  checkEndToEnd(dir, self_exe);
  std::error_code ec;
  fs::remove_all(dir, ec);

  std::printf("%d checks, %d failures\n", g_checks, g_failures);
  if (g_mutation != 0 && g_failures == 0) {
    std::printf("MUTATION %d PRODUCED NO FAILURE - the check it targets is unfalsifiable.\n",
                g_mutation);
  } else if (g_mutation != 0) {
    std::printf("mutation %d correctly caught by %d check(s)\n", g_mutation, g_failures);
  }
  // The SAME exit convention as frame_gate, document_gate and ir_pipeline_gate:
  // non-zero means checks failed, full stop. A mutated run is therefore EXPECTED
  // to exit non-zero, and a mutated run that exits ZERO is the real defect -- the
  // mutation was not caught. test/run_desktop.sh's run_gate() reads exactly this,
  // and the ctest entries carry WILL_FAIL so the inversion is declared in one
  // place instead of being a second, contradictory convention living in here.
  return g_failures == 0 ? 0 : 1;
}
