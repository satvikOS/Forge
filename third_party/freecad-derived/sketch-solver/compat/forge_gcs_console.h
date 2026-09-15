// SPDX-License-Identifier: LGPL-2.1-or-later
//
// Part of libforge_gcs, a modified version of FreeCAD's planegcs solver.
// Written for Forge on 2026-09-15 to stand in for the two FreeCAD runtime
// services planegcs/GCS.cpp reaches for, which live outside the planegcs subtree
// (FreeCAD's src/Base/Console.h and FCConfig.h). See ../MODIFICATIONS.md.
//
//   Base::Console().log / .warning   solver diagnostics. Forwarded to the sink a
//                                    host installs with forge_gcs_set_log_sink();
//                                    with no sink installed they are discarded.
//   Base::TimeElapsed                wall-clock timing around the QR steps, on
//                                    std::chrono::steady_clock.
//
// Included only by planegcs/GCS.cpp.
#pragma once

#include <chrono>
#include <cstdarg>

namespace forge_gcs_detail {
// Defined in src/forge_gcs.cpp. level: 0 = log, 1 = warning.
void emitv(int level, const char* fmt, std::va_list args);
}  // namespace forge_gcs_detail

namespace Base {

class ConsoleSingleton {
public:
    void log(const char* fmt, ...)
    {
        std::va_list args;
        va_start(args, fmt);
        forge_gcs_detail::emitv(0, fmt, args);
        va_end(args);
    }
    void warning(const char* fmt, ...)
    {
        std::va_list args;
        va_start(args, fmt);
        forge_gcs_detail::emitv(1, fmt, args);
        va_end(args);
    }
};

inline ConsoleSingleton& Console()
{
    static ConsoleSingleton console;
    return console;
}

class TimeElapsed {
public:
    TimeElapsed() : t_(std::chrono::steady_clock::now()) {}
    static double diffTimeF(const TimeElapsed& start, const TimeElapsed& end)
    {
        return std::chrono::duration<double>(end.t_ - start.t_).count();
    }

private:
    std::chrono::steady_clock::time_point t_;
};

}  // namespace Base
