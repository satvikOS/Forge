// forge-desktop/test/guardian_status_test.cpp
//
// DOES FORGE EVER SHOW A MACHINE AS HEALTHY WHEN GUARDIAN DID NOT SAY SO?
//
// The status strip reads Forge Guardian's state.json (tools/guardian/SCHEMA.md
// §4.1). Every way that file can be untrustworthy -- absent, malformed, stale,
// future-dated, an unknown word, a v1 producer that reports no evidence, a v2
// producer that says its evidence is incomplete -- must render as NOT healthy and
// must never claim heavy work is admitted. Only a fresh v2 GREEN with
// evidence_complete=true is Healthy.
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <unistd.h>

#include "GuardianStatus.hpp"

using namespace forge::desktop;

namespace {

// ── the check harness ───────────────────────────────────────────────────────
// ui/test/ui_test_util.hpp's contract, local to this file (the convention
// forge-desktop/test/parameters_gate.cpp states): the desktop syntax gate
// type-checks this file with forge-desktop's include path, without ui/test.
struct Harness {
  const char* name;
  std::size_t checks = 0;
  std::size_t failures = 0;
  explicit Harness(const char* n) : name(n) {}
  int finish() const {
    std::printf("[%s] %zu checks, %zu failures — %s\n", name, checks, failures,
                failures == 0 ? "PASS" : "FAIL");
    return failures == 0 ? 0 : 1;
  }
};
void checkTrue(Harness& h, bool v, const char* expr, const char* file, int line) {
  ++h.checks;
  if (v) return;
  ++h.failures;
  std::printf("  FAIL %s:%d  expected true: %s\n", file, line, expr);
}
void checkEqInt(Harness& h, long long got, long long want, const char* expr, const char* file, int line) {
  ++h.checks;
  if (got == want) return;
  ++h.failures;
  std::printf("  FAIL %s:%d  %s\n        got %lld, want %lld\n", file, line, expr, got, want);
}
void checkLeInt(Harness& h, long long got, long long bound, const char* expr, const char* file, int line) {
  ++h.checks;
  if (got <= bound) return;
  ++h.failures;
  std::printf("  FAIL %s:%d  %s\n        got %lld, want <= %lld\n", file, line, expr, got, bound);
}
void checkEqStr(Harness& h, const std::string& got, const std::string& want, const char* expr,
                const char* file, int line) {
  ++h.checks;
  if (got == want) return;
  ++h.failures;
  std::printf("  FAIL %s:%d  %s\n        got \"%s\", want \"%s\"\n", file, line, expr, got.c_str(), want.c_str());
}
#define CHECK(e) checkTrue(H, (e), #e, __FILE__, __LINE__)
#define CHECK_EQ_INT(g, w) checkEqInt(H, (g), (w), #g " == " #w, __FILE__, __LINE__)
#define CHECK_LE_INT(g, b) checkLeInt(H, (g), (b), #g " <= " #b, __FILE__, __LINE__)
#define CHECK_EQ_STR(g, w) checkEqStr(H, (g), (w), #g " == " #w, __FILE__, __LINE__)

constexpr long long kNow = 1791450000;

std::string v2(const std::string& state, long long epoch, bool evidence, bool heavy,
               const std::string& missing = "", bool overcommit = false) {
  return std::string("{\"schema\":\"forge.guardian.state/2\",\"state\":\"") + state +
         "\",\"reason\":\"nominal\",\"epoch\":" + std::to_string(epoch) +
         ",\"heavy_jobs_ok\":" + (heavy ? "true" : "false") +
         ",\"evidence_complete\":" + (evidence ? "true" : "false") +
         ",\"evidence\":{\"source\":\"sensor\",\"sensor_age_s\":1,\"missing\":[" + missing + "]}" +
         ",\"thermal_state\":\"nominal\"" +
         ",\"reservations\":{\"reserved_gb\":31.0,\"budget_gb\":30.0,\"overcommit\":" +
         (overcommit ? "true" : "false") + ",\"jobs\":1}" +
         ",\"observables\":{\"registered_jobs\":1}}";
}

}  // namespace

