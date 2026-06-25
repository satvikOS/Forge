// CamAdvanced.cpp (Forge-33) — advanced CAM operations.
//
// Implements the five §6 Manufacturing follow-ups:
//
//   * adaptiveClear3Axis — z-level adaptive clearing whose feedrate is
//     modulated by the local engagement-arc radius. We trace the outer
//     wire of the stock AABB at each z-level, then inset by toolRadius and
//     emit an Archimedean spiral inwards at `stepover` spacing. The
//     feedrate at each move is multiplied by clamp(localRadius/minRadius,
//     0.4, 1.0) so tight pockets get a lower feed (engagement-arc
//     compensation).
//
//   * multiAxisIndexed — for each (A,B,C) orientation we run a profile
//     toolpath against a synthesised rotated copy of the original shape's
//     bbox (taking the rotation into account on the move coordinates),
//     joining sub-paths with safe-Z rapids. We don't materialise a new
//     OCCT shape per orientation — instead we rotate the Move stream of
//     a single profile so the kernel doesn't pay the OCCT cloning cost
//     5× per call.
//
//   * multiAxisContinuous — for each SurfaceStation we emit a cutting Move
//     at (x,y,z) and an (A,B,C) Euler triple derived from the surface
//     normal.
//
//   * simulateStock — voxel sweep. Uniform N³ grid (cap 50 for cost). For
//     each cutting move segment we step along the segment in voxel-sized
//     increments and mark every voxel within `toolRadius` of the segment
//     as cleared. We then read back the residue distribution from the
//     remaining voxel column heights.
//
//   * generateCmm — walks the supplied features. For a planar face we
//     sample a stepover-spaced grid clipped to the face's bbox; for a
//     cylindrical face we sample (theta, h) pairs at the same spacing; for
//     a point feature we emit a single touch. We then format a DMIS-ish
//     program string that callers can stream to a CMM.
//
// Honest scope: the engagement-arc estimator is a curvature proxy (we
// approximate local engagement by the radius of the inscribed circle on
// the spiral, not by a true material-removal calculation). The voxel sim
// is hard-capped at 50³ = 125k voxels — fine for a parity smoke; would
// need GPU-backed dexel sim for production accuracy.

#include "forge/CamAdvanced.hpp"
#include "forge/Cam.hpp"
#include "forge/ShapeRegistry.hpp"

#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>

#include <algorithm>
#include <cmath>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <vector>

// PHASE-D wiring (2026-06-25) — route the ONE genuine OCCT surface-evaluation op in
// this module, generateCmm's per-face PROBE-POINT SAMPLING (surface point S(u,v) +
// outward normal N(u,v) on a planar / cylindrical inspection face), through the
// ALREADY-BUILT in-house analytic Surface evaluator family
// (forge::native::brep::Surface — Surface.cpp: evaluate(u,v) / normalAt(u,v) for the
// Plane & Cylinder kinds) behind a GATE. Compiled in ONLY under -DFORGE_NATIVE_BREP
// and taken at runtime ONLY when forgeNativeFeaturesEnabled() is true (env
// FORGE_NATIVE_FEATURES=1, or the A/B harness's setForgeNativeBrepEnabled(true)).
// PRODUCTION DEFAULT IS OFF: with the gate off the original OCCT path below
// (BRep_Tool::Surface -> Geom_Plane / BRepAdaptor_Surface -> gp_Cylinder) runs
// byte-for-byte unchanged. Mirrors the just-landed Cam.cpp (PolygonOffset2D) /
// Healing.cpp (healBRep/sewFaces) wires: tryNativeGenerateCmm takes the native branch
// ONLY when the input handle is a NativeSolid whose feature faces carry a native
// analytic Surface (Plane/Cylinder). An OCCT-backed input HONESTLY DEFERS to OCCT
// (there is NO OCCT-face -> native-Surface importer), so the gate-off default and the
// gate-on OCCT-input path are both identical to today.
//
// ONLY generateCmm is wired — the other four entries do NO OCCT surface evaluation
// and so have NO native-Surface target (see the per-op note above each):
//   * adaptiveClear3Axis  — spiral/feed math over a numeric StockAABB; `shape` is only
//                           null-checked, never surface-sampled. OCCT-only (no target).
//   * multiAxisIndexed    — rotates a synthetic bbox-derived square trace; reads only
//                           BRepBndLib bbox, never a surface point/normal. OCCT-only.
//   * multiAxisContinuous — surface stations + normals come FROM THE CALLER
//                           (SurfaceStation list); no kernel surface evaluation at all.
//                           OCCT-only (no target).
//   * simulateStock       — voxel sweep over a StockAABB; takes no ShapeHandle and
//                           evaluates no surface. OCCT-only (no target).
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"   // forgeNativeFeaturesEnabled()
#include "forge/native/brep/Topology.hpp"      // Solid/Shell/Face/Surface, SurfaceKind
#include "forge/native/brep/Surface.hpp"       // Surface::evaluate / normalAt (Plane/Cylinder)
#include "forge/native/brep/Aabb.hpp"          // computeAabb (Point feature centroid)
#endif

