// forge-guardian-sensor -- admission, release, quarantine (SCHEMA §9).
//
// THE RACE THIS CLOSES: forge-gate checks the published STATE, and forge-job then
// writes its envelope. Eight jobs arriving together all see GREEN, all pass, and the
// machine is asked for eight peaks at once -- a state check is not a reservation.
// Here every decision is taken under one fcntl lock on <D>/admission.lock, reads the
// registry fresh inside it, and renames the new envelope into place BEFORE the lock
// is released, so the next decision sees it. The lock is held for the decision only,
// never while waiting for capacity (--wait drops it and re-takes it every 5 s).
//
// FAIL CLOSED: no state, stale state, a clock in the future, an unreadable registry
// or unreadable memory evidence is exit 75 -- the domain cannot decide -- never an
// admission.
#import <Foundation/Foundation.h>

#include "sensor.hpp"

#include <fcntl.h>
#include <signal.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstring>

namespace fgs {

namespace {

int rank_of(const std::string& st) {
  if (st == "GREEN") return 0;
  if (st == "YELLOW") return 1;
  if (st == "ORANGE") return 2;
  if (st == "RED" || st == "UNKNOWN") return 3;  // UNKNOWN ranks with RED
  return 9;                                      // a word nobody knows denies everything
}

// fcntl write lock with a bounded wait (a holder only ever holds it for one decision).
int take_lock(const std::string& D, int& fd, std::string& err) {
  std::string p = D + "/admission.lock";
  fd = open(p.c_str(), O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (fd < 0) {
    int e = errno;
    err = "cannot open " + p + ": " + strerror(e);
    return e;
  }
  struct flock fl;
  memset(&fl, 0, sizeof fl);
  fl.l_type = F_WRLCK;
  fl.l_whence = SEEK_SET;
  uint64_t deadline = mono_ms() + 30000;
  while (fcntl(fd, F_SETLK, &fl) != 0) {
    int e = errno;
    if (e != EAGAIN && e != EACCES && e != EINTR) {
      err = "cannot lock " + p + ": " + strerror(e);
      close(fd);
      fd = -1;
      return e;
    }
    if (mono_ms() > deadline) {
      err = "admission.lock held for more than 30 s";
      close(fd);
      fd = -1;
      return ETIMEDOUT;
    }
    usleep(5000);
  }
  return 0;
}

void drop_lock(int& fd) {
  if (fd >= 0) close(fd);  // closing the descriptor releases the fcntl lock
  fd = -1;
}

// Peak footprints a running sensor has observed, keyed by (pid, process start).
PeakMap sensor_peaks(const std::string& D) {
  PeakMap m;
  std::string t;
  if (read_file(D + "/sensor.json", t, 1024 * 1024, false) != 0) return m;
  @autoreleasepool {
    NSDictionary* d = json_obj(t);
    id jobs = d[@"jobs"];
    if (![jobs isKindOfClass:[NSArray class]]) return m;
    for (id j in (NSArray*)jobs) {
      if (![j isKindOfClass:[NSDictionary class]]) continue;
      double pid, ps, pk;
      if (ns_num(j[@"pid"], pid) && ns_num(j[@"pstart"], ps) && ns_num(j[@"peak_fp_b"], pk))
        m[{(int)pid, (int64_t)ps}] = (int64_t)pk;
    }
  }
  return m;
}

struct Holder {
  std::string name;
  int pid;
  double b;
};

std::string holders_text(std::vector<Holder> hs, const char* verb) {
  std::sort(hs.begin(), hs.end(), [](const Holder& a, const Holder& b) { return a.b > b.b; });
  std::string o;
  size_t shown = 0;
  for (auto& h : hs) {
    if (shown == 6) {
      o += ", +" + std::to_string(hs.size() - shown) + " more";
      break;
    }
    o += (o.empty() ? "" : ", ") + (h.name.empty() ? std::string("?") : h.name) + " pid " + std::to_string(h.pid) +
         " " + verb + " " + fmt_gib(h.b);
    ++shown;
  }
  return o.empty() ? "no other reservations" : o;
}

struct AdmitReq {
  std::string D, name, peak_str, need = "green", sig, cmd, owner = "forge-job", disk_path, heartbeat, policy;
  int pid = 0, priority = 5;
  double peak_gb = 0, disk_gb = -1, wait_s = 0;
  int64_t threads = -1, stall_s = -1;
  bool restartable = false, gpu = false, dry_run = false, json = false;
};

struct Decision {
  int code = kExitInternal;
  std::string decision = "undecidable", reason, state, envelope;
  JW budget, instant, disk;
  bool b_set = false, i_set = false, d_set = false;
  bool final = false;  // a refusal that waiting cannot change (--wait does not retry it)
};

void fit_skipped(JW& w, const char* why) {
  w.begin_obj().kb("checked", false).ks("why", why).end_obj();
}

Decision decide(const AdmitReq& rq, const Policy& pol) {
  Decision d;
  double now = now_wall();
  // 0. SCHEMA §5: never admit a protected or foreign process as a job. An admitted pid
  // is a pid the governor may later signal; `admit` used to accept any live pid --
  // root-owned logd, the governor itself, a "Claude Helper" (review 2026-10-08 ACT-1).
  {
    ProcInfo pi = proc_info(rq.pid);
    if (pi.alive) {
      std::string why = protected_why(rq.pid, pi, rq.D);
      if (!why.empty()) {
        d.code = kExitDeny;
        d.decision = "deny";
        d.final = true;
        d.reason = "protected or foreign process: pid " + std::to_string(rq.pid) + " (" + why + ")";
        return d;
      }
    }
  }
  // 1. quarantine
  std::string qpath = rq.D + "/quarantine/" + rq.sig + ".json";
  struct stat qst;
  if (lstat(qpath.c_str(), &qst) == 0) {
    std::string since;
    std::string t;
    if (read_file(qpath, t, 64 * 1024, false) == 0) {
      @autoreleasepool {
        NSDictionary* q = json_obj(t);
        double s;
        if (q && ns_num(q[@"since"], s)) since = " since " + iso_utc(s);
      }
    }
    d.code = kExitQuarantined;
    d.decision = "quarantined";
    d.reason = "quarantined: job signature " + rq.sig + " (" + rq.name + ") crash-looped" + since +
               "; clear with: forge-guardian-ctl quarantine clear " + rq.sig + " --reason TEXT";
    return d;
  }
  // 2. state freshness: the state file's mtime AND state.json's epoch
  std::string word;
  {
    std::string t;
    int e = read_file(rq.D + "/state", t, 64, false);
    if (e) {
      d.code = kExitTempfail;
      d.reason = "undecidable: no governor state (" + rq.D + "/state: " + strerror(e) + ")";
      return d;
    }
    word = trim(t);
    double mt;
    if (!path_mtime(rq.D + "/state", mt, false)) {
      d.code = kExitTempfail;
      d.reason = "undecidable: cannot stat the state file";
      return d;
    }
    double age = now - mt;
    if (age > 60) {
      d.code = kExitTempfail;
      d.reason = "undecidable: governor state is " + fmt_num(age, 0) + " s stale (> 60 s): is forge-guardian running?";
      return d;
    }
    if (age < -5) {
      d.code = kExitTempfail;
      d.reason = "undecidable: state file mtime is " + fmt_num(-age, 0) + " s in the future (clock skew)";
      return d;
    }
  }
  {
    std::string t;
    int e = read_file(rq.D + "/state.json", t, 512 * 1024, false);
    double epoch = 0;
    bool ok = false;
    if (e == 0) {
      @autoreleasepool {
        NSDictionary* sj = json_obj(t);
        ok = sj && ns_num(sj[@"epoch"], epoch);
      }
    }
    if (!ok) {
      d.code = kExitTempfail;
      d.reason = e ? "undecidable: no state.json (" + std::string(strerror(e)) + ")" : "undecidable: state.json has no epoch";
      return d;
    }
    double age = now - epoch;
    if (age > 60) {
      d.code = kExitTempfail;
      d.reason = "undecidable: state.json epoch is " + fmt_num(age, 0) + " s old (> 60 s)";
      return d;
    }
    if (age < -5) {
      d.code = kExitTempfail;
      d.reason = "undecidable: state.json epoch is " + fmt_num(-age, 0) + " s in the future (> 5 s clock skew)";
      return d;
    }
  }
  // 2b. FO-4: a fresh state file is not a live governor. A governor killed by anything
  // but TERM/INT (SIGKILL, jetsam, a set -u death) leaves state and state.json fresh
  // for up to 60 s. Only the guardian.lock holder -- alive, started when the lock says,
  // running forge-guardian -- makes this domain governed.
  {
    std::string why = governor_check(rq.D, nullptr);
    if (!why.empty()) {
      d.code = kExitTempfail;
      d.reason = "undecidable: governor not running: " + why;
      return d;
    }
  }
  d.state = word;
  // 3. state rank vs --need
  if (rank_of(word) > rank_of(upper(rq.need))) {
    d.code = kExitDeny;
    d.decision = "deny";
    d.reason = "state: " + (word.empty() ? std::string("(empty)") : word) + " does not satisfy --need " + rq.need;
    return d;
  }
  // 4. identity-verified registry
  std::string cur_boot = boot_uuid();
  PeakMap sp = sensor_peaks(rq.D);
  Registry reg = read_registry(rq.D, cur_boot, true, nullptr, &sp);
  if (reg.err) {
    d.code = kExitTempfail;
    d.reason = "undecidable: unreadable registry: " + reg.errmsg;
    return d;
  }
  if (!reg.undecidable.empty()) {  // FO-5: an unreadable declaration is not a 0 GiB one
    d.code = kExitTempfail;
    d.reason = "undecidable: " + reg.undecidable;
    return d;
  }
  // memory evidence (honours FORGE_SENSOR_INJECT in test mode)
  Sampler sm;
  sm.pol = pol;
  Snapshot snap = sm.sample(false);
  const double G = rq.peak_gb * kGiB;
  const bool light = rq.peak_gb <= pol.light_job_gb;
  std::vector<Holder> holders, unbacked;
  double reserved = 0, deficit = 0;
  for (auto& j : reg.jobs) {
    // Every LIVE envelope holds its reservation: ok AND unverifiable. Unverifiable is
    // a reason never to SIGNAL a pid, never a reason to treat its memory as free
    // (review 2026-10-08 FO-5: a live 24 GiB job without `started` was admitted past).
    if (!j.live() || j.pid == rq.pid) continue;  // re-admission replaces its own envelope
    reserved += j.reserved_b;
    holders.push_back({j.name, j.pid, j.reserved_b});
    double res = j.res_b >= 0 ? (double)j.res_b : 0;
    double gap = std::max(0.0, j.reserved_b - res);
    deficit += gap;
    if (gap > 0) unbacked.push_back({j.name, j.pid, gap});
  }
  // 5. memory fit
  if (light) {
    fit_skipped(d.budget, "light job");
    fit_skipped(d.instant, "light job");
  } else {
    if (snap.mem_st != ST_OK) {
      d.code = kExitTempfail;
      d.reason = std::string("undecidable: memory evidence ") + st_name(snap.mem_st);
      return d;
    }
    double limit = snap.mem_total_b - pol.os_reserve_gb * kGiB;
    bool ok = reserved + G <= limit;
    d.budget.begin_obj().kb("checked", true).kb("ok", ok);
    d.budget.kn("reserved_gb", reserved / kGiB).kn("new_gb", rq.peak_gb).kn("limit_gb", limit / kGiB);
    d.budget.kn("mem_total_gb", snap.mem_total_b / kGiB).kn("os_reserve_gb", pol.os_reserve_gb);
    d.budget.key("holders").begin_arr();
    for (auto& h : holders) d.budget.begin_obj().ks("name", h.name).ki("pid", h.pid).kn("gb", h.b / kGiB).end_obj();
    d.budget.end_arr().end_obj();
    if (!ok) {
      d.code = kExitDeny;
      d.decision = "deny";
      d.reason = "budget: reserved " + fmt_gib(reserved) + " + new " + fmt_gib(G) + " > " + fmt_gib(limit) +
                 " GiB (" + holders_text(holders, "holds") + ")";
      fit_skipped(d.instant, "budget denied");
      fit_skipped(d.disk, "budget denied");
      return d;
    }
    if (pol.enforce_instant_fit) {
      double margin = pol.instant_margin_gb * kGiB;
      double need = G + deficit + margin;
      bool iok = need <= snap.mem_avail_b;
      d.instant.begin_obj().kb("checked", true).kb("ok", iok);
      d.instant.kn("new_gb", rq.peak_gb).kn("unbacked_gb", deficit / kGiB).kn("margin_gb", pol.instant_margin_gb);
      d.instant.kn("need_gb", need / kGiB).kn("avail_gb", snap.mem_avail_b / kGiB).end_obj();
      if (!iok) {
        d.code = kExitDeny;
        d.decision = "deny";
        d.reason = "instant: new " + fmt_gib(G) + " + unbacked " + fmt_gib(deficit) + " + margin " + fmt_gib(margin) +
                   " > available " + fmt_gib(snap.mem_avail_b) + " GiB (" +
                   (unbacked.empty() ? std::string("no reservation is unbacked") : holders_text(unbacked, "has unbacked")) + ")";
        fit_skipped(d.disk, "instant denied");
        return d;
      }
    } else {
      fit_skipped(d.instant, "memory.enforce_instant_fit is false");
    }
  }
  // 6. disk fit
  Volume dv;
  if (rq.disk_gb >= 0) {
    if (!vol_stat(rq.disk_path, dv, /*walk_up=*/true)) {
      d.code = kExitTempfail;
      d.reason = "undecidable: cannot statfs " + rq.disk_path;
      return d;
    }
    // A configured volume on the same file system carries the same reading (and, in
    // test mode, the injected one).
    for (auto& v : snap.vols)
      if (v.fsid == dv.fsid && v.st == ST_OK) dv.avail_b = v.avail_b;
    // Outstanding disk reservations on this volume. NEVER UNDER-COUNT (review
    // 2026-10-08 SEM-3): the old per-job formula credited EVERY job with the whole drop
    // in free space since its own admission, so two jobs that declared 30 GiB each on a
    // volume that had dropped 20 GiB counted 20 outstanding instead of >= 40. A drop
    // can be attributed only when exactly one live job reserves on the volume and it
    // recorded its baseline; with two or more, who wrote what is unknowable, so every
    // job counts its full declaration.
    std::vector<const JobInfo*> vol_jobs;
    for (auto& j : reg.jobs)
      if (j.live() && j.pid != rq.pid && j.disk_gb > 0 && j.disk_fsid == dv.fsid) vol_jobs.push_back(&j);
    double outstanding = 0;
    std::vector<Holder> on_vol;
    for (const JobInfo* jp : vol_jobs) {
      const JobInfo& j = *jp;
      double want = j.disk_gb * kGiB;
      double credit = 0;
      if (vol_jobs.size() == 1 && j.disk_avail0_b >= 0) credit = std::max(0.0, j.disk_avail0_b - dv.avail_b);
      double out = std::max(0.0, want - credit);
      outstanding += out;
      if (out > 0) on_vol.push_back({j.name, j.pid, out});
    }
    double X = rq.disk_gb * kGiB;
    double floor_b = pol.floor_gib(pol.admission_floor) * kGiB;
    double left = dv.avail_b - outstanding - X;
    bool ok = left >= floor_b;
    d.disk.begin_obj().kb("checked", true).kb("ok", ok).ks("path", rq.disk_path).ks("mount", dv.mount);
    d.disk.ks("fsid", dv.fsid).kn("avail_gb", dv.avail_b / kGiB).kn("outstanding_gb", outstanding / kGiB);
    d.disk.kn("request_gb", rq.disk_gb).kn("floor_gb", floor_b / kGiB).ks("floor", pol.admission_floor);
    d.disk.kn("left_gb", left / kGiB).end_obj();
    if (!ok) {
      d.code = kExitDeny;
      d.decision = "deny";
      d.reason = "disk: " + dv.mount + " avail " + fmt_gib(dv.avail_b) + " - outstanding " + fmt_gib(outstanding) +
                 " - new " + fmt_gib(X) + " = " + fmt_gib(left) + " < " + pol.admission_floor + " floor " +
                 fmt_num(floor_b / kGiB) + " GiB (" + holders_text(on_vol, "has outstanding") + ")";
      return d;
    }
  } else {
    fit_skipped(d.disk, "no --disk-gb");
  }
  // 7. the envelope (v1 keys first, in order; v2 keys; cmd LAST)
  ProcInfo pi = proc_info(rq.pid);
  if (!pi.alive) {
    d.code = kExitDeny;
    d.decision = "deny";
    d.reason = "pid " + std::to_string(rq.pid) + " is not alive";
    return d;
  }
  d.code = kExitOk;
  d.decision = "admit";
  d.reason = "admitted: " + rq.name + " " + fmt_num(rq.peak_gb) + " GiB" + (light ? " (light job)" : "") +
             " at state " + word;
  if (rq.dry_run) return d;
  int64_t now_s = (int64_t)now;
  std::string env;
  auto kv = [&](const char* k, const std::string& v) { env += k; env += '='; env += one_line(v, 4000); env += '\n'; };
  kv("pid", std::to_string(rq.pid));
  kv("name", rq.name);
  kv("priority", std::to_string(rq.priority));
  kv("can_restart", rq.restartable ? "1" : "0");
  kv("peak_gb", rq.peak_str);
  kv("gpu", rq.gpu ? "1" : "0");
  kv("started", std::to_string(now_s));
  kv("schema", "2");
  if (pi.start_s > 0) kv("pstart", std::to_string(pi.start_s));
  if (!cur_boot.empty()) kv("boot", cur_boot);
  kv("sig", rq.sig);
  if (rq.threads > 0) kv("threads", std::to_string(rq.threads));
  if (rq.disk_gb >= 0) {
    kv("disk_gb", fmt_num(rq.disk_gb, 6));
    kv("disk_path", rq.disk_path);
    kv("disk_fsid", dv.fsid);
    kv("disk_avail0_b", fmt_num(std::floor(dv.avail_b), 0));
  }
  if (!rq.heartbeat.empty()) {
    kv("heartbeat", rq.heartbeat);
    kv("stall_s", std::to_string(rq.stall_s > 0 ? rq.stall_s : 0));
  }
  kv("admitted", std::to_string(now_s));
  kv("admit_state", word);
  kv("owner", rq.owner);
  kv("cmd", rq.cmd);
  std::string jdir = rq.D + "/jobs";
  if (int e = mkdirs(jdir)) {
    d.code = kExitTempfail;
    d.decision = "undecidable";
    d.reason = "undecidable: cannot create " + jdir + ": " + strerror(e);
    return d;
  }
  std::string path = jdir + "/" + std::to_string(rq.pid) + ".job";
  if (int e = write_atomic(path, env)) {
    d.code = kExitTempfail;
    d.decision = "undecidable";
    d.reason = "undecidable: cannot write " + path + ": " + strerror(e);
    return d;
  }
  d.envelope = path;
  return d;
}

void print_decision(const AdmitReq& rq, Decision& d) {
  if (rq.json) {
    JW w;
    w.begin_obj().ks("decision", d.decision).ks("reason", d.reason);
    if (d.state.empty()) w.knull("state"); else w.ks("state", d.state);
    w.ks("sig", rq.sig);
    if (d.envelope.empty()) w.knull("envelope"); else w.ks("envelope", d.envelope);
    w.key("fit").begin_obj();
    w.key("budget").raw(d.budget.out.empty() ? "{\"checked\":false,\"why\":\"not reached\"}" : d.budget.out);
    w.key("instant").raw(d.instant.out.empty() ? "{\"checked\":false,\"why\":\"not reached\"}" : d.instant.out);
    w.key("disk").raw(d.disk.out.empty() ? "{\"checked\":false,\"why\":\"not reached\"}" : d.disk.out);
    w.end_obj().ki("exit", d.code).end_obj();
    printf("%s\n", w.out.c_str());
  }
  if (d.code != kExitOk) fprintf(stderr, "forge-guardian-sensor admit: %s\n", d.reason.c_str());
}

int admit_usage(const std::string& why) {
  fprintf(stderr,
          "forge-guardian-sensor admit: %s\n"
          "usage: forge-guardian-sensor admit --state-dir D --pid PID --name N --peak-gb G\n"
          "         [--priority P] [--restartable] [--gpu] [--threads T]\n"
          "         [--disk-gb X --disk-path PATH] [--heartbeat FILE --stall-s S]\n"
          "         [--need green|yellow|orange|red] [--sig SIG] [--cmd STR] [--owner forge-job]\n"
          "         [--wait SECONDS] [--dry-run] [--json] [--policy FILE]\n",
          why.c_str());
  return kExitUsage;
}

}  // namespace

int cmd_admit(int argc, char** argv) {
  Args a = parse_args(argc, argv, 2,
                      {"state-dir", "pid", "name", "peak-gb", "priority", "threads", "disk-gb", "disk-path",
                       "heartbeat", "stall-s", "need", "sig", "cmd", "owner", "wait", "policy"},
                      {"restartable", "gpu", "dry-run", "json"});
  if (!a.error.empty()) return admit_usage(a.error);
  if (!a.pos.empty()) return admit_usage("unexpected argument " + a.pos[0]);
  AdmitReq rq;
  rq.D = a.get("state-dir");
  if (rq.D.empty()) return admit_usage("--state-dir is required");
  int64_t v;
  if (!parse_i64(a.get("pid"), v) || v <= 1 || v > INT32_MAX) return admit_usage("--pid must be a pid > 1");
  rq.pid = (int)v;
  rq.name = a.get("name");
  if (rq.name.empty() || rq.name.size() > 200 || rq.name.find('\n') != std::string::npos)
    return admit_usage("--name is required (one line, <= 200 chars)");
  rq.peak_str = trim(a.get("peak-gb"));
  if (!parse_dbl(rq.peak_str, rq.peak_gb) || rq.peak_gb < 0 || rq.peak_gb > 1e6)
    return admit_usage("--peak-gb must be a decimal >= 0");
  if (a.has("priority")) {
    if (!parse_i64(a.get("priority"), v) || v < 0 || v > 9) return admit_usage("--priority must be 0..9");
    rq.priority = (int)v;
  }
  if (a.has("threads")) {
    if (!parse_i64(a.get("threads"), v) || v < 1 || v > 4096) return admit_usage("--threads must be >= 1");
    rq.threads = v;
  }
  if (a.has("disk-gb") != a.has("disk-path")) return admit_usage("--disk-gb and --disk-path go together");
  if (a.has("disk-gb")) {
    if (!parse_dbl(a.get("disk-gb"), rq.disk_gb) || rq.disk_gb < 0) return admit_usage("--disk-gb must be >= 0");
    rq.disk_path = a.get("disk-path");
    if (rq.disk_path.empty() || rq.disk_path[0] != '/') return admit_usage("--disk-path must be absolute");
  }
  if (a.has("heartbeat")) {
    rq.heartbeat = a.get("heartbeat");
    if (rq.heartbeat.empty() || rq.heartbeat[0] != '/') return admit_usage("--heartbeat must be an absolute path");
    if (!a.has("stall-s") || !parse_i64(a.get("stall-s"), rq.stall_s) || rq.stall_s < 1)
      return admit_usage("--heartbeat needs --stall-s S (S >= 1)");
  } else if (a.has("stall-s")) {
    return admit_usage("--stall-s needs --heartbeat");
  }
  rq.need = lower(a.get("need", "green"));
  if (rank_of(upper(rq.need)) > 3 || rq.need == "unknown") return admit_usage("--need must be green|yellow|orange|red");
  rq.cmd = a.get("cmd");
  rq.sig = a.has("sig") ? a.get("sig") : job_sig(rq.name, rq.cmd);
  if (!safe_token(rq.sig, 64)) return admit_usage("--sig must be [A-Za-z0-9._-]{1,64}");
  rq.owner = a.get("owner", "forge-job");
  if (!safe_token(rq.owner, 32)) return admit_usage("--owner must be a short token");
  if (a.has("wait")) {
    if (!parse_dbl(a.get("wait"), rq.wait_s) || rq.wait_s < 0 || rq.wait_s > 7 * 86400)
      return admit_usage("--wait must be seconds >= 0");
  }
  rq.restartable = a.flag.count("restartable") > 0;
  rq.gpu = a.flag.count("gpu") > 0;
  rq.dry_run = a.flag.count("dry-run") > 0;
  rq.json = a.flag.count("json") > 0;
  rq.policy = a.get("policy");
  umask(077);

  PolicyLoad pl = load_policy(rq.D, rq.policy);
  if (!pl.error.empty()) fprintf(stderr, "forge-guardian-sensor admit: policy rejected, using defaults: %s\n", pl.error.c_str());

  struct stat dst;
  uint64_t deadline = mono_ms() + (uint64_t)(rq.wait_s * 1000.0);
  Decision d;
  for (;;) {
    @autoreleasepool {
      d = Decision{};
      if (stat(rq.D.c_str(), &dst) != 0 || !S_ISDIR(dst.st_mode)) {
        d.code = kExitTempfail;
        d.reason = "undecidable: health domain " + rq.D + " does not exist";
      } else {
        int fd = -1;
        std::string err;
        if (take_lock(rq.D, fd, err) != 0) {
          d.code = kExitTempfail;
          d.reason = "undecidable: " + err;
        } else {
          d = decide(rq, pl.p);
          drop_lock(fd);  // never held while waiting
        }
      }
    }
    if (d.code == kExitOk || d.code == kExitQuarantined || d.code == kExitUsage || d.final) break;
    uint64_t now = mono_ms();
    if (now >= deadline) break;
    uint64_t nap = std::min<uint64_t>(5000, deadline - now);
    usleep((useconds_t)(nap * 1000));
  }
  print_decision(rq, d);
  return d.code;
}

// ---------------------------------------------------------------- release
static std::string norm_signal(std::string s) {
  s = upper(trim(s));
  if (starts_with(s, "SIG")) s = s.substr(3);
  int64_t n;
  if (parse_i64(s, n) && n > 0 && n < NSIG) {
    const char* nm = sys_signame[n];
    return nm ? upper(nm) : s;
  }
  return s;
}

// R13: reservations.history.jsonl and every crashes/<sig>.jsonl rotate at 1 MiB, one
// generation kept -- they grew without bound (about 0.8 GB a year at 10k jobs a day).
static constexpr uint64_t kLedgerRotateBytes = 1024 * 1024;

// A crash ledger matters only inside crash_loop.window_s (<= 1 day <= retention_days),
// so a ledger untouched for logs.retention_days whose signature is not quarantined can
// go: the number of per-signature ledgers is bounded by the crash rate, not by time.
// Runs under admission.lock (release holds it), so no concurrent append can be lost.
static void prune_crash_ledgers(const std::string& D, int retention_days) {
  int e = 0;
  auto names = list_dir(D + "/crashes", 4096, &e);
  if (e) return;
  double cutoff = now_wall() - (double)retention_days * 86400.0;
  for (auto& n : names) {
    std::string stem = n;
    if (ends_with(stem, ".jsonl.1")) stem = stem.substr(0, stem.size() - 8);
    else if (ends_with(stem, ".jsonl")) stem = stem.substr(0, stem.size() - 6);
    else continue;
    struct stat st, qs;
    std::string p = D + "/crashes/" + n;
    if (lstat(p.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) continue;
    if ((double)st.st_mtimespec.tv_sec >= cutoff) continue;
    if (lstat((D + "/quarantine/" + stem + ".json").c_str(), &qs) == 0) continue;  // evidence of a live quarantine
    if (unlink(p.c_str()) == 0) logf("pruned crash ledger %s (untouched for %d days)", n.c_str(), retention_days);
  }
}

static double last_clear_ts(const std::string& D, const std::string& sig) {
  std::string t;
  if (read_tail(D + "/quarantine/cleared.jsonl", t, 256 * 1024) != 0) return 0;
  double last = 0;
  @autoreleasepool {
    for (auto& line : split(t, '\n')) {
      NSDictionary* o = json_obj(line);
      double ts;
      if (o && ns_str(o[@"sig"]) == sig && ns_num(o[@"ts"], ts)) last = std::max(last, ts);
    }
  }
  return last;
}

int cmd_release(int argc, char** argv) {
  Args a = parse_args(argc, argv, 2, {"state-dir", "pid", "rc", "signal"}, {"external-term"});
  int64_t pid = 0, rc = 0;
  if (!a.error.empty() || !a.pos.empty() || a.get("state-dir").empty() || !parse_i64(a.get("pid"), pid) || pid <= 1 ||
      pid > INT32_MAX || (a.has("rc") && !parse_i64(a.get("rc"), rc))) {
    fprintf(stderr, "usage: forge-guardian-sensor release --state-dir D --pid PID [--rc N] [--signal NAME] [--external-term]\n");
    return kExitUsage;
  }
  umask(077);
  std::string D = a.get("state-dir");
  std::string signame = a.has("signal") ? norm_signal(a.get("signal")) : "";
  bool inferred = false;
  if (signame.empty() && a.has("rc") && rc > 128 && rc < 128 + NSIG) {
    signame = norm_signal(std::to_string(rc - 128));  // shell convention: 128 + signal
    inferred = true;
  }
  if (!signame.empty() && !known_signal_name(signame)) {
    fprintf(stderr, "forge-guardian-sensor release: unknown signal %s\n", signame.c_str());
    return kExitUsage;
  }
  bool external = a.flag.count("external-term") > 0;
  PolicyLoad pl = load_policy(D, "");
  log_open(D);
  int fd = -1;
  std::string err;
  if (take_lock(D, fd, err) != 0) {
    fprintf(stderr, "forge-guardian-sensor release: %s\n", err.c_str());
    return kExitTempfail;
  }
  int code = kExitOk;
  @autoreleasepool {
    std::string path = D + "/jobs/" + std::to_string(pid) + ".job";
    std::string text;
    int e = read_file(path, text, 64 * 1024, false);
    if (e) {
      drop_lock(fd);
      fprintf(stderr, "forge-guardian-sensor release: no envelope for pid %lld (%s)\n", (long long)pid, strerror(e));
      return kExitDeny;
    }
    KV kv;
    parse_kv(text, kv);
    ProcInfo pi;
    std::string ident = verify_identity(kv, (int)pid, boot_uuid(), &pi);
    if (ident == "mismatch") {
      drop_lock(fd);
      fprintf(stderr, "forge-guardian-sensor release: %s names a different process (pid reused); not removed\n",
              path.c_str());
      return kExitDeny;
    }
    std::string name = kv.count("name") ? kv["name"] : "";
    std::string cmd = kv.count("cmd") ? kv["cmd"] : "";
    std::string sig = kv.count("sig") && safe_token(kv["sig"], 64) ? kv["sig"] : job_sig(name, cmd);
    double declared = 0;
    if (kv.count("peak_gb")) parse_dbl(kv["peak_gb"], declared);
    int64_t t0 = -1, v;
    if (kv.count("admitted") && parse_i64(kv["admitted"], v)) t0 = v;
    else if (kv.count("started") && parse_i64(kv["started"], v)) t0 = v;
    // measured peak: what a running sensor saw for this exact process
    double measured = -1;
    PeakMap sp = sensor_peaks(D);
    auto it = sp.find({(int)pid, pi.start_s});
    if (it != sp.end()) measured = (double)it->second;
    if (unlink(path.c_str()) != 0 && errno != ENOENT) {
      drop_lock(fd);
      fprintf(stderr, "forge-guardian-sensor release: cannot remove %s: %s\n", path.c_str(), strerror(errno));
      return kExitInternal;
    }
    double now = now_wall();
    JW h;
    h.begin_obj().kn("ts", now, 3).ks("sig", sig).ks("name", name).ki("pid", pid);
    h.kn("declared_gb", declared);
    if (measured >= 0) h.kn("measured_peak_gb", measured / kGiB); else h.knull("measured_peak_gb");
    if (t0 > 0) h.ki("wall_s", (int64_t)now - t0); else h.knull("wall_s");
    if (a.has("rc")) h.ki("rc", rc); else h.knull("rc");
    if (signame.empty()) h.knull("signal"); else h.ks("signal", signame);
    h.kb("signal_inferred", inferred).kb("external_term", external).ks("identity", ident);
    h.end_obj();
    rotate_if_needed(D + "/reservations.history.jsonl", kLedgerRotateBytes, 1);
    append_line(D + "/reservations.history.jsonl", h.out);

    bool crash = !signame.empty() && !external &&
                 std::find(pl.p.crash_signals.begin(), pl.p.crash_signals.end(), signame) != pl.p.crash_signals.end();
    if (crash) {
      mkdirs(D + "/crashes");
      JW c;
      c.begin_obj().kn("ts", now, 3).ki("pid", pid).ks("name", name).ks("signal", signame);
      if (a.has("rc")) c.ki("rc", rc); else c.knull("rc");
      c.ks("cmd", one_line(cmd, 1024)).end_obj();
      std::string ledger = D + "/crashes/" + sig + ".jsonl";
      rotate_if_needed(ledger, kLedgerRotateBytes, 1);
      append_line(ledger, c.out);
      // count crashes inside the window, after the last manual clear of this sig; a
      // rotation may have just moved the window's earlier crashes into .1
      double since = std::max(now - pl.p.window_s, last_clear_ts(D, sig));
      std::string lt, lt1;
      read_tail(ledger + ".1", lt1, 256 * 1024);
      read_tail(ledger, lt, 256 * 1024);
      lt = lt1 + (lt1.empty() || lt1.back() == '\n' ? "" : "\n") + lt;
      std::vector<std::string> in_window;
      for (auto& line : split(lt, '\n')) {
        NSDictionary* o = json_obj(line);
        double ts;
        if (o && ns_num(o[@"ts"], ts) && ts > since - 1e-9 && ts <= now + 1) in_window.push_back(line);
      }
      std::string qpath = D + "/quarantine/" + sig + ".json";
      struct stat qst;
      if ((int)in_window.size() >= pl.p.max_crashes && lstat(qpath.c_str(), &qst) != 0) {
        mkdirs(D + "/quarantine");
        auto qjson = [&](const std::string& incident) {
          JW q;
          q.begin_obj().ks("sig", sig).ks("name", name).ks("cmd", one_line(cmd, 4000));
          q.key("crashes").begin_arr();
          for (auto& l : in_window) q.raw(l);
          q.end_arr();
          q.kn("since", now, 3).ks("since_iso", iso_utc(now));
          if (incident.empty()) q.knull("incident"); else q.ks("incident", incident);
          q.ki("max_crashes", pl.p.max_crashes).ki("window_s", pl.p.window_s);
          q.end_obj();
          return q.out + "\n";
        };
        write_atomic(qpath, qjson(""));
        Ev("quarantine").s("sig", sig).s("name", name).i("crashes", (int64_t)in_window.size()).write(D);
        IncidentReq rq;
        rq.kind = "crash_loop";
        rq.job_sig = sig;
        rq.rate_key = "crash_loop:" + sig;
        rq.window_min = std::max(1, (pl.p.window_s + 59) / 60);
        rq.note = name + " crashed " + std::to_string(in_window.size()) + " times in " + std::to_string(pl.p.window_s) +
                  " s (last " + signame + ")";
        std::string idir, ierr;
        if (make_incident(D, pl.p, rq, idir, ierr) == 0) write_atomic(qpath, qjson(idir));
        else logf("crash_loop incident for %s not created: %s", sig.c_str(), ierr.c_str());
        fprintf(stderr, "forge-guardian-sensor release: %s (sig %s) QUARANTINED after %zu crashes in %d s\n",
                name.c_str(), sig.c_str(), in_window.size(), pl.p.window_s);
        code = kExitQuarantined;
      }
    }
  }
  prune_crash_ledgers(D, pl.p.logs_retention_days);
  drop_lock(fd);
  return code;
}

// ---------------------------------------------------------------- quarantine-clear
int cmd_quarantine_clear(int argc, char** argv) {
  Args a = parse_args(argc, argv, 2, {"state-dir", "sig", "reason"}, {});
  std::string D = a.get("state-dir"), sig = a.get("sig"), reason = a.get("reason");
  if (!a.error.empty() || !a.pos.empty() || D.empty() || !safe_token(sig, 64) || trim(reason).empty()) {
    fprintf(stderr, "usage: forge-guardian-sensor quarantine-clear --state-dir D --sig SIG --reason TEXT\n");
    return kExitUsage;
  }
  umask(077);
  int fd = -1;
  std::string err;
  if (take_lock(D, fd, err) != 0) {
    fprintf(stderr, "forge-guardian-sensor quarantine-clear: %s\n", err.c_str());
    return kExitTempfail;
  }
  std::string q = D + "/quarantine/" + sig + ".json";
  if (unlink(q.c_str()) != 0) {
    int e = errno;
    drop_lock(fd);
    fprintf(stderr, "forge-guardian-sensor quarantine-clear: %s is not quarantined (%s)\n", sig.c_str(), strerror(e));
    return kExitDeny;
  }
  JW w;
  w.begin_obj().ks("sig", sig).ks("reason", one_line(reason, 2000)).ks("user", user_name()).kn("ts", now_wall(), 3);
  w.end_obj();
  int e = append_line(D + "/quarantine/cleared.jsonl", w.out);
  drop_lock(fd);
  if (e) {
    fprintf(stderr, "forge-guardian-sensor quarantine-clear: cleared, but cleared.jsonl not written: %s\n", strerror(e));
    return kExitInternal;
  }
  printf("cleared %s\n", sig.c_str());
  return kExitOk;
}

}  // namespace fgs
