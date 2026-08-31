#include "forge/ui/GuardedProcess.hpp"

#include <cerrno>
#include <chrono>
#include <csignal>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

#include <fcntl.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

#if defined(__APPLE__)
#include <crt_externs.h>
#define FORGE_UI_ENVIRON (*_NSGetEnviron())
#else
extern char** environ;
#define FORGE_UI_ENVIRON environ
#endif

namespace forge::ui {
namespace {

// SIGPIPE is ignored ONCE, and only when nothing else has claimed it.
//
// The failure this prevents is specific and was the whole point of the exercise:
// the child segfaults while parsing, the parent's next write() to a pipe with no
// reader raises SIGPIPE, and SIGPIPE's DEFAULT DISPOSITION TERMINATES THE
// PARENT. An isolation layer that dies of its own isolation is worse than none.
//
// It reads the current disposition first, so an application that installed its
// own SIGPIPE handler keeps it. sigaction(SIG_DFL -> SIG_IGN) is the smallest
// change that makes write() return EPIPE as a value.
void ignoreSigPipeOnce() {
  static bool done = false;
  if (done) return;
  done = true;
  struct sigaction current {};
  if (sigaction(SIGPIPE, nullptr, &current) != 0) return;
  if (current.sa_handler != SIG_DFL) return;  // someone else owns it
  struct sigaction ign {};
  ign.sa_handler = SIG_IGN;
  sigemptyset(&ign.sa_mask);
  ign.sa_flags = 0;
  sigaction(SIGPIPE, &ign, nullptr);
}

bool setNonBlocking(int fd) {
  const int flags = fcntl(fd, F_GETFL, 0);
  if (flags < 0) return false;
  return fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0;
}

void closeFd(int& fd) noexcept {
  if (fd >= 0) {
    ::close(fd);
    fd = -1;
  }
}

}  // namespace

std::uint64_t steadyNowMs() {
  const auto now = std::chrono::steady_clock::now().time_since_epoch();
  return static_cast<std::uint64_t>(
      std::chrono::duration_cast<std::chrono::milliseconds>(now).count());
}

const char* toString(GuardOutcome outcome) noexcept {
  switch (outcome) {
    case GuardOutcome::Pending:      return "pending";
    case GuardOutcome::Completed:    return "completed";
    case GuardOutcome::Failed:       return "failed";
    case GuardOutcome::Crashed:      return "crashed";
    case GuardOutcome::TimedOut:     return "timed_out";
    case GuardOutcome::Cancelled:    return "cancelled";
    case GuardOutcome::LaunchFailed: return "launch_failed";
  }
  return "pending";
}

bool isTerminal(GuardOutcome outcome) noexcept { return outcome != GuardOutcome::Pending; }

const char* signalName(int signalNumber) noexcept {
  switch (signalNumber) {
    case SIGHUP:  return "SIGHUP";
    case SIGINT:  return "SIGINT";
    case SIGQUIT: return "SIGQUIT";
    case SIGILL:  return "SIGILL";
    case SIGTRAP: return "SIGTRAP";
    case SIGABRT: return "SIGABRT";
    case SIGFPE:  return "SIGFPE";
    case SIGKILL: return "SIGKILL";
    case SIGBUS:  return "SIGBUS";
    case SIGSEGV: return "SIGSEGV";
    case SIGSYS:  return "SIGSYS";
    case SIGPIPE: return "SIGPIPE";
    case SIGTERM: return "SIGTERM";
    case SIGXCPU: return "SIGXCPU";
    case SIGXFSZ: return "SIGXFSZ";
    default:      return "signal";
  }
}

// Kill, reap, forget. Shared by the destructor and reset(): the two places that
// have to guarantee no child of ours outlives the object that owns it.
void GuardedProcess::reset() {
  if (pid_ > 0) {
    signalChild(SIGKILL);
    int status = 0;
    for (int i = 0; i < 1000; ++i) {
      const pid_t r = ::waitpid(pid_, &status, WNOHANG);
      if (r == pid_ || r < 0) break;
      ::usleep(1000);
    }
    pid_ = -1;
  }
  closeAll();
  started_ = false;
  request_.clear();
  written_ = 0;
  stdout_.clear();
  stderr_.clear();
  report_ = GuardReport{};
  limits_ = GuardLimits{};
  startedAtMs_ = 0;
  cancelRequested_ = false;
  termSent_ = false;
  killSent_ = false;
  stopDeadlineMs_ = 0;
  killReason_ = GuardOutcome::Pending;
}

// A supervisor destroyed with a child still running would leave an orphan
// holding a CPU, a pipe and a page of the parent's address space for the rest of
// the session. reset() is bounded (the child has been SIGKILLed, so the reap
// returns almost at once) — a bound is what keeps a destructor from becoming a
// hang.
GuardedProcess::~GuardedProcess() { reset(); }

void GuardedProcess::closeAll() noexcept {
  closeFd(inFd_);
  closeFd(outFd_);
  closeFd(errFd_);
}

void GuardedProcess::signalChild(int sig) noexcept {
  if (pid_ > 0) ::kill(pid_, sig);
}

std::uint64_t GuardedProcess::elapsedMs(std::uint64_t nowMs) const noexcept {
  if (!started_) return 0;
  if (report_.terminal()) return report_.elapsedMs;
  return nowMs >= startedAtMs_ ? nowMs - startedAtMs_ : 0;
}

void GuardedProcess::finish(GuardOutcome outcome, std::string diagnostic, std::uint64_t nowMs) {
  if (report_.terminal()) return;
  report_.outcome = outcome;
  report_.diagnostic = std::move(diagnostic);
  report_.elapsedMs = nowMs >= startedAtMs_ ? nowMs - startedAtMs_ : 0;
  report_.stdoutBytes = stdout_.size();
  report_.stderrBytes = stderr_.size();
  closeAll();
}

bool GuardedProcess::start(const std::vector<std::string>& argv, const std::string& stdinPayload,
                           const GuardLimits& limits, std::uint64_t nowMs, std::string& error) {
  reset();
  error.clear();
  limits_ = limits;
  startedAtMs_ = nowMs;
  request_ = stdinPayload;
  written_ = 0;
  started_ = true;

  if (argv.empty() || argv.front().empty()) {
    error = "no worker command was given";
    finish(GuardOutcome::LaunchFailed, error, nowMs);
    return false;
  }

  ignoreSigPipeOnce();

  int inPipe[2] = {-1, -1};
  int outPipe[2] = {-1, -1};
  int errPipe[2] = {-1, -1};
  auto fail = [&](const std::string& why) {
    for (int* p : {inPipe, outPipe, errPipe}) {
      if (p[0] >= 0) ::close(p[0]);
      if (p[1] >= 0) ::close(p[1]);
    }
    error = why;
    finish(GuardOutcome::LaunchFailed, why, nowMs);
    return false;
  };
  if (::pipe(inPipe) != 0) return fail(std::string("pipe(stdin) failed: ") + std::strerror(errno));
  if (::pipe(outPipe) != 0) return fail(std::string("pipe(stdout) failed: ") + std::strerror(errno));
  if (::pipe(errPipe) != 0) return fail(std::string("pipe(stderr) failed: ") + std::strerror(errno));

  posix_spawn_file_actions_t actions;
  if (posix_spawn_file_actions_init(&actions) != 0) {
    return fail("posix_spawn_file_actions_init failed");
  }
  posix_spawn_file_actions_adddup2(&actions, inPipe[0], STDIN_FILENO);
  posix_spawn_file_actions_adddup2(&actions, outPipe[1], STDOUT_FILENO);
  posix_spawn_file_actions_adddup2(&actions, errPipe[1], STDERR_FILENO);
  // The child must not inherit the PARENT's ends: if it did, the parent's read
  // would never see EOF because a writer would still be open in the child, and a
  // crash would look exactly like a hang.
  posix_spawn_file_actions_addclose(&actions, inPipe[1]);
  posix_spawn_file_actions_addclose(&actions, outPipe[0]);
  posix_spawn_file_actions_addclose(&actions, errPipe[0]);

  std::vector<char*> cargv;
  cargv.reserve(argv.size() + 1);
  for (const std::string& a : argv) cargv.push_back(const_cast<char*>(a.c_str()));
  cargv.push_back(nullptr);

  pid_t child = -1;
  const int rc = posix_spawn(&child, argv.front().c_str(), &actions, nullptr, cargv.data(),
                             FORGE_UI_ENVIRON);
  posix_spawn_file_actions_destroy(&actions);
  if (rc != 0) {
    return fail("cannot launch '" + argv.front() + "': " + std::strerror(rc));
  }

  ::close(inPipe[0]);
  ::close(outPipe[1]);
  ::close(errPipe[1]);
  inFd_ = inPipe[1];
  outFd_ = outPipe[0];
  errFd_ = errPipe[0];
  pid_ = static_cast<int>(child);
  setNonBlocking(inFd_);
  setNonBlocking(outFd_);
  setNonBlocking(errFd_);
  if (request_.empty()) closeFd(inFd_);  // EOF immediately: nothing to send
  return true;
}

void GuardedProcess::pumpWrite() {
  if (inFd_ < 0) return;
  while (written_ < request_.size()) {
    const std::size_t remaining = request_.size() - written_;
    const std::size_t chunk = remaining > 65536u ? 65536u : remaining;
    const ssize_t n = ::write(inFd_, request_.data() + written_, chunk);
    if (n > 0) {
      written_ += static_cast<std::size_t>(n);
      continue;
    }
    if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return;  // child is behind; try later
    if (n < 0 && errno == EINTR) continue;
    // EPIPE: the child is gone. That is not an error here — it is the crash this
    // class exists to survive, and poll() will read the real cause off waitpid.
    closeFd(inFd_);
    return;
  }
  closeFd(inFd_);  // request delivered: the child sees EOF
}

void GuardedProcess::pumpRead() {
  char buf[65536];
  struct Stream {
    int* fd;
    std::string* sink;
    std::size_t cap;
    bool* capped;
  };
  const Stream streams[2] = {{&outFd_, &stdout_, limits_.stdoutCap, &report_.stdoutCapped},
                             {&errFd_, &stderr_, limits_.stderrCap, &report_.stderrCapped}};
  for (const Stream& s : streams) {
    if (*s.fd < 0) continue;
    for (;;) {
      const ssize_t n = ::read(*s.fd, buf, sizeof(buf));
      if (n > 0) {
        const std::size_t room = s.sink->size() >= s.cap ? 0 : s.cap - s.sink->size();
        const std::size_t take = static_cast<std::size_t>(n) < room
                                     ? static_cast<std::size_t>(n)
                                     : room;
        s.sink->append(buf, take);
        if (take < static_cast<std::size_t>(n)) *s.capped = true;
        continue;
      }
      if (n == 0) {  // EOF
        closeFd(*s.fd);
        break;
      }
      if (errno == EINTR) continue;
      if (errno == EAGAIN || errno == EWOULDBLOCK) break;
      closeFd(*s.fd);
      break;
    }
  }
}

void GuardedProcess::cancel(std::uint64_t nowMs) {
  if (!started_ || report_.terminal()) return;
  if (cancelRequested_) return;
  cancelRequested_ = true;
  if (killReason_ == GuardOutcome::Pending) killReason_ = GuardOutcome::Cancelled;
  if (!termSent_) {
    termSent_ = true;
    signalChild(SIGTERM);
    stopDeadlineMs_ = nowMs + limits_.termGraceMs;
  }
}

bool GuardedProcess::poll(std::uint64_t nowMs) {
  if (!started_) return false;
  if (report_.terminal()) return true;

  pumpWrite();
  pumpRead();

  // ── deadline ─────────────────────────────────────────────────────────────
  // Checked BEFORE the reap, so a child that finished inside its budget on the
  // same poll is still Completed: a run is late only if it is still running.
  if (limits_.deadlineMs != 0 && !termSent_ && nowMs >= startedAtMs_ + limits_.deadlineMs) {
    killReason_ = GuardOutcome::TimedOut;
    termSent_ = true;
    signalChild(SIGTERM);
    stopDeadlineMs_ = nowMs + limits_.termGraceMs;
  }
  // A child that ignores SIGTERM must still die.
  if (termSent_ && !killSent_ && nowMs >= stopDeadlineMs_) {
    killSent_ = true;
    signalChild(SIGKILL);
  }

  // ── reap ─────────────────────────────────────────────────────────────────
  int status = 0;
  const pid_t r = ::waitpid(pid_, &status, WNOHANG);
  if (r == 0) return false;  // still alive
  if (r < 0) {
    if (errno == EINTR) return false;
    finish(GuardOutcome::Failed, std::string("waitpid failed: ") + std::strerror(errno), nowMs);
    pid_ = -1;
    return true;
  }

  pid_ = -1;
  // The child is gone; drain whatever it left in the pipes before judging it.
  // Without this the progress trail that names the failing op is lost exactly
  // when it matters most.
  pumpRead();

  if (WIFSIGNALED(status)) {
    const int sig = WTERMSIG(status);
    report_.signalNumber = sig;
    if (killReason_ == GuardOutcome::TimedOut) {
      finish(GuardOutcome::TimedOut,
             "the operation exceeded its " + std::to_string(limits_.deadlineMs) +
                 " ms budget and was stopped (" + signalName(sig) + ")",
             nowMs);
    } else if (killReason_ == GuardOutcome::Cancelled) {
      finish(GuardOutcome::Cancelled,
             std::string("the operation was cancelled (") + signalName(sig) + ")", nowMs);
    } else {
      finish(GuardOutcome::Crashed,
             std::string("the worker died on ") + signalName(sig) + " (signal " +
                 std::to_string(sig) + ") — the operation was isolated, the session survived",
             nowMs);
    }
    return true;
  }

  const int code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
  report_.exitCode = code;
  if (code == 0) {
    finish(GuardOutcome::Completed, "completed", nowMs);
  } else {
    finish(GuardOutcome::Failed, "the worker exited " + std::to_string(code), nowMs);
  }
  return true;
}

}  // namespace forge::ui
