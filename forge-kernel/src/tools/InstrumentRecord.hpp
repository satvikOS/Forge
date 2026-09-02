// InstrumentRecord.hpp — a verifier that dies is its own outcome.
//
// Extracted from forge_verify.cpp so the crash paths can be DRIVEN BY A TEST
// against the very code that ships, rather than against a replica that drifts.
// test/instrument_record_gate.cpp includes this header and fires every handler;
// it links in a second and needs no kernel and no OCCT, so the gate can run
// everywhere the compiler runs.
#pragma once

#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cxxabi.h>
#include <exception>
#include <iostream>
#include <string>
#include <typeinfo>
#include <unistd.h>

// ===================== THE INSTRUMENT IS NOT THE SPECIMEN =====================
//
// A VERIFIER THAT DIES MUST BE ITS OWN OUTCOME, NEVER A VERDICT ON ITS INPUT --
// and it must say so ITSELF, at the point where the process exits, not wherever
// the harness downstream happens to notice the silence.
//
// WHY THAT DISTINCTION IS NOT PEDANTRY. Measured on the 600-row self-consistency
// run of 2026-09-01: forge_verify aborted 7 times (SIGABRT; every crash report on
// the machine that day has forge::rotate in its faulting frame, a zero-axis
// ROTATE reaching gp_Dir(0,0,0) -> Standard_ConstructionError, which is not a
// std::exception, so main()'s handler never matched). The harness saw a closed
// pipe and wrote down, for all 7 rows, "the tree does not compile: verifier
// produced no output". That sentence is a claim about the MODEL'S OUTPUT, and
// for those 7 rows nothing had established it.
//
// WHAT THIS BLOCK GUARANTEES, and what a harness-side fix alone cannot:
//
//   1. EXACTLY ONE record per row, always. A row that is read either gets its
//      measurement or gets an `instrument` record -- including when the process
//      is dying. `verifierAborted` fires from std::terminate and from the fatal
//      signals, i.e. from inside the crash, so the record exists even though the
//      answer never will.
//
//   2. THE COUNT RECONCILES. Every abort leaves BOTH a line here AND an OS crash
//      report; the two are then countable against each other, which is the only
//      way to prove no failure went unrecorded. (The 2026-09-01 apparent
//      shortfall -- 13 crash reports against 9 instrument rows -- turned out to
//      be 6 reports belonging to five OTHER processes plus 2 timeouts that were
//      SIGKILLed and so leave no report at all. Reconciling by parent pid, not
//      by wall-clock window, is what settled it: 7 aborts, 7 rows, nothing lost.
//      A count you cannot reconcile is a count you cannot defend either way.)
//
//   3. THE EXCEPTION'S OWN WORDS SURVIVE. The .ips carries "abort() called" and
//      nothing else, so the cause of a crash used to die with it. The terminate
//      handler re-raises the in-flight exception to read what() off it, and names
//      its type through __cxa_current_exception_type even when it is a type this
//      tool has never heard of.
//
// `instrument` is the key that says "this record is about ME". A caller must
// exclude such a row from BOTH the numerator and the denominator of every rate:
// it is not a pass, not a failure, and not evidence.
namespace forge {
namespace instrument {

constexpr std::size_t kInstrCap = 2048;

inline char  g_rowId[192] = {0};      // the row in flight, copied (never referenced):
inline long  g_rowIndex = -1;         // a crash handler must not chase a pointer
inline volatile std::sig_atomic_t g_rowAnswered = 1;   // has this row emitted a record?
inline volatile std::sig_atomic_t g_dying = 0;         // emit the death record only once
inline std::terminate_handler g_prevTerminate = nullptr;

// --- allocation-free JSON assembly -----------------------------------------
// Deliberately hand-rolled: these run from a signal handler, where malloc,
// iostreams and std::string are all forbidden. Truncation is silent by design --
// a short record beats no record.
//
// TWO appenders, not one, and the distinction is load-bearing: putRaw writes the
// record's STRUCTURE (the quotes and braces that make it JSON) and putEsc writes
// the VALUES that go inside them (an id, an exception's what()). Passing
// structure through the escaper turns every quote into \" and the record stops
// being JSON at all -- caught here by the gate, which is what a gate is for.
inline void putRaw(char* b, std::size_t cap, std::size_t* n, const char* s) {
    if (!s) return;
    for (; *s && *n + 2 < cap; ++s) b[(*n)++] = *s;
}
inline void putEsc(char* b, std::size_t cap, std::size_t* n, const char* s) {
    if (!s) return;
    for (; *s && *n + 8 < cap; ++s) {
        const unsigned char c = static_cast<unsigned char>(*s);
        if (c == '"' || c == '\\') { b[(*n)++] = '\\'; b[(*n)++] = static_cast<char>(c); }
        else if (c >= 0x20)        { b[(*n)++] = static_cast<char>(c); }
        else                       { b[(*n)++] = ' '; }
    }
}
inline void putLong(char* b, std::size_t cap, std::size_t* n, long v) {
    char tmp[24];
    int k = 0;
    const bool neg = v < 0;
    unsigned long u = neg ? static_cast<unsigned long>(-(v + 1)) + 1ul
                          : static_cast<unsigned long>(v);
    do { tmp[k++] = static_cast<char>('0' + (u % 10ul)); u /= 10ul; } while (u && k < 20);
    if (neg && *n + 1 < cap) b[(*n)++] = '-';
    while (k-- > 0 && *n + 1 < cap) b[(*n)++] = tmp[k];
}

// One instrument record on stdout (where the caller reads records) AND one human
// line on stderr (which is where a dying child's last words are read from).
inline void emitInstrument(const char* kind, const char* detail, bool afterAnswer) {
    char b[kInstrCap];
    std::size_t n = 0;
    putRaw(b, sizeof b, &n, "{\"id\":\"");
    putEsc(b, sizeof b, &n, g_rowId);
    putRaw(b, sizeof b, &n, "\",\"ok\":false,\"instrument\":\"");
    putEsc(b, sizeof b, &n, kind);
    putRaw(b, sizeof b, &n, "\",\"rowIndex\":");
    putLong(b, sizeof b, &n, g_rowIndex);
    putRaw(b, sizeof b, &n, ",\"pid\":");
    putLong(b, sizeof b, &n, static_cast<long>(::getpid()));
    // `afterAnswer` means the row HAD already been measured and the process died
    // afterwards. The record exists so the crash still reconciles, and the flag
    // exists so the caller does not overwrite a good measurement with it.
    putRaw(b, sizeof b, &n, afterAnswer ? ",\"afterAnswer\":true" : ",\"afterAnswer\":false");
    putRaw(b, sizeof b, &n, ",\"error\":\"INSTRUMENT: ");
    putEsc(b, sizeof b, &n, detail);
    putRaw(b, sizeof b, &n, "\"}\n");
    const ssize_t w1 = ::write(STDOUT_FILENO, b, n);
    (void)w1;

    char e[kInstrCap];
    std::size_t m = 0;
    putRaw(e, sizeof e, &m, "forge_verify: INSTRUMENT ");
    putRaw(e, sizeof e, &m, kind);
    putRaw(e, sizeof e, &m, " on row ");
    putRaw(e, sizeof e, &m, g_rowId[0] ? g_rowId : "(id not yet read)");
    putRaw(e, sizeof e, &m, ": ");
    putRaw(e, sizeof e, &m, detail);
    putRaw(e, sizeof e, &m, "\n");
    const ssize_t w2 = ::write(STDERR_FILENO, e, m);
    (void)w2;

    // This row has now been accounted for. EXACTLY ONE record per row is the
    // whole guarantee: without this the row-end check below would emit a second.
    g_rowAnswered = 1;
}

inline void beginRow(long index) {
    g_rowId[0] = '\0';
    g_rowIndex = index;
    g_rowAnswered = 0;
}
inline void setRowId(const std::string& id) {
    const std::size_t k = id.size() < sizeof(g_rowId) - 1 ? id.size() : sizeof(g_rowId) - 1;
    std::memcpy(g_rowId, id.data(), k);
    g_rowId[k] = '\0';
}
// Every place the tool emits a real record goes through this, so "did this row
// answer?" is a fact rather than an assumption.
inline void emitRow(const std::string& json) {
    std::cout << json << "\n" << std::flush;
    g_rowAnswered = 1;
}

// The type of whatever is being thrown, demangled, without needing to have heard
// of it. Standard_ConstructionError is exactly such a type here: forge_verify
// links the kernel but deliberately holds no OCCT headers of its own.
inline const char* currentExceptionTypeName(char* out, std::size_t cap) {
    out[0] = '\0';
    const std::type_info* t = abi::__cxa_current_exception_type();
    if (!t) return "unknown-exception";
    int status = 0;
    char* dem = abi::__cxa_demangle(t->name(), nullptr, nullptr, &status);
    const char* src = (status == 0 && dem) ? dem : t->name();
    std::size_t k = std::strlen(src);
    if (k > cap - 1) k = cap - 1;
    std::memcpy(out, src, k);
    out[k] = '\0';
    if (dem) std::free(dem);
    return out;
}

// std::terminate: the LAST point at which this process is still itself. Reached
// when an exception found no handler anywhere -- which is precisely how the
// 2026-09-01 aborts happened -- and the only place the exception is still
// readable.
inline void onTerminate() {
    if (!g_dying) {
        g_dying = 1;
        char detail[1024];
        char ty[512];
        detail[0] = '\0';
        currentExceptionTypeName(ty, sizeof ty);
        std::snprintf(detail, sizeof detail, "verifier aborted: uncaught %s", ty);
        if (std::current_exception()) {
            try {
                std::rethrow_exception(std::current_exception());
            } catch (const std::exception& e) {
                std::snprintf(detail, sizeof detail, "verifier aborted: uncaught %s: %s",
                              ty, e.what());
            } catch (...) {
                // Not a std::exception (an OCCT raise is exactly this case). The
                // TYPE is still recorded above, which is the fact that was lost.
            }
        }
        emitInstrument("verifier_aborted", detail, g_rowAnswered != 0);
    }
    if (g_prevTerminate) g_prevTerminate();
    std::abort();     // keep the crash report: it is half of the reconciliation
}

inline const char* signalName(int sig) {
    switch (sig) {
        case SIGABRT: return "SIGABRT";
        case SIGSEGV: return "SIGSEGV";
        case SIGBUS:  return "SIGBUS";
        case SIGILL:  return "SIGILL";
        case SIGFPE:  return "SIGFPE";
        default:      return "fatal signal";
    }
}

// A crash that is NOT an exception (a segfault has no what() to lose, but it has
// a row) still names its row. Re-raised with the default handler afterwards, so
// the OS crash report is still written and the counts still reconcile.
inline void onFatalSignal(int sig) {
    if (!g_dying) {
        g_dying = 1;
        emitInstrument("verifier_signal", signalName(sig), g_rowAnswered != 0);
    }
    std::signal(sig, SIG_DFL);
    std::raise(sig);
}

// --- fault injection, so the crash paths above are PROVEN, not asserted ------
// A GATE THAT NEVER FIRES IS NOT A GATE. The 2026-09-01 abort ran unnoticed for
// a whole 600-row run precisely because nothing ever exercised the path it died
// on, and every downstream count was then quietly wrong. These hooks let
// test/forge_verify_instrument_gate.sh drive each handler for real, against this
// binary, and check that a record comes out. Inert unless FORGE_VERIFY_FAULT is
// set; FORGE_VERIFY_FAULT_ID narrows it to one row of a batch.
struct InjectedFault {};   // NOT a std::exception — exactly like an OCCT raise
// Terminate with a LIVE exception in flight — the same state an uncaught throw
// leaves, which is what makes onTerminate able to name the type at all.
inline void injectUncaught() {
    try { throw InjectedFault{}; } catch (...) { std::terminate(); }
}

inline void maybeInjectFault(const std::string& id) {
    const char* f = std::getenv("FORGE_VERIFY_FAULT");
    if (!f || !*f) return;
    const char* only = std::getenv("FORGE_VERIFY_FAULT_ID");
    if (only && *only && id != only) return;
    if (std::strcmp(f, "terminate") == 0) injectUncaught();               // -> onTerminate
    if (std::strcmp(f, "nonstd") == 0)    throw InjectedFault{};          // -> catch (...)
    if (std::strcmp(f, "throw") == 0)     throw std::runtime_error("injected std::exception");
    if (std::strcmp(f, "segv") == 0)      std::raise(SIGSEGV);            // -> onFatalSignal
}

inline void installInstrumentHandlers() {
    g_prevTerminate = std::set_terminate(onTerminate);
    std::signal(SIGSEGV, onFatalSignal);
    std::signal(SIGBUS, onFatalSignal);
    std::signal(SIGILL, onFatalSignal);
    std::signal(SIGFPE, onFatalSignal);
    std::signal(SIGABRT, onFatalSignal);
}

}  // namespace instrument
}  // namespace forge
