// forge-guardian-sensor -- policy (SCHEMA §6).
//
// The built-in defaults below are IDENTICAL to tools/guardian/policy.default.json;
// sensor_gate.sh proves it by comparing `policy --json` (built-in) with that file.
// A policy.json is an overlay: objects merge key by key, lists replace. A file that
// fails validation is rejected WHOLE (never half-applied) and the defaults are used,
// with a policy_error event naming why.
#import <Foundation/Foundation.h>

#include "sensor.hpp"

#include <sys/stat.h>

#include <cerrno>
#include <cmath>
#include <cstring>

namespace fgs {

std::vector<WatchLog> Policy::default_watch_logs() {
  WatchLog w;
  w.path = "~/Library/Logs/archie-sidecar/sidecar.err.log";
  w.kind = "gpu_error";
  w.patterns = {"Command buffer execution failed", "kIOGPUCommandBufferCallbackError",
                "MTLCommandBufferError", "GPU Hang", "Insufficient Memory", "VK_ERROR_DEVICE_LOST",
                "VK_ERROR_OUT_OF_DEVICE_MEMORY"};
  return {w};
}

double Policy::floor_gib(const std::string& level) const {
  if (level == "red") return floor_red;
  if (level == "orange") return floor_orange;
  return floor_yellow;
}

static const std::set<std::string>& signal_names() {
  static const std::set<std::string> s{"vm_pressure", "pressure_event", "free_pct", "memory", "swap",
                                       "pageouts", "thermal", "cpu", "disk"};
  return s;
}

bool known_signal_name(const std::string& s) {
  static const std::set<std::string> names{"HUP", "INT", "QUIT", "ILL", "TRAP", "ABRT", "EMT", "FPE",
                                           "KILL", "BUS", "SEGV", "SYS", "PIPE", "ALRM", "TERM", "URG",
                                           "STOP", "TSTP", "CONT", "CHLD", "TTIN", "TTOU", "IO", "XCPU",
                                           "XFSZ", "VTALRM", "PROF", "WINCH", "INFO", "USR1", "USR2"};
  return names.count(s) > 0;
}

namespace {

struct Ctx {
  std::string err;
  bool fail(const std::string& e) {
    if (err.empty()) err = e;
    return false;
  }
};

bool get_dict(Ctx& c, id v, const std::string& where, NSDictionary* __strong& out) {
  if (![v isKindOfClass:[NSDictionary class]]) return c.fail(where + " must be an object");
  out = (NSDictionary*)v;
  return true;
}

// min_ok: the smallest accepted value; strict: value must be > min_ok.
bool get_number(Ctx& c, id v, const std::string& where, double min_ok, bool strict, double& out) {
  double d;
  if (!ns_num(v, d)) return c.fail(where + " must be a number");
  if (strict ? !(d > min_ok) : !(d >= min_ok))
    return c.fail(where + (strict ? " must be > " : " must be >= ") + fmt_num(min_ok));
  out = d;
  return true;
}

bool get_int(Ctx& c, id v, const std::string& where, int64_t min_ok, int& out) {
  double d;
  if (!ns_num(v, d)) return c.fail(where + " must be an integer");
  if (d != std::floor(d) || d > 1e9) return c.fail(where + " must be an integer");
  if (d < (double)min_ok) return c.fail(where + " must be >= " + std::to_string(min_ok));
  out = (int)d;
  return true;
}

bool get_bool(Ctx& c, id v, const std::string& where, bool& out) {
  if (ns_is_bool(v)) { out = [(NSNumber*)v boolValue]; return true; }
  double d;
  if (ns_num(v, d) && (d == 0 || d == 1)) { out = d == 1; return true; }
  return c.fail(where + " must be a boolean");
}

bool get_word(Ctx& c, id v, const std::string& where, const std::set<std::string>& allowed,
              std::string& out) {
  std::string s = ns_str(v);
  if (!allowed.count(s)) {
    std::string a;
    for (auto& x : allowed) a += (a.empty() ? "" : "|") + x;
    return c.fail(where + " must be one of " + a);
  }
  out = s;
  return true;
}

bool get_str_list(Ctx& c, id v, const std::string& where, size_t max, std::vector<std::string>& out) {
  if (![v isKindOfClass:[NSArray class]]) return c.fail(where + " must be a list of strings");
  std::vector<std::string> o;
  for (id x in (NSArray*)v) {
    std::string s = ns_str(x);
    if (s.empty()) return c.fail(where + " must contain non-empty strings");
    if (s.size() > 1024) return c.fail(where + " entry too long");
    o.push_back(s);
    if (o.size() > max) return c.fail(where + " has more than " + std::to_string(max) + " entries");
  }
  out = o;
  return true;
}

bool comment_key(NSString* k) { return [k hasPrefix:@"_"]; }

#define FOR_KEYS(dict)                      \
  for (NSString * nk in (dict)) {           \
    if (comment_key(nk)) continue;          \
    std::string k = ns_str(nk);             \
    id v = (dict)[nk];

bool overlay(Ctx& c, Policy& p, NSDictionary* root) {
  static const std::set<std::string> states{"GREEN", "YELLOW", "ORANGE", "RED"};
  FOR_KEYS(root)
    if (k == "schema") {
      if (ns_str(v) != "forge.guardian.policy/1") return c.fail("schema must be forge.guardian.policy/1");
    } else if (k == "poll_s") { if (!get_int(c, v, k, 1, p.poll_s)) return false; }
    else if (k == "escalate_polls") { if (!get_int(c, v, k, 1, p.escalate_polls)) return false; }
    else if (k == "deescalate_polls") { if (!get_int(c, v, k, 1, p.deescalate_polls)) return false; }
    else if (k == "sensor_stale_polls") { if (!get_int(c, v, k, 1, p.sensor_stale_polls)) return false; }
    else if (k == "required_signals") {
      std::vector<std::string> l;
      if (!get_str_list(c, v, k, 16, l)) return false;
      for (auto& s : l)
        if (!signal_names().count(s)) return c.fail("required_signals: unknown signal " + s);
      p.required_signals = l;
    } else if (k == "memory") {
      NSDictionary* d = nil;
      if (!get_dict(c, v, k, d)) return false;
      FOR_KEYS(d)
        std::string w = "memory." + k;
        if (k == "os_reserve_gb") { if (!get_number(c, v, w, 0, false, p.os_reserve_gb)) return false; }
        else if (k == "instant_margin_gb") { if (!get_number(c, v, w, 0, false, p.instant_margin_gb)) return false; }
        else if (k == "enforce_instant_fit") { if (!get_bool(c, v, w, p.enforce_instant_fit)) return false; }
        else if (k == "light_job_gb") { if (!get_number(c, v, w, 0, false, p.light_job_gb)) return false; }
        else return c.fail("unknown key " + w);
      }
    } else if (k == "disk") {
      NSDictionary* d = nil;
      if (!get_dict(c, v, k, d)) return false;
      FOR_KEYS(d)
        std::string w = "disk." + k;
        if (k == "floors_gib") {
          NSDictionary* f = nil;
          if (!get_dict(c, v, w, f)) return false;
          FOR_KEYS(f)
            std::string ww = w + "." + k;
            // Whole GiB, >= 1: the governor compares floors with integer arithmetic
            // (disk_min_avail_gib is an int), so a fractional floor would mean one
            // thing to admission and another to the state machine.
            int f = 0;
            if (k == "yellow") { if (!get_int(c, v, ww, 1, f)) return false; p.floor_yellow = f; }
            else if (k == "orange") { if (!get_int(c, v, ww, 1, f)) return false; p.floor_orange = f; }
            else if (k == "red") { if (!get_int(c, v, ww, 1, f)) return false; p.floor_red = f; }
            else return c.fail("unknown key " + ww);
          }
        } else if (k == "volumes") {
          std::vector<std::string> l;
          if (!get_str_list(c, v, w, 16, l)) return false;
          if (l.empty()) return c.fail(w + " must name at least one volume");
          p.volumes = l;
        } else if (k == "admission_floor") {
          if (!get_word(c, v, w, {"yellow", "orange", "red"}, p.admission_floor)) return false;
        } else {
          return c.fail("unknown key " + w);
        }
      }
    } else if (k == "thermal") {
      NSDictionary* d = nil;
      if (!get_dict(c, v, k, d)) return false;
      FOR_KEYS(d)
        std::string w = "thermal." + k;
        if (k == "fair") { if (!get_word(c, v, w, states, p.thermal_fair)) return false; }
        else if (k == "serious") { if (!get_word(c, v, w, states, p.thermal_serious)) return false; }
        else if (k == "critical") { if (!get_word(c, v, w, states, p.thermal_critical)) return false; }
        else return c.fail("unknown key " + w);
      }
    } else if (k == "eviction") {
      NSDictionary* d = nil;
      if (!get_dict(c, v, k, d)) return false;
      FOR_KEYS(d)
        std::string w = "eviction." + k;
        if (k == "settle_s") { if (!get_int(c, v, w, 0, p.settle_s)) return false; }
        else if (k == "term_grace_s") { if (!get_int(c, v, w, 1, p.term_grace_s)) return false; }
        else return c.fail("unknown key " + w);
      }
    } else if (k == "crash_loop") {
      NSDictionary* d = nil;
      if (!get_dict(c, v, k, d)) return false;
      FOR_KEYS(d)
        std::string w = "crash_loop." + k;
        if (k == "max_crashes") { if (!get_int(c, v, w, 1, p.max_crashes)) return false; }
        else if (k == "window_s") { if (!get_int(c, v, w, 1, p.window_s)) return false; }
        else if (k == "crash_signals") {
          std::vector<std::string> l;
          if (!get_str_list(c, v, w, 32, l)) return false;
          for (auto& s : l)
            if (!known_signal_name(s)) return c.fail(w + ": unknown signal " + s);
          p.crash_signals = l;
        } else return c.fail("unknown key " + w);
      }
    } else if (k == "guardian_restart_loop") {
      NSDictionary* d = nil;
      if (!get_dict(c, v, k, d)) return false;
      FOR_KEYS(d)
        std::string w = "guardian_restart_loop." + k;
        if (k == "max_starts") { if (!get_int(c, v, w, 1, p.restart_max_starts)) return false; }
        else if (k == "window_s") { if (!get_int(c, v, w, 1, p.restart_window_s)) return false; }
        else if (k == "backoff_s") { if (!get_int(c, v, w, 0, p.restart_backoff_s)) return false; }
        else return c.fail("unknown key " + w);
      }
    } else if (k == "logs") {
      NSDictionary* d = nil;
      if (!get_dict(c, v, k, d)) return false;
      FOR_KEYS(d)
        std::string w = "logs." + k;
        if (k == "cap_mib") { if (!get_int(c, v, w, 1, p.logs_cap_mib)) return false; }
        else if (k == "rotate_mib") { if (!get_int(c, v, w, 1, p.logs_rotate_mib)) return false; }
        else if (k == "generations") { if (!get_int(c, v, w, 1, p.logs_generations)) return false; }
        else if (k == "history_mib") { if (!get_int(c, v, w, 1, p.logs_history_mib)) return false; }
        else if (k == "incident_max_kib") { if (!get_int(c, v, w, 16, p.logs_incident_max_kib)) return false; }
        else if (k == "retention_days") { if (!get_int(c, v, w, 1, p.logs_retention_days)) return false; }
        else return c.fail("unknown key " + w);
      }
    } else if (k == "notifications") {
      NSDictionary* d = nil;
      if (!get_dict(c, v, k, d)) return false;
      FOR_KEYS(d)
        std::string w = "notifications." + k;
        if (k == "enabled") { if (!get_bool(c, v, w, p.notifications_enabled)) return false; }
        else if (k == "min_interval_s") { if (!get_int(c, v, w, 1, p.notifications_min_interval_s)) return false; }
        else return c.fail("unknown key " + w);
      }
    } else if (k == "reports") {
      NSDictionary* d = nil;
      if (!get_dict(c, v, k, d)) return false;
      FOR_KEYS(d)
        std::string w = "reports." + k;
        if (k == "scan_interval_s") { if (!get_int(c, v, w, 1, p.reports_scan_interval_s)) return false; }
        else return c.fail("unknown key " + w);
      }
    } else if (k == "smart") {
      NSDictionary* d = nil;
      if (!get_dict(c, v, k, d)) return false;
      FOR_KEYS(d)
        std::string w = "smart." + k;
        if (k == "interval_s") { if (!get_int(c, v, w, 1, p.smart_interval_s)) return false; }
        else return c.fail("unknown key " + w);
      }
    } else if (k == "watch_logs") {
      if (![v isKindOfClass:[NSArray class]]) return c.fail("watch_logs must be a list");
      std::vector<WatchLog> wl;
      for (id e in (NSArray*)v) {
        NSDictionary* d = nil;
        if (!get_dict(c, e, "watch_logs[]", d)) return false;
        WatchLog w;
        w.kind = "gpu_error";
        FOR_KEYS(d)
          if (k == "path") {
            w.path = ns_str(v);
            if (w.path.empty() || w.path.size() > 1024) return c.fail("watch_logs[].path must be a path");
          } else if (k == "kind") {
            if (!get_word(c, v, "watch_logs[].kind", {"gpu_error"}, w.kind)) return false;
          } else if (k == "patterns") {
            if (!get_str_list(c, v, "watch_logs[].patterns", 64, w.patterns)) return false;
          } else {
            return c.fail("unknown key watch_logs[]." + k);
          }
        }
        if (w.path.empty()) return c.fail("watch_logs[] needs a path");
        if (w.patterns.empty()) return c.fail("watch_logs[] needs at least one pattern");
        wl.push_back(w);
        if (wl.size() > 16) return c.fail("watch_logs has more than 16 entries");
      }
      p.watch_logs = wl;
    } else {
      return c.fail("unknown key " + k);
    }
  }
  if (!(p.floor_red < p.floor_orange && p.floor_orange < p.floor_yellow))
    return c.fail("disk.floors_gib must be strictly ordered red < orange < yellow (got red " +
                  fmt_num(p.floor_red) + ", orange " + fmt_num(p.floor_orange) + ", yellow " +
                  fmt_num(p.floor_yellow) + ")");
  return true;
}
#undef FOR_KEYS

}  // namespace

