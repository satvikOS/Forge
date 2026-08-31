// ui/test/crash_isolation_test.cpp — THE CRASH-ISOLATION GATE.
//
// It proves, with REAL child processes that REALLY die, that a geometry
// operation cannot take the application down.
//
// ── why the children are real ───────────────────────────────────────────────
// A mock that "returns Crashed" tests the mock. The defect being defended
// against is a SIGSEGV inside third-party code: no exception, no return value,
// no stack unwinding, and a parent that is simply gone. Nothing but an actual
// signal exercises the actual mechanism, so this gate RE-EXECS ITSELF with a
// `--forge-worker <mode>` marker and each mode does the real thing — dereferences
// null, spins for ever, ignores SIGTERM, exits non-zero, floods a pipe, or
// closes stdin without reading a 32 MB request.
//
// If the supervisor is wrong, THIS TEST PROCESS DIES, and run_ui.sh reports the
// gate as a crash rather than as a failed check. That is the strongest possible
// signal for this particular invariant, and it is why every mode below is run
// from inside one process that keeps counting checks afterwards: reaching the
// final line at all is part of the result.
//
// ── the two defects it covers ───────────────────────────────────────────────
//  1. THE KERNEL SEGFAULTS (OCCT_NULL_PCURVE_SEGV.md). The child dies on
//     SIGSEGV; the parent classifies it, NAMES THE STATEMENT the worker was
//     executing when it died, keeps its own document, and carries on.
//  2. TIMEOUTS (6 of 600 corpus parts exceed 300 s). The child hangs; the parent
//     is never blocked, the deadline fires, SIGTERM then SIGKILL, and the run is
//     reported as TimedOut rather than as a frozen window.
#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <fcntl.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

#include "forge/ui/GuardedProcess.hpp"
#include "forge/ui/KernelSession.hpp"
#include "ui_test_util.hpp"

using forge::ui::GuardedProcess;
using forge::ui::GuardLimits;
using forge::ui::GuardOutcome;
using forge::ui::KernelJobState;
using forge::ui::KernelSession;
using forge::ui::OpProgress;

