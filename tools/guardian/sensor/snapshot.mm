// forge-guardian-sensor -- sampling and the sensor snapshot (SCHEMA §3).
//
// Every signal carries a status. A source that fails never blocks the others, and a
// value that is unavailable/invalid is published as -1 / none / null -- NEVER as a
// default that reads as healthy. That is the defect this program exists to end: the
// shell governor defaulted thermal to 100 % (healthy) whenever `pmset -g therm` had
// nothing to say, which on this Mac is always.
#import <Foundation/Foundation.h>

#include "sensor.hpp"

#include <libproc.h>
#include <mach/mach.h>
#include <sys/mount.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstring>

namespace fgs {

const char* st_name(St s) {
  switch (s) {
    case ST_OK: return "ok";
    case ST_UNAVAIL: return "unavailable";
    case ST_STALE: return "stale";
    case ST_INVALID: return "invalid";
  }
  return "unavailable";
}

bool st_parse(std::string_view w, St& out) {
  if (w == "ok") out = ST_OK;
  else if (w == "unavailable") out = ST_UNAVAIL;
  else if (w == "stale") out = ST_STALE;
  else if (w == "invalid") out = ST_INVALID;
  else return false;
  return true;
}

static mach_port_t host_port() {
  static mach_port_t h = MACH_PORT_NULL;
  if (h == MACH_PORT_NULL) h = mach_host_self();
  return h;
}

template <typename T>
static bool sysctl_get(const char* name, T& out) {
  size_t len = sizeof(T);
  return sysctlbyname(name, &out, &len, nullptr, 0) == 0 && len == sizeof(T);
}

static bool sysctl_int_any(const char* name, int64_t& out) {
  // Some of these are int, some uint64; accept either width.
  unsigned char buf[16];
  size_t len = sizeof buf;
  if (sysctlbyname(name, buf, &len, nullptr, 0) != 0) return false;
  if (len == 4) { int32_t v; memcpy(&v, buf, 4); out = v; return true; }
  if (len == 8) { int64_t v; memcpy(&v, buf, 8); out = v; return true; }
  return false;
}

static std::string fsid_hex(const fsid_t& f) {
  char b[24];
  snprintf(b, sizeof b, "%08x%08x", (uint32_t)f.val[0], (uint32_t)f.val[1]);
  return b;
}

bool vol_stat(const std::string& path_in, Volume& v, bool walk_up) {
  std::string p = expand_tilde(path_in);
  v.path = p;
  // walk_up: a path that does not exist yet (an admission's output dir) is measured at
  // its nearest existing ancestor, the file system it will be created on. A configured
  // policy volume is NOT walked up: an unmounted /Volumes/X must read unavailable, not
  // silently report the boot volume.
  for (int guard = 0; guard < 128 && !p.empty(); ++guard) {
    struct statfs sf;
    if (statfs(p.c_str(), &sf) == 0) {
      v.mount = sf.f_mntonname;
      v.fsid = fsid_hex(sf.f_fsid);
      v.avail_b = (double)sf.f_bavail * (double)sf.f_bsize;
      v.total_b = (double)sf.f_blocks * (double)sf.f_bsize;
      v.st = ST_OK;
      return true;
    }
    if (!walk_up || (errno != ENOENT && errno != ENOTDIR) || p == "/") break;
    size_t slash = p.find_last_of('/');
    if (slash == std::string::npos) break;
    p = slash == 0 ? "/" : p.substr(0, slash);
  }
  v.st = ST_UNAVAIL;
  return false;
}

static void validate(Snapshot& s) {
  auto bad = [](double x) { return !std::isfinite(x) || x < 0; };
  if (s.vmp_st == ST_OK && !(s.vmp == 1 || s.vmp == 2 || s.vmp == 4)) s.vmp_st = ST_INVALID;
  if (s.pevent_st == ST_OK && !(s.pevent == "normal" || s.pevent == "warn" || s.pevent == "critical"))
    s.pevent_st = ST_INVALID;
  if (s.freepct_st == ST_OK && (bad(s.freepct) || s.freepct > 100)) s.freepct_st = ST_INVALID;
  if (s.mem_st == ST_OK &&
      (bad(s.mem_total_b) || s.mem_total_b <= 0 || bad(s.mem_avail_b) || bad(s.mem_free_b) ||
       bad(s.mem_wired_b) || bad(s.mem_compressed_b) || s.mem_total_b < s.mem_avail_b ||
       s.mem_total_b < s.mem_free_b || s.mem_total_b < s.mem_wired_b))
    s.mem_st = ST_INVALID;
  if (s.swap_st == ST_OK && (bad(s.swap_used_mb) || bad(s.swap_total_mb) || s.swap_total_mb < s.swap_used_mb ||
                             !std::isfinite(s.swap_growth_mb_min)))
    s.swap_st = ST_INVALID;
  if (s.pageouts_st == ST_OK && (bad(s.pageouts_total) || bad(s.pageout_rate_ps) || bad(s.swapout_rate_ps)))
    s.pageouts_st = ST_INVALID;
  if (s.thermal_st == ST_OK && !(s.thermal == "nominal" || s.thermal == "fair" || s.thermal == "serious" ||
                                 s.thermal == "critical"))
    s.thermal_st = ST_INVALID;
  if (s.cpu_st == ST_OK && (bad(s.load1) || bad(s.cpu_busy_pct) || s.cpu_busy_pct > 100 || s.ncpu <= 0))
    s.cpu_st = ST_INVALID;
  for (auto& v : s.vols)
    if (v.st == ST_OK && (bad(v.avail_b) || bad(v.total_b) || v.total_b <= 0 || v.total_b < v.avail_b ||
                          !std::isfinite(v.growth_b_min)))
      v.st = ST_INVALID;
}

void derive(Snapshot& s, const Policy& p) {
  // disk: ok iff every configured volume is ok; the minimum is over the ok ones.
  double mn = -1;
  bool all_ok = !s.vols.empty();
  for (auto& v : s.vols) {
    if (v.st != ST_OK) { all_ok = false; continue; }
    if (mn < 0 || v.avail_b < mn) mn = v.avail_b;
  }
  s.disk_st = all_ok ? ST_OK : ST_UNAVAIL;
  s.disk_min_avail_gib = mn >= 0 ? std::floor(mn / kGiB) : -1;
  // reservations (§9.1). Every LIVE envelope counts -- ok and unverifiable alike:
  // "unverifiable" means never signal, not free memory, and admit counts it the same
  // way, so the published total and the admission engine agree (review FO-5). A live
  // envelope whose peak_gb cannot be read makes the total unavailable, never smaller.
  s.budget_b = s.mem_st == ST_OK ? s.mem_total_b - p.os_reserve_gb * kGiB : -1;
  if (s.jobs_st == ST_OK) {
    double r = 0;
    bool readable = true;
    for (auto& j : s.jobs) {
      if (!j.live()) continue;
      if (!j.peak_ok) readable = false;
      r += j.reserved_b;
    }
    s.reserved_b = readable ? r : -1;
  } else {
    s.reserved_b = -1;
  }
  // SEM-6: with either side unavailable there is no overcommit verdict at all (-1 in
  // .env, null in .json) -- never a 0 that reads as "not overcommitted".
  if (s.budget_b < 0 || s.reserved_b < 0) s.overcommit = -1;
  else s.overcommit = s.reserved_b > s.budget_b ? 1 : 0;
}

// FORGE_SENSOR_INJECT (test mode only): KEY=VALUE overrides applied after sampling,
// keys are sensor.env keys. Values first (an injected value is a sampled value, so it
// is status ok and then range-validated like any other), status overrides last.
static void apply_injection(Snapshot& s) {
  const char* path = test_env("FORGE_SENSOR_INJECT");
  if (!path) return;
  std::string text;
  if (read_file(path, text, 64 * 1024, true) != 0) return;
  KV kv;
  parse_kv(text, kv);
  std::vector<std::pair<std::string, std::string>> st_over;
  for (auto& [k, val] : kv) {
    double d = 0;
    bool num = parse_dbl(val, d);
    bool used = true;
    if (ends_with(k, "_st")) { st_over.emplace_back(k, val); continue; }
    if (k == "vmp" && num) { s.vmp = d; s.vmp_st = ST_OK; }
    else if (k == "pevent") { s.pevent = val; s.pevent_st = ST_OK; }
    else if (k == "freepct" && num) { s.freepct = d; s.freepct_st = ST_OK; }
    else if (k == "mem_total_b" && num) { s.mem_total_b = d; }
    else if (k == "mem_avail_b" && num) { s.mem_avail_b = d; }
    else if (k == "mem_free_b" && num) { s.mem_free_b = d; }
    else if (k == "mem_wired_b" && num) { s.mem_wired_b = d; }
    else if (k == "mem_compressed_b" && num) { s.mem_compressed_b = d; }
    else if (k == "swap_used_mb" && num) { s.swap_used_mb = d; }
    else if (k == "swap_total_mb" && num) { s.swap_total_mb = d; }
    else if (k == "swap_growth_mb_min" && num) { s.swap_growth_mb_min = d; }
    else if (k == "pageouts_total" && num) { s.pageouts_total = d; }
    else if (k == "pageout_rate_ps" && num) { s.pageout_rate_ps = d; }
    else if (k == "swapout_rate_ps" && num) { s.swapout_rate_ps = d; }
    else if (k == "thermal") { s.thermal = val; s.thermal_st = ST_OK; }
    else if (k == "load1" && num) { s.load1 = d; }
    else if (k == "cpu_busy_pct" && num) { s.cpu_busy_pct = d; }
    else if (starts_with(k, "vol") && k.find('_') != std::string::npos) {
      int64_t idx;
      std::string field = k.substr(k.find('_') + 1);
      if (!parse_i64(k.substr(3, k.find('_') - 3), idx) || idx < 0 || (size_t)idx >= s.vols.size() || !num) {
        used = false;
      } else if (field == "avail_b") { s.vols[(size_t)idx].avail_b = d; s.vols[(size_t)idx].st = ST_OK; }
      else if (field == "total_b") { s.vols[(size_t)idx].total_b = d; s.vols[(size_t)idx].st = ST_OK; }
      else if (field == "growth_b_min") { s.vols[(size_t)idx].growth_b_min = d; }
      else used = false;
    } else {
      used = false;
    }
    // A memory/swap/pageouts/cpu field injected into a group the platform could not
    // sample makes that group "sampled" for the test.
    if (used) {
      if (starts_with(k, "mem_")) s.mem_st = ST_OK;
      else if (starts_with(k, "swap_")) s.swap_st = ST_OK;
      else if (k == "pageouts_total" || k == "pageout_rate_ps" || k == "swapout_rate_ps") s.pageouts_st = ST_OK;
      else if (k == "load1" || k == "cpu_busy_pct") s.cpu_st = ST_OK;
      s.injected += (s.injected.empty() ? "" : " ") + k;
    }
  }
  validate(s);
  for (auto& [k, val] : st_over) {
    St st;
    if (!st_parse(val, st)) continue;
    std::string g = k.substr(0, k.size() - 3);
    bool used = true;
    if (g == "vmp") s.vmp_st = st;
    else if (g == "pevent") s.pevent_st = st;
    else if (g == "freepct") s.freepct_st = st;
    else if (g == "mem") s.mem_st = st;
    else if (g == "swap") s.swap_st = st;
    else if (g == "pageouts") s.pageouts_st = st;
    else if (g == "thermal") s.thermal_st = st;
    else if (g == "cpu") s.cpu_st = st;
    else if (starts_with(g, "vol")) {
      int64_t idx;
      if (parse_i64(g.substr(3), idx) && idx >= 0 && (size_t)idx < s.vols.size()) s.vols[(size_t)idx].st = st;
      else used = false;
    } else {
      used = false;
    }
    if (used) s.injected += (s.injected.empty() ? "" : " ") + k;
  }
}

Snapshot Sampler::sample(bool with_jobs) {
  Snapshot s;
  s.pid = getpid();
  s.ts = now_wall();
  s.mono = mono_ms();
  s.boot_uuid = boot_uuid();
  s.boot_epoch = boot_epoch();
  s.poll_s = poll_s;

  bool rb = rebaseline || !have_prev;
  double dt = have_prev ? (double)(s.mono - prev_mono) / 1000.0 : 0;
  // A snapshot taken moments after the previous one (an event-driven publish) would
  // turn a handful of pages into an enormous per-second rate. Rates are computed over
  // windows of at least one second; inside that, the last rates are carried.
  bool carry = !rb && dt < 1.0;
  s.rebaseline = rb ? 1 : 0;

  // vm pressure level
  int64_t iv;
  if (sysctl_int_any("kern.memorystatus_vm_pressure_level", iv)) { s.vmp = (double)iv; s.vmp_st = ST_OK; }
  else { s.vmp_st = ST_UNAVAIL; ++errors; }

  // pressure events
  if (pevent_armed) {
    s.pevent = pevent;
    s.pevent_st = ST_OK;
    s.pevent_ts = pevent_ts;
    s.pevent_warn_n = warn_n;
    s.pevent_crit_n = crit_n;
  }

  // free percentage (the number `memory_pressure` prints)
  if (sysctl_int_any("kern.memorystatus_level", iv)) { s.freepct = (double)iv; s.freepct_st = ST_OK; }
  else { s.freepct_st = ST_UNAVAIL; ++errors; }

  // memory + pageouts
  uint64_t memsize = 0;
  vm_size_t page = 0;
  vm_statistics64_data_t vm;
  mach_msg_type_number_t cnt = HOST_VM_INFO64_COUNT;
  bool vm_ok = host_statistics64(host_port(), HOST_VM_INFO64, (host_info64_t)&vm, &cnt) == KERN_SUCCESS;
  bool page_ok = host_page_size(host_port(), &page) == KERN_SUCCESS && page > 0;
  if (sysctl_get("hw.memsize", memsize) && vm_ok && page_ok) {
    double pg = (double)page;
    // vm_stat's "Pages free" is free_count - speculative_count; the schema's free +
    // inactive + speculative + purgeable counts speculative once.
    double free_pages = (double)vm.free_count - (double)vm.speculative_count;
    if (free_pages < 0) free_pages = 0;
    s.mem_total_b = (double)memsize;
    s.mem_free_b = free_pages * pg;
    s.mem_avail_b = (free_pages + (double)vm.inactive_count + (double)vm.speculative_count +
                     (double)vm.purgeable_count) * pg;
    s.mem_wired_b = (double)vm.wire_count * pg;
    s.mem_compressed_b = (double)vm.compressor_page_count * pg;
    s.mem_st = ST_OK;
  } else {
    s.mem_st = ST_UNAVAIL;
    ++errors;
  }
  if (vm_ok) {
    double po = (double)vm.pageouts, so = (double)vm.swapouts;
    s.pageouts_total = po;
    if (carry) {
      s.pageout_rate_ps = last_po_rate;
      s.swapout_rate_ps = last_so_rate;
    } else if (!rb && dt > 0 && po >= prev_pageouts && so >= prev_swapouts) {
      s.pageout_rate_ps = (po - prev_pageouts) / dt;
      s.swapout_rate_ps = (so - prev_swapouts) / dt;
    } else {
      s.pageout_rate_ps = 0;
      s.swapout_rate_ps = 0;
    }
    s.pageouts_st = ST_OK;
  } else {
    s.pageouts_st = ST_UNAVAIL;
    ++errors;
  }

  // swap
  struct xsw_usage xsw;
  memset(&xsw, 0, sizeof xsw);
  if (sysctl_get("vm.swapusage", xsw)) {
    s.swap_used_mb = std::floor((double)xsw.xsu_used / kMiB);
    s.swap_total_mb = std::floor((double)xsw.xsu_total / kMiB);
    double used_mb = (double)xsw.xsu_used / kMiB;
    if (carry) s.swap_growth_mb_min = last_swap_growth;
    else if (!rb && dt > 0) s.swap_growth_mb_min = (used_mb - prev_swap_used_mb) / (dt / 60.0);
    else s.swap_growth_mb_min = 0;
    s.swap_st = ST_OK;
    if (!carry) prev_swap_used_mb = used_mb;
  } else {
    s.swap_st = ST_UNAVAIL;
    ++errors;
  }

  // thermal -- the native source the shell governor never had.
  switch ([[NSProcessInfo processInfo] thermalState]) {
    case NSProcessInfoThermalStateNominal: s.thermal = "nominal"; s.thermal_st = ST_OK; break;
    case NSProcessInfoThermalStateFair: s.thermal = "fair"; s.thermal_st = ST_OK; break;
    case NSProcessInfoThermalStateSerious: s.thermal = "serious"; s.thermal_st = ST_OK; break;
    case NSProcessInfoThermalStateCritical: s.thermal = "critical"; s.thermal_st = ST_OK; break;
    default: s.thermal = "none"; s.thermal_st = ST_INVALID; break;
  }

  // cpu
  double la[1];
  host_cpu_load_info_data_t cpu;
  mach_msg_type_number_t ccnt = HOST_CPU_LOAD_INFO_COUNT;
  bool cpu_ok = host_statistics(host_port(), HOST_CPU_LOAD_INFO, (host_info_t)&cpu, &ccnt) == KERN_SUCCESS;
  int64_t ncpu = -1, nperf = -1;
  sysctl_int_any("hw.ncpu", ncpu);
  if (!sysctl_int_any("hw.perflevel0.logicalcpu", nperf) && ncpu > 0) nperf = ncpu / 2;
  if (getloadavg(la, 1) == 1 && cpu_ok && ncpu > 0) {
    s.load1 = la[0];
    s.ncpu = (double)ncpu;
    s.nperf = (double)nperf;
    uint64_t t[4] = {cpu.cpu_ticks[CPU_STATE_USER], cpu.cpu_ticks[CPU_STATE_SYSTEM],
                     cpu.cpu_ticks[CPU_STATE_NICE], cpu.cpu_ticks[CPU_STATE_IDLE]};
    if (carry) {
      s.cpu_busy_pct = last_busy;
    } else if (!rb) {
      double busy = (double)(t[0] - prev_cpu[0]) + (double)(t[1] - prev_cpu[1]) + (double)(t[2] - prev_cpu[2]);
      double tot = busy + (double)(t[3] - prev_cpu[3]);
      s.cpu_busy_pct = tot > 0 ? std::round(100.0 * busy / tot) : 0;
    } else {
      s.cpu_busy_pct = 0;
    }
    if (!carry) memcpy(prev_cpu, t, sizeof t);
    s.cpu_st = ST_OK;
  } else {
    s.cpu_st = ST_UNAVAIL;
    ++errors;
  }

  // volumes, deduplicated by fsid; growth of avail is an EWMA over monotonic time
  // (tau 60 s), negative = free space shrinking.
  std::set<std::string> seen_fsid;
  for (auto& vp : pol.volumes) {
    Volume v;
    if (!vol_stat(vp, v)) {
      v.path = expand_tilde(vp);
      s.vols.push_back(v);
      ++errors;
      continue;
    }
    if (!seen_fsid.insert(v.fsid).second) continue;
    auto it = volprev.find(v.fsid);
    if (rb || it == volprev.end()) {
      v.growth_b_min = 0;
      volprev[v.fsid] = VolPrev{v.avail_b, s.mono, 0};
    } else {
      VolPrev& p = it->second;
      double vdt = (double)(s.mono - p.mono) / 1000.0;
      if (vdt >= 1.0) {
        double inst = (v.avail_b - p.avail) / (vdt / 60.0);
        double alpha = 1.0 - std::exp(-vdt / 60.0);
        p.ewma = alpha * inst + (1.0 - alpha) * p.ewma;
        p.avail = v.avail_b;
        p.mono = s.mono;
      }
      v.growth_b_min = p.ewma;
    }
    s.vols.push_back(v);
  }

  // jobs
  if (with_jobs && !state_dir.empty()) {
    Registry r = read_registry(state_dir, s.boot_uuid, true, &peaks, sensor_peaks);
    if (r.err) {
      s.jobs_st = ST_UNAVAIL;
      ++errors;
    } else {
      s.jobs = std::move(r.jobs);
      s.jobs_st = ST_OK;
    }
  } else {
    s.jobs_st = ST_OK;  // no registry asked for: zero jobs is the truth
  }

  // power
  s.sleep_n = sleep_n;
  s.last_sleep_ts = last_sleep_ts;
  s.last_wake_ts = last_wake_ts;

  // self
  struct rusage ru;
  if (getrusage(RUSAGE_SELF, &ru) == 0)
    s.self_cpu_s = (double)ru.ru_utime.tv_sec + (double)ru.ru_utime.tv_usec / 1e6 +
                   (double)ru.ru_stime.tv_sec + (double)ru.ru_stime.tv_usec / 1e6;
  mach_task_basic_info_data_t ti;
  mach_msg_type_number_t tcnt = MACH_TASK_BASIC_INFO_COUNT;
  if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO, (task_info_t)&ti, &tcnt) == KERN_SUCCESS)
    s.self_rss_b = (int64_t)ti.resident_size;
  int fdbytes = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, nullptr, 0);
  if (fdbytes > 0) {
    std::vector<struct proc_fdinfo> fds((size_t)fdbytes / sizeof(struct proc_fdinfo) + 4);
    int got = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, fds.data(), (int)(fds.size() * sizeof(struct proc_fdinfo)));
    if (got > 0) s.self_fds = got / (int)sizeof(struct proc_fdinfo);
  }

  validate(s);
  if (test_mode()) apply_injection(s);
  derive(s, pol);

  // advance the rate baselines
  if (!carry) {
    if (vm_ok) {
      prev_pageouts = (double)vm.pageouts;
      prev_swapouts = (double)vm.swapouts;
    }
    prev_mono = s.mono;
    have_prev = true;
    last_po_rate = s.pageouts_st == ST_OK ? s.pageout_rate_ps : 0;
    last_so_rate = s.pageouts_st == ST_OK ? s.swapout_rate_ps : 0;
    last_swap_growth = s.swap_st == ST_OK ? s.swap_growth_mb_min : 0;
    last_busy = s.cpu_st == ST_OK ? s.cpu_busy_pct : 0;
  }
  rebaseline = false;
  s.seq = ++seq;
  s.errors = errors;
  s.inbox_ingested = inbox_ingested;
  s.inbox_invalid = inbox_invalid;
  return s;
}

