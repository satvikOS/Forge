// forge-desktop/src/GuardianStatus.cpp — see GuardianStatus.hpp for the rule this keeps.
#include "GuardianStatus.hpp"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <utility>

#include "forge/retrieval/Json.hpp"

namespace forge::desktop {

namespace json = forge::retrieval::json;

const char* toString(GuardianLevel level) noexcept {
  switch (level) {
    case GuardianLevel::Healthy:     return "healthy";
    case GuardianLevel::Caution:     return "caution";
    case GuardianLevel::Pressure:    return "pressure";
    case GuardianLevel::Critical:    return "critical";
    case GuardianLevel::NoEvidence:  return "no-evidence";
    case GuardianLevel::Unavailable: return "unavailable";
  }
  return "unavailable";
}

namespace {

GuardianStatus unavailable(std::string why) {
  GuardianStatus s;
  s.level = GuardianLevel::Unavailable;
  s.reason = std::move(why);
  return s;
}

bool finiteNumber(const json::Value& v) {
  return v.isNumber() && std::isfinite(v.number());
}

}  // namespace

GuardianStatus parseGuardianStatus(const std::string& stateJson, long long nowEpoch) {
  if (stateJson.size() > kGuardianMaxStateBytes) {
    return unavailable("state.json is larger than 256 KiB -- not a Guardian state");
  }
  json::Value root;
  std::string err;
  if (!json::parse(stateJson, root, err)) return unavailable("state.json unreadable: " + err);
  if (!root.isObject()) return unavailable("state.json is not a JSON object");

  // FRESHNESS FIRST: a perfectly formed GREEN from a dead governor is the most
  // dangerous input this reader can be given.
  const json::Value& epoch = root.at("epoch");
  if (!finiteNumber(epoch)) return unavailable("state.json has no epoch -- freshness unknown");
  const long long age = nowEpoch - static_cast<long long>(epoch.number());
  if (age > kGuardianStaleSeconds) {
    GuardianStatus s = unavailable("stale " + std::to_string(age) + " s -- Guardian is not publishing");
    s.ageSeconds = age;
    return s;
  }
  if (age < -kGuardianFutureSeconds) {
    GuardianStatus s = unavailable("published " + std::to_string(-age) + " s in the future -- clock skew");
    s.ageSeconds = age;
    return s;
  }

  GuardianStatus s;
  s.ageSeconds = age < 0 ? 0 : age;
  s.state = root.stringField("state");
  s.reason = root.stringField("reason");
  s.schemaV2 = root.stringField("schema") == "forge.guardian.state/2";
  // Only an explicit `true` counts; a missing or non-boolean field is false.
  s.heavyJobsOk = root.at("heavy_jobs_ok").kind() == json::Kind::Bool && root.at("heavy_jobs_ok").boolean();
  const json::Value& ec = root.at("evidence_complete");
  s.evidenceComplete = ec.kind() == json::Kind::Bool && ec.boolean();
  for (const json::Value& m : root.at("evidence").at("missing").items()) {
    if (m.isString()) s.missing.push_back(m.str());
  }
  s.thermal = root.stringField("thermal_state");
  const json::Value& rs = root.at("reservations");
  if (finiteNumber(rs.at("reserved_gb"))) s.reservedGb = rs.at("reserved_gb").number();
  if (finiteNumber(rs.at("budget_gb"))) s.budgetGb = rs.at("budget_gb").number();
  s.overcommit = rs.at("overcommit").kind() == json::Kind::Bool && rs.at("overcommit").boolean();
  const json::Value& rj = root.at("observables").at("registered_jobs");
  if (finiteNumber(rj)) s.registeredJobs = static_cast<long long>(rj.number());

  if (s.state == "GREEN") s.level = GuardianLevel::Healthy;
  else if (s.state == "YELLOW") s.level = GuardianLevel::Caution;
  else if (s.state == "ORANGE") s.level = GuardianLevel::Pressure;
  else if (s.state == "RED") s.level = GuardianLevel::Critical;
  else if (s.state == "UNKNOWN") s.level = GuardianLevel::NoEvidence;
  else {
    GuardianStatus u = unavailable("unrecognised state '" + s.state.substr(0, 32) + "'");
    u.ageSeconds = s.ageSeconds;
    return u;
  }

  // Missing evidence never upgrades a pressure state, but it does stop a calm one
  // from rendering as healthy. A v2 producer says so explicitly; a v1 producer
  // does not report evidence at all, so its GREEN/YELLOW is shown as unverified
  // (NoEvidence) rather than trusted.
  const bool calm = s.level == GuardianLevel::Healthy || s.level == GuardianLevel::Caution;
  if (calm && (!s.schemaV2 || !s.evidenceComplete)) {
    s.level = GuardianLevel::NoEvidence;
    if (!s.schemaV2 && s.missing.empty()) s.missing.push_back("v1 producer: evidence not reported");
  }
  // Heavy admission is the producer's GREEN-with-evidence verdict; nothing this
  // reader downgraded may still claim it.
  if (s.level != GuardianLevel::Healthy) s.heavyJobsOk = false;
  return s;
}

GuardianStatus readGuardianStatus(const std::string& path, long long nowEpoch) {
  if (path.empty()) return unavailable("no FORGE_HEALTH_DIR or HOME -- cannot locate Guardian state");
  std::ifstream in(path, std::ios::binary);
  if (!in) return unavailable("Guardian not running (no " + path + ")");
  std::string text;
  text.resize(kGuardianMaxStateBytes + 1);
  in.read(text.data(), static_cast<std::streamsize>(text.size()));
  text.resize(static_cast<std::size_t>(in.gcount()));
  return parseGuardianStatus(text, nowEpoch);
}

std::string defaultGuardianStatePath() {
  if (const char* d = std::getenv("FORGE_HEALTH_DIR"); d != nullptr && *d != '\0') {
    return std::string(d) + "/state.json";
  }
  if (const char* h = std::getenv("HOME"); h != nullptr && *h != '\0') {
    return std::string(h) + "/.forge-health/state.json";
  }
  return {};
}

std::string guardianStripText(const GuardianStatus& s, std::size_t maxChars) {
  std::string out;
  switch (s.level) {
    case GuardianLevel::Healthy:
      out = "Guardian GREEN";
      break;
    case GuardianLevel::Caution:
    case GuardianLevel::Pressure:
    case GuardianLevel::Critical:
      out = "Guardian " + s.state + (s.reason.empty() ? "" : ": " + s.reason);
      break;
    case GuardianLevel::NoEvidence: {
      out = "Guardian: no evidence";
      if (!s.missing.empty()) {
        out += " (";
        for (std::size_t i = 0; i < s.missing.size(); ++i) out += (i ? ", " : "") + s.missing[i];
        out += ")";
      } else if (!s.reason.empty()) {
        out += " (" + s.reason + ")";
      }
      break;
    }
    case GuardianLevel::Unavailable:
      out = "Guardian unavailable" + (s.reason.empty() ? std::string() : ": " + s.reason);
      break;
  }
  if (maxChars >= 4 && out.size() > maxChars) out = out.substr(0, maxChars - 3) + "...";
  return out;
}

std::vector<std::string> guardianDetail(const GuardianStatus& s) {
  std::vector<std::string> lines;
  lines.push_back(std::string("Forge Guardian: ") + (s.state.empty() ? "-" : s.state) + "  (" +
                  toString(s.level) + ")");
  if (!s.reason.empty()) lines.push_back("reason: " + s.reason);
  if (s.ageSeconds >= 0) lines.push_back("published " + std::to_string(s.ageSeconds) + " s ago");
  lines.push_back(std::string("heavy work admitted: ") + (s.heavyJobsOk ? "yes" : "no"));
  if (s.level != GuardianLevel::Unavailable) {
    std::string ev = std::string("evidence: ") + (s.evidenceComplete ? "complete" : "INCOMPLETE");
    if (!s.missing.empty()) {
      ev += " -- missing ";
      for (std::size_t i = 0; i < s.missing.size(); ++i) ev += (i ? ", " : "") + s.missing[i];
    }
    lines.push_back(ev);
  }
  if (!s.thermal.empty()) lines.push_back("thermal: " + s.thermal);
  if (s.reservedGb >= 0.0 && s.budgetGb >= 0.0) {
    char buf[128];
    std::snprintf(buf, sizeof buf, "reserved %.1f of %.1f GiB%s", s.reservedGb, s.budgetGb,
                  s.overcommit ? "  -- OVERCOMMITTED: new heavy jobs are refused" : "");
    lines.push_back(buf);
  }
  if (s.registeredJobs >= 0) lines.push_back("registered jobs: " + std::to_string(s.registeredJobs));
  lines.push_back("details: forge-guardian-ctl status");
  return lines;
}

}  // namespace forge::desktop
