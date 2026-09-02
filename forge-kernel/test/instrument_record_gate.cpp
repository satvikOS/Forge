// instrument_record_gate.cpp — DOES THE VERIFIER ANSWER FOR ITSELF WHEN IT DIES?
//
// The defect this gate exists for, measured 2026-09-01: forge_verify aborted
// seven times during a 600-row self-consistency run (uncaught
// Standard_ConstructionError out of forge::rotate; OCCT raises do not derive
// from std::exception, so main's handler never matched). It wrote NOTHING on the
// way out, so all seven rows were recorded downstream as "the tree does not
// compile: verifier produced no output" — a claim about the MODEL'S OUTPUT that
// nothing had established, sitting in the denominator of a published rate.
//
// The fix is a record emitted where the process EXITS. This gate proves that
// record actually appears, by driving every death path in
// src/tools/InstrumentRecord.hpp — the very header forge_verify.cpp ships — and
// checking stdout. It needs no kernel and no OCCT, so it can run anywhere the
// compiler runs, which is the point: the reason the original abort went
// unnoticed for a whole run is that nothing ever exercised the path it died on.
//
// Each case runs in a forked child, because most of them END the process. The
// parent reads the child's stdout through a pipe and checks what it said before
// it went.
//
// Exit codes
//   0  GREEN
//   1  RED — a death path produced no record, or the wrong one
//   3  RED — the gate could not run at all (a check that could not run is not a
//            check that passed)
#include "../src/tools/InstrumentRecord.hpp"

#include <sys/wait.h>

#include <cstdio>
#include <cstring>
#include <functional>   // runChild takes a std::function. libc++ happens to pull
                        // this in transitively and libstdc++ does not, so without
                        // it the gate compiles on the macOS runner and fails on a
                        // Linux one -- a portability break in the one file whose
                        // selling point is that it runs anywhere a compiler does.
#include <string>
#include <vector>

using namespace forge::instrument;

namespace {

int g_failures = 0;

struct Outcome {
    std::string out;      // everything the child wrote to stdout
    std::string err;      // ... and to stderr
    int status = 0;
    bool signalled = false;
    int signum = 0;
};

// Run `body` in a child, capture both streams, and report how it died.
Outcome runChild(const std::function<void()>& body) {
    Outcome o;
    int po[2], pe[2];
    if (pipe(po) != 0 || pipe(pe) != 0) { std::perror("pipe"); std::exit(3); }
    const pid_t pid = fork();
    if (pid < 0) { std::perror("fork"); std::exit(3); }
    if (pid == 0) {
        dup2(po[1], STDOUT_FILENO);
        dup2(pe[1], STDERR_FILENO);
        close(po[0]); close(po[1]); close(pe[0]); close(pe[1]);
        installInstrumentHandlers();
        body();
        std::_Exit(0);          // a body that returns is a body that survived
    }
    close(po[1]); close(pe[1]);
    char buf[4096];
    ssize_t n;
    while ((n = read(po[0], buf, sizeof buf)) > 0) o.out.append(buf, static_cast<std::size_t>(n));
    while ((n = read(pe[0], buf, sizeof buf)) > 0) o.err.append(buf, static_cast<std::size_t>(n));
    close(po[0]); close(pe[0]);
    int st = 0;
    waitpid(pid, &st, 0);
    o.status = st;
    o.signalled = WIFSIGNALED(st);
    o.signum = o.signalled ? WTERMSIG(st) : 0;
    return o;
}

void check(bool cond, const std::string& what) {
    std::printf("  %s %s\n", cond ? "ok  " : "FAIL", what.c_str());
    if (!cond) ++g_failures;
}

bool has(const std::string& hay, const char* needle) {
    return hay.find(needle) != std::string::npos;
}

// How many times does an instrument record appear? EXACTLY ONE PER ROW is the
// whole guarantee — two would double-count a crash, none is the original bug.
int countRecords(const std::string& s) {
    int k = 0;
    for (std::size_t i = s.find("\"instrument\":"); i != std::string::npos;
         i = s.find("\"instrument\":", i + 1))
        ++k;
    return k;
}

}  // namespace

