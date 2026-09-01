// ui/include/forge/ui/KernelSession.hpp
//
// THE POLICY OVER GuardedProcess: run one geometry operation at a time, out of
// process, with a deadline the user can cut short, and turn every way it can end
// into something the UI can SHOW and a repair loop can ACT ON.
//
// GuardedProcess answers "how did that child die". This class answers the three
// questions the application actually has:
//
//   1. WHAT WAS IT DOING WHEN IT DIED? A SIGSEGV yields no verdict, no error
//      string and no partial measurement — the report calls that "the only
//      failure mode that produces no diagnostic at all". So the worker announces
//      each statement on stderr before executing it (`FORGE-OP <id> <OP>`), and
//      this class keeps that trail. When the child dies the parent still holds
//      the last announcement, and the diagnostic becomes
//      "the kernel died on SIGSEGV while executing %7 = SHELL" instead of
//      nothing. That is the difference between a crash and a repairable failure.
//   2. IS IT STILL GOING, AND CAN I STOP IT? pump() is called once per frame and
//      never blocks, so the window keeps drawing while a 300 s operation runs,
//      and cancel() ends it. 6 of 600 corpus parts exceed 300 s in the verifier;
//      a modal freeze for those is a hang as far as the user is concerned.
//   3. HAS THIS KILLED US BEFORE? Every terminal run is recorded in an incident
//      ledger keyed by the program text, so the UI can WARN.
//
// ★ THE LEDGER NEVER REFUSES. It is advisory and read-only to the submit path:
//   submit() has no consultation of it and no way to decline. The owner's
//   constraint is explicit — "dont gate anything if you do that then how will
//   Archie generate ultra long feature trees for Kernel to execute" — and a
//   quarantine that silently declined to re-run a program would be exactly the
//   capability gate wearing a safety hat that the OCCT report warns about, firing
//   hardest on the longest, densest trees. What the ledger buys is a NAMED
//   diagnostic and a count, not a veto.
#ifndef FORGE_UI_KERNELSESSION_HPP
#define FORGE_UI_KERNELSESSION_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/GuardedProcess.hpp"

namespace forge::ui {

// The marker a worker writes to stderr before it executes a statement. Public
// because the worker and the supervisor must agree on it, and a protocol spelled
// in two places is a protocol that drifts.
inline constexpr const char* kOpProgressPrefix = "FORGE-OP ";

// What the session is doing right now.
enum class KernelJobState : std::uint8_t {
  Idle = 0,     // nothing has ever been submitted, or the last result was consumed
  Running,      // a worker is executing
  Succeeded,    // the worker exited 0 and its payload is in result()
  Crashed,      // the worker died on a signal — isolated, session intact
  TimedOut,     // it exceeded its deadline
  Cancelled,    // the user stopped it
  Failed,       // it exited non-zero, or broke the protocol
  Unavailable,  // no worker is configured, so nothing ran
};
const char* toString(KernelJobState state) noexcept;
bool isTerminalState(KernelJobState state) noexcept;

// The last statement a worker announced before it stopped announcing. `id` is 0
// when the worker never got as far as its first op — which is itself the useful
// fact that the failure is in parse or setup, not in a modelling operation.
struct OpProgress {
  int id = 0;
  std::string op;
  std::size_t announced = 0;  // how many statements were announced in total
  bool valid() const noexcept { return id != 0 || !op.empty(); }
  std::string text() const;  // "%7 = SHELL" or "before the first statement"
};

// One terminal run, kept for the ledger.
struct KernelIncident {
  std::string label;             // what the caller called it ("rebuild", "open")
  KernelJobState state = KernelJobState::Failed;
  int signalNumber = 0;
  std::uint64_t elapsedMs = 0;
  OpProgress lastOp;
  std::uint64_t programKey = 0;  // hash of the program text
  std::size_t programBytes = 0;
  std::string diagnostic;
};

class KernelSession {
 public:
  KernelSession() = default;

