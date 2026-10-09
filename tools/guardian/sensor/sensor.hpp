// forge-guardian-sensor -- shared declarations.
//
// The binding contract is tools/guardian/SCHEMA.md. Section numbers in comments
// (§3, §5, ...) refer to it. Every file this program writes is created under
// umask 077 and published by write-to-<name>.tmp.<pid> + rename(2): a failed or
// short write is never renamed, so a reader sees the previous good file or the
// new good file, never a torn one.
#pragma once

#include <cstdint>
#include <map>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
#include <sys/types.h>

#ifdef __OBJC__
#import <Foundation/Foundation.h>
#endif

namespace fgs {

inline constexpr const char* kVersion = "2.0.0";
inline constexpr const char* kSensorSchema = "forge.guardian.sensor/1";
inline constexpr double kGiB = 1073741824.0;
inline constexpr double kMiB = 1048576.0;

// SCHEMA §11.
enum Exit : int {
  kExitOk = 0,
  kExitDeny = 1,
  kExitUsage = 2,
  kExitDup = 3,
  kExitInternal = 70,
  kExitTempfail = 75,
  kExitQuarantined = 78,
};

// ---------------------------------------------------------------- util.mm
bool test_mode();                       // FORGE_SENSOR_TEST=1, read once
const char* test_env(const char* name); // getenv, but ONLY in test mode
double now_wall();                      // honours FORGE_SENSOR_TEST_NOW in test mode
uint64_t mono_ms();                     // mach_continuous_time (counts sleep)
std::string home_dir();
std::string expand_tilde(const std::string& p);
std::string iso_utc(double t);          // 2026-10-08T05:57:00Z
std::string utc_compact(double t);      // 20261008T055700Z
std::string local_stamp(double t);      // 2026-10-08 01:57:00 (local, for log show)
std::string fmt_num(double v, int prec = 3);  // trailing zeros trimmed
std::string fmt_gib(double bytes);            // one decimal: "31.0"
std::string trim(std::string_view s);
std::vector<std::string> split(std::string_view s, char sep);
bool parse_i64(std::string_view s, int64_t& out);
bool parse_dbl(std::string_view s, double& out);
bool starts_with(std::string_view s, std::string_view p);
bool ends_with(std::string_view s, std::string_view p);
bool contains(std::string_view s, std::string_view p);
std::string lower(std::string_view s);
std::string upper(std::string_view s);
std::string env_word(std::string_view s);         // percent-encode for KEY=VALUE files
std::string one_line(std::string_view s, size_t cap);  // newlines -> space, capped
bool safe_token(std::string_view s, size_t maxlen);    // [A-Za-z0-9._-]{1,maxlen}
std::string user_name();

// Files. Every function returns 0 or an errno.
int mkdirs(const std::string& path, mode_t mode = 0700);
// Regular files only (a FIFO named *.job must never block a reader). Reads at most
// `cap` bytes. follow=false refuses a symlink in the last component.
int read_file(const std::string& path, std::string& out, size_t cap, bool follow = false);
int read_tail(const std::string& path, std::string& out, size_t cap);
// tmp.<pid> + write + fsync (F_FULLFSYNC when full_sync) + close + rename. Every
// step is checked; on any failure the tmp file is unlinked and nothing is renamed.
int write_atomic(const std::string& path, std::string_view data, bool full_sync = false);
// Two-phase variant for publishing a PAIR of files from one snapshot.
int write_tmp(const std::string& path, std::string_view data, std::string& tmp_out);
int commit_tmp(const std::string& tmp, const std::string& path);
// One whole record per O_APPEND write(2). A short or failed write (a full disk) is
// truncated back to the size the file had immediately before it, so a torn fragment
// never glues itself to the next writer's record (review 2026-10-08 R6).
int append_line(const std::string& path, std::string_view line);
// generations is clamped to 1..10 (SCHEMA §6: logs.generations 1-10).
void rotate_if_needed(const std::string& path, uint64_t max_bytes, int generations);
std::vector<std::string> list_dir(const std::string& dir, size_t max, int* err);
bool path_mtime(const std::string& path, double& mt, bool follow = true);

std::string sha256_hex(std::string_view data);
std::string json_escape(std::string_view s);  // without the quotes; invalid UTF-8 -> U+FFFD

// A small JSON writer with deterministic key order. Non-finite numbers -> null.
class JW {
 public:
  std::string out;
  JW& begin_obj();
  JW& end_obj();
  JW& begin_arr();
  JW& end_arr();
  JW& key(std::string_view k);
  JW& str(std::string_view v);
  JW& i64(int64_t v);
  JW& num(double v, int prec = 3);
  JW& boolean(bool v);
  JW& null();
  JW& raw(std::string_view json);  // caller guarantees valid JSON
  // Convenience: key + value.
  JW& ks(std::string_view k, std::string_view v) { return key(k).str(v); }
  JW& ki(std::string_view k, int64_t v) { return key(k).i64(v); }
  JW& kn(std::string_view k, double v, int prec = 3) { return key(k).num(v, prec); }
  JW& kb(std::string_view k, bool v) { return key(k).boolean(v); }
  JW& knull(std::string_view k) { return key(k).null(); }