namespace {

// ── THE WORKER HALF ─────────────────────────────────────────────────────────
// Everything below runs in the CHILD. It speaks the same protocol the real
// kernel worker does: the IR program arrives on stdin, each statement is
// announced on stderr as `FORGE-OP <id> <NAME>` BEFORE it is executed, and the
// answer goes to stdout.
void announce(int id, const char* op) {
  std::fprintf(stderr, "%s%d %s\n", forge::ui::kOpProgressPrefix, id, op);
  std::fflush(stderr);
}

std::string readAllStdin() {
  std::string all;
  char buf[65536];
  for (;;) {
    const ssize_t n = ::read(STDIN_FILENO, buf, sizeof(buf));
    if (n > 0) {
      all.append(buf, static_cast<std::size_t>(n));
      continue;
    }
    if (n < 0 && errno == EINTR) continue;
    break;
  }
  return all;
}

int runWorker(const std::string& mode) {
  if (mode == "ok") {
    const std::string program = readAllStdin();
    announce(1, "RECT");
    announce(2, "EXTRUDE");
    announce(3, "FILLET");
    // A payload big enough that the pipe buffer cannot hold it, so the parent's
    // incremental drain is exercised rather than assumed.
    std::string payload = "FORGE-RESULT 1\nbytes " + std::to_string(program.size()) + "\n";
    payload.append(4u * 1024u * 1024u, 'x');
    std::fwrite(payload.data(), 1, payload.size(), stdout);
    std::fflush(stdout);
    return 0;
  }
  if (mode == "crash") {
    (void)readAllStdin();
    announce(5, "CUT");
    announce(7, "SHELL");  // the op the report names as a real crasher
    // The real thing. Not abort(), not exit(): a null dereference, which is what
    // BRep_Tool::CurveOnSurface does with a null Geom2d_Curve handle.
    volatile int* p = nullptr;
    *p = 1;
    return 0;  // unreachable
  }
  if (mode == "crash-early") {
    // Dies BEFORE announcing anything and WITHOUT reading stdin. Two things at
    // once: the trail is empty (the honest answer is "before the first
    // statement"), and the parent still has a large request half-written into a
    // pipe whose reader is gone — the SIGPIPE case.
    volatile int* p = nullptr;
    *p = 1;
    return 0;
  }
  if (mode == "hang") {
    (void)readAllStdin();
    announce(4, "LOFT");
    for (;;) ::usleep(50000);
  }
  if (mode == "hang-stubborn") {
    ::signal(SIGTERM, SIG_IGN);  // a polite request is not enough
    (void)readAllStdin();
    announce(9, "PATTERN");
    for (;;) ::usleep(50000);
  }
  if (mode == "fail") {
    (void)readAllStdin();
    announce(2, "HOLE");
    std::fprintf(stderr, "the kernel refused: no solid at %%2\n");
    return 3;
  }
  if (mode == "flood") {
    (void)readAllStdin();
    std::string line(1024, 'e');
    line += '\n';
    for (int i = 0; i < 4096; ++i) std::fwrite(line.data(), 1, line.size(), stderr);
    std::fflush(stderr);
    return 0;
  }
  if (mode == "exit-unread") {
    // Exits at once without reading a byte of a large request.
    return 0;
  }
  std::fprintf(stderr, "unknown worker mode '%s'\n", mode.c_str());
  return 9;
}

// ── THE SUPERVISOR HALF ─────────────────────────────────────────────────────
std::string g_self;

std::vector<std::string> worker(const std::string& mode) { return {g_self, "--forge-worker", mode}; }

// Drives a session to a terminal state WITHOUT sleeping the whole budget: the
// gate must be fast, and pumping with an injected clock is also how the
// application will do it (once per frame). `stepMs` advances the clock the
// deadline is measured against; real waiting is 0.5 ms a turn.
//
// maxPumps is a BOUND, not a timeout, and it is deliberately small (2 s of real
// waiting). A supervisor whose deadline stopped working would otherwise leave
// this loop spinning until run_ui.sh's 120 s per-test kill — measured, and a
// two-minute red is a red nobody reads. With the bound, the same defect leaves
// the state at "running" and the very next CHECK prints which state was expected.
KernelJobState drive(KernelSession& s, std::uint64_t startMs, std::uint64_t stepMs,
                     std::uint64_t& endMs, std::size_t maxPumps = 4000) {
  std::uint64_t t = startMs;
  for (std::size_t i = 0; i < maxPumps && s.running(); ++i) {
    if (s.pump(t)) break;
    ::usleep(500);
    t += stepMs;
  }
  endMs = t;
  return s.state();
}

// How many file descriptors this process holds. A supervisor that leaked one per
// run would exhaust the table over a long session, which is the resource-leak
// half of this track.
std::size_t openFdCount() {
  std::size_t n = 0;
  for (int fd = 0; fd < 512; ++fd) {
    if (::fcntl(fd, F_GETFD) != -1) ++n;
  }
  return n;
}

}  // namespace

