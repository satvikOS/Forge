#include "forge/ui/KernelSession.hpp"

#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include <unistd.h>

#include "forge/ui/GuardedProcess.hpp"

namespace forge::ui {

const char* toString(KernelJobState state) noexcept {
  switch (state) {
    case KernelJobState::Idle:        return "idle";
    case KernelJobState::Running:     return "running";
    case KernelJobState::Succeeded:   return "succeeded";
    case KernelJobState::Crashed:     return "crashed";
    case KernelJobState::TimedOut:    return "timed_out";
    case KernelJobState::Cancelled:   return "cancelled";
    case KernelJobState::Failed:      return "failed";
    case KernelJobState::Unavailable: return "unavailable";
  }
  return "idle";
}

bool isTerminalState(KernelJobState state) noexcept {
  return state != KernelJobState::Idle && state != KernelJobState::Running;
}

std::string OpProgress::text() const {
  if (id == 0 && op.empty()) return "before the first statement";
  std::string s;
  if (id != 0) {
    s += "%";
    s += std::to_string(id);
    s += " = ";
  }
  s += op.empty() ? std::string("<unnamed op>") : op;
  return s;
}

// ── the op trail ───────────────────────────────────────────────────────────
// The LAST well-formed `FORGE-OP <id> <NAME>` line in the worker's stderr. Read
// from the end so a partial line left by a process that died mid-write (the
// normal case for a SIGSEGV) does not become the answer: a truncated tail is
// skipped and the last COMPLETE announcement wins.
OpProgress KernelSession::parseOpTrail(const std::string& stderrText) {
  OpProgress out;
  const std::string prefix = kOpProgressPrefix;
  std::size_t pos = 0;
  while (pos < stderrText.size()) {
    std::size_t eol = stderrText.find('\n', pos);
    const bool complete = eol != std::string::npos;
    if (!complete) eol = stderrText.size();
    const std::string line = stderrText.substr(pos, eol - pos);
    pos = complete ? eol + 1 : stderrText.size();
    if (!complete) break;  // a torn final line is not an announcement
    if (line.rfind(prefix, 0) != 0) continue;
    std::string rest = line.substr(prefix.size());
    // "<id> <NAME>"
    std::size_t sp = rest.find(' ');
    std::string idText = sp == std::string::npos ? rest : rest.substr(0, sp);
    std::string name = sp == std::string::npos ? std::string() : rest.substr(sp + 1);
    while (!name.empty() && (name.back() == '\r' || name.back() == ' ')) name.pop_back();
    int id = 0;
    bool digits = !idText.empty();
    for (char c : idText) {
      if (c < '0' || c > '9') { digits = false; break; }
      id = id * 10 + (c - '0');
    }
    if (!digits) continue;
    out.id = id;
    out.op = std::move(name);
    ++out.announced;
  }
  return out;
}

std::uint64_t KernelSession::programKey(const std::string& program) {
  std::uint64_t h = 1469598103934665603ull;  // FNV-1a offset basis
  for (unsigned char c : program) {
    h ^= static_cast<std::uint64_t>(c);
    h *= 1099511628211ull;
  }
  return h;
}

void KernelSession::configureWorker(std::vector<std::string> argv) { argv_ = std::move(argv); }

void KernelSession::setIncidentCapacity(std::size_t n) noexcept {
  incidentCap_ = n == 0 ? 1 : n;
  while (incidents_.size() > incidentCap_) incidents_.erase(incidents_.begin());
}

const KernelIncident* KernelSession::priorIncidentFor(const std::string& program) const {
  const std::uint64_t key = programKey(program);
  for (std::size_t i = incidents_.size(); i > 0; --i) {
    const KernelIncident& inc = incidents_[i - 1];
    if (inc.programKey == key) return &inc;
  }
  return nullptr;
}

std::uint64_t KernelSession::elapsedMs(std::uint64_t nowMs) const {
  if (state_ == KernelJobState::Running) {
    return nowMs >= startedAtMs_ ? nowMs - startedAtMs_ : 0;
  }
  return elapsedMs_;
}

bool KernelSession::submit(std::string label, std::string program, std::uint64_t nowMs) {
  if (state_ == KernelJobState::Running) {
    diagnostic_ = "a kernel operation is already running; cancel it or wait";
    return false;
  }
  label_ = std::move(label);
  program_ = std::move(program);
  result_.clear();
  log_.clear();
  lastOp_ = OpProgress{};
  elapsedMs_ = 0;
  startedAtMs_ = nowMs;

  if (argv_.empty()) {
    state_ = KernelJobState::Unavailable;
    diagnostic_ = "no isolated kernel worker is configured; the caller must run in process";
    return false;
  }

  ++submissions_;
  proc_.reset();
  std::string error;
  if (!proc_.start(argv_, program_, limits_, nowMs, error)) {
    state_ = KernelJobState::Failed;
    diagnostic_ = "could not start the kernel worker: " + error;
    settle(nowMs);
    return false;
  }
  state_ = KernelJobState::Running;
  diagnostic_ = "running " + label_;
  return true;
}

void KernelSession::cancel(std::uint64_t nowMs) {
  if (state_ != KernelJobState::Running) return;
  proc_.cancel(nowMs);
}

bool KernelSession::pump(std::uint64_t nowMs) {
  if (state_ != KernelJobState::Running) return false;
  if (!proc_.poll(nowMs)) {
    // Not terminal, but the trail is live: a UI that shows "executing %7 = SHELL"
    // while it runs needs it before the job ends, not only after.
    log_ = proc_.errorText();
    lastOp_ = parseOpTrail(log_);
    return false;
  }

  log_ = proc_.errorText();
  lastOp_ = parseOpTrail(log_);
  const GuardReport& r = proc_.report();
  elapsedMs_ = r.elapsedMs;

  switch (r.outcome) {
    case GuardOutcome::Completed:
      result_ = proc_.output();
      state_ = KernelJobState::Succeeded;
      ++completions_;
      diagnostic_ = label_ + " completed in " + std::to_string(elapsedMs_) + " ms";
      break;
    case GuardOutcome::Crashed:
      state_ = KernelJobState::Crashed;
      ++crashes_;
      // ★ The whole point: a signal becomes a sentence that names the statement.
      diagnostic_ = "the kernel worker died on " + std::string(signalName(r.signalNumber)) +
                    " while executing " + lastOp_.text() +
                    ". The operation was isolated: this session, the document and every "
                    "other panel are intact. The last good geometry is still on screen.";
      break;
    case GuardOutcome::TimedOut:
      state_ = KernelJobState::TimedOut;
      ++timeouts_;
      diagnostic_ = label_ + " exceeded its " + std::to_string(limits_.deadlineMs) +
                    " ms budget at " + lastOp_.text() + " and was stopped";
      break;
    case GuardOutcome::Cancelled:
      state_ = KernelJobState::Cancelled;
      ++cancellations_;
      diagnostic_ = label_ + " was cancelled at " + lastOp_.text();
      break;
    case GuardOutcome::LaunchFailed:
      state_ = KernelJobState::Failed;
      diagnostic_ = "the kernel worker could not be launched: " + r.diagnostic;
      break;
    case GuardOutcome::Failed:
    case GuardOutcome::Pending:
      state_ = KernelJobState::Failed;
      diagnostic_ = label_ + " failed: " + r.diagnostic + " (last statement: " + lastOp_.text() +
                    ")";
      break;
  }
  settle(nowMs);
  return true;
}

void KernelSession::settle(std::uint64_t nowMs) {
  if (elapsedMs_ == 0 && nowMs >= startedAtMs_) elapsedMs_ = nowMs - startedAtMs_;
  KernelIncident inc;
  inc.label = label_;
  inc.state = state_;
  inc.signalNumber = proc_.report().signalNumber;
  inc.elapsedMs = elapsedMs_;
  inc.lastOp = lastOp_;
  inc.programKey = programKey(program_);
  inc.programBytes = program_.size();
  inc.diagnostic = diagnostic_;
  incidents_.push_back(std::move(inc));
  while (incidents_.size() > incidentCap_) incidents_.erase(incidents_.begin());
}

KernelJobState KernelSession::runToCompletion() {
  while (state_ == KernelJobState::Running) {
    if (pump(steadyNowMs())) break;
    ::usleep(1000);  // 1 ms: bounded latency without spinning a core
  }
  return state_;
}

}  // namespace forge::ui