 private:
  std::vector<bool> first_;
  bool after_key_ = false;
  void prefix();
};

// Events (§7): one JSON object per line in <D>/events.jsonl.
class Ev {
 public:
  explicit Ev(std::string_view kind);
  Ev& s(std::string_view k, std::string_view v) { w_.ks(k, v); return *this; }
  Ev& i(std::string_view k, int64_t v) { w_.ki(k, v); return *this; }
  Ev& n(std::string_view k, double v) { w_.kn(k, v); return *this; }
  Ev& b(std::string_view k, bool v) { w_.kb(k, v); return *this; }
  Ev& raw(std::string_view k, std::string_view json) { w_.key(k).raw(json); return *this; }
  const std::string& line();
  int write(const std::string& state_dir);  // 0 or errno

 private:
  JW w_;
  bool done_ = false;
};

// log/sensor.log
void log_open(const std::string& state_dir);
void logf(const char* fmt, ...) __attribute__((format(printf, 1, 2)));

#ifdef __OBJC__
id json_parse(std::string_view s);  // NSDictionary / NSArray, or nil
NSDictionary* json_obj(std::string_view s);
bool ns_is_bool(id v);
bool ns_num(id v, double& out);  // a JSON number, never a JSON bool
std::string ns_str(id v);        // "" unless NSString
std::string ns_compact(id obj);  // compact JSON text, "" on failure
#endif

// ---------------------------------------------------------------- policy.mm
struct WatchLog {
  std::string path;
  std::string kind = "gpu_error";
  std::vector<std::string> patterns;
};

struct Policy {
  int poll_s = 5, escalate_polls = 2, deescalate_polls = 6, sensor_stale_polls = 3;
  std::vector<std::string> required_signals{"vm_pressure", "swap", "pageouts", "disk", "thermal"};
  double os_reserve_gb = 6, instant_margin_gb = 2, light_job_gb = 0.5;
  bool enforce_instant_fit = true;
  double floor_yellow = 45, floor_orange = 25, floor_red = 12;
  std::vector<std::string> volumes{"~", "/private/tmp"};
  std::string admission_floor = "yellow";
  std::string thermal_fair = "YELLOW", thermal_serious = "ORANGE", thermal_critical = "RED";
  int settle_s = 180, term_grace_s = 45;
  int max_crashes = 3, window_s = 900;
  std::vector<std::string> crash_signals{"SEGV", "BUS", "ILL", "ABRT", "FPE", "TRAP", "SYS", "KILL"};
  int restart_max_starts = 5, restart_window_s = 900, restart_backoff_s = 300;
  int logs_cap_mib = 64, logs_rotate_mib = 4, logs_generations = 3, logs_history_mib = 6,
      logs_incident_max_kib = 512, logs_retention_days = 30;
  bool notifications_enabled = true;
  int notifications_min_interval_s = 1800;
  int reports_scan_interval_s = 600;
  int smart_interval_s = 21600;
  std::vector<WatchLog> watch_logs = default_watch_logs();