// ---------------------------------------------------------------- encodings
static std::string num_or(double v, St st, int prec = 3) { return st == ST_OK ? fmt_num(v, prec) : "-1"; }
static std::string int_or(double v, St st) { return st == ST_OK ? fmt_num(std::floor(v), 0) : "-1"; }
static std::string word_or(const std::string& v, St st) { return st == ST_OK ? env_word(v) : "none"; }

std::string encode_env(const Snapshot& s) {
  std::string o;
  o.reserve(4096);
  auto kv = [&](const std::string& k, const std::string& v) { o += k; o += '='; o += v; o += '\n'; };
  kv("schema", kSensorSchema);
  kv("version", kVersion);
  kv("pid", std::to_string(s.pid));
  kv("seq", std::to_string(s.seq));
  kv("ts", fmt_num(s.ts, 3));
  kv("ts_s", std::to_string((int64_t)s.ts));
  kv("mono_ms", std::to_string(s.mono));
  kv("boot_uuid", s.boot_uuid.empty() ? "none" : env_word(s.boot_uuid));
  kv("boot_epoch", std::to_string(s.boot_epoch));
  kv("rebaseline", std::to_string(s.rebaseline));
  kv("poll_s", std::to_string(s.poll_s));
  kv("vmp", int_or(s.vmp, s.vmp_st));
  kv("vmp_st", st_name(s.vmp_st));
  kv("pevent", word_or(s.pevent, s.pevent_st));
  kv("pevent_st", st_name(s.pevent_st));
  kv("pevent_ts", s.pevent_st == ST_OK && s.pevent_ts > 0 ? fmt_num(s.pevent_ts, 0) : "-1");
  kv("pevent_warn_n", s.pevent_st == ST_OK ? std::to_string(s.pevent_warn_n) : "-1");
  kv("pevent_crit_n", s.pevent_st == ST_OK ? std::to_string(s.pevent_crit_n) : "-1");
  kv("freepct", int_or(s.freepct, s.freepct_st));
  kv("freepct_st", st_name(s.freepct_st));
  kv("mem_total_b", int_or(s.mem_total_b, s.mem_st));
  kv("mem_avail_b", int_or(s.mem_avail_b, s.mem_st));
  kv("mem_free_b", int_or(s.mem_free_b, s.mem_st));
  kv("mem_wired_b", int_or(s.mem_wired_b, s.mem_st));
  kv("mem_compressed_b", int_or(s.mem_compressed_b, s.mem_st));
  kv("mem_st", st_name(s.mem_st));
  kv("swap_used_mb", int_or(s.swap_used_mb, s.swap_st));
  kv("swap_total_mb", int_or(s.swap_total_mb, s.swap_st));
  kv("swap_growth_mb_min", num_or(s.swap_growth_mb_min, s.swap_st));
  kv("swap_st", st_name(s.swap_st));
  kv("pageouts_total", int_or(s.pageouts_total, s.pageouts_st));
  kv("pageout_rate_ps", num_or(s.pageout_rate_ps, s.pageouts_st));
  kv("swapout_rate_ps", num_or(s.swapout_rate_ps, s.pageouts_st));
  kv("pageouts_st", st_name(s.pageouts_st));
  kv("thermal", word_or(s.thermal, s.thermal_st));
  kv("thermal_st", st_name(s.thermal_st));
  kv("load1", num_or(s.load1, s.cpu_st, 2));
  kv("cpu_busy_pct", int_or(s.cpu_busy_pct, s.cpu_st));
  kv("ncpu", int_or(s.ncpu, s.cpu_st));
  kv("nperf", int_or(s.nperf, s.cpu_st));
  kv("cpu_st", st_name(s.cpu_st));
  kv("vol_n", std::to_string(s.vols.size()));
  for (size_t i = 0; i < s.vols.size(); ++i) {
    const Volume& v = s.vols[i];
    std::string p = "vol" + std::to_string(i) + "_";
    kv(p + "path", env_word(v.path));
    kv(p + "mount", v.mount.empty() ? "none" : env_word(v.mount));
    kv(p + "fsid", v.fsid.empty() ? "none" : v.fsid);
    kv(p + "avail_b", int_or(v.avail_b, v.st));
    kv(p + "total_b", int_or(v.total_b, v.st));
    kv(p + "growth_b_min", num_or(v.growth_b_min, v.st, 1));
    kv(p + "st", st_name(v.st));
  }
  kv("disk_min_avail_gib", s.disk_min_avail_gib >= 0 ? fmt_num(s.disk_min_avail_gib, 0) : "-1");
  kv("disk_st", st_name(s.disk_st));
  kv("jobs_n", std::to_string(s.jobs.size()));
  for (size_t i = 0; i < s.jobs.size(); ++i) {
    const JobInfo& j = s.jobs[i];
    std::string p = "job" + std::to_string(i) + "_";
    kv(p + "pid", std::to_string(j.pid));
    kv(p + "name", env_word(j.name));
    kv(p + "identity", j.identity);
    kv(p + "fp_b", std::to_string(j.fp_b));
    kv(p + "res_b", std::to_string(j.res_b));
    kv(p + "peak_fp_b", std::to_string(j.peak_fp_b));
    kv(p + "reserved_b", fmt_num(std::floor(j.reserved_b), 0));
    kv(p + "hb_age_s", std::to_string(j.hb_age_s));
    kv(p + "declared_b", fmt_num(std::floor(j.declared_b), 0));
    kv(p + "sig", env_word(j.sig));
    // additive: WHICH envelope this verdict is about. Two envelopes can name one pid (a
    // reused pid's stale file beside the live job's); a verdict keyed by pid alone let
    // the governor reap the live job's envelope or keep the stale one.
    kv(p + "file", env_word(j.file));
  }
  kv("reserved_b", s.reserved_b >= 0 ? fmt_num(std::floor(s.reserved_b), 0) : "-1");
  kv("budget_b", s.budget_b >= 0 ? fmt_num(std::floor(s.budget_b), 0) : "-1");
  kv("overcommit", std::to_string(s.overcommit));
  kv("sleep_n", std::to_string(s.sleep_n));
  kv("last_sleep_ts", s.last_sleep_ts > 0 ? fmt_num(s.last_sleep_ts, 0) : "-1");
  kv("last_wake_ts", s.last_wake_ts > 0 ? fmt_num(s.last_wake_ts, 0) : "-1");
  kv("self_cpu_s", fmt_num(s.self_cpu_s, 3));
  kv("self_rss_b", std::to_string(s.self_rss_b));
  kv("self_fds", std::to_string(s.self_fds));
  kv("errors", std::to_string(s.errors));
  // additive keys (not in §3.1)
  kv("jobs_st", st_name(s.jobs_st));
  kv("inbox_ingested", std::to_string(s.inbox_ingested));
  kv("inbox_invalid", std::to_string(s.inbox_invalid));
  if (!s.injected.empty()) kv("injected", env_word(s.injected));
  return o;
}

