// forge/native/cam/Cam.hpp
//
// In-house COMPUTER-AIDED MANUFACTURING verification kernel — forge::native::cam.
// Pure C++20, standard library only. NO OCCT, NO WASM, NO third-party libs.
//
// WHY THIS EXISTS (the marketed differentiator, per Forge Engineering Bible):
//   A CAM post-processor emits a toolpath (a polyline the tool tip follows, with
//   rapid/feed flags). Before that path ever touches a real machine three things
//   MUST be verified, and a real CAD/CAM kernel verifies them GEOMETRICALLY, not
//   by trusting the CAM author:
//
//     (A) MATERIAL REMOVAL — does the path actually cut the intended stock down
//         to the part? We answer with a swept-volume simulation: sweep the tool
//         SOLID (flat-end cylinder / ball-end / toroidal-corner endmill) along
//         each cutting segment and subtract that swept solid from the stock
//         block, then measure the removed volume. For a straight slot / pocket
//         the removed volume has a CLOSED-FORM analytic answer the simulation
//         must converge to as the voxel spacing -> 0 (validated in the gate).
//
//     (B) COLLISION — does the tool, the holder, or a rapid move hit something
//         it must not? We flag, in path order, the FIRST of: (i) the swept
//         tool-or-holder capsule overlapping any fixture / clamp box, (ii) a
//         RAPID-flagged move that drives into remaining stock (a feed move into
//         stock is normal cutting and is NOT a collision), (iii) any path point
//         outside the machine travel envelope.
//
//     (C) PROBING — generate a collision-free on-machine touch-probe cycle
//         (approach -> slow touch -> retract) to a target face, reporting the
//         expected nominal contact point, and PROVE the generated cycle itself
//         passes the (B) collision check.
//
// HONEST SCOPE (Bible §0/§9 — 0 FAKES, no stubs, no fallback):
//   * Material removal is VOXEL-based: it reuses the already-validated dense
//     field engine (voxel/VoxelGrid.hpp) and field CSG (voxel/VoxelBoolean.hpp)
//     verbatim by #include — NO new voxelizer, NO new boolean. The removed-volume
//     number is a midpoint-Riemann measure that CONVERGES to the analytic slot
//     volume under refinement; the gate asserts that convergence within a stated
//     spacing tolerance. The voxel resolution actually used is RETURNED so the
//     caller knows the discretisation (never hidden).
//   * The tool / holder swept solid is the exact signed distance to the swept
//     capsule (a segment-swept sphere/cylinder), negative-inside, matching the
//     kernel's SDF convention so it composes with VoxelBoolean directly. The
//     toroidal corner is the standard "rounded endmill" = cylinder core unioned
//     with a torus at the bottom corner, expressed as an SDF offset — EXACT, not
//     faceted.
//   * Collision uses CLOSED-FORM segment / capsule / box distance (a new local
//     primitive — none existed in the kernel) plus the existing geom::AABBTree
//     for the rapid-into-stock surface ray test. No approximated proxy hulls.
//   * Probing composes (A)'s clearance reasoning with (B)'s collision check; the
//     generated cycle is RE-CHECKED through checkCollisions so the "collision
//     free" claim is verified, not asserted.
//
// TARGETED (NOT in this increment — flagged, never faked):
//   * 5-axis tool-orientation sweeps (the tool axis is +Z here; the swept solid
//     is along the tip polyline). // TODO(5axis)
//   * Engagement-angle / chip-load / feed-rate optimisation (this module
//     VERIFIES a path; it does not generate or optimise feeds). // TODO(engage)
//   * Exact (non-voxel) boundary-rep swept-volume regeneration of the in-process
//     stock as a B-rep (the field measure is the validated quantity here; a B-rep
//     regen is a separate, larger feature). // TODO(brep-stock)
//
// CONVENTIONS: namespace forge::native::cam. The canonical point type is
//   mesh::Vec3 {double x,y,z} (the AABBTree's vertex type); it converts trivially
//   to the voxel engine's native::Vec3. Pure C++20, standard library only.