int main(int argc, char** argv) {
  // ── the child path ────────────────────────────────────────────────────────
  if (argc >= 3 && std::strcmp(argv[1], "--forge-worker") == 0) {
    return runWorker(argv[2]);
  }

  forge::uitest::Harness H("crash_isolation");
  g_self = argc > 0 && argv[0] != nullptr ? argv[0] : std::string();
  // A gate that cannot find itself must SAY SO, not quietly pass having run
  // nothing. `ONLY=` filtering already had to learn this lesson once.
  if (g_self.empty() || ::access(g_self.c_str(), X_OK) != 0) {
    std::printf("[crash_isolation] cannot re-exec self from argv[0]='%s' — refusing to report "
                "success\n",
                g_self.c_str());
    return 1;
  }

  const std::size_t fdsAtStart = openFdCount();

  // ── 1. parseOpTrail, in isolation ─────────────────────────────────────────
  // The trail is what turns a signal into a sentence, so it is checked as a pure
  // function before anything spawns.
  {
    const OpProgress none = KernelSession::parseOpTrail("");
    CHECK_EQ_INT(none.id, 0);
    CHECK_EQ_STR(none.text(), "before the first statement");

    const OpProgress two = KernelSession::parseOpTrail(
        "FORGE-OP 1 RECT\nnoise\nFORGE-OP 7 SHELL\n");
    CHECK_EQ_INT(two.id, 7);
    CHECK_EQ_STR(two.op, "SHELL");
    CHECK_EQ_INT(static_cast<long long>(two.announced), 2);
    CHECK_EQ_STR(two.text(), "%7 = SHELL");

    // A process that dies MID-WRITE leaves a torn line. The last COMPLETE
    // announcement is the answer; a half-written one is not evidence.
    const OpProgress torn = KernelSession::parseOpTrail("FORGE-OP 3 CUT\nFORGE-OP 4 SH");
    CHECK_EQ_INT(torn.id, 3);
    CHECK_EQ_STR(torn.op, "CUT");

    // Garbage in the id field is skipped rather than parsed as zero.
    const OpProgress junk = KernelSession::parseOpTrail("FORGE-OP x SHELL\nFORGE-OP 2 HOLE\n");
    CHECK_EQ_INT(junk.id, 2);

    CHECK(KernelSession::programKey("a") != KernelSession::programKey("b"));
    CHECK_EQ_INT(static_cast<long long>(KernelSession::programKey("abc") ==
                                           KernelSession::programKey("abc")),
                 1);
  }

  // ── 2. no worker configured: Unavailable, never a crash ───────────────────
  {
    KernelSession s;
    CHECK(!s.workerConfigured());
    const bool started = s.submit("rebuild", "%1 = RECT(10, 10)", 1000);
    CHECK(!started);
    CHECK_EQ_STR(forge::ui::toString(s.state()), "unavailable");
    CHECK(!s.diagnostic().empty());
    CHECK_EQ_INT(static_cast<long long>(s.submissions()), 0);
  }

  // ── 3. THE HAPPY PATH, through a real pipe ────────────────────────────────
  const std::string program = "%1 = RECT(40, 30)\n%2 = EXTRUDE(%1, 20)\n%3 = FILLET(%2, 2, ALL)\n";
  {
    KernelSession s;
    s.configureWorker(worker("ok"));
    GuardLimits lim;
    lim.deadlineMs = 20000;
    s.setLimits(lim);
    CHECK(s.submit("rebuild", program, 0));
    std::uint64_t endMs = 0;
    const KernelJobState st = drive(s, 0, 1, endMs);
    CHECK_EQ_STR(forge::ui::toString(st), "succeeded");
    CHECK_EQ_INT(static_cast<long long>(s.completions()), 1);
    CHECK_EQ_INT(static_cast<long long>(s.crashes()), 0);
    // The payload came back WHOLE — 4 MB is far past a pipe buffer, so this is
    // the check that the incremental drain actually drains.
    CHECK(s.result().size() > 4u * 1024u * 1024u);
    CHECK(s.result().rfind("FORGE-RESULT 1\n", 0) == 0);
    // ...and the REQUEST arrived whole, which is the other direction of the same
    // claim: the worker echoes the byte count it read.
    const std::string want = "bytes " + std::to_string(program.size()) + "\n";
    CHECK(s.result().find(want) != std::string::npos);
    CHECK_EQ_INT(s.lastOp().id, 3);
    CHECK_EQ_STR(s.lastOp().op, "FILLET");
    CHECK_EQ_INT(static_cast<long long>(s.incidents().size()), 1);
  }

  // ── 4. ★ THE CRASH. A real SIGSEGV in the child; the parent survives it. ──
  {
    KernelSession s;
    s.configureWorker(worker("crash"));
    CHECK(s.submit("rebuild", program, 0));
    std::uint64_t endMs = 0;
    const KernelJobState st = drive(s, 0, 1, endMs);
    CHECK_EQ_STR(forge::ui::toString(st), "crashed");
    CHECK_EQ_INT(s.lastGuardReport().signalNumber, SIGSEGV);
    CHECK_EQ_INT(static_cast<long long>(s.crashes()), 1);
    // ★ THE POINT OF THE OP TRAIL: the crash is not silent any more. It names
    // the statement the worker was executing, which is what a repair loop acts
    // on and what the OCCT report says every other failure mode already gives.
    CHECK_EQ_INT(s.lastOp().id, 7);
    CHECK_EQ_STR(s.lastOp().op, "SHELL");
    CHECK(s.diagnostic().find("SIGSEGV") != std::string::npos);
    CHECK(s.diagnostic().find("%7 = SHELL") != std::string::npos);
    CHECK(s.result().empty());
    // The ledger saw it, WITHOUT anything being refused.
    CHECK_EQ_INT(static_cast<long long>(s.incidents().size()), 1);
    const forge::ui::KernelIncident* prior = s.priorIncidentFor(program);
    CHECK(prior != nullptr);
    if (prior != nullptr) {
      CHECK_EQ_INT(prior->signalNumber, SIGSEGV);
      CHECK_EQ_INT(prior->lastOp.id, 7);
    }

    // ★★ THE LEDGER IS ADVISORY, NOT A GATE. The owner's constraint is that
    // nothing may REFUSE input. Re-submitting the program that just crashed must
    // RUN AGAIN — a quarantine that declined would be a capability gate wearing a
    // safety hat, and it would fire hardest on the longest trees.
    CHECK(s.submit("rebuild again", program, 0));
    const KernelJobState again = drive(s, 0, 1, endMs);
    CHECK_EQ_STR(forge::ui::toString(again), "crashed");
    CHECK_EQ_INT(static_cast<long long>(s.submissions()), 2);
    CHECK_EQ_INT(static_cast<long long>(s.crashes()), 2);
  }

  // ── 5. a crash BEFORE the first announcement, with a huge unread request ──
  // Two hazards in one: an empty trail must produce an honest diagnostic rather
  // than a wrong one, and the parent must survive writing 32 MB into a pipe
  // whose reader is dead. Without the SIGPIPE guard this line kills THIS gate.
  {
    KernelSession s;
    s.configureWorker(worker("crash-early"));
    std::string huge;
    huge.reserve(32u * 1024u * 1024u);
    for (int i = 0; i < 400000; ++i) huge += "%1 = CIRCLE(4.495)\n";
    CHECK(huge.size() > 6u * 1024u * 1024u);
    CHECK(s.submit("open", huge, 0));
    std::uint64_t endMs = 0;
    const KernelJobState st = drive(s, 0, 1, endMs);
    CHECK_EQ_STR(forge::ui::toString(st), "crashed");
    CHECK_EQ_STR(s.lastOp().text(), "before the first statement");
    CHECK(s.diagnostic().find("before the first statement") != std::string::npos);
  }

  // ── 6. THE HANG. The deadline fires; nothing blocks. ─────────────────────
  {
    KernelSession s;
    s.configureWorker(worker("hang"));
    GuardLimits lim;
    lim.deadlineMs = 200;
    lim.termGraceMs = 200;
    s.setLimits(lim);
    CHECK(s.submit("rebuild", program, 0));
    // The clock is INJECTED, so the deadline is deterministic and the gate does
    // not spend the budget in real time.
    std::uint64_t endMs = 0;
    const KernelJobState st = drive(s, 0, 5, endMs);
    CHECK_EQ_STR(forge::ui::toString(st), "timed_out");
    CHECK_EQ_INT(static_cast<long long>(s.timeouts()), 1);
    CHECK_EQ_INT(s.lastOp().id, 4);
    CHECK(s.diagnostic().find("%4 = LOFT") != std::string::npos);
    CHECK(s.diagnostic().find("budget") != std::string::npos);
    // A timeout is NOT reported as a crash: we killed it, it did not fault.
    CHECK_EQ_INT(static_cast<long long>(s.crashes()), 0);
  }

  // ── 7. a child that IGNORES SIGTERM still dies ───────────────────────────
  {
    KernelSession s;
    s.configureWorker(worker("hang-stubborn"));
    GuardLimits lim;
    lim.deadlineMs = 150;
    lim.termGraceMs = 150;
    s.setLimits(lim);
    CHECK(s.submit("rebuild", program, 0));
    std::uint64_t endMs = 0;
    const KernelJobState st = drive(s, 0, 5, endMs);
    CHECK_EQ_STR(forge::ui::toString(st), "timed_out");
    CHECK_EQ_INT(s.lastGuardReport().signalNumber, SIGKILL);
  }

  // ── 8. CANCEL — the user's escape hatch ──────────────────────────────────
  {
    KernelSession s;
    s.configureWorker(worker("hang"));
    GuardLimits lim;
    lim.deadlineMs = 0;  // no deadline at all: only the user stops this one
    lim.termGraceMs = 100;
    s.setLimits(lim);
    CHECK(s.submit("rebuild", program, 0));
    std::uint64_t t = 0;
    for (int i = 0; i < 200 && s.lastOp().id == 0; ++i) {  // wait for it to start work
      s.pump(t);
      ::usleep(2000);
      t += 2;
    }
    CHECK_EQ_INT(s.lastOp().id, 4);
    CHECK(s.running());
    s.cancel(t);
    std::uint64_t endMs = 0;
    const KernelJobState st = drive(s, t, 5, endMs);
    CHECK_EQ_STR(forge::ui::toString(st), "cancelled");
    CHECK_EQ_INT(static_cast<long long>(s.cancellations()), 1);
    CHECK(s.diagnostic().find("cancelled") != std::string::npos);
  }

  // ── 9. a worker that REFUSES: non-zero exit is Failed, never Crashed ─────
  {
    KernelSession s;
    s.configureWorker(worker("fail"));
    CHECK(s.submit("rebuild", program, 0));
    std::uint64_t endMs = 0;
    const KernelJobState st = drive(s, 0, 1, endMs);
    CHECK_EQ_STR(forge::ui::toString(st), "failed");
    CHECK_EQ_INT(s.lastGuardReport().exitCode, 3);
    CHECK_EQ_INT(static_cast<long long>(s.crashes()), 0);
    CHECK(s.workerLog().find("the kernel refused") != std::string::npos);
    CHECK(s.diagnostic().find("%2 = HOLE") != std::string::npos);
  }

  // ── 10. a worker that FLOODS its log is capped, and the cap is named ─────
  {
    KernelSession s;
    s.configureWorker(worker("flood"));
    GuardLimits lim;
    lim.stderrCap = 64u * 1024u;
    s.setLimits(lim);
    CHECK(s.submit("rebuild", program, 0));
    std::uint64_t endMs = 0;
    const KernelJobState st = drive(s, 0, 1, endMs);
    CHECK_EQ_STR(forge::ui::toString(st), "succeeded");
    CHECK_EQ_INT(static_cast<long long>(s.workerLog().size()), 64 * 1024);
    CHECK(s.lastGuardReport().stderrCapped);
  }

  // ── 11. a worker that never reads a big request, then exits 0 ────────────
  {
    KernelSession s;
    s.configureWorker(worker("exit-unread"));
    std::string big(8u * 1024u * 1024u, 'z');
    CHECK(s.submit("rebuild", big, 0));
    std::uint64_t endMs = 0;
    const KernelJobState st = drive(s, 0, 1, endMs);
    CHECK_EQ_STR(forge::ui::toString(st), "succeeded");
  }

  // ── 12. a worker that is not there at all ────────────────────────────────
  {
    KernelSession s;
    s.configureWorker({"/nonexistent/forge_kernel_worker_xyz"});
    const bool started = s.submit("rebuild", program, 0);
    CHECK(!started);
    CHECK_EQ_STR(forge::ui::toString(s.state()), "failed");
    CHECK(s.diagnostic().find("could not start") != std::string::npos);
  }

  // ── 13. RESOURCES. 40 runs must not leak a descriptor or leave a zombie. ─
  // A crash the app survives once but that costs a file descriptor every time is
  // a slower way to lose the session, not a fix.
  {
    KernelSession s;
    s.setIncidentCapacity(8);
    for (int i = 0; i < 20; ++i) {
      s.configureWorker(worker(i % 2 == 0 ? "crash" : "fail"));
      s.submit("churn", program + std::to_string(i), 0);
      std::uint64_t endMs = 0;
      drive(s, 0, 1, endMs);
    }
    CHECK_EQ_INT(static_cast<long long>(s.incidents().size()), 8);  // bounded ledger
    CHECK_EQ_INT(static_cast<long long>(s.crashes()), 10);
    const std::size_t fdsNow = openFdCount();
    // Exactly equal is the honest bar here: every pipe this supervisor opens is
    // closed by the run that opened it.
    CHECK_EQ_INT(static_cast<long long>(fdsNow), static_cast<long long>(fdsAtStart));
    // ...and nothing is left unreaped. ECHILD means "you have no children",
    // which after 20+ spawns is the whole claim.
    const pid_t leftover = ::waitpid(-1, nullptr, WNOHANG);
    CHECK_EQ_INT(static_cast<long long>(leftover), -1);
    CHECK_EQ_INT(errno, ECHILD);
  }

  // ── 14. GuardedProcess reuse: the same supervisor, run twice ────────────
  {
    GuardedProcess p;
    GuardLimits lim;
    lim.deadlineMs = 10000;
    std::string err;
    CHECK(p.start(worker("ok"), "x", lim, 0, err));
    std::uint64_t t = 0;
    while (!p.poll(t)) { ::usleep(500); t += 1; }
    CHECK_EQ_STR(forge::ui::toString(p.report().outcome), "completed");
    const int firstPid = p.report().exitCode;  // 0
    CHECK_EQ_INT(firstPid, 0);
    CHECK(p.start(worker("fail"), "y", lim, 0, err));
    t = 0;
    while (!p.poll(t)) { ::usleep(500); t += 1; }
    CHECK_EQ_STR(forge::ui::toString(p.report().outcome), "failed");
    CHECK_EQ_INT(p.report().exitCode, 3);
    // The second run's state is its own: no residue from the first.
    CHECK(p.output().empty());
  }

  // ── 15. POSITIVE CONTROLS: prove the arms differ ────────────────────────
  // Every check above says the SUPERVISED arm survives. None of them says the
  // UNSUPERVISED arm would not, and a gate that cannot show the hazard is real
  // is asserting that a mechanism it never demonstrated is load-bearing. Both
  // controls run in a forked child, so the hazard is demonstrated without the
  // gate taking the damage.
  {
    // (a) IN PROCESS, the operation is fatal. This is the same null dereference
    //     the "crash" worker performs; here nothing supervises it.
    const pid_t c = ::fork();
    if (c == 0) {
      volatile int* p = nullptr;
      *p = 1;
      ::_exit(0);
    }
    CHECK(c > 0);
    int status = 0;
    ::waitpid(c, &status, 0);
    CHECK_EQ_INT(static_cast<long long>(WIFSIGNALED(status)), 1);
    CHECK_EQ_INT(WTERMSIG(status), SIGSEGV);
  }
  {
    // (b) WITHOUT the SIGPIPE guard, writing a request to a dead worker kills
    //     the WRITER. The child restores the default disposition — which is what
    //     GuardedProcess::start() replaces — closes the read end, and writes.
    int fds[2] = {-1, -1};
    CHECK_EQ_INT(::pipe(fds), 0);
    const pid_t c = ::fork();
    if (c == 0) {
      ::signal(SIGPIPE, SIG_DFL);
      ::close(fds[0]);
      const char byte = 'x';
      (void)::write(fds[1], &byte, 1);
      ::_exit(0);
    }
    ::close(fds[0]);
    ::close(fds[1]);
    CHECK(c > 0);
    int status = 0;
    ::waitpid(c, &status, 0);
    CHECK_EQ_INT(static_cast<long long>(WIFSIGNALED(status)), 1);
    CHECK_EQ_INT(WTERMSIG(status), SIGPIPE);
  }

  std::printf("[crash_isolation] the supervisor survived %s\n",
              "SIGSEGV x13, two hangs, a SIGTERM-ignoring child, a cancel, a flood, "
              "a 32 MB unread request and a missing binary");
  return H.finish();
}
