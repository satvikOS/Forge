#pragma once

// GcodePost (Forge-13) — text post-processor that turns a Toolpath into a
// dialect-flavoured G-code string.
//
// We support four dialects out of the gate:
//   * Fanuc    — most "neutral" 3-axis interpretation. Default reference.
//   * Haas     — Fanuc-derived with Haas-specific spindle/M-codes.
//   * LinuxCNC — Fanuc compatible plus % program-wrapper sentinels.
//   * Grbl     — minimal hobbyist controller; we strip workplane select
//                and tool-change codes Grbl ignores, and skip coolant
//                M-codes that are usually wired to user pins.
//
// The output is intentionally human-readable: G0/G1 are spelled G00/G01,
// every cutting move emits an F-word on the first move and again whenever
// the rate changes. Header lines (G17 G21 G90 G54) appear at the top so
// callers can search-grep `G17 G21` as a sanity check on dialect dispatch.

#include "forge/Cam.hpp"

#include <string>

namespace forge::cam::gcode {

enum Dialect {
    Fanuc    = 0,
    Haas     = 1,
    LinuxCNC = 2,
    Grbl     = 3,
};

// Render the toolpath as a G-code program. `safeZ` is the absolute Z
// position used for true rapids between operations (we still preserve
// the per-move Z in the geometry; safeZ is the staging height between
// retract and next-XY-rapid sequences).
//
// Throws std::invalid_argument for unknown dialects.
std::string toGcode(const Toolpath& tp, Dialect dialect, double safeZ);

} // namespace forge::cam::gcode