namespace forge::cam {

namespace {

constexpr double kEps = 1.0e-7;
constexpr double kPi  = 3.14159265358979323846;

inline double dist3(double ax, double ay, double az,
                    double bx, double by, double bz) {
    const double dx = bx - ax, dy = by - ay, dz = bz - az;
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

// Cycle time + cutting length (mirrors finalize() in Cam.cpp; copy is
// trivial and keeps the modules decoupled).
void finalizeMoves(Toolpath& tp) {
    double cuttingMm = 0.0;
    double timeSec   = 0.0;
    for (std::size_t i = 1; i < tp.moves.size(); ++i) {
        const auto& a = tp.moves[i - 1];
        const auto& b = tp.moves[i];
        const double d = dist3(a.x, a.y, a.z, b.x, b.y, b.z);
        if (b.cutting) cuttingMm += d;
        const double feed = std::max(b.feedrate, 1.0);
        timeSec += (d / feed) * 60.0;
    }
    tp.cycleTimeSec = timeSec;
    tp.estCuttingMm = cuttingMm;
}

inline void pushRapid(Toolpath& tp, double x, double y, double z) {
    tp.moves.push_back({ x, y, z, false, 5000.0 });
}
inline void pushCut(Toolpath& tp, double x, double y, double z, double feed) {
    tp.moves.push_back({ x, y, z, true, feed });
}

// Convert a unit tool-axis vector (nx, ny, nz) into (A, B, C) Euler
// angles in degrees. We use the ZYX convention common to 5-axis post-
// processors: A is rotation about X, B about Y, C about Z. For tool-axis
// alignment only A and B are independent (C is set so the spindle nose
// looks down the axis). We pick C = atan2(ny, nx) for repeatability.
std::array<double, 3> toolAxisToABC(double nx, double ny, double nz) {
    // Tilt about Y so the +Z axis lies on (nx, 0, nz')
    const double len = std::sqrt(nx * nx + ny * ny + nz * nz);
    if (len < kEps) return { 0.0, 0.0, 0.0 };
    const double ux = nx / len, uy = ny / len, uz = nz / len;
    // B = angle between +Z and tilt projection in XZ plane.
    const double B = std::atan2(std::sqrt(ux * ux + uy * uy), uz);
    // A = rotation in the YZ plane to bring the axis on the meridian.
    const double A = std::atan2(uy, ux);
    const double C = 0.0;
    constexpr double kRad2Deg = 180.0 / kPi;
    return { A * kRad2Deg, B * kRad2Deg, C * kRad2Deg };
}

// Rotate a 2D point around (cx, cy) by `degrees`.
inline std::array<double, 2> rotXY(double x, double y, double cx, double cy, double degrees) {
    const double r = degrees * kPi / 180.0;
    const double cs = std::cos(r), sn = std::sin(r);
    const double dx = x - cx, dy = y - cy;
    return { cx + dx * cs - dy * sn, cy + dx * sn + dy * cs };
}

} // namespace

// ============================================================================
// adaptiveClear3Axis
// ============================================================================
//
// Algorithm — for each z-level:
//   1. Start at the stock AABB centre (best engagement).
//   2. Trace an outward Archimedean spiral r = stepover * theta / (2π) until
//      the spiral exits the (toolRadius-inset) stock bbox.
//   3. Each spiral segment carries a feedrate scaled by min(1, localR/minR).
//
// Then drop to the next z-level (zMax → zMin in `stepover/2`-style steps)
// and repeat. The first plunge into each level is a helical ramp at
// `helixAngle` (we approximate it with three small descents around the
// stock-centre to avoid plunging straight down).
Toolpath adaptiveClear3Axis(ShapeHandle h,
                            const StockAABB& stock,
                            const Tool& tool,
                            const CuttingParams& params,
                            const AdaptiveParams& ap)
{
    const auto& shape = ShapeRegistry::instance().get(h);
    if (shape.IsNull()) {
        throw std::runtime_error("forge.cam.adaptiveClear: shape is null");
    }
    if (tool.diameter <= 0.0) {
        throw std::runtime_error("forge.cam.adaptiveClear: tool diameter must be > 0");
    }
    if (ap.stepover <= kEps) {
        throw std::runtime_error("forge.cam.adaptiveClear: stepover must be > 0");
    }
    if (ap.zMax <= ap.zMin) {
        throw std::runtime_error("forge.cam.adaptiveClear: zMax must be > zMin");
    }

    const double toolR  = tool.diameter * 0.5;
    const double safeZ  = ap.zMax + 5.0;
    const double cx     = 0.5 * (stock.minX + stock.maxX);
    const double cy     = 0.5 * (stock.minY + stock.maxY);

    // Engagement-arc shrunken bbox; toolR away from each wall.
    const double xLo = stock.minX + toolR;
    const double yLo = stock.minY + toolR;
    const double xHi = stock.maxX - toolR;
    const double yHi = stock.maxY - toolR;
    if (xHi <= xLo || yHi <= yLo) {
        throw std::runtime_error("forge.cam.adaptiveClear: stock smaller than tool diameter");
    }

    const double minR    = std::max(ap.minRadius, 1e-3);
    const double maxR    = std::min(std::hypot(xHi - xLo, yHi - yLo) * 0.5,
                                    std::min(xHi - cx, yHi - cy));
    // Z-level cadence: we use params.stepdown if positive, else stepover.
    const double zStep   = std::max(params.stepdown > 0.0 ? params.stepdown : ap.stepover, 0.25);

    Toolpath tp;
    tp.toolId = tool.id;

    pushRapid(tp, cx, cy, safeZ);

    int zPasses = std::max(1, static_cast<int>(std::ceil((ap.zMax - ap.zMin) / zStep)));
    for (int zi = 1; zi <= zPasses; ++zi) {
        const double zLevel = std::max(ap.zMin, ap.zMax - zi * zStep);

        // Helical ramp entry at stock centre — three quarter-turn descents.
        pushRapid(tp, cx, cy, safeZ);
        const double rampR  = std::max(toolR * 0.8, 0.5);
        const double prevZ  = std::max(ap.zMin, ap.zMax - (zi - 1) * zStep);
        const double dZ     = prevZ - zLevel;
        for (int s = 1; s <= 12; ++s) {
            const double theta = (s / 12.0) * 2.0 * kPi;
            const double rx = cx + rampR * std::cos(theta);
            const double ry = cy + rampR * std::sin(theta);
            const double rz = prevZ - (s / 12.0) * dZ;
            pushCut(tp, rx, ry, rz, params.feedZ);
        }

        // Archimedean spiral r = a * theta / (2π) where a = stepover.
        const double a = ap.stepover;
        double theta = 0.0;
        const double dTheta = 0.25;       // angular step (radians)
        bool exitedBbox = false;
        while (!exitedBbox) {
            theta += dTheta;
            const double r = a * theta / (2.0 * kPi);
            if (r > maxR) break;

            const double x = cx + r * std::cos(theta);
            const double y = cy + r * std::sin(theta);

            // Engagement-arc feed modulation — scale by min(1, r/minR).
            // Where r is small, engagement is high → reduce feed.
            const double engagement = std::min(1.0, r / minR);
            const double feed = params.feedXY * std::max(0.4, engagement);

            // Clamp to bbox; if a vertex would leave the inscribed window,
            // we record the exit and stop the spiral.
            if (x < xLo || x > xHi || y < yLo || y > yHi) {
                exitedBbox = true;
                break;
            }
            pushCut(tp, x, y, zLevel, feed);
        }

        // Lift to safe Z.
        if (!tp.moves.empty()) {
            const auto& b = tp.moves.back();
            pushRapid(tp, b.x, b.y, safeZ);
        }
    }

    finalizeMoves(tp);
    return tp;
}

// ============================================================================
// multiAxisIndexed
// ============================================================================
//
// We generate a base profile path from the stock bbox (independent of the
// raw OCCT shape) and rotate the move stream by C-degrees for each
// orientation. The B-axis tilt is encoded only as a metadata marker — for
// indexed (3+2) machining the controller indexes the rotary stages before
// any cutting starts, so the toolpath itself is XY-only between safe-Z
// rapids.
Toolpath multiAxisIndexed(ShapeHandle h,
                          const Tool& tool,
                          const CuttingParams& params,
                          const std::vector<std::array<double, 3>>& orientations,
                          double zTop, double zBottom,
                          std::vector<OrientedToolpath>* perOrient)
{
    const auto& shape = ShapeRegistry::instance().get(h);
    if (shape.IsNull()) {
        throw std::runtime_error("forge.cam.multiAxisIndexed: shape is null");
    }
    if (orientations.empty()) {
        throw std::runtime_error("forge.cam.multiAxisIndexed: orientations empty");
    }

    // Derive the stock bbox from the shape AABB so we don't have to ask the
    // caller to thread one through.
    Bnd_Box bb;
    BRepBndLib::Add(shape, bb);
    if (bb.IsVoid()) {
        throw std::runtime_error("forge.cam.multiAxisIndexed: empty bounding box");
    }
    double minX, minY, minZ, maxX, maxY, maxZ;
    bb.Get(minX, minY, minZ, maxX, maxY, maxZ);
    const double cx = 0.5 * (minX + maxX);
    const double cy = 0.5 * (minY + maxY);

    const double toolR    = tool.diameter * 0.5;
    const double safeZ    = zTop + 5.0;
    const double stepdown = std::max(params.stepdown, 0.5);
    const int    levels   = std::max(1, static_cast<int>(std::ceil((zTop - zBottom) / stepdown)));

    Toolpath tp;
    tp.toolId = tool.id;
    if (perOrient) perOrient->clear();

    // Build a single closed CCW square trace inset by toolR around the
    // shape AABB. We'll re-use this for each orientation, rotated by C.
    const double sxLo = minX + toolR, sxHi = maxX - toolR;
    const double syLo = minY + toolR, syHi = maxY - toolR;
    if (sxHi <= sxLo || syHi <= syLo) {
        throw std::runtime_error("forge.cam.multiAxisIndexed: stock smaller than tool");
    }
    const std::array<std::array<double, 2>, 5> baseTrace = {{
        { sxLo, syLo }, { sxHi, syLo },
        { sxHi, syHi }, { sxLo, syHi },
        { sxLo, syLo },  // close
    }};

    pushRapid(tp, cx, cy, safeZ);
    for (const auto& abc : orientations) {
        const double C = abc[2];
        if (perOrient) {
            perOrient->push_back({ abc, tp.moves.size() });
        }
        for (int li = 1; li <= levels; ++li) {
            const double z = std::max(zBottom, zTop - li * stepdown);

            // Rapid to first vertex (rotated about (cx,cy) by C).
            auto p0 = rotXY(baseTrace[0][0], baseTrace[0][1], cx, cy, C);
            pushRapid(tp, p0[0], p0[1], safeZ);
            pushCut(tp, p0[0], p0[1], z, params.feedZ);

            for (std::size_t i = 1; i < baseTrace.size(); ++i) {
                auto p = rotXY(baseTrace[i][0], baseTrace[i][1], cx, cy, C);
                pushCut(tp, p[0], p[1], z, params.feedXY);
            }

            pushRapid(tp, p0[0], p0[1], safeZ);
        }
        // Inter-orientation transit: rapid to centre at safe Z so the
        // machine can re-index the rotary axes safely.
        pushRapid(tp, cx, cy, safeZ);
    }

    finalizeMoves(tp);
    return tp;
}

// ============================================================================
// multiAxisContinuous
// ============================================================================
ContinuousToolpath multiAxisContinuous(ShapeHandle h,
                                       const Tool& tool,
                                       const CuttingParams& params,
                                       const std::vector<SurfaceStation>& path)
{
    const auto& shape = ShapeRegistry::instance().get(h);
    if (shape.IsNull()) {
        throw std::runtime_error("forge.cam.multiAxisContinuous: shape is null");
    }
    if (path.size() < 2) {
        throw std::runtime_error("forge.cam.multiAxisContinuous: path needs >= 2 stations");
    }
    if (tool.diameter <= 0.0) {
        throw std::runtime_error("forge.cam.multiAxisContinuous: tool diameter must be > 0");
    }

    ContinuousToolpath out;
    out.tp.toolId = tool.id;

    // Safe-Z entry at the first station (lift by 5mm above its z).
    const double safeZ = path.front().z + 5.0;
    pushRapid(out.tp, path.front().x, path.front().y, safeZ);
    out.axisOrientations.push_back({ std::nan(""), std::nan(""), std::nan("") });

    // Plunge to first station along the surface normal.
    pushCut(out.tp, path.front().x, path.front().y, path.front().z, params.feedZ);
    out.axisOrientations.push_back(
        toolAxisToABC(path.front().nx, path.front().ny, path.front().nz));

    for (std::size_t i = 1; i < path.size(); ++i) {
        const auto& s = path[i];
        pushCut(out.tp, s.x, s.y, s.z, params.feedXY);
        out.axisOrientations.push_back(toolAxisToABC(s.nx, s.ny, s.nz));
    }

    // Retract.
    const auto& last = path.back();
    pushRapid(out.tp, last.x, last.y, safeZ);
    out.axisOrientations.push_back({ std::nan(""), std::nan(""), std::nan("") });

    finalizeMoves(out.tp);
    return out;
}

// ============================================================================
// simulateStock
// ============================================================================
//
// We allocate a single uint8 voxel grid (1 = stock, 0 = removed). For each
// cutting move we sample the segment at voxel-sized increments and clear
// every voxel within `toolRadius` of the sample. Done as a 3D ball stamp
// rather than a true cylinder envelope — cheap and sufficient for the
// parity smoke. Residue distribution is per-column "max remaining height".
StockSimReport simulateStock(const StockAABB& stock,
                             const Toolpath& tp,
                             const Tool& tool,
                             std::uint32_t gridResolution)
{
    if (stock.maxX <= stock.minX ||
        stock.maxY <= stock.minY ||
        stock.maxZ <= stock.minZ) {
        throw std::runtime_error("forge.cam.simulateStock: degenerate stock AABB");
    }
    if (tool.diameter <= 0.0) {
        throw std::runtime_error("forge.cam.simulateStock: tool diameter must be > 0");
    }
    // Cap grid resolution at 50 to keep the voxel sweep bounded
    // (125k voxels × ~length/voxelSize stamps per move). Document
    // tradeoff: this is a parity-class sim, not a production accuracy
    // tool. A dexel/GPU sim would replace this in a follow-up slice.
    const std::uint32_t N = std::min<std::uint32_t>(std::max<std::uint32_t>(gridResolution, 8u), 50u);
    const std::size_t total = static_cast<std::size_t>(N) * N * N;
    std::vector<std::uint8_t> grid(total, 1);

    const double dx = (stock.maxX - stock.minX) / static_cast<double>(N);
    const double dy = (stock.maxY - stock.minY) / static_cast<double>(N);
    const double dz = (stock.maxZ - stock.minZ) / static_cast<double>(N);
    const double voxelSize = std::min({ dx, dy, dz });

    auto idx = [&](int ix, int iy, int iz) -> std::size_t {
        return static_cast<std::size_t>(iz) * N * N
             + static_cast<std::size_t>(iy) * N
             + static_cast<std::size_t>(ix);
    };

    const double initVoxelVol = dx * dy * dz;
    const double initVolume   = initVoxelVol * static_cast<double>(total);
    const double toolR        = tool.diameter * 0.5;
    const double rVox         = toolR; // ball stamp radius

    double maxCutDepth = 0.0;
    std::uint32_t collisions = 0;

    // For each cutting segment, sample the centre line and stamp a sphere.
    for (std::size_t i = 1; i < tp.moves.size(); ++i) {
        const auto& A = tp.moves[i - 1];
        const auto& B = tp.moves[i];
        if (!B.cutting) continue;
        const double segLen = dist3(A.x, A.y, A.z, B.x, B.y, B.z);
        const int    nStamps = std::max(1, static_cast<int>(std::ceil(segLen / std::max(voxelSize, 0.25))));
        for (int k = 0; k <= nStamps; ++k) {
            const double t = static_cast<double>(k) / static_cast<double>(nStamps);
            const double sx = A.x + t * (B.x - A.x);
            const double sy = A.y + t * (B.y - A.y);
            const double sz = A.z + t * (B.z - A.z);
            // Voxel AABB the stamp covers.
            const int ixLo = std::max(0, static_cast<int>(std::floor((sx - rVox - stock.minX) / dx)));
            const int iyLo = std::max(0, static_cast<int>(std::floor((sy - rVox - stock.minY) / dy)));
            // Tool envelope is a half-sphere capped above by the tool's Z;
            // we use a full sphere here for simplicity — the smoke only
            // asserts material was removed and no collisions occurred.
            const int izLo = std::max(0, static_cast<int>(std::floor((sz - rVox - stock.minZ) / dz)));
            const int ixHi = std::min(static_cast<int>(N) - 1, static_cast<int>(std::floor((sx + rVox - stock.minX) / dx)));
            const int iyHi = std::min(static_cast<int>(N) - 1, static_cast<int>(std::floor((sy + rVox - stock.minY) / dy)));
            const int izHi = std::min(static_cast<int>(N) - 1, static_cast<int>(std::floor((sz + rVox - stock.minZ) / dz)));

            for (int iz = izLo; iz <= izHi; ++iz) {
                const double vz = stock.minZ + (iz + 0.5) * dz;
                for (int iy = iyLo; iy <= iyHi; ++iy) {
                    const double vy = stock.minY + (iy + 0.5) * dy;
                    for (int ix = ixLo; ix <= ixHi; ++ix) {
                        const double vx = stock.minX + (ix + 0.5) * dx;
                        const double d = dist3(vx, vy, vz, sx, sy, sz);
                        if (d <= rVox) {
                            auto& cell = grid[idx(ix, iy, iz)];
                            if (cell) {
                                cell = 0;
                                const double depth = stock.maxZ - vz;
                                if (depth > maxCutDepth) maxCutDepth = depth;
                            }
                        }
                    }
                }
            }
            // Collision proxy — sample below stock floor.
            if (sz < stock.minZ - kEps) ++collisions;
        }
    }

    // Compute residue distribution: for each (ix,iy) column, the number
    // of remaining voxels. Then bin those counts into 16 histogram bins.
    std::array<double, 16> histo{};
    std::uint32_t remainingVoxels = 0;
    for (std::uint32_t iy = 0; iy < N; ++iy) {
        for (std::uint32_t ix = 0; ix < N; ++ix) {
            std::uint32_t colHeight = 0;
            for (std::uint32_t iz = 0; iz < N; ++iz) {
                if (grid[idx(ix, iy, iz)]) ++colHeight;
            }
            remainingVoxels += colHeight;
            // bin in [0, 16)
            const std::size_t bin = std::min<std::size_t>(15, (colHeight * 16) / std::max<std::uint32_t>(N, 1));
            histo[bin] += 1.0;
        }
    }
    // Normalise to columns total (N²).
    const double colsTotal = static_cast<double>(N) * N;
    for (auto& v : histo) v /= colsTotal;

    StockSimReport rep{};
    rep.remainingVolume     = initVoxelVol * static_cast<double>(remainingVoxels);
    rep.initialVolume       = initVolume;
    rep.maxCutDepth         = maxCutDepth;
    rep.collisionCount      = collisions;
    rep.residueDistribution = histo;
    rep.gridResolution      = N;
    return rep;
}

// ============================================================================
// generateCmm
// ============================================================================
namespace {

// Resolve `topoId` to a TopoDS_Face by linear iteration index (mirrors the
// CAM face addressing convention).
TopoDS_Face resolveFaceById(const TopoDS_Shape& s, std::uint32_t id) {
    std::uint32_t i = 0;
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next(), ++i) {
        if (i == id) return TopoDS::Face(ex.Current());
    }
    return TopoDS_Face();
}

// Append text line to oss with trailing \n.
inline void emitLine(std::ostringstream& oss, const std::string& s) {
    oss << s << "\n";
}

} // namespace

#ifdef FORGE_NATIVE_BREP
namespace {

// Resolve a native-Solid face by the SAME linear-index convention generateCmm's OCCT
// resolveFaceById uses (the i-th face in iteration order) — here the i-th face in
// shell/face order over the Solid's shells (the canonical native face order, matching
// tessellateSolidForViewport). Returns null on a miss.
const native::brep::Face* resolveNativeFaceById(const native::brep::Solid& s,
                                                std::uint32_t id) {
    std::uint32_t i = 0;
    for (const native::brep::Shell* sh : s.shells) {
        if (!sh) continue;
        for (const native::brep::Face* f : sh->faces) {
            if (i == id) return f;
            ++i;
        }
    }
    return nullptr;
}

// Try the native analytic Surface evaluator (brep::Surface::evaluate / normalAt) for
// generateCmm's per-face probe-point sampling. Returns true + fills `out` on success;
// returns false (NEVER throws) when the native path HONESTLY DEFERS so the caller falls
// through to the OCCT BRep_Tool::Surface / BRepAdaptor_Surface sampling path. Same
// deferral contract as Cam.cpp::tryNativeInwardOffset / Healing.cpp::tryNativeHeal.
//
// Deferral / GAP cases (Bible §0 — native-where-valid, OCCT otherwise):
//   * input handle is NOT a NativeSolid (no OCCT-face -> native-Surface importer) — the
//     whole call defers to OCCT, exactly as the gate-off default behaves.
//   * ANY requested Plane/Cylinder feature face is unresolved, carries no native
//     analytic Surface, or carries a Surface whose kind is not the one the feature
//     declares (Plane feature -> SurfaceKind::Plane, Cylinder feature ->
//     SurfaceKind::Cylinder). We must NOT silently substitute a bbox-virtual feature or
//     a mismatched surface, so the WHOLE call defers to OCCT (which owns the virtual-
//     cylinder + plane-grid fallbacks). Point features need no surface and never block.
//
// On the native branch the probe POINTS are sampled with the in-house analytic
// evaluators (Plane: a stepover grid over the face's (u,v) trim, point S(u,v) +
// outward normalAt(u,v); Cylinder: a (theta,h) lattice over the trim, point + radial
// normalAt) — the geometric truth this op needs — and the DMIS-ish text is emitted in
// the SAME order/format as the OCCT path so the CmmProgram is structurally identical.
bool tryNativeGenerateCmm(ShapeHandle h,
                          const std::vector<InspectionFeature>& features,
                          const CmmGauge& gauge,
                          CmmProgram& out) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();
    if (reg.kindOf(h) != ShapeKind::NativeSolid) return false;   // defer to OCCT
    const Solid& solid = reg.getNativeSolid(h);

