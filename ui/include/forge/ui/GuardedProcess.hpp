// ui/include/forge/ui/GuardedProcess.hpp
//
// A GEOMETRY OPERATION MUST NOT BE ABLE TO TAKE THE PROCESS DOWN.
//
// forge-kernel/reports/OCCT_NULL_PCURVE_SEGV.md records a null Geom2d_Curve
// dereferenced INSIDE OCCT, reached by at least three independent paths (solid
// classification, BRepOffset — the SHELL operation — and ShapeUpgrade's
// same-domain merge), crashing on Archie's emitted geometry AND on the GOLD
// REFERENCE parts. The faulting toolkits are third-party; OCCT has no null check
// to enable; and the report's own measured self-correction rules out the obvious
// remedy — the crashing input measured `nullPcurves=0`, so the null is BORN
// INSIDE the operation and no pre-check on the input can see it coming.
//
// A SIGSEGV is not an exception. KernelScene::buildFromIr already catches
// `std::exception` AND `...` (an escaping OCCT Standard_Failure is not a
// std::exception), and neither catch clause exists for a signal: the process is
// simply gone, taking the user's unsaved document with it. The only mechanism
// that survives a fault in code we do not own is to run that code somewhere the
// fault is RECOVERABLE — i.e. in another process.
//
// ── what this class is ──────────────────────────────────────────────────────
// A supervisor for one child process: spawn it, feed it a request on stdin, read
// its answer from stdout, watch its progress trail on stderr, and classify how it
// ended — Completed, Failed, Crashed (with the signal), TimedOut, Cancelled or
// LaunchFailed. It knows nothing about geometry, IR or OCCT: it is a byte pipe
// with a deadline, which is why it lives in forge::ui and is gated headless.
//
// ── every rule here was paid for ────────────────────────────────────────────
//   * NOTHING BLOCKS. start() returns immediately and poll() never waits: the
//     stdin write, both reads and the reap are all non-blocking. A gate that
//     blocked on a child that never reads its stdin would hang; an APPLICATION
//     that did it would freeze the UI, which is defect #2 on this track, not a
//     fix for defect #1.
//   * SIGPIPE CANNOT BE ALLOWED TO KILL THE PARENT. When the child dies before
//     reading the whole request — exactly what a SIGSEGV during parse looks like
//     — the parent's next write() to the pipe raises SIGPIPE, whose default
//     disposition terminates the writer. Isolating a crash and then dying of the
//     isolation is worse than not isolating it. start() installs SIG_IGN for
//     SIGPIPE only when the current disposition is still SIG_DFL, so an
//     application that installed its own handler keeps it, and write() then
//     reports EPIPE as a value.
//   * THE CHILD IS ALWAYS REAPED. A cancel or a deadline sends SIGTERM, then
//     SIGKILL after a grace window, and poll() keeps calling waitpid(WNOHANG)
//     until the child is collected. A supervisor that leaks zombies turns a
//     recoverable crash into a resource leak over a long session.
//   * OUTPUT IS CAPPED, AND THE CAP IS NAMED. A runaway child that prints
//     forever must not exhaust the parent's memory. The caps are large and
//     configurable, and hitting one is reported as a diagnostic that says which
//     stream and what the cap was — never as a silent truncation.
//   * TIME IS INJECTED. Every entry point takes `nowMs`, so a gate can drive a
//     deadline deterministically instead of sleeping. steadyNowMs() is what the
//     application passes.
#ifndef FORGE_UI_GUARDEDPROCESS_HPP
#define FORGE_UI_GUARDEDPROCESS_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::ui {

// A monotonic millisecond clock. Monotonic, not wall-clock: a deadline measured
// against a clock the user can move backwards is not a deadline.
std::uint64_t steadyNowMs();

// How a supervised run ended. `Pending` is the only non-terminal value.
enum class GuardOutcome : std::uint8_t {
  Pending = 0,
  Completed,     // exited 0
  Failed,        // exited non-zero, or broke its own protocol
  Crashed,       // died on a signal — the case this class exists for
  TimedOut,      // exceeded its deadline and was killed
  Cancelled,     // the user asked for it to stop and it was killed
  LaunchFailed,  // never started (missing binary, pipe/spawn refused)
};
const char* toString(GuardOutcome outcome) noexcept;
bool isTerminal(GuardOutcome outcome) noexcept;

// The POSIX signal name for a number ("SIGSEGV"), or "signal <n>" when unknown.
// Spelled here rather than taken from strsignal() so the text is identical on
// every platform a gate might run on.
const char* signalName(int signalNumber) noexcept;

