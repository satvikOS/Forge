// forge-guardian-sensor -- session continuity (SCHEMA §8).
//
// What this can and cannot say. A new boot with no orderly stop recorded and nothing
// in DiagnosticReports explaining it is `unclean_unknown`: it is NEVER asserted to be
// a kernel panic, a power loss or a "green screen". A panic is claimed only when a
// panic report is dated inside the gap, and the report path is recorded as the
// evidence. Every rewrite of current.json is F_FULLFSYNC'd, because the record exists
// precisely for the case where the machine died before it could write anything else.
#import <Foundation/Foundation.h>

#include "sensor.hpp"

#include <sys/stat.h>

#include <algorithm>
#include <cerrno>
#include <cstring>

namespace fgs {

static std::string session_json(const Session& s) {
  JW w;
  w.begin_obj();
  if (s.boot_uuid.empty()) w.knull("boot_uuid"); else w.ks("boot_uuid", s.boot_uuid);
  w.ki("boot_epoch", s.boot_epoch);
  w.kn("sensor_start", s.sensor_start, 3);
  w.kn("last_heartbeat", s.last_heartbeat, 3);
  w.ki("last_heartbeat_mono_ms", (int64_t)s.last_hb_mono);
  w.kb("orderly_stop", s.orderly_stop);
  if (s.orderly_stop_ts > 0) w.kn("orderly_stop_ts", s.orderly_stop_ts, 3); else w.knull("orderly_stop_ts");
  if (s.stop_reason.empty()) w.knull("stop_reason"); else w.ks("stop_reason", s.stop_reason);
  w.ki("sleeps", s.sleeps);
  if (s.last_sleep_ts > 0) w.kn("last_sleep_ts", s.last_sleep_ts, 3); else w.knull("last_sleep_ts");
  if (s.last_wake_ts > 0) w.kn("last_wake_ts", s.last_wake_ts, 3); else w.knull("last_wake_ts");
  w.kb("asleep", s.asleep);
  w.ki("sensor_pid", getpid()).ks("sensor_version", kVersion);
  w.end_obj();
  w.out += '\n';
  return w.out;
}

int session_save(const std::string& D, Session& s) {
  s.last_heartbeat = now_wall();
  s.last_hb_mono = mono_ms();
  std::string dir = D + "/session";
  if (int e = mkdirs(dir)) return e;
  return write_atomic(dir + "/current.json", session_json(s), /*full_sync=*/true);
}

std::string session_begin(const std::string& D, const Session& cur, const std::vector<std::string>& dirs) {
  std::string dir = D + "/session";
  mkdirs(dir);
  std::string text;
  int e = read_file(dir + "/current.json", text, 64 * 1024, false);
  if (e == ENOENT) return "";
  double now = now_wall();
  std::string classification, panic_path, note;
  double last_hb = 0, last_sleep = -1, last_wake = -1;
  int64_t old_boot_epoch = -1;
  bool orderly = false, asleep = false, parsed = false;
  std::string old_boot;
  std::string old_raw;
  @autoreleasepool {
    NSDictionary* d = e == 0 ? json_obj(text) : nil;
    if (d) {
      parsed = true;
      old_raw = ns_compact(d);
      old_boot = ns_str(d[@"boot_uuid"]);
      double v;
      if (ns_num(d[@"last_heartbeat"], v)) last_hb = v;
      if (ns_num(d[@"last_sleep_ts"], v)) last_sleep = v;
      if (ns_num(d[@"last_wake_ts"], v)) last_wake = v;
      if (ns_num(d[@"boot_epoch"], v)) old_boot_epoch = (int64_t)v;
      orderly = ns_is_bool(d[@"orderly_stop"]) && [(NSNumber*)d[@"orderly_stop"] boolValue];
      asleep = ns_is_bool(d[@"asleep"]) && [(NSNumber*)d[@"asleep"] boolValue];
    }
  }
  bool was_asleep = asleep || (last_sleep > 0 && last_sleep > last_wake);
  // Every report dated in the gap is recorded as evidence. The panic window is
  // [last heartbeat, now]: a panic report is written at the NEXT boot, after the gap.
  std::vector<Report> gap;
  if (last_hb > 0) gap = scan_reports(dirs, last_hb - 1e-6, now + 1, 50, false);
  for (auto& r : gap)
    if (r.category == "panic" && panic_path.empty()) panic_path = r.path;
  if (!parsed) {
    classification = "unclean_unknown";
    note = "previous current.json was unreadable or corrupt";
  } else if (!old_boot.empty() && !cur.boot_uuid.empty() && old_boot == cur.boot_uuid) {
    classification = orderly ? "service_restart" : "service_interrupted";
  } else if (orderly) {
    classification = "orderly_stop_then_reboot";
  } else if (!panic_path.empty()) {
    classification = "kernel_panic";
  } else {
    classification = "unclean_unknown";
  }
  JW w;
  w.begin_obj();
  if (parsed) w.key("record").raw(old_raw); else w.knull("record");
  w.ks("classification", classification);
  w.kn("classified_ts", now, 3);
  if (cur.boot_uuid.empty()) w.knull("classified_boot_uuid"); else w.ks("classified_boot_uuid", cur.boot_uuid);
  w.key("evidence").begin_obj();
  if (last_hb > 0 && cur.boot_epoch > 0) w.kn("gap_s", (double)cur.boot_epoch - last_hb, 3); else w.knull("gap_s");
  if (last_hb > 0) w.kn("last_heartbeat", last_hb, 3); else w.knull("last_heartbeat");
  w.ki("previous_boot_epoch", old_boot_epoch).ki("boot_epoch", cur.boot_epoch);
  w.kb("same_boot", !old_boot.empty() && old_boot == cur.boot_uuid);
  w.kb("orderly_stop", orderly).kb("was_asleep", was_asleep);
  if (panic_path.empty()) w.knull("panic_report"); else w.ks("panic_report", panic_path);
  w.key("reports_in_gap").begin_arr();
  for (auto& r : gap) w.begin_obj().ks("file", r.path).ks("category", r.category).kn("mtime", r.mtime, 3).end_obj();
  w.end_arr();
  if (!note.empty()) w.ks("note", note);
  w.end_obj();
  w.end_obj();
  // previous.json is the old record verbatim (top-level keys) plus the classification:
  // splice the record's own keys in so v1 readers find them where they were.
  std::string prev;
  @autoreleasepool {
    NSMutableDictionary* m = [NSMutableDictionary dictionary];
    NSDictionary* rec = parsed ? json_obj(old_raw) : nil;
    if (rec) [m addEntriesFromDictionary:rec];
    NSDictionary* extra = json_obj(w.out);
    if (extra) {
      for (NSString* k in extra)
        if (![k isEqualToString:@"record"]) m[k] = extra[k];
    }
    prev = ns_compact(m);
  }
  if (prev.empty()) prev = w.out;
  write_atomic(dir + "/previous.json", prev + "\n", /*full_sync=*/true);
  append_line(dir + "/boots.jsonl", prev);
  return classification;
}

int cmd_session(int argc, char** argv) {
  Args a = parse_args(argc, argv, 2, {"state-dir"}, {});
  if (!a.error.empty() || !a.pos.empty() || a.get("state-dir").empty()) {
    fprintf(stderr, "usage: forge-guardian-sensor session --state-dir D\n");
    return kExitUsage;
  }
  std::string D = a.get("state-dir");
  std::string prev, cur;
  read_file(D + "/session/previous.json", prev, 64 * 1024, false);
  read_file(D + "/session/current.json", cur, 64 * 1024, false);
  JW w;
  w.begin_obj();
  @autoreleasepool {
    std::string p = ns_compact(json_obj(prev));
    std::string c = ns_compact(json_obj(cur));
    if (p.empty()) w.knull("previous"); else w.key("previous").raw(p);
    if (c.empty()) w.knull("current"); else w.key("current").raw(c);
  }
  w.end_obj();
  w.out += '\n';
  fwrite(w.out.data(), 1, w.out.size(), stdout);
  return kExitOk;
}

}  // namespace fgs