  double floor_gib(const std::string& level) const;
  static std::vector<WatchLog> default_watch_logs();
};

struct PolicyLoad {
  Policy p;
  std::string source = "builtin";  // builtin | <path>
  std::string error;               // non-empty: the file was rejected, p is the defaults
};

// <D>/policy.json if present, else policy_arg, else the built-in defaults.
PolicyLoad load_policy(const std::string& state_dir, const std::string& policy_arg);
std::string policy_env(const Policy& p, const std::string& source);
std::string policy_json(const Policy& p);
bool known_signal_name(const std::string& s);
// reports.scan_interval_s, or FORGE_SENSOR_TEST_SCAN_S in test mode (the policy bound is
// 60-86400 s; a gate cannot wait a minute per report).
int reports_scan_interval_s(const Policy& p);

// ---------------------------------------------------------------- procinfo.mm
struct ProcInfo {
  bool alive = false;
  bool zombie = false;
  int ppid = -1;
  int64_t start_s = -1, start_us = -1;
  int64_t uid = -1;
  std::string comm;  // raw p_comm / pbi_name bytes (pidinfo prints it percent-encoded)
};
ProcInfo proc_info(int pid);  // pid <= 0 is always dead
bool proc_argv(int pid, std::vector<std::string>& argv);  // KERN_PROCARGS2
// SCHEMA §5: canonical decimal, no sign, no leading zero, 1..99999.
bool canonical_pid(std::string_view s, int& out);

// SCHEMA §5 protected-process list (ONE list). A name is matched DECODED (raw bytes).
bool protected_name(const std::string& comm);
// FO-4: the domain's governor is the guardian.lock holder only while that pid is alive,
// started at the time guardian.lock/started records (ps lstart text) and runs an argv
// ending in forge-guardian. "" when verified (pid in *pid_out), else why not.
std::string governor_check(const std::string& state_dir, int* pid_out);
// SCHEMA §5: "" when PID may be signalled/admitted, else why it is protected or foreign.
// state_dir (may be empty) adds the guardian.lock holder, the verified governor's
// ancestors and the sensor.lock holder.
std::string protected_why(int pid, const ProcInfo& pi, const std::string& state_dir);

struct TreeUse {
  int64_t fp = -1, res = -1;
  int n = 0;
};
TreeUse tree_usage(int root);  // proc_pid_rusage(V4) over descendants, depth<=64, <=4096 pids

using PeakMap = std::map<std::pair<int, int64_t>, int64_t>;  // (pid, pstart) -> peak footprint

using KV = std::map<std::string, std::string>;
void parse_kv(std::string_view text, KV& kv, size_t line_cap = 4096);  // first key wins
std::string job_sig(const std::string& name, const std::string& cmd);  // sha256(name NUL cmd)[:16]

struct JobInfo {
  std::string file;
  int pid = -1;
  std::string name, identity = "unverifiable", sig, cmd, owner, heartbeat, disk_path, disk_fsid;
  int priority = 5;
  bool can_restart = false, gpu = false;
  double peak_gb = 0, disk_gb = -1, disk_avail0_b = -1;
  int64_t pstart = -1;       // declared
  int64_t proc_start = -1;   // observed
  int64_t threads = -1, started = -1, admitted = -1;
  int64_t fp_b = -1, res_b = -1, peak_fp_b = -1, hb_age_s = -1;
  double declared_b = 0, reserved_b = 0;  // reserved = max(declared, measured peak)
  bool peak_ok = true;    // peak_gb present, numeric, >= 0
  bool oversize = false;  // file > 64 KiB: identity forced to unverifiable (R7)
  KV kv;
  // A live envelope (identity ok or unverifiable) holds a reservation. Unverifiable
  // means "never signal", NOT "free memory" (review 2026-10-08 FO-5).
  bool live() const { return identity == "ok" || identity == "unverifiable"; }
};

std::string verify_identity(const KV& kv, int pid, const std::string& boot_uuid, ProcInfo* out);

// SCHEMA §6 registry limits.
inline constexpr size_t kMaxEnvelopes = 1024;
inline constexpr size_t kMaxJobDirEntries = 4096;
inline constexpr size_t kMaxEnvelopeBytes = 64 * 1024;

struct Registry {
  std::vector<JobInfo> jobs;
  int err = 0;           // errno if the registry could not be read (completely)
  std::string errmsg;
  // A live envelope whose declaration cannot be read: admission cannot decide (75)
  // and the published reservation total is unavailable.
  std::string undecidable;
};
// measure: walk process trees. peaks: running peak map (run mode), may be null.
// sensor_peaks: peak footprints published by a running sensor (admit), may be null.
Registry read_registry(const std::string& state_dir, const std::string& boot_uuid, bool measure,
                       PeakMap* peaks, const PeakMap* sensor_peaks);

std::string boot_uuid();   // kern.bootsessionuuid; FORGE_SENSOR_TEST_BOOT_UUID in test mode
int64_t boot_epoch();      // kern.boottime seconds

// ---------------------------------------------------------------- snapshot.mm
enum St : uint8_t { ST_OK, ST_UNAVAIL, ST_STALE, ST_INVALID };
const char* st_name(St s);
bool st_parse(std::string_view w, St& out);

struct Volume {
  std::string path, mount, fsid;
  double avail_b = -1, total_b = -1, growth_b_min = 0;
  St st = ST_UNAVAIL;
};

struct Snapshot {
  int pid = 0;
  uint64_t seq = 0;
  double ts = 0;
  uint64_t mono = 0;
  std::string boot_uuid;
  int64_t boot_epoch = -1;
  int rebaseline = 1, poll_s = 5;

