// SPDX-License-Identifier: LGPL-2.1-or-later
//
// forge_planegcs_stub.h — Forge-local stand-ins for the FreeCAD-internal
// runtime helpers that the vendored planegcs code reaches for.
//
// Upstream planegcs calls into:
//   - Base::Console().log(fmt, ...) / .warning(fmt, ...) for verbose solver
//     diagnostics. We funnel all of that to stderr behind a single global
//     verbosity flag that defaults to off — the solver is silent in
//     production, matching the rest of forge_kernel.
//   - Base::TimeElapsed for sub-second timing of QR decompositions. We
//     substitute std::chrono::steady_clock; the diffTimeF method returns
//     seconds-as-double, same shape as the FreeCAD helper.
//
// This header is included ONLY by the vendored planegcs *.cpp files (see
// the "// Forge vendoring" comment in GCS.cpp). The forge::Sketcher wrapper
// does NOT pull this in.

#pragma once

#include <chrono>
#include <cstdarg>
#include <cstdio>

namespace Base {

class ConsoleSingleton {
public:
    // planegcs only uses fmt-style strings; we forward to vfprintf.
    void log(const char* fmt, ...) {
        if (!verbose) return;
        std::va_list args; va_start(args, fmt);
        std::vfprintf(stderr, fmt, args);
        va_end(args);
    }
    void warning(const char* fmt, ...) {
        if (!verbose) return;
        std::va_list args; va_start(args, fmt);
        std::fputs("[planegcs/warn] ", stderr);
        std::vfprintf(stderr, fmt, args);
        va_end(args);
    }
    bool verbose = false;
};

// The free function `Base::Console()` is how FreeCAD exposes the singleton.
inline ConsoleSingleton& Console() {
    static ConsoleSingleton c;
    return c;
}

// TimeElapsed — default-constructs to "now", diffTimeF returns seconds.
class TimeElapsed {
public:
    using Clock = std::chrono::steady_clock;
    TimeElapsed() : t(Clock::now()) {}
    Clock::time_point t;
    static double diffTimeF(const TimeElapsed& a, const TimeElapsed& b) {
        std::chrono::duration<double> d = b.t - a.t;
        return d.count();
    }
};

}  // namespace Base