PolicyLoad load_policy(const std::string& state_dir, const std::string& policy_arg) {
  PolicyLoad r;
  std::string path;
  if (!state_dir.empty()) {
    std::string pj = state_dir + "/policy.json";
    struct stat st;
    if (lstat(pj.c_str(), &st) == 0) path = pj;
  }
  if (path.empty() && !policy_arg.empty()) path = policy_arg;
  if (path.empty()) return r;
  r.source = path;
  std::string text;
  int e = read_file(path, text, 256 * 1024, /*follow=*/true);
  if (e) {
    r.error = "cannot read " + path + ": " + strerror(e);
    return r;
  }
  @autoreleasepool {
    NSDictionary* root = json_obj(text);
    if (!root) {
      r.error = path + ": not a JSON object";
      return r;
    }
    Policy p;
    Ctx c;
    if (!overlay(c, p, root)) {
      r.error = path + ": " + c.err;
      return r;
    }
    r.p = p;
  }
  return r;
}

static std::string join(const std::vector<std::string>& v, const char* sep) {
  std::string o;
  for (size_t i = 0; i < v.size(); ++i) o += (i ? sep : "") + v[i];
  return o;
}

// SCHEMA §6: exactly these keys, `_`-joined, lists space-joined. policy_source is an
// additive key naming where the effective policy came from.
std::string policy_env(const Policy& p, const std::string& source) {
  std::string o;
  auto kv = [&](const char* k, const std::string& v) { o += k; o += '='; o += v; o += '\n'; };
  kv("poll_s", std::to_string(p.poll_s));
  kv("escalate_polls", std::to_string(p.escalate_polls));
  kv("deescalate_polls", std::to_string(p.deescalate_polls));
  kv("sensor_stale_polls", std::to_string(p.sensor_stale_polls));
  kv("required_signals", join(p.required_signals, " "));
  kv("memory_os_reserve_gb", fmt_num(p.os_reserve_gb));
  kv("memory_instant_margin_gb", fmt_num(p.instant_margin_gb));
  kv("memory_enforce_instant_fit", p.enforce_instant_fit ? "1" : "0");
  kv("memory_light_job_gb", fmt_num(p.light_job_gb));
  kv("disk_floors_gib_yellow", fmt_num(p.floor_yellow));
  kv("disk_floors_gib_orange", fmt_num(p.floor_orange));
  kv("disk_floors_gib_red", fmt_num(p.floor_red));
  kv("disk_admission_floor", p.admission_floor);
  {  // additive: the configured volumes, each percent-encoded, space-joined
    std::string vols;
    for (auto& v : p.volumes) vols += (vols.empty() ? "" : " ") + env_word(v);
    kv("disk_volumes", vols);
  }
  kv("thermal_fair", p.thermal_fair);
  kv("thermal_serious", p.thermal_serious);
  kv("thermal_critical", p.thermal_critical);
  kv("eviction_settle_s", std::to_string(p.settle_s));
  kv("eviction_term_grace_s", std::to_string(p.term_grace_s));
  kv("crash_loop_max_crashes", std::to_string(p.max_crashes));
  kv("crash_loop_window_s", std::to_string(p.window_s));
  kv("crash_loop_crash_signals", join(p.crash_signals, " "));
  kv("guardian_restart_loop_max_starts", std::to_string(p.restart_max_starts));
  kv("guardian_restart_loop_window_s", std::to_string(p.restart_window_s));
  kv("guardian_restart_loop_backoff_s", std::to_string(p.restart_backoff_s));
  kv("logs_cap_mib", std::to_string(p.logs_cap_mib));
  kv("logs_rotate_mib", std::to_string(p.logs_rotate_mib));
  kv("logs_generations", std::to_string(p.logs_generations));
  kv("logs_history_mib", std::to_string(p.logs_history_mib));
  kv("logs_incident_max_kib", std::to_string(p.logs_incident_max_kib));
  kv("logs_retention_days", std::to_string(p.logs_retention_days));
  kv("notifications_enabled", p.notifications_enabled ? "1" : "0");
  kv("notifications_min_interval_s", std::to_string(p.notifications_min_interval_s));
  kv("reports_scan_interval_s", std::to_string(p.reports_scan_interval_s));
  kv("smart_interval_s", std::to_string(p.smart_interval_s));
  kv("policy_source", env_word(source));
  return o;
}

