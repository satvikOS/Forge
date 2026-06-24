#pragma once

// Sketcher — Forge-native facade over the vendored planegcs constraint solver.
//
// The goal is a tiny, stable, handle-based API that the N-API binding can
// forward to JS verbatim. Inside, each `forge::Sketch` owns:
//   - a planegcs `GCS::System` that holds the constraint network
//   - a pool of heap-allocated `double` parameters (point coords, radii, etc.)
//     — planegcs takes raw `double*` and edits them in place during solve()
//   - vectors of `Point`, `Line`, `Circle`, `Arc` instances whose internal
//     pointers tie back into the parameter pool
//   - a parallel vector of "distance value" parameters for value-bearing
//     constraints (Distance, Equal w/ value, etc.)
//
// IDs returned by add* are dense uint32 indices, NOT raw pointers — the JS
// side never sees a C++ pointer. The same is true for the SketchHandle.
//
// Lifetimes: a Sketch lives until destroySketch() is called or the process
// exits. Destruction frees the planegcs heap allocations and clears the
// parameter pool.

#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include <TopoDS_Wire.hxx>

// IN-HOUSE KERNEL STEP 3b — the OCCT-FREE profile bridge feeds the native
// feature ops (forge::native::brep::sweep/prism/loftSections,
// forge::native::csg::revolve), which consume an ordered 2D point ring, NOT an
// OCCT TopoDS_Wire. geom/Geom.hpp is pure C++20 (no OCCT) so it is safe to pull
// into this header (it is ALWAYS compiled — only the native ROUTING that uses
// the rings is gated behind FORGE_NATIVE_BREP).
#include "forge/native/geom/Geom.hpp"   // forge::native::geom::Point2

// Forward-declare planegcs types to avoid bleeding their headers into binding.cpp.
namespace GCS {
class System;
class Point;
class Line;
class Circle;
class Arc;
}  // namespace GCS

namespace forge {

using SketchHandle    = std::uint32_t;
using SketchParamId   = std::uint32_t;  // identifies a point's (x, y) parameter pair
using SketchEntityId  = std::uint32_t;  // identifies a geometry entity (line / circle / arc)
using SketchValueId   = std::uint32_t;  // identifies a value-bearing parameter (distance, etc.)

constexpr SketchHandle  kInvalidSketch = 0;

// Constraint kinds exposed to JS. The trailing comment is the planegcs
// primitive we route the call through.
enum class SketchConstraintKind : std::uint32_t {
    Coincident     = 1,   // addConstraintP2PCoincident
    Parallel       = 2,   // addConstraintParallel
    Perpendicular  = 3,   // addConstraintPerpendicular
    Distance       = 4,   // addConstraintP2PDistance  (value required)
    Horizontal     = 5,   // addConstraintHorizontal(line)  -- or 2-point overload
    Vertical       = 6,   // addConstraintVertical(line)
    PointOnLine    = 7,   // addConstraintPointOnLine
    PointOnCircle  = 8,   // addConstraintPointOnCircle
    Equal          = 9,   // addConstraintEqualLength (lines) / EqualRadius (circles)
    Tangent        = 10,  // addConstraintTangent (line↔circle is the supported pair)
};

enum class SketchSolveStatus : std::uint32_t {
    Success       = 0,
    Failed        = 1,
    Inconsistent  = 2,
};

struct SketchSolveResult {
    SketchSolveStatus status;
    int               dof;          // -1 if not diagnosable
    int               iterations;   // best-effort estimate; planegcs doesn't expose this directly
};

struct Sketch;  // opaque, defined in Sketcher.cpp

class SketchRegistry {
public:
    static SketchRegistry& instance();

