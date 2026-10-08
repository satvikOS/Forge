// forge-guardian-sensor -- processes, envelopes and identity (SCHEMA §5).
//
// An envelope names a PROCESS, not a number. pids are reused; a pid alone has already
// cost this program a stale lock that named a different process (forge-guardian's
// single-instance guard). Everything that counts or signals an envelope's pid goes
// through verify_identity() first.
#import <Foundation/Foundation.h>

#include "sensor.hpp"

#include <libproc.h>
#include <signal.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/sysctl.h>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstring>
#include <deque>

namespace fgs {

ProcInfo proc_info(int pid) {
  ProcInfo pi;
  // pid <= 0 names a process GROUP to kill(2). Never let one through.
  if (pid <= 0) return pi;
  struct proc_bsdinfo bi;
  memset(&bi, 0, sizeof bi);
  int n = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &bi, (int)sizeof bi);
  if (n == (int)sizeof bi) {
    pi.zombie = bi.pbi_status == SZOMB;
    pi.alive = !pi.zombie;  // a zombie holds no memory and cannot act on a signal
    pi.ppid = (int)bi.pbi_ppid;
    pi.start_s = (int64_t)bi.pbi_start_tvsec;
    pi.start_us = (int64_t)bi.pbi_start_tvusec;
    pi.uid = (int64_t)bi.pbi_uid;
    size_t nl = strnlen(bi.pbi_name, sizeof bi.pbi_name);
    pi.comm = nl ? std::string(bi.pbi_name, nl)
                 : std::string(bi.pbi_comm, strnlen(bi.pbi_comm, sizeof bi.pbi_comm));
    return pi;
  }
  // proc_pidinfo is refused for another user's process; the kern.proc sysctl that
  // ps(1) uses is not. kill(pid, 0) is the last resort (EPERM means it exists).
  int mib[4] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, pid};
  struct kinfo_proc kp;
  size_t len = sizeof kp;
  memset(&kp, 0, sizeof kp);
  if (sysctl(mib, 4, &kp, &len, nullptr, 0) == 0 && len == sizeof kp && kp.kp_proc.p_pid == pid) {
    pi.zombie = kp.kp_proc.p_stat == SZOMB;
    pi.alive = !pi.zombie;
    pi.ppid = (int)kp.kp_eproc.e_ppid;
    pi.start_s = (int64_t)kp.kp_proc.p_starttime.tv_sec;
    pi.start_us = (int64_t)kp.kp_proc.p_starttime.tv_usec;
    pi.uid = (int64_t)kp.kp_eproc.e_ucred.cr_uid;
    pi.comm = std::string(kp.kp_proc.p_comm, strnlen(kp.kp_proc.p_comm, sizeof kp.kp_proc.p_comm));
    return pi;
  }
  if (kill(pid, 0) == 0 || errno == EPERM) pi.alive = true;
  return pi;
}

TreeUse tree_usage(int root) {
  TreeUse u;
  if (root <= 0) return u;
  std::deque<std::pair<int, int>> q;  // (pid, depth)
  std::set<int> seen;
  q.emplace_back(root, 0);
  seen.insert(root);
  std::vector<int> kids(1024);
  int64_t fp = 0, res = 0;
  bool root_ok = false;
  while (!q.empty() && u.n < 4096) {
    auto [pid, depth] = q.front();
    q.pop_front();
    struct rusage_info_v4 ri;
    memset(&ri, 0, sizeof ri);
    if (proc_pid_rusage(pid, RUSAGE_INFO_V4, (rusage_info_t*)&ri) == 0) {
      fp += (int64_t)ri.ri_phys_footprint;
      res += (int64_t)ri.ri_resident_size;
      if (pid == root) root_ok = true;
    }
    ++u.n;
    if (depth >= 64) continue;
    int cnt = proc_listchildpids(pid, kids.data(), (int)(kids.size() * sizeof(int)));
    if (cnt <= 0) continue;
    cnt = std::min<int>(cnt, (int)kids.size());
    for (int i = 0; i < cnt; ++i) {
      int c = kids[(size_t)i];
      if (c <= 0 || seen.count(c)) continue;
      seen.insert(c);
      q.emplace_back(c, depth + 1);
    }
  }
  if (root_ok) {
    u.fp = fp;
    u.res = res;
  }
  return u;
}

