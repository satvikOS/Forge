// forge-guardian-sensor run -- the event-driven sampler the governor supervises.
//
// One process per health domain (fcntl lock on <D>/sensor.lock), a child of the
// governor that must never outlive it (kqueue NOTE_EXIT on --parent plus a per-tick
// check). Everything runs on the main dispatch queue under CFRunLoop; there is no
// fork() here and no signal is ever sent except SIGUSR2 to the verified --parent.
//
// Event sources: memory-pressure dispatch source, NSProcessInfo thermal notification,
// IOKit system power (sleep/wake), SIGTERM/SIGINT/SIGHUP (and SIGUSR1 for test-only
// event injection), and the poll timer. Each publishes through the same function so a
// pressure event and a timer tick produce byte-identical encodings of one snapshot.
#import <Foundation/Foundation.h>

#include "sensor.hpp"

#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOMessage.h>
#include <IOKit/pwr_mgt/IOPMLib.h>
#include <dispatch/dispatch.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstring>
#include <tuple>

namespace fgs {
namespace {

struct WatchState {
  uint64_t ino = 0, dev = 0;
  int64_t off = -1;
  bool known = false;
};

struct RunCtx {
  std::string D, policy_arg;
  int poll_override = 0, poll = 5;
  int parent = 0;
  int64_t parent_start_s = -1, parent_start_us = -1;
  bool parent_is_ppid = false;
  PolicyLoad pl;
  double policy_mtime = -1;
  Sampler sm;
  int lock_fd = -1;
  dispatch_source_t timer = nil, mem_src = nil, parent_src = nil;
  std::vector<dispatch_source_t> sig_srcs;
  io_connect_t root_port = MACH_PORT_NULL;
  IONotificationPortRef notify_port = nullptr;
  io_object_t notifier = 0;
  id thermal_obs = nil;
  std::string last_thermal;
  Session sess;
  uint64_t last_session_mono = 0;
  uint64_t next_report_scan = 0;
  std::map<std::string, WatchState> watch;
  bool watch_dirty = false;
  std::map<std::string, double> watch_last;
  std::map<std::string, int64_t> watch_suppressed;
  // R10: inbox files already ingested whose unlink failed, by identity
  // (dev, ino, size, mtime_ns): skipped while they persist unchanged.
  std::set<std::tuple<uint64_t, uint64_t, int64_t, int64_t>> inbox_done;
  bool stopping = false;
};
RunCtx* g = nullptr;

void ev(Ev& e) {
  if (int err = e.write(g->D)) logf("event append failed (%s): %s", strerror(err), e.line().c_str());
}

// ------------------------------------------------------------------ publish
Snapshot publish(const char* why) {
  Snapshot s = g->sm.sample(true);
  std::string env = encode_env(s), js = encode_json(s);
  std::string t1, t2;
  const char* failed = "sensor.env";
  // Both tmp files are complete and fsync'd before either is renamed, so the pair
  // published is always one snapshot; a failure renames neither and the previous
  // good pair stays (and goes stale, which consumers can see).
  int e = write_tmp(g->D + "/sensor.env", env, t1);
  if (!e) {
    failed = "sensor.json";
    e = write_tmp(g->D + "/sensor.json", js, t2);
    if (e) unlink(t1.c_str());
  }
  if (!e) {
    failed = "sensor.env";
    e = commit_tmp(t1, g->D + "/sensor.env");
    if (e) unlink(t2.c_str());
  }
  if (!e) {
    failed = "sensor.json";
    e = commit_tmp(t2, g->D + "/sensor.json");
  }
  if (e) {
    ++g->sm.errors;
    logf("publish (%s) failed: %s: %s", why, failed, strerror(e));
    Ev x("publish_error");
    x.s("file", failed).i("errno", e).s("error", strerror(e)).s("why", why);
    ev(x);
  }
  return s;
}

void check_thermal(const Snapshot& s) {
  std::string cur = s.thermal_st == ST_OK ? s.thermal : std::string("none");
  if (g->last_thermal.empty()) {
    g->last_thermal = cur;
    return;
  }
  if (cur == g->last_thermal) return;
  logf("thermal %s -> %s", g->last_thermal.c_str(), cur.c_str());
  Ev x("thermal");
  x.s("state", cur).s("prev", g->last_thermal).s("status", st_name(s.thermal_st)).i("seq", (int64_t)s.seq);
  ev(x);
  g->last_thermal = cur;
}

// ------------------------------------------------------------------ policy
void write_policy_env() {
  int e = write_atomic(g->D + "/policy.env", policy_env(g->pl.p, g->pl.source));
  if (e) {
    ++g->sm.errors;
    logf("policy.env not written: %s", strerror(e));
    Ev x("publish_error");
    x.s("file", "policy.env").i("errno", e).s("error", strerror(e));
    ev(x);
  }
}

void arm_timer();

void load_policy_now(const char* why) {
  g->pl = load_policy(g->D, g->policy_arg);
  double mt;
  g->policy_mtime = path_mtime(g->D + "/policy.json", mt, false) ? mt : -1;
  if (!g->pl.error.empty()) {
    logf("policy rejected (%s), using defaults: %s", why, g->pl.error.c_str());
    Ev x("policy_error");
    x.s("error", g->pl.error).s("source", g->pl.source).s("why", why);
    ev(x);
  } else {
    logf("policy loaded (%s) from %s", why, g->pl.source.c_str());
  }
  g->sm.pol = g->pl.p;
  write_policy_env();
  int np = g->poll_override > 0 ? g->poll_override : g->pl.p.poll_s;
  if (np != g->poll) {
    g->poll = np;
    g->sm.poll_s = np;
    if (g->timer) arm_timer();
  }
}

// ------------------------------------------------------------------ session
void session_beat() {
  g->sess.sleeps = g->sm.sleep_n;
  g->sess.last_sleep_ts = g->sm.last_sleep_ts;
  g->sess.last_wake_ts = g->sm.last_wake_ts;
  int e = session_save(g->D, g->sess);
  g->last_session_mono = mono_ms();
  if (e) {
    ++g->sm.errors;
    logf("session/current.json not written: %s", strerror(e));
    Ev x("publish_error");
    x.s("file", "session/current.json").i("errno", e).s("error", strerror(e));
    ev(x);
  }
}

void persist_watch() {
  if (!g->watch_dirty) return;
  JW w;
  w.begin_obj();
  for (auto& [p, s] : g->watch) {
    if (!s.known) continue;
    w.key(p).begin_obj().ki("ino", (int64_t)s.ino).ki("dev", (int64_t)s.dev).ki("off", s.off).end_obj();
  }
  w.end_obj();
  if (write_atomic(g->D + "/session/watch_offsets.json", w.out + "\n") == 0) g->watch_dirty = false;
}

[[noreturn]] void stop(const char* reason) {
  g->stopping = true;
  g->sess.orderly_stop = true;
  g->sess.orderly_stop_ts = now_wall();
  g->sess.stop_reason = reason;
  g->sess.sleeps = g->sm.sleep_n;
  g->sess.last_sleep_ts = g->sm.last_sleep_ts;
  g->sess.last_wake_ts = g->sm.last_wake_ts;
  int e = session_save(g->D, g->sess);
  persist_watch();
  Ev x("sensor_stop");
  x.b("orderly", true).s("reason", reason).i("pid", getpid()).i("session_errno", e);
  ev(x);
  logf("sensor stopping (%s)%s", reason, e ? ", session record NOT written" : "");
  exit(kExitOk);
}

// ------------------------------------------------------------------ parent
bool parent_gone() {
  if (g->parent <= 0) return false;
  if (g->parent_is_ppid && getppid() != g->parent) return true;
  ProcInfo pi = proc_info(g->parent);
  if (!pi.alive) return true;
  if (g->parent_start_s >= 0 && (pi.start_s != g->parent_start_s || pi.start_us != g->parent_start_us)) return true;
  return false;
}

void signal_parent(const char* level) {
  if (g->parent <= 1) return;
  ProcInfo pi = proc_info(g->parent);
  // Identity, not number: the pid must still be the process we were started by.
  if (!pi.alive || g->parent_start_s < 0 || pi.start_s != g->parent_start_s || pi.start_us != g->parent_start_us) {
    logf("pressure %s: NOT signalling pid %d (dead, or no longer the recorded parent)", level, g->parent);
    return;
  }
  if (kill(g->parent, SIGUSR2) != 0) logf("SIGUSR2 to parent %d failed: %s", g->parent, strerror(errno));
  else logf("pressure %s: SIGUSR2 -> parent %d", level, g->parent);
}

// ------------------------------------------------------------------ event handlers
void on_pressure(const char* level, bool injected) {
  g->sm.pevent = level;
  g->sm.pevent_ts = now_wall();
  if (strcmp(level, "warn") == 0) ++g->sm.warn_n;
  if (strcmp(level, "critical") == 0) ++g->sm.crit_n;
  Snapshot s = publish("pressure");
  Ev x("pressure");
  x.s("level", level).i("vmp", s.vmp_st == ST_OK ? (int64_t)s.vmp : -1).i("seq", (int64_t)s.seq);
  if (injected) x.b("injected", true);
  ev(x);
  if (strcmp(level, "normal") != 0) signal_parent(level);
}

void on_will_sleep(bool injected) {
  ++g->sm.sleep_n;
  g->sm.last_sleep_ts = now_wall();
  g->sess.asleep = true;
  Ev x("will_sleep");
  x.i("sleep_n", g->sm.sleep_n);
  if (injected) x.b("injected", true);
  ev(x);
  session_beat();
}

void on_did_wake(bool injected) {
  double now = now_wall();
  double slept = g->sm.last_sleep_ts > 0 ? now - g->sm.last_sleep_ts : -1;
  g->sm.last_wake_ts = now;
  g->sess.asleep = false;
  g->sm.rebaseline = true;  // rates across a sleep are not deltas
  Ev x("did_wake");
  if (slept >= 0) x.n("slept_s", slept); else x.raw("slept_s", "null");
  if (injected) x.b("injected", true);
  ev(x);
  publish("wake");
  session_beat();
}

void power_cb(void*, io_service_t, natural_t msg, void* arg) {
  @autoreleasepool {
    switch (msg) {
      case kIOMessageCanSystemSleep:
        IOAllowPowerChange(g->root_port, (long)arg);  // never veto, never delay
        break;
      case kIOMessageSystemWillSleep:
        // Acknowledge FIRST: sleep is never held for our bookkeeping. The record is a
        // few hundred bytes and is durable long before the system actually sleeps.
        IOAllowPowerChange(g->root_port, (long)arg);
        on_will_sleep(false);
        break;
      case kIOMessageSystemHasPoweredOn:
        on_did_wake(false);
        break;
      default:
        break;
    }
  }
}

void on_usr1() {
  if (!test_mode()) return;  // outside tests SIGUSR1 is ignored, never fatal
  const char* p = test_env("FORGE_SENSOR_INJECT_EVENT");
  if (!p) {
    logf("SIGUSR1 without FORGE_SENSOR_INJECT_EVENT");
    return;
  }
  std::string t;
  if (read_file(p, t, 4096, true) != 0) {
    logf("injected event file %s unreadable", p);
    return;
  }
  std::string w = trim(t);
  if (w == "pressure=warn") on_pressure("warn", true);
  else if (w == "pressure=critical") on_pressure("critical", true);
  else if (w == "pressure=normal") on_pressure("normal", true);
  else if (w == "sleep") on_will_sleep(true);
  else if (w == "wake") on_did_wake(true);
  else if (w == "thermal") { Snapshot s = publish("thermal"); check_thermal(s); }
  else logf("unknown injected event '%s'", w.c_str());
}

// ------------------------------------------------------------------ inbox
// SCHEMA §7: every events.jsonl line is {"ts": <epoch float>, "kind": "<documented>"}.
// An inbox producer (the Forge app, a worker) may report only what it can observe
// itself; the kinds the governor and the sensor own -- a transition, a shed, a
// pressure event, a sensor_stop -- cannot be forged through the inbox (review SEM-7).
bool inbox_kind_ok(const std::string& k) {
  static const std::set<std::string> ok{"gpu_error", "stall", "cancel_latency"};
  return ok.count(k) > 0;
}

// One valid inbox line -> the events.jsonl line, ts and kind FIRST (window_lines and
// every other reader find the top-level ts at the front), or "" when invalid.
std::string inbox_line(NSDictionary* o, NSString* src) {
  id kind = o[@"kind"];
  if (![kind isKindOfClass:[NSString class]] || !inbox_kind_ok(ns_str(kind))) return "";
  id tsv = o[@"ts"];
  double ts = now_wall();
  if (tsv && !ns_num(tsv, ts)) return "";  // present but not a number (or a bool)
  NSMutableDictionary* rest = [o mutableCopy];
  [rest removeObjectsForKeys:@[ @"ts", @"kind", @"source" ]];
  std::string body = ns_compact(rest);
  if (body.size() < 2) return "";
  JW w;
  w.begin_obj().kn("ts", ts, 3).ks("kind", ns_str(kind)).ks("source", ns_str(src));
  std::string head = w.out;  // still open
  std::string inner = body.substr(1, body.size() - 2);
  return head + (inner.empty() ? "" : "," + inner) + "}";
}

std::tuple<uint64_t, uint64_t, int64_t, int64_t> file_id(const struct stat& st) {
  return std::make_tuple((uint64_t)st.st_dev, (uint64_t)st.st_ino, (int64_t)st.st_size,
                         (int64_t)st.st_mtimespec.tv_sec * 1000000000LL + (int64_t)st.st_mtimespec.tv_nsec);
}

void ingest_inbox() {
  std::string dir = g->D + "/events/inbox";
  int err = 0;
  auto names = list_dir(dir, 1024, &err);
  if (err) return;
  std::sort(names.begin(), names.end());
  int files = 0;
  decltype(g->inbox_done) still;  // forget identities whose file is gone
  for (auto& n : names) {
    if (!ends_with(n, ".jsonl") || starts_with(n, ".")) continue;
    std::string p = dir + "/" + n;
    // R10: a file whose unlink failed (an unwritable inbox) was re-ingested in full on
    // EVERY tick -- ~1 MiB/s of duplicates at poll 1, flushing real transitions out of
    // the rotated history. Each file is ingested once; while it persists unchanged it
    // is skipped.
    struct stat st;
    if (lstat(p.c_str(), &st) == 0 && g->inbox_done.count(file_id(st))) {
      still.insert(file_id(st));
      continue;
    }
    if (files >= 64) continue;  // the rest next tick (never `break`: the skip set must see every name)
    ++files;
    std::string t;
    const size_t cap = 256 * 4097;
    int e = read_file(p, t, cap + 1, false);
    if (e) {
      if (e != ENOENT) {
        ++g->sm.inbox_invalid;
        if (unlink(p.c_str()) == 0) {
          logf("inbox %s unreadable (%s); removed", n.c_str(), strerror(e));
        } else {
          int ue = errno;
          logf("inbox %s unreadable (%s) and not removed (%s); skipped while it stays unchanged", n.c_str(),
               strerror(e), strerror(ue));
          struct stat s3;
          if (lstat(p.c_str(), &s3) == 0 && still.size() < 4096) still.insert(file_id(s3));
        }
      }
      continue;
    }
    int64_t ok = 0, bad = 0;
    if (t.size() > cap) {
      t.resize(cap);
      ++bad;  // the remainder past 256 lines x 4 KiB is not ingested
    }
    size_t lines = 0;
    NSString* src = [NSString stringWithUTF8String:n.c_str()] ?: @"?";
    for (auto& raw : split(t, '\n')) {
      std::string line = trim(raw);
      if (line.empty()) continue;
      if (++lines > 256 || line.size() > 4096) { ++bad; continue; }
      @autoreleasepool {
        NSDictionary* o = json_obj(line);
        if (!o) { ++bad; continue; }
        std::string out = inbox_line(o, src);
        if (out.empty()) { ++bad; continue; }
        int we = append_line(g->D + "/events.jsonl", out);
        if (we) { ++g->sm.errors; logf("inbox line not appended: %s", strerror(we)); }
        else ++ok;
      }
    }
    if (unlink(p.c_str()) != 0) {
      int ue = errno;
      struct stat st2;
      if (lstat(p.c_str(), &st2) == 0 && still.size() < 4096) still.insert(file_id(st2));
      logf("inbox %s not removed: %s (ingested once; skipped while it stays unchanged)", n.c_str(), strerror(ue));
    }
    g->sm.inbox_ingested += ok;
    g->sm.inbox_invalid += bad;
    logf("inbox %s: %lld ingested, %lld invalid", n.c_str(), (long long)ok, (long long)bad);
  }
  g->inbox_done.swap(still);
}

// ------------------------------------------------------------------ watch_logs
void watch_line(const WatchLog& wl, const std::string& path, std::string_view line) {
  for (auto& pat : wl.patterns) {
    if (line.find(pat) == std::string_view::npos) continue;
    std::string key = path + '\x1f' + pat;
    double now = now_wall();
    auto it = g->watch_last.find(key);
    if (it != g->watch_last.end() && now - it->second < 60 && now >= it->second) {
      ++g->watch_suppressed[key];  // identical hits: one event per 60 s
      return;
    }
    g->watch_last[key] = now;
    int64_t sup = g->watch_suppressed[key];
    g->watch_suppressed[key] = 0;
    std::string l(line.substr(0, 512));
    Ev x(wl.kind);
    x.s("source", path).s("pattern", pat).s("line", l).i("suppressed", sup);
    ev(x);
    IncidentReq rq;
    rq.kind = "gpu_error";
    rq.rate_key = "gpu_error";
    rq.window_min = 10;
    rq.note = pat + " in " + path + ": " + one_line(l, 300);
    std::string dir, err;
    if (make_incident(g->D, g->pl.p, rq, dir, err) == 0) logf("incident %s", dir.c_str());
    return;  // one event per line
  }
}

void watch_logs_tick() {
  for (auto& wl : g->pl.p.watch_logs) {
    std::string path = expand_tilde(wl.path);
    struct stat st;
    if (stat(path.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) continue;
    WatchState& ws = g->watch[path];
    if (!ws.known) {
      // First sight of this file: history is not news. Start at its end.
      ws = WatchState{(uint64_t)st.st_ino, (uint64_t)st.st_dev, (int64_t)st.st_size, true};
      g->watch_dirty = true;
      continue;
    }
    if ((uint64_t)st.st_ino != ws.ino || (uint64_t)st.st_dev != ws.dev || st.st_size < ws.off) {
      // rotated or truncated: everything in the file now is new
      ws.ino = (uint64_t)st.st_ino;
      ws.dev = (uint64_t)st.st_dev;
      ws.off = 0;
      g->watch_dirty = true;
    }
    if (st.st_size <= ws.off) continue;
    size_t want = (size_t)std::min<int64_t>(64 * 1024, st.st_size - ws.off);
    int fd = open(path.c_str(), O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) continue;
    std::string buf(want, '\0');
    ssize_t n = pread(fd, buf.data(), want, ws.off);
    close(fd);
    if (n <= 0) continue;
    buf.resize((size_t)n);
    size_t last_nl = buf.rfind('\n');
    size_t consumed;
    if (last_nl == std::string::npos) {
      if (buf.size() < 64 * 1024) continue;  // a partial line: wait for its end
      consumed = buf.size();                // one enormous line: take the 64 KiB
    } else {
      consumed = last_nl + 1;
    }
    std::string_view v(buf.data(), consumed);
    size_t i = 0;
    while (i < v.size()) {
      size_t nl = v.find('\n', i);
      if (nl == std::string_view::npos) nl = v.size();
      watch_line(wl, path, v.substr(i, nl - i));
      i = nl + 1;
    }
    ws.off += (int64_t)consumed;
    g->watch_dirty = true;
  }
  persist_watch();
}

void load_watch() {
  std::string t;
  if (read_file(g->D + "/session/watch_offsets.json", t, 64 * 1024, false) != 0) return;
  @autoreleasepool {
    NSDictionary* d = json_obj(t);
    for (NSString* k in d) {
      NSDictionary* e = d[k];
      if (![e isKindOfClass:[NSDictionary class]]) continue;
      double ino, dev, off;
      if (ns_num(e[@"ino"], ino) && ns_num(e[@"dev"], dev) && ns_num(e[@"off"], off) && off >= 0)
        g->watch[ns_str(k)] = WatchState{(uint64_t)ino, (uint64_t)dev, (int64_t)off, true};
    }
  }
}

// ------------------------------------------------------------------ reports
void write_baseline(const std::vector<std::string>& dirs, double now) {
  auto reps = scan_reports(dirs, now - 30 * 86400.0, now + 1, 5000, false);
  std::map<std::string, std::vector<const Report*>> by;
  for (auto& r : reps) by[r.category].push_back(&r);
  JW w;
  w.begin_obj().ks("schema", "forge.guardian.reports_baseline/1").kn("ts", now, 3).ks("iso", iso_utc(now));
  w.ki("window_days", 30);
  w.key("dirs").begin_arr();
  for (auto& d : dirs) w.str(d);
  w.end_arr();
  w.ki("total", (int64_t)reps.size());
  w.key("categories").begin_obj();
  int deep = 0;
  for (auto& [cat, v] : by) {
    w.key(cat).begin_obj().ki("count", (int64_t)v.size()).kn("latest", v.back()->mtime, 3);
    w.ks("latest_iso", iso_utc(v.back()->mtime));
    w.key("files").begin_arr();
    for (size_t k = v.size() > 10 ? v.size() - 10 : 0; k < v.size(); ++k) w.str(v[k]->name);
    w.end_arr();
    if (cat == "jetsam" || cat == "panic") {
      w.key("details").begin_arr();
      for (size_t k = v.size() > 20 ? v.size() - 20 : 0; k < v.size(); ++k) {
        if (++deep > 50) break;
        Report r = analyze_report(v[k]->dir, v[k]->name, v[k]->mtime, v[k]->size, true);
        report_json(w, r);
      }
      w.end_arr();
    }
    w.end_obj();
  }
  w.end_obj();
  w.end_obj();
  int e = write_atomic(g->D + "/session/reports_baseline.json", w.out + "\n");
  logf("reports baseline: %zu reports over 30 days in %zu categories (errno %d)", reps.size(), by.size(), e);
}

// session/report_seen: the keys (report_key: "<mtime s> <name>") of reports already
// emitted or baselined whose mtime is inside the rescan window or in the future.
std::set<std::string> load_seen(const std::string& path) {
  std::set<std::string> s;
  std::string t;
  if (read_file(path, t, 4 * 1024 * 1024, false) != 0) return s;
  for (auto& l : split(t, '\n'))
    if (!l.empty()) s.insert(l);
  return s;
}
void save_seen(const std::string& path, const std::set<std::string>& seen, double keep_after) {
  std::vector<std::pair<int64_t, const std::string*>> v;
  for (auto& k : seen) {
    int64_t m;
    size_t sp = k.find(' ');
    if (sp == std::string::npos || !parse_i64(k.substr(0, sp), m) || k.find('\n') != std::string::npos) continue;
    if ((double)m + 1 < keep_after) continue;  // below every future rescan window
    v.emplace_back(m, &k);
  }
  std::sort(v.begin(), v.end(), [](auto& a, auto& b) { return a.first > b.first; });
  if (v.size() > 5000) v.resize(5000);
  std::string out;
  for (auto& [m, k] : v) { out += *k; out += '\n'; }
  write_atomic(path, out);
}

// Reports are found by mtime but REMEMBERED by key. Each scan looks back over
// (min(watermark, now - scan interval - 120 s), +inf): a report that became visible
// late, or was moved into Retired/ (a move keeps the mtime: same key), is caught once
// and never twice.
//
// R8 (review 2026-10-08): the watermark used to be the newest mtime seen, never
// clamped. After a backward clock step it sat in the future and every panic and GPU
// report dated before it -- the whole length of the step -- was skipped. A watermark
// more than 5 s in the future is now treated as a clock step: the scan restarts from
// the rescan window and the seen set keeps already-emitted reports from repeating.
void reports_scan() {
  std::string wm_path = g->D + "/session/report_watermark";
  std::string seen_path = g->D + "/session/report_seen";
  auto dirs = report_dirs();
  double now = now_wall();
  double look = (double)reports_scan_interval_s(g->pl.p) + 120.0;
  std::string t;
  double wm = 0;
  if (read_file(wm_path, t, 64, false) != 0 || !parse_dbl(trim(t), wm)) {
    // First run ever: summarize history, emit nothing. Old reports are not news, and
    // neither is anything a later rescan window would still see.
    write_baseline(dirs, now);
    std::set<std::string> seen;
    for (auto& r : scan_reports(dirs, now - look, 1e15, 5000, false)) seen.insert(report_key(r.name, r.mtime));
    save_seen(seen_path, seen, now - look);
    write_atomic(wm_path, fmt_num(std::ceil(now * 1e6) / 1e6, 6) + "\n");
    return;
  }
  double lo;
  if (wm > now + 5) {
    logf("report watermark %.0f is %.0f s in the future (clock stepped back?): rescanning from now - %.0f s", wm,
         wm - now, look);
    lo = now - look;
  } else {
    lo = std::min(wm, now - look);
  }
  std::set<std::string> seen = load_seen(seen_path);
  std::vector<Report> fresh;
  for (auto& r : scan_reports(dirs, lo, 1e15, 500, false))
    if (!seen.count(report_key(r.name, r.mtime))) fresh.push_back(r);
  if (fresh.size() > 200) fresh.erase(fresh.begin(), fresh.end() - 200);  // the newest
  for (auto& r0 : fresh) {
    Report r = analyze_report(r0.dir, r0.name, r0.mtime, r0.size, true);
    seen.insert(report_key(r.name, r.mtime));
    Ev x("report");
    x.s("category", r.category).s("file", r.path).n("mtime", r.mtime);
    if (r.bug_type.empty()) x.raw("bug_type", "null"); else x.s("bug_type", r.bug_type);
    x.s("summary", r.summary);
    if (r.category == "jetsam") x.b("per_process_limit_only", r.per_process_only);
    ev(x);
    if (r.incident_worthy()) {
      IncidentReq rq;
      rq.kind = "report";
      rq.rate_key = "report:" + r.category;
      rq.note = r.summary + " (" + r.path + ")";
      std::string dir, err;
      int rc = make_incident(g->D, g->pl.p, rq, dir, err);
      if (rc == 0) logf("incident %s for %s", dir.c_str(), r.name.c_str());
      else logf("no incident for %s: %s", r.name.c_str(), err.c_str());
    }
  }
  save_seen(seen_path, seen, lo);  // also prunes keys below the next rescan window
  write_atomic(wm_path, fmt_num(std::ceil(now * 1e6) / 1e6, 6) + "\n");
}

// ------------------------------------------------------------------ tick
void tick() {
  @autoreleasepool {
    if (g->stopping) return;
    if (parent_gone()) stop("parent_exit");
    double mt;
    double pm = path_mtime(g->D + "/policy.json", mt, false) ? mt : -1;
    if (pm != g->policy_mtime) load_policy_now("policy.json changed");
    Snapshot s = publish("tick");
    check_thermal(s);
    uint64_t m = mono_ms();
    if (m - g->last_session_mono >= 60000) session_beat();
    ingest_inbox();
    watch_logs_tick();
    if (m >= g->next_report_scan) {
      reports_scan();
      g->next_report_scan = mono_ms() + (uint64_t)reports_scan_interval_s(g->pl.p) * 1000;
    }
    uint64_t rot = (uint64_t)g->pl.p.logs_rotate_mib * 1048576ULL;
    rotate_if_needed(g->D + "/events.jsonl", rot, g->pl.p.logs_generations);
    rotate_if_needed(g->D + "/log/sensor.log", rot, g->pl.p.logs_generations);
  }
}

void arm_timer() {
  if (g->timer) dispatch_source_cancel(g->timer);
  g->timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
  uint64_t ns = (uint64_t)g->poll * NSEC_PER_SEC;
  dispatch_source_set_timer(g->timer, dispatch_time(DISPATCH_TIME_NOW, (int64_t)ns), ns, ns / 10);
  dispatch_source_set_event_handler(g->timer, ^{ tick(); });
  dispatch_resume(g->timer);
}

void add_signal(int sig, void (^handler)(void)) {
  signal(sig, SIG_IGN);  // the dispatch source sees it; the default action never runs
  dispatch_source_t s = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, (uintptr_t)sig, 0, dispatch_get_main_queue());
  dispatch_source_set_event_handler(s, handler);
  dispatch_resume(s);
  g->sig_srcs.push_back(s);
}

int run_usage(const std::string& why) {
  fprintf(stderr,
          "forge-guardian-sensor run: %s\n"
          "usage: forge-guardian-sensor run --state-dir D [--poll S] [--parent PID] [--policy FILE]\n",
          why.c_str());
  return kExitUsage;
}

}  // namespace

int cmd_run(int argc, char** argv) {
  Args a = parse_args(argc, argv, 2, {"state-dir", "poll", "parent", "policy"}, {});
  if (!a.error.empty()) return run_usage(a.error);
  if (!a.pos.empty()) return run_usage("unexpected argument " + a.pos[0]);
  std::string D = a.get("state-dir");
  if (D.empty() || D[0] != '/') return run_usage("--state-dir must be an absolute path");
  int64_t poll = 0, parent = 0;
  // SCHEMA §6: poll_s 1-60, the same range policy.json and the governor accept (review
  // R2: policy accepted 4000, this refused it, and the sensor never started again).
  if (a.has("poll") && (!parse_i64(a.get("poll"), poll) || poll < 1 || poll > 60))
    return run_usage("--poll must be 1..60 seconds");
  if (a.has("parent") && (!parse_i64(a.get("parent"), parent) || parent <= 1 || parent > INT32_MAX))
    return run_usage("--parent must be a pid > 1");

  umask(077);
  if (int e = mkdirs(D)) {
    fprintf(stderr, "forge-guardian-sensor run: cannot create %s: %s\n", D.c_str(), strerror(e));
    return kExitInternal;
  }
  // single instance per domain
  std::string lp = D + "/sensor.lock";
  int fd = open(lp.c_str(), O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (fd < 0) {
    fprintf(stderr, "forge-guardian-sensor run: cannot open %s: %s\n", lp.c_str(), strerror(errno));
    return kExitInternal;
  }
  struct flock fl;
  memset(&fl, 0, sizeof fl);
  fl.l_type = F_WRLCK;
  fl.l_whence = SEEK_SET;
  if (fcntl(fd, F_SETLK, &fl) != 0) {
    int e = errno;
    if (e == EAGAIN || e == EACCES) {
      struct flock q;
      memset(&q, 0, sizeof q);
      q.l_type = F_WRLCK;
      q.l_whence = SEEK_SET;
      pid_t holder = 0;
      if (fcntl(fd, F_GETLK, &q) == 0 && q.l_type != F_UNLCK) holder = q.l_pid;
      fprintf(stderr,
              "forge-guardian-sensor run: a sensor (pid %d) already runs for %s; refusing a second instance\n",
              (int)holder, D.c_str());
      return kExitDup;
    }
    fprintf(stderr, "forge-guardian-sensor run: cannot lock %s: %s\n", lp.c_str(), strerror(e));
    return kExitInternal;
  }
  if (ftruncate(fd, 0) == 0) {
    std::string pidline = std::to_string(getpid()) + "\n";
    if (pwrite(fd, pidline.data(), pidline.size(), 0) < 0) { /* the lock, not the text, is authoritative */ }
  }
  for (const char* sub : {"/session", "/log", "/events/inbox"}) mkdirs(D + sub);
  log_open(D);
  // A sensor killed mid-publish leaves <name>.tmp.<pid>. We hold the domain's sensor
  // lock, so every such file of OURS is stale; nothing else is touched.
  for (const std::string& dir : {D, D + "/session"}) {
    int le = 0;
    for (auto& n : list_dir(dir, 4096, &le)) {
      static const char* mine[] = {"sensor.env.tmp.", "sensor.json.tmp.", "policy.env.tmp.", "current.json.tmp.",
                                   "previous.json.tmp.", "watch_offsets.json.tmp.", "report_watermark.tmp.",
                                   "reports_baseline.json.tmp.", "report_seen.tmp."};
      for (const char* m : mine)
        if (starts_with(n, m)) unlink((dir + "/" + n).c_str());
    }
  }

  g = new RunCtx();
  g->D = D;
  g->lock_fd = fd;
  g->policy_arg = a.get("policy");
  g->poll_override = (int)poll;
  g->sm.state_dir = D;
  g->poll = 0;
  load_policy_now("start");
  if (g->poll <= 0) g->poll = g->poll_override > 0 ? g->poll_override : g->pl.p.poll_s;
  g->sm.poll_s = g->poll;

  if (parent > 0) {
    g->parent = (int)parent;
    ProcInfo pi = proc_info(g->parent);
    if (!pi.alive) {
      fprintf(stderr, "forge-guardian-sensor run: --parent %lld is not alive\n", (long long)parent);
      logf("refusing to start: parent %lld not alive", (long long)parent);
      return kExitDeny;
    }
    g->parent_start_s = pi.start_s;
    g->parent_start_us = pi.start_us;
    g->parent_is_ppid = getppid() == g->parent;
    g->parent_src = dispatch_source_create(DISPATCH_SOURCE_TYPE_PROC, (uintptr_t)g->parent, DISPATCH_PROC_EXIT,
                                           dispatch_get_main_queue());
    if (g->parent_src) {
      dispatch_source_set_event_handler(g->parent_src, ^{ stop("parent_exit"); });
      dispatch_resume(g->parent_src);
    }
  }

  load_watch();
  // session continuity: classify the previous record, then start a new one
  g->sess.boot_uuid = boot_uuid();
  g->sess.boot_epoch = boot_epoch();
  g->sess.sensor_start = now_wall();
  std::string cls = session_begin(D, g->sess, report_dirs());
  session_beat();
  if (cls == "kernel_panic" || cls == "unclean_unknown") {
    IncidentReq rq;
    rq.kind = "unclean_boot";
    rq.note = "previous session classified " + cls;
    rq.window_min = 10;
    std::string dir, err;
    if (make_incident(D, g->pl.p, rq, dir, err) == 0) logf("incident %s", dir.c_str());
  }

  // event sources
  add_signal(SIGTERM, ^{ stop("sigterm"); });
  add_signal(SIGINT, ^{ stop("sigint"); });
  add_signal(SIGHUP, ^{ @autoreleasepool { load_policy_now("SIGHUP"); } });
  add_signal(SIGUSR1, ^{ @autoreleasepool { on_usr1(); } });
  signal(SIGUSR2, SIG_IGN);
  signal(SIGPIPE, SIG_IGN);

  g->mem_src = dispatch_source_create(DISPATCH_SOURCE_TYPE_MEMORYPRESSURE, 0,
                                      DISPATCH_MEMORYPRESSURE_NORMAL | DISPATCH_MEMORYPRESSURE_WARN |
                                          DISPATCH_MEMORYPRESSURE_CRITICAL,
                                      dispatch_get_main_queue());
  if (g->mem_src) {
    dispatch_source_set_event_handler(g->mem_src, ^{
      @autoreleasepool {
        unsigned long lv = dispatch_source_get_data(g->mem_src);
        if (lv & DISPATCH_MEMORYPRESSURE_CRITICAL) on_pressure("critical", false);
        else if (lv & DISPATCH_MEMORYPRESSURE_WARN) on_pressure("warn", false);
        else if (lv & DISPATCH_MEMORYPRESSURE_NORMAL) on_pressure("normal", false);
      }
    });
    dispatch_resume(g->mem_src);
    g->sm.pevent_armed = true;
  } else {
    logf("memory-pressure source unavailable: pevent will publish unavailable");
  }

  g->thermal_obs = [[NSNotificationCenter defaultCenter]
      addObserverForName:NSProcessInfoThermalStateDidChangeNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification*) {
                dispatch_async(dispatch_get_main_queue(), ^{
                  @autoreleasepool {
                    if (g->stopping) return;
                    Snapshot s = publish("thermal");
                    check_thermal(s);
                  }
                });
              }];

  g->root_port = IORegisterForSystemPower(nullptr, &g->notify_port, power_cb, &g->notifier);
  if (g->root_port == MACH_PORT_NULL || !g->notify_port) {
    logf("IORegisterForSystemPower failed: sleep/wake will not be recorded");
  } else {
    IONotificationPortSetDispatchQueue(g->notify_port, dispatch_get_main_queue());
  }

  {
    Ev x("sensor_start");
    x.s("version", kVersion).i("pid", getpid()).i("parent", g->parent).i("poll_s", g->poll);
    x.s("policy_source", g->pl.source);
    if (!g->pl.error.empty()) x.s("policy_error", g->pl.error);
    if (cls.empty()) x.raw("session", "null"); else x.s("session", cls);
    x.s("boot_uuid", g->sess.boot_uuid);
    ev(x);
  }
  logf("sensor %s started: D=%s poll=%ds parent=%d session=%s", kVersion, D.c_str(), g->poll, g->parent,
       cls.empty() ? "(first)" : cls.c_str());
  if (std::find(g->pl.p.required_signals.begin(), g->pl.p.required_signals.end(), "thermal") ==
      g->pl.p.required_signals.end())
    logf("policy: required_signals omits thermal (allowed only where thermal is unavailable by design)");

  // the parent may have died while we were starting
  if (parent_gone()) stop("parent_exit");
  tick();
  arm_timer();
  CFRunLoopRun();
  return kExitOk;
}

}  // namespace fgs