static void jnum_or(JW& w, const char* k, double v, St st, int prec = 3) {
  if (st == ST_OK) w.kn(k, v, prec);
  else w.knull(k);
}

std::string encode_json(const Snapshot& s) {
  JW w;
  w.begin_obj();
  w.ks("schema", kSensorSchema).ks("version", kVersion);
  w.ki("pid", s.pid).ki("seq", (int64_t)s.seq).kn("ts", s.ts, 3).ki("ts_s", (int64_t)s.ts);
  w.ki("mono_ms", (int64_t)s.mono);
  w.key("boot").begin_obj();
  if (s.boot_uuid.empty()) w.knull("uuid"); else w.ks("uuid", s.boot_uuid);
  if (s.boot_epoch > 0) w.ki("epoch", s.boot_epoch); else w.knull("epoch");
  w.end_obj();
  w.ki("rebaseline", s.rebaseline).ki("poll_s", s.poll_s);
  w.key("signals").begin_obj();

  w.key("vm_pressure").begin_obj().ks("status", st_name(s.vmp_st));
  jnum_or(w, "value", s.vmp, s.vmp_st, 0);
  w.ks("unit", "level").end_obj();

  w.key("pressure_event").begin_obj().ks("status", st_name(s.pevent_st));
  if (s.pevent_st == ST_OK) {
    w.ks("value", s.pevent);
    if (s.pevent_ts > 0) w.kn("ts", s.pevent_ts, 3); else w.knull("ts");
    w.ki("warn_n", s.pevent_warn_n).ki("crit_n", s.pevent_crit_n);
  } else {
    w.knull("value").knull("ts").knull("warn_n").knull("crit_n");
  }
  w.ks("unit", "event").end_obj();

  w.key("free_pct").begin_obj().ks("status", st_name(s.freepct_st));
  jnum_or(w, "value", s.freepct, s.freepct_st, 0);
  w.ks("unit", "pct").end_obj();

  w.key("memory").begin_obj().ks("status", st_name(s.mem_st));
  jnum_or(w, "total_b", s.mem_total_b, s.mem_st, 0);
  jnum_or(w, "avail_b", s.mem_avail_b, s.mem_st, 0);
  jnum_or(w, "free_b", s.mem_free_b, s.mem_st, 0);
  jnum_or(w, "wired_b", s.mem_wired_b, s.mem_st, 0);
  jnum_or(w, "compressed_b", s.mem_compressed_b, s.mem_st, 0);
  w.ks("unit", "bytes").end_obj();

  w.key("swap").begin_obj().ks("status", st_name(s.swap_st));
  jnum_or(w, "used_mb", s.swap_used_mb, s.swap_st, 0);
  jnum_or(w, "total_mb", s.swap_total_mb, s.swap_st, 0);
  jnum_or(w, "growth_mb_min", s.swap_growth_mb_min, s.swap_st);
  w.ks("unit", "MiB").end_obj();

  w.key("pageouts").begin_obj().ks("status", st_name(s.pageouts_st));
  jnum_or(w, "total", s.pageouts_total, s.pageouts_st, 0);
  jnum_or(w, "rate_ps", s.pageout_rate_ps, s.pageouts_st);
  jnum_or(w, "swapout_rate_ps", s.swapout_rate_ps, s.pageouts_st);
  w.ks("unit", "pages").end_obj();

  w.key("thermal").begin_obj().ks("status", st_name(s.thermal_st));
  if (s.thermal_st == ST_OK) w.ks("value", s.thermal); else w.knull("value");
  w.ks("source", "NSProcessInfo.thermalState").ks("unit", "state").end_obj();

  w.key("cpu").begin_obj().ks("status", st_name(s.cpu_st));
  jnum_or(w, "load1", s.load1, s.cpu_st, 2);
  jnum_or(w, "busy_pct", s.cpu_busy_pct, s.cpu_st, 0);
  jnum_or(w, "ncpu", s.ncpu, s.cpu_st, 0);
  jnum_or(w, "nperf", s.nperf, s.cpu_st, 0);
  w.ks("unit", "pct").end_obj();

  w.key("disk").begin_obj().ks("status", st_name(s.disk_st));
  if (s.disk_min_avail_gib >= 0) w.kn("min_avail_gib", s.disk_min_avail_gib, 0); else w.knull("min_avail_gib");
  w.ki("volumes", (int64_t)s.vols.size());
  w.ks("unit", "GiB").end_obj();
  w.end_obj();  // signals

  w.key("volumes").begin_arr();
  for (auto& v : s.vols) {
    w.begin_obj().ks("path", v.path);
    if (v.mount.empty()) w.knull("mount"); else w.ks("mount", v.mount);
    if (v.fsid.empty()) w.knull("fsid"); else w.ks("fsid", v.fsid);
    jnum_or(w, "avail_b", v.avail_b, v.st, 0);
    jnum_or(w, "total_b", v.total_b, v.st, 0);
    jnum_or(w, "growth_b_min", v.growth_b_min, v.st, 1);
    w.ks("status", st_name(v.st)).end_obj();
  }
  w.end_arr();

  w.key("jobs").begin_arr();
  for (auto& j : s.jobs) {
    w.begin_obj();
    w.ki("pid", j.pid).ks("name", j.name).ks("identity", j.identity).ks("sig", j.sig);
    if (j.proc_start > 0) w.ki("pstart", j.proc_start); else w.knull("pstart");
    w.ki("priority", j.priority).kb("can_restart", j.can_restart).kb("gpu", j.gpu);
    w.kn("peak_gb", j.peak_gb, 3);
    if (j.fp_b >= 0) w.ki("fp_b", j.fp_b); else w.knull("fp_b");
    if (j.res_b >= 0) w.ki("res_b", j.res_b); else w.knull("res_b");
    if (j.peak_fp_b >= 0) w.ki("peak_fp_b", j.peak_fp_b); else w.knull("peak_fp_b");
    w.kn("declared_b", std::floor(j.declared_b), 0).kn("reserved_b", std::floor(j.reserved_b), 0);
    if (j.hb_age_s >= 0) w.ki("hb_age_s", j.hb_age_s); else w.knull("hb_age_s");
    if (j.threads > 0) w.ki("threads", j.threads); else w.knull("threads");
    if (j.disk_gb >= 0) w.kn("disk_gb", j.disk_gb); else w.knull("disk_gb");
    w.ks("file", j.file);
    if (!j.peak_ok) w.kb("peak_readable", false);  // additive: the declaration did not parse
    if (j.oversize) w.kb("oversize", true);         // additive: > 64 KiB, kept as unverifiable
    w.end_obj();
  }
  w.end_arr();

  w.key("reservations").begin_obj();
  w.ks("status", st_name(s.jobs_st));
  if (s.reserved_b >= 0) w.kn("reserved_b", std::floor(s.reserved_b), 0); else w.knull("reserved_b");
  if (s.budget_b >= 0) w.kn("budget_b", std::floor(s.budget_b), 0); else w.knull("budget_b");
  if (s.overcommit < 0) w.knull("overcommit"); else w.kb("overcommit", s.overcommit == 1);
  w.ki("jobs", (int64_t)s.jobs.size());
  w.end_obj();

  w.key("power").begin_obj();
  w.ki("sleep_n", s.sleep_n);
  if (s.last_sleep_ts > 0) w.kn("last_sleep_ts", s.last_sleep_ts, 3); else w.knull("last_sleep_ts");
  if (s.last_wake_ts > 0) w.kn("last_wake_ts", s.last_wake_ts, 3); else w.knull("last_wake_ts");
  w.end_obj();

  w.key("self").begin_obj();
  w.kn("cpu_s", s.self_cpu_s, 3).ki("rss_b", s.self_rss_b).ki("fds", s.self_fds);
  w.ki("inbox_ingested", s.inbox_ingested).ki("inbox_invalid", s.inbox_invalid);
  w.end_obj();
  if (!s.injected.empty()) w.ks("injected", s.injected);
  w.ki("errors", s.errors);
  w.end_obj();
  w.out += '\n';
  return w.out;
}

// ---------------------------------------------------------------- snapshot command
int cmd_snapshot(int argc, char** argv) {
  Args a = parse_args(argc, argv, 2, {"state-dir", "policy"}, {});
  if (!a.error.empty() || !a.pos.empty()) {
    fprintf(stderr, "forge-guardian-sensor snapshot: %s\nusage: forge-guardian-sensor snapshot [--state-dir D] [--policy FILE]\n",
            a.error.empty() ? "unexpected argument" : a.error.c_str());
    return kExitUsage;
  }
  @autoreleasepool {
    std::string D = a.get("state-dir");
    PolicyLoad pl = load_policy(D, a.get("policy"));
    if (!pl.error.empty()) fprintf(stderr, "forge-guardian-sensor: policy rejected, using defaults: %s\n", pl.error.c_str());
    Sampler sm;
    sm.state_dir = D;
    sm.pol = pl.p;
    sm.poll_s = pl.p.poll_s;
    Snapshot s = sm.sample(!D.empty());
    std::string out = encode_json(s);
    if (fwrite(out.data(), 1, out.size(), stdout) != out.size()) return kExitInternal;
    if (fflush(stdout) != 0) return kExitInternal;
  }
  return kExitOk;
}

}  // namespace fgs