int main() {
  Harness H("guardian_status");

  // ── the only Healthy: fresh v2 GREEN with complete evidence ───────────────
  {
    GuardianStatus s = parseGuardianStatus(v2("GREEN", kNow - 3, true, true), kNow);
    CHECK(s.level == GuardianLevel::Healthy);
    CHECK(s.heavyJobsOk);
    CHECK_EQ_INT(s.ageSeconds, 3);
    CHECK_EQ_STR(guardianStripText(s), "Guardian GREEN");
    CHECK_EQ_STR(s.thermal, "nominal");
  }
  // ── v2 GREEN whose evidence is incomplete is NOT healthy ──────────────────
  {
    GuardianStatus s = parseGuardianStatus(v2("GREEN", kNow, false, true, "\"thermal\""), kNow);
    CHECK(s.level == GuardianLevel::NoEvidence);
    CHECK(!s.heavyJobsOk);   // even though the (inconsistent) producer said true
    CHECK(guardianStripText(s).find("thermal") != std::string::npos);
  }
  // ── UNKNOWN is the governor saying it has no evidence ────────────────────
  {
    GuardianStatus s = parseGuardianStatus(v2("UNKNOWN", kNow, false, false, "\"sensor\""), kNow);
    CHECK(s.level == GuardianLevel::NoEvidence);
    CHECK(!s.heavyJobsOk);
  }
  // ── the pressure states keep their meaning, evidence or not ──────────────
  CHECK(parseGuardianStatus(v2("YELLOW", kNow, true, false), kNow).level == GuardianLevel::Caution);
  CHECK(parseGuardianStatus(v2("ORANGE", kNow, true, false), kNow).level == GuardianLevel::Pressure);
  CHECK(parseGuardianStatus(v2("RED", kNow, true, false), kNow).level == GuardianLevel::Critical);
  CHECK(parseGuardianStatus(v2("RED", kNow, false, false, "\"thermal\""), kNow).level ==
        GuardianLevel::Critical);   // missing evidence never hides real pressure
  CHECK(parseGuardianStatus(v2("YELLOW", kNow, false, false), kNow).level == GuardianLevel::NoEvidence);

  // ── freshness: the same bounds as forge-gate ─────────────────────────────
  CHECK(parseGuardianStatus(v2("GREEN", kNow - 60, true, true), kNow).level == GuardianLevel::Healthy);
  {
    GuardianStatus s = parseGuardianStatus(v2("GREEN", kNow - 61, true, true), kNow);
    CHECK(s.level == GuardianLevel::Unavailable);
    CHECK(!s.heavyJobsOk);
    CHECK(guardianStripText(s).find("stale") != std::string::npos);
  }
  CHECK(parseGuardianStatus(v2("GREEN", kNow + 5, true, true), kNow).level == GuardianLevel::Healthy);
  {
    GuardianStatus s = parseGuardianStatus(v2("GREEN", kNow + 6, true, true), kNow);
    CHECK(s.level == GuardianLevel::Unavailable);
    CHECK(s.reason.find("clock skew") != std::string::npos);
  }

  // ── malformed, partial and foreign inputs ────────────────────────────────
  CHECK(parseGuardianStatus("", kNow).level == GuardianLevel::Unavailable);
  CHECK(parseGuardianStatus("{\"state\":\"GREEN\"", kNow).level == GuardianLevel::Unavailable);
  CHECK(parseGuardianStatus("[1,2,3]", kNow).level == GuardianLevel::Unavailable);
  CHECK(parseGuardianStatus("{\"state\":\"GREEN\",\"heavy_jobs_ok\":true}", kNow).level ==
        GuardianLevel::Unavailable);   // no epoch: freshness unknown
  CHECK(parseGuardianStatus("{\"state\":\"GREEN\",\"epoch\":\"1791450000\"}", kNow).level ==
        GuardianLevel::Unavailable);   // a string epoch is not a number
  CHECK(parseGuardianStatus(v2("PURPLE", kNow, true, true), kNow).level == GuardianLevel::Unavailable);
  CHECK(parseGuardianStatus(std::string(kGuardianMaxStateBytes + 1, ' '), kNow).level ==
        GuardianLevel::Unavailable);
  {
    // heavy_jobs_ok must be a JSON boolean true; the string "true" is not.
    std::string t = v2("GREEN", kNow, true, false);
    const std::string from = "\"heavy_jobs_ok\":false";
    t.replace(t.find(from), from.size(), "\"heavy_jobs_ok\":\"true\"");
    CHECK(!parseGuardianStatus(t, kNow).heavyJobsOk);
  }

  // ── a v1 producer reports no evidence: its GREEN is unverified ───────────
  {
    const std::string v1 = "{\"state\":\"GREEN\",\"reason\":\"nominal\",\"epoch\":" + std::to_string(kNow) +
                           ",\"heavy_jobs_ok\":true,\"observables\":{\"registered_jobs\":1}}";
    GuardianStatus s = parseGuardianStatus(v1, kNow);
    CHECK(s.level == GuardianLevel::NoEvidence);
    CHECK(!s.heavyJobsOk);
    CHECK(!s.schemaV2);
    CHECK(guardianStripText(s).find("v1") != std::string::npos);
  }

  // ── reservations and the tooltip ─────────────────────────────────────────
  {
    GuardianStatus s = parseGuardianStatus(v2("GREEN", kNow, true, true, "", true), kNow);
    bool sawOver = false;
    for (const std::string& l : guardianDetail(s)) sawOver = sawOver || l.find("OVERCOMMITTED") != std::string::npos;
    CHECK(sawOver);
    CHECK(s.overcommit);
    CHECK(s.reservedGb > 30.9 && s.reservedGb < 31.1);
  }

  // ── the strip label is bounded ───────────────────────────────────────────
  {
    GuardianStatus s;
    s.level = GuardianLevel::Unavailable;
    s.reason = std::string(500, 'x');
    CHECK_LE_INT(static_cast<long long>(guardianStripText(s, 40).size()), 40);
  }

  // ── the file reader: absent, present, path resolution ────────────────────
  {
    GuardianStatus s = readGuardianStatus("/nonexistent/forge-health/state.json", kNow);
    CHECK(s.level == GuardianLevel::Unavailable);
    CHECK(s.reason.find("not running") != std::string::npos);
    CHECK(readGuardianStatus("", kNow).level == GuardianLevel::Unavailable);

    char dir[] = "/tmp/guardian_status_test.XXXXXX";
    if (mkdtemp(dir) != nullptr) {
      const std::string p = std::string(dir) + "/state.json";
      if (FILE* f = std::fopen(p.c_str(), "wb")) {
        const std::string body = v2("GREEN", kNow - 1, true, true);
        std::fwrite(body.data(), 1, body.size(), f);
        std::fclose(f);
      }
      CHECK(readGuardianStatus(p, kNow).level == GuardianLevel::Healthy);
      setenv("FORGE_HEALTH_DIR", dir, 1);
      CHECK_EQ_STR(defaultGuardianStatePath(), p);
      unsetenv("FORGE_HEALTH_DIR");
      std::remove(p.c_str());
      rmdir(dir);
    } else {
      CHECK(false);   // the harness could not make its fixture dir: fail, never skip
    }
  }

  return H.finish();
}