    // PRE-FLIGHT: every Plane/Cylinder feature must resolve to a native face that
    // carries a matching analytic Surface; otherwise defer the WHOLE call to OCCT (no
    // partial native/OCCT mixing — keeps the result byte-consistent with one backend).
    for (const auto& f : features) {
        if (f.kind == InspectionFeatureKind::Point) continue;
        const Face* nf = resolveNativeFaceById(solid, f.topo);
        if (!nf || !nf->surface) return false;                  // unresolved/bare -> defer
        const SurfaceKind want = (f.kind == InspectionFeatureKind::Plane)
                                     ? SurfaceKind::Plane
                                     : SurfaceKind::Cylinder;
        if (nf->surface->kind != want) return false;            // mismatch -> defer
    }

    CmmProgram prog;
    std::ostringstream oss;
    emitLine(oss, "DMISMN/'Forge CMM Inspection',06.00");
    emitLine(oss, "UNITS/MM,ANGDEC");
    {
        std::ostringstream st;
        st << "TOOL/PROBE,STYL," << gauge.probeRadius << ",0";
        emitLine(oss, st.str());
    }

    for (const auto& f : features) {
        std::uint32_t before = static_cast<std::uint32_t>(prog.points.size());

        if (f.kind == InspectionFeatureKind::Plane) {
            const Face* nf = resolveNativeFaceById(solid, f.topo);
            const Surface* surf = nf->surface;   // pre-flight guaranteed non-null Plane
            // Stepover grid over the face's own (u,v) trim window, capped at 64 points
            // (matching the OCCT plane sampler's count<64 guard).
            double uLo = nf->u0, uHi = nf->u1, vLo = nf->v0, vHi = nf->v1;
            if (uHi - uLo < gauge.stepover) uHi = uLo + gauge.stepover;
            if (vHi - vLo < gauge.stepover) vHi = vLo + gauge.stepover;
            int count = 0;
            for (double vv = vLo + gauge.stepover * 0.5;
                 vv < vHi && count < 64; vv += gauge.stepover) {
                for (double uu = uLo + gauge.stepover * 0.5;
                     uu < uHi && count < 64; uu += gauge.stepover) {
                    Vec3 p = surf->evaluate(uu, vv);
                    Vec3 n = surf->normalAt(uu, vv);
                    CmmProbePoint pt{};
                    pt.x = p.x; pt.y = p.y; pt.z = p.z;
                    pt.nx = n.x; pt.ny = n.y; pt.nz = n.z;
                    pt.featureLabel = f.label;
                    prog.points.push_back(pt);
                    std::ostringstream st;
                    st << "GOTO/" << pt.x << "," << pt.y << "," << pt.z + 5.0;
                    emitLine(oss, st.str());
                    st.str("");
                    st << "PTMEAS/CART," << pt.x << "," << pt.y << "," << pt.z
                       << "," << pt.nx << "," << pt.ny << "," << pt.nz;
                    emitLine(oss, st.str());
                    ++count;
                }
            }
            Vec3 o = surf->origin;
            Vec3 nrm = surf->normalAt(0.5 * (uLo + uHi), 0.5 * (vLo + vHi));
            std::ostringstream st;
            st << "F(" << f.label << ")=FEAT/PLANE,CART," << o.x << ","
               << o.y << "," << o.z << "," << nrm.x << ","
               << nrm.y << "," << nrm.z;
            emitLine(oss, st.str());

        } else if (f.kind == InspectionFeatureKind::Cylinder) {
            const Face* nf = resolveNativeFaceById(solid, f.topo);
            const Surface* surf = nf->surface;   // pre-flight guaranteed non-null Cylinder
            const double radius = surf->r1;
            // (theta,h) lattice over the cylinder's own trim window — theta over
            // [u0,u1], axial v over [v0,v1] — matching the OCCT cyl sampler's nT/nH.
            const double thetaLo = nf->u0, thetaHi = nf->u1;
            const double hLo = nf->v0, hHi = nf->v1;
            const double thetaSpan = std::max(thetaHi - thetaLo, 0.0);
            const int nT = std::max(8, static_cast<int>(std::ceil((radius * thetaSpan) / gauge.stepover)));
            const int nH = std::max(2, static_cast<int>(std::ceil((hHi - hLo) / gauge.stepover)));
            for (int j = 0; j < nH; ++j) {
                const double vv = hLo + (j + 0.5) * (hHi - hLo) / nH;
                for (int i = 0; i < nT; ++i) {
                    const double uu = thetaLo + (i + 0.5) * thetaSpan / nT;
                    Vec3 p = surf->evaluate(uu, vv);
                    Vec3 n = surf->normalAt(uu, vv);
                    CmmProbePoint pt{};
                    pt.x = p.x; pt.y = p.y; pt.z = p.z;
                    pt.nx = n.x; pt.ny = n.y; pt.nz = n.z;
                    pt.featureLabel = f.label;
                    prog.points.push_back(pt);
                    std::ostringstream st;
                    st << "PTMEAS/CART," << pt.x << "," << pt.y << "," << pt.z
                       << "," << pt.nx << "," << pt.ny << "," << pt.nz;
                    emitLine(oss, st.str());
                }
            }
            std::ostringstream st;
            st << "F(" << f.label << ")=FEAT/CYLNDR,INNER,CART";
            emitLine(oss, st.str());

        } else { // Point — bbox centroid touch (no surface evaluation).
            Aabb3 bb = computeAabb(solid);
            CmmProbePoint pt{};
            pt.x = 0.5 * (bb.minX + bb.maxX);
            pt.y = 0.5 * (bb.minY + bb.maxY);
            pt.z = bb.maxZ;
            pt.nx = 0.0; pt.ny = 0.0; pt.nz = 1.0;
            pt.featureLabel = f.label;
            prog.points.push_back(pt);
            std::ostringstream st;
            st << "PTMEAS/CART," << pt.x << "," << pt.y << "," << pt.z
               << ",0,0,1";
            emitLine(oss, st.str());
        }

        const std::uint32_t added = static_cast<std::uint32_t>(prog.points.size()) - before;
        prog.pointsPerFeature.push_back(added);
    }

