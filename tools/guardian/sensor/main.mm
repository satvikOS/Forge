// forge-guardian-sensor -- native sensor and admission engine for Forge Guardian v2.
// Contract: tools/guardian/SCHEMA.md. Build: tools/guardian/sensor/build.sh.
#import <Foundation/Foundation.h>

#include "sensor.hpp"

#include <sys/stat.h>

#include <cstdio>
#include <cstring>

using namespace fgs;

static void usage(FILE* f) {
  fprintf(f,
          "forge-guardian-sensor %s -- Forge Guardian native sensor and admission engine\n"
          "\n"
          "usage: forge-guardian-sensor <command> [options]\n"
          "\n"
          "  run --state-dir D [--poll S] [--parent PID] [--policy FILE]\n"
          "        event-driven sampler: publishes D/sensor.env + D/sensor.json every poll\n"
          "  snapshot [--state-dir D] [--policy FILE]      one-shot sensor.json on stdout\n"
          "  pidinfo PID...                                 pid, ppid, start time, identity\n"
          "  admit --state-dir D --pid PID --name N --peak-gb G [...]   SCHEMA 9.1\n"
          "  release --state-dir D --pid PID [--rc N] [--signal NAME] [--external-term]\n"
          "  incident --state-dir D --kind K [--note T] [--job SIG] [--window-min M] [--with-log]\n"
          "  session --state-dir D                          previous (classified) and current session\n"
          "  reports --since EPOCH [--dirs a:b]             classified DiagnosticReports (JSON)\n"
          "  quarantine-clear --state-dir D --sig SIG --reason TEXT\n"
          "  policy [--state-dir D] [--policy FILE] [--env]  effective policy (JSON, or policy.env)\n"
          "  --version | --help\n"
          "\n"
          "exit: 0 ok, 1 denied/failed, 2 usage, 3 duplicate instance, 70 internal,\n"
          "      75 cannot decide (fail closed), 78 quarantined\n",
          kVersion);
}

namespace fgs {
int cmd_policy(int argc, char** argv) {
  Args a = parse_args(argc, argv, 2, {"state-dir", "policy"}, {"env", "json"});
  if (!a.error.empty() || !a.pos.empty()) {
    fprintf(stderr, "usage: forge-guardian-sensor policy [--state-dir D] [--policy FILE] [--env|--json]\n");
    return kExitUsage;
  }
  PolicyLoad pl = load_policy(a.get("state-dir"), a.get("policy"));
  if (!pl.error.empty()) fprintf(stderr, "forge-guardian-sensor policy: rejected, using defaults: %s\n", pl.error.c_str());
  std::string out = a.flag.count("env") ? policy_env(pl.p, pl.source) : policy_json(pl.p) + "\n";
  fwrite(out.data(), 1, out.size(), stdout);
  return pl.error.empty() ? kExitOk : kExitDeny;
}
}  // namespace fgs

int main(int argc, char** argv) {
  umask(077);
  if (argc < 2) {
    usage(stderr);
    return kExitUsage;
  }
  std::string c = argv[1];
  if (c == "--version" || c == "version") {
    printf("forge-guardian-sensor %s\n", kVersion);
    return kExitOk;
  }
  if (c == "--help" || c == "-h" || c == "help") {
    usage(stdout);
    return kExitOk;
  }
  @autoreleasepool {
    if (c == "run") return cmd_run(argc, argv);
    if (c == "snapshot") return cmd_snapshot(argc, argv);
    if (c == "pidinfo") return cmd_pidinfo(argc, argv);
    if (c == "admit") return cmd_admit(argc, argv);
    if (c == "release") return cmd_release(argc, argv);
    if (c == "incident") return cmd_incident(argc, argv);
    if (c == "session") return cmd_session(argc, argv);
    if (c == "reports") return cmd_reports(argc, argv);
    if (c == "quarantine-clear") return cmd_quarantine_clear(argc, argv);
    if (c == "policy") return cmd_policy(argc, argv);
  }
  fprintf(stderr, "forge-guardian-sensor: unknown command '%s'\n", c.c_str());
  usage(stderr);
  return kExitUsage;
}