std::string policy_json(const Policy& p) {
  JW w;
  auto list = [&](const std::vector<std::string>& v) {
    w.begin_arr();
    for (auto& s : v) w.str(s);
    w.end_arr();
  };
  w.begin_obj();
  w.ks("schema", "forge.guardian.policy/1");
  w.ki("poll_s", p.poll_s).ki("escalate_polls", p.escalate_polls);
  w.ki("deescalate_polls", p.deescalate_polls).ki("sensor_stale_polls", p.sensor_stale_polls);
  w.key("required_signals");
  list(p.required_signals);
  w.key("memory").begin_obj();
  w.kn("os_reserve_gb", p.os_reserve_gb).kn("instant_margin_gb", p.instant_margin_gb);
  w.kb("enforce_instant_fit", p.enforce_instant_fit).kn("light_job_gb", p.light_job_gb);
  w.end_obj();
  w.key("disk").begin_obj();
  w.key("floors_gib").begin_obj();
  w.kn("yellow", p.floor_yellow).kn("orange", p.floor_orange).kn("red", p.floor_red);
  w.end_obj();
  w.key("volumes");
  list(p.volumes);
  w.ks("admission_floor", p.admission_floor);
  w.end_obj();
  w.key("thermal").begin_obj();
  w.ks("fair", p.thermal_fair).ks("serious", p.thermal_serious).ks("critical", p.thermal_critical);
  w.end_obj();
  w.key("eviction").begin_obj().ki("settle_s", p.settle_s).ki("term_grace_s", p.term_grace_s).end_obj();
  w.key("crash_loop").begin_obj();
  w.ki("max_crashes", p.max_crashes).ki("window_s", p.window_s);
  w.key("crash_signals");
  list(p.crash_signals);
  w.end_obj();
  w.key("guardian_restart_loop").begin_obj();
  w.ki("max_starts", p.restart_max_starts).ki("window_s", p.restart_window_s);
  w.ki("backoff_s", p.restart_backoff_s).end_obj();
  w.key("logs").begin_obj();
  w.ki("cap_mib", p.logs_cap_mib).ki("rotate_mib", p.logs_rotate_mib);
  w.ki("generations", p.logs_generations).ki("history_mib", p.logs_history_mib);
  w.ki("incident_max_kib", p.logs_incident_max_kib).ki("retention_days", p.logs_retention_days);
  w.end_obj();
  w.key("notifications").begin_obj();
  w.kb("enabled", p.notifications_enabled).ki("min_interval_s", p.notifications_min_interval_s);
  w.end_obj();
  w.key("reports").begin_obj().ki("scan_interval_s", p.reports_scan_interval_s).end_obj();
  w.key("smart").begin_obj().ki("interval_s", p.smart_interval_s).end_obj();
  w.key("watch_logs").begin_arr();
  for (auto& wl : p.watch_logs) {
    w.begin_obj().ks("path", wl.path).ks("kind", wl.kind);
    w.key("patterns");
    list(wl.patterns);
    w.end_obj();
  }
  w.end_arr();
  w.end_obj();
  return w.out;
}

}  // namespace fgs