int main() {
    std::printf("[instrument-gate] driving every death path in InstrumentRecord.hpp\n");

    // --- 1. THE REAL SHAPE: an exception that is not a std::exception, uncaught.
    // This is Standard_ConstructionError's shape exactly. Before the fix the
    // process died here having said nothing at all.
    {
        Outcome o = runChild([] {
            beginRow(41);
            setRowId("ho962");
            injectUncaught();               // terminate with a live exception
        });
        std::printf("[case 1] uncaught non-std exception (the 2026-09-01 abort)\n");
        check(has(o.out, "\"instrument\":\"verifier_aborted\""),
              "the dying process emits an instrument record");
        check(has(o.out, "\"id\":\"ho962\""), "the record names the row in flight");
        check(has(o.out, "\"rowIndex\":41"), "the record carries the row index");
        check(has(o.out, "InjectedFault"),
              "the exception's TYPE survives (the .ips carries only 'abort() called')");
        check(has(o.out, "\"afterAnswer\":false"),
              "flagged as a row that never got its measurement");
        check(countRecords(o.out) == 1, "exactly one record, never two");
        check(o.signalled && o.signum == SIGABRT,
              "the process still aborts, so the OS crash report still exists to reconcile against");
        check(has(o.err, "forge_verify: INSTRUMENT"),
              "stderr carries the same words, for a caller that reads the child's last lines");
    }

    // --- 2. A std::exception that escapes: its what() must survive. -----------
    {
        Outcome o = runChild([] {
            beginRow(7);
            setRowId("ho1229");
            try { throw std::runtime_error("axis is zero"); }
            catch (...) { std::terminate(); }
        });
        std::printf("[case 2] uncaught std::exception\n");
        check(has(o.out, "\"instrument\":\"verifier_aborted\""), "instrument record emitted");
        check(has(o.out, "axis is zero"), "what() survives — the diagnosis is not destroyed");
        check(has(o.out, "runtime_error"), "the type is named too");
    }

    // --- 3. A fatal SIGNAL has no exception to read, but it still has a row. --
    {
        Outcome o = runChild([] {
            beginRow(3);
            setRowId("ho341");
            std::raise(SIGSEGV);
        });
        std::printf("[case 3] fatal signal\n");
        check(has(o.out, "\"instrument\":\"verifier_signal\""), "instrument record emitted");
        check(has(o.out, "SIGSEGV"), "the signal is named");
        check(has(o.out, "\"id\":\"ho341\""), "the record names the row in flight");
        check(o.signalled && o.signum == SIGSEGV, "the process still dies of the signal");
    }

    // --- 4. A crash AFTER the row was answered is still recorded, and flagged.
    // Without this the counts stop reconciling: there would be a crash report
    // with no line to match it to, which is precisely the ambiguity that made
    // the 2026-09-01 numbers arguable in both directions.
    {
        Outcome o = runChild([] {
            beginRow(9);
            setRowId("ho274");
            emitRow("{\"id\":\"ho274\",\"ok\":true,\"volume\":1.0}");
            injectUncaught();
        });
        std::printf("[case 4] crash after the row was answered\n");
        check(has(o.out, "\"volume\":1.0"), "the good measurement is still there");
        check(has(o.out, "\"instrument\":\"verifier_aborted\""), "the crash is recorded too");
        check(has(o.out, "\"afterAnswer\":true"),
              "flagged afterAnswer, so a caller reconciles it WITHOUT discarding the measurement");
    }

    // --- 5. NEGATIVE CONTROL. A row that simply succeeds must produce NO
    // instrument record. A gate that fires on everything measures nothing.
    {
        Outcome o = runChild([] {
            beginRow(0);
            setRowId("ho23");
            emitRow("{\"id\":\"ho23\",\"ok\":true}");
        });
        std::printf("[case 5] negative control: a healthy row\n");
        check(countRecords(o.out) == 0, "no instrument record for a row that answered");
        check(!o.signalled && WEXITSTATUS(o.status) == 0, "and the process lives");
    }

    // --- 6. The fault injector the shell gate drives must be INERT by default.
    {
        unsetenv("FORGE_VERIFY_FAULT");
        Outcome o = runChild([] {
            beginRow(0);
            setRowId("ho23");
            maybeInjectFault("ho23");
            emitRow("{\"id\":\"ho23\",\"ok\":true}");
        });
        std::printf("[case 6] fault injector is off unless asked\n");
        check(countRecords(o.out) == 0 && !o.signalled,
              "FORGE_VERIFY_FAULT unset -> nothing injected");
    }
    {
        setenv("FORGE_VERIFY_FAULT", "terminate", 1);
        setenv("FORGE_VERIFY_FAULT_ID", "ho999", 1);
        Outcome o = runChild([] {
            beginRow(0);
            setRowId("ho23");                 // a DIFFERENT row
            maybeInjectFault("ho23");
            emitRow("{\"id\":\"ho23\",\"ok\":true}");
        });
        check(countRecords(o.out) == 0 && !o.signalled,
              "FORGE_VERIFY_FAULT_ID targets one row and spares the others");
        Outcome p = runChild([] {
            beginRow(0);
            setRowId("ho999");                // the targeted row
            maybeInjectFault("ho999");
            emitRow("{\"id\":\"ho999\",\"ok\":true}");
        });
        check(has(p.out, "\"instrument\":\"verifier_aborted\"") && p.signalled,
              "and it DOES fire on the row it targets (the injector is real)");
        unsetenv("FORGE_VERIFY_FAULT");
        unsetenv("FORGE_VERIFY_FAULT_ID");
    }

    if (g_failures) {
        std::printf("[instrument-gate] RED: %d check(s) failed\n", g_failures);
        return 1;
    }
    std::printf("[instrument-gate] GREEN\n");
    return 0;
}
