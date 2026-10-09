// forge-guardian-sensor -- processes, envelopes and identity (SCHEMA §5).
//
// An envelope names a PROCESS, not a number. pids are reused; a pid alone has already
// cost this program a stale lock that named a different process (forge-guardian's
// single-instance guard). Everything that counts or signals an envelope's pid goes
// through verify_identity() first.
#import <Foundation/Foundation.h>

#include "sensor.hpp"

#include <fcntl.h>
#include <libproc.h>
#include <signal.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <unistd.h>
#include <xlocale.h>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstring>
#include <ctime>
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

bool proc_argv(int pid, std::vector<std::string>& argv) {
  argv.clear();
  if (pid <= 0) return false;
  int argmax = 0;
  size_t sz = sizeof argmax;
  int m1[2] = {CTL_KERN, KERN_ARGMAX};
  if (sysctl(m1, 2, &argmax, &sz, nullptr, 0) != 0 || argmax <= 0) return false;
  std::vector<char> buf((size_t)argmax);
  int m2[3] = {CTL_KERN, KERN_PROCARGS2, pid};
  sz = buf.size();
  if (sysctl(m2, 3, buf.data(), &sz, nullptr, 0) != 0 || sz < sizeof(int)) return false;
  int argc = 0;
  memcpy(&argc, buf.data(), sizeof argc);
  if (argc <= 0 || argc > 65536) return false;
  size_t p = sizeof(int);
  while (p < sz && buf[p] != '\0') ++p;  // the exec path
  while (p < sz && buf[p] == '\0') ++p;  // its padding
  for (int i = 0; i < argc && p < sz; ++i) {
    size_t s = p;
    while (p < sz && buf[p] != '\0') ++p;
    argv.emplace_back(buf.data() + s, p - s);
    ++p;
  }
  return (int)argv.size() == argc;
}

bool canonical_pid(std::string_view s, int& out) {
  if (s.empty() || s.size() > 5 || s[0] == '0') return false;
  int v = 0;
  for (char c : s) {
    if (c < '0' || c > '9') return false;
    v = v * 10 + (c - '0');
  }
  if (v < 1 || v > 99999) return false;
  out = v;
  return true;
}

// ---------------------------------------------------------------- SCHEMA §5 protection
bool protected_name(const std::string& comm) {
  std::string c = comm;
  size_t sl = c.find_last_of('/');
  if (sl != std::string::npos) c = c.substr(sl + 1);
  if (c.empty()) return true;  // an unknown name is protected
  static const std::set<std::string> names{
      "claude", "node", "Claude", "WindowServer", "loginwindow", "Finder", "Dock", "SystemUIServer",
      "kernel_task", "launchd", "sshd", "forge-guardian", "forge-guardian-sensor",
      "forge-guardian-s",  // forge-guardian-sensor as p_comm truncates it (16 characters)
  };
  if (names.count(c)) return true;
  return starts_with(c, "Claude Helper");
}

// ps(1) prints lstart with strftime("%c"), in the locale of whoever ran it: under
// launchd the plist sets LC_ALL=C; a governor started by hand inherits the user's.
// Whitespace runs are collapsed (ps pads the field).
static std::string collapse_ws(std::string_view s) {
  std::string o;
  bool sp = false;
  for (char c : s) {
    if (c == ' ' || c == '\t' || c == '\n' || c == '\r') { sp = !o.empty(); continue; }
    if (sp) o += ' ';
    sp = false;
    o += c;
  }
  return o;
}

static bool lstart_matches(int64_t start_s, const std::string& text) {
  std::string want = collapse_ws(text);
  if (want.empty() || start_s <= 0) return false;
  time_t t = (time_t)start_s;
  struct tm tmv;
  if (!localtime_r(&t, &tmv)) return false;
  for (const char* loc : {"C", ""}) {
    locale_t l = newlocale(LC_ALL_MASK, loc, nullptr);
    if (!l) continue;
    char buf[160];
    size_t n = strftime_l(buf, sizeof buf, "%c", &tmv, l);
    freelocale(l);
    if (n > 0 && collapse_ws(std::string_view(buf, n)) == want) return true;
  }
  return false;
}

static int lock_holder_pid(const std::string& D) {
  std::string t;
  if (D.empty() || read_file(D + "/guardian.lock/pid", t, 64, false) != 0) return -1;
  int p;
  return canonical_pid(trim(t), p) ? p : -1;
}

