// forge-desktop/src/GuardianStatus.hpp
//
// WHAT FORGE GUARDIAN SAYS ABOUT THIS MACHINE, AS A VALUE.
//
// Forge Guardian (tools/guardian, contract in tools/guardian/SCHEMA.md) is the
// workstation's one machine-wide admission authority. It publishes
// $FORGE_HEALTH_DIR/state.json every poll. The app shows that state in its status
// strip so a user can see, from inside Forge, whether heavy work (a rebuild of a
// 400-face part, a CAE solve, an Archie generation) is being admitted -- and WHY
// not when it is not.
//
// ── the rule this file exists to keep ───────────────────────────────────────
// AN ABSENT INSTRUMENT IS NOT A HEALTHY MACHINE. A missing, unreadable, stale,
// future-dated or unrecognised state is `Unavailable`; a governor that says it has
// no sustained evidence (UNKNOWN, or evidence_complete=false) is `NoEvidence`.
// Neither may ever render as healthy. The old governor published a thermal reading
// of 100 % for months on this Mac because the sensor it parsed printed nothing; a
// reader that turned "nothing" into "fine" would repeat that one level up.
//
// Pure: parseGuardianStatus() is a function of (text, now), so a headless gate
// (forge-desktop/test/run_guardian_status_gate.sh) drives every case without a
// window, a GPU or the kernel. readGuardianStatus() only adds a bounded file read.
// It lives in the app layer, not forge::ui, because it is a client of a local
// service (like forge_archie's sidecar client) and reuses the strict JSON reader in
// retrieval/ -- which forge::ui's fifteen direct-compile gates do not link.
#ifndef FORGE_DESKTOP_GUARDIANSTATUS_HPP
#define FORGE_DESKTOP_GUARDIANSTATUS_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::desktop {

enum class GuardianLevel : std::uint8_t {
  Healthy,      // GREEN with complete, fresh evidence
  Caution,      // YELLOW
  Pressure,     // ORANGE
  Critical,     // RED
  NoEvidence,   // UNKNOWN, or a state published with evidence_complete=false
  Unavailable,  // no file, unreadable, stale, clock skew, or a state word we do not know
};

const char* toString(GuardianLevel level) noexcept;

struct GuardianStatus {
  GuardianLevel level = GuardianLevel::Unavailable;
  std::string state;            // the published word ("GREEN" ...); empty when unavailable
  std::string reason;           // the governor's reason, or why it could not be read
  long long ageSeconds = -1;    // now - epoch; -1 when unknown
  bool heavyJobsOk = false;     // only ever true when the producer said so
  bool evidenceComplete = false;
  bool schemaV2 = false;        // false: a v1 producer that does not report evidence
  std::vector<std::string> missing;   // evidence.missing
  std::string thermal;          // thermal_state, "" when not published
  double reservedGb = -1.0;
  double budgetGb = -1.0;
  bool overcommit = false;
  long long registeredJobs = -1;
};

// Freshness bounds, the same as forge-gate's (SCHEMA §9.1).
inline constexpr long long kGuardianStaleSeconds = 60;
inline constexpr long long kGuardianFutureSeconds = 5;
// state.json is a few KiB; anything larger is not ours.
inline constexpr std::size_t kGuardianMaxStateBytes = 256 * 1024;

// Pure decision over the published text at wall-clock `nowEpoch`.
GuardianStatus parseGuardianStatus(const std::string& stateJson, long long nowEpoch);

// Bounded read of `path` (normally defaultGuardianStatePath()), then parse.
GuardianStatus readGuardianStatus(const std::string& path, long long nowEpoch);

// $FORGE_HEALTH_DIR/state.json, else $HOME/.forge-health/state.json; "" if neither is set.
std::string defaultGuardianStatePath();

// One short status-strip label, e.g. "Guardian GREEN", "Guardian: no evidence (thermal)",
// "Guardian unavailable: stale 125 s". Never longer than `maxChars` (elided with "...").
std::string guardianStripText(const GuardianStatus& s, std::size_t maxChars = 56);

// Tooltip lines: state, reason, age, admission, evidence, thermal, reservations.
std::vector<std::string> guardianDetail(const GuardianStatus& s);

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_GUARDIANSTATUS_HPP
