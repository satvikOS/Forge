#pragma once

// Cam (Forge-13) — 2.5D CAM toolpath generation.
//
// 2.5D operations operate on a planar 3D BREP body: a "face" picks a flat
// boundary, an explicit Z-range governs depth-stepping, and the resulting
// Toolpath is a Z-stratified 3D polyline that an inverse-kinematics post can
// emit as G-code. The native side computes geometry only; G-code formatting
// lives in `forge::cam::gcode` (see GcodePost.hpp).
//
// Operations are deterministic functions of (shape, face, tool, params).
// We do not yet model cutting load (engagement-arc feed compensation) — that
// is a follow-up slice. For now all "cutting" moves use a constant feedrate
// drawn from CuttingParams (XY feed for lateral moves, Z feed for plunges).
//
// Face addressing: OCCT subshape IDs are not stable across kernel rebuilds,
// so a "faceId" argument of 0xFFFFFFFF (UINT32_MAX) means "auto-pick the
// first planar face whose surface normal points along +Z". This makes the
// API resilient to BREP-id drift while still allowing callers that have
// resolved a stable face id (e.g. via top-down topology iteration in JS)
// to address it explicitly.

#include "forge/ShapeRegistry.hpp"

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::cam {

// ---------------------------------------------------------- tool catalogue
//
// A Tool is purely descriptive — geometry + spindle/flute count + label.
// It does not own any kernel state; callers may discard / recreate the
// struct freely.
struct Tool {
    enum Type { EndMill, BallNose, Drill, Chamfer };

    std::uint32_t id;        // user-assigned (catalogue key)
    std::string   name;
    double        diameter;  // mm — outer cutting diameter
    double        fluteLength; // mm — usable Z stick-out
    double        helix;     // degrees — flute helix angle
    int           flutes;    // count
    Type          type;
};

// ---------------------------------------------------------- cutting params
//
// Cutting parameters describe how the tool engages material. Feeds in
// mm / min, RPM in rev/min. `stepover` and `stepdown` are mm (lateral and
// per-Z-pass depth respectively). `coolant` is 0..1, intended to drive an
// M-code in the post (0 = off, 1 = flood, intermediate = mist).
struct CuttingParams {
    double feedXY;      // mm/min — lateral cutting feedrate
    double feedZ;       // mm/min — Z plunge feedrate
    double spindleRPM;  // rev/min
    double stepover;    // mm — lateral pass overlap (for pocket / face mill)
    double stepdown;    // mm — Z-pass depth (positive)
    double coolant;     // 0..1
};

// ---------------------------------------------------------- toolpath
//
// A Move is one G0/G1 segment endpoint plus a flag that marks whether the
// tool is engaged (cutting = true) or repositioning (rapids / plunge /
// retract). Feedrate is per-move so the post can emit fresh F-words only
// where the rate changes — but the geometric simulator can also use the
// per-move rate directly.
struct Move {
    double x;
    double y;
    double z;
    bool   cutting;
    double feedrate; // mm/min
};

struct Toolpath {
    std::uint32_t          toolId;
    std::vector<Move>      moves;
    double                 cycleTimeSec; // estimated total dwell + traverse
    double                 estCuttingMm; // sum of cutting-arc lengths only
};

// Auto-pick sentinel. When passed as faceId, the operation searches the
// shape's faces and selects the first planar one whose normal points
// along +Z (within a small tolerance). If none exists, the operation
// throws std::runtime_error.
constexpr std::uint32_t kAutoFaceId = 0xFFFFFFFFu;

// ---------------------------------------------------------- operations
//
// profile  — trace the outer wire of the face, offset inward by toolRadius,
//            stepping from zTop down to zBottom by stepdown.
// pocket   — like profile but additionally rasters (zigzag) inside the
//            offset boundary at each Z level.
// drill    — punch each XY hole straight down. With `peck` true, retract
//            after each stepdown.
// faceMill — zigzag pattern across the face's XY bbox at a single Z
//            (zTop − depth).
//
// All operations clamp zTop > zBottom (descending). `leadIn` (profile only)
// is the lateral lead-in distance for a tangential entry — 0 for a plunge
// entry.

Toolpath profile(ShapeHandle shape, std::uint32_t faceId,
                 const Tool& tool, const CuttingParams& params,
                 double zTop, double zBottom, double leadIn);

Toolpath pocket(ShapeHandle shape, std::uint32_t faceId,
                const Tool& tool, const CuttingParams& params,
                double zTop, double zBottom);

Toolpath drill(ShapeHandle shape,
               const std::vector<std::array<double, 3>>& holes,
               const Tool& bit, const CuttingParams& params,
               double zTop, double zBottom, bool peck);

Toolpath faceMill(ShapeHandle shape, std::uint32_t faceId,
                  const Tool& tool, const CuttingParams& params,
                  double zTop, double depth);

} // namespace forge::cam
