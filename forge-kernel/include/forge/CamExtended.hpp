#pragma once

// PUSH-10 — Extended CAM (forge::camx)
//
// A self-contained, geometry-only CAM module sitting next to forge::cam and
// forge::cam::gcode. It provides:
//   1. A built-in 6-entry tool catalogue (mixed end mills, ball mills, drill,
//      face mill, spot drill).
//   2. A 2.5-axis pocket toolpath generator that consumes a planar boundary
//      polygon (outer + island holes) and returns concentric offset rings
//      stacked over multiple Z stepdowns.
//   3. A contour (profile) toolpath generator with inside/outside/on sides.
//   4. Drill cycles: G81 (spot) and G83 (peck) emitted as a vector of point
//      sequences per hole.
//   5. ASCII G-code post-processors for three dialects (Fanuc, Heidenhain,
//      Siemens). Each emitter takes the same vector-of-paths input plus a
//      spindle RPM and feed.
//   6. Cycle-time estimation: total travel length (mm) + cycle time (s).
//
// No external dependencies — only <string>, <vector>, <cstdint>. All geometry
// math is inlined.

#include <cstdint>
#include <string>
#include <vector>

// PUSH-10 — use C++17-style nested namespaces so this header compiles
// regardless of whether the upstream tree is built at C++17 or later.
namespace forge { namespace camx {

// ---------------------------------------------------------- Tool catalogue
//
// Tools are pure POD; the catalogue is the canonical fixed source so callers
// can switch to a JSON-loader later without touching downstream code.
enum ToolType {
    ToolType_EndMill   = 0,
    ToolType_BallMill  = 1,
    ToolType_Drill     = 2,
    ToolType_FaceMill  = 3,
    ToolType_SpotDrill = 4,
};

struct Tool {
    std::uint32_t id;
    ToolType      type;
    double        diameter;       // mm
    double        fluteLength;    // mm
    double        totalLength;    // mm
    int           flutes;
    std::string   material;       // "carbide" | "HSS"
    double        maxRPM;         // rev/min
    double        feedPerTooth;   // mm/tooth (chip load)
};

// Returns the 6-entry built-in catalogue (always the same order).
std::vector<Tool> listTools();

// Resolve a tool by id; throws std::out_of_range on miss.
Tool toolById(std::uint32_t id);

// ---------------------------------------------------------- Geometry
struct Pt2 { double x; double y; };
struct Pt3 { double x; double y; double z; };

// A closed polygon is a vector<Pt2> where the last vertex implicitly closes
// back to the first. A boundary-with-holes is vector<vector<Pt2>> where
// [0] is the outer polygon and [1..] are island holes.
using Polygon  = std::vector<Pt2>;
using Boundary = std::vector<Polygon>;
using Polyline3 = std::vector<Pt3>;

// ---------------------------------------------------------- Pocket / contour
struct PocketParams {
    double depth;       // mm — total Z descent, positive
    double stepdown;    // mm — per-pass depth, positive
    double stepover;    // mm — lateral pass overlap, positive
    bool   climb;       // true = climb milling, false = conventional
};

struct ContourParams {
    double depth;
    double stepdown;
    bool   climb;
};

enum ContourSide {
    ContourSide_Inside  = 0,
    ContourSide_Outside = 1,
    ContourSide_On      = 2,
};

enum DrillCycle {
    DrillCycle_G81 = 0,   // spot drill (rapid → feed to depth → rapid retract)
    DrillCycle_G83 = 1,   // peck drill (incremental peck with retract)
};

struct DrillParams {
    double depth;        // mm — total descent below Z=0, positive
    double retract;      // mm — rapid retract Z above part, positive
    double peck;         // mm — per-peck increment for G83 (ignored for G81)
};

// 2.5-axis pocket: returns a vector of polylines, one per pass. Each polyline
// contains absolute (x,y,z) points the controller should sequence. Multiple
// Z-levels are emitted; concentric offset rings shrink inward until the
// remaining area is too small to fit another stepover ring.
std::vector<Polyline3> pocketToolpath(const Boundary& boundary,
                                      std::uint32_t toolId,
                                      const PocketParams& params);

// Contour (profile) toolpath: offsets the polyline by ±r (inside/outside) or
// keeps it as-is (on), then stacks the offset polyline over each Z depth.
std::vector<Polyline3> contourToolpath(const Polygon& polyline,
                                       std::uint32_t toolId,
                                       ContourSide side,
                                       const ContourParams& params);

// Drill cycle: returns one polyline per hole, each containing the rapid
// approach, plunge, peck, and retract moves.
std::vector<Polyline3> drillToolpath(const std::vector<Pt2>& holes,
                                     std::uint32_t toolId,
                                     DrillCycle cycle,
                                     const DrillParams& params);

// ---------------------------------------------------------- Post-processors
enum PostFlavour {
    Post_Fanuc      = 0,
    Post_Heidenhain = 1,
    Post_Siemens    = 2,
};

struct PostParams {
    double spindleRPM;
    double feed;       // mm/min — used for all cutting moves
    double safeZ;      // mm — Z height used for rapids between segments
    std::uint32_t toolId;
};

// Convert a list of toolpath segments to ASCII G-code in the selected dialect.
// Each segment is one polyline (e.g. from pocketToolpath()). Moves within a
// segment are emitted as cuts; the post-processor inserts rapid retracts +
// rapid traverses between segments.
std::string postProcess(const std::vector<Polyline3>& segments,
                        PostFlavour post,
                        const PostParams& params);

// ---------------------------------------------------------- Cycle time
struct CycleTime {
    double totalLengthMm;
    double timeSec;
};

// Estimate cycle time: sums the polyline lengths and divides by feedrate.
// `feedMmMin` is the cutting feedrate; rapids and retracts are not modelled
// (this is a conservative estimate of cutting-only time).
CycleTime estimateCycleTime(const std::vector<Polyline3>& segments,
                            double feedMmMin);

}}  // namespace forge::camx