  // ── configuration ───────────────────────────────────────────────────────
  // The command that runs one operation. Empty (the default) means NO isolation
  // is available; submit() then reports Unavailable and the caller falls back to
  // running in process. That fallback is deliberate: a build with no worker
  // beside it must still be a working application, not a broken one.
  void configureWorker(std::vector<std::string> argv);
  const std::vector<std::string>& workerArgv() const noexcept { return argv_; }
  bool workerConfigured() const noexcept { return !argv_.empty(); }
  void setLimits(const GuardLimits& limits) noexcept { limits_ = limits; }
  const GuardLimits& limits() const noexcept { return limits_; }

  // ── driving one job ─────────────────────────────────────────────────────
  // Starts `program` in a worker. Returns false when nothing started — no worker
  // configured, one already running, or the spawn was refused — and state() then
  // says which. Never blocks.
  bool submit(std::string label, std::string program, std::uint64_t nowMs);
  // Advance. Call once per frame. Returns true on the poll that made the job
  // terminal, so a caller can react exactly once.
  bool pump(std::uint64_t nowMs);
  // Ask the running job to stop. It becomes terminal on a later pump().
  void cancel(std::uint64_t nowMs);
  // Convenience for callers with no frame loop (gates, batch tools): pumps until
  // terminal, sleeping in small slices so it does not spin a core. Honours the
  // same deadline; returns the terminal state.
  KernelJobState runToCompletion();

  // ── the answer ──────────────────────────────────────────────────────────
  KernelJobState state() const noexcept { return state_; }
  bool running() const noexcept { return state_ == KernelJobState::Running; }
  // The worker's stdout, verbatim; empty unless state() == Succeeded.
  const std::string& result() const noexcept { return result_; }
  // ALWAYS printable once a job has ended, and it NAMES the statement.
  const std::string& diagnostic() const noexcept { return diagnostic_; }
  const OpProgress& lastOp() const noexcept { return lastOp_; }
  const std::string& label() const noexcept { return label_; }
  std::uint64_t elapsedMs(std::uint64_t nowMs) const;
  // The worker's stderr trail, for a console panel.
  const std::string& workerLog() const noexcept { return log_; }

  // ── the ledger (advisory only) ──────────────────────────────────────────
  const std::vector<KernelIncident>& incidents() const noexcept { return incidents_; }
  // The most recent incident for this exact program text, or nullptr. Callers
  // use it to WARN. There is no interface here that declines to run anything.
  const KernelIncident* priorIncidentFor(const std::string& program) const;
  std::size_t submissions() const noexcept { return submissions_; }
  std::size_t completions() const noexcept { return completions_; }
  std::size_t crashes() const noexcept { return crashes_; }
  std::size_t timeouts() const noexcept { return timeouts_; }
  std::size_t cancellations() const noexcept { return cancellations_; }
  // The ledger is bounded: a long session must not grow one entry per rebuild
  // for ever. Oldest incidents are dropped first.
  void setIncidentCapacity(std::size_t n) noexcept;
  std::size_t incidentCapacity() const noexcept { return incidentCap_; }

  // Exposed for a UI that wants the raw supervision numbers.
  const GuardReport& lastGuardReport() const noexcept { return proc_.report(); }

  // The op trail parser, exposed because it is a pure function over the worker's
  // stderr and the gate asserts on it directly.
  static OpProgress parseOpTrail(const std::string& stderrText);
  // The ledger's key. FNV-1a over the program bytes: stable across processes,
  // which matters because the incident a user hits today should still be
  // recognised after a restart if the ledger is ever persisted.
  static std::uint64_t programKey(const std::string& program);

 private:
  void settle(std::uint64_t nowMs);

  std::vector<std::string> argv_;
  GuardLimits limits_{};
  GuardedProcess proc_;
  KernelJobState state_ = KernelJobState::Idle;
  std::string label_;
  std::string program_;
  std::string result_;
  std::string diagnostic_;
  std::string log_;
  OpProgress lastOp_{};
  std::uint64_t startedAtMs_ = 0;
  std::uint64_t elapsedMs_ = 0;
  std::vector<KernelIncident> incidents_;
  std::size_t incidentCap_ = 64;
  std::size_t submissions_ = 0;
  std::size_t completions_ = 0;
  std::size_t crashes_ = 0;
  std::size_t timeouts_ = 0;
  std::size_t cancellations_ = 0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_KERNELSESSION_HPP