struct GuardReport {
  GuardOutcome outcome = GuardOutcome::Pending;
  int exitCode = -1;        // meaningful when Completed or Failed
  int signalNumber = 0;     // non-zero iff Crashed (or killed by us)
  std::uint64_t elapsedMs = 0;
  std::size_t stdoutBytes = 0;
  std::size_t stderrBytes = 0;
  bool stdoutCapped = false;
  bool stderrCapped = false;
  // ALWAYS non-empty once terminal. A segfault's whole problem is that it says
  // nothing; a supervisor that also says nothing has not improved on it.
  std::string diagnostic;

  bool terminal() const noexcept { return isTerminal(outcome); }
  bool ok() const noexcept { return outcome == GuardOutcome::Completed; }
};

// Tunables. Defaults are chosen for an interactive rebuild; a batch caller
// raises the deadline rather than removing it.
struct GuardLimits {
  // 0 means "no deadline". Never the default: an operation with no deadline is
  // indistinguishable from a hang, and 6 of 600 corpus parts already exceed
  // 300 s in the verifier.
  std::uint64_t deadlineMs = 30000;
  // How long a SIGTERM is given to work before SIGKILL. A child that ignores
  // SIGTERM must still die.
  std::uint64_t termGraceMs = 500;
  std::size_t stdoutCap = 256u * 1024u * 1024u;  // a 400-face mesh is ~10 MB
  std::size_t stderrCap = 256u * 1024u;
};

class GuardedProcess {
 public:
  GuardedProcess() = default;
  ~GuardedProcess();
  GuardedProcess(const GuardedProcess&) = delete;
  GuardedProcess& operator=(const GuardedProcess&) = delete;

  // Spawns argv[0] with argv, and arranges for `stdinPayload` to be written to
  // its standard input (incrementally, from poll()). Returns false and fills
  // `error` when the child could not be launched at all — in which case the
  // report's outcome is LaunchFailed and the object is terminal immediately.
  bool start(const std::vector<std::string>& argv, const std::string& stdinPayload,
             const GuardLimits& limits, std::uint64_t nowMs, std::string& error);

  // Advances the run: writes what it can of the request, drains both output
  // streams, reaps the child if it has exited, and enforces the deadline and any
  // pending cancel. NEVER blocks. Returns true once the run is terminal.
  bool poll(std::uint64_t nowMs);

  // Asks the child to stop. Idempotent. The run does not become terminal here —
  // poll() still has to reap it — which is the difference between "asked to
  // stop" and "stopped".
  void cancel(std::uint64_t nowMs);

  // Returns the supervisor to its never-started state so it can run again.
  // A live child is SIGKILLed and reaped first: reuse must not orphan anything.
  // This exists rather than assignment because the copy constructor is deleted,
  // which suppresses the implicit move — an owner of file descriptors and a pid
  // is not a value, and pretending otherwise is how two objects come to hold one
  // pid and both try to reap it.
  void reset();

  bool running() const noexcept { return started_ && !isTerminal(report_.outcome); }
  bool started() const noexcept { return started_; }
  const GuardReport& report() const noexcept { return report_; }
  // The child's stdout, verbatim. Binary-safe.
  const std::string& output() const noexcept { return stdout_; }
  // The child's stderr, verbatim. This is where a worker's progress trail lives,
  // and it is the ONLY thing that survives a crash to say what the child was
  // doing when it died.
  const std::string& errorText() const noexcept { return stderr_; }
  int pid() const noexcept { return pid_; }
  std::uint64_t elapsedMs(std::uint64_t nowMs) const noexcept;

 private:
  void finish(GuardOutcome outcome, std::string diagnostic, std::uint64_t nowMs);
  void closeAll() noexcept;
  void pumpWrite();
  void pumpRead();
  void signalChild(int sig) noexcept;

  bool started_ = false;
  int pid_ = -1;
  int inFd_ = -1;
  int outFd_ = -1;
  int errFd_ = -1;
  std::string request_;
  std::size_t written_ = 0;
  std::string stdout_;
  std::string stderr_;
  GuardLimits limits_{};
  GuardReport report_{};
  std::uint64_t startedAtMs_ = 0;
  bool cancelRequested_ = false;
  bool termSent_ = false;
  bool killSent_ = false;
  std::uint64_t stopDeadlineMs_ = 0;  // when the SIGTERM grace expires
  // Why we killed it, so the reaped signal is not misreported as the child's own
  // fault: a SIGKILL we sent is a timeout, not a crash.
  GuardOutcome killReason_ = GuardOutcome::Pending;
};

}  // namespace forge::ui

#endif  // FORGE_UI_GUARDEDPROCESS_HPP
