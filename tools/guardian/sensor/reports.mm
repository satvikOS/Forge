// forge-guardian-sensor -- DiagnosticReports classification and incident bundles
// (SCHEMA §10).
//
// A Jetsam report is not evidence of system-wide memory exhaustion by itself. The one
// on this machine at the time of writing (JetsamEvent-2026-10-07-181917.ips) killed a
// single process, knowledgeconstructiond, for exceeding its OWN per-process limit,
// while the largest process was a Python trainer. Calling that "the machine ran out of
// memory" would be a diagnosis the evidence does not support, so the summary says
// which kind of Jetsam it was.
#import <Foundation/Foundation.h>

#include "sensor.hpp"

#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstring>

extern char** environ;

namespace fgs {

// THE GAP THIS CLOSES (review 2026-10-08 SEM-1): macOS moves EVERY report into
// <dir>/Retired at its daily run -- one born 47 s earlier included. Scanning only the
// top level lost every JetsamEvent on this Mac, among them the one real system-wide
// compressor-exhaustion kill (JetsamEvent-2026-10-03-215334.ips), from the baseline,
// from incidents and from `reports`. A move keeps the mtime, so report_key() makes a
// report seen in one place and later in the other the same report.
std::vector<std::string> report_dirs() {
  std::vector<std::string> base;
  if (const char* e = test_env("FORGE_SENSOR_TEST_REPORT_DIRS")) {
    for (auto& d : split(e, ':'))
      if (!d.empty()) base.push_back(d);
  } else {
    base = {"/Library/Logs/DiagnosticReports", home_dir() + "/Library/Logs/DiagnosticReports"};
  }
  std::vector<std::string> out;
  for (auto& d : base) {
    out.push_back(d);
    out.push_back(d + "/Retired");
  }
  return out;
}

std::string report_key(const std::string& name, double mtime) {
  return std::to_string((int64_t)std::floor(mtime)) + " " + name;
}

std::string classify_report_name(const std::string& name) {
  std::string lo = lower(name);
  if (ends_with(lo, ".panic") || starts_with(lo, "panic-full-")) return "panic";
  if (starts_with(name, "JetsamEvent-") && ends_with(lo, ".ips")) return "jetsam";
  if (contains(name, "GPU") || contains(name, "gpuRestart") || contains(name, "AGX")) return "gpu";
  if (starts_with(name, "WindowServer")) return "windowserver";
  if (ends_with(lo, ".shutdownstall")) return "shutdown_stall";
  if (ends_with(lo, ".ips") || ends_with(lo, ".crash")) {
    if (starts_with(lo, "forge") || starts_with(lo, "python") || contains(lo, "mlx")) return "app_crash";
  }
  if (ends_with(lo, ".diag")) return "resource";
  return "other";
}

bool Report::incident_worthy() const {
  if (category == "panic" || category == "gpu" || category == "windowserver" || category == "shutdown_stall")
    return true;
  if (category == "jetsam") return jetsam_parsed && !kill_reasons.empty() && !per_process_only;
  return false;
}

static void analyze_jetsam(Report& r, std::string_view body) {
  @autoreleasepool {
    NSDictionary* d = json_obj(body);
    if (!d) return;
    r.jetsam_parsed = true;
    r.largest = ns_str(d[@"largestProcess"]);
    std::set<std::string> reasons;
    id procs = d[@"processes"];
    if ([procs isKindOfClass:[NSArray class]]) {
      size_t n = 0;
      for (id p in (NSArray*)procs) {
        if (++n > 8192) break;
        if (![p isKindOfClass:[NSDictionary class]]) continue;
        std::string reason = ns_str(((NSDictionary*)p)[@"reason"]);
        if (reason.empty()) continue;
        reasons.insert(reason);
        if (r.killed.size() < 16) r.killed.push_back(ns_str(((NSDictionary*)p)[@"name"]) + "(" + reason + ")");
      }
    }
    r.kill_reasons.assign(reasons.begin(), reasons.end());
    r.per_process_only = !reasons.empty() && reasons.size() == 1 && *reasons.begin() == "per-process-limit";
    std::string killed;
    for (auto& k : r.killed) killed += (killed.empty() ? "" : ", ") + k;
    if (reasons.empty()) {
      r.summary = "jetsam: no kills recorded; largest process " + (r.largest.empty() ? "?" : r.largest);
    } else if (r.per_process_only) {
      r.summary = "per-process limit, not system-wide exhaustion: killed " + killed + "; largest process " +
                  (r.largest.empty() ? "?" : r.largest);
    } else {
      std::string rs;
      for (auto& x : r.kill_reasons) rs += (rs.empty() ? "" : ",") + x;
      r.summary = "system memory pressure kill (reasons " + rs + "): killed " + killed + "; largest process " +
                  (r.largest.empty() ? "?" : r.largest);
    }
  }
}

Report analyze_report(const std::string& dir, const std::string& name, double mtime, int64_t size, bool deep) {
  Report r;
  r.dir = dir;
  r.name = name;
  r.path = dir + "/" + name;
  r.mtime = mtime;
  r.size = size;
  r.category = classify_report_name(name);
  r.summary = r.category + ": " + name;
  if (!deep) return r;
  std::string lo = lower(name);
  bool ips = ends_with(lo, ".ips");
  bool panic = r.category == "panic";
  if (!ips && !panic) return r;
  // .ips: the first line is a JSON header carrying bug_type; Jetsam bodies follow it.
  size_t cap = r.category == "jetsam" ? 4u * 1024 * 1024 : 8192;
  std::string text;
  int e = read_file(r.path, text, cap, /*follow=*/false);
  if (e) {
    r.readable = false;
    r.summary += " (unreadable: " + std::string(strerror(e)) + ")";
    return r;
  }
  size_t nl = text.find('\n');
  std::string first = text.substr(0, std::min<size_t>(nl == std::string::npos ? text.size() : nl, 4096));
  @autoreleasepool {
    NSDictionary* h = json_obj(first);
    if (h) {
      id bt = h[@"bug_type"];
      double d;
      if ([bt isKindOfClass:[NSString class]]) r.bug_type = ns_str(bt);
      else if (ns_num(bt, d)) r.bug_type = fmt_num(d, 0);
      if (panic) {
        std::string ps = ns_str(h[@"panic_string"]);
        if (!ps.empty()) {
          size_t pnl = ps.find('\n');
          r.panic_line = one_line(ps.substr(0, pnl), 300);
          r.summary = "panic: " + r.panic_line;
        }
      }
    }
  }
  if (r.category == "jetsam" && nl != std::string::npos) analyze_jetsam(r, std::string_view(text).substr(nl + 1));
  return r;
}

std::vector<Report> scan_reports(const std::vector<std::string>& dirs, double since, double until, size_t max,
                                 bool deep) {
  std::vector<Report> out;
  for (auto& d : dirs) {
    int err = 0;
    std::vector<std::string> names = list_dir(d, 20000, &err);
    if (err) continue;
    for (auto& n : names) {
      std::string p = d + "/" + n;
      struct stat st;
      if (lstat(p.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) continue;
      double mt = (double)st.st_mtimespec.tv_sec + (double)st.st_mtimespec.tv_nsec / 1e9;
      if (!(mt > since && mt <= until)) continue;
      out.push_back(Report{});
      out.back().dir = d;
      out.back().name = n;
      out.back().mtime = mt;
      out.back().size = (int64_t)st.st_size;
    }
  }
  // One report, one entry: the copy in the first directory listed (the top level
  // before its Retired/) wins over the same report found again after a move.
  {
    std::set<std::string> seen;
    std::vector<Report> uniq;
    uniq.reserve(out.size());
    for (auto& r : out)
      if (seen.insert(report_key(r.name, r.mtime)).second) uniq.push_back(std::move(r));
    out.swap(uniq);
  }
  std::stable_sort(out.begin(), out.end(), [](const Report& a, const Report& b) { return a.mtime < b.mtime; });
  if (out.size() > max) out.erase(out.begin(), out.end() - (long)max);  // keep the newest
  for (auto& r : out) r = analyze_report(r.dir, r.name, r.mtime, r.size, deep);
  return out;
}

void report_json(JW& w, const Report& r) {
  w.begin_obj();
  w.ks("file", r.name).ks("path", r.path).ks("category", r.category);
  w.kn("mtime", r.mtime, 3).ks("iso", iso_utc(r.mtime)).ki("size", r.size);
  if (r.bug_type.empty()) w.knull("bug_type"); else w.ks("bug_type", r.bug_type);
  w.ks("summary", r.summary);
  if (!r.readable) w.kb("readable", false);
  if (r.category == "jetsam") {
    w.key("jetsam").begin_obj();
    w.kb("parsed", r.jetsam_parsed);
    if (r.largest.empty()) w.knull("largest_process"); else w.ks("largest_process", r.largest);
    w.key("kill_reasons").begin_arr();
    for (auto& k : r.kill_reasons) w.str(k);
    w.end_arr();
    w.key("killed").begin_arr();
    for (auto& k : r.killed) w.str(k);
    w.end_arr();
    w.kb("per_process_limit_only", r.per_process_only);
    w.end_obj();
  }
  w.kb("incident_worthy", r.incident_worthy());
  w.end_obj();
}

int cmd_reports(int argc, char** argv) {
  Args a = parse_args(argc, argv, 2, {"since", "until", "dirs", "max"}, {});
  double since = 0, until = 0;
  if (!a.error.empty() || !a.pos.empty() || !a.has("since") || !parse_dbl(a.get("since"), since)) {
    fprintf(stderr, "usage: forge-guardian-sensor reports --since EPOCH [--until EPOCH] [--dirs a:b] [--max N]\n");
    return kExitUsage;
  }
  until = now_wall() + 1;
  if (a.has("until") && !parse_dbl(a.get("until"), until)) return kExitUsage;
  int64_t mx = 500;
  if (a.has("max") && (!parse_i64(a.get("max"), mx) || mx < 1)) return kExitUsage;
  std::vector<std::string> dirs;
  if (a.has("dirs")) {
    for (auto& d : split(a.get("dirs"), ':'))
      if (!d.empty()) dirs.push_back(d);
  } else {
    dirs = report_dirs();
  }
  // mtime >= since: the boundary second is included for a caller asking "since T".
  auto rs = scan_reports(dirs, since - 1e-6, until, (size_t)mx, true);
  JW w;
  w.begin_arr();
  for (auto& r : rs) report_json(w, r);
  w.end_arr();
  w.out += '\n';
  fwrite(w.out.data(), 1, w.out.size(), stdout);
  return fflush(stdout) == 0 ? kExitOk : kExitInternal;
}

// ---------------------------------------------------------------- incidents
bool incident_kind_known(const std::string& k) {
  return k == "manual" || k == "red" || k == "crash_loop" || k == "unclean_boot" || k == "report" ||
         k == "gpu_error";
}

// The line's TOP-LEVEL numeric `field`. Fast path: the field is the first member
// (every producer writes ts/t first: `{"ts":` or `{"ts": `). Otherwise the line is
// parsed: the first '"ts":' anywhere in the text can be a NESTED key, which silently
// dropped or mis-windowed inbox lines (review 2026-10-08 SEM-7).
static bool line_time(std::string_view line, const char* field, double& t) {
  size_t i = 0;
  auto ws = [&] { while (i < line.size() && (line[i] == ' ' || line[i] == '\t')) ++i; };
  ws();
  if (i < line.size() && line[i] == '{') {
    ++i;
    ws();
    std::string key = std::string("\"") + field + "\"";
    if (line.substr(i, key.size()) == key) {
      i += key.size();
      ws();
      if (i < line.size() && line[i] == ':') {
        ++i;
        ws();
        std::string num(line.substr(i, std::min<size_t>(32, line.size() - i)));
        char* end = nullptr;
        double v = strtod(num.c_str(), &end);
        if (end && end != num.c_str() && std::isfinite(v)) { t = v; return true; }
        return false;
      }
    }
  }
  @autoreleasepool {
    NSDictionary* o = json_obj(line);
    double v;
    if (o && ns_num(o[[NSString stringWithUTF8String:field]], v)) { t = v; return true; }
  }
  return false;
}

// The last lines of a JSONL file whose top-level numeric `field` is >= since, newest
// kept, within cap bytes.
static std::string window_lines(const std::string& path, const char* field, double since, size_t cap,
                                int64_t& nlines, bool& truncated) {
  nlines = 0;
  truncated = false;
  std::string tail;
  if (read_tail(path, tail, 8u * 1024 * 1024) != 0) return "";
  std::vector<std::string_view> keep;
  size_t i = 0;
  std::string_view tv(tail);
  while (i < tv.size()) {
    size_t nl = tv.find('\n', i);
    if (nl == std::string_view::npos) nl = tv.size();
    std::string_view line = tv.substr(i, nl - i);
    i = nl + 1;
    double t;
    if (!line_time(line, field, t)) continue;
    if (t >= since) keep.push_back(line);
  }
  size_t total = 0;
  size_t first = keep.size();
  while (first > 0 && total + keep[first - 1].size() + 1 <= cap) {
    total += keep[first - 1].size() + 1;
    --first;
  }
  truncated = first > 0;
  std::string out;
  out.reserve(total);
  for (size_t k = first; k < keep.size(); ++k) {
    out.append(keep[k]);
    out += '\n';
  }
  nlines = (int64_t)(keep.size() - first);
  return out;
}

// /usr/bin/log show over the window, posix_spawn (never a shell), 30 s timeout. The
// LAST `cap` bytes are kept (the end of the window is nearest the incident); the read
// itself is bounded at 64 MiB. Only our own child is ever signalled.
//
// The predicate keeps every kernel message, and only errors/faults from WindowServer
// and the GPU stack: at default level WindowServer alone logs ~1.4 MB a minute on this
// machine (measured 2026-10-08), which would fill the cap with RunningBoard chatter.
static std::string unified_log(double start, double end, size_t cap, std::string& status) {
  int pfd[2];
  if (pipe(pfd) != 0) { status = std::string("inaccessible: pipe: ") + strerror(errno); return ""; }
  fcntl(pfd[0], F_SETFD, FD_CLOEXEC);
  posix_spawn_file_actions_t fa;
  posix_spawn_file_actions_init(&fa);
  posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0);
  posix_spawn_file_actions_adddup2(&fa, pfd[1], 1);
  posix_spawn_file_actions_adddup2(&fa, pfd[1], 2);
  posix_spawn_file_actions_addclose(&fa, pfd[0]);
  posix_spawn_file_actions_addclose(&fa, pfd[1]);
  std::string s0 = local_stamp(start), s1 = local_stamp(end);
  const char* pred =
      "process == \"kernel\" OR ((process == \"WindowServer\" OR subsystem CONTAINS[c] \"gpu\" OR "
      "subsystem BEGINSWITH \"com.apple.Metal\" OR sender BEGINSWITH \"AGX\" OR sender BEGINSWITH \"IOGPU\") "
      "AND (messageType == error OR messageType == fault))";
  const char* av[] = {"/usr/bin/log", "show", "--style", "compact", "--start", s0.c_str(), "--end", s1.c_str(),
                      "--predicate", pred, nullptr};
  pid_t child = -1;
  int rc = posix_spawn(&child, "/usr/bin/log", &fa, nullptr, const_cast<char* const*>(av), environ);
  posix_spawn_file_actions_destroy(&fa);
  close(pfd[1]);
  if (rc != 0) {
    close(pfd[0]);
    status = std::string("inaccessible: posix_spawn: ") + strerror(rc);
    return "";
  }
  std::string out;
  uint64_t deadline = mono_ms() + 30000;
  bool timed_out = false, over = false, head_dropped = false;
  size_t total = 0;
  char buf[16384];
  for (;;) {
    uint64_t now = mono_ms();
    if (now >= deadline) { timed_out = true; break; }
    struct pollfd p = {pfd[0], POLLIN, 0};
    int pr = poll(&p, 1, (int)std::min<uint64_t>(deadline - now, 1000));
    if (pr < 0 && errno == EINTR) continue;
    if (pr <= 0) continue;
    ssize_t n = read(pfd[0], buf, sizeof buf);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) break;
    out.append(buf, (size_t)n);
    total += (size_t)n;
    if (out.size() > 2 * cap) {  // keep a sliding tail
      out.erase(0, out.size() - cap);
      head_dropped = true;
    }
    if (total > 64u * 1024 * 1024) { over = true; break; }
  }
  close(pfd[0]);
  if (timed_out || over) kill(child, SIGKILL);
  int wst = 0;
  while (waitpid(child, &wst, 0) < 0 && errno == EINTR) {}
  if (out.size() > cap) {
    out.erase(0, out.size() - cap);
    head_dropped = true;
  }
  if (head_dropped) {  // start at a line boundary
    size_t nl = out.find('\n');
    if (nl != std::string::npos) out.erase(0, nl + 1);
  }
  int code = WIFEXITED(wst) ? WEXITSTATUS(wst) : -1;
  if (timed_out) status = "timeout after 30 s (partial)";
  else if (over) status = "stopped after 64 MiB (partial)";
  else if (code == 0) status = "ok";
  else status = (out.empty() ? "inaccessible: log show exited " : "log show exited ") + std::to_string(code);
  if (head_dropped) status += "; earliest output dropped to keep the last " + std::to_string(cap) + " bytes";
  return out;
}