    SketchHandle createSketch();
    bool         exists(SketchHandle h) const;
    Sketch&      get(SketchHandle h);
    void         destroySketch(SketchHandle h);
    std::size_t  liveCount() const;

private:
    SketchRegistry() = default;
    mutable std::mutex mtx_;
    std::unordered_map<SketchHandle, std::unique_ptr<Sketch>> sketches_;
    SketchHandle next_ = 1;
};

// --------------------------------------------------------------------- Sketch API
// Each function dispatches to SketchRegistry::get(handle) and operates on
// the sketch's internal state. They throw std::runtime_error on bad input.

SketchHandle createSketch();
void         destroySketch(SketchHandle h);

// Point — returns a SketchParamId. The point's coordinates can be read back
// with readPoint() and modified by solving constraints.
SketchParamId addPoint(SketchHandle h, double x, double y);

// Line between two existing points. Returns a SketchEntityId.
SketchEntityId addLine(SketchHandle h, SketchParamId p0, SketchParamId p1);

// Circle: center point + scalar radius. The scalar lives in the sketch's
// value pool but is referenced by entity id only.
SketchEntityId addCircle(SketchHandle h, SketchParamId center, double radius);

// Arc: center + start + end + initial radius derived from |start - center|.
// planegcs's arc has 5 free params (cx, cy, rad, startAngle, endAngle); we
// derive the angles from start / end on initial insertion.
SketchEntityId addArc(SketchHandle h, SketchParamId center, SketchParamId p0, SketchParamId p1);

// Add a constraint. `refs` is a span of entity / point IDs whose meaning
// depends on `kind`:
//   Coincident:    refs = {ptA, ptB}
//   Parallel:      refs = {lineA, lineB}
//   Perpendicular: refs = {lineA, lineB}
//   Distance:      refs = {ptA, ptB}             value = target distance
//   Horizontal:    refs = {lineA}                (or {ptA, ptB})
//   Vertical:      refs = {lineA}                (or {ptA, ptB})
//   PointOnLine:   refs = {pt, line}
//   PointOnCircle: refs = {pt, circle}
//   Equal:         refs = {lineA, lineB}         (or {circleA, circleB})
//   Tangent:       refs = {line, circle}
// `value` is consulted only when the constraint has a scalar — pass 0.0 to
// skip. IDs are tagged in the low bit (lsb=1 means SketchEntityId, lsb=0
// means SketchParamId) so we can disambiguate without a separate type tag.
std::uint32_t addConstraint(
    SketchHandle h,
    SketchConstraintKind kind,
    const std::vector<std::uint32_t>& refs,
    double value
);

// Solve the constraint network. Returns final status + DOF.
SketchSolveResult solve(SketchHandle h);

// Read back a point's current (x, y).
struct SketchPoint { double x; double y; };
SketchPoint readPoint(SketchHandle h, SketchParamId pid);

// Mutate a point's coordinates (without resolving). Used to set up "move
// one point, then solve" workflows from JS.
void writePoint(SketchHandle h, SketchParamId pid, double x, double y);

// Build OCCT wires (TopoDS_Wire) from the sketch's lines / circles / arcs.
// The sketch is assumed to live on the XY plane (Z = 0) — every native
// part-feature consumer (extrude, revolve, sweep, …) re-orients via its
// own gp_Ax1 / direction inputs. Closed curves (circles) become their own
// closed wire; line + arc segments are stitched into wires by matching
// shared endpoints within Precision::Confusion.
std::vector<TopoDS_Wire> extractWires(SketchHandle h);

// IN-HOUSE KERNEL STEP 3b — OCCT-FREE profile bridge.
//
// Extract the sketch's closed loops as ordered 2D point RINGS on the local
// (Z=0) sketch plane — the input form the in-house native feature ops want
// (forge::native::brep::Profile / LoftSection, forge::native::csg::revolve).
//
// This walks the SAME raw GCS::Line / GCS::Circle / GCS::Arc data that
// extractWires reads, but emits ordered `geom::Point2` rings instead of OCCT
// wires, so the feature-profile path is genuinely OCCT-free. Each ring is
// returned WITHOUT a repeated closing vertex.
//
//   * A circle becomes its own ring, sampled into `circleSegments` chords.
//   * Arcs and lines are stitched head-to-tail (endpoint matching within
//     1e-5, mirroring extractWires) into one ring per closed loop; arcs are
//     sampled into chords at the same angular resolution as a full circle.
//
// Winding is NOT forced here — the caller orients each ring (CCW outer / CW
// hole) via the native signedArea, exactly as the native Profile contract
// requires. Open (non-closed) chains are still returned as a ring (the caller
// decides whether an open chain is valid for its op).
std::vector<std::vector<native::geom::Point2>>
extractProfileRings(SketchHandle h, int circleSegments = 96);

// ===================================================================
// Constraint DIAGNOSTICS — sketcher-constraints.md "Phase A".
//
// These SURFACE the diagnose pipeline that planegcs's GCS::System already
// computes (GCS.h: diagnose(), getConflicting/getRedundant/
// getPartiallyRedundant/getDependentParams(Groups), dofsNumber(),
// calculateConstraintErrorByTag()) but which the original 3-state `solve()`
// status dropped on the floor. No new numerics — pure facade exposure.
//
// They are bound to JS under `forge.sketch.diagnose.*` by
// src/binding_sketchdiag.cpp.

// What kind of geometry parameter a dependent param maps back to.
enum class SketchParamRole : std::uint8_t {
    PointX = 0,
    PointY = 1,
    CircleRadius = 2,
    ArcRadius = 3,
    ArcStartAngle = 4,
    ArcEndAngle = 5,
    Unknown = 255,
};

// A dependent (still-free) geometry parameter the solver flagged as a remaining
// degree of freedom — mapped back from the raw double* to the owning point /
// entity ID the JS caller knows.
struct SketchDependentParam {
    SketchParamRole role;
    std::uint32_t   ownerId;   // SketchParamId (PointX/Y) or SketchEntityId (radius/angles)
    int             group;     // index into getDependentParamsGroups(), or -1 if ungrouped
};

// Per-constraint residual: how far the constraint is from satisfied, by tag.
struct SketchConstraintResidual {
    int    tag;       // the tag returned by addConstraint()
    double residual;  // RMS error from GCS::calculateConstraintErrorByTag (NaN if no such tag)
};

// The full solver-backed diagnosis of a sketch.
struct SketchDiagnostics {
    int                 dof;                    // dofsNumber(): remaining DOF, or -1 if not diagnosable
    bool                emptyDiagnoseMatrix;    // isEmptyDiagnoseMatrix(): no driving constraints
    bool                hasConflicting;
    bool                hasRedundant;
    bool                hasPartiallyRedundant;
    std::vector<int>    conflicting;            // constraint TAGS that are mutually inconsistent
    std::vector<int>    redundant;              // constraint TAGS removable with no info lost
    std::vector<int>    partiallyRedundant;     // constraint TAGS over-determining a sub-DOF
    std::vector<SketchDependentParam> dependentParams;  // which geometry is still free
    int                 dependentParamGroupCount;
    // Classification derived from the above (DCM-style):
    //   "well"       — dof == 0, no conflicts/redundancy
    //   "under"      — dof  > 0
    //   "over"       — has conflicting tags (structurally inconsistent)
    //   "redundant"  — consistent but has redundant/partially-redundant tags
    //   "empty"      — no driving constraints to diagnose
    std::string         classification;
};

// Run a real solver-backed diagnose on the live sketch and return the full
// conflicting / redundant / partially-redundant / dependent-param report plus
// the rank-based DOF. Re-declares unknowns + initSolution(diagnose) so the
// report is valid even if the caller never called solve(). Does NOT mutate
// geometry (diagnose is a Jacobian-rank analysis, not a solve).
SketchDiagnostics diagnoseSketch(SketchHandle h);

// Residual of the constraint(s) carrying `tag`, via
// GCS::calculateConstraintErrorByTag (RMS of the per-solver-constraint errors;
// NaN if no constraint has that tag).
double constraintResidual(SketchHandle h, int tag);

// Residuals for EVERY tag the JS caller has added (1..nextConstraintTag).
std::vector<SketchConstraintResidual> allConstraintResiduals(SketchHandle h);

// SOLVER-BACKED replacement for the static src/SketchDof.cpp counting table.
// Builds nothing new — it diagnoses the live sketch and returns a DOF/health
// report whose `dof` is the true Jacobian-rank DOF (correct for coupled/looped
// systems, where the static count is wrong). `staticEstimate` carries the old
// counting value alongside, for a pre-solve UX hint only.
struct SketchAuditResult {
    int          totalEntities;
    int          totalConstraints;
    int          staticEstimate;   // legacy counting-table freeDof (pre-solve hint)
    int          solverDof;        // dofsNumber() — the SOURCE OF TRUTH
    std::string  status;           // SketchDiagnostics::classification
    bool         hasConflicting;
    bool         hasRedundant;
    bool         hasPartiallyRedundant;
};
SketchAuditResult auditSketch(SketchHandle h);

}  // namespace forge