std::string governor_check(const std::string& D, int* pid_out) {
  if (pid_out) *pid_out = -1;
  std::string t;
  int e = read_file(D + "/guardian.lock/pid", t, 64, false);
  if (e) return "no guardian.lock/pid (" + std::string(strerror(e)) + ")";
  int pid;
  if (!canonical_pid(trim(t), pid)) return "guardian.lock/pid is not a pid ('" + one_line(trim(t), 40) + "')";
  std::string started;
  e = read_file(D + "/guardian.lock/started", started, 256, false);
  if (e) return "no guardian.lock/started (" + std::string(strerror(e)) + ")";
  ProcInfo pi = proc_info(pid);
  if (!pi.alive) return "guardian.lock names pid " + std::to_string(pid) + ", which is not running";
  if (!lstart_matches(pi.start_s, started))
    return "pid " + std::to_string(pid) + " did not start at '" + collapse_ws(started) +
           "' (guardian.lock/started): the pid was reused";
  std::vector<std::string> av;
  if (!proc_argv(pid, av) || av.empty()) return "cannot read the argv of pid " + std::to_string(pid);
  const std::string& last = av.back();
  std::string base = last.substr(last.find_last_of('/') == std::string::npos ? 0 : last.find_last_of('/') + 1);
  if (base != "forge-guardian")
    return "pid " + std::to_string(pid) + " is not forge-guardian (argv ends in '" + one_line(last, 120) + "')";
  if (pid_out) *pid_out = pid;
  return "";
}