  double vmp = -1; St vmp_st = ST_UNAVAIL;
  std::string pevent = "none"; St pevent_st = ST_UNAVAIL;
  double pevent_ts = -1; int64_t pevent_warn_n = 0, pevent_crit_n = 0;
  double freepct = -1; St freepct_st = ST_UNAVAIL;
  double mem_total_b = -1, mem_avail_b = -1, mem_free_b = -1, mem_wired_b = -1, mem_compressed_b = -1;
  St mem_st = ST_UNAVAIL;
  double swap_used_mb = -1, swap_total_mb = -1, swap_growth_mb_min = 0; St swap_st = ST_UNAVAIL;
  double pageouts_total = -1, pageout_rate_ps = 0, swapout_rate_ps = 0; St pageouts_st = ST_UNAVAIL;
  std::string thermal = "none"; St thermal_st = ST_UNAVAIL;
  double load1 = -1, cpu_busy_pct = -1, ncpu = -1, nperf = -1; St cpu_st = ST_UNAVAIL;
  std::vector<Volume> vols;
  double disk_min_avail_gib = -1; St disk_st = ST_UNAVAIL;
  std::vector<JobInfo> jobs; St jobs_st = ST_UNAVAIL;
  double reserved_b = -1, budget_b = -1; int overcommit = -1;  // -1: unavailable
  int64_t sleep_n = 0; double last_sleep_ts = -1, last_wake_ts = -1;
  double self_cpu_s = 0; int64_t self_rss_b = 0, self_fds = 0;
  int64_t errors = 0;
  int64_t inbox_ingested = 0, inbox_invalid = 0;
  std::string injected;  // keys applied from FORGE_SENSOR_INJECT (test mode), space-joined
};

struct VolPrev {
  double avail = 0;
  uint64_t mono = 0;
  double ewma = 0;
};

class Sampler {
 public:
  std::string state_dir;   // may be empty (no jobs)
  Policy pol;
  int poll_s = 5;
  uint64_t seq = 0;
  bool rebaseline = true;
  // previous counters for monotonic-time rates
  bool have_prev = false;
  uint64_t prev_mono = 0;
  double prev_pageouts = 0, prev_swapouts = 0, prev_swap_used_mb = 0;
  uint64_t prev_cpu[4] = {0, 0, 0, 0};
  double last_po_rate = 0, last_so_rate = 0, last_swap_growth = 0, last_busy = 0;
  std::map<std::string, VolPrev> volprev;
  PeakMap peaks;
  const PeakMap* sensor_peaks = nullptr;
  // pressure-event source state (run mode only)
  bool pevent_armed = false;
  std::string pevent = "normal";
  double pevent_ts = -1;
  int64_t warn_n = 0, crit_n = 0;
  // power
  int64_t sleep_n = 0;
  double last_sleep_ts = -1, last_wake_ts = -1;
  int64_t errors = 0;
  int64_t inbox_ingested = 0, inbox_invalid = 0;

