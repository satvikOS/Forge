// forge-guardian-sensor -- native sensor and admission engine for Forge Guardian v2.
// Contract: tools/guardian/SCHEMA.md. Build: tools/guardian/sensor/build.sh.
#import <Foundation/Foundation.h>

#include "sensor.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <iterator>

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
          "  pidinfo [--state-dir D] PID...                 pid, ppid, start (epoch), uid, protected, identity\n"
          "  admit --state-dir D --pid PID --name N --peak-gb G [...]   SCHEMA 9.1\n"
          "  release --state-dir D --pid PID [--rc N] [--signal NAME] [--external-term]\n"
          "  incident --state-dir D --kind K [--note T] [--job SIG] [--window-min M] [--with-log]\n"
          "  session --state-dir D                          previous (classified) and current session\n"
          "  reports --since EPOCH [--dirs a:b]             classified DiagnosticReports (JSON)\n"
          "  quarantine-clear --state-dir D --sig SIG --reason TEXT\n"
          "  policy [--state-dir D] [--policy FILE] [--env]  effective policy (JSON, or policy.env)\n"
          "  append --file F [--line TEXT]                  append ONE whole record (stdin without --line)\n"
          "  append --file F --truncate-to N --if-size M    undo a torn append: cut F to N bytes iff it is M\n"
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

// append: the governor's JSONL appends (events.jsonl, history.jsonl, guardian.log) on a
// full disk (review 2026-10-08 R6, governor half). The governor appends in-process (one
// O_APPEND write, no fork); when that write fails part-way it has left a torn fragment
// [M - n, M) at the end of the file, and asks this to restore the file's previous length
// N = M - n. The cut is made only while the file is still exactly M bytes long: if another
// writer (the sensor) has appended since, its record must not be cut off with ours.
//   append --file F --truncate-to N --if-size M   exit 0 cut (or already N), 1 not cut
//   append --file F [--line TEXT]                 append_line: one whole record, or none
// ftruncate needs no free blocks, so the undo works on the full volume that caused it.
int cmd_append(int argc, char** argv) {
  Args a = parse_args(argc, argv, 2, {"file", "line", "truncate-to", "if-size"}, {});
  std::string f = a.get("file");
  bool undo = a.has("truncate-to") || a.has("if-size");
  int64_t to = -1, at = -1;
  if (!a.error.empty() || !a.pos.empty() || f.empty() || f[0] != '/' ||
      (undo && (!parse_i64(a.get("truncate-to"), to) || !parse_i64(a.get("if-size"), at) || to < 0 || at < to)) ||
      (undo && a.has("line"))) {
    fprintf(stderr,
            "usage: forge-guardian-sensor append --file /ABS/PATH [--line TEXT]\n"
            "       forge-guardian-sensor append --file /ABS/PATH --truncate-to N --if-size M%s%s\n",
            a.error.empty() ? "" : "\n", a.error.c_str());
    return kExitUsage;
  }
  if (undo) {
    int fd = open(f.c_str(), O_WRONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
    if (fd < 0) {
      fprintf(stderr, "forge-guardian-sensor append: %s: %s\n", f.c_str(), strerror(errno));
      return kExitDeny;
    }
    struct stat st;
    int rc = kExitDeny;
    if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode)) {
      fprintf(stderr, "forge-guardian-sensor append: %s: not a regular file\n", f.c_str());
    } else if (st.st_size == (off_t)to) {
      rc = kExitOk;  // nothing (left) to undo
    } else if (st.st_size != (off_t)at) {
      fprintf(stderr, "forge-guardian-sensor append: %s is %lld bytes, not %lld: another writer appended after the fragment; not cut\n",
              f.c_str(), (long long)st.st_size, (long long)at);
    } else if (ftruncate(fd, (off_t)to) != 0) {
      fprintf(stderr, "forge-guardian-sensor append: ftruncate %s: %s\n", f.c_str(), strerror(errno));
    } else {
      rc = kExitOk;
    }
    close(fd);
    return rc;
  }
  std::string line;
  if (a.has("line")) {
    line = a.get("line");
  } else {
    line.assign(std::istreambuf_iterator<char>(std::cin), std::istreambuf_iterator<char>());
    if (!line.empty() && line.back() == '\n') line.pop_back();
  }
  if (line.find('\n') != std::string::npos || line.size() > 1024 * 1024) {
    fprintf(stderr, "forge-guardian-sensor append: one record per call: no newline inside, at most 1 MiB\n");
    return kExitUsage;
  }
  int e = append_line(f, line);
  if (e) {
    fprintf(stderr, "forge-guardian-sensor append: %s: %s (the file keeps its previous length)\n", f.c_str(), strerror(e));
    return kExitDeny;
  }
  return kExitOk;
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
    if (c == "append") return cmd_append(argc, argv);
  }
  fprintf(stderr, "forge-guardian-sensor: unknown command '%s'\n", c.c_str());
  usage(stderr);
  return kExitUsage;
}