static std::string bounded_json_file(const std::string& path, size_t cap, std::string& why) {
  std::string t;
  int e = read_file(path, t, cap + 1, false);
  if (e) { why = e == ENOENT ? "absent" : std::string("inaccessible: ") + strerror(e); return ""; }
  if (t.size() > cap) { why = "too large"; return ""; }
  @autoreleasepool {
    id o = json_parse(t);
    if (!o) { why = "not valid JSON"; return ""; }
    return ns_compact(o);
  }
}

int make_incident(const std::string& D, const Policy& pol, const IncidentReq& rq, std::string& dir_out,
                  std::string& err) {
  double now = now_wall();
  std::string inc = D + "/incidents";
  if (int e = mkdirs(inc)) { err = "cannot create " + inc + ": " + strerror(e); return e; }
  // Automatic kinds: one per kind (or rate key) per 10 minutes.
  std::string rl_file;
  if (rq.kind != "manual") {
    std::string key = rq.rate_key.empty() ? rq.kind : rq.rate_key;
    std::string safe;
    for (char c : key) safe += (safe_token(std::string(1, c), 1) ? c : '_');
    mkdirs(inc + "/.ratelimit");
    rl_file = inc + "/.ratelimit/" + safe.substr(0, 96);
    std::string last;
    double t;
    if (read_file(rl_file, last, 64, false) == 0 && parse_dbl(trim(last), t) && now - t < 600 && now >= t) {
      err = "rate-limited: an automatic '" + key + "' incident was created " + fmt_num(now - t, 0) + " s ago";
      return 1;
    }
  }
  std::string base = inc + "/" + utc_compact(now) + "-" + rq.kind;
  std::string dir = base;
  int e = 0;
  for (int k = 1; k <= 20; ++k) {
    if (mkdir(dir.c_str(), 0700) == 0) { e = 0; break; }
    e = errno;
    if (e != EEXIST) break;
    dir = base + "-" + std::to_string(k + 1);
  }
  if (e) { err = "cannot create " + dir + ": " + strerror(e); return e; }

  const size_t total = (size_t)pol.logs_incident_max_kib * 1024;
  const size_t log_cap = rq.with_log ? std::min<size_t>(256 * 1024, total / 2) : 0;
  const size_t rest = total - log_cap;
  const size_t sum_cap = rest * 2 / 5, part_cap = rest / 5;
  const double since = now - rq.window_min * 60.0;
  std::vector<std::string> inaccessible;
  JW files;
  files.begin_obj();

  // history / events windows
  int64_t hn = 0, en = 0;
  bool htr = false, etr = false;
  std::string hist = window_lines(D + "/history.jsonl", "t", since, part_cap, hn, htr);
  std::string evs = window_lines(D + "/events.jsonl", "ts", since, part_cap, en, etr);
  int we = write_atomic(dir + "/history.jsonl", hist);
  files.key("history.jsonl").begin_obj().ki("lines", hn).kb("truncated", htr).ki("errno", we).end_obj();
  we = write_atomic(dir + "/events.jsonl", evs);
  files.key("events.jsonl").begin_obj().ki("lines", en).kb("truncated", etr).ki("errno", we).end_obj();

  // reports in the window
  auto dirs = report_dirs();
  for (auto& d : dirs) {
    // A Retired/ that does not exist yet holds nothing; anything else unreadable is
    // recorded as inaccessible evidence.
    if (access(d.c_str(), R_OK | X_OK) != 0 && !(errno == ENOENT && ends_with(d, "/Retired")))
      inaccessible.push_back(d + ": " + strerror(errno));
  }
  auto reps = scan_reports(dirs, since, now + 1, 200, true);
  std::string rj;
  size_t dropped = 0;
  for (;;) {
    JW w;
    w.begin_arr();
    for (size_t k = dropped; k < reps.size(); ++k) report_json(w, reps[k]);
    w.end_arr();
    if (w.out.size() <= part_cap || dropped >= reps.size()) { rj = w.out; break; }
    ++dropped;  // oldest first
  }
  we = write_atomic(dir + "/reports.json", rj + "\n");
  files.key("reports.json").begin_obj().ki("reports", (int64_t)(reps.size() - dropped)).ki("dropped", (int64_t)dropped)
      .ki("errno", we).end_obj();

  // unified log
  std::string log_status = "not requested";
  if (rq.with_log) {
    std::string txt = unified_log(since, now, log_cap, log_status);
    if (starts_with(log_status, "inaccessible")) inaccessible.push_back("unified log: " + log_status);
    we = write_atomic(dir + "/unified_log.txt", txt.empty() ? "(" + log_status + ")\n" : txt);
    files.key("unified_log.txt").begin_obj().ki("bytes", (int64_t)txt.size()).ks("status", log_status)
        .ki("errno", we).end_obj();
  }
  files.end_obj();

  // summary: drop the largest optional parts until it fits.
  std::string why_state, why_sensor, why_prev;
  std::string state_json = bounded_json_file(D + "/state.json", 64 * 1024, why_state);
  std::string sensor_json = bounded_json_file(D + "/sensor.json", 96 * 1024, why_sensor);
  std::string prev_json = bounded_json_file(D + "/session/previous.json", 32 * 1024, why_prev);
  std::string classification;
  @autoreleasepool {
    NSDictionary* pd = json_obj(prev_json);
    if (pd) classification = ns_str(pd[@"classification"]);
  }
  Registry reg = read_registry(D, boot_uuid(), false, nullptr, nullptr);
  std::vector<std::string> quarantines;
  {
    int qe = 0;
    auto qn = list_dir(D + "/quarantine", 256, &qe);
    std::sort(qn.begin(), qn.end());
    for (auto& n : qn) {
      if (!ends_with(n, ".json")) continue;
      std::string why;
      std::string q = bounded_json_file(D + "/quarantine/" + n, 16 * 1024, why);
      if (!q.empty()) quarantines.push_back(q);
    }
  }
  std::string crashes;
  if (!rq.job_sig.empty() && safe_token(rq.job_sig, 64)) {
    read_tail(D + "/crashes/" + rq.job_sig + ".jsonl", crashes, 16 * 1024);
  }
  std::string summary;
  for (int level = 0; level < 4; ++level) {
    JW w;
    w.begin_obj();
    w.ks("schema", "forge.guardian.incident/1").kn("ts", now, 3).ks("iso", iso_utc(now));
    w.ks("kind", rq.kind).ks("note", one_line(rq.note, 2000));
    if (rq.job_sig.empty()) w.knull("job"); else w.ks("job", rq.job_sig);
    w.ki("window_min", rq.window_min).ks("producer", std::string("forge-guardian-sensor ") + kVersion);
    std::string bu = boot_uuid();
    w.key("boot").begin_obj();
    if (bu.empty()) w.knull("uuid"); else w.ks("uuid", bu);
    w.ki("epoch", boot_epoch()).end_obj();
    w.key("session").begin_obj();
    if (classification.empty()) w.knull("classification"); else w.ks("classification", classification);
    if (level < 3 && !prev_json.empty()) w.key("previous").raw(prev_json); else w.knull("previous");
    w.end_obj();
    if (level < 2 && !state_json.empty()) w.key("state_json").raw(state_json);
    else w.key("state_json").str(state_json.empty() ? why_state : "omitted: size");
    if (level < 1 && !sensor_json.empty()) w.key("sensor_json").raw(sensor_json);
    else w.key("sensor_json").str(sensor_json.empty() ? why_sensor : "omitted: size");
    w.key("envelopes").begin_arr();
    if (level < 3) {
      for (auto& j : reg.jobs) {
        w.begin_obj().ks("file", j.file).ks("identity", j.identity);
        for (auto& [k, v] : j.kv) w.ks(k, one_line(v, 1024));
        w.end_obj();
      }
    }
    w.end_arr();
    w.key("quarantines").begin_arr();
    for (auto& q : quarantines) w.raw(q);
    w.end_arr();
    w.key("crashes").begin_arr();
    for (auto& line : split(crashes, '\n')) {
      @autoreleasepool {
        if (!line.empty() && json_obj(line)) w.raw(line);
      }
    }
    w.end_arr();
    w.key("inaccessible").begin_arr();
    for (auto& x : inaccessible) w.str(x);
    w.end_arr();
    w.key("files").raw(files.out);
    w.ki("size_cap_b", (int64_t)total).ki("summary_level", level);
    w.end_obj();
    summary = w.out;
    if (summary.size() <= sum_cap) break;
  }
  we = write_atomic(dir + "/summary.json", summary + "\n");
  if (we) { err = "cannot write summary.json: " + std::string(strerror(we)); return we; }
  if (!rl_file.empty()) write_atomic(rl_file, fmt_num(now, 3));
  // SCHEMA §7 lists the incident event's fields as (dir, kind), but "kind" is already
  // the event's own key ("incident"); a second "kind" would be a duplicate JSON key
  // that parsers resolve differently. The incident's kind is published as
  // incident_kind (reported to the contract owner).
  Ev("incident").s("dir", dir).s("incident_kind", rq.kind).s("note", one_line(rq.note, 300)).write(D);
  dir_out = dir;
  return 0;
}