static int sensor_lock_holder(const std::string& D) {
  if (D.empty()) return -1;
  int fd = open((D + "/sensor.lock").c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
  if (fd < 0) return -1;
  struct flock q;
  memset(&q, 0, sizeof q);
  q.l_type = F_RDLCK;  // the sensor's write lock conflicts with a read lock
  q.l_whence = SEEK_SET;
  int holder = -1;
  if (fcntl(fd, F_GETLK, &q) == 0 && q.l_type != F_UNLCK) holder = (int)q.l_pid;
  close(fd);
  return holder;
}

std::string protected_why(int pid, const ProcInfo& pi, const std::string& D) {
  if (pid <= 1) return "pid " + std::to_string(pid) + " <= 1";
  if (pid == (int)getpid()) return "the sensor itself";
  if (pi.uid < 0) return "owner unknown";
  if (pi.uid != (int64_t)getuid())
    return "owned by uid " + std::to_string(pi.uid) + ", not " + std::to_string(getuid());
  if (protected_name(pi.comm))
    return pi.comm.empty() ? std::string("process name unknown") : "protected process name '" + pi.comm + "'";
  if (!D.empty()) {
    // The lock holder is protected even unverified (refusing is the safe direction);
    // its ancestors only when it IS the live governor, never a reused pid's.
    int holder = lock_holder_pid(D);
    if (holder > 0 && holder == pid) return "the governor (guardian.lock holder)";
    int gov = -1;
    if (holder > 0 && governor_check(D, &gov).empty()) {
      int p = proc_info(gov).ppid;
      for (int d = 0; p > 1 && d < 64; ++d) {
        if (p == pid) return "an ancestor of the governor (pid " + std::to_string(gov) + ")";
        p = proc_info(p).ppid;
      }
    }
    int sh = sensor_lock_holder(D);
    if (sh > 0 && sh == pid) return "the sensor (sensor.lock holder)";
  }
  return "";
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
  // SCHEMA §6 registry limits. THE BUG THIS CLOSES (review 2026-10-08 R4): readdir was
  // cut at 4096 raw entries (tmp files included) BEFORE the *.job filter, and the
  // envelope list at 1024 after a sort by name, both SILENTLY -- a 25 GiB job named
  // zzzz.job vanished from the budget and admit admitted past it. A registry that
  // cannot be read completely is an error, never a shorter registry.
  std::vector<std::string> names = list_dir(dir, kMaxJobDirEntries + 1, &err);
  if (err == ENOENT) return r;  // no registry yet: nothing registered
  if (err) {
    r.err = err;
    r.errmsg = "cannot read " + dir + ": " + strerror(err);
    return r;
  }
  if (names.size() > kMaxJobDirEntries) {
    r.err = E2BIG;
    r.errmsg = dir + " has more than " + std::to_string(kMaxJobDirEntries) + " entries: the registry cannot be read completely";
    return r;
  }
  std::sort(names.begin(), names.end());
  // Envelopes are REGULAR *.job files. A FIFO, directory, symlink or device named
  // *.job is not an envelope and is never opened (a FIFO must never block a reader;
  // review R1). lstat first; read_file's O_NONBLOCK + S_ISREG covers the race.
  std::vector<std::pair<std::string, off_t>> envs;
  for (auto& n : names) {
    if (!ends_with(n, ".job") || starts_with(n, ".")) continue;
    struct stat st;
    if (lstat((dir + "/" + n).c_str(), &st) != 0 || !S_ISREG(st.st_mode)) continue;
    envs.emplace_back(n, st.st_size);
  }
  if (envs.size() > kMaxEnvelopes) {
    r.err = E2BIG;
    r.errmsg = dir + " holds " + std::to_string(envs.size()) + " envelopes, more than " + std::to_string(kMaxEnvelopes) +
               ": the registry cannot be read completely";
    return r;
  }
  double now = now_wall();
  std::set<std::pair<int, int64_t>> live_keys;
  for (auto& [n, fsize] : envs) {
    std::string path = dir + "/" + n;
    std::string text;
    int e = read_file(path, text, kMaxEnvelopeBytes, /*follow=*/false);
    if (e == ENOENT) continue;               // released between readdir and open
    if (e == EINVAL || e == ELOOP) continue;  // replaced by a non-regular file since lstat
    if (e) {
      r.err = e;
      r.errmsg = "cannot read envelope " + path + ": " + strerror(e);
      return r;
    }
    JobInfo j;
    j.file = n;
    // R7: an envelope larger than 64 KiB is read up to 64 KiB (pid, pstart and peak_gb
    // come first; cmd is last) and kept as unverifiable -- counted, never signalled,
    // never dropped. The governor used to DELETE it, live job and all.
    j.oversize = fsize > (off_t)kMaxEnvelopeBytes || (text.size() >= kMaxEnvelopeBytes && (off_t)text.size() > fsize);
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
    {
      // FO-5: a declaration that does not parse ("24GiB", "", missing, negative) is
      // not a reservation of 0. It is recorded as unreadable; admission cannot decide.
      auto it = j.kv.find("peak_gb");
      double pg = -1;
      j.peak_ok = it != j.kv.end() && parse_dbl(it->second, pg) && pg >= 0;
      j.peak_gb = j.peak_ok ? pg : 0;
    }
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
    if (j.oversize && j.identity != "dead") j.identity = "unverifiable";
    j.proc_start = pi.start_s;
    if (!j.peak_ok && j.live() && r.undecidable.empty()) {
      auto it = j.kv.find("peak_gb");
      r.undecidable = "envelope " + path + " (pid " + std::to_string(j.pid) + ", " + j.identity +
                      ") has peak_gb " + (it == j.kv.end() ? std::string("missing") : "'" + one_line(it->second, 40) + "'") +
                      ", which is not a decimal >= 0";
    }
    if (measure && j.live()) {
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
// pidinfo [--state-dir D] PID...
//   pid=N ppid=P pstart=S uid=U protected=0|1 comm=<percent-encoded> identity=alive
//   pid=N identity=dead
// comm stays percent-encoded (%20 for a space) and stays the field just before
// identity=, so existing `${out#*comm=}% identity=*` parsers keep working. protected=
// is computed HERE from the one SCHEMA §5 list on the DECODED name, so no consumer has
// to re-derive it: the governor once matched 'Claude Helper*' against the encoded
// 'Claude%20Helper' and signalled every Claude helper (review 2026-10-08 ACT-1).
int cmd_pidinfo(int argc, char** argv) {
  Args a = parse_args(argc, argv, 2, {"state-dir"}, {});
  if (!a.error.empty() || a.pos.empty()) {
    fprintf(stderr, "usage: forge-guardian-sensor pidinfo [--state-dir D] PID...%s%s\n", a.error.empty() ? "" : "\n",
            a.error.c_str());
    return kExitUsage;
  }
  std::string D = a.get("state-dir");
  std::vector<int> pids;
  for (auto& s : a.pos) {
    int64_t v;
    if (!parse_i64(s, v) || v <= 0 || v > INT32_MAX) {
      fprintf(stderr, "forge-guardian-sensor pidinfo: not a pid: %s\n", s.c_str());
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
    bool prot = !protected_why(pid, pi, D).empty();
    printf("pid=%d ppid=%d pstart=%lld uid=%lld protected=%d comm=%s identity=alive\n", pid, pi.ppid,
           (long long)pi.start_s, (long long)pi.uid, prot ? 1 : 0, env_word(pi.comm).c_str());
  }
  return kExitOk;
}

}  // namespace fgs
