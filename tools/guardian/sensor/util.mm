// forge-guardian-sensor -- utilities: time, files, JSON, events, logging.
#import <Foundation/Foundation.h>

#include "sensor.hpp"

#include <CommonCrypto/CommonDigest.h>
#include <dirent.h>
#include <fcntl.h>
#include <mach/mach_time.h>
#include <pwd.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>

namespace fgs {

// ------------------------------------------------------------------ test mode
bool test_mode() {
  static int v = -1;
  if (v < 0) {
    const char* e = getenv("FORGE_SENSOR_TEST");
    v = (e && strcmp(e, "1") == 0) ? 1 : 0;
  }
  return v == 1;
}

// Test hooks are honoured ONLY under FORGE_SENSOR_TEST=1: a stray variable in a
// production environment must not be able to fake a boot, a clock or a reading.
const char* test_env(const char* name) {
  if (!test_mode()) return nullptr;
  const char* e = getenv(name);
  return (e && *e) ? e : nullptr;
}

// ------------------------------------------------------------------ time
double now_wall() {
  if (const char* e = test_env("FORGE_SENSOR_TEST_NOW")) {
    double d;
    if (parse_dbl(e, d)) return d;
  }
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  return (double)ts.tv_sec + (double)ts.tv_nsec / 1e9;
}

// mach_continuous_time does not jump with the wall clock and DOES count sleep, so a
// rate computed across a sleep divides by the real elapsed time (and the first
// snapshot after a wake is a rebaseline anyway).
uint64_t mono_ms() {
  static mach_timebase_info_data_t tb;
  if (tb.denom == 0) mach_timebase_info(&tb);
  unsigned __int128 t = mach_continuous_time();
  return (uint64_t)(t * tb.numer / tb.denom / 1000000ULL);
}

std::string home_dir() {
  const char* h = getenv("HOME");
  if (h && *h) return h;
  struct passwd* pw = getpwuid(getuid());
  if (pw && pw->pw_dir) return pw->pw_dir;
  return "/";
}

std::string expand_tilde(const std::string& p) {
  if (p == "~") return home_dir();
  if (starts_with(p, "~/")) return home_dir() + p.substr(1);
  return p;
}

static std::string fmt_time(double t, const char* fmt, bool utc) {
  time_t s = (time_t)t;
  struct tm tmv;
  if (utc) gmtime_r(&s, &tmv); else localtime_r(&s, &tmv);
  char buf[64];
  strftime(buf, sizeof buf, fmt, &tmv);
  return buf;
}
std::string iso_utc(double t) { return fmt_time(t, "%Y-%m-%dT%H:%M:%SZ", true); }
std::string utc_compact(double t) { return fmt_time(t, "%Y%m%dT%H%M%SZ", true); }
std::string local_stamp(double t) { return fmt_time(t, "%Y-%m-%d %H:%M:%S", false); }

// ------------------------------------------------------------------ strings
std::string fmt_num(double v, int prec) {
  if (!std::isfinite(v)) return "-1";
  char buf[64];
  snprintf(buf, sizeof buf, "%.*f", prec, v);
  std::string s(buf);
  if (s.find('.') != std::string::npos) {
    while (!s.empty() && s.back() == '0') s.pop_back();
    if (!s.empty() && s.back() == '.') s.pop_back();
  }
  if (s == "-0") s = "0";
  return s;
}

// One decimal, as reasons are read by people ("reserved 31.0 + new 8.0 > 30.0 GiB"),
// but never a misleading 0.0 for a small non-zero amount (a 2 MiB volume).
std::string fmt_gib(double bytes) {
  char buf[64];
  double g = bytes / kGiB;
  if (g != 0 && std::fabs(g) < 0.1) snprintf(buf, sizeof buf, "%.4f", g);
  else snprintf(buf, sizeof buf, "%.1f", g);
  return buf;
}

std::string trim(std::string_view s) {
  size_t a = 0, b = s.size();
  while (a < b && (s[a] == ' ' || s[a] == '\t' || s[a] == '\r' || s[a] == '\n')) ++a;
  while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t' || s[b - 1] == '\r' || s[b - 1] == '\n')) --b;
  return std::string(s.substr(a, b - a));
}

std::vector<std::string> split(std::string_view s, char sep) {
  std::vector<std::string> out;
  size_t start = 0;
  for (size_t i = 0; i <= s.size(); ++i) {
    if (i == s.size() || s[i] == sep) {
      out.emplace_back(s.substr(start, i - start));
      start = i + 1;
    }
  }
  return out;
}

bool parse_i64(std::string_view s, int64_t& out) {
  std::string t = trim(s);
  if (t.empty() || t.size() > 20) return false;
  char* end = nullptr;
  errno = 0;
  long long v = strtoll(t.c_str(), &end, 10);
  if (errno != 0 || !end || *end != '\0') return false;
  out = v;
  return true;
}

bool parse_dbl(std::string_view s, double& out) {
  std::string t = trim(s);
  if (t.empty() || t.size() > 64) return false;
  // strtod accepts "nan", "inf" and hex floats; a published number must be finite.
  char* end = nullptr;
  errno = 0;
  double v = strtod(t.c_str(), &end);
  if (errno != 0 || !end || *end != '\0' || !std::isfinite(v)) return false;
  out = v;
  return true;
}

bool starts_with(std::string_view s, std::string_view p) {
  return s.size() >= p.size() && s.compare(0, p.size(), p) == 0;
}
bool ends_with(std::string_view s, std::string_view p) {
  return s.size() >= p.size() && s.compare(s.size() - p.size(), p.size(), p) == 0;
}
bool contains(std::string_view s, std::string_view p) { return s.find(p) != std::string_view::npos; }

std::string lower(std::string_view s) {
  std::string o(s);
  for (auto& c : o) if (c >= 'A' && c <= 'Z') c = (char)(c - 'A' + 'a');
  return o;
}
std::string upper(std::string_view s) {
  std::string o(s);
  for (auto& c : o) if (c >= 'a' && c <= 'z') c = (char)(c - 'a' + 'A');
  return o;
}

// .env values carry no spaces and no quoting (zsh parses them without a fork).
// Anything that could break a KEY=VALUE line or a shell word is percent-encoded, which
// is reversible, unlike substituting '_'.
std::string env_word(std::string_view s) {
  if (s.empty()) return "none";
  static const char* hex = "0123456789ABCDEF";
  std::string o;
  o.reserve(s.size());
  for (unsigned char c : s) {
    if (c <= 0x20 || c == 0x7f || c == '%' || c == '"' || c == '\'' || c == '\\' || c == '$' ||
        c == '`' || c == ';' || c == '&' || c == '|') {
      o += '%';
      o += hex[c >> 4];
      o += hex[c & 15];
    } else {
      o += (char)c;
    }
  }
  return o;
}

std::string one_line(std::string_view s, size_t cap) {
  std::string o;
  o.reserve(std::min(s.size(), cap));
  for (char c : s) {
    if (o.size() >= cap) break;
    o += (c == '\n' || c == '\r' || c == '\0') ? ' ' : c;
  }
  return o;
}

bool safe_token(std::string_view s, size_t maxlen) {
  if (s.empty() || s.size() > maxlen) return false;
  if (s == "." || s == "..") return false;
  for (char c : s) {
    bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
              c == '.' || c == '_' || c == '-';
    if (!ok) return false;
  }
  return true;
}

std::string user_name() {
  struct passwd* pw = getpwuid(getuid());
  if (pw && pw->pw_name) return pw->pw_name;
  return std::to_string(getuid());
}

// ------------------------------------------------------------------ files
int mkdirs(const std::string& path, mode_t mode) {
  if (path.empty()) return EINVAL;
  struct stat st;
  if (stat(path.c_str(), &st) == 0) return S_ISDIR(st.st_mode) ? 0 : ENOTDIR;
  size_t slash = path.find_last_of('/');
  if (slash != std::string::npos && slash > 0) {
    int e = mkdirs(path.substr(0, slash), mode);
    if (e) return e;
  }
  if (mkdir(path.c_str(), mode) != 0 && errno != EEXIST) return errno;
  return 0;
}

int read_file(const std::string& path, std::string& out, size_t cap, bool follow) {
  out.clear();
  int flags = O_RDONLY | O_NONBLOCK | O_CLOEXEC | (follow ? 0 : O_NOFOLLOW);
  int fd = open(path.c_str(), flags);
  if (fd < 0) return errno;
  struct stat st;
  if (fstat(fd, &st) != 0) { int e = errno; close(fd); return e; }
  if (!S_ISREG(st.st_mode)) { close(fd); return EINVAL; }
  size_t want = std::min<size_t>(cap, (size_t)std::max<off_t>(st.st_size, 0) + 1);
  out.resize(want);
  size_t got = 0;
  while (got < want) {
    ssize_t n = read(fd, &out[got], want - got);
    if (n < 0) {
      if (errno == EINTR) continue;
      int e = errno;
      close(fd);
      out.clear();
      return e;
    }
    if (n == 0) break;
    got += (size_t)n;
  }
  out.resize(got);
  close(fd);
  return 0;
}

int read_tail(const std::string& path, std::string& out, size_t cap) {
  out.clear();
  int fd = open(path.c_str(), O_RDONLY | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) return errno;
  struct stat st;
  if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode)) { close(fd); return EINVAL; }
  off_t start = st.st_size > (off_t)cap ? st.st_size - (off_t)cap : 0;
  size_t want = (size_t)(st.st_size - start);
  out.resize(want);
  size_t got = 0;
  while (got < want) {
    ssize_t n = pread(fd, &out[got], want - got, start + (off_t)got);
    if (n < 0) {
      if (errno == EINTR) continue;
      int e = errno;
      close(fd);
      out.clear();
      return e;
    }
    if (n == 0) break;
    got += (size_t)n;
  }
  out.resize(got);
  close(fd);
  if (start > 0) {  // drop the partial first line
    size_t nl = out.find('\n');
    out = (nl == std::string::npos) ? std::string() : out.substr(nl + 1);
  }
  return 0;
}