int cmd_incident(int argc, char** argv) {
  Args a = parse_args(argc, argv, 2, {"state-dir", "kind", "note", "job", "window-min"}, {"with-log"});
  int64_t wm = 30;
  std::string kind = a.get("kind", "manual");
  if (!a.error.empty() || !a.pos.empty() || a.get("state-dir").empty() || !incident_kind_known(kind) ||
      (a.has("window-min") && (!parse_i64(a.get("window-min"), wm) || wm < 1 || wm > 7 * 24 * 60)) ||
      (a.has("job") && !safe_token(a.get("job"), 64))) {
    fprintf(stderr,
            "usage: forge-guardian-sensor incident --state-dir D --kind manual|red|crash_loop|unclean_boot|report|gpu_error\n"
            "         [--note TEXT] [--job SIG] [--window-min M] [--with-log]\n%s%s",
            a.error.c_str(), a.error.empty() ? "" : "\n");
    return kExitUsage;
  }
  umask(077);
  std::string D = a.get("state-dir");
  PolicyLoad pl = load_policy(D, "");
  log_open(D);
  IncidentReq rq;
  rq.kind = kind;
  rq.note = a.get("note");
  rq.job_sig = a.get("job");
  rq.window_min = (int)wm;
  rq.with_log = a.flag.count("with-log") > 0;
  std::string dir, err;
  int rc = make_incident(D, pl.p, rq, dir, err);
  if (rc == 0) {
    printf("%s\n", dir.c_str());
    return kExitOk;
  }
  fprintf(stderr, "forge-guardian-sensor incident: %s\n", err.c_str());
  return rc == 1 ? kExitDeny : kExitInternal;
}

}  // namespace fgs