void parse_kv(std::string_view text, KV& kv, size_t line_cap) {
  size_t i = 0;
  while (i < text.size()) {
    size_t nl = text.find('\n', i);
    if (nl == std::string_view::npos) nl = text.size();
    std::string_view line = text.substr(i, std::min(nl - i, line_cap));
    i = nl + 1;
    if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
    size_t eq = line.find('=');
    if (eq == std::string_view::npos || eq == 0 || eq > 64) continue;
    std::string k(line.substr(0, eq));
    bool ok = true;
    for (char c : k)
      if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_'))
        ok = false;
    if (!ok) continue;
    if (kv.count(k)) continue;  // SCHEMA §5: readers take the FIRST occurrence
    kv[k] = std::string(line.substr(eq + 1));
  }
}

std::string job_sig(const std::string& name, const std::string& cmd) {
  std::string m = name;
  m.push_back('\0');
  m += cmd;
  return sha256_hex(m).substr(0, 16);
}

std::string boot_uuid() {
  if (const char* e = test_env("FORGE_SENSOR_TEST_BOOT_UUID")) return e;
  char buf[128];
  size_t len = sizeof buf;
  if (sysctlbyname("kern.bootsessionuuid", buf, &len, nullptr, 0) != 0 || len == 0) return "";
  return std::string(buf, strnlen(buf, len));
}

int64_t boot_epoch() {
  struct timeval tv;
  size_t len = sizeof tv;
  if (sysctlbyname("kern.boottime", &tv, &len, nullptr, 0) != 0) return -1;
  return (int64_t)tv.tv_sec;
}

// SCHEMA §5, in order: alive; boot (if present); pstart ±1 (if present); else
// started + 5; else unverifiable.
std::string verify_identity(const KV& kv, int pid, const std::string& cur_boot, ProcInfo* out) {
  ProcInfo pi = proc_info(pid);
  if (out) *out = pi;
  if (!pi.alive) return "dead";
  auto it = kv.find("boot");
  if (it != kv.end() && !it->second.empty() && !cur_boot.empty() && it->second != cur_boot)
    return "mismatch";
  int64_t v;
  it = kv.find("pstart");
  if (it != kv.end() && parse_i64(it->second, v)) {
    if (pi.start_s < 0) return "unverifiable";
    return std::llabs(pi.start_s - v) <= 1 ? "ok" : "mismatch";
  }
  it = kv.find("started");
  if (it != kv.end() && parse_i64(it->second, v)) {
    if (pi.start_s < 0) return "unverifiable";
    // The envelope is written AFTER its process starts, so a process younger than
    // the envelope (plus slack) is a different process that inherited the pid.
    return pi.start_s <= v + 5 ? "ok" : "mismatch";
  }
  return "unverifiable";
}

static int64_t kv_i64(const KV& kv, const char* k, int64_t d) {
  auto it = kv.find(k);
  int64_t v;
  return (it != kv.end() && parse_i64(it->second, v)) ? v : d;
}
static double kv_dbl(const KV& kv, const char* k, double d) {
  auto it = kv.find(k);
  double v;
  return (it != kv.end() && parse_dbl(it->second, v)) ? v : d;
}
static std::string kv_str(const KV& kv, const char* k) {
  auto it = kv.find(k);
  return it == kv.end() ? "" : it->second;
}