int write_tmp(const std::string& path, std::string_view data, std::string& tmp) {
  tmp = path + ".tmp." + std::to_string(getpid());
  int fd = open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (fd < 0) return errno;
  size_t off = 0;
  while (off < data.size()) {
    ssize_t n = write(fd, data.data() + off, data.size() - off);
    if (n < 0) {
      if (errno == EINTR) continue;
      int e = errno;
      close(fd);
      unlink(tmp.c_str());
      return e;
    }
    if (n == 0) { close(fd); unlink(tmp.c_str()); return EIO; }
    off += (size_t)n;
  }
  if (fsync(fd) != 0) { int e = errno; close(fd); unlink(tmp.c_str()); return e; }
  if (close(fd) != 0) { int e = errno; unlink(tmp.c_str()); return e; }
  return 0;
}

int commit_tmp(const std::string& tmp, const std::string& path) {
  if (rename(tmp.c_str(), path.c_str()) != 0) {
    int e = errno;
    unlink(tmp.c_str());
    return e;
  }
  return 0;
}

int write_atomic(const std::string& path, std::string_view data, bool full_sync) {
  std::string tmp;
  if (!full_sync) {
    int e = write_tmp(path, data, tmp);
    return e ? e : commit_tmp(tmp, path);
  }
  // Session records must survive a panic or power loss: F_FULLFSYNC asks the drive to
  // flush its cache, which plain fsync on APFS does not.
  tmp = path + ".tmp." + std::to_string(getpid());
  int fd = open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (fd < 0) return errno;
  size_t off = 0;
  while (off < data.size()) {
    ssize_t n = write(fd, data.data() + off, data.size() - off);
    if (n < 0) {
      if (errno == EINTR) continue;
      int e = errno;
      close(fd);
      unlink(tmp.c_str());
      return e;
    }
    if (n == 0) { close(fd); unlink(tmp.c_str()); return EIO; }
    off += (size_t)n;
  }
  if (fcntl(fd, F_FULLFSYNC) != 0 && fsync(fd) != 0) {
    int e = errno;
    close(fd);
    unlink(tmp.c_str());
    return e;
  }
  if (close(fd) != 0) { int e = errno; unlink(tmp.c_str()); return e; }
  int e = commit_tmp(tmp, path);
  if (e) return e;
  // Make the rename itself durable.
  std::string dir = path.substr(0, path.find_last_of('/'));
  int dfd = open(dir.empty() ? "/" : dir.c_str(), O_RDONLY | O_CLOEXEC);
  if (dfd >= 0) { fsync(dfd); close(dfd); }
  return 0;
}