#ifndef FORGE_NATIVE_CAM_CAM_HPP
#define FORGE_NATIVE_CAM_CAM_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/voxel/VoxelGrid.hpp"     // VoxelGrid<float>, native::Vec3
#include "forge/native/voxel/VoxelBoolean.hpp"   // VoxelBoolean (field CSG + enclosedVolume)
#include "forge/native/mesh/HalfEdgeMesh.hpp"    // mesh::Vec3 (canonical point type)
#include "forge/native/geom/AABBTree.hpp"        // geom::AABBTree, geom::Aabb (rapid-into-stock ray)

namespace forge {
namespace native {
namespace cam {

using mesh::Vec3;          // canonical point / direction type {double x,y,z}
using geom::Aabb;          // axis-aligned box (fixtures, stock block, envelope)

// ---------------------------------------------------------------------------
// Data model — minimal and honest.
// ---------------------------------------------------------------------------

// A cutting tool whose axis is +Z, tip at the path point.
//   radius       : nominal cutter radius (mm).
//   length       : flute length below the holder (mm), >= 0.
//   cornerRadius : bottom-corner fillet radius (mm):
//                    0            -> flat-end (square) endmill,
//                    == radius    -> ball-end endmill,
//                    in (0,radius)-> bull-nose / toroidal-corner endmill.
struct Tool {
    double radius{1.0};
    double length{10.0};
    double cornerRadius{0.0};
    bool ballEnd() const { return cornerRadius >= radius - 1e-12; }
};

// The holder / collet: a cylinder of the given radius, sitting ABOVE the tool
// tip. It begins `gapZ` above the tip (so the flutes clear) and rises `length`.
// (radius is typically larger than the tool radius -> a holder crash even when
// the slender tool would clear.)
struct Holder {
    double radius{6.0};
    double length{40.0};
    double gapZ{0.0};   // axial gap between tip and the holder's lower face (mm)
};

// One point of a toolpath. `rapid==true` is a non-cutting positioning move
// (which MUST NOT pass through material); otherwise it is a cutting feed move.
struct PathPoint {
    Vec3 p{};
    bool rapid{false};
};

using Toolpath = std::vector<PathPoint>;

// The raw stock as an axis-aligned block [lo, hi].
struct Stock {
    Vec3 lo{};
    Vec3 hi{};
    bool valid() const {
        return lo.x < hi.x && lo.y < hi.y && lo.z < hi.z;
    }
};

// The machine linear-travel envelope (axis-aligned min/max XYZ).
struct MachineEnvelope {
    Vec3 lo{};
    Vec3 hi{};
};

// ---------------------------------------------------------------------------
// (A) Swept-volume material removal.
// ---------------------------------------------------------------------------

// Result of removeMaterial.
//   ok             : false on a real precondition failure (bad stock / spacing /
//                    empty path / field-CSG misalignment) — never a fabricated
//                    success.
//   reason         : diagnostic when ok==false.
//   updatedStock   : the in-process stock SDF field (negative-inside) AFTER the
//                    swept tool was subtracted. Solid = { field <= 0 }.
//   removedVolume  : enclosedVolume(before) - enclosedVolume(after), the volume
//                    of material the path removed (mm^3), midpoint-Riemann.
//   stockVolume0   : the stock's enclosed volume BEFORE cutting (mm^3).
//   voxelResolution: the cubic voxel spacing actually used (mm) — the
//                    discretisation behind removedVolume, returned so the caller
//                    knows the resolution (never hidden).
struct RemovalResult {
    bool                  ok{false};
    const char*           reason{""};
    VoxelGrid<float>      updatedStock{};
    double                removedVolume{0.0};
    double                stockVolume0{0.0};
    double                voxelResolution{0.0};
};

// Sweep the tool solid along every CUTTING (non-rapid) segment of `path` and
// subtract it from `stock`, returning the in-process stock + removed volume.
//   spacing : the cubic voxel edge length (mm). Smaller -> more accurate +
//             slower; the removed-volume converges to the analytic answer as
//             spacing -> 0. Must be > 0 and finite.
// Rapid segments are NOT cutting and remove no material. A path with fewer than
// two points (no segment) removes nothing (ok=true, removedVolume=0).
RemovalResult removeMaterial(const Stock& stock,
                             const Tool& tool,
                             const Toolpath& path,
                             double spacing);

// ---------------------------------------------------------------------------
// (B) Collision detection.
// ---------------------------------------------------------------------------

enum class CollisionKind {
    None,
    Fixture,        // swept tool OR holder overlaps a fixture / clamp box
    RapidIntoStock, // a RAPID-flagged segment drives into remaining stock
    Envelope        // a path point lies outside the machine travel envelope
};

struct CollisionResult {
    bool          collided{false};
    CollisionKind kind{CollisionKind::None};
    std::size_t   segmentIndex{0};   // index of the OFFENDING segment (or point)
    Vec3          point{};           // representative collision location
    const char*   detail{""};        // short human-readable note
};

// Walk `path` and return the FIRST collision (in path order), or a result with
// collided==false if the whole path is clean.
//
//   tool, holder    : the swept solids that must not hit a fixture.
//   fixtureBoxes    : clamp / fixture / vise boxes the tool+holder must avoid.
//   env             : the machine travel envelope (every point must lie inside).
//   remainingStock  : the surface of the stock that is still present, as a
//                     triangle soup (positions+indices). A RAPID move whose
//                     segment crosses this surface is a rapid-into-stock crash.
//                     Pass an empty soup (both vectors empty) if there is no
//                     in-process stock to test against (then rapid-into-stock is
//                     simply never flagged). Cutting (feed) moves are NEVER
//                     flagged against stock — cutting INTO stock is the job.
//
// Detection order per the spec: envelope is checked per point as the path is
// walked; for each segment the fixture sweep is checked, then (rapid only) the
// stock crossing. The first hit in walk order wins.
CollisionResult checkCollisions(const Toolpath& path,
                                const Tool& tool,
                                const Holder& holder,
                                const std::vector<Aabb>& fixtureBoxes,
                                const MachineEnvelope& env,
                                const std::vector<double>& remainingStockPositions,
                                const std::vector<std::uint32_t>& remainingStockIndices);

// ---------------------------------------------------------------------------
// (C) Probing.
// ---------------------------------------------------------------------------

// A target face/plane to probe: a point ON the plane and the OUTWARD unit
// normal (the direction the probe approaches FROM, i.e. the probe travels along
// -normal to touch). Only the plane is needed for a nominal touch point.
struct ProbeTarget {
    Vec3 pointOnFace{};   // any point on the target plane
    Vec3 normal{};        // outward unit normal of the face (need not be unit;
                          //   it is normalised internally)
};

struct ProbeResult {
    bool        ok{false};
    const char* reason{""};
    Toolpath    cycle{};            // approach -> slow-touch -> retract, in order
    Vec3        nominalContact{};   // expected contact point on the face
    bool        collisionFree{false}; // cycle re-checked through checkCollisions
};

// Generate a collision-free probe cycle to `target`:
//   1. nominal contact = projection of `target.pointOnFace`-region onto the face
//      directly under the standoff approach line (we touch the face at the point
//      offset `target.pointOnFace` along the approach line).
//   2. retract point   = contact + clearance * approachUnit
//   3. approach point   = contact + (clearance/2) * approachUnit (rapid down)
//   4. slow touch point = contact (feed move onto the face)
//   5. retract back     = contact + clearance * approachUnit (feed up clear)
// The whole cycle is then RE-CHECKED through checkCollisions; collisionFree
// reports the result (and the cycle is returned regardless so the caller can
// inspect a flagged path). On a degenerate target (zero normal / clearance)
// ok=false with a reason.
ProbeResult generateProbePath(const ProbeTarget& target,
                              const Tool& tool,
                              const Holder& holder,
                              double clearance,
                              const MachineEnvelope& env,
                              const std::vector<Aabb>& fixtureBoxes);

// ---------------------------------------------------------------------------
// Geometry helpers exposed for the gate (closed-form, validated directly).
// ---------------------------------------------------------------------------

// Squared distance from point `p` to the segment [a,b] (closed form).
double segmentPointDist2(const Vec3& a, const Vec3& b, const Vec3& p);

// Does the capsule of radius `r` swept along segment [a,b] overlap the
// axis-aligned box `box`? Closed-form (segment-to-box squared distance vs r^2).
bool segmentCapsuleOverlapsBox(const Vec3& a, const Vec3& b, double r,
                               const Aabb& box);

} // namespace cam
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_CAM_CAM_HPP