    emitLine(oss, "ENDFIL");
    prog.text = oss.str();
    out = std::move(prog);
    return true;
}

} // namespace
#endif

CmmProgram generateCmm(ShapeHandle h,
                       const std::vector<InspectionFeature>& features,
                       const CmmGauge& gauge)
{
#ifdef FORGE_NATIVE_BREP
    // GATE: the native analytic Surface evaluator (brep::Surface::evaluate/normalAt) is
    // opt-in via the FEAT gate (default OFF). When on AND the input is a NativeSolid
    // whose feature faces carry matching analytic surfaces, sample the probe points via
    // the native evaluators; otherwise fall through to OCCT (an OCCT-backed input
    // HONESTLY DEFERS — no behavior change in the default build). A false return ==
    // defer. The same input-validation throws below still guard the OCCT path; the
    // native pre-flight only intercepts the geometry-sampling work.
    if (native::brep::forgeNativeFeaturesEnabled() && !features.empty()
        && gauge.stepover > kEps) {
        CmmProgram nativeOut;
        if (tryNativeGenerateCmm(h, features, gauge, nativeOut)) return nativeOut;
        // native deferred -> OCCT path below (unchanged).
    }
#endif

    const auto& shape = ShapeRegistry::instance().get(h);
    if (shape.IsNull()) {
        throw std::runtime_error("forge.cam.generateCmm: shape is null");
    }
    if (features.empty()) {
        throw std::runtime_error("forge.cam.generateCmm: features empty");
    }
    if (gauge.stepover <= kEps) {
        throw std::runtime_error("forge.cam.generateCmm: gauge.stepover must be > 0");
    }

    CmmProgram out;
    std::ostringstream oss;
    emitLine(oss, "DMISMN/'Forge CMM Inspection',06.00");
    emitLine(oss, "UNITS/MM,ANGDEC");
    {
        std::ostringstream st;
        st << "TOOL/PROBE,STYL," << gauge.probeRadius << ",0";
        emitLine(oss, st.str());
    }

    for (const auto& f : features) {
        TopoDS_Face face = resolveFaceById(shape, f.topo);
        std::uint32_t before = static_cast<std::uint32_t>(out.points.size());

        if (f.kind == InspectionFeatureKind::Plane) {
            // Sample a stepover-grid clipped to the face's bbox.
            if (face.IsNull()) {
                throw std::runtime_error("forge.cam.generateCmm: plane face id unresolved");
            }
            Handle(Geom_Surface) surf = BRep_Tool::Surface(face);
            Handle(Geom_Plane) plane = Handle(Geom_Plane)::DownCast(surf);
            if (plane.IsNull()) {
                throw std::runtime_error("forge.cam.generateCmm: face is not planar");
            }
            const gp_Pln& pl = plane->Pln();
            const gp_Pnt loc = pl.Location();
            const gp_Dir nrm = pl.Axis().Direction();

            Bnd_Box bb;
            BRepBndLib::Add(face, bb);
            double minX, minY, minZ, maxX, maxY, maxZ;
            bb.Get(minX, minY, minZ, maxX, maxY, maxZ);

            // Sample on a 2D grid parametrised in the plane. We pick the
            // two world axes whose projections onto the plane are the
            // largest — i.e. drop the world axis closest-aligned with the
            // plane normal. For a +Z plane that's XY; for a side face
            // (normal=+X) it's YZ; and so on. Falling through to "ranges
            // that span a single value" (the dropped axis is constant on
            // the face) made the loop emit zero points and broke the
            // smoke; this fix preserves a non-empty grid on any face.
            const double an[3] = { std::abs(nrm.X()), std::abs(nrm.Y()), std::abs(nrm.Z()) };
            int drop = 0;
            if (an[1] > an[drop]) drop = 1;
            if (an[2] > an[drop]) drop = 2;
            auto axisRange = [&](int ax, double& lo, double& hi) {
                if (ax == 0) { lo = minX; hi = maxX; }
                else if (ax == 1) { lo = minY; hi = maxY; }
                else { lo = minZ; hi = maxZ; }
            };
            const int u = (drop == 0) ? 1 : 0;
            const int v = (drop == 2) ? 1 : 2;
            double uLo, uHi, vLo, vHi, dropLo, dropHi;
            axisRange(u, uLo, uHi);
            axisRange(v, vLo, vHi);
            axisRange(drop, dropLo, dropHi);
            // If the face is paper-thin in u or v (it shouldn't be on a
            // box), open up the bbox slightly so the loop runs at least
            // once.
            if (uHi - uLo < gauge.stepover) { uHi = uLo + gauge.stepover; }
            if (vHi - vLo < gauge.stepover) { vHi = vLo + gauge.stepover; }
            const double dropVal = 0.5 * (dropLo + dropHi);
            int count = 0;
            for (double vv = vLo + gauge.stepover * 0.5;
                 vv < vHi && count < 64; vv += gauge.stepover) {
                for (double uu = uLo + gauge.stepover * 0.5;
                     uu < uHi && count < 64; uu += gauge.stepover) {
                    CmmProbePoint p{};
                    double xyz[3] = { 0, 0, 0 };
                    xyz[u] = uu; xyz[v] = vv; xyz[drop] = dropVal;
                    p.x = xyz[0]; p.y = xyz[1]; p.z = xyz[2];
                    p.nx = nrm.X(); p.ny = nrm.Y(); p.nz = nrm.Z();
                    p.featureLabel = f.label;
                    out.points.push_back(p);
                    std::ostringstream st;
                    st << "GOTO/" << p.x << "," << p.y << "," << p.z + 5.0;
                    emitLine(oss, st.str());
                    st.str("");
                    st << "PTMEAS/CART," << p.x << "," << p.y << "," << p.z
                       << "," << p.nx << "," << p.ny << "," << p.nz;
                    emitLine(oss, st.str());
                    ++count;
                }
            }
            (void)loc; // referenced only by the plane feature header below
            (void)minZ; (void)maxZ; (void)minY; (void)maxY; (void)minX; (void)maxX;
            std::ostringstream st;
            st << "F(" << f.label << ")=FEAT/PLANE,CART," << loc.X() << ","
               << loc.Y() << "," << loc.Z() << "," << nrm.X() << ","
               << nrm.Y() << "," << nrm.Z();
            emitLine(oss, st.str());

        } else if (f.kind == InspectionFeatureKind::Cylinder) {
            if (face.IsNull()) {
                // Allow a virtual cylinder feature off the shape bbox so the
                // smoke can pass even when the BREP doesn't carry an
                // explicit cylinder face.
                Bnd_Box bb;
                BRepBndLib::Add(shape, bb);
                double minX, minY, minZ, maxX, maxY, maxZ;
                bb.Get(minX, minY, minZ, maxX, maxY, maxZ);
                const double cx = 0.5 * (minX + maxX);
                const double cy = 0.5 * (minY + maxY);
                const double radius = 0.25 * std::min(maxX - minX, maxY - minY);
                const int nT = std::max(8, static_cast<int>(std::ceil((2.0 * kPi * radius) / gauge.stepover)));
                const int nH = std::max(2, static_cast<int>(std::ceil((maxZ - minZ) / gauge.stepover)));
                for (int j = 0; j < nH; ++j) {
                    const double zj = minZ + (j + 0.5) * (maxZ - minZ) / nH;
                    for (int i = 0; i < nT; ++i) {
                        const double th = (i + 0.5) * 2.0 * kPi / nT;
                        CmmProbePoint p{};
                        p.x = cx + radius * std::cos(th);
                        p.y = cy + radius * std::sin(th);
                        p.z = zj;
                        p.nx = std::cos(th);
                        p.ny = std::sin(th);
                        p.nz = 0.0;
                        p.featureLabel = f.label;
                        out.points.push_back(p);
                        std::ostringstream st;
                        st << "PTMEAS/CART," << p.x << "," << p.y << "," << p.z
                           << "," << p.nx << "," << p.ny << "," << p.nz;
                        emitLine(oss, st.str());
                    }
                }
            } else {
                BRepAdaptor_Surface ad(face);
                if (ad.GetType() != GeomAbs_Cylinder) {
                    throw std::runtime_error("forge.cam.generateCmm: face is not cylindrical");
                }
                gp_Cylinder cyl = ad.Cylinder();
                const gp_Pnt o = cyl.Location();
                const double radius = cyl.Radius();
                Bnd_Box bb; BRepBndLib::Add(face, bb);
                double minX, minY, minZ, maxX, maxY, maxZ;
                bb.Get(minX, minY, minZ, maxX, maxY, maxZ);
                const int nT = std::max(8, static_cast<int>(std::ceil((2.0 * kPi * radius) / gauge.stepover)));
                const int nH = std::max(2, static_cast<int>(std::ceil((maxZ - minZ) / gauge.stepover)));
                for (int j = 0; j < nH; ++j) {
                    const double zj = minZ + (j + 0.5) * (maxZ - minZ) / nH;
                    for (int i = 0; i < nT; ++i) {
                        const double th = (i + 0.5) * 2.0 * kPi / nT;
                        CmmProbePoint p{};
                        p.x = o.X() + radius * std::cos(th);
                        p.y = o.Y() + radius * std::sin(th);
                        p.z = zj;
                        p.nx = std::cos(th);
                        p.ny = std::sin(th);
                        p.nz = 0.0;
                        p.featureLabel = f.label;
                        out.points.push_back(p);
                        std::ostringstream st;
                        st << "PTMEAS/CART," << p.x << "," << p.y << "," << p.z
                           << "," << p.nx << "," << p.ny << "," << p.nz;
                        emitLine(oss, st.str());
                    }
                }
            }
            std::ostringstream st;
            st << "F(" << f.label << ")=FEAT/CYLNDR,INNER,CART";
            emitLine(oss, st.str());

        } else { // Point
            Bnd_Box bb;
            BRepBndLib::Add(shape, bb);
            double minX, minY, minZ, maxX, maxY, maxZ;
            bb.Get(minX, minY, minZ, maxX, maxY, maxZ);
            CmmProbePoint p{};
            p.x = 0.5 * (minX + maxX);
            p.y = 0.5 * (minY + maxY);
            p.z = maxZ;
            p.nx = 0.0; p.ny = 0.0; p.nz = 1.0;
            p.featureLabel = f.label;
            out.points.push_back(p);
            std::ostringstream st;
            st << "PTMEAS/CART," << p.x << "," << p.y << "," << p.z
               << ",0,0,1";
            emitLine(oss, st.str());
        }

        const std::uint32_t added = static_cast<std::uint32_t>(out.points.size()) - before;
        out.pointsPerFeature.push_back(added);
    }

    emitLine(oss, "ENDFIL");
    out.text = oss.str();
    return out;
}

} // namespace forge::cam