Registry read_registry(const std::string& state_dir, const std::string& cur_boot, bool measure,
                       PeakMap* peaks, const PeakMap* sensor_peaks) {
  Registry r;
  std::string dir = state_dir + "/jobs";
  int err = 0;
  std::vector<std::string> names = list_dir(dir, 4096, &err);
  if (err == ENOENT) return r;  // no registry yet: nothing registered
  if (err) {
    r.err = err;
    r.errmsg = "cannot read " + dir + ": " + strerror(err);
    return r;
  }
  std::sort(names.begin(), names.end());
  double now = now_wall();
  std::set<std::pair<int, int64_t>> live_keys;
  for (auto& n : names) {
    if (!ends_with(n, ".job") || starts_with(n, ".")) continue;
    std::string path = dir + "/" + n;
    std::string text;
    int e = read_file(path, text, 64 * 1024, /*follow=*/false);
    if (e == ENOENT) continue;  // released between readdir and open
    if (e) {
      r.err = e;
      r.errmsg = "cannot read envelope " + path + ": " + strerror(e);
      return r;
    }
    JobInfo j;
    j.file = n;
    parse_kv(text, j.kv);
    int64_t pid = kv_i64(j.kv, "pid", -1);
    if (pid <= 0) {
      int64_t stem;
      if (parse_i64(n.substr(0, n.size() - 4), stem)) pid = stem;
    }
    j.pid = (pid > 0 && pid < INT32_MAX) ? (int)pid : -1;
    j.name = kv_str(j.kv, "name");
    j.cmd = kv_str(j.kv, "cmd");
    j.owner = kv_str(j.kv, "owner");
    j.priority = (int)kv_i64(j.kv, "priority", 5);
    j.can_restart = kv_i64(j.kv, "can_restart", 0) == 1;
    j.gpu = kv_i64(j.kv, "gpu", 0) == 1;
    j.peak_gb = std::max(0.0, kv_dbl(j.kv, "peak_gb", 0));
    j.declared_b = j.peak_gb * kGiB;
    j.pstart = kv_i64(j.kv, "pstart", -1);
    j.started = kv_i64(j.kv, "started", -1);
    j.admitted = kv_i64(j.kv, "admitted", -1);
    j.threads = kv_i64(j.kv, "threads", -1);
    j.disk_gb = kv_dbl(j.kv, "disk_gb", -1);
    j.disk_avail0_b = kv_dbl(j.kv, "disk_avail0_b", -1);
    j.disk_path = kv_str(j.kv, "disk_path");
    j.disk_fsid = kv_str(j.kv, "disk_fsid");
    j.heartbeat = kv_str(j.kv, "heartbeat");
    j.sig = kv_str(j.kv, "sig");
    if (!safe_token(j.sig, 64)) j.sig = job_sig(j.name, j.cmd);
    ProcInfo pi;
    j.identity = verify_identity(j.kv, j.pid, cur_boot, &pi);
    j.proc_start = pi.start_s;
    if (measure && (j.identity == "ok" || j.identity == "unverifiable")) {
      TreeUse u = tree_usage(j.pid);
      j.fp_b = u.fp;
      j.res_b = u.res;
      j.peak_fp_b = u.fp;
      auto key = std::make_pair(j.pid, pi.start_s);
      if (peaks) {
        int64_t& pk = (*peaks)[key];
        pk = std::max(pk, u.fp);
        j.peak_fp_b = pk;
        live_keys.insert(key);
      }
      if (sensor_peaks) {
        auto it = sensor_peaks->find(key);
        if (it != sensor_peaks->end()) j.peak_fp_b = std::max(j.peak_fp_b, it->second);
      }
    }
    // SCHEMA §9.1: a measurement can RAISE a reservation, never shrink it below
    // the declaration.
    j.reserved_b = std::max(j.declared_b, (double)std::max<int64_t>(j.peak_fp_b, 0));
    if (!j.heartbeat.empty()) {
      double mt;
      if (path_mtime(j.heartbeat, mt)) {
        j.hb_age_s = (int64_t)std::max(0.0, std::floor(now - mt));
      } else {
        // Declared but never written: the job has not shown a sign of life since it
        // was admitted.
        int64_t since = j.admitted > 0 ? j.admitted : j.started;
        j.hb_age_s = since > 0 ? std::max<int64_t>(0, (int64_t)now - since) : -1;
      }
    }
    r.jobs.push_back(std::move(j));
    if (r.jobs.size() >= 1024) break;
  }
  if (peaks) {  // forget peaks of processes that are no longer registered
    for (auto it = peaks->begin(); it != peaks->end();) {
      if (!live_keys.count(it->first)) it = peaks->erase(it);
      else ++it;
    }
  }
  std::sort(r.jobs.begin(), r.jobs.end(), [](const JobInfo& a, const JobInfo& b) { return a.pid < b.pid; });
  return r;
}

// ---------------------------------------------------------------- pidinfo
int cmd_pidinfo(int argc, char** argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: forge-guardian-sensor pidinfo PID...\n");
    return kExitUsage;
  }
  std::vector<int> pids;
  for (int i = 2; i < argc; ++i) {
    int64_t v;
    if (!parse_i64(argv[i], v) || v <= 0 || v > INT32_MAX) {
      fprintf(stderr, "forge-guardian-sensor pidinfo: not a pid: %s\n", argv[i]);
      return kExitUsage;
    }
    pids.push_back((int)v);
  }
  for (int pid : pids) {
    ProcInfo pi = proc_info(pid);
    if (!pi.alive) {
      printf("pid=%d identity=dead\n", pid);
      continue;
    }
    printf("pid=%d ppid=%d pstart=%lld uid=%lld comm=%s identity=alive\n", pid, pi.ppid,
           (long long)pi.start_s, (long long)pi.uid, env_word(pi.comm).c_str());
  }
  return kExitOk;
}

}  // namespace fgs