  Snapshot sample(bool with_jobs = true);
};

std::string encode_env(const Snapshot& s);
std::string encode_json(const Snapshot& s);
// Re-derive the aggregates (disk, reservations) after a change to the inputs.
void derive(Snapshot& s, const Policy& p);
// statfs a path; walk_up measures a not-yet-existing path at its nearest ancestor.
bool vol_stat(const std::string& path, Volume& v, bool walk_up = false);

// ---------------------------------------------------------------- reports.mm
struct Report {
  std::string dir, name, path, category, bug_type, summary, largest, panic_line;
  double mtime = 0;
  int64_t size = 0;
  std::vector<std::string> kill_reasons;  // distinct reasons, sorted
  std::vector<std::string> killed;        // "name(reason)", capped
  bool jetsam_parsed = false, per_process_only = false, readable = true;
  bool incident_worthy() const;
};
// system + user (or FORGE_SENSOR_TEST_REPORT_DIRS), each followed by its Retired/
// subdirectory: macOS moves every report there at its daily run (review SEM-1).
std::vector<std::string> report_dirs();
// A report's identity across a move into Retired/: basename + mtime second.
std::string report_key(const std::string& name, double mtime);
std::string classify_report_name(const std::string& name);
Report analyze_report(const std::string& dir, const std::string& name, double mtime, int64_t size,
                      bool deep);
// mtime in (since, until]; newest last; at most max.
std::vector<Report> scan_reports(const std::vector<std::string>& dirs, double since, double until,
                                 size_t max, bool deep);
void report_json(JW& w, const Report& r);

struct IncidentReq {
  std::string kind, note, job_sig, rate_key;
  int window_min = 30;
  bool with_log = false;
};
// 0 = created (dir_out), 1 = rate-limited, other = errno-ish failure (err)
int make_incident(const std::string& state_dir, const Policy& pol, const IncidentReq& rq,
                  std::string& dir_out, std::string& err);
bool incident_kind_known(const std::string& k);

// ---------------------------------------------------------------- session.mm
struct Session {
  std::string boot_uuid;
  int64_t boot_epoch = -1;
  double sensor_start = 0, last_heartbeat = 0;
  uint64_t last_hb_mono = 0;
  bool orderly_stop = false;
  double orderly_stop_ts = -1;
  std::string stop_reason;
  int64_t sleeps = 0;
  double last_sleep_ts = -1, last_wake_ts = -1;
  bool asleep = false;
};
int session_save(const std::string& state_dir, Session& s);  // stamps last_heartbeat, F_FULLFSYNC
// Moves current.json to previous.json with a classification, appends boots.jsonl.
// Returns the classification, or "" when there was no previous session.
std::string session_begin(const std::string& state_dir, const Session& cur,
                          const std::vector<std::string>& report_dirs);

// ---------------------------------------------------------------- commands
int cmd_run(int argc, char** argv);
int cmd_snapshot(int argc, char** argv);
int cmd_pidinfo(int argc, char** argv);
int cmd_admit(int argc, char** argv);
int cmd_release(int argc, char** argv);
int cmd_quarantine_clear(int argc, char** argv);
int cmd_incident(int argc, char** argv);
int cmd_session(int argc, char** argv);
int cmd_reports(int argc, char** argv);
int cmd_policy(int argc, char** argv);

// Minimal argv parser shared by the subcommands.
struct Args {
  std::map<std::string, std::string> opt;  // --key value
  std::set<std::string> flag;              // --flag
  std::vector<std::string> pos;
  std::string error;
  bool has(const std::string& k) const { return opt.count(k) || flag.count(k); }
  std::string get(const std::string& k, const std::string& d = "") const {
    auto it = opt.find(k);
    return it == opt.end() ? d : it->second;
  }
};
// valued: options that take a value; flags: options that do not.
Args parse_args(int argc, char** argv, int start, const std::set<std::string>& valued,
                const std::set<std::string>& flags);

}  // namespace fgs
