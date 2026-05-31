// GcodePost.cpp (Forge-13) — Toolpath → G-code text emitter.
//
// Output format per dialect:
//
//   Fanuc (default 3-axis ISO):
//      ( header )                  → comment block with toolId / cycle time
//      G17 G21 G90 G54             → XY plane / metric / abs / wcs1
//      G00 Z<safeZ>                → rapid to safe Z
//      G00 X.. Y..                 → rapid to first XY
//      G01 Z.. F<feedZ>            → plunge
//      G01 X.. Y.. (Z..) F<feedXY> → cutting moves (F only on rate change)
//      G00 Z<safeZ>                → final retract
//      M30                         → program end + rewind
//
//   Haas: Fanuc plus M19 (spindle stop oriented) at program end before M30.
//   LinuxCNC: Fanuc wrapped in % … % program sentinels.
//   Grbl: minimal — skip G54 (Grbl uses G54 implicitly), no tool-change M-codes.
//
// Numbers are printed with %.4f. F-words are printed with %.1f.

#include "forge/GcodePost.hpp"

#include <cstdio>
#include <cmath>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace forge::cam::gcode {

namespace {

inline std::string fmt(double v) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.4f", v);
    return buf;
}
inline std::string fmtF(double v) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%.1f", v);
    return buf;
}

void emitHeader(std::ostringstream& os, const Toolpath& tp, Dialect d) {
    char tc[128];
    std::snprintf(tc, sizeof(tc),
                  "( forge-cam toolId=%u moves=%zu cycle=%.2fs cutMm=%.2f )\n",
                  tp.toolId, tp.moves.size(), tp.cycleTimeSec, tp.estCuttingMm);
    os << tc;

    switch (d) {
        case LinuxCNC: os << "%\n"; break;
        case Grbl:     /* Grbl has no header sentinels */ break;
        case Haas:     os << "( Haas )\n"; break;
        case Fanuc:    os << "( Fanuc )\n"; break;
        default: break;
    }

    if (d == Grbl) {
        // Minimal prologue — Grbl ignores most of the Fanuc setup words.
        os << "G17 G21 G90\n";
    } else {
        os << "G17 G21 G90 G54\n";
    }
}

void emitFooter(std::ostringstream& os, Dialect d, double safeZ) {
    // Lift to safe Z then end.
    os << "G00 Z" << fmt(safeZ) << "\n";
    if (d == Haas) {
        // Oriented spindle stop before program end (Haas convention).
        os << "M19\n";
    }
    os << "M30\n";
    if (d == LinuxCNC) os << "%\n";
}

} // namespace

std::string toGcode(const Toolpath& tp, Dialect dialect, double safeZ) {
    if (dialect < 0 || dialect > 3) {
        throw std::invalid_argument("forge.cam.gcode: unknown dialect");
    }

    std::ostringstream os;
    emitHeader(os, tp, dialect);

    // Initial rapid to safe Z.
    os << "G00 Z" << fmt(safeZ) << "\n";

    double lastFeed = -1.0;
    bool   first    = true;
    for (const auto& m : tp.moves) {
        if (first) {
            // First move: rapid to its XY at safe Z, then if it's a cut go
            // down. This avoids assuming the machine starts at the first
            // move's XYZ.
            os << "G00 X" << fmt(m.x) << " Y" << fmt(m.y) << "\n";
            if (m.cutting) {
                os << "G01 Z" << fmt(m.z) << " F" << fmtF(m.feedrate) << "\n";
                lastFeed = m.feedrate;
            } else {
                os << "G00 Z" << fmt(m.z) << "\n";
            }
            first = false;
            continue;
        }

        if (m.cutting) {
            if (std::abs(m.feedrate - lastFeed) > 1e-3) {
                os << "G01 X" << fmt(m.x) << " Y" << fmt(m.y)
                   << " Z" << fmt(m.z) << " F" << fmtF(m.feedrate) << "\n";
                lastFeed = m.feedrate;
            } else {
                os << "G01 X" << fmt(m.x) << " Y" << fmt(m.y)
                   << " Z" << fmt(m.z) << "\n";
            }
        } else {
            os << "G00 X" << fmt(m.x) << " Y" << fmt(m.y) << " Z" << fmt(m.z) << "\n";
        }
    }

    emitFooter(os, dialect, safeZ);
    return os.str();
}

} // namespace forge::cam::gcode