int append_line(const std::string& path, std::string_view line) {
  std::string buf(line);
  if (buf.empty() || buf.back() != '\n') buf += '\n';
  int fd = open(path.c_str(), O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (fd < 0) return errno;
  // One write(2) per line: O_APPEND makes it a single positioned append, so lines from
  // the governor and the sensor interleave whole.
  ssize_t n;
  do { n = write(fd, buf.data(), buf.size()); } while (n < 0 && errno == EINTR);
  int e = 0;
  if (n < 0) e = errno;
  else if ((size_t)n != buf.size()) e = ENOSPC;
  if (close(fd) != 0 && !e) e = errno;
  return e;
}

void rotate_if_needed(const std::string& path, uint64_t max_bytes, int generations) {
  struct stat st;
  if (lstat(path.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) return;
  if ((uint64_t)st.st_size < max_bytes) return;
  if (generations < 1) generations = 1;
  unlink((path + "." + std::to_string(generations)).c_str());
  for (int i = generations - 1; i >= 1; --i)
    rename((path + "." + std::to_string(i)).c_str(), (path + "." + std::to_string(i + 1)).c_str());
  rename(path.c_str(), (path + ".1").c_str());
}

std::vector<std::string> list_dir(const std::string& dir, size_t max, int* err) {
  std::vector<std::string> out;
  if (err) *err = 0;
  DIR* d = opendir(dir.c_str());
  if (!d) {
    if (err) *err = errno;
    return out;
  }
  while (struct dirent* de = readdir(d)) {
    if (strcmp(de->d_name, ".") == 0 || strcmp(de->d_name, "..") == 0) continue;
    out.emplace_back(de->d_name);
    if (out.size() >= max) break;
  }
  closedir(d);
  return out;
}

bool path_mtime(const std::string& path, double& mt, bool follow) {
  struct stat st;
  int rc = follow ? stat(path.c_str(), &st) : lstat(path.c_str(), &st);
  if (rc != 0) return false;
  mt = (double)st.st_mtimespec.tv_sec + (double)st.st_mtimespec.tv_nsec / 1e9;
  return true;
}

std::string sha256_hex(std::string_view data) {
  unsigned char md[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.data(), (CC_LONG)data.size(), md);
  static const char* hex = "0123456789abcdef";
  std::string o;
  for (unsigned char c : md) {
    o += hex[c >> 4];
    o += hex[c & 15];
  }
  return o;
}

// ------------------------------------------------------------------ JSON
// Log lines and report names are bytes, not text. Invalid UTF-8 becomes U+FFFD so the
// output is always valid JSON for strict parsers.
std::string json_escape(std::string_view s) {
  std::string o;
  o.reserve(s.size() + 8);
  size_t i = 0;
  const size_t n = s.size();
  while (i < n) {
    unsigned char c = (unsigned char)s[i];
    if (c < 0x80) {
      switch (c) {
        case '"': o += "\\\""; break;
        case '\\': o += "\\\\"; break;
        case '\n': o += "\\n"; break;
        case '\r': o += "\\r"; break;
        case '\t': o += "\\t"; break;
        default:
          if (c < 0x20 || c == 0x7f) {
            char b[8];
            snprintf(b, sizeof b, "\\u%04x", c);
            o += b;
          } else {
            o += (char)c;
          }
      }
      ++i;
      continue;
    }
    int len = 0;
    uint32_t cp = 0;
    if ((c & 0xE0) == 0xC0) { len = 2; cp = c & 0x1F; }
    else if ((c & 0xF0) == 0xE0) { len = 3; cp = c & 0x0F; }
    else if ((c & 0xF8) == 0xF0) { len = 4; cp = c & 0x07; }
    bool ok = len > 0 && i + (size_t)len <= n;
    for (int k = 1; ok && k < len; ++k) {
      unsigned char cc = (unsigned char)s[i + (size_t)k];
      if ((cc & 0xC0) != 0x80) ok = false;
      else cp = (cp << 6) | (cc & 0x3F);
    }
    if (ok) {
      if ((len == 2 && cp < 0x80) || (len == 3 && cp < 0x800) || (len == 4 && cp < 0x10000) ||
          cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF))
        ok = false;
    }
    if (ok) {
      o.append(s.data() + i, (size_t)len);
      i += (size_t)len;
    } else {
      o += "\\ufffd";
      ++i;
    }
  }
  return o;
}

void JW::prefix() {
  if (after_key_) {
    after_key_ = false;
    return;
  }
  if (!first_.empty()) {
    if (!first_.back()) out += ',';
    first_.back() = false;
  }
}
JW& JW::begin_obj() { prefix(); out += '{'; first_.push_back(true); return *this; }
JW& JW::end_obj() { out += '}'; if (!first_.empty()) first_.pop_back(); return *this; }
JW& JW::begin_arr() { prefix(); out += '['; first_.push_back(true); return *this; }
JW& JW::end_arr() { out += ']'; if (!first_.empty()) first_.pop_back(); return *this; }
JW& JW::key(std::string_view k) {
  if (!first_.empty()) {
    if (!first_.back()) out += ',';
    first_.back() = false;
  }
  out += '"';
  out += json_escape(k);
  out += "\":";
  after_key_ = true;
  return *this;
}
JW& JW::str(std::string_view v) { prefix(); out += '"'; out += json_escape(v); out += '"'; return *this; }
JW& JW::i64(int64_t v) { prefix(); out += std::to_string(v); return *this; }
JW& JW::num(double v, int prec) {
  prefix();
  if (!std::isfinite(v)) out += "null";
  else out += fmt_num(v, prec);
  return *this;
}
JW& JW::boolean(bool v) { prefix(); out += v ? "true" : "false"; return *this; }
JW& JW::null() { prefix(); out += "null"; return *this; }
JW& JW::raw(std::string_view json) { prefix(); out += json; return *this; }

id json_parse(std::string_view s) {
  if (s.empty()) return nil;
  NSData* d = [NSData dataWithBytes:s.data() length:s.size()];
  NSError* err = nil;
  id o = [NSJSONSerialization JSONObjectWithData:d options:0 error:&err];
  if (!o || err) return nil;
  if (![o isKindOfClass:[NSDictionary class]] && ![o isKindOfClass:[NSArray class]]) return nil;
  return o;
}

NSDictionary* json_obj(std::string_view s) {
  id o = json_parse(s);
  return [o isKindOfClass:[NSDictionary class]] ? (NSDictionary*)o : nil;
}

bool ns_is_bool(id v) {
  if (![v isKindOfClass:[NSNumber class]]) return false;
  return CFGetTypeID((__bridge CFTypeRef)v) == CFBooleanGetTypeID();
}

bool ns_num(id v, double& out) {
  if (![v isKindOfClass:[NSNumber class]] || ns_is_bool(v)) return false;
  double d = [(NSNumber*)v doubleValue];
  if (!std::isfinite(d)) return false;
  out = d;
  return true;
}

std::string ns_str(id v) {
  if (![v isKindOfClass:[NSString class]]) return "";
  const char* c = [(NSString*)v UTF8String];
  return c ? std::string(c) : std::string();
}

std::string ns_compact(id obj) {
  if (!obj || ![NSJSONSerialization isValidJSONObject:obj]) return "";
  NSError* err = nil;
  NSData* d = [NSJSONSerialization dataWithJSONObject:obj options:0 error:&err];
  if (!d || err) return "";
  return std::string((const char*)d.bytes, d.length);
}

// ------------------------------------------------------------------ events
Ev::Ev(std::string_view kind) {
  w_.begin_obj();
  w_.kn("ts", now_wall(), 3);
  w_.ks("kind", kind);
}
const std::string& Ev::line() {
  if (!done_) {
    w_.end_obj();
    done_ = true;
  }
  return w_.out;
}
int Ev::write(const std::string& state_dir) {
  if (state_dir.empty()) return EINVAL;
  return append_line(state_dir + "/events.jsonl", line());
}

// ------------------------------------------------------------------ logging
static std::string g_log_path;
void log_open(const std::string& state_dir) {
  if (state_dir.empty()) return;
  mkdirs(state_dir + "/log");
  g_log_path = state_dir + "/log/sensor.log";
}
void logf(const char* fmt, ...) {
  if (g_log_path.empty()) return;
  char msg[2048];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(msg, sizeof msg, fmt, ap);
  va_end(ap);
  std::string line = iso_utc(now_wall()) + " [" + std::to_string(getpid()) + "] " + msg;
  append_line(g_log_path, one_line(line, 4000));
}

// ------------------------------------------------------------------ argv
Args parse_args(int argc, char** argv, int start, const std::set<std::string>& valued,
                const std::set<std::string>& flags) {
  Args a;
  for (int i = start; i < argc; ++i) {
    std::string s = argv[i];
    if (starts_with(s, "--") && s.size() > 2) {
      std::string k = s.substr(2);
      std::string v;
      bool has_eq = false;
      size_t eq = k.find('=');
      if (eq != std::string::npos) {
        v = k.substr(eq + 1);
        k = k.substr(0, eq);
        has_eq = true;
      }
      if (valued.count(k)) {
        if (!has_eq) {
          if (i + 1 >= argc) { a.error = "--" + k + " needs a value"; return a; }
          v = argv[++i];
        }
        a.opt[k] = v;
      } else if (flags.count(k) && !has_eq) {
        a.flag.insert(k);
      } else {
        a.error = "unknown option --" + k;
        return a;
      }
    } else {
      a.pos.push_back(s);
    }
  }
  return a;
}

}  // namespace fgs
