#pragma once

// CamAdvanced (Forge-33) — closes out the §6 Manufacturing parity gap.
//
// Forge-13 shipped the four 2.5D operations (profile / pocket / drill /
// faceMill) plus the Fanuc/Haas/LinuxCNC/Grbl post. This module adds the
// "deep CAM" rows the incumbent MCAD vendors ship:
//
//   * adaptiveClear3Axis — 3-axis adaptive (engagement-arc-modulated)
//     roughing. Walks z-levels top→bottom, and at each level traces an
//     inverse-offset spiral whose cutting feedrate is scaled down in tight
//     pockets (small local radius ⇒ higher engagement ⇒ lower feed).
//
//   * multiAxisIndexed — 3+2 / 4+1 / 5-axis-indexed. Given a list of
//     (A,B,C) orientation triples, run the standard profile/pocket toolpath
//     in each rotated frame and concatenate the sub-paths with safe-Z
//     rapids between indexings.
//
//   * multiAxisContinuous — 5-axis continuous. The caller supplies a
//     sketched surface path (sequence of {x,y,z, nx,ny,nz} stations). For
//     each station we derive the tool axis from the local surface normal
//     and emit a Move carrying the optional (a,b,c) orientation triple.
//
//   * simulateStock — voxel stock simulation. Discretises the stock AABB
//     into a uniform grid (cap at 50³ — coarse but cheap; documented
//     tradeoff) and sweeps the tool envelope along the toolpath to
//     subtract material. Returns the remaining volume, a 16-bin residue-
//     thickness histogram, the maximum cut depth and a collision count
//     (proxy = voxels removed below the stock's bottom face).
//
//   * generateCmm — coordinate-measuring-machine inspection program. For
//     each requested feature (plane / cylinder / point) we pick a
//     representative set of measurement points using a stepover gauge,
//     and emit a DMIS / I++ DME-flavoured probe-path program (one entry
//     per probe touch). Returns both the structured probe path and the
//     formatted text — callers can either inspect the points programmatic
//     -ally or stream the text to a CMM controller.
//
// Move struct extension: the Move struct in Cam.hpp does NOT carry tool-
// orientation. Rather than break the binary layout, multiAxisContinuous
// emits a parallel `axisOrientations` vector of (a,b,c) triples sized to
// `moves.size()` (with NaN for moves that don't carry an indexed pose,
// e.g. safe-Z rapids between stations). The packToolpath binding flattens
// both vectors into the JS Float32Array.

#include "forge/Cam.hpp"
#include "forge/ShapeRegistry.hpp"

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::cam {

// ---------------------------------------------------------- stock AABB
struct StockAABB {
    double minX, minY, minZ;
    double maxX, maxY, maxZ;
};

// ---------------------------------------------------------- adaptive
struct AdaptiveParams {
    double stepover;   // mm — nominal radial engagement
    double zMax;       // mm — top of stock (start cutting at this Z)
    double zMin;       // mm — bottom of clear pass
    double helixAngle; // degrees — helix ramp angle for the entry
    double minRadius;  // mm — minimum local radius of curvature; below this
                       // we cap the engagement and modulate the feedrate
};

Toolpath adaptiveClear3Axis(ShapeHandle shape,
                            const StockAABB& stock,
                            const Tool& tool,
                            const CuttingParams& params,
                            const AdaptiveParams& adaptive);

// ---------------------------------------------------------- multi-axis
//
// Orientation triple = (A, B, C) in DEGREES. The kernel rotates the shape
// to the canonical Z-up CAM frame for each orientation (A about X, then
// B about Y, then C about Z), runs the chosen 2.5D op (profile or pocket
// based on `mode`), then composes the moves with a safe-Z transit between
// orientations. The output toolpath is a single Toolpath whose Move
// stream contains every sub-orientation back-to-back.
struct OrientedToolpath {
    std::array<double, 3> abc; // (A, B, C) degrees
    std::size_t           startMove; // index into Toolpath.moves where this
                                     // orientation's moves begin.
};

Toolpath multiAxisIndexed(ShapeHandle shape,
                          const Tool& tool,
                          const CuttingParams& params,
                          const std::vector<std::array<double, 3>>& orientations,
                          double zTop, double zBottom,
                          std::vector<OrientedToolpath>* perOrient = nullptr);

// ---------------------------------------------------------- continuous 5-axis
//
// SurfaceStation is one waypoint on the swarf / surface path. (nx,ny,nz)
// is the unit surface normal at that station; the tool axis is taken as
// (nx,ny,nz). We then convert that to (A,B,C) Euler angles in degrees and
// stash the triple in `axisOrientations[i]`.
struct SurfaceStation {
    double x, y, z;
    double nx, ny, nz;
};

struct ContinuousToolpath {
    Toolpath                            tp;
    std::vector<std::array<double, 3>>  axisOrientations; // size == tp.moves.size()
};

ContinuousToolpath multiAxisContinuous(ShapeHandle shape,
                                       const Tool& tool,
                                       const CuttingParams& params,
                                       const std::vector<SurfaceStation>& path);

// ---------------------------------------------------------- stock sim
struct StockSimReport {
    double              remainingVolume;     // mm³
    double              initialVolume;       // mm³
    double              maxCutDepth;         // mm — deepest voxel removed
    std::uint32_t       collisionCount;      // voxels removed below stock.minZ
    std::array<double, 16> residueDistribution; // histogram of residue depth
                                                // (16 bins, normalised 0..1)
    std::uint32_t       gridResolution;      // N for the N³ grid actually used
};

StockSimReport simulateStock(const StockAABB& stock,
                             const Toolpath& tp,
                             const Tool& tool,
                             std::uint32_t gridResolution = 50);

// ---------------------------------------------------------- CMM
enum class InspectionFeatureKind {
    Plane,
    Cylinder,
    Point
};

// `topo` is a planar face id for Plane, a cylindrical face id for Cylinder,
// and any face id for Point (we sample its centroid). When the face id is
// not resolvable we fall back to the shape's overall bbox-derived
// representative point.
struct InspectionFeature {
    InspectionFeatureKind kind;
    std::uint32_t         topo;
    std::string           label;
};

struct CmmGauge {
    double stepover;    // mm — distance between probe points on a face
    double probeRadius; // mm — stylus tip radius
};

struct CmmProbePoint {
    double x, y, z;        // probe approach point
    double nx, ny, nz;     // surface inward normal at touch
    std::string featureLabel;
};

struct CmmProgram {
    std::vector<CmmProbePoint> points;
    std::string                text; // DMIS / I++ DME flavoured listing
    std::vector<std::uint32_t> pointsPerFeature;
};

CmmProgram generateCmm(ShapeHandle shape,
                       const std::vector<InspectionFeature>& features,
                       const CmmGauge& gauge);

} // namespace forge::cam
